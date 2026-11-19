'use strict';
/* Dashboard: a time range for all numbers, tiles you can drag and resize with the mouse, and a catalog for adding more tiles
   (including your own, with a filter). Layout, tiles and range are saved on the server with the other screen choices. */

/** the dashboard that is shown: the main one is prefs.dash, the others are prefs.dashboards[i].dash (1.36). Everything below reads and writes SP.dash. */
let boardId = '';
try { boardId = localStorage.getItem('ne.board') || ''; } catch { /* storage may be blocked */ }
const boards = () => S.prefs.dashboards || [];
/** while customizing, changes live only in memory: Done saves them, Cancel (or leaving the page) throws them away (1.73.3) */
let draft = null;
const keep = () => { if (draft) { draft.dirty = true; return; } return savePrefs(); };
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
  pollv: { label: 'Polled value', srv: true, k: 'poll' },
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
  system: { label: 'System (live)', chip: 'System', short: 'System', kind: 'system', desc: 'The application itself: message rate, database size, disk space.' },
  poll: { label: 'SNMP polling (readings)', chip: 'Polling', short: 'Poll', kind: 'poll', desc: 'Values read from polled devices: temperatures, voltages, load, traffic, anything you set up as a reading.' }
};
/** ways to rank or group, per kind of data */
const BYS = {
  events: [['host', 'Device'], ['app', 'Process'], ['severity', 'Severity'], ['facility', 'Facility'], ['msgid', 'Trap name (SNMP)']],
  alarms: [['host', 'Device'], ['rule', 'Alarm rule'], ['severity', 'Severity'], ['state', 'State (open / acknowledged / cleared)'], ['source', 'Source (syslog / trap)']],
  devices: [['vendor', 'Vendor'], ['status', 'Status (reporting / silent / muted ...)'], ['group', 'Group'], ['kind', 'What it sends (syslog / traps)']],
  poll: [['device', 'One per device'], ['instance', 'One per device and instance (port, sensor, rectifier ...)'], ['all', 'All together']]
};
const A_STATES = [['raised', 'Raised in the time range'], ['active', 'Active now (open + acknowledged)'], ['open', 'Open now (not acknowledged)'], ['ack', 'Acknowledged now'], ['esc', 'Escalated now'], ['cleared', 'Cleared in the time range']];
const D_STATES = [['all', 'All devices'], ['reporting', 'Reporting normally'], ['silent', 'Silent'], ['muted', 'Muted'], ['overdue', 'Overdue'], ['alarms', 'With open alarms'], ['syslog', 'Sending syslog'], ['trap', 'Sending traps']];
/** which kinds of data each visual can show */
const VIS_DS = { kpi: ['events', 'alarms', 'devices', 'system'], gauge: ['events', 'alarms', 'devices', 'system'], statspark: ['events', 'alarms'], line: ['events', 'alarms'], trend: ['events', 'alarms'], sevbars: ['events', 'alarms'], heat: ['events'],
  top: ['events', 'alarms', 'devices'], bar: ['events', 'alarms', 'devices'], pie: ['events', 'alarms', 'devices'], treemap: ['events', 'alarms', 'devices'], ...Object.fromEntries(['waffle', 'radial', 'rose', 'cloud', 'bubble', 'funnel', 'podium'].map((k) => [k, ['events', 'alarms', 'devices']])), table: ['events', 'alarms', 'devices'], bargauge: ['events', 'alarms', 'devices'], latest: ['events', 'alarms', 'devices'] };
for (const v of ['kpi', 'gauge', 'statspark', 'line', 'top', 'bar', 'pie', 'treemap', 'waffle', 'radial', 'rose', 'cloud', 'bubble', 'funnel', 'podium', 'table', 'bargauge']) if (VIS_DS[v] && !VIS_DS[v].includes('poll')) VIS_DS[v].push('poll');   // 1.99.2 polled readings in every visual that fits
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
  treemap: { label: 'Treemap', desc: 'Rectangles sized by message count: see at a glance which devices or processes dominate.', w: 6, h: 8, minW: 3, minH: 5 },
  table: { label: 'Table', desc: 'A ranking table with count and share of the total (device, process, severity, facility or trap name).', w: 6, h: 9, minW: 3, minH: 4 },
  bargauge: { label: 'Bar gauge', desc: 'Horizontal gauges that turn green, amber or red, (set warning and critical counts or let it use the share of the biggest).', w: 4, h: 8, minW: 3, minH: 4 },
  statspark: { label: 'Number with trend line', desc: 'A big number with a small trend line behind it. Can turn amber or red at levels you set.', w: 3, h: 5, minW: 2, minH: 3 },
  text: { label: 'Text note', desc: 'Your own text: a heading, instructions, a runbook link or a reminder for the shift (bold, bullets and links are supported).', w: 4, h: 5, minW: 2, minH: 2 },
  alarm: { label: 'Alarm card', desc: 'A card from the alarm list: active, acknowledged, escalated, cleared or total alarms. Click it to open the Alarms page. Styled like every other tile.', w: 2, h: 3, minW: 2, minH: 2 },
  waffle: { label: 'Waffle chart', desc: 'A grid of 100 squares, each one is 1% of the total: an easy-to-read share of severity, device, process or alarm state.', w: 4, h: 7, minW: 3, minH: 5 },
  radial: { label: 'Radial bars', desc: 'Concentric rings, the longest ring is the biggest: a compact ranking that looks great on a wall display.', w: 4, h: 8, minW: 3, minH: 5 },
  rose: { label: 'Rose (polar area) chart', desc: 'A flower of wedges; the further a wedge reaches, the more messages. Good for comparing many categories at once.', w: 4, h: 8, minW: 3, minH: 5 },
  cloud: { label: 'Word cloud', desc: 'Names sized by count: the busiest devices, processes or trap names stand out at a glance. Click a word to open its messages.', w: 5, h: 6, minW: 3, minH: 4 },
  bubble: { label: 'Bubbles', desc: 'Circles sized by count, one per device, process, severity or state.', w: 5, h: 7, minW: 3, minH: 4 },
  funnel: { label: 'Funnel', desc: 'Centred bars from the biggest to the smallest, like a funnel: a ranking that is easy to read from a distance.', w: 4, h: 8, minW: 3, minH: 4 },
  podium: { label: 'Leaderboard podium', desc: 'The top three on a podium with medals, the rest in a list underneath.', w: 4, h: 9, minW: 3, minH: 6 },
  devwall: { label: 'Device status wall', desc: 'One cell per device, coloured by status (green reporting, amber overdue, red silent, grey muted), like a NOC status wall. Click to open the Devices page.', w: 6, h: 7, minW: 3, minH: 4 },
  gauge: { label: 'Gauge', desc: 'One number on a dial with warning and critical levels, for example errors in the time range.', w: 3, h: 6, minW: 2, minH: 4 }
};
const NEWRANK = ['waffle', 'radial', 'rose', 'cloud', 'bubble', 'funnel', 'podium'];    // 1.74 more ways to show a ranking
const FILTER_TYPES = ['kpi', 'trend', 'sevbars', 'top', 'latest', 'pie', 'line', 'heat', 'gauge', 'bar', 'treemap', 'table', 'bargauge', 'statspark', ...NEWRANK];
const TOPLIKE = { bar: 12, treemap: 12, table: 50, bargauge: 12, waffle: 8, radial: 8, rose: 12, cloud: 25, bubble: 12, funnel: 8, podium: 10 };    // tiles that rank messages by device / process / severity ... (the most rows each shows)
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
  mono: ['#f2f2f4', '#d4d4d8', '#b4b4ba', '#94949b', '#76767d', '#5b5b61', '#46464b', '#a1a1aa', '#71717a', '#52525b']
};
const PAL_NAMES = [['theme', 'Follow the theme'], ['classic', 'Classic'], ['powerbi', 'Business'], ['grafana', 'Operations'], ['warm', 'Warm'], ['cool', 'Cool'], ['neon', 'Neon'], ['pastel', 'Pastel'], ['mono', 'Greys']];
// 1.72 glass looks: charts get glossy bars, glowing lines and a clear donut hole (only while a glass theme is on)
const glassy = () => ['glass', 'ios'].includes(document.documentElement.dataset.look);
const glossRect = (g, x, y, w, h, color) => { if (h <= 0) return; const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, hexA(color, 95)); gr.addColorStop(1, hexA(color, 55)); g.fillStyle = typeof gr === 'object' && /^#/.test(color) ? gr : color; g.fillRect(x, y, w, h); if (h > 3 && w > 2) { g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(x, y, w, 1); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x, y, Math.min(w, Math.max(1, w * 0.35)), h); } };
const hexA = (hex, a) => { const m = /^#([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return hex; const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(100, a ?? 100)) / 100})`; };
/** any CSS colour (#hex, rgb(), color(srgb …)) as [r, g, b] 0-255, or null; named colours and var() are resolved by the browser */
const rgbOf = (col) => {
  col = String(col || '').trim(); let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(col);
  if (m) { let h = m[1]; if (h.length === 3) h = h.replace(/./g, '$&$&'); const n = parseInt(h, 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(col); if (m) return [+m[1], +m[2], +m[3]];
  m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(col); if (m) return [m[1] * 255, m[2] * 255, m[3] * 255];
  if (!col || typeof document === 'undefined') return null;
  const probe = rgbOf.el || (rgbOf.el = document.createElement('i')); probe.style.color = ''; probe.style.color = col; if (!probe.style.color) return null;
  if (!probe.isConnected) { probe.hidden = true; document.body.appendChild(probe); } const r = getComputedStyle(probe).color; return /^#|^rgb|^color/.test(r) && r !== col ? rgbOf(r) : null;
};
const lumOf = (rgb) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
const contrastOf = (a, b) => { const x = lumOf(a), y = lumOf(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** dark or white text, whichever reads better on this fill (WCAG contrast) */
const inkOf = (col) => { const c = rgbOf(col); if (!c) return '#fff'; return contrastOf(c, [17, 24, 39]) >= contrastOf(c, [255, 255, 255]) ? '#111827' : '#ffffff'; };
/** a colour used for text or thin marks straight on the tile: kept as it is when it reads well, otherwise darkened (light themes) or lightened (dark themes) until it does */
const readable = (col, bg, min = 3.2) => {
  const c = rgbOf(col), b = rgbOf(bg || (typeof css === 'function' ? css('--panel') : '') || '#ffffff'); if (!c || !b) return col;
  if (contrastOf(c, b) >= min) return col; const toward = lumOf(b) > 0.4 ? [0, 0, 0] : [255, 255, 255];
  for (let k = 0.1; k <= 0.9; k += 0.1) { const m = c.map((v, i) => Math.round(v + (toward[i] - v) * k)); if (contrastOf(m, b) >= min) return `rgb(${m.join(',')})`; }
  return toward[0] ? '#ffffff' : '#111827';
};
/** colour steps (Grafana "thresholds"): the colour of the highest step whose value is reached; old warn/crit levels still work */
const thSteps = (c) => (c?.th?.steps?.length ? [...c.th.steps].sort((a, b) => a.v - b.v) : (c?.warn > 0 || c?.crit > 0) ? [{ v: 0, c: 'var(--ok)' }, ...(c.warn > 0 ? [{ v: c.warn, c: 'var(--s4)' }] : []), ...(c.crit > 0 ? [{ v: c.crit, c: 'var(--bad)' }] : [])] : null);
const thColor = (c, v) => { const st = thSteps(c); if (!st || v === null || v === undefined || Number.isNaN(+v)) return ''; let col = st[0].c; for (const x of st) if (v >= x.v) col = x.c; return col; };
const thMode = (c) => c?.th?.mode || (thSteps(c) ? 'value' : 'none');
const STEP_PRESETS = [['Green → amber → red', [{ v: 0, c: '#30a46c' }, { v: 50, c: '#f5a524' }, { v: 100, c: '#e5484d' }]], ['Red → amber → green (higher is better)', [{ v: 0, c: '#e5484d' }, { v: 50, c: '#f5a524' }, { v: 90, c: '#30a46c' }]], ['Blue → purple → pink', [{ v: 0, c: '#3b82f6' }, { v: 50, c: '#8b5cf6' }, { v: 100, c: '#ec4899' }]], ['Traffic light', [{ v: 0, c: '#73bf69' }, { v: 50, c: '#f2cc0c' }, { v: 100, c: '#f2495c' }]]];
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
/** 1.99.2 a tile's icon: next to the title, as a badge in the corner, or large and faint in the background */
function iconBits(t) {
  const ic = t.cfg?.icon; if (!ic?.name || !window.NEPIcons?.TILE[ic.name]) return { title: '', box: '', cls: '', vars: '' };
  const pos = ic.pos || 'title', col = /^#[0-9a-f]{6}$/i.test(ic.color || '') ? ic.color : '', st = col ? `style="--ic:${col}"` : '';
  if (pos === 'title') return { title: `<span class="wicon" ${st}>${NEPIcons.tile(ic.name, Math.min(48, +ic.size || 16))}</span>`, box: '', cls: '', vars: '' };
  if (pos === 'corner') { const z = Math.min(96, +ic.size || 22); return { title: '', cls: ' ico-corner', vars: `--icz:${z}px;`, box: `<span class="wico-corner" style="${col ? `--ic:${col};` : ''}--icz:${z}px">${NEPIcons.tile(ic.name, z)}</span>` }; }
  return { title: '', cls: '', vars: '', box: `<span class="wico-mark" style="${col ? `--ic:${col};` : ''}${+ic.size ? `width:${Math.min(400, +ic.size)}px` : ''}">${NEPIcons.svg(NEPIcons.TILE[ic.name][1], 100, 'style="width:100%;height:100%"')}</span>` };
}
function lookOf(t) {
  const c = t.cfg || {}, L = c.look || {}, st = [], cls = [], tl = [], hd = [];
  if (c.color) st.push(`border-top:3px solid ${c.color}`);
  if (c.bg && !L.bgMode) st.push(`background:${c.bg}`);
  const a = L.bgAlpha ?? 100;
  if (L.bgMode === 'none') st.push('background:transparent', 'box-shadow:none', 'border-color:transparent');
  else if (L.bgMode === 'solid' && L.bg) st.push(`background:${hexA(L.bg, a)}`);
  else if (L.bgMode === 'gradient' && L.bg) st.push(`background:linear-gradient(${L.angle ?? 135}deg,${hexA(L.bg, a)},${hexA(L.bg2 || L.bg, a)})`);
  if (L.bgMode === 'solid' || L.bgMode === 'gradient') { if (a < 100) st.push('backdrop-filter:blur(var(--bgfrost,8px))'); }
  if (L.bw !== undefined) st.push(`border:${L.bw}px solid ${L.bc || 'var(--line)'}`); else if (L.bc) st.push(`border-color:${L.bc}`);
  if (L.radius !== undefined) st.push(`border-radius:${L.radius}px`);
  const glow = L.bc || c.color || 'var(--accent)';
  if (L.shadow === 'none') st.push('box-shadow:none'); else if (L.shadow === 'soft') st.push('box-shadow:0 2px 10px rgba(0,0,0,.28)'); else if (L.shadow === 'strong') st.push('box-shadow:0 12px 30px rgba(0,0,0,.5)'); else if (L.shadow === 'glow') st.push(`box-shadow:0 0 22px color-mix(in srgb,${glow} 60%,transparent)`);
  if (L.pad !== undefined) st.push(`--px:${L.pad}px`, `--py:${L.pad}px`);
  const tcc = L.tc || ((L.bgMode === 'solid' || L.bgMode === 'gradient') && L.bg && a >= 60 ? inkOf(L.bg) : '');     // readable text on a dark or light custom background
  if (tcc) cls.push('custombg'); if (tcc) st.push(`color:${tcc}`, `--text:${tcc}`, `--muted:color-mix(in srgb,${tcc} 68%,transparent)`, `--faint:color-mix(in srgb,${tcc} 52%,transparent)`);
  if (L.tAlign) tl.push(`text-align:${L.tAlign}`); if (L.tSize) tl.push(`font-size:${L.tSize}px`); if (L.tColor || c.color) tl.push(`color:${L.tColor || c.color}`);
  if (L.tUpper) tl.push('text-transform:uppercase', 'letter-spacing:.06em'); if (L.tAlign === 'center' || L.tAlign === 'right') tl.push('flex:1');
  if (L.tBar && L.tBar !== 'none') { const b1 = L.tBarC || 'var(--accent)', b2 = L.tBarC2 || (L.tBarC ? L.tBarC : 'color-mix(in srgb, var(--accent) 45%, #000)'); cls.push('tbar'); hd.push(L.tBar === 'gradient' ? `background:linear-gradient(90deg,${b1},${b2})` : `background:${b1}`, `color:${L.tColor || inkOf(b1)}`); if (!L.tColor) tl.push(`color:${inkOf(b1)}`); }
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
  ['powerbi', 'Business', 'Clean white cards on a light grey page, blue accent.'], ['grafana', 'Operations', 'Dark flat panels; alarm cards turn solid green or red.'],
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
    if (pal && ['pie', 'bar', 'treemap', 'table', 'bargauge', ...NEWRANK].includes(t.type)) c.pal = pal;
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
const T = (id, type, title, x, y, w, h, cfg = {}) => ({ id, type, title, x, y, w, h, cfg });
const SEC = (id, title, y) => T(id, 'section', title, 0, y, 12, 1);
const sysKpis = (y, ds) => [['k_total', 'total', 'Messages'], ['k_err', 'errors', 'Errors and worse'], ['k_hosts', 'hosts', 'Devices reporting']].map(([id, metric, title], i) => T(id, 'kpi', title, i * 2, y, 2, 3, { metric, ...(ds ? { ds } : {}) }))
  .concat([['k_eps', 'eps', 'Messages / second'], ['k_stored', 'stored', 'Stored messages'], ['k_silent', 'silent', 'Silent devices']].map(([id, metric, title], i) => T(id, 'kpi', title, 6 + i * 2, y, 2, 3, { metric })));
const devKpis = (y, w = 2) => [['dvAll', 'Devices known'], ['dvReporting', 'Reporting normally'], ['dvSilent', 'Silent'], ['dvMuted', 'Muted'], ['dvOverdue', 'Overdue'], ['dvAlarms', 'With open alarms']].slice(0, 12 / w).map(([metric, title], i) => T('d_' + metric.toLowerCase(), 'kpi', title, i * w, y, w, 3, { ds: 'devices', metric }));
const POLL_NOTE = 'To show readings of your polled devices here (for example every Temperature reading in one table), click Customize, then Add tile, then Polled devices and readings.';
/** the first sheet ("Overview"): a little of everything, one heading per area */
function defaultTiles() {
  return [SEC('sec_al', 'Alarms', 0), ...alarmTiles(1),
    SEC('sec_sys', 'Syslog', 4), ...sysKpis(5),
    T('t_trend', 'trend', 'Messages over time', 0, 8, 8, 8), T('t_sev', 'sevbars', 'Severity breakdown', 8, 8, 4, 8),
    SEC('sec_snmp', 'SNMP traps', 16), T('s_k_total', 'kpi', 'Traps', 0, 17, 2, 3, { metric: 'total', filter: { source: 'snmp' } }), T('s_k_err', 'kpi', 'Trap errors and worse', 2, 17, 2, 3, { metric: 'errors', filter: { source: 'snmp' } }),
    T('s_k_dev', 'kpi', 'Devices sending traps', 4, 17, 2, 3, { metric: 'hosts', filter: { source: 'snmp' } }), T('s_io', 'snmpstatus', 'SNMP trap receiver', 6, 17, 6, 3),
    SEC('sec_poll', 'SNMP polling', 20), T('p_stat', 'poll', 'Polled devices', 0, 21, 8, 6, { poll: { src: 'status', view: 'tiles', shape: 'round', hours: 6, picks: [] } }), T('p_alm', 'poll', 'Polling alarms', 8, 21, 4, 6, { poll: { src: 'alarms', view: 'tiles', hours: 6, picks: [] } }),
    SEC('sec_dev', 'Devices', 27), ...devKpis(28, 3).slice(0, 4),
    T('t_latest', 'latest', 'Latest errors and worse', 0, 31, 8, 9, { n: 10, filter: { severityMax: 3 } }), T('t_io', 'io', 'Inputs and alert delivery', 8, 31, 4, 9)];
}
/** the other sheets, each about one subject only */
const SHEET_DEFS = {
  alarms: { name: 'Alarms', tiles: () => [...alarmTiles(0),
    T('a_avg', 'kpi', 'Average time to clear', 0, 3, 4, 4, { ds: 'alarms', metric: 'alAvgClear' }), T('a_dev', 'kpi', 'Devices with alarms', 4, 3, 4, 4, { ds: 'devices', metric: 'dvAlarms' }), T('a_spark', 'statspark', 'Alarms raised', 8, 3, 4, 4, { ds: 'alarms', metric: 'alRaised', graph: 'area' }),
    T('a_trend', 'trend', 'Alarms over time', 0, 7, 8, 8, { ds: 'alarms' }), T('a_sev', 'pie', 'Alarms by severity', 8, 7, 4, 8, { ds: 'alarms', by: 'severity', n: 8, style: 'donut' }),
    T('a_rule', 'bar', 'Alarms by rule', 0, 15, 4, 8, { ds: 'alarms', by: 'rule', n: 8 }), T('a_host', 'top', 'Devices with most alarms', 4, 15, 4, 8, { ds: 'alarms', by: 'host', n: 8 }), T('a_state', 'pie', 'Alarms by state', 8, 15, 4, 8, { ds: 'alarms', by: 'state', n: 6, style: 'donut' }),
    T('a_latest', 'latest', 'Latest alarms', 0, 23, 12, 10, { ds: 'alarms', n: 10 })] },
  syslog: { name: 'Syslog', tiles: () => [...sysKpis(0, 'syslog'),
    T('y_trend', 'trend', 'Messages over time', 0, 3, 8, 8, { ds: 'syslog' }), T('y_sev', 'sevbars', 'Severity breakdown', 8, 3, 4, 8, { ds: 'syslog' }),
    T('y_rate', 'rate', 'Messages per second', 0, 11, 4, 7), T('y_hosts', 'top', 'Busiest devices', 4, 11, 4, 7, { ds: 'syslog', by: 'host', n: 8 }), T('y_apps', 'top', 'Busiest processes', 8, 11, 4, 7, { ds: 'syslog', by: 'app', n: 8 }),
    T('y_pie', 'pie', 'Messages by device', 0, 18, 4, 8, { ds: 'syslog', by: 'host', n: 6, style: 'donut' }), T('y_heat', 'heat', 'Busiest devices over time', 4, 18, 8, 8, { ds: 'syslog', mode: 'hostTime', n: 8 }),
    T('y_latest', 'latest', 'Latest errors and worse', 0, 26, 8, 9, { ds: 'syslog', n: 10, filter: { severityMax: 3 } }), T('y_io', 'io', 'Inputs and alert delivery', 8, 26, 4, 9)] },
  wall: { name: 'NOC wall', tiles: () => [
    T('w_active', 'kpi', 'Active alarms', 0, 0, 6, 6, { ds: 'alarms', metric: 'alActive' }), T('w_err', 'kpi', 'Errors and worse', 6, 0, 3, 6, { metric: 'errors' }), T('w_silent', 'kpi', 'Silent devices', 9, 0, 3, 6, { metric: 'silent' }),
    T('w_sev', 'sevbars', 'Severity breakdown', 0, 6, 4, 10, { ds: 'syslog' }), T('w_latest', 'latest', 'Active alarms', 4, 6, 8, 10, { ds: 'alarms', n: 8, filter: { astate: 'active' } }),
    T('w_trend', 'trend', 'Messages over time', 0, 16, 12, 7)] },
  traps: { name: 'SNMP traps', tiles: () => snmpTiles(0) },
  polling: { name: 'SNMP polling', tiles: () => [
    T('p_stat', 'poll', 'Polled devices', 0, 0, 8, 8, { poll: { src: 'status', view: 'tiles', shape: 'round', hours: 6, picks: [] } }), T('p_alm', 'poll', 'Polling alarms', 8, 0, 4, 8, { poll: { src: 'alarms', view: 'tiles', hours: 6, picks: [] } }),
    T('p_note', 'text', 'Readings', 0, 8, 12, 3, { text: POLL_NOTE })] },
  devices: { name: 'Devices', tiles: () => [...devKpis(0),
    T('d_pie', 'pie', 'Devices by status', 0, 3, 4, 8, { ds: 'devices', by: 'status', n: 6, style: 'donut' }), T('d_vendor', 'pie', 'Devices by vendor', 4, 3, 4, 8, { ds: 'devices', by: 'vendor', n: 8, style: 'donut' }), T('d_kind', 'pie', 'What devices send', 8, 3, 4, 8, { ds: 'devices', by: 'kind', n: 4, style: 'donut' }),
    T('d_bar', 'bar', 'Devices by group', 0, 11, 6, 8, { ds: 'devices', by: 'group', n: 10 }), T('d_silent', 'silent', 'Silent devices', 6, 11, 6, 8),
    T('d_latest', 'latest', 'Devices', 0, 19, 12, 9, { ds: 'devices', n: 10 })] }
};
const defaultSheets = () => Object.entries(SHEET_DEFS).map(([id, d]) => ({ id, name: d.name, tiles: d.tiles() }));
const SHEET_ICON = {
  main: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  alarms: '<path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4z"/><path d="M10 21h4"/>',
  syslog: '<path d="M4 6h16M4 12h11M4 18h7"/>',
  traps: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  wall: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  polling: '<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>',
  devices: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-5M12 16V8M16 16v-3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  shield: '<path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.5-7 10-7 10z"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0"/><path d="M12 20h.01"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.5 1.5A3.5 3.5 0 0 1 17 18z"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  flame: '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .5 1.5 1.5 2 2 2 0-3-1-5 1-8z"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  other: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12h8"/>'
};
const ICON_NAMES = ['main', 'alarms', 'syslog', 'traps', 'polling', 'devices', 'chart', 'globe', 'shield', 'heart', 'wifi', 'cloud', 'cpu', 'clock', 'map', 'star', 'flame', 'lock'];

/** time range -> { from, to, rolling, label } */
function rangeOf(r, now = Date.now()) {
  r = r || { preset: '24h' }; const p = PRESETS.find((x) => x[0] === r.preset) || PRESETS[3];
  const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const fmt = (t) => `${dateOf(t)} ${hhmm(t)}`;
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
/** Packs the tiles upward (one list, no zones). Runs only after you move, resize, add or remove a tile, never while the dashboard is just opened. */
function settle(items, fixedId) { settleZone(items, items.find((i) => i.id === fixedId), 0); return items; }
const overlaps = (list) => list.some((a, i) => list.some((b, j) => j > i && hit(a, b)));

/** the last numbers of every dashboard sheet: reopening the page or switching sheets paints these at once while fresh numbers load */
const DASH_MEMO = new Map();
/** 1.99.2 the polled readings and devices for the tile editor (loaded when needed, kept for a minute) */
const POLLMETA = { data: null, at: 0, async load() { if (this.data && Date.now() - this.at < 60000) return this.data; try { const [k, d] = await Promise.all([api('/api/poll/keys?for=dash'), api('/api/poll/devices')]); this.data = { keys: k.keys || [], devices: (d.devices || []).map((x) => ({ id: x.id, name: x.name || x.host })) }; this.at = Date.now(); } catch { this.data = { keys: [], devices: [] }; } return this.data; } };

views.dashboard = (el) => {
  let editing = false, tiles = null, data = null, health = null, devices = null, lastAt = 0, timer = null, fetching = false;
  const cache = new Map();                                    // tile id -> last painted html (skip needless repaints)
  el.innerHTML = `<div class="page-head dash-head"><h1>Dashboard<span class="dsheetname" id="dSheetName"></span></h1>
    <select id="dBoard" aria-label="Which dashboard" title="Your saved dashboards"></select>
    <select id="dRange" aria-label="Time range">${PRESETS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
    <span id="dCustom" hidden><input type="datetime-local" id="dFrom" aria-label="From"> to <input type="datetime-local" id="dTo" aria-label="To"> <button id="dApply">Apply</button></span>
    <span class="muted" id="dInfo"></span><span class="spacer"></span>
    <span id="dHid" hidden><span id="dEditBar" hidden><button id="dAdd">Add tile</button><button id="dCancel" title="Throw away the changes made since you clicked Customize">Cancel</button><button id="dSave" title="Keep a copy of this dashboard under a new name">Save as…</button><button id="dAurora" title="Add the ready-made Aurora dashboard: gradient numbers, charts and a sheet each for alarms, traffic, traps and devices">Ready-made: Aurora</button><button id="dNew" title="Start an empty dashboard, then add the tiles you want (Reset layout brings back the standard tiles)">New dashboard</button><button id="dRen">Rename</button><button id="dExp" title="Download this dashboard as a file (to back it up or give it to a colleague)">Export…</button><button id="dImp" title="Add a dashboard from a file exported by NetEventPro">Import…</button><button id="dDel" class="danger">Delete</button><button id="dSet" title="Page background, colour theme, spacing, corners, refresh rate">Dashboard settings</button><button id="dReset">Reset layout</button><button id="dShAdd">Add sheet</button><button id="dShRen">Rename sheet</button><button id="dShIco">Sheet icon</button><button id="dShDel">Delete sheet</button></span>
    <button id="dWallLink" title="Copy a link that opens this dashboard straight in wall display mode (the wall computer signs in once)">Wall link</button><button id="dWall" title="Show this dashboard full screen without menus, for a wall display">Wall display</button><button id="dRefresh" title="Reload the numbers now">Refresh</button><button id="dEdit">Customize</button></span><button id="dDone" class="primary" hidden title="Finish customizing">Done</button><button id="dWallBtn" class="dwall" type="button" aria-label="Wall display" title="Wall display: this dashboard full screen without menus (Esc leaves it)"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4" width="19" height="12.5" rx="2.5"/><path d="M8 20.5h8M12 16.5v4"/><path d="M8.5 9V7.5H10M15.5 9V7.5H14M8.5 11.5V13H10M15.5 11.5V13H14"/></svg></button><span class="dmore"><button id="dMore" aria-haspopup="menu" aria-expanded="false" aria-label="Dashboard menu" title="Dashboard menu">&#8942;</button><div class="dmenu" id="dMenu" role="menu" hidden><button role="menuitem" data-go="dRefresh">Refresh now</button><button role="menuitem" data-go="dWallLink">Copy wall link</button><hr><button role="menuitem" data-go="dEdit" id="dmEdit">Customize</button><button role="menuitem" data-sub="dSub" aria-expanded="false">New dashboard &#9656;</button><div class="dsub" id="dSub" hidden><button role="menuitem" data-go="dAurora">Ready-made: Aurora</button><button role="menuitem" data-go="dNew">Empty dashboard</button><button role="menuitem" data-go="dAdd" data-edit="1">Add tile…</button><button role="menuitem" data-go="dSave">Save as…</button></div><button role="menuitem" data-go="dRen">Rename…</button><hr><button role="menuitem" data-go="dShAdd">Add sheet…</button><button role="menuitem" data-go="dShRen">Rename this sheet…</button><button role="menuitem" data-go="dShIco">Change sheet icon…</button><button role="menuitem" data-go="dShDel" class="danger" id="dmShDel">Delete this sheet</button><hr><button role="menuitem" data-go="dExp">Export…</button><button role="menuitem" data-go="dImp">Import…</button><hr><button role="menuitem" data-go="dSet">Dashboard settings</button><button role="menuitem" data-go="dReset">Reset layout</button><button role="menuitem" data-go="dDel" class="danger">Delete this dashboard</button></div></span></div>
    <div class="dgrid" id="dgrid"></div>`;
  const grid = $('#dgrid', el);

  // ----- sheets (1.73): several pages in one dashboard. The first sheet ("main", shown as Overview) lives in dash.tiles, the others in dash.sheets -----
  let sheetId = 'main';
  const sheetKey = () => 'ne.sheet.' + (boardId || 'main');
  const extraSheets = () => (Array.isArray(SP.dash?.sheets) ? SP.dash.sheets : []);
  const sheetList = () => [{ id: 'main', name: SP.dash?.mainName || 'Overview', icon: SP.dash?.mainIcon }, ...extraSheets()];
  const sheetRef = () => (sheetId === 'main' ? null : extraSheets().find((x) => x.id === sheetId) || null);
  function initSheets() {
    if (!boardId && SP.dash?.sheets === undefined && !SP.dash?.blank) { SP.dash = { ...(SP.dash || {}), sheets: defaultSheets() }; keep(); }    // the main dashboard gets the standard sheets once
    else if (!boardId && Array.isArray(SP.dash?.sheets) && !SP.dash.wallAdded && !SP.dash.sheets.some((s) => s.id === 'wall')) { SP.dash = { ...SP.dash, wallAdded: 1, sheets: [...SP.dash.sheets, { id: 'wall', name: SHEET_DEFS.wall.name, tiles: SHEET_DEFS.wall.tiles() }] }; keep(); }    // 1.83: one new sheet, added once to a dashboard that already has sheets (delete it if you do not want it)
    let want = 'main'; try { want = localStorage.getItem(sheetKey()) || 'main'; } catch { /* blocked storage */ }
    sheetId = sheetList().some((x) => x.id === want) ? want : 'main';
  }
  const getTiles = () => {
    if (tiles) return tiles;
    if (sheetId !== 'main') { const sh = sheetRef(); if (!sh) sheetId = 'main'; else { tiles = structuredClone(sh.tiles || []); if (overlaps(tiles)) settle(tiles, null); return tiles; } }
    if (!SP.dash?.tiles?.length) return SP.dash?.blank ? (tiles = []) : (tiles = settle(defaultTiles(), null));      // a blank dashboard (New dashboard, 1.42.1) stays empty until tiles are added
    tiles = structuredClone(SP.dash.tiles);
    if (!SP.dash.snmpTiles) {           // a layout saved before SNMP traps existed: add the trap tiles once at the bottom (they can be removed or moved like any tile)
      if (!tiles.some((x) => x.id.startsWith('s_'))) tiles.push(...snmpTiles(Math.max(0, ...tiles.map((x) => x.y + x.h))));
      SP.dash = { ...SP.dash, snmpTiles: true, tiles: structuredClone(tiles) }; keep();
    }
    if (!SP.dash.alarmTiles) {          // the alarm banner became ordinary tiles (1.35): carry over its titles, colours, order and visibility once
      const ab = SP.dash.alarmBar || {}, order = [...(ab.order || []).filter((k) => AL_ORDER.includes(k)), ...AL_ORDER.filter((k) => !(ab.order || []).includes(k))];
      if (!tiles.some((x) => x.type === 'alarm') && !ab.hide) {
        const shown = order.filter((k) => ab.cards?.[k]?.show !== false), per = ab.cols || shown.length || 1, w = Math.max(2, Math.floor(12 / per)), h = ab.style === 'compact' ? 2 : ab.style === 'large' ? 4 : 3;
        const al = shown.map((k, i) => ({ id: 'al_' + k, type: 'alarm', title: ab.cards?.[k]?.title || AL_CARDS[k], x: (i % per) * w, y: Math.floor(i / per) * h, w, h, cfg: { card: k, ...(ab.cards?.[k]?.color ? { color: ab.cards[k].color } : {}) } }));
        tiles.push(...al);
      }
      const nd = { ...SP.dash, alarmTiles: true }; delete nd.alarmBar; settle(tiles, null); SP.dash = { ...nd, tiles: structuredClone(tiles) }; keep();
    }
    if (tiles.some((x) => x.type === 'alarm')) {     // the alarm cards became ordinary number tiles on the "Alarms" data (1.36)
      for (const x of tiles) if (x.type === 'alarm') { const { card, ...rest } = x.cfg || {}; x.type = 'kpi'; x.cfg = { ...rest, ds: 'alarms', metric: AL_MIG[card] || 'alActive' }; }
      SP.dash = { ...SP.dash, tiles: structuredClone(tiles) }; keep();
    }
    if (overlaps(tiles)) settle(tiles, null);        // 1.73: a saved layout whose tiles overlap is repaired once; a good layout is never rearranged on opening
    return tiles;
  };
  const saveTiles = () => {
    if (sheetRef()) { SP.dash = { ...SP.dash, sheets: extraSheets().map((x) => (x.id === sheetId ? { ...x, tiles: structuredClone(getTiles()) } : x)) }; return keep(); }
    SP.dash = { ...(SP.dash || {}), alarmTiles: true, snmpTiles: true, tiles: structuredClone(getTiles()) }; if (!SP.dash.tiles.length) SP.dash.blank = true; else delete SP.dash.blank; keep();
  };
  const mainTiles = () => (sheetId === 'main' ? getTiles() : SP.dash?.tiles?.length ? SP.dash.tiles : SP.dash?.blank ? [] : settle(defaultTiles(), null));
  const range = () => rangeOf(SP.dash?.range);
  const metricOf = (t) => METRICS[t.cfg?.metric] || METRICS.total;
  const isRanged = (t) => (t.type === 'kpi' || t.type === 'gauge') ? !!metricOf(t).ranged || dsKind(t) !== 'system' : ['trend', 'sevbars', 'top', 'latest', 'pie', 'line', 'heat', 'bar', 'treemap', 'table', 'bargauge', 'statspark', ...NEWRANK].includes(t.type);

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
    const nar = narrow(), half = (g.W - GRID.gap) / 2; let pend = null;      // phone: two small number tiles side by side
    const put = (id, l, tp, w, h) => { const n = $(`[data-id="${id}"]`, grid); if (!n || id === skipId) return; n.style.left = l + 'px'; n.style.top = tp + 'px'; n.style.width = w + 'px'; n.style.height = h + 'px'; };
    for (const t of order) {
      if (nar && t.type !== 'section' && t.w <= 3 && t.h <= 3) {
        const h = Math.max(t.h, 3) * GRID.row + (Math.max(t.h, 3) - 1) * GRID.gap;
        if (pend) { put(t.id, half + GRID.gap, pend.top, half, pend.h); stack = pend.top + Math.max(pend.h, h) + GRID.gap; bottom = Math.max(bottom, stack - GRID.gap); pend = null; }
        else { pend = { top: stack, h }; put(t.id, 0, stack, half, h); stack += h + GRID.gap; bottom = Math.max(bottom, stack - GRID.gap); }
        continue;
      }
      if (pend) pend = null;
      const r = rect(t, g, stack); stack += r.height + GRID.gap; bottom = Math.max(bottom, r.top + r.height);
      put(t.id, r.left, r.top, r.width, r.height);
    }
    grid.style.height = (bottom + (editing ? 80 : 0)) + 'px';
  }

  // ----- frames (the boxes); their contents are painted separately -----
  /** a tile under a section heading needs no source chip: the heading already says it */
  const secAbove = (t) => getTiles().some((x) => x.type === 'section' && x.y <= t.y);
  function frames() {
    cache.clear();
    grid.classList.toggle('editing', editing && !narrow());
    grid.innerHTML = getTiles().map((t) => { if (t.type === 'section') { const k = lookOfSec(t); return `<div class="dsec" data-id="${t.id}" data-type="section" ${k.style ? `style="${k.style}"` : ''}><b ${k.title ? `style="${k.title}"` : ''}>${esc(t.title)}</b><span class="muted" id="sec_${t.id}"></span>${editing ? `<span class="spacer"></span><button data-a="seccfg" data-sid="${t.id}" title="Rename this section and change its look">Edit</button>` : ''}</div>`; }
      const k = lookOf(t), ib = iconBits(t); return `<section class="widget panel ${k.cls}${ib.box ? ' has-ico' : ''}${ib.cls}" data-id="${t.id}" data-type="${t.type}" ${k.style || ib.vars ? `style="${k.style || ''}${k.style && !/;\s*$/.test(k.style) ? ';' : ''}${ib.vars}"` : ''}>${ib.box}
      <div class="whead ${k.hideTitle && !editing ? 'nohead' : ''}" ${k.head ? `style="${k.head}"` : ''} ${editing ? 'tabindex="0" title="Drag to move. Arrow keys move, Shift+arrows resize."' : ''}>${k.hideTitle ? '' : `<h2 class="wtitle" ${k.title ? `style="${k.title}"` : ''}>${ib.title}${esc(t.title || TYPES[t.type].label)}</h2>${hasDs(t) && t.cfg?.look?.tSrc !== false && !secAbove(t) ? `<span class="srcchip" data-ds="${dsOf(t)}" title="${esc(DS[dsOf(t)].chip + ': ' + DS[dsOf(t)].desc)}">${esc(t.w <= 2 ? DS[dsOf(t)].short : DS[dsOf(t)].chip)}</span>` : ''}`}<span class="spacer"></span>
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
  const defBy = (t) => { const k = dsKind(t); if (k === 'poll') return 'device'; return t.type === 'pie' ? (k === 'devices' ? 'status' : 'severity') : k === 'devices' ? 'vendor' : 'host'; };
  const byOf = (t) => { const k = dsKind(t), b = t.cfg?.by; return (BYS[k] || BYS.events).some((x) => x[0] === b) ? b : defBy(t); };
  function requestsFor(list) {
    const out = [], slicer = '';   // 1.71 the per-device filter box was removed; a filter saved earlier is ignored
    for (const t of list) {
      if (!hasDs(t)) continue;
      const ds = dsOf(t), kd = DS[ds].kind, c = t.cfg || {}, f = { ...(c.filter || {}) }, n = c.n, dq = kd === 'events' ? {} : { ds: kd };
      if (kd === 'poll') {   // 1.99.2 polled readings: the same answers as messages (a number, a series, a ranking), read from the polling data
        const pq = { ds: 'poll', k: c.pk || '', devs: c.pdevs || [], inst: c.pinst || '*', pagg: c.pagg || 'avg', per: byOf(t), n: n || 10 };
        if (t.type === 'kpi' || t.type === 'gauge') { out.push({ id: t.id, kind: 'count', ...pq }); if (t.type === 'kpi' && c.graph && c.graph !== 'none') out.push({ id: t.id + '_g', kind: 'series', ...pq, per: 'all' }); }
        else if (t.type === 'statspark') { out.push({ id: t.id, kind: 'series', ...pq, per: 'all' }); out.push({ id: t.id + '_n', kind: 'count', ...pq }); }
        else if (t.type === 'line') out.push({ id: t.id, kind: 'series', ...pq });
        else if (t.type === 'pie' || TOPLIKE[t.type] || t.type === 'top') out.push({ id: t.id, kind: 'top', ...pq, n: Math.min(n || 8, t.type === 'pie' ? 12 : 50) });
        continue;
      }
      if (kd === 'events') { if (c.ds) f.source = DS[ds].src; if (slicer) f.host = slicer; } else if (kd === 'alarms') { if (slicer) f.host = slicer; }
      if (kd !== 'devices') delete f.dstate; if (kd !== 'alarms') delete f.astate;
      if (t.type === 'kpi' || t.type === 'gauge') {
        const m = c.metric || 'total', M = METRICS[m];
        if (M?.srv) {
          const q = metricReq(t.id, m, f); if (q) out.push(q);
          if (c.calc?.op && c.calc.op !== 'none' && ['pct', 'ratio', 'diff', 'sum'].includes(c.calc.op) && METRICS[c.calc.bm]?.srv) { const fb = {}; if (slicer && METRICS[c.calc.bm].k !== 'devices') fb.host = slicer; const qb = metricReq(t.id + '_b', c.calc.bm, fb); if (qb) out.push(qb); }
          if (t.type === 'kpi' && c.graph && c.graph !== 'none' && kd !== 'devices') out.push({ id: t.id + '_g', kind: 'series', ...dq, filter: { ...f, ...(m === 'errors' ? { severityMax: 3 } : {}), ...(M.astate ? { astate: M.astate } : {}) } });
        }
      } else if (t.type === 'statspark') {
        const m = c.metric || 'total', fs = { ...f }; if (kd === 'alarms') fs.astate = m === 'alCleared' ? 'cleared' : 'raised';   // 1.99.2 the line follows the chosen alarm number (it always showed raised alarms)
        if (kd === 'events') { if (m === 'errors') fs.severityMax = Math.min(fs.severityMax ?? 7, 3); if (m === 'warnings') { fs.severityMax = Math.min(fs.severityMax ?? 7, 4); fs.severityMin = Math.max(fs.severityMin ?? 0, 4); } }
        out.push({ id: t.id, kind: 'series', ...dq, filter: fs });
        if (kd === 'events' && (m === 'hosts' || m === 'perMinute')) { const q = metricReq(t.id + '_n', m, f); if (q) out.push(q); }
      } else if (t.type === 'trend' || t.type === 'line') out.push({ id: t.id, kind: 'series', ...dq, filter: f });
      else if (t.type === 'sevbars') out.push({ id: t.id, kind: 'top', ...dq, by: 'severity', n: 8, filter: f });
      else if (t.type === 'top') out.push({ id: t.id, kind: 'top', ...dq, by: byOf(t), n: n || 8, filter: f });
      else if (t.type === 'latest') out.push({ id: t.id, kind: 'list', ...dq, n: n || 8, filter: f });
      else if (t.type === 'pie') out.push({ id: t.id, kind: 'top', ...dq, by: byOf(t), n: Math.min(n || 6, 12), filter: f });
      else if (TOPLIKE[t.type]) out.push({ id: t.id, kind: 'top', ...dq, by: byOf(t), n: Math.min(n || (t.type === 'table' ? 10 : 8), TOPLIKE[t.type]), filter: f });
      else if (t.type === 'heat') out.push({ id: t.id, kind: t.cfg?.mode === 'dowHour' ? 'heatDow' : 'heatHost', n: n || 10, tz: -new Date().getTimezoneOffset(), filter: f });
    }
    return out;
  }
  let again = false;
  async function load(force = true) {
    if (fetching) { again = true; return; } fetching = true;
    const key = memoKey();
    try {
      const r = range(), reqs = requests(), t = getTiles(), got = {};
      const jobs = [];
      if (reqs.length && (force || r.rolling || !data)) jobs.push(api('/api/dash', { method: 'POST', body: { from: r.from, to: r.to, tiles: reqs } }).then((d) => { got.data = d; }));
      if (t.some((x) => x.type === 'poll')) jobs.push(loadPoll(t));
      if (t.some((x) => x.type === 'health' || ((x.type === 'kpi' || x.type === 'gauge') && x.cfg?.metric === 'diskFree'))) jobs.push(api('/api/health').then((h) => { got.health = h; }));
      if (t.some((x) => x.type === 'silent' || x.type === 'devwall')) jobs.push(api('/api/devices').then((d) => { got.devices = d; }));
      if (t.some((x) => x.type === 'alarm')) jobs.push(loadAlarms());
      await Promise.all(jobs);
      if (key === memoKey()) {          // the answer is for the sheet that is still shown (you may have switched sheets while it was loading)
        if ('data' in got) data = got.data; if ('health' in got) health = got.health; if ('devices' in got) devices = got.devices;
        lastAt = Date.now(); DASH_MEMO.set(key, { data, health, devices, alarmData, at: lastAt });
        $('#dInfo', el).textContent = `${r.label.charAt(0).toUpperCase() + r.label.slice(1)} · updated ${timeOf(lastAt, false)}`;
        paint();
      }
    } catch (e) { $('#dInfo', el).textContent = 'Could not load: ' + e.message; } finally { fetching = false; if (again) { again = false; load(); } }
  }
  let alarmData = null;
  const memoKey = () => `${boardId}|${sheetId}|${JSON.stringify(SP.dash?.range || {})}`;
  /** paint the numbers of the last visit of this sheet (if any) before the fresh ones arrive */
  function memoPaint() { const m = DASH_MEMO.get(memoKey()); if (!m || Date.now() - m.at > 900000) return false; ({ data, health, devices, alarmData } = m); lastAt = m.at; paint(); return true; }
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
    const d = el.dataset; d.card = ['raised', 'outline'].includes(s.card) ? s.card : 'solid'; d.titles = s.titles === 'upper' ? 'upper' : 'normal';
    if (s.radius != null) el.style.setProperty('--dr', s.radius + 'px'); else el.style.removeProperty('--dr');
    el.style.background = ''; el.style.removeProperty('--accent'); el.style.removeProperty('--link');   // 1.69 colours come from the application colour theme only
  }
  function styleDialog() {
    const s = { ...(SP.dash?.style || {}) }, back = document.createElement('div'); back.className = 'modal-back';
    const sel = (id, label, opts, cur) => `<div class="field"><label for="${id}">${label}</label><select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
    back.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-label="Dashboard settings"><h3 style="margin:0 0 4px">Dashboard settings</h3><p class="muted" style="margin:0 0 12px">Settings for the whole page. Saved for everyone who opens this dashboard. The application colour theme is chosen under Settings.</p><div class="form">
      ${sel('stCard', 'Card style', [['solid', 'Solid (flat)'], ['raised', 'Raised (shadow)'], ['outline', 'Outline only']], s.card || 'solid')}
      ${sel('stTitles', 'Tile titles', [['normal', 'Normal'], ['upper', 'Small capitals']], s.titles || 'normal')}
      <div class="field"><label for="stRadius">Corner radius</label><div><input type="range" id="stRadius" min="0" max="24" value="${s.radius ?? 8}"> <output id="stRadiusO">${s.radius ?? 8}px</output></div></div>
      <div class="field"><label for="stGap">Space between tiles</label><div><input type="range" id="stGap" min="4" max="24" value="${s.gap ?? 12}"> <output id="stGapO">${s.gap ?? 12}px</output></div></div>
      ${sel('stDens', 'Row height', [['compact', 'Compact'], ['normal', 'Normal'], ['comfortable', 'Comfortable']], s.density || 'normal')}
      ${sel('stRef', 'Refresh the numbers', [[5, 'Every 5 seconds'], [10, 'Every 10 seconds (default)'], [30, 'Every 30 seconds'], [60, 'Every minute'], [300, 'Every 5 minutes'], [0, 'Only when I press Refresh']], s.refresh ?? 10)}
      </div><div class="toolbar" style="margin:14px 0 0"><button type="button" id="stReset">Reset style</button><span class="spacer"></span><button type="button" id="mCancel">Cancel</button><button type="submit" class="primary">Save</button></div></form>`;
    document.body.appendChild(back); const q = (id) => $('#' + id, back), close = () => back.remove();
    const read = () => { const o = { card: q('stCard').value, titles: q('stTitles').value, gap: +q('stGap').value, density: q('stDens').value, refresh: +q('stRef').value }; if (q('stRadius').dataset.t || s.radius != null) o.radius = +q('stRadius').value; return o; };
    const live = () => { SP.dash = { ...(SP.dash || {}), style: read() }; q('stRadiusO').textContent = q('stRadius').value + 'px'; q('stGapO').textContent = q('stGap').value + 'px'; applyStyle(); place(); paint(); };
    back.addEventListener('input', (e) => { if (e.target.id === 'stRadius') e.target.dataset.t = '1'; });
    back.addEventListener('input', live); back.addEventListener('change', live);
    const undo = () => { SP.dash = { ...(SP.dash || {}), style: orig }; if (!orig) delete SP.dash.style; applyStyle(); place(); paint(); close(); };
    const orig = SP.dash?.style ? { ...SP.dash.style } : null;
    $('#mCancel', back).onclick = undo; back.addEventListener('mousedown', (e) => { if (e.target === back) undo(); });
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); undo(); } });
    q('stReset').onclick = () => { delete SP.dash.style; keep(); applyStyle(); place(); paint(); schedule(); close(); };
    $('form', back).onsubmit = (e) => { e.preventDefault(); SP.dash = { ...(SP.dash || {}), style: read() }; keep(); applyStyle(); place(); paint(); schedule(); close(); };
  }
  const schedule = () => { clearInterval(timer); const rf = SP.dash?.style?.refresh ?? 10; if (rf > 0) timer = setInterval(() => load(false), rf * 1000); };   // a fixed range (yesterday, custom) is not re-read; live tiles still refresh

  // ----- painting -----
  const wbOf = (id) => document.getElementById('wb_' + id);
  const setHtml = (id, html) => { if (cache.get(id) === html) return false; cache.set(id, html); const n = wbOf(id); if (n) n.innerHTML = html; return true; };
  const bars = (rows, nameFn, colorFn, linkFn) => { const max = Math.max(1, ...rows.map((r) => r.n)); return `<div class="hostbars">${rows.map((r) => `<div class="row">${linkFn ? linkFn(r) : `<span class="trunc">${nameFn(r)}</span>`}<div class="bar"><i style="width:${(r.n / max) * 100}%;background:${colorFn(r)}"></i></div><span class="num-r">${fmtN(r.n)}</span></div>`).join('')}</div>`; };
  const trend = (a, b) => (b > 0 ? Math.round((a - b) / b * 100) : null);
  const tileValue = (t) => { if (t.type === 'alarm') return alarmInfo(t)?.v ?? null; if (t.type === 'statspark') { const ls = lineSeries({ ...t, cfg: { ...t.cfg, mode: 'total', sc: undefined } }); return ls ? sparkNum(t, ls.lines[0].v) : null; } if (t.type === 'kpi' || t.type === 'gauge') return metricNumber(t); return null; };
  const isAl = (t) => t.type === 'alarm' || (['kpi', 'gauge', 'statspark'].includes(t.type) && dsOf(t) === 'alarms');
  const alarmCol = (t) => { if (t.type === 'alarm') return ({ bad: 'var(--bad)', warn: 'var(--s4)', ok: 'var(--ok)' }[alarmInfo(t)?.cls] || ''); const m = t.cfg?.metric, v = tileValue(t); if (v === null || v === undefined || t.cfg?.calc?.op) return ''; if (['alActive', 'alOpen', 'alEsc'].includes(m)) return v > 0 ? 'var(--bad)' : 'var(--ok)'; if (m === 'alAck') return v > 0 ? 'var(--s4)' : ''; if (m === 'alCleared') return 'var(--ok)'; if (m === 'dvSilent' || m === 'dvOverdue') return v > 0 ? 'var(--bad)' : 'var(--ok)'; return ''; };
  const tintOf = (t) => { if (!['kpi', 'statspark', 'gauge', 'alarm'].includes(t.type)) return ''; const c = t.cfg || {}, m = thMode(c); if (m !== 'bg' && m !== 'grad') return ''; return thColor(c, tileValue(t)) || ''; };
  const valCol = (t) => { const c = t.cfg || {}, m = thMode(c), al = isAl(t) || ['dvSilent', 'dvOverdue'].includes(c.metric); if (al && c.look?.bgMode && (m === 'none' || m === 'value') && !thSteps(c)) return 'inherit'; if (m === 'bg' || m === 'grad') return 'inherit'; if (m === 'value') return thColor(c, tileValue(t)) || (al ? alarmCol(t) : ''); return al ? alarmCol(t) : ''; };
  const numFmt = (c, v) => { const o = c.val || {}; if (typeof v !== 'number') return esc(String(v)); let x; if (o.dec !== undefined) x = v.toLocaleString(undefined, { minimumFractionDigits: o.dec, maximumFractionDigits: o.dec }); else x = fmtN(v); if (o.compact && Math.abs(v) >= 1000) x = Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k'; return x; };
  const decorate = (c, html) => { const o = c.val || {}; return (o.prefix ? `<span class="unit">${esc(o.prefix)}</span>` : '') + html + (o.suffix ? `<small class="unit">${esc(o.suffix)}</small>` : ''); };
  const valStyle = (t, col) => { const o = t.cfg?.val || {}, st = []; if (col) st.push(`color:${readable(col)}`); if (o.size && o.size !== 'auto') st.push(`font-size:${VSIZE[o.size]}px`); return st.join(';'); };
  const alignStyle = (t) => { const a = t.cfg?.val?.align; return a ? `text-align:${a};align-items:${a === 'center' ? 'center' : a === 'right' ? 'flex-end' : 'flex-start'}` : ''; };
  function sparkSvg(v, col, mode) {
    const n = v.length, mx = Math.max(...v), mn = Math.min(...v), lo = mn > 0 && mn > (mx - mn) * 2 ? mn - (mx - mn) * 0.3 : Math.min(0, mn), max = Math.max(lo + 1e-9, mx === lo ? lo + 1 : mx), pts = v.map((y, i) => `${(n < 2 ? 50 : i / (n - 1) * 100).toFixed(1)},${(34 - (y - lo) / (max - lo) * 30).toFixed(1)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">${mode === 'line' ? '' : `<polygon points="0,36 ${pts} 100,36" fill="${col}" opacity=".22"/>`}<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
  }
  const flatSeries = (d) => { let last = null; return d.series.map((a) => { const v = a.filter((x) => x !== null); if (v.length) last = v.reduce((p, q2) => p + q2, 0) / v.length; return last ?? 0; }); };   // 1.99.2 polled: gaps keep the value before
  const sparkOf = (t, col) => { const mode = t.cfg?.graph; if (!mode || mode === 'none') return ''; const d = data?.tiles?.[t.id + '_g']; if (!d?.series) return ''; return sparkSvg(d.groups ? flatSeries(d) : d.series.map((a) => SEVORD.reduce((s2, k) => s2 + a[k], 0)), col, mode); };
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
        if (M.k === 'poll') sub = d.n === null ? 'no value yet' : `${esc(d.label || '')}${d.of > 1 ? ` · ${({ avg: 'average', max: 'highest', min: 'lowest', sum: 'sum', last: 'latest', count: 'number' })[t.cfg?.pagg || 'avg']} of ${d.of}` : ''}`;
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
  const dayish = () => (data ? data.to - data.from > 20 * 3600000 : false);
  function latestHtml(t) {
    const d = data?.tiles?.[t.id]; if (!d) return '<div class="muted">Loading…</div>'; if (d.error) return `<div class="muted">${esc(d.error)}</div>`;
    if (d.alarms) {
      if (!d.alarms.length) return `<div class="empty" style="padding:16px"><b>Nothing found</b>${noData(t)}</div>`;
      return `<table class="data"><tbody>${d.alarms.map((a) => `<tr class="sev-${a.severity}" data-aid="${a.id}" data-q="${esc(a.host)}" data-st="${esc(a.state)}" style="cursor:pointer"><td><span class="sevname">${SEV[a.severity] ?? ''}</span></td><td class="trunc" style="max-width:130px">${esc(a.host)}</td><td class="muted trunc" style="max-width:0;width:100%">${esc(a.rule || a.message || '')}</td><td class="muted" style="white-space:nowrap">${esc(catName('state', a.state))}</td><td class="muted" style="white-space:nowrap">${dayish() ? shortDate(a.last) + ' ' : ''}${timeOf(a.last, false)}</td></tr>`).join('')}</tbody></table>`;
    }
    if (d.devices) {
      if (!d.devices.length) return `<div class="empty" style="padding:16px"><b>Nothing found</b>${noData(t)}</div>`;
      return `<table class="data"><tbody>${d.devices.map((v) => `<tr data-dev="${esc(v.host)}" style="cursor:pointer"><td class="trunc" style="max-width:150px">${esc(v.host)}</td><td class="muted trunc" style="max-width:0;width:100%">${esc(v.vendor || '')}${v.srcIp && v.srcIp !== v.host ? ' · ' + esc(v.srcIp) : ''}</td><td style="white-space:nowrap"><span class="dot" style="background:${catColor('status', v.status, 0)};margin-right:5px"></span>${esc(catName('status', v.status))}</td><td class="muted" style="white-space:nowrap">${v.openAlarms ? fmtN(v.openAlarms) + ' alarms · ' : ''}${v.lastSeen ? timeOf(v.lastSeen, false) : ''}</td></tr>`).join('')}</tbody></table>`;
    }
    if (!d.rows.length) return '<div class="empty" style="padding:16px"><b>Nothing found</b>No messages match in this time range.</div>';
    const long = dayish();
    return `<table class="data"><tbody>${d.rows.map((m) => `<tr class="sev-${m.severity}" data-id="${m.id}" style="cursor:pointer"><td><span class="sevname">${SEV[m.severity]}</span></td><td class="trunc" style="max-width:130px">${esc(m.host)}</td><td class="muted trunc" style="max-width:0;width:100%">${esc(m.message)}</td><td class="muted" style="white-space:nowrap">${long ? shortDate(m.ts) + ' ' : ''}${timeOf(m.ts, false)}</td></tr>`).join('')}</tbody></table>`;
  }
  function paint() { for (const t of getTiles()) paintTile(t); }
  function afterPaint(t, wb) {
    const c = t.cfg || {}, node = wb.closest('.widget'); if (!node) return;
    wb.dataset.lg = c.ch?.legend || 'bottom'; wb.dataset.sm = node.clientHeight && node.clientHeight < 200 ? '2' : node.clientHeight && node.clientHeight < 280 ? '1' : '';   // small tile: smaller legend, or none, so the chart keeps its room
    const col = tintOf(t); node.classList.toggle('tinted', !!col);
    if (col) { const m = thMode(c), a2 = m === 'grad' ? `linear-gradient(135deg,${col},color-mix(in srgb,${col} 55%,#000))` : col; node.style.setProperty('--tint', a2); node.style.setProperty('--tintink', inkOf(/^#/.test(col) ? col : '#888888')); } else { node.style.removeProperty('--tint'); node.style.removeProperty('--tintink'); }
  }
  /** 1.97.3 a chart is drawn again only when something it shows changed (data, options, size, theme): a refresh with the same numbers costs nothing */
  const drawnKey = new Map();
  const chartDue = (t, fresh) => { const wb = wbOf(t.id), k = JSON.stringify([data?.tiles?.[t.id], data?.tiles?.[t.id + '_b'], t.cfg, wb?.clientWidth, wb?.clientHeight, document.documentElement.dataset.theme, document.documentElement.dataset.look, curPalName]); if (!fresh && drawnKey.get(t.id) === k) return false; drawnKey.set(t.id, k); return true; };
  function paintTile(t) {
    const st = S.stats;
    {
      const wb = wbOf(t.id); if (!wb) return; const d = data?.tiles?.[t.id]; curPal = PALETTES[t.cfg?.pal] || null; curPalName = t.cfg?.pal || '';
      if (t.type === 'kpi') setHtml(t.id, kpiHtml(t));
      else if (t.type === 'trend') { if (chartDue(t, setHtml(t.id, '<div class="cwrap"><canvas></canvas></div><div class="legend"></div>'))) drawTrend(t); }
      else if (t.type === 'rate') { if (setHtml(t.id, '<div class="cwrap"><canvas></canvas></div>') || true) drawRate(t); }
      else if (t.type === 'sevbars') {
        if (!d) setHtml(t.id, '<div class="muted">Loading…</div>');
        else { const by = new Map(d.rows.map((r) => [+r.key, r.n])); setHtml(t.id, `<div class="sevbars">${SEVORD.map((i) => { const n = SEV[i]; const v = by.get(i) || 0, max = Math.max(1, ...d.rows.map((r) => r.n)); return `<div class="row"><span>${n}</span><div class="bar"><i style="width:${v / max * 100}%;background:var(--s${i})"></i></div><span class="num-r">${fmtN(v)}</span></div>`; }).join('')}</div>`); }
      } else if (t.type === 'top') {
        if (!d) setHtml(t.id, '<div class="muted">Loading…</div>'); else if (d.error) setHtml(t.id, `<div class="muted">${esc(d.error)}</div>`);
        else {
          const by = byOf(t);
          setHtml(t.id, d.rows.length ? bars(d.rows, (r) => esc(catName(by, r.key)), (r) => curPalOverrides() ? catColor(by, r.key, d.rows.indexOf(r)) : by === 'severity' && SEV[r.key] !== undefined ? `var(--s${r.key})` : by === 'app' ? 'var(--s6)' : (r.worst !== undefined && by === 'host') ? `var(--s${r.worst})` : catColor(by, r.key, 0),
            by === 'host' ? (r) => `<a href="#" class="hostlink2 trunc" data-host="${esc(r.key)}">${esc(r.key)}</a>` : null) : `<div class="muted">${noData(t)}</div>`);
        }
      } else if (t.type === 'latest') setHtml(t.id, latestHtml(t));
      else if (t.type === 'pie') { if (chartDue(t, setHtml(t.id, pieHtml(t)))) drawPie(t); }
      else if (t.type === 'line') { if (chartDue(t, setHtml(t.id, '<div class="cwrap"><canvas></canvas></div><div class="legend"></div>'))) drawLine(t); }
      else if (t.type === 'heat') setHtml(t.id, heatHtml(t));
      else if (t.type === 'gauge') setHtml(t.id, gaugeHtml(t));
      else if (t.type === 'bar') setHtml(t.id, barHtml(t));
      else if (t.type === 'treemap') setHtml(t.id, treemapHtml(t));
      else if (t.type === 'table') setHtml(t.id, tableHtml(t));
      else if (NEWRANK.includes(t.type)) setHtml(t.id, rankVisHtml(t));
      else if (t.type === 'devwall') setHtml(t.id, devWallHtml(t));
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
  const catColor = (by, k, i) => (curPalOverrides() ? palc(i) : by === 'severity' && SEV[k] !== undefined ? css('--s' + k) : (by === 'state' || by === 'status') && STATE_COL[k] ? css(STATE_COL[k]) : palc(i));
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
    for (const x of p.sl) { const a1 = a0 + (x.n / p.total) * Math.PI * 2; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, a1); g.closePath(); g.fillStyle = glassy() ? hexA(x.color, 85) : x.color; g.fill(); g.strokeStyle = glassy() ? 'rgba(255,255,255,.55)' : css('--panel'); g.lineWidth = glassy() ? 1 : 1.5; g.stroke(); arcs.push([a0, a1, x]); a0 = a1; }
    if (donut) { g.beginPath(); g.arc(cx, cy, R * 0.58, 0, Math.PI * 2); if (glassy()) { g.save(); g.globalCompositeOperation = 'destination-out'; g.fill(); g.restore(); g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 1; g.stroke(); } else { g.fillStyle = css('--panel'); g.fill(); } g.fillStyle = css('--text'); g.textAlign = 'center'; g.font = '600 ' + Math.max(12, Math.round(R * 0.3)) + 'px ' + css('--ui'); g.fillText(fmtN(p.total), cx, cy + R * 0.08); g.font = '11px ' + css('--ui'); g.fillStyle = css('--faint'); g.fillText(({ alarms: 'alarms', devices: 'devices' })[dsKind(t)] || 'messages', cx, cy + R * 0.3); }
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
    if (d.groups) return { d, value: true, unit: d.unit, lines: all ? [{ name: d.label || 'Value', color: css('--accent'), v: flatSeries(d) }] : d.groups.map((name, i) => ({ name, color: palc(i), v: d.series.map((a) => a[i]) })) };
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
    const isVal = !!d.groups, stk = stack && !isVal;   // 1.99.2 polled values: their own range (54 V does not start at 0), gaps where nothing was read
    const tops = []; lines.forEach((l, i) => tops.push(l.v.map((v, k) => (v === null ? null : v + (stk && i ? (tops[i - 1][k] || 0) : 0)))));
    const allV = (stk ? tops[tops.length - 1] : lines.flatMap((l) => l.v)).filter((v) => v !== null && Number.isFinite(v));
    let lo = 0, max = Math.max(5, ...allV) * 1.1;
    if (isVal) { const mx = allV.length ? Math.max(...allV) : 1, mn = allV.length ? Math.min(...allV) : 0, sp = (mx - mn) || Math.abs(mx) || 1; lo = mn >= 0 && mn > sp * 2 ? mn - sp * 0.25 : Math.min(0, mn - sp * 0.1); max = mx + sp * 0.12; }
    const x = (i) => padL + (n < 2 ? 0.5 : i / (n - 1)) * (w - padL - 8), y = (v) => padT + (1 - (v - lo) / (max - lo)) * (h - padT - padB);
    g.strokeStyle = css('--line'); g.fillStyle = css('--faint'); g.textAlign = 'right'; g.lineWidth = 1;
    for (let i = 0; i <= 3; i++) { const v = lo + ((max - lo) / 3) * i, yy = y(v); if (grid2) { g.beginPath(); g.moveTo(padL, yy); g.lineTo(w - 4, yy); g.stroke(); } if (axis) g.fillText(Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : (max - lo) < 10 ? +v.toFixed(2) : Math.round(v), padL - 5, yy + 3); }
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i], segs = []; let cur = null; tops[i].forEach((v, k) => { if (v === null) { cur = null; return; } if (!cur) segs.push(cur = []); cur.push([x(k), y(v)]); });
      if (isVal) { for (const sg of segs) { if (fillA > 0) { g.beginPath(); pathPts(g, sg, !!ch.smooth, true); g.lineTo(sg[sg.length - 1][0], y(lo)); g.lineTo(sg[0][0], y(lo)); g.closePath(); let fs = hexA(l.color, fillA); if (grad && /^#/.test(l.color)) { const gr = g.createLinearGradient(0, padT, 0, h - padB); gr.addColorStop(0, hexA(l.color, fillA)); gr.addColorStop(1, hexA(l.color, 0)); fs = gr; } g.fillStyle = fs; g.fill(); }
        g.beginPath(); pathPts(g, sg, !!ch.smooth, true); g.strokeStyle = l.color; g.lineWidth = lw; g.lineJoin = 'round'; g.stroke(); if (ch.pts || sg.length === 1) { g.fillStyle = l.color; for (const [px, py] of sg) { g.beginPath(); g.arc(px, py, Math.max(2, lw + 0.8), 0, 7); g.fill(); } } } continue; }
      const pts = tops[i].map((v, k) => [x(k), y(v)]);
      if (fillA > 0) {
        g.beginPath(); pathPts(g, pts, !!ch.smooth, true);
        if (stack && i) pathPts(g, tops[i - 1].map((v, k) => [x(k), y(v)]).reverse(), false, false); else { g.lineTo(x(n - 1), y(0)); g.lineTo(x(0), y(0)); }
        g.closePath(); let fs = hexA(l.color, fillA); if (grad && /^#/.test(l.color) && !(stack && i)) { const gr = g.createLinearGradient(0, padT, 0, h - padB); gr.addColorStop(0, hexA(l.color, fillA)); gr.addColorStop(1, hexA(l.color, 0)); fs = gr; } g.fillStyle = fs; g.fill();
      }
      g.beginPath(); pathPts(g, pts, !!ch.smooth, true); g.strokeStyle = l.color; g.lineWidth = lw; g.lineJoin = 'round'; if (glassy()) { g.shadowColor = l.color; g.shadowBlur = 9; } g.stroke(); g.shadowBlur = 0;
      if (ch.pts) { g.fillStyle = l.color; for (const [px, py] of pts) { g.beginPath(); g.arc(px, py, Math.max(2, lw + 0.8), 0, 7); g.fill(); } }
    }
    const t0 = data.firstBucket * data.bucketMs, fmt = (ts) => (data.to - data.from > 20 * 3600000 ? shortDate(ts) + ' ' : '') + hhmm(ts);
    if (axis) { g.fillStyle = css('--faint'); g.textAlign = 'left'; g.fillText(fmt(Math.max(t0, data.from)), padL, h - 3); g.textAlign = 'right'; g.fillText(fmt(data.to), w - 4, h - 3); }
    cv.onmousemove = (e) => { const i = Math.round(((e.offsetX - padL) / (w - padL - 8)) * (n - 1)); if (i < 0 || i >= n) { cv.title = ''; return; } const ts = t0 + i * data.bucketMs; cv.title = `${dateOf(ts)} ${hhmm(ts)}\n` + lines.map((l) => `${l.name}: ${l.v[i] === null ? '–' : fmtN(l.v[i])}${isVal && d.unit ? ' ' + d.unit : ''}`).join('\n'); };
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
    const rows = cells.map((row, ri) => `<div class="hm-row${ri % 2 ? ' odd' : ''}"><span class="trunc" title="${esc(labels[ri])}">${esc(labels[ri])}</span>${row.map((v, ci) => { const tip = dow ? `${DOWN[ri]} ${String(ci).padStart(2, '0')}:00 — ${fmtN(v)} messages` : (() => { const ts = (d.firstBucket + ci) * d.bucketMs; return `${labels[ri]} · ${dateOf(ts)} ${hhmm(ts)} — ${fmtN(v)} messages`; })(); return `<i class="hmc shp-${shape}${v ? '' : ' z'}" style="${shade(v)}" title="${esc(tip)}"></i>`; }).join('')}</div>`).join('');
    const foot = dow ? '' : `<div class="hm-row hm-head"><span></span><i style="grid-column:span ${Math.ceil(cols / 2)};text-align:left">${esc(shortDate(d.firstBucket * d.bucketMs) + ' ' + hhmm(d.firstBucket * d.bucketMs))}</i><i style="grid-column:span ${Math.floor(cols / 2) || 1};text-align:right">${esc(shortDate(data.to) + ' ' + hhmm(data.to))}</i></div>`;
    return `<div class="heat${shape === 'hex' || shape === 'hexo' ? ' honey' : ''}" style="--cols:${cols}">${head}${rows}${foot}</div><div class="muted" style="font-size:11.5px;margin-top:4px;display:flex;gap:6px;align-items:center">0 <span class="hmleg" style="background:linear-gradient(90deg, ${theme === 'blue' ? 'transparent, var(--accent)' : THEMES[theme].join(',')})"></span> ${fmtN(max)} messages in one cell</div>`;
  }
  const nOf = (m, d) => { if (!d || d.error) return null; return m === 'perMinute' ? Math.round(d.n / Math.max(1, (data.to - data.from) / 60000) * 10) / 10 : d.n; };
  const calcUnit = (c) => ({ pct: '%', deltaPct: '%', perMin: '/min', perHour: '/h', perDay: '/day' }[c.calc?.op] || '');
  /** a tile's config with the unit that goes with its calculation / metric (the user's own "Unit after" wins) */
  const vcfg = (t) => { const c = t.cfg || {}, pu = dsKind(t) === 'poll' ? (data?.tiles?.[t.id]?.unit || data?.tiles?.[t.id + '_n']?.unit || '') : '', u = c.val?.suffix ? '' : (calcUnit(c) || (pu ? ' ' + pu : '') || (c.calc?.op && c.calc.op !== 'none' ? '' : METRICS[c.metric]?.unit ? ' ' + METRICS[c.metric].unit : '')); return u ? { ...c, val: { ...(c.val || {}), suffix: u } } : c; };
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
      return `<div class="gauge2"><div class="gv2" style="color:${readable(col)};${vs}">${txt}</div><div class="${style === 'lcd' ? 'lcd' : 'gbar'}">${seg}</div><div class="gscale"><span>0</span><span>${fmtN(max)}</span></div>${sub}</div>`;
    }
    const needle = style === 'needle', full = style === 'ring', R = full ? 62 : 80, wd = full ? 11 : 14, cx = 100, cy = full ? 80 : 100;
    const P = (fr) => { const ang = full ? -Math.PI / 2 + Math.PI * 2 * fr : Math.PI * (1 - fr); return [cx + R * Math.cos(ang), cy - (full ? -R * Math.sin(ang) : R * Math.sin(ang))]; };
    const arc = (f0, f1, color, w2) => { if (full && f0 <= 0 && f1 >= 0.999) return `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${color}" stroke-width="${w2}"/>`; f1 = Math.min(f1, 0.9999); if (f1 <= f0) return ''; const [x0, y0] = P(f0), [x1, y1] = P(f1); const large = (f1 - f0) * (full ? 2 : 1) > 1 ? 1 : 0; return `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="${color}" stroke-width="${w2}" stroke-linecap="butt"/>`; };
    // 1.97.3 the arc, ring and needle styles use the same number options as every other tile (decimals, compact, prefix, suffix, size)
    const plain = String(numFmt(c, Math.round(v * 1000) / 1000)).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'), pre = c.val?.prefix || '', suf = c.val?.suffix || '';
    const gsz = { s: 18, m: 24, l: 30, xl: 38 }[c.val?.size] || 0, gfs = (base) => `font-size:${gsz || base}px`;
    const gtext = (x, y, base) => `<text x="${x}" y="${y}" text-anchor="middle" class="gv" style="fill:${steps ? readable(col) : 'var(--text)'};${gfs(base)}">${pre ? `<tspan class="gu">${esc(pre)}</tspan>` : ''}${esc(plain)}${suf ? `<tspan class="gu" dx="2">${esc(suf.trim())}</tspan>` : ''}</text>`;
    let bands = ''; if (steps) steps.forEach((x, i) => { const f0 = Math.min(1, x.v / max), f1 = i + 1 < steps.length ? Math.min(1, steps[i + 1].v / max) : 1; bands += arc(f0, f1, hexA(/^#/.test(x.c) ? x.c : '#888888', 38), wd); });
    if (needle && !steps) bands = arc(0, 0.6, hexA('#2fa36b', 70), wd) + arc(0.6, 0.85, hexA('#f5a524', 70), wd) + arc(0.85, 1, hexA('#e5484d', 70), wd);
    if (needle) { const ang = Math.PI * (1 - f), [nx, ny] = [cx + (R - 12) * Math.cos(ang), cy - (R - 12) * Math.sin(ang)]; const nd = `<line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${col}" stroke-width="3.5" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="6" fill="${col}"/>`;
      return `<div class="gauge"><svg viewBox="0 0 200 146" role="img" aria-label="${esc(label)}: ${fmtN(v)}">${arc(0, 0.9999, css('--line'), wd)}${bands.replace(/opacity="[^"]*"/g, '')}${nd}${gtext(100, 138, 24)}<text x="20" y="116" text-anchor="middle" class="gs">0</text><text x="180" y="116" text-anchor="middle" class="gs">${fmtN(max)}</text></svg>${sub}</div>`; }
    let val = ''; if (f > 0) { if (grad && steps) { const K = 40; for (let i = 0; i < K; i++) { const s0 = i / K * f, s1 = (i + 1) / K * f; val += arc(s0, s1 + 0.002, colAt(s0 + (s1 - s0) / 2), wd); } } else val = arc(0, f, col, wd); }
    const vb = full ? '0 0 200 160' : '0 0 200 120';
    return `<div class="gauge"><svg viewBox="${vb}" role="img" aria-label="${esc(label)}: ${fmtN(v)}">${arc(0, 0.9999, css('--line'), wd)}${bands}${val}${full ? gtext(100, cy + 10, 30) : `${gtext(100, 92, 30)}<text x="20" y="116" text-anchor="middle" class="gs">0</text><text x="180" y="116" text-anchor="middle" class="gs">${fmtN(max)}</text>`}</svg>${sub}</div>`;
  }

  // ----- 1.34 more visuals: bar chart, treemap, table, bar gauge, number with trend line, text note -----
  let curPal = null, curPalName = '';
  // 1.74.2: a palette picked on the tile (anything but Classic / Follow the theme) also recolours severity, state and status charts
  const curPalOverrides = () => !!curPal && curPalName !== 'classic';
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
  const inkOn = (col) => (inkOf(col) === '#111827' ? 'color:#111827;text-shadow:none' : 'color:#fff');
  function treemapHtml(t) {
    const x = topRows(t); if (x.msg) return `<div class="muted">${x.msg}</div>`; const out = []; treemapCells(x.rows.filter((r) => r.n > 0), 0, 0, 100, 100, out);
    return `<div class="tmap">${out.map((c) => `<div class="tc" ${dk(t, c).replace(' style="cursor:pointer"', '')} style="left:${c.x}%;top:${c.y}%;width:${c.w}%;height:${c.h}%" title="${esc(c.name)}: ${fmtN(c.n)} (${Math.round(c.n / x.total * 100)}%)"><div style="background:${c.color};${inkOn(c.color)}"><b class="trunc">${esc(c.name)}</b><span>${fmtN(c.n)}${c.w * c.h > 600 ? ` · ${Math.round(c.n / x.total * 100)}%` : ''}</span></div></div>`).join('')}</div>`;
  }
  function tableHtml(t) {
    const x = topRows(t); if (x.msg) return `<div class="muted">${x.msg}</div>`;
    return `<table class="data"><thead><tr><th>#</th><th>${esc({ host: 'Device', app: 'Process', severity: 'Severity', facility: 'Facility', msgid: 'Trap', rule: 'Alarm rule', state: 'State', source: 'Source', vendor: 'Vendor', status: 'Status', group: 'Group', kind: 'Sends' }[x.by] || 'Name')}</th><th style="text-align:right">Count</th><th style="width:34%">Share</th></tr></thead><tbody>${x.rows.map((r, i) => `<tr ${dk(t, r)}><td class="muted">${i + 1}</td><td class="trunc" style="max-width:0;width:50%"><span class="dot" style="background:${r.color};margin-right:7px"></span>${esc(r.name)}</td><td style="text-align:right${(thMode(t.cfg) !== 'none' && thColor(t.cfg, r.n)) ? `;color:${readable((thMode(t.cfg) !== 'none' && thColor(t.cfg, r.n)))};font-weight:600` : ''}">${decorate(t.cfg || {}, numFmt(t.cfg || {}, r.n))}</td><td><div class="bar"><i style="width:${Math.max(1, r.n / x.total * 100)}%;background:${(thMode(t.cfg) !== 'none' && thColor(t.cfg, r.n)) || r.color}"></i></div></td></tr>`).join('')}</tbody></table>`;
  }
  function bargaugeHtml(t) {
    const x = topRows(t); if (x.msg) return `<div class="muted">${x.msg}</div>`; const c = t.cfg || {}, bs = c.bstyle || 'gradient', steps = thMode(c) !== 'none' ? thSteps(c) : null;
    return `<div class="hbars bg ${bs}">${x.rows.map((r) => {
      const pct = Math.max(1, r.n / x.max * 100), lvl = pct >= 80 ? 2 : pct >= 50 ? 1 : 0, col = (steps && thColor(c, r.n)) || ['var(--ok)', 'var(--s4)', 'var(--bad)'][lvl];
      let track;
      if (bs === 'lcd') { const N = 20, on = Math.max(1, Math.round(pct / 100 * N)); track = `<div class="htrack lcd">${Array.from({ length: N }, (_, i) => `<i style="${i < on ? `background:${steps ? (thColor(c, i / N * x.max) || col) : `color-mix(in srgb,var(--ok) ${100 - i / N * 100}%,var(--bad))`}` : ''}"></i>`).join('')}</div>`; }
      else if (bs === 'solid') track = `<div class="htrack"><i style="width:${pct}%;background:${col}"></i></div>`;
      else track = `<div class="htrack"><i style="width:${pct}%;background:linear-gradient(90deg,var(--ok),${lvl ? 'var(--s4)' : 'var(--ok)'} 60%,${col});background-size:${(100 / pct * 100).toFixed(0)}% 100%"></i></div>`;
      return `<div class="hb" ${dk(t, r)} title="${esc(r.name)}: ${fmtN(r.n)}"><span class="hn trunc">${esc(r.name)}</span>${track}<span class="hv" style="color:${readable(col)}">${decorate(c, fmtN(r.n))}</span></div>`;
    }).join('')}</div>`;
  }
  /** the big number of a "number with trend line": the sum of the line, or (for devices / per minute) the server's own figure */
  const sparkNum = (t, v) => { const m = t.cfg?.metric; if (dsKind(t) === 'poll') { const n = data?.tiles?.[t.id + '_n']; return n && !n.error ? n.n : null; } if (dsKind(t) === 'events' && (m === 'hosts' || m === 'perMinute')) { const n = nOf(m, data?.tiles?.[t.id + '_n']); if (n !== null) return n; } return (v || []).reduce((a, b) => a + b, 0); };
  function statsparkHtml(t) {
    const ls = lineSeries({ ...t, cfg: { ...t.cfg, mode: 'total', sc: undefined } }); if (!ls) return '<div class="muted">Loading…</div>';
    const v = ls.lines[0].v.map((x) => x ?? 0), total = sparkNum(t, v), c = vcfg(t), col0 = valCol(t), col = col0 && col0 !== 'inherit' ? col0 : (col0 === 'inherit' ? 'currentColor' : css('--accent'));
    return `<div class="stat" style="${alignStyle(t)}"><div class="num" style="${valStyle(t, col0 && col0 !== 'inherit' ? col0 : '')}">${total === null ? '–' : decorate(c, numFmt(c, total))}</div>${c.val?.sub === false ? '' : `<div class="sub">${esc(range().label)}</div>`}${sparkSvg(v, col, c.graph === 'line' ? 'line' : 'area')}</div>`;
  }
  // ----- 1.74 more visuals: waffle, radial bars, rose, word cloud, bubbles, funnel, podium, device wall -----
  const polar = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const arcPath = (cx, cy, r, a0, a1) => { const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1); return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
  const legendRows = (t, rows, total) => `<div class="pielegend">${rows.map((r) => `<div class="pl" ${dk(t, r).replace(' style="cursor:pointer"', '')}><span class="dot" style="background:${r.color}"></span><span class="trunc">${esc(r.name)}</span><b>${fmtN(r.n)}</b><span class="muted">${total ? Math.round(r.n / total * 100) : 0}%</span></div>`).join('')}</div>`;
  function rankVisHtml(t) {
    const x = topRows(t); if (x.msg) return `<div class="muted">${x.msg}</div>`;
    const rows = x.rows.filter((r) => r.n > 0), total = rows.reduce((a, r) => a + r.n, 0) || 1, max = Math.max(1, ...rows.map((r) => r.n)), ty = t.type;
    if (!rows.length) return `<div class="muted">${noData(t)}</div>`;
    if (ty === 'waffle') {
      const cells = [], q = rows.map((r) => ({ r, f: r.n / total * 100 })); let used = 0; q.forEach((o) => { o.c = Math.floor(o.f); used += o.c; });
      [...q].sort((a, b) => (b.f - b.c) - (a.f - a.c)).slice(0, 100 - used).forEach((o) => { o.c++; });
      q.forEach((o) => { for (let i = 0; i < o.c; i++) cells.push(`<i style="background:${o.r.color}" title="${esc(o.r.name)}: ${fmtN(o.r.n)}"></i>`); });
      return `<div class="waffle"><div class="wf-grid">${cells.join('')}</div>${legendRows(t, rows, total)}</div>`;
    }
    if (ty === 'radial') {
      const k = rows.length, step = 84 / Math.max(k, 1), sw = Math.min(12, step * 0.72), A0 = -Math.PI / 2;
      const rings = rows.map((r, i) => { const R = 92 - i * step, f = Math.max(0.02, r.n / max) * 0.75;
        return `<path d="${arcPath(100, 100, R, A0, A0 + Math.PI * 1.5)}" fill="none" stroke="var(--line)" stroke-width="${sw}" opacity=".6" stroke-linecap="round"/><path d="${arcPath(100, 100, R, A0, A0 + Math.PI * 2 * f)}" fill="none" stroke="${r.color}" stroke-width="${sw}" stroke-linecap="round"><title>${esc(r.name)}: ${fmtN(r.n)}</title></path>`; }).join('');
      return `<div class="radialv"><svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet">${rings}</svg>${legendRows(t, rows, total)}</div>`;
    }
    if (ty === 'rose') {
      const k = rows.length, da = Math.PI * 2 / k, R0 = 92;
      const w = rows.map((r, i) => { const rr = R0 * Math.sqrt(r.n / max), a0 = -Math.PI / 2 + i * da, a1 = a0 + da * 0.94, [x0, y0] = polar(100, 100, rr, a0), [x1, y1] = polar(100, 100, rr, a1);
        return `<path d="M100 100 L${x0.toFixed(2)} ${y0.toFixed(2)} A${rr.toFixed(2)} ${rr.toFixed(2)} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z" fill="${r.color}" fill-opacity=".88" stroke="var(--panel)" stroke-width="1"><title>${esc(r.name)}: ${fmtN(r.n)}</title></path>`; }).join('');
      const rings = [0.33, 0.66, 1].map((f) => `<circle cx="100" cy="100" r="${(R0 * f).toFixed(1)}" fill="none" stroke="var(--line)" stroke-dasharray="2 3" opacity=".7"/>`).join('');
      return `<div class="radialv"><svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet">${rings}${w}</svg>${legendRows(t, rows, total)}</div>`;
    }
    if (ty === 'cloud') {
      const shuffled = [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name)));
      return `<div class="cloud">${shuffled.map((r) => `<span ${dk(t, r).replace(' style="cursor:pointer"', '')} title="${esc(r.name)}: ${fmtN(r.n)}" style="font-size:${(10 + 15 * Math.sqrt(r.n / max)).toFixed(1)}px;color:${readable(r.color)};font-weight:${r.n / max > 0.5 ? 700 : 500}">${esc(r.name)}</span>`).join('')}</div>`;
    }
    if (ty === 'bubble') {
      return `<div class="bubbles">${rows.map((r) => { const d = Math.round((28 + 44 * Math.sqrt(r.n / max)) * (rows.length > 8 ? 0.78 : 1)); return `<div class="bub" ${dk(t, r).replace(' style="cursor:pointer"', '')} title="${esc(r.name)}: ${fmtN(r.n)}" style="width:${d}px;height:${d}px;background:color-mix(in srgb,${r.color} 78%,transparent);border-color:${r.color};color:${inkOf(r.color)}"><b>${fmtN(r.n)}</b>${d >= 62 ? `<span class="trunc">${esc(r.name)}</span>` : ''}</div>`; }).join('')}</div>`;
    }
    if (ty === 'funnel') {
      return `<div class="funnel">${rows.map((r) => `<div class="fn-row" ${dk(t, r)} title="${esc(r.name)}: ${fmtN(r.n)}"><div class="fn-bar" style="width:${Math.max(14, r.n / max * 100)}%;background:${r.color};color:${inkOf(r.color)};text-shadow:none"><span class="trunc">${esc(r.name)}</span><b>${fmtN(r.n)}</b></div></div>`).join('')}</div>`;
    }
    if (ty === 'podium') {
      const top3 = rows.slice(0, 3), order = top3.length === 3 ? [1, 0, 2] : top3.map((_, i) => i), hs = [88, 66, 50];
      const med = ['#e2b93b', '#aab4c0', '#c58a50'];
      const pod = order.map((i) => { const r = top3[i]; return `<div class="pd" ${dk(t, r)} title="${esc(r.name)}: ${fmtN(r.n)}"><span class="pd-n trunc">${esc(r.name)}</span><b class="pd-v">${fmtN(r.n)}</b><div class="pd-b" style="height:${hs[i]}%;background:linear-gradient(180deg,${r.color},color-mix(in srgb,${r.color} 45%,transparent))"><span class="pd-m" style="background:${med[i]}">${i + 1}</span></div></div>`; }).join('');
      const rest = rows.slice(3); return `<div class="podium"><div class="pd-row">${pod}</div>${rest.length ? bars(rest, (r) => esc(r.name), (r) => r.color, (r) => `<span class="trunc" ${dk(t, r)}>${esc(r.name)}</span>`) : ''}</div>`;
    }
    return '';
  }
  function devWallHtml(t) {
    if (!devices) return '<div class="muted">Loading…</div>';
    const c = t.cfg || {}, f = c.filter || {}, stOf = (d) => (d.silent ? 'silent' : d.muted ? 'muted' : d.overdue ? 'overdue' : d.idle ? 'idle' : 'ok');
    let list = devices.filter((d) => (!f.vendor || String(d.vendor || '').toLowerCase() === String(f.vendor).toLowerCase()) && (!f.group || String(d.group || '').toLowerCase() === String(f.group).toLowerCase()));
    if (!list.length) return '<div class="muted">No devices yet.</div>';
    const rank = { silent: 0, overdue: 1, idle: 2, muted: 3, ok: 4 }, cnt = { ok: 0, overdue: 0, silent: 0, muted: 0, idle: 0 };
    list.forEach((d) => { cnt[stOf(d)]++; }); list = [...list].sort((a, b) => rank[stOf(a)] - rank[stOf(b)] || (b.openAlarms || 0) - (a.openAlarms || 0)).slice(0, 600);
    const sz = list.length <= 20 ? 46 : list.length <= 80 ? 30 : list.length <= 250 ? 20 : 14, shape = c.shape === 'round' || c.shape === 'circle' ? 'round' : c.shape === 'hex' ? 'hex' : 'sq';
    const cells = list.map((d) => { const st = stOf(d), nm = d.alias || d.host || d.srcIp; return `<a class="dw dw-${st} dw-${shape}${d.openAlarms ? ' dw-al' : ''}" href="#devices" style="width:${sz}px;height:${shape === 'hex' ? Math.round(sz * 1.12) : sz}px" title="${esc(nm)} · ${st === 'ok' ? 'reporting' : st}${d.openAlarms ? ' · ' + d.openAlarms + ' open alarm(s)' : ''}">${sz >= 30 ? esc(String(nm).slice(0, sz >= 46 ? 5 : 3)) : ''}</a>`; }).join('');
    const leg = [['ok', 'Reporting'], ['overdue', 'Overdue'], ['silent', 'Silent'], ['muted', 'Muted'], ['idle', 'Idle']].filter(([k]) => cnt[k]).map(([k, l]) => `<span class="dwl"><i class="dw-${k}"></i>${l} <b>${cnt[k]}</b></span>`).join('');
    return `<div class="devwall"><div class="dw-grid">${cells}</div><div class="dw-leg">${leg}</div></div>`;
  }
  function mdLite(src) {
    const e = esc(String(src || '')).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return e.split('\n').map((l) => (/^#{1,3}\s/.test(l) ? `<div class="mdh">${l.replace(/^#{1,3}\s/, '')}</div>` : /^[-*]\s/.test(l) ? `<div class="mdl">• ${l.slice(2)}</div>` : l.trim() ? `<div>${l}</div>` : '<div class="mdg"></div>')).join('');
  }
  const textHtml = (t) => `<div class="txt">${t.cfg?.text ? mdLite(t.cfg.text) : '<span class="muted">Empty note. Customize, then Edit this tile to type your text.</span>'}</div>`;

  // ----- charts (sized to their tile) -----
  function canvasOf(t) { const wb = wbOf(t.id); return wb && $('canvas', wb); }
  function fit(cv) { const dpr = (window.devicePixelRatio || 1) * (window.NEP_ZOOM || 1), w = cv.clientWidth || 300, h = cv.clientHeight || 120; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.font = '11px ' + css('--ui'); return { g, w, h }; }
  function drawRate(t) {
    const cv = canvasOf(t), st = S.stats; if (!cv || !st) return; const { g, w, h } = fit(cv), data = st.rate; const padL = 34, padB = 16, padT = 6, max = Math.max(5, ...data) * 1.15;
    const x = (i) => padL + (i / (data.length - 1)) * (w - padL - 4), y = (v) => padT + (1 - v / max) * (h - padT - padB);
    g.strokeStyle = css('--line'); g.fillStyle = css('--faint'); g.lineWidth = 1; g.textAlign = 'right';
    for (let i = 0; i <= 3; i++) { const v = (max / 3) * i, yy = y(v); g.beginPath(); g.moveTo(padL, yy); g.lineTo(w - 4, yy); g.stroke(); g.fillText(Math.round(v), padL - 5, yy + 3); }
    g.textAlign = 'center'; g.fillText('2 min ago', padL + 24, h - 3); g.fillText('now', w - 16, h - 3);
    g.beginPath(); data.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v)))); const color = css('--accent');
    g.strokeStyle = color; g.lineWidth = 1.8; if (glassy()) { g.shadowColor = color; g.shadowBlur = 8; } g.stroke(); g.shadowBlur = 0; g.lineTo(x(data.length - 1), y(0)); g.lineTo(x(0), y(0)); g.closePath(); g.fillStyle = color + '33'; g.fill();
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
    d.series.forEach((a, i) => { let base = 0; GROUPS.forEach((grp, gi) => { const v = grp.reduce((s, k) => s + a[k], 0); if (!v) return; const y1 = y(base + v), y0 = y(base); if (glassy()) glossRect(g, padL + i * bw, y1, Math.max(1, bw - 1), y0 - y1, colors[gi]); else { g.fillStyle = colors[gi]; g.fillRect(padL + i * bw, y1, Math.max(1, bw - 1), y0 - y1); } base += v; }); });
    const t0 = data.firstBucket * data.bucketMs, fmt = (ts) => (data.to - data.from > 20 * 3600000 ? shortDate(ts) + ' ' : '') + hhmm(ts);
    g.fillStyle = css('--faint'); g.textAlign = 'left'; g.fillText(fmt(Math.max(t0, data.from)), padL, h - 3); g.textAlign = 'right'; g.fillText(fmt(data.to), w - 4, h - 3);
    cv.onmousemove = (e) => { const i = Math.floor((e.offsetX - padL) / bw); if (i < 0 || i >= n) { cv.title = ''; return; } const ts = t0 + i * data.bucketMs;
      cv.title = `${dateOf(ts)} ${hhmm(ts)} (${data.bucketMs >= 3600000 ? data.bucketMs / 3600000 + ' h' : data.bucketMs / 60000 + ' min'})\n` + GNAMES.map((nm, k) => `${nm}: ${fmtN(GROUPS[k].reduce((s, q) => s + d.series[i][q], 0))}`).join('\n'); };
    const lg = $('.legend', wbOf(t.id)); if (lg) lg.innerHTML = t.cfg?.ch?.legend === 'hide' ? '' : GNAMES.map((nm, i) => `<span class="muted"><span class="dot" style="background:${colors[i]};margin-right:5px"></span>${nm}</span>`).join('');
  }
  // charts redraw when their tile changes size (dragging, side panel, window)
  let ro = null, roTimer;
  function observe() {
    ro?.disconnect(); ro = new ResizeObserver(() => { clearTimeout(roTimer); roTimer = setTimeout(() => { for (const t of getTiles()) { curPal = PALETTES[t.cfg?.pal] || null; curPalName = t.cfg?.pal || ''; if (t.type === 'trend') drawTrend(t); if (t.type === 'rate') drawRate(t); if (t.type === 'line') drawLine(t); if (t.type === 'pie') drawPie(t); } }, 60); });
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
    // 1.97.5 at most one update per screen frame; a moved tile glides on the graphics card (transform) instead of being laid out again on every mouse move
    let lastEv = null, raf2 = 0; node.style.left = r0.left + 'px'; node.style.top = r0.top + 'px'; node.style.willChange = 'transform';
    const move = (ev) => { lastEv = ev; if (!raf2) raf2 = requestAnimationFrame(() => { raf2 = 0; step(lastEv); }); };
    const step = (ev) => {
      const dx = (ev.clientX - x0) / zf(), dy = (ev.clientY - y0) / zf();   // 1.99.3 in page pixels when the interface is scaled
      let nx = t.x, ny = t.y, nw = t.w, nh = t.h;
      if (mode === 'move') { nx = Math.min(GRID.cols - t.w, Math.max(0, Math.round(o.x + dx / g.cellW))); ny = Math.max(0, Math.round(o.y + dy / g.cellH)); node.style.transform = `translate(${dx}px, ${Math.max(-r0.top, dy)}px)`; }
      else {
        if (mode.includes('e')) { nw = Math.min(GRID.cols - t.x, Math.max(ty.minW, Math.round(o.w + dx / g.cellW))); node.style.width = Math.max(ty.minW * g.cellW - GRID.gap, r0.width + dx) + 'px'; }
        if (mode.includes('s')) { nh = Math.max(ty.minH, Math.round(o.h + dy / g.cellH)); node.style.height = Math.max(ty.minH * g.cellH - GRID.gap, r0.height + dy) + 'px'; }
      }
      if (nx !== t.x || ny !== t.y || nw !== t.w || nh !== t.h) { Object.assign(t, { x: nx, y: ny, w: nw, h: nh }); settle(getTiles(), t.id); place(t.id); showGhost(); }
    };
    const up = () => {
      node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', up);
      cancelAnimationFrame(raf2); if (lastEv) step(lastEv); node.style.transform = ''; node.style.willChange = '';
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
      col: (label, path, def = '#3b82f6', o = {}) => fld(label, `<span class="colw ${val(path) ? '' : 'unset'}"><input type="color" data-p="${path}" data-cx-none="Theme default" ${val(path) ? '' : 'data-unset="1"'} value="${val(path) || def}" aria-label="${esc(String(label).replace(/<[^>]+>/g, ''))}"><button type="button" class="x" data-clr="${path}" title="Back to the default colour">×</button></span>`, o.hint)
    };
  }
  function tileDialog(existing, type, ds0) {
    const dflt = { kpi: { metric: 'errors' }, gauge: { metric: 'errors' }, top: { by: 'host', n: 8 }, pie: { by: 'severity', n: 6, style: 'donut' }, line: { mode: 'severity' }, heat: { mode: 'hostTime', n: 10 }, latest: { n: 8 }, alarm: { card: 'open' }, statspark: {}, trend: {}, sevbars: {}, bar: { by: 'host', n: 8 }, treemap: { by: 'host', n: 10 }, table: { by: 'host', n: 10 }, bargauge: { by: 'host', n: 8 } };
    const t = existing ? structuredClone(existing) : { id: 'u' + Date.now().toString(36), type, title: '', x: 0, y: 0, w: TYPES[type].w, h: TYPES[type].h, cfg: structuredClone(dflt[type] || {}) };
    const c = t.cfg ||= {}; let fl, ty, hasVal, hasTh, hasChart, hasPal, isRank;
    const setFlags = () => { fl = FILTER_TYPES.includes(t.type); ty = TYPES[t.type]; hasVal = ['kpi', 'statspark', 'gauge', 'alarm'].includes(t.type); hasTh = hasVal || ['bargauge', 'bar', 'treemap', 'table'].includes(t.type); hasChart = ['line', 'trend'].includes(t.type); hasPal = ['pie', 'bar', 'treemap', 'table', ...NEWRANK].includes(t.type); isRank = !!TOPLIKE[t.type] || t.type === 'top' || t.type === 'pie'; };
    setFlags();
    if (c.bg && !c.look?.bgMode) c.look = { ...(c.look || {}), bgMode: 'solid', bg: c.bg }; delete c.bg;                       // an old custom background becomes a panel option
    if (!c.th?.steps?.length && (c.warn > 0 || c.crit > 0)) { c.th = { ...(c.th || {}), mode: c.th?.mode || 'value', steps: [{ v: 0, c: '#30a46c' }, ...(c.warn > 0 ? [{ v: c.warn, c: '#f5a524' }] : []), ...(c.crit > 0 ? [{ v: c.crit, c: '#e5484d' }] : [])] }; } delete c.warn; delete c.crit;
    const K = optKit(t);
    const DEF_METRIC = { events: 'errors', alarms: 'alActive', devices: 'dvAll', system: 'eps', poll: 'pollv' };
    /** choose the data a tile reads: fixes the metric, the ranking and the filters so they always belong to that data */
    const setDs = (ds) => {
      const k = DS[ds].kind; c.ds = ds; c.filter = { ...(c.filter || {}) };
      if (k === 'poll') { delete c.filter; if (t.type === 'kpi' || t.type === 'gauge') c.metric = 'pollv'; else delete c.metric; if (!BYS.poll.some((x) => x[0] === c.by)) c.by = 'device'; delete c.calc?.bm; if (c.calc && ['pct', 'ratio', 'diff', 'sum', 'perMin', 'perHour', 'perDay', 'delta', 'deltaPct'].includes(c.calc.op)) delete c.calc.op; return; }
      delete c.pk; delete c.pdevs; delete c.pinst; delete c.pagg;
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
      const kd = dsKind(t), dsOptG = ['events', 'alarms', 'devices', 'poll', 'system'].map((k2) => { const l = Object.entries(DS).filter(([, v]) => v.kind === k2 && VIS_DS[t.type]?.includes(k2)); return l.length ? `<optgroup label="${{ events: 'Received messages', alarms: 'Alarm list', devices: 'Device list', poll: 'Polled devices', system: 'The application itself' }[k2]}">${l.map(([k, v]) => `<option value="${k}" ${dsOf(t) === k ? 'selected' : ''}>${v.label}</option>`).join('')}</optgroup>` : ''; }).join('');
      const visOpts = Object.entries(TYPES).filter(([k]) => VIS_DS[k]?.includes(kd)).map(([k, v]) => `<option value="${k}" ${t.type === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
      // 1.99.2 step 1 Visual: pictures of the visuals; step 2 Data: the source, then the fields that belong to that data
      const visGrid = VIS_DS[t.type] ? `<div class="visgrid" role="radiogroup" aria-label="Visual">${Object.entries(TYPES).filter(([k]) => VIS_DS[k]).map(([k, v]) => `<button type="button" role="radio" aria-checked="${t.type === k}" class="visb ${t.type === k ? 'on' : ''}" data-vis="${k}" title="${esc(v.desc)}">${window.NEPIcons ? NEPIcons.vis(k, 22) : ''}<span>${esc(v.label)}</span></button>`).join('')}</div><p class="muted" style="margin:6px 0 0">Switching keeps your colours and looks. Data that a visual cannot show is changed to data it can.</p>` : '';
      const pm = POLLMETA.data, isPoll = kd === 'poll';
      const pollFields = !isPoll ? '' : !pm ? '<p class="muted">Loading the polled readings…</p>' : !pm.keys.length ? '<p class="muted">No polled readings yet. Add devices and readings on the SNMP polling page first.</p>' : `
        ${K.fld('Reading', `<select data-p="cfg.pk"><option value="">Choose a reading…</option>${pm.keys.filter((x) => !x.text).map((x) => `<option value="${esc(x.k)}" ${c.pk === x.k ? 'selected' : ''}>${esc(x.label)}${x.unit ? ' (' + esc(x.unit) + ')' : ''}${x.devices > 1 ? ` · ${x.devices} devices` : ''}</option>`).join('')}</select>`, 'Readings with the same name and unit are one choice, whatever the device or vendor: they are combined across devices.')}
        ${K.fld('Devices', `<div class="pdevs">${pm.devices.length ? pm.devices.map((d) => `<label class="chk"><input type="checkbox" data-pdev="${esc(d.id)}" ${(c.pdevs || []).includes(d.id) ? 'checked' : ''}> ${esc(d.name)}</label>`).join('') : '<span class="muted">No polled devices</span>'}</div>`, 'None ticked: every device that has this reading.')}
        ${K.txt('Instance', 'cfg.pinst', { ph: 'all (for example Port 1 or Rectifier 2)', max: 120, hint: 'For readings with several values per device (ports, sensors, rectifiers). Empty: all of them.' })}
        ${K.sel('Combine values', 'cfg.pagg', [['avg', 'Average'], ['max', 'Highest'], ['min', 'Lowest'], ['sum', 'Sum'], ['last', 'Latest'], ['count', 'Number of values']], { def: 'avg' })}
        ${t.type === 'line' ? K.sel('Lines', 'cfg.by', BYS.poll, { def: 'device' }) : ''}
        ${isRank || t.type === 'pie' ? K.sel(t.type === 'pie' ? 'Slices' : 'Rank by', 'cfg.by', BYS.poll.filter((x) => x[0] !== 'all'), { def: 'device' }) + K.num(t.type === 'pie' ? 'Number of slices' : 'Rows', 'cfg.n', { min: 1, max: t.type === 'pie' ? 12 : TOPLIKE[t.type] || 50, ph: '8' }) : ''}`;
      const dsSel = VIS_DS[t.type] ? K.fld('Data', `<select id="peDs">${dsOptG}</select>`, esc(DS[dsOf(t)].desc)) : '';
      const ICONS = window.NEPIcons, ic = c.icon || {};
      const iconPick = !ICONS ? '' : `<div class="field"><label>Icon</label><div><div class="icongrid"><button type="button" class="icb ${ic.name ? '' : 'on'}" data-icon="" title="No icon">None</button>${ICONS.list().map((x) => `<button type="button" class="icb ${ic.name === x.k ? 'on' : ''}" data-icon="${x.k}" title="${esc(x.label)}" aria-label="${esc(x.label)}">${ICONS.tile(x.k, 20)}</button>`).join('')}</div></div></div>
        ${ic.name ? `${K.sel('Icon place', 'cfg.icon.pos', [['title', 'Next to the title'], ['corner', 'Badge in the corner'], ['mark', 'Large, faint, in the background']], { def: 'title' })}${K.num('Icon size', 'cfg.icon.size', { min: 12, max: 160, unit: 'px', ph: 'auto' })}${K.col('Icon colour', 'cfg.icon.color', '#3b82f6', { hint: 'Empty: the theme accent colour' })}` : ''}`;
      const genData = `${t.type === 'kpi' || t.type === 'gauge' ? K.fld('Show', `<select data-p="cfg.metric">${metricOpts()}</select>`) : ''}
        ${t.type === 'statspark' && dsKind(t) === 'alarms' ? K.sel('Show', 'cfg.metric', [['alRaised', 'Alarms raised'], ['alCleared', 'Alarms cleared']], { def: 'alRaised' }) : ''}
        ${t.type === 'statspark' && dsKind(t) === 'events' ? K.fld('Show', `<select data-p="cfg.metric">${[['total', 'All messages'], ['errors', 'Errors and worse'], ['warnings', 'Warnings'], ['hosts', 'Devices that sent messages'], ['perMinute', 'Messages per minute']].map(([k, l]) => `<option value="${k}" ${(c.metric || 'total') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`) : ''}
        ${isRank ? K.sel('Rank by', 'cfg.by', BYS[kd] || BYS.events, { def: defBy(t) }) : ''}
        ${t.type === 'line' ? K.sel('Lines', 'cfg.mode', [['severity', 'One line per severity group'], ['total', 'All ' + DS[dsOf(t)].chip.toLowerCase() + ' (one line)']], { def: 'severity' }) : ''}
        ${t.type === 'heat' ? K.sel('Shows', 'cfg.mode', [['hostTime', 'Busiest devices over time'], ['dowHour', 'Weekday against hour of day']], { def: 'hostTime' }) : ''}
        ${['top', 'latest', 'pie', 'heat', 'bar', 'treemap', 'table', 'bargauge', ...NEWRANK].includes(t.type) ? K.num(t.type === 'pie' ? 'Slices' : 'Rows', 'cfg.n', { min: 1, max: t.type === 'pie' ? 12 : t.type === 'heat' ? 20 : TOPLIKE[t.type] || 50, ph: '8' }) : ''}`;
      const genVis = `${t.type === 'bar' ? K.sel('Direction', 'cfg.orient', [['h', 'Horizontal bars'], ['v', 'Vertical columns']], { def: 'h' }) : ''}
        ${t.type === 'pie' ? K.sel('Shape', 'cfg.style', [['donut', 'Donut'], ['pie', 'Pie']], { def: 'donut' }) : ''}
        ${t.type === 'heat' ? K.sel('Cell shape', 'cfg.shape', [['square', 'Square'], ['round', 'Rounded square'], ['circle', 'Circle'], ['hex', 'Hexagon'], ['hexo', 'Hexagon outline']], { def: 'square' }) + K.sel('Colours', 'cfg.theme', [['blue', 'Blue (accent colour)'], ['traffic', 'Traffic light (green, amber, red)'], ['heat', 'Heat (yellow to dark red)'], ['cool', 'Cool (teal, blue, purple)'], ['mono', 'Greys']], { def: 'blue' }) : ''}
        ${t.type === 'text' ? K.fld('Text', `<textarea data-p="cfg.text" rows="6" style="width:100%" maxlength="2000" placeholder="# Heading&#10;Plain text, **bold**, - bullets and [links](https://example.com)">${esc(c.text || '')}</textarea>`) : ''}
        ${t.type === 'gauge' ? K.num('Dial maximum', 'cfg.max', { min: 0, ph: 'auto' }) : ''}`;
      const genTile = `${K.txt('Title', 'title', { ph: ty.label })}
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
      const calcs = (t.type === 'kpi' || t.type === 'gauge') && kd === 'poll' ? `<p class="muted" style="margin:0 0 6px">Convert the value, for example a reading in tenths: multiply by 0.1.</p>${K.num('Multiply by', 'cfg.calc.mul', { step: 'any', ph: '1' })}${K.num('Then add', 'cfg.calc.add', { step: 'any', ph: '0' })}` : (t.type === 'kpi' || t.type === 'gauge') ? (() => {
        const srv = !!METRICS[c.metric]?.srv, ops = srv ? [['none', 'No calculation'], ['pct', 'Percent of another number (A ÷ B × 100)'], ['ratio', 'Ratio to another number (A ÷ B)'], ['diff', 'Difference to another number (A − B)'], ['sum', 'Sum with another number (A + B)'], ['perMin', 'Average per minute'], ['perHour', 'Average per hour'], ['perDay', 'Average per day'], ['delta', 'Change since the period before'], ['deltaPct', '% change since the period before']] : [['none', 'No calculation']], op = c.calc?.op || 'none';
        return `<p class="muted" style="margin:0 0 6px">A is the number chosen under "Show". Calculations are done on the live numbers each refresh.</p>${K.sel('Calculation', 'cfg.calc.op', ops, { def: 'none' })}
          ${['pct', 'ratio', 'diff', 'sum'].includes(op) ? K.fld('B is', `<select data-p="cfg.calc.bm">${calcMetricOpts()}</select>`) : ''}
          ${K.num('Multiply by', 'cfg.calc.mul', { step: 'any', ph: '1' })}${K.num('Then add', 'cfg.calc.add', { step: 'any', ph: '0' })}${op === 'delta' || op === 'deltaPct' ? '<p class="muted">Only for numbers counted over the time range (messages, alarms raised or cleared).</p>' : ''}`;
      })() : t.type === 'line' || t.type === 'trend' ? `<p class="muted" style="margin:0 0 6px">Change how the series is drawn. The trend chart then draws lines.</p>${K.sel('Calculation', 'cfg.sc.op', [['none', 'None (counts per time step)'], ['cum', 'Running total'], ['ma', 'Moving average'], ['diff', 'Rise since the step before (never negative)'], ['rate', 'Per minute']], { def: 'none' })}${c.sc?.op === 'ma' ? K.num('Average over', 'cfg.sc.n', { min: 2, max: 30, unit: 'steps', ph: '5' }) : ''}` : '';
      const val = hasVal || t.type === 'bargauge' || t.type === 'table' ? `${hasVal ? `${K.sel('Size', 'cfg.val.size', [['auto', 'Automatic (follows the tile)'], ['s', 'Small'], ['m', 'Medium'], ['l', 'Large'], ['xl', 'Extra large']], { def: 'auto' })}${t.type === 'gauge' ? '' : K.sel('Alignment', 'cfg.val.align', [['', 'Default'], ['left', 'Left'], ['center', 'Centre'], ['right', 'Right']])}${K.num('Decimals', 'cfg.val.dec', { min: 0, max: 4, ph: 'auto' })}${K.chk('Short form (1.2k, 3.4M)', 'cfg.val.compact')}${K.chk('Show the small text under the number', 'cfg.val.sub', true)}` : ''}
        ${K.txt('Unit before', 'cfg.val.prefix', { max: 12, w: 'w-sm', ph: '' })}${K.txt('Unit after', 'cfg.val.suffix', { max: 12, w: 'w-sm', ph: 'for example ms or %' })}
        ${t.type === 'kpi' ? K.sel('Trend line', 'cfg.graph', [['none', 'None'], ['area', 'Filled area behind the number'], ['line', 'Line behind the number']], { def: 'none' }) : t.type === 'statspark' ? K.sel('Trend line', 'cfg.graph', [['area', 'Filled area'], ['line', 'Line']], { def: 'area' }) : ''}
        ${t.type === 'devwall' ? K.sel('Cell shape', 'cfg.shape', [['square', 'Square'], ['round', 'Round'], ['hex', 'Hexagon']], { def: 'square' }) : ''}
        ${t.type === 'gauge' ? K.sel('Gauge style', 'cfg.gstyle', [['arc', 'Half dial'], ['needle', 'Speedometer (needle)'], ['ring', 'Full ring'], ['lcd', 'Segmented bar (LCD)'], ['bar', 'Flat bar']], { def: 'arc' }) : ''}
        ${t.type === 'bargauge' ? K.sel('Bar style', 'cfg.bstyle', [['gradient', 'Gradient'], ['lcd', 'Segmented (LCD)'], ['solid', 'Solid']], { def: 'gradient' }) : ''}` : '';
      const thr = hasTh ? `${K.sel('Colour by steps', 'cfg.th.mode', [['none', 'Off'], ['value', t.type === 'gauge' ? 'Colour the dial' : hasVal ? 'Colour the number' : 'Colour the bars / cells'], ...(hasVal ? [['bg', 'Fill the whole tile'], ['grad', 'Fill the tile with a gradient']] : [])], { def: thSteps(c) ? 'value' : 'none' })}<p class="muted" style="margin:2px 0 6px">The colour of the highest step the value reaches is used. The first step is the base colour.</p>${stepsHtml()}` : '';
      const chart = hasChart ? `${t.type === 'trend' ? K.sel('Draw as', 'cfg.ch.bars', [['bars', 'Stacked bars'], ['area', 'Stacked areas'], ['line', 'Lines']], { def: 'bars' }) : ''}
        ${t.type === 'line' || ['area', 'line'].includes(c.ch?.bars) ? `${K.num('Line width', 'cfg.ch.lw', { min: 0.5, max: 6, step: 0.5, ph: '1.8' })}${K.num('Fill under line', 'cfg.ch.fillA', { min: 0, max: 100, unit: '%', ph: t.type === 'line' ? '0' : '60' })}${(c.ch?.fillA ?? (t.type === 'line' ? 0 : 60)) > 0 ? K.chk('Gradient fill', 'cfg.ch.grad', true) : ''}${K.chk('Smooth lines', 'cfg.ch.smooth')}${K.chk('Show points', 'cfg.ch.pts')}` : ''}${t.type === 'line' ? K.chk('Stack the lines', 'cfg.ch.stack') : ''}
        ${K.chk('Show grid lines', 'cfg.ch.grid', true)}${K.chk('Show axis numbers and times', 'cfg.ch.axis', true)}${K.sel('Legend', 'cfg.ch.legend', [['bottom', 'Below'], ['right', 'At the right'], ['hide', 'Hidden']], { def: 'bottom' })}` : '';
      const pal = hasPal ? K.sel('Colours', 'cfg.pal', PAL_NAMES.map(([v, l]) => [v, l]), { def: 'theme' }) : '';
      const look = `<div class="presets">${LOOK_PRESETS.map(([n, l], i) => `<button type="button" data-preset="${i}" class="pre" style="${l?.bgMode === 'gradient' ? `background:linear-gradient(135deg,${l.bg},${l.bg2});color:#fff` : l?.bg ? `background:${l.bg};color:${l.tc || 'inherit'}` : ''}">${esc(n)}</button>`).join('')}</div>
        ${K.sel('Background', 'cfg.look.bgMode', [['', 'Theme default'], ['none', 'Transparent'], ['solid', 'Solid colour'], ['gradient', 'Gradient']])}${K.col('Colour', 'cfg.look.bg', '#1f2937')}${K.col('Second colour', 'cfg.look.bg2', '#3b82f6')}${K.num('Gradient angle', 'cfg.look.angle', { min: 0, max: 360, unit: '°', ph: '135' })}${K.num('Opacity', 'cfg.look.bgAlpha', { min: 0, max: 100, unit: '%', ph: '100' })}
        ${K.num('Border width', 'cfg.look.bw', { min: 0, max: 8, unit: 'px' })}${K.col('Border colour', 'cfg.look.bc', '#475569')}${K.col('Accent edge (top)', 'cfg.color', '#3b82f6', { hint: 'a 3 px coloured line on the top of the tile' })}${K.num('Corner radius', 'cfg.look.radius', { min: 0, max: 32, unit: 'px', ph: 'theme' })}
        ${K.sel('Shadow', 'cfg.look.shadow', [['', 'Theme default'], ['none', 'None'], ['soft', 'Soft'], ['strong', 'Strong'], ['glow', 'Glow (border colour)']])}${!hasDs(t) ? '' : K.chk('Show the data label (Syslog / SNMP traps / Alarms / Devices)', 'cfg.look.tSrc', true)}${K.num('Inner space', 'cfg.look.pad', { min: 0, max: 32, unit: 'px', ph: '12' })}${K.col('Text colour', 'cfg.look.tc', '#e5e7eb', { hint: 'for everything inside the tile' })}`;
      const ttl = `${K.chk('Show the title', 'cfg.look.tShow', true)}${K.sel('Alignment', 'cfg.look.tAlign', [['', 'Left'], ['center', 'Centre'], ['right', 'Right']])}${K.num('Size', 'cfg.look.tSize', { min: 10, max: 28, unit: 'px', ph: '13' })}${K.col('Colour', 'cfg.look.tColor', '#e5e7eb')}${K.chk('Capital letters', 'cfg.look.tUpper')}
        ${K.sel('Title bar', 'cfg.look.tBar', [['', 'None'], ['solid', 'Solid colour'], ['gradient', 'Gradient']])}${K.col('Bar colour', 'cfg.look.tBarC', '#4338ca')}${K.col('Bar second colour', 'cfg.look.tBarC2', '#1e1b4b')}`;
      const SH = (h) => `<h4 class="ogsub">${h}</h4>`;
      const fmt = (genVis.replace(/\s/g, '') ? genVis : '') + (calcs ? SH('Calculation') + calcs : '') + (val ? SH(hasVal ? 'Value' : 'Numbers') + val : '') + (thr ? SH('Colour steps (thresholds)') + thr : '') + (chart ? SH('Chart') + chart : '') + (pal ? SH('Colours') + pal : '');
      return (visGrid ? G('1 · Visual', visGrid, false) : '') + G(visGrid ? '2 · Data' : 'Content', dsSel + (isPoll ? pollFields : genData + flt) + (visGrid ? '' : genVis), true) + (fmt.replace(/\s/g, '') && visGrid ? G('3 · Format', fmt, false) : '') + G(visGrid ? '4 · Tile' : 'Tile', genTile + iconPick + SH('Look') + look + SH('Title') + ttl, false);
    };
    // ----- preview -----
    let pvData = null, pvKey = '', pvFetching = false, pvTimer;
    const pvTile = () => { const x = structuredClone(t); x.id = 'pv'; return x; };
    function pvPaint() {
      const node = q('pvW'); if (!node) return; const tt = pvTile(), k = lookOf(tt), ob = $('.whead', node);
      node.className = `widget panel pvw ${k.cls}`; node.style.cssText = k.style; node.classList.remove('tinted'); ob.className = `whead ${k.hideTitle ? 'nohead' : ''}`; ob.style.cssText = k.head;
      const ib = iconBits(tt); node.querySelectorAll('.wico-corner,.wico-mark').forEach((x) => x.remove()); if (ib.box) node.insertAdjacentHTML('afterbegin', ib.box); node.classList.toggle('has-ico', !!ib.box); node.classList.toggle('ico-corner', !!ib.cls); if (ib.vars) node.style.setProperty('--icz', ib.vars.slice(6, -1));
      ob.innerHTML = k.hideTitle ? '' : `<h2 class="wtitle" style="${k.title}">${ib.title}${esc(tt.title || TYPES[tt.type].label)}</h2>${hasDs(tt) && tt.cfg?.look?.tSrc !== false ? `<span class="srcchip" data-ds="${dsOf(tt)}">${esc(tt.w <= 2 ? DS[dsOf(tt)].short : DS[dsOf(tt)].chip)}</span>` : ''}`;
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
    if (dsKind(t) === 'poll') POLLMETA.load().then(renderOpts);
    const onField = (e) => {
      const el2 = e.target, pth = el2.dataset?.p;
      if (el2.id === 'peDs') { setDs(el2.value); renderOpts(); if (DS[el2.value]?.kind === 'poll') POLLMETA.load().then(renderOpts); return changed(); }
      if (el2.dataset?.pdev !== undefined) { const set = new Set(c.pdevs || []); if (el2.checked) set.add(el2.dataset.pdev); else set.delete(el2.dataset.pdev); c.pdevs = [...set]; if (!c.pdevs.length) delete c.pdevs; return changed(); }
      if (pth === 'cfg.pk' && (!t.title || POLLMETA.data?.keys.some((x) => x.label === t.title))) { const kk = POLLMETA.data?.keys.find((x) => x.k === el2.value); if (kk) { t.title = kk.label; const ti = $('[data-p=title]', back); if (ti) ti.value = t.title; } }
      if (el2.id === 'peVis') { setType(el2.value); renderOpts(); return changed(); }
      if (pth === 'cfg.calc.op' || pth === 'cfg.sc.op') { const key = pth === 'cfg.calc.op' ? 'calc' : 'sc'; setP(t, pth, el2.value); if (el2.value === 'none') { delete c[key].op; if (!Object.keys(c[key]).length) delete c[key]; } else if (key === 'calc' && ['pct', 'ratio', 'diff', 'sum'].includes(el2.value) && !c.calc.bm) c.calc.bm = 'total'; renderOpts(); return changed(); }
      if (pth === 'cfg.ch.bars' || pth === 'cfg.ch.fillA' || pth === 'cfg.look.tBar' || pth === 'cfg.look.bgMode') setTimeout(() => { renderOpts(); }, 0);
      if (pth) { let v; if (el2.type === 'checkbox') v = el2.checked; else if (el2.type === 'number') v = el2.value === '' ? undefined : +el2.value; else v = el2.value; setP(t, pth, v);
        { const L2 = c.look || {}, needs = { 'cfg.look.bg': ['bgMode', ['solid', 'gradient'], 'solid'], 'cfg.look.bgAlpha': ['bgMode', ['solid', 'gradient'], 'solid'], 'cfg.look.bg2': ['bgMode', ['gradient'], 'gradient'], 'cfg.look.angle': ['bgMode', ['gradient'], 'gradient'], 'cfg.look.tBarC': ['tBar', ['solid', 'gradient'], 'solid'], 'cfg.look.tBarC2': ['tBar', ['gradient'], 'gradient'] }[pth];
          if (needs && !needs[1].includes(L2[needs[0]])) { setP(t, 'cfg.look.' + needs[0], needs[2]); if (needs[0] === 'bgMode' && !L2.bg) setP(t, 'cfg.look.bg', pth === 'cfg.look.bg' ? v : '#1f2937'); if (needs[0] === 'tBar' && !L2.tBarC) setP(t, 'cfg.look.tBarC', pth === 'cfg.look.tBarC' ? v : '#4338ca'); const sel2 = $(`[data-p="cfg.look.${needs[0]}"]`, back); if (sel2) sel2.value = needs[2]; } }
         if (el2.type === 'color') el2.closest('.colw')?.classList.remove('unset'); if (pth === 'cfg.card' && (!t.title || Object.values(AL_CARDS).includes(t.title))) { t.title = AL_CARDS[v]; const ti = $('[data-p=title]', back); if (ti) ti.value = t.title; } return changed(); }
      if (el2.dataset?.si !== undefined) { const st = c.th.steps[+el2.dataset.si]; if (el2.dataset.sf === 'v') st.v = +el2.value || 0; else st.c = el2.value; return changed(); }
      if (el2.id === 'thPre' && el2.value !== '') { c.th = { ...(c.th || {}), mode: c.th?.mode && c.th.mode !== 'none' ? c.th.mode : 'value', steps: structuredClone(STEP_PRESETS[+el2.value][1]) }; renderOpts(); changed(); }
    };
    back.addEventListener('input', onField); back.addEventListener('change', onField);
    back.addEventListener('click', (e) => {
      const clr = e.target.closest('[data-clr]'); if (clr) { setP(t, clr.dataset.clr, undefined); const i2 = $(`[data-p="${clr.dataset.clr}"]`, back); if (i2) { i2.closest('.colw')?.classList.add('unset'); } renderOpts(); return changed(); }
      const vb = e.target.closest('[data-vis]'); if (vb) { setType(vb.dataset.vis); renderOpts(); return changed(); }
      const icb = e.target.closest('[data-icon]'); if (icb) { if (icb.dataset.icon) c.icon = { ...(c.icon || {}), name: icb.dataset.icon }; else delete c.icon; renderOpts(); return changed(); }
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
      if (!t.title && dsKind(t) === 'poll') t.title = POLLMETA.data?.keys.find((x) => x.k === c.pk)?.label || '';
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
      waffle: sv(Array.from({ length: 40 }, (_, i) => { const col = i % 8, row = Math.floor(i / 8); return `<rect x="${20 + col * 10.5}" y="${8 + row * 11}" width="8.5" height="8.5" rx="1.5" fill="${i < 20 ? A : i < 30 ? '#f5a524' : i < 36 ? '#b07cf2' : M}" opacity="${i < 36 ? 1 : 0.2}"/>`; }).join('')),
      radial: sv([0, 1, 2].map((i) => { const R = 28 - i * 8; return `<circle cx="60" cy="36" r="${R}" fill="none" stroke="${M}" opacity=".15" stroke-width="5"/><circle cx="60" cy="36" r="${R}" fill="none" stroke="${[A, '#f5a524', '#b07cf2'][i]}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${R * 2 * Math.PI * [0.7, 0.5, 0.3][i]} 999" transform="rotate(-90 60 36)"/>`; }).join('')),
      rose: sv([22, 30, 16, 26, 12, 20].map((r, i) => { const a0 = -Math.PI / 2 + i * Math.PI / 3, a1 = a0 + Math.PI / 3 * 0.92; return `<path d="M60 36 L${60 + r * Math.cos(a0)} ${36 + r * Math.sin(a0)} A${r} ${r} 0 0 1 ${60 + r * Math.cos(a1)} ${36 + r * Math.sin(a1)} Z" fill="${[A, '#f5a524', '#b07cf2', '#45c2a5', '#e5484d', '#8fd14f'][i]}" opacity=".9"/>`; }).join('')),
      cloud: sv(`<text x="14" y="30" font-size="20" font-weight="700" fill="${A}">core</text><text x="58" y="22" font-size="12" fill="#f5a524">edge</text><text x="62" y="38" font-size="15" font-weight="600" fill="#b07cf2">sw-12</text><text x="16" y="50" font-size="10" fill="${M}" opacity=".6">fw</text><text x="40" y="56" font-size="12" fill="#45c2a5">ups</text>`),
      bubble: sv(`<circle cx="40" cy="38" r="22" fill="${A}" opacity=".75"/><circle cx="76" cy="30" r="14" fill="#f5a524" opacity=".75"/><circle cx="92" cy="52" r="9" fill="#b07cf2" opacity=".75"/><circle cx="68" cy="56" r="6" fill="#45c2a5" opacity=".75"/>`),
      funnel: sv([[96, A], [76, '#45c2a5'], [54, '#f5a524'], [32, '#b07cf2']].map(([w, c], i) => `<rect x="${60 - w / 2}" y="${8 + i * 15}" width="${w}" height="11" rx="3" fill="${c}"/>`).join('')),
      podium: sv(`<rect x="14" y="34" width="28" height="26" rx="2" fill="${A}" opacity=".55"/><rect x="46" y="18" width="28" height="42" rx="2" fill="${A}"/><rect x="78" y="42" width="28" height="18" rx="2" fill="${A}" opacity=".4"/><text x="60" y="34" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">1</text>`),
      devwall: sv(Array.from({ length: 24 }, (_, i) => { const col = i % 8, row = Math.floor(i / 8); return `<rect x="${12 + col * 12}" y="${10 + row * 17}" width="10" height="14" rx="2" fill="${i === 5 ? '#e5484d' : i === 13 || i === 20 ? '#f5a524' : '#30a46c'}"/>`; }).join('')),
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
  // 1.97.5 the SNMP polling visuals each have their own card in the gallery; they all make a "poll" tile, ready-set to that look
  const PSV = (inner) => `<svg viewBox="0 0 120 72" aria-hidden="true">${inner}</svg>`, PG = '#30a46c', PA = '#f5a524', PR = '#e5484d', PM = 'currentColor';
  const POLL_CARDS = {
    poll_sum: ['Polling status summary', 'Big counts of polled devices: up, no answer, late, and open polling alarms.', { src: 'status', view: 'summary' }, PSV([[PG, '18'], [PR, '2'], [PA, '1']].map(([c, n], i) => `<rect x="${8 + i * 37}" y="14" width="32" height="44" rx="6" fill="${c}" opacity=".16"/><text x="${24 + i * 37}" y="42" text-anchor="middle" font-size="18" font-weight="700" fill="${c}">${n}</text>`).join(''))],
    poll_donut: ['Polling status donut', 'Share of polled devices that answer, do not answer or are late.', { src: 'status', view: 'donut' }, PSV(`<circle cx="40" cy="36" r="22" fill="none" stroke="${PG}" stroke-width="10" stroke-dasharray="104 200" transform="rotate(-90 40 36)"/><circle cx="40" cy="36" r="22" fill="none" stroke="${PR}" stroke-width="10" stroke-dasharray="20 200" stroke-dashoffset="-106" transform="rotate(-90 40 36)"/><circle cx="40" cy="36" r="22" fill="none" stroke="${PA}" stroke-width="10" stroke-dasharray="12 200" stroke-dashoffset="-128" transform="rotate(-90 40 36)"/>` + [PG, PR, PA].map((c, i) => `<rect x="74" y="${22 + i * 12}" width="8" height="8" rx="2" fill="${c}"/><rect x="86" y="${23 + i * 12}" width="24" height="6" rx="3" fill="${PM}" opacity=".35"/>`).join(''))],
    poll_board: ['Polled device board', 'Every polled device as a coloured tile (or hexagon), grouped.', { src: 'status', view: 'tiles', shape: 'hex' }, PSV(Array.from({ length: 12 }, (_, i) => { const r = Math.floor(i / 6), c = i % 6, x = 14 + c * 17 + (r ? 8 : 0), y = 20 + r * 16; return `<path d="M${x} ${y - 8} l7 4v8l-7 4l-7-4v-8z" fill="${i === 4 ? PR : i === 9 ? PA : PG}" opacity=".85"/>`; }).join(''))],
    poll_spark: ['Readings with trend', 'Each reading with its value and a small line of the last hours.', { src: 'readings', view: 'spark', hours: 6 }, PSV([0, 1, 2].map((i) => `<rect x="8" y="${14 + i * 18}" width="26" height="6" rx="3" fill="${PM}" opacity=".35"/><polyline fill="none" stroke="${['#4aa3ff', '#45c2a5', PA][i]}" stroke-width="2" points="40,${20 + i * 18} 52,${15 + i * 18} 62,${19 + i * 18} 74,${12 + i * 18} 86,${17 + i * 18}"/><rect x="94" y="${13 + i * 18}" width="18" height="8" rx="3" fill="${PM}" opacity=".6"/>`).join(''))],
    poll_gauges: ['Reading gauges', 'One small gauge per reading, for example the temperature or load of many devices.', { src: 'readings', view: 'gauges' }, PSV([0, 1, 2].map((i) => `<path d="M${10 + i * 36} 46 a14 14 0 0 1 28 0" fill="none" stroke="${PM}" stroke-opacity=".2" stroke-width="5" stroke-linecap="round"/><path d="M${10 + i * 36} 46 a14 14 0 0 1 ${[18, 26, 10][i]} -${[12, 3, 10][i]}" fill="none" stroke="${[PG, PA, PG][i]}" stroke-width="5" stroke-linecap="round"/>`).join(''))],
    poll_line: ['Reading graph', 'A line per reading over 1 hour to 7 days.', { src: 'readings', view: 'line', hours: 24 }, PSV(`<polyline fill="none" stroke="#4aa3ff" stroke-width="2.2" points="10,50 26,42 42,46 58,28 74,34 90,22 110,30"/><polyline fill="none" stroke="${PA}" stroke-width="2.2" points="10,58 26,56 42,52 58,54 74,46 90,48 110,40"/>`)],
    poll_bars: ['Reading bars', 'Readings as a bar list, coloured by their thresholds.', { src: 'readings', view: 'bars' }, PSV([0, 1, 2, 3].map((i) => `<rect x="10" y="${12 + i * 13}" width="28" height="6" rx="3" fill="${PM}" opacity=".35"/><rect x="42" y="${11 + i * 13}" width="${[60, 44, 30, 52][i]}" height="8" rx="3" fill="${[PR, PA, PG, PA][i]}"/>`).join(''))],
    poll: ['Polled readings table', 'Any readings of any devices in a table, tile grid, big number or gauge. The full choice.', { src: 'readings', view: 'table' }, null],
    poll_alarms: ['Polling alarms', 'How many polling alarms are open, and on which devices.', { src: 'alarms', view: 'big' }, PSV(`<text x="22" y="46" font-size="30" font-weight="700" fill="${PR}">3</text><rect x="54" y="20" width="54" height="10" rx="5" fill="${PR}" opacity=".18"/><rect x="54" y="36" width="44" height="10" rx="5" fill="${PR}" opacity=".18"/>`)]
  };
  const cardMeta = (k) => (POLL_CARDS[k] ? { label: POLL_CARDS[k][0], desc: POLL_CARDS[k][1] } : TYPES[k]);
  const GALLERY = [['Numbers', ['kpi', 'statspark', 'gauge', 'bargauge']], ['Charts', ['trend', 'line', 'bar', 'pie', 'treemap', 'heat', 'sevbars']], ['More visuals', ['waffle', 'radial', 'rose', 'bubble', 'cloud', 'funnel']], ['Rankings, tables and lists', ['podium', 'top', 'table', 'latest', 'silent']], ['Status and notes', ['devwall', 'rate', 'io', 'health', 'snmpstatus', 'text']], ['SNMP polling', ['poll_sum', 'poll_donut', 'poll_board', 'poll_spark', 'poll_gauges', 'poll_line', 'poll_bars', 'poll_alarms', 'poll']]];
  const DS_HINT = { events: 'Counts, busiest devices / processes, severity, latest messages and charts over time.', alarms: 'Active, acknowledged, escalated, cleared alarms; by rule, device, severity; latest alarms.', devices: 'How many devices are reporting, silent, muted, overdue; by vendor, status or group.', system: 'Message rate now, database size, free disk space, messages dropped.' };
  // ---------- 1.58: polled devices and readings ----------
  const pollData = new Map();
  async function loadPoll(list) {
    if (!(S.info?.me?.perms || []).includes('polling')) { for (const x of list) if (x.type === 'poll') pollData.set(x.id, { error: 'Your account is not allowed to see SNMP polling.' }); return; }     // no request that can only be refused
    await Promise.all(list.filter((x) => x.type === 'poll').map(async (x) => { try { pollData.set(x.id, await api('/api/poll/tile', { method: 'POST', body: x.cfg?.poll || {} })); } catch (e) { pollData.set(x.id, { error: e.message || 'Cannot read the polling data.' }); } }));
  }
  const PST = { ok: 'var(--ok)', warn: 'var(--s4)', crit: 'var(--bad)', unk: 'var(--muted)' };
  const DEVST = { up: 'ok', down: 'crit', stale: 'warn', unknown: 'unk', off: 'unk' };
  const WORSE = ['unk', 'ok', 'warn', 'crit'];
  const pfmt = (e, v = e.v) => (e.text !== undefined && v === null ? esc(e.text) : Number.isFinite(v) ? esc((e.dec !== null && e.dec !== undefined ? v.toFixed(e.dec) : String(Math.round(v * 100) / 100)) + (e.unit ? ' ' + e.unit : '')) : '–');
  function pollHtml(t) {
    const d = pollData.get(t.id), sp = t.cfg?.poll || {}, shape = sp.shape || 'square'; if (!d) return '<div class="muted">Loading…</div>'; if (d.error) return `<div class="muted">${esc(d.error)}</div>`;
    const cell = (name, big, small, col, tip) => `<div class="pcell shp-${shape}" style="--c:${col};--ink:${shape === 'hexo' ? 'var(--text)' : inkOf(col)}" title="${esc(tip || name)}"><span class="pn">${esc(name)}</span><b>${big}</b>${small ? `<span class="tw">${small}</span>` : ''}</div>`;
    if (d.src === 'status' || d.src === 'alarms') {
      const rows = d.devices || []; if (!rows.length) return '<div class="muted">No polled device' + (sp.group ? ' in this group' : '') + ' yet. <a href="#polling">Add a device in SNMP polling</a>.</div>';
      const sum = Object.entries(d.groups).sort((a, b) => a[0].localeCompare(b[0]));
      const head = d.src === 'alarms' ? `<div class="bigv" style="color:${readable(d.alarms ? 'var(--s3)' : 'var(--ok)')}">${d.alarms}</div><div class="muted" style="margin-bottom:6px">open polling alarm${d.alarms === 1 ? '' : 's'}</div>` : `<div class="muted" style="margin-bottom:6px">${rows.filter((r) => r.state === 'up').length} of ${rows.length} up${rows.some((r) => r.state === 'down') ? ` · <b style="color:var(--bad)">${rows.filter((r) => r.state === 'down').length} no answer</b>` : ''}${d.alarms ? ` · <b style="color:var(--s3)">${d.alarms} alarm${d.alarms === 1 ? '' : 's'}</b>` : ''}</div>`;
      const SR = { down: 0, stale: 1, unknown: 2, off: 3, up: 4 };
      if (sp.sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name)); else if (sp.sort === 'worst') rows.sort((a, b) => (SR[a.state] ?? 2) - (SR[b.state] ?? 2) || b.alarms - a.alarms || a.name.localeCompare(b.name)); else if (sp.sort === 'high') rows.sort((a, b) => (b.rtt ?? -1) - (a.rtt ?? -1)); else if (sp.sort === 'low') rows.sort((a, b) => (a.rtt ?? 1e9) - (b.rtt ?? 1e9));
      const cnt = { up: rows.filter((r) => r.state === 'up').length, down: rows.filter((r) => r.state === 'down').length, stale: rows.filter((r) => r.state === 'stale').length };
      cnt.other = rows.length - cnt.up - cnt.down - cnt.stale;
      if (d.src === 'status' && sp.view === 'summary') {    // 1.97.5 big counts
        const box = (n, l, c, k) => `<a class="psum" href="#polling" style="--c:${c}"><b style="color:${n ? readable(c) : 'var(--muted)'}">${n}</b><span>${l}</span></a>`;
        return `<div class="psums">${box(cnt.up, 'up', 'var(--ok)')}${box(cnt.down, 'no answer', 'var(--bad)')}${box(cnt.stale, 'late', 'var(--s4)')}${cnt.other ? box(cnt.other, 'off / unknown', 'var(--muted)') : ''}${box(d.alarms, d.alarms === 1 ? 'alarm' : 'alarms', 'var(--s3)')}</div><div class="muted" style="margin-top:6px;font-size:12px">${rows.length} polled device${rows.length === 1 ? '' : 's'}${sp.group ? ' in ' + esc(sp.group) : ''}</div>`;
      }
      if (d.src === 'status' && sp.view === 'donut') {     // 1.97.5 donut of states
        const parts = [[cnt.up, 'Up', 'var(--ok)'], [cnt.down, 'No answer', 'var(--bad)'], [cnt.stale, 'Late', 'var(--s4)'], [cnt.other, 'Off / unknown', 'var(--muted)']].filter((x) => x[0]);
        let a0 = -Math.PI / 2; const R = 40, r = 27, tot = rows.length || 1;
        const arcs = parts.map(([n, , c]) => { const a1 = a0 + (n / tot) * Math.PI * 2 - (parts.length > 1 ? 0.03 : 0), big = a1 - a0 > Math.PI ? 1 : 0, P = (a, rr) => `${(50 + rr * Math.cos(a)).toFixed(2)} ${(50 + rr * Math.sin(a)).toFixed(2)}`;
          const d2 = n === tot ? `M50 ${50 - R} A${R} ${R} 0 1 1 49.99 ${50 - R} L49.99 ${50 - r} A${r} ${r} 0 1 0 50 ${50 - r} Z` : `M${P(a0, R)} A${R} ${R} 0 ${big} 1 ${P(a1, R)} L${P(a1, r)} A${r} ${r} 0 ${big} 0 ${P(a0, r)} Z`; a0 = a1 + (parts.length > 1 ? 0.03 : 0); return `<path d="${d2}" fill="${c}"/>`; }).join('');
        return `<div class="pdonut"><svg viewBox="0 0 100 100" aria-label="${cnt.up} of ${rows.length} up">${arcs}<text x="50" y="50" text-anchor="middle" class="pdv">${Math.round(cnt.up / tot * 100)}%</text><text x="50" y="62" text-anchor="middle" class="pdl">up</text></svg>${sp.legend === false ? '' : `<div class="pleg">${parts.map(([n, l, c]) => `<span><i style="background:${c}"></i>${l} <b>${n}</b></span>`).join('')}</div>`}</div>`;
      }
      if (d.src === 'alarms' && sp.view === 'big') { const al = rows.filter((r) => r.alarms); return `<div class="bigv" style="color:${readable(d.alarms ? 'var(--s3)' : 'var(--ok)')}">${d.alarms}</div><div class="muted">open polling alarm${d.alarms === 1 ? '' : 's'}${al.length ? ` on ${al.length} device${al.length === 1 ? '' : 's'}` : ''}</div>${al.length ? `<div class="pchips">${al.slice(0, sp.limit || 12).map((r) => `<a href="#polling?d=${esc(r.id)}" class="pchip">${esc(r.name)} <b>${r.alarms}</b></a>`).join('')}</div>` : ''}`; }
      if (sp.limit) rows.splice(sp.limit);
      const shown = d.src === 'alarms' ? rows.filter((r) => r.alarms) : rows;
      if (sp.view === 'table' || d.src === 'alarms') return head + (shown.length ? `<table class="data"><thead><tr><th>Device</th>${sum.length > 1 || sum[0]?.[0] ? '<th>Group</th>' : ''}<th>Status</th><th class="num-r">Answer</th><th class="num-r">Alarms</th></tr></thead><tbody>${shown.map((r) => `<tr><td><a href="#polling?d=${esc(r.id)}">${esc(r.name)}</a></td>${sum.length > 1 || sum[0]?.[0] ? `<td class="muted">${esc(r.group)}</td>` : ''}<td><span class="sdot" style="background:${PST[DEVST[r.state] || 'unk']}"></span> ${esc(r.state)}</td><td class="num-r">${r.rtt === null ? '–' : r.rtt + ' ms'}</td><td class="num-r">${r.alarms || ''}</td></tr>`).join('')}</tbody></table>` : '');
      const by = {}; rows.forEach((r) => (by[r.group] ||= []).push(r));
      return head + Object.keys(by).sort().map((g) => `${Object.keys(by).length > 1 || g ? `<div class="pgh">${esc(g || 'No group')} <span class="muted">${by[g].filter((r) => r.state === 'up').length}/${by[g].length}</span></div>` : ''}<div class="ptiles">${by[g].map((r) => `<a href="#polling?d=${esc(r.id)}" class="pa">${cell(r.name, esc(r.state), r.alarms ? r.alarms + ' alarm' + (r.alarms === 1 ? '' : 's') : '', PST[r.alarms && r.state === 'up' ? 'warn' : DEVST[r.state] || 'unk'], r.name + ' · ' + r.state)}</a>`).join('')}</div>`).join('');
    }
    let es = (d.entries || []).map((e) => (sp.dec !== undefined ? { ...e, dec: sp.dec } : e)); if (!es.length) return '<div class="muted">Nothing to show yet. Edit the tile and choose readings, or wait for the next poll.</div>';
    { const W = { crit: 0, warn: 1, unk: 2, ok: 3 }, nv = (e) => (Number.isFinite(e.v) ? e.v : null);
      if (sp.sort === 'name') es.sort((a, b) => `${a.devName} ${a.row}`.localeCompare(`${b.devName} ${b.row}`)); else if (sp.sort === 'high') es.sort((a, b) => (nv(b) ?? -Infinity) - (nv(a) ?? -Infinity)); else if (sp.sort === 'low') es.sort((a, b) => (nv(a) ?? Infinity) - (nv(b) ?? Infinity)); else if (sp.sort === 'worst') es.sort((a, b) => (W[a.state] ?? 2) - (W[b.state] ?? 2) || (nv(b) ?? 0) - (nv(a) ?? 0));
      if (sp.limit) es = es.slice(0, sp.limit); }
    const same = es.every((e) => e.label === es[0].label), nm = (e) => (sp.compact ? (e.row ? e.row : e.devName) : e.devName + (e.row ? ' · ' + e.row : '') + (same ? '' : ' · ' + e.label)), col = (e) => PST[e.state];
    const nums = es.map((e) => e.v).filter(Number.isFinite), worst = es.reduce((w, e) => (WORSE.indexOf(e.state) > WORSE.indexOf(w) ? e.state : w), 'unk');
    const agg = () => { if (!nums.length) return null; const a = sp.agg || 'max'; return a === 'first' ? es.find((e) => Number.isFinite(e.v)).v : a === 'avg' ? nums.reduce((x, y) => x + y, 0) / nums.length : a === 'min' ? Math.min(...nums) : a === 'sum' ? nums.reduce((x, y) => x + y, 0) : Math.max(...nums); };
    const e0 = es[0];
    if (sp.view === 'big') { const v = agg(); return `<div class="bigv" style="color:${worst === 'unk' ? 'inherit' : readable(PST[worst])}">${pfmt(e0, v)}</div><div class="muted">${esc(same ? e0.label : 'readings')} · ${{ first: 'first', avg: 'average', min: 'lowest', max: 'highest', sum: 'total' }[sp.agg || 'max']} of ${es.length}</div>`; }
    if (sp.view === 'gauge') { const v = agg(), mx = sp.max || e0.max || Math.max(100, ...nums), f = Math.min(1, Math.max(0, (v || 0) / mx)), a = Math.PI * (1 - f), x = 60 + 48 * Math.cos(a), y = 62 - 48 * Math.sin(a); return `<svg viewBox="0 0 120 76" style="width:100%;max-height:100%"><path d="M12 62 A48 48 0 0 1 108 62" fill="none" stroke="var(--line)" stroke-width="10" stroke-linecap="round"/><path d="M12 62 A48 48 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="${worst === 'unk' ? 'var(--accent)' : PST[worst]}" stroke-width="10" stroke-linecap="round"/><text x="60" y="60" text-anchor="middle" font-size="16" font-weight="700" fill="currentColor">${pfmt(e0, v)}</text></svg><div class="muted" style="text-align:center">${esc(same ? e0.label : 'readings')} · ${es.length} value${es.length === 1 ? '' : 's'}</div>`; }
    if (sp.view === 'bars') { const mx = sp.max || Math.max(...es.map((e) => e.max || 0), ...nums, 1); return `<div class="hbars">${es.map((e) => `<div class="hb" title="${esc(nm(e))}"><span class="trunc">${esc(nm(e))}</span><span class="hbt"><i style="width:${Math.min(100, Math.max(0, (e.v || 0) / mx * 100))}%;background:${e.state === 'unk' ? 'var(--accent)' : col(e)}"></i></span><b>${pfmt(e)}</b></div>`).join('')}</div>`; }
    const tcol = (i) => css('--c' + (i % 10)) || PAL[i % PAL.length];
    if (sp.view === 'gauges') {      // 1.97.5 one small gauge per reading
      return `<div class="pgauges">${es.map((e) => { const mx = sp.max || e.max || 100, f = Number.isFinite(e.v) ? Math.min(1, Math.max(0, e.v / mx)) : 0, a = Math.PI * (1 - f), x = 50 + 38 * Math.cos(a), y = 48 - 38 * Math.sin(a), c = e.state === 'unk' ? 'var(--accent)' : col(e);
        return `<div class="pg" title="${esc(nm(e) + ' · ' + pfmt(e))}"><svg viewBox="0 0 100 58"><path d="M12 48 A38 38 0 0 1 88 48" fill="none" stroke="var(--line)" stroke-width="8" stroke-linecap="round"/>${f > 0 ? `<path d="M12 48 A38 38 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"/>` : ''}<text x="50" y="46" text-anchor="middle" class="pgv" style="fill:${e.state === 'unk' ? 'var(--text)' : readable(c)}">${pfmt(e).replace(/ [^ ]+$/, (u) => (e.unit && u.trim() === e.unit ? '' : u))}</text></svg><span class="pgn trunc">${esc(nm(e))}</span>${e.unit ? `<span class="pgu">${esc(e.unit)}</span>` : ''}</div>`; }).join('')}</div>`;
    }
    if (sp.view === 'spark') {       // 1.97.5 value with a small history line
      const ser = new Map((d.series || []).map((x) => [x.key, x])), x0 = d.from, x1 = d.to;
      return `<div class="psparks">${es.map((e, i) => { const sr = ser.get(e.dev + '|' + e.k + '|' + (e.row || '')), pts = (sr?.pts || []).filter((p) => Number.isFinite(p[1])), ys = pts.map((p) => p[1]), lo = Math.min(...ys), hi = Math.max(...ys), c = e.state === 'unk' || e.state === 'ok' ? tcol(i) : col(e);
        const line = pts.length > 1 ? pts.map((p) => `${(2 + (p[0] - x0) / (x1 - x0 || 1) * 96).toFixed(1)},${(22 - (hi === lo ? 0.5 : (p[1] - lo) / (hi - lo)) * 20).toFixed(1)}`).join(' ') : '';
        return `<div class="psr" title="${esc(nm(e))}"><span class="trunc">${esc(nm(e))}</span><svg viewBox="0 0 100 24" preserveAspectRatio="none">${line ? `<polyline fill="none" stroke="${c}" stroke-width="1.6" vector-effect="non-scaling-stroke" points="${line}"/>${sp.fill ? `<polygon fill="${c}" opacity=".15" points="2,24 ${line} 98,24"/>` : ''}` : '<line x1="2" x2="98" y1="12" y2="12" stroke="var(--line)" stroke-dasharray="3 3"/>'}</svg><b style="color:${e.state === 'ok' || e.state === 'unk' ? 'var(--text)' : readable(col(e))}">${pfmt(e)}</b></div>`; }).join('')}</div>`;
    }
    if (sp.view === 'tiles') return `<div class="ptiles">${es.map((e) => cell(nm(e), pfmt(e), esc(e.meaning || ''), e.state === 'unk' ? 'var(--accent)' : col(e), nm(e) + ' · ' + pfmt(e))).join('')}</div>`;
    if (sp.view === 'line') {
      const ser = d.series || []; if (!ser.some((x) => x.pts.length)) return '<div class="muted">No history for this period yet.</div>';
      const all = ser.flatMap((x) => x.pts), x0 = d.from, x1 = d.to, ys = all.map((p) => p[1]).filter(Number.isFinite), lo = Math.min(0, ...ys), hi = Math.max(...ys, sp.max || 0, lo + 1), X = (x) => 4 + (x - x0) / (x1 - x0 || 1) * 392, Y = (y) => 128 - (y - lo) / (hi - lo) * 120;
      return `<svg viewBox="0 0 400 134" preserveAspectRatio="none" style="width:100%;height:calc(100% - 38px);min-height:90px"><line x1="4" x2="396" y1="128" y2="128" stroke="var(--line)"/><line x1="4" x2="396" y1="8" y2="8" stroke="var(--line)" stroke-dasharray="3 4"/>${ser.map((x, i) => { const pl = x.pts.filter((p) => Number.isFinite(p[1])).map((p) => X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' '), dots = x.pts.length < 3 ? x.pts.filter((p) => Number.isFinite(p[1])).map((p) => `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="3" fill="${tcol(i)}"/>`).join('') : '';
        return `${sp.fill && pl ? `<polygon fill="${tcol(i)}" opacity=".14" points="${pl.split(' ')[0].split(',')[0]},128 ${pl} ${pl.split(' ').pop().split(',')[0]},128"/>` : ''}<polyline fill="none" stroke="${tcol(i)}" stroke-width="1.8" vector-effect="non-scaling-stroke" points="${pl}"/>${dots}`; }).join('')}</svg><div class="legend">${ser.map((x, i) => `<span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;background:${tcol(i)}"></i>${esc(x.name)}</span>`).join('')}</div><div class="muted" style="font-size:11px">${esc(String(Math.round(lo * 10) / 10))} – ${esc(String(Math.round(hi * 10) / 10))}${esc(ser[0].unit ? ' ' + ser[0].unit : '')} · last ${sp.hours || 6} h</div>`;
    }
    const grp = es.some((e) => e.group);
    return `<table class="data"><thead><tr><th>Device</th>${grp ? '<th>Group</th>' : ''}${same ? '' : '<th>Reading</th>'}<th class="num-r">${same ? esc(e0.label) : 'Value'}</th></tr></thead><tbody>${es.map((e) => `<tr><td><a href="#polling?d=${esc(e.dev)}">${esc(e.devName)}</a>${e.row ? ` <span class="muted">${esc(e.row)}</span>` : ''}</td>${grp ? `<td class="muted">${esc(e.group)}</td>` : ''}${same ? '' : `<td>${esc(e.label)}</td>`}<td class="num-r"><span class="sdot" style="background:${col(e)}"></span> <b>${pfmt(e)}</b>${e.meaning ? ` <span class="muted">${esc(e.meaning)}</span>` : ''}</td></tr>`).join('')}</tbody></table>`;
  }
  async function pollDialog(existing, preset) {
    let cat; try { cat = await api('/api/poll/catalog'); } catch (e) { return toast(e.message || 'Cannot read the polled devices.', true); }
    const t = existing ? structuredClone(existing) : { id: 'u' + Date.now().toString(36), type: 'poll', title: '', x: 0, y: 0, w: TYPES.poll.w, h: TYPES.poll.h, cfg: {} };
    const sp = t.cfg.poll = { src: 'readings', view: 'table', hours: 6, picks: [], ...(preset || {}), ...(t.cfg.poll || {}) }; sp.picks = [...(sp.picks || [])];
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
        <div class="field"><label for="pdV">Look</label><div><select id="pdV">${(isR ? [['table', 'Table'], ['tiles', 'Tile grid (coloured by what the value means)'], ['bars', 'Bar list'], ['spark', 'Values with a trend line'], ['gauges', 'One small gauge per reading'], ['big', 'One big number'], ['gauge', 'One gauge (values combined)'], ['line', 'Graph (one line per reading)']] : sp.src === 'status' ? [['summary', 'Summary (up / no answer / late)'], ['donut', 'Donut'], ['tiles', 'Tile grid'], ['table', 'Table']] : [['table', 'Table'], ['big', 'One big number']]).map(([v, l]) => opt(v, l, sp.view)).join('')}</select></div></div>
        ${sp.view === 'tiles' ? `<div class="field"><label for="pdSh">Tile shape</label><div><select id="pdSh">${[['square', 'Square'], ['round', 'Rounded square'], ['circle', 'Circle'], ['hex', 'Hexagon'], ['hexo', 'Hexagon outline']].map(([v, l]) => opt(v, l, sp.shape || 'square')).join('')}</select></div></div>` : ''}
        ${['big', 'gauge'].includes(sp.view) && isR ? `<div class="field"><label for="pdA">Combine values</label><div><select id="pdA">${[['max', 'Highest'], ['min', 'Lowest'], ['avg', 'Average'], ['sum', 'Total'], ['first', 'First one']].map(([v, l]) => opt(v, l, sp.agg || 'max')).join('')}</select></div></div>` : ''}
        ${(isR && !['big', 'gauge'].includes(sp.view)) || (sp.src === 'status' && ['tiles', 'table'].includes(sp.view)) || (sp.src === 'alarms' && sp.view === 'table') ? `<div class="field"><label for="pdSo">Order</label><div><select id="pdSo">${(isR ? [['', 'As added'], ['name', 'By name'], ['high', 'Highest value first'], ['low', 'Lowest value first'], ['worst', 'Problems first']] : [['', 'By group'], ['name', 'By name'], ['worst', 'Problems first'], ['high', 'Slowest answer first'], ['low', 'Fastest answer first']]).map(([v, l]) => opt(v, l, sp.sort || '')).join('')}</select> &nbsp; <label for="pdLi" style="display:inline">Show at most</label> <input id="pdLi" type="number" min="1" max="200" style="width:80px" value="${sp.limit ?? ''}" placeholder="all"></div></div>` : ''}
        ${isR ? `<div class="field"><label for="pdDe">Decimals</label><div><select id="pdDe">${[['', 'As set for the reading'], ['0', '0'], ['1', '1'], ['2', '2'], ['3', '3']].map(([v, l]) => opt(v, l, sp.dec ?? '')).join('')}</select> &nbsp; <label class="chk" style="display:inline-flex"><input type="checkbox" id="pdCo" ${sp.compact ? 'checked' : ''}> Short names (device or row only)</label></div></div>` : ''}
        ${['line', 'spark'].includes(sp.view) ? `<div class="field"><label for="pdFi">Fill</label><div><label class="chk"><input type="checkbox" id="pdFi" ${sp.fill ? 'checked' : ''}> Shade the area under the line</label></div></div>` : ''}
        ${sp.view === 'donut' ? `<div class="field"><label for="pdLg">Legend</label><div><label class="chk"><input type="checkbox" id="pdLg" ${sp.legend === false ? '' : 'checked'}> Show the legend</label></div></div>` : ''}
        ${['gauge', 'gauges', 'bars', 'line'].includes(sp.view) && isR ? `<div class="field"><label for="pdM">Top of the scale</label><div><input id="pdM" type="number" step="any" style="width:100px" value="${sp.max ?? ''}" placeholder="automatic"></div></div>` : ''}
        ${['line', 'spark'].includes(sp.view) ? `<div class="field"><label for="pdH">Time range</label><div><select id="pdH">${[[1, '1 hour'], [6, '6 hours'], [24, '24 hours'], [168, '7 days']].map(([v, l]) => opt(v, l, sp.hours)).join('')}</select></div></div>` : ''}
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
      $b('pdS').onchange = (e) => { sp.src = e.target.value; sp.view = sp.src === 'readings' ? 'table' : sp.src === 'status' ? 'summary' : 'table'; draw(); };
      $b('pdV').onchange = (e) => { sp.view = e.target.value; draw(); };
      if ($b('pdSh')) $b('pdSh').onchange = (e) => { sp.shape = e.target.value; }; if ($b('pdA')) $b('pdA').onchange = (e) => { sp.agg = e.target.value; };
      if ($b('pdM')) $b('pdM').onchange = (e) => { if (e.target.value === '') delete sp.max; else sp.max = +e.target.value; }; if ($b('pdH')) $b('pdH').onchange = (e) => { sp.hours = +e.target.value; };
      if ($b('pdG')) $b('pdG').onchange = (e) => { if (e.target.value) sp.group = e.target.value; else delete sp.group; };
      $b('pdWd').onchange = (e) => { t.w = +e.target.value; }; $b('pdHt').onchange = (e) => { t.h = +e.target.value; };
      if ($b('pdSo')) $b('pdSo').onchange = (e) => { if (e.target.value) sp.sort = e.target.value; else delete sp.sort; };
      if ($b('pdLi')) $b('pdLi').onchange = (e) => { const v = Math.round(+e.target.value); if (v >= 1) sp.limit = Math.min(200, v); else delete sp.limit; };
      if ($b('pdDe')) $b('pdDe').onchange = (e) => { if (e.target.value === '') delete sp.dec; else sp.dec = +e.target.value; };
      if ($b('pdCo')) $b('pdCo').onchange = (e) => { if (e.target.checked) sp.compact = true; else delete sp.compact; };
      if ($b('pdFi')) $b('pdFi').onchange = (e) => { if (e.target.checked) sp.fill = true; else delete sp.fill; };
      if ($b('pdLg')) $b('pdLg').onchange = (e) => { if (e.target.checked) delete sp.legend; else sp.legend = false; };
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
    const works = (k) => (k === 'poll' || POLL_CARDS[k] ? 'SNMP polling' : VIS_DS[k] ? [...new Set(VIS_DS[k].map((x) => ({ events: 'Syslog / traps', alarms: 'Alarms', devices: 'Devices', poll: 'SNMP polling', system: 'System' }[x])))].join(' · ') : 'Fixed content');
    const card = (k) => `<button type="button" class="vcard" data-type="${k}" aria-label="${esc(cardMeta(k).label)}"><span class="vthumb">${(POLL_CARDS[k] && POLL_CARDS[k][3]) || THUMB[k] || THUMB.poll || ''}</span><b>${esc(cardMeta(k).label)}</b><span class="muted vdesc">${esc(cardMeta(k).desc)}</span><span class="vworks">${esc(works(k))}</span></button>`;
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
    back.addEventListener('input', (e) => { if (e.target.id !== 'vFind') return; const f = e.target.value.trim().toLowerCase(); for (const b of $$('.vcard', back)) b.hidden = !!f && !(`${cardMeta(b.dataset.type).label} ${cardMeta(b.dataset.type).desc} ${works(b.dataset.type)}`.toLowerCase().includes(f)); for (const g of $$('.gcat', back)) g.hidden = !$$('.vcard:not([hidden])', g).length; });
    back.addEventListener('click', (e) => {
      if (e.target.id === 'mBack') return show(stepOne());
      const b = e.target.closest('button[data-type]'); if (b) { picked = b.dataset.type; if (POLL_CARDS[picked]) { close(); return pollDialog(null, POLL_CARDS[picked][2]); } if (!VIS_DS[picked]) { close(); return tileDialog(null, picked); } const kinds = [...new Set(VIS_DS[picked])]; return show(stepTwo(picked)); }
      const d = e.target.closest('button[data-ds]'); if (d) { close(); tileDialog(null, picked, d.dataset.ds); }
    });
  }

  // ----- header controls -----
  /** click-through: syslog and traps open the message pages; alarms open the Alarms page; devices open the Devices page */
  const drillTile = (t, by, key) => {
    const k = dsKind(t);
    if (k === 'poll') { location.hash = '#polling'; return; }
    if (k === 'alarms') { const st = by === 'state' ? ({ open: 'open', ack: 'ack', cleared: 'cleared', escalated: 'escalated' }[key] || 'active') : ({ active: 'active', open: 'open', ack: 'ack', esc: 'escalated', cleared: 'cleared' }[t.cfg?.filter?.astate] || 'active'); S.alarmState = st; S.alarmSrc = by === 'source' ? String(key) : ''; S.alarmRange = ''; try { sessionStorage.setItem('sp.alarmQ', by === 'host' || by === 'rule' ? String(key) : ''); } catch { /* ignore */ } location.hash = '#alarms'; return; }
    if (k === 'devices') { location.hash = '#devices'; return; }
    return drill(drillFilter(by, key, t));
  };
  const drill = (filter) => { S.cur = filter.source === 'snmp' ? 'snmp' : 'syslog'; S.filter = normFilter(filter); const p = SP.dash?.range?.preset || '24h'; S.range = DRILL_RANGE[p] || '86400000'; location.hash = filter.source === 'snmp' ? '#traps' : '#logs'; };
  const syncRange = () => {
    const r = SP.dash?.range || { preset: '24h' }; $('#dRange', el).value = r.preset; $('#dCustom', el).hidden = r.preset !== 'custom';
    if (r.preset === 'custom') { const loc = (t) => new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 16); $('#dFrom', el).value = loc(r.from); $('#dTo', el).value = loc(r.to); }
  };
  const discardDraft = () => {
    const d = draft; if (!d) return; draft = null;
    if (d.dash === null) delete S.prefs.dash; else S.prefs.dash = d.dash;
    if (d.boards === null) delete S.prefs.dashboards; else S.prefs.dashboards = d.boards;
    boardId = d.board; tiles = null;
    if (!sheetList().some((x) => x.id === d.sheet)) d.sheet = 'main';
    sheetId = d.sheet; try { localStorage.setItem(sheetKey(), sheetId); localStorage.setItem('ne.board', boardId); } catch { /* storage may be blocked */ }
    if (editing) { editing = false; $('#dEdit', el).textContent = 'Customize'; $('#dEdit', el).classList.remove('primary'); $('#dEditBar', el).hidden = true; }
    syncMenu(); syncBoards(); applyStyle(); syncRange(); drawSheets(); frames(); load(); toast('Changes discarded');
  };
  const setRange = (r) => { SP.dash = { ...(SP.dash || {}), range: r }; keep(); syncRange(); data = null; paint(); load(); schedule(); };
  el.addEventListener('change', (e) => {
    if (e.target.id !== 'dRange') return; const v = e.target.value;
    if (v === 'custom') { const now = Date.now(); SP.dash = { ...(SP.dash || {}), range: { preset: 'custom', from: SP.dash?.range?.from ?? now - 86400000, to: SP.dash?.range?.to ?? now } }; syncRange(); } else setRange({ preset: v });
  });
  // 1.68 the page buttons live in one three-dot menu; each item presses the matching (hidden) button so every action keeps its single code path
  const dMenu = $('#dMenu', el), dMore = $('#dMore', el);
  const closeMenu = () => { dMenu.hidden = true; dMore.setAttribute('aria-expanded', 'false'); };
  const syncMenu = () => { $('#dmEdit', el).textContent = editing ? 'Finish customizing' : 'Customize'; $('#dDone', el).hidden = !editing; };
  dMore.addEventListener('click', (e) => { e.stopPropagation(); const open = dMenu.hidden; dMenu.hidden = !open; dMore.setAttribute('aria-expanded', String(open)); if (open) { syncMenu(); dMenu.querySelector('button')?.focus(); } });
  dMenu.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; e.stopPropagation();
    if (b.dataset.sub) { const sub = $('#' + b.dataset.sub, el); sub.hidden = !sub.hidden; b.setAttribute('aria-expanded', String(!sub.hidden)); return; }
    if (!b.dataset.go) return; closeMenu();
    if (b.dataset.edit && !editing) $('#dEdit', el).click();   // adding a tile means customizing
    $('#' + b.dataset.go, el).click(); syncMenu();
  });
  $('#dDone', el).addEventListener('click', () => { $('#dEdit', el).click(); syncMenu(); });
  const outside = (e) => { if (!el.isConnected) return document.removeEventListener('click', outside); if (!dMenu.hidden && !e.target.closest('.dmore')) closeMenu(); };
  document.addEventListener('click', outside);
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dMenu.hidden) { closeMenu(); dMore.focus(); } });
  el.addEventListener('click', async (e) => {
    if (e.target.closest('#dWallBtn')) return wallMode(true);
    const al0 = e.target.closest('a.alink'); if (al0 && editing) { e.preventDefault(); return; }
    const ac = e.target.closest('[data-al]');
    const ar = e.target.closest('tr[data-aid]'); if (ar && !editing) { const tt = getTiles().find((x) => x.id === ar.closest('.widget').dataset.id); try { sessionStorage.setItem('sp.alarmQ', ar.dataset.q || ''); } catch { /* ignore */ } S.alarmState = 'active'; S.alarmSrc = ''; S.alarmRange = ''; location.hash = '#alarms'; return; }
    const dr = e.target.closest('tr[data-dev]'); if (dr && !editing) { location.hash = '#devices'; return; }
    if (ac) { e.preventDefault(); S.alarmState = ac.dataset.al === 'all' ? 'all' : ac.dataset.al; S.alarmSrc = ''; S.alarmRange = ''; location.hash = '#alarms'; return; }
    const id = e.target.id;
    if (id === 'dApply') { const f = new Date($('#dFrom', el).value).getTime(), t = new Date($('#dTo', el).value).getTime(); if (!(f < t)) return toast('Choose a start that is earlier than the end', true); return setRange({ preset: 'custom', from: f, to: t }); }
    if (id === 'dRefresh') return load(true);
    if (id === 'dSet') return styleDialog();
    if (id === 'dAurora') return addAurora();
    if (id === 'dCancel') { discardDraft(); return; }
    if (id === 'dEdit') { if (!editing) draft = { dash: structuredClone(S.prefs.dash ?? null), boards: structuredClone(S.prefs.dashboards ?? null), board: boardId, sheet: sheetId, dirty: false }; else if (draft) { const d = draft; draft = null; if (d.dirty) { savePrefs(); toast('Dashboard saved'); } } editing = !editing; $('#dEdit', el).textContent = editing ? 'Done' : 'Customize'; $('#dEdit', el).classList.toggle('primary', editing); $('#dEditBar', el).hidden = !editing; drawSheets(); showBar(); return frames(); }
    if (id === 'dReset') {
      if (!await askConfirm(sheetId === 'main' ? 'Put this sheet back to the standard tiles and layout?' : 'Put this sheet back to its standard tiles and layout?')) return;
      if (sheetRef()) { const d = SHEET_DEFS[sheetId]; SP.dash = { ...SP.dash, sheets: extraSheets().map((x) => (x.id === sheetId ? { ...x, tiles: d ? d.tiles() : [] } : x)) }; }
      else { delete SP.dash?.tiles; delete SP.dash?.blank; }
      keep(); tiles = null; frames(); return load();
    }
    if (id === 'dShAdd') return sheetAct('add'); if (id === 'dShRen') return sheetAct('ren'); if (id === 'dShIco') return sheetAct('ico'); if (id === 'dShDel') return sheetAct('del');
    if (id === 'dAdd') return addMenu();
    if (id === 'dWallLink') return wallMode.copy(); if (id === 'dWall') return wallMode(true); if (id === 'dExp') return boardAct('exp'); if (id === 'dImp') return boardAct('imp'); if (id === 'dSave') return boardAct('save'); if (id === 'dNew') return boardAct('new'); if (id === 'dRen') return boardAct('ren'); if (id === 'dDel') return boardAct('del');
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
  // ----- the sheet bar (1.73): a small panel at the bottom that appears when the mouse moves over the dashboard; a button per sheet, its name shows on hover -----
  const bar = document.createElement('nav'); bar.className = 'sheetbar'; bar.setAttribute('aria-label', 'Dashboard sheets'); document.body.appendChild(bar);
  let barTimer = null, barHover = false;
  const iconKey = (x) => (x.icon && SHEET_ICON[x.icon] ? x.icon : SHEET_ICON[x.id] ? x.id : '');
  const iconOf = (x) => SHEET_ICON[iconKey(x)] || SHEET_ICON.other;
  function drawSheets() {
    const list = sheetList(), many = list.length > 1;
    bar.innerHTML = list.map((x, i) => `<button type="button" class="sheetbtn${x.id === sheetId ? ' on' : ''}" data-sheet="${esc(x.id)}" data-tip="${esc(x.name)}" aria-label="${esc(x.name)}" aria-pressed="${x.id === sheetId}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconOf(x)}</svg>${iconKey(x) ? '' : `<i>${i + 1}</i>`}</button>`).join('')
      + (editing ? `<button type="button" class="sheetbtn add" data-sheetadd="1" data-tip="Add a sheet" aria-label="Add a sheet"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>` : '');
    bar.classList.toggle('none', !many && !editing);
    const nm = $('#dSheetName', el), cur = list.find((x) => x.id === sheetId); if (nm) nm.textContent = many && cur ? ' · ' + cur.name : ''; setWallName();
    const d = $('#dmShDel', el); if (d) d.hidden = sheetId === 'main';
  }
  function showBar() {
    if (document.hidden || bar.classList.contains('none')) return;
    let r = el.getBoundingClientRect(); if (r.width < 50 && el.parentElement) r = el.parentElement.getBoundingClientRect(); bar.style.left = Math.round((r.width >= 50 ? r.left + r.width / 2 : innerWidth / 2) / zf()) + 'px'; bar.classList.add('show');
    clearTimeout(barTimer); barTimer = setTimeout(() => { if (!barHover && !bar.contains(document.activeElement)) bar.classList.remove('show'); }, 2600);
  }
  const host = el.parentElement || el;
  host.addEventListener('mousemove', showBar); host.addEventListener('touchstart', showBar, { passive: true });
  bar.addEventListener('mouseenter', () => { barHover = true; clearTimeout(barTimer); bar.classList.add('show'); });
  bar.addEventListener('mouseleave', () => { barHover = false; showBar(); });
  bar.addEventListener('focusin', () => bar.classList.add('show'));
  bar.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.sheetadd) return sheetAct('add'); if (b.dataset.sheet) useSheet(b.dataset.sheet); showBar(); });
  function useSheet(id) {
    if (!sheetList().some((x) => x.id === id) || id === sheetId) return;
    sheetId = id; try { localStorage.setItem(sheetKey(), id); } catch { /* not remembered */ }
    tiles = null; data = null; cache.clear(); drawSheets(); frames(); memoPaint(); load();
    grid.classList.remove('sheetin'); void grid.offsetWidth; grid.classList.add('sheetin');
  }
  /** small box with the icons to choose from; resolves the icon key or null */
  function pickIcon(current) {
    return new Promise((resolve) => {
      const back = document.createElement('div'); back.className = 'modal-back';
      back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Choose an icon"><p class="confirm-msg">Choose an icon for this sheet:</p><div class="icopick">${ICON_NAMES.map((k) => `<button type="button" class="icobtn${k === current ? ' on' : ''}" data-ico="${k}" title="${k === 'main' ? 'grid' : k}" aria-label="${k}"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SHEET_ICON[k]}</svg></button>`).join('')}</div><div class="toolbar" style="margin:16px 0 0;justify-content:flex-end"><button type="button" data-a="no">Cancel</button></div></div>`;
      let done = false; const end = (v) => { if (done) return; done = true; back.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
      const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); end(null); } };
      document.addEventListener('keydown', key, true);
      back.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b?.dataset.ico) end(b.dataset.ico); else if (b?.dataset.a || e.target === back) end(null); });
      document.body.appendChild(back); (back.querySelector('.icobtn.on') || back.querySelector('.icobtn')).focus();
    });
  }
  async function sheetAct(a) {
    const cur = sheetList().find((x) => x.id === sheetId);
    if (a === 'add') {
      if (extraSheets().length >= 7) return toast('A dashboard can have up to 8 sheets. Delete one first.', true);
      const nm = cleanName(await askText('Name for the new sheet:', '')).slice(0, 30); if (!nm) return;
      const id = 'sh' + Date.now().toString(36).slice(-7);
      const ic = await pickIcon('chart'); SP.dash = { ...(SP.dash || {}), sheets: [...extraSheets(), { id, name: nm, tiles: [], ...(ic ? { icon: ic } : {}) }] }; keep(); useSheet(id); toast(`Added the sheet “${nm}”. Click Customize, then Add tile.`); return;
    }
    if (a === 'ren') { const nm = cleanName(await askText('New name for this sheet:', cur.name)).slice(0, 30); if (!nm) return; if (sheetId === 'main') SP.dash = { ...(SP.dash || {}), mainName: nm }; else SP.dash = { ...SP.dash, sheets: extraSheets().map((x) => (x.id === sheetId ? { ...x, name: nm } : x)) }; keep(); drawSheets(); return; }
    if (a === 'ico') {
      const ic = await pickIcon(iconKey(cur) || 'other'); if (!ic) return;
      if (sheetId === 'main') SP.dash = { ...(SP.dash || {}), mainIcon: ic }; else SP.dash = { ...SP.dash, sheets: extraSheets().map((x) => (x.id === sheetId ? { ...x, icon: ic } : x)) };
      keep(); drawSheets(); return;
    }
    if (a === 'del') {
      if (sheetId === 'main') return toast('The first sheet cannot be deleted. Rename it, or delete its tiles instead.', true);
      if (!await askConfirm(`Delete the sheet “${cur.name}”? Its tiles are lost.`)) return;
      SP.dash = { ...SP.dash, sheets: extraSheets().filter((x) => x.id !== sheetId) }; keep(); sheetId = 'main'; try { localStorage.setItem(sheetKey(), 'main'); } catch { /* ignore */ }
      tiles = null; data = null; cache.clear(); drawSheets(); frames(); load();
    }
  }
  // ----- named dashboards (1.36) -----
  if (boardId && !boards().some((b) => b.id === boardId)) boardId = '';
  const boardSel = $('#dBoard', el);
  const syncBoards = () => { boardSel.innerHTML = [{ id: '', name: S.prefs.dashMainName || 'Main dashboard' }, ...boards()].map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join(''); boardSel.value = boardId; $('#dDel', el).disabled = !boardId; setWallName(); };
  function useBoard(id) { boardId = id; try { localStorage.setItem('ne.board', id); } catch { /* blocked storage: the choice is not remembered */ } initSheets(); tiles = null; data = null; cache.clear(); applyStyle(); syncRange(); syncBoards(); drawSheets(); frames(); memoPaint(); load(); schedule(); }
  const cleanName = (v) => String(v ?? '').replace(/[<>\r\n]/g, ' ').trim().slice(0, 40);
  const newId = () => 'b' + Date.now().toString(36) + Math.floor(Math.random() * 100).toString(36);
  async function boardAct(a) {
    if (a === 'exp') return exportBoard(); if (a === 'imp') return importBoard();
    const cur = boardList();
    if (a === 'save' || a === 'new') {
      if (boards().length >= 19) return toast('You can keep up to 20 dashboards. Delete one first.', true);
      const nm = cleanName(await askText(a === 'save' ? 'Name for the copy of this dashboard:' : 'Name for the new dashboard:', a === 'save' ? cur.name + ' copy' : '')); if (!nm) return;
      const dash = a === 'save' ? { ...structuredClone(SP.dash || {}), alarmTiles: true, snmpTiles: true, tiles: structuredClone(mainTiles()), sheets: structuredClone(extraSheets()) } : { blank: true, alarmTiles: true, snmpTiles: true, sheets: [] };
      S.prefs.dashboards = [...boards(), { id: newId(), name: nm, dash }]; keep(); useBoard(S.prefs.dashboards.at(-1).id); toast(`Saved as “${nm}”`); return;
    }
    if (a === 'ren') { const nm = cleanName(await askText('New name for this dashboard:', cur.name)); if (!nm) return; if (boardId) boards().find((b) => b.id === boardId).name = nm; else S.prefs.dashMainName = nm; keep(); syncBoards(); return; }
    if (a === 'del') { if (!boardId || !await askConfirm(`Delete the dashboard “${cur.name}”? Its tiles are lost.`)) return; S.prefs.dashboards = boards().filter((b) => b.id !== boardId); if (!S.prefs.dashboards.length) delete S.prefs.dashboards; keep(); useBoard(''); }
  }

  // ----- sharing (1.42): export / import a dashboard as a file, and a wall display (kiosk) mode -----
  const slug = (n) => String(n || 'dashboard').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'dashboard';
  function exportBoard() {
    const cur = boardList(), dash = { ...structuredClone(SP.dash || {}), tiles: structuredClone(mainTiles()), sheets: structuredClone(extraSheets()) };
    const blob = new Blob([JSON.stringify({ neteventpro: 'dashboard', format: 1, name: cur.name, exported: new Date().toISOString(), dash }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `neteventpro-dashboard-${slug(cur.name)}.json`; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast(`Exported “${cur.name}”`);
  }
  /** 1.99.1: the ready-made "Aurora" dashboard, added from the menu without a file */
  async function addAurora() {
    try {
      if (!window.NEP_DASH_AURORA) await new Promise((ok, no) => { const sc = document.createElement('script'); sc.src = 'dash-aurora.js'; sc.onload = ok; sc.onerror = () => no(new Error('The ready-made dashboard could not be loaded.')); document.head.appendChild(sc); });
      await addBoardFrom(structuredClone(window.NEP_DASH_AURORA));
    } catch (e) { toast(e.message || 'Could not add the dashboard.', true); }
  }
  async function addBoardFrom(j) {
        if (!j || j.neteventpro !== 'dashboard' || !j.dash || !Array.isArray(j.dash.tiles)) throw new Error('This is not a NetEventPro dashboard file.');
        if (j.dash.tiles.length > 300) throw new Error('The dashboard has too many tiles (over 300).');
        if (boards().length >= 19) throw new Error('You can keep up to 20 dashboards. Delete one first.');
        let nm = cleanName(j.name) || 'Imported dashboard'; if ([S.prefs.dashMainName || 'Main dashboard', ...boards().map((b) => b.name)].includes(nm)) nm = cleanName(nm + ' (imported)');
        const dash = { ...structuredClone(j.dash), alarmTiles: true, snmpTiles: true, sheets: Array.isArray(j.dash.sheets) ? j.dash.sheets : [] }; delete dash.slicer; delete dash.snmpFirst;
        S.prefs.dashboards = [...boards(), { id: newId(), name: nm, dash }]; await keep(); useBoard(S.prefs.dashboards.at(-1).id); toast(`Added “${nm}”`);
  }
  function importBoard() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return;
      try {
        if (f.size > 2e6) throw new Error('The file is too large for a dashboard (over 2 MB).');
        await addBoardFrom(JSON.parse(await f.text()));
      } catch (e) { toast(e.message || 'Could not read the file.', true); }
    };
    inp.click();
  }
  /** the date-and-time title bar of the wall display: the same for every dashboard (1.50: it follows the 'kiosk' state of the page, not one dashboard's code) */
  /** wall display: "Dashboard · <sheet>" at the left of the title bar, the same heading as on the page (no dashboard name) */
  function setWallName() {
    const w = $('#wallBar .wname'); if (!w) return;
    const list = sheetList(), cur = list.find((x) => x.id === sheetId);
    w.innerHTML = `<b>Dashboard</b>${list.length > 1 && cur ? `<span class="wsheet"> · ${esc(cur.name)}</span>` : ''}`;
  }
  function wallBar(on) {
    let bar = $('#wallBar'); if (on && !bar) { bar = document.createElement('div'); bar.id = 'wallBar'; bar.innerHTML = '<span class="wname"></span><span class="wdate"></span><span class="wtime"></span>'; document.body.appendChild(bar); }
    setWallName();
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
  wallMode.copy = () => { const u = `${location.origin}${location.pathname}#dashboard?board=${encodeURIComponent(boardId)}${sheetId !== 'main' ? '&sheet=' + encodeURIComponent(sheetId) : ''}&kiosk=1`; navigator.clipboard?.writeText(u).then(() => toast('Wall display link copied. Open it on the wall computer and sign in once.'), () => toast(u)); };
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('kiosk')) wallMode(false); });
  const boardList = () => (boardId ? boards().find((b) => b.id === boardId) : { name: S.prefs.dashMainName || 'Main dashboard' }) || { name: 'Dashboard' };
  boardSel.addEventListener('change', () => useBoard(boardSel.value));
  initSheets(); applyStyle(); syncRange(); syncBoards(); drawSheets(); frames(); memoPaint(); load(); schedule();
  /** Left / Right arrow keys switch the sheet (not while typing, in a dialog or while customizing, where arrows move tiles) */
  const scroller = () => { for (let n = el; n && n !== document.body; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n; } return document.scrollingElement; };
  /** wall display has no scroll bars to grab: Up / Down / PageUp / PageDown / Home / End scroll the dashboard */
  const onScrollKey = (e) => {
    if (!document.body.classList.contains('kiosk') || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    const sc = scroller(); if (!sc) return; const page = Math.max(120, sc.clientHeight * 0.85), k = e.key;
    const by = k === 'ArrowDown' ? 140 : k === 'ArrowUp' ? -140 : k === 'PageDown' ? page : k === 'PageUp' ? -page : 0;
    if (by) sc.scrollBy({ top: by, behavior: 'smooth' }); else if (k === 'Home') sc.scrollTo({ top: 0, behavior: 'smooth' }); else if (k === 'End') sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' }); else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onScrollKey);
  const onArrow = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || editing || e.defaultPrevented) return;
    const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return; if (document.querySelector('.modal-back, .icopick')) return;
    const list = sheetList(); if (list.length < 2) return; const i = list.findIndex((x) => x.id === sheetId), n = (i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length;
    e.preventDefault(); useSheet(list[n].id); showBar();
  };
  document.addEventListener('keydown', onArrow);
  { const hq = S.hq; if (hq && hq.get('board') !== null && hq.get('board') !== boardId && (boards().some((b) => b.id === hq.get('board')) || hq.get('board') === '')) useBoard(hq.get('board')); if (hq && hq.get('sheet') && sheetList().some((x) => x.id === hq.get('sheet'))) useSheet(hq.get('sheet')); if (hq && hq.get('kiosk')) wallMode(true); }
  return () => { document.removeEventListener('keydown', onArrow); document.removeEventListener('keydown', onScrollKey); if (draft) { const d = draft; draft = null; if (d.dash === null) delete S.prefs.dash; else S.prefs.dash = d.dash; if (d.boards === null) delete S.prefs.dashboards; else S.prefs.dashboards = d.boards; boardId = d.board; } bar.remove(); clearTimeout(barTimer); document.body.classList.remove('kiosk'); $('#kioskExit')?.remove(); $('#wallBar')?.remove(); el.style.background = ''; for (const k of ['--accent', '--link', '--dr']) el.style.removeProperty(k); delete el.dataset.card; delete el.dataset.titles; S.onStats = null; clearInterval(timer); clearTimeout(roTimer); ro?.disconnect(); gro.disconnect(); window.removeEventListener('resize', resize); $$('.modal-back').forEach((n) => n.remove()); };
};
