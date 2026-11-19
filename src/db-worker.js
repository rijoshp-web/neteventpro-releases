'use strict';
// Runs in a worker thread. Opens the database read-only and answers searches and statistics, so a slow query
// can never stall the receiver (which writes on the main thread). Read-only: it cannot change any data.
const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const SEVX = require('./sev');
const { COLS, buildWhere, rowOut, indexTerms, ftsQuery } = require('./query');
/** 1.98.1 lowest message id the word index holds, or null when there is no index */
const ftsFrom = () => { try { const v = db.prepare("SELECT v FROM sum_meta WHERE k = 'fts_from'").get()?.v; if (v === undefined) return null; db.prepare('SELECT rowid FROM logs_fts LIMIT 0').all(); return v; } catch { return null; } };
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
    // 1.98.1 a search for words: the word index lists the candidate messages, newest first; every candidate is still checked against the full filter
    const terms = indexTerms(qq.text), ff = terms.length ? ftsFrom() : null;
    if (ff !== null) {
      let lo = Math.max(ff, b.lo);
      if (Number(qq.from) > 0) { const r = db.prepare('SELECT id FROM logs WHERE ts >= ? ORDER BY ts LIMIT 1').get(+qq.from - 3600000); lo = Math.max(lo, r ? r.id : hi); }
      const page = db.prepare('SELECT rowid AS id FROM logs_fts WHERE logs_fts MATCH ? AND rowid < ? AND rowid >= ? ORDER BY rowid DESC LIMIT 2000');
      const byIds = db.prepare(`SELECT ${COLS} FROM logs ${sql ? sql + ' AND' : 'WHERE'} id IN (SELECT value FROM json_each(?)) ORDER BY id DESC`), mq = ftsQuery(terms);
      while (out.length < n && hi > lo) {
        const ids = page.all(mq, hi, lo).map((r) => r.id); if (!ids.length) { hi = lo; break; }
        for (const r of byIds.all(...args, JSON.stringify(ids))) { out.push(rowOut(r)); if (out.length >= n) break; }
        hi = ids[ids.length - 1]; if (ids.length < 2000) { hi = lo; break; }
      }
      if (out.length >= n || hi <= b.lo || lo > Math.max(ff, b.lo)) return out.slice(0, n);   // done, or the time range starts inside the indexed part
      hi = Math.min(hi, ff);                                                                       // older messages the index does not hold yet: read them as before
    }
    while (hi > b.lo && out.length < n) {
      const lo = Math.max(b.lo, hi - span);
      for (const r of st.all(...args, lo, hi, n - out.length)) out.push(rowOut(r));
      hi = lo; span = Math.min(span * 4, 8000000);
    }
    return out;
  },
  count({ q }) {
    const { sql, args } = buildWhere(q);
    const terms = indexTerms(q && q.text), ff = terms.length ? ftsFrom() : null;
    // 1.98.1 counted from the word index's candidates (and the not yet indexed older part as before) — unless the words are
    // common: then reading messages reaches the 100 001 cap sooner than listing millions of candidates
    if (ff !== null && db.prepare('SELECT COUNT(*) AS n FROM (SELECT rowid FROM logs_fts WHERE logs_fts MATCH ? LIMIT 200001)').get(ftsQuery(terms)).n <= 200000) {
      const a = db.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM logs ${sql ? sql + ' AND' : 'WHERE'} id IN (SELECT rowid FROM logs_fts WHERE logs_fts MATCH ? AND rowid >= ?) LIMIT 100001)`).get(...args, ftsQuery(terms), ff).n;
      if (a > 100000 || !ff) return a;
      return Math.min(100001, a + db.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM logs ${sql ? sql + ' AND' : 'WHERE'} id < ? LIMIT ${100001 - a})`).get(...args, ff).n);
    }
    // counting stops at 100 001 rows so "Everything stored" stays fast with tens of millions of messages (the screen then shows 100,000+)
    return db.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM logs ${sql} LIMIT 100001)`).get(...args).n;
  },
  // one page of an export, newest first, continuing after lastId
  page({ q, lastId, n }) {
    const { sql, args } = buildWhere({ ...q, beforeId: lastId ?? q.beforeId });
    return db.prepare(`SELECT ${COLS}, raw FROM logs ${sql} ORDER BY id DESC LIMIT ?`).all(...args, Math.min(Math.max(+n || 2000, 1), 5000)).map(rowOut);
  },
  // 1.97.6: from the summary tables where they cover the period (24 h on 10 million messages went from 25 s to well under a second)
  stats({ since }) {
    const now = Date.now(), m = require('./summary').meta(db), nb = Math.floor(now / 60000) - Math.floor(since / 60000) + 1, b0 = Math.floor(since / 60000);
    const series = dashq.seriesRange(db, {}, since, now + 1, 60000, b0, nb, m), minuteSeries = [];
    series.forEach((sv, i) => sv.forEach((n, sev) => { if (n) minuteSeries.push({ minute: b0 + i, severity: sev, n }); }));
    const top = (col, ne) => dashq.topOf(dashq.groupRange(db, {}, col, since, now + 1, m, ne), 10);
    return {
      minuteSeries,
      topHosts: top('host').map((r) => ({ host: r.key, n: r.n, worst: SEVX.ORDER[r.worst] })),
      topApps: top('app', true).map((r) => ({ app: r.key, n: r.n }))
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
