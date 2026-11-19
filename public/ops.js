'use strict';
/* 1.98.0 Operations dashboard: one page with a sheet for every part of NetEventPro (overview, syslog, traps, alarms, devices,
   polling, system). Everything is drawn from the theme's own colours (CSS variables), so it follows all themes and looks,
   including the user's own severity colours. Read-only: it only shows data and links to the pages where things are done. */
(function () {
  const L = (k, v) => (window.T ? window.T(k, v) : k);
  const SHEETS = [['overview', 'ops.sheet.overview'], ['syslog', 'ops.sheet.syslog'], ['traps', 'ops.sheet.traps'], ['alarms', 'ops.sheet.alarms'], ['devices', 'ops.sheet.devices'], ['polling', 'ops.sheet.polling', 'polling'], ['system', 'ops.sheet.system']];
  const RANGES = [['15m', 15 * 60e3, 'ops.range.15m'], ['1h', 3600e3, 'ops.range.1h'], ['24h', 86400e3, 'ops.range.24h'], ['7d', 7 * 86400e3, 'ops.range.7d']];
  // severity groups for the message charts, most serious first
  const GROUPS = [{ key: 'bad', sevs: [0, 1, 2, 3], col: '--s1', label: 'ops.g.bad' }, { key: 'warn', sevs: [8, 4], col: '--s4', label: 'ops.g.warn' }, { key: 'note', sevs: [5, 9], col: '--s5', label: 'ops.g.note' }, { key: 'info', sevs: [6, 7], col: '--s6', label: 'ops.g.info' }];
  const SRC = { syslog: {}, snmp: { source: 'snmp' }, all: { source: 'all' } };

  const sevCol = (s) => `var(--s${s})`;
  const ink = (s) => inkOf(css(`--s${s}`) || '#888');
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const short = (n) => { n = Math.round(+n || 0); return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : fmtN(n); };
  const dur = (ms) => { const m = Math.round(ms / 60000); return m < 1 ? L('ops.dur.lt1') : m < 90 ? `${m} min` : m < 2880 ? `${Math.round(m / 6) / 10} h` : `${Math.round(m / 144) / 10} d`; };
  const sevPill = (s) => `<span class="ops-pill" style="background:${sevCol(s)};color:${ink(s)}">${esc(SEV[s] || '')}</span>`;
  const empty = (t) => `<p class="ops-empty">${esc(t)}</p>`;
  const card = (title, body, opts = {}) => `<section class="panel ops-card${opts.cls ? ' ' + opts.cls : ''}"${opts.style ? ` style="${opts.style}"` : ''}><header class="ops-ch"><h3>${esc(title)}</h3>${opts.link ? `<a href="${opts.link[0]}" class="ops-more">${esc(opts.link[1])}</a>` : ''}</header>${body}</section>`;

  // ---------- small charts (SVG, theme colours) ----------
  function spark(vals) {
    if (!vals || vals.length < 2) return '';
    const mx = Math.max(1, ...vals), pts = vals.map((v, i) => `${(i / (vals.length - 1) * 100).toFixed(1)},${(26 - (v / mx) * 22).toFixed(1)}`).join(' ');
    return `<svg class="ops-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" style="fill:none;stroke:var(--accent);stroke-width:1.6" vector-effect="non-scaling-stroke"></polyline></svg>`;
  }
  function kpi(label, value, sub, opts = {}) {
    return `<div class="panel ops-kpi${opts.tone ? ' tone-' + opts.tone : ''}"${opts.href ? ` data-href="${opts.href}" tabindex="0" role="link"` : ''}><span class="ops-kl">${esc(label)}</span><span class="ops-kv">${esc(value)}</span><div class="ops-kf"><span class="ops-ks${opts.subTone ? ' ' + opts.subTone : ''}">${esc(sub || '')}</span>${opts.spark || ''}</div></div>`;
  }
  const deltaText = (n, prev) => { if (prev === undefined || prev === null) return ''; if (!prev) return n ? L('ops.delta.new') : L('ops.delta.same'); const d = Math.round(((n - prev) / prev) * 100); return d === 0 ? L('ops.delta.same') : L(d > 0 ? 'ops.delta.up' : 'ops.delta.down', { n: Math.abs(d) }); };
  /** stacked area chart of message counts per bucket, in severity groups */
  function area(series, meta, groups = GROUPS) {
    if (!series || !series.length) return empty(L('ops.nodata'));
    const W = 600, H = 200, nb = series.length, tot = series.map((b) => groups.reduce((a, g) => a + g.sevs.reduce((x, s) => x + (b[s] || 0), 0), 0));
    const mx = Math.max(1, ...tot), x = (i) => (nb === 1 ? W / 2 : (i / (nb - 1)) * W), y = (v) => H - (v / mx) * (H - 6);
    let base = new Array(nb).fill(0); const paths = [];
    for (const g of [...groups].reverse()) {
      const top = base.map((b, i) => b + g.sevs.reduce((a, s) => a + (series[i][s] || 0), 0));
      let d = `M${x(0)},${y(top[0])}`; for (let i = 1; i < nb; i++) d += ` L${x(i).toFixed(1)},${y(top[i]).toFixed(1)}`;
      for (let i = nb - 1; i >= 0; i--) d += ` L${x(i).toFixed(1)},${y(base[i]).toFixed(1)}`;
      paths.push(`<path d="${d} Z" style="fill:var(${g.col});opacity:.88"></path>`); base = top;
    }
    const t0 = meta.firstBucket * meta.bucketMs, t1 = (meta.firstBucket + nb - 1) * meta.bucketMs, long = t1 - t0 > 36 * 3600e3;
    const lab = (t) => (long ? shortDate(t) + ' ' + hhmm(t) : hhmm(t));
    const xl = [0, 0.25, 0.5, 0.75, 1].map((f) => `<span>${esc(lab(t0 + (t1 - t0) * f))}</span>`).join('');
    const legend = groups.map((g) => `<span><i style="background:var(${g.col})"></i>${esc(L(g.label))}</span>`).join('');
    return `<div class="ops-legend">${legend}</div><div class="ops-area"><div class="ops-yl"><span>${short(mx)}</span><span>${short(mx / 2)}</span><span>0</span></div><div class="ops-plot">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(L('ops.chart.aria', { n: fmtN(tot.reduce((a, b) => a + b, 0)) }))}"><line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" style="stroke:var(--line)"></line>${paths.join('')}</svg>
      <div class="ops-xl">${xl}</div></div></div>`;
  }
  /** horizontal bars for a "top" list */
  function bars(rows, opts = {}) {
    if (!rows || !rows.length) return empty(opts.none || L('ops.nodata'));
    const mx = Math.max(1, ...rows.map((r) => r.n));
    return `<ol class="ops-bars">${rows.map((r) => { const key = r.key === '' || r.key === null || r.key === undefined ? L('ops.blank') : opts.label ? opts.label(r.key) : String(r.key);
      const col = opts.color ? opts.color(r) : r.worst !== undefined && r.worst !== null ? sevCol(r.worst) : 'var(--accent)';
      return `<li${opts.href ? ` data-href="${opts.href(r)}" tabindex="0" role="link"` : ''}><div class="ops-bt"><span class="ops-bk" title="${esc(key)}">${esc(key)}</span><span class="ops-bn">${fmtN(r.n)}</span></div><div class="ops-bb"><i style="width:${Math.max(2, (r.n / mx) * 100).toFixed(1)}%;background:${col}"></i></div></li>`; }).join('')}</ol>`;
  }
  /** ring split by severity */
  function donut(rows) {
    const tot = rows.reduce((a, r) => a + r.n, 0); if (!tot) return empty(L('ops.nodata'));
    let a0 = -Math.PI / 2; const R = 42, C = 2 * Math.PI * R; let off = 0; const segs = [];
    for (const r of rows) { const f = r.n / tot; segs.push(`<circle cx="60" cy="60" r="${R}" style="fill:none;stroke:${sevCol(r.key)};stroke-width:16" stroke-dasharray="${(f * C).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 60 60)"></circle>`); off += f * C; }
    void a0;
    return `<div class="ops-donut"><svg viewBox="0 0 120 120" role="img" aria-label="${esc(rows.map((r) => `${SEV[r.key]} ${r.n}`).join(', '))}">${segs.join('')}<text x="60" y="58" text-anchor="middle" class="ops-dn">${short(tot)}</text><text x="60" y="74" text-anchor="middle" class="ops-dl">${esc(L('ops.total'))}</text></svg>
      <ul>${rows.map((r) => `<li><i style="background:${sevCol(r.key)}"></i>${esc(SEV[r.key] || r.key)}<b>${fmtN(r.n)}</b></li>`).join('')}</ul></div>`;
  }
  /** half-ring gauge, value 0..max */
  function gauge(label, value, max, unit, opts = {}) {
    const v = value === null || value === undefined || Number.isNaN(+value) ? null : +value, f = v === null ? 0 : Math.max(0, Math.min(1, v / max)), A = 157.1;
    const col = v === null ? 'var(--line2)' : opts.color || (f >= (opts.crit ?? 0.9) ? 'var(--s1)' : f >= (opts.warn ?? 0.75) ? 'var(--s4)' : 'var(--ok)');
    return `<div class="ops-gauge"><svg viewBox="0 0 120 70" role="img" aria-label="${esc(label)} ${v === null ? '' : v + ' ' + unit}"><path d="M10 64 A50 50 0 0 1 110 64" style="fill:none;stroke:var(--line);stroke-width:10;stroke-linecap:round"></path>
      <path d="M10 64 A50 50 0 0 1 110 64" style="fill:none;stroke:${col};stroke-width:10;stroke-linecap:round" stroke-dasharray="${(f * A).toFixed(1)} ${A}"></path></svg>
      <span class="ops-gv">${v === null ? '–' : esc(opts.text || (Math.round(v * 10) / 10 + (unit === '%' ? '%' : ' ' + unit)))}</span><span class="ops-gl">${esc(label)}</span>${opts.note ? `<span class="ops-gn">${esc(opts.note)}</span>` : ''}</div>`;
  }
  /** open alarms by severity as one band (the first thing on the overview) */
  function band(bySev) {
    const rows = SEVORD.filter((s) => bySev[s]).map((s) => [s, bySev[s]]); const total = rows.reduce((a, r) => a + r[1], 0);
    if (!total) return `<div class="ops-band ops-band-ok"><span>${esc(L('ops.band.none'))}</span></div>`;
    return `<div class="ops-band" role="img" aria-label="${esc(rows.map(([s, n]) => `${n} ${SEV[s]}`).join(', '))}">${rows.map(([s, n]) => `<a href="#alarms" class="ops-seg" style="flex:${n + total * 0.06} 1 0;background:${sevCol(s)};color:${ink(s)}" title="${esc(`${n} ${SEV[s]}`)}"><b>${fmtN(n)}</b><span>${esc(SEV[s])}</span></a>`).join('')}</div>`;
  }
  function headline(bySev) {
    const crit = [0, 1, 2].reduce((a, s) => a + (bySev[s] || 0), 0), all = Object.values(bySev).reduce((a, b) => a + b, 0);
    if (crit) return L(crit === 1 ? 'ops.head.crit1' : 'ops.head.crit', { n: fmtN(crit) });
    if (all) return L(all === 1 ? 'ops.head.open1' : 'ops.head.open', { n: fmtN(all) });
    return L('ops.head.quiet');
  }
  function alarmList(list, n = 8) {
    if (!list.length) return empty(L('ops.alarms.none'));
    const rows = [...list].sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || b.first - a.first).slice(0, n);
    return `<ul class="ops-alist">${rows.map((a) => `<li data-href="#alarms" tabindex="0" role="link"><i class="ops-abar" style="background:${sevCol(a.severity)}"></i><div class="ops-am"><span class="ops-at">${esc(a.rule)}${a.port ? ' · ' + esc(a.port) : ''}</span><span class="ops-ad">${esc(a.host || a.device || '')}${a.state === 'ack' ? ' · ' + esc(L('ops.ack')) : ''}</span></div><div class="ops-ar">${sevPill(a.severity)}<span class="ops-ag">${esc(dur(Date.now() - a.first))}</span></div></li>`).join('')}</ul>`;
  }
  function msgList(rows) {
    if (!rows || !rows.length) return empty(L('ops.nodata'));
    return `<div class="ops-tw"><table class="ops-msgs"><tbody>${rows.map((m) => `<tr data-href="${m.source === 'snmp' ? '#traps' : '#logs'}"><td class="ops-mt">${esc(timeOf(m.ts, false))}</td><td>${sevPill(m.severity)}</td><td class="ops-mh">${esc(m.host || '')}</td><td class="ops-mx">${esc(m.message || '')}</td></tr>`).join('')}</tbody></table></div>`;
  }
  /** one square per device, coloured by its worst open alarm; silent devices are drawn hollow */
  function devGrid(devs, worst) {
    if (!devs.length) return empty(L('ops.dev.none'));
    const groups = new Map(); for (const d of devs) { const g = d.group || d.vendor || L('ops.dev.other'); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(d); }
    const MAXC = 2500; let shown = 0;
    const out = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([g, l]) => {
      const cells = l.slice(0, Math.max(0, MAXC - shown)).map((d) => { const w = worst.get(d.key) ?? worst.get(d.host) ?? worst.get(d.srcIp); const name = d.alias || d.host || d.key;
        const tip = `${name}${w !== undefined ? ' · ' + SEV[w] : ''}${d.silent ? ' · ' + L('ops.dev.silent') : ''}`;
        return `<i class="ops-cell${d.silent ? ' silent' : ''}" title="${esc(tip)}" style="${d.silent ? '' : `background:${w !== undefined ? sevCol(w) : 'var(--ok)'}`}"></i>`; });
      shown += cells.length;
      return `<div class="ops-grow"><span class="ops-gname" title="${esc(g)}">${esc(g)}</span><div class="ops-cells">${cells.join('')}</div><span class="ops-gcount">${fmtN(l.length)}</span></div>`;
    });
    const more = devs.length > MAXC ? `<p class="ops-empty">${esc(L('ops.dev.more', { n: fmtN(MAXC), t: fmtN(devs.length) }))}</p>` : '';
    return `<div class="ops-grid">${out.join('')}</div>${more}<div class="ops-legend ops-leg2"><span><i style="background:var(--ok)"></i>${esc(L('ops.dev.ok'))}</span><span><i style="background:var(--s4)"></i>${esc(SEV[4])}</span><span><i style="background:var(--s3)"></i>${esc(SEV[3])}</span><span><i style="background:var(--s2)"></i>${esc(L('ops.dev.crit'))}</span><span><i class="hollow"></i>${esc(L('ops.dev.silent'))}</span></div>`;
  }

  // ---------- data ----------
  const dash = (r, tiles) => api('/api/dash', { method: 'POST', body: { from: r.from, to: r.to, tiles } });
  const totals = (series) => (series || []).map((b) => b.reduce((a, x) => a + x, 0));
  const worstMap = (alarms) => { const m = new Map(); for (const a of alarms) for (const k of [a.device, a.host, a.srcIp]) if (k && (!m.has(k) || sevRank(a.severity) < sevRank(m.get(k)))) m.set(k, a.severity); return m; };
  const sevCounts = (rows) => { const o = {}; for (const r of rows || []) o[r.key] = r.n; return o; };

  const SHEET = {
    async overview(r, can) {
      const [d, devs, al, poll] = await Promise.all([
        dash(r, [{ id: 'msg', kind: 'count', prev: true }, { id: 'trp', kind: 'count', prev: true, filter: SRC.snmp }, { id: 'ser', kind: 'series', filter: SRC.all }, { id: 'top', kind: 'top', by: 'host', n: 8, filter: SRC.all },
          { id: 'asev', kind: 'top', by: 'severity', ds: 'alarms', n: 10, filter: { astate: 'active' } }]),
        api('/api/devices').catch(() => []), api('/api/alarms?state=active&limit=500').catch(() => ({ alarms: [], counts: {} })), can.polling ? api('/api/poll/overview').catch(() => null) : null]);
      const t = d.tiles, silent = devs.filter((x) => x.silent).length, sp = totals(t.ser?.series);
      const c = al.counts || {};
      // the band and the headline come from the same alarm list as the numbers beside them when it holds every active alarm
      let bySev = sevCounts(t.asev?.rows); if ((al.alarms || []).length >= (al.total || 0)) { bySev = {}; for (const a of al.alarms || []) bySev[a.severity] = (bySev[a.severity] || 0) + 1; }
      return `<div class="ops-hero"><h2>${esc(headline(bySev))}</h2><span class="ops-sub">${esc(L('ops.hero.sub', { open: fmtN(c.open || 0), ack: fmtN(c.ack || 0), esc: fmtN(c.escalated || 0) }))}</span></div>${band(bySev)}
      <div class="ops-kpis">${kpi(L('ops.k.msgs'), fmtN(t.msg?.n), deltaText(t.msg?.n, t.msg?.prev), { spark: spark(sp), href: '#logs' })}${kpi(L('ops.k.traps'), fmtN(t.trp?.n), deltaText(t.trp?.n, t.trp?.prev), { href: '#traps' })}
      ${kpi(L('ops.k.devs'), `${fmtN(devs.length - silent)} / ${fmtN(devs.length)}`, silent ? L('ops.k.silent', { n: fmtN(silent) }) : L('ops.k.allsend'), { subTone: silent ? 'bad' : 'good', href: '#devices' })}
      ${poll && poll.counts?.total ? kpi(L('ops.k.poll'), `${fmtN(poll.counts.up)} / ${fmtN(poll.counts.total)}`, poll.counts.down ? L('ops.k.down', { n: poll.counts.down }) : L('ops.k.allup'), { subTone: poll.counts.down ? 'bad' : 'good', href: '#polling' })
        : kpi(L('ops.k.alarms'), fmtN((c.open || 0) + (c.ack || 0)), L('ops.k.cleared', { n: fmtN(c.clearedToday || 0) }), { href: '#alarms' })}</div>
      <div class="ops-row">${card(L('ops.c.rate'), area(t.ser?.series, d), { cls: 'w2' })}${card(L('ops.c.active'), alarmList(al.alarms || []), { link: ['#alarms', L('ops.all')] })}</div>
      <div class="ops-row">${card(L('ops.c.health'), devGrid(devs, worstMap(al.alarms || [])), { cls: 'w2', link: ['#devices', L('ops.open.devices')] })}${card(L('ops.c.busy'), bars(t.top?.rows, { href: (x) => '#devices' }))}</div>`;
    },
    async syslog(r) { return msgSheet(r, SRC.syslog, 'syslog'); },
    async traps(r) { return msgSheet(r, SRC.snmp, 'traps'); },
    async alarms(r) {
      const A = (id, kind, f, x = {}) => ({ id, kind, ds: 'alarms', filter: f, ...x });
      const [d, al] = await Promise.all([dash(r, [A('raised', 'count', { astate: 'raised' }, { prev: true }), A('cleared', 'count', { astate: 'cleared' }), A('avg', 'count', { astate: 'cleared' }, { agg: 'avgclear' }),
        A('ser', 'series', { astate: 'raised' }), A('rules', 'top', { astate: 'raised' }, { by: 'rule', n: 8 }), A('devs', 'top', { astate: 'raised' }, { by: 'host', n: 8 }), A('sev', 'top', { astate: 'active' }, { by: 'severity', n: 10 })]),
        api('/api/alarms?state=active&limit=500').catch(() => ({ alarms: [], counts: {} }))]);
      const t = d.tiles, c = al.counts || {};
      return `<div class="ops-kpis">${kpi(L('ops.k.open'), fmtN(c.open || 0), L('ops.k.notack'), { tone: c.open ? 'bad' : '', href: '#alarms' })}${kpi(L('ops.k.ack'), fmtN(c.ack || 0), L('ops.k.ackd'))}${kpi(L('ops.k.esc'), fmtN(c.escalated || 0), L('ops.k.escd'), { subTone: c.escalated ? 'bad' : '' })}
        ${kpi(L('ops.k.raised'), fmtN(t.raised?.n), deltaText(t.raised?.n, t.raised?.prev), { spark: spark(totals(t.ser?.series)) })}${kpi(L('ops.k.clearedr'), fmtN(t.cleared?.n), t.avg?.n ? L('ops.k.avg', { t: dur((t.avg.n || 0) * 60000) }) : '')}</div>
        <div class="ops-row">${card(L('ops.c.raised'), area(t.ser?.series, d, SEVORD.map((s) => ({ key: 's' + s, sevs: [s], col: `--s${s}`, label: SEV[s] })).filter((g) => (t.ser?.series || []).some((b) => b[g.sevs[0]]))), { cls: 'w2' })}${card(L('ops.c.bysev'), donut(SEVORD.filter((s) => sevCounts(t.sev?.rows)[s]).map((s) => ({ key: s, n: sevCounts(t.sev?.rows)[s] }))))}</div>
        <div class="ops-row">${card(L('ops.c.rules'), bars(t.rules?.rows))}${card(L('ops.c.adevs'), bars(t.devs?.rows))}${card(L('ops.c.active'), alarmList(al.alarms || [], 10), { link: ['#alarms', L('ops.all')] })}</div>`;
    },
    async devices(r) {
      const [devs, al] = await Promise.all([api('/api/devices').catch(() => []), api('/api/alarms?state=active&limit=500').catch(() => ({ alarms: [] }))]);
      const now = Date.now(), live = devs.filter((d) => now - d.lastSeen < 5 * 60000).length, silent = devs.filter((d) => d.silent), muted = devs.filter((d) => d.muted).length, withA = devs.filter((d) => d.openAlarms > 0).length;
      const vend = new Map(); for (const d of devs) { const v = d.vendor || L('ops.dev.unknown'); vend.set(v, (vend.get(v) || 0) + 1); }
      const newest = [...devs].sort((a, b) => b.firstSeen - a.firstSeen).slice(0, 8);
      const busiest = [...devs].sort((a, b) => b.count - a.count).slice(0, 8).map((d) => ({ key: d.alias || d.host, n: d.count, worst: d.lastSeverity }));
      return `<div class="ops-kpis">${kpi(L('ops.k.total'), fmtN(devs.length), L('ops.k.known'))}${kpi(L('ops.k.live'), fmtN(live), L('ops.k.live5'), { subTone: 'good' })}${kpi(L('ops.k.silentn'), fmtN(silent.length), L('ops.k.silentd'), { tone: silent.length ? 'bad' : '' })}${kpi(L('ops.k.witha'), fmtN(withA), L('ops.k.muted', { n: fmtN(muted) }))}</div>
        ${card(L('ops.c.health'), devGrid(devs, worstMap(al.alarms || [])), { link: ['#devices', L('ops.open.devices')] })}
        <div class="ops-row">${card(L('ops.c.vendors'), bars([...vend.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n).slice(0, 10), { color: () => 'var(--accent)' }))}${card(L('ops.c.busy'), bars(busiest))}
        ${card(L('ops.c.silent'), silent.length ? `<ul class="ops-simple">${silent.slice(0, 12).map((d) => `<li><span>${esc(d.alias || d.host)}</span><span class="ops-ag">${esc(ago(d.ageSec))}</span></li>`).join('')}</ul>` : empty(L('ops.k.allsend')))}
        ${card(L('ops.c.newest'), `<ul class="ops-simple">${newest.map((d) => `<li><span>${esc(d.alias || d.host)}</span><span class="ops-ag">${esc(dateOf(d.firstSeen))}</span></li>`).join('')}</ul>`)}</div>`;
    },
    async polling() {
      const o = await api('/api/poll/overview'); const c = o.counts || {}, devs = o.devices || [];
      const cards = devs.slice(0, 24).map((d) => `<div class="panel ops-pdev"><div class="ops-ph"><i class="ops-dot st-${esc(d.state)}"></i><b title="${esc(d.host)}">${esc(d.name)}</b><span class="ops-ag">${esc(d.group || d.site || '')}</span></div><div class="ops-gauges">
        ${d.cpu !== null ? gauge(L('ops.p.cpu'), d.cpu, 100, '%') : ''}${d.memory !== null ? gauge(L('ops.p.mem'), d.memory, 100, '%') : ''}${d.temperature !== null ? gauge(L('ops.p.temp'), d.temperature, 80, '°C', { warn: 0.6, crit: 0.75 }) : ''}${d.battery !== null ? gauge(L('ops.p.batt'), d.battery, 100, '%', { color: d.battery < 30 ? 'var(--s1)' : d.battery < 60 ? 'var(--s4)' : 'var(--ok)' }) : ''}
        ${d.cpu === null && d.memory === null && d.temperature === null && d.battery === null ? `<p class="ops-empty">${esc(d.error || L('ops.p.nodata'))}</p>` : ''}</div><div class="ops-pf"><span>${d.ifMon ? esc(L('ops.p.ifs', { up: d.ifUp, n: d.ifMon })) : ''}</span><span>${d.rtt !== null ? d.rtt + ' ms' : ''}</span></div></div>`).join('');
      return `<div class="ops-kpis">${kpi(L('ops.k.ptotal'), fmtN(c.total || 0), L('ops.k.polled'))}${kpi(L('ops.k.up'), fmtN(c.up || 0), '', { subTone: 'good' })}${kpi(L('ops.k.pdown'), fmtN(c.down || 0), '', { tone: c.down ? 'bad' : '' })}${kpi(L('ops.k.unknown'), fmtN(c.unknown || 0), L('ops.k.unknownd'))}</div>
        ${devs.length ? `<div class="ops-pgrid">${cards}</div>` : card(L('ops.sheet.polling'), empty(L('ops.p.none')))}${devs.length > 24 ? `<p class="ops-empty">${esc(L('ops.p.more', { n: devs.length }))} <a href="#polling">${esc(L('ops.open.polling'))}</a></p>` : ''}
        ${card(L('ops.c.recent'), (o.recent || []).length ? `<ul class="ops-simple">${o.recent.slice(0, 12).map((x) => `<li><span><i class="ops-dot st-${x.kind === 'fail' ? 'down' : 'up'}"></i>${esc(x.name)}: ${esc(x.text)}</span><span class="ops-ag">${esc(timeOf(x.ts, false))}</span></li>`).join('')}</ul>` : empty(L('ops.nodata')))}`;
    },
    async system() {
      const h = await api('/api/health'); const s = h.system || {}, dk = h.disk || {}, db = h.db || {}, ig = h.ingest || {}, out = h.outputs || {};
      const chk = (h.checks || []).map((c) => `<li class="ops-chk st-${esc(c.status)}"><i></i><div><b>${esc(c.label)}</b><span>${esc(c.detail || '')}</span></div></li>`).join('');
      return `<div class="ops-hero"><h2>${esc(L(h.status === 'ok' ? 'ops.sys.ok' : h.status === 'warn' ? 'ops.sys.warn' : 'ops.sys.bad'))}</h2><span class="ops-sub">${esc(L('ops.sys.sub', { up: uptime(s.uptimeSec || 0), node: s.node || '' }))}</span></div>
        <div class="ops-row">${card(L('ops.c.server'), `<div class="ops-gauges big">${gauge(L('ops.p.cpu'), s.cpuPct, 100, '%')}${gauge(L('ops.sys.disk'), dk.freePct === undefined ? null : 100 - dk.freePct, 100, '%', { text: dk.freeGB !== undefined ? L('ops.sys.free', { n: Math.round(dk.freeGB) }) : '' })}${gauge(L('ops.sys.mem'), s.rssMB, 2048, 'MB', { text: `${s.rssMB} MB` })}${gauge(L('ops.sys.lag'), s.loopLagMs, 200, 'ms', { warn: 0.25, crit: 0.5 })}</div>`, { cls: 'w2' })}
          ${card(L('ops.c.ingest'), `<dl class="ops-dl2"><dt>${esc(L('ops.sys.eps'))}</dt><dd>${fmtN(ig.eps)}</dd><dt>${esc(L('ops.sys.peak'))}</dt><dd>${fmtN(ig.peak)}</dd><dt>${esc(L('ops.sys.recv'))}</dt><dd>${fmtN(ig.received)}</dd><dt>${esc(L('ops.sys.devs'))}</dt><dd>${fmtN(ig.devices)}</dd><dt>${esc(L('ops.sys.queue'))}</dt><dd>${fmtN(db.queue)}</dd><dt>${esc(L('ops.sys.mail'))}</dt><dd>${fmtN(out.email?.sent)} / ${fmtN(out.email?.failed)}</dd></dl>`)}</div>
        <div class="ops-row">${card(L('ops.c.db'), `<dl class="ops-dl2"><dt>${esc(L('ops.sys.rows'))}</dt><dd>${fmtN(db.rows)}</dd><dt>${esc(L('ops.sys.size'))}</dt><dd>${fmtN(db.fileMB)} MB</dd><dt>${esc(L('ops.sys.perday'))}</dt><dd>${db.mbPerDay ? fmtN(db.mbPerDay) + ' MB' : '–'}</dd><dt>${esc(L('ops.sys.keep'))}</dt><dd>${db.retentionDays ? L('ops.sys.days', { n: db.retentionDays }) : L('ops.sys.forever')}</dd><dt>${esc(L('ops.sys.oldest'))}</dt><dd>${db.oldest ? esc(dateOf(db.oldest)) : '–'}</dd></dl>`)}${card(L('ops.c.checks'), `<ul class="ops-checks">${chk}</ul>`, { cls: 'w2', link: ['#health', L('ops.open.health')] })}</div>`;
    }
  };
  async function msgSheet(r, f, kind) {
    const isT = kind === 'traps';
    const d = await dash(r, [{ id: 'n', kind: 'count', prev: true, filter: f }, { id: 'bad', kind: 'count', filter: { ...f, severityMax: 3 } }, { id: 'dist', kind: 'distinct', filter: f }, { id: 'ser', kind: 'series', filter: f },
      { id: 'hosts', kind: 'top', by: 'host', n: 10, filter: f }, { id: 'second', kind: 'top', by: isT ? 'msgid' : 'app', n: 10, filter: f }, { id: 'sev', kind: 'top', by: 'severity', n: 10, filter: f },
      { id: 'dow', kind: 'heatDow', tz: -new Date().getTimezoneOffset(), filter: f }, { id: 'last', kind: 'list', n: 12, filter: isT ? f : { ...f, severityMax: 3 } }]);
    const t = d.tiles, sp = totals(t.ser?.series), sevRows = SEVORD.filter((s) => sevCounts(t.sev?.rows)[s]).map((s) => ({ key: s, n: sevCounts(t.sev?.rows)[s] }));
    const heat = (() => { const c = t.dow?.cells; if (!c) return empty(L('ops.nodata')); const mx = Math.max(1, ...c.flat()); const days = L('ops.days').split(',');
      return `<div class="ops-heat" role="img" aria-label="${esc(L('ops.c.when'))}">${c.map((row, di) => `<span class="ops-hd">${esc(days[di] || '')}</span>${row.map((v, h) => `<i title="${esc(`${days[di]} ${pad(h)}:00 · ${fmtN(v)}`)}" style="background:color-mix(in srgb, var(--accent) ${v ? Math.max(8, Math.round((v / mx) * 100)) : 0}%, var(--panel2))"></i>`).join('')}`).join('')}<span></span>${[0, 6, 12, 18].map((h) => `<span class="ops-hh" style="grid-column:${h + 2} / span 6">${pad(h)}:00</span>`).join('')}</div>`; })();
    return `<div class="ops-kpis">${kpi(L(isT ? 'ops.k.traps' : 'ops.k.msgs'), fmtN(t.n?.n), deltaText(t.n?.n, t.n?.prev), { spark: spark(sp), href: isT ? '#traps' : '#logs' })}${kpi(L('ops.k.bad'), fmtN(t.bad?.n), L('ops.k.badpct', { n: pct(t.bad?.n, t.n?.n) }), { subTone: t.bad?.n ? 'bad' : 'good' })}
      ${kpi(L(isT ? 'ops.k.senders' : 'ops.k.sending'), fmtN(t.dist?.n), '')}${kpi(L('ops.k.rate'), fmtN(Math.round((t.n?.n || 0) / Math.max(1, (r.to - r.from) / 60000))), L('ops.k.permin'))}</div>
      <div class="ops-row">${card(L(isT ? 'ops.c.trate' : 'ops.c.rate'), area(t.ser?.series, d), { cls: 'w2' })}${card(L('ops.c.bysev'), donut(sevRows))}</div>
      <div class="ops-row">${card(L(isT ? 'ops.c.senders' : 'ops.c.busy'), bars(t.hosts?.rows))}${card(L(isT ? 'ops.c.tnames' : 'ops.c.apps'), bars(t.second?.rows))}${card(L('ops.c.when'), heat)}</div>
      ${card(L(isT ? 'ops.c.ltraps' : 'ops.c.lerr'), msgList(t.last?.rows), { link: [isT ? '#traps' : '#logs', L(isT ? 'ops.open.traps' : 'ops.open.logs')] })}`;
  }

  views.ops = (el) => {
    const me = (S.info && S.info.me) || { perms: [] }, feats = S.info && S.info.features;
    const can = { polling: me.perms.includes('polling') && (!feats || feats.includes('polling')) };
    const sheets = SHEETS.filter((s) => !s[2] || can[s[2]]);
    let sheet = S.hq?.get('sheet') || store.get('nep.ops.sheet', 'overview'); if (!sheets.some((s) => s[0] === sheet)) sheet = 'overview';
    let range = store.get('nep.ops.range', '1h'); if (!RANGES.some((x) => x[0] === range)) range = '1h';
    let timer = null, busy = false, gen = 0;
    el.innerHTML = `<div class="ops">
      <div class="ops-top"><div class="ops-tabs" role="tablist" aria-label="${esc(L('ops.sheets'))}">${sheets.map(([k, l]) => `<button type="button" role="tab" data-sheet="${k}" aria-selected="${k === sheet}">${esc(L(l))}</button>`).join('')}</div>
        <div class="ops-tools"><div class="ops-range" role="group" aria-label="${esc(L('ops.range'))}">${RANGES.map(([k, , l]) => `<button type="button" data-range="${k}" aria-pressed="${k === range}">${esc(L(l))}</button>`).join('')}</div><span class="ops-upd" aria-live="polite"></span></div></div>
      <div class="ops-body" role="tabpanel"></div></div>`;
    const body = $('.ops-body', el), upd = $('.ops-upd', el);
    const load = async (first) => {
      if (busy) return; busy = true; const my = ++gen; const R = RANGES.find((x) => x[0] === range); const to = Date.now(), r = { from: to - R[1], to };
      if (first) body.innerHTML = `<p class="ops-empty">${esc(L('ops.loading'))}</p>`;
      try {
        const html = await SHEET[sheet](r, can);
        if (my !== gen || !el.isConnected) return;
        const y = el.closest('main')?.scrollTop; body.innerHTML = html; if (y !== undefined) el.closest('main').scrollTop = y;
        upd.textContent = L('ops.updated', { t: timeOf(Date.now(), false) });
      } catch (e) { if (my === gen) body.innerHTML = `<p class="ops-empty">${esc(L('ops.error', { m: e.message }))}</p>`; }
      finally { busy = false; }
    };
    const schedule = () => { clearInterval(timer); const every = range === '15m' || range === '1h' ? 15000 : 60000; timer = setInterval(() => { if (!document.hidden) load(false); }, every); };
    el.addEventListener('click', (e) => {
      const tb = e.target.closest('[data-sheet]'); if (tb) { sheet = tb.dataset.sheet; store.set('nep.ops.sheet', sheet); $$('[data-sheet]', el).forEach((b) => b.setAttribute('aria-selected', String(b === tb))); try { history.replaceState(null, '', '#ops?sheet=' + sheet); } catch { /* */ } gen++; busy = false; load(true); return; }
      const rb = e.target.closest('[data-range]'); if (rb) { range = rb.dataset.range; store.set('nep.ops.range', range); $$('[data-range]', el).forEach((b) => b.setAttribute('aria-pressed', String(b === rb))); gen++; busy = false; load(true); schedule(); return; }
      const h = e.target.closest('[data-href]'); if (h && !e.target.closest('a')) location.hash = h.dataset.href;
    });
    el.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-href]')) { e.preventDefault(); location.hash = e.target.dataset.href; }
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.target.matches('[role=tab]')) { const tabs = $$('[role=tab]', el), i = tabs.indexOf(e.target), n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; n.focus(); n.click(); }
    });
    const vis = () => { if (!document.hidden) load(false); }; document.addEventListener('visibilitychange', vis);
    load(true); schedule();
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', vis); gen++; };
  };
})();
