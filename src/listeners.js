'use strict';
const dgram = require('node:dgram');
const net = require('node:net');
const tls = require('node:tls');
const fs = require('node:fs');
const { StreamFramer } = require('./parser');

const clean = (a) => (a || '').replace(/^::ffff:/, '');
const MAX_TCP_TOTAL = 2000, MAX_TCP_PER_IP = 200;   // one sender cannot use up every connection slot

/** UDP + TCP syslog listeners with live status and restart support. */
class Listeners {
  constructor(onPacket, isAllowed = () => true) {
    this.onPacket = onPacket; // (buf, srcIp, proto) => void
    this.isAllowed = isAllowed; // (srcIp) => boolean  — "accept only from these sources" list
    this.udp = null; this.tcp = null; this.conns = new Set(); this.perIp = new Map();
    this.status = {
      udp: { running: false, port: null, error: null, packets: 0, bytes: 0, rejected: 0 },
      tcp: { running: false, port: null, error: null, connections: 0, packets: 0, bytes: 0, rejected: 0 },
      tls: { running: false, port: null, error: null, connections: 0, packets: 0, bytes: 0, rejected: 0, handshakeErrors: 0 }
    };
  }

  async apply(cfg) {
    await this.stop();
    if (cfg.udpEnabled) await this.startUdp(cfg.udpPort, cfg.syslogBind, cfg.udpRecvMB);
    if (cfg.tcpEnabled) await this.startTcp(cfg.tcpPort, cfg.syslogBind);
    if (cfg.tlsSyslogEnabled) await this.startTls(cfg);
  }

  startUdp(port, bind, recvMB = 16) {
    return new Promise((resolve) => {
      const st = this.status.udp;
      st.error = null; st.port = port;
      const family = bind.includes(':') ? 'udp6' : 'udp4';
      const s = dgram.createSocket({ type: family, reuseAddr: false });
      s.on('error', (e) => {
        st.running = false; st.error = explain(e, 'UDP', port);
        console.error('[udp]', st.error);
        try { s.close(); } catch { /* ignore */ }
        resolve();
      });
      s.on('message', (buf, rinfo) => {
        const ip = clean(rinfo.address);
        if (!this.isAllowed(ip)) { st.rejected++; return; }
        st.packets++; st.bytes += buf.length;
        this.onPacket(buf, ip, 'udp');
      });
      s.bind(port, bind, () => {
        const want = Math.round(Math.min(256, Math.max(1, +recvMB || 16)) * 1024 * 1024); st.wantBuf = want; try { s.setRecvBufferSize(want); } catch { /* OS may cap it */ } try { st.recvBuf = s.getRecvBufferSize(); } catch { st.recvBuf = null; }
        st.running = true;
        this.udp = s;
        console.log(`[udp] listening on ${bind}:${port}`);
        resolve();
      });
    });
  }

  /** syslog over TLS (RFC 5425, usually port 6514), using the same certificate as the HTTPS dashboard */
  startTls(cfg) {
    const st = this.status.tls; st.error = null; st.port = cfg.tlsSyslogPort;
    if (!cfg.tlsCertFile || !cfg.tlsKeyFile) { st.running = false; st.error = 'Secure syslog needs a certificate: Settings → Access & updates → HTTPS (create or choose one), then save.'; return Promise.resolve(); }
    let opts; try { opts = { cert: fs.readFileSync(cfg.tlsCertFile), key: fs.readFileSync(cfg.tlsKeyFile), minVersion: 'TLSv1.2' }; } catch (e) { st.running = false; st.error = 'Cannot read the certificate files: ' + e.message; return Promise.resolve(); }
    return this.startTcp(cfg.tlsSyslogPort, cfg.syslogBind, opts);
  }

  startTcp(port, bind, tlsOpts) {
    return new Promise((resolve) => {
      const kind = tlsOpts ? 'tls' : 'tcp', st = this.status[kind];
      st.error = null; st.port = port;
      const onConn = (sock) => {
        if (this.conns.size >= MAX_TCP_TOTAL) { sock.destroy(); return; }
        const ip = clean(sock.remoteAddress);
        if (!this.isAllowed(ip)) { st.rejected++; sock.destroy(); return; }
        const open = this.perIp.get(ip) || 0;
        if (open >= MAX_TCP_PER_IP) { st.rejected++; sock.destroy(); return; }
        this.perIp.set(ip, open + 1);
        this.conns.add(sock); st.connections = this.conns.size;
        sock.setKeepAlive(true, 30000);
        sock.setTimeout(3600000, () => sock.destroy());   // drop connections that have been silent for an hour
        const framer = new StreamFramer((frame) => {
          st.packets++; st.bytes += frame.length;
          this.onPacket(Buffer.from(frame), ip, kind);
        });
        sock.on('data', (d) => framer.push(d));
        let closed = false;
        const done = () => {
          if (closed) return; closed = true;
          this.conns.delete(sock); st.connections = this.conns.size;
          const left = (this.perIp.get(ip) || 1) - 1; if (left > 0) this.perIp.set(ip, left); else this.perIp.delete(ip);
        };
        sock.on('close', done);
        sock.on('error', () => { done(); sock.destroy(); });
      };
      const srv = tlsOpts ? tls.createServer(tlsOpts, onConn) : net.createServer(onConn);
      if (tlsOpts) srv.on('tlsClientError', () => { st.handshakeErrors++; });
      srv.on('error', (e) => {
        st.running = false; st.error = explain(e, tlsOpts ? 'TLS' : 'TCP', port);
        console.error(`[${kind}]`, st.error);
        resolve();
      });
      srv.listen(port, bind, () => {
        st.running = true; if (tlsOpts) this.tlsSrv = srv; else this.tcp = srv;
        console.log(`[${kind}] listening on ${bind}:${port}`);
        resolve();
      });
    });
  }

  async stop() {
    const closing = [];
    if (this.udp) { const u = this.udp; closing.push(new Promise(r => { try { u.close(r); } catch { r(); } })); this.udp = null; }
    if (this.tcp) {
      const t = this.tcp; closing.push(new Promise(r => t.close(() => r())));
      for (const s of this.conns) s.destroy();
      this.conns.clear(); this.perIp.clear(); this.tcp = null;
    }
    if (this.tlsSrv) { const t = this.tlsSrv; closing.push(new Promise((r) => t.close(() => r()))); this.tlsSrv = null; for (const s of this.conns) s.destroy(); this.conns.clear(); this.perIp.clear(); }
    await Promise.all(closing);
    this.status.udp.running = false; this.status.tcp.running = false; this.status.tls.running = false; this.status.tcp.connections = 0; this.status.tls.connections = 0;
  }
}

function explain(e, proto, port) {
  if (e.code === 'EADDRINUSE') return `${proto} port ${port} is already in use by another program (another syslog server?). Stop it or choose a different port in Settings.`;
  if (e.code === 'EACCES') return `Permission denied opening ${proto} port ${port}. Run NetEventPro as administrator/service, or use a port above 1024.`;
  return `${proto} ${port}: ${e.message}`;
}

module.exports = { Listeners };
