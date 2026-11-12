'use strict';
// SNMP polling on a probe (1.48). A probe polls the devices of its own network that the main server cannot reach. It asks the main server every 10 seconds
// for its device list (with the SNMP credentials, over the same authenticated HTTPS link as the packets), polls them on their own schedule with the same code the
// server uses (pollcore.js) and sends the results back. If the link is down the results wait in a queue on disk (encrypted) and are sent later, in order.
// The main server keeps the readings, evaluates the thresholds and raises the alarms; the probe only measures.
const fs = require('node:fs');
const path = require('node:path');
const { Collector } = require('./pollcore');
const { SnmpClient } = require('./snmpclient');

const MAX_RESULTS = 10000, BATCH = 100, SYNC_MS = 10000;

class ProbePoller {
  /** probe: the Probe object (for the link: probe.cfg(), probe.post(), probe.box) */
  constructor(probe, dir) {
    this.probe = probe; this.collector = new Collector(new SnmpClient()); this.file = path.join(dir, 'probe-poll-queue.json'); this.cfgFile = path.join(dir, 'probe-poll-config.json');
    this.cfg = { devices: [], profiles: [], workers: 5, enabled: true }; this.next = new Map(); this.fails = new Map(); this.busy = new Set(); this.out = []; this.taskOut = []; this.running = 0; this.syncing = false; this.sending = false; this.nextSync = 0; this.backoff = 0; this.nextSend = 0; this.dirty = false;
    this.s = { devices: 0, polls: 0, sent: 0, lastSync: 0, lastError: '', jobs: 0 };
    try { const raw = fs.readFileSync(this.file), dec = probe.box.openFile(raw), j = JSON.parse(dec ? dec.toString('utf8') : raw.toString('utf8')); if (Array.isArray(j)) this.out = j.slice(-MAX_RESULTS); } catch { /* no queue yet */ }
    try { const raw = fs.readFileSync(this.cfgFile), dec = probe.box.openFile(raw), j = JSON.parse(dec ? dec.toString('utf8') : raw.toString('utf8')); if (j && Array.isArray(j.devices)) this.cfg = j; } catch { /* nothing cached */ }
    this.timer = setInterval(() => this.tick(), 1000); this.timer.unref?.();
    this.saver = setInterval(() => this.save(), 5000); this.saver.unref?.();
  }
  get on() { return this.probe.on; }
  save() {
    if (!this.dirty) return; this.dirty = false;
    try { fs.writeFileSync(this.file + '.tmp', this.probe.box.sealFile(Buffer.from(JSON.stringify(this.out)))); fs.renameSync(this.file + '.tmp', this.file); } catch { /* best effort */ }
  }
  saveCfg() { try { fs.writeFileSync(this.cfgFile + '.tmp', this.probe.box.sealFile(Buffer.from(JSON.stringify(this.cfg)))); fs.renameSync(this.cfgFile + '.tmp', this.cfgFile); } catch { /* best effort */ } }
  status() { return { ...this.s, queued: this.out.length }; }

  tick() {
    if (!this.on) return; const now = Date.now();
    if (!this.syncing && now >= this.nextSync) this.sync().catch(() => {});
    if (!this.sending && now >= this.nextSend && (this.out.length || this.taskOut.length)) this.flush().catch(() => {});
    if (this.cfg.enabled === false) return;
    const cap = Math.max(1, Math.min(50, +this.cfg.workers || 5)); this.collector.client.gapMs = Math.max(0, Math.min(2000, this.cfg.gapMs ?? 30));
    for (const d of this.cfg.devices) {
      if (this.running >= cap) break; if (this.busy.has(d.id)) continue;
      const at = this.next.get(d.id);
      if (!at) { this.next.set(d.id, now + Math.floor(Math.random() * Math.min(10000, (d.intervalSec || 60) * 1000))); continue; }
      if (now < at) continue;
      const step = (d.intervalSec || 60) * 1000, f = this.fails.get(d.id) || 0, back = f >= 3 ? Math.min(step * 2 ** Math.min(f - 2, 5), Math.max(step, 600000)) : step;   // an unanswering device is asked less often (up to 10 min)
      this.next.set(d.id, now + back); this.busy.add(d.id); this.running++;
      this.collector.collect(d, this.cfg.profiles).then((res) => {
        this.s.polls++; this.fails.set(d.id, res && res.ok ? 0 : (this.fails.get(d.id) || 0) + 1); this.out.push({ dev: d.id, res }); if (this.out.length > MAX_RESULTS) this.out.splice(0, this.out.length - MAX_RESULTS); this.dirty = true;
      }).catch(() => {}).finally(() => { this.busy.delete(d.id); this.running--; });
    }
  }

  /** ask the main server for the device list and for jobs (test connection, discovery) */
  async sync() {
    const c = this.probe.cfg(); if (!c.server || !c.token) return;
    this.syncing = true;
    try {
      const j = await this.probe.post(c, { probe: c.name || '' }, '/api/probe/pollcfg');
      if (j && Array.isArray(j.devices)) {
        const before = JSON.stringify(this.cfg); this.cfg = { devices: j.devices, profiles: Array.isArray(j.profiles) ? j.profiles : [], workers: j.workers || 5, gapMs: j.gapMs ?? 30, enabled: j.enabled !== false };
        const ids = new Set(j.devices.map((d) => d.id)); for (const id of [...this.next.keys()]) if (!ids.has(id)) { this.next.delete(id); this.collector.forget(id); }
        if (JSON.stringify(this.cfg) !== before) this.saveCfg();
        this.s.devices = j.devices.length; this.s.lastSync = Date.now(); this.s.lastError = '';
        for (const t of Array.isArray(j.tasks) ? j.tasks : []) this.job(t);
      }
      this.nextSync = Date.now() + SYNC_MS;
    } catch (e) { this.s.lastError = e.message; this.nextSync = Date.now() + SYNC_MS * 2; }
    finally { this.syncing = false; }
  }
  /** a job from the main server: run it here (the device may only be reachable from this network) and send the answer with the next results */
  job(t) {
    this.s.jobs++;
    const done = (result) => { this.taskOut.push({ id: t.id, result }); this.nextSend = 0; };
    if (t.type === 'test' && t.spec && t.spec.device) this.collector.test(t.spec.device, (id) => ((this.cfg.profiles || []).find((p) => p.id === id) || {}).name || id).then(done, (e) => done({ ok: false, error: e.message }));
    else if (t.type === 'discover' && t.spec) {
      const job = { cancelled: false, done: 0, found: [] };
      this.collector.discover(t.spec.hosts || [], { port: t.spec.port || 161, version: t.spec.version, creds: t.spec.creds || [], known: new Set(t.spec.known || []) }, job).then(() => done({ ok: true, found: job.found }), (e) => done({ ok: false, error: e.message }));
    } else done({ ok: false, error: 'This probe does not know that job.' });
  }
  async flush() {
    const c = this.probe.cfg(); if (!c.server || !c.token) return;
    this.sending = true; const results = this.out.slice(0, BATCH), tasks = this.taskOut.slice();
    try {
      await this.probe.post(c, { probe: c.name || '', results, tasks }, '/api/probe/pollresults');
      this.out.splice(0, results.length); for (const t of tasks) { const i = this.taskOut.indexOf(t); if (i >= 0) this.taskOut.splice(i, 1); }
      this.dirty = true; this.s.sent += results.length; this.backoff = 0; this.nextSend = this.out.length ? 0 : Date.now() + 1000;
    } catch (e) { this.s.lastError = e.message; this.backoff = Math.min(30000, (this.backoff || 1000) * 2); this.nextSend = Date.now() + this.backoff; }
    finally { this.sending = false; }
  }
  shutdown() { clearInterval(this.timer); clearInterval(this.saver); this.dirty = true; this.save(); }
}

module.exports = { ProbePoller };
