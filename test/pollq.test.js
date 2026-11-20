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

// 1.99.7 an empty polling tile says why, and a number kept as text is shown
test('an empty polling tile explains why; a numeric text value is used', () => {
  const pq = require('../src/pollq');
  const devs = [{ id: 'a', name: 'CM-1', host: '10.0.0.1' }, { id: 'b', name: 'Rect', host: '10.0.0.2' }];
  const rt = new Map([['a', { lastTry: 1, lastOk: 1, last: new Map(), texts: new Map([['r1|', { s: '23.5 C', ts: 5 }]]) }], ['b', { lastTry: 1, lastOk: 1, last: new Map() }]]);
  const polling = { devices: () => devs, rt, metricInfo: () => ({ label: 'Room temp', unit: '°C' }), keysOf: () => ['r1'], profiles: () => [{ id: 'dev-a', own: true, metrics: [{ k: 'r1' }] }] };
  const n = pq.run(polling, { kind: 'count', k: 'L:Room temp|°C', devs: [], inst: '*', pagg: 'avg', per: 'device', n: 5 }, {});
  assert.strictEqual(n.n, 23.5);
  const e = pq.run(polling, { kind: 'top', k: 'L:Room temp|°C', devs: ['b'], inst: '*', pagg: 'avg', per: 'device', n: 5 }, {});
  assert.deepStrictEqual(e.rows, []); assert.match(e.why, /Rect: no reading named/);
  rt.get('a').texts = new Map(); rt.get('a').last = new Map();
  const g = pq.run(polling, { kind: 'top', k: 'L:Room temp|°C', devs: ['a'], inst: '*', pagg: 'avg', per: 'device', n: 5 }, {});
  assert.match(g.why, /CM-1: answers, but has no value/);
});

// 1.99.9 a device that is polled with a custom reading set (not its own readings) still feeds the dashboard by reading name
test('readings of a custom reading set join by name and unit, not case sensitive', () => {
  const { Polling } = require('../src/polling');
  const profiles = [
    { id: 'generic', builtin: true, metrics: [{ k: 'cpu', label: 'CPU' }] },
    { id: 'pCM', builtin: false, metrics: [{ k: 'c1', label: 'CM Room Temperature', unit: '°C' }] },
    { id: 'dev-b', own: true, metrics: [{ k: 'r2', label: 'cm room temperature ', unit: '°C' }] }
  ];
  const devs = [{ id: 'a', name: 'CUC-6 CM', profile: 'pCM' }, { id: 'b', name: 'PTB CM', profile: 'dev-b' }];
  const polling = { profiles: () => profiles, devices: () => devs, rt: new Map([['a', { lastTry: 1, lastOk: 1, last: new Map([['c1|', { v: 22, ts: 1 }]]) }], ['b', { lastTry: 1, lastOk: 1, last: new Map([['r2|', { v: 25, ts: 1 }]]) }]]),
    metricInfo: () => ({ label: 'CM Room Temperature', unit: '°C' }) };
  polling.keysOf = Polling.prototype.keysOf.bind(polling); polling.dashKeys = Polling.prototype.dashKeys.bind(polling);
  const k = polling.dashKeys().find((x) => x.label.toLowerCase() === 'cm room temperature');
  assert.equal(k.devices, 2);
  const r = Q.run(polling, req({ kind: 'top', k: k.k, devs: ['a', 'b'], per: 'device' }), ctx);
  assert.deepEqual(r.rows.map((x) => [x.name, x.n]).sort(), [['CUC-6 CM', 22], ['PTB CM', 25]]);
});

// 1.99.10 a reading that only an unused reading set has is not offered, and the tile says so plainly
test('a reading no device polls is not offered; the empty tile says which devices lack it', () => {
  const { Polling } = require('../src/polling');
  const profiles = [{ id: 'generic', builtin: true, metrics: [] }, { id: 'pOld', builtin: false, metrics: [{ k: 'c9', label: 'CM Room Temperature', unit: '°C' }] }, { id: 'dev-a', own: true, metrics: [{ k: 'r1', label: 'Room Temperature', unit: '°C' }] }];
  const polling = { profiles: () => profiles, devices: () => [{ id: 'a', name: 'CUC-6 CM', profile: 'dev-a' }], rt: new Map([['a', { lastTry: 1, lastOk: 1, last: new Map([['r1|', { v: 22, ts: 1 }]]) }]]), metricInfo: (k) => ({ label: k.slice(2).split('|')[0], unit: '°C' }) };
  polling.keysOf = Polling.prototype.keysOf.bind(polling); polling.dashKeys = Polling.prototype.dashKeys.bind(polling);
  const labels = polling.dashKeys().map((x) => x.label);
  assert.ok(labels.includes('Room Temperature')); assert.ok(!labels.includes('CM Room Temperature'));
  const e = Q.run(polling, req({ kind: 'top', k: 'L:CM Room Temperature|°C', devs: ['a'] }), ctx); assert.match(e.why, /No polled device uses a reading named/);
  const ok = Q.run(polling, req({ kind: 'top', k: 'L:Room Temperature|°C', devs: ['a'] }), ctx); assert.equal(ok.rows[0].n, 22);
  const rtt = Q.run(polling, req({ kind: 'count', k: 'rtt', devs: ['a'] }), ctx); assert.match(rtt.why, /CUC-6 CM: answers/);
});
