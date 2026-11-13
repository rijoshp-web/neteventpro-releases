'use strict';
// SNMP polling (1.46): the main server asks devices for CPU, memory, temperature, uptime and interface traffic every minute or so,
// keeps the readings (raw for a week, 5-minute averages for a year), and raises normal alarms when a reading stays past a limit.
// A device that stops answering SNMP raises "No SNMP answer". Probes do not poll yet (planned).
const crypto = require('node:crypto');
const net = require('node:net');
const { SnmpClient, SnmpError, toNumber, toText, oidStr } = require('./snmpclient');
const { Collector, OID, IF, BUILTIN, IF_KEYS, BASE_KEYS, HOSTRE, detectProfile, vendorOf, target } = require('./pollcore');
const V = require('./snmpv3');

const id8 = () => crypto.randomBytes(5).toString('hex');
const lower = (s) => String(s || '').trim().toLowerCase();
const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const MASK = '********';

const OPS = { '>': (v, x) => v > x, '<': (v, x) => v < x, '>=': (v, x) => v >= x, '<=': (v, x) => v <= x, '=': (v, x) => v === x, '!=': (v, x) => v !== x };
/** ready-made lookups: a number the device sends -> a word and a state (ok, warn, crit, unk). The state raises and clears alarms by itself. */
const BUILTIN_LOOKUPS = [
  { id: 'b-ifstatus', name: 'Interface status (ifOperStatus)', items: [[1, 'up', 'ok'], [2, 'down', 'crit'], [3, 'testing', 'warn'], [4, 'unknown', 'unk'], [5, 'dormant', 'warn'], [6, 'not present', 'warn'], [7, 'lower layer down', 'crit']] },
  { id: 'b-alarmcolor', name: 'Colour status (gray, green, yellow, red)', items: [[0, 'gray', 'unk'], [1, 'green', 'ok'], [2, 'yellow', 'warn'], [3, 'red', 'crit']] },
  { id: 'b-updown', name: 'Up / down (1 = up, 0 = down)', items: [[1, 'up', 'ok'], [0, 'down', 'crit']] },
  { id: 'b-okfail', name: 'OK / fail (0 = ok, 1 = fail)', items: [[0, 'ok', 'ok'], [1, 'fail', 'crit']] },
  { id: 'b-onoff', name: 'On / off (1 = on, 0 = off)', items: [[1, 'on', 'ok'], [0, 'off', 'warn']] },
  { id: 'b-truth', name: 'True / false (1 = true, 2 = false)', items: [[1, 'true', 'ok'], [2, 'false', 'warn']] },
  { id: 'b-battery', name: 'Battery status (UPS: 1 unknown, 2 normal, 3 low, 4 depleted)', items: [[1, 'unknown', 'unk'], [2, 'normal', 'ok'], [3, 'low', 'warn'], [4, 'depleted', 'crit']] },
].map((l) => ({ ...l, builtin: true, items: l.items.map(([v, label, state]) => ({ v, label, state })) }));
const stateOfName = (n) => (/(^|\b)(ok|up|normal|green|good|online|active|on|running|enabled|true|present|ready|closed|healthy)\b/i.test(n) ? 'ok' : /(down|fail|crit|red|alarm|fault|error|offline|depleted|dead|lost|open|major|emergency|bad)/i.test(n) ? 'crit' : /(warn|yellow|low|minor|degrad|testing|dormant|high|notpresent|standby)/i.test(n) ? 'warn' : /(unknown|gray|grey|other|none|notapplicable|n\/a|disabled|off|false)/i.test(n) ? 'unk' : 'unk');
class Polling {
  constructor(config, store, engine) {
    this.config = config; this.store = store; this.engine = engine; this.db = store.db;
    this.collector = new Collector(new SnmpClient()); this.client = this.collector.client;
    this.rt = new Map();           // device id -> runtime state
    this.fire = new Map();         // threshold state: thr|dev|inst -> { since, firing }
    this.running = 0; this.recent = []; this.timer = null; this.maintTimer = null;
    this.db.exec(`CREATE TABLE IF NOT EXISTS poll_readings (dev TEXT NOT NULL, k TEXT NOT NULL, inst TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL, v REAL);
      CREATE INDEX IF NOT EXISTS ix_poll_r ON poll_readings (dev, k, inst, ts);
      CREATE TABLE IF NOT EXISTS poll_avg (dev TEXT NOT NULL, k TEXT NOT NULL, inst TEXT NOT NULL DEFAULT '', t INTEGER NOT NULL, avg REAL, min REAL, max REAL, n INTEGER);
      CREATE INDEX IF NOT EXISTS ix_poll_a ON poll_avg (dev, k, inst, t);
      CREATE TABLE IF NOT EXISTS poll_meta (k TEXT PRIMARY KEY, v TEXT);`);
    this.ins = this.db.prepare('INSERT INTO poll_readings (dev, k, inst, ts, v) VALUES (?, ?, ?, ?, ?)');
  }
  get cfg() { return this.config.get().polling || {}; }

  // ---------- profiles ----------
  profiles() {
    const c = this.cfg, off = c.profileOff || {}, out = [];
    for (const p of BUILTIN) out.push({ ...p, metrics: p.metrics.map((m) => ({ ...m, on: !(off[p.id] || []).includes(m.k) })) });
    for (const p of c.profiles || []) out.push({ ...p, builtin: false, metrics: (p.metrics || []).map((m) => ({ ...m, srcs: m.srcs || [{ t: m.t === 'walk' ? 'walk' : 'oid', oid: m.oid, agg: m.dtype === 'text' && m.t === 'walk' ? 'each' : m.agg || 'avg', nameOid: m.nameOid || '', scale: (m.scale ?? 1) * (m.dtype === 'ticks' ? 0.01 : 1), rate: !!m.rate || m.dtype === 'counter', text: m.dtype === 'text' }], on: m.on !== false })) });
    return out;
  }
  profile(id) { return this.profiles().find((p) => p.id === id) || this.profiles()[0]; }
  metricInfo(k) {
    for (const p of this.profiles()) for (const m of p.metrics) if (m.k === k) return { label: m.label || k, unit: m.unit || '', lookup: m.lookup || '', text: m.dtype === 'text' };
    const x = [...IF_KEYS, ...BASE_KEYS].find((y) => y.k === k); return x ? { label: x.label, unit: x.unit } : { label: k, unit: '' };
  }
  keyList() {
    const seen = new Map();
    for (const p of this.profiles()) for (const m of p.metrics) if (!seen.has(m.k)) seen.set(m.k, { k: m.k, label: m.label || m.k, unit: m.unit || '', text: m.dtype === 'text', inst: (m.srcs || []).some((x) => x.agg === 'each') });
    for (const x of [...IF_KEYS, ...BASE_KEYS]) seen.set(x.k, { ...x, inst: !!x.inst });
    return [...seen.values()];
  }
  vendorOf(o) { return vendorOf(o); }
  detectProfile(o) { return detectProfile(o); }

  /** the state shown: a device polled through a probe is "stale" when that probe has not reported for a while */
  shownState(d, rt) { if (d.enabled === false) return 'off'; if (d.via && rt.state !== 'unknown' && Date.now() - (rt.lastReport || 0) > Math.max(180000, 3 * (d.intervalSec || 60) * 1000)) return 'stale'; return rt.state; }
  state(d) { let r = this.rt.get(d.id); if (!r) { r = { state: 'unknown', misses: 0, polls: 0, last: new Map(), ifaces: [], nextAt: 0, busy: false }; this.rt.set(d.id, r); } return r; }

  /** one poll of one device made by this computer; never throws */
  async pollDevice(d) {
    const rt = this.state(d); rt.busy = true;
    try { return this.apply(d, await this.collector.collect(d, this.profiles())); } finally { rt.busy = false; }
  }
  /** takes what a poll found (made here or by a probe) into the state, the stored readings, the thresholds and the no-answer alarm */
  apply(d, res) {
    const rt = this.state(d), ts = res.ts || Date.now(); rt.lastTry = ts; rt.lastReport = Date.now(); rt.polls++;
    if (res.ok) {
      rt.rtt = res.rtt; rt.sysName = res.sysName; rt.sysDescr = res.sysDescr; rt.objectId = res.objectId; rt.detected = res.detected; rt.profile = res.profile; rt.ifaces = res.ifaces || [];
      rt.error = ''; rt.lastOk = ts; rt.misses = 0; rt.pingOk = null;
      if (res.autoSelect && !(d.ifSelected || []).length && d.ifMode === 'auto') this.patchDevice(d.id, { ifMode: 'selected', ifSelected: res.autoSelect });
      const wasDown = rt.state === 'down' || rt.alarmDown; rt.state = 'up';
      if (wasDown) { rt.alarmDown = false; this.noAnswer(d, rt, false); }
      const nums = res.readings.filter((r) => r.s === undefined), txt = res.readings.filter((r) => r.s !== undefined);
      this.store_(d, ts, nums); this.thresholds(d, rt, ts, nums); this.lookupAlarms(d, rt, ts, nums); this.texts_(d, rt, ts, txt);
      if (wasDown) this.event(d, 'ok', 'answering again');
      return { ok: true, rtt: res.rtt, readings: res.readings.filter((r) => r.s === undefined) };
    }
    rt.error = res.error; rt.misses++; rt.errCode = res.code || 'error'; rt.pingOk = res.pingOk ?? null;
    this.store_(d, ts, [{ k: 'poll.ok', inst: '', v: 0 }]);
    const need = num(this.cfg.missesBeforeDown, 3, 1, 20);
    if (rt.misses >= need && rt.state !== 'down') { rt.state = 'down'; rt.downSince = ts; rt.alarmDown = true; this.noAnswer(d, rt, true); }
    else if (rt.state === 'unknown' && rt.misses >= need) rt.state = 'down';
    this.event(d, 'fail', res.error);
    return { ok: false, error: res.error, code: res.code || 'error' };
  }
  event(d, kind, text) { this.recent.unshift({ ts: Date.now(), dev: d.id, name: d.name, kind, text: String(text).slice(0, 200) }); if (this.recent.length > 300) this.recent.length = 300; }

  // ---------- storage ----------
  store_(d, ts, rows) {
    const now = ts; const rt = this.state(d);
    try { this.db.exec('BEGIN'); for (const r of rows) this.ins.run(d.id, r.k, r.inst || '', now, r.v); this.db.exec('COMMIT'); }
    catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* none open */ } console.error('[polling] store', e.message); }
    for (const r of rows) rt.last.set(r.k + '|' + (r.inst || ''), { v: r.v, ts: now });
  }
  rollup() {
    try {
      const now = Date.now(), cut = Math.floor((now - 3600000) / 300000) * 300000, c = this.cfg;
      const m = this.db.prepare("SELECT v FROM poll_meta WHERE k = 'rolledTo'").get(); let from = m ? +m.v : 0;
      if (!from) { const f = this.db.prepare('SELECT MIN(ts) AS t FROM poll_readings').get(); from = f && f.t ? Math.floor(f.t / 300000) * 300000 : cut; }
      if (cut > from) {
        this.db.exec('BEGIN');
        this.db.prepare('INSERT INTO poll_avg (dev, k, inst, t, avg, min, max, n) SELECT dev, k, inst, (ts / 300000) * 300000, AVG(v), MIN(v), MAX(v), COUNT(*) FROM poll_readings WHERE ts >= ? AND ts < ? GROUP BY dev, k, inst, (ts / 300000)').run(from, cut);
        this.db.prepare("INSERT INTO poll_meta (k, v) VALUES ('rolledTo', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(String(cut));
        this.db.exec('COMMIT');
      }
      const rawKeep = now - num(c.keepRawDays, 7, 1, 90) * 86400000, avgKeep = now - num(c.keepAvgDays, 365, 7, 3650) * 86400000;
      this.db.prepare('DELETE FROM poll_readings WHERE ts < ?').run(rawKeep); this.db.prepare('DELETE FROM poll_avg WHERE t < ?').run(avgKeep);
    } catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* none open */ } console.error('[polling] rollup', e.message); }
  }
  /** readings of one item between two times, thinned to about `points` points: [{ t, v, min, max }] */
  series(devId, k, inst, from, to, points = 300) {
    const now = Date.now(), rawFrom = now - num(this.cfg.keepRawDays, 7, 1, 90) * 86400000, step = Math.max(1000, Math.ceil((to - from) / Math.max(10, points)));
    inst = inst || '';
    if (from >= rawFrom) return this.db.prepare('SELECT (ts / @s) * @s AS t, AVG(v) AS v, MIN(v) AS min, MAX(v) AS max FROM poll_readings WHERE dev = @d AND k = @k AND inst = @i AND ts >= @f AND ts <= @to GROUP BY ts / @s ORDER BY t')
      .all({ s: step, d: devId, k, i: inst, f: from, to }).map((r) => ({ t: r.t, v: r.v, min: r.min, max: r.max }));
    const st = Math.max(step, 300000), m = this.db.prepare("SELECT v FROM poll_meta WHERE k = 'rolledTo'").get(), rolled = m ? +m.v : 0;
    const a = this.db.prepare('SELECT (t / @s) * @s AS t, SUM(avg * n) / SUM(n) AS v, MIN(min) AS min, MAX(max) AS max FROM poll_avg WHERE dev = @d AND k = @k AND inst = @i AND t >= @f AND t <= @to GROUP BY t / @s ORDER BY t')
      .all({ s: st, d: devId, k, i: inst, f: from, to }).map((r) => ({ t: r.t, v: r.v, min: r.min, max: r.max }));
    const b = this.db.prepare('SELECT (ts / @s) * @s AS t, AVG(v) AS v, MIN(v) AS min, MAX(v) AS max FROM poll_readings WHERE dev = @d AND k = @k AND inst = @i AND ts >= @f AND ts <= @to GROUP BY ts / @s ORDER BY t')
      .all({ s: st, d: devId, k, i: inst, f: Math.max(from, rolled), to }).map((r) => ({ t: r.t, v: r.v, min: r.min, max: r.max }));
    const seen = new Set(a.map((x) => x.t)); return [...a, ...b.filter((x) => !seen.has(x.t))];
  }

  // ---------- lookups (a value -> a word and a state) and text values ----------
  lookups() { return [...BUILTIN_LOOKUPS, ...(this.cfg.lookups || []).map((l) => ({ ...l, builtin: false }))]; }
  lookup(id) { return id ? this.lookups().find((l) => l.id === id) || null : null; }
  lookupTell() { return this.cfg.lookupProfiles ?? this.cfg.noAnswerProfiles ?? []; }   /* who is told about lookup alarms (until chosen on the Lookups tab it is the No-answer list, as before) */
  setLookupTell(list) { this.config.update({ polling: { ...this.cfg, lookupProfiles: (Array.isArray(list) ? list : []).map(String).slice(0, 20) } }); }
  saveLookups(list) {
    const out = [], seen = new Set();
    for (const l of Array.isArray(list) ? list.slice(0, 100) : []) {
      if (l && l.builtin) continue; const name = String(l.name || '').trim().slice(0, 80); if (!name) continue;
      const id = /^l[a-z0-9]{4,12}$/.test(l.id || '') && !seen.has(l.id) ? l.id : 'l' + id8(); seen.add(id);
      const items = []; for (const it of (l.items || []).slice(0, 200)) { const v = Number(it.v); if (!Number.isFinite(v) || items.some((x) => x.v === v)) continue; items.push({ v, label: String(it.label || v).slice(0, 60), state: ['ok', 'warn', 'crit', 'unk'].includes(it.state) ? it.state : 'unk' }); }
      out.push({ id, name, items });
    }
    this.config.update({ polling: { ...this.cfg, lookups: out } }); return this.lookups();
  }
  /** a lookup from the named values of a MIB type (AlarmColor ::= INTEGER { green(1) ... }); the same name is reused */
  lookupFromEnums(name, enums) {
    name = String(name || 'MIB values').slice(0, 60); const cur = (this.cfg.lookups || []).find((l) => l.name === name); if (cur) return cur.id;
    const items = Object.entries(enums && typeof enums === 'object' ? enums : {}).slice(0, 100).map(([v, label]) => ({ v: Number(v), label: String(label).slice(0, 60), state: stateOfName(String(label)) })).filter((x) => Number.isFinite(x.v));
    if (!items.length) return ''; const id = 'l' + id8(); this.config.update({ polling: { ...this.cfg, lookups: [...(this.cfg.lookups || []), { id, name, items }] } }); return id;
  }
  textsOf(rt) { const o = {}; for (const [key, v] of (rt.texts || new Map())) { const i = key.indexOf('|'), k = key.slice(0, i), inst = key.slice(i + 1); (o[k] ||= {})[inst] = { s: v.s, ts: v.ts, since: v.since }; } return o; }
  lookupsUsed() { const o = {}; for (const [k, mi] of this.lookupMetrics()) { const l = this.lookup(mi.lookup); if (l) o[k] = { id: l.id, name: l.name, items: l.items }; } return o; }
  lookupMetrics() { const out = new Map(); for (const p of this.profiles()) for (const m of p.metrics) if (m.lookup && m.on !== false && !out.has(m.k)) out.set(m.k, { lookup: m.lookup, label: m.label || m.k }); return out; }
  /** a value that has a lookup: its state (warn or crit) raises an alarm for that row, and it clears when the state is ok again */
  lookupAlarms(d, rt, ts, readings) {
    const lm = this.lookupMetrics(); if (!lm.size) return;
    for (const r of readings) {
      const mi = lm.get(r.k); if (!mi) continue; const lk = this.lookup(mi.lookup); if (!lk) continue;
      const it = lk.items.find((x) => x.v === Math.round(r.v)), state = it ? it.state : 'unk', bad = state === 'warn' || state === 'crit';
      const key = `lk|${d.id}|${r.k}|${r.inst}`, st = this.fire.get(key) || { firing: false }, who = `[${mi.label}${r.inst ? ' ' + r.inst : ''}]`;
      if (bad && (!st.firing || st.state !== state)) { st.firing = true; st.state = state; this.say(d, state === 'crit' ? 3 : 4, `${who} ${mi.label}${r.inst ? ' ' + r.inst : ''} is ${it ? it.label : r.v} (${state === 'crit' ? 'critical' : 'warning'}, value ${r.v})`, 'lookup'); }
      else if (!bad && st.firing) { st.firing = false; this.say(d, 6, `${who} CLEARED: ${mi.label}${r.inst ? ' ' + r.inst : ''} is ${it ? it.label : r.v}`, 'lookup'); }
      if (st.firing) this.fire.set(key, st); else this.fire.delete(key);
    }
  }
  /** text values: kept for the device page, and the "text" thresholds (changed, equals, contains ...) */
  texts_(d, rt, ts, rows) {
    rt.texts = rt.texts || new Map();
    for (const r of rows) {
      const key = r.k + '|' + (r.inst || ''), prev = rt.texts.get(key); const cur = { s: String(r.s), ts, since: prev && prev.s === String(r.s) ? prev.since : ts, prev: prev ? prev.s : null };
      rt.texts.set(key, cur);
      for (const t of this.cfg.thresholds || []) {
        if (!t || t.enabled === false || !t.id || t.k !== r.k || !t.textOp) continue; if (t.scope === 'devices' && !(t.devices || []).includes(d.id)) continue;
        const info = this.metricInfo(t.k), fk = `${t.id}|${d.id}|${r.inst}`, st = this.fire.get(fk) || { firing: false }, v = String(r.s), x = String(t.text || '');
        const hit = t.textOp === 'changed' ? !!prev && prev.s !== v : t.textOp === 'equals' ? v === x : t.textOp === 'notequals' ? v !== x : t.textOp === 'contains' ? v.toLowerCase().includes(x.toLowerCase()) : t.textOp === 'notcontains' ? !v.toLowerCase().includes(x.toLowerCase()) : false;
        const where = `[${t.name || info.label}${r.inst ? ' ' + r.inst : ''}] `;
        if (hit && (!st.firing || t.textOp === 'changed')) { st.firing = true; this.say(d, num(t.severity, 4, 0, 7), `${where}${info.label}${r.inst ? ' ' + r.inst : ''}: "${v.slice(0, 80)}"${t.textOp === 'changed' ? ` (was "${String(prev.s).slice(0, 80)}")` : ''}`, t.id); }
        else if (!hit && st.firing) { st.firing = false; this.say(d, 6, `${where}CLEARED: ${info.label}${r.inst ? ' ' + r.inst : ''}: "${v.slice(0, 80)}"`, t.id); }
        if (st.firing) this.fire.set(fk, st); else this.fire.delete(fk);
      }
    }
  }

  // ---------- thresholds and alarms ----------
  rules() {
    const c = this.cfg, out = [], act = (profiles, extra = {}) => ({ alarm: true, profiles: Array.isArray(profiles) ? profiles : [], ...extra });
    out.push({ id: 'poll-noanswer', name: 'No SNMP answer', enabled: true, source: 'syslog', match: { tag: 'poll-noanswer' }, actions: act(c.noAnswerProfiles, { clearText: ['/^CLEARED:/'] }) });
    out.push({ id: 'poll-lookup', name: 'SNMP value state (lookup)', enabled: true, source: 'syslog', match: { tag: 'poll-lookup' }, actions: act(c.lookupProfiles ?? c.noAnswerProfiles, { alarmBy: '/^\\[([^\\]]*)\\]/', clearText: ['/CLEARED:/'] }) });
    for (const t of c.thresholds || []) {
      if (!t || t.enabled === false || !t.id) continue;
      out.push({ id: 'poll-' + t.id, name: String(t.name || 'SNMP threshold').slice(0, 100), enabled: true, source: 'syslog', match: { tag: 'poll-' + t.id },
        actions: act(t.profiles, { alarmBy: t.perInstance || t.textOp ? '/^\\[([^\\]]*)\\]/' : '', clearText: ['/CLEARED:/'] }) });
    }
    return out;
  }
  say(d, severity, text, tagId) {
    const now = Date.now(), host = d.name, tags = ['poll', 'poll-' + tagId];
    this.engine.process({ ts: now, devTs: now, srcIp: d.host, host, devKey: lower(d.name), facility: 5, severity, facilityName: 'syslog', severityName: ['emergency', 'alert', 'critical', 'error', 'warning', 'notice', 'info', 'debug'][severity] || 'info',
      app: 'snmp-poll', pid: '', msgid: 'poll', message: text, format: 'internal', sd: null, raw: `<${5 * 8 + severity}>snmp-poll: ${text}`, tags, poll: true }, true);
  }
  noAnswer(d, rt, down) {
    if (down) {
      const ping = rt.pingOk === null || rt.pingOk === undefined ? '' : rt.pingOk ? ' — it answers ping, so the device is up but SNMP is not answering' : ' — it does not answer ping either', n = rt.misses;
      this.say(d, num(this.cfg.noAnswerSeverity, 3, 0, 7), `No SNMP answer from ${d.name} (${d.host}) for ${n} poll${n === 1 ? '' : 's'}: ${rt.error}${ping}`, 'noanswer');
    } else this.say(d, 6, `CLEARED: ${d.name} (${d.host}) answers SNMP again`, 'noanswer');
  }
  thresholds(d, rt, ts, readings) {
    for (const t of this.cfg.thresholds || []) {
      if (!t || t.enabled === false || !t.id) continue;
      if (t.scope === 'devices' && !(t.devices || []).includes(d.id)) continue;
      const info = this.metricInfo(t.k);
      for (const r of readings) {
        if (r.k !== t.k) continue;
        if (!t.perInstance && r.inst) continue;
        const key = `${t.id}|${d.id}|${r.inst}`, st = this.fire.get(key) || { since: 0, firing: false };
        const op = OPS[t.op] ? t.op : t.op === '<' ? '<' : '>', hi = op === '>' || op === '>=', breach = OPS[op](r.v, t.value);
        const cv = t.clearValue === '' || t.clearValue === undefined || t.clearValue === null ? t.value : +t.clearValue;
        const clear = !OPS[op](r.v, cv);
        const where = r.inst ? `[${r.inst}] ` : '', fmt = (x) => (Math.abs(x) >= 1000 ? (x / 1000).toFixed(1) + 'k' : Number(x.toFixed(2))), unit = info.unit && info.unit !== '' ? (info.unit === '%' ? '%' : ' ' + info.unit) : '';
        if (!st.firing) {
          if (breach) { if (!st.since) st.since = ts; if (ts - st.since >= num(t.forSec, 0, 0, 86400) * 1000) { st.firing = true; this.say(d, num(t.severity, 4, 0, 7), `${where}${t.name || info.label}: ${info.label} is ${fmt(r.v)}${unit} (limit ${op} ${fmt(t.value)}${unit}${t.forSec ? ` for ${Math.round(t.forSec / 60 * 10) / 10 || 0} min` : ''})`, t.id); } }
          else st.since = 0;
        } else if (clear) { st.firing = false; st.since = 0; this.say(d, 6, `${where}CLEARED: ${t.name || info.label}: ${info.label} is back to ${fmt(r.v)}${unit}`, t.id); }
        else if (breach) st.since = ts;
        if (st.firing || st.since) this.fire.set(key, st); else this.fire.delete(key);
      }
    }
  }
  /** after a restart: thresholds that were already alarming keep their state, so a recovery clears the alarm */
  recover() {
    const al = this.engine.alarms; if (!al) return; const byKey = new Map(this.devices().map((d) => [lower(d.name), d]));
    for (const row of al.open.values()) {
      if (!String(row.rule_id).startsWith('poll-')) continue; const d = byKey.get(row.dev); if (!d) continue; const tid = row.rule_id.slice(5);
      if (tid === 'noanswer') { const rt = this.state(d); rt.alarmDown = true; rt.state = 'down'; } else this.fire.set(`${tid}|${d.id}|${row.inst || ''}`, { since: 0, firing: true });
    }
  }
  clearAlarms(ruleId, devKey, by = 'system') {
    const al = this.engine.alarms; if (!al) return 0; const ids = [];
    for (const row of al.open.values()) if ((ruleId ? row.rule_id === ruleId : String(row.rule_id).startsWith('poll-')) && (!devKey || row.dev === devKey)) ids.push(row.id);
    return ids.length ? al.clear(ids, by) : 0;
  }

  // ---------- devices ----------
  devices() { return (this.cfg.devices || []); }
  mask(d) { return { ...d, community: d.community ? MASK : '', authPass: d.authPass ? MASK : '', privPass: d.privPass ? MASK : '' }; }
  patchDevice(id, patch) {
    const c = this.cfg; const list = (c.devices || []).map((d) => (d.id === id ? { ...d, ...patch } : d));
    this.config.update({ polling: { ...c, devices: list } });
  }
  /** checks and cleans a device sent from the page; keeps stored secrets when the page sends the mask */
  cleanDevice(b, old) {
    const bad = (m) => { const e = new Error(m); e.status = 400; throw e; };
    const name = String(b.name || '').trim().slice(0, 60); if (!name) bad('Give the device a name.');
    const host = String(b.host || '').trim(); if (!host || !(HOSTRE.test(host) || net.isIP(host))) bad('Give the device address as an IP address or a host name.');
    for (const o of this.devices()) if (o.id !== old?.id && lower(o.name) === lower(name)) bad(`Another polled device is already named "${name}".`);
    const version = ['v1', 'v2c', 'v3'].includes(b.version) ? b.version : 'v2c';
    const keep = (k) => (b[k] === MASK ? old?.[k] || '' : String(b[k] || '').slice(0, 200));
    const d = { id: old?.id || 'd' + id8(), name, host, port: num(b.port, 161, 1, 65535), version, community: '', user: '', level: 'authPriv', authProto: 'SHA', authPass: '', privProto: 'AES128', privPass: '',
      profile: b.profile === undefined || b.profile === '' ? 'basic' : String(b.profile).slice(0, 40), intervalSec: num(b.intervalSec, this.cfg.defaultIntervalSec || 60, 10, 3600), timeoutMs: num(b.timeoutMs, 3000, 500, 30000), retries: Math.round(num(b.retries, 1, 0, 5)),
      via: this.probeOk(b.via) ? String(b.via) : '', ping: !!b.ping, enabled: b.enabled !== false, site: String(b.site || '').slice(0, 60), ifMode: ['auto', 'all', 'selected', 'none'].includes(b.ifMode) ? b.ifMode : (old?.ifMode || 'none'), ifSelected: Array.isArray(b.ifSelected) ? b.ifSelected.map(String).slice(0, 500) : (old?.ifSelected || []) };
    if (version === 'v3') {
      d.user = String(b.user || '').trim().slice(0, 100); if (!d.user) bad('SNMPv3 needs a user name.');
      d.level = ['noAuthNoPriv', 'authNoPriv', 'authPriv'].includes(b.level) ? b.level : 'authPriv';
      d.authProto = V.AUTH_PROTOCOLS.includes(b.authProto) ? b.authProto : 'SHA'; d.privProto = V.PRIV_PROTOCOLS.includes(b.privProto) ? b.privProto : 'AES128';
      if (d.level !== 'noAuthNoPriv') { d.authPass = keep('authPass'); if (d.authPass.length < 8) bad('The SNMPv3 authentication password must be at least 8 characters.'); }
      if (d.level === 'authPriv') { d.privPass = keep('privPass'); if (d.privPass.length < 8) bad('The SNMPv3 privacy password must be at least 8 characters.'); }
    } else { d.community = keep('community'); if (!d.community) bad('Give the community string.'); }
    return d;
  }
  probeOk(id) { return !!id && (this.config.get().probes || []).some((p) => p.id === id); }
  probeName(id) { return ((this.config.get().probes || []).find((p) => p.id === id) || {}).name || ''; }
  saveDevice(b) {
    const c = this.cfg, old = b.id ? this.devices().find((x) => x.id === b.id) : null; if (b.id && !old) { const e = new Error('No such device.'); e.status = 404; throw e; }
    const d = this.cleanDevice(b, old), list = old ? this.devices().map((x) => (x.id === old.id ? d : x)) : [...this.devices(), d];
    if (list.length > 2000) { const e = new Error('At most 2000 polled devices.'); e.status = 400; throw e; }
    if (old && lower(old.name) !== lower(d.name)) this.clearAlarms(null, lower(old.name));
    this.config.update({ polling: { ...c, devices: list } });
    const rt = this.state(d); rt.nextAt = 0; if (old && (old.host !== d.host || old.port !== d.port || old.version !== d.version)) { rt.misses = 0; this.client.sessions.clear(); }
    return d;
  }
  deleteDevice(id) {
    const d = this.devices().find((x) => x.id === id); if (!d) return null;
    this.config.update({ polling: { ...this.cfg, devices: this.devices().filter((x) => x.id !== id) } });
    this.clearAlarms(null, lower(d.name)); this.rt.delete(id);
    try { this.db.prepare('DELETE FROM poll_readings WHERE dev = ?').run(id); this.db.prepare('DELETE FROM poll_avg WHERE dev = ?').run(id); } catch (e) { console.error('[polling] delete', e.message); }
    for (const k of [...this.fire.keys()]) if (k.split('|')[1] === id) this.fire.delete(k);
    this.collector.forget(id);
    return d;
  }
  async testDevice(b) {
    const old = b.id ? this.devices().find((x) => x.id === b.id) : null;
    let d; try { d = this.cleanDevice({ ...b, name: b.name || 'test' }, old ? { ...old } : undefined); } catch (e) { return { ok: false, error: e.message, code: 'input' }; }
    if (d.via) return this.viaProbe(d.via, 'test', { device: { ...d, retries: Math.min(1, d.retries) } }, 45000);
    return this.collector.test({ ...d, retries: Math.min(1, d.retries) }, (id) => this.profile(id).name);
  }
  pollNow(id) { const d = this.devices().find((x) => x.id === id); if (!d) return false; if (d.via) return true; /* a probe polls on its own schedule */ const rt = this.state(d); if (rt.busy) return true; this.pollDevice(d).catch(() => {}); return true; }

  // ---------- discovery ----------
  /** '10.1.2.0/24', '10.1.2.5-10.1.2.40', '10.1.2.5-40' or one address -> list of IPv4 addresses (at most max) */
  static expand(text, max = 1024) {
    const ip2n = (a) => { const p = String(a).trim().split('.'); if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || +x > 255)) return null; return ((+p[0] << 24) >>> 0) + (+p[1] << 16) + (+p[2] << 8) + +p[3]; };
    const n2ip = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'), out = [], seen = new Set();
    for (const part of String(text || '').split(/[\s,;]+/).filter(Boolean)) {
      let lo, hi, m;
      if ((m = /^([\d.]+)\/(\d{1,2})$/.exec(part))) { const b = ip2n(m[1]), bits = +m[2]; if (b === null || bits < 8 || bits > 32) throw new Error(`"${part}" is not a valid range (use for example 10.1.2.0/24; the smallest allowed prefix is /8 but at most ${max} addresses are scanned at once).`); const size = 2 ** (32 - bits); lo = Math.floor(b / size) * size; hi = lo + size - 1; if (bits < 31) { lo += 1; hi -= 1; } }
      else if ((m = /^([\d.]+)-([\d.]+)$/.exec(part))) { lo = ip2n(m[1]); hi = ip2n(m[2]); if (hi === null && /^\d{1,3}$/.test(m[2]) && lo !== null) hi = (lo - (lo & 255)) + +m[2]; if (lo === null || hi === null || hi < lo) throw new Error(`"${part}" is not a valid range.`); }
      else { lo = hi = ip2n(part); if (lo === null) throw new Error(`"${part}" is not an IPv4 address or range.`); }
      for (let n = lo; n <= hi; n++) { const a = n2ip(n); if (!seen.has(a)) { seen.add(a); out.push(a); } if (out.length > max) throw new Error(`That is more than ${max} addresses. Scan smaller ranges (a /22 is the most at once).`); }
    }
    return out;
  }
  startDiscovery(b) {
    let hosts; try { hosts = Polling.expand(b.ranges); } catch (e) { throw Object.assign(e, { status: 400 }); } if (!hosts.length) throw Object.assign(new Error('Give at least one address or range.'), { status: 400 });
    const version = ['v1', 'v2c', 'v3'].includes(b.version) ? b.version : 'v2c', port = num(b.port, 161, 1, 65535);
    let creds = [];
    if (version === 'v3') { const user = String(b.user || '').trim(); if (!user) throw Object.assign(new Error('SNMPv3 needs a user name.'), { status: 400 }); const level = ['noAuthNoPriv', 'authNoPriv', 'authPriv'].includes(b.level) ? b.level : 'authPriv';
      if (level !== 'noAuthNoPriv' && String(b.authPass || '').length < 8) throw Object.assign(new Error('The authentication password must be at least 8 characters.'), { status: 400 });
      if (level === 'authPriv' && String(b.privPass || '').length < 8) throw Object.assign(new Error('The privacy password must be at least 8 characters.'), { status: 400 });
      creds = [{ user, level, authProto: V.AUTH_PROTOCOLS.includes(b.authProto) ? b.authProto : 'SHA', authPass: String(b.authPass || ''), privProto: V.PRIV_PROTOCOLS.includes(b.privProto) ? b.privProto : 'AES128', privPass: String(b.privPass || '') }]; }
    else { creds = String(b.communities || '').split(/[\s,;]+/).filter(Boolean).slice(0, 5).map((community) => ({ community })); if (!creds.length) throw Object.assign(new Error('Give at least one community string.'), { status: 400 }); }
    for (const [id, j] of this.jobs || []) if (j.running) throw Object.assign(new Error('A discovery is already running. Wait for it or stop it.'), { status: 409 });
    this.jobs ||= new Map(); if (this.jobs.size > 5) this.jobs.delete(this.jobs.keys().next().value);
    const job = { id: id8(), running: true, cancelled: false, total: hosts.length, done: 0, found: [], version, port, creds, startedAt: Date.now() }; this.jobs.set(job.id, job);
    const known = this.devices().map((d) => d.host), via = this.probeOk(b.via) ? String(b.via) : '';
    if (via) {      // the probe scans from its own network and sends the list back (it asks the server every 10 seconds, so the scan starts a few seconds late)
      job.via = via; this.viaProbe(via, 'discover', { hosts, port, version, creds, known }, 600000).then((r) => { if (job.cancelled) return; if (r && r.found) { job.found = r.found; job.done = job.total; } else job.error = (r && r.error) || 'The probe did not return a result.'; }).finally(() => { job.running = false; });
    } else this.collector.discover(hosts, { port, version, creds, known: new Set(known) }, job).catch(() => {}).finally(() => { job.running = false; });
    return job.id;
  }
  discoveryStatus(id) { const j = this.jobs?.get(id); if (!j) return null; return { id: j.id, running: j.running, total: j.total, done: j.done, version: j.version, error: j.error || '', via: j.via ? this.probeName(j.via) : '', found: j.found.map(({ cred, ...x }) => x).sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true })) }; }
  stopDiscovery(id) { const j = this.jobs?.get(id); if (j) j.cancelled = true; return !!j; }
  /** adds the chosen hosts of a finished discovery with the credentials that worked; returns the number added */
  addDiscovered(id, hosts, opts = {}) {
    const j = this.jobs?.get(id); if (!j) throw Object.assign(new Error('That discovery is no longer available. Run it again.'), { status: 404 });
    let n = 0; const used = new Set(this.devices().map((d) => lower(d.name)));
    for (const h of hosts) {
      const f = j.found.find((x) => x.host === h); if (!f || this.devices().some((d) => d.host === h)) continue;
      let name = String(f.name || h).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60) || h, k = name, i = 2; while (used.has(lower(k))) k = `${name.slice(0, 54)} (${i++})`; name = k; used.add(lower(name));
      this.saveDevice({ name, host: h, port: j.port, version: j.version, via: j.via || '', ...f.cred, profile: 'basic', ifMode: 'none', intervalSec: opts.intervalSec || this.cfg.defaultIntervalSec || 60, site: opts.site || '', timeoutMs: 3000, retries: 1, ifMode: 'auto', enabled: true }); n++;
    }
    return n;
  }

  // ---------- polling through a probe (1.48) ----------
  /** a job for a probe (test connection, discovery): it is handed over when the probe next asks, the answer comes back with its results */
  viaProbe(probeId, type, spec, waitMs) {
    this.tasks ||= new Map(); for (const [k, t] of this.tasks) if (Date.now() - t.created > 600000) this.tasks.delete(k);
    const task = { id: id8(), probe: probeId, type, spec, created: Date.now(), done: false, result: null }; this.tasks.set(task.id, task);
    return new Promise((resolve) => {
      const t0 = Date.now(), h = setInterval(() => {
        if (task.done) { clearInterval(h); this.tasks.delete(task.id); return resolve(task.result); }
        if (Date.now() - t0 > waitMs) { clearInterval(h); this.tasks.delete(task.id); resolve({ ok: false, code: 'probe', error: `The probe "${this.probeName(probeId) || probeId}" did not answer in ${Math.round(waitMs / 1000)} s. It asks the server every 10 seconds; check that it is running and connected (Settings → Remote probes).` }); }
      }, 300); h.unref?.();
    });
  }
  /** what a probe needs: its devices (with credentials), the profiles, and jobs waiting for it */
  pollConfigFor(probeId) {
    const devs = this.devices().filter((d) => d.via === probeId && d.enabled !== false).map((d) => ({ id: d.id, name: d.name, host: d.host, port: d.port, version: d.version, community: d.community, user: d.user, level: d.level, authProto: d.authProto, authPass: d.authPass, privProto: d.privProto, privPass: d.privPass,
      profile: d.profile, intervalSec: d.intervalSec, timeoutMs: d.timeoutMs, retries: d.retries, ping: !!d.ping, ifMode: d.ifMode, ifSelected: d.ifSelected }));
    const tasks = [...(this.tasks || new Map()).values()].filter((t) => t.probe === probeId && !t.done && !t.sent).map((t) => { t.sent = Date.now(); return { id: t.id, type: t.type, spec: t.spec }; });
    return { enabled: this.cfg.enabled !== false, workers: num(this.cfg.workers, 5, 1, 50), gapMs: num(this.cfg.gapMs, 30, 0, 2000), devices: devs, profiles: this.profiles(), tasks, now: Date.now() };
  }
  /** results a probe sends: poll results of its devices (oldest first) and answers to jobs */
  ingestFromProbe(probeId, results, taskResults) {
    let n = 0; const now = Date.now(), byId = new Map(this.devices().map((d) => [d.id, d]));
    for (const r of Array.isArray(results) ? results.slice(0, 500) : []) {
      const d = byId.get(r && r.dev); if (!d || d.via !== probeId || !r.res || typeof r.res !== 'object') continue;
      const x = r.res, ts = Number.isFinite(+x.ts) && +x.ts > now - 48 * 3600000 && +x.ts <= now + 60000 ? Math.round(+x.ts) : now;
      const readings = (Array.isArray(x.readings) ? x.readings : []).slice(0, 5000).filter((q) => q && typeof q.k === 'string' && q.k.length <= 40 && Number.isFinite(+q.v)).map((q) => ({ k: q.k, inst: String(q.inst || '').slice(0, 255), v: +q.v }));
      const s = (v, m) => String(v ?? '').slice(0, m);
      this.apply(d, { ts, ok: !!x.ok, rtt: Number.isFinite(+x.rtt) ? +x.rtt : null, error: s(x.error, 300), code: s(x.code, 20), pingOk: typeof x.pingOk === 'boolean' ? x.pingOk : null, sysName: s(x.sysName, 255), sysDescr: s(x.sysDescr, 300), objectId: s(x.objectId, 200), detected: s(x.detected, 40), profile: s(x.profile, 40), readings,
        ifaces: (Array.isArray(x.ifaces) ? x.ifaces : []).slice(0, 2000).map((i) => ({ idx: +i.idx || 0, name: s(i.name, 255), alias: s(i.alias, 255), type: +i.type || 0, speed: +i.speed || 0, status: ['up', 'down'].includes(i.status) ? i.status : 'other', monitored: !!i.monitored, in: Number.isFinite(+i.in) ? +i.in : undefined, out: Number.isFinite(+i.out) ? +i.out : undefined, err: Number.isFinite(+i.err) ? +i.err : undefined })),
        autoSelect: Array.isArray(x.autoSelect) ? x.autoSelect.map(String).slice(0, 200) : undefined });
      n++;
    }
    for (const tr of Array.isArray(taskResults) ? taskResults.slice(0, 20) : []) {
      const t = this.tasks?.get(tr && tr.id); if (!t || t.probe !== probeId) continue; t.done = true; t.result = tr.result && typeof tr.result === 'object' ? tr.result : { ok: false, error: 'The probe sent no result.' };
    }
    return n;
  }

  // ---------- settings, profiles, thresholds (saved by the API) ----------
  saveSettings(b) {
    const c = this.cfg; const s = { enabled: b.enabled !== false, workers: Math.round(num(b.workers, c.workers || 5, 1, 50)), gapMs: Math.round(num(b.gapMs, c.gapMs ?? 30, 0, 2000)), defaultIntervalSec: num(b.defaultIntervalSec, 60, 10, 3600), keepRawDays: Math.round(num(b.keepRawDays, 7, 1, 90)), keepAvgDays: Math.round(num(b.keepAvgDays, 365, 7, 3650)),
      missesBeforeDown: Math.round(num(b.missesBeforeDown, 3, 1, 20)), noAnswerSeverity: Math.round(num(b.noAnswerSeverity, 3, 0, 7)), noAnswerProfiles: Array.isArray(b.noAnswerProfiles) ? b.noAnswerProfiles.map(String).slice(0, 20) : c.noAnswerProfiles || [] };
    this.config.update({ polling: { ...c, ...s } }); return s;
  }
  saveProfiles(list, off) {
    const out = [], ids = new Set(BUILTIN.map((p) => p.id));
    for (const p of Array.isArray(list) ? list.slice(0, 100) : []) {
      const name = String(p.name || '').trim().slice(0, 80); if (!name) continue; const id = /^p[a-z0-9]{6,12}$/.test(p.id || '') && !ids.has(p.id) ? p.id : 'p' + id8(); ids.add(id);
      const ms = []; for (const m of (p.metrics || []).slice(0, 60)) {
        const oid = String(m.oid || '').trim(); const k = String(m.k || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 30); if (!k || !/^\d+(\.\d+)+$/.test(oid)) continue;
        ms.push({ k, label: String(m.label || k).slice(0, 60), unit: String(m.unit || '').slice(0, 10), t: m.t === 'walk' ? 'walk' : 'oid', oid, agg: ['avg', 'max', 'min', 'sum', 'each'].includes(m.agg) ? m.agg : 'avg', nameOid: m.t === 'walk' && m.agg === 'each' && /^\d+(\.\d+)+$/.test(String(m.nameOid || '').trim()) ? String(m.nameOid).trim() : '', scale: Number.isFinite(+m.scale) && +m.scale !== 0 ? +m.scale : 1, rate: !!m.rate && m.dtype !== 'text', dtype: ['number', 'counter', 'ticks', 'text'].includes(m.dtype) ? m.dtype : m.rate ? 'counter' : 'number', lookup: /^l[a-z0-9]{4,12}$|^b-[a-z0-9]+$/.test(m.lookup || '') ? m.lookup : '', on: m.on !== false });
      }
      out.push({ id, name, metrics: ms });
    }
    const po = {}; for (const [pid, keys] of Object.entries(off || {})) if (BUILTIN.some((p) => p.id === pid) && Array.isArray(keys)) po[pid] = keys.map(String).slice(0, 50);
    this.config.update({ polling: { ...this.cfg, profiles: out, profileOff: off === undefined ? this.cfg.profileOff || {} : po } }); return out;
  }
  saveThresholds(list) {
    const keys = new Set(this.keyList().map((x) => x.k)), prev = new Map((this.cfg.thresholds || []).map((t) => [t.id, t])), out = [];
    for (const t of Array.isArray(list) ? list.slice(0, 200) : []) {
      const name = String(t.name || '').trim().slice(0, 100); const k = String(t.k || ''); if (!name || !k) continue;
      const id = /^t[a-z0-9]{6,12}$/.test(t.id || '') ? t.id : 't' + id8(); const textOp = ['changed', 'equals', 'notequals', 'contains', 'notcontains'].includes(t.textOp) ? t.textOp : ''; const value = textOp ? 0 : Number(t.value); if (!Number.isFinite(value)) continue;
      const cv = t.clearValue === '' || t.clearValue === undefined || t.clearValue === null ? '' : Number(t.clearValue);
      out.push({ id, name, enabled: t.enabled !== false, k, op: OPS[t.op] ? t.op : '>', textOp, text: textOp ? String(t.text || '').slice(0, 200) : '', value, clearValue: Number.isFinite(cv) ? cv : '', forSec: Math.round(num(t.forSec, 0, 0, 86400)), severity: Math.round(num(t.severity, 4, 0, 7)),
        perInstance: k.startsWith('if.') || !!t.perInstance, scope: t.scope === 'devices' ? 'devices' : 'all', devices: Array.isArray(t.devices) ? t.devices.map(String).slice(0, 500) : [], profiles: Array.isArray(t.profiles) ? t.profiles.map(String).slice(0, 20) : [] });
      void keys;
    }
    for (const [id, old] of prev) { const now = out.find((x) => x.id === id); if (!now || now.enabled === false || now.k !== old.k) { this.clearAlarms('poll-' + id); for (const fk of [...this.fire.keys()]) if (fk.startsWith(id + '|')) this.fire.delete(fk); } }
    this.config.update({ polling: { ...this.cfg, thresholds: out } }); return out;
  }
  setInterfaces(id, selected, mode) { const d = this.devices().find((x) => x.id === id); if (!d) return false; this.patchDevice(id, { ifMode: mode === 'all' ? 'all' : mode === 'none' ? 'none' : 'selected', ifSelected: (selected || []).map(String).slice(0, 500) }); return true; }

  // ---------- reports (1.47) ----------
  /** per device over the last `hours`: availability (share of polls that were answered), average and highest CPU / memory / temperature, answer time, polling alarms */
  summary(hours) {
    hours = num(hours, 24, 1, 8760); const to = Date.now(), from = to - hours * 3600000, m = this.db.prepare("SELECT v FROM poll_meta WHERE k = 'rolledTo'").get(), rolled = m ? +m.v : 0;
    const acc = new Map(); const add = (dev, k, sum, n, mx) => { const key = dev + '|' + k, a = acc.get(key) || { sum: 0, n: 0, max: -Infinity }; a.sum += sum; a.n += n; a.max = Math.max(a.max, mx); acc.set(key, a); };
    const keys = "('poll.ok','cpu','memory','temperature','rtt')";
    for (const r of this.db.prepare(`SELECT dev, k, SUM(v) AS s, COUNT(*) AS n, MAX(v) AS mx FROM poll_readings WHERE ts >= ? AND ts <= ? AND inst = '' AND k IN ${keys} GROUP BY dev, k`).all(Math.max(from, rolled), to)) add(r.dev, r.k, r.s, r.n, r.mx);
    if (from < rolled) for (const r of this.db.prepare(`SELECT dev, k, SUM(avg * n) AS s, SUM(n) AS n, MAX(max) AS mx FROM poll_avg WHERE t >= ? AND t < ? AND inst = '' AND k IN ${keys} GROUP BY dev, k`).all(from, rolled)) add(r.dev, r.k, r.s, r.n, r.mx);
    const alarms = new Map(); try { for (const r of (this.engine.alarms?.db || this.db).prepare("SELECT dev, COUNT(*) AS n FROM alarms WHERE rule_id LIKE 'poll-%' AND first_ts >= ? GROUP BY dev").all(from)) alarms.set(r.dev, r.n); } catch { /* no alarms table */ }
    const get = (dev, k) => acc.get(dev + '|' + k), avg = (a) => (a && a.n ? a.sum / a.n : null), mx = (a) => (a && a.n ? a.max : null);
    const rows = this.devices().map((d) => { const ok = get(d.id, 'poll.ok'), cpu = get(d.id, 'cpu'), mem = get(d.id, 'memory'), tp = get(d.id, 'temperature'), rt = get(d.id, 'rtt');
      return { id: d.id, name: d.name, host: d.host, site: d.site || '', polls: ok ? ok.n : 0, availability: ok && ok.n ? (ok.sum / ok.n) * 100 : null, cpuAvg: avg(cpu), cpuMax: mx(cpu), memAvg: avg(mem), memMax: mx(mem), tempAvg: avg(tp), tempMax: mx(tp), rttAvg: avg(rt), alarms: alarms.get(lower(d.name)) || 0 }; });
    return { from, to, hours, rows };
  }
  /** CSV text: the summary of all devices, or every reading of one device (thinned to about 500 points per item) */
  csv(hours, id) {
    const safe = (x) => { const t = String(x ?? ''); const u = /^[=+\-@\t\r]/.test(t) ? "'" + t : t; return '"' + u.replace(/"/g, '""') + '"'; }, f = (v, d = 2) => (v === null || v === undefined ? '' : Number(v.toFixed(d)));
    if (!id) {
      const sm = this.summary(hours), head = ['Device', 'Address', 'Site', 'Polls', 'Availability %', 'CPU avg %', 'CPU max %', 'Memory avg %', 'Memory max %', 'Temp avg C', 'Temp max C', 'Answer ms', 'Polling alarms'];
      return '﻿' + [head.map(safe).join(','), ...sm.rows.map((r) => [r.name, r.host, r.site, r.polls, f(r.availability), f(r.cpuAvg), f(r.cpuMax), f(r.memAvg), f(r.memMax), f(r.tempAvg), f(r.tempMax), f(r.rttAvg, 1), r.alarms].map(safe).join(','))].join('\r\n') + '\r\n';
    }
    const d = this.devices().find((x) => x.id === id); if (!d) return null; hours = num(hours, 24, 1, 8760); const to = Date.now(), from = to - hours * 3600000;
    const items = new Map(); for (const r of this.db.prepare('SELECT DISTINCT k, inst FROM poll_readings WHERE dev = ? AND ts >= ?').all(id, Math.max(0, from))) items.set(r.k + '|' + r.inst, r);
    for (const r of this.db.prepare('SELECT DISTINCT k, inst FROM poll_avg WHERE dev = ? AND t >= ?').all(id, from)) items.set(r.k + '|' + r.inst, r);
    const lines = [['Time (UTC)', 'Reading', 'Item', 'Unit', 'Average', 'Min', 'Max'].map(safe).join(',')];
    for (const it of [...items.values()].sort((a, b) => (a.k + a.inst).localeCompare(b.k + b.inst))) { const info = this.metricInfo(it.k);
      for (const p of this.series(id, it.k, it.inst, from, to, 500)) lines.push([new Date(p.t).toISOString().replace('T', ' ').slice(0, 19), info.label, it.inst, info.unit, f(p.v, 3), f(p.min, 3), f(p.max, 3)].map(safe).join(',')); }
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  // ---------- views for the pages ----------
  alarmCount(d) { const al = this.engine.alarms; if (!al) return 0; const k = lower(d.name); let n = 0; for (const r of al.open.values()) if (r.dev === k && String(r.rule_id).startsWith('poll-')) n++; return n; }
  latest(rt, k, inst = '') { const x = rt.last.get(k + '|' + inst); return x ? x.v : null; }
  overview() {
    const devs = this.devices().map((d) => {
      const rt = this.state(d), ifs = rt.ifaces || [];
      return { id: d.id, name: d.name, host: d.host, site: d.site || '', version: d.version, enabled: d.enabled !== false, state: this.shownState(d, rt), via: d.via ? this.probeName(d.via) || d.via : '', rtt: rt.rtt ?? null, lastOk: rt.lastOk || 0, lastTry: rt.lastTry || 0, error: rt.error || '', profile: rt.profile || (d.profile === 'auto' ? '' : d.profile), uptime: this.latest(rt, 'uptime'),
        cpu: this.latest(rt, 'cpu'), memory: this.latest(rt, 'memory'), temperature: this.latest(rt, 'temperature'), battery: this.latest(rt, 'battery'), ifMon: ifs.filter((i) => i.monitored).length, ifUp: ifs.filter((i) => i.monitored && i.status === 'up').length, alarms: this.alarmCount(d) };
    });
    const c = { total: devs.length, up: devs.filter((x) => x.state === 'up').length, down: devs.filter((x) => x.state === 'down').length, unknown: devs.filter((x) => x.state === 'unknown' || x.state === 'stale').length, off: devs.filter((x) => x.state === 'off').length, alarms: devs.reduce((a, x) => a + x.alarms, 0) };
    return { enabled: this.cfg.enabled !== false, counts: c, devices: devs, recent: this.recent.slice(0, 40), settings: this.publicSettings() };
  }
  publicSettings() { const c = this.cfg; return { enabled: c.enabled !== false, workers: c.workers, gapMs: c.gapMs ?? 30, defaultIntervalSec: c.defaultIntervalSec, keepRawDays: c.keepRawDays, keepAvgDays: c.keepAvgDays, missesBeforeDown: c.missesBeforeDown, noAnswerSeverity: c.noAnswerSeverity, noAnswerProfiles: c.noAnswerProfiles || [] }; }
  detail(id) {
    const d = this.devices().find((x) => x.id === id); if (!d) return null; const rt = this.state(d), vals = {}, inst = {};
    for (const [key, x] of rt.last) { const [k, i] = key.split('|'); if (i) (inst[k] ||= {})[i] = x.v; else vals[k] = x.v; }
    const prof = this.profile(d.profile && d.profile !== 'auto' ? d.profile : rt.detected || 'generic');
    return { device: this.mask(d), via: d.via ? this.probeName(d.via) || d.via : '', state: this.shownState(d, rt), rtt: rt.rtt ?? null, lastOk: rt.lastOk || 0, lastTry: rt.lastTry || 0, error: rt.error || '', misses: rt.misses, downSince: rt.state === 'down' ? rt.downSince || 0 : 0, sysName: rt.sysName || '', sysDescr: rt.sysDescr || '', objectId: rt.objectId || '', profile: { id: prof.id, name: prof.name, metrics: prof.metrics.filter((m) => m.on !== false).map((m) => ({ k: m.k, label: m.label, unit: m.unit })) },
      values: vals, insts: inst, texts: this.textsOf(rt), lookups: this.lookupsUsed(), ifaces: rt.ifaces || [], events: this.recent.filter((e) => e.dev === id).slice(0, 30), alarms: this.alarmCount(d) };
  }

  // ---------- scheduler ----------
  start() {
    this.recover(); this.rollup();
    this.timer = setInterval(() => this.tick(), 1000); this.timer.unref?.();
    this.maintTimer = setInterval(() => this.rollup(), 600000); this.maintTimer.unref?.();
  }
  stop() { clearInterval(this.timer); clearInterval(this.maintTimer); }
  tick() {
    const c = this.cfg; if (c.enabled === false) return; const now = Date.now(), cap = num(c.workers, 5, 1, 50); this.client.gapMs = num(c.gapMs, 30, 0, 2000);
    for (const d of this.devices()) {
      if (this.running >= cap) break; if (d.enabled === false || d.via) continue;       // a device polled through a probe is polled by that probe
      const rt = this.state(d); if (rt.busy) continue;
      if (!rt.nextAt) { rt.nextAt = now + Math.floor(Math.random() * Math.min(10000, (d.intervalSec || 60) * 1000)); continue; }      // first poll after a short random delay: not all at once
      if (now < rt.nextAt) continue;
      // a device that does not answer is asked less and less often (2x, 4x, 8x ... up to 10 minutes) so a dead address costs nothing, and normal speed returns with its first answer
      const step = (d.intervalSec || 60) * 1000, back = rt.misses >= 3 ? Math.min(step * 2 ** Math.min(rt.misses - 2, 5), Math.max(step, 600000)) : step;
      rt.nextAt = now + back; this.running++;
      this.pollDevice(d).catch((e) => console.error('[polling]', e.message)).finally(() => { this.running--; });
    }
  }
}

module.exports = { Polling, BUILTIN, IF_KEYS, BASE_KEYS, MASK };
