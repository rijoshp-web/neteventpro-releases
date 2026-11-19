'use strict';
// 1.98.1 word index: a search must return exactly what it returned without the index — before, during and after the
// background fill, after deletes, and for words the index cannot use (short words, excluded words, tags).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store');

function fill(st, n) {
  const now = Date.now();
  for (let i = 1; i <= n; i++) st.enqueue({ id: i, ts: now - (n - i) * 1000, devTs: null, srcIp: '10.0.0.' + (i % 50), host: 'dev-' + (i % 37), facility: 23, severity: i % 8, app: i % 3 ? 'sshd' : 'LINK',
    pid: '', msgid: '', message: i % 997 === 0 ? `Fan redundancy is lost on PSU ${i}` : i % 13 === 0 ? `Interface Gi1/0/${i % 48} down "quoted"` : `user login ok ${i}`, tags: i % 101 === 0 ? ['link-down'] : null, color: '', raw: 'x', source: 'syslog', vb: null, seq: i });
  st.flush();
}
const Q = (now) => [
  { text: 'redundancy' }, { text: 'REDUNDANCY psu' }, { text: 'redundancy', from: now - 3600e3 }, { text: 'Gi1/0/7 down' }, { text: 'dev-5' }, { text: 'link' },
  { text: 'redundancy -psu' }, { text: 'ok' }, { text: '"quoted"' }, { text: 'tag:link-down' }, { text: 'no-such-word-anywhere' }, { text: 'redundancy', beforeId: 15000 }, { text: 'login', severityMax: 3 }
];
const ids = async (st, q, n = 200) => (await st.query(q, n)).map((r) => r.id);

test('word index searches return the same messages as reading every message', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nep-fts-')); const st = new Store(dir);
  try {
    fill(st, 30000); const now = Date.now();
    const before = []; for (const q of Q(now)) before.push([await ids(st, q), await st.count(q)]);
    st.setSearchIndex(true);
    // nothing indexed yet (fill runs later): the same answers
    for (const [i, q] of Q(now).entries()) assert.deepEqual(await ids(st, q), before[i][0], 'unfilled ' + JSON.stringify(q));
    // half filled
    st.db.exec('BEGIN'); for (const r of st.db.prepare('SELECT id, message, host, app FROM logs WHERE id >= 15000').all()) st.ftsIns.run(r.id, r.message, r.host, r.app); st.setMeta('fts_from', 15000); st.db.exec('COMMIT');
    for (const [i, q] of Q(now).entries()) { assert.deepEqual(await ids(st, q), before[i][0], 'half ' + JSON.stringify(q)); assert.equal(await st.count(q), before[i][1], 'half count ' + JSON.stringify(q)); }
    await st.ftsBackfill(); assert.equal(st.ftsStatus().complete, true);
    for (const [i, q] of Q(now).entries()) { assert.deepEqual(await ids(st, q), before[i][0], 'full ' + JSON.stringify(q)); assert.equal(await st.count(q), before[i][1], 'full count ' + JSON.stringify(q)); }
    // new messages are indexed as they arrive; deleted ones leave the index
    st.enqueue({ id: 30001, ts: Date.now(), devTs: null, srcIp: '1.1.1.1', host: 'newdev', facility: 1, severity: 3, app: 'x', pid: '', msgid: '', message: 'brand new redundancy alarm', raw: 'x', source: 'syslog', seq: 30001 }); st.flush();
    assert.equal((await ids(st, { text: 'redundancy' }))[0], 30001);
    await st.deleteLogs({ q: { text: 'redundancy' } });
    assert.deepEqual(await ids(st, { text: 'redundancy' }), []);
    assert.equal(st.db.prepare("SELECT COUNT(*) AS n FROM logs_fts WHERE logs_fts MATCH '\"redundancy\"'").get().n, 0);
    st.setSearchIndex(false); assert.equal(st.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'logs_fts'").get().n, 0);
    assert.deepEqual(await ids(st, { text: 'Gi1/0/7 down' }), before[3][0]);
  } finally { st.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
