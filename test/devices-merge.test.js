'use strict';
const test = require('node:test'); const assert = require('node:assert');
const { Engine } = require('../src/engine');
const { nameOf, numberOf } = require('../src/enterprises');
const fake = () => { const e = Object.create(Engine.prototype); e.devices = new Map(); e.dirtyDevices = new Set(); e.store = { deleteDevice() {} }; return e; };
const dev = (key, ips, extra = {}) => ({ key, host: key, srcIp: ips[0], srcIps: ips, count: 5, sys: 5, traps: 0, firstSeen: 100, lastSeen: 200, sev: new Array(10).fill(0), ...extra });

test('a device that sends syslog by name and traps by address is one device', () => {
  const e = fake(); e.devices.set('sw1', dev('sw1', ['10.0.0.1'])); e.devices.set('10.0.0.1', dev('10.0.0.1', ['10.0.0.1'], { traps: 3, sys: 0, count: 3, vendor: 'Cisco', firstSeen: 50 }));
  e.mergeDuplicateDevices(); assert.strictEqual(e.devices.size, 1);
  assert.strictEqual(e.resolveKey('10.0.0.1', '10.0.0.1'), 'sw1');                         // a new trap from that address goes to sw1
  const d = e.devices.get('sw1'); assert.strictEqual(d.count, 8); assert.strictEqual(d.traps, 3); assert.strictEqual(d.vendor, 'Cisco'); assert.strictEqual(d.firstSeen, 50);
});
test('a relay (several named devices behind one address) is not merged', () => {
  const e = fake(); e.devices.set('a', dev('a', ['10.9.9.9'])); e.devices.set('b', dev('b', ['10.9.9.9'])); e.devices.set('10.9.9.9', dev('10.9.9.9', ['10.9.9.9']));
  assert.strictEqual(e.resolveKey('10.9.9.9', '10.9.9.9'), '10.9.9.9'); e.mergeDuplicateDevices(); assert.strictEqual(e.devices.size, 3);
});
test('every enterprise number gets a vendor name', () => {
  assert.strictEqual(nameOf(674), 'Dell'); assert.strictEqual(nameOf(12148), 'Eltek'); assert.strictEqual(nameOf(35188), 'Eventide'); assert.strictEqual(nameOf(99999), 'Enterprise 99999');
  assert.strictEqual(numberOf('1.3.6.1.4.1.674.10892.5.3.2.1.0.2185'), 674); assert.strictEqual(numberOf('1.3.6.1.6.3.1.1.5.3'), 0);
});
