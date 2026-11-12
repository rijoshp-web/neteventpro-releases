'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store');
const { AlarmStore } = require('../src/alarms');
const { SqlCopy, schemaSql, loadSql, rowArray, TABLES } = require('../src/sqlcopy');

process.env.NETEVENTPRO_SQLCOPY_WORKER = path.join(__dirname, 'fake-sqlworker.js');
const setup = (over = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-')), logf = path.join(dir, 'sql.log'); process.env.FAKE_SQL_LOG = logf; process.env.FAKE_SQL_MODE = 'ok';
  const store = new Store(dir), alarms = new AlarmStore(store, { enqueue() {}, enqueueEscalation() {}, enqueueRecovery() {} });
  const cfg = { enabled: true, server: 'sql1', database: 'NEP', auth: 'windows', user: '', password: '', encrypt: true, trustCert: false, createDb: true, copyLogs: true, copyTraps: true, copyAlarms: true, copyDevices: true, backfill: true, batch: 100, intervalSec: 5, ...over };
  const config = { dir, get: () => ({ sqlCopy: cfg }) };
  const sc = new SqlCopy(config, store.db);
  const calls = () => (fs.existsSync(logf) ? fs.readFileSync(logf, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const add = (n, src = 'syslog', from = 1) => { for (let i = 0; i < n; i++) store.enqueue({ id: from + i, ts: Date.now(), devTs: null, srcIp: '10.0.0.1', host: 'sw1', facility: 1, severity: 3, app: 'a', pid: '', msgid: '', message: 'm' + (from + i), tags: [], color: '', raw: 'r', source: src, seq: from + i }); store.flush(); };
  return { dir, store, alarms, cfg, sc, calls, add, done: () => { sc.stop(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
};

test('SQL is generated for every table (schema version, merge, temp table)', () => {
  const ddl = schemaSql().join('\n');
  for (const t of Object.values(TABLES)) assert.ok(ddl.includes('dbo.' + t.sql));
  assert.ok(/ne_schema/.test(ddl) && /newer NetEventPro/.test(ddl)); assert.ok(/CREATE VIEW dbo\.ne_traps/.test(ddl) && /dbo\.ne_syslog/.test(ddl));
  const l = loadSql('logs'); assert.ok(l.before[0].startsWith('CREATE TABLE #stg') && /MERGE dbo\.ne_logs/.test(l.after[0]));
  assert.deepEqual(rowArray('devices', { src_ip: '1.1.1.1', host: 'h\u0000x', first_seen: 0, last_seen: 1700000000000, count: 3, vendor: '', ips: null }), ['1.1.1.1', 'hx', null, '2023-11-14 22:13:20.000', 3, '', null]);
});

test('copies logs, traps, alarms and devices; creates tables first; then only what is new', async () => {
  const x = setup();
  try {
    x.add(250); x.add(5, 'snmp', 251);
    x.alarms.raise({ id: 1, ts: Date.now(), host: 'sw1', devKey: 'sw1', srcIp: '10.0.0.1', severity: 3, message: 'down' }, { id: 'r', name: 'R', actions: { alarm: true } });
    x.store.saveDevices?.([{ key: '10.0.0.1', ip: '10.0.0.1', host: 'sw1', first: 1, last: 2, count: 3 }]);
    await new Promise((r) => setTimeout(r, 40));
    await x.sc.tick();
    const c = x.calls();
    assert.ok(c[0].createDb && c[0].before.some((s) => /ne_schema/.test(s)), 'schema first, with create-database');
    const total = (t) => c.filter((k) => k.after.some((s) => s.includes('dbo.' + t))).reduce((a, k) => a + k.rows, 0);
    assert.equal(total('ne_logs'), 255); assert.equal(total('ne_alarms'), 1);
    assert.equal(x.sc.status().pending.logs, 0); assert.equal(x.sc.status().state, 'ok');
    const n = c.length; await x.sc.tick(); assert.equal(x.calls().length, n, 'nothing new = nothing sent');
    x.add(3, 'syslog', 1000); x.alarms.ack([1], 'me'); await new Promise((r) => setTimeout(r, 40)); await x.sc.tick();
    const d = x.calls().slice(n); assert.equal(d.filter((k) => k.after.some((s) => s.includes('ne_logs'))).reduce((a, k) => a + k.rows, 0), 3);
    assert.equal(d.filter((k) => k.after.some((s) => s.includes('ne_alarms'))).reduce((a, k) => a + k.rows, 0), 1, 'a changed alarm is sent again');
  } finally { x.done(); }
});

test('server down: errors are shown, rows wait, and are copied when it is back', async () => {
  const x = setup({ backfill: false });
  try {
    await x.sc.tick(); x.add(10);
    process.env.FAKE_SQL_MODE = 'down'; x.sc.state.nextAt = 0; await x.sc.tick();
    assert.equal(x.sc.status().state, 'error'); assert.match(x.sc.status().lastError, /network-related/); assert.equal(x.sc.status().pending.logs, 10);
    x.sc.state.nextAt = 0; process.env.FAKE_SQL_MODE = 'ok'; await x.sc.tick();
    assert.equal(x.sc.status().pending.logs, 0); assert.equal(x.sc.status().lastError, '');
  } finally { x.done(); }
});

test('switching copies off per kind, and the Test button answers', async () => {
  const x = setup({ copyTraps: false, copyAlarms: false });
  try {
    x.add(3); x.add(4, 'snmp', 10); await x.sc.tick();
    assert.equal(x.calls().filter((k) => k.after.some((s) => s.includes('ne_logs'))).reduce((a, k) => a + k.rows, 0), 3, 'traps are skipped');
    let r = await x.sc.test(x.cfg); assert.ok(r.ok && r.dbExists && /SQL Server 2022/.test(r.version) && !/line2/.test(r.version));
    process.env.FAKE_SQL_MODE = 'nodb'; r = await x.sc.test({ ...x.cfg, createDb: false }); assert.ok(!r.ok && /does not exist/.test(r.error));
    r = await x.sc.test({ ...x.cfg, createDb: true }); assert.ok(r.ok && r.willCreate);
    process.env.FAKE_SQL_MODE = 'nocreate'; r = await x.sc.test({ ...x.cfg, createDb: true }); assert.ok(!r.ok && /dbcreator/.test(r.error));
  } finally { x.done(); }
});

test('SNMP polling averages are copied to ne_poll with the device name (1.47)', async () => {
  const x = setup();
  try {
    x.store.db.exec('CREATE TABLE IF NOT EXISTS poll_avg (dev TEXT, k TEXT, inst TEXT, t INTEGER, avg REAL, min REAL, max REAL, n INTEGER)');
    x.store.db.prepare('INSERT INTO poll_avg VALUES (?,?,?,?,?,?,?,?)').run('d1', 'cpu', '', 1700000000000, 40.5, 30, 50, 5);
    x.cfg.copyPoll = true; await x.sc.tick();
    const c = x.calls(); const hit = c.find((q) => (q.after || []).some((a) => /ne_poll/.test(a)));
    assert.ok(hit, 'poll table loaded'); assert.equal(hit.rows, 1); assert.ok(c[0].before.some((q) => /ne_poll/.test(q)), 'table created');
    const n = c.length; await x.sc.tick(); assert.equal(x.calls().length, n, 'nothing new, nothing sent');
  } finally { x.done(); }
});
