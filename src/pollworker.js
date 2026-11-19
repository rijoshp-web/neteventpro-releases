'use strict';
// 1.99.1 SNMP polling on its own thread. The scheduled polls (asking the devices, waiting for answers, timeouts and retries,
// reading the answers) run here, so a busy receiver no longer delays them: before, a device's answer could sit unread while
// the main thread saved thousands of syslog messages, and the poll timed out and was retried although the device had
// answered in time. The main thread still decides which device is due and stores what comes back.
//
// In the main thread: new PollWorker() → collect(device, profiles, gapMs) → the same result as Collector.collect.
// If the thread cannot start or stops, polls run in the main thread as before (fallback), and it is started again later.
const { Worker, isMainThread, parentPort } = require('node:worker_threads');

if (!isMainThread && parentPort) {
  const { Collector } = require('./pollcore');
  const { SnmpClient } = require('./snmpclient');
  const col = new Collector(new SnmpClient());
  parentPort.on('message', async (m) => {
    if (m.type === 'reset') { col.client.sessions.clear(); return; }
    if (m.type === 'forget') { col.forget?.(m.id); return; }
    if (m.type !== 'collect') return;
    if (m.gapMs !== undefined) col.client.gapMs = m.gapMs;
    try { parentPort.postMessage({ id: m.id, res: await col.collect(m.dev, m.profiles) }); }
    catch (e) { parentPort.postMessage({ id: m.id, error: { message: e.message, code: e.code || 'error' } }); }
  });
} else {
  class PollWorker {
    constructor(fallback) { this.fallback = fallback; this.w = null; this.seq = 0; this.wait = new Map(); this.failedAt = 0; this.restarts = 0; this.lastError = ''; }
    start() {
      if (this.w || (this.failedAt && Date.now() - this.failedAt < 60000)) return this.w;
      try {
        const w = new Worker(__filename);
        w.on('message', (m) => { const p = this.wait.get(m.id); if (!p) return; this.wait.delete(m.id); if (!this.wait.size) w.unref(); if (m.error) p.no(Object.assign(new Error(m.error.message), { code: m.error.code })); else p.ok(m.res); });
        const down = (why) => { if (this.w !== w) return; this.w = null; this.failedAt = Date.now(); this.restarts++; this.lastError = why; for (const p of this.wait.values()) p.retry(); this.wait.clear(); console.error('[polling] the polling thread stopped:', why); };
        w.on('error', (e) => down(e.message)); w.on('exit', (code) => down(`exit code ${code}`));
        w.unref();   // idle: does not hold the process open (after the listeners, which would ref it again); held while a poll waits
        this.w = w;
      } catch (e) { this.failedAt = Date.now(); this.lastError = e.message; this.w = null; }
      return this.w;
    }
    /** one scheduled poll; runs in the main thread when the polling thread is not available */
    collect(dev, profiles, gapMs) {
      const w = this.start(); if (!w) return this.fallback(dev, profiles);
      const id = ++this.seq;
      return new Promise((ok, no) => {
        if (!this.wait.size) w.ref(); this.wait.set(id, { ok, no, retry: () => this.fallback(dev, profiles).then(ok, no) });
        try { w.postMessage({ type: 'collect', id, dev, profiles, gapMs }); } catch (e) { this.wait.delete(id); this.fallback(dev, profiles).then(ok, no); }
      });
    }
    reset() { try { this.w?.postMessage({ type: 'reset' }); } catch { /* not running */ } }
    forget(id) { try { this.w?.postMessage({ type: 'forget', id }); } catch { /* not running */ } }
    status() { return { thread: !!this.w, restarts: this.restarts, lastError: this.lastError, waiting: this.wait.size }; }
    stop() { const w = this.w; this.w = null; if (w) w.terminate().catch(() => {}); }
  }
  module.exports = { PollWorker };
}
