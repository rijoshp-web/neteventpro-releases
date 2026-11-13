'use strict';
const test = require('node:test'); const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const { startAgent } = require('./fake-snmp-agent');
const { Polling } = require('../src/polling');
const { DEFAULTS } = require('../src/config');

const MIB = [
  ['1.3.6.1.2.1.1.1.0', 'octets', 'Test box'], ['1.3.6.1.2.1.1.2.0', 'oid', '1.3.6.1.4.1.99999.1'], ['1.3.6.1.2.1.1.3.0', 'timeticks', 360000], ['1.3.6.1.2.1.1.5.0', 'octets', 'box-1'],
  ['1.3.6.1.4.1.99999.1.1.0', 'integer', 4],                                        // 4 V -> 20 C with scale 5
  ['1.3.6.1.4.1.99999.1.2.0', 'integer', 250],                                     // 250 -> 25.0 with scale 0.1 and offset -5 -> 20
  ['1.3.6.1.4.1.99999.2.1', 'integer', 1], ['1.3.6.1.4.1.99999.2.2', 'integer', 3],  // a status table with two rows
];
function setup() {
  const db = new DatabaseSync(':memory:'), cfg = { polling: structuredClone(DEFAULTS.polling) };
  const config = { get: () => cfg, update: (p) => Object.assign(cfg, p) };
  const msgs = [], engine = { process: (m) => msgs.push(m), alarms: null }, pl = new Polling(config, { db }, engine);
  return { pl, msgs, cfg };
}
const dev = (pl, port, name = 'Box-1') => pl.saveDevice({ name, host: '127.0.0.1', port, version: 'v2c', community: 'public', timeoutMs: 500, retries: 0, profile: 'basic', ifMode: 'none' });

test('readings: own name, unit, scale and offset; value meanings and an alarm per reading', async () => {
  const a = await startAgent({ mib: MIB }), { pl, msgs } = setup();
  try {
    const d = dev(pl, a.port);
    const out = pl.saveReadings(d.id, [
      { label: 'Room temperature', unit: '°C', t: 'oid', oid: '1.3.6.1.4.1.99999.1.1.0', scale: 5, alarms: [{ op: '>', value: 15, clearValue: 12, severity: 3 }] },
      { label: 'Probe B', unit: '°C', t: 'oid', oid: '1.3.6.1.4.1.99999.1.2.0', scale: 0.1, offset: -5 },
      { label: 'Door', t: 'walk', oid: '1.3.6.1.4.1.99999.2', agg: 'each', items: [{ v: 1, label: 'closed', state: 'ok' }, { v: 3, label: 'open', state: 'crit' }] },
    ]);
    assert.equal(out.length, 3); assert.ok(/^r[a-z0-9]+$/.test(out[0].k));
    const dd = pl.devices()[0]; assert.equal(dd.profile, 'dev-' + d.id);
    assert.ok(pl.profiles().some((p) => p.own), 'own profile exists'); assert.ok(!pl.keyList().some((x) => x.k === out[0].k), 'own keys are not offered in the shared key list');
    await pl.pollDevice(dd); const get = (k, inst = '') => pl.latest(pl.state(dd), k, inst);
    assert.equal(get(out[0].k), 20); assert.equal(get(out[1].k), 20); assert.equal(get(out[2].k, '1'), 1); assert.equal(get(out[2].k, '2'), 3);
    assert.ok(msgs.some((m) => /Room temperature/.test(m.message)), 'alarm of the reading raised');
    assert.ok(pl.lookups().some((l) => l.owner === d.id && l.items.length === 2), 'value meanings were stored');
    assert.ok(msgs.some((m) => /open/.test(m.message)), 'value meaning "open" raised its own alarm');
    const t1 = await pl.testReading(d.id, { oid: '1.3.6.1.4.1.99999.1.1.0', t: 'oid', scale: 5 }); assert.equal(t1.ok, true); assert.equal(t1.rows[0].raw, 4); assert.equal(t1.rows[0].value, 20);
    const t2 = await pl.testReading(d.id, { oid: '1.3.6.1.4.1.99999.2', t: 'walk', agg: 'each' }); assert.equal(t2.rows.length, 2);
    const t3 = await pl.testReading(d.id, { oid: '1.3.6.1.4.1.99999.9.9.0', t: 'oid' }); assert.equal(t3.ok, false);
  } finally { await a.close(); }
});

test('readings: copy from a device, templates, built-in sets, removing a device', async () => {
  const a = await startAgent({ mib: MIB }), { pl, cfg } = setup();
  try {
    const d1 = dev(pl, a.port, 'A'), d2 = dev(pl, a.port, 'B');
    pl.saveReadings(d1.id, [{ label: 'Temp', unit: '°C', t: 'oid', oid: '1.3.6.1.4.1.99999.1.1.0', scale: 5, alarms: [{ op: '>', value: 30 }] }]);
    const r = pl.copyReadings(d2.id, 'dev:' + d1.id, false); assert.equal(r.count, 1);
    const a1 = pl.readingsOf(d1.id)[0], b1 = pl.readingsOf(d2.id)[0]; assert.notEqual(a1.k, b1.k, 'the copy has its own key'); assert.equal(b1.scale, 5); assert.equal(b1.alarms.length, 1); assert.notEqual(b1.alarms[0].id, a1.alarms[0].id);
    assert.equal(cfg.polling.thresholds.filter((t) => t.owner === d2.id).length, 1);
    const tid = pl.saveTemplate('Room sensor', d1.id); assert.equal(pl.templates()[0].count, 1);
    const d3 = dev(pl, a.port, 'C'); pl.copyReadings(d3.id, 'tpl:' + tid, true); assert.equal(pl.readingsOf(d3.id)[0].label, 'Temp');
    const d4 = dev(pl, a.port, 'D'); const b = pl.copyReadings(d4.id, 'builtin:apc', true); assert.ok(b.count > 0, 'a built-in set can be the start');
    assert.throws(() => pl.saveReadings(d1.id, [{ label: 'x', oid: 'nope' }]), /OID/);
    pl.deleteDevice(d2.id); assert.equal(cfg.polling.thresholds.filter((t) => t.owner === d2.id).length, 0); assert.equal(pl.readingsOf(d2.id).length, 0);
    pl.saveReadings(d1.id, []); assert.equal(pl.devices().find((x) => x.id === d1.id).profile, 'basic'); assert.equal(cfg.polling.thresholds.filter((t) => t.owner === d1.id).length, 0);
    assert.ok(pl.deleteTemplate(tid)); assert.equal(pl.templates().length, 0);
  } finally { await a.close(); }
});
