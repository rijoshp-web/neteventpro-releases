'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { tagMessage } = require('../src/vendors');
const { buildWhere } = require('../src/query');
const dashq = require('../src/dashq');
const { RuleEngine } = require('../src/rules');
const { makeLiveFilter } = require('../src/engine');

const tags = (message, app = '', host = 'h', enabled) => { const m = { message, app, host, tags: [] }; tagMessage(m, enabled); return m.tags; };

test('vendor recognisers: Cisco link, config and login messages', () => {
  assert.deepEqual(tags('Interface GigabitEthernet1/0/1, changed state to down', '%LINK-3-UPDOWN'), ['cisco', 'link-down', 'if:Gi1/0/1']);
  assert.deepEqual(tags('Line protocol on Interface Vlan10, changed state to up', '%LINEPROTO-5-UPDOWN'), ['cisco', 'link-up', 'if:Vl10']);
  assert.deepEqual(tags('Configured from console by admin', '%SYS-5-CONFIG_I'), ['cisco', 'config-change']);
  assert.ok(tags('Login failed [user: admin]', '%SEC_LOGIN-4-LOGIN_FAILED').includes('login-failed'));
  assert.ok(tags('Process 1, Nbr 10.0.0.2 on Gi0/1 from FULL to DOWN, Neighbor Down', '%OSPF-5-ADJCHG').includes('routing-neighbor-down'));
});
test('vendor recognisers: Dell, HP, APC and Eltek', () => {
  assert.deepEqual(tags('The power supply 2 is not working. iDRAC', 'PSU0003'), ['dell', 'power-supply', 'code:PSU0003']);
  assert.deepEqual(tags('port 12 is now off-line', ''), ['hp', 'link-down', 'if:12']);
  assert.deepEqual(tags('On battery power in response to utility power failure.', 'UPS'), ['apc', 'on-battery']);
  assert.deepEqual(tags('Returned from battery power.', 'UPS'), ['apc', 'power-restored']);
  assert.deepEqual(tags('Mains failure', 'Smartpack'), ['eltek', 'mains-failure']);
});
test('vendor recognisers: ordinary messages get no tags, and an APC message is not mistaken for Eltek', () => {
  assert.deepEqual(tags('User admin logged in from 10.1.1.5', 'sshd'), []);
  assert.deepEqual(tags('On battery power in response to utility power failure.', 'UPS', 'h', { apc: false }), []);
  assert.deepEqual(tags('Battery low', 'laptop'), []);
});
test('vendor recognisers: a family can be switched off and at most 4 tags are added', () => {
  assert.deepEqual(tags('Interface Gi1/0/1, changed state to down', '%LINK-3-UPDOWN', 'h', { cisco: false }), []);
  const m = { message: 'x', app: '', host: 'h', tags: ['a', 'b', 'c'] }; tagMessage(m, {}); assert.equal(m.tags.length, 3);
});
test('tag words in the search syntax become bound parameters', () => {
  const w = buildWhere({ text: 'tag:link-down -tag:x foo', severityMin: 4, tag: 'a_b' });
  assert.ok(w.args.includes('%,link-down,%') && w.args.includes('%,x,%') && w.args.includes('%,a\\_b,%') && w.sql.includes('severity IN (4,5,6,7,9)'));
  assert.ok(!/link-down/.test(w.sql), 'the user text is never put into the SQL');
});
test('rules can match a tag; the live filter understands tag: words', () => {
  const re = new RuleEngine(); re.load([{ id: 'a', enabled: true, match: { tag: 'Link-Down' }, actions: { tag: 'seen' } }]);
  const m = { severity: 5, facility: 1, host: 'h', srcIp: '1.1.1.1', app: '', message: 'x', tags: ['cisco', 'link-down'] }; re.apply(m); assert.ok(m.tags.includes('seen'));
  const n = { severity: 5, facility: 1, host: 'h', srcIp: '1.1.1.1', app: '', message: 'x', tags: ['cisco'] }; re.apply(n); assert.ok(!n.tags.includes('seen'));
  const f = makeLiveFilter({ text: 'tag:link-down' }); assert.equal(f(m), true); assert.equal(f(n), false);
  assert.equal(makeLiveFilter({ text: '-tag:cisco' })(n), false);
});

function seedDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE logs (id INTEGER PRIMARY KEY, ts INTEGER, dev_ts INTEGER, src_ip TEXT, host TEXT, facility INTEGER, severity INTEGER, app TEXT, pid TEXT, msgid TEXT, message TEXT, tags TEXT, color TEXT, raw TEXT, source TEXT NOT NULL DEFAULT \'syslog\', vb TEXT NOT NULL DEFAULT \'\', seq INTEGER NOT NULL DEFAULT 0)');
  const ins = db.prepare('INSERT INTO logs (ts, src_ip, host, facility, severity, app, message, tags) VALUES (?,?,?,?,?,?,?,?)');
  const now = Date.now(); const H = 3600000;
  for (let i = 0; i < 20; i++) ins.run(now - H + i * 60000, '1.1.1.1', 'sw1', 1, i % 4 === 0 ? 3 : 6, 'link', 'msg ' + i, i % 5 === 0 ? 'cisco,link-down' : '');      // last hour
  for (let i = 0; i < 10; i++) ins.run(now - 2 * H + i * 1000, '2.2.2.2', 'sw2', 1, 4, '', 'old ' + i, '');                                                  // the hour before
  return { db, now, H };
}
test('dashboard numbers: counts, previous period, distinct devices', () => {
  const { db, now, H } = seedDb();
  const r = dashq.run(db, { from: now - H - 1000, to: now, tiles: [{ id: 'a', kind: 'count', prev: true }, { id: 'b', kind: 'count', filter: { severityMax: 3 } }, { id: 'c', kind: 'distinct' }, { id: 'd', kind: 'count', filter: { tag: 'link-down' } }, { id: 'e', kind: 'count', filter: { text: 'tag:link-down' } }, { id: 'f', kind: 'count', filter: { severityMin: 4, severityMax: 4 } }] });
  assert.equal(r.tiles.a.n, 20); assert.equal(r.tiles.a.prev, 10); assert.equal(r.tiles.b.n, 5); assert.equal(r.tiles.c.n, 1); assert.equal(r.tiles.d.n, 4); assert.equal(r.tiles.e.n, 4); assert.equal(r.tiles.f.n, 0);
});
test('dashboard numbers: series, top lists and latest rows', () => {
  const { db, now, H } = seedDb();
  const r = dashq.run(db, { from: now - 2 * H, to: now, tiles: [{ id: 's', kind: 'series' }, { id: 'h', kind: 'top', by: 'host', n: 5 }, { id: 'p', kind: 'top', by: 'app' }, { id: 'v', kind: 'top', by: 'severity' }, { id: 'l', kind: 'list', n: 3 }] });
  const total = r.tiles.s.series.reduce((n, a) => n + a.reduce((x, y) => x + y, 0), 0); assert.equal(total, 30); assert.equal(r.tiles.s.series.length, r.buckets);
  assert.deepEqual(r.tiles.h.rows.map((x) => [x.key, x.n]), [['sw1', 20], ['sw2', 10]]);
  assert.deepEqual(r.tiles.p.rows.map((x) => x.key), ['link'], 'rows without a process are left out');
  assert.equal(r.tiles.v.rows.length, 3); assert.equal(r.tiles.l.rows.length, 3); assert.ok(r.tiles.l.rows[0].id > r.tiles.l.rows[1].id);
});
test('dashboard numbers: hostile input stays data, sizes are capped, bad kinds are reported', () => {
  const { db, now, H } = seedDb();
  const r = dashq.run(db, { from: now - H, to: now, tiles: [{ id: 'x', kind: 'count', filter: { text: "'); DROP TABLE logs;--", host: "a' OR '1'='1" } }, { id: 'y', kind: 'top', by: 'host); DROP TABLE logs;--', n: 99999 }, { id: 'z', kind: 'nonsense' }] });
  assert.equal(r.tiles.x.n, 0); assert.ok(r.tiles.y.rows.length <= 25); assert.ok(r.tiles.z.error);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM logs').get().n, 30, 'the table is intact');
});
test('dashboard buckets: about 96 bars at most, aligned to the clock', () => {
  assert.equal(dashq.bucketFor(0, 3600000), 60000); assert.equal(dashq.bucketFor(0, 86400000), 900000); assert.equal(dashq.bucketFor(0, 30 * 86400000), 43200000);
  for (const span of [900000, 3600000, 21600000, 86400000, 604800000, 2592000000]) assert.ok(span / dashq.bucketFor(0, span) <= 96.01);
});

test('tiles count syslog only unless a source is chosen (traps have their own tiles)', () => {
  const { db, now } = seedDb();
  db.prepare("INSERT INTO logs (ts, src_ip, host, facility, severity, app, msgid, message, tags, source) VALUES (?,?,?,?,?,?,?,?,?,?)").run(now - 1000, '3.3.3.3', '3.3.3.3', 23, 3, 'snmptrap', 'linkDown', 'IF-MIB::linkDown', 'snmp', 'snmp');
  const t = (filter) => dashq.run(db, { from: now - 3 * 3600000, to: now, tiles: [{ id: 'a', kind: 'count', filter }, { id: 'b', kind: 'top', by: 'msgid', n: 5, filter }] }).tiles;
  assert.equal(t({}).a.n, 30); assert.equal(t({ source: 'snmp' }).a.n, 1); assert.equal(t({ source: 'all' }).a.n, 31);
  assert.deepEqual(t({ source: 'snmp' }).b.rows.map((r) => [r.key, r.n]), [['linkDown', 1]]); assert.equal(t({}).b.rows.length, 0);
});
