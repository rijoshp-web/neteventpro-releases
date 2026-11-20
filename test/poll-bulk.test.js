'use strict';
// 1.99.10 one change for many polled devices: on/off, probe, group, interval, template, remove (one config write)
const test = require('node:test'); const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { Polling } = require('../src/polling');
const { DEFAULTS } = require('../src/config');

function setup() {
  const db = new DatabaseSync(':memory:'), cfg = { polling: structuredClone(DEFAULTS.polling), probes: [{ id: 'p1', name: 'Site B' }] }; let writes = 0;
  const config = { get: () => cfg, update: (p) => { writes++; Object.assign(cfg, p); } };
  const pl = new Polling(config, { db }, { process() {}, alarms: null });
  const ids = [1, 2, 3, 4].map((i) => pl.saveDevice({ name: 'Box-' + i, host: '127.0.0.' + i, version: 'v2c', community: 'public', profile: 'basic', ifMode: 'none' }).id);
  return { pl, cfg, ids, writes: () => writes };
}
test('bulk changes', () => {
  const { pl, ids } = setup(); const get = (id) => pl.devices().find((d) => d.id === id);
  assert.equal(pl.bulk(ids.slice(0, 2), 'off').count, 2); assert.equal(get(ids[0]).enabled, false); assert.equal(get(ids[2]).enabled, true);
  pl.bulk(ids, 'via', 'p1'); assert.ok(pl.devices().every((d) => d.via === 'p1')); pl.bulk([ids[0]], 'via', ''); assert.equal(get(ids[0]).via, '');
  assert.throws(() => pl.bulk(ids, 'via', 'nope'), /No such probe/);
  pl.bulk(ids, 'group', '  Power   room '); assert.equal(get(ids[3]).group, 'Power room');
  pl.bulk(ids, 'interval', 5); assert.equal(get(ids[1]).intervalSec, 10);
  pl.saveReadings(ids[0], [{ label: 'Temp', unit: '°C', t: 'oid', oid: '1.3.6.1.4.1.99999.1.1.0' }]); const tid = pl.saveTemplate('T', ids[0]);
  pl.bulk(ids.slice(1), 'template', tid); assert.ok(ids.slice(1).every((id) => pl.readingsOf(id).some((r) => r.label === 'Temp')));
  assert.throws(() => pl.bulk(ids, 'explode'), /Unknown action/);
});
test('bulk remove is one config write for the devices and one for their readings', () => {
  const { pl, ids, writes } = setup(); pl.saveReadings(ids[0], [{ label: 'Temp', t: 'oid', oid: '1.3.6.1.4.1.99999.1.1.0' }]);
  const before = writes(); assert.equal(pl.bulk(ids.slice(0, 3), 'remove').count, 3);
  assert.equal(pl.devices().length, 1); assert.ok(!pl.readingsOf(ids[0]).length); assert.ok(writes() - before <= 2, `config writes: ${writes() - before}`);
});
