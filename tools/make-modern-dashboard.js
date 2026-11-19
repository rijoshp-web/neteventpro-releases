'use strict';
// Builds dashboards/NetEventPro-Aurora.json: a ready-made dashboard to import (Dashboard → ⋮ → Import…).
// Hero numbers sit on their own gradients with white text, so they read the same in every theme; every chart keeps the
// theme's own panel colours. No per-device tiles, so it stays fast with tens of thousands of devices.
const fs = require('node:fs'), path = require('node:path');
const T = (id, type, title, x, y, w, h, cfg = {}) => ({ id, type, title, x, y, w, h, cfg });
const SEC = (id, title, y) => T(id, 'section', title, 0, y, 12, 1);
const hero = (a, b) => ({ bgMode: 'gradient', bg: a, bg2: b, angle: 140, bw: 0, radius: 18, shadow: 'soft', tc: '#ffffff', tColor: '#ffffff', tSize: 13 });
const soft = { radius: 18 };
const ch = { smooth: true, grad: true, fillA: 32, lw: 2.5, grid: true, legend: true, pts: false };
const G = { alarm: ['#be123c', '#f97316'], err: ['#6d28d9', '#db2777'], msg: ['#0369a1', '#6366f1'], dev: ['#047857', '#0d9488'], trap: ['#a16207', '#ea580c'], poll: ['#1e3a8a', '#0891b2'] };

const overview = [
  T('o_al', 'statspark', 'Active alarms', 0, 0, 3, 5, { ds: 'alarms', metric: 'alActive', graph: 'area', look: hero(...G.alarm) }),
  T('o_err', 'statspark', 'Errors and worse', 3, 0, 3, 5, { metric: 'errors', graph: 'area', look: hero(...G.err) }),
  T('o_msg', 'statspark', 'Messages', 6, 0, 3, 5, { metric: 'total', graph: 'area', val: { compact: true }, look: hero(...G.msg) }),
  T('o_dev', 'kpi', 'Devices reporting', 9, 0, 3, 5, { ds: 'devices', metric: 'dvReporting', look: hero(...G.dev) }),
  T('o_line', 'line', 'Traffic by severity', 0, 5, 8, 9, { ds: 'events', mode: 'severity', ch, look: soft }),
  T('o_rad', 'radial', 'Severity mix', 8, 5, 4, 9, { ds: 'events', by: 'severity', n: 8, pal: 'theme', look: soft }),
  T('o_pod', 'podium', 'Busiest devices', 0, 14, 4, 10, { ds: 'events', by: 'host', n: 8, look: soft }),
  T('o_alst', 'pie', 'Alarms by state', 4, 14, 4, 10, { ds: 'alarms', by: 'state', n: 6, style: 'donut', pal: 'cool', look: soft }),
  T('o_dst', 'pie', 'Devices by status', 8, 14, 4, 10, { ds: 'devices', by: 'status', n: 6, style: 'donut', pal: 'cool', look: soft }),
  T('o_latest', 'latest', 'Active alarms', 0, 24, 12, 9, { ds: 'alarms', n: 10, filter: { astate: 'active' }, look: soft })
];
const alarms = [
  T('a_act', 'gauge', 'Active alarms', 0, 0, 3, 7, { ds: 'alarms', metric: 'alActive', gstyle: 'ring', th: { mode: 'value', steps: [{ v: 0, c: '#10b981' }, { v: 5, c: '#f59e0b' }, { v: 20, c: '#ef4444' }] }, look: soft }),
  T('a_open', 'alarm', 'Open', 3, 0, 3, 3, { card: 'open', look: hero(...G.alarm) }),
  T('a_ack', 'alarm', 'Acknowledged', 6, 0, 3, 3, { card: 'ack', look: hero(...G.poll) }),
  T('a_esc', 'alarm', 'Escalated', 9, 0, 3, 3, { card: 'esc', look: hero(...G.err) }),
  T('a_rais', 'statspark', 'Raised in range', 3, 3, 3, 4, { ds: 'alarms', metric: 'alRaised', graph: 'area', look: soft }),
  T('a_clr', 'kpi', 'Cleared in range', 6, 3, 3, 4, { ds: 'alarms', metric: 'alCleared', look: soft }),
  T('a_avg', 'kpi', 'Average time to clear', 9, 3, 3, 4, { ds: 'alarms', metric: 'alAvgClear', look: soft }),
  T('a_trend', 'line', 'Alarms over time', 0, 7, 8, 9, { ds: 'alarms', mode: 'severity', ch, look: soft }),
  T('a_rose', 'rose', 'Alarms by rule', 8, 7, 4, 9, { ds: 'alarms', by: 'rule', n: 10, pal: 'warm', look: soft }),
  T('a_fun', 'funnel', 'Devices with most alarms', 0, 16, 6, 9, { ds: 'alarms', by: 'host', n: 8, pal: 'warm', look: soft }),
  T('a_waf', 'waffle', 'Alarms by severity', 6, 16, 6, 9, { ds: 'alarms', by: 'severity', n: 8, look: soft })
];
const traffic = [
  T('t_rate', 'rate', 'Messages per second (live)', 0, 0, 4, 7, { look: soft }),
  T('t_tot', 'statspark', 'Syslog messages', 4, 0, 4, 7, { ds: 'syslog', metric: 'total', graph: 'area', val: { compact: true }, look: hero(...G.msg) }),
  T('t_hosts', 'statspark', 'Devices sending', 8, 0, 4, 7, { ds: 'syslog', metric: 'hosts', graph: 'area', look: hero(...G.dev) }),
  T('t_heat', 'heat', 'When it happens (weekday × hour)', 0, 7, 8, 9, { ds: 'syslog', mode: 'dowHour', look: soft }),
  T('t_bub', 'bubble', 'Facilities', 8, 7, 4, 9, { ds: 'syslog', by: 'facility', n: 10, pal: 'cool', look: soft }),
  T('t_tree', 'treemap', 'Busiest processes', 0, 16, 7, 9, { ds: 'syslog', by: 'app', n: 12, pal: 'cool', look: soft }),
  T('t_cloud', 'cloud', 'Busiest devices', 7, 16, 5, 9, { ds: 'syslog', by: 'host', n: 25, pal: 'cool', look: soft }),
  T('t_latest', 'latest', 'Latest errors and worse', 0, 25, 12, 9, { ds: 'syslog', n: 10, filter: { severityMax: 3 }, look: soft })
];
const traps = [
  T('s_tot', 'statspark', 'Traps', 0, 0, 4, 5, { ds: 'snmp', metric: 'total', graph: 'area', look: hero(...G.trap) }),
  T('s_err', 'statspark', 'Trap errors and worse', 4, 0, 4, 5, { ds: 'snmp', metric: 'errors', graph: 'area', look: hero(...G.err) }),
  T('s_dev', 'statspark', 'Devices sending traps', 8, 0, 4, 5, { ds: 'snmp', metric: 'hosts', graph: 'area', look: hero(...G.dev) }),
  T('s_line', 'line', 'Traps over time', 0, 5, 8, 9, { ds: 'snmp', mode: 'severity', ch, look: soft }),
  T('s_rcv', 'snmpstatus', 'Trap receiver', 8, 5, 4, 3, { look: soft }),
  T('s_name', 'bargauge', 'Trap names', 8, 8, 4, 6, { ds: 'snmp', by: 'msgid', n: 8, look: soft }),
  T('s_hosts', 'bar', 'Devices sending most traps', 0, 14, 6, 9, { ds: 'snmp', by: 'host', n: 10, pal: 'warm', look: soft }),
  T('s_latest', 'latest', 'Latest traps', 6, 14, 6, 9, { ds: 'snmp', n: 10, look: soft })
];
const devices = [
  T('d_all', 'kpi', 'Known devices', 0, 0, 3, 4, { ds: 'devices', metric: 'dvAll', look: hero(...G.poll) }),
  T('d_rep', 'kpi', 'Reporting', 3, 0, 3, 4, { ds: 'devices', metric: 'dvReporting', look: hero(...G.dev) }),
  T('d_ovd', 'kpi', 'Overdue', 6, 0, 3, 4, { ds: 'devices', metric: 'dvOverdue', look: hero(...G.trap) }),
  T('d_alm', 'kpi', 'With open alarms', 9, 0, 3, 4, { ds: 'devices', metric: 'dvAlarms', look: hero(...G.alarm) }),
  T('d_ven', 'pie', 'Vendors', 0, 4, 4, 9, { ds: 'devices', by: 'vendor', n: 8, style: 'donut', pal: 'cool', look: soft }),
  T('d_grp', 'radial', 'Groups', 4, 4, 4, 9, { ds: 'devices', by: 'group', n: 8, pal: 'cool', look: soft }),
  T('d_kind', 'waffle', 'What devices send', 8, 4, 4, 9, { ds: 'devices', by: 'kind', n: 6, look: soft }),
  T('d_poll', 'poll', 'Polled devices', 0, 13, 8, 8, { poll: { src: 'status', view: 'tiles', shape: 'round', hours: 6, picks: [] }, look: soft }),
  T('d_palm', 'poll', 'Polling alarms', 8, 13, 4, 8, { poll: { src: 'alarms', view: 'tiles', hours: 6, picks: [] }, look: soft }),
  T('d_sil', 'silent', 'Silent devices', 0, 21, 12, 7, { look: soft })
];
const dash = { mainName: 'Overview', mainIcon: 'main', style: { card: 'raised', titles: 'normal', radius: 18, gap: 14, density: 'normal', refresh: 10 }, alarmTiles: true, snmpTiles: true,
  tiles: overview, sheets: [{ id: 'aur_alarms', name: 'Alarms', icon: 'alarms', tiles: alarms }, { id: 'aur_traffic', name: 'Traffic', icon: 'chart', tiles: traffic }, { id: 'aur_traps', name: 'SNMP traps', icon: 'traps', tiles: traps }, { id: 'aur_devices', name: 'Devices', icon: 'devices', tiles: devices }] };
const out = { neteventpro: 'dashboard', format: 1, name: 'Aurora', exported: '2026-11-19T00:00:00.000Z', dash };
const txt = JSON.stringify(out, null, 2) + '\n'; fs.writeFileSync(path.join(__dirname, '..', 'dashboards', 'NetEventPro-Aurora.json'), txt); fs.writeFileSync(path.join(__dirname, '..', 'public', 'dash-aurora.js'), '// generated by tools/make-modern-dashboard.js: the ready-made Aurora dashboard (Dashboard → ⋮ → New dashboard → Ready-made: Aurora)\nwindow.NEP_DASH_AURORA = ' + JSON.stringify(out) + ';\n');
console.log('tiles', overview.length + alarms.length + traffic.length + traps.length + devices.length);
