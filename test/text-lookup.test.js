'use strict';
// 1.99.7 a reading set to "Text" whose value is a number (Eltek status "1") still gets its value meanings
const test = require('node:test'); const assert = require('node:assert/strict');
const { Polling } = require('../src/polling');

test('a numeric text value of a reading with value meanings is stored as a number and checked against the meanings', () => {
  const stored = [], checked = [];
  const self = { state: () => ({ last: new Map(), polls: 0 }), store_: (d, ts, rows) => stored.push(...rows), thresholds() {}, lookupAlarms: (d, rt, ts, rows) => checked.push(...rows), texts_() {}, event() {},
    lookupMetrics: () => new Map([['r1', { lookup: 'l1' }]]), noAnswer() {}, patchDevice() {} };
  Polling.prototype.apply.call(self, { id: 'd' }, { ok: true, ts: 1, readings: [{ k: 'r1', inst: '', s: '1' }, { k: 'r2', inst: '', s: '7' }, { k: 'r1', inst: 'x', s: 'Fault' }] });
  assert.deepEqual(checked, [{ k: 'r1', inst: '', v: 1 }]);
  assert.ok(stored.some((r) => r.k === 'r1' && r.v === 1)); assert.ok(!stored.some((r) => r.k === 'r2'));
});

// 1.99.8 a Text reading polled through a probe arrives (it was dropped on the server, so it never got a value)
test('text values sent by a probe are kept', () => {
  let got = null;
  const self = { devices: () => [{ id: 'd1', via: 'p1' }], apply: (d, res) => { got = res; } };
  Polling.prototype.ingestFromProbe.call(self, 'p1', [{ dev: 'd1', res: { ok: true, ts: Date.now(), readings: [{ k: 'r1', inst: '', s: '1' }, { k: 'r2', inst: '', v: 53.5 }, { k: 'r3', inst: '', v: 'x' }] } }], []);
  assert.deepEqual(got.readings, [{ k: 'r1', inst: '', s: '1' }, { k: 'r2', inst: '', v: 53.5 }]);
});
