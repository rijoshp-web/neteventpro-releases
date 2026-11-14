'use strict';
// Readings of one device (1.53). A reading is one thing to read from a device, with everything that belongs to it:
// where to read it (OID), name, unit, how the number is calculated (scale, offset), what the values mean, the alarms and how it is shown.
// They are stored per device (cfg.readings[deviceId]) and turned into the profile, thresholds and lookups the poller already understands,
// so nothing else in the polling code had to change. Templates are named sets of readings that can be applied to any device.
const crypto = require('node:crypto');
const { numOf, toText, target } = require('./pollcore');

const rid = () => crypto.randomBytes(5).toString('hex').slice(0, 8);
const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const OIDRE = /^\d+(\.\d+)+$/;
const OPS = ['>', '<', '>=', '<=', '=', '!='];
const own = (id) => 'dev-' + id;
const IOPS = ['=', '<', '<=', '>', '>=', 'between'];
/** value meanings are rules, the first one that fits wins: equals (status codes), below, above, between. `clear` (optional) keeps a state until the value is back past it. */
function cleanItems(list, max = 60) {
  const out = [];
  for (const it of Array.isArray(list) ? list.slice(0, max) : []) {
    const op = IOPS.includes(it.op) ? it.op : '=', v = Number(it.v); if (!Number.isFinite(v)) continue; const v2 = Number(it.v2);
    if (op === 'between' && !Number.isFinite(v2)) continue; if (op === '=' && out.some((x) => x.op === '=' && x.v === v)) continue;
    const cl = it.clear === '' || it.clear === null || it.clear === undefined ? null : Number(it.clear);
    out.push({ op, v, ...(op === 'between' ? { v2 } : {}), label: String(it.label || v).slice(0, 60), state: ['ok', 'warn', 'crit', 'unk'].includes(it.state) ? it.state : 'unk', ...(Number.isFinite(cl) && op !== '=' && op !== 'between' ? { clear: cl } : {}) });
  }
  return out;
}
/** the rule that fits a value; `prev` (the rule that applied at the last poll) is held while the value has not passed its `clear` value */
function matchItem(items, val, prev) {
  if (!Array.isArray(items) || !Number.isFinite(val)) return null;
  const hit = (x) => { const op = x.op || '=', v = +x.v; return op === '=' ? Math.round(val) === v : op === '<' ? val < v : op === '<=' ? val <= v : op === '>' ? val > v : op === '>=' ? val >= v : op === 'between' ? val >= v && val <= +x.v2 : false; };
  const i = items.findIndex(hit);
  if (prev) { const pi = items.findIndex((x) => x.op === prev.op && x.v === prev.v && x.label === prev.label); if (pi >= 0 && (i < 0 || i > pi) && items[pi].clear !== undefined) { const c = items[pi].clear, o = items[pi].op; if ((o === '>' || o === '>=') ? val >= c : val <= c) return items[pi]; } }
  return i >= 0 ? items[i] : null;
}

const VIEWS = ['', 'card', 'big', 'gauge', 'bar', 'light', 'tiles'];
/** how a reading is shown on the device page; older versions had a card and bar tick-box instead of a view */
function normDisp(d, text) {
  d = d || {}; const fin = (x) => (x === '' || x === null || x === undefined || !Number.isFinite(+x) ? null : +x);
  const view = VIEWS.includes(d.view) ? d.view : d.card ? (d.bar ? 'bar' : 'card') : '';
  return { graph: d.graph !== false && !text, style: d.style === 'area' ? 'area' : 'line', view, min: fin(d.min), max: fin(d.max), dec: fin(d.dec) === null ? null : Math.round(num(d.dec, 1, 0, 4)) };
}
/** one reading as the poller wants it (the same shape a custom profile metric has, plus offset and display) */
function metricOf(r) {
  const text = r.dtype === 'text', rate = r.dtype === 'counter';
  return { k: r.k, label: r.label, unit: r.unit, t: r.t, oid: r.oid, agg: r.agg, nameOid: r.nameOid, scale: r.scale, offset: r.offset, dtype: r.dtype, rate, lookup: r.items && r.items.length ? 'l' + r.k.slice(1) : r.lookup || '', disp: normDisp(r.disp, r.dtype === 'text'), on: r.on !== false,
    srcs: [{ t: r.t === 'walk' ? 'walk' : 'oid', oid: r.oid, agg: text && r.t === 'walk' ? 'each' : r.agg, nameOid: r.nameOid || '', scale: r.scale * (r.dtype === 'ticks' ? 0.01 : 1), offset: rate || text ? 0 : r.offset, rate, text }] };
}

module.exports = (Polling) => {
  const P = Polling.prototype;

  /** a reading from the browser (or an older version) made safe; `used` holds the keys already taken in this list */
  P.cleanReading = function (r, used) {
    r = r || {}; const oid = String(r.oid || '').trim(); if (!OIDRE.test(oid)) { const e = new Error(`“${String(r.label || 'Reading').slice(0, 40)}”: give the OID as numbers and dots, for example 1.3.6.1.4.1.318.1.1.2.2.1.0`); e.status = 400; throw e; }
    let k = /^r[a-z0-9]{5,12}$/.test(r.k || '') && !used.has(r.k) ? r.k : 'r' + rid(); used.add(k);
    const t = r.t === 'walk' ? 'walk' : 'oid', dtype = ['number', 'counter', 'ticks', 'text'].includes(r.dtype) ? r.dtype : 'number';
    const agg = ['avg', 'max', 'min', 'sum', 'each'].includes(r.agg) ? r.agg : t === 'walk' ? 'each' : 'avg', d = r.disp || {};
    const items = cleanItems(r.items), tl = (x) => (Array.isArray(x) ? x.map(String).slice(0, 20) : undefined);
    const ids = new Set(), alarms = [];
    for (const a of Array.isArray(r.alarms) ? r.alarms.slice(0, 12) : []) {
      const textOp = ['changed', 'equals', 'notequals', 'contains', 'notcontains'].includes(a.textOp) ? a.textOp : ''; if (dtype === 'text' && !textOp) continue;
      const value = textOp ? 0 : Number(a.value); if (!textOp && !Number.isFinite(value)) continue;
      const cv = a.clearValue === '' || a.clearValue === undefined || a.clearValue === null ? '' : Number(a.clearValue);
      const id = /^[a-z0-9]{6,12}$/.test(a.id || '') && !ids.has(a.id) ? a.id : rid(); ids.add(id);
      alarms.push({ id, enabled: a.enabled !== false, op: OPS.includes(a.op) ? a.op : '>', textOp: dtype === 'text' ? textOp : '', text: textOp ? String(a.text || '').slice(0, 200) : '', value, clearValue: Number.isFinite(cv) ? cv : '', forSec: Math.round(num(a.forSec, 0, 0, 86400)), severity: Math.round(num(a.severity, 4, 0, 7)), tell: Array.isArray(a.tell) ? a.tell.map(String).slice(0, 20) : [] });
    }
    return { k, label: String(r.label || 'Reading').trim().slice(0, 60) || 'Reading', unit: String(r.unit || '').slice(0, 10), t, oid, agg, nameOid: t === 'walk' && agg === 'each' && OIDRE.test(String(r.nameOid || '').trim()) ? String(r.nameOid).trim() : '',
      scale: Number.isFinite(+r.scale) && +r.scale !== 0 ? +r.scale : 1, offset: Number.isFinite(+r.offset) ? +r.offset : 0, dtype, items, ...(items.length && tl(r.tellWarn) ? { tellWarn: tl(r.tellWarn) } : {}), ...(items.length && tl(r.tellCrit) ? { tellCrit: tl(r.tellCrit) } : {}), lookup: !items.length && /^l[a-z0-9]{4,12}$|^b-[a-z0-9]+$/.test(r.lookup || '') ? r.lookup : '', on: r.on !== false,
      disp: normDisp(d, dtype === 'text'), alarms };
  };

  /** the profiles of devices that have their own readings (id dev-<device id>) */
  P.ownProfiles = function () {
    const rs = this.cfg.readings || {}, out = [];
    for (const d of this.devices()) if (Array.isArray(rs[d.id]) && rs[d.id].length) out.push({ id: own(d.id), name: `${d.name}: own readings`, builtin: false, own: true, metrics: rs[d.id].map(metricOf) });
    return out;
  };

  P.readingsOf = function (id) { const r = (this.cfg.readings || {})[id]; return Array.isArray(r) ? r.map((x) => ({ ...x, disp: normDisp(x.disp, x.dtype === 'text') })) : []; };

  /** save all readings of a device, and rebuild the profile, thresholds and value meanings that come from them */
  P.saveReadings = function (id, list) {
    const d = this.devices().find((x) => x.id === id); if (!d) { const e = new Error('No such device.'); e.status = 404; throw e; }
    if (!Array.isArray(list)) list = []; if (list.length > 80) { const e = new Error('At most 80 readings per device.'); e.status = 400; throw e; }
    const used = new Set(), clean = list.map((r) => this.cleanReading(r, used)), c = this.cfg;
    const oldT = (c.thresholds || []).filter((t) => t.owner === id), thresholds = (c.thresholds || []).filter((t) => t.owner !== id), lookups = (c.lookups || []).filter((l) => l.owner !== id);
    for (const r of clean) {
      if (r.items.length) lookups.push({ id: 'l' + r.k.slice(1), name: `${r.label} (${d.name})`.slice(0, 80), items: r.items, owner: id, rk: r.k, ...(r.tellWarn ? { tellWarn: r.tellWarn } : {}), ...(r.tellCrit ? { tellCrit: r.tellCrit } : {}) });
      for (const a of r.alarms) thresholds.push({ id: 't' + a.id, name: r.label, enabled: a.enabled, k: r.k, op: a.op, textOp: a.textOp, text: a.text, value: a.value, clearValue: a.clearValue, forSec: a.forSec, severity: a.severity, perInstance: r.t === 'walk' && r.agg === 'each', scope: 'devices', devices: [id], profiles: a.tell, owner: id });
    }
    for (const l of (c.lookups || []).filter((x) => x.owner === id)) if (!lookups.some((x) => x.id === l.id)) { for (const st of ['warn', 'crit']) this.clearAlarms(`poll-lk-${l.rk}-${st}`); for (const fk of [...this.fire.keys()]) if (fk.startsWith('lk|' + id + '|' + l.rk + '|')) this.fire.delete(fk); }
    for (const t of oldT) { const now = thresholds.find((x) => x.id === t.id); if (!now || now.enabled === false || now.k !== t.k) { this.clearAlarms('poll-' + t.id); for (const fk of [...this.fire.keys()]) if (fk.startsWith(t.id + '|')) this.fire.delete(fk); } }
    const readings = { ...(c.readings || {}) }; if (clean.length) readings[id] = clean; else delete readings[id];
    const devices = this.devices().map((x) => (x.id === id ? { ...x, profile: clean.length ? own(id) : x.profile === own(id) ? 'basic' : x.profile } : x));
    this.config.update({ polling: { ...c, readings, thresholds, lookups, devices } });
    const rt = this.state(d); rt.nextAt = 0; this.collector.forget?.(id);
    const keep = new Set(clean.map((x) => x.k)); for (const key of [...rt.last.keys()]) { const k = key.split('|')[0]; if (k !== 'uptime' && !k.startsWith('if.') && !keep.has(k)) rt.last.delete(key); }   /* values of removed readings*/
    return clean;
  };

  /** the readings of a built-in set as plain readings (first source of each; sets that compute a percentage cannot be copied) */
  P.builtinReadings = function (profId, detected) {
    const id = profId && profId !== 'auto' ? profId : detected || 'generic', p = this.profiles().find((x) => x.id === id && !x.own); const out = [], skipped = [];
    for (const m of p ? p.metrics : []) {
      if (m.k === 'uptime') continue; const s = (m.srcs || []).find((x) => (x.t === 'oid' || x.t === 'walk') && OIDRE.test(String(x.oid || '')));
      if (!s) { skipped.push(m.label || m.k); continue; }
      out.push({ label: m.label || m.k, unit: m.unit || '', t: s.t, oid: s.oid, agg: s.agg || 'avg', nameOid: s.nameOid || '', scale: s.scale ?? 1, offset: s.offset ?? 0, dtype: s.rate ? 'counter' : s.text ? 'text' : 'number', lookup: m.lookup || '', disp: { graph: true } });
    }
    return { name: p ? p.name : id, readings: out, skipped };
  };

  /** copies with new keys and alarm ids, so the copy is independent of its source */
  P.cloneReadings = function (list) { return (list || []).map((r) => { const { k, ...x } = r; return { ...x, alarms: (r.alarms || []).map(({ id, ...a }) => a) }; }); };

  P.copyReadings = function (toId, from, replace) {
    const to = this.devices().find((x) => x.id === toId); if (!to) { const e = new Error('No such device.'); e.status = 404; throw e; }
    const [kind, ref] = String(from || '').split(':'); let src, skipped = [];
    if (kind === 'dev') { const o = this.devices().find((x) => x.id === ref); if (!o) { const e = new Error('The device to copy from was not found.'); e.status = 404; throw e; } const own1 = this.readingsOf(ref); if (own1.length) src = own1; else { const b = this.builtinReadings(o.profile, this.state(o).detected); src = b.readings; skipped = b.skipped; } }
    else if (kind === 'tpl') { const t = (this.cfg.templates || []).find((x) => x.id === ref); if (!t) { const e = new Error('Template not found.'); e.status = 404; throw e; } src = t.readings; }
    else if (kind === 'builtin') { const b = this.builtinReadings(ref, this.state(to).detected); src = b.readings; skipped = b.skipped; }
    else { const e = new Error('Say where to copy the readings from.'); e.status = 400; throw e; }
    const add = this.cloneReadings(src), out = this.saveReadings(toId, [...(replace ? [] : this.readingsOf(toId)), ...add]);
    return { count: add.length, total: out.length, skipped };
  };

  // ---- templates: named sets of readings ----
  P.templates = function () { return (this.cfg.templates || []).map((t) => ({ id: t.id, name: t.name, count: t.readings.length, labels: t.readings.map((r) => r.label) })); };
  P.saveTemplate = function (name, fromDev, id) {
    name = String(name || '').trim().slice(0, 60); if (!name) { const e = new Error('Give the template a name.'); e.status = 400; throw e; }
    const list = this.cfg.templates || [], old = id ? list.find((t) => t.id === id) : list.find((t) => t.name.toLowerCase() === name.toLowerCase());
    let readings = old ? old.readings : []; if (fromDev) { readings = this.readingsOf(fromDev); if (!readings.length) { const d = this.devices().find((x) => x.id === fromDev); readings = d ? this.builtinReadings(d.profile, this.state(d).detected).readings : []; } readings = this.cloneReadings(readings).map((r) => this.cleanReading(r, new Set())); }
    if (!old && list.length >= 100) { const e = new Error('At most 100 templates.'); e.status = 400; throw e; }
    if (!readings.length) { const e = new Error('This device has no readings to save yet.'); e.status = 400; throw e; }
    const t = { id: old ? old.id : 'tp' + rid(), name, readings }, next = old ? list.map((x) => (x.id === old.id ? t : x)) : [...list, t];
    this.config.update({ polling: { ...this.cfg, templates: next } }); return t.id;
  };
  P.deleteTemplate = function (id) { const list = this.cfg.templates || []; if (!list.some((t) => t.id === id)) return false; this.config.update({ polling: { ...this.cfg, templates: list.filter((t) => t.id !== id) } }); return true; };

  /** what the readings editor of a device needs */
  P.readingsInfo = function (id) {
    const d = this.devices().find((x) => x.id === id); if (!d) return null; const rt = this.state(d), mine = this.readingsOf(id);
    const bid = d.profile && d.profile !== 'auto' && !String(d.profile).startsWith('dev-') ? d.profile : rt.detected || 'generic', bp = this.profiles().find((x) => x.id === bid && !x.own);
    return { readings: mine, own: mine.length > 0, builtin: bp ? { id: bp.id, name: bp.name } : null, builtinSets: this.profiles().filter((x) => x.builtin && x.id !== 'basic').map((x) => ({ id: x.id, name: x.name })),
      lookupTell: this.lookupTell(), devices: this.devices().filter((x) => x.id !== id).map((x) => ({ id: x.id, name: x.name, count: this.readingsOf(x.id).length })), templates: this.templates() };
  };

  /** read one OID of a stored device now and show the raw value and the calculated one (nothing is saved) */
  P.testReading = async function (id, r) {
    const d = this.devices().find((x) => x.id === id); if (!d) { const e = new Error('No such device.'); e.status = 404; throw e; }
    if (d.via) return { ok: false, error: 'This device is polled by a probe, so the server cannot read it directly. Save the reading and look at the values after the next poll.' };
    const c = this.cleanReading({ ...r, label: r.label || 'test', alarms: [] }, new Set()), t = target({ ...d, retries: Math.min(1, d.retries) }), sc = c.scale * (c.dtype === 'ticks' ? 0.01 : 1), calc = (n) => (c.dtype === 'text' ? n : Math.round((n * sc + c.offset) * 1e6) / 1e6);
    try {
      if (c.t === 'oid') { const x = await this.collector.client.get(t, [c.oid]), vb = x.vbs[0], n = numOf(vb); return c.dtype === 'text' ? { ok: true, rows: [{ raw: toText(vb), value: toText(vb) }] } : n === null ? { ok: false, error: 'The device answered, but not with a number for this OID (it may not exist on this device).' } : { ok: true, rows: [{ raw: n, value: calc(n) }], rtt: x.rtt }; }
      const x = await this.collector.client.walk(t, c.oid, { maxRows: 60 }); if (!x.vbs.length) return { ok: false, error: 'No rows under this OID. Check the number, or that this device has this table.' };
      const base = c.oid.split('.').length; let names = null;
      if (c.nameOid) { try { names = new Map(); for (const vb of (await this.collector.client.walk(t, c.nameOid, { maxRows: 60 })).vbs) names.set(vb.oid.slice(c.nameOid.split('.').length).join('.'), toText(vb)); } catch { names = null; } }
      const rows = x.vbs.slice(0, 20).map((vb) => { const idx = vb.oid.slice(base).join('.'), n = numOf(vb); return { name: (names && names.get(idx)) || idx, raw: c.dtype === 'text' ? toText(vb) : n, value: n === null ? toText(vb) : calc(n) }; });
      return { ok: true, rows, more: x.vbs.length > rows.length, rtt: x.rtt };
    } catch (e) { return { ok: false, error: e.code === 'timeout' ? 'The device did not answer in time.' : e.message }; }
  };

  // ---- layout of a device page: what is shown, how big, in which order (1.56) ----
  P.layoutOf = function (id) { const l = (this.cfg.layouts || {})[id]; return l && typeof l === 'object' ? l : { items: {}, order: [] }; };
  P.saveLayout = function (id, b) {
    if (!this.devices().some((x) => x.id === id)) { const e = new Error('No such device.'); e.status = 404; throw e; }
    const items = {}, KEY = /^[a-z]:[a-z0-9._-]{1,40}$/i;
    for (const [k, v] of Object.entries((b && b.items) || {}).slice(0, 200)) { if (!KEY.test(k) || !v || typeof v !== 'object') continue;
      const fin = (x) => (x === '' || x === null || x === undefined || !Number.isFinite(+x) ? null : +x);
      items[k] = { show: v.show !== false, span: Math.round(num(v.span, 1, 1, 4)), h: Math.round(num(v.h, 200, 100, 700)), style: v.style === 'area' ? 'area' : v.style === 'line' ? 'line' : '', hours: fin(v.hours) === null ? null : num(v.hours, 24, 1, 8760), color: /^#[0-9a-f]{6}$/i.test(v.color || '') ? v.color : '', max: fin(v.max), min: fin(v.min), ...(v.w ? { w: Math.round(num(v.w, 0, 0, 12)) } : {}) }; }
    const order = (Array.isArray(b && b.order) ? b.order : []).map(String).filter((k) => KEY.test(k)).slice(0, 200), layouts = { ...(this.cfg.layouts || {}) };
    if (!Object.keys(items).length && !order.length) delete layouts[id]; else layouts[id] = { items, order };
    this.config.update({ polling: { ...this.cfg, layouts } }); return layouts[id] || { items: {}, order: [] };
  };

  /* ---------- 1.58: polled data on the dashboard ---------- */
  const IDRE = /^[A-Za-z0-9_.-]{1,40}$/;
  const txt = (v, n) => String(v ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, n);
  /** the settings of a dashboard "Polled devices" tile, cleaned (used when a dashboard is saved and when the tile asks for its data) */
  const cleanPollSpec = function (c) {
    c = c && typeof c === 'object' ? c : {}; const o = {};
    o.src = ['readings', 'status', 'alarms'].includes(c.src) ? c.src : 'readings';
    o.view = ['table', 'tiles', 'bars', 'big', 'gauge', 'line'].includes(c.view) ? c.view : (o.src === 'readings' ? 'table' : 'tiles');
    if (['square', 'round', 'circle', 'hex', 'hexo'].includes(c.shape)) o.shape = c.shape;
    if (['first', 'avg', 'min', 'max', 'sum'].includes(c.agg)) o.agg = c.agg;
    const g = txt(c.group, 40); if (g) o.group = g;
    o.hours = Math.round(num(c.hours, 6, 1, 168));
    if (c.max !== undefined && c.max !== '' && c.max !== null && Number.isFinite(+c.max)) o.max = +c.max;
    o.picks = (Array.isArray(c.picks) ? c.picks : []).slice(0, 40).map((x) => {
      if (!x || typeof x !== 'object') return null; const k = {};
      if (IDRE.test(x.dev || '')) k.dev = x.dev; if (IDRE.test(x.k || '')) k.k = x.k;
      const row = txt(x.row, 80), label = txt(x.label, 80), gg = txt(x.group, 40); if (row) k.row = row; if (label) k.label = label; if (gg) k.group = gg;
      return (k.label || (k.dev && k.k)) ? k : null; }).filter(Boolean);
    return o;
  };

  P.cleanPollSpec = cleanPollSpec;
  module.exports.cleanPollSpec = cleanPollSpec;
  /** what the dashboard can choose from: devices with their readings and rows, the reading names that exist on several devices, and the groups */
  P.pollCatalog = function () {
    const devices = this.devices().map((d) => {
      const rt = this.state(d), own = this.readingsOf(d.id), prof = this.profile(d.profile && d.profile !== 'auto' ? d.profile : rt.detected || 'generic');
      const list = own.length ? own : prof.metrics.filter((m) => m.k !== 'uptime' && !String(m.k).startsWith('if.'));
      return { id: d.id, name: d.name, group: d.group || '', readings: list.map((r) => { const rows = []; for (const [key] of rt.last) { const i = key.indexOf('|'); if (key.slice(0, i) === r.k && key.slice(i + 1)) rows.push(key.slice(i + 1)); } for (const [key] of (rt.texts || new Map())) { const i = key.indexOf('|'); if (key.slice(0, i) === r.k && key.slice(i + 1) && !rows.includes(key.slice(i + 1))) rows.push(key.slice(i + 1)); }
        return { k: r.k, label: r.label || r.k, unit: r.unit || '', rows: rows.slice(0, 60) }; }) };
    });
    const labels = {}; for (const d of devices) for (const r of d.readings) { const k = r.label.toLowerCase(); (labels[k] ||= { label: r.label, devices: 0 }).devices++; }
    return { devices, labels: Object.values(labels).sort((a, b) => b.devices - a.devices || a.label.localeCompare(b.label)), groups: [...new Set(devices.map((d) => d.group).filter(Boolean))].sort() };
  };

  /** the data of one dashboard tile */
  P.pollTile = function (spec) {
    const s = this.cleanPollSpec(spec), devs = this.devices(), out = { src: s.src, view: s.view, at: Date.now() };
    const inGroup = (d, g) => !g || (d.group || '') === g;
    if (s.src === 'status' || s.src === 'alarms') {
      const rows = devs.filter((d) => inGroup(d, s.group)).map((d) => { const rt = this.state(d); return { id: d.id, name: d.name, group: d.group || '', state: this.shownState(d, rt), rtt: rt.rtt ?? null, alarms: this.alarmCount(d) }; });
      out.devices = rows; out.alarms = rows.reduce((n, r) => n + r.alarms, 0); out.groups = {};
      for (const r of rows) { const g = out.groups[r.group] ||= { n: 0, up: 0, down: 0, alarms: 0 }; g.n++; if (r.state === 'up') g.up++; if (r.state === 'down') g.down++; g.alarms += r.alarms; }
      return out;
    }
    const picks = s.picks.length ? s.picks : [], entries = [];
    const add = (d, k, label, unit, items, disp, row) => {
      const rt = this.state(d), have = []; for (const [key, x] of rt.last) { const i = key.indexOf('|'); if (key.slice(0, i) === k) have.push([key.slice(i + 1), x.v]); }
      const texts = []; for (const [key, x] of (rt.texts || new Map())) { const i = key.indexOf('|'); if (key.slice(0, i) === k) texts.push([key.slice(i + 1), x.s]); }
      const named = have.filter(([i]) => i), rows = row ? have.filter(([i]) => i === row) : named.length ? named : have.filter(([i]) => !i);
      const base = { dev: d.id, devName: d.name, group: d.group || '', k, label, unit: unit || '', dec: disp && Number.isFinite(+disp.dec) ? +disp.dec : null, max: disp && disp.max !== null && disp.max !== undefined && Number.isFinite(+disp.max) ? +disp.max : null, down: rt.state === 'down' };
      for (const [i, v] of rows) { const it = matchItem(items, v); entries.push({ ...base, row: i, v, state: it ? it.state : 'unk', meaning: it ? it.label : '' }); }
      if (!rows.length) for (const [i, t] of texts.filter(([i2]) => !row || i2 === row)) entries.push({ ...base, row: i, v: null, text: t, state: 'unk', meaning: '' });
    };
    for (const p of picks) {
      for (const d of devs) {
        if (p.label ? !inGroup(d, p.group || s.group) : d.id !== p.dev) continue;
        const rt = this.state(d), own = this.readingsOf(d.id), prof = this.profile(d.profile && d.profile !== 'auto' ? d.profile : rt.detected || 'generic');
        const r = p.label ? [...own, ...prof.metrics].find((x) => String(x.label || x.k).toLowerCase() === p.label.toLowerCase()) : [...own, ...prof.metrics].find((x) => x.k === p.k);
        if (r) add(d, r.k, r.label || r.k, r.unit, r.items || (r.lookup ? ((this.cfg.lookups || []).find((l) => l.id === r.lookup) || {}).items : null), r.disp, p.row);
      }
    }
    out.entries = entries.slice(0, 200);
    if (s.view === 'line') { const to = Date.now(), from = to - s.hours * 3600000; out.series = out.entries.slice(0, 8).map((e) => ({ name: e.devName + (e.row ? ' · ' + e.row : '') + (picks.every((p) => p.label === picks[0].label) ? '' : ' · ' + e.label), unit: e.unit, pts: this.series(e.dev, e.k, e.row || '', from, to, 60).map((x) => [x.t, x.v]) })); out.from = from; out.to = to; }
    return out;
  };

  /** forget everything that belongs to a device that is removed */
  P.dropReadings = function (id) {
    const c = this.cfg; if (!(c.readings || {})[id] && !(c.layouts || {})[id] && !(c.thresholds || []).some((t) => t.owner === id) && !(c.lookups || []).some((l) => l.owner === id)) return;
    for (const t of (c.thresholds || []).filter((x) => x.owner === id)) this.clearAlarms('poll-' + t.id);
    for (const l of (c.lookups || []).filter((x) => x.owner === id)) for (const st of ['warn', 'crit']) this.clearAlarms(`poll-lk-${l.rk}-${st}`);
    const readings = { ...(c.readings || {}) }, layouts = { ...(c.layouts || {}) }; delete readings[id]; delete layouts[id];
    this.config.update({ polling: { ...c, readings, layouts, thresholds: (c.thresholds || []).filter((t) => t.owner !== id), lookups: (c.lookups || []).filter((l) => l.owner !== id) } });
  };
};
module.exports.OIDRE = OIDRE; module.exports.cleanItems = cleanItems; module.exports.matchItem = matchItem;
