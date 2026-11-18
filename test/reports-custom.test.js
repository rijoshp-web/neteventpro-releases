'use strict';
const test = require('node:test'); const assert = require('node:assert');
const { Reports } = require('../src/reports'); const BRAND = require('../src/brand'); const dt = require('../src/dashtiles');
test('polled devices table drops columns nobody reports', () => {
  const r = Object.create(Reports.prototype);
  const t = r.pollTable([{ name: 'a', host: '1.1.1.1', site: '', polls: 5, availability: 100, cpuAvg: 12.34, cpuMax: 40, memAvg: null, memMax: null, tempAvg: null, tempMax: null, rttAvg: 3, alarms: 0 }]);
  assert.ok(t.head.includes('CPU avg %')); assert.ok(!t.head.includes('Temp max C')); assert.ok(!t.head.includes('Site')); assert.strictEqual(t.rows[0][t.head.indexOf('CPU avg %')], 12.3);
});
test('dashboard figures follow the chosen dashboard', async () => {
  const prefs = { dash: { tiles: [{ id: 'a', type: 'kpi', title: 'Errors', cfg: { metric: 'errors' } }] }, dashboards: [{ id: 'd2', name: 'NOC', dash: { tiles: [{ id: 'b', type: 'top', cfg: { by: 'host', n: 3 } }] } }] };
  const seen = []; const fn = async (b) => { seen.push(b.tiles[0].id); return { tiles: { a: { n: 7 }, b: { rows: [{ key: 'sw1', n: 2 }] } } }; };
  assert.deepStrictEqual((await dt.run(prefs, '', 0, 1, fn)).rows, [['Errors', '', 7]]);
  assert.deepStrictEqual((await dt.run(prefs, 'd2', 0, 1, fn)).rows, [['Top host', 'sw1', 2]]);
  assert.deepStrictEqual(seen, ['a', 'b']);
});
test('company name and bad logo are cleaned', () => {
  let msg = ''; const c = BRAND.clean({ company: ' ACME\u0001 ', footer: 'x'.repeat(500), logo: 'data:text/html;base64,AAAA' }, (m) => { msg = m; });
  assert.strictEqual(c.company, 'ACME'); assert.ok(c.footer.length <= 200); assert.ok(msg.includes('JPEG'));
});
