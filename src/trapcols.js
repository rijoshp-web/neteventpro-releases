'use strict';
const { rulesFor, fieldView, colText } = require('./trapreplace');
// Trap column views on the server: the CSV / JSON export of the Traps page uses the same columns, recipes and lookups as the screen.
// Keep this in step with recipeValue / cellText / applyMap in public/app.js.
const { SEVERITIES } = require('./parser');

const pad = (n, w = 2) => String(n).padStart(w, '0');
const dateOf = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const timeOf = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function vbOf(m) {
  if (m._vb !== undefined) return m._vb;
  let v = m.vb; if (typeof v === 'string') { try { v = v ? JSON.parse(v) : null; } catch { v = null; } }
  return (m._vb = v && typeof v === 'object' ? v : null);
}
function vbValue(m, field) {
  const f = String(field).toLowerCase(), vb = vbOf(m);
  if (vb?.v) {
    for (const [n, o, val] of vb.v) { const nl = String(n).toLowerCase(); if (nl === f || nl.startsWith(f + '.') || nl.split('.')[0] === f || o === field || o.startsWith(field + '.')) return val; }
    return '';
  }
  const mt = new RegExp('(?:^|[:,] )' + esc(field) + '(?:\\.[\\d.]+)? = ([^,]*)', 'i').exec(m.message || '');
  return mt ? mt[1] : '';
}
function recipeValue(m, key) {
  const [name, mod] = key.split(':').map((x) => x.trim()); const n = name.toLowerCase(); let v = ''; const vb = vbOf(m);
  if (n === 'agent') v = vb?.a || /\[agent ([\d.]+)\]/.exec(m.message || '')?.[1] || m.srcIp || '';
  else if (n === 'source' || n === 'ip') v = m.srcIp || '';
  else if (n === 'trap') v = vb?.n || m.msgid || '';
  else if (n === 'oid') v = vb?.o || m.trapOid || '';
  else if (n === 'host' || n === 'device') v = m.host || '';
  else if (n === 'severity') v = cap(SEVERITIES[m.severity] || '');
  else if (n === 'message') v = m.message || '';
  else if (n === 'number' || n === 'id') v = m.seq || m.id || '';
  else if (n === 'date') v = m.ts ? dateOf(m.ts) : '';
  else if (n === 'time') v = m.ts ? timeOf(m.ts) : '';
  else if (n === 'devtime') v = m.devTs ? dateOf(m.devTs) + ' ' + timeOf(m.devTs) : '';
  else if (n === 'app' || n === 'process') v = m.app || '';
  else if (n === 'pid') v = m.pid || '';
  else if (n === 'version' || n === 'snmpversion' || n === 'ver') v = vb?.ver || /^SNMPv(\S+)/.exec(m.raw || '')?.[1]?.replace(/^/, 'v') || '';
  else if (n === 'mib') v = /^([A-Za-z0-9_-]+)::/.exec(m.message || '')?.[1] || '';
  else if (n === 'values') v = (vb?.v || []).map(([k, , val]) => `${k}=${val}`).join(', ');
  else v = vbValue(m, name);
  v = String(v ?? '').trim();
  if (mod === 'name') v = v.replace(/\(\s*-?\d+\s*\)\s*$/, '').trim(); else if (mod === 'num') v = (/\(\s*(-?\d+)\s*\)\s*$/.exec(v) || [])[1] ?? v; else if (mod === 'upper') v = v.toUpperCase(); else if (mod === 'lower') v = v.toLowerCase();
  return v;
}
function cellText(m, spec) {
  spec = String(spec ?? ''); if (!spec.includes('{')) return vbValue(m, spec);
  const text = spec.replace(/\{([^{}]+)\}/g, (_, inner) => { for (const alt of inner.split('|')) { const v = recipeValue(m, alt.trim()); if (v) return v; } return '\u0001'; });
  return text.replace(/\s*[-–—:,;|/]*\s*\u0001(?:\s*[-–—:,;|/]*\s*\u0001)*/g, ' ').replace(/\u0001/g, '').replace(/\s{2,}/g, ' ').replace(/^[\s\-–—:,;|/]+|[\s\-–—:,;|/]+$/g, '').trim();
}
function trapMatches(m, match) {
  if (!match) return true; const vb = vbOf(m), oid = vb?.o || m.trapOid || '', name = vb?.n || m.msgid || '';
  const rx = /^\/(.+)\/([a-z]*)$/.exec(match); if (rx) { try { const re = new RegExp(rx[1], rx[2]); return re.test(name) || re.test(oid); } catch { return false; } }
  if (/^[\d.]+$/.test(match)) { const e = match.replace(/\.$/, ''); return oid === e || oid.startsWith(e + '.'); }
  return name.toLowerCase() === match.toLowerCase();
}
/** several values in one entry: "0,2,3,8=Critical", "0|2=Critical" and number ranges "2-5=Critical" (each value is also found as written) */
function mapKeys(k) {
  if (!/[,|]/.test(k) && !/^-?\d+\s*-\s*-?\d+$/.test(k)) return [];
  const out = [];
  for (const p of k.split(/[,|]/)) {
    const s = p.trim(); if (!s) continue; const r = /^(\d+)\s*-\s*(\d+)$/.exec(s);
    if (r && +r[2] >= +r[1] && +r[2] - +r[1] <= 1000) for (let n = +r[1]; n <= +r[2]; n++) out.push(String(n)); else out.push(s);
  }
  return out;
}
function parseMap(str) {
  const r = { scoped: [], all: { pairs: new Map(), def: null } };
  for (const line of String(str).split('\n')) {
    const h = /^\s*@\s*([^:]+?)\s*:(.*)$/.exec(line), t = h ? { match: h[1], pairs: new Map(), def: null } : r.all, body = h ? h[2] : line;
    for (const part of body.split(';')) { const i = part.indexOf('='); if (i < 1) continue; const k = part.slice(0, i).trim().toLowerCase(), v = part.slice(i + 1).trim(); if (k === '*') t.def = v; else if (k) { t.pairs.set(k, v); for (const x of mapKeys(k)) if (!t.pairs.has(x)) t.pairs.set(x, v); } }
    if (h) r.scoped.push(t);
  }
  return r;
}
function applyMap(text, mapStr, m, cache) {
  if (!mapStr || text === '' || text == null) return text;
  let t = cache?.get(mapStr); if (!t) { t = parseMap(mapStr); cache?.set(mapStr, t); }
  const v = String(text).trim().toLowerCase(), mm = /^(.*?)\s*\(\s*(-?\d+)\s*\)\s*$/.exec(v), keys = mm ? [v, mm[1], mm[2]] : [v];
  const tables = [...t.scoped.filter((x) => trapMatches(m, x.match)), t.all];
  for (const x of tables) for (const k of keys) if (x.pairs.has(k)) return x.pairs.get(k);
  for (const x of tables) if (x.def !== null) return x.def;
  return text;
}

/** the columns of a view as the export shows them: [{ label, get(row) }] */
/** the text replacement rules that change trap columns when they are shown or exported (set by the engine when the settings change) */
let repRules = [];
const setReplacements = (list) => { repRules = rulesFor(list); };
function viewColumns(view) {
  if (!view) return null; const cache = new Map();
  const cols = [];
  if (view.std !== false) cols.push({ label: 'Date', get: (m) => dateOf(m.ts) }, { label: 'Time', get: (m) => timeOf(m.ts) }, { label: 'Device', get: (m) => m.host || '' }, { label: 'Severity', get: (m) => cap(SEVERITIES[m.severity] || '') });
  for (const c of view.cols || []) if (!c.hide) cols.push({ label: c.label, get: (m) => colText(applyMap(cellText(fieldView(m, repRules), c.field), c.map, m, cache), c.label, c.field, repRules) });
  if (view.message) cols.push({ label: 'Message', get: (m) => m.message || '' });
  return cols;
}
/** the severity a trap view takes from its "severity" column (text after the lookup read as a severity word), or null */
function severityOf(views, def, msg) {
  const list = (views || []).filter((v) => v && Array.isArray(v.cols) && v.cols.some((c) => c.sev)); if (!list.length) return null;
  const v = list.find((x) => x.id === def && trapMatches(msg, x.match)) || list.find((x) => trapMatches(msg, x.match)); if (!v) return null;
  const c = v.cols.find((x) => x.sev); const text = applyMap(cellText(msg, c.field), c.map, msg);
  return require('./sev').fromWord(text);
}
module.exports = { setReplacements, severityOf, viewColumns, cellText, applyMap, trapMatches, vbOf };
