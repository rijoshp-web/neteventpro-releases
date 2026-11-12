'use strict';
// SNMP manager side (1.46): asks a device for values. SNMPv1, v2c and v3 (user-based security: MD5/SHA/SHA-2 authentication, DES/AES privacy).
// GET, GETNEXT and GETBULK over UDP, with timeouts and retries, and a walk() on top. The BER and v3 crypto pieces are the ones the trap receiver already uses.
const dgram = require('node:dgram');
const dns = require('node:dns');
const net = require('node:net');
const crypto = require('node:crypto');
const B = require('./ber');
const V = require('./snmpv3');
const { T, tlv, encSigned, header, readSigned, readVarbinds } = B;

const PDU = { GET: 0xa0, GETNEXT: 0xa1, RESPONSE: 0xa2, GETBULK: 0xa5, REPORT: 0xa8 };
const USM = { // usmStats counters a device sends in a report
  '1.3.6.1.6.3.15.1.1.1.0': 'level', '1.3.6.1.6.3.15.1.1.2.0': 'time', '1.3.6.1.6.3.15.1.1.3.0': 'user', '1.3.6.1.6.3.15.1.1.4.0': 'engine', '1.3.6.1.6.3.15.1.1.5.0': 'digest', '1.3.6.1.6.3.15.1.1.6.0': 'decrypt'
};
const ERR_TOO_BIG = 1, ERR_NO_SUCH_NAME = 2;

class SnmpError extends Error { constructor(message, code = 'protocol') { super(message); this.code = code; } }   // code: timeout | auth | user | level | engine | protocol | resolve | device

const oidStr = (o) => (Array.isArray(o) ? o.join('.') : String(o));
const oidArr = (o) => B.parseOid(o);
const under = (oid, root) => { if (oid.length < root.length) return false; for (let i = 0; i < root.length; i++) if (oid[i] !== root[i]) return false; return true; };
const isMissing = (vb) => vb.type === 'noSuchObject' || vb.type === 'noSuchInstance' || vb.type === 'endOfMibView';
/** a value as a number (counters, gauges, integers, timeticks); null when it is text or missing */
function toNumber(vb) { if (!vb || isMissing(vb)) return null; if (typeof vb.value === 'number') return vb.value; if (typeof vb.value === 'string' && /^-?\d+$/.test(vb.value)) return Number(vb.value); return null; }
/** a value as text (octet strings are read as UTF-8 with control characters removed) */
function toText(vb) {
  if (!vb || isMissing(vb) || vb.value === null) return '';
  if (Buffer.isBuffer(vb.value)) return vb.value.toString('utf8').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (Array.isArray(vb.value)) return vb.value.join('.');
  return String(vb.value);
}

const MAX_PACKET = 65507;
const rid = () => crypto.randomInt(1, 2147483647);

class SnmpClient {
  /** gapMs: the least pause between two requests to the same device (a device answers one request at a time; a walk is never sent as a burst).
   *  maxInflight: requests on the wire at once, over all devices. Both keep SNMP polling light on the devices and on the network (1.49). */
  constructor(opts = {}) { this.sessions = new Map(); this.dnsCache = new Map(); this.keyCache = new Map(); this.gapMs = opts.gapMs ?? 30; this.maxInflight = opts.maxInflight ?? 64; this.hostQ = new Map(); this.inflight = 0; this.waiters = []; }
  async acquire() { if (this.inflight < this.maxInflight) { this.inflight++; return; } await new Promise((r) => this.waiters.push(r)); }
  release() { const w = this.waiters.shift(); if (w) w(); else this.inflight--; }

  async resolve(host) {
    if (net.isIP(host)) return { address: host, family: net.isIP(host) };
    const hit = this.dnsCache.get(host); if (hit && Date.now() - hit.at < 300000) return hit.r;
    let r; try { r = await dns.promises.lookup(host); } catch (e) { throw new SnmpError(`cannot find the address of "${host}" (${e.code || e.message})`, 'resolve'); }
    if (this.dnsCache.size > 2000) this.dnsCache.clear(); this.dnsCache.set(host, { at: Date.now(), r: { address: r.address, family: r.family } }); return { address: r.address, family: r.family };
  }

  /** one request/response exchange with retries. accept(buf) returns a result, or undefined to keep waiting for another packet (a stray or old datagram). */
  async exchange(t, packet, accept) {
    const to = Math.max(300, Math.min(60000, +t.timeoutMs || 3000)), tries = 1 + Math.max(0, Math.min(5, t.retries === undefined ? 2 : +t.retries));
    const dest = await this.resolve(t.host), port = +t.port || 161;
    if (packet.length > MAX_PACKET) throw new SnmpError('the request is too large', 'protocol');
    const sock = dgram.createSocket(dest.family === 6 ? 'udp6' : 'udp4');
    let finish; const done = new Promise((res, rej) => { finish = { res, rej }; });
    sock.on('error', (e) => finish.rej(new SnmpError('network error: ' + e.message, 'network')));
    sock.on('message', (buf, rinfo) => {
      if (rinfo.address !== dest.address || rinfo.port !== port) return;
      try { const out = accept(buf); if (out !== undefined) finish.res(out); } catch (e) { finish.rej(e); }
    });
    try {
      for (let i = 0; i < tries; i++) {
        const t0 = Date.now(), timer = new Promise((_, rej) => { const h = setTimeout(() => rej(new SnmpError(`no answer within ${to / 1000} s`, 'timeout')), to); h.unref?.(); done.finally(() => clearTimeout(h)); });
        sock.send(packet, port, dest.address, (e) => { if (e) finish.rej(new SnmpError('could not send: ' + e.message, 'network')); });
        try { const out = await Promise.race([done, timer]); out.rtt = Date.now() - t0; return out; }
        catch (e) { if (e.code !== 'timeout' || i === tries - 1) throw e; }
      }
    } finally { try { sock.close(); } catch { /* already closed */ } }
    throw new SnmpError('no answer', 'timeout');
  }

  pduBytes(kind, requestId, vbs, bulk) {
    const body = kind === PDU.GETBULK
      ? [tlv(T.INTEGER, encSigned(requestId)), tlv(T.INTEGER, encSigned(bulk.nonRep || 0)), tlv(T.INTEGER, encSigned(bulk.maxRep || 20))]
      : [tlv(T.INTEGER, encSigned(requestId)), tlv(T.INTEGER, encSigned(0)), tlv(T.INTEGER, encSigned(0))];
    return tlv(kind, Buffer.concat([...body, B.encVarbinds(vbs.map((o) => ({ oid: o, type: 'null', value: null })))]));
  }

  /** v1 / v2c exchange: returns { requestId, errorStatus, errorIndex, varbinds, rtt } */
  async v12(t, kind, oids, bulk) {
    const id = rid(), version = t.version === 'v1' ? 0 : 1, pdu = this.pduBytes(kind, id, oids, bulk);
    const packet = tlv(T.SEQUENCE, Buffer.concat([tlv(T.INTEGER, encSigned(version)), tlv(T.OCTETS, Buffer.from(String(t.community || 'public'), 'latin1')), pdu]));
    return this.exchange(t, packet, (buf) => {
      let top, p, r;
      try {
        top = header(buf, 0, buf.length); if (top.tag !== T.SEQUENCE) return undefined;
        const vh = header(buf, top.start, top.end), ch = header(buf, vh.end, top.end), ph = header(buf, ch.end, top.end);
        if (ph.tag !== PDU.RESPONSE) return undefined;
        p = ph.start; r = header(buf, p, ph.end); if (Number(readSigned(buf, r)) !== id) return undefined;      // an old answer to an earlier request
        const e1 = header(buf, r.end, ph.end), e2 = header(buf, e1.end, ph.end), vb = header(buf, e2.end, ph.end);
        return { requestId: id, errorStatus: Number(readSigned(buf, e1)), errorIndex: Number(readSigned(buf, e2)), varbinds: readVarbinds(buf, vb) };
      } catch (e) { return undefined; }     // a damaged packet is ignored; the retry timer decides
    });
  }

  // ---- SNMPv3 ----
  sessKey(t, addr) { return `${addr}:${+t.port || 161}`; }
  async discover(t) {
    const dest = await this.resolve(t.host), key = this.sessKey(t, dest.address), msgId = rid();
    const pdu = tlv(PDU.GET, Buffer.concat([tlv(T.INTEGER, encSigned(rid())), tlv(T.INTEGER, encSigned(0)), tlv(T.INTEGER, encSigned(0)), B.encVarbinds([])]));
    const packet = V.buildMessage({ msgId, engineId: Buffer.alloc(0), boots: 0, time: 0, user: '', keys: null, reportable: true, pdu });
    const r = await this.exchange(t, packet, (buf) => { try { const m = V.parseMessage(buf); if (m.msgId !== msgId || !m.engineId.length) return undefined; return { m }; } catch { return undefined; } });
    const s = { engineId: r.m.engineId, boots: r.m.boots, time: r.m.time, at: Date.now() }; this.sessions.set(key, s); return s;
  }
  keysFor(t, engineId) {
    const ck = [t.user, t.level, t.authProto, t.authPass, t.privProto, t.privPass, engineId.toString('hex')].join('\0'); let k = this.keyCache.get(ck);
    if (!k) { try { k = V.userKeys({ level: t.level || 'authPriv', authProto: t.authProto || 'SHA', authPass: t.authPass, privProto: t.privProto || 'AES128', privPass: t.privPass }, engineId); } catch (e) { throw new SnmpError('the SNMPv3 settings are not usable: ' + e.message, 'auth'); }
      if (this.keyCache.size > 500) this.keyCache.clear(); this.keyCache.set(ck, k); }
    return k;
  }
  async v3(t, kind, oids, bulk, attempt = 0) {
    const dest = await this.resolve(t.host), key = this.sessKey(t, dest.address);
    let s = this.sessions.get(key); if (!s) s = await this.discover(t);
    const keys = this.keysFor(t, s.engineId), msgId = rid(), id = rid();
    const pdu = this.pduBytes(kind, id, oids, bulk);
    const now = Math.min(2147483646, s.time + Math.floor((Date.now() - s.at) / 1000));
    const packet = V.buildMessage({ msgId, engineId: s.engineId, boots: s.boots, time: now, user: t.user || '', keys, reportable: true, contextEngineId: s.engineId, pdu });
    const res = await this.exchange(t, packet, (buf) => {
      let o; try { o = V.openMessage(buf, () => keys); } catch (e) {
        try { const m = V.parseMessage(buf); if (m.msgId !== msgId) return undefined; } catch { return undefined; }
        throw new SnmpError(e.message, /decrypt|privacy/.test(e.message) ? 'auth' : 'auth');
      }
      if (o.m.msgId !== msgId) return undefined;
      return o;
    });
    if (res.tag === PDU.REPORT) {
      const what = USM[oidStr(res.varbinds[0]?.oid || '')];
      if ((what === 'time' || what === 'engine') && attempt < 2) {
        if (what === 'engine') this.sessions.delete(key); else this.sessions.set(key, { ...s, boots: res.m.boots, time: res.m.time, at: Date.now() });
        return this.v3(t, kind, oids, bulk, attempt + 1);
      }
      const text = { level: 'the device does not accept this security level for this user', time: 'the device rejected the message time (clock or engine settings)', user: `the device does not know the user "${t.user}"`,
        engine: 'the device did not accept the engine ID', digest: 'wrong authentication password or protocol', decrypt: 'wrong privacy password or protocol' }[what] || 'the device answered with an SNMPv3 report';
      throw new SnmpError(text, what === 'digest' || what === 'decrypt' ? 'auth' : what === 'user' ? 'user' : what === 'level' ? 'level' : 'engine');
    }
    if (res.tag !== PDU.RESPONSE || res.requestId !== id) throw new SnmpError('unexpected answer from the device', 'protocol');
    if (res.m.auth) this.sessions.set(key, { engineId: s.engineId, boots: res.m.boots, time: res.m.time, at: Date.now() });
    return res;
  }

  /** one request at a time per device, with a short pause after each, and a limit on requests in flight overall */
  async send(t, kind, oids, bulk) {
    const key = `${t.host}:${t.port || 161}`; let st = this.hostQ.get(key);
    if (!st) { if (this.hostQ.size > 5000) for (const [k, v] of this.hostQ) if (!v.n && Date.now() - v.last > 60000) this.hostQ.delete(k); st = { tail: Promise.resolve(), last: 0, n: 0 }; this.hostQ.set(key, st); }
    const prev = st.tail; let done; st.tail = new Promise((r) => { done = r; }); st.n++;
    try {
      await prev; const wait = st.last + (this.gapMs || 0) - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      await this.acquire();
      try { return t.version === 'v3' ? await this.v3(t, kind, oids, bulk) : await this.v12(t, kind, oids, bulk); } finally { this.release(); }
    } finally { st.last = Date.now(); st.n--; done(); }
  }

  /** GET: returns { vbs, rtt }, one entry per requested OID in the same order. A missing object has type noSuchObject. */
  async get(t, oids) {
    const list = oids.map(oidArr); const out = new Array(list.length).fill(null); let rtt = 0;
    const run = async (idx) => {
      // v1 says "no such name" for the first missing OID only: take it out and ask again. "Too big": ask for half.
      let pending = idx.slice();
      for (let guard = 0; pending.length && guard < 60; guard++) {
        const r = await this.send(t, PDU.GET, pending.map((i) => list[i]));
        rtt = Math.max(rtt, r.rtt || 0);
        if (r.errorStatus === ERR_TOO_BIG && pending.length > 1) { const h = Math.ceil(pending.length / 2); await run(pending.slice(0, h)); await run(pending.slice(h)); return; }
        if (r.errorStatus === ERR_NO_SUCH_NAME && r.errorIndex >= 1 && r.errorIndex <= pending.length) { const bad = pending[r.errorIndex - 1]; out[bad] = { oid: list[bad], type: 'noSuchObject', value: null }; pending = pending.filter((_, j) => j !== r.errorIndex - 1); continue; }
        if (r.errorStatus) throw new SnmpError(`the device reported an error (status ${r.errorStatus})`, 'device');
        pending.forEach((i, j) => { out[i] = r.varbinds[j] || { oid: list[i], type: 'noSuchObject', value: null }; });
        return;
      }
    };
    await run(list.map((_, i) => i));
    return { vbs: out.map((v, i) => v || { oid: list[i], type: 'noSuchObject', value: null }), rtt };
  }

  /** GETNEXT / GETBULK: returns { vbs, rtt } */
  async next(t, oid, maxRep = 10) {
    const o = oidArr(oid);
    if (t.version === 'v1') { const r = await this.send(t, PDU.GETNEXT, [o]); if (r.errorStatus === ERR_NO_SUCH_NAME) return { vbs: [{ oid: o, type: 'endOfMibView', value: null }], rtt: r.rtt }; if (r.errorStatus) throw new SnmpError(`the device reported an error (status ${r.errorStatus})`, 'device'); return { vbs: r.varbinds, rtt: r.rtt }; }
    for (let m = maxRep; m >= 1; m = Math.floor(m / 2)) {
      const r = await this.send(t, PDU.GETBULK, [o], { nonRep: 0, maxRep: m });
      if (r.errorStatus === ERR_TOO_BIG && m > 1) continue;
      if (r.errorStatus) throw new SnmpError(`the device reported an error (status ${r.errorStatus})`, 'device');
      return { vbs: r.varbinds, rtt: r.rtt };
    }
    throw new SnmpError('the answer is too large for this device', 'device');
  }

  /** every object under root, in order: [{ oid: [..], type, value }]. At most maxRows rows. */
  async walk(t, root, { maxRows = 5000, maxRep = 10 } = {}) {
    const rootA = oidArr(root), out = []; let cur = rootA, rtt = 0;
    for (let guard = 0; guard < 2000 && out.length < maxRows; guard++) {
      const r = await this.next(t, cur, maxRep); rtt = Math.max(rtt, r.rtt || 0);
      if (!r.vbs.length) break; let progressed = false, ended = false;
      for (const vb of r.vbs) {
        if (vb.type === 'endOfMibView' || !under(vb.oid, rootA)) { ended = true; break; }
        if (vb.oid.length === cur.length && vb.oid.every((x, i) => x === cur[i])) { ended = true; break; }       // the device did not move forward
        out.push(vb); cur = vb.oid; progressed = true; if (out.length >= maxRows) break;
      }
      if (ended || !progressed) break;
    }
    return { vbs: out, rtt };
  }
}

module.exports = { SnmpClient, SnmpError, PDU, toNumber, toText, oidStr, oidArr, under, isMissing };
