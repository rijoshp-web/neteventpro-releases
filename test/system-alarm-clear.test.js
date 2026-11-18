'use strict';
const test = require('node:test'); const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const { AlarmStore } = require('../src/alarms');
test('alarms on the application\'s own health and silent-device messages clear when it reports them fixed', () => {
  const a = new AlarmStore({ db: new DatabaseSync(':memory:') }, null), rule = { id: 'r1', name: 'New rule1', actions: { alarm: true } };
  const m = (text, ip = 'neteventpro', host = 'NetEventPro') => ({ srcIp: ip, host, severity: 3, message: text, ts: Date.now() });
  a.raise(m('Health check failed: Processing delay. Longest pause in the last minute 2.1 s.'), rule);
  a.raise(m('Health check failed: Processing delay. Longest pause in the last minute 3.4 s.'), rule);
  a.raise(m('Health check failed: Polling keeps up. 100 of 200 devices are late.'), rule);
  a.raise(m('No messages from sw-01 (10.0.0.5) for 15+ minutes — last seen x', 'neteventpro', 'sw-01'), rule);
  a.raise(m('Health check failed: Processing delay. looks the same but comes from a device', '10.9.9.9', 'fake'), rule);   // a device cannot clear or fake the application's own alarms
  assert.strictEqual(a.open.size, 5);
  assert.strictEqual(a.clearSystem(['Health check failed: Processing delay.', 'Health check improved to a warning: Processing delay.']), 2);
  assert.strictEqual(a.open.size, 3);
  assert.strictEqual(a.clearSystem(['No messages from sw-01 ']), 1);
  assert.ok([...a.open.values()].some((r) => r.message.startsWith('Health check failed: Polling')));
  assert.ok([...a.open.values()].some((r) => r.src_ip === '10.9.9.9'));
  a.stop();
});
