'use strict';
const test = require('node:test'); const assert = require('node:assert'); const path = require('node:path'); const { spawn } = require('node:child_process');
const { SnmpClient, toNumber, toText } = require('../src/snmpclient');

test('tools/fake-device.js answers like a device and reacts to commands', async (t) => {
  const port = 11613, p = spawn(process.execPath, [path.join(__dirname, '..', 'tools', 'fake-device.js'), '--port', String(port)], { stdio: ['pipe', 'pipe', 'ignore'] });
  t.after(() => p.kill());
  await new Promise((ok) => p.stdout.once('data', ok));
  const c = new SnmpClient(), dev = { host: '127.0.0.1', port, version: 'v2c', community: 'public', timeoutMs: 800, retries: 1 };
  const r = await c.get(dev, ['1.3.6.1.2.1.1.5.0', '1.3.6.1.2.1.1.3.0']); assert.strictEqual(toText(r.vbs[0]), 'FAKE-DEVICE-1'); assert.ok(toNumber(r.vbs[1]) > 0);
  const rows = await c.walk(dev, '1.3.6.1.4.1.99999.1.1.2'); assert.deepStrictEqual(rows.vbs.map((v) => toNumber(v)), [22, 6, 6, 6]);   /* one table column: 4 rows */
  p.stdin.write('critical\n'); await new Promise((ok) => setTimeout(ok, 300));
  const s = await c.get(dev, ['1.3.6.1.4.1.99999.1.1.3.1', '1.3.6.1.4.1.99999.1.1.2.1']); assert.strictEqual(toNumber(s.vbs[0]), 3); assert.strictEqual(toNumber(s.vbs[1]), 45);
  p.stdin.write('down 2\n'); await new Promise((ok) => setTimeout(ok, 300));
  assert.strictEqual(toNumber((await c.get(dev, ['1.3.6.1.2.1.2.2.1.8.2'])).vbs[0]), 2);
});
