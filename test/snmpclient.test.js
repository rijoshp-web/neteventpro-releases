'use strict';
const test = require('node:test'); const assert = require('node:assert');
const { startAgent, USER, DEFAULT_MIB } = require('./fake-snmp-agent');
const { SnmpClient, SnmpError, toNumber, toText } = require('../src/snmpclient');

const dev = (a, o = {}) => ({ host: '127.0.0.1', port: a.port, version: 'v2c', community: 'public', timeoutMs: 400, retries: 1, ...o });

for (const version of ['v1', 'v2c']) {
  test(`${version}: get, missing object, walk`, async () => {
    const a = await startAgent(), c = new SnmpClient();
    try {
      const t = dev(a, { version });
      const r = await c.get(t, ['1.3.6.1.2.1.1.1.0', '1.3.6.1.2.1.1.9.0', '1.3.6.1.2.1.1.3.0']);
      assert.equal(toText(r.vbs[0]), 'Test switch'); assert.equal(r.vbs[1].type, 'noSuchObject'); assert.equal(toNumber(r.vbs[2]), 123456);
      const w = await c.walk(t, '1.3.6.1.2.1.2.2.1.8');
      assert.deepEqual(w.vbs.map((v) => v.value), [1, 2, 1]); assert.deepEqual(w.vbs[2].oid.slice(-2), [8, 3]);
      const all = await c.walk(t, '1.3.6.1');
      assert.equal(all.vbs.length, DEFAULT_MIB.length);
      const big = await c.walk(t, '1.3.6.1.2.1.31.1.1.1.6'); assert.equal(toNumber(big.vbs[0]), 5000000000);
    } finally { a.close(); }
  });
}

test('wrong community times out; retries recover from a lost packet', async () => {
  const a = await startAgent({ drop: 1 }), c = new SnmpClient();
  try {
    const r = await c.get(dev(a, { retries: 2 }), ['1.3.6.1.2.1.1.1.0']); assert.equal(toText(r.vbs[0]), 'Test switch'); assert.equal(a.seen.requests, 2);
    await assert.rejects(c.get(dev(a, { community: 'nope', retries: 0 }), ['1.3.6.1.2.1.1.1.0']), (e) => e instanceof SnmpError && e.code === 'timeout');
  } finally { a.close(); }
});

test('unknown host name gives a clear error', async () => {
  await assert.rejects(new SnmpClient().get({ host: 'no-such-host.invalid', version: 'v2c', timeoutMs: 400, retries: 0 }, ['1.3.6.1.2.1.1.1.0']), (e) => e.code === 'resolve');
});

for (const [authProto, privProto] of [['SHA', 'AES128'], ['MD5', 'DES'], ['SHA256', 'AES256']]) {
  test(`v3 ${authProto}/${privProto}: discovery, get, walk, time resync`, async () => {
    const a = await startAgent(); Object.assign(USER, { authProto, privProto }); const c = new SnmpClient();
    try {
      const t = dev(a, { version: 'v3', user: USER.name, level: 'authPriv', authProto, authPass: USER.authPass, privProto, privPass: USER.privPass });
      const r = await c.get(t, ['1.3.6.1.2.1.1.1.0']); assert.equal(toText(r.vbs[0]), 'Test switch');
      const w = await c.walk(t, '1.3.6.1.2.1.2.2.1.8'); assert.equal(w.vbs.length, 3);
      a.setTime(5000);                                        // the device clock moved far away: a report, then a retry with the new time
      const r2 = await c.get(t, ['1.3.6.1.2.1.1.3.0']); assert.equal(toNumber(r2.vbs[0]), 123456);
    } finally { a.close(); Object.assign(USER, { authProto: 'SHA', privProto: 'AES128' }); }
  });
}

test('v3 wrong password gets no usable answer (error, not a crash)', async () => {
  const a = await startAgent(), c = new SnmpClient();
  try {
    await assert.rejects(c.get(dev(a, { version: 'v3', user: USER.name, level: 'authPriv', authProto: 'SHA', authPass: 'wrongwrong1', privProto: 'AES128', privPass: USER.privPass, retries: 0 }), ['1.3.6.1.2.1.1.1.0']), SnmpError);
  } finally { a.close(); }
});

test('1.49: polite polling: one request at a time per device, with a pause between them', async () => {
  const a = await startAgent(), c = new SnmpClient({ gapMs: 60 });
  try {
    const t = dev(a); let live = 0, peak = 0; const times = [];
    const orig = c.v12.bind(c); c.v12 = async (...x) => { live++; peak = Math.max(peak, live); times.push(Date.now()); try { return await orig(...x); } finally { live--; } };
    await Promise.all([1, 2, 3, 4].map(() => c.get(t, ['1.3.6.1.2.1.1.1.0'])));
    assert.equal(peak, 1, 'never two requests at once to one device');
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 55, 'pause between requests: ' + (times[i] - times[i - 1]));
    // many devices are not held up by each other's pause
    const b = await startAgent(); try { const t0 = Date.now(); await Promise.all([c.get(t, ['1.3.6.1.2.1.1.1.0']), c.get(dev(b), ['1.3.6.1.2.1.1.1.0'])]); assert.ok(Date.now() - t0 < 400); } finally { b.close(); }
  } finally { a.close(); }
});
