'use strict';
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
    this.queue = [];
    this.timer = setInterval(() => this.flush(), 250);
    this.timer.unref?.();
    this.droppedOnOverflow = 0;
    this.search = new Reader(this.file);                     // searches, exports, backups
    this.statsReader = new Reader(this.file, { maxPending: 4 }); // dashboard numbers (kept apart so a long search never freezes the dashboard)
  }

  /** delete messages by id, or everything matching a search (in small steps so the receiver keeps running). Returns how many were removed. */
  async deleteLogs({ ids, q }) {
    this.flush(); let n = 0;
    if (Array.isArray(ids)) {
      const st = this.db.prepare('DELETE FROM logs WHERE id = ?');
      for (let i = 0; i < ids.length; i += 500) { this.db.exec('BEGIN'); try { for (const id of ids.slice(i, i + 500)) n += Number(st.run(id).changes); this.db.exec('COMMIT'); this._rows = undefined; } catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* */ } throw e; } await new Promise((r) => setImmediate(r)); }
      return n;
    }
    const { buildWhere } = require('./query'); const { sql, args } = buildWhere(q || {});
    for (;;) { const c = Number(this.db.prepare(`DELETE FROM logs WHERE id IN (SELECT id FROM logs ${sql} LIMIT 5000)`).run(...args).changes); n += c; this._rows = undefined; if (c < 5000) break; await new Promise((r) => setImmediate(r)); }
    return n;
  }
  maxSeq() { const o = { syslog: 0, snmp: 0 }; for (const r of this.db.prepare('SELECT source, MAX(seq) AS m FROM logs GROUP BY source').all()) o[r.source === 'snmp' ? 'snmp' : 'syslog'] = r.m || 0; return o; }
  maxId() { return this.db.prepare('SELECT COALESCE(MAX(id),0) AS m FROM logs').get().m; }

  enqueue(m) {
    if (this.queue.length > 200000) { this.droppedOnOverflow++; return; } // safety valve
    this.queue.push(m);
  }

  flush() {
    if (!this.queue.length) return;
    const batch = this.queue;
    this.queue = [];
    if (this._rows !== undefined) this._rows += batch.length;
    try {
      this.db.exec('BEGIN');
      for (const m of batch) {
        this.insertStmt.run(m.id, m.ts, m.devTs, m.srcIp, m.host, m.facility, m.severity,
          m.app, m.pid, m.msgid, m.message, m.tags ? m.tags.join(',') : '', m.color || '', m.raw, m.source === 'snmp' ? 'snmp' : 'syslog', m.vb ? JSON.stringify(m.vb) : '', m.seq || 0);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      console.error('[store] flush failed:', e.message);
    }
  }

  // ---- reading (worker threads) ---------------------------------------------
  query(q, limit = 500) { this.flush(); return this.search.call('query', { q, limit }); }
  count(q) { this.flush(); return this.search.call('count', { q }); }
  stats(since) { this.flush(); return this.statsReader.call('stats', { since }); }
  dash(args) { this.flush(); return this.statsReader.call('dash', args); }
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
  deleteDevice(srcIp) { this.db.prepare('DELETE FROM devices WHERE src_ip = ?').run(srcIp); }

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
      const st = this.db.prepare('DELETE FROM logs WHERE id IN (SELECT id FROM logs WHERE ts < ? ORDER BY id LIMIT ?)');
      for (;;) {
        const n = Number(st.run(cutoff, CHUNK).changes); deleted += n; if (this._rows !== undefined) this._rows -= n;
        if (n < CHUNK) break;
        await tick(); this.flush();
      }
    }
    if (maxDbMB > 0) {
      const del = this.db.prepare('DELETE FROM logs WHERE id IN (SELECT id FROM logs ORDER BY id LIMIT ?)');
      // Measured on the space used by data (not the file size, which does not shrink when rows are deleted).
      // Aim for 90% of the limit so the next cleanup is not needed straight away.
      for (let round = 0; round < 4 && this.usedMB() > maxDbMB; round++) {
        const rows = this.totalRows(), used = this.usedMB();
        if (!rows) break;
        let left = Math.min(rows, Math.ceil(rows * (used - maxDbMB * 0.9) / used));
        while (left > 0) {
          const n = Number(del.run(Math.min(CHUNK, left)).changes);
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
    this.db.exec('DELETE FROM logs; PRAGMA wal_checkpoint(TRUNCATE); VACUUM;'); this._rows = 0;
  }

  close() {
    clearInterval(this.timer);
    this.flush();
    this.search.close(); this.statsReader.close();
    try { this.db.close(); } catch { /* ignore */ }
  }
}

module.exports = { Store, UserError };
