'use strict';
const SEVX = require('./sev');
const dgram = require('node:dgram');
const net = require('node:net');
const { buildV1, buildV2, pduV2 } = require('./ber');

/** Relays raw syslog messages to other collectors (SIEM, second server...). */
class Forwarder {
  constructor() {
    this.targets = []; this.udp = dgram.createSocket('udp4'); this.udp.on('error', () => {});
    this.tcp = new Map(); this.stats = new Map();
  }

  configure(targets) {
    this.targets = (targets || []).filter(t => t && t.enabled !== false && t.host && t.port);
    const keep = new Set(this.targets.map(t => key(t)));
    for (const [k, s] of this.tcp) if (!keep.has(k)) { s.sock.destroy(); this.tcp.delete(k); }
  }

  send(msg) {
    for (const t of this.targets) {
      if (t.minSeverity !== undefined && t.minSeverity !== '' && SEVX.rank(msg.severity) > SEVX.rank(+t.minSeverity)) continue; // only forward this severity and worse
      const st = this.stats.get(key(t)) || { sent: 0, errors: 0 };
      this.stats.set(key(t), st);
      // Forward original bytes; if the sender had no PRI, add one so downstream parsers work.
      let payload = msg.raw;
      if (!/^<\d{1,3}>/.test(payload)) payload = `<${msg.facility * 8 + SEVX.syslogNum(msg.severity)}>` + payload;
      if (t.protocol === 'tcp') this.sendTcp(t, payload, st);
      else {
        const buf = Buffer.from(payload);
        this.udp.send(buf, t.port, t.host, (e) => { if (e) st.errors++; else st.sent++; });
      }
    }
  }

  sendTcp(t, payload, st) {
    const k = key(t);
    let c = this.tcp.get(k);
    if (!c || c.sock.destroyed) {
      const sock = net.connect({ host: t.host, port: t.port });
      c = { sock, ready: false, pending: [] };
      this.tcp.set(k, c);
      sock.on('connect', () => { c.ready = true; for (const p of c.pending) sock.write(p); c.pending = []; });
      sock.on('error', () => { st.errors++; });
      sock.on('close', () => { c.ready = false; if (this.tcp.get(k) === c) this.tcp.delete(k); });
    }
    const line = payload + '\n';
    if (c.ready) { c.sock.write(line); st.sent++; }
    else if (c.pending.length < 5000) { c.pending.push(line); st.sent++; }
    else st.errors++;
  }

  status() {
    return this.targets.map(t => ({ name: t.name, host: t.host, port: t.port, protocol: t.protocol || 'udp', ...(this.stats.get(key(t)) || { sent: 0, errors: 0 }) }));
  }
}
const key = (t) => `${t.protocol || 'udp'}://${t.host}:${t.port}`;

/** Northbound SNMP: relays every received trap, as a trap of the same kind and with the same values, to another manager (NMS). */
class TrapForwarder {
  constructor() { this.targets = []; this.udp = dgram.createSocket('udp4'); this.udp.on('error', () => {}); this.stats = new Map(); this.reqId = 1; this.v3 = null; }
  configure(targets) { this.targets = (targets || []).filter((t) => t && t.enabled !== false && t.host && t.port); }
  send(msg) {
    const f = msg.trapFwd; if (!f || !this.targets.length) return;
    for (const t of this.targets) {
      if (t.minSeverity !== undefined && t.minSeverity !== '' && SEVX.rank(msg.severity) > SEVX.rank(+t.minSeverity)) continue;
      const k = `${t.host}:${t.port}`, st = this.stats.get(k) || { sent: 0, errors: 0 }; this.stats.set(k, st);
      let pkt; try { pkt = this.build(f, t); } catch { st.errors++; continue; }
      this.udp.send(pkt, t.port, t.host, (e) => { if (e) st.errors++; else st.sent++; });
    }
  }
  build(f, t) {
    const vbs = (f.varbinds || []).filter((v) => ['integer', 'counter32', 'gauge32', 'timeticks', 'counter64', 'octets', 'opaque', 'oid', 'ipaddress', 'null'].includes(v.type));
    const community = t.community || 'public', uptime = f.uptime || 0;
    if (t.version === 'v3') {       // this program is the authoritative engine: the manager needs our engine ID (Settings → SNMP & MIBs shows it)
      if (!this.v3) throw new Error('SNMPv3 is not available');
      const pdu = pduV2({ uptime, trapOid: f.trapOid || [1, 3, 6, 1, 6, 3, 1, 1, 5, 1], requestId: this.reqId++ & 0x7fffffff, varbinds: [...vbs, { oid: '1.3.6.1.6.3.18.1.3.0', type: 'ipaddress', value: /^\d+\.\d+\.\d+\.\d+$/.test(f.srcIp || '') ? f.srcIp : '0.0.0.0' }] });
      return this.v3.buildTrap(t, pdu);
    }
    if (t.version === 'v1') {
      const enterprise = f.enterprise || (f.trapOid ? f.trapOid.slice(0, -1) : [1, 3, 6, 1, 4, 1]);
      const generic = f.v1 ? f.v1.generic : 6, specific = f.v1 ? f.v1.specific : (f.trapOid ? f.trapOid[f.trapOid.length - 1] : 0);
      return buildV1({ community, enterprise, agentAddr: f.agentAddr || f.srcIp || '0.0.0.0', generic, specific, uptime, varbinds: vbs });
    }
    // v2c: keep the address of the original sender (snmpTrapAddress.0, RFC 3584) so the manager knows which device it was
    return buildV2({ community, uptime, trapOid: f.trapOid || [1, 3, 6, 1, 6, 3, 1, 1, 5, 1], requestId: this.reqId++ & 0x7fffffff, varbinds: [...vbs, { oid: '1.3.6.1.6.3.18.1.3.0', type: 'ipaddress', value: /^\d+\.\d+\.\d+\.\d+$/.test(f.srcIp || '') ? f.srcIp : '0.0.0.0' }] });
  }
  status() { return this.targets.map((t) => ({ name: 'SNMP → ' + (t.name || t.host), host: t.host, port: t.port, protocol: 'snmp ' + (t.version || 'v2c'), ...(this.stats.get(`${t.host}:${t.port}`) || { sent: 0, errors: 0 }) })); }
}

module.exports = { Forwarder, TrapForwarder };
