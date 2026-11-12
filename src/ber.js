'use strict';
// Minimal BER reader/writer for SNMP v1/v2c messages (RFC 1157, RFC 3416). Every length is checked against the packet before it is used,
// because the input comes straight from the network.

class BerError extends Error {}

const T = { INTEGER: 0x02, OCTETS: 0x04, NULL: 0x05, OID: 0x06, SEQUENCE: 0x30, IPADDR: 0x40, COUNTER32: 0x41, GAUGE32: 0x42, TIMETICKS: 0x43, OPAQUE: 0x44, COUNTER64: 0x46,
  NOSUCHOBJECT: 0x80, NOSUCHINSTANCE: 0x81, ENDOFMIBVIEW: 0x82, PDU_GET_RESPONSE: 0xa2, PDU_TRAP_V1: 0xa4, PDU_INFORM: 0xa6, PDU_TRAP_V2: 0xa7 };
const TYPE_NAMES = { 0x02: 'integer', 0x04: 'octets', 0x05: 'null', 0x06: 'oid', 0x40: 'ipaddress', 0x41: 'counter32', 0x42: 'gauge32', 0x43: 'timeticks', 0x44: 'opaque', 0x46: 'counter64',
  0x80: 'noSuchObject', 0x81: 'noSuchInstance', 0x82: 'endOfMibView' };
const MAX_VARBINDS = 100, MAX_OID_LEN = 128;

function header(buf, pos, end) {
  if (pos + 2 > end) throw new BerError('truncated');
  const tag = buf[pos++];
  if ((tag & 0x1f) === 0x1f) throw new BerError('multi-byte tags are not used by SNMP');
  let len = buf[pos++];
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4 || pos + n > end) throw new BerError('bad length');
    len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[pos++];
  }
  if (pos + len > end) throw new BerError('length runs past the end of the packet');
  return { tag, start: pos, end: pos + len };
}

function readSigned(buf, h) {
  const n = h.end - h.start; if (n < 1 || n > 8) throw new BerError('bad integer length');
  let v = 0n; for (let i = h.start; i < h.end; i++) v = (v << 8n) | BigInt(buf[i]);
  if (buf[h.start] & 0x80) v -= 1n << BigInt(8 * n);
  return v;
}
function readUnsigned(buf, h) {
  const n = h.end - h.start; if (n < 1 || n > 9) throw new BerError('bad integer length');
  let v = 0n; for (let i = h.start; i < h.end; i++) v = (v << 8n) | BigInt(buf[i]);
  return v;
}
const num = (b) => (b >= -(2n ** 53n) && b <= 2n ** 53n ? Number(b) : b.toString());

function readOid(buf, h) {
  if (h.end <= h.start) throw new BerError('empty OID');
  const out = []; let v = 0, bytes = 0, first = true;
  for (let i = h.start; i < h.end; i++) {
    const b = buf[i]; if (++bytes > 5) throw new BerError('OID component too large');
    v = v * 128 + (b & 0x7f);
    if (!(b & 0x80)) {
      if (first) { if (v < 40) out.push(0, v); else if (v < 80) out.push(1, v - 40); else out.push(2, v - 80); first = false; } else out.push(v);
      if (out.length > MAX_OID_LEN) throw new BerError('OID too long');
      v = 0; bytes = 0;
    }
  }
  if (bytes) throw new BerError('OID ends in the middle of a component');
  return out;
}

function readValue(buf, h) {
  const type = TYPE_NAMES[h.tag];
  switch (h.tag) {
    case T.INTEGER: return { type, value: num(readSigned(buf, h)) };
    case T.COUNTER32: case T.GAUGE32: case T.TIMETICKS: return { type, value: num(readUnsigned(buf, h)) };
    case T.COUNTER64: return { type, value: num(readUnsigned(buf, h)) };
    case T.OCTETS: case T.OPAQUE: return { type, value: Buffer.from(buf.subarray(h.start, h.end)) };
    case T.IPADDR: { if (h.end - h.start !== 4) throw new BerError('bad IP address'); return { type, value: [...buf.subarray(h.start, h.end)].join('.') }; }
    case T.OID: return { type, value: readOid(buf, h) };
    case T.NULL: case T.NOSUCHOBJECT: case T.NOSUCHINSTANCE: case T.ENDOFMIBVIEW: return { type: type || 'null', value: null };
    default: return { type: 'unknown', value: Buffer.from(buf.subarray(h.start, h.end)) };
  }
}

function readVarbinds(buf, h) {
  if (h.tag !== T.SEQUENCE) throw new BerError('variable bindings expected');
  const out = []; let p = h.start;
  while (p < h.end) {
    if (out.length >= MAX_VARBINDS) break;              // ignore the rest of an absurdly long list
    const vb = header(buf, p, h.end); if (vb.tag !== T.SEQUENCE) throw new BerError('bad variable binding');
    const o = header(buf, vb.start, vb.end); if (o.tag !== T.OID) throw new BerError('OID expected');
    const v = header(buf, o.end, vb.end);
    out.push({ oid: readOid(buf, o), ...readValue(buf, v) });
    p = vb.end;
  }
  return out;
}

/** Decodes an SNMP message. Returns { version: 3 } for SNMPv3 (not decoded). Throws BerError when the packet is not a valid trap/inform. */
function decodeMessage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) throw new BerError('too short');
  const top = header(buf, 0, buf.length); if (top.tag !== T.SEQUENCE) throw new BerError('not an SNMP message');
  const vh = header(buf, top.start, top.end); if (vh.tag !== T.INTEGER) throw new BerError('version expected');
  const version = Number(readSigned(buf, vh));
  if (version === 3) return { version: 3 };
  if (version !== 0 && version !== 1) throw new BerError('unknown SNMP version');
  const ch = header(buf, vh.end, top.end); if (ch.tag !== T.OCTETS) throw new BerError('community expected');
  const community = buf.toString('latin1', ch.start, ch.end);
  const pdu = header(buf, ch.end, top.end);
  if (pdu.tag === T.PDU_TRAP_V1) {
    if (version !== 0) throw new BerError('SNMPv1 trap in a v2c message');
    let p = pdu.start;
    const e = header(buf, p, pdu.end); if (e.tag !== T.OID) throw new BerError('enterprise expected'); const enterprise = readOid(buf, e); p = e.end;
    const a = header(buf, p, pdu.end); if (a.tag !== T.IPADDR || a.end - a.start !== 4) throw new BerError('agent address expected'); const agentAddr = [...buf.subarray(a.start, a.end)].join('.'); p = a.end;
    const g = header(buf, p, pdu.end); if (g.tag !== T.INTEGER) throw new BerError('generic trap expected'); const generic = Number(readSigned(buf, g)); p = g.end;
    const s = header(buf, p, pdu.end); if (s.tag !== T.INTEGER) throw new BerError('specific trap expected'); const specific = Number(readSigned(buf, s)); p = s.end;
    const t = header(buf, p, pdu.end); if (t.tag !== T.TIMETICKS) throw new BerError('time stamp expected'); const uptime = Number(readUnsigned(buf, t)); p = t.end;
    const vbs = header(buf, p, pdu.end);
    return { version: 1, community, kind: 'trap1', enterprise, agentAddr, generic, specific, uptime, varbinds: readVarbinds(buf, vbs) };
  }
  if (pdu.tag === T.PDU_TRAP_V2 || pdu.tag === T.PDU_INFORM) {
    if (version !== 1) throw new BerError('SNMPv2 PDU in a v1 message');
    let p = pdu.start;
    const r = header(buf, p, pdu.end); if (r.tag !== T.INTEGER) throw new BerError('request id expected'); const requestId = readSigned(buf, r); p = r.end;
    const e1 = header(buf, p, pdu.end); p = e1.end; const e2 = header(buf, p, pdu.end); p = e2.end;
    const vbs = header(buf, p, pdu.end);
    return { version: 2, community, kind: pdu.tag === T.PDU_INFORM ? 'inform' : 'trap2', requestId, varbinds: readVarbinds(buf, vbs), varbindBytes: Buffer.from(buf.subarray(p, vbs.end)) };
  }
  throw new BerError('not a trap');
}

// ---- writing ----------------------------------------------------------------------------------------------------------------------
const encLen = (n) => { if (n < 128) return Buffer.from([n]); const b = []; while (n > 0) { b.unshift(n & 0xff); n = Math.floor(n / 256); } return Buffer.from([0x80 | b.length, ...b]); };
const tlv = (tag, content) => Buffer.concat([Buffer.from([tag]), encLen(content.length), content]);
function encSigned(v) {
  let n = BigInt(v); const out = [];
  for (;;) { out.unshift(Number(n & 0xffn)); n >>= 8n; const b = out[0]; if ((n === 0n && !(b & 0x80)) || (n === -1n && (b & 0x80))) break; }
  return Buffer.from(out);
}
function encUnsigned(v) {
  let n = BigInt(v); const out = [];
  do { out.unshift(Number(n & 0xffn)); n >>= 8n; } while (n > 0n);
  if (out[0] & 0x80) out.unshift(0);
  return Buffer.from(out);
}
function encOidBody(oid) {
  const a = oid.slice(); if (a.length < 2) throw new BerError('OID too short');
  const out = []; const push = (v) => { const t = [v & 0x7f]; v = Math.floor(v / 128); while (v > 0) { t.unshift((v & 0x7f) | 0x80); v = Math.floor(v / 128); } out.push(...t); };
  push(a[0] * 40 + a[1]); for (let i = 2; i < a.length; i++) push(a[i]);
  return Buffer.from(out);
}
const parseOid = (s) => (Array.isArray(s) ? s : String(s).split('.').filter((x) => x !== '').map(Number));

/** { type, value } -> BER bytes. type is one of the names in TYPE_NAMES */
function encodeValue(type, value) {
  switch (type) {
    case 'integer': return tlv(T.INTEGER, encSigned(value));
    case 'counter32': return tlv(T.COUNTER32, encUnsigned(value));
    case 'gauge32': return tlv(T.GAUGE32, encUnsigned(value));
    case 'timeticks': return tlv(T.TIMETICKS, encUnsigned(value));
    case 'counter64': return tlv(T.COUNTER64, encUnsigned(value));
    case 'octets': return tlv(T.OCTETS, Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8'));
    case 'opaque': return tlv(T.OPAQUE, Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8'));
    case 'oid': return tlv(T.OID, encOidBody(parseOid(value)));
    case 'ipaddress': return tlv(T.IPADDR, Buffer.from(String(value).split('.').map(Number)));
    case 'null': return tlv(T.NULL, Buffer.alloc(0));
    default: throw new BerError('cannot encode ' + type);
  }
}
const encVarbinds = (vbs) => tlv(T.SEQUENCE, Buffer.concat(vbs.map((v) => tlv(T.SEQUENCE, Buffer.concat([tlv(T.OID, encOidBody(parseOid(v.oid))), encodeValue(v.type, v.value)])))));

/** SNMPv2c trap or inform. varbinds[0..1] (sysUpTime.0, snmpTrapOID.0) are added for you. */
function pduV2(o) {
  const vbs = [{ oid: '1.3.6.1.2.1.1.3.0', type: 'timeticks', value: o.uptime ?? 0 }, { oid: '1.3.6.1.6.3.1.1.4.1.0', type: 'oid', value: o.trapOid }, ...(o.varbinds || [])];
  return tlv(o.inform ? T.PDU_INFORM : T.PDU_TRAP_V2, Buffer.concat([tlv(T.INTEGER, encSigned(o.requestId ?? 1)), tlv(T.INTEGER, encSigned(0)), tlv(T.INTEGER, encSigned(0)), encVarbinds(vbs)]));
}
function buildV2(o) {
  const pdu = pduV2(o);
  return tlv(T.SEQUENCE, Buffer.concat([tlv(T.INTEGER, encSigned(1)), tlv(T.OCTETS, Buffer.from(o.community ?? 'public')), pdu]));
}
/** SNMPv1 trap */
function buildV1(o) {
  const pdu = tlv(T.PDU_TRAP_V1, Buffer.concat([tlv(T.OID, encOidBody(parseOid(o.enterprise))), encodeValue('ipaddress', o.agentAddr || '0.0.0.0'), tlv(T.INTEGER, encSigned(o.generic ?? 6)),
    tlv(T.INTEGER, encSigned(o.specific ?? 0)), encodeValue('timeticks', o.uptime ?? 0), encVarbinds(o.varbinds || [])]));
  return tlv(T.SEQUENCE, Buffer.concat([tlv(T.INTEGER, encSigned(0)), tlv(T.OCTETS, Buffer.from(o.community ?? 'public')), pdu]));
}
/** the reply to an inform: same request id and variable bindings, error status 0 */
function buildInformReply(msg) {
  const pdu = tlv(T.PDU_GET_RESPONSE, Buffer.concat([tlv(T.INTEGER, encSigned(msg.requestId)), tlv(T.INTEGER, encSigned(0)), tlv(T.INTEGER, encSigned(0)), msg.varbindBytes]));
  return tlv(T.SEQUENCE, Buffer.concat([tlv(T.INTEGER, encSigned(1)), tlv(T.OCTETS, Buffer.from(msg.community, 'latin1')), pdu]));
}

module.exports = { header, readSigned, readUnsigned, readVarbinds, tlv, encSigned, encUnsigned, encVarbinds, pduV2, T, BerError, decodeMessage, buildV1, buildV2, buildInformReply, parseOid, MAX_OID_LEN };
