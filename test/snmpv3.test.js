'use strict';
const test = require('node:test'); const assert = require('node:assert');
const crypto = require('node:crypto');
const B = require('../src/ber'); const V = require('../src/snmpv3');

const eng = () => new V.V3Engine(null);
const user = (o) => ({ name: 'u1', level: 'authPriv', authProto: 'SHA', authPass: 'authpass123', privProto: 'AES128', privPass: 'privpass123', ...o });
const sender = Buffer.from('80001f8880aabbccdd11223344', 'hex');           // the device's own engine ID
const trapPdu = () => B.pduV2({ trapOid: '1.3.6.1.6.3.1.1.5.3', requestId: 7, uptime: 100, varbinds: [{ oid: '1.3.6.1.2.1.2.2.1.1.3', type: 'integer', value: 3 }] });

test('RFC 3414 key localization test vectors (password maplesyrup)', () => {
  const id = Buffer.from('000000000000000000000002', 'hex');
  assert.equal(V.userKeys({ level: 'authNoPriv', authProto: 'MD5', authPass: 'maplesyrup' }, id).auth.toString('hex'), '526f5eed9fcce26f8964c2930787d82b');
  assert.equal(V.userKeys({ level: 'authNoPriv', authProto: 'SHA', authPass: 'maplesyrup' }, id).auth.toString('hex'), '6695febc9288e36282235fc7151f128497b38f3f');
});

for (const authProto of ['MD5', 'SHA', 'SHA256', 'SHA512']) for (const privProto of ['DES', 'AES128', 'AES256']) {
  test(`trap from a device: ${authProto} + ${privProto}`, () => {
    const e = eng(), u = user({ authProto, privProto });
    const pkt = V.buildMessage({ msgId: 11, engineId: sender, boots: 5, time: 1000, user: 'u1', keys: V.userKeys(u, sender), pdu: trapPdu() });
    const r = e.handle(pkt, [u]); assert.ok(r.trap, r.error); assert.equal(r.trap.kind, 'trap2'); assert.equal(r.trap.varbinds.length, 3); assert.equal(r.trap.user, 'u1'); assert.equal(r.trap.level, 'authPriv');
    assert.equal(e.handle(pkt, [user({ authProto, privProto, authPass: 'wrong' })]).error?.startsWith('authentication failed'), true);
    assert.match(e.handle(pkt, [user({ authProto, privProto, privPass: 'wrongwrong1' })]).error, /decrypt|decrypted/);
  });
}
test('authNoPriv and noAuthNoPriv traps; wrong user and wrong level are refused', () => {
  const e = eng();
  const a = user({ level: 'authNoPriv' }), pkt = V.buildMessage({ msgId: 1, engineId: sender, boots: 1, time: 5, user: 'u1', keys: V.userKeys(a, sender), pdu: trapPdu() });
  assert.ok(e.handle(pkt, [a]).trap); assert.match(e.handle(pkt, [user()]).error, /authNoPriv/); assert.match(e.handle(pkt, []).error, /unknown user/);
  const n = user({ level: 'noAuthNoPriv' }); assert.ok(e.handle(V.buildMessage({ msgId: 2, engineId: sender, boots: 1, time: 5, user: 'u1', keys: V.userKeys(n, sender), pdu: trapPdu() }), [n]).trap);
});
test('a tampered message fails the digest and an old one is ignored as a replay', () => {
  const e = eng(), u = user({ level: 'authNoPriv' });
  const pkt = V.buildMessage({ msgId: 1, engineId: sender, boots: 2, time: 1000, user: 'u1', keys: V.userKeys(u, sender), pdu: trapPdu() }); const bad = Buffer.from(pkt); bad[bad.length - 3] ^= 1;
  assert.match(e.handle(bad, [u]).error, /authentication failed/);
  assert.ok(e.handle(pkt, [u]).trap);
  assert.match(e.handle(V.buildMessage({ msgId: 2, engineId: sender, boots: 1, time: 999, user: 'u1', keys: V.userKeys(u, sender), pdu: trapPdu() }), [u]).error, /replay/);
});
test('inform: discovery is answered, then the inform is acknowledged', () => {
  const e = eng(), u = user();
  const disc = B.tlv(0x30, Buffer.concat([B.tlv(2, B.encSigned(3)), B.tlv(0x30, Buffer.concat([B.tlv(2, B.encSigned(99)), B.tlv(2, B.encSigned(65507)), B.tlv(4, Buffer.from([4])), B.tlv(2, B.encSigned(3))])),
    B.tlv(4, B.tlv(0x30, Buffer.concat([B.tlv(4, Buffer.alloc(0)), B.tlv(2, B.encSigned(0)), B.tlv(2, B.encSigned(0)), B.tlv(4, Buffer.alloc(0)), B.tlv(4, Buffer.alloc(0)), B.tlv(4, Buffer.alloc(0))]))),
    B.tlv(0x30, Buffer.concat([B.tlv(4, Buffer.alloc(0)), B.tlv(4, Buffer.alloc(0)), B.tlv(0xa0, Buffer.concat([B.tlv(2, B.encSigned(1)), B.tlv(2, B.encSigned(0)), B.tlv(2, B.encSigned(0)), B.tlv(0x30, Buffer.alloc(0))]))]))]));
  const rep = e.handle(disc, [u]); assert.ok(rep.report); const pm = V.parseMessage(rep.report); assert.ok(pm.engineId.equals(e.engineId)); assert.equal(pm.boots, e.boots);
  const pdu = B.pduV2({ inform: true, trapOid: '1.3.6.1.6.3.1.1.5.3', requestId: 42, varbinds: [] });
  const inf = V.buildMessage({ msgId: 100, engineId: e.engineId, boots: e.boots, time: e.now(), user: 'u1', keys: V.userKeys(u, e.engineId), reportable: true, contextEngineId: e.engineId, pdu });
  const r = e.handle(inf, [u]); assert.ok(r.trap, r.error); assert.equal(r.trap.kind, 'inform'); assert.ok(r.reply);
  const ack = e.handle(r.reply, [u]); assert.match(ack.error, /not a trap/);        // the reply is a valid, authentic, decryptable message (only not a trap)
  const old = V.buildMessage({ msgId: 101, engineId: e.engineId, boots: e.boots, time: e.now() + 1000, user: 'u1', keys: V.userKeys(u, e.engineId), pdu }); assert.match(e.handle(old, [u]).error, /time window/);
});
