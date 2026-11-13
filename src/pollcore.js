'use strict';
// SNMP polling core (1.48): "ask one device and return what it said". Used by the main server (src/polling.js) and by a probe (src/probepoll.js),
// so both read devices in exactly the same way. No database, no config, no alarms in here.
const net = require('node:net');
const { execFile } = require('node:child_process');
const { SnmpClient, SnmpError, toNumber, toText, oidStr, isMissing } = require('./snmpclient');
/** a number from a value; a device that sends its numbers as text ("12.4", "12.4 V") is read too (1.51) */
const numOf = (vb) => { const n = toNumber(vb); if (n !== null) return n; if (vb && !isMissing(vb) && (Buffer.isBuffer(vb.value) || typeof vb.value === 'string')) { const m = /^\s*([-+]?\d+(?:[.,]\d+)?)/.exec(toText(vb)); if (m) return Number(m[1].replace(',', '.')); } return null; };
const ENT = require('./enterprises');

const OID = { sysDescr: '1.3.6.1.2.1.1.1.0', sysObjectID: '1.3.6.1.2.1.1.2.0', sysUpTime: '1.3.6.1.2.1.1.3.0', sysName: '1.3.6.1.2.1.1.5.0' };
const IF = { name: '1.3.6.1.2.1.31.1.1.1.1', descr: '1.3.6.1.2.1.2.2.1.2', alias: '1.3.6.1.2.1.31.1.1.1.18', type: '1.3.6.1.2.1.2.2.1.3', oper: '1.3.6.1.2.1.2.2.1.8',
  hcIn: '1.3.6.1.2.1.31.1.1.1.6', hcOut: '1.3.6.1.2.1.31.1.1.1.10', in: '1.3.6.1.2.1.2.2.1.10', out: '1.3.6.1.2.1.2.2.1.16', inErr: '1.3.6.1.2.1.2.2.1.14', outErr: '1.3.6.1.2.1.2.2.1.20', speed: '1.3.6.1.2.1.31.1.1.1.15' };
const SKIP_IF_TYPES = new Set([1, 24, 53, 131, 135, 136, 142, 150]);        // other, loopback, virtual, tunnel, VLAN interfaces, ...
const HR_STORAGE = { type: '1.3.6.1.2.1.25.2.3.1.2', units: '1.3.6.1.2.1.25.2.3.1.4', size: '1.3.6.1.2.1.25.2.3.1.5', used: '1.3.6.1.2.1.25.2.3.1.6', ram: '1.3.6.1.2.1.25.2.1.2' };

const w = (oid, o = {}) => ({ t: 'oid', oid, ...o });
/** built-in profiles. metric = { k, label, unit, srcs: [source, ...] }: the first source that gives a number wins */
const BUILTIN = [
  { id: 'basic', name: 'Uptime only (add your own values)', builtin: true, metrics: [{ k: 'uptime', label: 'Uptime', unit: 's', srcs: [w(OID.sysUpTime, { scale: 0.01 })] }] },
  { id: 'generic', name: 'Generic (standard MIB-II / HOST-RESOURCES)', builtin: true, metrics: [
    { k: 'uptime', label: 'Uptime', unit: 's', srcs: [w(OID.sysUpTime, { scale: 0.01 })] },
    { k: 'cpu', label: 'CPU load', unit: '%', srcs: [{ t: 'walk', oid: '1.3.6.1.2.1.25.3.3.1.2', agg: 'avg' }] },
    { k: 'memory', label: 'Memory used', unit: '%', srcs: [{ t: 'hrram' }] }] },
  { id: 'cisco', name: 'Cisco switch / router', builtin: true, metrics: [
    { k: 'uptime', label: 'Uptime', unit: 's', srcs: [w(OID.sysUpTime, { scale: 0.01 })] },
    { k: 'cpu', label: 'CPU load (5 min)', unit: '%', srcs: [{ t: 'walk', oid: '1.3.6.1.4.1.9.9.109.1.1.1.1.8', agg: 'max' }, { t: 'walk', oid: '1.3.6.1.4.1.9.2.1.58', agg: 'max' }, { t: 'walk', oid: '1.3.6.1.2.1.25.3.3.1.2', agg: 'avg' }] },
    { k: 'memory', label: 'Memory used', unit: '%', srcs: [{ t: 'pct', used: '1.3.6.1.4.1.9.9.48.1.1.1.5', free: '1.3.6.1.4.1.9.9.48.1.1.1.6' }, { t: 'hrram' }] },
    { k: 'temperature', label: 'Temperature', unit: '°C', srcs: [{ t: 'walk', oid: '1.3.6.1.4.1.9.9.13.1.3.1.3', agg: 'max' }] }] },
  { id: 'apc', name: 'APC UPS', builtin: true, metrics: [
    { k: 'uptime', label: 'Uptime', unit: 's', srcs: [w(OID.sysUpTime, { scale: 0.01 })] },
    { k: 'battery', label: 'Battery charge', unit: '%', srcs: [w('1.3.6.1.4.1.318.1.1.1.2.2.1.0')] },
    { k: 'temperature', label: 'Battery temperature', unit: '°C', srcs: [w('1.3.6.1.4.1.318.1.1.1.2.2.2.0')] },
    { k: 'runtime', label: 'Runtime left', unit: 'min', srcs: [w('1.3.6.1.4.1.318.1.1.1.2.2.3.0', { scale: 1 / 6000 })] },
    { k: 'replace', label: 'Battery needs replacing (2 = yes)', unit: '', srcs: [w('1.3.6.1.4.1.318.1.1.1.2.2.4.0')] },
    { k: 'vin', label: 'Input voltage', unit: 'V', srcs: [w('1.3.6.1.4.1.318.1.1.1.3.2.1.0')] },
    { k: 'vout', label: 'Output voltage', unit: 'V', srcs: [w('1.3.6.1.4.1.318.1.1.1.4.2.1.0')] },
    { k: 'load', label: 'Output load', unit: '%', srcs: [w('1.3.6.1.4.1.318.1.1.1.4.2.3.0')] },
    { k: 'upsstatus', label: 'Output status (2 = online, 3 = on battery)', unit: '', srcs: [w('1.3.6.1.4.1.318.1.1.1.4.1.1.0')] }] }
];
const IF_KEYS = [{ k: 'if.status', label: 'Interface status (1 = up, 0 = down)', unit: '', inst: true }, { k: 'if.in', label: 'Interface traffic in', unit: 'bit/s', inst: true },
  { k: 'if.out', label: 'Interface traffic out', unit: 'bit/s', inst: true }, { k: 'if.err', label: 'Interface errors', unit: '/min', inst: true }];
const BASE_KEYS = [{ k: 'poll.ok', label: 'Poll answered (1 = yes)', unit: '' }, { k: 'rtt', label: 'Answer time', unit: 'ms' }];

const HOSTRE = /^[A-Za-z0-9]([A-Za-z0-9.\-_]{0,251}[A-Za-z0-9])?$|^[0-9A-Fa-f:]+$/;

const detectProfile = (objectId) => { const o = String(objectId || ''); if (o.startsWith('1.3.6.1.4.1.9.')) return 'cisco'; if (o.startsWith('1.3.6.1.4.1.318.')) return 'apc'; return 'generic'; };
const vendorOf = (objectId) => { const n = ENT.numberOf(objectId); return n ? ENT.nameOf(n) : ''; };
const target = (d) => ({ host: d.host, port: d.port || 161, version: d.version || 'v2c', community: d.community, user: d.user, level: d.level, authProto: d.authProto, authPass: d.authPass, privProto: d.privProto, privPass: d.privPass,
  timeoutMs: d.timeoutMs || 3000, retries: d.retries === undefined ? 1 : d.retries });
function ping(host) {
  return new Promise((res) => {
    if (!HOSTRE.test(host) && !net.isIP(host)) return res(null);
    const win = process.platform === 'win32', args = win ? ['-n', '1', '-w', '1500', host] : ['-c', '1', '-W', '2', host];
    try { execFile(win ? 'ping.exe' : 'ping', args, { timeout: 5000, windowsHide: true }, (e) => res(!e)); } catch { res(null); }
  });
}

class Collector {
  constructor(client) { this.client = client || new SnmpClient(); this.prev = new Map(); this.names = new Map(); this.count = new Map(); }
  forget(id) { this.names.delete(id); this.count.delete(id); for (const k of [...this.prev.keys()]) if (k.startsWith(id + '|')) this.prev.delete(k); }
  async evalSrc(t, s) {
    if (s.t === 'oid') { const r = await this.client.get(t, [s.oid]); const n = numOf(r.vbs[0]); return n === null ? null : n * (s.scale ?? 1) + (s.offset || 0); }
    if (s.t === 'walk') {
      const r = await this.client.walk(t, s.oid, { maxRows: 400 }); const v = r.vbs.map(numOf).filter((x) => x !== null); if (!v.length) return null;
      const agg = s.agg === 'max' ? Math.max(...v) : s.agg === 'min' ? Math.min(...v) : s.agg === 'sum' ? v.reduce((a, b) => a + b, 0) : v.reduce((a, b) => a + b, 0) / v.length;
      return agg * (s.scale ?? 1) + (s.offset || 0);
    }
    if (s.t === 'pct') {
      const [a, b] = await Promise.all([this.client.walk(t, s.used, { maxRows: 200 }), this.client.walk(t, s.free, { maxRows: 200 })]);
      const used = a.vbs.map(toNumber).filter((x) => x !== null).reduce((x, y) => x + y, 0), free = b.vbs.map(toNumber).filter((x) => x !== null).reduce((x, y) => x + y, 0);
      return used + free > 0 ? (used / (used + free)) * 100 : null;
    }
    if (s.t === 'hrram') {
      const ty = await this.client.walk(t, HR_STORAGE.type, { maxRows: 100 }); const ram = ty.vbs.find((v) => v.type === 'oid' && oidStr(v.value) === HR_STORAGE.ram); if (!ram) return null;
      const idx = ram.oid[ram.oid.length - 1], r = await this.client.get(t, [`${HR_STORAGE.size}.${idx}`, `${HR_STORAGE.used}.${idx}`]);
      const size = toNumber(r.vbs[0]), used = toNumber(r.vbs[1]); return size > 0 && used !== null ? (used / size) * 100 : null;
    }
    return null;
  }
  async evalMetric(t, m, dev, ts, out) {
    for (const s of m.srcs || []) {
      if (s.text) {   // 1.51: a text value (firmware version, status text, a name ...): one value, or one per table row
        try {
          if (s.t === 'oid') { const r = await this.client.get(t, [s.oid]); if (!isMissing(r.vbs[0])) out.push({ k: m.k, inst: '', s: toText(r.vbs[0]).slice(0, 200) }); }
          else {
            const base = String(s.oid).split('.').length, r = await this.client.walk(t, s.oid, { maxRows: 200 }); let names = null;
            if (s.nameOid) { try { names = new Map(); for (const vb of (await this.client.walk(t, s.nameOid, { maxRows: 200 })).vbs) names.set(vb.oid.slice(String(s.nameOid).split('.').length).join('.'), toText(vb)); } catch (e) { if (e.code === 'timeout') throw e; names = null; } }
            const seen = new Set();
            for (const vb of r.vbs) { if (isMissing(vb)) continue; const idx = vb.oid.slice(base).join('.'); let inst = String((names && names.get(idx)) || idx).trim().slice(0, 60) || idx; if (seen.has(inst)) inst = idx; seen.add(inst); out.push({ k: m.k, inst, s: toText(vb).slice(0, 200) }); }
          }
        } catch (e) { if (e.code === 'timeout') throw e; }
        return;
      }
      if (s.t === 'walk' && s.agg === 'each') {   // 1.50: a table read row by row: one value for every row (the row index, or the text of a name column, is the instance)
        const base = String(s.oid).split('.').length; let names = null;
        try {
          const r = await this.client.walk(t, s.oid, { maxRows: 200 });
          if (s.nameOid) { try { names = new Map(); for (const vb of (await this.client.walk(t, s.nameOid, { maxRows: 200 })).vbs) names.set(vb.oid.slice(String(s.nameOid).split('.').length).join('.'), toText(vb)); } catch (e) { if (e.code === 'timeout') throw e; names = null; } }
          const seen = new Set();
          for (const vb of r.vbs) {
            let v = numOf(vb); if (v === null || !Number.isFinite(v)) continue; v = v * (s.scale ?? 1) + (s.offset || 0);
            const idx = vb.oid.slice(base).join('.'); let inst = String((names && names.get(idx)) || idx).trim().slice(0, 60) || idx; if (seen.has(inst)) inst = idx; seen.add(inst);
            if (s.rate) { const q = this.rate(`${dev.id}|${m.k}|${inst}`, v, ts, 4294967296); if (q === null) continue; v = q; }
            out.push({ k: m.k, inst, v });
          }
        } catch (e) { if (e.code === 'timeout') throw e; }
        return;
      }
      let v; try { v = await this.evalSrc(t, s); } catch (e) { if (e.code === 'timeout') throw e; v = null; }
      if (v === null || !Number.isFinite(v)) continue;
      if (s.rate) { const r = this.rate(`${dev.id}|${m.k}|`, v, ts, 4294967296); if (r === null) return; v = r; }
      out.push({ k: m.k, inst: '', v }); return;
    }
  }
  /** a counter turned into a rate per second; null for the first reading or after a reset */
  rate(key, v, ts, wrap = 4294967296) {
    const p = this.prev.get(key); this.prev.set(key, { v, ts }); if (!p || ts <= p.ts) return null;
    let d = v - p.v; if (d < 0) { if (p.v > 4294967295) d += 18446744073709552000; else d += wrap; if (d < 0 || d > wrap) return null; }
    return d / ((ts - p.ts) / 1000);
  }
  async interfaces(t, dev, ts, n, res, out) {
    const mode = dev.ifMode || 'none'; if (mode === 'none') return;   /* nothing is polled unless it was chosen */
    const col = async (oid) => { const m = new Map(); try { const r = await this.client.walk(t, oid, { maxRows: 2000 }); for (const vb of r.vbs) m.set(vb.oid[vb.oid.length - 1], vb); } catch (e) { if (e.code === 'timeout') throw e; } return m; };
    let names = this.names.get(dev.id);
    if (!names || !names.size || n % 30 === 0) {
      const [nm, ds, al, ty, sp] = [await col(IF.name), await col(IF.descr), await col(IF.alias), await col(IF.type), await col(IF.speed)];
      names = new Map();
      for (const idx of new Set([...nm.keys(), ...ds.keys()])) { const name = toText(nm.get(idx)) || toText(ds.get(idx)) || 'if' + idx; names.set(idx, { idx, name, alias: toText(al.get(idx)), type: toNumber(ty.get(idx)) ?? 0, speed: (toNumber(sp.get(idx)) || 0) * 1e6 }); }
      this.names.set(dev.id, names);
    }
    const oper = await col(IF.oper); if (!oper.size && !names.size) return;
    let hin = await col(IF.hcIn), hout = await col(IF.hcOut), wrapIn = 2 ** 64; if (!hin.size) { hin = await col(IF.in); wrapIn = 4294967296; } if (!hout.size) hout = await col(IF.out);
    const ein = await col(IF.inErr), eout = await col(IF.outErr), list = [...names.values()];
    let sel = dev.ifSelected || [], all = mode === 'all';
    if (mode === 'auto' && !sel.length && list.length) {      // first answer: watch the interfaces that are up (not loopbacks, VLANs, tunnels); the caller saves the choice
      sel = list.filter((i) => toNumber(oper.get(i.idx)) === 1 && !SKIP_IF_TYPES.has(i.type)).map((i) => i.name).slice(0, 200); res.autoSelect = sel;
    }
    const mon = all ? null : new Set(sel);
    res.ifaces = list.map((i) => {
      const st = toNumber(oper.get(i.idx)), monitored = !mon || mon.has(i.name), o = { idx: i.idx, name: i.name, alias: i.alias, type: i.type, speed: i.speed, status: st === 1 ? 'up' : st === 2 ? 'down' : 'other', monitored };
      if (!monitored) return o;
      out.push({ k: 'if.status', inst: i.name, v: st === 1 ? 1 : 0 });
      const rin = toNumber(hin.get(i.idx)), rout = toNumber(hout.get(i.idx));
      if (rin !== null) { const r = this.rate(`${dev.id}|if.in|${i.name}`, rin, ts, wrapIn); if (r !== null) { o.in = r * 8; out.push({ k: 'if.in', inst: i.name, v: o.in }); } }
      if (rout !== null) { const r = this.rate(`${dev.id}|if.out|${i.name}`, rout, ts, wrapIn); if (r !== null) { o.out = r * 8; out.push({ k: 'if.out', inst: i.name, v: o.out }); } }
      const e = (toNumber(ein.get(i.idx)) ?? null), e2 = (toNumber(eout.get(i.idx)) ?? null);
      if (e !== null || e2 !== null) { const r = this.rate(`${dev.id}|if.err|${i.name}`, (e || 0) + (e2 || 0), ts); if (r !== null) { o.err = r * 60; out.push({ k: 'if.err', inst: i.name, v: o.err }); } }
      return o;
    });
  }
  /** one poll of one device (never throws): { ts, ok, rtt, error, code, pingOk, sysName, sysDescr, objectId, detected, profile, readings[], ifaces[], autoSelect? } */
  async collect(dev, profiles) {
    const t = target(dev), ts = Date.now(), readings = [], res = { ts, ok: false, readings, ifaces: [] }, n = this.count.get(dev.id) || 0; this.count.set(dev.id, n + 1);
    try {
      const r = await this.client.get(t, [OID.sysUpTime, OID.sysObjectID, OID.sysName, OID.sysDescr]);
      const up = toNumber(r.vbs[0]); if (up === null && r.vbs.every(isMissing)) throw new SnmpError('the device answered but has none of the standard objects (is the SNMP view restricted?)', 'device');
      res.rtt = r.rtt; res.sysName = toText(r.vbs[2]); res.sysDescr = toText(r.vbs[3]).slice(0, 300); res.objectId = r.vbs[1].type === 'oid' ? oidStr(r.vbs[1].value) : '';
      res.detected = detectProfile(res.objectId);
      const want = dev.profile && dev.profile !== 'auto' ? dev.profile : res.detected, prof = profiles.find((p) => p.id === want) || profiles.find((p) => p.id === 'generic') || profiles[0]; res.profile = prof.id;
      readings.push({ k: 'poll.ok', inst: '', v: 1 }, { k: 'rtt', inst: '', v: r.rtt });
      for (const m of prof.metrics) { if (m.on === false) continue; if (m.k === 'uptime' && up !== null) { readings.push({ k: 'uptime', inst: '', v: up / 100 }); continue; } await this.evalMetric(t, m, dev, ts, readings); }
      if (up !== null && !prof.metrics.some((m) => m.k === 'uptime')) readings.push({ k: 'uptime', inst: '', v: up / 100 });   /* uptime is always kept, whatever the profile */
      await this.interfaces(t, dev, ts, n, res, readings);
      res.ok = true;
    } catch (e) { res.error = e.message; res.code = e.code || 'error'; if (dev.ping) res.pingOk = await ping(dev.host); }
    return res;
  }

  /** Test connection: one look at a device: name, vendor, uptime, number of interfaces, matching profile. profileName(id) gives the profile's display name. */
  async test(d, profileName) {
    const t = target(d);
    try {
      const r = await this.client.get(t, [OID.sysDescr, OID.sysObjectID, OID.sysUpTime, OID.sysName]);
      const objectId = r.vbs[1].type === 'oid' ? oidStr(r.vbs[1].value) : '', prof = detectProfile(objectId); let ifs = 0;
      try { ifs = (await this.client.walk(t, IF.oper, { maxRows: 3000 })).vbs.length; } catch { /* interfaces are optional */ }
      return { ok: true, rtt: r.rtt, vendor: vendorOf(objectId), sysDescr: toText(r.vbs[0]).slice(0, 300), sysName: toText(r.vbs[3]), objectId, uptimeSec: (toNumber(r.vbs[2]) || 0) / 100, profile: prof, profileName: profileName ? profileName(prof) : prof, interfaces: ifs };
    } catch (e) { return { ok: false, error: e.message, code: e.code || 'error' }; }
  }

  /** the addresses of a scan, with up to 40 asked at the same time. job: { cancelled, done, found[] } is updated while it runs */
  async discover(hosts, o, job) {
    const known = o.known || new Set(), queue = hosts.slice();
    const one = async (host) => {
      for (const cr of o.creds) {
        if (job.cancelled) return;
        try {
          const r = await this.client.get({ host, port: o.port, version: o.version, ...cr, timeoutMs: 1000, retries: 0 }, [OID.sysDescr, OID.sysObjectID, OID.sysName]); const objectId = r.vbs[1].type === 'oid' ? oidStr(r.vbs[1].value) : '';
          job.found.push({ host, name: toText(r.vbs[2]), descr: toText(r.vbs[0]).slice(0, 200), objectId, vendor: vendorOf(objectId), profile: detectProfile(objectId), rtt: r.rtt, exists: known.has(host), cred: cr }); return;
        } catch { /* no answer with this credential */ }
      }
    };
    await Promise.all(Array.from({ length: 40 }, async () => { while (queue.length && !job.cancelled) { await one(queue.shift()); job.done++; } }));
  }
}

module.exports = { Collector, OID, IF, BUILTIN, IF_KEYS, BASE_KEYS, HOSTRE, detectProfile, vendorOf, target, ping, SKIP_IF_TYPES, numOf, toText };
