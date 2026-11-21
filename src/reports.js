'use strict';
const { prepareFolder } = require('./fsutil');
// Scheduled reports. A report = a time period + filter + contents; it is rendered as CSV, Excel and/or PDF, then e-mailed
// and/or written to a folder (a local path or a network share such as \\server\share\reports).
const fs = require('node:fs');
const path = require('node:path');
const { buildXlsx } = require('./xlsx');
const { Pdf, W, H, widthOf } = require('./pdf');
const { sendMail, parseRecipients } = require('./mailer');
const { renderReportHtml, renderReportText } = require('./mailtpl');
const { SEVERITIES, FACILITIES } = require('./parser');
const SEVX = require('./sev');
const VC = require('./viewcols');
const FMT = require('./fmt');
const BRAND = require('./brand');

const SEV_COLORS = ['#b71c1c', '#d32f2f', '#e64a19', '#f57c00', '#fbc02d', '#1976d2', '#388e3c', '#757575', '#ffa726', '#26a69a'];
const PERIODS = { last24h: 'Last 24 hours', last7d: 'Last 7 days', last30d: 'Last 30 days', prevday: 'Yesterday', prevweek: 'Previous 7 full days', prevmonth: 'Previous calendar month' };
const MAX_ROWS_FILE = 100000, MAX_ROWS_PDF = 1500, MAX_MAIL_BYTES = 20 * 1024 * 1024;
const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => FMT.fileStamp(+d);
const local = (ts) => FMT.dateTime(ts);
const slug = (s) => String(s || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'report';

/** { from, to } in ms for a period name, relative to `now`; "yesterday", "last month" and so on follow the time zone chosen in Settings */
function periodRange(period, now = Date.now()) {
  const d = FMT.wall(now); const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate();
  const midnight = FMT.fromWall(Date.UTC(Y, M, D));
  switch (period) {
    case 'last7d': return { from: now - 7 * 86400000, to: now };
    case 'last30d': return { from: now - 30 * 86400000, to: now };
    case 'prevday': return { from: FMT.fromWall(Date.UTC(Y, M, D - 1)), to: midnight - 1 };
    case 'prevweek': return { from: FMT.fromWall(Date.UTC(Y, M, D - 7)), to: midnight - 1 };
    case 'prevmonth': return { from: FMT.fromWall(Date.UTC(Y, M - 1, 1)), to: FMT.fromWall(Date.UTC(Y, M, 1)) - 1 };
    default: return { from: now - 86400000, to: now };
  }
}

/** the most recent moment (<= now) the schedule says the report should have run (clock times are in the chosen time zone) */
function latestSlot(s, now = Date.now()) {
  const d = FMT.wall(now); const [hh, mm] = String(s.time || '08:00').split(':').map(Number);
  const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate(), at = (y, m, dd, h, mi) => FMT.fromWall(Date.UTC(y, m, dd, h, mi));
  if (s.type === 'hourly') { const t = at(Y, M, D, d.getUTCHours(), mm || 0); return t <= now ? t : t - 3600000; }
  if (s.type === 'weekly') {
    const t = at(Y, M, D - ((d.getUTCDay() - (s.dow ?? 1) + 7) % 7), hh, mm); return t <= now ? t : at(Y, M, D - ((d.getUTCDay() - (s.dow ?? 1) + 7) % 7) - 7, hh, mm);
  }
  if (s.type === 'monthly') {
    const dom = Math.min(28, Math.max(1, s.dom || 1)); const t = at(Y, M, dom, hh, mm);
    return t <= now ? t : at(Y, M - 1, dom, hh, mm);
  }
  const t = at(Y, M, D, hh, mm); return t <= now ? t : at(Y, M, D - 1, hh, mm);
}

class Reports {
  constructor({ config, store, dir }) {
    this.config = config; this.store = store; this.alarms = null; this.file = path.join(dir, 'reports-state.json'); this.running = new Set(); this.state = {};
    try { this.state = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch { /* none yet */ }
    this.timer = setInterval(() => require('./busy').run('scheduled reports', () => this.tick()).catch((e) => console.error('[reports]', e.message)), 30000); this.timer.unref?.();
  }
  close() { clearInterval(this.timer); }
  saveState() { try { fs.writeFileSync(this.file, JSON.stringify(this.state, null, 1)); } catch (e) { console.error('[reports] state', e.message); } }
  list() { return this.config.get().reports || []; }
  statusOf(id) { return { ...(this.state[id] || {}), running: this.running.has(id) }; }

  async tick() {
    if (require('./ha').passive()) return;        // 1.98.1 only the server in charge sends scheduled reports
    if (this.blocked?.()) return;
    const now = Date.now();
    for (const def of this.list()) {
      if (!def.enabled || this.running.has(def.id)) continue;
      const st = this.state[def.id] || (this.state[def.id] = { since: now });     // a new report never "catches up" on slots before it existed
      const slot = latestSlot(def.schedule, now);
      if (slot > (st.lastRun || st.since) && now - slot < 12 * 3600000) { st.lastRun = now; this.saveState(); await this.run(def, { deliver: true, scheduled: true }).catch(() => {}); }
    }
  }

  /** builds the files; with deliver=true also mails / stores them. Returns { files, summary, results[] } */
  async run(def, { deliver = true, scheduled = false } = {}) {
    if (this.running.has(def.id)) throw Object.assign(new Error('This report is already running.'), { userFacing: true, status: 409 });
    this.running.add(def.id); const st = this.state[def.id] || (this.state[def.id] = { since: Date.now() });
    const results = []; let files = [];
    try {
      const data = await this.collect(def); files = await this.render(def, data);
      if (deliver) {
        if (def.email?.enabled) results.push(await this.mail(def, data, files).then(() => ({ where: 'email', ok: true, detail: `sent to ${def.email.to}` }), (e) => ({ where: 'email', ok: false, detail: e.message })));
        if (def.folder?.enabled) results.push(await this.store2(def, files).then((d) => ({ where: 'folder', ok: true, detail: d }), (e) => ({ where: 'folder', ok: false, detail: e.message })));
        if (!results.length) results.push({ where: 'none', ok: true, detail: 'Created, but no delivery is turned on for this report.' });
      }
      const failed = results.filter((r) => !r.ok);
      st.lastRun = Date.now(); st.lastOk = !failed.length; st.lastMessage = failed.length ? failed.map((r) => `${r.where}: ${r.detail}`).join(' · ') : (deliver ? results.map((r) => r.detail).join(' · ') : 'Downloaded');
      st.lastRows = data.total; st.lastFiles = files.map((f) => f.name); st.lastScheduled = scheduled;
      return { files, summary: { total: data.total, from: data.from, to: data.to }, results };
    } catch (e) { st.lastRun = Date.now(); st.lastOk = false; st.lastMessage = e.message; throw e; }
    finally { this.running.delete(def.id); this.saveState(); }
  }

  /**
   * The "last 24 hours" PDF that is attached to escalation e-mails: alarms (active and history), the newest syslog messages and traps.
   * Made once and reused for 2 minutes, so a burst of escalations builds it only once; never touches the scheduled reports' state.
   */
  async quick24h() {
    const now = Date.now(); if (this.quickCache && now - this.quickCache.at < 120000) return this.quickCache.files;
    if (this.quickBusy) return this.quickBusy;
    this.quickBusy = (async () => {
      const def = { id: '_last24h', name: `${BRAND.brand(this.config.get()).name} last 24 hours`, period: 'last24h', filter: {}, formats: ['pdf'], content: { messages: true, maxRows: 400, traps: true, maxTrapRows: 300, alarmsActive: true, alarmHistory: true, maxAlarmRows: 500 } };
      const data = await this.collect(def); const files = await this.render(def, data); this.quickCache = { at: Date.now(), files }; return files;
    })();
    try { return await this.quickBusy; } finally { this.quickBusy = null; }
  }

  async collect(def) {
    const { from, to } = periodRange(def.period); const f = { ...(def.filter || {}) };
    const sv = def.view ? ((this.config.get().uiPrefs || {}).views || []).find((x) => x.id === def.view) : null;
    if (sv && sv.filter) { for (const k of ['host', 'app', 'text']) if (sv.filter[k]) f[k] = sv.filter[k]; if (sv.filter.sevs) f.sevs = sv.filter.sevs; }       // a saved view's filter replaces the matching fields of the report's own filter
    const filter = { ...f }; if (filter.tag) { filter.text = `tag:${filter.tag} ${filter.text || ''}`.trim(); delete filter.tag; }
    filter.source = 'syslog';
    const tiles = [
      { id: 'total', kind: 'count', filter }, { id: 'devices', kind: 'distinct', filter }, { id: 'sev', kind: 'top', by: 'severity', n: 10, filter },
      { id: 'hosts', kind: 'top', by: 'host', n: 15, filter }, { id: 'apps', kind: 'top', by: 'app', n: 15, filter }, { id: 'trend', kind: 'series', filter }
    ];
    const d = await this.store.dash({ from, to, tiles });
    const c = def.content || {}; const rows = []; let truncated = false;
    if (c.messages !== false) {
      const max = Math.min(MAX_ROWS_FILE, Math.max(1, +c.maxRows || 5000));
      for await (const r of this.store.iterate({ ...filter, from, to }, max + 1)) { if (rows.length >= max) { truncated = true; break; } rows.push(r); }
    }
    const sevN = new Array(10).fill(0); for (const r of d.tiles.sev.rows || []) sevN[r.key] = r.n;
    let traps = null, alarmsActive = null, alarmHistory = null;
    const tf = { ...filter, source: 'snmp' };       // the trap summary is part of the dashboard pages of every report; the trap list only when asked for
    const t2 = await this.store.dash({ from, to, tiles: [{ id: 'total', kind: 'count', filter: tf }, { id: 'devices', kind: 'distinct', filter: tf }, { id: 'sev', kind: 'top', by: 'severity', n: 10, filter: tf }, { id: 'names', kind: 'top', by: 'msgid', n: 12, filter: tf }, { id: 'hosts', kind: 'top', by: 'host', n: 12, filter: tf }, { id: 'trend', kind: 'series', filter: tf }] });
    const tsev = new Array(10).fill(0); for (const r of t2.tiles.sev.rows || []) tsev[r.key] = r.n;
    const trapSum = { total: t2.tiles.total.n, devices: t2.tiles.devices.n, sevN: tsev, names: t2.tiles.names.rows || [], hosts: t2.tiles.hosts.rows || [], series: t2.tiles.trend.series || [], bucketMs: t2.bucketMs };
    if (c.traps) {
      const trows = []; let ttrunc = false; const tmax = Math.min(MAX_ROWS_FILE, Math.max(1, +c.maxTrapRows || 2000));
      for await (const r of this.store.iterate({ ...tf, from, to }, tmax + 1)) { if (trows.length >= tmax) { ttrunc = true; break; } trows.push(r); }
      traps = { ...trapSum, rows: trows, truncated: ttrunc };
    }
    if (c.alarmsActive && this.alarms) alarmsActive = this.alarms.list({ state: 'active', limit: Math.min(500, +c.maxAlarmRows || 2000) }).alarms;
    if (c.alarmHistory && this.alarms) alarmHistory = this.alarms.between(from, to, +c.maxAlarmRows || 2000);
    let polling = null;
    if (c.polling && this.polling) { try { const hrs = Math.max(1, Math.min(8760, Math.ceil((to - from) / 3600000))); const rows = this.polling.summary(hrs, to).rows; try { const av = new Map(this.polling.availability(from, to).devices.map((x) => [x.id, x])); for (const r of rows) { const a = av.get(r.id); if (a) Object.assign(r, { availability: a.availability, target: a.target, met: a.met, downMin: a.downMin, outages: a.outages }); } } catch { /* the plain summary is still shown */ } polling = this.pollTable(rows); } catch { polling = null; } }   // 1.99.14 availability by time, SLA target, downtime and outages
    let dashSum = null;
    if (c.dashboard && this.dashFn) { try { dashSum = await require('./dashtiles').run((this.config.get().uiPrefs || {}), c.dashboard === 'main' ? '' : c.dashboard, from, to, this.dashFn); } catch { dashSum = null; } }
    const alarmSum = this.alarms ? { counts: this.alarms.counts(), sum: this.alarms.summary(from) } : null;
    return { trapSum, alarmSum, def, from: d.from, to: d.to, bucketMs: d.bucketMs, firstBucket: d.firstBucket, total: d.tiles.total.n, devices: d.tiles.devices.n, sevN, hosts: d.tiles.hosts.rows || [], apps: d.tiles.apps.rows || [], series: d.tiles.trend.series || [], rows, truncated, generated: Date.now(), traps, alarmsActive, alarmHistory, polling, dashSum };
  }

  /** polled devices as a table; a column is left out when no device has a value for it, so the report only shows what the person's devices really report */
  pollTable(list) {
    const f = (v, d = 1) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);
    const all = [['Device', (r) => r.name], ['Address', (r) => r.host], ['Site', (r) => r.site], ['Polls', (r) => r.polls], ['Availability %', (r) => f(r.availability, 3)], ['SLA target %', (r) => r.target ?? null], ['SLA met', (r) => (r.met === true ? 'yes' : r.met === false ? 'no' : null)], ['Downtime min', (r) => r.downMin ?? null], ['Outages', (r) => r.outages ?? null], ['CPU avg %', (r) => f(r.cpuAvg)], ['CPU max %', (r) => f(r.cpuMax)], ['Memory avg %', (r) => f(r.memAvg)], ['Memory max %', (r) => f(r.memMax)], ['Temp avg C', (r) => f(r.tempAvg)], ['Temp max C', (r) => f(r.tempMax)], ['Answer time avg ms', (r) => f(r.rttAvg)], ['Alarms', (r) => r.alarms]];
    const cols = all.filter(([, g], i) => i < 4 || list.some((r) => g(r) !== null && g(r) !== undefined && g(r) !== '' && (i !== 16 || true)));
    const keep = cols.filter(([h, g]) => !['Site'].includes(h) || list.some((r) => g(r)));
    return { head: keep.map((k) => k[0]), rows: list.map((r) => keep.map(([, g]) => g(r))) };
  }

  async render(def, data) {
    const base = `${slug(def.name)}-${stamp(new Date())}`; const out = []; const c = def.content || {};
    for (const fmt of def.formats || []) {
      if (fmt === 'csv') {
        if (c.messages !== false || (!data.traps && !data.alarmsActive && !data.alarmHistory)) out.push({ name: base + '.csv', type: 'text/csv', data: this.csv(data) });
        if (data.polling) out.push({ name: base + '-devices.csv', type: 'text/csv', data: this.csvOf(data.polling.head.map((h, k) => ({ label: h, get: (r) => r[k] })), data.polling.rows) });
        if (data.dashSum && data.dashSum.rows.length) out.push({ name: base + '-dashboard.csv', type: 'text/csv', data: this.csvOf([{ label: 'Tile', get: (r) => r[0] }, { label: 'Item', get: (r) => r[1] }, { label: 'Value', get: (r) => r[2] }], data.dashSum.rows) });
        if (data.traps) out.push({ name: base + '-traps.csv', type: 'text/csv', data: this.csvTraps(data) });
        if (data.alarmsActive) out.push({ name: base + '-active-alarms.csv', type: 'text/csv', data: this.csvAlarms(data.alarmsActive, false, data.def) });
        if (data.alarmHistory) out.push({ name: base + '-alarm-history.csv', type: 'text/csv', data: this.csvAlarms(data.alarmHistory.rows, true, data.def) });
      }
      if (fmt === 'xlsx') out.push({ name: base + '.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: this.xlsx(data, c) });
      if (fmt === 'pdf') out.push({ name: base + '.pdf', type: 'application/pdf', data: this.pdf(data, c) });
    }
    return out;
  }

  head(data) { return [`Report: ${data.def.name}`, `Period: ${local(data.from)} to ${local(data.to)}`, `Messages: ${data.total}`]; }
  /** the screen layout the exports use; a report that names a saved Logs view uses that view's columns for its syslog list */
  prefs(def) {
    const p = this.config.get().uiPrefs || {}; const v = def && def.view ? (p.views || []).find((x) => x.id === def.view) : null;
    if (!v || !Array.isArray(v.cols) || !v.cols.length) return p;
    return { ...p, columns: { ...(p.columns || {}), logs: v.cols.map((id) => ({ id, visible: true })), live: undefined, search: undefined } };
  }
  // CSV, Excel and PDF use the columns of the application windows (Settings of the Logs / Traps / Alarms column chooser), same headings, same order
  table(cols, rows, max = 32000) { return [cols.map((c) => c.label), ...rows.map((r) => cols.map((c) => String(c.get(r) ?? '').slice(0, max)))]; }
  csvOf(cols, rows) {
    let s = '\ufeff' + cols.map((c) => csvCell(c.label)).join(',') + '\r\n';
    for (const r of rows) s += cols.map((c) => csvCell(c.get(r))).join(',') + '\r\n';
    return Buffer.from(s, 'utf8');
  }
  csv(data) { return this.csvOf(VC.logColumns(this.prefs(data.def), 'logs'), data.rows); }
  csvTraps(data) { return this.csvOf(VC.logColumns(this.prefs(data.def), 'traps'), data.traps.rows); }
  csvAlarms(list, history = false, def) { return this.csvOf(VC.alarmColumns(this.prefs(def), history), list); }
  xlsx(data, c) {
    const b = (v) => ({ v, bold: true });
    const sum = [...(BRAND.brand(this.config.get()).custom ? [['Company', BRAND.brand(this.config.get()).name]] : []), [ 'Report', data.def.name ], ['Period', `${local(data.from)} to ${local(data.to)}`], ['Generated', local(data.generated)], ['Matching syslog messages', data.total], ['Devices that sent syslog', data.devices],
      ...(data.traps ? [['SNMP traps', data.traps.total], ['Devices that sent traps', data.traps.devices]] : []),
      ...(data.alarmsActive ? [['Active alarms now', data.alarmsActive.length]] : []),
      ...(data.alarmHistory ? [['Alarms raised in the period', data.alarmHistory.raised], ['Alarms cleared in the period', data.alarmHistory.cleared], ['Average time to clear (min)', Math.round(data.alarmHistory.avgClearMs / 60000)]] : []), [], [b('Syslog severity'), b('Messages')]];
    SEVX.ORDER.forEach((i) => sum.push([SEVX.label(i), data.sevN[i]])); sum.push([], [b('Busiest devices'), b('Messages'), b('Most serious')]);
    for (const r of data.hosts) sum.push([r.key, r.n, SEVX.label(r.worst)]); sum.push([], [b('Busiest processes'), b('Messages'), b('Most serious')]);
    for (const r of data.apps) sum.push([r.key, r.n, SEVX.label(r.worst)]);
    const sheets = [{ name: 'Summary', rows: sum, header: false, widths: [34, 44, 14] }];
    if (c.messages !== false) {
      const lc = VC.logColumns(this.prefs(data.def), 'logs');
      sheets.push({ name: 'Syslog', rows: this.table(lc, data.rows), widths: lc.map((c) => (c.w ? Math.max(8, Math.round(c.w / 4.5)) : 100)) });
    }
    if (data.traps) {
      const t = data.traps, tcols = VC.logColumns(this.prefs(data.def), 'traps');
      sheets.push({ name: 'SNMP traps', rows: this.table(tcols, t.rows), widths: tcols.map((c) => (c.w ? Math.max(8, Math.round(c.w / 4.5)) : 100)) });
      const top = [[b('Top traps'), b('Count'), b('Most serious')], ...t.names.map((x) => [x.key, x.n, SEVX.label(x.worst)]), [], [b('Top trap senders'), b('Count'), b('Most serious')], ...t.hosts.map((x) => [x.key, x.n, SEVX.label(x.worst)])];
      sheets.push({ name: 'Trap summary', rows: top, header: false, widths: [40, 12, 14] });
    }
    const acols = VC.alarmColumns(this.prefs(data.def), false), hcols = VC.alarmColumns(this.prefs(data.def), true), aw = (cols) => cols.map((c) => (c.w ? Math.max(8, Math.round(c.w / 4.5)) : 80));
    if (data.alarmsActive) sheets.push({ name: 'Active alarms', rows: this.table(acols, data.alarmsActive), widths: aw(acols) });
    if (data.alarmHistory) sheets.push({ name: 'Alarm history', rows: this.table(hcols, data.alarmHistory.rows), widths: aw(hcols) });
    if (data.dashSum && data.dashSum.rows.length) sheets.push({ name: 'Dashboard', rows: [['Tile', 'Item', 'Value'], ...data.dashSum.rows], widths: [34, 30, 14] });
    if (data.polling) sheets.push({ name: 'Polled devices', rows: [data.polling.head, ...data.polling.rows], widths: data.polling.head.map((h, k) => (k < 3 ? 22 : 14)) });
    return buildXlsx(sheets);
  }
  pdf(data, c) {
    const p = new Pdf(), M = 36; let y = M; const br = BRAND.brand(this.config.get());
    // dark only: every page gets the dashboard background and the light-theme colours are swapped for their dark counterparts
    const MAP = { '#111111': '#e6edf5', '#555555': '#9fb0c3', '#888888': '#7d8da1', '#e8edf3': '#1b2735', '#f1f4f8': '#151d28', '#999999': '#3a4a5e', '#cccccc': '#2f4056', '#333333': '#c9d4e0', '#757575': '#9fb0c3' };
    const dk = (c2) => MAP[String(c2 || '').toLowerCase()] || c2;
    const _rect = p.rect.bind(p), _text = p.text.bind(p), _line = p.line.bind(p), _np = p.newPage.bind(p);
    p.rect = (x, yy, w, h, c2) => _rect(x, yy, w, h, dk(c2)); p.line = (a, b, c2, d, col, wd) => _line(a, b, c2, d, dk(col || '#cccccc'), wd);
    p.text = (x, yy, str, o = {}) => _text(x, yy, str, { ...o, color: dk(o.color || '#111111') });
    p.newPage = () => { const n = _np(); _rect(0, 0, W, H, '#0e141c'); return n; };
    _rect(0, 0, W, H, '#0e141c');
    const N = (v) => Number(v || 0).toLocaleString('en-US'), fit = (str, n) => { str = String(str ?? ''); return str.length > n ? str.slice(0, n - 1) + '…' : str; };
    const wrap = (str, w, size) => {      // word wrap by measured width; very long words are cut
      const out = []; for (const para of String(str ?? '').split(/\r?\n/)) {
        let cur = ''; for (let word of para.split(/\s+/)) {
          while (widthOf(word, size, 'F1') > w && word.length > 1) { let k = word.length - 1; while (k > 1 && widthOf(word.slice(0, k), size, 'F1') > w) k--; if (cur) { out.push(cur); cur = ''; } out.push(word.slice(0, k)); word = word.slice(k); }
          const t = cur ? cur + ' ' + word : word; if (cur && widthOf(t, size, 'F1') > w) { out.push(cur); cur = word; } else cur = t;
        } out.push(cur);
      } return out;
    };
    const bar = (title, sub) => { p.rect(M, y, W - 2 * M, 18, '#e8edf3'); p.rect(M, y, 4, 18, '#1976d2'); p.text(M + 10, y + 4, title, { size: 11, font: 'F2' }); if (sub) p.textRight(W - M - 8, y + 5, sub, { size: 8, color: '#555555' }); y += 26; };
    const kpis = (items) => { const w = (W - 2 * M - 12 * (items.length - 1)) / items.length; items.forEach(([label, v, col], i) => { const x = M + i * (w + 12); p.rect(x, y, w, 42, '#f1f4f8'); if (col) p.rect(x, y, 4, 42, col); p.text(x + 12, y + 7, label, { size: 8, color: '#555555' }); p.text(x + 12, y + 20, v, { size: 16, font: 'F2' }); }); y += 54; };
    const sevAndTrend = (sevN, series, bucketMs, from, to) => {
      p.text(M, y, 'By severity', { size: 10, font: 'F2' }); p.text(M + 340, y, 'Over time', { size: 10, font: 'F2' }); y += 16;
      const mx = Math.max(1, ...sevN); SEVX.ORDER.forEach((i, row) => { const n = SEVX.label(i); const yy = y + row * 14; p.text(M, yy, n, { size: 8, max: 70 }); const w = Math.round((sevN[i] / mx) * 190); p.rect(M + 75, yy, Math.max(w, sevN[i] ? 2 : 0), 10, SEV_COLORS[i]); p.text(M + 75 + w + 6, yy, N(sevN[i]), { size: 8, color: '#333333' }); });
      const cx = M + 340, cw = W - M - cx, ch = 104, tot = series.map((bk) => bk.reduce((a2, x) => a2 + x, 0)), tmax = Math.max(1, ...tot), bw = cw / Math.max(1, tot.length);
      series.forEach((bk, i) => { let top = y + ch; bk.forEach((n, sv) => { const h = (n / tmax) * ch; if (h > 0) { p.rect(cx + i * bw, top - h, Math.max(bw - 0.6, 0.6), h, SEV_COLORS[sv]); top -= h; } }); });
      p.line(cx, y + ch, cx + cw, y + ch, '#999999'); p.text(cx, y + ch + 3, local(from).slice(0, 16), { size: 7, color: '#555555' }); p.textRight(cx + cw, y + ch + 3, local(to).slice(0, 16), { size: 7, color: '#555555' });
      p.textRight(cx + cw, y - 14, `peak ${N(tmax)} per ${bucketMs >= 3600000 ? bucketMs / 3600000 + ' h' : bucketMs / 60000 + ' min'}`, { size: 8, color: '#555555' });
      y += Math.max(ch + 22, SEVX.ORDER.length * 14 + 10);
    };
    const top = (x, title, rows, w, n = 8) => { p.text(x, y, title, { size: 10, font: 'F2' }); let yy = y + 15; for (const r of rows.slice(0, n)) { p.rect(x, yy + 1, 7, 7, SEV_COLORS[r.worst]); p.text(x + 12, yy, r.key, { size: 8.5, max: w - 60 }); p.textRight(x + w, yy, N(r.n), { size: 8.5 }); yy += 13; } return yy; };
    const grid = (title, cols, rows, sevOf, note) => {
      p.newPage(); y = M; p.text(M, y, title, { size: 13, font: 'F2' }); y += 20; if (note) { p.text(M, y, note, { size: 8, color: '#555555', max: W - 2 * M }); y += 14; }
      let ty = 0;      // top of the table on this page: faint column lines are drawn from here down to the last row
      const vlines = () => { for (const x of [M, ...cols.slice(1).map((c2) => c2[0] - 3), W - M]) p.line(x, ty, x, y - 1, '#243142', 0.4); };
      const header = () => { ty = y - 2; p.rect(M, y - 2, W - 2 * M, 14, '#e8edf3'); for (const [x, t] of cols) p.text(x + 2, y, t, { size: 8, font: 'F2' }); y += 16; p.line(M, y - 2, W - M, y - 2, '#2f4056', 0.5); }; header();
      if (!rows.length) p.text(M, y, 'None.', { size: 9, color: '#555555' });
      for (let i = 0; i < Math.min(rows.length, MAX_ROWS_PDF); i++) {
        // every cell wraps inside its own column; the row is as tall as its longest cell
        const cells = rows[i].map((v, k) => wrap(v, (cols[k + 1] ? cols[k + 1][0] : W - M) - cols[k][0] - 5 - (k ? 0 : 6), 7));
        const n = Math.min(8, Math.max(1, ...cells.map((c2) => c2.length)));
        if (y + n * 9 > H - M - 12) { vlines(); p.newPage(); y = M; header(); }
        if (sevOf) p.rect(M, y, 3, n * 9 - 1, SEV_COLORS[sevOf(i)]);
        cells.forEach((lines, k) => lines.slice(0, n).forEach((ln, j) => p.text(cols[k][0] + (k ? 0 : 6), y + j * 9, ln, { size: 7 }))); y += n * 9 + 2; p.line(M, y - 1, W - M, y - 1, '#243142', 0.3);
      }
      vlines();
      if (rows.length > MAX_ROWS_PDF) { y += 8; p.text(M, y, `Showing the first ${N(MAX_ROWS_PDF)} of ${N(rows.length)}. The CSV and Excel versions hold more.`, { size: 8, color: '#555555' }); }
    };

    // ===== page 1: summary page (dark, "soft cards" layout) =====
    {
      const al0 = data.alarmSum, t0 = data.trapSum, errs = (a2) => a2.slice(0, 4).reduce((x, y2) => x + y2, 0);
      const dur = (ms) => { const m = Math.round(Math.max(0, ms) / 60000); return m < 1 ? '< 1 min' : m < 90 ? m + ' min' : m < 2880 ? (Math.round(m / 6) / 10) + ' h' : (Math.round(m / 144) / 10) + ' days'; };
      const act = this.alarms ? this.alarms.list({ state: 'active', limit: 6 }).alarms : [], nAct = al0 ? al0.counts.open + al0.counts.ack : act.length, nEsc = al0 ? al0.counts.escalated : 0;
      const CARD = '#111925', LINE = '#243142';
      if (br.logo) { const lw = Math.min(150, 38 * br.logo.w / br.logo.h); p.image(M, y - 4, lw, br.logo); y += lw * br.logo.h / br.logo.w + 6; }
      p.text(M, y, br.name.toUpperCase(), { size: 8, color: '#9ec9f5', max: W - 2 * M }); y += 14;
      p.text(M, y, data.def.name, { size: 26, color: '#e6edf5' });
      if (nAct || nEsc) { const lbl = 'NEEDS ATTENTION', lw = widthOf(lbl, 8, 'F2') + 24; p.rrect(W - M - lw, y + 4, lw, 20, 10, null, '#ffb74d'); p.text(W - M - lw + 12, y + 10, lbl, { size: 8, font: 'F2', color: '#ffb74d' }); }
      y += 34; p.text(M, y, `${local(data.from)} to ${local(data.to)} · generated ${local(data.generated)}`, { size: 9, color: '#9fb0c3' }); y += 22;
      const cards = [['Active alarms', N(nAct), nAct ? '#ff6b6b' : '#4cd08a'], ['Cleared alarms', al0 ? N(al0.sum.cleared) : '0', '#4cd08a'], ['Syslog count', N(data.total), '#5ab0ff'], ['Trap count', N(t0.total), '#c58bff'], ['Average to clear', al0 && al0.sum.avgClearMs ? dur(al0.sum.avgClearMs) : '-', '#ffb74d'], ['Devices', N(Math.max(data.devices, t0.devices)), '#e6edf5']];
      const cw = (W - 2 * M - 10 * (cards.length - 1)) / cards.length;
      cards.forEach(([l, v, col], i) => { const x = M + i * (cw + 10); p.rrect(x, y, cw, 60, 8, CARD, LINE); p.text(x + 12, y + 11, v, { size: 22, color: col, max: cw - 20 }); p.text(x + 12, y + 41, l.toUpperCase(), { size: 7, color: '#9fb0c3' }); });
      y += 76;
      // left: summary text and the messages-over-time chart; right: the active alarms
      const LW = 400, RX = M + LW + 24, RW = W - M - RX, top0 = y;
      const lead = al0 ? `${N(al0.sum.raised)} alarms were raised and ${N(al0.sum.cleared)} cleared${al0.sum.avgClearMs ? `, on average within ${dur(al0.sum.avgClearMs)}` : ''}. ${nEsc ? `${N(nEsc)} alarm${nEsc === 1 ? ' was' : 's were'} escalated because nobody acknowledged ${nEsc === 1 ? 'it' : 'them'} in time, and ` : ''}${N(nAct)} ${nAct === 1 ? 'is' : 'are'} still active. ` : '';
      const lead2 = `${N(data.total)} syslog messages (${N(errs(data.sevN))} errors or worse) and ${N(t0.total)} SNMP traps (${N(errs(t0.sevN))} errors or worse) came from ${N(Math.max(data.devices, t0.devices))} devices.`;
      for (const ln of wrap(lead + lead2, LW, 10)) { p.text(M, y, ln, { size: 10, color: '#e6edf5' }); y += 14; }
      y += 6; const chH = 120; p.rrect(M, y, LW, chH + 34, 8, CARD, LINE); p.text(M + 12, y + 9, 'MESSAGES OVER TIME', { size: 7.5, font: 'F2', color: '#9fb0c3' });
      { const tot = data.series.map((bk) => bk.reduce((x, y2) => x + y2, 0)), mx = Math.max(1, ...tot), cx = M + 14, cwid = LW - 28, base = y + 24 + chH - 14, ch2 = chH - 28;
        for (let g = 0; g <= 3; g++) p.line(cx, base - g / 3 * ch2, cx + cwid, base - g / 3 * ch2, '#243142', 0.4);
        const pts = tot.map((v, i) => [cx + (tot.length > 1 ? i / (tot.length - 1) : 0.5) * cwid, base - v / mx * ch2]);
        if (pts.length > 1) { p.poly([[cx, base], ...pts, [cx + cwid, base]], '#1a3350'); for (let i = 1; i < pts.length; i++) p.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], '#5ab0ff', 1.4); }
        p.text(cx, base + 5, local(data.from).slice(5, 16), { size: 7, color: '#7d8da1' }); p.textRight(cx + cwid, base + 5, local(data.to).slice(5, 16), { size: 7, color: '#7d8da1' }); p.textRight(cx + cwid, y + 9, `peak ${N(mx)} per ${data.bucketMs >= 3600000 ? data.bucketMs / 3600000 + ' h' : data.bucketMs / 60000 + ' min'}`, { size: 7, color: '#7d8da1' }); }
      const leftEnd = y + chH + 34;
      y = top0; p.text(RX, y, 'ACTIVE ALARMS', { size: 7.5, font: 'F2', color: '#9fb0c3' }); y += 16;
      if (!act.length) p.text(RX, y, 'No active alarms.', { size: 10, color: '#4cd08a' });
      for (const a of act) {
        p.line(RX, y - 5, RX + RW, y - 5, '#243142', 0.4); p.rect(RX, y + 1, 7, 7, SEV_COLORS[a.severity]);
        p.text(RX + 14, y, `${a.host} - ${a.rule}${a.port ? ' · ' + a.port : ''}`, { size: 9, color: '#e6edf5', max: RW - 120 });
        p.textRight(RX + RW, y, dur(Date.now() - a.first) + (a.escalated ? ' · escalated' : a.ackBy ? ' · ack ' + fit(a.ackBy, 10) : ''), { size: 8, color: a.escalated ? '#ff6b6b' : '#9fb0c3' }); y += 20;
      }
      if (nAct > act.length) { p.text(RX, y, `and ${N(nAct - act.length)} more`, { size: 8, color: '#7d8da1' }); y += 14; }
      y = Math.max(leftEnd, y) + 20;
      const list = (x, title, rows, w) => { p.text(x, y, title, { size: 7.5, font: 'F2', color: '#9fb0c3' }); let yy = y + 16; if (!rows.length) p.text(x, yy, 'None in this period.', { size: 9, color: '#7d8da1' }); for (const r of rows.slice(0, 4)) { p.line(x, yy - 5, x + w, yy - 5, '#243142', 0.4); p.text(x, yy, r.key, { size: 9, color: '#e6edf5', max: w - 70 }); p.textRight(x + w, yy, N(r.n), { size: 9, color: '#9fb0c3' }); yy += 17; } };
      list(M, 'BUSIEST DEVICES', data.hosts, LW); list(RX, 'MOST FREQUENT TRAPS', t0.names, RW);
    }

    // ===== all alarms, then syslog messages, then SNMP traps =====
    // the tables use the columns of the application windows (same headings and order as the screen and the CSV)
    const gridOf = (title, cols, items, note) => {
      const ws = VC.pdfWidths(cols, W - 2 * M); let x = M; const pos = cols.map((c, k) => { const at = x; x += ws[k] + 4; return [at, c.label]; });
      grid(title, pos, items.map((r) => cols.map((c) => fit(String(c.get(r) ?? ''), c.w ? 60 : 400))), (i) => items[i].severity, note);
    };
    const pf = this.prefs(data.def);
    if (data.alarmsActive) gridOf('All alarms: active (open and acknowledged)', VC.alarmColumns(pf, false), data.alarmsActive, `${data.alarmsActive.length} alarm(s) at the time the report was made.`);
    if (data.alarmHistory) { const h = data.alarmHistory;
      gridOf('All alarms: history', VC.alarmColumns(pf, true), h.rows, `Raised in the period: ${N(h.raised)} · cleared: ${N(h.cleared)}${h.cleared ? ` · average time to clear ${Math.round(h.avgClearMs / 60000)} min, longest ${Math.round(h.maxClearMs / 60000)} min` : ''}.`); }
    if (c.messages !== false && data.rows.length) {
      const n = Math.min(MAX_ROWS_PDF, data.rows.length);
      gridOf('Syslog messages', VC.logColumns(pf, 'logs'), data.rows.slice(0, n), n < data.total ? `Showing the newest ${N(n)} of ${N(data.total)} matching messages. The CSV and Excel versions can hold more.` : '');
    }
    if (data.dashSum && data.dashSum.rows.length) grid(data.dashSum.name, [[M, 'Tile'], [M + 230, 'Item'], [W - M - 90, 'Value']], data.dashSum.rows.map((r) => r.map((v) => String(v))), null, 'Figures of the dashboard for the period of this report.');
    if (data.polling) {
      const hd = data.polling.head, ws = hd.map((h, k) => (k < 3 ? 2.2 : 1)), tot = ws.reduce((a, b) => a + b, 0), span = W - 2 * M; let x = M;
      const pos = hd.map((h, k) => { const at = x; x += (ws[k] / tot) * span; return [at, h]; });
      grid('Polled devices', pos, data.polling.rows.map((r) => r.map((v) => (v === null || v === undefined ? '-' : String(v)))), null, `${data.polling.rows.length} device(s) polled in the period.`);
    }
    if (data.traps && data.traps.rows.length) gridOf('SNMP trap list', VC.logColumns(pf, 'traps'), data.traps.rows, data.traps.truncated ? 'Showing the newest traps only. The CSV and Excel versions hold more.' : '');
    const total = p.pages.length; p.pages.forEach((_, i) => { p.cur = p.pages[i]; p.text(M, H - 22, `${br.name} report${br.footer ? ' · ' + br.footer : ''}`, { size: 7, color: '#888888', max: W - 2 * M - 80 }); p.textRight(W - M, H - 22, `Page ${i + 1} of ${total}`, { size: 7, color: '#888888' }); });
    return p.build();
  }

  async mail(def, data, files) {
    const size = files.reduce((n, f) => n + f.data.length, 0); if (size > MAX_MAIL_BYTES) throw new Error(`The files are ${(size / 1048576).toFixed(1)} MB; the limit for e-mail is 20 MB. Lower "Messages to include", or use a folder.`);
    const smtp = this.config.get().smtp || {}; const to = def.email.to || smtp.to; if (!smtp.host || !smtp.from) throw new Error('E-mail is not set up yet (Notifications → E-mail server).'); parseRecipients(to);
    const fill = (t) => String(t).replace(/\{(name|date|period|count)\}/g, (_, k) => ({ name: def.name, date: local(data.to).slice(0, 10), period: `${local(data.from).slice(0, 10)} to ${local(data.to).slice(0, 10)}`, count: String(data.sevN.reduce((a, x) => a + x, 0)) })[k]).replace(/[\r\n]+/g, ' ').trim();
    const cc = [def.email.cc, smtp.cc].filter(Boolean).join(', ');
    await sendMail(smtp, { to, cc, subject: def.email.subject ? fill(def.email.subject).slice(0, 200) : `[${BRAND.brand(this.config.get()).name}] ${def.name} — ${local(data.from).slice(0, 10)} to ${local(data.to).slice(0, 10)}`,
      ...(() => {
        const al = data.alarmSum, intro = def.email.body ? fill(def.email.body).replace(/\s*\|\s*/g, '\n') : '';
        const cfgBody = def.email.body ? String(def.email.body).replace(/\{(name|date|period|count)\}/g, (_, k) => ({ name: def.name, date: local(data.to).slice(0, 10), period: `${local(data.from).slice(0, 10)} to ${local(data.to).slice(0, 10)}`, count: String(data.sevN.reduce((x, y) => x + y, 0)) })[k]) : '';
        const o = { title: def.name, intro: cfgBody || intro, from: data.from, to: data.to, zone: this.config.get().ntp?.zone || '', alarms: al ? al.counts : null, raised: al ? al.sum.raised : 0, cleared: al ? al.sum.cleared : 0, avgClearMs: al ? al.sum.avgClearMs : 0, ...(() => { const cols = VC.alarmColumns(this.prefs(), false), r = this.alarms ? this.alarms.list({ state: 'active', limit: 8 }) : { alarms: [], total: 0 }; return { activeRows: r.alarms.map((a) => ({ severity: a.severity, cells: cols.map((c) => [c.label, String(c.get(a) ?? '')]) })), activeMore: Math.max(0, (r.total || 0) - r.alarms.length) }; })(),
          total: data.total, devices: data.devices, sevN: data.sevN, trapTotal: data.trapSum.total, trapDevices: data.trapSum.devices, trapSev: data.trapSum.sevN, hosts: data.hosts, apps: data.apps, attached: files.map((f) => f.name).join(', ') };
        const bd = BRAND.brand(this.config.get()); o.brand = { name: bd.name, footer: bd.footer, logoCid: bd.logo ? 'nep-logo@report' : '' };
        return { html: renderReportHtml(o), text: renderReportText(o), inline: bd.logo ? [{ cid: 'nep-logo@report', contentType: 'image/jpeg', data: bd.logo.buf }] : [] };
      })(),
      attachments: files.map((f) => ({ filename: f.name, contentType: f.type, data: f.data })) });
  }

  async store2(def, files) {
    const dir = await prepareFolder(checkFolder(def.folder.path), def.folder.user, def.folder.password);
    for (const f of files) fs.writeFileSync(path.join(dir, f.name), f.data);
    const keep = Math.max(0, +def.folder.keep || 0), prefix = slug(def.name) + '-';
    if (keep) {      // only files this report made (name-YYYYMMDD-HHMM.ext) are ever removed
      for (const ext of ['pdf', 'xlsx', 'csv']) {
        const mine = fs.readdirSync(dir).filter((n) => n.startsWith(prefix) && new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d{8}-\\d{4}\\.${ext}$`).test(n)).sort().reverse();
        for (const old of mine.slice(keep)) { try { fs.unlinkSync(path.join(dir, old)); } catch { /* ignore */ } }
      }
    }
    return `saved ${files.length} file(s) in ${dir}`;
  }
}

/** a full path only: C:\folder, \\server\share\folder, or /folder. No relative paths or ".." */
function checkFolder(p) {
  const s = String(p || '').trim();
  if (!s) throw new Error('Enter a folder.');
  if (!(/^[a-zA-Z]:[\\/]/.test(s) || /^\\\\[^\\]+\\[^\\]+/.test(s) || s.startsWith('/'))) throw new Error('Use a full path such as D:\\Reports or \\\\server\\share\\reports.');
  if (s.split(/[\\/]+/).includes('..') || /[\u0000-\u001f<>"|?*]/.test(s.replace(/^\\\\\?\\/, ''))) throw new Error('That folder path is not allowed.');
  return s;
}
async function testFolder(p, user, password) {
  const dir = await prepareFolder(checkFolder(p), user, password); const f = path.join(dir, `neteventpro-test-${Date.now()}.txt`);
  fs.writeFileSync(f, 'NetEventPro folder test. You can delete this file.\r\n'); fs.unlinkSync(f); return dir;
}

module.exports = { Reports, periodRange, latestSlot, checkFolder, testFolder, PERIODS };
