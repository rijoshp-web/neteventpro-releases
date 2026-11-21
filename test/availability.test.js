'use strict';
// 1.99.14 availability (SLA) of polled devices: by time, maintenance windows not counted, older periods from the 5-minute averages
const test = require('node:test'); const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { Polling } = require('../src/polling');
const { DEFAULTS } = require('../src/config');
const { Maintenance } = require('../src/maintenance');

function setup(maintList = []) {
  const db = new DatabaseSync(':memory:'), cfg = { polling: structuredClone(DEFAULTS.polling), maintenance: maintList };
  const config = { get: () => cfg, update: (p) => { Object.assign(cfg, p); }, onChange: () => {} };
  const engine = { process() {}, alarms: null, maint: new Maintenance(config) };
  const pl = new Polling(config, { db }, engine);
  const a = pl.saveDevice({ name: 'Rect-A', host: '10.0.0.1', version: 'v2c', community: 'public', profile: 'basic', ifMode: 'none', group: 'Power', intervalSec: 60 }).id;
  const b = pl.saveDevice({ name: 'Sw-B', host: '10.0.0.2', version: 'v2c', community: 'public', profile: 'basic', ifMode: 'none', group: 'Core', intervalSec: 60 }).id;
  return { pl, db, a, b, cfg };
}
const ins = (db, dev, ts, v) => db.prepare("INSERT INTO poll_readings (dev, k, inst, ts, v) VALUES (?, 'poll.ok', '', ?, ?)").run(dev, ts, v);

test('availability by time: missed polls count as down until the next poll, outages and groups', () => {
  const { pl, db, a, b } = setup(); const T0 = Date.now() - 4 * 3600000;
  for (let i = 0; i < 180; i++) { ins(db, a, T0 + i * 60000, i >= 60 && i < 90 ? 0 : 1); ins(db, b, T0 + i * 60000, i === 100 || i === 150 ? 0 : 1); }
  const r = pl.availability(T0, T0 + 180 * 60000), A = r.devices.find((x) => x.id === a), B = r.devices.find((x) => x.id === b);
  assert.ok(Math.abs(A.availability - (150 / 180) * 100) < 0.01, String(A.availability)); assert.equal(A.downMin, 30); assert.equal(A.outages, 1); assert.equal(A.met, false);
  assert.equal(B.outages, 2); assert.equal(B.downMin, 2); assert.equal(r.devices[0].id, a, 'worst first');
  assert.deepEqual(r.groups.map((g) => g.group), ['Core', 'Power']); assert.equal(r.groups.find((g) => g.group === 'Power').below, 1);
  assert.equal(r.below, 2, 'both are below the default 99.9 % target');
  pl.setSla({ target: 99, groups: { Power: 80, Bad: 'x' } }); const r2 = pl.availability(T0, T0 + 180 * 60000);
  assert.equal(r2.target, 99); assert.equal(r2.devices.find((x) => x.id === a).target, 80); assert.equal(r2.devices.find((x) => x.id === a).met, true); assert.deepEqual(Object.keys(r2.groupTargets), ['Power']);
  assert.match(pl.availabilityCsv(T0, T0 + 180 * 60000), /"Rect-A","10\.0\.0\.1","Power","","83\.333","80","yes","30","1"/);
});
test('a gap with no polling is not counted, and time inside a maintenance window is left out', () => {
  const T0 = new Date(); T0.setHours(0, 0, 0, 0); T0.setDate(T0.getDate() - 2); const t0 = T0.getTime();
  const once = { id: 'w1', name: 'works', enabled: true, devices: 'rect-a', schedule: { type: 'once', from: t0 + 3600000, to: t0 + 7200000 } };
  const { pl, db, a } = setup([once]);
  for (let i = 0; i < 240; i++) ins(db, a, t0 + i * 60000, i >= 60 && i < 120 ? 0 : 1);   // down exactly during the window
  for (let i = 0; i < 60; i++) ins(db, a, t0 + 600 * 60000 + i * 60000, 1);               // 6 hours without polling before this
  const A = pl.availability(t0, t0 + 660 * 60000).devices.find((x) => x.id === a);
  assert.equal(A.downMin, 0, 'the outage was planned work'); assert.equal(A.availability, 100); assert.equal(A.maintMin, 60);
  assert.ok(A.measuredH < 5, 'the 6 hours without polling are not counted: ' + A.measuredH);
});
test('older periods come from the 5-minute averages', () => {
  const { pl, db, a } = setup(); const t = Math.floor((Date.now() - 10 * 86400000) / 300000) * 300000;
  for (let i = 0; i < 12; i++) db.prepare("INSERT INTO poll_avg (dev, k, inst, t, avg, min, max, n) VALUES (?, 'poll.ok', '', ?, ?, 0, 1, 5)").run(a, t + i * 300000, i < 3 ? 0 : 1);
  db.prepare("INSERT INTO poll_meta (k, v) VALUES ('rolledTo', ?)").run(String(Date.now() - 3600000));
  const A = pl.availability(t, t + 12 * 300000).devices.find((x) => x.id === a); assert.equal(A.downMin, 15); assert.equal(A.availability, 75);
});
test('maintenance windows: the times a weekly window covered', () => {
  const cfg = { maintenance: [{ id: 'w', enabled: true, devices: 'sw-*', schedule: { type: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], start: '23:00', end: '01:00' } }] };
  const m = new Maintenance({ get: () => cfg, onChange: () => {} }); const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 3); const from = d.getTime(), to = from + 2 * 86400000;
  const rs = m.rangesFor(['SW-1'], from, to); assert.equal(rs.reduce((n, [x, y]) => n + (y - x), 0), 4 * 3600000, 'night 1 (00-01), night 2 (23-01) and 23-24 on day 2');
  assert.equal(m.rangesFor(['rect-1'], from, to).length, 0);
});
