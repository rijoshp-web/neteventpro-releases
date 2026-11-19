'use strict';
// 1.99.2 polled readings as a dashboard data source: number, ranking, series and list, readings combined by name and unit
const test = require('node:test'); const assert = require('node:assert/strict');
const Q = require('../src/pollq');

function fakePolling() {
  const rt = new Map([
    ['a', { last: new Map([['r1|', { v: 54.2, ts: 1 }], ['t1|1', { v: 21, ts: 1 }], ['t1|2', { v: 24, ts: 1 }]]) }],
    ['b', { last: new Map([['r2|', { v: 53.0, ts: 2 }], ['t2|1', { v: 30, ts: 2 }], ['x|', { v: 'text', ts: 2 }]]) }]
  ]);
  const own = { V: ['r1', 'r2'], T: ['t1', 't2'] };
  return {
    rt, devices: () => [{ id: 'a', name: 'Rect A' }, { id: 'b', name: 'Rect B' }, { id: 'c', name: 'Never polled' }],
    keysOf: (k) => (k === 'L:Battery voltage|V' ? own.V : k === 'L:Temperature|°C' ? own.T : [k]),
    metricInfo: (k) => (k.startsWith('L:') ? { label: k.slice(2).split('|')[0], unit: k.split('|')[1] } : { label: k, unit: '' }),
    series: (dev, k, inst, from) => [{ t: from + 60000, v: dev === 'a' ? 54 : 53 }, { t: from + 180000, v: dev === 'a' ? 54.4 : 53.2 }]
  };
}
const ctx = { bucketMs: 60000, firstBucket: 1000, buckets: 10 };
const req = (o) => ({ ...Q.clean({ ...o }), kind: o.kind });

test('a number: readings with the same name on different devices are combined', () => {
  const p = fakePolling();
  const avg = Q.run(p, req({ kind: 'count', k: 'L:Battery voltage|V' }), ctx); assert.equal(avg.n, 53.6); assert.equal(avg.unit, 'V'); assert.equal(avg.of, 2);
  assert.equal(Q.run(p, req({ kind: 'count', k: 'L:Temperature|°C', pagg: 'max' }), ctx).n, 30);
  assert.equal(Q.run(p, req({ kind: 'count', k: 'L:Temperature|°C', pagg: 'count' }), ctx).n, 3);
  assert.equal(Q.run(p, req({ kind: 'count', k: 'L:Battery voltage|V', devs: ['b'] }), ctx).n, 53);
  assert.equal(Q.run(p, req({ kind: 'count', k: 'L:Temperature|°C', inst: '2' }), ctx).n, 24);
  assert.equal(Q.run(p, req({ kind: 'count', k: 'nothing' }), ctx).n, null, 'no value: empty, not 0');
  assert.match(Q.run(p, req({ kind: 'count', k: '' }), ctx).error, /Choose a reading/);
});

test('a ranking per device or per instance, text values left out', () => {
  const p = fakePolling();
  const perDev = Q.run(p, req({ kind: 'top', k: 'L:Temperature|°C', per: 'device' }), ctx);
  assert.deepEqual(perDev.rows.map((r) => [r.name, r.n]), [['Rect B', 30], ['Rect A', 22.5]]);
  const perInst = Q.run(p, req({ kind: 'top', k: 'L:Temperature|°C', per: 'instance' }), ctx);
  assert.deepEqual(perInst.rows.map((r) => r.name), ['Rect B 1', 'Rect A 2', 'Rect A 1']);
  assert.equal(Q.run(p, req({ kind: 'top', k: 'x' }), ctx).rows.length, 0);
});

test('a series: one line per device, gaps stay empty', () => {
  const s = Q.run(fakePolling(), req({ kind: 'series', k: 'L:Battery voltage|V', per: 'device' }), ctx);
  assert.deepEqual(s.groups, ['Rect A', 'Rect B']); assert.equal(s.series.length, 10);
  assert.deepEqual(s.series[1], [54, 53]); assert.deepEqual(s.series[0], [null, null]); assert.deepEqual(s.series[3], [54.4, 53.2]);
  const all = Q.run(fakePolling(), req({ kind: 'series', k: 'L:Battery voltage|V', per: 'all', pagg: 'max' }), ctx);
  assert.deepEqual(all.groups, ['All']); assert.deepEqual(all.series[1], [54]);
});

test('request fields are made safe', () => {
  const c = Q.clean({ k: 'x'.repeat(300), devs: Array(500).fill('d'), pagg: 'evil', per: 'nope', n: 9999 });
  assert.equal(c.k.length, 80); assert.equal(c.devs.length, 200); assert.equal(c.pagg, 'avg'); assert.equal(c.per, 'device'); assert.equal(c.n, 50);
});
