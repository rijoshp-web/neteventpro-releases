'use strict';
/* Dashboard: a time range for all numbers, tiles you can drag and resize with the mouse, and a catalog for adding more tiles
   (including your own, with a filter). Layout, tiles and range are saved on the server with the other screen choices. */

/** the dashboard that is shown: the main one is prefs.dash, the others are prefs.dashboards[i].dash (1.36). Everything below reads and writes SP.dash. */
let boardId = '';
try { boardId = localStorage.getItem('ne.board') || ''; } catch { /* storage may be blocked */ }
const boards = () => S.prefs.dashboards || [];
const SP = {
  get dash() { const b = boardId && boards().find((x) => x.id === boardId); return b ? b.dash : S.prefs.dash; },
  set dash(v) { const b = boardId && boards().find((x) => x.id === boardId); if (b) b.dash = v; else S.prefs.dash = v; }
};
const GRID = { cols: 12, row: 30, gap: 12 };
const PRESETS = [['15m', 'Last 15 minutes', 15 * 60e3], ['1h', 'Last hour', 3600e3], ['6h', 'Last 6 hours', 6 * 3600e3], ['24h', 'Last 24 hours', 86400e3], ['7d', 'Last 7 days', 7 * 86400e3],
  ['30d', 'Last 30 days', 30 * 86400e3], ['today', 'Today', 0], ['yesterday', 'Yesterday', 0], ['all', 'Everything stored', 0], ['custom', 'Custom range…', 0]];
const DRILL_RANGE = { '15m': '900000', '1h': '3600000', '24h': '86400000', '7d': '604800000', '30d': '2592000000', all: '0' };   // dashboard range -> Logs range

const METRICS = {
  total: { label: 'Messages in the time range', ranged: true, srv: true, k: 'events' }, errors: { label: 'Errors and worse in the time range', ranged: true, srv: true, k: 'events' }, warnings: { label: 'Warnings in the time range', ranged: true, srv: true, k: 'events' },
  hosts: { label: 'Devices that sent messages in the time range', ranged: true, srv: true, k: 'events' }, perMinute: { label: 'Average messages per minute in the time range', ranged: true, srv: true, k: 'events' },
  alActive: { label: 'Active alarms (open and acknowledged, now)', srv: true, k: 'alarms', astate: 'active', link: 'open' }, alOpen: { label: 'Open alarms not yet acknowledged (now)', srv: true, k: 'alarms', astate: 'open', link: 'open' },
  alAck: { label: 'Acknowledged alarms (now)', srv: true, k: 'alarms', astate: 'ack', link: 'ack' }, alEsc: { label: 'Escalated alarms (now)', srv: true, k: 'alarms', astate: 'esc', link: 'escalated' },
  alRaised: { label: 'Alarms raised in the time range', ranged: true, srv: true, prev: true, k: 'alarms', astate: 'raised', link: 'all' }, alCleared: { label: 'Alarms cleared in the time range', ranged: true, srv: true, prev: true, k: 'alarms', astate: 'cleared', link: 'cleared' },
  alAvgClear: { label: 'Average time to clear, in minutes (cleared in the time range)', ranged: true, srv: true, k: 'alarms', astate: 'cleared', agg: 'avgclear', unit: 'min', link: 'cleared' },
  dvAll: { label: 'Devices known to the application', srv: true, k: 'devices', dstate: 'all' }, dvReporting: { label: 'Devices reporting normally', srv: true, k: 'devices', dstate: 'reporting' }, dvSilent: { label: 'Silent devices', srv: true, k: 'devices', dstate: 'silent' },
  dvMuted: { label: 'Muted devices', srv: true, k: 'devices', dstate: 'muted' }, dvOverdue: { label: 'Devices overdue (not heard within their expected time)', srv: true, k: 'devices', dstate: 'overdue' },
  dvAlarms: { label: 'Devices with open alarms', srv: true, k: 'devices', dstate: 'alarms' }, dvSyslog: { label: 'Devices that send syslog', srv: true, k: 'devices', dstate: 'syslog' }, dvTrap: { label: 'Devices that send SNMP traps', srv: true, k: 'devices', dstate: 'trap' },
  received: { label: 'Messages received since the service started', k: 'system' }, eps: { label: 'Messages per second now', k: 'system' }, devices: { label: 'Known devices (from the live counters)', k: 'system' }, silent: { label: 'Silent devices (from the live counters)', k: 'system' },
  stored: { label: 'Messages in the database', k: 'system' }, dbSize: { label: 'Database size on disk', k: 'system' }, dropped: { label: 'Messages dropped by rules since start', k: 'system' }, diskFree: { label: 'Free disk space', k: 'system' }
};
/** the data a tile can show: where the numbers come from, in plain words (shown on the tile as a small label) */
const DS = {
  syslog: { label: 'Syslog messages', chip: 'Syslog', short: 'Syslog', kind: 'events', src: 'syslog', desc: 'Messages that devices sent by syslog (switches, routers, servers, UPS ...).' },
  snmp: { label: 'SNMP traps', chip: 'SNMP traps', short: 'Traps', kind: 'events', src: 'snmp', desc: 'SNMP traps received on the trap port.' },
  events: { label: 'Syslog + SNMP traps', chip: 'Syslog + traps', short: 'Both', kind: 'events', src: 'all', desc: 'Every received event, syslog and traps together.' },
  alarms: { label: 'Alarms', chip: 'Alarms', short: 'Alarms', kind: 'alarms', desc: 'The alarms raised by your rules: open, acknowledged, escalated, cleared.' },
  devices: { label: 'Devices', chip: 'Devices', short: 'Devices', kind: 'devices', desc: 'The devices that send to the application and their state.' },
  system: { label: 'System (live)', chip: 'System', short: 'System', kind: 'system', desc: 'The application itself: message rate, database size, disk space.' }
};
/** ways to rank or group, per kind of data */
const BYS = {
  events: [['host', 'Device'], ['app', 'Process'], ['severity', 'Severity'], ['facility', 'Facility'], ['msgid', 'Trap name (SNMP)']],
  alarms: [['host', 'Device'], ['rule', 'Alarm rule'], ['severity', 'Severity'], ['state', 'State (open / acknowledged / cleared)'], ['source', 'Source (syslog / trap)']],
  devices: [['vendor', 'Vendor'], ['status', 'Status (reporting / silent / muted ...)'], ['group', 'Group'], ['kind', 'What it sends (syslog / traps)']]
};
const A_STATES = [['raised', 'Raised in the time range'], ['active', 'Active now (open + acknowledged)'], ['open', 'Open now (not acknowledged)'], ['ack', 'Acknowledged now'], ['esc', 'Escalated now'], ['cleared', 'Cleared in the time range']];
const D_STATES = [['all', 'All devices'], ['reporting', 'Reporting normally'], ['silent', 'Silent'], ['muted', 'Muted'], ['overdue', 'Overdue'], ['alarms', 'With open alarms'], ['syslog', 'Sending syslog'], ['trap', 'Sending traps']];
/** which kinds of data each visual can show */
const VIS_DS = { kpi: ['events', 'alarms', 'devices', 'system'], gauge: ['events', 'alarms', 'devices', 'system'], statspark: ['events', 'alarms'], line: ['events', 'alarms'], trend: ['events', 'alarms'], sevbars: ['events', 'alarms'], heat: ['events'],
  top: ['events', 'alarms', 'devices'], bar: ['events', 'alarms', 'devices'], pie: ['events', 'alarms', 'devices'], treemap: ['events', 'alarms', 'devices'], table: ['events', 'alarms', 'devices'], bargauge: ['events', 'alarms', 'devices'], latest: ['events', 'alarms', 'devices'] };
const srcDs = (s) => (s === 'snmp' ? 'snmp' : s === 'all' ? 'events' : 'syslog');
const dsOf = (t) => { const c = t.cfg || {}; if (c.ds && DS[c.ds]) return c.ds; if (t.type === 'alarm') return 'alarms'; const m = METRICS[c.metric]; if ((t.type === 'kpi' || t.type === 'gauge') && m && m.k !== 'events') return m.k; return srcDs(c.filter?.source); };
const dsKind = (t) => DS[dsOf(t)].kind;
const hasDs = (t) => !!VIS_DS[t.type];
const NEEDS_DEFAULT_TITLE = (t) => !t.title;

const TYPES = {
  kpi: { label: 'Number', desc: 'One big number, such as errors in the time range, with an optional filter.', w: 2, h: 3, minW: 1, minH: 2 },
  trend: { label: 'Messages over time', desc: 'Bars by severity across the time range. Add a filter to chart one device or one kind of message.', w: 8, h: 8, minW: 3, minH: 5 },
  sevbars: { label: 'Severity breakdown', desc: 'How many messages of each severity in the time range.', w: 4, h: 8, minW: 2, minH: 5 },
  top: { label: 'Top devices / processes', desc: 'Ranking by device, process, severity or facility, with an optional filter.', w: 4, h: 8, minW: 2, minH: 4 },
  latest: { label: 'Latest messages', desc: 'The newest messages that match a filter (errors and worse by default).', w: 6, h: 9, minW: 3, minH: 4 },
  rate: { label: 'Messages per second (live)', desc: 'Live rate for the last two minutes.', w: 4, h: 7, minW: 3, minH: 4 },
  io: { label: 'Inputs and alert delivery', desc: 'UDP/TCP listeners, email, forwarding.', w: 4, h: 9, minW: 3, minH: 4 },
  health: { label: 'System health', desc: 'Disk space, database and listener checks at a glance.', w: 4, h: 7, minW: 3, minH: 4 },
  silent: { label: 'Silent devices', desc: 'Devices that stopped sending.', w: 4, h: 6, minW: 2, minH: 3 },
  pie: { label: 'Pie / donut chart', desc: 'Share of messages by severity, device, process or facility.', w: 4, h: 8, minW: 3, minH: 6 },
  line: { label: 'Line graph', desc: 'Messages over time as lines (by severity group, or all messages), with an optional filled area.', w: 8, h: 8, minW: 3, minH: 5 },
  heat: { label: 'Heatmap', desc: 'Busiest devices over time, or weekday against hour of day, shaded by message count.', w: 8, h: 8, minW: 4, minH: 5 },
  poll: { label: 'Polled devices and readings', desc: 'SNMP polling on the dashboard: device status by group, open polling alarms, or any readings (for example the temperature of many devices in one table, tile grid, bar list, gauge or graph).', w: 6, h: 8, minW: 2, minH: 3 },
  snmpstatus: { label: 'SNMP trap receiver', desc: 'Whether the trap port is listening, and how many traps came in.', w: 6, h: 3, minW: 3, minH: 3 },
  bar: { label: 'Bar chart', desc: 'Columns or bars: the busiest devices, processes, severities or facilities. Click a bar to open the messages.', w: 6, h: 8, minW: 3, minH: 5 },
  treemap: { label: 'Treemap', desc: 'Rectangles sized by message count, like Power BI: see at a glance which devices or processes dominate.', w: 6, h: 8, minW: 3, minH: 5 },
  table: { label: 'Table', desc: 'A ranking table with count and share of the total (device, process, severity, facility or trap name).', w: 6, h: 9, minW: 3, minH: 4 },
  bargauge: { label: 'Bar gauge', desc: 'Horizontal gauges that turn green, amber or red, like the Grafana bar gauge (set warning and critical counts or let it use the share of the biggest).', w: 4, h: 8, minW: 3, minH: 4 },
  statspark: { label: 'Number with trend line', desc: 'A big number with a small trend line behind it (Grafana “stat” panel). Can turn amber or red at levels you set.', w: 3, h: 5, minW: 2, minH: 3 },
  text: { label: 'Text note', desc: 'Your own text: a heading, instructions, a runbook link or a reminder for the shift (bold, bullets and links are supported).', w: 4, h: 5, minW: 2, minH: 2 },
  alarm: { label: 'Alarm card', desc: 'A card from the alarm list: active, acknowledged, escalated, cleared or total alarms. Click it to open the Alarms page. Styled like every other tile.', w: 2, h: 3, minW: 2, minH: 2 },
  gauge: { label: 'Gauge', desc: 'One number on a dial with warning and critical levels, for example errors in the time range.', w: 3, h: 6, minW: 2, minH: 4 }
};
const FILTER_TYPES = ['kpi', 'trend', 'sevbars', 'top', 'latest', 'pie', 'line', 'heat', 'gauge', 'bar', 'treemap', 'table', 'bargauge', 'statspark'];
const TOPLIKE = { bar: 12, treemap: 12, table: 50, bargauge: 12 };    // tiles that rank messages by device / process / severity ... (the most rows each shows)
const PAL = ['#4aa3ff', '#45c2a5', '#f5a524', '#b07cf2', '#f2703d', '#8fd14f', '#e86a9a', '#2fc4d6', '#c9b458', '#7d8ea3'];
const AL_CARDS = { open: 'Active alarms', ack: 'Acknowledged', esc: 'Escalated alarms', cleared: 'Cleared', total: 'Total alarms' };
const AL_ORDER = ['open', 'ack', 'esc', 'cleared', 'total'];
const DOWN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------- 1.35 panel options (the same for every tile, alarm cards included): look, value, colour steps, chart, palette ----------
const PALETTES = {
  classic: PAL,
  powerbi: ['#118dff', '#12239e', '#e66c37', '#6b007b', '#e044a7', '#744ec2', '#d9b300', '#d64550', '#197278', '#1aab40'],
  grafana: ['#73bf69', '#f2cc0c', '#8ab8ff', '#ff780a', '#f2495c', '#b877d9', '#5794f2', '#ff9830', '#19c3b0', '#fade2a'],
  warm: ['#ff6b6b', '#ffa94d', '#ffd43b', '#f06595', '#e8590c', '#fcc419', '#d6336c', '#ff8787', '#fd7e14', '#c2255c'],
  cool: ['#4dabf7', '#38d9a9', '#748ffc', '#66d9e8', '#3bc9db', '#69db7c', '#9775fa', '#22b8cf', '#5c7cfa', '#20c997'],
  neon: ['#00f5d4', '#ff2e93', '#fee440', '#7b61ff', '#00bbf9', '#f15bb5', '#9b5de5', '#ff9e00', '#b6ff00', '#00f5ff'],
  pastel: ['#a5d8ff', '#b2f2bb', '#ffec99', '#d0bfff', '#ffc9c9', '#99e9f2', '#fcc2d7', '#ffd8a8', '#c0eb75', '#bac8ff'],
  mono: ['#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569', '#334155', '#1e293b', '#a1a1aa', '#71717a', '#52525b']
};
const PAL_NAMES = [['theme', 'Follow the theme'], ['classic', 'Classic'], ['powerbi', 'Power BI'], ['grafana', 'Grafana'], ['warm', 'Warm'], ['cool', 'Cool'], ['neon', 'Neon'], ['pastel', 'Pastel'], ['mono', 'Greys']];
const hexA = (hex, a) => { const m = /^#([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return hex; const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(100, a ?? 100)) / 100})`; };
const inkOf = (col) => { const m = /^#([0-9a-f]{6})$/i.exec(String(col || '').trim()); if (!m) return '#fff'; const n = parseInt(m[1], 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 165 ? '#111827' : '#ffffff'; };
/** colour steps (Grafana "thresholds"): the colour of the highest step whose value is reached; old warn/crit levels still work */
const thSteps = (c) => (c?.th?.steps?.length ? [...c.th.steps].sort((a, b) => a.v - b.v) : (c?.warn > 0 || c?.crit > 0) ? [{ v: 0, c: 'var(--ok)' }, ...(c.warn > 0 ? [{ v: c.warn, c: 'var(--s4)' }] : []), ...(c.crit > 0 ? [{ v: c.crit, c: 'var(--bad)' }] : [])] : null);
const thColor = (c, v) => { const st = thSteps(c); if (!st || v === null || v === undefined || Number.isNaN(+v)) return ''; let col = st[0].c; for (const x of st) if (v >= x.v) col = x.c; return col; };
const thMode = (c) => c?.th?.mode || (thSteps(c) ? 'value' : 'none');
const STEP_PRESETS = [['Green → amber → red', [{ v: 0, c: '#30a46c' }, { v: 50, c: '#f5a524' }, { v: 100, c: '#e5484d' }]], ['Red → amber → green (higher is better)', [{ v: 0, c: '#e5484d' }, { v: 50, c: '#f5a524' }, { v: 90, c: '#30a46c' }]], ['Blue → purple → pink', [{ v: 0, c: '#3b82f6' }, { v: 50, c: '#8b5cf6' }, { v: 100, c: '#ec4899' }]], ['Grafana', [{ v: 0, c: '#73bf69' }, { v: 50, c: '#f2cc0c' }, { v: 100, c: '#f2495c' }]]];
const LOOK_PRESETS = [
  ['Theme default', null],
  ['Transparent', { bgMode: 'none', shadow: 'none', bw: 0 }],
  ['Grafana panel', { bgMode: 'solid', bg: '#181b1f', bw: 1, bc: '#2c3235', radius: 2, shadow: 'none', tc: '#d8d9da' }],
  ['Power BI card', { bgMode: 'solid', bg: '#ffffff', bw: 0, radius: 6, shadow: 'soft', tc: '#252423', tColor: '#605e5c' }],
  ['Glass', { bgMode: 'solid', bg: '#8fa6c8', bgAlpha: 14, bw: 1, bc: '#8fa6c8', radius: 16, shadow: 'strong' }],
  ['Blue gradient', { bgMode: 'gradient', bg: '#1d4ed8', bg2: '#06b6d4', angle: 135, bw: 0, radius: 10, shadow: 'soft', tc: '#ffffff', tColor: '#ffffff' }],
  ['Purple gradient', { bgMode: 'gradient', bg: '#6d28d9', bg2: '#c084fc', angle: 135, bw: 0, radius: 10, shadow: 'soft', tc: '#ffffff', tColor: '#ffffff' }],
  ['Orange gradient', { bgMode: 'gradient', bg: '#ea580c', bg2: '#fbbf24', angle: 135, bw: 0, radius: 10, shadow: 'soft', tc: '#ffffff', tColor: '#ffffff' }],
  ['Green gradient', { bgMode: 'gradient', bg: '#047857', bg2: '#4ade80', angle: 135, bw: 0, radius: 10, shadow: 'soft', tc: '#ffffff', tColor: '#ffffff' }],
  ['Title bar', { tBar: 'gradient', tBarC: '#4338ca', tBarC2: '#1e1b4b', tColor: '#ffffff', tSize: 13 }],
  ['Neon glow', { bgMode: 'solid', bg: '#0b0b16', bw: 1, bc: '#00f5d4', radius: 10, shadow: 'glow', tc: '#e6fffb' }]
];
/** CSS (inline style, classes) of one tile from its panel options */
function lookOf(t) {
  const c = t.cfg || {}, L = c.look || {}, st = [], cls = [], tl = [], hd = [];
  if (c.color) st.push(`border-top:3px solid ${c.color}`);
  if (c.bg && !L.bgMode) st.push(`background:${c.bg}`);
  const a = L.bgAlpha ?? 100;
  if (L.bgMode === 'none') st.push('background:transparent', 'box-shadow:none', 'border-color:transparent');
  else if (L.bgMode === 'solid' && L.bg) st.push(`background:${hexA(L.bg, a)}`);
  else if (L.bgMode === 'gradient' && L.bg) st.push(`background:linear-gradient(${L.angle ?? 135}deg,${hexA(L.bg, a)},${hexA(L.bg2 || L.bg, a)})`);
  if (L.bgMode === 'solid' || L.bgMode === 'gradient') { if (a < 100) st.push('backdrop-filter:blur(8px)'); }
  if (L.bw !== undefined) st.push(`border:${L.bw}px solid ${L.bc || 'var(--line)'}`); else if (L.bc) st.push(`border-color:${L.bc}`);
  if (L.radius !== undefined) st.push(`border-radius:${L.radius}px`);
  const glow = L.bc || c.color || 'var(--accent)';
  if (L.shadow === 'none') st.push('box-shadow:none'); else if (L.shadow === 'soft') st.push('box-shadow:0 2px 10px rgba(0,0,0,.28)'); else if (L.shadow === 'strong') st.push('box-shadow:0 12px 30px rgba(0,0,0,.5)'); else if (L.shadow === 'glow') st.push(`box-shadow:0 0 22px color-mix(in srgb,${glow} 60%,transparent)`);
  if (L.pad !== undefined) st.push(`--px:${L.pad}px`, `--py:${L.pad}px`);
  const tcc = L.tc || ((L.bgMode === 'solid' || L.bgMode === 'gradient') && L.bg && a >= 60 ? inkOf(L.bg) : '');     // readable text on a dark or light custom background
  if (tcc) st.push(`color:${tcc}`, `--text:${tcc}`, `--muted:color-mix(in srgb,${tcc} 68%,transparent)`, `--faint:color-mix(in srgb,${tcc} 52%,transparent)`);
  if (L.tAlign) tl.push(`text-align:${L.tAlign}`); if (L.tSize) tl.push(`font-size:${L.tSize}px`); if (L.tColor || c.color) tl.push(`color:${L.tColor || c.color}`);
  if (L.tUpper) tl.push('text-transform:uppercase', 'letter-spacing:.06em'); if (L.tAlign === 'center' || L.tAlign === 'right') tl.push('flex:1');
  if (L.tBar && L.tBar !== 'none' && L.tBarC) { cls.push('tbar'); hd.push(L.tBar === 'gradient' ? `background:linear-gradient(90deg,${L.tBarC},${L.tBarC2 || L.tBarC})` : `background:${L.tBarC}`); if (!L.tColor) tl.push(`color:${inkOf(L.tBarC)}`); }
  return { style: st.join(';'), cls: cls.join(' '), title: tl.join(';'), head: hd.join(';'), hideTitle: L.tShow === false };
}
function lookOfSec(t) {
  const c = t.cfg || {}, L = c.look || {}, st = [], tl = [];
  if (c.color) st.push(`border-bottom-color:${c.color}`);
  if (L.bgMode === 'solid' && L.bg) st.push(`background:${hexA(L.bg, L.bgAlpha ?? 100)}`, 'padding:6px 14px', 'border-bottom-width:0');
  else if (L.bgMode === 'gradient' && L.bg) st.push(`background:linear-gradient(${L.angle ?? 90}deg,${hexA(L.bg, L.bgAlpha ?? 100)},${hexA(L.bg2 || L.bg, L.bgAlpha ?? 100)})`, 'padding:6px 14px', 'border-bottom-width:0');
  if (L.bw !== undefined) st.push(`border:${L.bw}px solid ${L.bc || 'var(--line)'}`); if (L.radius !== undefined) st.push(`border-radius:${L.radius}px`);
  if (L.tAlign === 'center') st.push('justify-content:center'); if (L.tAlign === 'right') st.push('justify-content:flex-end');
  if (L.tSize) tl.push(`font-size:${L.tSize}px`); if (L.tColor || c.color) tl.push(`color:${L.tColor || c.color}`); if (L.tUpper) tl.push('text-transform:uppercase', 'letter-spacing:.06em');
  return { style: st.join(';'), title: tl.join(';') };
}
const lp = (name) => structuredClone(LOOK_PRESETS.find((x) => x[0] === name)[1]);
const GRADS = ['Blue gradient', 'Purple gradient', 'Orange gradient', 'Green gradient'];
/** one-click looks for the whole board: page colours, colour theme, a look for every tile, chart colours */
const QUICK_LOOKS = [
  ['powerbi', 'Power BI', 'Clean white cards on a light grey page, blue accent.'], ['grafana', 'Grafana', 'Dark flat panels; alarm cards turn solid green or red.'],
  ['neon', 'Neon NOC', 'Black page, glowing neon outlines for numbers.'], ['executive', 'Executive', 'Deep violet page, glass cards, gradient number tiles.'], ['plain', 'Plain', 'Remove every custom look and colour.']
];
function quickLook(id, tiles) {
  const isNum = (t) => ['kpi', 'alarm', 'statspark', 'gauge'].includes(t.type); let n = 0;
  const alarmSteps = (t, c1, c2) => (t.type === 'kpi' && t.cfg.ds === 'alarms' && ['alActive', 'alOpen', 'alEsc'].includes(t.cfg.metric) ? { mode: 'bg', steps: [{ v: 0, c: c1 }, { v: 1, c: c2 }] } : undefined);
  const style = { powerbi: { pageBg: 'solid', bg1: '#f3f2f1', accent: '#118dff', card: 'raised', radius: 6 }, grafana: { pageBg: 'solid', bg1: '#111217', card: 'outline', radius: 2 }, neon: { pageBg: 'gradient', bg1: '#05050a', bg2: '#150a2e', bgAngle: 180, radius: 10 }, executive: { pageBg: 'gradient', bg1: '#0f0a24', bg2: '#2a1470', bgAngle: 160, radius: 14, card: 'glass' }, plain: null }[id];
  const theme = { powerbi: 'pbi', grafana: 'noc', neon: 'neon', executive: 'midnight', plain: 'classic' }[id], pal = { powerbi: 'powerbi', grafana: 'grafana', neon: 'neon', executive: 'cool', plain: undefined }[id];
  for (const t of tiles) {
    const c = t.cfg ||= {}; delete c.look; delete c.color; delete c.bg; delete c.pal; if (c.th) { delete c.th; }
    if (t.type === 'section') {
      c.look = { powerbi: { tColor: '#252423', tSize: 16 }, grafana: { tColor: '#d8d9da', tUpper: true, tSize: 13 }, neon: { bgMode: 'gradient', bg: '#7b61ff', bg2: '#00f5d4', angle: 90, tColor: '#05050a', radius: 8, tSize: 14, tUpper: true }, executive: { bgMode: 'gradient', bg: '#4338ca', bg2: '#7c3aed', angle: 90, tColor: '#ffffff', radius: 10, tSize: 15 }, plain: undefined }[id]; if (!c.look) delete c.look; if (id === 'powerbi') c.color = '#118dff'; continue;
    }
    if (id === 'plain') continue;
    if (pal && ['pie', 'bar', 'treemap', 'table', 'bargauge'].includes(t.type)) c.pal = pal;
    if (id === 'powerbi') c.look = lp('Power BI card');
    else if (id === 'grafana') { c.look = lp('Grafana panel'); const th = alarmSteps(t, '#73bf69', '#f2495c'); if (th) { c.th = th; c.look = { ...c.look, tc: '#ffffff' }; } }
    else if (id === 'neon') c.look = isNum(t) ? lp('Neon glow') : { bgMode: 'solid', bg: '#0e0e1a', bw: 1, bc: '#262648', radius: 10, tc: '#e6e6ff' };
    else if (id === 'executive') { if (isNum(t)) { c.look = lp(GRADS[n++ % 4]); } else c.look = lp('Glass'); }
  }
  return { style, theme };
}
const VSIZE = { s: 22, m: 34, l: 52, xl: 76 };

/** the SNMP trap section of the dashboard; y0 = first free row */
function snmpTiles(y0) {
  const f = (o = {}) => ({ source: 'snmp', ...o });
  return [
    { id: 's_k_total', type: 'kpi', title: 'Traps', x: 0, y: y0, w: 2, h: 3, cfg: { metric: 'total', filter: f() } },
    { id: 's_k_err', type: 'kpi', title: 'Trap errors and worse', x: 2, y: y0, w: 2, h: 3, cfg: { metric: 'errors', filter: f() } },
    { id: 's_k_dev', type: 'kpi', title: 'Devices sending traps', x: 4, y: y0, w: 2, h: 3, cfg: { metric: 'hosts', filter: f() } },
    { id: 's_io', type: 'snmpstatus', title: 'SNMP trap receiver', x: 6, y: y0, w: 6, h: 3, cfg: {} },
    { id: 's_trend', type: 'trend', title: 'Traps over time', x: 0, y: y0 + 3, w: 8, h: 8, cfg: { filter: f() } },
    { id: 's_sev', type: 'sevbars', title: 'Traps by severity', x: 8, y: y0 + 3, w: 4, h: 8, cfg: { filter: f() } },
    { id: 's_top', type: 'top', title: 'Top traps', x: 0, y: y0 + 11, w: 4, h: 8, cfg: { by: 'msgid', n: 8, filter: f() } },
    { id: 's_hosts', type: 'top', title: 'Top trap senders', x: 4, y: y0 + 11, w: 4, h: 8, cfg: { by: 'host', n: 8, filter: f() } },
    { id: 's_pie', type: 'pie', title: 'Traps by severity share', x: 8, y: y0 + 11, w: 4, h: 8, cfg: { by: 'severity', n: 6, style: 'donut', filter: f() } },
    { id: 's_latest', type: 'latest', title: 'Latest traps', x: 0, y: y0 + 19, w: 12, h: 9, cfg: { n: 10, filter: f() } }
  ];
}
const AL_MIG = { open: 'alActive', ack: 'alAck', esc: 'alEsc', cleared: 'alCleared', total: 'alRaised' };
const alarmTiles = (y0 = 0) => AL_ORDER.map((k, i) => ({ id: 'al_' + k, type: 'kpi', title: AL_CARDS[k], x: [0, 3, 5, 7, 9][i], y: y0, w: [3, 2, 2, 2, 3][i], h: 3, cfg: { ds: 'alarms', metric: AL_MIG[k] } }));
function defaultTiles() {
  const k = (id, metric, title, x, extra = {}) => ({ id, type: 'kpi', title, x, y: 0, w: 2, h: 3, cfg: { metric, ...extra } });
  return [
    ...alarmTiles(),
    k('k_total', 'total', 'Messages', 0), k('k_err', 'errors', 'Errors and worse', 2), k('k_hosts', 'hosts', 'Devices reporting', 4), k('k_eps', 'eps', 'Messages / second', 6),
    k('k_stored', 'stored', 'Stored messages', 8), k('k_silent', 'silent', 'Silent devices', 10),
    { id: 't_trend', type: 'trend', title: 'Messages over time', x: 0, y: 3, w: 8, h: 8, cfg: {} },
    { id: 't_sev', type: 'sevbars', title: 'Severity breakdown', x: 8, y: 3, w: 4, h: 8, cfg: {} },
    { id: 't_rate', type: 'rate', title: 'Messages per second', x: 0, y: 11, w: 4, h: 7, cfg: {} },
    { id: 't_hosts', type: 'top', title: 'Busiest devices', x: 4, y: 11, w: 4, h: 7, cfg: { by: 'host', n: 8 } },
    { id: 't_apps', type: 'top', title: 'Busiest processes', x: 8, y: 11, w: 4, h: 7, cfg: { by: 'app', n: 8 } },
    { id: 't_latest', type: 'latest', title: 'Latest errors and worse', x: 0, y: 18, w: 8, h: 9, cfg: { n: 10, filter: { severityMax: 3 } } },
    { id: 't_io', type: 'io', title: 'Inputs and alert delivery', x: 8, y: 18, w: 4, h: 9, cfg: {} },
    { id: 't_pie', type: 'pie', title: 'Messages by device', x: 0, y: 27, w: 4, h: 8, cfg: { by: 'host', n: 6, style: 'donut' } },
    { id: 't_heat', type: 'heat', title: 'Busiest devices over time', x: 4, y: 27, w: 8, h: 8, cfg: { mode: 'hostTime', n: 8 } },
    ...snmpTiles(35), ...sectionTiles()
  ];
}

/** time range -> { from, to, rolling, label } */
function rangeOf(r, now = Date.now()) {
  r = r || { preset: '24h' }; const p = PRESETS.find((x) => x[0] === r.preset) || PRESETS[3];
  const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const fmt = (t) => `${dateOf(t)} ${timeOf(t, false).slice(0, 5)}`;
  if (p[2]) return { from: now - p[2], to: now, rolling: true, label: p[1].toLowerCase() };
  if (p[0] === 'today') return { from: startOfDay(now), to: now, rolling: true, label: 'today' };
  if (p[0] === 'yesterday') { const s = startOfDay(now); return { from: s - 86400000, to: s, rolling: false, label: 'yesterday' }; }
  if (p[0] === 'all') return { from: 0, to: now, rolling: true, label: 'everything stored' };
  return { from: r.from, to: r.to, rolling: false, label: `${fmt(r.from)} to ${fmt(r.to)}` };
}

// ---------- layout engine (a grid with 12 columns; tiles never overlap; empty space above a tile is closed up) ----------
const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
function settleZone(items, fixed, base) {
  const placed = fixed ? [fixed] : [];
  if (fixed && fixed.y < base) fixed.y = base;
  for (const it of items.filter((i) => i !== fixed).sort((a, b) => a.y - b.y || a.x - b.x)) {
    it.y = base; while (placed.some((p) => hit(it, p))) it.y++;
    placed.push(it);
  }
  return Math.max(base, ...items.map((i) => i.y + i.h));
}
const zoneOf = (t) => (t.type === 'alarm' || hasDs(t) && ['alarms', 'devices'].includes(dsOf(t)) ? 'al' : t.id.startsWith('s_') || t.cfg?.filter?.source === 'snmp' ? 'snmp' : 'sys');
/** Packs the tiles upward. The dashboard has a Syslog zone and an SNMP traps zone, each under its own heading bar (tile type "section"). */
function settle(items, fixedId) {
  const heads = items.filter((i) => i.type === 'section');
  if (!heads.length) { const fixed = items.find((i) => i.id === fixedId); settleZone(items, fixed, 0); return items; }
  const body = items.filter((i) => i.type !== 'section'), hs = heads.find((h) => h.id === 'sec_sys'), hn = heads.find((h) => h.id === 'sec_snmp');
  const al = body.filter((t) => zoneOf(t) === 'al'), sys = body.filter((t) => zoneOf(t) === 'sys'), sn = body.filter((t) => zoneOf(t) === 'snmp');
  const order = SP.dash?.snmpFirst ? [[hn, sn], [hs, sys]] : [[hs, sys], [hn, sn]];
  let y = al.length ? settleZone(al, al.find((i) => i.id === fixedId), 0) : 0;
  for (const [h, zone] of order) { Object.assign(h, { x: 0, y, w: 12, h: 1 }); y = settleZone(zone, zone.find((i) => i.id === fixedId), y + 1); }
  return items;
}
const sectionTiles = () => [{ id: 'sec_sys', type: 'section', title: 'Syslog', x: 0, y: 0, w: 12, h: 1, cfg: {} }, { id: 'sec_snmp', type: 'section', title: 'SNMP traps', x: 0, y: 99, w: 12, h: 1, cfg: {} }];

views.dashboard = (el) => {
  let editing = false, tiles = null, data = null, health = null, devices = null, lastAt = 0, timer = null, fetching = false;
  const cache = new Map();                                    // tile id -> last painted html (skip needless repaints)
  el.innerHTML = `<div class="page-head dash-head"><h1>Dashboard</h1>
    <select id="dBoard" aria-label="Which dashboard" title="Your saved dashboards"></select>
    <select id="dRange" aria-label="Time range">${PRESETS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
    <span id="dCustom" hidden><input type="datetime-local" id="dFrom" aria-label="From"> to <input type="datetime-local" id="dTo" aria-label="To"> <button id="dApply">Apply</button></span>
    <input id="dSlicer" list="dSlD" placeholder="All devices" size="14" aria-label="Show one device only" title="Show only this device on every tile (clear it for all devices)"><datalist id="dSlD"></datalist><span class="muted" id="dInfo"></span><span class="spacer"></span>
    <span class="seg" id="dOrder" role="group" aria-label="Which section is shown first"><button type="button" data-o="sys" title="Syslog section on top">Syslog first</button><button type="button" data-o="snmp" title="SNMP traps section on top">SNMP first</button></span><span id="dEditBar" hidden><button id="dAdd">Add tile</button><button id="dSave" title="Keep a copy of this dashboard under a new name">Save as…</button><button id="dNew" title="Start an empty dashboard, then add the tiles you want (Reset layout brings back the standard tiles)">New dashboard</button><button id="dRen">Rename</button><button id="dExp" title="Download this dashboard as a file (to back it up or give it to a colleague)">Export…</button><button id="dImp" title="Add a dashboard from a file exported by NetEventPro">Import…</button><button id="dDel" class="danger">Delete</button><button id="dSet" title="Page background, colour theme, spacing, corners, refresh rate">Dashboard settings</button><button id="dReset">Reset layout</button></span>
    <button id="dWallLink" title="Copy a link that opens this dashboard straight in wall display mode (the wall computer signs in once)">Wall link</button><button id="dWall" title="Show this dashboard full screen without menus, for a wall display">Wall display</button><button id="dRefresh" title="Reload the numbers now">Refresh</button><button id="dEdit">Customize</button></div>
    <div class="dgrid" id="dgrid"></div>`;
  const grid = $('#dgrid', el);

  const getTiles = () => {
    if (tiles) return tiles;
    if (!SP.dash?.tiles?.length) return SP.dash?.blank ? (tiles = []) : (tiles = settle(defaultTiles(), null));      // a blank dashboard (New dashboard, 1.42.1) stays empty until tiles are added
    tiles = structuredClone(SP.dash.tiles);
    if (!SP.dash.snmpTiles) {           // a layout saved before SNMP traps existed: add the trap section once at the bottom (it can be removed or moved like any tile)
      if (!tiles.some((x) => x.id.startsWith('s_'))) tiles.push(...snmpTiles(Math.max(0, ...tiles.map((x) => x.y + x.h))));
      SP.dash = { ...SP.dash, snmpTiles: true, tiles: structuredClone(tiles) }; savePrefs();
    }
    if (!SP.dash.alarmTiles) {          // the alarm banner became ordinary tiles (1.35): carry over its titles, colours, order and visibility once
      const ab = SP.dash.alarmBar || {}, order = [...(ab.order || []).filter((k) => AL_ORDER.includes(k)), ...AL_ORDER.filter((k) => !(ab.order || []).includes(k))];
      if (!tiles.some((x) => x.type === 'alarm') && !ab.hide) {
        const shown = order.filter((k) => ab.cards?.[k]?.show !== false), per = ab.cols || shown.length || 1, w = Math.max(2, Math.floor(12 / per)), h = ab.style === 'compact' ? 2 : ab.style === 'large' ? 4 : 3;
        const al = shown.map((k, i) => ({ id: 'al_' + k, type: 'alarm', title: ab.cards?.[k]?.title || AL_CARDS[k], x: (i % per) * w, y: Math.floor(i / per) * h, w, h, cfg: { card: k, ...(ab.cards?.[k]?.color ? { color: ab.cards[k].color } : {}) } }));
        tiles.push(...al);
      }
      const nd = { ...SP.dash, alarmTiles: true }; delete nd.alarmBar; settle(tiles, null); SP.dash = { ...nd, tiles: structuredClone(tiles) }; savePrefs();
    }
    if (!tiles.some((x) => x.type === 'section')) { tiles.push(...sectionTiles()); settle(tiles, null); SP.dash = { ...SP.dash, tiles: structuredClone(tiles) }; savePrefs(); }
    if (tiles.some((x) => x.type === 'alarm')) {     // the alarm cards became ordinary number tiles on the "Alarms" data (1.36)
      for (const x of tiles) if (x.type === 'alarm') { const { card, ...rest } = x.cfg || {}; x.type = 'kpi'; x.cfg = { ...rest, ds: 'alarms', metric: AL_MIG[card] || 'alActive' }; }
      SP.dash = { ...SP.dash, tiles: structuredClone(tiles) }; savePrefs();
    }
    return tiles;
  };
  const saveTiles = () => { SP.dash = { ...(SP.dash || {}), alarmTiles: true, snmpTiles: true, tiles: structuredClone(getTiles()) }; if (!SP.dash.tiles.length) SP.dash.blank = true; else delete SP.dash.blank; savePrefs(); };
  const range = () => rangeOf(SP.dash?.range);
  const metricOf = (t) => METRICS[t.cfg?.metric] || METRICS.total;
  const isRanged = (t) => (t.type === 'kpi' || t.type === 'gauge') ? !!metricOf(t).ranged || dsKind(t) !== 'system' : ['trend', 'sevbars', 'top', 'latest', 'pie', 'line', 'heat', 'bar', 'treemap', 'table', 'bargauge', 'statspark'].includes(t.type);

  // ----- geometry -----
  const narrow = () => grid.clientWidth < 640;
  const geo = () => { const W = Math.max(300, grid.clientWidth), cw = (W - GRID.gap * (GRID.cols - 1)) / GRID.cols; return { W, cw, cellW: cw + GRID.gap, cellH: GRID.row + GRID.gap }; };
  function rect(t, g, stackY) {
    if (t.type === 'section') return narrow() ? { left: 0, top: stackY, width: g.W, height: GRID.row } : { left: 0, top: t.y * g.cellH, width: g.W, height: GRID.row };
    if (narrow()) return { left: 0, top: stackY, width: g.W, height: Math.max(t.h, 3) * GRID.row + (Math.max(t.h, 3) - 1) * GRID.gap };
    return { left: t.x * g.cellW, top: t.y * g.cellH, width: t.w * g.cw + (t.w - 1) * GRID.gap, height: t.h * GRID.row + (t.h - 1) * GRID.gap };
  }
  function place(skipId) {
    const g = geo(); let stack = 0, bottom = 0;
    const order = narrow() ? [...getTiles()].sort((a, b) => a.y - b.y || a.x - b.x) : getTiles();
    for (const t of order) {
      const r = rect(t, g, stack); stack += r.height + GRID.gap; bottom = Math.max(bottom, r.top + r.height);
      const n = $(`[data-id="${t.id}"]`, grid); if (!n || t.id === skipId) continue;
      n.style.left = r.left + 'px'; n.style.top = r.top + 'px'; n.style.width = r.width + 'px'; n.style.height = r.height + 'px';
    }
    grid.style.height = (bottom + (editing ? 80 : 0)) + 'px';
  }

  // ----- frames (the boxes); their contents are painted separately -----
  function frames() {
    cache.clear();
    grid.classList.toggle('editing', editing && !narrow());
    grid.innerHTML = getTiles().map((t) => { if (t.type === 'section') { const k = lookOfSec(t); return `<div class="dsec" data-id="${t.id}" data-type="section" ${k.style ? `style="${k.style}"` : ''}><b ${k.title ? `style="${k.title}"` : ''}>${esc(t.title)}</b><span class="muted" id="sec_${t.id}"></span>${editing ? `<span class="spacer"></span><button data-a="seccfg" data-sid="${t.id}" title="Rename this section and change its look">Edit</button>` : ''}</div>`; }
      const k = lookOf(t); return `<section class="widget panel ${k.cls}" data-id="${t.id}" data-type="${t.type}" ${k.style ? `style="${k.style}"` : ''}>
      <div class="whead ${k.hideTitle && !editing ? 'nohead' : ''}" ${k.head ? `style="${k.head}"` : ''} ${editing ? 'tabindex="0" title="Drag to move. Arrow keys move, Shift+arrows resize."' : ''}>${k.hideTitle ? '' : `<h2 class="wtitle" ${k.title ? `style="${k.title}"` : ''}>${esc(t.title || TYPES[t.type].label)}</h2>${hasDs(t) && t.cfg?.look?.tSrc !== false ? `<span class="srcchip" data-ds="${dsOf(t)}" title="${esc(DS[dsOf(t)].chip + ': ' + DS[dsOf(t)].desc)}">${esc(t.w <= 2 ? DS[dsOf(t)].short : DS[dsOf(t)].chip)}</span>` : ''}`}<span class="spacer"></span>
      ${editing ? `<button data-a="cfg" aria-label="Edit tile ${esc(t.title)}" title="Edit this tile">Edit</button><button data-a="del" class="danger" aria-label="Remove tile ${esc(t.title)}" title="Remove this tile">✕</button>` : ''}</div>
      <div class="wb" id="wb_${t.id}"></div>
      ${editing && !narrow() ? '<i class="dz dz-e" data-r="e"></i><i class="dz dz-s" data-r="s"></i><i class="dz dz-se" data-r="se"></i>' : ''}</section>`; }).join('')
      || '<div class="panel empty"><b>No tiles</b>Click Customize, then Add tile.</div>';
    place(); paint(); observe();
  }

  // ----- data -----
  const requests = () => requestsFor(getTiles());
  /** the request for one number (a metric of the chosen data) */
  function metricReq(id, m, f0) {
    const M = METRICS[m]; if (!M || !M.srv) return null; const f = { ...f0 }, q = { id, kind: 'count', filter: f };
    if (M.k === 'events') {
      if (m === 'errors') f.severityMax = Math.min(f.severityMax ?? 7, 3);
      if (m === 'warnings') { f.severityMax = Math.min(f.severityMax ?? 7, 4); f.severityMin = Math.max(f.severityMin ?? 0, 4); }
      if (m === 'hosts') q.kind = 'distinct'; else q.prev = true;
    } else if (M.k === 'alarms') { q.ds = 'alarms'; f.astate = M.astate; if (M.agg) q.agg = M.agg; if (M.prev) q.prev = true; }
    else { q.ds = 'devices'; f.dstate = M.dstate; }
    return q;
  }
  const defBy = (t) => { const k = dsKind(t); return t.type === 'pie' ? (k === 'devices' ? 'status' : 'severity') : k === 'devices' ? 'vendor' : 'host'; };
  const byOf = (t) => { const k = dsKind(t), b = t.cfg?.by; return (BYS[k] || BYS.events).some((x) => x[0] === b) ? b : defBy(t); };
  function requestsFor(list) {
    const out = [], slicer = SP.dash?.slicer || '';
    for (const t of list) {
      if (!hasDs(t)) continue;
      const ds = dsOf(t), kd = DS[ds].kind, c = t.cfg || {}, f = { ...(c.filter || {}) }, n = c.n, dq = kd === 'events' ? {} : { ds: kd };
      if (kd === 'events') { if (c.ds) f.source = DS[ds].src; if (slicer) f.host = slicer; } else if (kd === 'alarms') { if (slicer) f.host = slicer; }
      if (kd !== 'devices') delete f.dstate; if (kd !== 'alarms') delete f.astate;
      if (t.type === 'kpi' || t.type === 'gauge') {
        const m = c.metric || 'total', M = METRICS[m];
        if (M?.srv) {
          const q = metricReq(t.id, m, f); if (q) out.push(q);
          if (c.calc?.op && c.calc.op !== 'none' && ['pct', 'ratio', 'diff', 'sum'].includes(c.calc.op) && METRICS[c.calc.bm]?.srv) { const fb = {}; if (slicer && METRICS[c.calc.bm].k !== 'devices') fb.host = slicer; const qb = metricReq(t.id + '_b', c.calc.bm, fb); if (qb) out.push(qb); }
          if (t.type === 'kpi' && c.graph && c.graph !== 'none' && kd !== 'devices') out.push({ id: t.id + '_g', kind: 'series', ...dq, filter: { ...f, ...(m === 'errors' ? { severityMax: 3 } : {}), ...(M.astate ? { astate: M.astate } : {}) } });
        }
      } else if (t.type === 'trend' || t.type === 'line' || t.type === 'statspark') out.push({ id: t.id, kind: 'series', ...dq, filter: f });
      else if (t.type === 'sevbars') out.push({ id: t.id, kind: 'top', ...dq, by: 'severity', n: 8, filter: f });
      else if (t.type === 'top') out.push({ id: t.id, kind: 'top', ...dq, by: byOf(t), n: n || 8, filter: f });
      else if (t.type === 'latest') out.push({ id: t.id, kind: 'list', ...dq, n: n || 8, filter: f });
      else if (t.type === 'pie') out.push({ id: t.id, kind: 'top', ...dq, by: byOf(t), n: Math.min(n || 6, 12), filter: f });
      else if (TOPLIKE[t.type]) out.push({ id: t.id, kind: 'top', ...dq, by: byOf(t), n: Math.min(n || (t.type === 'table' ? 10 : 8), TOPLIKE[t.type]), filter: f });
      else if (t.type === 'heat') out.push({ id: t.id, kind: t.cfg?.mode === 'dowHour' ? 'heatDow' : 'heatHost', n: n || 10, tz: -new Date().getTimezoneOffset(), filter: f });
    }
    return out;
  }
  async function load(force = true) {
    if (fetching) return; fetching = true;
    try {
      const r = range(), reqs = requests(), t = getTiles();
      const jobs = [];
      if (reqs.length && (force || r.rolling || !data)) jobs.push(api('/api/dash', { method: 'POST', body: { from: r.from, to: r.to, tiles: reqs } }).then((d) => { data = d; }));
      if (t.some((x) => x.type === 'poll')) jobs.push(loadPoll(t));
      if (t.some((x) => x.type === 'health' || (x.type === 'kpi' && x.cfg?.metric === 'diskFree'))) jobs.push(api('/api/health').then((h) => { health = h; }));
      if (t.some((x) => x.type === 'silent')) jobs.push(api('/api/devices').then((d) => { devices = d; }));
      if (t.some((x) => x.type === 'alarm')) jobs.push(loadAlarms());
      await Promise.all(jobs); lastAt = Date.now();
      $('#dInfo', el).textContent = `${r.label.charAt(0).toUpperCase() + r.label.slice(1)} · updated ${timeOf(lastAt, false)}`;
      paint();
    } catch (e) { $('#dInfo', el).textContent = 'Could not load: ' + e.message; } finally { fetching = false; }
  }
  let alarmData = null;
  const dur2 = (ms) => { const m = Math.round(ms / 60000); return m < 1 ? '<1 min' : m < 90 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`; };
  async function loadAlarms() {
    try { const r = range(); alarmData = await api('/api/alarms?' + new URLSearchParams({ state: 'all', limit: 1, since: r.from || 1 })); paint(); } catch { /* the sign-in check reloads the page */ }
  }
  const alarmInfo = (t) => {
    const a = alarmData; if (!a) return null; const c = a.counts, m = a.summary, r = range(), sysOpen = c.open - (c.openSnmp || 0);
    return { open: { v: c.open, cls: c.open ? 'bad' : 'ok', sub: `Syslog ${fmtN(sysOpen)} · SNMP ${fmtN(c.openSnmp || 0)}${m.oldestOpen ? ` · oldest ${esc(dur2(Date.now() - m.oldestOpen.first))}` : ''}`, hash: 'open' },
      ack: { v: c.ack, cls: c.ack ? 'warn' : '', sub: 'Someone is working on it', hash: 'ack' },
      esc: { v: c.escalated || 0, cls: c.escalated ? 'bad' : '', sub: `${fmtN(m.escalatedPeriod || 0)} escalated ${esc(r.label)} · not acknowledged in time`, hash: 'escalated' },
      cleared: { v: m.cleared, cls: 'ok', sub: `${esc(r.label)}${m.cleared ? ` · avg ${esc(dur2(m.avgClearMs))} to clear` : ''}`, hash: 'cleared' },
      total: { v: m.total ?? m.raised, cls: '', sub: `${esc(r.label)} · ${fmtN(m.raised)} newly raised${m.bySource.length ? ' · ' + m.bySource.map((x) => (x.source === 'snmp' ? 'SNMP ' : 'Syslog ') + fmtN(x.n)).join(' · ') : ''}`, hash: 'all' } }[t.cfg?.card || 'open'];
  };
  // ----- 1.34 look & feel: card style, corners, spacing, density, titles, accent colour -----
  function applyStyle() {
    const s = SP.dash?.style || {}, dens = { compact: 24, normal: 30, comfortable: 36 }[s.density] || 30;
    GRID.gap = s.gap ?? 12; GRID.row = dens;
    const d = el.dataset; d.card = s.card || 'solid'; d.titles = s.titles || 'normal'; el.style.setProperty('--dr', (s.radius ?? 8) + 'px');
    el.style.background = s.pageBg === 'solid' && s.bg1 ? s.bg1 : s.pageBg === 'gradient' && s.bg1 ? `linear-gradient(${s.bgAngle ?? 160}deg,${s.bg1},${s.bg2 || s.bg1})` : '';
    if (s.accent) { el.style.setProperty('--accent', s.accent); el.style.setProperty('--link', s.accent); } else { el.style.removeProperty('--accent'); el.style.removeProperty('--link'); }
  }
  function styleDialog() {
    const s = { ...(SP.dash?.style || {}) }, back = document.createElement('div'); back.className = 'modal-back';
    const sel = (id, label, opts, cur) => `<div class="field"><label for="${id}">${label}</label><select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
    back.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-label="Dashboard settings"><h3 style="margin:0 0 4px">Dashboard settings</h3><p class="muted" style="margin:0 0 12px">Settings for the whole page. Each tile can override its own look under <b>Edit</b> → Tile look. Saved for everyone who opens this dashboard (the colour theme is kept per browser).</p><div class="form">
      <div class="field"><label>Colour theme</label><div class="themes" id="stThemes">${window.NEP.DASHES.map(([id, n, sw]) => `<button type="button" class="thm ${document.documentElement.dataset.dash === id ? 'on' : ''}" data-th="${id}" title="${esc(n)}"><span class="sw">${(sw || ['#888', '#aaa', '#ccc', '#eee']).map((c) => `<i style="background:${c}"></i>`).join('')}</span><small>${esc(n)}</small></button>`).join('')}</div></div>
      ${sel('stCard', 'Card style', [['solid', 'Solid (flat)'], ['raised', 'Raised (shadow)'], ['glass', 'Glass (translucent)'], ['outline', 'Outline only'], ['accent', 'Accent edge']], s.card || 'solid')}
      ${sel('stTitles', 'Tile titles', [['normal', 'Normal'], ['upper', 'Small capitals'], ['bar', 'Coloured title bar']], s.titles || 'normal')}
      <div class="field"><label for="stRadius">Corner radius</label><div><input type="range" id="stRadius" min="0" max="24" value="${s.radius ?? 8}"> <output id="stRadiusO">${s.radius ?? 8}px</output></div></div>
      <div class="field"><label for="stGap">Space between tiles</label><div><input type="range" id="stGap" min="4" max="24" value="${s.gap ?? 12}"> <output id="stGapO">${s.gap ?? 12}px</output></div></div>
      ${sel('stDens', 'Row height', [['compact', 'Compact'], ['normal', 'Normal'], ['comfortable', 'Comfortable']], s.density || 'normal')}
      <div class="field"><label for="stAcc">Accent colour</label><div><input type="color" id="stAcc" value="${s.accent || '#3b82f6'}"> <label class="chk"><input type="checkbox" id="stAccOn" ${s.accent ? 'checked' : ''}> override the theme accent</label></div></div>
      <div class="field"><label>Quick look</label><div><div class="presets" id="stQL">${QUICK_LOOKS.map(([id, n, d]) => `<button type="button" class="pre" data-ql="${id}" title="${esc(d)}">${esc(n)}</button>`).join('')}</div><div class="hint">Gives the page and every tile a ready-made look. You can still change any tile afterwards. Replaces the current tile looks.</div></div></div>
      ${sel('stPg', 'Page background', [['', 'Theme default'], ['solid', 'Solid colour'], ['gradient', 'Gradient']], s.pageBg || '')}
      <div class="field"><label for="stBg1">Background colours</label><div><input type="color" id="stBg1" value="${s.bg1 || '#0f172a'}"> <input type="color" id="stBg2" value="${s.bg2 || '#1e1b4b'}"> <input type="number" id="stBgA" class="w-sm" min="0" max="360" value="${s.bgAngle ?? 160}" aria-label="Gradient angle"> <span class="muted">° angle</span></div></div>
      ${sel('stRef', 'Refresh the numbers', [[5, 'Every 5 seconds'], [10, 'Every 10 seconds (default)'], [30, 'Every 30 seconds'], [60, 'Every minute'], [300, 'Every 5 minutes'], [0, 'Only when I press Refresh']], s.refresh ?? 10)}
      </div><div class="toolbar" style="margin:14px 0 0"><button type="button" id="stReset">Reset style</button><span class="spacer"></span><button type="button" id="mCancel">Cancel</button><button type="submit" class="primary">Save</button></div></form>`;
    document.body.appendChild(back); const q = (id) => $('#' + id, back), close = () => back.remove(), keep = document.documentElement.dataset.dash;
    const read = () => { const o = { ...(q('stPg').value ? { pageBg: q('stPg').value, bg1: q('stBg1').value, bg2: q('stBg2').value, bgAngle: +q('stBgA').value || 0 } : {}), card: q('stCard').value, titles: q('stTitles').value, radius: +q('stRadius').value, gap: +q('stGap').value, density: q('stDens').value, refresh: +q('stRef').value }; if (q('stAccOn').checked) o.accent = q('stAcc').value; return o; };
    const live = () => { SP.dash = { ...(SP.dash || {}), style: read() }; q('stRadiusO').textContent = q('stRadius').value + 'px'; q('stGapO').textContent = q('stGap').value + 'px'; applyStyle(); place(); paint(); };
    back.addEventListener('input', live); back.addEventListener('change', live);
    back.addEventListener('click', async (e) => {
      const ql = e.target.closest('[data-ql]'); if (!ql) return; if (!await askConfirm('Replace the look of every tile with this ready-made look?')) return;
      const list = getTiles(), r = quickLook(ql.dataset.ql, list); window.NEP.setDash(r.theme); const keepOld = SP.dash || {};
      SP.dash = { ...keepOld }; if (r.style) SP.dash.style = { ...(keepOld.style || {}), ...r.style, ...(r.style.pageBg ? {} : {}) }; else { const st2 = { ...(keepOld.style || {}) }; for (const k of ['pageBg', 'bg1', 'bg2', 'bgAngle', 'accent', 'card']) delete st2[k]; SP.dash.style = st2; }
      saveTiles(); applyStyle(); close(); frames(); load();
    });
    back.addEventListener('click', (e) => { const b = e.target.closest('.thm'); if (!b) return; window.NEP.setDash(b.dataset.th); $$('.thm', back).forEach((x) => x.classList.toggle('on', x === b)); paint(); });
    const undo = () => { SP.dash = { ...(SP.dash || {}), style: orig }; if (!orig) delete SP.dash.style; window.NEP.setDash(keep); applyStyle(); place(); paint(); close(); };
    const orig = SP.dash?.style ? { ...SP.dash.style } : null;
    $('#mCancel', back).onclick = undo; back.addEventListener('mousedown', (e) => { if (e.target === back) undo(); });
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); undo(); } });
    q('stReset').onclick = () => { delete SP.dash.style; savePrefs(); window.NEP.setDash('classic'); applyStyle(); place(); paint(); schedule(); close(); };
    $('form', back).onsubmit = (e) => { e.preventDefault(); SP.dash = { ...(SP.dash || {}), style: read() }; savePrefs(); applyStyle(); place(); paint(); schedule(); close(); };
  }
  const schedule = () => { clearInterval(timer); const rf = SP.dash?.style?.refresh ?? 10; if (rf > 0) timer = setInterval(() => load(false), rf * 1000); };   // a fixed range (yesterday, custom) is not re-read; live tiles still refresh

  // ----- painting -----
  const wbOf = (id) => document.getElementById('wb_' + id);
  const setHtml = (id, html) => { if (cache.get(id) === html) return false; cache.set(id, html); const n = wbOf(id); if (n) n.innerHTML = html; return true; };
  const bars = (rows, nameFn, colorFn, linkFn) => { const max = Math.max(1, ...rows.map((r) => r.n)); return `<div class="hostbars">${rows.map((r) => `<div class="row">${linkFn ? linkFn(r) : `<span class="trunc">${nameFn(r)}</span>`}<div class="bar"><i style="width:${(r.n / max) * 100}%;background:${colorFn(r)}"></i></div><span class="num-r">${fmtN(r.n)}</span></div>`).join('')}</div>`; };
  const trend = (a, b) => (b > 0 ? Math.round((a - b) / b * 100) : null);
  const tileValue = (t) => { if (t.type === 'alarm') return alarmInfo(t)?.v ?? null; if (t.type === 'statspark') { const ls = lineSeries({ ...t, cfg: { ...t.cfg, mode: 'total', sc: undefined } }); return ls ? ls.lines[0].v.reduce((a, b) => a + b, 0) : null; } if (t.type === 'kpi' || t.type === 'gauge') return metricNumber(t); return null; };
  const isAl = (t) => t.type === 'alarm' || (['kpi', 'gauge', 'statspark'].includes(t.type) && dsOf(t) === 'alarms');
  const alarmCol = (t) => { if (t.type === 'alarm') return ({ bad: 'var(--bad)', warn: 'var(--s4)', ok: 'var(--ok)' }[alarmInfo(t)?.cls] || ''); const m = t.cfg?.metric, v = tileValue(t); if (v === null || v === undefined || t.cfg?.calc?.op) return ''; if (['alActive', 'alOpen', 'alEsc'].includes(m)) return v > 0 ? 'var(--bad)' : 'var(--ok)'; if (m === 'alAck') return v > 0 ? 'var(--s4)' : ''; if (m === 'alCleared') return 'var(--ok)'; if (m === 'dvSilent' || m === 'dvOverdue') return v > 0 ? 'var(--bad)' : 'var(--ok)'; return ''; };
  const tintOf = (t) => { if (!['kpi', 'statspark', 'gauge', 'alarm'].includes(t.type)) return ''; const c = t.cfg || {}, m = thMode(c); if (m !== 'bg' && m !== 'grad') return ''; return thColor(c, tileValue(t)) || ''; };
  const valCol = (t) => { const c = t.cfg || {}, m = thMode(c), al = isAl(t) || ['dvSilent', 'dvOverdue'].includes(c.metric); if (al && c.look?.bgMode && (m === 'none' || m === 'value') && !thSteps(c)) return 'inherit'; if (m === 'bg' || m === 'grad') return 'inherit'; if (m === 'value') return thColor(c, tileValue(t)) || (al ? alarmCol(t) : ''); return al ? alarmCol(t) : ''; };
  const numFmt = (c, v) => { const o = c.val || {}; if (typeof v !== 'number') return esc(String(v)); let x; if (o.dec !== undefined) x = v.toLocaleString(undefined, { minimumFractionDigits: o.dec, maximumFractionDigits: o.dec }); else x = fmtN(v); if (o.compact && Math.abs(v) >= 1000) x = Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k'; return x; };
  const decorate = (c, html) => { const o = c.val || {}; return (o.prefix ? `<span class="unit">${esc(o.prefix)}</span>` : '') + html + (o.suffix ? `<small class="unit">${esc(o.suffix)}</small>` : ''); };
  const valStyle = (t, col) => { const o = t.cfg?.val || {}, st = []; if (col) st.push(`color:${col}`); if (o.size && o.size !== 'auto') st.push(`font-size:${VSIZE[o.size]}px`); return st.join(';'); };
  const alignStyle = (t) => { const a = t.cfg?.val?.align; return a ? `text-align:${a};align-items:${a === 'center' ? 'center' : a === 'right' ? 'flex-end' : 'flex-start'}` : ''; };
  function sparkSvg(v, col, mode) {
    const n = v.length, max = Math.max(1, ...v), pts = v.map((y, i) => `${(n < 2 ? 50 : i / (n - 1) * 100).toFixed(1)},${(34 - y / max * 30).toFixed(1)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">${mode === 'line' ? '' : `<polygon points="0,36 ${pts} 100,36" fill="${col}" opacity=".22"/>`}<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
  }
  const sparkOf = (t, col) => { const mode = t.cfg?.graph; if (!mode || mode === 'none') return ''; const d = data?.tiles?.[t.id + '_g']; if (!d?.series) return ''; return sparkSvg(d.series.map((a) => SEVORD.reduce((s2, k) => s2 + a[k], 0)), col, mode); };
  function alarmHtml(t) {
    const x = alarmInfo(t); if (!x) return '<div class="muted">Loading…</div>'; const c = t.cfg || {}, col = valCol(t);
    return `<a class="kpi alink" href="#alarms" data-al="${x.hash}" style="${alignStyle(t)}"><div class="num" style="${valStyle(t, col)}">${decorate(c, numFmt(c, x.v))}</div>${c.val?.sub === false ? '' : `<div class="sub">${x.sub}</div>`}</a>`;
  }
  const short = (m) => (METRICS[m]?.label || m).replace(/ in the time range| \(.*?\)/gi, '').toLowerCase();
  const calcText = (c) => ({ pct: `% of ${short(c.calc.bm)}`, ratio: `÷ ${short(c.calc.bm)}`, diff: `minus ${short(c.calc.bm)}`, sum: `plus ${short(c.calc.bm)}`, perMin: 'per minute', perHour: 'per hour', perDay: 'per day', delta: 'change vs the period before', deltaPct: '% change vs the period before' }[c.calc.op] || '');
  function kpiHtml(t) {
    const c = vcfg(t), m = c.metric || 'total', M = METRICS[m] || METRICS.total, st = S.stats, r = range(), d = data?.tiles?.[t.id], calc = !!(c.calc?.op && c.calc.op !== 'none');
    let num = '–', sub = '', bad = false, link = '';
    if (M.srv) {
      if (d && !d.error) {
        const v = metricNumber(t); num = v === null ? '–' : numFmt(c, v); sub = M.ranged ? r.label : DS[dsOf(t)].chip + ' now';
        if (calc) sub = calcText(c);
        else if (d.prev !== undefined && m !== 'perMinute') { const p = trend(d.n, d.prev); if (p !== null && d.prev !== d.n) { bad = ['errors', 'warnings', 'alRaised'].includes(m) && d.n > d.prev; sub = `<span class="${bad ? 'up-bad' : 'up-ok'}">${d.n > d.prev ? '▲' : '▼'} ${Math.abs(p)}%</span> vs the period before`; } }
      } else if (d?.error) sub = esc(d.error);
      if (M.link && !calc) link = 'a:' + M.link; else if (M.k === 'devices' && !calc) link = 'd';
    } else if (st) {
      if (m === 'received') { num = fmtN(st.received); sub = `up ${uptime(st.uptimeSec)}`; }
      if (m === 'eps') { num = st.eps; sub = `peak ${st.peakEps} since start`; }
      if (m === 'devices') { num = st.devices; sub = st.silentDevices ? `${st.silentDevices} silent` : 'all reporting'; }
      if (m === 'silent') { num = st.silentDevices; sub = st.silentDevices ? 'check the Devices page' : 'all reporting'; bad = st.silentDevices > 0; }
      if (m === 'stored') { num = fmtN(st.db.rows); sub = `${st.db.sizeMB} MB on disk`; }
      if (m === 'dbSize') { num = st.db.sizeMB + ' MB'; sub = `${fmtN(st.db.rows)} messages`; }
      if (m === 'dropped') { num = fmtN(st.dropped); sub = 'discarded by rules'; }
      if (m === 'diskFree') { const dk = health?.disk; num = dk ? dk.freeGB.toFixed(1) + ' GB' : '–'; sub = dk ? `${dk.freePct.toFixed(0)}% free` : ''; bad = !!dk && dk.freePct < 15; }
      if (calc) { const v = metricNumber(t); num = v === null ? '–' : numFmt(c, v); sub = calcText(c); }
    }
    const col = valCol(t), sp = sparkOf(t, col && col !== 'inherit' ? col : css('--accent'));
    const inner = `<div class="num ${bad && !col ? 'up-bad' : ''}" style="${valStyle(t, col)}">${decorate(c, num)}</div>${c.val?.sub === false ? '' : `<div class="sub">${sub}</div>`}${sp}`;
    if (link) return `<a class="kpi alink ${sp ? 'hasspark' : ''}" href="${link === 'd' ? '#devices' : '#alarms'}" ${link.startsWith('a:') ? `data-al="${link.slice(2)}"` : ''} style="${alignStyle(t)}">${inner}</a>`;
    return `<div class="kpi ${sp ? 'hasspark' : ''}" style="${alignStyle(t)}">${inner}</div>`;
  }
  const dayish = () => (data ? data.to - data.from > 36 * 3600000 : false);
  function latestHtml(t) {
    const d = data?.tiles?.[t.id]; if (!d) return '<div class="muted">Loading…</div>'; if (d.error) return `<div class="muted">${esc(d.error)}</div>`;
    if (d.alarms) {
      if (!d.alarms.length) return `<div class="empty" style="padding:16px"><b>Nothing found</b>${noData(t)}</div>`;
      return `<table class="data"><tbody>${d.alarms.map((a) => `<tr class="sev-${a.severity}" data-aid="${a.id}" data-q="${esc(a.host)}" data-st="${esc(a.state)}" style="cursor:pointer"><td><span class="sevname">${SEV[a.severity] ?? ''}</span></td><td class="trunc" style="max-width:130px">${esc(a.host)}</td><td class="muted trunc" style="max-width:0;width:100%">${esc(a.rule || a.message || '')}</td><td class="muted" style="white-space:nowrap">${esc(catName('state', a.state))}</td><td class="muted" style="white-space:nowrap">${dayish() ? dateOf(a.last).slice(5) + ' ' : ''}${timeOf(a.last, false)}</td></tr>`).join('')}</tbody></table>`;
    }
    if (d.devices) {
      if (!d.devices.length) return `<div class="empty" style="padding:16px"><b>Nothing found</b>${noData(t)}</div>`;
      return `<table class="data"><tbody>${d.devices.map((v) => `<tr data-dev="${esc(v.host)}" style="cursor:pointer"><td class="trunc" style="max-width:150px">${esc(v.host)}</td><td class="muted trunc" style="max-width:0;width:100%">${esc(v.vendor || '')}${v.srcIp && v.srcIp !== v.host ? ' · ' + esc(v.srcIp) : ''}</td><td style="white-space:nowrap"><span class="dot" style="background:${catColor('status', v.status, 0)};margin-right:5px"></span>${esc(catName('status', v.status))}</td><td class="muted" style="white-space:nowrap">${v.openAlarms ? fmtN(v.openAlarms) + ' alarms · ' : ''}${v.lastSeen ? timeOf(v.lastSeen, false) : ''}</td></tr>`).join('')}</tbody></table>`;
    }
    if (!d.rows.length) return '<div class="empty" style="padding:16px"><b>Nothing found</b>No messages match in this time range.</div>';
    const long = dayish();
    return `<table class="data"><tbody>${d.rows.map((m) => `<tr class="sev-${m.severity}" data-id="${m.id}" style="cursor:pointer"><td><span class="sevname">${SEV[m.severity]}</span></td><td class="trunc" style="max-width:130px">${esc(m.host)}</td><td class="muted trunc" style="max-width:0;width:100%">${esc(m.message)}</td><td class="muted" style="white-space:nowrap">${long ? dateOf(m.ts).slice(5) + ' ' : ''}${timeOf(m.ts, false)}</td></tr>`).join('')}</tbody></table>`;
  }
  function paint() { for (const t of getTiles()) paintTile(t); }
  function afterPaint(t, wb) {
    const c = t.cfg || {}, node = wb.closest('.widget'); if (!node) return;
    wb.dataset.lg = c.ch?.legend || 'bottom';
    const col = tintOf(t); node.classList.toggle('tinted', !!col);
    if (col) { const m = thMode(c), a2 = m === 'grad' ? `linear-gradient(135deg,${col},color-mix(in srgb,${col} 55%,#000))` : col; node.style.setProperty('--tint', a2); node.style.setProperty('--tintink', inkOf(/^#/.test(col) ? col : '#888888')); } else { node.style.removeProperty('--tint'); node.style.removeProperty('--tintink'); }
  }
  function paintTile(t) {
    const st = S.stats;
    {
      const wb = wbOf(t.id); if (!wb) return; const d = data?.tiles?.[t.id]; curPal = PALETTES[t.cfg?.pal] || null;
      if (t.type === 'kpi') setHtml(t.id, kpiHtml(t));
      else if (t.type === 'trend') { if (setHtml(t.id, '<div class="cwrap"><canvas></canvas></div><div class="legend"></div>') || true) drawTrend(t); }
      else if (t.type === 'rate') { if (setHtml(t.id, '<div class="cwrap"><canvas></canvas></div>') || true) drawRate(t); }
      else if (t.type === 'sevbars') {
        if (!d) setHtml(t.id, '<div class="muted">Loading…</div>');
        else { const by = new Map(d.rows.map((r) => [+r.key, r.n])); setHtml(t.id, `<div class="sevbars">${SEVORD.map((i) => { const n = SEV[i]; const v = by.get(i) || 0, max = Math.max(1, ...d.rows.map((r) => r.n)); return `<div class="row"><span>${n}</span><div class="bar"><i style="width:${v / max * 100}%;background:var(--s${i})"></i></div><span class="num-r">${fmtN(v)}</span></div>`; }).join('')}</div>`); }
      } else if (t.type === 'top') {
        if (!d) setHtml(t.id, '<div class="muted">Loading…</div>'); else if (d.error) setHtml(t.id, `<div class="muted">${esc(d.error)}</div>`);
        else {
          const by = byOf(t);
          setHtml(t.id, d.rows.length ? bars(d.rows, (r) => esc(catName(by, r.key)), (r) => by === 'severity' && SEV[r.key] !== undefined ? `var(--s${r.key})` : by === 'app' ? 'var(--s6)' : (r.worst !== undefined && by === 'host') ? `var(--s${r.worst})` : catColor(by, r.key, 0),
            by === 'host' ? (r) => `<a href="#" class="hostlink2 trunc" data-host="${esc(r.key)}">${esc(r.key)}</a>` : null) : `<div class="muted">${noData(t)}</div>`);
        }
      } else if (t.type === 'latest') setHtml(t.id, latestHtml(t));
      else if (t.type === 'pie') { setHtml(t.id, pieHtml(t)); drawPie(t); }
      else if (t.type === 'line') { setHtml(t.id, '<div class="cwrap"><canvas></canvas></div><div class="legend"></div>'); drawLine(t); }
      else if (t.type === 'heat') setHtml(t.id, heatHtml(t));
      else if (t.type === 'gauge') setHtml(t.id, gaugeHtml(t));
      else if (t.type === 'bar') setHtml(t.id, barHtml(t));
      else if (t.type === 'treemap') setHtml(t.id, treemapHtml(t));
      else if (t.type === 'table') setHtml(t.id, tableHtml(t));
      else if (t.type === 'bargauge') setHtml(t.id, bargaugeHtml(t));
      else if (t.type === 'statspark') setHtml(t.id, statsparkHtml(t));
      else if (t.type === 'text') setHtml(t.id, textHtml(t));
      else if (t.type === 'io' && st) setHtml(t.id, ioHtml(st));
      else if (t.type === 'snmpstatus') setHtml(t.id, snmpStatusHtml());
      else if (t.type === 'poll') setHtml(t.id, pollHtml(t));
      else if (t.type === 'health') setHtml(t.id, healthTile());
      else if (t.type === 'silent') setHtml(t.id, silentTile());
      else if (t.type === 'alarm') setHtml(t.id, alarmHtml(t));
      afterPaint(t, wb);
    }
  }
  function snmpStatusHtml() {
    const x = S.info.listeners?.snmp || {}, on = S.info.config?.snmp?.enabled;
    const pill = !on ? '<span class="pill">off</span>' : x.running ? '<span class="pill ok">listening</span>' : '<span class="pill bad">stopped</span>';
    return `<table class="data"><tbody><tr><td>UDP ${esc(x.port ?? '')}</td><td>${pill}</td><td class="num-r">${fmtN(x.decoded || 0)} traps · ${fmtN((x.rejectedSource || 0) + (x.rejectedCommunity || 0))} refused · ${fmtN(x.malformed || 0)} damaged</td></tr>
      ${x.v3 ? `<tr><td colspan="3"><span class="pill">${fmtN(x.v3Ok || 0)} SNMPv3 accepted</span>${x.v3Refused ? ` <span class="pill warn">${fmtN(x.v3Refused)} refused</span> <span class="muted">${esc(String(x.v3LastError || '').slice(0, 140))}</span>` : ''}</td></tr>` : ''}
      ${(x.missing || []).length ? `<tr><td colspan="3" class="muted"><a href="#snmp">${x.missing.length} vendor${x.missing.length > 1 ? 's' : ''} need a MIB file</a></td></tr>` : ''}
      ${x.error ? `<tr><td colspan="3" class="muted" style="white-space:normal;color:var(--bad)">${esc(x.error)}</td></tr>` : ''}</tbody></table>`;
  }
  function ioHtml(st) {
    const l = S.info.listeners, em = st.email || {}, sm = S.info.config.smtp || {};
    const emailState = !(sm.host && sm.from) ? '<span class="pill">not set up</span>' : em.lastError ? '<span class="pill warn">needs attention</span>' : '<span class="pill ok">ready</span>';
    return `<table class="data"><tbody>
      <tr><td>UDP ${esc(l.udp.port ?? '')}</td><td>${l.udp.running ? '<span class="pill ok">listening</span>' : '<span class="pill bad">stopped</span>'}</td><td class="num-r">${fmtN(l.udp.packets)} packets${l.udp.rejected ? ` · ${fmtN(l.udp.rejected)} refused` : ''}</td></tr>
      <tr><td>TCP ${esc(l.tcp.port ?? '')}</td><td>${l.tcp.running ? '<span class="pill ok">listening</span>' : '<span class="pill bad">stopped</span>'}</td><td class="num-r">${l.tcp.connections} connections · ${fmtN(l.tcp.packets)} messages${l.tcp.rejected ? ` · ${fmtN(l.tcp.rejected)} refused` : ''}</td></tr>
      <tr><td>Email alerts</td><td>${emailState}</td><td class="num-r">${fmtN(em.sent || 0)} sent · ${fmtN(em.failed || 0)} failed · ${fmtN(em.skipped || 0)} skipped</td></tr>
      ${em.lastError ? `<tr><td colspan="3" class="muted" style="white-space:normal">${esc(em.lastError)}</td></tr>` : ''}
      ${st.rawLog?.enabled ? `<tr><td>Raw text logs</td><td>${st.rawLog.error ? '<span class="pill bad">error</span>' : '<span class="pill ok">writing</span>'}</td><td class="num-r">${esc(st.rawLog.error || 'daily files')}</td></tr>` : ''}
      ${st.forwarders.map((f) => `<tr><td>Forward → ${esc(f.name || f.host)}</td><td><span class="pill ${f.errors ? 'warn' : 'ok'}">${esc(f.protocol)} ${esc(f.host)}:${f.port}</span></td><td class="num-r">${fmtN(f.sent)} sent · ${fmtN(f.errors)} errors</td></tr>`).join('')}
      </tbody></table>`;
  }
  function healthTile() {
    const h = health; if (!h) return '<div class="muted">Loading…</div>';
    const bad = h.checks.filter((c) => c.status !== 'ok');
    return `<div class="hstate ${h.status}"><b>${h.status === 'ok' ? 'All checks passed' : h.status === 'warn' ? 'Needs attention' : 'Problem'}</b></div>` +
      (bad.length ? `<ul class="hlist">${bad.slice(0, 5).map((c) => `<li><span class="pill ${c.status}">${esc(c.label)}</span> <span class="muted">${esc(c.detail).slice(0, 110)}</span></li>`).join('')}</ul>` : `<div class="muted">${h.disk ? `${h.disk.freeGB.toFixed(1)} GB free · ` : ''}${fmtN(h.db.rows)} messages stored</div>`) +
      '<div style="margin-top:8px"><a href="#health">Open the Health page</a></div>';
  }
  function silentTile() {
    if (!devices) return '<div class="muted">Loading…</div>';
    const s = devices.filter((d) => d.silent);
    return s.length ? `<table class="data"><tbody>${s.slice(0, 12).map((d) => `<tr><td>${esc(d.alias || d.host)}</td><td class="muted">${esc(d.srcIp)}</td><td class="num-r">${ago(d.ageSec)}</td></tr>`).join('')}</tbody></table>` : '<div class="muted">All devices are reporting.</div>';
  }

  // ----- pie / donut, line, heatmap and gauge -----
  const STATE_NAME = { open: 'Open', ack: 'Acknowledged', cleared: 'Cleared', escalated: 'Escalated', reporting: 'Reporting', silent: 'Silent', muted: 'Muted', overdue: 'Overdue', alarms: 'With open alarms', syslog: 'Syslog', snmp: 'SNMP traps', trap: 'SNMP traps', both: 'Syslog + traps', none: 'Nothing received' };
  const catName = (by, k) => (by === 'severity' ? (SEV[k] ?? k) : by === 'facility' ? ((S.info.facilities || [])[k] ?? k) : (by === 'state' || by === 'status' || by === 'source' || by === 'kind') ? (STATE_NAME[k] || String(k)) : String(k) || '(none)');
  const STATE_COL = { open: '--bad', ack: '--s4', cleared: '--ok', escalated: '--bad', reporting: '--ok', silent: '--bad', muted: '--faint', overdue: '--s4', alarms: '--bad' };
  const catColor = (by, k, i) => (by === 'severity' && SEV[k] !== undefined ? css('--s' + k) : (by === 'state' || by === 'status') && STATE_COL[k] ? css(STATE_COL[k]) : palc(i));
  const noData = (t) => `Nothing to show in this time range for ${DS[dsOf(t)].chip.toLowerCase()}.`;
  function pieSlices(t) {
    const d = data?.tiles?.[t.id]; if (!d || d.error || !d.rows) return null; const by = byOf(t);
    const sl = d.rows.map((r, i) => ({ key: r.key, name: catName(by, r.key), n: r.n, color: catColor(by, r.key, i) }));
    if (by === 'severity' && dsKind(t) === 'events') sl.sort((a, b) => a.key - b.key);
    const rest = (d.total || 0) - d.rows.reduce((s, r) => s + r.n, 0); if (rest > 0) sl.push({ key: null, name: 'Other', n: rest, color: css('--faint') });
    return { sl, total: d.total || sl.reduce((s, x) => s + x.n, 0), by };
  }
  function pieHtml(t) {
    const d = data?.tiles?.[t.id]; if (!d) return '<div class="muted">Loading…</div>'; if (d.error) return `<div class="muted">${esc(d.error)}</div>`;
    const p = pieSlices(t); if (!p || !p.total) return `<div class="muted">${noData(t)}</div>`;
    return `<div class="piewrap"><div class="cwrap"><canvas></canvas></div><div class="pielegend">${p.sl.map((x) => `<div class="pl" ${x.key !== null ? `data-key="${esc(x.key)}"` : ''}><span class="dot" style="background:${x.color}"></span><span class="trunc">${esc(x.name)}</span><span class="muted num-r">${fmtN(x.n)} · ${(x.n / p.total * 100).toFixed(x.n / p.total < 0.1 ? 1 : 0)}%</span></div>`).join('')}</div></div>`;
  }
  const drillFilter = (by, key, t) => ({ ...(t.cfg?.filter || {}), ...(by === 'host' ? { host: key } : by === 'app' ? { app: key } : by === 'severity' ? { sevs: String(key) } : by === 'msgid' ? { text: key } : { facility: key }) });
  function drawPie(t) {
    const cv = canvasOf(t), p = pieSlices(t); if (!cv || !p || !p.total) return; const { g, w, h } = fit(cv);
    const cx = w / 2, cy = h / 2, R = Math.max(10, Math.min(w, h) / 2 - 4), donut = (t.cfg?.style || 'donut') === 'donut'; let a0 = -Math.PI / 2; const arcs = [];
    for (const x of p.sl) { const a1 = a0 + (x.n / p.total) * Math.PI * 2; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a1); g.closePath(); g.fillStyle = x.color; g.fill(); g.strokeStyle = css('--panel'); g.lineWidth = 1.5; g.stroke(); arcs.push([a0, a1, x]); a0 = a1; }
    if (donut) { g.beginPath(); g.arc(cx, cy, R * 0.58, 0, Math.PI * 2); g.fillStyle = css('--panel'); g.fill(); g.fillStyle = css('--text'); g.textAlign = 'center'; g.font = '600 ' + Math.max(12, Math.round(R * 0.3)) + 'px ' + css('--ui'); g.fillText(fmtN(p.total), cx, cy + R * 0.08); g.font = '11px ' + css('--ui'); g.fillStyle = css('--faint'); g.fillText('messages', cx, cy + R * 0.3); }
    const at = (e) => { const dx = e.offsetX - cx, dy = e.offsetY - cy; if (Math.hypot(dx, dy) > R || (donut && Math.hypot(dx, dy) < R * 0.58)) return null; let a = Math.atan2(dy, dx); if (a < -Math.PI / 2) a += Math.PI * 2; return (arcs.find(([s0, s1]) => a >= s0 && a < s1) || [])[2] || null; };
    cv.onmousemove = (e) => { const x = at(e); cv.title = x ? `${x.name}: ${fmtN(x.n)} (${(x.n / p.total * 100).toFixed(1)}%)` : ''; cv.style.cursor = x && x.key !== null && !editing ? 'pointer' : ''; };
    cv.onclick = (e) => { const x = at(e); if (x && x.key !== null && !editing) drillTile(t, p.by, x.key); };
  }
  /** calculations on a series: running total, moving average, change per step, per-minute rate */
  function seriesCalc(t, v) {
    const sc = t.cfg?.sc; if (!sc?.op || sc.op === 'none') return v; const n = Math.min(60, Math.max(2, Math.round(+sc.n) || 5));
    if (sc.op === 'cum') { let a = 0; return v.map((x) => (a += x)); }
    if (sc.op === 'ma') return v.map((_, i) => { const w = v.slice(Math.max(0, i - n + 1), i + 1); return Math.round(w.reduce((a, b) => a + b, 0) / w.length * 100) / 100; });
    if (sc.op === 'diff') return v.map((x, i) => (i ? x - v[i - 1] : 0)).map((x) => Math.max(0, x));
    if (sc.op === 'rate') { const m = Math.max(1, (data?.bucketMs || 60000) / 60000); return v.map((x) => Math.round(x / m * 100) / 100); }
    return v;
  }
  function lineSeries(t) {
    const d = data?.tiles?.[t.id]; if (!d?.series) return null; const all = (t.cfg?.mode || 'severity') === 'total';
    const defs = all ? [{ name: 'All ' + DS[dsOf(t)].chip.toLowerCase(), color: css('--accent'), ks: [...SEVORD] }] : GROUPS.map((ks, i) => ({ name: GNAMES[i], color: [css('--s2'), css('--s3'), css('--s4'), css('--s5')][i], ks }));
    return { d, lines: defs.map((df) => ({ ...df, v: seriesCalc(t, d.series.map((a) => df.ks.reduce((s, k) => s + a[k], 0))) })) };
  }
  const pathPts = (g, pts, smooth, move) => {
    if (!pts.length) return; if (move) g.moveTo(pts[0][0], pts[0][1]); else g.lineTo(pts[0][0], pts[0][1]);
    if (!smooth || pts.length < 3) { for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); return; }
    for (let i = 1; i < pts.length - 1; i++) g.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  };
  /** line / area chart with the tile's chart options (width, fill, gradient, smooth, points, stacked, grid, axes, legend) */
  function drawLines(t, lines, d, dflt = {}) {
    const cv = canvasOf(t); if (!cv || !data) return; const ch = t.cfg?.ch || {}, { g, w, h } = fit(cv), axis = ch.axis !== false, grid2 = ch.grid !== false;
    const padL = axis ? 34 : 6, padB = axis ? 16 : 4, padT = 8, n = d.series.length, stack = ch.stack ?? dflt.stack ?? false, lw = ch.lw ?? 1.8, fillA = ch.fillA ?? (t.cfg?.fill ? 19 : (dflt.fillA ?? 0)), grad = ch.grad !== false;
    const tops = []; lines.forEach((l, i) => tops.push(l.v.map((v, k) => v + (stack && i ? tops[i - 1][k] : 0))));
    const max = Math.max(5, ...(stack ? tops[tops.length - 1] : lines.flatMap((l) => l.v))) * 1.1, x = (i) => padL + (n < 2 ? 0.5 : i / (n - 1)) * (w - padL - 8), y = (v) => padT + (1 - v / max) * (h - padT - padB);
    g.strokeStyle = css('--line'); g.fillStyle = css('--faint'); g.textAlign = 'right'; g.lineWidth = 1;
    for (let i = 0; i <= 3; i++) { const v = (max / 3) * i, yy = y(v); if (grid2) { g.beginPath(); g.moveTo(padL, yy); g.lineTo(w - 4, yy); g.stroke(); } if (axis) g.fillText(v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v), padL - 5, yy + 3); }
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i], pts = tops[i].map((v, k) => [x(k), y(v)]);
      if (fillA > 0) {
        g.beginPath(); pathPts(g, pts, !!ch.smooth, true);
        if (stack && i) pathPts(g, tops[i - 1].map((v, k) => [x(k), y(v)]).reverse(), false, false); else { g.lineTo(x(n - 1), y(0)); g.lineTo(x(0), y(0)); }
        g.closePath(); let fs = hexA(l.color, fillA); if (grad && /^#/.test(l.color) && !(stack && i)) { const gr = g.createLinearGradient(0, padT, 0, h - padB); gr.addColorStop(0, hexA(l.color, fillA)); gr.addColorStop(1, hexA(l.color, 0)); fs = gr; } g.fillStyle = fs; g.fill();
      }
      g.beginPath(); pathPts(g, pts, !!ch.smooth, true); g.strokeStyle = l.color; g.lineWidth = lw; g.lineJoin = 'round'; g.stroke();
      if (ch.pts) { g.fillStyle = l.color; for (const [px, py] of pts) { g.beginPath(); g.arc(px, py, Math.max(2, lw + 0.8), 0, 7); g.fill(); } }
    }
    const t0 = data.firstBucket * data.bucketMs, fmt = (ts) => (data.to - data.from > 36 * 3600000 ? dateOf(ts).slice(5) + ' ' : '') + timeOf(ts, false).slice(0, 5);
    if (axis) { g.fillStyle = css('--faint'); g.textAlign = 'left'; g.fillText(fmt(Math.max(t0, data.from)), padL, h - 3); g.textAlign = 'right'; g.fillText(fmt(data.to), w - 4, h - 3); }
    cv.onmousemove = (e) => { const i = Math.round(((e.offsetX - padL) / (w - padL - 8)) * (n - 1)); if (i < 0 || i >= n) { cv.title = ''; return; } const ts = t0 + i * data.bucketMs; cv.title = `${dateOf(ts)} ${timeOf(ts, false).slice(0, 5)}\n` + lines.map((l) => `${l.name}: ${fmtN(l.v[i])}`).join('\n'); };
    const lg = $('.legend', wbOf(t.id)); if (lg) lg.innerHTML = lines.length > 1 && ch.legend !== 'hide' ? lines.map((l) => `<span class="muted"><span class="dot" style="background:${l.color};margin-right:5px"></span>${l.name}</span>`).join('') : '';
  }
  function drawLine(t) { const ls = lineSeries(t); if (ls) drawLines(t, ls.lines, ls.d, { stack: false }); }
  const THEMES = { blue: [], traffic: ['#30a46c', '#f5a524', '#e5484d'], heat: ['#fff3b0', '#fb923c', '#b91c1c'], cool: ['#2dd4bf', '#3b82f6', '#7c3aed'], mono: ['#334155', '#94a3b8', '#f1f5f9'] };
  const themeCol = (theme, r) => { const st = THEMES[theme] || THEMES.traffic, x = Math.min(1, Math.max(0, r)) * (st.length - 1), i = Math.min(st.length - 2, Math.floor(x)), f = x - i, a = parseInt(st[i].slice(1), 16), b = parseInt(st[i + 1].slice(1), 16); const m = (sh) => Math.round(((a >> sh) & 255) * (1 - f) + ((b >> sh) & 255) * f); return `rgb(${m(16)},${m(8)},${m(0)})`; };
  function heatHtml(t) {
    const d = data?.tiles?.[t.id]; if (!d) return '<div class="muted">Loading…</div>'; if (d.error) return `<div class="muted">${esc(d.error)}</div>`;
    const dow = t.cfg?.mode === 'dowHour', cells = d.cells || [], max = Math.max(1, ...cells.flat());
    if (!cells.flat().some((v) => v)) return `<div class="muted">${noData(t)}</div>`;
    const shape = t.cfg?.shape || 'square', theme = t.cfg?.theme || 'blue';
    const shade = (v) => `--c:${v ? (theme === 'blue' ? `color-mix(in srgb, var(--accent) ${Math.max(10, Math.round(v / max * 100))}%, transparent)` : themeCol(theme, v / max)) : 'transparent'}`;
    const cols = dow ? 24 : (cells[0] ? cells[0].length : 1), labels = dow ? DOWN : d.hosts;
    const head = dow ? `<div class="hm-row hm-head"><span></span>${Array.from({ length: 24 }, (_, h) => `<i>${h % 6 === 0 ? h : ''}</i>`).join('')}</div>` : '';
    const rows = cells.map((row, ri) => `<div class="hm-row${ri % 2 ? ' odd' : ''}"><span class="trunc" title="${esc(labels[ri])}">${esc(labels[ri])}</span>${row.map((v, ci) => { const tip = dow ? `${DOWN[ri]} ${String(ci).padStart(2, '0')}:00 — ${fmtN(v)} messages` : (() => { const ts = (d.firstBucket + ci) * d.bucketMs; return `${labels[ri]} · ${dateOf(ts)} ${timeOf(ts, false).slice(0, 5)} — ${fmtN(v)} messages`; })(); return `<i class="hmc shp-${shape}${v ? '' : ' z'}" style="${shade(v)}" title="${esc(tip)}"></i>`; }).join('')}</div>`).join('');
    const foot = dow ? '' : `<div class="hm-row hm-head"><span></span><i style="grid-column:span ${Math.ceil(cols / 2)};text-align:left">${esc(dateOf(d.firstBucket * d.bucketMs).slice(5) + ' ' + timeOf(d.firstBucket * d.bucketMs, false).slice(0, 5))}</i><i style="grid-column:span ${Math.floor(cols / 2) || 1};text-align:right">${esc(dateOf(data.to).slice(5) + ' ' + timeOf(data.to, false).slice(0, 5))}</i></div>`;
    return `<div class="heat${shape === 'hex' || shape === 'hexo' ? ' honey' : ''}" style="--cols:${cols}">${head}${rows}${foot}</div><div class="muted" style="font-size:11.5px;margin-top:4px;display:flex;gap:6px;align-items:center">0 <span class="hmleg" style="background:linear-gradient(90deg, ${theme === 'blue' ? 'transparent, var(--accent)' : THEMES[theme].join(',')})"></span> ${fmtN(max)} messages in one cell</div>`;
  }
  const nOf = (m, d) => { if (!d || d.error) return null; return m === 'perMinute' ? Math.round(d.n / Math.max(1, (data.to - data.from) / 60000) * 10) / 10 : d.n; };
  const calcUnit = (c) => ({ pct: '%', deltaPct: '%', perMin: '/min', perHour: '/h', perDay: '/day' }[c.calc?.op] || '');
  /** a tile's config with the unit that goes with its calculation / metric (the user's own "Unit after" wins) */
  const vcfg = (t) => { const c = t.cfg || {}, u = c.val?.suffix ? '' : (calcUnit(c) || (c.calc?.op && c.calc.op !== 'none' ? '' : METRICS[c.metric]?.unit ? ' ' + METRICS[c.metric].unit : '')); return u ? { ...c, val: { ...(c.val || {}), suffix: u } } : c; };
  function applyCalc(t, v, d) {
    const c = t.cfg?.calc; if (v === null || v === undefined) return v; if (!c) return v;
    const mins = Math.max(1, ((data?.to || 0) - (data?.from || 0)) / 60000); let r = v;
    if (!c.op || c.op === 'none') r = v; else if (['pct', 'ratio', 'diff', 'sum'].includes(c.op)) { const b = nOf(c.bm, data?.tiles?.[t.id + '_b']); if (b === null) return null; r = c.op === 'pct' ? (b ? v / b * 100 : 0) : c.op === 'ratio' ? (b ? v / b : 0) : c.op === 'diff' ? v - b : v + b; }
    else if (c.op === 'perMin') r = v / mins; else if (c.op === 'perHour') r = v / (mins / 60); else if (c.op === 'perDay') r = v / (mins / 1440);
    else if (c.op === 'deltaPct' || c.op === 'delta') { if (!d || d.prev === undefined) return null; r = c.op === 'delta' ? d.n - d.prev : (d.prev ? (d.n - d.prev) / d.prev * 100 : 0); }
    if (Number.isFinite(+c.mul)) r *= +c.mul; if (Number.isFinite(+c.add)) r += +c.add;
    return Math.round(r * 100) / 100;
  }
  function metricNumber(t) {
    const m = t.cfg?.metric || 'total', st = S.stats, d = data?.tiles?.[t.id];
    if (METRICS[m]?.srv) return applyCalc(t, nOf(m, d), d);
    if (!st) return null; const v = { received: st.received, eps: st.eps, devices: st.devices, silent: st.silentDevices, stored: st.db.rows, dbSize: st.db.sizeMB, dropped: st.dropped, diskFree: health?.disk?.freeGB }[m]; return v === undefined ? null : applyCalc(t, v, null);
  }
  function gaugeHtml(t) {
    const v = metricNumber(t), c = vcfg(t); if (v === null) return '<div class="muted">Loading…</div>';
    const steps = thSteps(c), nice = (x) => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, x)))); return Math.ceil(x / p) * p; };
    const top = steps ? steps[steps.length - 1].v : 0, max = c.max > 0 ? +c.max : nice(Math.max(1, (top || v) * 1.25, v * 1.1)), f = Math.min(1, Math.max(0, v / max));
    const col = thColor(c, v) || css('--accent'), grad = thMode(c) === 'grad', style = c.gstyle || 'arc', label = (METRICS[c.metric || 'total'] || {}).label || '';
    const colAt = (fr) => thColor(c, fr * max) || css('--accent');
    const sub = c.val?.sub === false ? '' : `<div class="sub muted">${esc(label.replace(/ in the time range/i, ''))}${(METRICS[c.metric || 'total'] || {}).ranged ? ' · ' + esc(range().label) : ''}${c.calc?.op && c.calc.op !== 'none' ? ' · ' + esc(calcText(c)) : ''}</div>`;
    const txt = decorate(c, numFmt(c, Math.round(v * 10) / 10)), vs = valStyle(t, '');
    if (style === 'lcd' || style === 'bar') {
      const N = 24, on = Math.round(f * N);
      const seg = style === 'lcd' ? Array.from({ length: N }, (_, i) => `<i style="${i < on ? `background:${grad || steps ? colAt((i + 0.5) / N) : `color-mix(in srgb,var(--ok) ${100 - i / N * 100}%,var(--bad))`}` : ''}"></i>`).join('') : `<b style="width:${f * 100}%;background:${grad && steps ? `linear-gradient(90deg,${steps.map((x) => `${x.c} ${Math.min(100, x.v / max * 100)}%`).join(',')})` : col}"></b>`;
      return `<div class="gauge2"><div class="gv2" style="color:${col};${vs}">${txt}</div><div class="${style === 'lcd' ? 'lcd' : 'gbar'}">${seg}</div><div class="gscale"><span>0</span><span>${fmtN(max)}</span></div>${sub}</div>`;
    }
    const full = style === 'ring', R = full ? 62 : 80, wd = full ? 11 : 14, cx = 100, cy = full ? 80 : 100;
    const P = (fr) => { const ang = full ? -Math.PI / 2 + Math.PI * 2 * fr : Math.PI * (1 - fr); return [cx + R * Math.cos(ang), cy - (full ? -R * Math.sin(ang) : R * Math.sin(ang))]; };
    const arc = (f0, f1, color, w2) => { f1 = Math.min(f1, 0.9999); if (f1 <= f0) return ''; const [x0, y0] = P(f0), [x1, y1] = P(f1); const large = (f1 - f0) * (full ? 2 : 1) > 1 ? 1 : 0; return `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="${color}" stroke-width="${w2}" stroke-linecap="butt"/>`; };
    let bands = ''; if (steps) steps.forEach((x, i) => { const f0 = Math.min(1, x.v / max), f1 = i + 1 < steps.length ? Math.min(1, steps[i + 1].v / max) : 1; bands += arc(f0, f1, hexA(/^#/.test(x.c) ? x.c : '#888888', 38), wd); });
    let val = ''; if (f > 0) { if (grad && steps) { const K = 40; for (let i = 0; i < K; i++) { const s0 = i / K * f, s1 = (i + 1) / K * f; val += arc(s0, s1 + 0.002, colAt(s0 + (s1 - s0) / 2), wd); } } else val = arc(0, f, col, wd); }
    const vb = full ? '0 0 200 160' : '0 0 200 120';
    return `<div class="gauge"><svg viewBox="${vb}" role="img" aria-label="${esc(label)}: ${fmtN(v)}">${arc(0, 0.9999, css('--line'), wd)}${bands}${val}${full ? `<text x="100" y="${cy + 10}" text-anchor="middle" class="gv" fill="${col}">${fmtN(Math.round(v * 10) / 10)}</text>` : `<text x="100" y="92" text-anchor="middle" class="gv" fill="${col}">${fmtN(Math.round(v * 10) / 10)}</text><text x="20" y="116" text-anchor="middle" class="gs">0</text><text x="180" y="116" text-anchor="middle" class="gs">${fmtN(max)}</text>`}</svg>${sub}</div>`;
  }

  // ----- 1.34 more visuals: bar chart, treemap, table, bar gauge, number with trend line, text note -----
  let curPal = null;
  const palc = (i) => (curPal ? curPal[i % curPal.length] : (css('--c' + (i % 10)) || PAL[i % PAL.length]));
  function topRows(t) {
    const d = data?.tiles?.[t.id]; if (!d) return { msg: 'Loading…' }; if (d.error) return { msg: esc(d.error) }; if (!d.rows?.length) return { msg: noData(t) };
    const by = byOf(t), thOn = !!t.cfg?.th?.steps?.length && thMode(t.cfg) !== 'none', rows = d.rows.map((r, i) => ({ key: r.key, name: catName(by, r.key), n: r.n, color: (thOn && thColor(t.cfg, r.n)) || catColor(by, r.key, i) }));
    return { by, rows, total: d.total || rows.reduce((a, r) => a + r.n, 0), max: Math.max(1, ...rows.map((r) => r.n)) };
  }
  const dk = (t, r) => `data-dk="${esc(r.key)}" data-tid="${t.id}" style="cursor:pointer"`;
  function barHtml(t) {
    const x = topRows(t); if (x.msg) return `<div class="muted">${x.msg}</div>`;
    if (t.cfg?.orient === 'v') return `<div class="vbars">${x.rows.map((r) => `<div class="vb" ${dk(t, r).replace(' style="cursor:pointer"', '')} title="${esc(r.name)}: ${fmtN(r.n)}"><span class="vv">${fmtN(r.n)}</span><div class="vcol"><i style="height:${Math.max(2, r.n / x.max * 100)}%;background:${r.color}"></i></div><span class="vn trunc">${esc(r.name)}</span></div>`).join('')}</div>`;
    return `<div class="hbars">${x.rows.map((r) => `<div class="hb" ${dk(t, r)} title="${esc(r.name)}: ${fmtN(r.n)}"><span class="hn trunc">${esc(r.name)}</span><div class="htrack"><i style="width:${Math.max(1, r.n / x.max * 100)}%;background:${r.color}"></i></div><span class="hv">${fmtN(r.n)}</span></div>`).join('')}</div>`;
  }
  function treemapCells(items, x, y, w, h, out) {
    if (!items.length) return; if (items.length === 1) { out.push({ ...items[0], x, y, w, h }); return; }
    const total = items.reduce((a, i) => a + i.n, 0); let acc = 0, k = 0;
    for (; k < items.length - 1; k++) { if (acc + items[k].n / 2 > total / 2) break; acc += items[k].n; }
    k = Math.max(1, k); const a = items.slice(0, k), b = items.slice(k), fa = a.reduce((s, i) => s + i.n, 0) / total;
    if (w >= h) { treemapCells(a, x, y, w * fa, h, out); treemapCells(b, x + w * fa, y, w * (1 - fa), h, out); } else { treemapCells(a, x, y, w, h * fa, out); treemapCells(b, x, y + h * fa, w, h * (1 - fa), out); }
  }
  const inkOn = (col) => { const m = /^#([0-9a-f]{6})$/i.exec(String(col).trim()); if (!m) return ''; const n = parseInt(m[1], 16), L = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); return L > 160 ? 'color:#111;text-shadow:none' : ''; };
  function treemapHtml(t) {
    const x = topRows(t); if (x.msg) return `<div class="muted">${x.msg}</div>`; const out = []; treemapCells(x.rows.filter((r) => r.n > 0), 0, 0, 100, 100, out);
    return `<div class="tmap">${out.map((c) => `<div class="tc" ${dk(t, c).replace(' style="cursor:pointer"', '')} style="left:${c.x}%;top:${c.y}%;width:${c.w}%;height:${c.h}%" title="${esc(c.name)}: ${fmtN(c.n)} (${Math.round(c.n / x.total * 100)}%)"><div style="background:${c.color};${inkOn(c.color)}"><b class="trunc">${esc(c.name)}</b><span>${fmtN(c.n)}${c.w * c.h > 600 ? ` · ${Math.round(c.n / x.total * 100)}%` : ''}</span></div></div>`).join('')}</div>`;
  }
  function tableHtml(t) {
    const x = topRows(t); if (x.msg) return `<div class="muted">${x.msg}</div>`;
    return `<table class="data"><thead><tr><th>#</th><th>${esc({ host: 'Device', app: 'Process', severity: 'Severity', facility: 'Facility', msgid: 'Trap', rule: 'Alarm rule', state: 'State', source: 'Source', vendor: 'Vendor', status: 'Status', group: 'Group', kind: 'Sends' }[x.by] || 'Name')}</th><th style="text-align:right">Count</th><th style="width:34%">Share</th></tr></thead><tbody>${x.rows.map((r, i) => `<tr ${dk(t, r)}><td class="muted">${i + 1}</td><td class="trunc" style="max-width:0;width:50%"><span class="dot" style="background:${r.color};margin-right:7px"></span>${esc(r.name)}</td><td style="text-align:right">${fmtN(r.n)}</td><td><div class="bar"><i style="width:${Math.max(1, r.n / x.total * 100)}%;background:${r.color}"></i></div></td></tr>`).join('')}</tbody></table>`;
  }
  function bargaugeHtml(t) {
    const x = topRows(t); if (x.msg) return `<div class="muted">${x.msg}</div>`; const c = t.cfg || {}, bs = c.bstyle || 'gradient', steps = thSteps(c);
    return `<div class="hbars bg ${bs}">${x.rows.map((r) => {
      const pct = Math.max(1, r.n / x.max * 100), lvl = pct >= 80 ? 2 : pct >= 50 ? 1 : 0, col = (steps && thColor(c, r.n)) || ['var(--ok)', 'var(--s4)', 'var(--bad)'][lvl];
      let track;
      if (bs === 'lcd') { const N = 20, on = Math.max(1, Math.round(pct / 100 * N)); track = `<div class="htrack lcd">${Array.from({ length: N }, (_, i) => `<i style="${i < on ? `background:${steps ? (thColor(c, i / N * x.max) || col) : `color-mix(in srgb,var(--ok) ${100 - i / N * 100}%,var(--bad))`}` : ''}"></i>`).join('')}</div>`; }
      else if (bs === 'solid') track = `<div class="htrack"><i style="width:${pct}%;background:${col}"></i></div>`;
      else track = `<div class="htrack"><i style="width:${pct}%;background:linear-gradient(90deg,var(--ok),${lvl ? 'var(--s4)' : 'var(--ok)'} 60%,${col});background-size:${(100 / pct * 100).toFixed(0)}% 100%"></i></div>`;
      return `<div class="hb" ${dk(t, r)} title="${esc(r.name)}: ${fmtN(r.n)}"><span class="hn trunc">${esc(r.name)}</span>${track}<span class="hv" style="color:${col}">${decorate(c, fmtN(r.n))}</span></div>`;
    }).join('')}</div>`;
  }
  function statsparkHtml(t) {
    const ls = lineSeries({ ...t, cfg: { ...t.cfg, mode: 'total', sc: undefined } }); if (!ls) return '<div class="muted">Loading…</div>';
    const v = ls.lines[0].v, total = v.reduce((a, b) => a + b, 0), c = t.cfg || {}, col0 = valCol(t), col = col0 && col0 !== 'inherit' ? col0 : (col0 === 'inherit' ? 'currentColor' : css('--accent'));
    return `<div class="stat" style="${alignStyle(t)}"><div class="num" style="${valStyle(t, col0 && col0 !== 'inherit' ? col0 : '')}">${decorate(c, numFmt(c, total))}</div>${c.val?.sub === false ? '' : `<div class="sub">${esc(range().label)}</div>`}${sparkSvg(v, col, c.graph === 'line' ? 'line' : 'area')}</div>`;
  }
  function mdLite(src) {
    const e = esc(String(src || '')).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return e.split('\n').map((l) => (/^#{1,3}\s/.test(l) ? `<div class="mdh">${l.replace(/^#{1,3}\s/, '')}</div>` : /^[-*]\s/.test(l) ? `<div class="mdl">• ${l.slice(2)}</div>` : l.trim() ? `<div>${l}</div>` : '<div class="mdg"></div>')).join('');
  }
  const textHtml = (t) => `<div class="txt">${t.cfg?.text ? mdLite(t.cfg.text) : '<span class="muted">Empty note. Customize, then Edit this tile to type your text.</span>'}</div>`;

  // ----- charts (sized to their tile) -----
  function canvasOf(t) { const wb = wbOf(t.id); return wb && $('canvas', wb); }
  function fit(cv) { const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 300, h = cv.clientHeight || 120; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.font = '11px ' + css('--ui'); return { g, w, h }; }
  function drawRate(t) {
    const cv = canvasOf(t), st = S.stats; if (!cv || !st) return; const { g, w, h } = fit(cv), data = st.rate; const padL = 34, padB = 16, padT = 6, max = Math.max(5, ...data) * 1.15;
    const x = (i) => padL + (i / (data.length - 1)) * (w - padL - 4), y = (v) => padT + (1 - v / max) * (h - padT - padB);
    g.strokeStyle = css('--line'); g.fillStyle = css('--faint'); g.lineWidth = 1; g.textAlign = 'right';
    for (let i = 0; i <= 3; i++) { const v = (max / 3) * i, yy = y(v); g.beginPath(); g.moveTo(padL, yy); g.lineTo(w - 4, yy); g.stroke(); g.fillText(Math.round(v), padL - 5, yy + 3); }
    g.textAlign = 'center'; g.fillText('2 min ago', padL + 24, h - 3); g.fillText('now', w - 16, h - 3);
    g.beginPath(); data.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v)))); const color = css('--accent');
    g.strokeStyle = color; g.lineWidth = 1.8; g.stroke(); g.lineTo(x(data.length - 1), y(0)); g.lineTo(x(0), y(0)); g.closePath(); g.fillStyle = color + '33'; g.fill();
  }
  const GROUPS = [[0, 1, 2], [3], [8, 4], [5, 9, 6, 7]], GNAMES = ['Critical or worse', 'Error', 'Minor / warning', 'Notice / cleared / info / debug'];
  function drawTrend(t) {
    const cv = canvasOf(t), d = data?.tiles?.[t.id]; if (!cv || !d?.series) return;
    const bm = t.cfg?.ch?.bars; if (bm === 'area' || bm === 'line' || (t.cfg?.sc?.op && t.cfg.sc.op !== 'none')) return drawLines(t, GROUPS.map((ks, i) => ({ name: GNAMES[i], color: [css('--s2'), css('--s3'), css('--s4'), css('--s5')][i], v: seriesCalc(t, d.series.map((a) => ks.reduce((s2, k) => s2 + a[k], 0))) })).reverse().reverse(), d, { stack: true, fillA: bm === 'area' ? 60 : 0 });
    const { g, w, h } = fit(cv);
    const colors = [css('--s2'), css('--s3'), css('--s4'), css('--s5')], padL = 34, padB = 16, padT = 6, n = d.series.length;
    const tot = d.series.map((a) => a.reduce((s, v) => s + v, 0)), max = Math.max(5, ...tot) * 1.1, bw = (w - padL - 4) / n, y = (v) => padT + (1 - v / max) * (h - padT - padB);
    g.strokeStyle = css('--line'); g.fillStyle = css('--faint'); g.textAlign = 'right';
    for (let i = 0; i <= 3; i++) { const v = (max / 3) * i, yy = y(v); if (t.cfg?.ch?.grid !== false) { g.beginPath(); g.moveTo(padL, yy); g.lineTo(w - 4, yy); g.stroke(); } if (t.cfg?.ch?.axis !== false) g.fillText(v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v), padL - 5, yy + 3); }
    d.series.forEach((a, i) => { let base = 0; GROUPS.forEach((grp, gi) => { const v = grp.reduce((s, k) => s + a[k], 0); if (!v) return; g.fillStyle = colors[gi]; const y1 = y(base + v), y0 = y(base); g.fillRect(padL + i * bw, y1, Math.max(1, bw - 1), y0 - y1); base += v; }); });
    const t0 = data.firstBucket * data.bucketMs, fmt = (ts) => (data.to - data.from > 36 * 3600000 ? dateOf(ts).slice(5) + ' ' : '') + timeOf(ts, false).slice(0, 5);
    g.fillStyle = css('--faint'); g.textAlign = 'left'; g.fillText(fmt(Math.max(t0, data.from)), padL, h - 3); g.textAlign = 'right'; g.fillText(fmt(data.to), w - 4, h - 3);
    cv.onmousemove = (e) => { const i = Math.floor((e.offsetX - padL) / bw); if (i < 0 || i >= n) { cv.title = ''; return; } const ts = t0 + i * data.bucketMs;
      cv.title = `${dateOf(ts)} ${timeOf(ts, false).slice(0, 5)} (${data.bucketMs >= 3600000 ? data.bucketMs / 3600000 + ' h' : data.bucketMs / 60000 + ' min'})\n` + GNAMES.map((nm, k) => `${nm}: ${fmtN(GROUPS[k].reduce((s, q) => s + d.series[i][q], 0))}`).join('\n'); };
    const lg = $('.legend', wbOf(t.id)); if (lg) lg.innerHTML = t.cfg?.ch?.legend === 'hide' ? '' : GNAMES.map((nm, i) => `<span class="muted"><span class="dot" style="background:${colors[i]};margin-right:5px"></span>${nm}</span>`).join('');
  }
  // charts redraw when their tile changes size (dragging, side panel, window)
  let ro = null, roTimer;
  function observe() {
    ro?.disconnect(); ro = new ResizeObserver(() => { clearTimeout(roTimer); roTimer = setTimeout(() => { for (const t of getTiles()) { curPal = PALETTES[t.cfg?.pal] || null; if (t.type === 'trend') drawTrend(t); if (t.type === 'rate') drawRate(t); if (t.type === 'line') drawLine(t); if (t.type === 'pie') drawPie(t); } }, 60); });
    for (const n of $$('.wb', grid)) ro.observe(n);
  }

  // ----- drag and resize with the mouse (or finger) -----
  grid.addEventListener('pointerdown', (e) => {
    if (!editing || narrow() || e.button !== 0) return;
    const rz = e.target.closest('.dz'), head = e.target.closest('.whead'); if (!rz && !(head && !e.target.closest('button'))) return;
    const node = e.target.closest('.widget'), t = getTiles().find((x) => x.id === node.dataset.id); if (!t) return;
    e.preventDefault(); node.setPointerCapture(e.pointerId);
    const g = geo(), mode = rz ? rz.dataset.r : 'move', o = { x: t.x, y: t.y, w: t.w, h: t.h }, x0 = e.clientX, y0 = e.clientY, r0 = rect(t, g, 0), ty = TYPES[t.type];
    const ghost = document.createElement('div'); ghost.className = 'dghost'; grid.appendChild(ghost); node.classList.add('dragging');
    const showGhost = () => { const r = rect(t, g, 0); Object.assign(ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' }); };
    showGhost();
    const move = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      let nx = t.x, ny = t.y, nw = t.w, nh = t.h;
      if (mode === 'move') { nx = Math.min(GRID.cols - t.w, Math.max(0, Math.round(o.x + dx / g.cellW))); ny = Math.max(0, Math.round(o.y + dy / g.cellH)); node.style.left = r0.left + dx + 'px'; node.style.top = Math.max(0, r0.top + dy) + 'px'; }
      else {
        if (mode.includes('e')) { nw = Math.min(GRID.cols - t.x, Math.max(ty.minW, Math.round(o.w + dx / g.cellW))); node.style.width = Math.max(ty.minW * g.cellW - GRID.gap, r0.width + dx) + 'px'; }
        if (mode.includes('s')) { nh = Math.max(ty.minH, Math.round(o.h + dy / g.cellH)); node.style.height = Math.max(ty.minH * g.cellH - GRID.gap, r0.height + dy) + 'px'; }
      }
      if (nx !== t.x || ny !== t.y || nw !== t.w || nh !== t.h) { Object.assign(t, { x: nx, y: ny, w: nw, h: nh }); settle(getTiles(), t.id); place(t.id); showGhost(); }
    };
    const up = () => {
      node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', up);
      node.classList.remove('dragging'); ghost.remove(); settle(getTiles(), t.id); place(); saveTiles();
    };
    node.addEventListener('pointermove', move); node.addEventListener('pointerup', up); node.addEventListener('pointercancel', up);
  });
  // keyboard: arrows move the focused tile, Shift+arrows resize it
  grid.addEventListener('keydown', (e) => {
    const head = e.target.closest('.whead'); if (!editing || !head || !e.key.startsWith('Arrow')) return;
    const t = getTiles().find((x) => x.id === head.closest('.widget').dataset.id), ty = TYPES[t.type]; e.preventDefault();
    const dx = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0, dy = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (e.shiftKey) { t.w = Math.min(GRID.cols - t.x, Math.max(ty.minW, t.w + dx)); t.h = Math.max(ty.minH, t.h + dy); }
    else { t.x = Math.min(GRID.cols - t.w, Math.max(0, t.x + dx)); t.y = Math.max(0, t.y + dy); }
    settle(getTiles(), t.id); place(); saveTiles(); head.focus();
  });

  // ----- add / edit a tile -----
  // ----- tile editor (1.35): live preview on the left, grouped options on the right; the same panel options for every tile type -----
  const getP = (o, path) => path.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  const setP = (o, path, v) => { const ks = path.split('.'); let x = o; for (let i = 0; i < ks.length - 1; i++) x = (x[ks[i]] ||= {}); const k = ks[ks.length - 1]; if (v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))) delete x[k]; else x[k] = v; };
  const prune = (o) => { for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === 'object' && !Array.isArray(v)) { prune(v); if (!Object.keys(v).length) delete o[k]; } } };
  function optKit(t) {
    const val = (path) => getP(t, path);
    const fld = (label, html, hint) => `<div class="field"><label>${label}</label><div>${html}${hint ? `<div class="hint">${hint}</div>` : ''}</div></div>`;
    return {
      fld,
      num: (label, path, o = {}) => fld(label, `<input type="number" class="w-sm" data-p="${path}" ${o.min !== undefined ? `min="${o.min}"` : ''} ${o.max !== undefined ? `max="${o.max}"` : ''} ${o.step ? `step="${o.step}"` : ''} value="${val(path) ?? ''}" placeholder="${o.ph ?? ''}">${o.unit ? ` <span class="muted">${o.unit}</span>` : ''}`, o.hint),
      txt: (label, path, o = {}) => fld(label, `<input type="text" data-p="${path}" maxlength="${o.max || 60}" value="${esc(val(path) ?? '')}" placeholder="${esc(o.ph || '')}" ${o.w ? `class="${o.w}"` : ''}>`, o.hint),
      sel: (label, path, opts, o = {}) => fld(label, `<select data-p="${path}">${opts.map(([v, l]) => `<option value="${v}" ${String(val(path) ?? o.def ?? '') === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`, o.hint),
      chk: (label, path, def = false) => fld('', `<label class="chk"><input type="checkbox" data-p="${path}" ${(val(path) ?? def) ? 'checked' : ''}> ${label}</label>`),
      col: (label, path, def = '#3b82f6', o = {}) => fld(label, `<span class="colw ${val(path) ? '' : 'unset'}"><input type="color" data-p="${path}" value="${val(path) || def}"><button type="button" class="x" data-clr="${path}" title="Back to the default colour">×</button></span>`, o.hint)
    };
  }
  function tileDialog(existing, type, ds0) {
    const dflt = { kpi: { metric: 'errors' }, gauge: { metric: 'errors' }, top: { by: 'host', n: 8 }, pie: { by: 'severity', n: 6, style: 'donut' }, line: { mode: 'severity' }, heat: { mode: 'hostTime', n: 10 }, latest: { n: 8 }, alarm: { card: 'open' }, statspark: {}, trend: {}, sevbars: {}, bar: { by: 'host', n: 8 }, treemap: { by: 'host', n: 10 }, table: { by: 'host', n: 10 }, bargauge: { by: 'host', n: 8 } };
    const t = existing ? structuredClone(existing) : { id: 'u' + Date.now().toString(36), type, title: '', x: 0, y: 0, w: TYPES[type].w, h: TYPES[type].h, cfg: structuredClone(dflt[type] || {}) };
    const c = t.cfg ||= {}; let fl, ty, hasVal, hasTh, hasChart, hasPal, isRank;
    const setFlags = () => { fl = FILTER_TYPES.includes(t.type); ty = TYPES[t.type]; hasVal = ['kpi', 'statspark', 'gauge', 'alarm'].includes(t.type); hasTh = hasVal || ['bargauge', 'bar', 'treemap', 'table'].includes(t.type); hasChart = ['line', 'trend'].includes(t.type); hasPal = ['pie', 'bar', 'treemap', 'table', 'bargauge'].includes(t.type); isRank = !!TOPLIKE[t.type] || t.type === 'top' || t.type === 'pie'; };
    setFlags();
    if (c.bg && !c.look?.bgMode) c.look = { ...(c.look || {}), bgMode: 'solid', bg: c.bg }; delete c.bg;                       // an old custom background becomes a panel option
    if (!c.th?.steps?.length && (c.warn > 0 || c.crit > 0)) { c.th = { ...(c.th || {}), mode: c.th?.mode || 'value', steps: [{ v: 0, c: '#30a46c' }, ...(c.warn > 0 ? [{ v: c.warn, c: '#f5a524' }] : []), ...(c.crit > 0 ? [{ v: c.crit, c: '#e5484d' }] : [])] }; } delete c.warn; delete c.crit;
    const K = optKit(t);
    const DEF_METRIC = { events: 'errors', alarms: 'alActive', devices: 'dvAll', system: 'eps' };
    /** choose the data a tile reads: fixes the metric, the ranking and the filters so they always belong to that data */
    const setDs = (ds) => {
      const k = DS[ds].kind; c.ds = ds; c.filter = { ...(c.filter || {}) };
      if (k === 'events') c.filter.source = DS[ds].src; else delete c.filter.source;
      if (k !== 'alarms') { delete c.filter.astate; delete c.filter.rule; } if (k !== 'devices') { delete c.filter.dstate; delete c.filter.vendor; delete c.filter.group; }
      if (k === 'devices' || k === 'system') { delete c.filter.sevs; delete c.filter.severityMax; delete c.filter.text; delete c.filter.app; delete c.filter.tag; }
      if (t.type === 'kpi' || t.type === 'gauge') { if (METRICS[c.metric]?.k !== k) c.metric = DEF_METRIC[k]; } else delete c.metric;
      if (c.by !== undefined || isRank) { if (!(BYS[k] || []).some((x) => x[0] === c.by)) c.by = defBy(t); }
      if (c.calc?.bm && !METRICS[c.calc.bm]) delete c.calc;
      if (!Object.keys(c.filter).length) delete c.filter;
    };
    const setType = (nt) => {
      t.type = nt; setFlags(); const k = dsKind(t);
      if (!VIS_DS[nt].includes(k)) setDs('syslog'); else setDs(dsOf(t));
      const d0 = dflt[nt] || {}; for (const [kk, vv] of Object.entries(d0)) if (c[kk] === undefined && kk !== 'metric' && kk !== 'card') c[kk] = vv;
      if ((nt === 'kpi' || nt === 'gauge') && !METRICS[c.metric]) c.metric = DEF_METRIC[dsKind(t)];
      if (nt !== 'kpi' && nt !== 'gauge') { delete c.calc; } if (!['line', 'trend'].includes(nt)) delete c.sc;
      if (!existing) { t.w = TYPES[nt].w; t.h = TYPES[nt].h; }
      const h3 = $('h3', back), pp = $('p.muted', back); if (h3) h3.textContent = existing ? 'Edit tile' : 'Add: ' + TYPES[nt].label; if (pp) pp.textContent = TYPES[nt].desc; q('pvW').dataset.type = nt;
    };
    if (ds0 && DS[ds0]) { c.ds = ds0; }
    const back = document.createElement('div'); back.className = 'modal-back';
    back.innerHTML = `<form class="modal pe" role="dialog" aria-modal="true" aria-label="${existing ? 'Edit tile' : 'Add tile'}"><h3 style="margin:0 0 2px">${existing ? 'Edit tile' : 'Add: ' + esc(ty.label)}</h3><p class="muted" style="margin:0 0 10px">${esc(ty.desc)}</p>
      <div class="pe-body"><div class="pe-prev"><div class="pe-stage" id="peStage"><section class="widget panel pvw" id="pvW" data-type="${t.type}"><div class="whead"><h2 class="wtitle"></h2></div><div class="wb" id="wb_pv"></div></section></div><div class="muted pe-note">Live preview. It shows the numbers of the chosen time range.</div></div>
      <div class="pe-opts" id="peOpts"></div></div>
      <div class="toolbar" style="margin:12px 0 0"><span class="spacer"></span><button type="button" id="mCancel">Cancel</button><button type="submit" class="primary">${existing ? 'Save' : 'Add tile'}</button></div></form>`;
    document.body.appendChild(back); const form = $('form', back), q = (id) => $('#' + id, back), close = () => { window.removeEventListener('resize', changed); back.remove(); };
    if (ds0 && DS[ds0] && !existing) setDs(ds0);
    let sevs = fl ? normFilter({ sevs: c.filter?.sevs, severityMax: c.filter?.severityMax }).sevs : '';
    const metricOpts = () => { const kd = dsKind(t), o = (k, m) => `<option value="${k}" ${c.metric === k ? 'selected' : ''}>${m.label}</option>`, all = Object.entries(METRICS).filter(([, m]) => m.k === kd); const now = all.filter(([, m]) => !m.ranged), rg = all.filter(([, m]) => m.ranged);
      return (rg.length ? `<optgroup label="Over the chosen time range">${rg.map(([k, m]) => o(k, m)).join('')}</optgroup>` : '') + (now.length ? `<optgroup label="${kd === 'system' ? 'Live counters' : 'Right now'}">${now.map(([k, m]) => o(k, m)).join('')}</optgroup>` : ''); };
    const calcMetricOpts = () => ['events', 'alarms', 'devices'].map((kd) => `<optgroup label="${esc(kd === 'events' ? 'Syslog / trap messages' : DS[kd].label)}">${Object.entries(METRICS).filter(([, m]) => m.srv && m.k === kd).map(([k, m]) => `<option value="${k}" ${c.calc?.bm === k ? 'selected' : ''}>${m.label}</option>`).join('')}</optgroup>`).join('');
    const G = (title, body, open = false) => `<details class="og" ${open ? 'open' : ''}><summary>${title}</summary><div class="form">${body}</div></details>`;
    const stepsHtml = () => { const st = c.th?.steps || []; return `<div class="steps" id="thEd">${st.map((x, i) => `<div class="step"><span class="muted">from</span><input type="number" data-si="${i}" data-sf="v" value="${x.v}" class="w-sm" aria-label="Step ${i + 1} starts at"><input type="color" data-si="${i}" data-sf="c" value="${x.c}" aria-label="Step ${i + 1} colour"><button type="button" data-sdel="${i}" class="x" aria-label="Remove step">×</button></div>`).join('') || '<div class="muted">No colour steps yet.</div>'}<div class="toolbar" style="margin:6px 0 0"><button type="button" id="thAdd">Add step</button><select id="thPre"><option value="">Use a ready-made set…</option>${STEP_PRESETS.map(([n], i) => `<option value="${i}">${n}</option>`).join('')}</select></div></div>`; };
    const groups = () => {
      const kd = dsKind(t), dsOptG = ['events', 'alarms', 'devices', 'system'].map((k2) => { const l = Object.entries(DS).filter(([, v]) => v.kind === k2 && VIS_DS[t.type]?.includes(k2)); return l.length ? `<optgroup label="${{ events: 'Received messages', alarms: 'Alarm list', devices: 'Device list', system: 'The application itself' }[k2]}">${l.map(([k, v]) => `<option value="${k}" ${dsOf(t) === k ? 'selected' : ''}>${v.label}</option>`).join('')}</optgroup>` : ''; }).join('');
      const visOpts = Object.entries(TYPES).filter(([k]) => VIS_DS[k]?.includes(kd)).map(([k, v]) => `<option value="${k}" ${t.type === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
      const data = VIS_DS[t.type] ? `${K.fld('Visual', `<select id="peVis">${visOpts}</select>`, 'Switch to another visual for the same data. Your colours and looks are kept.')}${K.fld('Data', `<select id="peDs">${dsOptG}</select>`, esc(DS[dsOf(t)].desc))}` : '';
      const gen = `${K.txt('Title', 'title', { ph: ty.label })}
        ${t.type === 'kpi' || t.type === 'gauge' ? K.fld('Show', `<select data-p="cfg.metric">${metricOpts()}</select>`) : ''}
        ${isRank ? K.sel('Rank by', 'cfg.by', BYS[kd] || BYS.events, { def: defBy(t) }) : ''}
        ${t.type === 'bar' ? K.sel('Direction', 'cfg.orient', [['h', 'Horizontal bars'], ['v', 'Vertical columns']], { def: 'h' }) : ''}
        ${t.type === 'pie' ? K.sel('Shape', 'cfg.style', [['donut', 'Donut'], ['pie', 'Pie']], { def: 'donut' }) : ''}
        ${t.type === 'line' ? K.sel('Lines', 'cfg.mode', [['severity', 'One line per severity group'], ['total', 'All ' + DS[dsOf(t)].chip.toLowerCase() + ' (one line)']], { def: 'severity' }) : ''}
        ${t.type === 'heat' ? K.sel('Cell shape', 'cfg.shape', [['square', 'Square'], ['round', 'Rounded square'], ['circle', 'Circle'], ['hex', 'Hexagon'], ['hexo', 'Hexagon outline']], { def: 'square' }) + K.sel('Colours', 'cfg.theme', [['blue', 'Blue (accent colour)'], ['traffic', 'Traffic light (green, amber, red)'], ['heat', 'Heat (yellow to dark red)'], ['cool', 'Cool (teal, blue, purple)'], ['mono', 'Greys']], { def: 'blue' }) : ''}
        ${t.type === 'heat' ? K.sel('Shows', 'cfg.mode', [['hostTime', 'Busiest devices over time'], ['dowHour', 'Weekday against hour of day']], { def: 'hostTime' }) : ''}
        ${['top', 'latest', 'pie', 'heat', 'bar', 'treemap', 'table', 'bargauge'].includes(t.type) ? K.num(t.type === 'pie' ? 'Slices' : 'Rows', 'cfg.n', { min: 1, max: t.type === 'pie' ? 12 : t.type === 'heat' ? 20 : TOPLIKE[t.type] || 50, ph: '8' }) : ''}
        ${t.type === 'text' ? K.fld('Text', `<textarea data-p="cfg.text" rows="6" style="width:100%" maxlength="2000" placeholder="# Heading&#10;Plain text, **bold**, - bullets and [links](https://example.com)">${esc(c.text || '')}</textarea>`) : ''}
        ${t.type === 'gauge' ? K.num('Dial maximum', 'cfg.max', { min: 0, ph: 'auto' }) : ''}
        ${K.num('Width', 'w', { min: ty.minW, max: 12, unit: 'of 12 columns' })}${K.num('Height', 'h', { min: ty.minH, max: 40, unit: 'rows' })}`;
      const metricFixed = (t.type === 'kpi' || t.type === 'gauge') && METRICS[c.metric]?.srv && kd !== 'events';
      const flt = !fl ? '' : kd === 'events' ? `<div id="mFilter"><p class="muted" style="margin:0 0 6px">Only count messages that match (leave empty for all):</p>
        <div class="field"><label>Severity</label><div><button type="button" id="mSevBtn"></button></div></div>
        ${K.txt('Device', 'cfg.filter.host', { ph: 'name or IP, separate several with commas', max: 200 })}${K.txt('Process', 'cfg.filter.app', { max: 100 })}
        ${K.txt('Text', 'cfg.filter.text', { ph: 'words, "exact phrase", -excluded, tag:link-down', max: 200, hint: 'Same search words as the Logs page.' })}${K.txt('Tag', 'cfg.filter.tag', { ph: 'for example link-down or cisco', max: 100 })}</div>`
        : kd === 'alarms' ? `<div id="mFilter"><p class="muted" style="margin:0 0 6px">Only use alarms that match (leave empty for all):</p>
        ${metricFixed ? '' : K.sel('Which alarms', 'cfg.filter.astate', A_STATES, { def: 'raised' })}
        <div class="field"><label>Severity</label><div><button type="button" id="mSevBtn"></button></div></div>
        ${K.txt('Device', 'cfg.filter.host', { ph: 'name or IP', max: 200 })}${K.txt('Alarm rule', 'cfg.filter.rule', { ph: 'part of the rule name', max: 100 })}${K.txt('Text', 'cfg.filter.text', { ph: 'words in the alarm message', max: 200 })}</div>`
        : kd === 'devices' ? `<div id="mFilter"><p class="muted" style="margin:0 0 6px">Only use devices that match (leave empty for all):</p>
        ${metricFixed ? '' : K.sel('Which devices', 'cfg.filter.dstate', D_STATES, { def: 'all' })}${K.txt('Vendor', 'cfg.filter.vendor', { ph: 'for example Cisco', max: 60 })}${K.txt('Group', 'cfg.filter.group', { max: 60 })}</div>` : '';
      const calcs = (t.type === 'kpi' || t.type === 'gauge') ? (() => {
        const srv = !!METRICS[c.metric]?.srv, ops = srv ? [['none', 'No calculation'], ['pct', 'Percent of another number (A ÷ B × 100)'], ['ratio', 'Ratio to another number (A ÷ B)'], ['diff', 'Difference to another number (A − B)'], ['sum', 'Sum with another number (A + B)'], ['perMin', 'Average per minute'], ['perHour', 'Average per hour'], ['perDay', 'Average per day'], ['delta', 'Change since the period before'], ['deltaPct', '% change since the period before']] : [['none', 'No calculation']], op = c.calc?.op || 'none';
        return `<p class="muted" style="margin:0 0 6px">A is the number chosen under "Show". Calculations are done on the live numbers each refresh.</p>${K.sel('Calculation', 'cfg.calc.op', ops, { def: 'none' })}
          ${['pct', 'ratio', 'diff', 'sum'].includes(op) ? K.fld('B is', `<select data-p="cfg.calc.bm">${calcMetricOpts()}</select>`) : ''}
          ${K.num('Multiply by', 'cfg.calc.mul', { step: 'any', ph: '1' })}${K.num('Then add', 'cfg.calc.add', { step: 'any', ph: '0' })}${op === 'delta' || op === 'deltaPct' ? '<p class="muted">Only for numbers counted over the time range (messages, alarms raised or cleared).</p>' : ''}`;
      })() : t.type === 'line' || t.type === 'trend' ? `<p class="muted" style="margin:0 0 6px">Change how the series is drawn. The trend chart then draws lines.</p>${K.sel('Calculation', 'cfg.sc.op', [['none', 'None (counts per time step)'], ['cum', 'Running total'], ['ma', 'Moving average'], ['diff', 'Rise since the step before (never negative)'], ['rate', 'Per minute']], { def: 'none' })}${c.sc?.op === 'ma' ? K.num('Average over', 'cfg.sc.n', { min: 2, max: 30, unit: 'steps', ph: '5' }) : ''}` : '';
      const val = hasVal || t.type === 'bargauge' || t.type === 'table' ? `${hasVal ? `${K.sel('Size', 'cfg.val.size', [['auto', 'Automatic (follows the tile)'], ['s', 'Small'], ['m', 'Medium'], ['l', 'Large'], ['xl', 'Extra large']], { def: 'auto' })}${K.sel('Alignment', 'cfg.val.align', [['', 'Default'], ['left', 'Left'], ['center', 'Centre'], ['right', 'Right']])}${K.num('Decimals', 'cfg.val.dec', { min: 0, max: 4, ph: 'auto' })}${K.chk('Short form (1.2k, 3.4M)', 'cfg.val.compact')}${K.chk('Show the small text under the number', 'cfg.val.sub', true)}` : ''}
        ${K.txt('Unit before', 'cfg.val.prefix', { max: 12, w: 'w-sm', ph: '' })}${K.txt('Unit after', 'cfg.val.suffix', { max: 12, w: 'w-sm', ph: 'for example ms or %' })}
        ${t.type === 'kpi' ? K.sel('Trend line', 'cfg.graph', [['none', 'None'], ['area', 'Filled area behind the number'], ['line', 'Line behind the number']], { def: 'none' }) : t.type === 'statspark' ? K.sel('Trend line', 'cfg.graph', [['area', 'Filled area'], ['line', 'Line']], { def: 'area' }) : ''}
        ${t.type === 'gauge' ? K.sel('Gauge style', 'cfg.gstyle', [['arc', 'Half dial'], ['ring', 'Full ring'], ['lcd', 'Segmented bar (LCD)'], ['bar', 'Flat bar']], { def: 'arc' }) : ''}
        ${t.type === 'bargauge' ? K.sel('Bar style', 'cfg.bstyle', [['gradient', 'Gradient'], ['lcd', 'Segmented (LCD)'], ['solid', 'Solid']], { def: 'gradient' }) : ''}` : '';
      const thr = hasTh ? `${K.sel('Colour by steps', 'cfg.th.mode', [['none', 'Off'], ['value', t.type === 'gauge' ? 'Colour the dial' : hasVal ? 'Colour the number' : 'Colour the bars / cells'], ['bg', 'Fill the whole tile'], ['grad', 'Fill the tile with a gradient']], { def: thSteps(c) ? 'value' : 'none' })}<p class="muted" style="margin:2px 0 6px">The colour of the highest step the value reaches is used. The first step is the base colour.</p>${stepsHtml()}` : '';
      const chart = hasChart ? `${t.type === 'trend' ? K.sel('Draw as', 'cfg.ch.bars', [['bars', 'Stacked bars'], ['area', 'Stacked areas'], ['line', 'Lines']], { def: 'bars' }) : ''}
        ${K.num('Line width', 'cfg.ch.lw', { min: 0.5, max: 6, step: 0.5, ph: '1.8' })}${K.num('Fill under line', 'cfg.ch.fillA', { min: 0, max: 100, unit: '%', ph: t.type === 'line' ? '0' : '60' })}${K.chk('Gradient fill', 'cfg.ch.grad', true)}${K.chk('Smooth lines', 'cfg.ch.smooth')}${K.chk('Show points', 'cfg.ch.pts')}${t.type === 'line' ? K.chk('Stack the lines', 'cfg.ch.stack') : ''}
        ${K.chk('Show grid lines', 'cfg.ch.grid', true)}${K.chk('Show axis numbers and times', 'cfg.ch.axis', true)}${K.sel('Legend', 'cfg.ch.legend', [['bottom', 'Below'], ['right', 'At the right'], ['hide', 'Hidden']], { def: 'bottom' })}` : '';
      const pal = hasPal ? K.sel('Colours', 'cfg.pal', PAL_NAMES.map(([v, l]) => [v, l]), { def: 'theme' }) : '';
      const look = `<div class="presets">${LOOK_PRESETS.map(([n, l], i) => `<button type="button" data-preset="${i}" class="pre" style="${l?.bgMode === 'gradient' ? `background:linear-gradient(135deg,${l.bg},${l.bg2});color:#fff` : l?.bg ? `background:${l.bg};color:${l.tc || 'inherit'}` : ''}">${esc(n)}</button>`).join('')}</div>
        ${K.sel('Background', 'cfg.look.bgMode', [['', 'Theme default'], ['none', 'Transparent'], ['solid', 'Solid colour'], ['gradient', 'Gradient']])}${K.col('Colour', 'cfg.look.bg', '#1f2937')}${K.col('Second colour', 'cfg.look.bg2', '#3b82f6')}${K.num('Gradient angle', 'cfg.look.angle', { min: 0, max: 360, unit: '°', ph: '135' })}${K.num('Opacity', 'cfg.look.bgAlpha', { min: 0, max: 100, unit: '%', ph: '100' })}
        ${K.num('Border width', 'cfg.look.bw', { min: 0, max: 8, unit: 'px' })}${K.col('Border colour', 'cfg.look.bc', '#475569')}${K.col('Accent edge (top)', 'cfg.color', '#3b82f6', { hint: 'a 3 px coloured line on the top of the tile' })}${K.num('Corner radius', 'cfg.look.radius', { min: 0, max: 32, unit: 'px', ph: 'theme' })}
        ${K.sel('Shadow', 'cfg.look.shadow', [['', 'Theme default'], ['none', 'None'], ['soft', 'Soft'], ['strong', 'Strong'], ['glow', 'Glow (border colour)']])}${K.chk('Show the data label (Syslog / SNMP traps / Alarms / Devices)', 'cfg.look.tSrc', true)}${K.num('Inner space', 'cfg.look.pad', { min: 0, max: 32, unit: 'px', ph: '12' })}${K.col('Text colour', 'cfg.look.tc', '#e5e7eb', { hint: 'for everything inside the tile' })}`;
      const ttl = `${K.chk('Show the title', 'cfg.look.tShow', true)}${K.sel('Alignment', 'cfg.look.tAlign', [['', 'Left'], ['center', 'Centre'], ['right', 'Right']])}${K.num('Size', 'cfg.look.tSize', { min: 10, max: 28, unit: 'px', ph: '13' })}${K.col('Colour', 'cfg.look.tColor', '#e5e7eb')}${K.chk('Capital letters', 'cfg.look.tUpper')}
        ${K.sel('Title bar', 'cfg.look.tBar', [['', 'None'], ['solid', 'Solid colour'], ['gradient', 'Gradient']])}${K.col('Bar colour', 'cfg.look.tBarC', '#4338ca')}${K.col('Bar second colour', 'cfg.look.tBarC2', '#1e1b4b')}`;
      return (data ? G('Data', data, true) : '') + G('General', gen + flt, true) + (calcs ? G('Calculations', calcs, false) : '') + (val ? G(hasVal ? 'Value' : 'Numbers', val, hasVal) : '') + (thr ? G('Colour steps (thresholds)', thr, hasVal) : '') + (chart ? G('Chart', chart, true) : '') + (pal ? G('Chart colours', pal) : '') + G('Tile look', look, false) + G('Title', ttl);
    };
    // ----- preview -----
    let pvData = null, pvKey = '', pvFetching = false, pvTimer;
    const pvTile = () => { const x = structuredClone(t); x.id = 'pv'; return x; };
    function pvPaint() {
      const node = q('pvW'); if (!node) return; const tt = pvTile(), k = lookOf(tt), ob = $('.whead', node);
      node.className = `widget panel pvw ${k.cls}`; node.style.cssText = k.style; node.classList.remove('tinted'); ob.className = `whead ${k.hideTitle ? 'nohead' : ''}`; ob.style.cssText = k.head;
      ob.innerHTML = k.hideTitle ? '' : `<h2 class="wtitle" style="${k.title}">${esc(tt.title || TYPES[tt.type].label)}</h2>`;
      const stage = q('peStage'), W = Math.min(stage.clientWidth || 460, Math.max(160, t.w * 84)), H = Math.max(110, Math.min(360, t.h * (GRID.row + GRID.gap) - GRID.gap)); node.style.width = W + 'px'; node.style.height = H + 'px';
      const saved = data; if (pvData) data = { ...pvData, tiles: pvData.tiles }; cache.delete('pv');
      try { paintTile(tt); } finally { data = saved; }
    }
    async function pvFetch() {
      const tt = pvTile(), reqs = requestsFor([tt]), key = JSON.stringify(reqs); if (key === pvKey) return; pvKey = key;
      if (!reqs.length) { pvData = null; return pvPaint(); } const r = range();
      try { pvData = await api('/api/dash', { method: 'POST', body: { from: r.from, to: r.to, tiles: reqs } }); } catch { pvData = null; } pvPaint();
    }
    const changed = () => { cancelAnimationFrame(pvTimer); pvTimer = requestAnimationFrame(() => { pvPaint(); pvFetch(); }); };
    const bindSev = () => { if (!fl) return; const sb = q('mSevBtn'); if (!sb) return; sb.textContent = sevLabel(sevs) + ' ▾'; sb.onclick = () => sevPopover(sb, sevs, (v) => { sevs = v; sb.textContent = sevLabel(v) + ' ▾'; if (sevSetOf(v).length && sevSetOf(v).length < 10) setP(t, 'cfg.filter.sevs', v); else setP(t, 'cfg.filter.sevs', undefined); setP(t, 'cfg.filter.severityMax', undefined); changed(); /* 1.50: the old 'errors and worse' limit (severityMax) must go too, or ticking all severities still showed only errors */ }); };
    const renderOpts = () => { const open = new Set($$('details.og[open] > summary', back).map((s2) => s2.textContent)); q('peOpts').innerHTML = groups(); for (const d of $$('details.og', back)) d.open = open.size ? open.has($('summary', d).textContent) : d.open; bindSev(); };
    renderOpts(); $('input[type=text],input[type=number]', back)?.focus();
    const onField = (e) => {
      const el2 = e.target, pth = el2.dataset?.p;
      if (el2.id === 'peDs') { setDs(el2.value); renderOpts(); return changed(); }
      if (el2.id === 'peVis') { setType(el2.value); renderOpts(); return changed(); }
      if (pth === 'cfg.calc.op' || pth === 'cfg.sc.op') { const key = pth === 'cfg.calc.op' ? 'calc' : 'sc'; setP(t, pth, el2.value); if (el2.value === 'none') { delete c[key].op; if (!Object.keys(c[key]).length) delete c[key]; } else if (key === 'calc' && ['pct', 'ratio', 'diff', 'sum'].includes(el2.value) && !c.calc.bm) c.calc.bm = 'total'; renderOpts(); return changed(); }
      if (pth) { let v; if (el2.type === 'checkbox') v = el2.checked; else if (el2.type === 'number') v = el2.value === '' ? undefined : +el2.value; else v = el2.value; setP(t, pth, v); if (el2.type === 'color') el2.closest('.colw')?.classList.remove('unset'); if (pth === 'cfg.card' && (!t.title || Object.values(AL_CARDS).includes(t.title))) { t.title = AL_CARDS[v]; const ti = $('[data-p=title]', back); if (ti) ti.value = t.title; } return changed(); }
      if (el2.dataset?.si !== undefined) { const st = c.th.steps[+el2.dataset.si]; if (el2.dataset.sf === 'v') st.v = +el2.value || 0; else st.c = el2.value; return changed(); }
      if (el2.id === 'thPre' && el2.value !== '') { c.th = { ...(c.th || {}), mode: c.th?.mode && c.th.mode !== 'none' ? c.th.mode : 'value', steps: structuredClone(STEP_PRESETS[+el2.value][1]) }; renderOpts(); changed(); }
    };
    back.addEventListener('input', onField); back.addEventListener('change', onField);
    back.addEventListener('click', (e) => {
      const clr = e.target.closest('[data-clr]'); if (clr) { setP(t, clr.dataset.clr, undefined); const i2 = $(`[data-p="${clr.dataset.clr}"]`, back); if (i2) { i2.closest('.colw')?.classList.add('unset'); } renderOpts(); return changed(); }
      const pr = e.target.closest('[data-preset]'); if (pr) { const l = LOOK_PRESETS[+pr.dataset.preset][1]; if (l) c.look = structuredClone(l); else delete c.look; delete c.color; renderOpts(); return changed(); }
      if (e.target.id === 'thAdd') { c.th ||= {}; c.th.steps ||= []; const last = c.th.steps.at(-1); c.th.steps.push({ v: last ? last.v + 50 : 0, c: '#f5a524' }); if (!c.th.mode || c.th.mode === 'none') c.th.mode = 'value'; renderOpts(); return changed(); }
      const del = e.target.closest('[data-sdel]'); if (del) { c.th.steps.splice(+del.dataset.sdel, 1); if (!c.th.steps.length) delete c.th.steps; renderOpts(); return changed(); }
    });
    $('#mCancel', back).onclick = close; back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    window.addEventListener('resize', changed);
    setTimeout(() => { pvPaint(); pvFetch(); }, 30);
    form.onsubmit = (e) => {
      e.preventDefault(); window.removeEventListener('resize', changed);
      t.title = (t.title || '').trim(); if (c.filter?.source === 'syslog') delete c.filter.source; if (c.th && !c.th.steps?.length) delete c.th; if (c.th?.mode === 'none' && !c.th.steps) delete c.th;
      if (c.val?.size === 'auto') delete c.val.size; if (c.graph === 'none') delete c.graph; if (c.pal === 'theme') delete c.pal; if (c.look?.bgMode === '') delete c.look.bgMode; if (c.look?.tBar === '') delete c.look.tBar;
      if (t.type === 'pie' && c.n) c.n = Math.min(12, Math.max(1, c.n)); prune(c);
      if (!t.title) t.title = (t.type === 'kpi' || t.type === 'gauge') ? (METRICS[c.metric || 'total'].label.replace(/ in the time range| since the service started/i, '')) : t.type === 'alarm' ? AL_CARDS[c.card || 'open'] : TYPES[t.type].label;
      t.w = Math.min(12, Math.max(ty.minW, Math.round(+t.w) || ty.w)); t.h = Math.min(40, Math.max(ty.minH, Math.round(+t.h) || ty.h));
      const list = getTiles();
      if (existing) list[list.findIndex((x) => x.id === existing.id)] = t; else { t.y = Math.max(0, ...list.map((x) => x.y + x.h)); list.push(t); }
      if (t.x + t.w > 12) t.x = 12 - t.w;
      settle(list, t.id); saveTiles(); close(); frames(); load();
    };
  }
  function secDialog(t) {
    const c = t.cfg ||= {}; const K = optKit(t), back = document.createElement('div'); back.className = 'modal-back';
    back.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-label="Edit section"><h3 style="margin:0 0 10px">Edit section</h3><div class="form">
      ${K.txt('Name', 'title')}${K.col('Line colour', 'cfg.color', '#3b82f6')}
      ${K.sel('Band', 'cfg.look.bgMode', [['', 'None (line only)'], ['solid', 'Solid colour'], ['gradient', 'Gradient']])}${K.col('Band colour', 'cfg.look.bg', '#4338ca')}${K.col('Band second colour', 'cfg.look.bg2', '#1e1b4b')}${K.num('Gradient angle', 'cfg.look.angle', { min: 0, max: 360, unit: '°', ph: '90' })}
      ${K.col('Text colour', 'cfg.look.tColor', '#ffffff')}${K.num('Text size', 'cfg.look.tSize', { min: 10, max: 28, unit: 'px', ph: '15' })}${K.sel('Alignment', 'cfg.look.tAlign', [['', 'Left'], ['center', 'Centre'], ['right', 'Right']])}${K.chk('Capital letters', 'cfg.look.tUpper')}
      ${K.num('Corner radius', 'cfg.look.radius', { min: 0, max: 32, unit: 'px' })}</div>
      <div class="toolbar" style="margin:14px 0 0"><span class="spacer"></span><button type="button" id="mCancel">Cancel</button><button type="submit" class="primary">Save</button></div></form>`;
    document.body.appendChild(back); const close = () => back.remove();
    const on = (e) => { const el2 = e.target, pth = el2.dataset?.p; if (!pth) return; setP(t, pth, el2.type === 'checkbox' ? el2.checked : el2.type === 'number' ? (el2.value === '' ? undefined : +el2.value) : el2.value); };
    back.addEventListener('input', on); back.addEventListener('change', on);
    back.addEventListener('click', (e) => { const clr = e.target.closest('[data-clr]'); if (clr) { setP(t, clr.dataset.clr, undefined); clr.closest('.colw').classList.add('unset'); } });
    $('#mCancel', back).onclick = close; back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    $('form', back).onsubmit = (e) => { e.preventDefault(); t.title = (t.title || '').trim() || (t.id === 'sec_snmp' ? 'SNMP traps' : 'Syslog'); if (c.look?.bgMode === '') delete c.look.bgMode; prune(c); const list = getTiles(); const i = list.findIndex((x) => x.id === t.id); list[i] = t; saveTiles(); close(); frames(); load(); };
  }
  // ----- 1.36 add a tile: 1. pick a visual (with a picture, like Power BI)  2. pick the data  3. customize -----
  const THUMB = (() => {
    const A = 'var(--accent)', M = 'currentColor', bars = (xs, w = 10, base = 60) => xs.map((h, i) => `<rect x="${14 + i * (w + 5)}" y="${base - h}" width="${w}" height="${h}" rx="1.5" fill="${A}" opacity="${0.55 + (i % 3) * 0.2}"/>`).join('');
    const line = (pts, c = A, fill) => `${fill ? `<polygon points="${pts} 108,62 12,62" fill="${c}" opacity=".22"/>` : ''}<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/>`;
    const rows = (n, w = [80, 62, 50, 38, 26]) => Array.from({ length: n }, (_, i) => `<rect x="12" y="${12 + i * 11}" width="${w[i % 5]}" height="6" rx="3" fill="${A}" opacity="${1 - i * 0.14}"/>`).join('');
    const sv = (inner) => `<svg viewBox="0 0 120 72" aria-hidden="true">${inner}</svg>`;
    return {
      kpi: sv(`<text x="60" y="44" text-anchor="middle" font-size="30" font-weight="700" fill="${A}">128</text><rect x="38" y="52" width="44" height="4" rx="2" fill="${M}" opacity=".3"/>`),
      statspark: sv(`<text x="14" y="30" font-size="22" font-weight="700" fill="${A}">42</text>${line('12,62 30,52 48,56 66,40 84,46 108,26', A, true)}`),
      gauge: sv(`<path d="M22 56 A38 38 0 0 1 98 56" fill="none" stroke="${M}" opacity=".18" stroke-width="10"/><path d="M22 56 A38 38 0 0 1 72 21" fill="none" stroke="${A}" stroke-width="10"/><text x="60" y="56" text-anchor="middle" font-size="14" font-weight="700" fill="${M}">64</text>`),
      bargauge: sv([0, 1, 2, 3].map((i) => `<rect x="12" y="${12 + i * 14}" width="96" height="8" rx="4" fill="${M}" opacity=".15"/><rect x="12" y="${12 + i * 14}" width="${[84, 62, 44, 24][i]}" height="8" rx="4" fill="${['#e5484d', '#f5a524', '#30a46c', '#30a46c'][i]}"/>`).join('')),
      trend: sv(bars([18, 26, 20, 34, 28, 40, 24, 30], 8)),
      line: sv(line('12,56 30,40 48,46 66,24 84,34 108,14') + line('12,60 30,54 48,58 66,46 84,50 108,40', '#b07cf2')),
      sevbars: sv(rows(5, [88, 70, 56, 34, 20])),
      top: sv(rows(5)),
      bar: sv(bars([40, 52, 30, 22, 44], 12, 62)),
      pie: sv(`<circle cx="60" cy="36" r="24" fill="none" stroke="${A}" stroke-width="14" stroke-dasharray="60 100" transform="rotate(-90 60 36)"/><circle cx="60" cy="36" r="24" fill="none" stroke="#f5a524" stroke-width="14" stroke-dasharray="38 120" stroke-dashoffset="-60" transform="rotate(-90 60 36)"/><circle cx="60" cy="36" r="24" fill="none" stroke="#30a46c" stroke-width="14" stroke-dasharray="52 120" stroke-dashoffset="-98" transform="rotate(-90 60 36)"/>`),
      treemap: sv(`<rect x="10" y="8" width="56" height="56" rx="2" fill="${A}"/><rect x="68" y="8" width="42" height="30" rx="2" fill="#b07cf2"/><rect x="68" y="40" width="20" height="24" rx="2" fill="#f5a524"/><rect x="90" y="40" width="20" height="24" rx="2" fill="#30a46c"/>`),
      heat: sv(Array.from({ length: 4 }, (_, r) => Array.from({ length: 8 }, (_, c) => `<rect x="${12 + c * 12}" y="${10 + r * 14}" width="10" height="12" rx="2" fill="${A}" opacity="${((r * 5 + c * 3) % 7) / 8 + 0.1}"/>`).join('')).join('')),
      table: sv(`<rect x="10" y="10" width="100" height="9" fill="${A}" opacity=".5"/>` + [0, 1, 2, 3].map((i) => `<rect x="10" y="${23 + i * 11}" width="100" height="1.5" fill="${M}" opacity=".25"/><rect x="14" y="${27 + i * 11}" width="${[40, 30, 36, 24][i]}" height="4" rx="2" fill="${M}" opacity=".5"/><rect x="84" y="${27 + i * 11}" width="20" height="4" rx="2" fill="${A}"/>`).join('')),
      latest: sv([0, 1, 2, 3].map((i) => `<rect x="10" y="${10 + i * 14}" width="4" height="10" rx="1" fill="${['#e5484d', '#f5a524', '#f5a524', '#4aa3ff'][i]}"/><rect x="18" y="${12 + i * 14}" width="${[88, 70, 80, 60][i]}" height="6" rx="3" fill="${M}" opacity=".35"/>`).join('')),
      rate: sv(line('12,50 24,44 36,52 48,30 60,36 72,22 84,34 96,28 108,38', A, true)),
      io: sv([0, 1, 2].map((i) => `<circle cx="18" cy="${18 + i * 18}" r="5" fill="${['#30a46c', '#30a46c', '#f5a524'][i]}"/><rect x="30" y="${15 + i * 18}" width="${[70, 56, 62][i]}" height="6" rx="3" fill="${M}" opacity=".35"/>`).join('')),
      health: sv(`<path d="M12 40 L34 40 L42 20 L54 58 L64 32 L72 40 L108 40" fill="none" stroke="${A}" stroke-width="2.4" stroke-linejoin="round"/>`),
      silent: sv([0, 1, 2].map((i) => `<rect x="12" y="${12 + i * 17}" width="${[56, 44, 50][i]}" height="7" rx="3" fill="${M}" opacity=".4"/><rect x="82" y="${12 + i * 17}" width="26" height="7" rx="3" fill="#e5484d" opacity=".8"/>`).join('')),
      poll: sv([0, 1, 2, 3].map((i) => `<rect x="12" y="${12 + i * 14}" width="58" height="7" rx="3" fill="${M}" opacity=".4"/><circle cx="90" cy="${15 + i * 14}" r="5" fill="${['#30a46c', '#30a46c', '#f5a524', '#e5484d'][i]}"/>`).join('')),
      snmpstatus: sv(`<circle cx="26" cy="36" r="9" fill="#30a46c"/><rect x="42" y="28" width="62" height="7" rx="3" fill="${M}" opacity=".4"/><rect x="42" y="40" width="40" height="6" rx="3" fill="${M}" opacity=".25"/>`),
      text: sv(`<rect x="14" y="14" width="60" height="9" rx="2" fill="${M}" opacity=".7"/>` + [0, 1, 2].map((i) => `<rect x="14" y="${30 + i * 11}" width="${[92, 84, 60][i]}" height="5" rx="2.5" fill="${M}" opacity=".3"/>`).join(''))
    };
  })();
  const GALLERY = [['Numbers', ['kpi', 'statspark', 'gauge', 'bargauge']], ['Charts', ['trend', 'line', 'bar', 'pie', 'treemap', 'heat', 'sevbars']], ['Rankings, tables and lists', ['top', 'table', 'latest', 'silent']], ['Status and notes', ['rate', 'io', 'health', 'snmpstatus', 'text']], ['SNMP polling', ['poll']]];
  const DS_HINT = { events: 'Counts, busiest devices / processes, severity, latest messages and charts over time.', alarms: 'Active, acknowledged, escalated, cleared alarms; by rule, device, severity; latest alarms.', devices: 'How many devices are reporting, silent, muted, overdue; by vendor, status or group.', system: 'Message rate now, database size, free disk space, messages dropped.' };
  // ---------- 1.58: polled devices and readings ----------
  const pollData = new Map();
  async function loadPoll(list) {
    await Promise.all(list.filter((x) => x.type === 'poll').map(async (x) => { try { pollData.set(x.id, await api('/api/poll/tile', { method: 'POST', body: x.cfg?.poll || {} })); } catch (e) { pollData.set(x.id, { error: e.message || 'Cannot read the polling data.' }); } }));
  }
  const PST = { ok: 'var(--ok)', warn: 'var(--s4)', crit: 'var(--bad)', unk: 'var(--muted)' };
  const DEVST = { up: 'ok', down: 'crit', stale: 'warn', unknown: 'unk', off: 'unk' };
  const WORSE = ['unk', 'ok', 'warn', 'crit'];
  const pfmt = (e, v = e.v) => (e.text !== undefined && v === null ? esc(e.text) : Number.isFinite(v) ? esc((e.dec !== null && e.dec !== undefined ? v.toFixed(e.dec) : String(Math.round(v * 100) / 100)) + (e.unit ? ' ' + e.unit : '')) : '–');
  function pollHtml(t) {
    const d = pollData.get(t.id), sp = t.cfg?.poll || {}, shape = sp.shape || 'square'; if (!d) return '<div class="muted">Loading…</div>'; if (d.error) return `<div class="muted">${esc(d.error)}</div>`;
    const cell = (name, big, small, col, tip) => `<div class="pcell shp-${shape}" style="--c:${col}" title="${esc(tip || name)}"><span class="pn">${esc(name)}</span><b>${big}</b>${small ? `<span class="tw">${small}</span>` : ''}</div>`;
    if (d.src === 'status' || d.src === 'alarms') {
      const rows = d.devices || []; if (!rows.length) return '<div class="muted">No polled device' + (sp.group ? ' in this group' : '') + ' yet.</div>';
      const sum = Object.entries(d.groups).sort((a, b) => a[0].localeCompare(b[0]));
      const head = d.src === 'alarms' ? `<div class="bigv" style="color:${d.alarms ? 'var(--s3)' : 'var(--ok)'}">${d.alarms}</div><div class="muted" style="margin-bottom:6px">open polling alarm${d.alarms === 1 ? '' : 's'}</div>` : `<div class="muted" style="margin-bottom:6px">${rows.filter((r) => r.state === 'up').length} of ${rows.length} up${rows.some((r) => r.state === 'down') ? ` · <b style="color:var(--bad)">${rows.filter((r) => r.state === 'down').length} no answer</b>` : ''}${d.alarms ? ` · <b style="color:var(--s3)">${d.alarms} alarm${d.alarms === 1 ? '' : 's'}</b>` : ''}</div>`;
      const shown = d.src === 'alarms' ? rows.filter((r) => r.alarms) : rows;
      if (sp.view === 'table' || d.src === 'alarms') return head + (shown.length ? `<table class="data"><thead><tr><th>Device</th>${sum.length > 1 || sum[0]?.[0] ? '<th>Group</th>' : ''}<th>Status</th><th class="num-r">Answer</th><th class="num-r">Alarms</th></tr></thead><tbody>${shown.map((r) => `<tr><td><a href="#polling?d=${esc(r.id)}">${esc(r.name)}</a></td>${sum.length > 1 || sum[0]?.[0] ? `<td class="muted">${esc(r.group)}</td>` : ''}<td><span class="sdot" style="background:${PST[DEVST[r.state] || 'unk']}"></span> ${esc(r.state)}</td><td class="num-r">${r.rtt === null ? '–' : r.rtt + ' ms'}</td><td class="num-r">${r.alarms || ''}</td></tr>`).join('')}</tbody></table>` : '');
      const by = {}; rows.forEach((r) => (by[r.group] ||= []).push(r));
      return head + Object.keys(by).sort().map((g) => `${Object.keys(by).length > 1 || g ? `<div class="pgh">${esc(g || 'No group')} <span class="muted">${by[g].filter((r) => r.state === 'up').length}/${by[g].length}</span></div>` : ''}<div class="ptiles">${by[g].map((r) => `<a href="#polling?d=${esc(r.id)}" class="pa">${cell(r.name, esc(r.state), r.alarms ? r.alarms + ' alarm' + (r.alarms === 1 ? '' : 's') : '', PST[r.alarms && r.state === 'up' ? 'warn' : DEVST[r.state] || 'unk'], r.name + ' · ' + r.state)}</a>`).join('')}</div>`).join('');
    }
    const es = d.entries || []; if (!es.length) return '<div class="muted">Nothing to show yet. Edit the tile and choose readings, or wait for the next poll.</div>';
    const same = es.every((e) => e.label === es[0].label), nm = (e) => e.devName + (e.row ? ' · ' + e.row : '') + (same ? '' : ' · ' + e.label), col = (e) => PST[e.state];
    const nums = es.map((e) => e.v).filter(Number.isFinite), worst = es.reduce((w, e) => (WORSE.indexOf(e.state) > WORSE.indexOf(w) ? e.state : w), 'unk');
    const agg = () => { if (!nums.length) return null; const a = sp.agg || 'max'; return a === 'first' ? es.find((e) => Number.isFinite(e.v)).v : a === 'avg' ? nums.reduce((x, y) => x + y, 0) / nums.length : a === 'min' ? Math.min(...nums) : a === 'sum' ? nums.reduce((x, y) => x + y, 0) : Math.max(...nums); };
    const e0 = es[0];
    if (sp.view === 'big') { const v = agg(); return `<div class="bigv" style="color:${worst === 'unk' ? 'inherit' : PST[worst]}">${pfmt(e0, v)}</div><div class="muted">${esc(same ? e0.label : 'readings')} · ${{ first: 'first', avg: 'average', min: 'lowest', max: 'highest', sum: 'total' }[sp.agg || 'max']} of ${es.length}</div>`; }
    if (sp.view === 'gauge') { const v = agg(), mx = sp.max || e0.max || Math.max(100, ...nums), f = Math.min(1, Math.max(0, (v || 0) / mx)), a = Math.PI * (1 - f), x = 60 + 48 * Math.cos(a), y = 62 - 48 * Math.sin(a); return `<svg viewBox="0 0 120 76" style="width:100%;max-height:100%"><path d="M12 62 A48 48 0 0 1 108 62" fill="none" stroke="var(--line)" stroke-width="10" stroke-linecap="round"/><path d="M12 62 A48 48 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="${worst === 'unk' ? 'var(--accent)' : PST[worst]}" stroke-width="10" stroke-linecap="round"/><text x="60" y="60" text-anchor="middle" font-size="16" font-weight="700" fill="currentColor">${pfmt(e0, v)}</text></svg><div class="muted" style="text-align:center">${esc(same ? e0.label : 'readings')} · ${es.length} value${es.length === 1 ? '' : 's'}</div>`; }
    if (sp.view === 'bars') { const mx = sp.max || Math.max(...es.map((e) => e.max || 0), ...nums, 1); return `<div class="hbars">${es.map((e) => `<div class="hb" title="${esc(nm(e))}"><span class="trunc">${esc(nm(e))}</span><span class="hbt"><i style="width:${Math.min(100, Math.max(0, (e.v || 0) / mx * 100))}%;background:${e.state === 'unk' ? 'var(--accent)' : col(e)}"></i></span><b>${pfmt(e)}</b></div>`).join('')}</div>`; }
    if (sp.view === 'tiles') return `<div class="ptiles">${es.map((e) => cell(nm(e), pfmt(e), esc(e.meaning || ''), e.state === 'unk' ? 'var(--accent)' : col(e), nm(e) + ' · ' + pfmt(e))).join('')}</div>`;
    if (sp.view === 'line') {
      const ser = d.series || []; if (!ser.some((x) => x.pts.length)) return '<div class="muted">No history for this period yet.</div>';
      const all = ser.flatMap((x) => x.pts), x0 = d.from, x1 = d.to, ys = all.map((p) => p[1]).filter(Number.isFinite), lo = Math.min(0, ...ys), hi = Math.max(...ys, sp.max || 0, lo + 1), X = (x) => 4 + (x - x0) / (x1 - x0 || 1) * 392, Y = (y) => 128 - (y - lo) / (hi - lo) * 120;
      return `<svg viewBox="0 0 400 134" preserveAspectRatio="none" style="width:100%;height:calc(100% - 38px);min-height:90px"><line x1="4" x2="396" y1="128" y2="128" stroke="var(--line)"/><line x1="4" x2="396" y1="8" y2="8" stroke="var(--line)" stroke-dasharray="3 4"/>${ser.map((x, i) => `<polyline fill="none" stroke="${PAL[i % PAL.length]}" stroke-width="1.8" vector-effect="non-scaling-stroke" points="${x.pts.filter((p) => Number.isFinite(p[1])).map((p) => X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' ')}"/>${x.pts.length < 3 ? x.pts.filter((p) => Number.isFinite(p[1])).map((p) => `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="3" fill="${PAL[i % PAL.length]}"/>`).join('') : ''}`).join('')}</svg><div class="legend">${ser.map((x, i) => `<span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;background:${PAL[i % PAL.length]}"></i>${esc(x.name)}</span>`).join('')}</div><div class="muted" style="font-size:11px">${esc(String(Math.round(lo * 10) / 10))} – ${esc(String(Math.round(hi * 10) / 10))}${esc(ser[0].unit ? ' ' + ser[0].unit : '')} · last ${sp.hours || 6} h</div>`;
    }
    const grp = es.some((e) => e.group);
    return `<table class="data"><thead><tr><th>Device</th>${grp ? '<th>Group</th>' : ''}${same ? '' : '<th>Reading</th>'}<th class="num-r">${same ? esc(e0.label) : 'Value'}</th></tr></thead><tbody>${es.map((e) => `<tr><td><a href="#polling?d=${esc(e.dev)}">${esc(e.devName)}</a>${e.row ? ` <span class="muted">${esc(e.row)}</span>` : ''}</td>${grp ? `<td class="muted">${esc(e.group)}</td>` : ''}${same ? '' : `<td>${esc(e.label)}</td>`}<td class="num-r"><span class="sdot" style="background:${col(e)}"></span> <b>${pfmt(e)}</b>${e.meaning ? ` <span class="muted">${esc(e.meaning)}</span>` : ''}</td></tr>`).join('')}</tbody></table>`;
  }
  async function pollDialog(existing) {
    let cat; try { cat = await api('/api/poll/catalog'); } catch (e) { return toast(e.message || 'Cannot read the polled devices.', true); }
    const t = existing ? structuredClone(existing) : { id: 'u' + Date.now().toString(36), type: 'poll', title: '', x: 0, y: 0, w: TYPES.poll.w, h: TYPES.poll.h, cfg: {} };
    const sp = t.cfg.poll = { src: 'readings', view: 'table', hours: 6, picks: [], ...(t.cfg.poll || {}) }; sp.picks = [...(sp.picks || [])];
    const back = document.createElement('div'); back.className = 'modal-back';
    const opt = (v, l, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
    back.innerHTML = `<form class="modal pe" role="dialog" aria-modal="true" aria-label="Polled devices tile" style="max-width:680px;max-height:92vh;display:flex;flex-direction:column"><h3 style="margin:0 0 2px">${existing ? 'Edit tile' : 'Add: Polled devices and readings'}</h3><p class="muted" style="margin:0 0 10px">${esc(TYPES.poll.desc)}</p><div class="form" id="pdBody" style="overflow:auto;flex:1;min-height:0;padding-right:4px"></div>
      <div class="toolbar" style="margin:12px 0 0"><span class="spacer"></span><button type="button" id="mCancel">Cancel</button><button type="submit" class="primary">${existing ? 'Save' : 'Add tile'}</button></div></form>`;
    document.body.appendChild(back); const close = () => back.remove(), body = $('#pdBody', back), devById = Object.fromEntries(cat.devices.map((d) => [d.id, d]));
    let selDev = cat.devices[0]?.id || '', selLabel = cat.labels[0]?.label || '';
    const pickText = (p) => p.label ? `Every “${p.label}” reading${p.group || sp.group ? ' of group ' + (p.group || sp.group) : ' of every device'} (new devices join by themselves)` : `${devById[p.dev]?.name || p.dev} · ${(devById[p.dev]?.readings.find((r) => r.k === p.k) || { label: p.k }).label}${p.row ? ' · ' + p.row : ''}`;
    const draw = () => {
      const dv = devById[selDev], rd = dv?.readings || [], isR = sp.src === 'readings', lv = cat.devices.filter((d) => d.readings.some((r) => r.label.toLowerCase() === selLabel.toLowerCase()));
      body.innerHTML = `<div class="field"><label for="pdT">Title</label><div><input id="pdT" type="text" maxlength="60" value="${esc(t.title || '')}" placeholder="${esc(TYPES.poll.label)}"></div></div>
        <div class="field"><label for="pdS">Show</label><div><select id="pdS">${opt('readings', 'Readings (any device, any reading)', sp.src)}${opt('status', 'Device status (up / no answer, by group)', sp.src)}${opt('alarms', 'Open polling alarms', sp.src)}</select></div></div>
        <div class="field"><label for="pdV">Look</label><div><select id="pdV">${(isR ? [['table', 'Table'], ['tiles', 'Tile grid (coloured by what the value means)'], ['bars', 'Bar list'], ['big', 'One big number'], ['gauge', 'Gauge'], ['line', 'Graph (one line per reading)']] : sp.src === 'status' ? [['tiles', 'Tile grid'], ['table', 'Table']] : [['table', 'Table']]).map(([v, l]) => opt(v, l, sp.view)).join('')}</select></div></div>
        ${sp.view === 'tiles' ? `<div class="field"><label for="pdSh">Tile shape</label><div><select id="pdSh">${[['square', 'Square'], ['round', 'Rounded square'], ['circle', 'Circle'], ['hex', 'Hexagon'], ['hexo', 'Hexagon outline']].map(([v, l]) => opt(v, l, sp.shape || 'square')).join('')}</select></div></div>` : ''}
        ${['big', 'gauge'].includes(sp.view) && isR ? `<div class="field"><label for="pdA">Combine values</label><div><select id="pdA">${[['max', 'Highest'], ['min', 'Lowest'], ['avg', 'Average'], ['sum', 'Total'], ['first', 'First one']].map(([v, l]) => opt(v, l, sp.agg || 'max')).join('')}</select></div></div>` : ''}
        ${['gauge', 'bars', 'line'].includes(sp.view) && isR ? `<div class="field"><label for="pdM">Top of the scale</label><div><input id="pdM" type="number" step="any" style="width:100px" value="${sp.max ?? ''}" placeholder="automatic"></div></div>` : ''}
        ${sp.view === 'line' ? `<div class="field"><label for="pdH">Time range</label><div><select id="pdH">${[[1, '1 hour'], [6, '6 hours'], [24, '24 hours'], [168, '7 days']].map(([v, l]) => opt(v, l, sp.hours)).join('')}</select></div></div>` : ''}
        ${!isR ? `<div class="field"><label for="pdG">Only group</label><div><select id="pdG">${opt('', 'All devices', sp.group || '')}${cat.groups.map((g) => opt(g, g, sp.group || '')).join('')}</select></div></div>` : ''}
        ${isR ? `<div class="field"><label>Readings shown</label><div><div id="pdList" class="pdlist">${sp.picks.length ? sp.picks.map((p, i) => `<div class="pdp"><span>${esc(pickText(p))}</span><button type="button" data-rm="${i}" title="Remove">✕</button></div>`).join('') : '<span class="muted">None yet. Add one below.</span>'}</div></div></div>
        <details class="og" open><summary>Add one reading of one device</summary><div class="form">
          <div class="field"><label for="pdD">Device</label><div><select id="pdD">${cat.devices.map((d) => opt(d.id, d.name + (d.group ? ' (' + d.group + ')' : ''), selDev)).join('')}</select></div></div>
          <div class="field"><label for="pdR">Reading</label><div><select id="pdR">${rd.map((r) => opt(r.k, r.label + (r.unit ? ' (' + r.unit + ')' : ''), '')).join('')}</select></div></div>
          <div class="field"><label for="pdW">Rows</label><div><select id="pdW"><option value="">All rows (or the single value)</option>${(rd[0] ? rd[0].rows : []).map((r) => opt(r, r, '')).join('')}</select></div></div>
          <div class="toolbar"><button type="button" id="pdAdd">Add</button></div></div></details>
        <details class="og"><summary>Same reading on many devices</summary><div class="form">
          <div class="field"><label for="pdL">Reading name</label><div><select id="pdL">${cat.labels.map((l) => opt(l.label, l.label + ' (' + l.devices + ' device' + (l.devices === 1 ? '' : 's') + ')', selLabel)).join('')}</select></div></div>
          <div class="field"><label>Devices</label><div class="pdchk">${lv.map((d) => `<label><input type="checkbox" class="pdc" value="${esc(d.id)}" checked> ${esc(d.name)}${d.group ? ' <span class="muted">' + esc(d.group) + '</span>' : ''}</label>`).join('') || '<span class="muted">No device has this reading.</span>'}</div></div>
          <div class="toolbar"><button type="button" id="pdAddC">Add the ticked devices</button>${cat.groups.length ? `<select id="pdLG" aria-label="Group">${opt('', 'every device', '')}${cat.groups.map((g) => opt(g, 'group ' + g, '')).join('')}</select>` : ''}<button type="button" id="pdAddA" title="New devices that have this reading join automatically">Add all, including future devices</button></div></div></details>` : ''}
        <div class="field"><label for="pdWd">Width</label><div><input id="pdWd" type="number" min="${TYPES.poll.minW}" max="12" style="width:70px" value="${t.w}"> <span class="muted">of 12 columns</span> &nbsp; <label for="pdHt" style="display:inline">Height</label> <input id="pdHt" type="number" min="${TYPES.poll.minH}" max="40" style="width:70px" value="${t.h}"> <span class="muted">rows</span></div></div>`;
      const $b = (id) => $('#' + id, body);
      $b('pdT').oninput = (e) => { t.title = e.target.value; };
      $b('pdS').onchange = (e) => { sp.src = e.target.value; sp.view = sp.src === 'readings' ? 'table' : 'tiles'; draw(); };
      $b('pdV').onchange = (e) => { sp.view = e.target.value; draw(); };
      if ($b('pdSh')) $b('pdSh').onchange = (e) => { sp.shape = e.target.value; }; if ($b('pdA')) $b('pdA').onchange = (e) => { sp.agg = e.target.value; };
      if ($b('pdM')) $b('pdM').onchange = (e) => { if (e.target.value === '') delete sp.max; else sp.max = +e.target.value; }; if ($b('pdH')) $b('pdH').onchange = (e) => { sp.hours = +e.target.value; };
      if ($b('pdG')) $b('pdG').onchange = (e) => { if (e.target.value) sp.group = e.target.value; else delete sp.group; };
      $b('pdWd').onchange = (e) => { t.w = +e.target.value; }; $b('pdHt').onchange = (e) => { t.h = +e.target.value; };
      if (isR) {
        $$('[data-rm]', body).forEach((b) => { b.onclick = () => { sp.picks.splice(+b.dataset.rm, 1); draw(); }; });
        $b('pdD').onchange = (e) => { selDev = e.target.value; draw(); $b('pdD').focus(); };
        $b('pdR').onchange = (e) => { const r = rd.find((x) => x.k === e.target.value); $b('pdW').innerHTML = '<option value="">All rows (or the single value)</option>' + (r ? r.rows : []).map((x) => opt(x, x, '')).join(''); };
        $b('pdR').dispatchEvent(new Event('change'));
        $b('pdAdd').onclick = () => { if (!$b('pdR').value) return toast('This device has no readings yet. Add them on its page first.', true); sp.picks.push({ dev: selDev, k: $b('pdR').value, ...($b('pdW').value ? { row: $b('pdW').value } : {}) }); draw(); };
        $b('pdL').onchange = (e) => { selLabel = e.target.value; draw(); };
        $b('pdAddC').onclick = () => { for (const c of $$('.pdc:checked', body)) { const d = devById[c.value], r = d.readings.find((x) => x.label.toLowerCase() === selLabel.toLowerCase()); if (r && !sp.picks.some((p) => p.dev === d.id && p.k === r.k && !p.row)) sp.picks.push({ dev: d.id, k: r.k }); } draw(); };
        $b('pdAddA').onclick = () => { const g = $b('pdLG') ? $b('pdLG').value : ''; sp.picks.push({ label: selLabel, ...(g ? { group: g } : {}) }); draw(); };
      }
    };
    draw();
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(); }); back.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    $('#mCancel', back).onclick = close;
    $('form', back).onsubmit = (e) => {
      e.preventDefault(); if (sp.src === 'readings' && !sp.picks.length) return toast('Add at least one reading.', true);
      if (sp.src !== 'readings') sp.picks = []; if (!t.title) t.title = sp.src === 'status' ? 'Polled devices' : sp.src === 'alarms' ? 'Polling alarms' : 'Polled readings';
      t.w = Math.min(12, Math.max(TYPES.poll.minW, Math.round(+t.w) || TYPES.poll.w)); t.h = Math.min(40, Math.max(TYPES.poll.minH, Math.round(+t.h) || TYPES.poll.h));
      const list = getTiles(); if (existing) list[list.findIndex((x) => x.id === existing.id)] = t; else { t.y = Math.max(0, ...list.map((x) => x.y + x.h)); list.push(t); }
      if (t.x + t.w > 12) t.x = 12 - t.w; settle(list, t.id); saveTiles(); close(); frames(); load();
    };
  }

  function addMenu() {
    const back = document.createElement('div'); back.className = 'modal-back';
    const works = (k) => (k === 'poll' ? 'SNMP polling' : VIS_DS[k] ? [...new Set(VIS_DS[k].map((x) => ({ events: 'Syslog / traps', alarms: 'Alarms', devices: 'Devices', system: 'System' }[x])))].join(' · ') : 'Fixed content');
    const card = (k) => `<button type="button" class="vcard" data-type="${k}" aria-label="${esc(TYPES[k].label)}"><span class="vthumb">${THUMB[k] || ''}</span><b>${esc(TYPES[k].label)}</b><span class="muted vdesc">${esc(TYPES[k].desc)}</span><span class="vworks">${esc(works(k))}</span></button>`;
    const stepOne = () => `<h3 style="margin:0 0 4px">Add a tile</h3><p class="muted" style="margin:0 0 10px">Step 1 of 3 – pick a visual. Next you choose the data it shows, then colours and options.</p><input type="search" id="vFind" placeholder="Search visuals…" aria-label="Search visuals" style="width:100%;margin-bottom:8px">
      <div class="gallery" id="vGal">${GALLERY.map(([g, ks]) => `<div class="gcat"><h4>${g}</h4><div class="gitems">${ks.map(card).join('')}</div></div>`).join('')}</div><div class="toolbar" style="margin:12px 0 0"><span class="spacer"></span><button type="button" id="mCancel">Cancel</button></div>`;
    const stepTwo = (type) => `<h3 style="margin:0 0 4px">${esc(TYPES[type].label)}: choose the data</h3><p class="muted" style="margin:0 0 10px">Step 2 of 3 – where should the numbers come from? The tile shows this name in its header so you always know what it counts.</p>
      <div class="dsgrid">${Object.entries(DS).filter(([, v]) => VIS_DS[type].includes(v.kind)).map(([k, v]) => `<button type="button" class="dscard" data-ds="${k}"><b><span class="srcchip" data-ds="${k}">${esc(v.chip)}</span> ${esc(v.label)}</b><span class="muted">${esc(v.desc)}</span><span class="muted hint">${esc(DS_HINT[v.kind])}</span></button>`).join('')}</div>
      <div class="toolbar" style="margin:12px 0 0"><button type="button" id="mBack">← Back</button><span class="spacer"></span><button type="button" id="mCancel">Cancel</button></div>`;
    back.innerHTML = `<div class="modal wide" role="dialog" aria-modal="true" aria-label="Add a tile" id="mBox"></div>`; document.body.appendChild(back);
    const box = $('#mBox', back), close = () => back.remove(); let picked = '';
    const show = (html) => { box.innerHTML = html; $('#mCancel', back).onclick = close; $('button[data-type],button[data-ds]', back)?.focus(); };
    show(stepOne()); back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    back.addEventListener('input', (e) => { if (e.target.id !== 'vFind') return; const f = e.target.value.trim().toLowerCase(); for (const b of $$('.vcard', back)) b.hidden = !!f && !(`${TYPES[b.dataset.type].label} ${TYPES[b.dataset.type].desc} ${works(b.dataset.type)}`.toLowerCase().includes(f)); for (const g of $$('.gcat', back)) g.hidden = !$$('.vcard:not([hidden])', g).length; });
    back.addEventListener('click', (e) => {
      if (e.target.id === 'mBack') return show(stepOne());
      const b = e.target.closest('button[data-type]'); if (b) { picked = b.dataset.type; if (picked === 'poll') { close(); return pollDialog(null); } if (!VIS_DS[picked]) { close(); return tileDialog(null, picked); } const kinds = [...new Set(VIS_DS[picked])]; return show(stepTwo(picked)); }
      const d = e.target.closest('button[data-ds]'); if (d) { close(); tileDialog(null, picked, d.dataset.ds); }
    });
  }

  // ----- header controls -----
  /** click-through: syslog and traps open the message pages; alarms open the Alarms page; devices open the Devices page */
  const drillTile = (t, by, key) => {
    const k = dsKind(t);
    if (k === 'alarms') { const st = by === 'state' ? ({ open: 'open', ack: 'ack', cleared: 'cleared', escalated: 'escalated' }[key] || 'active') : ({ active: 'active', open: 'open', ack: 'ack', esc: 'escalated', cleared: 'cleared' }[t.cfg?.filter?.astate] || 'active'); S.alarmState = st; S.alarmSrc = by === 'source' ? String(key) : ''; S.alarmRange = ''; try { sessionStorage.setItem('sp.alarmQ', by === 'host' || by === 'rule' ? String(key) : ''); } catch { /* ignore */ } location.hash = '#alarms'; return; }
    if (k === 'devices') { location.hash = '#devices'; return; }
    return drill(drillFilter(by, key, t));
  };
  const drill = (filter) => { S.cur = filter.source === 'snmp' ? 'snmp' : 'syslog'; S.filter = normFilter(filter); const p = SP.dash?.range?.preset || '24h'; S.range = DRILL_RANGE[p] || '86400000'; location.hash = filter.source === 'snmp' ? '#traps' : '#logs'; };
  const syncRange = () => {
    const r = SP.dash?.range || { preset: '24h' }; $('#dRange', el).value = r.preset; $('#dCustom', el).hidden = r.preset !== 'custom';
    if (r.preset === 'custom') { const loc = (t) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 16); $('#dFrom', el).value = loc(r.from); $('#dTo', el).value = loc(r.to); }
  };
  const setRange = (r) => { SP.dash = { ...(SP.dash || {}), range: r }; savePrefs(); syncRange(); data = null; paint(); load(); schedule(); };
  el.addEventListener('change', (e) => {
    if (e.target.id !== 'dRange') return; const v = e.target.value;
    if (v === 'custom') { const now = Date.now(); SP.dash = { ...(SP.dash || {}), range: { preset: 'custom', from: SP.dash?.range?.from ?? now - 86400000, to: SP.dash?.range?.to ?? now } }; syncRange(); } else setRange({ preset: v });
  });
  el.addEventListener('click', async (e) => {
    const al0 = e.target.closest('a.alink'); if (al0 && editing) { e.preventDefault(); return; }
    const ac = e.target.closest('[data-al]');
    const ar = e.target.closest('tr[data-aid]'); if (ar && !editing) { const tt = getTiles().find((x) => x.id === ar.closest('.widget').dataset.id); try { sessionStorage.setItem('sp.alarmQ', ar.dataset.q || ''); } catch { /* ignore */ } S.alarmState = 'active'; S.alarmSrc = ''; S.alarmRange = ''; location.hash = '#alarms'; return; }
    const dr = e.target.closest('tr[data-dev]'); if (dr && !editing) { location.hash = '#devices'; return; }
    if (ac) { e.preventDefault(); S.alarmState = ac.dataset.al === 'all' ? 'all' : ac.dataset.al; S.alarmSrc = ''; S.alarmRange = ''; location.hash = '#alarms'; return; }
    const id = e.target.id;
    if (id === 'dApply') { const f = new Date($('#dFrom', el).value).getTime(), t = new Date($('#dTo', el).value).getTime(); if (!(f < t)) return toast('Choose a start that is earlier than the end', true); return setRange({ preset: 'custom', from: f, to: t }); }
    if (id === 'dRefresh') return load(true);
    if (id === 'dSet') return styleDialog();
    if (id === 'dEdit') { editing = !editing; $('#dEdit', el).textContent = editing ? 'Done' : 'Customize'; $('#dEdit', el).classList.toggle('primary', editing); $('#dEditBar', el).hidden = !editing; return frames(); }
    if (id === 'dReset') { if (!await askConfirm('Put the dashboard back to the standard tiles and layout?')) return; delete SP.dash?.tiles; delete SP.dash?.blank; savePrefs(); tiles = null; frames(); return load(); }
    if (id === 'dAdd') return addMenu();
    if (id === 'dWallLink') return wallMode.copy(); if (id === 'dWall') return wallMode(true); if (id === 'dExp') return boardAct('exp'); if (id === 'dImp') return boardAct('imp'); if (id === 'dSave') return boardAct('save'); if (id === 'dNew') return boardAct('new'); if (id === 'dRen') return boardAct('ren'); if (id === 'dDel') return boardAct('del');
    const od = e.target.closest('#dOrder button'); if (od) { const first = od.dataset.o === 'snmp'; if (!!SP.dash?.snmpFirst === first) return; SP.dash = { ...(SP.dash || {}), snmpFirst: first }; if (!first) delete SP.dash.snmpFirst; settle(getTiles(), null); saveTiles(); syncSnmpBtn(); return frames(); }
    const a = e.target.closest('button[data-a]:not([data-a=seccfg])');
    if (a) { const tid = a.closest('.widget').dataset.id, list = getTiles(), t = list.find((x) => x.id === tid);
      if (a.dataset.a === 'del') { list.splice(list.indexOf(t), 1); settle(list, null); saveTiles(); frames(); }
      if (a.dataset.a === 'cfg') { if (t.type === 'poll') pollDialog(t); else tileDialog(t); } return; }
    const sc = e.target.closest('button[data-a=seccfg]'); if (sc) return secDialog(structuredClone(getTiles().find((x) => x.id === sc.dataset.sid)));
    const pl = e.target.closest('.pl[data-key]'); if (pl && !editing) { const tt = getTiles().find((x) => x.id === pl.closest('.widget').dataset.id); return drillTile(tt, byOf(tt), pl.dataset.key); }
    const dk = e.target.closest('[data-dk]'); if (dk && !editing) { const tt = getTiles().find((x) => x.id === dk.dataset.tid); if (tt) return drillTile(tt, byOf(tt), dk.dataset.dk); }
    const h = e.target.closest('.hostlink2'); if (h) { e.preventDefault(); return drill({ host: h.dataset.host }); }
    const tr = e.target.closest('tr[data-id]'); if (tr && !editing) { const d = Object.values(data?.tiles || {}).flatMap((x) => x.rows || []).find((m) => m.id === +tr.dataset.id); openDrawer(+tr.dataset.id, d); }
  });

  S.onStats = () => { paint(); };
  const resize = () => { place(); };
  window.addEventListener('resize', resize); const gro = new ResizeObserver(() => place()); gro.observe(grid);
  const syncSnmpBtn = () => { const first = !!SP.dash?.snmpFirst; for (const b of $$('#dOrder button', el)) { const on = (b.dataset.o === 'snmp') === first; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); } };
  // ----- named dashboards (1.36) -----
  if (boardId && !boards().some((b) => b.id === boardId)) boardId = '';
  const boardSel = $('#dBoard', el), slicer = $('#dSlicer', el);
  const syncBoards = () => { boardSel.innerHTML = [{ id: '', name: S.prefs.dashMainName || 'Main dashboard' }, ...boards()].map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join(''); boardSel.value = boardId; $('#dDel', el).disabled = !boardId; };
  const syncSlicer = () => { slicer.value = SP.dash?.slicer || ''; slicer.classList.toggle('on', !!slicer.value); };
  function useBoard(id) { boardId = id; try { localStorage.setItem('ne.board', id); } catch { /* blocked storage: the choice is not remembered */ } tiles = null; data = null; cache.clear(); applyStyle(); syncSnmpBtn(); syncRange(); syncSlicer(); syncBoards(); frames(); load(); schedule(); }
  const cleanName = (v) => String(v ?? '').replace(/[<>\r\n]/g, ' ').trim().slice(0, 40);
  const newId = () => 'b' + Date.now().toString(36) + Math.floor(Math.random() * 100).toString(36);
  async function boardAct(a) {
    if (a === 'exp') return exportBoard(); if (a === 'imp') return importBoard();
    const cur = boardList();
    if (a === 'save' || a === 'new') {
      if (boards().length >= 19) return toast('You can keep up to 20 dashboards. Delete one first.', true);
      const nm = cleanName(await askText(a === 'save' ? 'Name for the copy of this dashboard:' : 'Name for the new dashboard:', a === 'save' ? cur.name + ' copy' : '')); if (!nm) return;
      const dash = a === 'save' ? { ...structuredClone(SP.dash || {}), alarmTiles: true, snmpTiles: true, tiles: structuredClone(getTiles()) } : { blank: true, alarmTiles: true, snmpTiles: true };
      S.prefs.dashboards = [...boards(), { id: newId(), name: nm, dash }]; savePrefs(); useBoard(S.prefs.dashboards.at(-1).id); toast(`Saved as “${nm}”`); return;
    }
    if (a === 'ren') { const nm = cleanName(await askText('New name for this dashboard:', cur.name)); if (!nm) return; if (boardId) boards().find((b) => b.id === boardId).name = nm; else S.prefs.dashMainName = nm; savePrefs(); syncBoards(); return; }
    if (a === 'del') { if (!boardId || !await askConfirm(`Delete the dashboard “${cur.name}”? Its tiles are lost.`)) return; S.prefs.dashboards = boards().filter((b) => b.id !== boardId); if (!S.prefs.dashboards.length) delete S.prefs.dashboards; savePrefs(); useBoard(''); }
  }

  // ----- sharing (1.42): export / import a dashboard as a file, and a wall display (kiosk) mode -----
  const slug = (n) => String(n || 'dashboard').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'dashboard';
  function exportBoard() {
    const cur = boardList(), dash = { ...structuredClone(SP.dash || {}), tiles: structuredClone(getTiles()) };
    const blob = new Blob([JSON.stringify({ neteventpro: 'dashboard', format: 1, name: cur.name, exported: new Date().toISOString(), dash }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `neteventpro-dashboard-${slug(cur.name)}.json`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast(`Exported “${cur.name}”`);
  }
  function importBoard() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return;
      try {
        if (f.size > 2e6) throw new Error('The file is too large for a dashboard (over 2 MB).');
        const j = JSON.parse(await f.text());
        if (!j || j.neteventpro !== 'dashboard' || !j.dash || !Array.isArray(j.dash.tiles)) throw new Error('This is not a NetEventPro dashboard file.');
        if (j.dash.tiles.length > 300) throw new Error('The dashboard has too many tiles (over 300).');
        if (boards().length >= 19) throw new Error('You can keep up to 20 dashboards. Delete one first.');
        let nm = cleanName(j.name) || 'Imported dashboard'; if ([S.prefs.dashMainName || 'Main dashboard', ...boards().map((b) => b.name)].includes(nm)) nm = cleanName(nm + ' (imported)');
        const dash = { ...structuredClone(j.dash), alarmTiles: true, snmpTiles: true }; delete dash.slicer;
        S.prefs.dashboards = [...boards(), { id: newId(), name: nm, dash }]; await savePrefs(); useBoard(S.prefs.dashboards.at(-1).id); toast(`Imported “${nm}”`);
      } catch (e) { toast(e.message || 'Could not read the file.', true); }
    };
    inp.click();
  }
  /** the date-and-time title bar of the wall display: the same for every dashboard (1.50: it follows the 'kiosk' state of the page, not one dashboard's code) */
  function wallBar(on) {
    let bar = $('#wallBar'); if (on && !bar) { bar = document.createElement('div'); bar.id = 'wallBar'; bar.innerHTML = '<span class="wdate"></span><span class="wtime"></span>'; document.body.appendChild(bar); }
    if (!on && bar) bar.remove(); if (on && typeof drawClock === 'function') drawClock();
  }
  if (!window.__wallBarWatch) { window.__wallBarWatch = true; new MutationObserver(() => wallBar(document.body.classList.contains('kiosk'))).observe(document.body, { attributes: true, attributeFilter: ['class'] }); }
  /** wall display: no menus, full screen; Esc or the small button leaves it */
  function wallMode(on) {
    document.body.classList.toggle('kiosk', on);
    wallBar(on);
    let b = $('#kioskExit'); if (on && !b) { b = document.createElement('button'); b.id = 'kioskExit'; b.textContent = 'Exit wall display'; b.onclick = () => wallMode(false); document.body.appendChild(b); } if (!on && b) b.remove();
    if (on) document.documentElement.requestFullscreen?.().catch(() => {}); else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    setTimeout(() => window.dispatchEvent(new Event('resize')), 200);
  }
  wallMode.copy = () => { const u = `${location.origin}${location.pathname}#dashboard?board=${encodeURIComponent(boardId)}&kiosk=1`; navigator.clipboard?.writeText(u).then(() => toast('Wall display link copied. Open it on the wall computer and sign in once.'), () => toast(u)); };
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('kiosk')) wallMode(false); });
  const boardList = () => (boardId ? boards().find((b) => b.id === boardId) : { name: S.prefs.dashMainName || 'Main dashboard' }) || { name: 'Dashboard' };
  boardSel.addEventListener('change', () => useBoard(boardSel.value));
  slicer.addEventListener('change', () => { const v = slicer.value.trim().slice(0, 100); SP.dash = { ...(SP.dash || {}), slicer: v || undefined }; if (!v) delete SP.dash.slicer; savePrefs(); syncSlicer(); data = null; paint(); load(); });
  api('/api/devices').then((d) => { $('#dSlD', el).innerHTML = (d || []).slice(0, 500).map((x) => `<option value="${esc(x.alias || x.host)}">`).join(''); }).catch(() => {});
  applyStyle(); syncSnmpBtn(); syncRange(); syncSlicer(); syncBoards(); frames(); load(); schedule();
  { const hq = S.hq; if (hq && hq.get('board') !== null && hq.get('board') !== boardId && (boards().some((b) => b.id === hq.get('board')) || hq.get('board') === '')) useBoard(hq.get('board')); if (hq && hq.get('kiosk')) wallMode(true); }
  return () => { document.body.classList.remove('kiosk'); $('#kioskExit')?.remove(); $('#wallBar')?.remove(); el.style.background = ''; for (const k of ['--accent', '--link', '--dr']) el.style.removeProperty(k); delete el.dataset.card; delete el.dataset.titles; S.onStats = null; clearInterval(timer); clearTimeout(roTimer); ro?.disconnect(); gro.disconnect(); window.removeEventListener('resize', resize); $$('.modal-back').forEach((n) => n.remove()); };
};
