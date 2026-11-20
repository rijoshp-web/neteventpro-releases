'use strict';
// 1.99.6 alarm notifications come from the Alarms section: raised -> 'raised' notice with the alarm's facts, cleared -> 'recovery'
// to the same profiles (and the escalation recipients), source "SNMP polling" for polling alarms, and the wait between alerts is per device
const test = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const { AlarmStore } = require('../src/alarms');
const { RuleEngine } = require('../src/rules');

const mk = () => { const told = []; const a = new AlarmStore({ db: new DatabaseSync(':memory:') }, { enqueueRecovery: () => told.push({ legacy: true }) }); a.notify = { dispatch: (ids, kind, ctx) => told.push({ ids, kind, o: ctx.o }) }; a.stop(); return { a, told }; };
const rule = { id: 'poll-t1', name: 'Battery low', actions: { alarm: true, profiles: ['ops'], clearText: ['/CLEARED:/'], alarmBy: '/^\\[([^\\]]*)\\]/' } };
const msg = (t, dev = 'rect1') => ({ ts: Date.now(), message: t, tags: ['poll', 'poll-t1'], severity: 2, host: dev, srcIp: '10.0.0.1', devKey: dev, source: 'syslog', poll: true });

test('a polling alarm is told when raised and when cleared, with source SNMP polling', () => {
  const { a, told } = mk();
  const row = a.raise(msg('[Battery] Battery voltage 44 V'), rule);
  assert.strictEqual(row.source, 'poll');
  assert.ok(a.tellRaised(row, ['ops']));
  assert.strictEqual(told[0].kind, 'raised'); assert.deepStrictEqual(told[0].ids, ['ops']); assert.strictEqual(told[0].o.source, 'poll'); assert.strictEqual(told[0].o.port.toLowerCase(), 'battery');
  a.clearBy('poll-t1', msg('[Battery] CLEARED: 53 V'), 'Battery low', rule.actions.alarmBy);
  assert.strictEqual(told[1].kind, 'recovery'); assert.deepStrictEqual(told[1].ids, ['ops']); assert.strictEqual(told[1].o.state, 'Cleared');
  assert.strictEqual(a.list({ state: 'cleared', source: 'poll' }).total, 1);
});
test('an escalated alarm tells the escalation profiles once when it clears, together with the raise profiles', () => {
  const { a, told } = mk();
  const row = a.raise(msg('[Battery] low'), { ...rule, actions: { ...rule.actions, alarmEscMin: 1, alarmEscProfiles: ['boss'] } }); a.tellRaised(row, ['ops']);
  a.escalate(Date.now() + 120000); assert.strictEqual(told.filter((x) => x.kind === 'escalation').length, 1); assert.ok(a.list({ state: 'escalated' }).total >= 1);
  a.clearBy('poll-t1', msg('[Battery] CLEARED'), 'x', rule.actions.alarmBy);
  const rec = told.filter((x) => x.kind === 'recovery'); assert.strictEqual(rec.length, 1); assert.deepStrictEqual(rec[0].ids.sort(), ['boss', 'ops']);
  assert.ok(!told.some((x) => x.legacy));
});
test('nobody told when raised = nothing when it clears', () => {
  const { a, told } = mk(); a.raise(msg('[B] low'), rule); a.clearBy('poll-t1', msg('[B] CLEARED'), 'x', rule.actions.alarmBy); assert.strictEqual(told.length, 0);
});
test('the wait between alerts of an alarm rule is per device: a second device is told at once', () => {
  const r = new RuleEngine(); r.load([{ ...rule, enabled: true, source: 'syslog', match: { tag: 'poll-t1' } }]);
  assert.strictEqual(r.apply(msg('[Battery] low', 'rect1')).notifs.length, 1);
  assert.strictEqual(r.apply(msg('[Battery] low', 'rect2')).notifs.length, 1);
  assert.strictEqual(r.apply(msg('[Battery] low again', 'rect1')).notifs.length, 0);   // same device within the wait
  assert.strictEqual(r.apply(msg('[Battery] CLEARED', 'rect1')).notifs.length, 0);     // the clear notice comes from the alarm, not the rule
});

// 1.99.11 a device in a maintenance window: no CLEARED notice and no escalation
test('maintenance window: the clear and the escalation are not sent', () => {
  const { a, told } = mk(); let maint = false; a.quiet = () => maint;
  const row = a.raise(msg('[Battery] low'), { ...rule, actions: { ...rule.actions, alarmEscMin: 1, alarmEscProfiles: ['boss'] } }); a.tellRaised(row, ['ops']);
  maint = true; a.escalate(Date.now() + 120000); assert.equal(told.filter((x) => x.kind === 'escalation').length, 0);
  a.clearBy('poll-t1', msg('[Battery] CLEARED'), 'x', rule.actions.alarmBy); assert.equal(told.filter((x) => x.kind === 'recovery').length, 0);
  assert.equal(told.length, 1, 'only the raise, before the window');
});
