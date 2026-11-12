'use strict';
// Replays real DNWP Connection Master syslog (test/fixtures/connection-master.json, oldest first) through the rule engine and the alarm store.
const test = require('node:test'); const assert = require('node:assert'); const { DatabaseSync } = require('node:sqlite');
const { AlarmStore } = require('../src/alarms'); const { RuleEngine } = require('../src/rules');
const rows = require('./fixtures/connection-master.json');

// the same three rules as the "DNWP Connection Master" templates in the dashboard
const RULES = [
  { id: 'cm1', name: 'CM port and card alarms', enabled: true, source: 'syslog', match: { textAny: ['/Alarm: .*\\bSet:/', '/Unit Missing\\s*$/'] },
    actions: { alarm: true, alarmBy: 'port', clearText: ['/Status:\\s*(No alarms|All disabled)/i', '/Unit Missing Cleared/'], sevMap: [{ text: '/Status:\\s*Critical/', severity: 2 }, { text: '/Status:\\s*Major/', severity: 3 }, { text: '/Status:\\s*Minor/', severity: 4 }] } },
  { id: 'cm2', name: 'CM protection and clock switches', enabled: true, source: 'syslog', match: { textAny: ['Path protection switched', 'SDH clock switched'] },
    actions: { alarm: true, alarmBy: 'port', clearText: ['/Reason:\\s*(No Request|Revert)/i'] } },
  { id: 'cm3', name: 'CM unit removed', enabled: true, source: 'syslog', match: { textAny: ['removed from unit slot'] }, actions: { alarm: true, alarmBy: 'port', clearText: ['inserted in unit slot'] } }
];
function replay(list = rows) {
  const a = new AlarmStore({ db: new DatabaseSync(':memory:') }, { enqueue() {} }); a.stop(); const eng = new RuleEngine(); eng.load(RULES); let t = Date.now() - 1e6;
  for (const r of list) {
    const m = { ts: (t += 1000), host: r.host, srcIp: r.srcIp, devKey: r.host, severity: r.severity, facility: 16, message: r.message, source: 'syslog', tags: [] };
    const o = eng.apply(m); for (const c of o.clears) a.clearBy(c.id, m, c.by, c.alarmBy); for (const rule of o.alarms) a.raise(m, rule);
  }
  return a;
}
// independent reference: last word on each device + card/port + type
function reference() {
  const state = new Map();
  for (const r of rows) {
    const m = /Alarm: (\d+\/\d+ [^:]+?):\s+(.*)$/.exec(r.message); if (!m) continue;
    state.set(r.host + '|' + m[1].toLowerCase().replace(/\s+/g, ''), /Status: (No alarms|All disabled)/.test(m[2]) ? 'clear' : /\bSet:/.test(m[2]) ? 'open' : (state.get(r.host + '|' + m[1].toLowerCase().replace(/\s+/g, '')) || 'clear'));
  }
  return [...state].filter(([, v]) => v === 'open').map(([k]) => k).sort();
}
test('every card/port is its own alarm and the open ones match the last message of each port', () => {
  const a = replay(); const open = a.list({ state: 'active', limit: 500 }).alarms.filter((x) => x.ruleId === 'cm1');
  assert.deepStrictEqual(open.map((x) => x.device + '|' + x.port).sort(), reference(), 'same open ports as a plain reading of the log');
  const all = a.list({ state: 'all', limit: 500 }).alarms.filter((x) => x.ruleId === 'cm1'); assert.ok(all.length > 10, 'many different ports raised');
  assert.ok(new Set(all.map((x) => x.device + '|' + x.port)).size >= 8);
});
test('two ports of one card: clearing one leaves the other open', () => {
  const l = [{ host: '10.203.242.22', srcIp: '10.30.2.1', severity: 5, message: ': Alarm: 5/8 E1: Set: Major=LOS. Status: Major=LOS' }, { host: '10.203.242.22', srcIp: '10.30.2.1', severity: 5, message: ': Alarm: 5/1 E1: Set: Major=LOS. Status: Major=LOS' },
    { host: '10.203.242.22', srcIp: '10.30.2.1', severity: 5, message: ': Alarm: 5/8 E1:  Cleared: Major=LOS. Status: No alarms' }];
  const a = replay(l); const act = a.list({ state: 'active' }).alarms; assert.strictEqual(act.length, 1); assert.strictEqual(act[0].port, '5/1e1'); assert.strictEqual(act[0].severity, 3, 'Major = Error');
});
test('a changed fault on the same port is its own alarm line', () => {
  const l = [{ host: 'h', srcIp: '1.1.1.1', severity: 5, message: ': Alarm: 7/2 E1: Set: Major=LOS. Status: Major=LOS' }, { host: 'h', srcIp: '1.1.1.1', severity: 5, message: ': Alarm: 7/2 E1: Set: Major=LOF. Cleared: Major=LOS. Status: Major=LOF' }];
  const a = replay(l); const act = a.list({ state: 'active' }).alarms; assert.strictEqual(act.length, 2); assert.ok(act.every((x) => x.count === 1)); assert.ok(act.some((x) => /LOF/.test(x.message)));
});
test('all the fixture message kinds are handled without error and the textAny/clearText fields work', () => {
  const eng = new RuleEngine(); eng.load(RULES); const o = eng.apply({ host: 'h', srcIp: '1.1.1.1', severity: 5, facility: 16, message: ': User: admin@10.1.1.1 logged in', source: 'syslog', tags: [] });
  assert.strictEqual(o.alarms.length, 0); assert.strictEqual(o.clears.length, 0);
  const p = eng.apply({ host: 'h', srcIp: '1.1.1.1', severity: 5, facility: 16, message: ': Alarm: 5/1 SDH LP[1-1-1-1]: Cleared: Major=AIS. Status: No alarms', source: 'syslog', tags: [] }); assert.deepStrictEqual(p.clears.map((c) => c.id), ['cm1']);
});
