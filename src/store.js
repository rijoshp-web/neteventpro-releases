'use strict';
const BUSY = require('./busy');
const { performance } = require('node:perf_hooks');
const { packRaw } = require('./query');
const SUM = require('./summary');
const path = require('node:path');
const fs = require('node:fs');
const { Worker } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');

// errors whose text is meant for the person using the dashboard (the server shows them instead of "Internal error")
class UserError extends Error { constructor(m, status = 503) { super(m); this.userFacing = true; this.status = status; } }

/**
 * One worker thread that answers read-only queries (see db-worker.js). Searching a large database takes seconds;
 * doing it here instead of on the main thread keeps the receiver, the live view and the dashboard responsive.
 */
class Reader {
  constructor(file, { maxPending = 8, timeoutMs = 120000 } = {}) {
    this.file = file; this.maxPending = maxPending; this.timeoutMs = timeoutMs;
    this.w = null; this.seq = 1; this.pending = new Map();
  }
  spawn() {
    const w = new Worker(path.join(__dirname, 'db-worker.js'), { workerData: { file: this.file } });
    const dead = (err) => {
      if (this.w === w) this.w = null;
      for (const p of this.pending.values()) { clearTimeout(p.t); p.reject(err); }
      this.pending.clear();
    };
    w.on('message', (m) => {
      const p = this.pending.get(m.id); if (!p) return;
      this.pending.delete(m.id); clearTimeout(p.t);
      if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error));
    });
    w.on('error', (e) => dead(e));
    w.on('exit', () => dead(new UserError('The database reader was restarted. Try again.')));
    w.unref();
    this.w = w;
  }
  call(op, args) {
    if (this.pending.size >= this.maxPending) return Promise.reject(new UserError('The database is busy with other searches. Try again in a moment.'));
    if (!this.w) this.spawn();
    return new Promise((resolve, reject) => {
      const id = this.seq++;
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new UserError('The search took too long and was stopped. Narrow the time range or the filters.'));
        try { this.w?.terminate(); } catch { /* already gone */ }
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, t });
      this.w.postMessage({ id, op, args });
    });
  }
  close() { try { this.w?.terminate(); } catch { /* ignore */ } }
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'syslog.db');
    const isNew = !fs.existsSync(this.file);
    this.db = new DatabaseSync(this.file);
    // a new database can hand freed space back to Windows without a long VACUUM (must be chosen before the first table exists)
    if (isNew) this.db.exec('PRAGMA auto_vacuum = INCREMENTAL');
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY,
        ts INTEGER NOT NULL,
        dev_ts INTEGER,
        src_ip TEXT, host TEXT,
        facility INTEGER, severity INTEGER,
        app TEXT, pid TEXT, msgid TEXT,
        message TEXT, tags TEXT, color TEXT, raw TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_logs_ts ON logs(ts);
      CREATE INDEX IF NOT EXISTS ix_logs_host_ts ON logs(host, ts);
      CREATE INDEX IF NOT EXISTS ix_logs_sev_ts ON logs(severity, ts);
      CREATE TABLE IF NOT EXISTS devices (
        src_ip TEXT PRIMARY KEY, host TEXT, first_seen INTEGER, last_seen INTEGER, count INTEGER
      );
    `);
    try { this.db.exec('ALTER TABLE devices ADD COLUMN ips TEXT'); } catch { /* already there */ }
    try { this.db.exec("ALTER TABLE devices ADD COLUMN vendor TEXT NOT NULL DEFAULT ''"); } catch { /* already there */ }
    // where a message came from: 'syslog' or 'snmp' (a trap). Added in 1.8.0; traps stored by 1.7.x (the last 3 days at most) are marked once.
    try { this.db.exec("ALTER TABLE logs ADD COLUMN source TEXT NOT NULL DEFAULT 'syslog'"); this.db.prepare("UPDATE logs SET source = 'snmp' WHERE ts >= ? AND app = 'snmptrap' AND (',' || tags || ',') LIKE '%,snmp,%'").run(Date.now() - 3 * 86400000); } catch { /* already there */ }
    try { this.db.exec("ALTER TABLE logs ADD COLUMN vb TEXT NOT NULL DEFAULT ''"); } catch { /* already there */ }
    try {   // own message numbers for syslog messages and for SNMP traps (1, 2, 3 ... in each kind)
      this.db.exec('ALTER TABLE logs ADD COLUMN seq INTEGER NOT NULL DEFAULT 0');
      this.db.exec('UPDATE logs SET seq = x.rn FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY source ORDER BY id) AS rn FROM logs) AS x WHERE logs.id = x.id');
    } catch { /* already there */ }
    this.db.exec("CREATE INDEX IF NOT EXISTS ix_logs_snmp ON logs(ts) WHERE source = 'snmp'");
    this.autoVacuum = this.db.prepare('PRAGMA auto_vacuum').get().auto_vacuum === 2;
    this.insertStmt = this.db.prepare(
      'INSERT OR REPLACE INTO logs (id, ts, dev_ts, src_ip, host, facility, severity, app, pid, msgid, message, tags, color, raw, source, vb, seq) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    this.initSummary();
    this.queue = [];
    this.timer = setInterval(() => require('./busy').run('saving messages to the database', () => this.flush()), 250);
    this.timer.unref?.();
    this.droppedOnOverflow = 0; this.peak = 0; this.peakAt = Date.now(); this.lastPeak = 0;   // 1.60: the longest the write queue was, in the last hour
    this.search = new Reader(this.file);                     // searches, exports, backups
    this.statsReader = new Reader(this.file, { maxPending: 4 }); // dashboard numbers (kept apart so a long search never freezes the dashboard)
  }

  /** delete messages by id, or everything matching a search (in small steps so the receiver keeps running). Returns how many were removed. */
  async deleteLogs({ ids, q }) {
    this.flush(); let n = 0;
    if (Array.isArray(ids)) {
      for (let i = 0; i < ids.length; i += 500) { const bt = performance.now(); n += this.deleteWhere('SELECT value FROM json_each(?)', [JSON.stringify(ids.slice(i, i + 500))]); BUSY.done('deleting messages', bt); this._rows = undefined; await new Promise((r) => setImmediate(r)); }
      return n;
    }
    const { buildWhere } = require('./query'); const { sql, args } = buildWhere(q || {});
    for (;;) { const bt = performance.now(); const c = this.deleteWhere(`SELECT id FROM logs ${sql} LIMIT 5000`, args); BUSY.done('deleting messages', bt); n += c; this._rows = undefined; if (c < 5000) break; await new Promise((r) => setImmediate(r)); }
    return n;
  }
  maxSeq() { const o = { syslog: 0, snmp: 0 }; for (const r of this.db.prepare('SELECT source, MAX(seq) AS m FROM logs GROUP BY source').all()) o[r.source === 'snmp' ? 'snmp' : 'syslog'] = r.m || 0; return o; }
  maxId() { return this.db.prepare('SELECT COALESCE(MAX(id),0) AS m FROM logs').get().m; }

  enqueue(m) {
    if (this.queue.length > 200000) { this.droppedOnOverflow++; return; } // safety valve
    this.queue.push(m); if (this.queue.length > this.peak) this.peak = this.queue.length;
  }

  /** the longest the write queue got during the last one to two hours (a writer that falls behind shows here long before messages are dropped) */
  peakQueue() { return Math.max(this.peak, this.lastPeak); }
  flush() {
    if (Date.now() - this.peakAt > 3600000) { this.lastPeak = this.peak; this.peak = 0; this.peakAt = Date.now(); }
    if (!this.queue.length) return;
    const batch = this.queue;
    this.queue = [];
    if (this._rows !== undefined) this._rows += batch.length;
    try {
      this.db.exec('BEGIN');
      for (const m of batch) {
        this.insertStmt.run(m.id, m.ts, m.devTs, m.srcIp, m.host, m.facility, m.severity,
          m.app, m.pid, m.msgid, m.message, m.tags ? m.tags.join(',') : '', m.color || '', packRaw(m.raw, m.message), m.source === 'snmp' ? 'snmp' : 'syslog', m.vb ? JSON.stringify(m.vb) : '', m.seq || 0);
      }
      if (this.ftsOn) for (const m of batch) this.ftsIns.run(m.id, m.message || '', m.host || '', m.app || '');
      this.db.exec('COMMIT');
      const live = this.sumLive ? batch.filter((m) => m.ts >= this.sumLive) : batch;
      if (live.length) SUM.tally(this.sumAcc, live);
      if (Date.now() - this.sumAt >= 2000) this.sumFlush();
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      console.error('[store] flush failed:', e.message);
    }
  }

  // ---- summaries (1.97.6, see summary.js) --------------------------------
  initSummary() {
    this.db.exec(SUM.SCHEMA);
    this.sumAcc = {}; this.sumAt = Date.now(); this.sumStmts = {}; this.sumLive = 0;
    const get = (k) => this.db.prepare('SELECT v FROM sum_meta WHERE k = ?').get(k)?.v;
    this.setMeta = (k, v) => this.db.prepare('INSERT INTO sum_meta (k, v) VALUES (?, ?) ON CONFLICT DO UPDATE SET v = excluded.v').run(k, v);
    let cov = get('cov');
    if (cov === undefined) {
      const any = this.db.prepare('SELECT ts FROM logs ORDER BY id LIMIT 1').get();
      // nothing stored yet: everything is covered from the start. Otherwise count from the next minute on and fill in the past in the background.
      cov = any ? Math.ceil((Date.now() + 1) / 60000) * 60000 : 0;
      this.setMeta('cov', cov); this.setMeta('upto', Date.now());
      if (any) this.sumLive = cov;
    }
    this.sumCov = cov;
    if (cov > 0) this.sumBackfillSoon(cov === this.sumLive ? cov - Date.now() + 5000 : 15000);
  }
  /** writes what was counted since the last time; "upto" tells the readers how far the summaries are complete */
  sumFlush() {
    this.sumAt = Date.now();
    if (this.sumAt - (this.sumPruneAt || 0) > 300000) {      // the 1-minute device and process counts are only kept for a few hours
      this.sumPruneAt = this.sumAt;
      try { for (const [t, , , keep] of SUM.TABLES) if (keep) this.db.prepare(`DELETE FROM ${t} WHERE t < ?`).run(this.sumAt - keep); } catch (e) { console.error('[store] summary:', e.message); }
    }
    const acc = this.sumAcc; this.sumAcc = {};
    try {
      this.db.exec('BEGIN'); SUM.apply(this.db, acc, this.sumStmts); this.setMeta('upto', this.sumAt - 1); this.db.exec('COMMIT');
    } catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* ignore */ } console.error('[store] summary:', e.message); }
  }
  sumBackfillSoon(ms) { clearTimeout(this.sumTimer); this.sumTimer = setTimeout(() => this.sumBackfill().catch((e) => console.error('[store] summary backfill:', e.message)), Math.max(1000, ms)); this.sumTimer.unref?.(); }
  /** counts older messages one minute at a time, newest first, with short pauses so the receiver never waits for it */
  async sumBackfill() {
    if (this.sumBusy) return; this.sumBusy = true;
    try {
      const first = this.db.prepare('SELECT MIN(ts) AS t FROM logs').get().t;
      const st = this.db.prepare('SELECT ts, host, app, severity, facility, source, n FROM (SELECT CAST(ts / 60000 AS INTEGER) * 60000 AS ts, host, app, severity, facility, source, COUNT(*) AS n FROM logs WHERE ts >= ? AND ts < ? GROUP BY 1, host, app, severity, facility, source)');
      let started = Date.now(), done = 0;
      while (!this.closed && first !== null && this.sumCov > Math.floor(first / 60000) * 60000) {
        const bt = performance.now(); this.flush();
        const to = this.sumCov, from = to - 60000;
        this.db.exec('BEGIN');
        try { SUM.apply(this.db, SUM.tally({}, st.all(from, to)), this.sumStmts); this.setMeta('cov', from); this.db.exec('COMMIT'); this.sumCov = from; } catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
        BUSY.done('filling the dashboard summaries', bt);
        if (++done % 60 === 0 && Date.now() - started > 60000) { console.log(`[store] summaries filled back to ${new Date(from).toISOString()}`); started = Date.now(); }
        await new Promise((r) => (done % 25 ? setImmediate(r) : setTimeout(r, 5)));
      }
      if (first === null || this.sumCov <= first) { this.sumCov = 0; this.setMeta('cov', 0); }
    } finally { this.sumBusy = false; }
  }
  /** takes messages that are about to be deleted off the summaries (call inside the delete's transaction, before the DELETE) */
  sumForget(rows) {
    const keep = rows.filter((r) => r.ts >= this.sumCov);
    if (keep.length) SUM.apply(this.db, SUM.tally({}, keep, -1), this.sumStmts);
  }
  // ---- word index (1.98.1): a trigram index over message, device and process, so a search for a rare word does not read every message ----
  // Contentless (it stores no copy of the text, only the index). Holds every message with id >= fts_from; older ones are added in the background.
  setSearchIndex(on) {
    on = !!on; if (on === !!this.ftsOn && this.ftsReady !== undefined) return;
    try {
      if (on) {
        const had = !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'logs_fts'").get();
        this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS logs_fts USING fts5(message, host, app, content='', contentless_delete=1, tokenize='trigram')");
        this.ftsIns = this.db.prepare('INSERT OR REPLACE INTO logs_fts (rowid, message, host, app) VALUES (?, ?, ?, ?)');
        this.flush();
        if (!had || this.db.prepare("SELECT v FROM sum_meta WHERE k = 'fts_from'").get() === undefined) this.setMeta('fts_from', this.maxId() + 1);
        this.ftsOn = true; this.ftsReady = true; this.ftsBackfillSoon();
      } else {
        this.ftsOn = false; this.ftsReady = false; clearTimeout(this.ftsTimer);
        this.db.exec("DROP TABLE IF EXISTS logs_fts; DELETE FROM sum_meta WHERE k = 'fts_from'");
      }
    } catch (e) { this.ftsOn = false; console.error('[store] word index:', e.message); }
  }
  ftsStatus() {
    if (!this.ftsOn) return { on: false };
    const from = this.db.prepare("SELECT v FROM sum_meta WHERE k = 'fts_from'").get()?.v ?? 0, lo = this.db.prepare('SELECT MIN(id) AS m FROM logs').get().m;
    const done = lo === null || from <= lo, oldest = done ? null : this.db.prepare('SELECT ts FROM logs WHERE id >= ? ORDER BY id LIMIT 1').get(from)?.ts;
    return { on: true, complete: done, coveredFrom: done ? null : oldest || null };
  }
  ftsBackfillSoon(ms = 3000) { clearTimeout(this.ftsTimer); this.ftsTimer = setTimeout(() => this.ftsBackfill().catch((e) => console.error('[store] word index fill:', e.message)), ms); this.ftsTimer.unref?.(); }
  /** adds older messages to the index, newest first, 5 000 at a time with pauses, so receiving never waits */
  async ftsBackfill() {
    if (this.ftsBusy || !this.ftsOn) return; this.ftsBusy = true;
    try {
      const sel = this.db.prepare('SELECT id, message, host, app FROM logs WHERE id < ? ORDER BY id DESC LIMIT 5000');
      for (;;) {
        if (this.closed || !this.ftsOn) break;
        const from = this.db.prepare("SELECT v FROM sum_meta WHERE k = 'fts_from'").get()?.v ?? 0, rows = sel.all(from);
        if (!rows.length) { this.setMeta('fts_from', 0); break; }
        this.db.exec('BEGIN');
        const bt = performance.now(); try { for (const r of rows) this.ftsIns.run(r.id, r.message || '', r.host || '', r.app || ''); this.setMeta('fts_from', rows[rows.length - 1].id); this.db.exec('COMMIT'); } catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* */ } throw e; }
        BUSY.done('filling the word index', bt);
        await new Promise((r) => setTimeout(r, 10));
      }
    } finally { this.ftsBusy = false; }
  }

  /** deletes messages by an id-selecting SQL, keeping the summaries right; returns how many went */
  deleteWhere(idSql, args) {
    this.sumFlush();
    const rows = this.db.prepare(`SELECT id, ts, host, app, severity, facility, source FROM logs WHERE id IN (${idSql})`).all(...args);
    if (!rows.length) return 0;
    this.db.exec('BEGIN');
    try {
      this.sumForget(rows);
      const n = Number(this.db.prepare('DELETE FROM logs WHERE id IN (SELECT value FROM json_each(?))').run(JSON.stringify(rows.map((r) => r.id))).changes);
      if (this.ftsOn) this.db.prepare('DELETE FROM logs_fts WHERE rowid IN (SELECT value FROM json_each(?))').run(JSON.stringify(rows.map((r) => r.id)));
      this.db.exec('COMMIT'); return n;
    } catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
  }

  // ---- reading (worker threads) ---------------------------------------------
  query(q, limit = 500) { this.flush(); return this.search.call('query', { q, limit }); }
  count(q) { this.flush(); return this.search.call('count', { q }); }
  stats(since) { this.flush(); this.sumFlush(); return this.statsReader.call('stats', { since }); }
  dash(args) { this.flush(); this.sumFlush(); return this.statsReader.call('dash', args); }
  oldest() { return this.statsReader.call('oldest', {}); }
  async backup(dest) { this.flush(); await this.search.call('backup', { dest }); }

  /** async iterator over everything that matches, newest first, in pages (used by the export) */
  async *iterate(q, max = 1000000) {
    this.flush();
    let lastId = null, n = 0;
    while (n < max) {
      const chunk = await this.search.call('page', { q, lastId, n: Math.min(2000, max - n) });
      if (!chunk.length) break;
      for (const r of chunk) { yield r; n++; }
      lastId = chunk[chunk.length - 1].id;
    }
  }

  // ---- devices ----------------------------------------------------------
  loadDevices() { return this.db.prepare('SELECT src_ip AS key, host, first_seen AS firstSeen, last_seen AS lastSeen, count, ips, vendor FROM devices').all(); }
  saveDevices(list) {
    if (!list.length) return;
    try {
      this.db.exec('BEGIN');
      const st = this.db.prepare('INSERT OR REPLACE INTO devices (src_ip, host, first_seen, last_seen, count, ips, vendor) VALUES (?,?,?,?,?,?,?)');
      for (const d of list) st.run(d.key, d.host, d.firstSeen, d.lastSeen, d.count, d.srcIps.join(','), d.vendor || '');
      this.db.exec('COMMIT');
    } catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* ignore */ } console.error('[store] saveDevices', e.message); }
  }
  deleteDevice(srcIp) { this.deleteDevices([srcIp]); }
  deleteDevices(keys) {
    if (!keys.length) return; const st = this.db.prepare('DELETE FROM devices WHERE src_ip = ?');
    this.db.exec('BEGIN'); try { for (const k of keys) st.run(String(k)); this.db.exec('COMMIT'); } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  // ---- maintenance ------------------------------------------------------
  /** size of the files on disk (database + write-ahead log) */
  sizeMB() {
    let total = 0;
    for (const suffix of ['', '-wal']) { try { total += fs.statSync(this.file + suffix).size; } catch { /* none */ } }
    return total / 1048576;
  }
  /** space actually holding data: deleted rows leave free pages behind, which the file keeps and new messages reuse */
  usedMB() {
    const n = (p) => Object.values(this.db.prepare(`PRAGMA ${p}`).get())[0];
    return (n('page_count') - n('freelist_count')) * n('page_size') / 1048576;
  }
  /**
   * Number of stored messages, without counting them on the receiving thread: counting 100 million rows takes seconds and
   * would make the receiver miss packets. The figure is taken from the id range at first, counted exactly in the reader
   * thread a moment later, then kept up to date by the writer and recounted every 10 minutes.
   */
  totalRows() {
    if (this._rows === undefined) { const r = this.db.prepare('SELECT (SELECT MIN(id) FROM logs) AS a, (SELECT MAX(id) FROM logs) AS b').get(); this._rows = r.b === null ? 0 : r.b - r.a + 1; this._rowsAt = 0; }
    if (Date.now() - this._rowsAt > 600000 && !this._counting) {
      this._counting = true; this._rowsAt = Date.now();
      this.statsReader.call('rows').then((n) => { this._rows = n; }).catch(() => {}).finally(() => { this._counting = false; });
    }
    return Math.max(0, this._rows);
  }

  /**
   * Removes messages older than retentionDays, then the oldest ones until the data fits in maxDbMB.
   * Works in small slices and yields between them, so the receiver keeps running while it cleans up.
   */
  async prune(retentionDays, maxDbMB) {
    this.flush();
    const CHUNK = 10000; const tick = () => new Promise((r) => setImmediate(r));
    let deleted = 0;
    if (retentionDays > 0) {
      const cutoff = Date.now() - retentionDays * 86400000;
      for (;;) {
        const n = this.deleteWhere('SELECT id FROM logs WHERE ts < ? ORDER BY id LIMIT ?', [cutoff, CHUNK]); deleted += n; if (this._rows !== undefined) this._rows -= n;
        if (n < CHUNK) break;
        await tick(); this.flush();
      }
    }
    if (maxDbMB > 0) {
      // Measured on the space used by data (not the file size, which does not shrink when rows are deleted).
      // Aim for 90% of the limit so the next cleanup is not needed straight away.
      for (let round = 0; round < 4 && this.usedMB() > maxDbMB; round++) {
        const rows = this.totalRows(), used = this.usedMB();
        if (!rows) break;
        let left = Math.min(rows, Math.ceil(rows * (used - maxDbMB * 0.9) / used));
        while (left > 0) {
          const n = this.deleteWhere('SELECT id FROM logs ORDER BY id LIMIT ?', [Math.min(CHUNK, left)]);
          if (!n) break;
          left -= n; deleted += n; if (this._rows !== undefined) this._rows -= n;
          await tick(); this.flush();
        }
      }
    }
    if (deleted > 0) {
      try {
        this.db.exec('PRAGMA wal_checkpoint(PASSIVE)');
        if (this.autoVacuum) for (let i = 0; i < 100; i++) {   // hand free space back to the disk, a slice at a time
          this.db.exec('PRAGMA incremental_vacuum(5000)');
          if (Object.values(this.db.prepare('PRAGMA freelist_count').get())[0] === 0) break;
          await tick();
        }
      } catch (e) { console.error('[store] cleanup:', e.message); }
    }
    return deleted;
  }

  clearAll() {
    this.flush();
    this.sumAcc = {}; this.sumLive = 0; this.sumCov = 0;
    this.db.exec(`DELETE FROM logs; ${SUM.TABLES.map(([t]) => `DELETE FROM ${t};`).join(' ')}`); this.setMeta('cov', 0); this.setMeta('upto', Date.now());
    if (this.ftsOn) { this.db.exec('DELETE FROM logs_fts'); this.setMeta('fts_from', 0); }
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;'); this._rows = 0;
  }

  close() {
    clearInterval(this.timer); clearTimeout(this.sumTimer); this.closed = true;
    this.flush(); this.sumFlush();
    this.search.close(); this.statsReader.close();
    try { this.db.close(); } catch { /* ignore */ }
  }
}

module.exports = { Store, UserError };
