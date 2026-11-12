'use strict';
// One column list for everything that shows logs, traps or alarms: the windows, the CSV downloads, the scheduled reports (CSV / Excel / PDF) and the e-mail.
// The user's choice (which columns, in which order) is saved with the screen layout (config.uiPrefs.columns.logs | traps | alarms); this file turns it into
// [{ id, label, get(row), w }] so the exports use the same columns, headings and cell text as the window. Keep the definitions in step with COLUMN_DEFS in
// public/app.js and ACOLS in public/alarms.js.
const SEVX = require('./sev');
const { FACILITIES } = require('./parser');
const TC = require('./trapcols');

const pad = (n, w = 2) => String(n).padStart(w, '0');
const dateOf = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const timeOf = (ts, ms = true) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` + (ms ? '.' + pad(d.getMilliseconds(), 3) : ''); };
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const sevName = (n) => cap(SEVX.NAMES[n] || '');
const dur = (ms) => { const m = Math.round(ms / 60000); return m < 90 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`; };

// label = the long name shown in the column chooser, th = the heading on the screen (that is what the exports use), w = relative width for the PDF (points)
const LOG_DEFS = {
  date: { th: 'Date', w: 54, get: (m) => dateOf(m.ts) },
  time: { th: 'Time', w: 62, get: (m) => timeOf(m.ts) },
  devtime: { th: 'Device time', w: 58, get: (m) => (m.devTs ? timeOf(m.devTs, false) : '') },
  host: { th: 'Device', w: 100, get: (m) => m.host || '' },
  ip: { th: 'Source IP', w: 72, get: (m) => m.srcIp || '' },
  app: { th: 'Process', w: 70, get: (m) => m.app || '' },
  pid: { th: 'PID', w: 34, get: (m) => m.pid || '' },
  facility: { th: 'Facility', w: 52, get: (m) => FACILITIES[m.facility] ?? m.facility ?? '' },
  severity: { th: 'Severity', w: 52, get: (m) => sevName(m.severity) },
  id: { th: '#', w: 36, get: (m) => m.seq || m.id || '' },
  snmpver: { th: 'SNMP', w: 36, get: (m) => TC.vbOf(m)?.ver || /^SNMPv(\S+)/.exec(m.raw || '')?.[1]?.replace(/^/, 'v') || '' },
  trap: { th: 'Trap', w: 110, get: (m) => m.msgid || '' },
  message: { th: 'Message', w: 0, get: (m) => m.message || '' }
};
const DEFAULT_COLS = { logs: ['date', 'time', 'host', 'app', 'severity', 'message'], traps: ['date', 'time', 'host', 'severity', 'snmpver', 'trap', 'message'] };

const ALARM_DEFS = {
  sev: { th: 'Severity', w: 52, get: (a) => sevName(a.severity) },
  device: { th: 'Device', w: 100, get: (a) => a.host || '' },
  port: { th: 'Port / item', w: 70, get: (a) => a.port || '' },
  alarm: { th: 'Alarm', w: 110, get: (a) => (a.rule || '') + (a.count > 1 ? ` x${a.count}` : '') },
  message: { th: 'Last message', w: 0, get: (a) => a.message || '' },
  raised: { th: 'Raised', w: 100, get: (a) => `${dateOf(a.first)} ${timeOf(a.first, false)}` },
  cleared: { th: 'Cleared', w: 100, hist: true, get: (a) => (a.clearedTs ? `${dateOf(a.clearedTs)} ${timeOf(a.clearedTs, false)}` : '') },
  dur: { th: 'Duration', w: 50, get: (a) => dur((a.clearedTs || Date.now()) - a.first) },
  source: { th: 'Source', w: 46, get: (a) => (a.source === 'snmp' ? 'SNMP trap' : 'Syslog') },
  ack: { th: 'Acknowledged', w: 80, get: (a) => (a.ackTs ? `${a.ackBy || ''} ${timeOf(a.ackTs, false)}`.trim() : '') },
  esc: { th: 'Escalated', w: 70, get: (a) => (a.escTs ? `Escalated ${timeOf(a.escTs, false)}` : '') },
  by: { th: 'Cleared by', w: 60, hist: true, get: (a) => (/^auto/.test(a.clearedBy || '') ? 'auto' : a.clearedBy || '') },
  ip: { th: 'IP address', w: 72, get: (a) => a.srcIp || '' }
};
const ALARM_DEFAULT = ['sev', 'device', 'port', 'alarm', 'message', 'raised', 'ack', 'esc', 'cleared', 'by', 'dur'];
const ALARM_OLD = { rdate: 'raised', ldate: 'last', cdate: 'cleared', rtime: null, ltime: null, ctime: null };

/** ids in the saved order, visible ones only; columns the user never saw are hidden unless they are in the default */
function ids(saved, defs, def, always) {
  let list;
  if (Array.isArray(saved) && saved.length) {
    list = []; for (const c of saved) { const id = c.id in ALARM_OLD && defs === ALARM_DEFS ? ALARM_OLD[c.id] : c.id; if (id && defs[id] && !list.some((x) => x.id === id)) list.push({ id, visible: c.visible !== false }); }
    for (const id of Object.keys(defs)) if (!list.some((x) => x.id === id)) list.push({ id, visible: id === 'snmpver' && defs === LOG_DEFS });
  } else { list = def.map((id) => ({ id, visible: true })); for (const id of Object.keys(defs)) if (!def.includes(id)) list.push({ id, visible: false }); }
  if (always) { const m = list.find((c) => c.id === always); if (m) m.visible = true; }
  return list.filter((c) => c.visible).map((c) => c.id);
}
const make = (defs, list) => list.map((id) => ({ id, label: defs[id].th, w: defs[id].w, get: defs[id].get }));

/** columns of the Live log / Search history ('logs') or of the Traps page ('traps'); the chosen trap view (own columns) wins for traps like it does on screen */
function logColumns(prefs, view = 'logs') {
  const p = prefs || {};
  if (view === 'traps') {
    const vs = Array.isArray(p.trapViews) ? p.trapViews : [], v = vs.length === 1 ? vs[0] : vs.find((x) => x.id === p.trapViewDefault);
    if (v && Array.isArray(v.cols) && v.cols.length) return TC.viewColumns(v).map((c) => ({ ...c, w: c.label === 'Message' ? 0 : c.label === 'Date' ? 54 : c.label === 'Time' ? 62 : c.label === 'Severity' ? 52 : 90, id: c.label }));
  }
  const saved = p.columns?.[view] || (view === 'logs' ? p.columns?.live || p.columns?.search : null);
  const allowed = (id) => view === 'traps' || (id !== 'trap' && id !== 'snmpver');
  const list = ids(saved, LOG_DEFS, DEFAULT_COLS[view], 'message').filter(allowed);
  return make(LOG_DEFS, list);
}
/** columns of the alarm table; the active list leaves out the columns that only make sense for cleared alarms */
function alarmColumns(prefs, history = false) {
  const saved = prefs?.columns?.alarms; const usable = Array.isArray(saved) && saved.some((c) => c.id === 'ack') ? saved : null;
  const list = ids(usable, ALARM_DEFS, ALARM_DEFAULT).filter((id) => history || !ALARM_DEFS[id].hist);
  return make(ALARM_DEFS, list);
}
/** widths in points for a PDF grid: fixed widths from the column list, the message column takes what is left (min 150) */
function pdfWidths(cols, total, gap = 4) {
  const fixed = cols.filter((c) => c.w > 0); let sum = fixed.reduce((n, c) => n + c.w + gap, 0); const msgMin = 150;
  const k = Math.min(1, (total - msgMin - (cols.length - fixed.length) * gap) / (sum || 1));
  return cols.map((c) => (c.w > 0 ? Math.max(24, Math.floor(c.w * k)) : 0)).map((w, i, a) => (w > 0 ? w : Math.max(60, total - a.reduce((n, x, j) => n + (x > 0 ? x + gap : 0), 0) - (a.filter((x) => x === 0).length - 1) * gap)));
}
module.exports = { logColumns, alarmColumns, pdfWidths, LOG_DEFS, ALARM_DEFS, dateOf, timeOf };
