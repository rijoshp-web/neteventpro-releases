'use strict';
// 1.97.6: per-minute and per-hour message counts, so dashboards and statistics over long periods add up a few thousand
// summary rows instead of reading every stored message (a 24 h dashboard on 10 million messages took 14 s).
//
// The summary tables hold exactly the messages with ts >= "cov" (kept in sum_meta), counted by when they arrived:
//   sum_sev    1 minute   source, severity, facility    (totals, severity charts, day-and-hour heat maps)
//   sum_host5  5 minutes  source, host, severity        (busiest devices, device counts)
//   sum_host60 1 hour     the same
//   sum_app5   5 minutes  source, app, severity         (busiest processes)
//   sum_app60  1 hour     the same
//   sum_host1, sum_app1   1 minute, kept for the last 3 hours only (so the edges of a short period stay small at high rates)
// The writer adds every stored message to them (store.js), takes deleted messages off again, and fills in older data in the
// background after an upgrade. A query uses a summary block only when the whole block lies inside the asked period, at or
// after "cov" and before "upto" (the moment the summaries were last written); the edges are counted from the messages
// themselves, so every answer is the same as before, just faster.
const { buildWhere } = require('./query');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sum_meta (k TEXT PRIMARY KEY, v INTEGER);       -- also holds fts_from (1.98.1 word index)
  CREATE TABLE IF NOT EXISTS sum_sev (t INTEGER NOT NULL, source TEXT NOT NULL, severity INTEGER NOT NULL, facility INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (t, source, severity, facility)) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS sum_host5 (t INTEGER NOT NULL, source TEXT NOT NULL, host TEXT NOT NULL, severity INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (t, source, host, severity)) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS sum_host60 (t INTEGER NOT NULL, source TEXT NOT NULL, host TEXT NOT NULL, severity INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (t, source, host, severity)) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS sum_app5 (t INTEGER NOT NULL, source TEXT NOT NULL, app TEXT NOT NULL, severity INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (t, source, app, severity)) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS sum_host1 (t INTEGER NOT NULL, source TEXT NOT NULL, host TEXT NOT NULL, severity INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (t, source, host, severity)) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS sum_app1 (t INTEGER NOT NULL, source TEXT NOT NULL, app TEXT NOT NULL, severity INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (t, source, app, severity)) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS sum_app60 (t INTEGER NOT NULL, source TEXT NOT NULL, app TEXT NOT NULL, severity INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (t, source, app, severity)) WITHOUT ROWID;`;

const KEEP1 = 3 * 3600e3;    // how long the 1-minute device and process counts are kept
/** the tables of each kind, biggest blocks first; a third value means "only the most recent this long" */
const LEVELS = {
  sev: [[60e3, 'sum_sev']],
  host: [[3600e3, 'sum_host60'], [300e3, 'sum_host5'], [60e3, 'sum_host1', KEEP1]],
  app: [[3600e3, 'sum_app60'], [300e3, 'sum_app5'], [60e3, 'sum_app1', KEEP1]]
};
const TABLES = [['sum_sev', 60e3, 'sev'], ['sum_host5', 300e3, 'host'], ['sum_host60', 3600e3, 'host'], ['sum_app5', 300e3, 'app'], ['sum_app60', 3600e3, 'app'], ['sum_host1', 60e3, 'host', KEEP1], ['sum_app1', 60e3, 'app', KEEP1]];
/** filters each kind can answer (anything else, such as a text search or one device, reads the messages) */
const ALLOWED = { sev: ['source', 'severityMax', 'severityMin', 'sevs', 'facility'], host: ['source', 'severityMax', 'severityMin', 'sevs'], app: ['source', 'severityMax', 'severityMin', 'sevs'] };

function compatible(f, kind) {
  const ok = ALLOWED[kind];
  for (const [k, v] of Object.entries(f || {})) { if (v === undefined || v === null || v === '') continue; if (k === 'from' || k === 'to') continue; if (!ok.includes(k)) return false; }
  return true;
}
/** WHERE clause for a summary table: the same severity / facility / source rules as for messages */
function sumWhere(f, kind, a, b) {
  const pick = {}; for (const k of ALLOWED[kind]) if (f && f[k] !== undefined) pick[k] = f[k];
  const w = buildWhere(pick); const extra = 't >= ? AND t < ?';
  return { sql: w.sql ? `${w.sql} AND ${extra}` : `WHERE ${extra}`, args: [...w.args, a, b] };
}

/** coverage of the summaries, as the reader sees it; null when the tables are not there (a database from before 1.97.6, opened read-only) */
function meta(db) {
  try {
    const m = {}; for (const r of db.prepare('SELECT k, v FROM sum_meta').all()) m[r.k] = r.v;
    if (m.cov === undefined || m.upto === undefined) return null;
    return { cov: m.cov, upto: m.upto };
  } catch { return null; }
}

/**
 * Splits [from, toExcl) into summary blocks and the pieces that must be counted from the messages.
 * `align` (optional): every block used must also lie inside one bucket of this size (charts), so only levels that divide it count.
 */
function plan(from, toExcl, m, kind, align) {
  const raw = [], sum = [];
  let levels = LEVELS[kind]; if (align) levels = levels.filter(([s]) => align % s === 0);
  if (!m || !levels.length) return { raw: [[from, toExcl]], sum };
  const lo = Math.max(from, m.cov), hi = Math.min(toExcl, m.upto);
  if (hi <= lo) return { raw: [[from, toExcl]], sum };
  if (from < lo) raw.push([from, lo]);
  const cover = (a, b, i) => {
    if (b <= a) return;
    if (i >= levels.length) { raw.push([a, b]); return; }
    const [size, table, keep] = levels[i]; let s = Math.ceil(a / size) * size; const e = Math.floor(b / size) * size;
    if (keep) s = Math.max(s, Math.ceil((m.upto - keep + 900e3) / size) * size);    // only blocks well inside what is kept (old ones are removed every few minutes)
    if (e > s) { cover(a, s, i + 1); sum.push([table, s, e]); cover(e, b, i + 1); } else cover(a, b, i + 1);
  };
  cover(lo, hi, 0);
  if (hi < toExcl) raw.push([hi, toExcl]);
  raw.sort((x, y) => x[0] - y[0]);
  const merged = []; for (const r of raw) { const l = merged[merged.length - 1]; if (l && l[1] >= r[0]) l[1] = Math.max(l[1], r[1]); else merged.push([...r]); }
  return { raw: merged, sum };
}

const blockOf = (ts, size) => Math.floor(ts / size) * size;

/** adds message counts into an in-memory tally: key → n, one map per table */
function tally(acc, rows, sign = 1) {
  const now = Date.now();
  for (const r of rows) {
    const src = r.source === 'snmp' ? 'snmp' : 'syslog', sev = Number.isInteger(r.severity) ? r.severity : 6, fac = Number.isInteger(r.facility) ? r.facility : 1, n = (r.n || 1) * sign;
    const host = r.host == null ? '' : String(r.host), app = r.app == null ? '' : String(r.app);
    for (const [table, size, kind, keep] of TABLES) {
      if (keep && r.ts < now - keep) continue;
      const t = blockOf(r.ts, size), key = kind === 'sev' ? `${t}\u0000${src}\u0000${sev}\u0000${fac}` : `${t}\u0000${src}\u0000${kind === 'host' ? host : app}\u0000${sev}`;
      const m = acc[table] || (acc[table] = new Map()); m.set(key, (m.get(key) || 0) + n);
    }
  }
  return acc;
}

/** writes a tally into the tables (inside the caller's transaction); counts that drop to zero are removed */
function apply(db, acc, stmts) {
  if (!stmts.up) {
    stmts.up = {}; stmts.zero = {};
    for (const [table, , kind] of TABLES) {
      const cols = kind === 'sev' ? 't, source, severity, facility' : `t, source, ${kind}, severity`;
      stmts.up[table] = db.prepare(`INSERT INTO ${table} (${cols}, n) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET n = n + excluded.n`);
      stmts.zero[table] = db.prepare(`DELETE FROM ${table} WHERE t >= ? AND t <= ? AND n <= 0`);
    }
  }
  for (const [table, , kind] of TABLES) {
    const m = acc[table]; if (!m || !m.size) continue; let neg = false, lo = Infinity, hi = -Infinity;
    for (const [key, n] of m) {
      if (!n) continue; const p = key.split('\u0000'), t = +p[0];
      if (kind === 'sev') stmts.up[table].run(t, p[1], +p[2], +p[3], n); else stmts.up[table].run(t, p[1], p[2], +p[3], n);
      if (n < 0) { neg = true; lo = Math.min(lo, t); hi = Math.max(hi, t); }
    }
    if (neg) stmts.zero[table].run(lo, hi);
  }
}

module.exports = { KEEP1, SCHEMA, LEVELS, TABLES, compatible, sumWhere, meta, plan, tally, apply, blockOf };
