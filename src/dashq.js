'use strict';
// Dashboard numbers for a chosen time range. Runs inside the database reader thread. Every filter goes through buildWhere (bound parameters),
// the grouping column comes from a fixed list, and sizes are capped, so a request can ask for a lot of work but never for arbitrary SQL.
const SEVX = require('./sev');
const { COLS, buildWhere, rowOut } = require('./query');
const SUM = require('./summary');

const BUCKETS = [60e3, 120e3, 300e3, 600e3, 900e3, 1800e3, 3600e3, 7200e3, 10800e3, 21600e3, 43200e3, 86400e3];
const BY = { host: 'host', app: 'app', severity: 'severity', facility: 'facility', msgid: 'msgid' };
const MAX_TILES = 80;
/** a tile without a source counts syslog only (tiles saved before traps existed); source "all" counts both */
const filterOf = (f) => { const o = { source: 'syslog', ...(f || {}) }; if (o.source === 'all') delete o.source; return o; };

/** a bucket size that gives about 96 bars or fewer for the range */
function bucketFor(from, to, bars = 96) { const want = (to - from) / bars; return BUCKETS.find((b) => b >= want) || BUCKETS[BUCKETS.length - 1]; }


/** alarms (1.36): the same kinds of answers as for messages, from the alarms table. "state" decides which alarms and which time column count. */
const A_BY = { host: 'host', rule: 'rule_name', severity: 'severity', state: 'state', source: 'source' };
function alarmWhere(f, from, to, series) {
  const w = [], a = [], st = f.astate || 'raised';
  if (st === 'active') w.push("state != 'cleared'"); else if (st === 'open') w.push("state = 'open'"); else if (st === 'ack') w.push("state = 'ack'"); else if (st === 'esc') w.push("state != 'cleared' AND esc_ts > 0");
  else if (st === 'cleared') { w.push("state = 'cleared' AND cleared_ts >= ? AND cleared_ts <= ?"); a.push(from, to); } else { w.push('first_ts >= ? AND first_ts <= ?'); a.push(from, to); }
  if (series && ['active', 'open', 'ack', 'esc'].includes(st)) { w.push('first_ts >= ? AND first_ts <= ?'); a.push(from, to); }
  const sv = (v) => (v === undefined || v === '' || v === null || !Number.isFinite(+v) ? null : Math.round(+v));
  if (sv(f.severityMax) !== null) w.push(`severity IN (${SEVX.upTo(sv(f.severityMax)).join(',')})`);
  if (sv(f.severityMin) !== null) w.push(`severity IN (${SEVX.from(sv(f.severityMin)).join(',')})`);
  if (f.sevs) { const l = String(f.sevs).split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 9); if (l.length) w.push(`severity IN (${l.join(',')})`); }
  if (f.host) { const hs = String(f.host).split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20); if (hs.length) { w.push('(' + hs.map(() => '(host = ? OR src_ip = ? OR dev = ?)').join(' OR ') + ')'); for (const h of hs) a.push(h, h, h); } }
  if (f.rule) { w.push("rule_name LIKE ? ESCAPE '\\'"); a.push('%' + String(f.rule).replace(/[\\%_]/g, '\\$&') + '%'); }
  if (f.text) { w.push("message LIKE ? ESCAPE '\\'"); a.push('%' + String(f.text).replace(/[\\%_]/g, '\\$&') + '%'); }
  if (f.source === 'syslog' || f.source === 'snmp') { w.push('source = ?'); a.push(f.source); }
  return { sql: 'WHERE ' + w.join(' AND '), args: a };
}
function alarmTile(db, t, ctx) {
  const { from, to, span, bucket, b0, nb } = ctx, f = t.filter || {}, k = alarmWhere(f, from, to, t.kind === 'series');
  if (t.kind === 'count') {
    if (t.agg === 'avgclear') return { n: Math.round((db.prepare(`SELECT AVG(cleared_ts - first_ts) AS v FROM alarms ${k.sql}`).get(...k.args).v || 0) / 6000) / 10 };
    const r = { n: db.prepare(`SELECT COUNT(*) AS n FROM alarms ${k.sql}`).get(...k.args).n };
    if (t.prev && ['raised', 'cleared', undefined].includes(f.astate)) { const p = alarmWhere(f, from - span - 1, from - 1); r.prev = db.prepare(`SELECT COUNT(*) AS n FROM alarms ${p.sql}`).get(...p.args).n; }
    return r;
  }
  if (t.kind === 'distinct') return { n: db.prepare(`SELECT COUNT(DISTINCT dev) AS n FROM alarms ${k.sql}`).get(...k.args).n };
  if (t.kind === 'series') {
    const col = f.astate === 'cleared' ? 'cleared_ts' : 'first_ts', series = Array.from({ length: nb }, () => new Array(10).fill(0));
    for (const r of db.prepare(`SELECT CAST(${col} / ${bucket} AS INTEGER) AS b, severity, COUNT(*) AS n FROM alarms ${k.sql} GROUP BY b, severity`).all(...k.args)) { const i = r.b - b0; if (i >= 0 && i < nb && r.severity >= 0 && r.severity < 10) series[i][r.severity] = r.n; }
    return { series };
  }
  if (t.kind === 'top') {
    const col = A_BY[t.by] || 'host', n = Math.min(Math.max(+t.n || 10, 1), 25);
    return { rows: db.prepare(`SELECT ${col} AS key, COUNT(*) AS n, MIN(${SEVX.RANK_SQL}) AS worst FROM alarms ${k.sql} GROUP BY ${col} ORDER BY n DESC LIMIT ${n}`).all(...k.args).map((r) => ({ ...r, worst: SEVX.ORDER[r.worst] })), total: db.prepare(`SELECT COUNT(*) AS n FROM alarms ${k.sql}`).get(...k.args).n };
  }
  if (t.kind === 'list') {
    const n = Math.min(Math.max(+t.n || 8, 1), 50);
    return { alarms: db.prepare(`SELECT id, severity, host, src_ip AS srcIp, rule_name AS rule, state, first_ts AS first, last_ts AS last, count, message, source FROM alarms ${k.sql} ORDER BY last_ts DESC LIMIT ${n}`).all(...k.args) };
  }
  return { error: 'This visual is not available for alarms' };
}

// ---- 1.97.6: answers built from the summary tables plus the messages at the edges (see summary.js) ----
const rawWhere = (tf, a, b, extra) => { const w = buildWhere({ ...tf, from: a, to: b - 1 }); return { sql: extra ? `${w.sql} AND ${extra}` : w.sql, args: w.args }; };
/** number of messages in [a, b) */
function countRange(db, tf, a, b, m) {
  const p = SUM.compatible(tf, 'sev') ? SUM.plan(a, b, m, 'sev') : { raw: [[a, b]], sum: [] }; let n = 0;
  for (const [x, y] of p.raw) { const w = rawWhere(tf, x, y); n += db.prepare(`SELECT COUNT(*) AS n FROM logs ${w.sql}`).get(...w.args).n; }
  for (const [table, x, y] of p.sum) { const w = SUM.sumWhere(tf, 'sev', x, y); n += db.prepare(`SELECT COALESCE(SUM(n), 0) AS n FROM ${table} ${w.sql}`).get(...w.args).n; }
  return n;
}
/** per severity, per bucket */
function seriesRange(db, tf, a, b, bucket, b0, nb, m) {
  const series = Array.from({ length: nb }, () => new Array(10).fill(0));
  const add = (r) => { const i = r.b - b0; if (i >= 0 && i < nb && r.severity >= 0 && r.severity < 10) series[i][r.severity] += r.n; };
  const p = SUM.compatible(tf, 'sev') ? SUM.plan(a, b, m, 'sev', bucket) : { raw: [[a, b]], sum: [] };
  for (const [x, y] of p.raw) { const w = rawWhere(tf, x, y); for (const r of db.prepare(`SELECT CAST(ts / ${bucket} AS INTEGER) AS b, severity, COUNT(*) AS n FROM logs ${w.sql} GROUP BY b, severity`).all(...w.args)) add(r); }
  for (const [table, x, y] of p.sum) { const w = SUM.sumWhere(tf, 'sev', x, y); for (const r of db.prepare(`SELECT CAST(t / ${bucket} AS INTEGER) AS b, severity, SUM(n) AS n FROM ${table} ${w.sql} GROUP BY b, severity`).all(...w.args)) add(r); }
  return series;
}
/** count and worst severity per value of one column (host, app, severity, facility); null when the summaries cannot answer it */
function groupRange(db, tf, col, a, b, m, notEmpty) {
  const kind = col === 'host' ? 'host' : col === 'app' ? 'app' : (col === 'severity' || col === 'facility') ? 'sev' : null;
  const out = new Map(), add = (r) => { const o = out.get(r.key); if (o) { o.n += r.n; o.worst = Math.min(o.worst, r.worst); } else out.set(r.key, { key: r.key, n: r.n, worst: r.worst }); };
  const p = kind && SUM.compatible(tf, kind) ? SUM.plan(a, b, m, kind) : { raw: [[a, b]], sum: [] };
  const ne = notEmpty ? `${col} <> ''` : '';
  for (const [x, y] of p.raw) { const w = rawWhere(tf, x, y, ne); for (const r of db.prepare(`SELECT ${col} AS key, COUNT(*) AS n, MIN(${SEVX.RANK_SQL}) AS worst FROM logs ${w.sql} GROUP BY ${col}`).all(...w.args)) add(r); }
  for (const [table, x, y] of p.sum) { const w = SUM.sumWhere(tf, kind, x, y); for (const r of db.prepare(`SELECT ${col} AS key, SUM(n) AS n, MIN(${SEVX.RANK_SQL}) AS worst FROM ${table} ${w.sql}${ne ? ' AND ' + ne : ''} GROUP BY ${col}`).all(...w.args)) add(r); }
  return out;
}
/** busiest values first */
const topOf = (map, n) => [...map.values()].sort((x, y) => y.n - x.n || (x.key < y.key ? -1 : 1)).slice(0, n);

function run(db, { from, to, tiles }) {
  const now = Date.now();
  to = Number.isFinite(+to) ? Math.min(+to, now + 60000) : now;
  if (!Number.isFinite(+from) || +from <= 0) {      // "everything stored"
    const first = db.prepare('SELECT MIN(ts) AS t FROM logs').get().t;
    from = first || to - 3600000;
  }
  from = Math.min(+from, to - 1000);
  const span = to - from, bucket = bucketFor(from, to), b0 = Math.floor(from / bucket), nb = Math.floor(to / bucket) - b0 + 1;
  const out = { from, to, bucketMs: bucket, firstBucket: b0, buckets: nb, tiles: {} };
  const m = SUM.meta(db), end = to + 1;
  for (const t of (tiles || []).slice(0, MAX_TILES)) {
    if (t.ds === 'alarms') { try { out.tiles[t.id] = alarmTile(db, t, { from, to, span, bucket, b0, nb }); } catch (e) { out.tiles[t.id] = { error: e.message }; } continue; }
    const tf = filterOf(t.filter), f = { ...tf, from, to };
    const { sql, args } = buildWhere(f);
    try {
      if (t.kind === 'count') {
        const r = { n: countRange(db, tf, from, end, m) };
        if (t.prev) r.prev = countRange(db, tf, from - span - 1, from, m);
        out.tiles[t.id] = r;
      } else if (t.kind === 'distinct') {
        out.tiles[t.id] = { n: SUM.compatible(tf, 'host') ? groupRange(db, tf, 'host', from, end, m).size : db.prepare(`SELECT COUNT(DISTINCT host) AS n FROM logs ${sql}`).get(...args).n };
      } else if (t.kind === 'series') {
        out.tiles[t.id] = { series: seriesRange(db, tf, from, end, bucket, b0, nb, m) };
      } else if (t.kind === 'top' && (t.by === 'host' || t.by === 'app' || t.by === 'severity' || t.by === 'facility' || !t.by) && SUM.compatible(tf, t.by === 'app' ? 'app' : t.by === 'host' || !t.by ? 'host' : 'sev')) {
        const col = BY[t.by] || 'host', n = Math.min(Math.max(+t.n || 10, 1), 25), g = groupRange(db, tf, col, from, end, m, col === 'app');
        let total = 0; for (const v of g.values()) total += v.n;
        out.tiles[t.id] = { rows: topOf(g, n).map((r) => ({ ...r, worst: SEVX.ORDER[r.worst] })), total };
      } else if (t.kind === 'top') {
        const col = BY[t.by] || 'host', n = Math.min(Math.max(+t.n || 10, 1), 25);
        const extra = col === 'app' || col === 'msgid' ? (sql ? `${sql} AND ${col} <> ''` : `WHERE ${col} <> ''`) : sql;
        out.tiles[t.id] = { rows: db.prepare(`SELECT ${col} AS key, COUNT(*) AS n, MIN(${SEVX.RANK_SQL}) AS worst FROM logs ${extra} GROUP BY ${col} ORDER BY n DESC LIMIT ${n}`).all(...args).map((r) => ({ ...r, worst: SEVX.ORDER[r.worst] })), total: db.prepare(`SELECT COUNT(*) AS n FROM logs ${extra}`).get(...args).n };
      } else if (t.kind === 'heatHost') {           // busiest devices (rows) by time slot (columns), at most 48 columns
        const hb = bucketFor(from, to, 48), hb0 = Math.floor(from / hb), hn = Math.floor(to / hb) - hb0 + 1, n = Math.min(Math.max(+t.n || 10, 1), 20);
        const useSum = SUM.compatible(tf, 'host');
        const hosts = useSum ? topOf(groupRange(db, tf, 'host', from, end, m), n).map((r) => r.key) : db.prepare(`SELECT host, COUNT(*) AS n FROM logs ${sql} GROUP BY host ORDER BY n DESC LIMIT ${n}`).all(...args).map((r) => r.host);
        const cells = hosts.map(() => new Array(hn).fill(0));
        if (hosts.length && useSum) {
          const p = SUM.plan(from, end, m, 'host', hb), inH = `host IN (${hosts.map(() => '?').join(',')})`;
          const add = (r) => { const i = r.b - hb0, h = hosts.indexOf(r.host); if (i >= 0 && i < hn && h >= 0) cells[h][i] += r.n; };
          for (const [x, y] of p.raw) { const w = rawWhere(tf, x, y, inH); for (const r of db.prepare(`SELECT host, CAST(ts / ${hb} AS INTEGER) AS b, COUNT(*) AS n FROM logs ${w.sql} GROUP BY host, b`).all(...w.args, ...hosts)) add(r); }
          for (const [table, x, y] of p.sum) { const w = SUM.sumWhere(tf, 'host', x, y); for (const r of db.prepare(`SELECT host, CAST(t / ${hb} AS INTEGER) AS b, SUM(n) AS n FROM ${table} ${w.sql} AND ${inH} GROUP BY host, b`).all(...w.args, ...hosts)) add(r); }
        } else if (hosts.length) {
          const extra = (sql ? sql + ' AND ' : 'WHERE ') + `host IN (${hosts.map(() => '?').join(',')})`;
          for (const r of db.prepare(`SELECT host, CAST(ts / ${hb} AS INTEGER) AS b, COUNT(*) AS n FROM logs ${extra} GROUP BY host, b`).all(...args, ...hosts)) { const i = r.b - hb0, h = hosts.indexOf(r.host); if (i >= 0 && i < hn && h >= 0) cells[h][i] = r.n; }
        }
        out.tiles[t.id] = { hosts, cells, bucketMs: hb, firstBucket: hb0 };
      } else if (t.kind === 'heatDow') {            // weekday (rows) by hour of day (columns), in the viewer's time zone
        const off = Math.round(+t.tz || 0) * 60, cells = Array.from({ length: 7 }, () => new Array(24).fill(0));
        if (SUM.compatible(tf, 'sev')) {
          const p = SUM.plan(from, end, m, 'sev'), add = (r) => { if (r.d >= 0 && r.d < 7 && r.h >= 0 && r.h < 24) cells[r.d][r.h] += r.n; };
          for (const [x, y] of p.raw) { const w = rawWhere(tf, x, y); for (const r of db.prepare(`SELECT CAST(strftime('%w', ts / 1000 + ${off}, 'unixepoch') AS INTEGER) AS d, CAST(strftime('%H', ts / 1000 + ${off}, 'unixepoch') AS INTEGER) AS h, COUNT(*) AS n FROM logs ${w.sql} GROUP BY d, h`).all(...w.args)) add(r); }
          for (const [table, x, y] of p.sum) { const w = SUM.sumWhere(tf, 'sev', x, y); for (const r of db.prepare(`SELECT CAST(strftime('%w', t / 1000 + ${off}, 'unixepoch') AS INTEGER) AS d, CAST(strftime('%H', t / 1000 + ${off}, 'unixepoch') AS INTEGER) AS h, SUM(n) AS n FROM ${table} ${w.sql} GROUP BY d, h`).all(...w.args)) add(r); }
          out.tiles[t.id] = { cells }; continue;
        }
        for (const r of db.prepare(`SELECT CAST(strftime('%w', ts / 1000 + ${off}, 'unixepoch') AS INTEGER) AS d, CAST(strftime('%H', ts / 1000 + ${off}, 'unixepoch') AS INTEGER) AS h, COUNT(*) AS n FROM logs ${sql} GROUP BY d, h`).all(...args)) cells[r.d][r.h] = r.n;
        out.tiles[t.id] = { cells };
      } else if (t.kind === 'list') {
        const n = Math.min(Math.max(+t.n || 8, 1), 50);
        out.tiles[t.id] = { rows: db.prepare(`SELECT ${COLS} FROM logs ${sql} ORDER BY id DESC LIMIT ${n}`).all(...args).map(rowOut) };
      } else out.tiles[t.id] = { error: 'unknown tile kind' };
    } catch (e) { out.tiles[t.id] = { error: e.message }; }
  }
  return out;
}

module.exports = { run, bucketFor, BUCKETS, seriesRange, groupRange, topOf, countRange };
