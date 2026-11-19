'use strict';
// 1.99.2 a controller that shows only its own vendor section (no sysUpTime, sysName, ...) is still polled:
// the answer time is kept and the readings set up for it are read, instead of "No SNMP answer".
const test = require('node:test'); const assert = require('node:assert/strict');
const { startAgent } = require('./fake-snmp-agent');
const { Collector } = require('../src/pollcore');
const { SnmpClient } = require('../src/snmpclient');

for (const version of ['v1', 'v2c']) {
  test(`vendor-only device over ${version}`, async () => {
    const ag = await startAgent({ mib: [['1.3.6.1.4.1.12148.10.10.5.5.0', 'integer', 5430], ['1.3.6.1.4.1.12148.10.10.6.5.0', 'integer', 87]] });
    const col = new Collector(new SnmpClient());
    try {
      const dev = { id: 'r1', host: '127.0.0.1', port: ag.port, version, community: 'public', timeoutMs: 1500, retries: 0, profile: 'mine', ifMode: 'none' };
      const prof = { id: 'mine', name: 'rectifier', metrics: [{ k: 'battV', label: 'Battery voltage', unit: 'V', srcs: [{ t: 'oid', oid: '1.3.6.1.4.1.12148.10.10.5.5.0', scale: 0.01 }] }, { k: 'loadA', label: 'Load current', unit: 'A', srcs: [{ t: 'oid', oid: '1.3.6.1.4.1.12148.10.10.6.5.0' }] }] };
      const res = await col.collect(dev, [prof]);
      assert.equal(res.ok, true, res.error); assert.equal(res.noStd, true);
      assert.ok(res.readings.some((r) => r.k === 'rtt'), 'answer time is kept');
      assert.ok(Math.abs(res.readings.find((r) => r.k === 'battV')?.v - 54.3) < 1e-9);
      assert.equal(res.readings.find((r) => r.k === 'loadA')?.v, 87);
      assert.ok(!res.readings.some((r) => r.k === 'uptime'));
      const t = await col.test(dev, () => 'x'); assert.equal(t.ok, true); assert.equal(t.noStd, true); assert.match(t.note, /vendor values/);
    } finally { ag.close(); }
  });
}
