'use strict';
const test = require('node:test'); const assert = require('node:assert');
const { viewColumns } = require('../src/trapcols');
const row = (o, v, sev = 5) => ({ id: 7, seq: 7, ts: Date.UTC(2026, 10, 1, 10, 0, 0), host: 'h1', srcIp: '10.0.0.1', severity: sev, message: 'x', vb: JSON.stringify({ o, n: 't', v }) });
test('export columns follow the view: recipes, lookups per vendor, hidden columns', () => {
  const view = { std: false, message: false, cols: [{ label: 'Number', field: '{number}' }, { label: 'Hidden', field: '{host}', hide: true },
    { label: 'Status', field: '{st}', map: '5=Critical; 4=Major\n@ 1.3.6.1.4.1.12148: 5=Clear' }, { label: 'Alarm', field: '{src} - {txt}' }] };
  const cols = viewColumns(view); assert.deepStrictEqual(cols.map((c) => c.label), ['Number', 'Status', 'Alarm']);
  const dell = row('1.3.6.1.4.1.674.1', [['st', '1.1', '5'], ['src', '1.2', 'ET1: 5/8'], ['txt', '1.3', 'LOS']]), other = row('1.3.6.1.4.1.12148.9', [['st', '1.1', '5']]);
  assert.deepStrictEqual(cols.map((c) => c.get(dell)), ['7', 'Critical', 'ET1: 5/8 - LOS']);
  assert.strictEqual(cols[1].get(other), 'Clear');
  const std = viewColumns({ cols: [], message: true }); assert.deepStrictEqual(std.map((c) => c.label), ['Date', 'Time', 'Device', 'Severity', 'Message']);
});
