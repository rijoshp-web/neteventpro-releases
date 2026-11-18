'use strict';
const test = require('node:test'); const assert = require('node:assert');
require('../src/polling');               // the readings mixin attaches cleanPollSpec when polling loads it (as in the server)
const { cleanPollSpec } = require('../src/readings');
test('polling tile: the new looks and settings are kept, anything else is dropped', () => {
  for (const v of ['gauges', 'spark', 'summary', 'donut', 'table', 'line']) assert.strictEqual(cleanPollSpec({ view: v }).view, v);
  assert.strictEqual(cleanPollSpec({ view: '<script>' }).view, 'table');
  const c = cleanPollSpec({ src: 'readings', view: 'spark', sort: 'high', limit: '12', dec: 2, fill: true, compact: true, legend: false });
  assert.deepStrictEqual([c.sort, c.limit, c.dec, c.fill, c.compact, c.legend], ['high', 12, 2, true, true, false]);
  const bad = cleanPollSpec({ sort: 'drop table', limit: 99999, dec: 9, fill: 'yes', compact: 1 });
  assert.strictEqual(bad.sort, undefined); assert.strictEqual(bad.limit, 200); assert.strictEqual(bad.dec, 4); assert.strictEqual(bad.fill, undefined); assert.strictEqual(bad.compact, undefined);
  assert.strictEqual(cleanPollSpec({ limit: 0 }).limit, undefined);
});
