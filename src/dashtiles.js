'use strict';
/**
 * The numbers and rankings of a person's own dashboard, for a report.
 * Uses the same data sources and the same wording as the dashboard page (public/dashboard.js), for the tile types that show a number or a ranking:
 * number / gauge tiles and every ranking tile (top list, pie, bar, table ...). Charts over time and live tiles are not part of a report.
 */
const { SEVERITIES } = require('./parser');
const KIND = { alarms: 'alarms', devices: 'devices' };
const METRICS = {      // the metrics that the dashboard answers from the database (same ids as the dashboard page)
  total: { k: 'events', label: 'Messages' }, errors: { k: 'events', label: 'Errors and worse' }, warnings: { k: 'events', label: 'Warnings' }, hosts: { k: 'events', label: 'Devices that sent messages' },
  alActive: { k: 'alarms', s: 'active', label: 'Active alarms' }, alOpen: { k: 'alarms', s: 'open', label: 'Open alarms not yet acknowledged' }, alAck: { k: 'alarms', s: 'ack', label: 'Acknowledged alarms' },
  alEsc: { k: 'alarms', s: 'esc', label: 'Escalated alarms' }, alRaised: { k: 'alarms', s: 'raised', label: 'Alarms raised' }, alCleared: { k: 'alarms', s: 'cleared', label: 'Alarms cleared' },
  dvAll: { k: 'devices', s: 'all', label: 'Devices' }, dvReporting: { k: 'devices', s: 'reporting', label: 'Devices reporting normally' }, dvSilent: { k: 'devices', s: 'silent', label: 'Silent devices' },
  dvMuted: { k: 'devices', s: 'muted', label: 'Muted devices' }, dvOverdue: { k: 'devices', s: 'overdue', label: 'Overdue devices' }, dvAlarms: { k: 'devices', s: 'alarms', label: 'Devices with open alarms' }
};
const RANKED = new Set(['top', 'pie', 'bar', 'treemap', 'table', 'bargauge', 'waffle', 'radial', 'rose', 'cloud', 'bubble', 'funnel', 'podium', 'sevbars']);
const SRC = { syslog: 'syslog', snmp: 'snmp', events: 'all' };

function pick(prefs, id) {
  const p = prefs || {};
  if (id && Array.isArray(p.dashboards)) { const d = p.dashboards.find((x) => x.id === id); if (d && d.dash) return { name: d.name || 'Dashboard', tiles: d.dash.tiles || [] }; }
  const m = p.dash || {}; return { name: 'Main dashboard', tiles: m.tiles || [] };
}
/** → { name, requests[], meta{tileId → {title, kind, by, metric}} } */
function plan(prefs, id) {
  const { name, tiles } = pick(prefs, id), requests = [], meta = new Map(); let n = 0;
  for (const t of tiles) {
    if (!t || !t.type || !/^[a-z0-9_]{1,24}$/.test(String(t.id || ''))) continue;
    const c = t.cfg || {}, f = { ...(c.filter || {}) }, ds = KIND[c.ds] || 'events';
    if (ds === 'events' && c.ds && SRC[c.ds]) f.source = SRC[c.ds]; delete f.dstate; delete f.astate;
    const title = String(t.title || '').slice(0, 80);
    if (t.type === 'kpi' || t.type === 'gauge') {
      const M = METRICS[c.metric || 'total']; if (!M) continue; const q = { id: t.id, kind: M.k === 'events' && c.metric === 'hosts' ? 'distinct' : 'count', filter: f };
      if (M.k === 'events') { if (c.metric === 'errors') f.severityMax = Math.min(f.severityMax ?? 7, 3); if (c.metric === 'warnings') { f.severityMax = Math.min(f.severityMax ?? 7, 4); f.severityMin = Math.max(f.severityMin ?? 0, 4); } }
      else if (M.k === 'alarms') { q.ds = 'alarms'; f.astate = M.s; } else { q.ds = 'devices'; f.dstate = M.s; }
      requests.push(q); meta.set(t.id, { title: title || M.label, one: true });
    } else if (RANKED.has(t.type)) {
      const by = t.type === 'sevbars' ? 'severity' : c.by || (ds === 'devices' ? 'vendor' : 'host'), q = { id: t.id, kind: 'top', by, n: Math.min(+c.n || 8, 25), filter: f }; if (ds !== 'events') q.ds = ds;
      requests.push(q); meta.set(t.id, { title: title || `Top ${by}`, by });
    }
    if (++n >= 60) break;
  }
  return { name, requests, meta };
}
/** run the plan with `dashFn(body)`; returns rows [tile, item, value] */
async function run(prefs, id, from, to, dashFn) {
  const pl = plan(prefs, id); if (!pl.requests.length) return { name: pl.name, rows: [] };
  const res = await dashFn({ from, to, tiles: pl.requests }), rows = [];
  for (const q of pl.requests) {
    const m = pl.meta.get(q.id), r = res.tiles && res.tiles[q.id]; if (!r) continue;
    if (m.one) rows.push([m.title, '', r.n ?? r.value ?? 0]);
    else for (const x of r.rows || []) rows.push([m.title, m.by === 'severity' && SEVERITIES[x.key] ? require('./sev').label(x.key) : String(x.label ?? x.key ?? ''), x.n ?? x.value ?? 0]);
  }
  return { name: pl.name, rows };
}
module.exports = { plan, run };
