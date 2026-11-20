'use strict';
// 1.99.7 a device's vendor: set by hand (wins), found from its messages or traps, or found by SNMP polling (sysObjectID)
const test = require('node:test');
const assert = require('node:assert');
const { Engine } = require('../src/engine');
const ENT = require('../src/enterprises');

test('enterprise 28458 is Nokia', () => { assert.strictEqual(ENT.nameOf(28458), 'Nokia'); });
test('vendor by hand wins, then found, then SNMP polling', () => {
  let cfg = { deviceInfo: {} };
  const e = Object.create(Engine.prototype);
  e.config = { get: () => cfg }; e.devices = new Map(); e.alarms = null; e.isMuted = () => false;
  const dev = (key, ip, host, vendor) => ({ key, srcIp: ip, srcIps: [ip], host, firstSeen: 1, lastSeen: Date.now(), count: 1, sev: new Array(10).fill(0), silent: false, vendor });
  e.devices.set('a', dev('a', '10.0.0.1', 'rect-a', '')); e.devices.set('b', dev('b', '10.0.0.2', 'sw-b', 'Dell')); e.devices.set('c', dev('c', '10.0.0.3', 'x', ''));
  e.polledVendors = () => new Map([['10.0.0.1', 'Eltek']]);
  let l = e.deviceList(); const v = (k) => l.find((d) => d.key === k);
  assert.strictEqual(v('a').vendor, 'Eltek'); assert.strictEqual(v('b').vendor, 'Dell'); assert.strictEqual(v('c').vendor, '');
  cfg = { deviceInfo: { c: { vendor: 'Nevion' }, b: { vendor: 'Dell EMC' } } }; e._devList = null;
  l = e.deviceList();
  assert.strictEqual(v('c').vendor, 'Nevion'); assert.strictEqual(v('b').vendor, 'Dell EMC'); assert.strictEqual(v('b').vendorFound, 'Dell');
});
