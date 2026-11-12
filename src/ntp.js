'use strict';
// SNTP client (RFC 4330) over UDP, no dependencies. It asks your NTP server for the time a few times, keeps the answer with the shortest
// round trip, and remembers how far this computer's clock is from the server. The dashboard clock uses that difference, so it shows
// the server's time even when this PC's own clock is off. The computer's clock itself is never changed.
const dgram = require('node:dgram');
const dns = require('node:dns');
const net = require('node:net');

const EPOCH = 2208988800;   // seconds between 1900 (NTP) and 1970 (Unix)
const toMs = (buf, o) => (buf.readUInt32BE(o) - EPOCH) * 1000 + (buf.readUInt32BE(o + 4) / 4294967296) * 1000;
function writeTs(buf, o, ms) { const s = ms / 1000 + EPOCH; buf.writeUInt32BE(Math.floor(s) >>> 0, o); buf.writeUInt32BE(Math.floor((s % 1) * 4294967296) >>> 0, o + 4); }

/** One request. Resolves { offsetMs, delayMs, stratum } or rejects with a readable message. */
function query(host, port = 123, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    dns.lookup(host, (err, address, family) => {
      if (err) return reject(new Error(`Cannot find "${host}" (${err.code || err.message}).`));
      const sock = dgram.createSocket(family === 6 ? 'udp6' : 'udp4'); let done = false;
      const end = (fn, v) => { if (done) return; done = true; clearTimeout(timer); try { sock.close(); } catch { /* */ } fn(v); };
      const timer = setTimeout(() => end(reject, new Error(`No answer from ${host}:${port} within ${timeoutMs / 1000} s (is UDP ${port} open?).`)), timeoutMs);
      sock.on('error', (e) => end(reject, new Error(`Network error: ${e.message}`)));
      sock.on('message', (msg) => {
        const t3 = Date.now();
        if (msg.length < 48) return;
        const mode = msg[0] & 7, li = msg[0] >> 6, stratum = msg[1];
        if (mode !== 4 && mode !== 5) return;
        if (msg.readUInt32BE(24) !== req.readUInt32BE(40) || msg.readUInt32BE(28) !== req.readUInt32BE(44)) return;   // not the answer to our request: ignore
        if (stratum === 0) return end(reject, new Error(`The server refused the request (kiss code ${msg.toString('ascii', 12, 16).replace(/\0/g, '')}).`));
        if (li === 3 || stratum > 15) return end(reject, new Error('The NTP server says its own clock is not synchronised.'));
        const t1 = toMs(msg, 32), t2 = toMs(msg, 40);
        if (!msg.readUInt32BE(40)) return end(reject, new Error('The server sent an empty time.'));
        end(resolve, { offsetMs: ((t1 - t0) + (t2 - t3)) / 2, delayMs: Math.max(0, (t3 - t0) - (t2 - t1)), stratum });
      });
      const req = Buffer.alloc(48); req[0] = 0x23;   // leap 0, version 4, mode 3 (client)
      const t0 = Date.now(); writeTs(req, 40, t0);
      sock.send(req, port, address, (e) => { if (e) end(reject, new Error(`Cannot send: ${e.message}`)); });
    });
  });
}

/** Asks several times and keeps the answer with the smallest delay (the most trustworthy). */
async function sample(host, port, tries = 3) {
  let best = null, lastErr = null;
  for (let i = 0; i < tries; i++) {
    try { const r = await query(host, port); if (!best || r.delayMs < best.delayMs) best = r; } catch (e) { lastErr = e; if (!best && i === 0 && /Cannot find/.test(e.message)) break; }
  }
  if (!best) throw lastErr || new Error('No answer.');
  return best;
}

function validHost(h) { return typeof h === 'string' && h.length <= 253 && (net.isIP(h) || /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(h)); }

class NtpClock {
  constructor(config) { this.config = config; this.s = { ok: false, offsetMs: 0, delayMs: 0, stratum: 0, lastSync: 0, lastTry: 0, error: '' }; this.timer = null; this.busy = false; }
  start() { this.apply(); this.config.onChange(() => this.apply()); }
  stop() { clearTimeout(this.timer); this.timer = null; }
  cfg() { return this.config.get().ntp || {}; }
  apply() {
    this.stop(); const c = this.cfg();
    if (!c.enabled || !validHost(c.server)) { this.s = { ...this.s, ok: false, error: '' }; return; }
    if (this.key !== `${c.server}:${c.port}`) { this.key = `${c.server}:${c.port}`; this.s.ok = false; this.s.offsetMs = 0; }
    this.sync(); 
  }
  async sync() {
    const c = this.cfg(); if (!c.enabled || this.busy) return; this.busy = true; this.s.lastTry = Date.now();
    try { const r = await sample(c.server, c.port || 123); Object.assign(this.s, { ok: true, offsetMs: r.offsetMs, delayMs: r.delayMs, stratum: r.stratum, lastSync: Date.now(), error: '' }); }
    catch (e) { this.s.error = e.message; if (Date.now() - this.s.lastSync > 3 * (c.intervalMin || 15) * 60000) this.s.ok = false; }
    finally { this.busy = false; clearTimeout(this.timer); const c2 = this.cfg(); if (c2.enabled) { this.timer = setTimeout(() => this.sync(), Math.max(1, c2.intervalMin || 15) * 60000 * (this.s.error ? 0.2 : 1)); this.timer.unref?.(); } }
  }
  /** the time in ms: this computer's clock corrected by the NTP difference (uncorrected when NTP is off or has not answered yet) */
  now() { return Date.now() + (this.s.ok ? this.s.offsetMs : 0); }
  info() { const c = this.cfg(); return { enabled: !!c.enabled, server: c.server || '', ok: this.s.ok, offsetMs: Math.round(this.s.offsetMs), delayMs: Math.round(this.s.delayMs), stratum: this.s.stratum, lastSync: this.s.lastSync, error: this.s.error, zone: c.zone || '' }; }
}

module.exports = { NtpClock, query, sample, validHost };
