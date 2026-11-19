'use strict';
// 1.98.1 High availability: two NetEventPro servers, a primary and a standby.
//
//  - The standby asks the primary "are you there?" every 5 s. After 3 missed answers (15 s) it takes over: it starts sending
//    e-mails, SMS, webhooks, reports, forwarding and the SQL Server copy, which it holds back while the primary is in charge.
//    When the primary answers again for 30 s it hands back. Both servers always receive, store and raise alarms, so the
//    standby has the full picture at the moment it takes over.
//  - Messages: devices can send to both servers (best, nothing is lost when the primary dies), or the primary copies every
//    syslog message and trap it receives to the standby ("copy messages").
//  - Settings: the standby takes the settings and users of the primary every minute, except the ones that belong to one
//    computer (addresses, certificate files, the HA settings themselves).
// The two talk over the dashboard port. Every request is signed with the shared key (HMAC-SHA256 with a time stamp), and
// settings travel encrypted with a key derived from it, so the shared key is never sent and plain http is still safe.
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');

const LOCAL_KEYS = new Set(['ha', 'webBind', 'webPort', 'tlsCertFile', 'tlsKeyFile', 'syslogBind', 'mode', 'probe', 'backup', 'setupDone', 'renamedTls', 'update']);
let current = null;     // the running HA object (one per process), for the passive() gate used by notifications, reports and forwarding

const sign = (key, ts, method, path, body) => crypto.createHmac('sha256', key).update(`${ts}\n${method}\n${path}\n`).update(crypto.createHash('sha256').update(body || '').digest('hex')).digest('hex');
const boxKey = (key) => crypto.createHash('sha256').update('neteventpro-ha-box\0' + key).digest();
function seal(key, obj) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', boxKey(key), iv); const data = Buffer.concat([c.update(JSON.stringify(obj)), c.final()]); return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }; }
function open(key, box) { const d = crypto.createDecipheriv('aes-256-gcm', boxKey(key), Buffer.from(box.iv, 'base64')); d.setAuthTag(Buffer.from(box.tag, 'base64')); return JSON.parse(Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString()); }

class HA {
  constructor({ config, users, audit, note, version }) {
    this.config = config; this.users = users; this.audit = audit || (() => {}); this.note = note || (() => {}); this.version = version || '';
    this.state = 'off'; this.misses = 0; this.okSince = 0; this.lastOk = 0; this.lastError = ''; this.takeoverAt = 0;
    this.queue = []; this.copied = 0; this.copyDropped = 0; this.copyError = ''; this.lastSync = 0; this.syncError = ''; this.pushing = false;
    this.timers = []; current = this;
    this.apply(); config.onChange(() => this.apply());
  }
  cfg() { const h = this.config.get().ha || {}; return { role: ['primary', 'standby'].includes(h.role) ? h.role : 'off', partner: String(h.partner || '').replace(/\/+$/, ''), key: String(h.sharedKey || ''), copy: !!h.copyMessages, sync: h.syncSettings !== false, allowSelfSigned: !!h.allowSelfSigned }; }
  apply() {
    for (const t of this.timers) clearInterval(t); this.timers = [];
    const c = this.cfg(); if (c.role === 'off' || !c.partner || c.key.length < 16) { this.state = 'off'; return; }
    if (c.role === 'primary') { this.state = 'active'; this.timers.push(setInterval(() => this.push(), 1000)); }
    else { if (this.state !== 'active') this.state = 'passive'; this.timers.push(setInterval(() => this.beat(), 5000)); if (c.sync) { this.timers.push(setInterval(() => this.syncNow(), 60000)); setTimeout(() => this.syncNow(), 3000).unref?.(); } }
    for (const t of this.timers) t.unref?.();
  }
  /** true while this server is a standby and the primary is in charge: hold back everything that would happen twice */
  passive() { return this.state === 'passive'; }

  // ---------- calls to the partner ----------
  call(method, path, body) {
    const c = this.cfg(); const u = new URL(c.partner + path), ts = String(Date.now()), raw = body === undefined ? '' : JSON.stringify(body);
    const lib = u.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const req = lib.request(u, { method, timeout: 4000, rejectUnauthorized: !c.allowSelfSigned, headers: { 'x-nep-ha': `${ts}.${sign(c.key, ts, method, u.pathname, raw)}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) } }, (res) => {
        let d = ''; res.setEncoding('utf8'); res.on('data', (x) => { if (d.length < 20e6) d += x; }); res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch { /* */ } if (res.statusCode === 200 && j) resolve(j); else reject(new Error(j?.error || `the partner answered ${res.statusCode}`)); });
      });
      req.on('timeout', () => req.destroy(new Error('no answer within 4 s'))); req.on('error', (e) => reject(e)); req.end(raw);
    });
  }
  /** a request from the partner: right signature, recent time stamp */
  verify(req, body) {
    const c = this.cfg(); if (c.role === 'off' || c.key.length < 16) return false;
    const m = /^(\d{10,15})\.([0-9a-f]{64})$/.exec(String(req.headers['x-nep-ha'] || '')); if (!m || Math.abs(Date.now() - +m[1]) > 60000) return false;
    const want = sign(c.key, m[1], req.method, new URL(req.url, 'http://x').pathname, body || '');
    return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(m[2]));
  }

  // ---------- standby ----------
  async beat() {
    try {
      const r = await this.call('GET', '/api/ha/peer');
      if (r.role !== 'primary') throw new Error('the partner is not set up as the primary');
      this.misses = 0; this.lastOk = Date.now(); this.lastError = ''; if (!this.okSince) this.okSince = Date.now();
      if (this.state === 'active' && Date.now() - this.okSince >= 30000) {
        this.state = 'passive'; this.audit({ name: 'high availability' }, 'the primary is back: the standby handed back');
        this.note(5, 'High availability: the primary answers again. The standby handed back and holds back notifications again.');
      }
    } catch (e) {
      this.misses++; this.okSince = 0; this.lastError = e.message;
      if (this.state === 'passive' && this.misses >= 3) {
        this.state = 'active'; this.takeoverAt = Date.now(); this.audit({ name: 'high availability' }, `the primary did not answer 3 times (${e.message}): the standby took over`);
        this.note(2, `High availability: the primary does not answer (${e.message}). This standby server has taken over notifications, reports and forwarding.`);
      }
    }
  }
  async syncNow() {
    const c = this.cfg(); if (c.role !== 'standby' || !c.sync) return { ok: false };
    try {
      const r = await this.call('GET', '/api/ha/config'); const d = open(c.key, r.box);
      const patch = {}; for (const [k, v] of Object.entries(d.config || {})) if (!LOCAL_KEYS.has(k)) patch[k] = v;
      const cur = this.config.get(); const changed = Object.keys(patch).filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(patch[k]));
      if (changed.length) this.config.update(Object.fromEntries(changed.map((k) => [k, patch[k]])));
      if (d.users && this.users && JSON.stringify(this.users.data) !== JSON.stringify(d.users)) { this.users.data = this.users.clean(d.users, true); this.users.save(); }
      this.lastSync = Date.now(); this.syncError = ''; return { ok: true, changed: changed.length };
    } catch (e) { this.syncError = e.message; return { ok: false, error: e.message }; }
  }

  // ---------- primary ----------
  /** a packet this server received from a device (not from a probe or the partner): copied to the standby when asked */
  tap(kind, buf, ip) {
    const c = this.cfg(); if (c.role !== 'primary' || !c.copy) return;
    this.queue.push({ k: kind, b: buf.toString('base64'), ip, t: Date.now() });
    if (this.queue.length > 100000) { this.queue.splice(0, this.queue.length - 100000); this.copyDropped++; }
  }
  async push() {
    if (this.pushing || !this.queue.length) return; this.pushing = true;
    try {
      while (this.queue.length) {
        const part = this.queue.slice(0, 2000);
        await this.call('POST', '/api/ha/ingest', { items: part }); this.queue.splice(0, part.length); this.copied += part.length; this.copyError = '';
      }
    } catch (e) { this.copyError = e.message; } finally { this.pushing = false; }
  }
  /** settings and users for the standby, encrypted with the shared key */
  exportBox() { const c = this.cfg(); const cfg = { ...this.config.get() }; delete cfg.ha; return { box: seal(c.key, { config: cfg, users: this.users ? this.users.data : null }) }; }

  status() {
    const c = this.cfg();
    return { role: c.role, state: this.state, partner: c.partner, keySet: c.key.length >= 16, copy: c.copy, sync: c.sync, misses: this.misses, lastOk: this.lastOk, lastError: this.lastError, takeoverAt: this.takeoverAt,
      queue: this.queue.length, copied: this.copied, copyDropped: this.copyDropped, copyError: this.copyError, lastSync: this.lastSync, syncError: this.syncError };
  }
  stop() { for (const t of this.timers) clearInterval(t); this.timers = []; }
}
/** used by notifications, reports, forwarding and the SQL copy: hold back while this server is a standby that is not in charge */
const passive = () => !!(current && current.passive());
module.exports = { HA, passive, seal, open, sign, LOCAL_KEYS };
