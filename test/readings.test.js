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

test('value meanings as rules: below / above / between, hold until the clear value, own recipients for warning and critical', async () => {
  const a = await startAgent({ mib: MIB }), { pl, msgs, cfg } = setup(), OID = '1.3.6.1.4.1.99999.1.2.0';
  try {
    const d = dev(pl, a.port, 'Rules');
    const [r] = pl.saveReadings(d.id, [{ label: 'Room temp', unit: '°C', t: 'oid', oid: OID, tellWarn: ['p-log'], tellCrit: ['p-mail'], items: [
      { op: '>=', v: 25, label: 'Critical', state: 'crit' }, { op: '>=', v: 22, label: 'Warning', state: 'warn', clear: 20 }, { op: 'between', v: 5, v2: 21.9, label: 'Normal', state: 'ok' }, { op: '<', v: 5, label: 'Too cold', state: 'warn' }] }]);
    assert.equal(r.items.length, 4); assert.equal(r.items[1].clear, 20);
    const rules = pl.rules().filter((x) => x.id.startsWith('poll-lk-' + r.k)); assert.equal(rules.length, 2);
    assert.deepEqual(rules.find((x) => x.id.endsWith('-warn')).actions.profiles, ['p-log']); assert.deepEqual(rules.find((x) => x.id.endsWith('-crit')).actions.profiles, ['p-mail']);
    const poll = async (v) => { a.set(OID, v); msgs.length = 0; await pl.pollDevice(pl.devices()[0]); return msgs.map((m) => m.message + ' #' + m.tags[1]); };
    let m = await poll(20); assert.equal(m.length, 0, 'normal: nothing');
    m = await poll(23); assert.equal(m.length, 1); assert.match(m[0], /Warning \(warning, value 23 °C\) #poll-lk-.*-warn/);
    m = await poll(21); assert.equal(m.length, 0, 'held at warning until it is back below 20');
    m = await poll(26); assert.equal(m.length, 2); assert.match(m[0], /CLEARED.*-warn/); assert.match(m[1], /critical.*-crit/);
    m = await poll(19); assert.equal(m.length, 1); assert.match(m[0], /CLEARED.*-crit/);
    m = await poll(3); assert.equal(m.length, 1); assert.match(m[0], /Too cold/);
    const { matchItem } = require('../src/readings'); assert.equal(matchItem([{ v: 1, label: 'up', state: 'ok' }], 1).label, 'up', 'old fixed meanings still work');
    pl.deleteDevice(d.id); assert.equal(pl.rules().filter((x) => x.id.startsWith('poll-lk-')).length, 0); void cfg;
  } finally { await a.close(); }
});

test('polling alarms are told by their own rules only, not by the general syslog rules (no double notification)', () => {
  const { RuleEngine } = require('../src/rules'), r = new RuleEngine();
  r.load([{ id: 'mine', name: 'warnings and worse', match: { severityMax: 4 }, actions: { alarm: true, email: true } }, { id: 'poll-t1', name: 'poll', match: { tag: 'poll-t1' }, actions: { alarm: true } }]);
  const m = (poll) => ({ severity: 3, facility: 5, host: 'h', srcIp: '1.1.1.1', app: 'snmp-poll', message: 'x', tags: ['poll', 'poll-t1'], ...(poll ? { poll: true } : {}) });
  let o = r.apply(m(true)); assert.deepEqual(o.alarms.map((x) => x.id || x.rule.id), ['poll-t1'], 'only the polling rule'); assert.equal(o.emails.length, 0);
  o = r.apply({ ...m(false), tags: [] }); assert.equal(o.emails.length, 1, 'real syslog still reaches your rule');
});

test('display views: new view is kept, the old card / bar tick-boxes are migrated', async () => {
  const a = await startAgent({ mib: MIB }), { pl, cfg } = setup();
  try {
    const d = dev(pl, a.port, 'Views'), base = { t: 'oid', oid: '1.3.6.1.4.1.99999.1.1.0' };
    const out = pl.saveReadings(d.id, [{ ...base, label: 'g', disp: { view: 'gauge', min: 0, max: 40, dec: 1 } }, { ...base, label: 'old card', disp: { card: true } }, { ...base, label: 'old bar', disp: { card: true, bar: true } }, { ...base, label: 'none', disp: { view: 'nonsense' } }]);
    assert.deepEqual(out.map((r) => r.disp.view), ['gauge', 'card', 'bar', '']); assert.equal(out[0].disp.max, 40);
    cfg.polling.readings[d.id][1].disp = { graph: true, card: true };   /* a set saved by 1.53 / 1.54 */
    assert.equal(pl.readingsOf(d.id)[1].disp.view, 'card'); assert.equal(pl.profiles().find((p) => p.own).metrics[1].disp.view, 'card');
  } finally { await a.close(); }
});

test('1.56: removed readings leave no values, layout of a device page is kept and cleaned, polling alarms can stay out of the syslog list', async () => {
  const a = await startAgent({ mib: MIB }), { pl, msgs, cfg } = setup();
  try {
    const d = dev(pl, a.port, 'Lay'), [r1, r2] = pl.saveReadings(d.id, [{ label: 'A', t: 'oid', oid: '1.3.6.1.4.1.99999.1.1.0' }, { label: 'T', t: 'walk', agg: 'each', oid: '1.3.6.1.4.1.99999.2' }]);
    await pl.pollDevice(pl.devices()[0]); let det = pl.detail(d.id); assert.ok(det.values[r1.k] !== undefined && det.insts[r2.k]);
    pl.saveReadings(d.id, [r1]); det = pl.detail(d.id); assert.equal(det.insts[r2.k], undefined, 'values of a removed reading are gone'); assert.ok(det.values[r1.k] !== undefined);
    const l = pl.saveLayout(d.id, { items: { ['g:' + r1.k]: { show: false, span: 9, h: 5000, style: 'area', color: '#112233' }, 'bad key': { show: false } }, order: ['g:rtt', 'x y'] });
    assert.equal(l.items['g:' + r1.k].span, 4); assert.equal(l.items['g:' + r1.k].h, 700); assert.equal(Object.keys(l.items).length, 1); assert.deepEqual(l.order, ['g:rtt']); assert.equal(pl.detail(d.id).layout.items['g:' + r1.k].show, false);
    pl.deleteDevice(d.id); assert.equal(cfg.polling.layouts[d.id], undefined);
    const d2 = dev(pl, a.port, 'Quiet'); cfg.polling.alarmsInSyslog = false; msgs.length = 0; pl.say(pl.devices()[0], 3, 'x', 'noanswer'); assert.equal(msgs[0].noLog, true);
    cfg.polling.alarmsInSyslog = true; msgs.length = 0; pl.say(pl.devices()[0], 3, 'x', 'noanswer'); assert.equal(msgs[0].noLog, undefined); void d2;
    assert.equal(pl.saveSettings({ alarmsInSyslog: false }).alarmsInSyslog, false); assert.equal(pl.publicSettings().alarmsInSyslog, false);
  } finally { await a.close(); }
});

test('1.57 device group is kept and the layout keeps widths and order', () => {
  const { pl } = setup(), d = dev(pl, 1), e = pl.saveDevice({ ...pl.devices().find((x) => x.id === d.id), group: '  Core   switches ' });
  assert.strictEqual(pl.devices().find((x) => x.id === e.id).group, 'Core switches');
  assert.strictEqual(pl.overview().devices.find((x) => x.id === d.id).group, 'Core switches');
  const lay = pl.saveLayout(d.id, { items: { 'v:r11111111': { w: 5, h: 300 }, 'g:rtt': { w: 20, span: 2 } }, order: ['g:rtt', 'v:r11111111', 'bad key'] });
  assert.strictEqual(lay.items['v:r11111111'].w, 5); assert.strictEqual(lay.items['g:rtt'].w, 12); assert.deepStrictEqual(lay.order, ['g:rtt', 'v:r11111111']);
  assert.deepStrictEqual(pl.layoutOf(d.id).order, ['g:rtt', 'v:r11111111']);
});

test('1.58 dashboard tile data: one reading across devices, groups, rows and status', async () => {
  const a = await startAgent({ mib: MIB }), { pl } = setup();
  try {
    const d1 = dev(pl, a.port, 'Box-1'), d2 = dev(pl, a.port, 'Box-2');
    pl.saveDevice({ ...pl.devices().find((x) => x.id === d1.id), group: 'Core' });
    const rd = [{ label: 'Room temperature', unit: '°C', t: 'oid', oid: '1.3.6.1.4.1.99999.1.1.0', scale: 5, items: [{ op: '>=', v: 25, label: 'Hot', state: 'crit' }, { op: '<', v: 25, label: 'Fine', state: 'ok' }] }, { label: 'Door', t: 'walk', oid: '1.3.6.1.4.1.99999.2', agg: 'each' }];
    pl.saveReadings(d1.id, rd); pl.saveReadings(d2.id, rd);
    await pl.pollDevice(pl.devices().find((x) => x.id === d1.id)); await pl.pollDevice(pl.devices().find((x) => x.id === d2.id));
    const cat = pl.pollCatalog(); assert.ok(cat.labels.some((l) => l.label === 'Room temperature' && l.devices === 2)); assert.deepStrictEqual(cat.groups, ['Core']);
    assert.ok(cat.devices[0].readings.find((r) => r.label === 'Door').rows.length === 2);
    const all = pl.pollTile({ src: 'readings', picks: [{ label: 'Room temperature' }] });
    assert.strictEqual(all.entries.length, 2); assert.ok(all.entries.every((e) => e.v === 20 && e.state === 'ok' && e.meaning === 'Fine'));
    assert.strictEqual(pl.pollTile({ src: 'readings', picks: [{ label: 'Room temperature', group: 'Core' }] }).entries.length, 1);
    assert.strictEqual(pl.pollTile({ src: 'readings', picks: [{ dev: d2.id, k: cat.devices.find((x) => x.id === d2.id).readings.find((r) => r.label === 'Door').k }] }).entries.length, 2);
    const one = pl.pollTile({ src: 'readings', picks: [{ dev: d2.id, k: cat.devices.find((x) => x.id === d2.id).readings.find((r) => r.label === 'Door').k, row: cat.devices[0].readings.find((r) => r.label === 'Door').rows[0] }] });
    assert.strictEqual(one.entries.length, 1);
    const st = pl.pollTile({ src: 'status', group: 'Core' }); assert.strictEqual(st.devices.length, 1); assert.strictEqual(st.groups.Core.up, 1);
    const ln = pl.pollTile({ src: 'readings', view: 'line', picks: [{ label: 'Room temperature' }] }); assert.strictEqual(ln.series.length, 2);
    assert.deepStrictEqual(pl.cleanPollSpec({ picks: [{ dev: '../x', k: 'a' }, { label: 'T<b>' }], shape: 'hex', view: 'nope' }).picks, [{ label: 'Tb' }]);
  } finally { a.close(); }
});
