'use strict';
// 1.99.10 Device view: what is kept when a view is saved, pictures, and the live state of each device
const test = require('node:test'); const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { ViewStore, imageType } = require('../src/views');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c50000000049454e44ae426082', 'hex');
function mk() {
  let cfg = { views: [] }; const config = { get: () => cfg, update: (p) => { cfg = { ...cfg, ...p }; } };
  const rt = new Map([['p1', { state: 'up', rtt: 12, last: new Map([['t1|', { v: 22.46 }], ['st|', { v: 2 }]]), texts: new Map() }], ['p2', { state: 'down', last: new Map() }], ['p3', { state: 'up', last: new Map() }]]);
  const devs = [{ id: 'p1', name: 'Rect-1', host: '10.0.0.1', profile: 'dev-p1' }, { id: 'p2', name: 'Rect-2', host: '10.9.9.9', profile: 'dev-p2' }, { id: 'p3', name: 'Rect-3', host: '10.9.9.9', profile: 'dev-p3' }];
  const polling = { series: () => [{ v: 21 }, { v: 22.46 }], detail: (id) => (id === 'p1' ? { device: devs[0], via: '', state: 'up', rtt: 12, lastOk: 1, profile: { metrics: [{ k: 't1', label: 'Temp', unit: '°C' }, { k: 'st', label: 'Status' }] }, values: { t1: 22.46, st: 2 }, insts: {}, texts: {} } : null), devices: () => devs, state: (d) => rt.get(d.id), shownState: (d, r) => r.state, profile: () => ({ metrics: [{ k: 't1', label: 'Temp', unit: '°C' }, { k: 'st', label: 'Status', lookup: 'L1' }] }),
    lookupMetrics: () => new Map([['st', { lookup: 'L1' }]]), lookups: () => [{ id: 'L1', items: [{ v: 1, label: 'Normal', state: 'ok' }, { v: 2, label: 'Fault', state: 'crit' }] }] };
  const alarms = { open: new Map([[1, { id: 1, dev: 'rect-1', src_ip: '10.0.0.1', severity: 4, state: 'open', rule_name: 'Hot', first_ts: 1 }], [2, { id: 2, dev: 'x', src_ip: '10.9.9.9', severity: 2, state: 'open', rule_name: 'Other', first_ts: 2 }]]) };
  const engine = { deviceList: () => [{ key: 'sw-1', name: 'sw-1', srcIp: '10.1.1.1', overdue: true }] };
  return { vs: new ViewStore(config, new DatabaseSync(':memory:'), { polling, alarms, engine }), cfg: () => cfg };
}
test('a saved view keeps only valid items, links and sizes', () => {
  const { vs } = mk();
  const v = vs.save({ name: '  Room A ', bg: { mode: 'image' }, items: [{ kind: 'device', src: 'poll', ref: 'p1', x: 99999, y: -5, pic: 'icon:battery', readings: ['t1', 'st', 'a', 'b'] }, { kind: 'device', src: 'poll', ref: '' }, { kind: 'label', text: 'Hall', size: 500 }, { kind: 'device', src: 'dev', ref: 'sw-1', pic: '<script>' }], links: [{ a: 'nope', b: 'x' }] });
  assert.equal(v.name, 'Room A'); assert.equal(v.bg.mode, 'grid', 'a picture background without a picture becomes the grid');
  assert.equal(v.items.length, 3); assert.equal(v.items[0].x, 1600); assert.equal(v.items[0].y, 0); assert.equal(v.items[0].readings.length, 0, '1.99.11 readings are shown in the details panel, not under the picture');
  assert.equal(v.items[1].size, 72); assert.equal(v.items[2].pic, 'icon:server');
  const v2 = vs.save({ ...v, links: [{ a: v.items[0].id, b: v.items[2].id }, { a: v.items[2].id, b: v.items[0].id }, { a: v.items[0].id, b: v.items[0].id }] }); assert.equal(v2.links.length, 1);
  assert.throws(() => vs.save({ name: '' }), /name/);
  const v3 = vs.save({ name: 'Pics', items: [{ kind: 'device', src: 'poll', ref: 'p1', pic: 'icon:switch-24port' }, { kind: 'device', src: 'poll', ref: 'p2', pic: 'icon:rectifier-shelf' }, { kind: 'device', src: 'poll', ref: 'p3', pic: 'icon:a b' }], links: [] });
  assert.deepEqual(v3.items.map((i) => i.pic), ['icon:switch-24port', 'icon:rectifier-shelf', 'icon:server'], '1.99.13 modern picture names (with digits and hyphens) are kept');
});
test('pictures: only real PNG / JPEG / WebP are kept, and are served back', () => {
  const { vs } = mk();
  assert.equal(imageType(PNG).type, 'image/png'); assert.equal(imageType(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>')).type, 'image/svg+xml'); assert.equal(imageType(Buffer.from('<html><svg>')), null);
  assert.throws(() => vs.saveImage('data:image/png;base64,' + Buffer.from('hello world').toString('base64')), /not a PNG/);
  assert.throws(() => vs.saveImage('data:image/gif;base64,AAAA'), /PNG, JPEG, WebP or SVG/); const sid = vs.saveImage('data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>').toString('base64')); assert.equal(vs.image(sid).type, 'image/svg+xml');
  const id = vs.saveImage('data:image/png;base64,' + PNG.toString('base64')); const im = vs.image(id); assert.equal(im.type, 'image/png'); assert.deepEqual(im.buf, PNG);
  assert.equal(vs.image('../../etc/passwd'), null);
});
test('live state: colours, readings with value meanings, alarms, a shared address does not mix devices', () => {
  const { vs } = mk();
  const v = vs.save({ name: 'R', items: [{ kind: 'device', src: 'poll', ref: 'p1', readings: ['rtt', 't1', 'st'] }, { kind: 'device', src: 'poll', ref: 'p2' }, { kind: 'device', src: 'poll', ref: 'p3' }, { kind: 'device', src: 'dev', ref: 'sw-1' }, { kind: 'device', src: 'poll', ref: 'gone' }] });
  const st = vs.status(v.id).items, [a, b, c, d, e] = v.items.map((i) => st[i.id]);
  assert.equal(a.state, 'up'); assert.equal(a.sev, 4); assert.equal(a.open, 1);
  const det = vs.itemDetail(v.id, v.items[0].id); assert.deepEqual(det.readings.map((r) => r.text), ['22.46 °C', 'Fault']); assert.equal(det.readings[1].state, 'crit'); assert.equal(det.rtt, 12); assert.equal(det.alarms, 1); assert.equal(det.readings[0].spark.length, 2);
  assert.equal(b.state, 'down'); assert.equal(b.open, 0, 'p2 and p3 share 10.9.9.9: the alarm of another device on that address is not theirs'); assert.equal(c.open, 0);
  assert.equal(d.state, 'down'); assert.equal(e.state, 'gone');
  assert.equal(vs.itemAlarms(v.id, v.items[0].id).length, 1); assert.equal(vs.itemAlarms(v.id, 'nope'), null);
});
test('a box to another view shows the worst of that view', () => {
  const { vs } = mk(); const inner = vs.save({ name: 'Inner', items: [{ kind: 'device', src: 'poll', ref: 'p1' }, { kind: 'device', src: 'poll', ref: 'p2' }] });
  const outer = vs.save({ name: 'Outer', items: [{ kind: 'view', view: inner.id }] }); const s = vs.status(outer.id).items[outer.items[0].id];
  assert.equal(s.state, 'down'); assert.equal(s.down, 1); assert.equal(s.sev, 4);
});
test('1.99.14 links follow a port: polled interface state and use, or an open alarm on that port', () => {
  const { vs } = mk();
  const rt3 = vs.polling.state({ id: 'p3' }); rt3.ifaces = [{ name: 'Gi1/0/1', alias: 'uplink', status: 'up', speed: 1e9, in: 950e6, out: 10e6 }, { name: 'Gi1/0/2', status: 'down', speed: 1e9 }, { name: 'Gi1/0/3', status: 'up', speed: 1e9, in: 1e6, out: 2e6 }];
  vs.alarms.open.set(3, { id: 3, dev: 'sw-1', src_ip: '10.1.1.1', severity: 2, state: 'open', rule_name: 'Port down', inst: 'gi0/5', inst_txt: 'Gi0/5', first_ts: 3 });
  const v = vs.save({ name: 'L', items: [{ kind: 'device', src: 'poll', ref: 'p1' }, { kind: 'device', src: 'poll', ref: 'p3' }, { kind: 'device', src: 'dev', ref: 'sw-1' }, { kind: 'device', src: 'poll', ref: 'p2' }] });
  const [i1, i3, isw, i2] = v.items.map((i) => i.id);
  const v2 = vs.save({ ...v, links: [{ a: i1, b: i3, port: { end: 'b', name: 'gi1/0/1' }, show: 'util' }, { a: i3, b: isw, port: { end: 'a', name: 'Gi1/0/2' } }, { a: i1, b: isw, port: { end: 'b', name: 'Gi0/5' }, label: 'To sw' }, { a: i1, b: i2, port: { end: 'a', name: '' } }, { a: isw, b: i1 }] });
  assert.equal(v2.links.length, 4, 'a second link between the same two devices is dropped'); assert.equal(v2.links[3].port, null, 'an empty port name means the link follows both devices');
  const L = vs.status(v2.id).links;
  assert.equal(L[0].state, 'warn', '95% used'); assert.match(L[0].text, /^95% · 950\.0 Mbit\/s$/);
  assert.equal(L[1].state, 'down'); assert.equal(L[1].text, 'Gi1/0/2 down');
  assert.equal(L[2].state, 'down', 'an open critical alarm on that port of the syslog device'); assert.equal(L[2].text, 'To sw · Gi0/5 down');
  const v3 = vs.save({ ...v2, links: [{ a: i1, b: i2 }, { a: i1, b: i3, port: { end: 'b', name: 'Gi1/0/3' } }] }); const L3 = vs.status(v3.id).links;
  assert.equal(L3[0].state, 'down', 'no port: down when a device at either end does not answer'); assert.equal(L3[1].state, 'up'); assert.equal(L3[1].text, 'Gi1/0/3 0%');
  assert.deepEqual(vs.itemPorts(v3.id, i3).ports.map((p) => p.name), ['Gi1/0/1', 'Gi1/0/2', 'Gi1/0/3']); assert.deepEqual(vs.itemPorts(v.id, isw).ports.map((p) => p.name), ['Gi0/5']);
});
