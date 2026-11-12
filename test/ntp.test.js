'use strict';
const test = require('node:test');
const assert = require('node:assert');
const dgram = require('node:dgram');
const { sample, validHost } = require('../src/ntp');
const E = 2208988800;

function fakeServer(aheadMs, { stratum = 2, li = 0, wrongOrigin = false } = {}) {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    s.on('message', (m, r) => {
      const o = Buffer.alloc(48); o[0] = (li << 6) | 0x24; o[1] = stratum; m.copy(o, 24, 40, 48); if (wrongOrigin) o.writeUInt32BE(1, 24);
      const t = (Date.now() + aheadMs) / 1000 + E; for (const off of [32, 40]) { o.writeUInt32BE(Math.floor(t), off); o.writeUInt32BE(Math.floor((t % 1) * 4294967296), off + 4); }
      s.send(o, r.port, r.address);
    });
    s.bind(0, '127.0.0.1', () => resolve(s));
  });
}

test('offset against a server 90 s ahead is measured within a few ms', async () => {
  const s = await fakeServer(90000); const r = await sample('127.0.0.1', s.address().port, 2);
  s.close(); assert.ok(Math.abs(r.offsetMs - 90000) < 50, String(r.offsetMs)); assert.strictEqual(r.stratum, 2);
});

test('a server that says it is unsynchronised, or answers the wrong request, is rejected', async () => {
  const a = await fakeServer(0, { li: 3 }); await assert.rejects(sample('127.0.0.1', a.address().port, 1), /not synchronised/); a.close();
  const b = await fakeServer(0, { wrongOrigin: true }); await assert.rejects(sample('127.0.0.1', b.address().port, 1), /No answer/); b.close();
});

test('host names are checked', () => {
  for (const ok of ['10.0.0.5', 'ntp.corp.local', 'ntp-1', '::1']) assert.ok(validHost(ok), ok);
  for (const bad of ['', 'a b', 'x;rm', '-x.', 'http://x']) assert.ok(!validHost(bad), bad);
});
