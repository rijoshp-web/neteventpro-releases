'use strict';
/* Health page: is NetEventPro itself running well? (disk space, database, listeners, delays, memory, mail) */
/* Chart helper: small canvas line/area chart with a hover read-out. series = [{name,color,key,fmt}] over samples [{t,...}] */
function sysChart(cv, samples, series, o = {}) {
  const css = getComputedStyle(document.documentElement), txt = css.getPropertyValue('--muted').trim() || '#8b97a8', grid = css.getPropertyValue('--line').trim() || '#2a3444';
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); g.font = '11px system-ui, sans-serif';
  const L = 44, R = 8, T = 8, B = 20, w = W - L - R, h = H - T - B;
  const pts = samples.filter((x) => series.some((sr) => x[sr.key] !== null && x[sr.key] !== undefined));
  let max = o.max || Math.max(1e-9, ...pts.flatMap((x) => series.map((sr) => x[sr.key] || 0)));
  if (!o.max) { const p = Math.pow(10, Math.floor(Math.log10(max))); max = Math.ceil(max / p * 2) / 2 * p; if (max < 1e-9) max = 1; }
  const fmt = o.fmt || ((v) => v), t0 = pts.length ? pts[0].t : 0, t1 = pts.length > 1 ? pts[pts.length - 1].t : t0 + 1;
  const X = (t) => L + (t - t0) / Math.max(1, t1 - t0) * w, Y = (v) => T + h - Math.min(1, v / max) * h;
  g.strokeStyle = grid; g.fillStyle = txt; g.lineWidth = 1; g.textAlign = 'right';
  for (let i = 0; i <= 4; i++) { const y = T + h - h * i / 4; g.beginPath(); g.moveTo(L, y + .5); g.lineTo(W - R, y + .5); g.stroke(); g.fillText(fmt(max * i / 4), L - 6, y + 4); }
  g.textAlign = 'center'; for (let i = 0; i <= 4; i++) { const t = t0 + (t1 - t0) * i / 4; g.fillText(new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), L + w * i / 4, H - 5); }
  if (pts.length < 2) { g.textAlign = 'center'; g.fillText('Collecting data… (a point every ' + (o.step || 5) + ' s)', L + w / 2, T + h / 2); cv._pts = null; return; }
  for (const [si, sr] of series.entries()) {
    g.beginPath(); let started = false;
    for (const x of pts) { const v = x[sr.key]; if (v === null || v === undefined) continue; const px = X(x.t), py = Y(v); if (!started) { g.moveTo(px, py); started = true; } else g.lineTo(px, py); }
    g.strokeStyle = sr.color; g.lineWidth = 1.8; g.lineJoin = 'round'; g.stroke();
    if (si === 0 || o.fillAll) { g.lineTo(X(pts[pts.length - 1].t), T + h); g.lineTo(X(pts[0].t), T + h); g.closePath(); const gr = g.createLinearGradient(0, T, 0, T + h); gr.addColorStop(0, sr.color + '55'); gr.addColorStop(1, sr.color + '05'); g.fillStyle = gr; g.fill(); g.fillStyle = txt; }
  }
  cv._pts = { pts, X, Y, L, R, T, h, w, series, fmt };
  cv.onmousemove = (e) => { const c = cv._pts; if (!c) return; const r = cv.getBoundingClientRect(), mx = e.clientX - r.left; let best = null, bd = 1e9; for (const x of c.pts) { const d = Math.abs(c.X(x.t) - mx); if (d < bd) { bd = d; best = x; } }
    cv.title = best ? `${new Date(best.t).toLocaleTimeString()}\n` + c.series.map((sr) => `${sr.name}: ${best[sr.key] === null || best[sr.key] === undefined ? '–' : c.fmt(best[sr.key])}`).join('\n') : ''; };
}

views.health = (el, _main, embedded) => {
  const RANGE_KEY = 'sp.healthRange';
  let range = '1h'; try { range = sessionStorage.getItem(RANGE_KEY) || '1h'; } catch { /* storage blocked */ }
  el.innerHTML = `<div class="page-head"><h1>System health</h1><span id="hPill"></span><span class="muted" id="hInfo"></span><span class="spacer"></span>
    <select id="hRange" aria-label="Time range of the graphs"><option value="15m">Last 15 minutes</option><option value="1h">Last hour</option><option value="24h">Last 24 hours</option></select><button id="hRefresh">Refresh</button></div>
    <div class="hcards" id="hCards"></div>
    <div class="hcharts" id="hCharts"></div>
    <div id="hBody"><div class="muted">Loading…</div></div>`;
  $('#hRange', el).value = range;
  let hist = null, sizes = '';
  let timer, alive = true;
  const bps = (v) => { if (v === null || v === undefined) return '–'; const b = v * 8; return b >= 1e9 ? (b / 1e9).toFixed(2) + ' Gbit/s' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' Mbit/s' : b >= 1e4 ? (b / 1e3).toFixed(0) + ' kbit/s' : b >= 1e3 ? (b / 1e3).toFixed(1) + ' kbit/s' : Math.round(b) + ' bit/s'; };
  const pct = (v) => (v === null || v === undefined ? '–' : (Math.round(v * 10) / 10) + '%');
  const sevOf = (v, w, c) => (v >= c ? 'bad' : v >= w ? 'warn' : 'ok');
  const pill = (s) => `<span class="pill ${s}">${s === 'ok' ? 'OK' : s === 'warn' ? 'Warning' : 'Problem'}</span>`;
  const gb = (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' GB';
  const kv = (rows) => `<table class="data"><tbody>${rows.filter(Boolean).map(([k, v]) => `<tr><td class="muted">${k}</td><td class="num-r" style="color:var(--text)">${v}</td></tr>`).join('')}</tbody></table>`;
  function draw(h) {
    const s = h.system, d = h.disk, b = h.db, g = h.ingest, o = h.outputs;
    const overall = h.status === 'ok' ? ['ok', 'Everything is working normally.'] : h.status === 'warn' ? ['warn', 'Something needs attention. See the list below.'] : ['bad', 'There is a problem. See the list below.'];
    $('#hBody', el).innerHTML = `
      <div class="hstate ${overall[0]}" style="font-size:15px"><b>${overall[1]}</b></div>
      <div class="panel" style="padding:0;overflow:auto;margin-bottom:14px"><table class="data"><thead><tr><th style="width:110px">Status</th><th style="width:250px">Check</th><th>Details</th></tr></thead><tbody>
        ${h.checks.map((c) => `<tr><td>${pill(c.status)}</td><td>${esc(c.label)}</td><td class="muted" style="white-space:normal">${esc(c.detail)}</td></tr>`).join('')}</tbody></table></div>
      <div class="hgrid">
        <div class="panel"><h2>Disk</h2>${d ? `<div class="bar" style="height:12px;margin-bottom:8px"><i style="width:${100 - d.freePct}%;background:${d.freePct < 5 ? 'var(--s1)' : d.freePct < 15 ? 'var(--s3)' : 'var(--accent)'}"></i></div>` : ''}
          ${d ? kv([['Free', `${gb(d.freeGB)} of ${gb(d.totalGB)} (${d.freePct.toFixed(0)}%)`], ['Data folder', `<code>${esc(d.path)}</code>`]]) : '<div class="muted">Not available</div>'}</div>
        <div class="panel"><h2>Database</h2>${kv([['Stored messages', fmtN(b.rows)], ['Data / file size', `${b.usedMB} MB / ${b.fileMB} MB`], ['Limit', b.maxMB ? `${fmtN(b.maxMB)} MB` : 'none'], ['Retention', b.retentionDays ? `${b.retentionDays} days` : 'unlimited'],
          ['Oldest message', b.oldest ? `${dateOf(b.oldest)} ${timeOf(b.oldest, false)}` : '–'], b.rowsPerDay ? ['Growth', `about ${fmtN(b.rowsPerDay)} messages/day, ${b.mbPerDay} MB/day`] : null, b.plateauMB ? ['Expected size when full', `about ${fmtN(b.plateauMB)} MB`] : null, ['Waiting to be written', fmtN(b.queue)]])}</div>
        <div class="panel"><h2>Receiving</h2>${kv([['Rate now / peak', `${g.eps} / ${g.peak} per second`], ['Received since start', fmtN(g.received)], ['Dropped by rules', fmtN(g.droppedByRules)], ['Devices (silent)', `${g.devices} (${g.silent})`],
          ['UDP', g.udp.running ? `port ${g.udp.port}, ${fmtN(g.udp.packets)} packets, ${fmtN(g.udp.rejected)} refused` : 'off'], ['TCP', g.tcp.running ? `port ${g.tcp.port}, ${g.tcp.connections} connections, ${fmtN(g.tcp.rejected)} refused` : 'off']])}</div>
        <div class="panel"><h2>Service</h2>${kv([['Running for', uptime(s.uptimeSec)], ['Memory', `${s.rssMB} MB`], ['Processor', `${s.cpuPct}% of ${s.cores} cores`], ['Longest pause (last minute)', `${s.loopLagMaxMs} ms`], ['Version', `${esc(S.info.version)} · Node ${esc(s.node)} · pid ${s.pid}`]])}</div>
        <div class="panel"><h2>Outputs</h2>${kv([['Email', o.email.lastError ? `<span class="pill warn">${esc(o.email.lastError).slice(0, 80)}</span>` : `${fmtN(o.email.sent || 0)} sent, ${fmtN(o.email.failed || 0)} failed`], ...o.forwarders.map((f) => [`Forward → ${esc(f.name || f.host)}`, `${fmtN(f.sent)} sent, ${fmtN(f.errors)} errors`]), ['Plain-text logs', o.rawLog.enabled ? (o.rawLog.error ? esc(o.rawLog.error) : 'writing') : 'off']])}</div>
      </div>
      <p class="muted" style="max-width:760px">Every 30 seconds NetEventPro runs these checks. When one changes state and stays that way for a minute, a message from device <b>NetEventPro</b> is added to the log. To be emailed, add a rule on the Rules page (template “NetEventPro health alerts”). Warning levels for disk space are in Settings → Storage.</p>`;
    $('#hInfo', el).textContent = `updated ${timeOf(h.at, false)}`; $('#hPill').innerHTML = pill(h.status);
  }
  function ring(v, sev, label) {   // a small dial: how full is it?
    const r = 30, c = 2 * Math.PI * r, f = Math.max(0, Math.min(100, v || 0)) / 100;
    return `<svg class="ring ${sev}" viewBox="0 0 76 76" width="76" height="76" role="img" aria-label="${label}"><circle cx="38" cy="38" r="${r}" class="rbg"/><circle cx="38" cy="38" r="${r}" class="rfg" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 38 38)"/><text x="38" y="43" text-anchor="middle">${v === null || v === undefined ? '–' : Math.round(v) + '%'}</text></svg>`;
  }
  function drawHist(d) {
    const f = d.fast, now = f[f.length - 1] || {}, m = d.machine, dk = d.disk;
    const cpuS = sevOf(now.cpu || 0, 75, 90), memS = sevOf(now.mem || 0, 80, 92), dskS = now.disk === null || now.disk === undefined ? 'ok' : sevOf(now.disk, 85, 95);
    $('#hCards', el).innerHTML = `
      <div class="hcard"><div>${ring(now.cpu, cpuS, 'CPU')}</div><div><div class="hk">CPU</div><div class="hv">${pct(now.cpu)}</div><div class="hs">${m.cores} cores · NetEventPro uses ${pct(now.proc)}</div></div></div>
      <div class="hcard"><div>${ring(now.mem, memS, 'Memory')}</div><div><div class="hk">Memory</div><div class="hv">${pct(now.mem)}</div><div class="hs">${(m.totalMemGB * (now.mem || 0) / 100).toFixed(1)} of ${m.totalMemGB} GB · NetEventPro ${now.rss ?? '–'} MB</div></div></div>
      <div class="hcard"><div>${ring(now.disk, dskS, 'Disk')}</div><div><div class="hk">Disk (data drive)</div><div class="hv">${pct(now.disk)}</div><div class="hs">${dk ? `${gb(dk.freeGB)} free of ${gb(dk.totalGB)}` : 'not readable'}</div></div></div>
      <div class="hcard"><div class="nic" aria-hidden="true">⇅</div><div><div class="hk">Network</div><div class="hv" style="font-size:18px">↓ ${bps(now.rx)}</div><div class="hv" style="font-size:18px">↑ ${bps(now.tx)}</div><div class="hs">${fmtN(now.eps ?? 0)} messages/s received</div></div></div>`;
    const key = d.range + '|' + f.length; const step = d.stepSec;
    const panel = (id, title, sub) => `<div class="panel hchart"><div class="hch"><h2>${title}</h2><span class="muted">${sub}</span></div><canvas id="${id}" height="170"></canvas></div>`;
    if (!$('#cCpu', el)) $('#hCharts', el).innerHTML = panel('cCpu', 'CPU utilisation', 'whole machine and NetEventPro') + panel('cMem', 'Memory utilisation', 'RAM in use') + panel('cDisk', 'Disk utilisation', 'data drive, percent used') + panel('cNet', 'Network', 'all interfaces, incoming and outgoing') + panel('cEps', 'Messages received', 'syslog and SNMP traps per second') + panel('cLag', 'Service responsiveness', 'longest pause, milliseconds');
    const pc = (v) => Math.round(v) + '%', mbps = (v) => bps(v);
    sysChart($('#cCpu', el), f, [{ name: 'Machine', color: '#3b82f6', key: 'cpu' }, { name: 'NetEventPro', color: '#f5a524', key: 'proc' }], { max: 100, fmt: pc, step });
    sysChart($('#cMem', el), f, [{ name: 'Used', color: '#a78bfa', key: 'mem' }], { max: 100, fmt: pc, step });
    sysChart($('#cDisk', el), f, [{ name: 'Used', color: '#22c55e', key: 'disk' }], { max: 100, fmt: pc, step });
    sysChart($('#cNet', el), f, [{ name: 'Incoming', color: '#06b6d4', key: 'rx' }, { name: 'Outgoing', color: '#f472b6', key: 'tx' }], { fmt: mbps, step, fillAll: true });
    sysChart($('#cEps', el), f, [{ name: 'Messages/s', color: '#38bdf8', key: 'eps' }], { fmt: (v) => String(Math.round(v * 10) / 10), step });
    sysChart($('#cLag', el), f, [{ name: 'Pause (ms)', color: '#fb7185', key: 'lag' }], { fmt: (v) => Math.round(v) + ' ms', step });
    if (now.rx === null || now.rx === undefined) { const c = $('#cNet', el); const g = c.getContext('2d'); g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted'); g.textAlign = 'center'; g.fillText('Network counters are not available on this system', c.clientWidth / 2, 90); }
    $('#hMachine', el)?.remove();
    $('#hBody', el).insertAdjacentHTML('afterbegin', `<div class="panel" id="hMachine" style="margin-bottom:14px"><h2>This machine</h2>${kv([['Name', esc(m.host)], ['Operating system', `${esc(m.os)} (${esc(m.arch)}), up ${uptime(m.uptimeSec)}`], ['Processor', `${esc(m.cpuModel || 'unknown')} · ${m.cores} cores${m.speedMHz ? ' · ' + m.speedMHz + ' MHz' : ''}`], ['Memory', `${m.totalMemGB} GB`], m.load ? ['Load average (1/5/15 min)', m.load.join(' / ')] : null, ['Network cards', m.nets.map((n) => `${esc(n.name)} ${esc(n.ip)}`).join('<br>') || '–']])}</div>`);
  }
  const loadHist = async () => { try { const d = await api('/api/health/history?range=' + range); if (alive) { hist = d; drawHist(d); } } catch { /* the cards stay as they were */ } };
  const load = async () => { try { const h = await api('/api/health'); if (alive) { draw(h); if (hist) drawHist(hist); } } catch (e) { if (alive) $('#hBody', el).innerHTML = `<div class="empty"><b>Could not read the health report</b>${esc(e.message)}</div>`; } };
  el.addEventListener('click', (e) => { if (e.target.id === 'hRefresh') { load(); loadHist(); } });
  el.addEventListener('change', (e) => { if (e.target.id === 'hRange') { range = e.target.value; try { sessionStorage.setItem(RANGE_KEY, range); } catch { /* ignore */ } loadHist(); } });
  const rs = () => { if (hist) drawHist(hist); }; window.addEventListener('resize', rs);
  load(); loadHist(); timer = setInterval(() => { load(); loadHist(); }, 5000);
  return () => { alive = false; clearInterval(timer); window.removeEventListener('resize', rs); };
};
