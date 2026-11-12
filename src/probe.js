'use strict';
// Remote probe. A probe is this same program running in "probe" mode on a PC in another network: it listens for syslog and SNMP traps there,
// does NOT store them, and sends every received packet (unchanged, with the sender's address and the receive time) over HTTPS to the main
// NetEventPro. The main server then handles it exactly like a packet it received itself (parsing, MIB names, rules, alarms, reports).
// If the link is down the packets wait in a queue (kept on disk) and are sent when it is back.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const tls = require('node:tls');
const { decodeMessage, buildInformReply } = require('./ber');
const { SecretBox } = require('./secretbox');

const MAX_QUEUE = 300000, BATCH = 800, MAX_PACKET = 8192;
const normFp = (x) => String(x || '').toLowerCase().replace(/[^0-9a-f]/g, '');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

class Probe {
  constructor(config, dir) {
    this.config = config; this.file = path.join(dir, 'probe-queue.json'); this.box = new SecretBox(dir); this.rate = new Map();
    this.q = []; this.dirty = false; this.busy = false; this.backoff = 0; this.nextTry = 0; this.trapSock = null;
    this.s = { sent: 0, dropped: 0, received: 0, lastOk: 0, lastError: '', lastErrorAt: 0, sending: false };
    try {   // the queue is encrypted on disk (1.44); a plain file from an older version is read once and re-written encrypted
      const raw = fs.readFileSync(this.file), dec = this.box.openFile(raw), j = JSON.parse(dec ? dec.toString('utf8') : raw.toString('utf8'));
      if (Array.isArray(j)) { this.q = j.slice(-MAX_QUEUE); if (!dec && this.q.length) this.dirty = true; }
    } catch { /* no queue yet */ }
    this.timer = setInterval(() => this.tick(), 1000); this.timer.unref?.();
    this.saver = setInterval(() => this.save(), 5000); this.saver.unref?.();
  }
  get on() { return this.config.get().mode === 'probe'; }
  /** the probe settings with the token readable (it is stored encrypted) */
  cfg() { const p = this.config.get().probe || {}; return { ...p, token: this.box.open(p.token) }; }
  /** per-sender limit: more than `rateLimit` packets per second from one address are dropped and counted */
  limited(ip) {
    const lim = Number(this.config.get().probe?.rateLimit) || 0; if (!lim) return false;
    const now = Math.floor(Date.now() / 1000); let r = this.rate.get(ip);
    if (!r || r.s !== now) { r = { s: now, n: 0 }; this.rate.set(ip, r); if (this.rate.size > 5000) for (const [k, v] of this.rate) if (v.s < now - 5) this.rate.delete(k); }
    return ++r.n > lim;
  }

  add(kind, buf, ip) {      // kind 's' (syslog) or 't' (SNMP trap)
    if (!buf || !buf.length) return;
    if (buf.length > MAX_PACKET) buf = buf.subarray(0, MAX_PACKET);
    if (this.limited(ip)) { this.s.limited = (this.s.limited || 0) + 1; return; }
    this.s.received++;
    if (this.q.length >= MAX_QUEUE) { this.q.shift(); this.s.dropped++; }
    this.q.push({ t: Date.now(), ip, k: kind, b: buf.toString('base64') }); this.dirty = true;
  }
  addSyslog(buf, ip) { this.add('s', buf, ip); }
  /** an SNMP packet: informs are answered here (the main server is too far away for the device's timeout), then the packet is queued */
  addTrap(buf, ip, rinfo, sock) {
    try { const t = decodeMessage(buf); if (t.kind === 'inform' && sock && rinfo) sock.send(buildInformReply(t), rinfo.port, rinfo.address); } catch { /* not a trap we can read: the server decides */ }
    this.add('t', buf, ip);
  }

  save() { if (!this.dirty) return; this.dirty = false; try { fs.writeFileSync(this.file + '.tmp', this.box.sealFile(Buffer.from(JSON.stringify(this.q)))); fs.renameSync(this.file + '.tmp', this.file); } catch { /* best effort */ } }
  status() { const c = this.cfg(); return { mode: this.on ? 'probe' : 'central', server: c.server || '', name: c.name || '', queued: this.q.length, ...this.s, backoffSec: Math.round(this.backoff / 1000) }; }

  async tick() {
    if (!this.on || this.busy || !this.q.length || Date.now() < this.nextTry) return;
    const c = this.cfg(); if (!c.server || !c.token) { this.fail('Set the server address and the probe token (Settings → Remote probe).'); return; }
    this.busy = true; this.s.sending = true;
    const items = this.q.slice(0, BATCH);
    try {
      await this.post(c, { probe: c.name || '', items });
      this.q.splice(0, items.length); this.dirty = true; this.s.sent += items.length; this.s.lastOk = Date.now(); this.s.lastError = ''; this.backoff = 0; this.nextTry = 0;
    } catch (e) { this.fail(e.message); }
    finally { this.busy = false; this.s.sending = false; }
  }
  fail(msg) { this.s.lastError = msg; this.s.lastErrorAt = Date.now(); this.backoff = Math.min(30000, (this.backoff || 1000) * 2); this.nextTry = Date.now() + this.backoff; }

  post(c, body, apiPath = '/api/probe/ingest') {
    return new Promise((resolve, reject) => {
      let u; try { u = new URL(apiPath, c.server.includes('://') ? c.server : 'https://' + c.server); } catch { return reject(new Error('The server address is not valid.')); }
      if (u.protocol === 'http:' && c.requireHttps) return reject(new Error('The address is plain http:// and "Require HTTPS" is on. Use an https:// address.'));
      const data = Buffer.from(JSON.stringify(body)); const mod = u.protocol === 'https:' ? https : http;
      const pin = u.protocol === 'https:' ? normFp(c.pinSha256) : '';
      if (pin) {   // pinned certificate: connect first, compare the fingerprint, and only then hand the connected socket to the HTTP request (nothing is sent to a wrong server)
        return Probe.pinnedSocket(u, pin).then((sock) => this.send(mod, u, data, c, resolve, reject, sock), reject);
      }
      this.send(mod, u, data, c, resolve, reject, null);
    });
  }
  /** a TLS connection whose certificate fingerprint (SHA-256) was checked against `pin` */
  static pinnedSocket(u, pin) {
    return new Promise((resolve, reject) => {
      const s = tls.connect({ host: u.hostname.replace(/^\[|\]$/g, ''), port: +u.port || 443, servername: /^[\d.:]+$/.test(u.hostname) ? undefined : u.hostname, rejectUnauthorized: false, timeout: 15000 });
      s.once('error', (e) => reject(new Error(e.code === 'ECONNREFUSED' ? 'Cannot connect to the server (refused).' : e.message)));
      s.once('timeout', () => s.destroy(new Error('The server did not answer in time.')));
      s.once('secureConnect', () => {
        const fp = normFp(new crypto.X509Certificate(s.getPeerCertificate().raw).fingerprint256);
        if (fp !== pin) { s.destroy(); return reject(new Error('The server certificate does not match the pinned fingerprint. Nothing was sent. If the certificate was renewed on purpose, pin it again.')); }
        s.setTimeout(0); resolve(s);
      });
    });
  }
  /** reads the certificate a server presents, to pin it (nothing is sent) */
  static fetchPin(server) {
    return new Promise((resolve, reject) => {
      let u; try { u = new URL(server.includes('://') ? server : 'https://' + server); } catch { return reject(new Error('The server address is not valid.')); }
      if (u.protocol !== 'https:') return reject(new Error('Only an https:// address has a certificate.'));
      const s = tls.connect({ host: u.hostname.replace(/^\[|\]$/g, ''), port: +u.port || 443, servername: /^[\d.:]+$/.test(u.hostname) ? undefined : u.hostname, rejectUnauthorized: false, timeout: 15000 });
      s.once('error', (e) => reject(new Error(e.code === 'ECONNREFUSED' ? 'Cannot connect to the server (refused).' : e.message)));
      s.once('timeout', () => s.destroy(new Error('The server did not answer in time.')));
      s.once('secureConnect', () => { const x = new crypto.X509Certificate(s.getPeerCertificate().raw); const o = { fingerprint: normFp(x.fingerprint256), subject: x.subject.replace(/\n/g, ', '), issuer: x.issuer.replace(/\n/g, ', '), validTo: x.validTo, trusted: s.authorized }; s.destroy(); resolve(o); });
    });
  }
  send(mod, u, data, c, resolve, reject, sock) {
    {
      const req = mod.request(u, { method: 'POST', timeout: 20000, ...(sock ? { createConnection: () => sock } : {}), rejectUnauthorized: !c.allowSelfSigned, headers: { 'content-type': 'application/json', 'content-length': data.length, authorization: 'Bearer ' + c.token } }, (res) => {
        const ch = []; res.on('data', (d) => ch.push(d)); res.on('end', () => {
          if (res.statusCode === 200) { let j = null; try { j = JSON.parse(Buffer.concat(ch).toString()); } catch { /* no body */ } return resolve(j); }
          let m = ''; try { m = JSON.parse(Buffer.concat(ch).toString()).error || ''; } catch { /* not JSON */ }
          reject(new Error(res.statusCode === 401 || res.statusCode === 403 ? 'The server refused the token (' + (m || res.statusCode) + ').' : `The server answered ${res.statusCode}${m ? ': ' + m : ''}`));
        });
      });
      req.on('timeout', () => req.destroy(new Error('The server did not answer in time.'))); req.on('error', (e) => reject(new Error(e.code === 'ECONNREFUSED' ? 'Cannot connect to the server (refused).' : e.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || /self.signed|certificate/i.test(e.message) ? 'The server certificate is not trusted (tick "Accept a self-signed certificate" if you trust it).' : e.message)));
      req.end(data);
    }
  }
  shutdown() { clearInterval(this.timer); clearInterval(this.saver); this.dirty = true; this.save(); }
}

/** the central side: probe definitions are kept as { id, name, tokenHash, enabled } and seen-statistics in memory */
class ProbeRegistry {
  constructor(config) { this.config = config; this.stats = new Map(); }
  list() { return (this.config.get().probes || []).map((p) => ({ id: p.id, name: p.name, enabled: p.enabled !== false, created: p.created || 0, allow: p.allow || [], rotated: p.rotated || 0, oldTokenUntil: p.prevUntil > Date.now() ? p.prevUntil : 0, ...(this.stats.get(p.id) || { packets: 0, last: 0, ip: '' }) })); }
  create(name) {
    const token = 'nep_' + crypto.randomBytes(24).toString('base64url'); const id = 'p' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
    const probes = [...(this.config.get().probes || []), { id, name, tokenHash: sha(token), enabled: true, created: Date.now() }];
    this.config.update({ probes }); return { id, name, token };
  }
  /** a new token for a probe; the old one keeps working for 24 hours so the probe PC can be updated without a gap */
  rotate(id) {
    const token = 'nep_' + crypto.randomBytes(24).toString('base64url'); let hit = null;
    const probes = (this.config.get().probes || []).map((p) => { if (p.id !== id) return p; hit = p; return { ...p, prevHash: p.tokenHash, prevUntil: Date.now() + 24 * 3600000, tokenHash: sha(token), rotated: Date.now() }; });
    if (!hit) return null; this.config.update({ probes }); return { id, name: hit.name, token };
  }
  setAllow(id, list) { this.config.update({ probes: (this.config.get().probes || []).map((p) => (p.id === id ? { ...p, allow: list } : p)) }); }
  remove(id) { this.config.update({ probes: (this.config.get().probes || []).filter((p) => p.id !== id) }); this.stats.delete(id); }
  setEnabled(id, on) { this.config.update({ probes: (this.config.get().probes || []).map((p) => (p.id === id ? { ...p, enabled: !!on } : p)) }); }
  /** the probe that owns this token, or null */
  find(token) {
    const h = sha(token), hb = Buffer.from(h);
    const same = (x) => { const pb = Buffer.from(String(x || '')); return pb.length === hb.length && crypto.timingSafeEqual(pb, hb); };
    for (const p of this.config.get().probes || []) { if (same(p.tokenHash)) return p; if (p.prevHash && p.prevUntil > Date.now() && same(p.prevHash)) return p; }   // the old token still works for a day after a rotation
    return null;
  }
  note(p, n, ip) { const s = this.stats.get(p.id) || { packets: 0, last: 0, ip: '' }; s.packets += n; s.last = Date.now(); s.ip = ip; this.stats.set(p.id, s); }
}

module.exports = { Probe, ProbeRegistry };
