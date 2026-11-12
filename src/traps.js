'use strict';
const SEVX = require('./sev');
// SNMP trap receiver (v1 and v2c traps, v2c informs). Each trap becomes an ordinary log message, so rules, alarms, search, reports and
// forwarding work on traps exactly as on syslog. Object and trap names come from the MIB files uploaded on the SNMP page.
const dgram = require('node:dgram');
const { decodeMessage, buildInformReply } = require('./ber');
const { parse } = require('./parser');
const { ifName } = require('./vendors');

const clean = (a) => (a || '').replace(/^::ffff:/, '');
const MAX_PER_SECOND = 5000, MAX_MESSAGE = 6000, MAX_UNRESOLVED = 300;
// vendor numbers (IANA "private enterprise numbers"), only used to tell you whose MIB is missing
const { NAMES: ENTERPRISES, numberOf: entOf } = require('./enterprises');
const OID = { upTime: '1.3.6.1.2.1.1.3.0', trapOid: '1.3.6.1.6.3.1.1.4.1.0', trapEnt: '1.3.6.1.6.3.1.1.4.3.0', traps: [1, 3, 6, 1, 6, 3, 1, 1, 5] };
const STANDARD = { '1.3.6.1.6.3.1.1.5.1': 5, '1.3.6.1.6.3.1.1.5.2': 5, '1.3.6.1.6.3.1.1.5.3': 3, '1.3.6.1.6.3.1.1.5.4': 5, '1.3.6.1.6.3.1.1.5.5': 4, '1.3.6.1.6.3.1.1.5.6': 4 };
const GOOD = new Set(['up', 'restored', 'restore', 'recovered', 'recovery', 'cleared', 'clear', 'normal', 'ok', 'ended', 'established', 'resumed', 'online', 'ready', 'closed']);
const BAD = new Set(['fail', 'failed', 'failure', 'fault', 'faulty', 'down', 'lost', 'loss', 'critical', 'crit', 'alarm', 'overtemp', 'trip', 'tripped', 'dead', 'unreachable', 'error', 'shutdown', 'offline', 'broken', 'disconnected', 'unavailable']);
const WARN = new Set(['warning', 'warn', 'high', 'low', 'exceeded', 'threshold', 'degraded', 'rising', 'falling', 'full', 'overload', 'overloaded', 'changed', 'mismatch', 'expired', 'expiring']);

const words = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.toLowerCase());

function severityFor(shortName, oid, snmp) {
  for (const r of snmp.severityRules || []) {
    const m = String(r.match || '').trim(); if (!m) continue;
    if (/^[\d.]+$/.test(m) ? (oid === m || oid.startsWith(m + '.')) : m.toLowerCase() === String(shortName).toLowerCase()) return r.severity;
  }
  if (STANDARD[oid] !== undefined) return STANDARD[oid];
  const w = words(shortName || '');
  if (w.some((x) => GOOD.has(x))) return 5;
  if (w.some((x) => BAD.has(x))) return 3;
  if (w.some((x) => WARN.has(x))) return 4;
  return snmp.defaultSeverity ?? 5;
}

/**
 * Severity carried inside the trap: snmp.valueSeverity = [{ field, match?, map: [{ value, severity }] }]. `match` (trap name, OID prefix or /regex/) limits a line to one kind of trap,
 * so the same number can mean different things for different vendors. `field` is a value name
 * (alarmSeverity), a name with its index (alertGroup.1.3) or a numeric OID. The value is compared as written, without
 * its number (major(3) -> major) and as its number (3 / 5).
 * @param vbs [[name, oid, value]] @returns severity 0-9 or null
 */
function ruleApplies(match, ctx) {      // optional "only for this trap": a trap name, an OID prefix or /regex/
  if (!match) return true; if (!ctx) return false; const rx = /^\/(.+)\/([a-z]*)$/.exec(match);
  if (rx) { try { const re = new RegExp(rx[1], rx[2]); return re.test(ctx.name || '') || re.test(ctx.oid || ''); } catch { return false; } }
  if (/^[\d.]+$/.test(match)) { const e = match.replace(/\.$/, ''); return ctx.oid === e || String(ctx.oid || '').startsWith(e + '.'); }
  return String(ctx.name || '').toLowerCase() === match.toLowerCase();
}
function valueSeverity(vbs, rules, ctx) {
  for (const r of rules || []) {
    if (!ruleApplies(r.match, ctx)) continue;
    const f = String(r.field).toLowerCase();
    const hit = vbs.find(([n, o]) => { const nl = String(n).toLowerCase(); return nl === f || nl.startsWith(f + '.') || nl.split('.')[0] === f || o === r.field || o.startsWith(r.field + '.'); });
    if (!hit) continue;
    const v = String(hit[2]).trim().toLowerCase(), m = /^(.*?)\s*\(\s*(-?\d+)\s*\)\s*$/.exec(v), cands = new Set([v]); if (m) { cands.add(m[1]); cands.add(m[2]); }
    for (const e of r.map) if (cands.has(String(e.value).trim().toLowerCase())) return e.severity;
  }
  // no line of yours applies: any value whose name contains "severity" and whose value is a well-known word (major, critical, warning ...) is understood by itself, for every vendor
  for (const [n, , val] of vbs) {
    const isSev = /severity/i.test(String(n)) && !/name|text|descr/i.test(String(n)), isStatus = !isSev && /status|state|condition/i.test(String(n)) && !/name|text|descr/i.test(String(n));
    if (!isSev && !isStatus) continue;
    const w = /^([a-z][a-z -]*?)\s*(?:\(\s*-?\d+\s*\))?$/i.exec(String(val).trim()); const key = w && w[1].toLowerCase().replace(/[ -]+/g, ''); const sev = key ? SEV_WORDS[key] : undefined;
    if (sev === undefined || (isStatus && !BAD_STATUS.has(key))) continue;      // a status value only counts when it says something is wrong (nonCritical, critical, major ...): "ok" must not hide a failure
    return sev;
  }
  return null;
}
const BAD_STATUS = new Set(['minor', 'critical', 'noncritical', 'nonrecoverable', 'major', 'minor', 'warning', 'fatal', 'emergency', 'alert', 'error']);
const SEV_WORDS = SEVX.WORDS;

function ticks(v) {
  const t = Math.floor(Number(v) / 100); const d = Math.floor(t / 86400), h = Math.floor(t / 3600) % 24, m = Math.floor(t / 60) % 60, s = t % 60, p = (n) => String(n).padStart(2, '0');
  return (d ? `${d}d ` : '') + `${p(h)}:${p(m)}:${p(s)}`;
}
function octets(buf) {
  let b = buf; while (b.length && b[b.length - 1] === 0) b = b.subarray(0, b.length - 1);
  if (!b.length) return '';
  if (b.every((c) => (c >= 0x20 && c < 0x7f) || c === 9 || c === 10 || c === 13)) return b.toString('latin1').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 300);
  if (buf.length === 6) return [...buf].map((c) => c.toString(16).padStart(2, '0')).join(':');
  const hex = [...buf.subarray(0, 48)].map((c) => c.toString(16).padStart(2, '0')).join('');
  return '0x' + hex + (buf.length > 48 ? '…' : '');
}
function fmtValue(vb, mibs, found) {
  switch (vb.type) {
    case 'integer': { const e = found && mibs.enumsOf(found.node); const n = e && e.get(vb.value); return n ? `${n}(${vb.value})` : String(vb.value); }
    case 'counter32': case 'gauge32': case 'counter64': return String(vb.value);
    case 'timeticks': return ticks(vb.value);
    case 'octets': case 'opaque': return octets(vb.value);
    case 'oid': return mibs.name(vb.value, true) || vb.value.join('.');
    case 'ipaddress': return vb.value;
    case 'null': return '';
    case 'unknown': return '?';
    default: return vb.type;
  }
}
const rawValue = (vb) => (vb.value === null ? vb.type : Buffer.isBuffer(vb.value) ? '0x' + vb.value.subarray(0, 64).toString('hex') : Array.isArray(vb.value) ? vb.value.join('.') : String(vb.value));
const tagSafe = (s) => String(s).replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 60);

/** unresolved OID -> key for the "missing MIB" list: the vendor (1.3.6.1.4.1.N) or the first eight numbers */
function prefixOf(oid) { return oid.length >= 7 && oid.slice(0, 6).join('.') === '1.3.6.1.4.1' ? oid.slice(0, 7).join('.') : oid.slice(0, 8).join('.'); }

/**
 * Turns a decoded trap into a log message. Pure (no I/O) so it can be tested.
 * @returns { msg, unresolved: string[] (prefixes), trapName, trapOid }
 */
function trapToMessage(trap, srcIp, mibs, snmp, now = new Date()) {
  let vbs = trap.varbinds, trapOid = null, uptime = null, enterprise = trap.enterprise || null;
  if (trap.version === 1) {
    trapOid = trap.generic < 6 ? [...OID.traps, trap.generic + 1] : [...trap.enterprise, 0, trap.specific];
    uptime = trap.uptime;
  } else {
    vbs = [];
    for (const vb of trap.varbinds) {
      const k = vb.oid.join('.');
      if (k === OID.trapOid && vb.type === 'oid') trapOid = vb.value;
      else if (k === OID.upTime) uptime = vb.value;
      else if (k === OID.trapEnt && vb.type === 'oid') enterprise = vb.value;
      else vbs.push(vb);
    }
  }
  const unresolved = new Set();
  const oidStr = trapOid ? trapOid.join('.') : '';
  const exactNode = trapOid ? mibs.exact(trapOid) : null;
  const longName = trapOid ? (exactNode ? (exactNode.module ? exactNode.module + '::' : '') + exactNode.name : mibs.name(trapOid, true)) : null;
  const shortName = exactNode ? exactNode.name : (trapOid && mibs.name(trapOid)) || '';
  if (trapOid && !longName) unresolved.add(prefixOf(trapOid));

  const parts = []; const rawParts = []; const vbOut = []; let ifn = '';
  for (const vb of vbs) {
    const found = mibs.find(vb.oid); const nm = mibs.name(vb.oid);
    if (!nm) unresolved.add(prefixOf(vb.oid));
    const val = fmtValue(vb, mibs, found);
    parts.push(`${nm || vb.oid.join('.')} = ${val}`);
    if (vbOut.length < 40) vbOut.push([nm || vb.oid.join('.'), vb.oid.join('.'), String(val).slice(0, 300)]);
    rawParts.push(`${vb.oid.join('.')} = ${rawValue(vb)}`);
    if (!ifn && vb.type === 'octets') {
      const k = vb.oid.join('.');
      if (k.startsWith('1.3.6.1.2.1.2.2.1.2.') || k.startsWith('1.3.6.1.2.1.31.1.1.1.1.')) ifn = octets(vb.value);
    }
  }
  const title = longName ? `${longName} (${oidStr})` : trapOid ? `Unknown trap ${oidStr}` : 'Trap without a trap OID';
  let text = parts.length ? `${title}: ${parts.join(', ')}` : title;
  if (trap.version === 1 && trap.agentAddr && trap.agentAddr !== '0.0.0.0' && trap.agentAddr !== srcIp) text += ` [agent ${trap.agentAddr}]`;
  if (text.length > MAX_MESSAGE) text = text.slice(0, MAX_MESSAGE) + '…';
  text = text.replace(/[\u0000-\u001f\u007f]/g, ' ');

  const allVb = vbs.map((vb) => { const nm = mibs.name(vb.oid), found = mibs.find(vb.oid); return [nm || vb.oid.join('.'), vb.oid.join('.'), String(fmtValue(vb, mibs, found))]; });
  const sev = valueSeverity(allVb, snmp.valueSeverity, { oid: oidStr, name: shortName }) ?? severityFor(shortName, oidStr, snmp);
  const tags = ['snmp'];
  if (shortName) tags.push('trap:' + tagSafe(shortName));
  if (oidStr === '1.3.6.1.6.3.1.1.5.3') tags.push('link-down'); else if (oidStr === '1.3.6.1.6.3.1.1.5.4') tags.push('link-up');
  if (ifn && (tags.includes('link-down') || tags.includes('link-up'))) tags.push('if:' + ifName(ifn));

  const msg = parse(`<${23 * 8 + SEVX.syslogNum(sev)}>snmptrap: ${text}`, srcIp, now);
  msg.entNum = entOf(trapOid) || entOf(enterprise) || (vbs.map((v) => entOf(v.oid)).find(Boolean) || 0);      // which maker sent it (for the Devices page); 0 for plain standard traps
  msg.severity = sev; msg.severityName = SEVX.NAMES[sev];      // Minor and Cleared do not fit in a syslog PRI, so the level is set here
  msg.msgid = tagSafe(shortName || oidStr).slice(0, 60);
  msg.source = 'snmp'; msg.trapOid = oidStr; msg.vb = { o: oidStr, n: shortName || '', ver: trap.v3 ? 'v3' : trap.version === 1 ? 'v1' : 'v2c', v: vbOut, ...(trap.version === 1 && trap.agentAddr && trap.agentAddr !== '0.0.0.0' ? { a: trap.agentAddr } : {}) };
  msg.tags = tags;
  // everything needed to pass the trap on to another manager unchanged (not stored, not sent to browsers)
  Object.defineProperty(msg, 'trapFwd', { enumerable: false, value: { trapOid: trapOid || null, uptime: uptime ?? 0, enterprise: trap.version === 1 ? trap.enterprise : enterprise, agentAddr: trap.agentAddr, srcIp, varbinds: vbs.map((v) => ({ oid: v.oid, type: v.type, value: v.value })), v1: trap.version === 1 ? { generic: trap.generic, specific: trap.specific } : null } });
  msg.raw = `SNMPv${trap.v3 ? '3 (' + trap.v3.user + ', ' + trap.v3.level + ')' : trap.version === 1 ? '1' : '2c'} ${trap.kind} from ${srcIp} | trapOID ${oidStr || '-'}${enterprise ? ' | enterprise ' + enterprise.join('.') : ''}${uptime !== null ? ' | uptime ' + uptime : ''}${rawParts.length ? ' | ' + rawParts.join(' | ') : ''}`.slice(0, 16000);
  return { msg, unresolved: [...unresolved], trapName: shortName, trapOid: oidStr };
}

class TrapReceiver {
  /** @param deps { config, mibs, engine, isAllowed } */
  constructor({ config, mibs, engine, isAllowed = () => true }) {
    this.config = config; this.mibs = mibs; this.engine = engine; this.isAllowed = isAllowed;
    this.sock = null; this.key = '';
    this.s = { running: false, port: null, error: null, received: 0, decoded: 0, v1: 0, v2c: 0, informs: 0, informsAcked: 0, rejectedSource: 0, rejectedCommunity: 0, malformed: 0, ignored: 0, v3: 0, v3Ok: 0, v3Refused: 0, v3LastError: '', rateDropped: 0, errors: 0, lastAt: 0, since: Date.now() };
    this.v3 = null;                  // the SNMPv3 engine (set by the server)
    this.senders = new Map();       // source address -> { count, v1, v2c, informs, unnamed, last, lastTrap }
    this.unres = new Map();          // prefix -> { count, last, sample }
    this.unk = new Map();            // trap OID that no loaded MIB defines -> { count, last, ips, sample } (for the MIB assistant)
    this.v3Seen = new Map();         // source -> last time a notice was written
    this.sec = 0; this.secCount = 0;
  }

  async apply(cfg) {
    const c = cfg.snmp || {}; const key = JSON.stringify([!!c.enabled, c.port, c.bind]);
    if (key === this.key && (this.sock || !c.enabled)) return;
    this.key = key; await this.stop();
    if (c.enabled) await this.start(c.port, c.bind || '0.0.0.0');
  }
  start(port, bind) {
    return new Promise((resolve) => {
      const st = this.s; st.error = null; st.port = port;
      const sock = dgram.createSocket({ type: String(bind).includes(':') ? 'udp6' : 'udp4', reuseAddr: false });
      sock.on('error', (e) => {
        st.running = false; st.error = e.code === 'EADDRINUSE' ? `UDP port ${port} is already in use by another program (another SNMP trap receiver?). Stop it or choose a different port.`
          : e.code === 'EACCES' ? `Permission denied opening UDP port ${port}. Run NetEventPro as administrator/service, or use a port above 1024.` : `UDP ${port}: ${e.message}`;
        console.error('[snmp]', st.error); try { sock.close(); } catch { /* ignore */ } resolve();
      });
      sock.on('message', (buf, rinfo) => { try { this.onPacket(buf, clean(rinfo.address), rinfo); } catch (e) { st.errors++; console.error('[snmp]', e.message); } });
      sock.bind(port, bind, () => { try { sock.setRecvBufferSize(4 * 1024 * 1024); } catch { /* OS may cap it */ } st.running = true; this.sock = sock; console.log(`[snmp] listening on ${bind}:${port} (UDP)`); resolve(); });
    });
  }
  async stop() {
    const s = this.sock; this.sock = null; this.s.running = false;
    if (s) await new Promise((r) => { try { s.close(r); } catch { r(); } });
  }

  onPacket(buf, ip, rinfo, opts = {}) {
    if (this.forward && !opts.fromProbe && this.forward(buf, ip, rinfo)) return;     // probe mode: the packet goes to the central server instead
    const st = this.s; st.received++;
    if (!this.isAllowed(ip)) { st.rejectedSource++; return; }
    const sec = Math.floor(Date.now() / 1000); if (sec !== this.sec) { this.sec = sec; this.secCount = 0; }
    if (++this.secCount > MAX_PER_SECOND) { st.rateDropped++; return; }
    let t; try { t = decodeMessage(buf); } catch (e) {
      st.malformed++; if (/not a trap/.test(e.message)) { st.malformed--; st.ignored++; } return;
    }
    const snmp = this.config.get().snmp || {};
    if (t.version === 3) {
      st.v3++;
      if (!(snmp.v3Users || []).length || !this.v3) { this.noteV3(ip, 'no SNMPv3 user is set up here (Settings → SNMP & MIBs → SNMPv3 users)'); return; }
      const r = this.v3.handle(buf, snmp.v3Users);
      if (r.report && rinfo && this.sock) { try { this.sock.send(r.report, rinfo.port, rinfo.address); } catch { /* the sender will try again */ } }
      if (!r.trap) { if (r.error) { st.v3Refused++; st.v3LastError = `${ip}: ${r.error}`; this.noteV3(ip, r.error); } return; }
      t = { version: 2, kind: r.trap.kind, community: '', requestId: r.trap.requestId, varbinds: r.trap.varbinds, v3: { user: r.trap.user, level: r.trap.level } };
      st.v3Ok++; if (t.kind === 'inform' && r.reply && snmp.informAck !== false && rinfo && this.sock) { try { this.sock.send(r.reply, rinfo.port, rinfo.address); st.informsAcked++; } catch { /* the sender will resend */ } }
      st.decoded++; st.lastAt = Date.now(); if (t.kind === 'inform') st.informs++;
    } else {
      if (snmp.communities?.length && !snmp.communities.includes(t.community)) { st.rejectedCommunity++; return; }
      st.decoded++; st.lastAt = Date.now();
      if (t.version === 1) st.v1++; else st.v2c++;
      if (t.kind === 'inform') {
        st.informs++;
        if (snmp.informAck !== false && rinfo && this.sock) { try { this.sock.send(buildInformReply(t), rinfo.port, rinfo.address); st.informsAcked++; } catch { /* the sender will resend */ } }
      }
    }
    const r = trapToMessage(t, ip, this.mibs, snmp);
    { let sd = this.senders.get(ip); if (!sd && this.senders.size < 2000) { sd = { count: 0, v1: 0, v2c: 0, informs: 0, unnamed: 0, last: 0, lastTrap: '', lastSev: 6 }; this.senders.set(ip, sd); }
      if (sd) { sd.count++; sd.last = Date.now(); if (t.version === 1) sd.v1++; else sd.v2c++; if (t.kind === 'inform') sd.informs++; if (r.unresolved.length) sd.unnamed++; sd.lastTrap = (r.trapName || r.trapOid || '').slice(0, 120); sd.lastSev = r.msg.severity; } }
    if (r.trapOid && /^\d+(\.\d+)+$/.test(r.trapOid) && !this.mibs.exact(r.trapOid.split('.').map(Number))) {     // a trap whose own OID no MIB defines (a parent name alone does not count as named)
      let k = this.unk.get(r.trapOid);
      if (!k) { if (this.unk.size >= MAX_UNRESOLVED) this.unk.delete(this.unk.keys().next().value); k = { count: 0, last: 0, ips: [], sample: '' }; this.unk.set(r.trapOid, k); }
      k.count++; k.last = Date.now(); if (!k.ips.includes(ip) && k.ips.length < 5) k.ips.push(ip); if (!k.sample) k.sample = String(r.msg.message || '').slice(0, 260);
    }
    for (const p of r.unresolved) {
      let u = this.unres.get(p);
      if (!u) { if (this.unres.size >= MAX_UNRESOLVED) continue; u = { count: 0, last: 0, sample: '' }; this.unres.set(p, u); }
      u.count++; u.last = Date.now(); u.sample = r.trapOid || p;
    }
    if (opts.ts) r.msg.ts = opts.ts; if (opts.via) (r.msg.tags ||= []).push('probe:' + opts.via);
    this.engine.process(r.msg);
  }
  noteV3(ip, why = '') {
    const now = Date.now(), last = this.v3Seen.get(ip) || 0;
    if (now - last < 600000) return;
    if (this.v3Seen.size > 1000) this.v3Seen.clear();
    this.v3Seen.set(ip, now);
    const msg = parse(`<${23 * 8 + 4}>snmptrap: SNMPv3 message from ${ip} was refused: ${why}. (One notice every 10 minutes per device.)`, ip);
    msg.tags = ['snmp', 'snmp-v3-refused']; msg.msgid = 'snmpv3'; msg.source = 'snmp'; msg.trapOid = '';
    this.engine.process(msg);
  }

  status() {
    const missing = [...this.unres.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 25).map(([prefix, u]) => {
      const m = /^1\.3\.6\.1\.4\.1\.(\d+)$/.exec(prefix);
      return { prefix, vendor: m ? ENTERPRISES[m[1]] || `enterprise ${m[1]}` : '', count: u.count, last: u.last, sample: u.sample };
    });
    const senders = [...this.senders.entries()].sort((a, b) => b[1].last - a[1].last).slice(0, 200).map(([ip, x]) => ({ ip, ...x }));
    const unknownTraps = [...this.unk.entries()].map(([oid, k]) => {
      const o = oid.split('.').map(Number), m = /^1\.3\.6\.1\.4\.1\.(\d+)\./.exec(oid), vendor = m ? ENTERPRISES[m[1]] || '' : '';
      return { oid, count: k.count, last: k.last, ips: k.ips, sample: k.sample, ...this.mibs.diagnose(o, vendor) };
    }).sort((a, b) => (a.state === 'resolved') - (b.state === 'resolved') || b.count - a.count).slice(0, 50);
    return { ...this.s, missing, senders, unknownTraps };
  }
}

module.exports = { valueSeverity, TrapReceiver, trapToMessage, severityFor, fmtValue, ENTERPRISES };
