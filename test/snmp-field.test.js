'use strict';
// 1.99.2 situations seen with real devices of every kind, whatever the vendor
const test = require('node:test'); const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const { startAgent } = require('./fake-snmp-agent');
const { SnmpClient, toNumber, toText } = require('../src/snmpclient');
const { Collector } = require('../src/pollcore');
const GETBULK = 0xa5, GET = 0xa0;
const MIB = [['1.3.6.1.2.1.1.3.0', 'timeticks', 5000], ['1.3.6.1.4.1.99999.1.1.0', 'integer', 230], ['1.3.6.1.4.1.99999.2.1.1', 'integer', 11], ['1.3.6.1.4.1.99999.2.1.2', 'integer', 12], ['1.3.6.1.4.1.99999.2.1.3', 'integer', 13]];
const T = (port, version = 'v2c') => ({ host: '127.0.0.1', port, version, community: 'public', timeoutMs: 600, retries: 0 });

test('an answer from another address of the same device is accepted', async () => {
  const other = dgram.createSocket('udp4'); await new Promise((r) => other.bind(0, '127.0.0.2', r));
  const ag = await startAgent({ mib: MIB, replyFrom: other });
  try { const r = await new SnmpClient({ gapMs: 0 }).get(T(ag.port), ['1.3.6.1.4.1.99999.1.1.0']); assert.equal(r.vbs[0].value, 230); }
  finally { ag.close(); other.close(); }
});

for (const mode of ['error', 'silent']) {
  test(`a device without GETBULK (${mode}) is walked with GETNEXT`, async () => {
    const ag = await startAgent({ mib: MIB, hook: (tag) => (tag === GETBULK ? (mode === 'error' ? { status: 5, index: 1, vbs: [] } : 'drop') : null) });
    try {
      const c = new SnmpClient({ gapMs: 0 }); const w = await c.walk(T(ag.port), '1.3.6.1.4.1.99999.2');
      assert.deepEqual(w.vbs.map((v) => v.value), [11, 12, 13]);
      const w2 = await c.walk(T(ag.port), '1.3.6.1.4.1.99999.2'); assert.equal(w2.vbs.length, 3, 'remembered, no bulk tried again');
    } finally { ag.close(); }
  });
}

test('one unknown object among many does not fail the request (general error split in halves)', async () => {
  const BAD = '1.3.6.1.4.1.99999.9.9.0';
  const ag = await startAgent({ mib: MIB, hook: (tag, oids) => (tag === GET && oids.some((o) => (Array.isArray(o) ? o.join('.') : String(o)) === BAD) ? { status: 5, index: 1, vbs: oids.map((o) => ({ oid: o, type: 'null', value: null })) } : null) });
  try {
    const r = await new SnmpClient({ gapMs: 0 }).get(T(ag.port), ['1.3.6.1.2.1.1.3.0', BAD, '1.3.6.1.4.1.99999.1.1.0']);
    assert.equal(r.vbs[0].value, 5000); assert.equal(r.vbs[1].type, 'noSuchObject'); assert.equal(r.vbs[2].value, 230);
  } finally { ag.close(); }
});

test('a walk stops when the device goes back or repeats (never loops)', async () => {
  const ag = await startAgent({ mib: MIB, hook: (tag, oids) => { const o = Array.isArray(oids[0]) ? oids[0].join('.') : String(oids[0]); if (o === '1.3.6.1.4.1.99999.2.1.2') return { status: 0, index: 0, vbs: [{ oid: '1.3.6.1.4.1.99999.2.1.1', type: 'integer', value: 11 }] }; return null; } });
  try { const w = await new SnmpClient({ gapMs: 0 }).walk(T(ag.port, 'v1'), '1.3.6.1.4.1.99999.2'); assert.deepEqual(w.vbs.map((v) => v.value), [11, 12]); }
  finally { ag.close(); }
});

test('values: opaque float and double, numbers inside text, binary as hex, big counters', () => {
  const f = Buffer.alloc(7); f[0] = 0x9f; f[1] = 0x78; f[2] = 4; f.writeFloatBE(23.5, 3);
  const d = Buffer.alloc(11); d[0] = 0x9f; d[1] = 0x79; d[2] = 8; d.writeDoubleBE(-12.25, 3);
  assert.equal(toNumber({ type: 'opaque', value: f }), 23.5); assert.equal(toNumber({ type: 'opaque', value: d }), -12.25);
  assert.equal(toText({ type: 'octets', value: Buffer.from([0x00, 0x1a, 0x2b, 0x3c, 0x4d, 0x5e]) }), '00:1A:2B:3C:4D:5E');
  assert.equal(toText({ type: 'octets', value: Buffer.from('Battery OK') }), 'Battery OK');
  assert.equal(toNumber({ type: 'counter64', value: 12345678901234n }), 12345678901234);
});

test('readings from text values and counter restarts', async () => {
  const ag = await startAgent({ mib: [['1.3.6.1.2.1.1.3.0', 'timeticks', 1], ['1.3.6.1.4.1.99999.3.0', 'octets', 'Temp: 23.5 C'], ['1.3.6.1.4.1.99999.4.0', 'octets', '54.30'], ['1.3.6.1.4.1.99999.5.0', 'counter32', 4000000000]] });
  try {
    const col = new Collector(new SnmpClient({ gapMs: 0 }));
    const dev = { id: 'x', host: '127.0.0.1', port: ag.port, version: 'v2c', community: 'public', timeoutMs: 800, retries: 0, profile: 'p', ifMode: 'none' };
    const prof = { id: 'p', name: 'p', metrics: [{ k: 'temp', label: 'T', unit: 'C', srcs: [{ t: 'oid', oid: '1.3.6.1.4.1.99999.3.0' }] }, { k: 'v', label: 'V', unit: 'V', srcs: [{ t: 'oid', oid: '1.3.6.1.4.1.99999.4.0' }] }] };
    const r = await col.collect(dev, [prof]);
    assert.equal(r.readings.find((x) => x.k === 'temp')?.v, 23.5); assert.equal(r.readings.find((x) => x.k === 'v')?.v, 54.3);
    // counters: a wrap near the top counts, a drop from the middle (a restart) is skipped
    assert.equal(col.rate('c1', 4294967000, 1000), null); assert.ok(Math.abs(col.rate('c1', 704, 2000) - 1000) < 1e-6, 'wrap');
    assert.equal(col.rate('c2', 1000000, 1000), null); assert.equal(col.rate('c2', 500, 2000), null, 'restart: no spike');
  } finally { ag.close(); }
});
