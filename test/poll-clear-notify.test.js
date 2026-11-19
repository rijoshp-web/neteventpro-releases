'use strict';
// 1.99.5 an SNMP polling alarm tells its notification profiles when it is raised AND when it clears
const test = require('node:test');
const assert = require('node:assert');
const { RuleEngine } = require('../src/rules');

const rule = (extra) => ({ id: 'poll-t1', name: 'Battery low', enabled: true, source: 'syslog', match: { tag: 'poll-t1' }, actions: { alarm: true, profiles: ['ops'], clearText: ['/CLEARED:/'], ...extra } });
const msg = (t) => ({ message: t, tags: ['poll', 'poll-t1'], severity: 3, host: 'rect', srcIp: '10.0.0.1', devKey: 'rect', source: 'syslog' });

test('a polling alarm notifies on raise and on clear', () => {
  const r = new RuleEngine(); r.load([rule({ notifyClear: true })]);
  assert.strictEqual(r.apply(msg('[Battery low] Battery voltage 44 V')).notifs.length, 1);
  const c = r.apply(msg('[Battery low] CLEARED: Battery voltage 53 V'));
  assert.strictEqual(c.clears.length, 1); assert.strictEqual(c.notifs.length, 1); assert.deepStrictEqual(c.notifs[0].profiles, ['ops']);
});
test('no clear notice in a maintenance window, nor for rules without notifyClear', () => {
  const r = new RuleEngine(); r.load([rule({ notifyClear: true })]);
  assert.strictEqual(r.apply(msg('CLEARED: x'), true).notifs.length, 0);
  const r2 = new RuleEngine(); r2.load([rule({})]);
  assert.strictEqual(r2.apply(msg('CLEARED: x')).notifs.length, 0);
});
test('polling builds its rules with notifyClear', () => {
  const src = require('node:fs').readFileSync(require.resolve('../src/polling'), 'utf8');
  assert.match(src, /alarm: true, notifyClear: true/);
});
