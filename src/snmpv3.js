'use strict';
// SNMPv3 (RFC 3411-3414) for NetEventPro: the User-based Security Model.
//  * receiving traps: the sender is the authoritative engine. Its engine ID is read from the message, the user's keys are made for that ID, the digest is checked and the data decrypted.
//  * receiving informs: this program is authoritative. Engine discovery is answered, the message is checked (digest and time window) and acknowledged with a response.
//  * sending traps (forwarder): this program is the authoritative engine; the receiving manager must be given our engine ID.
// Authentication: HMAC-MD5-96, HMAC-SHA-96, SHA-224/256/384/512.  Privacy: DES, AES-128, AES-192, AES-256 (the Blumenthal and Cisco/Reeder key extension for the longer keys).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const B = require('./ber');
const { T, tlv, encSigned, header, readSigned, readUnsigned, readVarbinds } = B;

const AUTH = { MD5: { hash: 'md5', len: 12 }, SHA: { hash: 'sha1', len: 12 }, SHA224: { hash: 'sha224', len: 16 }, SHA256: { hash: 'sha256', len: 24 }, SHA384: { hash: 'sha384', len: 32 }, SHA512: { hash: 'sha512', len: 48 } };
const PRIV = { DES: { key: 8, iv: 8 }, AES128: { key: 16 }, AES192: { key: 24 }, AES256: { key: 32 } };
const TIME_WINDOW = 150, MAX_MSG = 65507;
const OID_UNKNOWN_ENGINE = [1, 3, 6, 1, 6, 3, 15, 1, 1, 4, 0], OID_NOT_IN_WINDOW = [1, 3, 6, 1, 6, 3, 15, 1, 1, 2, 0];

class V3Error extends Error {}

const keyCache = new Map();      // password+hash -> master key (the 1 MB expansion is done once per password)
function masterKey(pass, hash) {
  const ck = hash + '\0' + pass, hit = keyCache.get(ck); if (hit) return hit;
  const p = Buffer.from(String(pass), 'utf8'); if (!p.length) throw new V3Error('empty password');
  const buf = Buffer.alloc(1048576); for (let i = 0; i < buf.length; i += p.length) p.copy(buf, i, 0, Math.min(p.length, buf.length - i));
  const k = crypto.createHash(hash).update(buf).digest(); if (keyCache.size > 200) keyCache.clear(); keyCache.set(ck, k); return k;
}
const localize = (ku, engineId, hash) => crypto.createHash(hash).update(Buffer.concat([ku, engineId, ku])).digest();
function privKeyOf(kul, proto, hash) {
  const need = PRIV[proto].key + (proto === 'DES' ? 8 : 0); let k = kul;
  while (k.length < need) k = Buffer.concat([k, crypto.createHash(hash).update(k).digest()]);       // key extension for AES-192/256 (and short hashes)
  return k.subarray(0, need);
}
/** the keys of one user for one authoritative engine */
function userKeys(u, engineId) {
  const a = AUTH[u.authProto]; const out = { level: u.level, authProto: u.authProto, privProto: u.privProto };
  if (u.level === 'noAuthNoPriv') return out;
  if (!a) throw new V3Error('unknown authentication protocol');
  out.auth = localize(masterKey(u.authPass, a.hash), engineId, a.hash); out.authLen = a.len; out.hash = a.hash;
  if (u.level === 'authPriv') { if (!PRIV[u.privProto]) throw new V3Error('unknown privacy protocol'); out.priv = privKeyOf(localize(masterKey(u.privPass, a.hash), engineId, a.hash), u.privProto, a.hash); }
  return out;
}
const hmac = (hash, key, data, len) => crypto.createHmac(hash, key).update(data).digest().subarray(0, len);

function desKey(k8) { return Buffer.concat([k8, k8]); }       // DES = two-key triple DES with both keys equal (OpenSSL 3 no longer ships plain DES)
function crypt(encrypt, proto, key, boots, time, salt, data) {
  if (proto === 'DES') {
    if (!encrypt && data.length % 8) throw new V3Error('bad DES data length');
    const iv = Buffer.alloc(8); for (let i = 0; i < 8; i++) iv[i] = key[8 + i] ^ salt[i];
    const c = (encrypt ? crypto.createCipheriv : crypto.createDecipheriv)('des-ede-cbc', desKey(key.subarray(0, 8)), iv); c.setAutoPadding(false);
    if (encrypt && data.length % 8) data = Buffer.concat([data, Buffer.alloc(8 - (data.length % 8))]);
    return Buffer.concat([c.update(data), c.final()]);
  }
  const iv = Buffer.alloc(16); iv.writeUInt32BE(boots >>> 0, 0); iv.writeUInt32BE(time >>> 0, 4); salt.copy(iv, 8);
  const c = (encrypt ? crypto.createCipheriv : crypto.createDecipheriv)('aes-' + PRIV[proto].key * 8 + '-cfb', key.subarray(0, PRIV[proto].key), iv);
  return Buffer.concat([c.update(data), c.final()]);
}

/** BER pieces of a v3 message; positions are kept so the digest can be checked on the original bytes */
function parseMessage(buf) {
  const top = header(buf, 0, buf.length); if (top.tag !== T.SEQUENCE) throw new V3Error('not an SNMP message');
  const vh = header(buf, top.start, top.end); if (Number(readSigned(buf, vh)) !== 3) throw new V3Error('not SNMPv3');
  const g = header(buf, vh.end, top.end); if (g.tag !== T.SEQUENCE) throw new V3Error('global data expected');
  const id = header(buf, g.start, g.end), ms = header(buf, id.end, g.end), fl = header(buf, ms.end, g.end), sm = header(buf, fl.end, g.end);
  if (fl.end - fl.start !== 1) throw new V3Error('bad flags');
  const flags = buf[fl.start], model = Number(readSigned(buf, sm));
  const spo = header(buf, g.end, top.end); if (spo.tag !== T.OCTETS) throw new V3Error('security parameters expected');
  const sp = header(buf, spo.start, spo.end); if (sp.tag !== T.SEQUENCE) throw new V3Error('bad security parameters');
  const e = header(buf, sp.start, sp.end), bo = header(buf, e.end, sp.end), ti = header(buf, bo.end, sp.end), us = header(buf, ti.end, sp.end), au = header(buf, us.end, sp.end), pr = header(buf, au.end, sp.end);
  const data = header(buf, spo.end, top.end);
  return { msgId: Number(readSigned(buf, id)), flags, model, auth: !!(flags & 1), priv: !!(flags & 2), reportable: !!(flags & 4),
    engineId: Buffer.from(buf.subarray(e.start, e.end)), boots: Number(readUnsigned(buf, bo)), time: Number(readUnsigned(buf, ti)), user: buf.toString('utf8', us.start, us.end),
    authStart: au.start, authLen: au.end - au.start, privParams: Buffer.from(buf.subarray(pr.start, pr.end)), dataTag: data.tag, data };
}
function parseScoped(buf, h) {       // h: header of the scoped PDU SEQUENCE inside buf
  if (h.tag !== T.SEQUENCE) throw new V3Error('scoped PDU expected');
  const ce = header(buf, h.start, h.end), cn = header(buf, ce.end, h.end), pdu = header(buf, cn.end, h.end);
  return { contextEngineId: Buffer.from(buf.subarray(ce.start, ce.end)), contextName: Buffer.from(buf.subarray(cn.start, cn.end)), pdu };
}
function parsePdu(buf, pdu) {
  let p = pdu.start; const r = header(buf, p, pdu.end); p = r.end; const e1 = header(buf, p, pdu.end); p = e1.end; const e2 = header(buf, p, pdu.end); p = e2.end; const vb = header(buf, p, pdu.end);
  return { requestId: readSigned(buf, r), varbinds: readVarbinds(buf, vb), varbindBytes: Buffer.from(buf.subarray(p, vb.end)) };
}

/** builds a complete v3 message. o: { msgId, engineId, boots, time, user, keys, reportable, contextEngineId, pdu(Buffer) } */
function buildMessage(o) {
  const k = o.keys || { level: 'noAuthNoPriv' }, auth = k.level !== 'noAuthNoPriv', priv = k.level === 'authPriv';
  let scoped = tlv(T.SEQUENCE, Buffer.concat([tlv(T.OCTETS, o.contextEngineId || o.engineId), tlv(T.OCTETS, Buffer.alloc(0)), o.pdu])), salt = Buffer.alloc(0), data = scoped;
  if (priv) {
    salt = Buffer.alloc(8);
    if (k.privProto === 'DES') { salt.writeUInt32BE(o.boots >>> 0, 0); crypto.randomBytes(4).copy(salt, 4); } else crypto.randomBytes(8).copy(salt);
    data = tlv(T.OCTETS, crypt(true, k.privProto, k.priv, o.boots, o.time, salt, scoped));
  }
  const make = (authParams) => {
    const sp = tlv(T.SEQUENCE, Buffer.concat([tlv(T.OCTETS, o.engineId), tlv(T.INTEGER, encSigned(o.boots)), tlv(T.INTEGER, encSigned(o.time)), tlv(T.OCTETS, Buffer.from(o.user || '', 'utf8')), tlv(T.OCTETS, authParams), tlv(T.OCTETS, salt)]));
    const flags = (auth ? 1 : 0) | (priv ? 2 : 0) | (o.reportable ? 4 : 0);
    return tlv(T.SEQUENCE, Buffer.concat([tlv(T.INTEGER, encSigned(3)), tlv(T.SEQUENCE, Buffer.concat([tlv(T.INTEGER, encSigned(o.msgId)), tlv(T.INTEGER, encSigned(MAX_MSG)), tlv(T.OCTETS, Buffer.from([flags])), tlv(T.INTEGER, encSigned(3))])), tlv(T.OCTETS, sp), data]));
  };
  if (!auth) return make(Buffer.alloc(0));
  const digest = hmac(k.hash, k.auth, make(Buffer.alloc(k.authLen)), k.authLen);
  return make(digest);
}

/**
 * A v3 message from a device we asked (we are the non-authoritative side: a response, or a report such as "not in time window").
 * getKeys(parsed) gives the keys of our user for parsed.engineId (only called when the message is authenticated or encrypted).
 * Returns { m, tag, requestId, errorStatus, errorIndex, varbinds, contextEngineId }; throws V3Error when the digest is wrong or the data cannot be read.
 */
function openMessage(buf, getKeys) {
  const m = parseMessage(buf); if (m.model !== 3) throw new V3Error('security model ' + m.model + ' is not supported');
  let k = null;
  if (m.auth || m.priv) { k = getKeys(m); if (!k || !k.auth) throw new V3Error('the device sent a protected message but no keys are set'); }
  if (m.auth) {
    if (m.authLen !== k.authLen) throw new V3Error('wrong authentication protocol (digest length differs)');
    const copy = Buffer.from(buf); copy.fill(0, m.authStart, m.authStart + m.authLen);
    if (!crypto.timingSafeEqual(hmac(k.hash, k.auth, copy, k.authLen), buf.subarray(m.authStart, m.authStart + m.authLen))) throw new V3Error('authentication failed (wrong password or protocol)');
  }
  let scopedBuf = buf, sh;
  if (m.priv) {
    if (m.dataTag !== T.OCTETS || m.privParams.length !== 8 || !k.priv) throw new V3Error('encrypted data expected');
    try { scopedBuf = crypt(false, k.privProto, k.priv, m.boots, m.time, m.privParams, buf.subarray(m.data.start, m.data.end)); sh = header(scopedBuf, 0, scopedBuf.length); } catch { throw new V3Error('could not decrypt (wrong privacy password or protocol)'); }
  } else sh = m.data;
  try {
    const sc = parseScoped(scopedBuf, sh), pdu = sc.pdu; let p = pdu.start;
    const r = header(scopedBuf, p, pdu.end); p = r.end; const e1 = header(scopedBuf, p, pdu.end); p = e1.end; const e2 = header(scopedBuf, p, pdu.end); p = e2.end; const vb = header(scopedBuf, p, pdu.end);
    return { m, tag: pdu.tag, requestId: Number(readSigned(scopedBuf, r)), errorStatus: Number(readSigned(scopedBuf, e1)), errorIndex: Number(readSigned(scopedBuf, e2)), varbinds: readVarbinds(scopedBuf, vb), contextEngineId: sc.contextEngineId };
  } catch (e) { throw new V3Error(m.priv ? 'could not read the decrypted data (wrong privacy password?)' : 'the data is damaged (' + e.message + ')'); }
}

class V3Engine {
  constructor(dir) {
    this.file = dir ? path.join(dir, 'snmpv3-engine.json') : null; this.started = Date.now(); this.seen = new Map(); this.cache = new Map();
    let st = {}; try { st = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* first start */ }
    if (!/^[0-9a-f]{10,64}$/.test(st.id || '')) st.id = '8000ffff05' + crypto.randomBytes(8).toString('hex');      // RFC 3411 format: enterprise number, then 5 = octets
    st.boots = Math.min(2147483646, (+st.boots || 0) + 1);       // every start of the service counts as a reboot of the engine
    this.id = st.id; this.boots = st.boots; if (this.file) { try { fs.writeFileSync(this.file, JSON.stringify(st)); } catch { /* best effort */ } }
    this.counter = crypto.randomInt(1, 2 ** 30);
  }
  get engineId() { return Buffer.from(this.id, 'hex'); }
  now() { return Math.min(2147483646, Math.floor((Date.now() - this.started) / 1000)); }
  nextId() { this.counter = (this.counter + 1) % 2147483647 || 1; return this.counter; }
  keysFor(u, engineId) {
    const ck = [u.name, u.level, u.authProto, u.authPass, u.privProto, u.privPass, engineId.toString('hex')].join('\0'); let k = this.cache.get(ck);
    if (!k) { k = userKeys(u, engineId); if (this.cache.size > 500) this.cache.clear(); this.cache.set(ck, k); } return k;
  }

  /**
   * An incoming v3 message. users = snmp.v3Users. Returns one of
   *   { report: Buffer }                                        engine discovery: send this back
   *   { trap: { kind: 'trap2'|'inform', varbinds, requestId, user, level, engineId }, reply?: Buffer }
   *   { error: 'text' }
   */
  handle(buf, users) {
    let m; try { m = parseMessage(buf); } catch (e) { return { error: 'the message is damaged (' + e.message + ')' }; }
    if (m.model !== 3) return { error: 'security model ' + m.model + ' is not supported' };
    const ours = m.engineId.equals(this.engineId);
    // discovery: an empty engine ID and no user. The sender learns our engine ID, boots and time from the report.
    if (!m.engineId.length && !m.auth) {
      if (!m.reportable) return { error: 'empty engine ID' };
      return { report: buildMessage({ msgId: m.msgId, engineId: this.engineId, boots: this.boots, time: this.now(), user: '', keys: null, reportable: false, pdu: this.reportPdu(OID_UNKNOWN_ENGINE) }) };
    }
    const u = (users || []).find((x) => x.name === m.user);
    if (!u) return { error: `unknown user "${m.user}" (add it under Settings → SNMP & MIBs → SNMPv3 users)` };
    const lvl = m.priv ? 'authPriv' : m.auth ? 'authNoPriv' : 'noAuthNoPriv';
    if (lvl !== u.level) return { error: `user "${m.user}" is set to ${u.level} here but the device sent ${lvl}` };
    if (u.engineId && !m.engineId.equals(Buffer.from(u.engineId, 'hex')) && !ours) return { error: `user "${m.user}" is limited to another engine ID` };
    let k; try { k = this.keysFor(u, m.engineId); } catch (e) { return { error: 'cannot make keys: ' + e.message }; }
    if (m.auth) {
      if (m.authLen !== k.authLen) return { error: 'wrong authentication protocol (digest length differs: ' + m.authLen + ' bytes, expected ' + k.authLen + ')' };
      const copy = Buffer.from(buf); copy.fill(0, m.authStart, m.authStart + m.authLen);
      const dg = hmac(k.hash, k.auth, copy, k.authLen);
      if (!crypto.timingSafeEqual(dg, buf.subarray(m.authStart, m.authStart + m.authLen))) return { error: `authentication failed for user "${m.user}" (wrong password, wrong protocol, or wrong engine ID on the device)` };
    }
    if (ours) {        // we are authoritative: boots must match and the time must be close to ours (replay protection)
      if (m.auth && (m.boots !== this.boots || Math.abs(m.time - this.now()) > TIME_WINDOW)) return { error: `message outside the time window (device thinks boots=${m.boots} time=${m.time}; here boots=${this.boots} time=${this.now()})`, report: m.reportable ? buildMessage({ msgId: m.msgId, engineId: this.engineId, boots: this.boots, time: this.now(), user: m.user, keys: k, reportable: false, pdu: this.reportPdu(OID_NOT_IN_WINDOW) }) : undefined };
    } else if (m.auth) {       // the sender is authoritative: ignore messages older than one already seen from it
      const key = m.engineId.toString('hex'), last = this.seen.get(key);
      if (last && (m.boots < last.boots || (m.boots === last.boots && m.time + TIME_WINDOW < last.time))) return { error: 'old message from ' + key + ' ignored (replay protection)' };
      if (!last || m.boots > last.boots || m.time > last.time) { if (this.seen.size > 5000) this.seen.clear(); this.seen.set(key, { boots: m.boots, time: m.time }); }
    }
    let scopedBuf = buf, sh;
    if (m.priv) {
      if (m.dataTag !== T.OCTETS) return { error: 'encrypted data expected' };
      if (m.privParams.length !== 8) return { error: 'bad privacy parameters' };
      try { scopedBuf = crypt(false, k.privProto, k.priv, m.boots, m.time, m.privParams, buf.subarray(m.data.start, m.data.end)); sh = header(scopedBuf, 0, scopedBuf.length); } catch { return { error: `could not decrypt (wrong privacy password or protocol for user "${m.user}")` }; }
    } else { sh = m.data; }
    let sc, pdu;
    try { sc = parseScoped(scopedBuf, sh); pdu = parsePdu(scopedBuf, sc.pdu); } catch (e) { return { error: m.priv ? `could not read the decrypted data (wrong privacy password for user "${m.user}"?)` : 'the data is damaged (' + e.message + ')' }; }
    const tag = sc.pdu.tag;
    if (tag !== T.PDU_TRAP_V2 && tag !== T.PDU_INFORM) return { error: 'not a trap or inform (PDU type 0x' + tag.toString(16) + ')' };
    const out = { trap: { kind: tag === T.PDU_INFORM ? 'inform' : 'trap2', varbinds: pdu.varbinds, requestId: pdu.requestId, user: m.user, level: lvl, engineId: m.engineId.toString('hex') } };
    if (tag === T.PDU_INFORM) {      // acknowledge: a Response PDU with the same bindings, from us (authoritative)
      const resp = tlv(T.PDU_GET_RESPONSE, Buffer.concat([tlv(T.INTEGER, encSigned(pdu.requestId)), tlv(T.INTEGER, encSigned(0)), tlv(T.INTEGER, encSigned(0)), pdu.varbindBytes]));
      out.reply = buildMessage({ msgId: m.msgId, engineId: this.engineId, boots: this.boots, time: this.now(), user: m.user, keys: this.keysFor(u, this.engineId), reportable: false, contextEngineId: sc.contextEngineId, pdu: resp });
    }
    return out;
  }
  reportPdu(oid) { return tlv(0xa8, Buffer.concat([tlv(T.INTEGER, encSigned(0)), tlv(T.INTEGER, encSigned(0)), tlv(T.INTEGER, encSigned(0)), B.encVarbinds([{ oid, type: 'counter32', value: 1 }])])); }

  /** a trap or inform as v3, sent by this engine (the forwarder). u: { user, level, authProto, authPass, privProto, privPass } */
  buildTrap(u, pduBytes) {
    const keys = this.keysFor({ name: u.user, level: u.level, authProto: u.authProto, authPass: u.authPass, privProto: u.privProto, privPass: u.privPass }, this.engineId);
    return buildMessage({ msgId: this.nextId(), engineId: this.engineId, boots: this.boots, time: this.now(), user: u.user, keys, reportable: false, pdu: pduBytes });
  }
}

module.exports = { openMessage, hmac, V3Engine, AUTH_PROTOCOLS: Object.keys(AUTH), PRIV_PROTOCOLS: Object.keys(PRIV), buildMessage, userKeys, parseMessage, V3Error };
