'use strict';
// A small fake SNMP device for tests: answers GET / GETNEXT / GETBULK for v1, v2c and v3 (user "monitor"). startAgent({ mib, drop, time }) -> { port, set(oid, value), close(), setTime(t), seen }
const dgram = require('node:dgram');
const B = require('../src/ber'); const V = require('../src/snmpv3');
const { T, tlv, encSigned, header, readSigned, readVarbinds } = B;

// ---- a small SNMP device (agent) for the tests: answers GET / GETNEXT / GETBULK for v1, v2c and v3 ----
const DEFAULT_MIB = [
  ['1.3.6.1.2.1.1.1.0', 'octets', 'Test switch'], ['1.3.6.1.2.1.1.3.0', 'timeticks', 123456],
  ['1.3.6.1.2.1.2.2.1.8.1', 'integer', 1], ['1.3.6.1.2.1.2.2.1.8.2', 'integer', 2], ['1.3.6.1.2.1.2.2.1.8.3', 'integer', 1],
  ['1.3.6.1.2.1.31.1.1.1.6.1', 'counter64', 5000000000], ['1.3.6.1.2.1.31.1.1.1.6.2', 'counter64', 7],
  ['1.3.6.1.4.1.9.9.109.1.1.1.1.8.1', 'gauge32', 42],
];
const build = (list) => list.map(([o, type, value]) => ({ oid: B.parseOid(o), type, value })).sort((a, b) => cmp(a.oid, b.oid));
let MIB = build(DEFAULT_MIB);
function cmp(a, b) { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; }

function answer(kind, oids, maxRep, v1) {       // -> { status, index, vbs }
  const vbs = [];
  if (kind === 0xa0) {
    for (let i = 0; i < oids.length; i++) {
      const hit = MIB.find((m) => cmp(m.oid, oids[i]) === 0);
      if (!hit) { if (v1) return { status: 2, index: i + 1, vbs: oids.map((o) => ({ oid: o, type: 'null', value: null })) }; vbs.push({ oid: oids[i], type: 'noSuchObject' }); } else vbs.push(hit);
    }
  } else {
    const n = kind === 0xa5 ? maxRep : 1;
    for (const o of oids) { let cur = o; for (let k = 0; k < n; k++) { const nx = MIB.find((m) => cmp(m.oid, cur) > 0); if (!nx) { if (v1) return { status: 2, index: 1, vbs: [{ oid: o, type: 'null', value: null }] }; vbs.push({ oid: cur, type: 'endOfMibView' }); break; } vbs.push(nx); cur = nx.oid; } }
  }
  return { status: 0, index: 0, vbs };
}

function respPdu(id, status, index, vbs) {
  const real = vbs.map((v) => (v.type === 'noSuchObject' || v.type === 'endOfMibView' ? { ...v, raw: v.type === 'noSuchObject' ? 0x80 : 0x82 } : v));
  // encode normal values with encVarbinds, missing markers by hand
  const parts = real.map((v) => {
    if (v.raw) { const one = B.encVarbinds([{ oid: v.oid, type: 'null' }]); const h = header(one, 0, one.length), inner = header(one, h.start, h.end), o = header(one, inner.start, inner.end); return tlv(T.SEQUENCE, Buffer.concat([one.subarray(inner.start, o.end), Buffer.from([v.raw, 0])])); }
    const one = B.encVarbinds([v]); const h = header(one, 0, one.length); return one.subarray(h.start, h.end);
  });
  return tlv(0xa2, Buffer.concat([tlv(T.INTEGER, encSigned(id)), tlv(T.INTEGER, encSigned(status)), tlv(T.INTEGER, encSigned(index)), tlv(T.SEQUENCE, Buffer.concat(parts))]));
}

const AGENT_ENGINE = Buffer.from('80001f8880aabbccdd11223344', 'hex');
const USER = { name: 'monitor', level: 'authPriv', authProto: 'SHA', authPass: 'authpass123', privProto: 'AES128', privPass: 'privpass123' };

function startAgent(opts = {}) {
  MIB = build(opts.mib || DEFAULT_MIB);
  const sock = dgram.createSocket('udp4'); const seen = { requests: 0 }; let bootsTime = opts.time ?? 1000;
  sock.on('message', (buf, rinfo) => {
    seen.requests++; if (opts.drop && seen.requests <= opts.drop) return;
    try {
      const top = header(buf, 0, buf.length), vh = header(buf, top.start, top.end), ver = Number(readSigned(buf, vh));
      if (ver === 3) {
        const m = V.parseMessage(buf);
        if (!m.engineId.length) { // discovery
          const pdu = tlv(0xa8, Buffer.concat([tlv(T.INTEGER, encSigned(0)), tlv(T.INTEGER, encSigned(0)), tlv(T.INTEGER, encSigned(0)), B.encVarbinds([])]));
          return sock.send(V.buildMessage({ msgId: m.msgId, engineId: AGENT_ENGINE, boots: 3, time: bootsTime, user: '', keys: null, pdu }), rinfo.port, rinfo.address);
        }
        const keys = V.userKeys(USER, AGENT_ENGINE);
        let o; try { o = V.openMessage(buf, () => keys); } catch { return; }     // a wrong password: no answer (a real device sends a report; tested separately)
        if (Math.abs(m.time - bootsTime) > 150 || m.boots !== 3) { // not in time window
          const pdu = tlv(0xa8, Buffer.concat([tlv(T.INTEGER, encSigned(0)), tlv(T.INTEGER, encSigned(0)), tlv(T.INTEGER, encSigned(0)), B.encVarbinds([{ oid: '1.3.6.1.6.3.15.1.1.2.0', type: 'counter32', value: 1 }])]));
          return sock.send(V.buildMessage({ msgId: m.msgId, engineId: AGENT_ENGINE, boots: 3, time: bootsTime, user: USER.name, keys, pdu }), rinfo.port, rinfo.address);
        }
        const a = answer(o.tag, o.varbinds.map((v) => v.oid), o.errorIndex || 20, false);
        const pdu = respPdu(o.requestId, a.status, a.index, a.vbs);
        return sock.send(V.buildMessage({ msgId: m.msgId, engineId: AGENT_ENGINE, boots: 3, time: bootsTime, user: USER.name, keys, pdu }), rinfo.port, rinfo.address);
      }
      const ch = header(buf, vh.end, top.end), community = buf.toString('latin1', ch.start, ch.end); if (community !== 'public') return;
      const ph = header(buf, ch.end, top.end), r = header(buf, ph.start, ph.end), e1 = header(buf, r.end, ph.end), e2 = header(buf, e1.end, ph.end), vb = header(buf, e2.end, ph.end);
      const oids = readVarbinds(buf, vb).map((v) => v.oid), a = answer(ph.tag, oids, Number(readSigned(buf, e2)) || 20, ver === 0);
      const pdu = respPdu(Number(readSigned(buf, r)), a.status, a.index, a.vbs);
      sock.send(tlv(T.SEQUENCE, Buffer.concat([tlv(T.INTEGER, encSigned(ver)), tlv(T.OCTETS, Buffer.from(community)), pdu])), rinfo.port, rinfo.address);
    } catch { /* ignore */ }
  });
  return new Promise((res) => sock.bind(opts.port || 0, opts.host || '127.0.0.1', () => res({ sock, port: sock.address().port, seen, close: () => sock.close(), setTime: (t) => { bootsTime = t; }, set: (oid, value) => { const h = MIB.find((m) => cmp(m.oid, B.parseOid(oid)) === 0); if (h) h.value = value; }, mib: MIB })));
}


module.exports = { startAgent, USER, DEFAULT_MIB, AGENT_ENGINE };
