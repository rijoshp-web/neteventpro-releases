'use strict';
const test = require('node:test'); const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const { startAgent } = require('./fake-snmp-agent');
const { Polling } = require('../src/polling');
const { DEFAULTS } = require('../src/config');

const MIB = [
  ['1.3.6.1.2.1.1.1.0', 'octets', 'Cisco IOS test'], ['1.3.6.1.2.1.1.2.0', 'oid', '1.3.6.1.4.1.9.1.1208'], ['1.3.6.1.2.1.1.3.0', 'timeticks', 360000], ['1.3.6.1.2.1.1.5.0', 'octets', 'sw-test'],
  ['1.3.6.1.4.1.9.9.109.1.1.1.1.8.1', 'gauge32', 65],
  ['1.3.6.1.2.1.25.2.3.1.2.1', 'oid', '1.3.6.1.2.1.25.2.1.2'], ['1.3.6.1.2.1.25.2.3.1.5.1', 'integer', 1000], ['1.3.6.1.2.1.25.2.3.1.6.1', 'integer', 500],
  ['1.3.6.1.2.1.31.1.1.1.1.1', 'octets', 'Gi1/0/1'], ['1.3.6.1.2.1.31.1.1.1.1.2', 'octets', 'Gi1/0/2'], ['1.3.6.1.2.1.31.1.1.1.1.3', 'octets', 'Vlan1'],
  ['1.3.6.1.2.1.2.2.1.3.1', 'integer', 6], ['1.3.6.1.2.1.2.2.1.3.2', 'integer', 6], ['1.3.6.1.2.1.2.2.1.3.3', 'integer', 53],
  ['1.3.6.1.2.1.2.2.1.8.1', 'integer', 1], ['1.3.6.1.2.1.2.2.1.8.2', 'integer', 2], ['1.3.6.1.2.1.2.2.1.8.3', 'integer', 1],
  ['1.3.6.1.2.1.31.1.1.1.6.1', 'counter64', 1000], ['1.3.6.1.2.1.31.1.1.1.6.2', 'counter64', 0], ['1.3.6.1.2.1.31.1.1.1.10.1', 'counter64', 2000],
  ['1.3.6.1.2.1.2.2.1.14.1', 'counter32', 0], ['1.3.6.1.2.1.2.2.1.20.1', 'counter32', 0]
];
function setup() {
  const db = new DatabaseSync(':memory:'), cfg = { polling: structuredClone(DEFAULTS.polling) }; cfg.polling.missesBeforeDown = 2;
  const config = { get: () => cfg, update: (p) => Object.assign(cfg, p) };
  const msgs = [], engine = { process: (m) => msgs.push(m), alarms: null }, pl = new Polling(config, { db }, engine);
  return { pl, msgs, cfg, db };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('poll a Cisco-like device: profile detection, readings, auto interfaces, rates, thresholds, no-answer', async () => {
  const a = await startAgent({ mib: MIB }), { pl, msgs, db } = setup();
  try {
    const t = await pl.testDevice({ name: 'x', host: '127.0.0.1', port: a.port, version: 'v2c', community: 'public', timeoutMs: 500 });
    assert.equal(t.ok, true); assert.equal(t.profile, 'cisco'); assert.equal(t.interfaces, 3); assert.equal(t.uptimeSec, 3600);
    const bad = await pl.testDevice({ name: 'x', host: '127.0.0.1', port: a.port, version: 'v2c', community: 'wrong', timeoutMs: 300, retries: 0 }); assert.equal(bad.ok, false); assert.equal(bad.code, 'timeout');

    const d = pl.saveDevice({ name: 'SW-Test', host: '127.0.0.1', port: a.port, version: 'v2c', community: 'public', timeoutMs: 500, retries: 0, profile: 'auto', ifMode: 'auto' });
    pl.saveThresholds([{ name: 'CPU high', k: 'cpu', op: '>', value: 50, clearValue: 40, forSec: 0, severity: 3 }, { name: 'Port down', k: 'if.status', op: '<', value: 0.5, severity: 4 }]);
    const r1 = await pl.pollDevice(pl.devices()[0]); assert.equal(r1.ok, true);
    const dd = pl.devices()[0]; assert.equal(dd.ifMode, 'selected'); assert.deepEqual(dd.ifSelected, ['Gi1/0/1', 'Gi1/0/2'].slice(0, 1));   // only the interface that is up, not the VLAN
    const get = (k, inst = '') => pl.latest(pl.state(dd), k, inst);
    assert.equal(get('cpu'), 65); assert.equal(get('memory'), 50); assert.equal(get('uptime'), 3600); assert.equal(get('if.status', 'Gi1/0/1'), 1); assert.equal(get('if.in', 'Gi1/0/1'), null);
    assert.ok(msgs.some((m) => /CPU high/.test(m.message) && m.tags.includes('poll-' + pl.cfg.thresholds[0].id) && m.devKey === 'sw-test'), 'cpu threshold raised');
    assert.equal(msgs.filter((m) => /CPU high/.test(m.message)).length, 1);
    a.set('1.3.6.1.2.1.31.1.1.1.6.1', 1000 + 125000 * 5);      // 5 s later (we fake the clock by waiting): rate must be about 125000 B/s
    await wait(1100); a.set('1.3.6.1.4.1.9.9.109.1.1.1.1.8.1', 20); a.set('1.3.6.1.2.1.31.1.1.1.6.1', 1000 + 125000);
    await pl.pollDevice(dd);
    const rin = get('if.in', 'Gi1/0/1'); assert.ok(rin > 0 && rin < 1.1e6 * 1.2, 'rate ' + rin);
    assert.ok(msgs.some((m) => /CLEARED: CPU high/.test(m.message)), 'cpu threshold cleared'); assert.equal(get('cpu'), 20);
    // series
    const s = pl.series(dd.id, 'cpu', '', Date.now() - 3600000, Date.now() + 1000); assert.ok(s.length >= 1);
    pl.rollup();
    // no answer: stop answering, 2 misses -> alarm message, then answer again -> cleared
    const before = msgs.length; a.close(); const dev2 = { ...dd };
    await pl.pollDevice(dev2); assert.equal(msgs.length, before);       // 1 miss: nothing yet
    await pl.pollDevice(dev2); assert.match(msgs[msgs.length - 1].message, /^No SNMP answer from SW-Test/); assert.equal(pl.state(dd).state, 'down');
    assert.ok(msgs[msgs.length - 1].tags.includes('poll-noanswer'));
    const ov = pl.overview(); assert.equal(ov.counts.down, 1);
    const b = await startAgent({ mib: MIB });
    try { pl.patchDevice(dd.id, { port: b.port }); await pl.pollDevice(pl.devices()[0]);
      assert.ok(msgs.some((m) => /^CLEARED: SW-Test/.test(m.message) && m.tags.includes('poll-noanswer'))); assert.equal(pl.state(dd).state, 'up'); } finally { b.close(); }
    // rules for the engine
    const ids = pl.rules().map((r) => r.id); assert.ok(ids.includes('poll-noanswer')); assert.ok(ids.includes('poll-lookup')); assert.equal(ids.length, 4);
    // deleting removes readings
    pl.deleteDevice(dd.id); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM poll_readings').get().n, 0);
  } finally { try { a.close(); } catch { /* closed */ } }
});

test('device input checks and secret masking', () => {
  const { pl, cfg } = setup();
  assert.throws(() => pl.saveDevice({ name: '', host: 'a', version: 'v2c', community: 'x' }), /name/);
  assert.throws(() => pl.saveDevice({ name: 'a', host: 'bad host!', version: 'v2c', community: 'x' }), /address/);
  assert.throws(() => pl.saveDevice({ name: 'a', host: '10.0.0.1', version: 'v2c', community: '' }), /community/);
  assert.throws(() => pl.saveDevice({ name: 'a', host: '10.0.0.1', version: 'v3', user: 'u', level: 'authPriv', authPass: 'short', privPass: 'longenough1' }), /authentication password/);
  const d = pl.saveDevice({ name: 'a', host: '10.0.0.1', version: 'v3', user: 'u', level: 'authPriv', authPass: 'authpass123', privPass: 'privpass123' });
  assert.equal(pl.mask(d).authPass, '********');
  const d2 = pl.saveDevice({ id: d.id, name: 'a', host: '10.0.0.2', version: 'v3', user: 'u', level: 'authPriv', authPass: '********', privPass: '********' });
  assert.equal(d2.authPass, 'authpass123'); assert.equal(cfg.polling.devices[0].privPass, 'privpass123');
  assert.throws(() => pl.saveDevice({ name: 'A', host: '10.0.0.3', version: 'v2c', community: 'x' }), /already named/);
});

test('secrets of polled devices are encrypted in config.json', () => {
  const { DEFAULTS: D } = require('../src/config'); assert.ok(D.polling);
  const cfg = require('node:fs').readFileSync(require.resolve('../src/config.js'), 'utf8'); assert.match(cfg, /polling\?\.devices[^\n]*community[^\n]*authPass[^\n]*privPass/);
});

test('discovery: ranges, finding a device, adding it with the credentials that worked (1.47)', async () => {
  assert.deepEqual(Polling.expand('10.0.0.0/30'), ['10.0.0.1', '10.0.0.2']); assert.equal(Polling.expand('10.0.0.5-8').length, 4); assert.throws(() => Polling.expand('10.0.0.0/16'), /more than/); assert.throws(() => Polling.expand('nope'), /not an IPv4/);
  const a = await startAgent({ mib: MIB }), { pl } = setup();
  try {
    assert.throws(() => pl.startDiscovery({ ranges: '127.0.0.1', version: 'v2c', communities: '' }), /community/);
    const id = pl.startDiscovery({ ranges: '127.0.0.1 127.0.0.2', version: 'v2c', port: a.port, communities: 'wrong public' });
    for (let i = 0; i < 100 && pl.discoveryStatus(id).running; i++) await wait(100);
    const st = pl.discoveryStatus(id); assert.equal(st.done, 2); assert.equal(st.found.length, 1); assert.equal(st.found[0].host, '127.0.0.1'); assert.equal(st.found[0].profile, 'cisco'); assert.equal(st.found[0].vendor, 'Cisco'); assert.equal(st.found[0].cred, undefined);
    assert.equal(pl.addDiscovered(id, ['127.0.0.1', '9.9.9.9'], { site: 'HQ' }), 1); assert.equal(pl.addDiscovered(id, ['127.0.0.1']), 0);
    const d = pl.devices()[0]; assert.equal(d.name, 'sw-test'); assert.equal(d.community, 'public'); assert.equal(d.site, 'HQ'); assert.equal(d.port, a.port);
  } finally { a.close(); }
});

test('report summary and CSV (1.47)', async () => {
  const a = await startAgent({ mib: MIB }), { pl } = setup();
  try {
    pl.saveDevice({ name: '=SW', host: '127.0.0.1', port: a.port, version: 'v2c', community: 'public', timeoutMs: 500, retries: 0, profile: 'auto', ifMode: 'auto' });
    const d = pl.devices()[0]; await pl.pollDevice(d); await pl.pollDevice(d);
    const sm = pl.summary(24); assert.equal(sm.rows.length, 1); assert.equal(sm.rows[0].polls, 2); assert.equal(sm.rows[0].availability, 100); assert.equal(sm.rows[0].cpuMax, 65);
    const csv = pl.csv(24); assert.match(csv, /"'=SW"/); assert.match(csv, /Availability %/);
    const one = pl.csv(24, d.id); assert.match(one, /CPU load/); assert.match(one, /Gi1\/0\/1/); assert.equal(pl.csv(24, 'nope'), null);
    a.close(); await pl.pollDevice(d); assert.ok(pl.summary(24).rows[0].availability < 100);
  } finally { try { a.close(); } catch { /* closed */ } }
});

test('1.50: a table read row by row gives one value per row, named by a name column', async () => {
  const a = await startAgent({ mib: MIB }), { pl } = setup();
  try {
    pl.saveProfiles([{ name: 'Rows', metrics: [{ k: 'ifst', label: 'Port state', unit: '', t: 'walk', oid: '1.3.6.1.2.1.2.2.1.8', agg: 'each', nameOid: '1.3.6.1.2.1.31.1.1.1.1', scale: 1, on: true }, { k: 'ifst2', label: 'Port state (no names)', unit: '', t: 'walk', oid: '1.3.6.1.2.1.2.2.1.8', agg: 'each', scale: 1, on: true }, { k: 'ifmax', label: 'Max', unit: '', t: 'walk', oid: '1.3.6.1.2.1.2.2.1.8', agg: 'max', scale: 1, on: true }] }]);
    const prof = pl.profiles().find((p) => p.name === 'Rows'); assert.ok(prof);
    const d = pl.saveDevice({ name: 'RowDev', host: '127.0.0.1', port: a.port, version: 'v2c', community: 'public', timeoutMs: 500, retries: 0, profile: prof.id });
    await pl.pollDevice(pl.devices()[0]); const dd = pl.devices()[0], det = pl.detail(dd.id);
    assert.deepEqual(det.insts.ifst, { 'Gi1/0/1': 1, 'Gi1/0/2': 2, 'Vlan1': 1 }, 'one value per row, named by the name column');
    assert.deepEqual(det.insts.ifst2, { '1': 1, '2': 2, '3': 1 }, 'the row number when no name column is given');
    assert.equal(det.values.ifmax, 2, 'combining rows still works');
    assert.ok(pl.keyList().find((k) => k.k === 'ifst').inst, 'thresholds can be set per row');
  } finally { try { a.close(); } catch { /* already closed */ } }
});

test('1.50.1: numbers that a device sends as text are read', async () => {
  const MIBT = [...MIB, ['1.3.6.1.4.1.9999.1.1', 'octets', '12.4 V'], ['1.3.6.1.4.1.9999.1.2', 'octets', '-3,5'], ['1.3.6.1.4.1.9999.1.3', 'octets', 'n/a']];
  const a = await startAgent({ mib: MIBT }), { pl } = setup();
  try {
    pl.saveProfiles([{ name: 'Txt', metrics: [{ k: 'tv', label: 'V', unit: '', t: 'walk', oid: '1.3.6.1.4.1.9999.1', agg: 'each', scale: 1, on: true }] }]);
    pl.saveDevice({ name: 'T', host: '127.0.0.1', port: a.port, version: 'v2c', community: 'public', timeoutMs: 500, retries: 0, profile: pl.profiles().find((p) => p.name === 'Txt').id });
    await pl.pollDevice(pl.devices()[0]); assert.deepEqual(pl.detail(pl.devices()[0].id).insts.tv, { '1': 12.4, '2': -3.5 });
  } finally { try { a.close(); } catch { /* closed */ } }
});

test('1.51: lookups raise and clear alarms per row, text values, the new operators', async () => {
  const MIBX = [...MIB, ['1.3.6.1.4.1.7777.1.1.1', 'integer', 1], ['1.3.6.1.4.1.7777.1.1.2', 'integer', 3], ['1.3.6.1.4.1.7777.1.2.1', 'octets', 'Fan A'], ['1.3.6.1.4.1.7777.1.2.2', 'octets', 'Fan B'],
    ['1.3.6.1.4.1.7777.2.0', 'octets', 'FW 1.0'], ['1.3.6.1.4.1.7777.3.0', 'integer', 7], ['1.3.6.1.4.1.7777.4.0', 'timeticks', 12000]];
  const a = await startAgent({ mib: MIBX }), { pl, msgs } = setup();
  try {
    const lid = pl.lookupFromEnums('AlarmColorT', { 0: 'gray', 1: 'green', 2: 'yellow', 3: 'red' }); assert.ok(lid);
    assert.equal(pl.lookupFromEnums('AlarmColorT', { 9: 'x' }), lid, 'the same name is reused');
    const lk = pl.lookup(lid); assert.deepEqual(lk.items.map((i) => i.state), ['unk', 'ok', 'warn', 'crit'], 'states are guessed from the names');
    assert.ok(pl.lookups().some((l) => l.id === 'b-ifstatus'), 'built-in lookups exist');
    pl.saveProfiles([{ name: 'Types', metrics: [
      { k: 'fan', label: 'Fan', unit: '', t: 'walk', oid: '1.3.6.1.4.1.7777.1.1', agg: 'each', nameOid: '1.3.6.1.4.1.7777.1.2', scale: 1, dtype: 'number', lookup: lid, on: true },
      { k: 'fw', label: 'Firmware', unit: '', t: 'oid', oid: '1.3.6.1.4.1.7777.2.0', agg: 'avg', scale: 1, dtype: 'text', on: true },
      { k: 'lvl', label: 'Level', unit: '', t: 'oid', oid: '1.3.6.1.4.1.7777.3.0', agg: 'avg', scale: 1, dtype: 'number', on: true },
      { k: 'tk', label: 'Ticks', unit: 's', t: 'oid', oid: '1.3.6.1.4.1.7777.4.0', agg: 'avg', scale: 1, dtype: 'ticks', on: true }] }]);
    pl.saveThresholds([{ name: 'Level is 7', k: 'lvl', op: '=', value: 7, severity: 4, scope: 'all' }, { name: 'Firmware changed', k: 'fw', textOp: 'changed', severity: 4, scope: 'all' }]);
    pl.saveDevice({ name: 'Rack', host: '127.0.0.1', port: a.port, version: 'v2c', community: 'public', timeoutMs: 500, retries: 0, profile: pl.profiles().find((p) => p.name === 'Types').id });
    const d = pl.devices()[0]; await pl.pollDevice(d); let det = pl.detail(d.id);
    assert.deepEqual(det.insts.fan, { 'Fan A': 1, 'Fan B': 3 }); assert.equal(det.texts.fw[''].s, 'FW 1.0'); assert.equal(det.values.tk, 120, 'ticks are hundredths of a second');
    assert.equal(det.lookups.fan.name, 'AlarmColorT');
    const crit = msgs.filter((m) => /Fan Fan B is red/.test(m.message)); assert.equal(crit.length, 1, 'the red fan raised one alarm message'); assert.equal(crit[0].severity, 3);
    assert.ok(!msgs.some((m) => /Fan Fan A is/.test(m.message)), 'the green fan is quiet');
    assert.ok(msgs.some((m) => /Level is 7/.test(m.message) && !/CLEARED/.test(m.message)), 'the = operator fires');
    assert.ok(!msgs.some((m) => /Firmware changed/.test(m.message)), 'the first text value is not a change');
    await pl.pollDevice(d); assert.equal(msgs.filter((m) => /Fan Fan B is red/.test(m.message)).length, 1, 'no repeat while it stays red');
    a.set('1.3.6.1.4.1.7777.1.1.2', 1); a.set('1.3.6.1.4.1.7777.2.0', 'FW 1.1'); a.set('1.3.6.1.4.1.7777.3.0', 8); await wait(50); await pl.pollDevice(d);
    assert.ok(msgs.some((m) => /CLEARED: Fan Fan B is green/.test(m.message)), 'the alarm clears when the lookup state is ok again');
    assert.ok(msgs.some((m) => /Firmware changed/.test(m.message) && /was "FW 1.0"/.test(m.message)), 'a changed text value raises the text threshold');
    assert.ok(msgs.some((m) => /CLEARED: Level is 7/.test(m.message)), 'the = threshold clears');
  } finally { try { a.close(); } catch { /* closed */ } }
});

test('1.52.4: a new device polls only uptime: no interfaces, CPU or memory unless chosen', async () => {
  const a = await startAgent(MIB); const { pl } = setup();
  try {
    const d = pl.saveDevice({ name: 'Bare', host: '127.0.0.1', port: a.port, version: 'v2c', community: 'public', timeoutMs: 500, retries: 0 });
    assert.strictEqual(d.profile, 'basic'); assert.strictEqual(d.ifMode, 'none');
    await pl.pollDevice(pl.devices().find((x) => x.id === d.id));
    const v = pl.detail(d.id); assert.deepStrictEqual(v.ifaces, []); assert.ok(!('cpu' in v.values) && !('memory' in v.values) && !v.insts['if.status']);
  } finally { a.close(); }
});
