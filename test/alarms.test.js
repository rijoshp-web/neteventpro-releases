'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const { AlarmStore, instanceOf } = require('../src/alarms');
const { Maintenance, windowActive } = require('../src/maintenance');
const { RuleEngine } = require('../src/rules');

const mk = () => { const sent = []; const a = new AlarmStore({ db: new DatabaseSync(':memory:') }, { enqueue: (info, msg) => sent.push({ info, msg }), enqueueEscalation: (info, o) => sent.push({ info, o }), enqueueRecovery: (info, o) => sent.push({ info, o, recovery: true }) }); a.stop(); return { a, sent }; };
const msg = (over = {}) => ({ id: 1, ts: Date.now(), host: 'sw1', devKey: 'sw1', srcIp: '10.0.0.1', severity: 3, message: 'link down', ...over });
const rule = { id: 'down', name: 'Link down', actions: { alarm: true } };

test('every message is its own alarm line (no merging, no repeat counter)', () => {
  const { a } = mk();
  a.raise(msg(), rule); a.raise(msg({ severity: 2, message: 'again' }), rule); a.raise(msg({ host: 'sw2', devKey: 'sw2' }), rule);
  const l = a.list({ state: 'active' }).alarms; assert.strictEqual(l.length, 3);
  assert.ok(l.every((x) => x.count === 1)); assert.strictEqual(l.filter((x) => x.device === 'sw1').length, 2); assert.ok(l.some((x) => x.message === 'again' && x.severity === 2));
});

test('acknowledge, notes, manual clear and auto-clear', () => {
  const { a } = mk(); const x = a.raise(msg(), rule), y = a.raise(msg({ devKey: 'sw2', host: 'sw2' }), rule);
  assert.strictEqual(a.ack([x.id, 9999], 'rijosh', 'on it'), 1);
  assert.strictEqual(a.ack([x.id], 'rijosh'), 0, 'only open alarms can be acknowledged');
  assert.strictEqual(a.list({ state: 'ack' }).alarms[0].notes[0].text, 'on it');
  a.clearBy('down', msg({ devKey: 'sw2' }), 'Link up'); assert.strictEqual(a.list({ state: 'cleared' }).alarms[0].clearedBy, 'auto: Link up');
  assert.strictEqual(a.clear([x.id], 'rijosh', 'fixed'), 1); assert.strictEqual(a.counts().open + a.counts().ack, 0);
  const again = a.raise(msg(), rule); assert.notStrictEqual(again.id, x.id, 'after clearing, a new problem is a new alarm');
});

test('escalation mails once, only for unacknowledged alarms', () => {
  const { a, sent } = mk(); const r = { id: 'e', name: 'Mains', actions: { alarm: true, alarmEscMin: 5, alarmEscTo: 'ops@example.com' } };
  const u = a.raise(msg({ ts: Date.now() - 6 * 60000 }), r); const v = a.raise(msg({ devKey: 'sw2', host: 'sw2', ts: Date.now() - 6 * 60000 }), r);
  a.ack([v.id], 'x'); a.escalate(); a.escalate();
  assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].info.to, 'ops@example.com'); assert.strictEqual(sent[0].info.report, true); assert.strictEqual(sent[0].o.host, 'sw1'); assert.match(sent[0].o.subtitle, /within 5 minutes/); assert.strictEqual(sent[0].o.sum.raised, 2); assert.strictEqual(u.esc_ts > 0, true);
});

test('an escalated alarm sends a recovery e-mail when it clears (by hand, by a clearing rule, automatically); others do not', () => {
  const { a, sent } = mk(); const r = { id: 'e', name: 'Mains', actions: { alarm: true, alarmEscMin: 5, alarmEscTo: 'ops@example.com' } }, old = Date.now() - 6 * 60000;
  const u = a.raise(msg({ ts: old }), r); a.escalate(); assert.strictEqual(sent.length, 1);
  a.clear([u.id], 'rijosh'); assert.strictEqual(sent.length, 2); assert.strictEqual(sent[1].recovery, true); assert.strictEqual(sent[1].info.to, 'ops@example.com'); assert.strictEqual(sent[1].o.host, 'sw1'); assert.match(sent[1].o.subtitle, /escalated and has now cleared after 6 min/); assert.strictEqual(sent[1].o.state, 'Cleared');
  a.clear([u.id], 'again'); assert.strictEqual(sent.length, 2, 'only once');
  const v = a.raise(msg({ devKey: 'sw2', host: 'sw2', ts: Date.now() }), r); a.clear([v.id], 'x'); assert.strictEqual(sent.length, 2, 'never escalated, so no recovery e-mail');
  const w = a.raise(msg({ devKey: 'sw3', host: 'sw3', ts: old }), r); a.escalate(); a.clearBy('e', msg({ devKey: 'sw3', host: 'sw3' }), 'Mains restored'); assert.strictEqual(sent.length, 4); assert.strictEqual(sent[3].recovery, true); assert.match(sent[3].o.subtitle, /automatically: Mains restored/);
  const off = { id: 'o', name: 'Quiet', actions: { alarm: true, alarmEscMin: 5, alarmEscClear: false } }, x = a.raise(msg({ devKey: 'sw4', host: 'sw4', ts: old }), off); a.escalate(); const n = sent.length; a.clear([x.id], 'x'); assert.strictEqual(sent.length, n, 'switched off for the rule');
});

test('search and severity filters; LIKE wildcards in the search are literal', () => {
  const { a } = mk(); a.raise(msg({ message: '100% full' }), rule); a.raise(msg({ devKey: 'sw2', host: 'sw2', severity: 6, message: 'fine' }), rule);
  assert.strictEqual(a.list({ q: '100%' }).alarms.length, 1); assert.strictEqual(a.list({ q: '%' }).alarms.length, 1);
  assert.strictEqual(a.list({ sevs: [6] }).alarms[0].device, 'sw2');
});

test('state survives a reload of the database table', () => {
  const db = new DatabaseSync(':memory:'); const a = new AlarmStore({ db }, null); a.raise(msg(), rule); a.flush(); a.stop();
  const b = new AlarmStore({ db }, null); b.stop(); assert.strictEqual(b.counts().open, 1);
});

test('rules: alarm and clear actions, and quiet mode', () => {
  const r = new RuleEngine(); r.load([{ id: 'down', name: 'down', match: { text: 'down' }, actions: { alarm: true, sound: true, email: true, color: '#ff0000' } }, { id: 'up', name: 'up', match: { text: 'up' }, actions: { clearsRule: 'down' } }]);
  const m = (t) => ({ severity: 3, facility: 1, host: 'h', srcIp: '1.1.1.1', app: '', message: t, tags: [] });
  let o = r.apply(m('port down')); assert.strictEqual(o.alarms.length, 1); assert.ok(o.sound); assert.strictEqual(o.emails.length, 1);
  o = r.apply(m('port down'), true); assert.strictEqual(o.alarms.length, 0, 'no alarm in maintenance'); assert.ok(!o.sound); assert.strictEqual(o.emails.length, 0);
  o = r.apply(m('port up'), true); assert.deepStrictEqual(o.clears, [{ id: 'down', by: 'up', alarmBy: '' }], 'clearing still works in maintenance');
});

test('maintenance schedules', () => {
  const at = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi).getTime();   // local time, like the server
  const wed = (h, mi) => at(2026, 9, 28, h, mi), thu = (h, mi) => at(2026, 9, 29, h, mi);   // 28 Oct 2026 is a Wednesday
  const night = { schedule: { type: 'weekly', days: [3], start: '22:00', end: '02:00' } };
  assert.ok(windowActive(night, wed(23, 0))); assert.ok(windowActive(night, thu(1, 30))); assert.ok(!windowActive(night, thu(2, 0))); assert.ok(!windowActive(night, wed(21, 59)));
  assert.ok(!windowActive({ ...night, enabled: false }, wed(23, 0)));
  const day = { schedule: { type: 'weekly', days: [3], start: '08:00', end: '09:00' } }; assert.ok(windowActive(day, wed(8, 30))); assert.ok(!windowActive(day, thu(8, 30)));
  const once = { schedule: { type: 'once', from: 1000, to: 2000 } }; assert.ok(windowActive(once, 1500)); assert.ok(!windowActive(once, 2000));
});

test('maintenance device matching: exact, wildcard, address, empty = all', () => {
  const cfg = { get: () => ({ maintenance: [{ id: 'a', enabled: true, devices: 'SW-DXB-*, 10.0.0.9, core1', schedule: { type: 'once', from: 0, to: 9e15 } }, { id: 'b', enabled: true, devices: '', schedule: { type: 'once', from: 5, to: 6 } }] }), onChange() {} };
  const m = new Maintenance(cfg);
  assert.strictEqual(m.forDevice(['sw-dxb-01'])?.id, 'a'); assert.strictEqual(m.forDevice(['x', '10.0.0.9'])?.id, 'a'); assert.strictEqual(m.forDevice(['CORE1'])?.id, 'a');
  assert.strictEqual(m.forDevice(['sw-auh-01']), null); assert.strictEqual(m.forDevice(['anything'], 5)?.id, 'b');
});

test('one alarm per port: 50 link-downs are 50 alarms and a link-up clears only its own port', () => {
  const { a } = mk(); const r = { id: 'down', name: 'Link down', actions: { alarm: true, alarmBy: 'port' } };
  for (let i = 1; i <= 50; i++) a.raise(msg({ message: `%LINK-3-UPDOWN: Interface GigabitEthernet1/0/${i}, changed state to down` }), r);
  assert.strictEqual(a.counts().open, 50);
  a.raise(msg({ message: '%LINK-3-UPDOWN: Interface GigabitEthernet1/0/7, changed state to down' }), r); assert.strictEqual(a.counts().open, 51, 'a repeat on the same port is another line');
  for (let i = 1; i <= 12; i++) a.clearBy('down', msg({ message: `%LINK-3-UPDOWN: Interface Gi1/0/${i}, changed state to up` }), 'Link up', 'port');
  assert.strictEqual(a.counts().open, 38, '12 ports came back (Gi1/0/7 had two lines, both clear), 38 stay open');
  assert.strictEqual(a.list({ state: 'cleared' }).alarms.length, 13);
  a.clearBy('down', msg({ message: 'whole device recovered' }), 'Device ok', '');   // no port named: every alarm of the rule on that device
  assert.strictEqual(a.counts().open, 0);
});

test('port names: Cisco, trap values, HP and your own pattern', () => {
  assert.strictEqual(instanceOf({ message: 'Line protocol on Interface GigabitEthernet1/0/24, changed state to down' }, 'port'), 'gi1/0/24');
  // card/port style names (DNWP Connection Master): card/port plus the port type is the key, so an E1, an SFP and an LP of one card are different alarms
  for (const [msg, want] of [[': Alarm: 5/8 E1: Set: Major=LOS. Status: Major=LOS', '5/8e1'], [': Alarm: 5/1 E1: Set: Major=LOS. Status: Major=LOS', '5/1e1'], [': Alarm: 13/1 E+M: Set: Major=AIS. Status: Major=AIS', '13/1e+m'],
    [': Alarm: 13/1 E&M: Set: Major=AIS', '13/1e&m'], [': Alarm: 13/1 E$M: Set: Major=AIS', '13/1e$m'], [': Alarm: 7/3 ETH: Set: Major=LOS', '7/3eth'], [': Alarm: 5/8 E1: Clear: Normal', '5/8e1'], [': Alarm: 5/8 E1:  Cleared: Major=LOS. Status: No alarms', '5/8e1'],
    [': Alarm: 3/1 SDH LP[1-1-1-1]: Set: Major=AIS', '3/1sdhlp[1-1-1-1]'], [': Alarm: 3/1 SDH SFP: Set: Minor=SFP-RxPower', '3/1sdhsfp'], [': Alarm: Path protection switched to 3/2 SDH LP[1-2-1-1] - Reason: SF Low Priority', '3/2sdhlp[1-2-1-1]'],
    [': Alarm: 16 x FXS - Slot 6, Unit Missing', 'slot6'], [': Unit: 16 x FXS removed from unit slot 6', 'slot6'], [': Alarm: 1 POWER (BITS):  Status: No alarms', '1power(bits)'], ['Alarm: 2/4/1 V.35: Set', '2/4/1v.35']]) assert.strictEqual(instanceOf({ message: msg }, 'port'), want, msg);
  assert.notStrictEqual(instanceOf({ message: ': Alarm: 5/8 E1: Set' }, 'port'), instanceOf({ message: ': Alarm: 5/1 E1: Set' }, 'port'));
  assert.notStrictEqual(instanceOf({ message: ': Alarm: 3/1 SDH SFP: Set' }, 'port'), instanceOf({ message: ': Alarm: 3/1 SDH RS: Set' }, 'port'));
  assert.strictEqual(instanceOf({ message: 'Backup finished 12:44 ok' }, 'port'), '');
  assert.strictEqual(instanceOf({ message: 'IF-MIB::linkDown: ifIndex.7 = 7, ifDescr.7 = Fa0/7 [agent 10.0.0.9]' }, 'port'), 'fa0/7');
  assert.strictEqual(instanceOf({ message: 'linkUp: ifIndex.12 = 12' }, 'port'), 'ifindex12');
  assert.strictEqual(instanceOf({ message: 'port 24 is now on-line' }, 'port'), 'port24');
  assert.strictEqual(instanceOf({ message: 'Power plant failed' }, 'port'), '');
  assert.strictEqual(instanceOf({ message: 'Slot 3 failed' }, '/slot (\\d+)/i'), '3');
  assert.strictEqual(instanceOf({ message: 'x' }, '/(a+)+$/'), '', 'risky patterns never run');
  assert.strictEqual(instanceOf({ message: 'anything' }, ''), '');
});

test('the 24-hour report can be switched off per rule, and the setting follows the rule', () => {
  const { a, sent } = mk(); const r = { id: 'e', name: 'Mains', actions: { alarm: true, alarmEscMin: 5, alarmEscReport: false } };
  a.raise(msg({ ts: Date.now() - 6 * 60000 }), r); a.escalate();
  assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].info.report, false);
});

test('alarms can be sorted by any column, both ways; unknown sort words fall back safely', () => {
  const { a } = mk(); const t = Date.now();
  a.raise(msg({ devKey: 'b', host: 'bravo', ts: t - 3000, severity: 3 }), { id: 'x', name: 'Zeta', actions: { alarm: true } });
  a.raise(msg({ devKey: 'a', host: 'alpha', ts: t - 2000, severity: 2 }), { id: 'y', name: 'Alpha rule', actions: { alarm: true } });
  a.raise(msg({ devKey: 'c', host: 'Charlie', ts: t - 1000, severity: 5 }), { id: 'z', name: 'Mid', actions: { alarm: true } });
  const hosts = (sort) => a.list({ sort }).alarms.map((x) => x.host);
  assert.deepStrictEqual(hosts('device:asc'), ['alpha', 'bravo', 'Charlie']); assert.deepStrictEqual(hosts('device:desc'), ['Charlie', 'bravo', 'alpha']);
  assert.deepStrictEqual(hosts('raised:desc'), ['Charlie', 'alpha', 'bravo']); assert.deepStrictEqual(hosts('raised:asc'), ['bravo', 'alpha', 'Charlie']);
  assert.deepStrictEqual(hosts('alarm:asc'), ['alpha', 'Charlie', 'bravo']); assert.deepStrictEqual(hosts('severity:asc'), ['alpha', 'bravo', 'Charlie']);
  assert.strictEqual(a.list({ sort: 'raised:desc; DROP TABLE alarms' }).alarms.length, 3); assert.strictEqual(a.list({ sort: 'nonsense:asc' }).alarms.length, 3);
  assert.ok(a.list({ sort: 'duration:desc' }).alarms.length === 3 && a.list({ sort: 'state:asc' }).alarms.length === 3 && a.list({ sort: 'by:desc' }).alarms.length === 3);
});

test('cleared alarms are kept for ever unless a retention is set (no hidden 90-day purge)', () => {
  const { a } = mk(); const old = Date.now() - 400 * 86400000;
  const r = a.raise(msg({ ts: old }), rule); a.clear([r.id], 'x'); a.db.prepare('UPDATE alarms SET cleared_ts = ? WHERE id = ?').run(old + 1000, r.id);
  assert.strictEqual(a.prune(0), 0); assert.strictEqual(a.list({ state: 'cleared', since: 0 }).total, 1);
  assert.strictEqual(a.prune(365), 1); assert.strictEqual(a.list({ state: 'cleared', since: 0 }).total, 0);
});

test('flap detection: one flapping alarm, quiet until it settles, then it clears itself', () => {
  const { a } = mk(); const r = { id: 'ld', name: 'Link down', actions: { alarm: true, alarmBy: 'port', flapCount: 3, flapMin: 10, flapQuiet: 5 } };
  const m = (t, text = 'Interface Gi0/1 changed state to down') => msg({ ts: t, message: text });
  const t0 = Date.now();
  assert.strictEqual(a.flapEvent(m(t0), r), false); a.raise(m(t0), r);
  a.flapClearEvent('ld', m(t0 + 1000, 'Interface Gi0/1 changed state to up'), 'port');          // a link-up counts as a change
  assert.strictEqual(a.flapEvent(m(t0 + 2000), r), 'start');
  const row = a.flapRaise(m(t0 + 2000), r, true);
  assert.match(row.rule_name, /\(flapping\)$/);
  assert.strictEqual(a.flapEvent(m(t0 + 3000), r), true, 'held back while flapping');
  a.flapRaise(m(t0 + 3000), r, false); assert.ok(a.byId(row.id).count >= 2);
  a.clearBy('ld', m(t0 + 4000, 'Interface Gi0/1 changed state to up'), 'Link up', 'port');
  assert.strictEqual(a.byId(row.id).state, 'open', 'a link-up does not clear a flapping alarm');
  a.flapSweep(t0 + 4 * 60000); assert.strictEqual(a.byId(row.id).state, 'open');
  a.flapSweep(t0 + 10 * 60000); assert.strictEqual(a.byId(row.id).state, 'cleared'); assert.match(a.byId(row.id).cleared_by, /flapping stopped/);
  assert.strictEqual(a.flapEvent(m(t0 + 11 * 60000), r), false, 'counting starts again');
  assert.strictEqual(a.flapEvent(msg({ ts: t0, devKey: 'other', host: 'other', message: 'x' }), r), false, 'other devices are counted apart');
});
