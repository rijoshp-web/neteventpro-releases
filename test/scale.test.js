'use strict';
// "Keep everything" must stay fast: searches over a large database give the same answers as a plain scan, only sooner.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store');

const N = 250000;       // more than the first windows of the search (20 000, then 80 000), so the window logic really runs
async function withStore(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nep-scale-')); const st = new Store(dir);
  try {
    const end = Date.now(), start = end - 700 * 86400000, step = Math.floor((end - start) / N);
    st.db.exec(`INSERT INTO logs (id, ts, dev_ts, src_ip, host, facility, severity, app, pid, msgid, message, tags, color, raw, source, vb, seq)
      WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM c WHERE i < ${N})
      SELECT i, ${start} + i*${step}, NULL, '10.0.0.' || (i%250), 'dev-' || (i%300), 23, CASE WHEN i%9973 = 0 THEN 1 WHEN i%9 = 0 THEN 3 ELSE 6 END, 'app', '', '', 'message number ' || i || CASE WHEN i%50000 = 7 THEN ' rare-marker' ELSE '' END, '', '', '', CASE WHEN i%10 = 0 THEN 'snmp' ELSE 'syslog' END, '', i FROM c`);
    await fn(st, { start, end, step });
  } finally { st.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}
const plain = (st, where, args, n = 500) => st.db.prepare(`SELECT id FROM logs ${where} ORDER BY id DESC LIMIT ?`).all(...args, n).map((r) => r.id);

test('a search over a big database returns exactly what a plain scan returns', async () => {
  await withStore(async (st, { end }) => {
    const ids = async (q, n = 500) => (await st.query(q, n)).map((r) => r.id);
    assert.deepEqual(await ids({ from: 0 }), plain(st, '', []));                                            // all time, no filter
    assert.deepEqual(await ids({ from: 0, sevs: '1,3' }), plain(st, 'WHERE severity IN (1,3)', []));       // frequent filter: first window is enough
    assert.deepEqual(await ids({ from: 0, sevs: '1' }), plain(st, 'WHERE severity = 1', []));              // rare filter: needs the later windows (25 rows exist)
    assert.equal((await ids({ from: 0, sevs: '1' })).length, Math.floor(N / 9973));
    assert.deepEqual(await ids({ text: 'rare-marker' }), plain(st, "WHERE message LIKE '%rare-marker%'", []));
    assert.equal((await ids({ text: 'rare-marker' })).length, 5);
    assert.deepEqual(await ids({ text: 'no-such-text-anywhere' }), []);
    assert.deepEqual(await ids({ host: 'dev-7', source: 'syslog' }), plain(st, "WHERE (host = 'dev-7' OR src_ip = 'dev-7') AND source = 'syslog'", []));
    assert.deepEqual(await ids({ from: end - 30 * 86400000 }), plain(st, 'WHERE ts >= ' + (end - 30 * 86400000), []));
    assert.deepEqual(await ids({ from: end - 400 * 86400000, to: end - 300 * 86400000, sevs: '3' }, 100), plain(st, `WHERE ts >= ${end - 400 * 86400000} AND ts <= ${end - 300 * 86400000} AND severity = 3`, [], 100));
    // paging backwards with beforeId walks the whole table once, without gaps or repeats
    const seen = new Set(); let before; for (let i = 0; i < 700; i++) { const page = await ids({ from: 0, beforeId: before }, 500); if (!page.length) break; for (const id of page) { assert.ok(!seen.has(id)); seen.add(id); } before = page[page.length - 1]; }
    assert.equal(seen.size, N);
    assert.deepEqual(await ids({ from: 0, limit: 5 }, 5), plain(st, '', [], 5));
  });
});

test('the number of stored messages is kept without counting on the receiving thread', async () => {
  await withStore(async (st) => {
    assert.equal(st.totalRows(), N);                                  // from the id range at first
    st.enqueue({ id: N + 1, ts: Date.now(), devTs: null, srcIp: '1.1.1.1', host: 'h', facility: 1, severity: 6, app: 'a', pid: '', msgid: '', message: 'm', raw: 'm', tags: [], seq: N + 1, source: 'syslog' }); st.flush();
    assert.equal(st.totalRows(), N + 1);                              // kept by the writer
    const removed = await st.deleteLogs({ ids: [1, 2, 3] }); assert.equal(removed, 3);
    await new Promise((r) => setTimeout(r, 50)); assert.equal(st.totalRows(), N - 2);   // recounted after a delete
  });
});

test('retention: "0" keeps everything, a number of days removes only older messages', async () => {
  await withStore(async (st, { end }) => {
    assert.equal(await st.prune(0, 0), 0); assert.equal(st.totalRows(), N);
    const old = st.db.prepare('SELECT COUNT(*) AS n FROM logs WHERE ts < ?').get(end - 365 * 86400000).n;
    assert.ok(old > 0); assert.equal(await st.prune(365, 0), old); assert.equal(st.db.prepare('SELECT COUNT(*) AS n FROM logs').get().n, N - old);
  });
});
