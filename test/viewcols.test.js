'use strict';
const test = require('node:test'); const assert = require('node:assert');
const VC = require('../src/viewcols');
const row = { id: 7, ts: Date.UTC(2026, 10, 5, 8, 9, 10, 123), host: 'sw1', srcIp: '10.0.0.1', app: 'sshd', pid: '9', facility: 4, severity: 3, msgid: 'linkDown', message: 'hello', vb: JSON.stringify({ ver: 'v2c' }) };
test('exports use the columns of the window: saved order, hidden ones left out, message always there', () => {
  const prefs = { columns: { logs: [{ id: 'host', visible: true }, { id: 'date', visible: false }, { id: 'severity', visible: true }, { id: 'message', visible: false }, { id: 'ip', visible: true }] } };
  const c = VC.logColumns(prefs, 'logs'); assert.deepStrictEqual(c.map((x) => x.label), ['Device', 'Severity', 'Message', 'Source IP']);
  assert.deepStrictEqual(c.map((x) => x.get(row)), ['sw1', 'Error', 'hello', '10.0.0.1']);
  assert.deepStrictEqual(VC.logColumns({}, 'logs').map((x) => x.label), ['Date', 'Time', 'Device', 'Process', 'Severity', 'Message']);
  assert.deepStrictEqual(VC.logColumns({}, 'traps').map((x) => x.label), ['Date', 'Time', 'Device', 'Severity', 'SNMP', 'Trap', 'Message']);
  assert.strictEqual(VC.logColumns({}, 'traps').find((x) => x.label === 'SNMP').get(row), 'v2c');
});
test('alarm columns: active list leaves out cleared-only columns; PDF widths fit the page', () => {
  assert.ok(!VC.alarmColumns({}, false).some((c) => c.label === 'Cleared'));
  assert.ok(VC.alarmColumns({}, true).some((c) => c.label === 'Cleared by'));
  for (const cols of [VC.logColumns({}, 'traps'), VC.alarmColumns({}, true)]) { const w = VC.pdfWidths(cols, 770); assert.ok(w.reduce((a, b) => a + b + 4, 0) <= 790 && w.every((x) => x >= 24)); }
});
