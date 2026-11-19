'use strict';
// 1.97.6: dashboards and statistics read per-minute / per-hour summaries. Every answer must be exactly what counting the
// messages gives: after normal receiving, after deletes and retention, and after filling in the past for an older database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Store } = require('../src/store');
const dashq = require('../src/dashq');
const SUM = require('../src/summary');

const HOUR = 3600e3;
function msgs(start, end, n, id0 = 1) {
  const out = []; const step = (end - start) / n;
  for (let i = 0; i < n; i++) {
    const k = id0 + i;
    out.push({ id: k, ts: Math.floor(start + i * step + (k % 7) * 13), devTs: null, srcIp: '10.0.0.' + (k % 40), host: 'dev-' + (k % 37), facility: k % 3 ? 23 : 4, severity: [0, 1, 2, 3, 4, 5, 6, 7, 3, 6, 6, 4][k % 12],
      app: k % 5 ? 'app' + (k % 11) : '', pid: '', msgid: k % 4 ? '' : 'ID' + (k % 3), message: 'message ' + k, tags: null, color: '', raw: 'x', source: k % 9 ? 'syslog' : 'snmp', vb: null, seq: k });
  }
  return out;
}
const TILES = (tz = 240) => [
  { id: 'c1', kind: 'count', prev: true }, { id: 'c2', kind: 'count', filter: { source: 'all' } }, { id: 'c3', kind: 'count', filter: { severityMax: 3 } }, { id: 'c4', kind: 'count', filter: { facility: 4, source: 'all' } },
  { id: 'd1', kind: 'distinct' }, { id: 'd2', kind: 'distinct', filter: { source: 'snmp' } },
  { id: 's1', kind: 'series' }, { id: 's2', kind: 'series', filter: { source: 'all', sevs: '3,4' } },
  { id: 't1', kind: 'top', by: 'host', n: 25 }, { id: 't2', kind: 'top', by: 'app', n: 25 }, { id: 't3', kind: 'top', by: 'severity', filter: { source: 'all' } }, { id: 't4', kind: 'top', by: 'facility' }, { id: 't5', kind: 'top', by: 'msgid' },
  { id: 't6', kind: 'top', by: 'host', filter: { text: 'message 1' } },
  { id: 'h1', kind: 'heatHost', n: 20 }, { id: 'h2', kind: 'heatDow', tz }, { id: 'h3', kind: 'heatDow', tz: 330, filter: { source: 'all' } }, { id: 'l1', kind: 'list', n: 5 }
];
// the same request answered from the messages only
function plainRun(db, args) { const keep = SUM.meta; SUM.meta = () => null; try { return dashq.run(db, args); } finally { SUM.meta = keep; } }
const sortTop = (o) => { for (const v of Object.values(o.tiles)) if (v.rows && v.total !== undefined) v.rows.sort((a, b) => b.n - a.n || String(a.key).localeCompare(String(b.key))); if (o.tiles.h1) { const h = o.tiles.h1; const z = h.hosts.map((x, i) => [x, h.cells[i]]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))); h.hosts = z.map((x) => x[0]); h.cells = z.map((x) => x[1]); } return o; };
function same(st, from, to, label) {
  st.flush(); st.sumFlush();
  const db = new DatabaseSync(st.file, { readOnly: true });
  try {
    const args = { from, to, tiles: TILES() };
    const a = sortTop(dashq.run(db, args)), b = sortTop(plainRun(db, args));
    for (const k of Object.keys(b.tiles)) assert.deepEqual(a.tiles[k], b.tiles[k], `${label}: tile ${k}`);
  } finally { db.close(); }
}
const ranges = (now) => [[now - 30 * 60e3, now], [now - 6 * HOUR - 17e3, now - 1234], [now - 26 * HOUR, now], [now - 3 * 86400e3, now - HOUR]];

test('summaries give the same dashboard answers as counting the messages', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nep-sum-')); const st = new Store(dir);
  try {
    const now = Date.now();
    for (const m of msgs(now - 3 * 86400e3, now, 30000)) st.enqueue(m);
    for (const [f, t] of ranges(now)) same(st, f, t, 'fresh');
    // summaries really are used: a 26 h dashboard plan has big blocks
    const db = new DatabaseSync(st.file, { readOnly: true }); const m = SUM.meta(db); db.close();
    assert.equal(m.cov, 0); assert.ok(SUM.plan(now - 26 * HOUR, now, m, 'host').sum.some(([t]) => t === 'sum_host60'));
    // deleting by id, by search and by age keeps them right
    st.deleteLogs({ ids: [5, 6, 7, 100, 2000, 29999] });
    return st.deleteLogs({ q: { host: 'dev-3' } }).then(async (n) => {
      assert.ok(n > 500);
      await st.prune(2, 0);
      for (const [f, t] of ranges(now)) same(st, f, t, 'after deletes');
      st.clearAll(); for (const m2 of msgs(now - HOUR, now, 500, 50000)) st.enqueue(m2);
      for (const [f, t] of ranges(now)) same(st, f, t, 'after delete all');
    });
  } finally { setTimeout(() => { st.close(); fs.rmSync(dir, { recursive: true, force: true }); }, 0); }
});

test('an older database is filled in the background and answers stay right meanwhile', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nep-sum2-'));
  let st = new Store(dir); const now = Date.now();
  for (const m of msgs(now - 2 * 86400e3, now - 60e3, 20000)) st.enqueue(m);
  st.flush();
  st.db.exec(`DROP TABLE sum_meta; ${SUM.TABLES.map(([t]) => `DROP TABLE ${t};`).join(' ')}`);   // as if written by 1.97.5
  st.close();
  st = new Store(dir);
  try {
    assert.ok(st.sumCov > now);
    same(st, now - 26 * HOUR, now, 'before filling');   // nothing covered yet: plain counting
    for (const m of msgs(now, now + 1000, 50, 90000)) st.enqueue(m);
    st.sumLive = 0; await st.sumBackfill();
    assert.equal(st.sumCov, 0);
    same(st, now - 26 * HOUR, now + 2000, 'after filling');
    same(st, now - 47 * HOUR, now - 5 * HOUR, 'after filling, older range');
    // statistics from the reader thread
    const s = await st.stats(now - 24 * HOUR);
    const raw = st.db.prepare('SELECT COUNT(*) AS n FROM logs WHERE ts >= ?').get(now - 24 * HOUR).n;
    assert.equal(s.minuteSeries.reduce((a, r) => a + r.n, 0), raw);
    assert.equal(s.topHosts.length, 10); assert.ok(s.topApps.every((r) => r.app !== ''));
  } finally { st.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
