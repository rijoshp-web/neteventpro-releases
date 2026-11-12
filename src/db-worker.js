'use strict';
// Runs in a worker thread. Opens the database read-only and answers searches and statistics, so a slow query
// can never stall the receiver (which writes on the main thread). Read-only: it cannot change any data.
const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const SEVX = require('./sev');
const { COLS, buildWhere, rowOut } = require('./query');
const dashq = require('./dashq');

const db = new DatabaseSync(workerData.file, { readOnly: true });
db.exec('PRAGMA busy_timeout = 5000');

const ops = {
  /**
   * Newest first, in id windows that start small and grow (20 000, 80 000, 320 000 … ids). A filter that matches often (an
   * error level, one device, a common word) finds its rows in the first window, so "All time" answers at once however
   * many years are stored. A filter that matches little still reads every window, exactly as before, and the main
   * thread is never involved (see Reader's time limit).
   */
  query({ q, limit }) {
    const n = Math.min(Math.max(+limit || 500, 1), 5000);
    const qq = { ...q }; if (!(Number(qq.from) > 0)) delete qq.from;          // "from 0" (all time) adds nothing but work
    const b = db.prepare('SELECT (SELECT MIN(id) FROM logs) AS lo, (SELECT MAX(id) FROM logs) AS hi').get(); if (b.hi === null) return [];
    const { sql, args } = buildWhere(qq); const range = sql ? sql + ' AND id >= ? AND id < ?' : 'WHERE id >= ? AND id < ?';
    const st = db.prepare(`SELECT ${COLS} FROM logs ${range} ORDER BY id DESC LIMIT ?`);
    let hi = Math.min(b.hi + 1, Number.isFinite(+qq.beforeId) && qq.beforeId !== '' && qq.beforeId !== null ? +qq.beforeId : Infinity), span = 20000; const out = [];
    while (hi > b.lo && out.length < n) {
      const lo = Math.max(b.lo, hi - span);
      for (const r of st.all(...args, lo, hi, n - out.length)) out.push(rowOut(r));
      hi = lo; span = Math.min(span * 4, 8000000);
    }
    return out;
  },
  count({ q }) {
    const { sql, args } = buildWhere(q);
    // counting stops at 100 001 rows so "Everything stored" stays fast with tens of millions of messages (the screen then shows 100,000+)
    return db.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM logs ${sql} LIMIT 100001)`).get(...args).n;
  },
  // one page of an export, newest first, continuing after lastId
  page({ q, lastId, n }) {
    const { sql, args } = buildWhere({ ...q, beforeId: lastId ?? q.beforeId });
    return db.prepare(`SELECT ${COLS}, raw FROM logs ${sql} ORDER BY id DESC LIMIT ?`).all(...args, Math.min(Math.max(+n || 2000, 1), 5000)).map(rowOut);
  },
  stats({ since }) {
    return {
      minuteSeries: db.prepare('SELECT (ts/60000) AS minute, severity, COUNT(*) AS n FROM logs WHERE ts >= ? GROUP BY minute, severity ORDER BY minute').all(since),
      topHosts: db.prepare('SELECT host, COUNT(*) AS n, MIN(' + SEVX.RANK_SQL + ') AS worst FROM logs WHERE ts >= ? GROUP BY host ORDER BY n DESC LIMIT 10').all(since).map((r) => ({ ...r, worst: SEVX.ORDER[r.worst] })),
      topApps: db.prepare("SELECT app, COUNT(*) AS n FROM logs WHERE ts >= ? AND app <> '' GROUP BY app ORDER BY n DESC LIMIT 10").all(since)
    };
  },
  dash(args) { return dashq.run(db, args); },
  rows() { return db.prepare('SELECT COUNT(*) AS n FROM logs').get().n; },
  oldest() { return db.prepare('SELECT MIN(ts) AS t FROM logs').get().t; },
  // consistent snapshot of the whole database in one file (safe while the service is writing)
  backup({ dest }) {
    db.prepare('VACUUM INTO ?').run(dest);
    return true;
  }
};

parentPort.on('message', ({ id, op, args }) => {
  try { parentPort.postMessage({ id, ok: true, result: ops[op](args || {}) }); }
  catch (e) { parentPort.postMessage({ id, ok: false, error: e.message }); }
});
