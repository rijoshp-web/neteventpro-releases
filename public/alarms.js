'use strict';
// Alarms console and Maintenance windows pages.

const ALARM_STATE = { open: ['Open', 'bad'], ack: ['Acknowledged', 'warn'], cleared: ['Cleared', ''] };
const agoMs = (ts) => ago(Math.max(0, (Date.now() - ts) / 1000));
const dur = (ms) => { const m = Math.round(ms / 60000); return m < 90 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`; };

// ---- alarm table columns: every column can be shown, hidden and moved (Columns button); clicking a heading sorts ----
const ACOLS = {
  sev:     { label: 'Severity', sort: 'severity', cell: (a) => `<td><span class="sevtag"><i></i>${esc(SEV[a.severity] || a.severity)}</span></td>` },
  device:  { label: 'Device', sort: 'device', cell: (a, o) => `<td class="nowrap"><span class="srcdot ${a.source === 'snmp' ? 'snmp' : ''}" title="${a.source === 'snmp' ? 'SNMP trap' : 'Syslog'}"></span><a href="${a.source === 'snmp' ? '#traps' : '#logs'}" data-host="${esc(a.device)}" title="Show this device's messages">${esc(a.host)}</a>${a.port && !o.has('port') ? ` <span class="portchip" title="Port / item this alarm is about">${esc(a.port)}</span>` : ''}</td>` },
  port:    { label: 'Port / item', sort: 'port', cell: (a) => `<td class="nowrap">${a.port ? `<span class="portchip">${esc(a.port)}</span>` : '<span class="muted">—</span>'}</td>` },
  alarm:   { label: 'Alarm', sort: 'alarm', cell: (a) => `<td class="nowrap">${esc(a.rule)}${a.count > 1 ? ` <span class="muted" title="Repeated ${fmtN(a.count)} times">×${fmtN(a.count)}</span>` : ''}${a.escalated ? ' <span class="escmark" title="Nobody acknowledged it in time: an escalation e-mail was sent">⚠</span>' : ''}${a.notes.length ? ` <span class="muted" title="${a.notes.length} note(s)">✎${a.notes.length}</span>` : ''}</td>` },
  message: { label: 'Last message', sort: 'message', cell: (a) => `<td class="msgcell" title="${esc(a.message)}">${esc(a.message)}</td>` },
  raised:  { label: 'Raised', sort: 'raised', cell: (a) => `<td class="nowrap">${dateOf(a.first)} ${timeOf(a.first, false)}</td>` },
  cleared: { label: 'Cleared', hist: true, sort: 'cleared', cell: (a) => `<td class="nowrap">${a.clearedTs ? dateOf(a.clearedTs) + ' ' + timeOf(a.clearedTs, false) : '<span class="muted">—</span>'}</td>` },
  dur:     { label: 'Duration', sort: 'duration', cell: (a) => `<td class="muted nowrap">${esc(dur((a.clearedTs || Date.now()) - a.first))}</td>` },
  source:  { label: 'Source', sort: 'source', cell: (a) => `<td class="nowrap">${a.source === 'snmp' ? 'SNMP trap' : 'Syslog'}</td>` },
  ack:     { label: 'Acknowledged', sort: 'ack', cell: (a) => `<td class="nowrap">${a.ackTs ? `<span class="pill warn" title="Acknowledged by ${esc(a.ackBy)}">✓ ${esc(String(a.ackBy || '').slice(0, 16))}</span> <span class="muted">${timeOf(a.ackTs, false)}</span>` : '<span class="muted">No</span>'}</td>` },
  esc:     { label: 'Escalated', sort: 'esc', cell: (a) => `<td class="nowrap">${a.escTs ? `<span class="pill bad" title="Nobody acknowledged it in ${a.escMin} min: an escalation e-mail was sent">⚠ Escalated</span> <span class="muted">${timeOf(a.escTs, false)}</span>` : '<span class="muted">No</span>'}</td>` },
  by:      { label: 'Cleared by', sort: 'clearedby', hist: true, cell: (a) => `<td class="nowrap muted">${esc(/^auto/.test(a.clearedBy) ? 'auto' : a.clearedBy || '')}</td>` },
  ip:      { label: 'IP address', sort: 'device', cell: (a) => `<td class="nowrap muted">${esc(a.srcIp)}</td>` },
};
const ACOL_DEFAULT = ['sev', 'device', 'port', 'alarm', 'message', 'raised', 'ack', 'esc', 'cleared', 'by', 'dur'];
const ACOL_OLD = { rdate: 'raised', ldate: 'last', cdate: 'cleared', rtime: null, ltime: null, ctime: null };   // date and time are one column now
/** [{id, visible}] in the saved order; columns that did not exist when it was saved are appended hidden */
function alarmColList() {
  const saved = S.prefs.columns?.alarms; let list;
  if (Array.isArray(saved) && saved.some((c) => c.id === 'ack')) {   // a list saved by an older version (no Acknowledged / Escalated columns) is replaced by the new default
    list = []; for (const c of saved) { const id = c.id in ACOL_OLD ? ACOL_OLD[c.id] : c.id; if (id && ACOLS[id] && !list.some((x) => x.id === id)) list.push({ id, visible: c.visible !== false }); } for (const id of Object.keys(ACOLS)) if (!list.some((c) => c.id === id)) list.push({ id, visible: false }); }
  else { list = ACOL_DEFAULT.map((id) => ({ id, visible: true })); for (const id of Object.keys(ACOLS)) if (!ACOL_DEFAULT.includes(id)) list.push({ id, visible: false }); }
  if (!list.some((c) => c.visible)) list[0].visible = true; return list;
}
function openAlarmColumns(anchor, onChange) {
  if ($('.popover')) { closePopovers(); return; }
  const pop = document.createElement('div'); pop.className = 'popover'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Choose alarm columns');
  const render = () => { const list = alarmColList();
    pop.innerHTML = '<div class="pop-title">Alarm columns</div>' + list.map((c, i) => `<div class="pop-row" data-id="${c.id}"><label class="chk"><input type="checkbox" ${c.visible ? 'checked' : ''}> ${esc(ACOLS[c.id].label)}</label><span class="spacer"></span><button data-mv="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(ACOLS[c.id].label)} up">↑</button><button data-mv="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(ACOLS[c.id].label)} down">↓</button></div>`).join('') + '<div class="toolbar" style="margin:10px 0 0"><button id="popReset">Reset to default</button><span class="spacer"></span><button class="primary" id="popDone">Done</button></div>'; };
  const commit = (list) => { S.prefs.columns = { ...(S.prefs.columns || {}), alarms: list }; if (S.colw) delete S.colw.alarm; if (S.prefs.colw) delete S.prefs.colw.alarm; savePrefs(); onChange(); render(); };
  pop.addEventListener('change', (e) => { const row = e.target.closest('.pop-row'); if (row) commit(alarmColList().map((c) => (c.id === row.dataset.id ? { ...c, visible: e.target.checked } : c))); });
  pop.addEventListener('click', (e) => {
    if (e.target.id === 'popDone') return closePopovers();
    if (e.target.id === 'popReset') { if (S.prefs.columns) delete S.prefs.columns.alarms; if (S.colw) delete S.colw.alarm; if (S.prefs.colw) delete S.prefs.colw.alarm; savePrefs(); onChange(); render(); return; }
    const b = e.target.closest('button[data-mv]'); if (!b) return; const list = alarmColList(), i = list.findIndex((c) => c.id === b.closest('.pop-row').dataset.id), j = i + +b.dataset.mv; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; commit(list);
  });
  render(); document.body.appendChild(pop); const r = anchor.getBoundingClientRect(); pop.style.top = (r.bottom + 6) + 'px'; pop.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  setTimeout(() => document.addEventListener('mousedown', function away(e) { if (!pop.isConnected) return document.removeEventListener('mousedown', away); if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', away); } }), 0);
}

views.alarms = (el) => {
  let data = { alarms: [], total: 0, counts: {}, canAct: false }, state = ['active', 'open', 'ack', 'escalated', 'cleared'].includes(S.alarmState) ? S.alarmState : 'active', sevs = S.alarmSevs || '', src = S.alarmSrc || '', range = S.alarmRange = 'day', day = dayKey(), cFrom = S.alarmFrom || '', cTo = S.alarmTo || '', seq = 0, sort = S.alarmSort || '', q = sessionStorage.getItem('sp.alarmQ') || '', timer, selected = new Set(), lastOpen = null, busy = false, lastSig = '', pressed = false, lastQuery = new URLSearchParams();
  const head = () => {
    const c = data.counts || {};
    el.innerHTML = `<div class="page-head"><h1>Alarms</h1><span class="muted" id="alInfo"></span></div>
    <div class="altabs" id="alChips" role="tablist"></div><div class="muted" id="alSum" style="margin:0 0 10px"></div>
    <div class="toolbar filterbar">
      <select id="alState" aria-label="Show"><option value="active">All active alarms</option><option value="open">Not acknowledged</option><option value="ack">Acknowledged</option><option value="escalated">Escalated</option></select>
      <select id="alRange" aria-label="Time range">${RANGES.map(([v, n]) => `<option value="${v}">${v === '0' ? 'All time (everything stored)' : n}</option>`).join('')}</select>
      ${dayNavHtml('alDay', day)}<span id="alCustom" ${range === 'custom' && state === 'cleared' ? '' : 'hidden'}><input type="datetime-local" id="alFrom" aria-label="From" value="${esc(cFrom)}"> to <input type="datetime-local" id="alTo" aria-label="To (leave empty for now)" value="${esc(cTo)}"></span>
      <select id="alSrc" aria-label="Source"><option value="">All sources</option><option value="syslog">Syslog</option><option value="snmp">SNMP traps</option></select>
      <button id="alSev" aria-haspopup="dialog" title="Choose one or more severities"></button>
      <input type="search" id="alQ" class="grow" placeholder="Search device, alarm name or message" value="${esc(q)}">
      <button id="alGo" class="ib">${ico('search')}<span class="bt">Search</span></button>
      <button id="alCols" class="ib" title="Choose, show, hide and move the columns">${ico('columns')}<span class="bt">Columns</span></button>
      <button id="alCsv" class="ib" title="Download the alarms shown as a CSV file">${ico('download')}<span class="bt">Export</span></button>
      <span class="spacer"></span>
      <span id="alBulk" class="btngroup" ${data.canAct || can('delete') ? '' : 'hidden'}><button id="alAckSel" class="ib" disabled>${ico('check')}<span class="bt">Acknowledge</span></button><button id="alClearSel" class="ib" disabled>${ico('x')}<span class="bt">Clear</span></button>${can('delete') ? `<button id="alDelSel" class="ib danger" disabled title="Delete the ticked alarms for good">${ico('x')}<span class="bt">Delete</span></button><button id="alDelAll" class="ib danger" hidden title="Delete every alarm that matches the filters above, not only the ones shown">${ico('x')}<span class="bt"></span></button>` : ''}</span>
    </div>
    <div class="panel alwrap" style="padding:0"><table class="data alarms" id="alTable"></table></div>`;
    $('#alState').value = state === 'cleared' ? 'active' : state; $('#alSrc').value = src; $('#alRange').value = range; setSev();
  };
  const setSev = () => { const n = sevSetOf(sevs).length; $('#alSev').textContent = sevLabel(sevs) + ' ▾'; $('#alSev').classList.toggle('on', n > 0 && n < 10); };
  const hist = () => state === 'cleared';
  const chips = () => {      // the two tabs (no counts on them); the history tab also needs the period controls
    $('#alChips').innerHTML = `<button role="tab" class="${hist() ? '' : 'on'}" data-t="active" aria-selected="${!hist()}">Active alarms</button><button role="tab" class="${hist() ? 'on' : ''}" data-t="hist" aria-selected="${hist()}">Alarm history</button>${data.counts?.refused ? `<span class="pill bad" style="margin-left:12px" title="Too many active alarms: new ones were not recorded. Clear old ones or tighten the rules.">${fmtN(data.counts.refused)} not recorded (limit reached)</span>` : ''}`;
    $('#alState').hidden = hist(); $('#alRange').hidden = !hist(); $('#alCustom').hidden = !hist() || range !== 'custom'; $('#alDay').hidden = !hist() || range !== 'day'; { const inp = $('#alDay [data-dayin]'); if (inp) { inp.value = day; $('#alDay [data-day="1"]').disabled = day >= dayKey(); $('#alDay [data-day="today"]').disabled = day === dayKey(); } }
  };
  const sortOf = () => { const m = /^([a-z]+):(asc|desc)$/.exec(sort); return m ? { col: m[1], dir: m[2] } : null; };
  const table = () => {
    const act = data.canAct, sel = act || can('delete'), rows = data.alarms, cols = alarmColList().filter((c) => c.visible && (!ACOLS[c.id].hist || hist())).map((c) => c.id), shown = new Set(cols), sd = sortOf();
    { const b = $('#alDelAll'); if (b) { b.hidden = !(data.total > rows.length); b.querySelector('.bt').textContent = `Delete all ${fmtN(data.total)}`; } }
    $('#alInfo').textContent = `${fmtN(data.total)} alarm${data.total === 1 ? '' : 's'}${data.total > rows.length ? ` · showing ${rows.length}` : ''}`;
    let arrowDone = false;      // the date and time columns sort the same way: only the first one shows the arrow
    const th = (id) => { const d = ACOLS[id], on = sd && sd.col === d.sort && !arrowDone; if (on) arrowDone = true; return `<th data-sort="${d.sort}" tabindex="0" class="sortable" aria-sort="${on ? (sd.dir === 'asc' ? 'ascending' : 'descending') : 'none'}" title="Click to sort by ${esc(d.label.toLowerCase())}">${esc(d.short || d.label)}<span class="arr">${on ? (sd.dir === 'asc' ? '▲' : '▼') : ''}</span></th>`; };
    $('#alTable').innerHTML = rows.length ? `<thead><tr>${sel ? '<th class="chk"><input type="checkbox" id="alAll" aria-label="Select all"></th>' : ''}${cols.map(th).join('')}${act ? '<th></th>' : ''}</tr></thead><tbody>${rows.map((a) => `<tr data-id="${a.id}" class="al-row sev-${a.severity}">${sel ? `<td class="chk"><input type="checkbox" data-sel="${a.id}" ${selected.has(a.id) ? 'checked' : ''} aria-label="Select"></td>` : ''}${cols.map((id) => ACOLS[id].cell(a, shown)).join('')}
        ${act ? `<td class="nowrap acts">${a.state === 'open' ? `<button class="ib" data-a="ack" title="Acknowledge" aria-label="Acknowledge">${ico('check')}</button>` : ''}${a.state !== 'cleared' ? `<button class="ib" data-a="clear" title="Clear" aria-label="Clear">${ico('x')}</button>` : ''}<button class="ib" data-a="note" title="Notes" aria-label="Notes">✎</button></td>` : ''}</tr>`).join('')}</tbody>` : `<tbody><tr><td class="empty-cell"><div class="empty"><b>${state === 'cleared' ? 'No cleared alarms' : 'No alarms'}</b>${state === 'active' || state === 'open' ? 'All quiet. Alarms appear here when a rule with “Raise an alarm” matches a message (Rules &amp; alerts).' : ''}</div></td></tr></tbody>`;
    enableColResize($('#alTable'), 'alarm', () => { lastSig = ''; table(); });
    sync();
  };
  const summary = () => {
    const m = data.summary; if (!m) return; const o = m.oldestOpen;
    $('#alSum').innerHTML = hist() ? (m.cleared ? `Average time to clear <b>${esc(dur(m.avgClearMs))}</b> · longest <b>${esc(dur(m.maxClearMs))}</b>` : '') : (o ? `Oldest active alarm: <b>${esc(o.rule)}</b> on ${esc(o.host)} for ${esc(dur(Date.now() - o.first))}` : '');
  };
  const csv = () => {
    const q2 = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"', h = ['Severity', 'Source', 'Device', 'IP', 'Alarm', 'Port', 'Message', 'Raised', 'Acknowledged by', 'Acknowledged at', 'Escalated at', 'Cleared', 'Cleared by', 'Duration (min)'];
    const rows = data.alarms.map((a) => [SEV[a.severity], a.source, a.host, a.srcIp, a.rule, a.port, a.message, dateTime(a.first), a.ackBy, a.ackTs ? dateTime(a.ackTs) : '', a.escTs ? dateTime(a.escTs) : '', a.clearedTs ? dateTime(a.clearedTs) : '', a.clearedBy, Math.round(((a.clearedTs || Date.now()) - a.first) / 60000)]);
    const blob = new Blob(['\ufeff' + [h, ...rows].map((r) => r.map(q2).join(',')).join('\r\n')], { type: 'text/csv' }), u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = `alarms-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000);
  };
  const sync = () => { const n = selected.size; for (const b of ['#alAckSel', '#alClearSel', '#alDelSel']) { const x = $(b); if (x) x.disabled = !n; } };
  const load = async (force) => {
    if (busy && !force) return; busy = true; const mine = ++seq;     // a choice made by the person always runs, and only the newest answer is shown
    try {
      const p = new URLSearchParams({ state, q, limit: 300 }); if (src) p.set('source', src); if (!hist()) { /* active alarms are shown whatever their age */ } else if (range === 'day') { const b = dayBounds(day); p.set('from', String(b.from)); if (day !== dayKey()) p.set('to', String(b.to)); } else if (range === 'custom') { if (cFrom) p.set('from', String(new Date(cFrom).getTime())); if (cTo) p.set('to', String(new Date(cTo).getTime())); } else if (range === '0') p.set('from', '0'); else if (range) p.set('from', String(Date.now() - +range)); if (sort) p.set('sort', sort); if (sevSetOf(sevs).length && sevSetOf(sevs).length < 8) p.set('sevs', sevs);
      lastQuery = new URLSearchParams(p); lastQuery.delete('limit'); lastQuery.delete('sort'); const got = await api('/api/alarms?' + p); if (mine !== seq) return; data = got;
      const open = data.counts.open || 0; if (lastOpen !== null && open > lastOpen) beep(data.counts.worstOpen); lastOpen = open;
      const ids = new Set(data.alarms.map((a) => a.id)); for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);
      $('#alBulk').hidden = !(data.canAct || can('delete')); const sig = JSON.stringify([data.alarms, data.total, state]); chips(); if (sig !== lastSig && (force || !pressed)) { lastSig = sig; table(); } setBadge(data.counts); summary();
    } catch (e) { /* the sign-in check in api() reloads the page when needed */ } finally { if (mine === seq) busy = false; }
  };
  const act = async (url, ids, note) => { try { const r = await api(url, { method: 'POST', body: { ids, note } }); selected.clear(); lastSig = ''; await load(); return r; } catch (e) { toast(e.message, true); } };
  const detail = (a) => {
    const d = dialog(`Alarm — ${a.rule}`, `<div class="form"><div class="field"><label>Device</label><div><b>${esc(a.host)}</b> <span class="muted">${esc(a.srcIp)}</span></div></div>
      <div class="field"><label>Severity</label><div><span class="sevtag sev-${a.severity}"><i></i>${esc(SEV[a.severity])}</span></div></div>
      <div class="field"><label>Message</label><div style="white-space:pre-wrap;word-break:break-word">${esc(a.message)}</div></div>
      <div class="field"><label>Times</label><div>Raised ${esc(dateTime(a.first))}${a.state === 'cleared' ? ` · cleared ${esc(dateTime(a.clearedTs))} (${esc(a.clearedBy)}) after ${esc(dur(a.clearedTs - a.first))}` : ''}</div></div>
      <div class="field"><label>Status</label><div>${a.ackTs ? `Acknowledged by <b>${esc(a.ackBy)}</b> at ${esc(dateTime(a.ackTs))}` : 'Not acknowledged'} · ${a.escTs ? `<b>Escalated</b> at ${esc(dateTime(a.escTs))}` : a.escMin && a.state === 'open' ? `escalates after ${a.escMin} min` : 'not escalated'}${a.state === 'cleared' ? ' · cleared' : ''}</div></div>
      <div class="field"><label>Notes</label><div id="alNotes">${a.notes.length ? a.notes.map((n) => `<div class="note"><span class="muted">${esc(dateTime(n.ts))} · ${esc(n.by)}</span><br>${esc(n.text)}</div>`).join('') : '<span class="muted">No notes yet.</span>'}</div></div>
      ${data.canAct ? '<div class="field"><label for="alNew">Add a note</label><div><textarea id="alNew" rows="2" style="width:100%" maxlength="1000" placeholder="What was done, ticket number, who is working on it…"></textarea></div></div>' : ''}
      <div class="toolbar" style="margin:12px 0 0"><button id="alLogs" class="ib">${ico('file')}<span class="bt">Show messages</span></button><span class="spacer"></span><button id="alClose">Close</button>
      ${data.canAct ? `<button id="alAddNote">Add note</button>${a.state === 'open' ? '<button id="alAck" class="primary">Acknowledge</button>' : ''}${a.state !== 'cleared' ? '<button id="alClr" class="danger">Clear</button>' : ''}` : ''}</div></div>`, true);
    const done = async (fn) => { await fn(); d.close(); };
    d.$('#alClose').onclick = d.close;
    d.$('#alLogs').onclick = () => { d.close(); sessionStorage.setItem('sp.search', JSON.stringify({ host: a.device })); location.hash = '#logs'; };
    const note = () => (d.$('#alNew')?.value || '').trim();
    d.$('#alAddNote')?.addEventListener('click', () => { if (!note()) return toast('Write the note first.', true); done(() => act('/api/alarms/note', [a.id], note())); });
    d.$('#alAck')?.addEventListener('click', () => done(() => act('/api/alarms/ack', [a.id], note())));
    d.$('#alClr')?.addEventListener('click', () => done(() => act('/api/alarms/clear', [a.id], note())));
  };
  sessionStorage.removeItem('sp.alarmQ'); head(); chips(); load();
  el.addEventListener('change', (e) => {
    if (e.target.id === 'alSrc') { src = S.alarmSrc = e.target.value; selected.clear(); load(true); }
    if (e.target.dataset?.dayin !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { day = e.target.value > dayKey() ? dayKey() : e.target.value; selected.clear(); chips(); load(true); return; }
    if (e.target.id === 'alRange') { if (e.target.value === 'day') day = dayKey(); range = S.alarmRange = e.target.value; $('#alCustom').hidden = range !== 'custom'; selected.clear(); if (range !== 'custom') load(true); chips(); }
    if (e.target.id === 'alFrom' || e.target.id === 'alTo') { cFrom = S.alarmFrom = $('#alFrom').value; cTo = S.alarmTo = $('#alTo').value; load(true); }
    if (e.target.id === 'alState') { state = S.alarmState = e.target.value; selected.clear(); chips(); load(true); }
    if (e.target.id === 'alAll') { selected = new Set(e.target.checked ? data.alarms.map((a) => a.id) : []); $$('[data-sel]', el).forEach((c) => { c.checked = selected.has(+c.dataset.sel); }); sync(); }
    if (e.target.dataset.sel) { const id = +e.target.dataset.sel; if (e.target.checked) selected.add(id); else selected.delete(id); sync(); }
  });
  el.addEventListener('click', async (e) => {
    const t = e.target;
    { const db = t.closest('#alDay [data-day]'); if (db) { const v = db.dataset.day; const k = v === 'today' ? dayKey() : dayShift(day, +v); day = k > dayKey() ? dayKey() : k; selected.clear(); chips(); load(true); return; } }
    if (t.id === 'alSev' || t.closest('#alSev')) return sevPopover($('#alSev'), sevs, (v) => { sevs = S.alarmSevs = v; setSev(); load(true); });
    if (t.closest('#alCols')) return openAlarmColumns($('#alCols'), () => { lastSig = ''; table(); });
    const sh = t.closest('th[data-sort]'); if (sh && !colDrag && !t.closest('.colrz')) { const k = sh.dataset.sort, cur = sortOf(); sort = S.alarmSort = cur && cur.col === k ? `${k}:${cur.dir === 'asc' ? 'desc' : 'asc'}` : `${k}:${k === 'raised' || k === 'ack' || k === 'esc' || k === 'cleared' || k === 'duration' ? 'desc' : 'asc'}`; return load(true); }
    if (t.closest('#alCsv')) return csv();
    if (t.id === 'alGo' || t.closest('#alGo')) { q = $('#alQ').value.trim(); return load(true); }
    if (t.closest('[data-t]')) { const h = t.closest('[data-t]').dataset.t === 'hist'; if (h === hist()) return; state = S.alarmState = h ? 'cleared' : 'active'; $('#alState').value = 'active'; selected.clear(); lastSig = ''; chips(); return load(true); }
    if (t.closest('#alDelAll')) { const n = data.total; if (await askConfirm(`Delete all ${fmtN(n)} alarm records that match the filters now shown (not only the ${fmtN(data.alarms.length)} in the list)? This cannot be undone. Open alarms among them disappear without being cleared.`, `Delete ${fmtN(n)}`)) { try { const r = await api('/api/alarms/delete-matching', { method: 'POST', body: { query: lastQuery.toString() } }); toast(`${fmtN(r.changed)} alarm record(s) deleted.`); selected.clear(); lastSig = ''; await load(true); } catch (e) { toast(e.message, true); } } return; }
    if (t.closest('#alDelSel')) { if (await askConfirm(`Delete ${selected.size} alarm record(s) for good? This cannot be undone. Open alarms among them disappear without being cleared.`, 'Delete')) { await act('/api/alarms/delete', [...selected]); lastSig = ''; } return; }
    if (t.closest('#alAckSel')) return act('/api/alarms/ack', [...selected]);
    if (t.closest('#alClearSel')) { if (await askConfirm(`Clear ${selected.size} alarm(s)? They move to “Cleared”.`, 'Clear')) act('/api/alarms/clear', [...selected]); return; }
    const host = t.closest('[data-host]'); if (host) { e.preventDefault(); sessionStorage.setItem('sp.search', JSON.stringify({ host: host.dataset.host })); location.hash = host.getAttribute('href') === '#traps' ? '#traps' : '#logs'; return; }
    const tr = t.closest('tr[data-id]'); if (!tr || t.closest('input')) return;
    const a = data.alarms.find((x) => x.id === +tr.dataset.id); if (!a) return;
    const b = t.closest('button[data-a]');
    if (b && b.dataset.a === 'ack') return act('/api/alarms/ack', [a.id]);
    if (b && b.dataset.a === 'clear') { if (await askConfirm(`Clear the alarm “${a.rule}” on ${a.host}?`, 'Clear')) act('/api/alarms/clear', [a.id]); return; }
    detail(a);
  });
  el.addEventListener('mousedown', () => { pressed = true; }); document.addEventListener('mouseup', () => { setTimeout(() => { pressed = false; }, 50); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'alQ') { q = e.target.value.trim(); load(true); } if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('th[data-sort]')) { e.preventDefault(); e.target.click(); } });
  timer = setInterval(() => { if (!$('.modal-back')) load(); }, 3000);
  return () => clearInterval(timer);
};

/** the little red number next to "Alarms" in the menu */
function setBadge(c) {
  const b = $('#navAlarms'); if (!b || !c) return;
  b.textContent = c.open ? (c.open > 999 ? '999+' : c.open) : ''; b.className = 'badge ' + (sevRank(c.worstOpen) <= 2 ? 'bad' : 'warn');
}

// =============================== Maintenance windows =====================================================================================
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
views.maintenance = (el) => {
  if (!can('rules')) return denied(el, 'Maintenance');
  let wins = [], status = {}, dirty = false, timer;
  const toLocal = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const blank = () => { const now = Date.now(); return { id: 'm' + now, name: 'Planned work', enabled: true, devices: '', note: '', schedule: { type: 'once', from: Math.ceil(now / 3600000) * 3600000, to: Math.ceil(now / 3600000) * 3600000 + 2 * 3600000 } }; };
  const draw = () => {
    el.innerHTML = `<div class="page-head"><h1>Maintenance windows</h1><span class="muted">While a window is active, its devices are still logged (tagged <code>maintenance</code>) but raise no alarms, send no alerts and are not reported silent. Times are the server's local time.</span></div>
    <div class="toolbar"><button id="mwAdd">Add window</button><span class="spacer"></span><button class="primary" id="mwSave">Save windows</button></div>
    ${wins.length ? '' : '<div class="panel empty"><b>No maintenance windows</b>Add one before planned work, or set a repeating window for a nightly job.</div>'}
    ${wins.map((w, i) => { const s = w.schedule, once = s.type === 'once';
      return `<div class="rule ${w.enabled === false ? 'off' : ''}" data-i="${i}">
      <div class="toolbar" style="margin:0"><label class="chk"><input type="checkbox" data-k="enabled" ${w.enabled !== false ? 'checked' : ''}> On</label><input type="text" class="name" data-k="name" value="${esc(w.name)}" maxlength="100" aria-label="Window name"><span class="spacer"></span>${status[w.id] ? '<span class="pill warn">Active now</span>' : '<span class="muted">not active</span>'}<button class="danger" data-act="del">Delete</button></div>
      <div class="row"><span class="k">Devices</span><input type="text" data-k="devices" style="width:100%;max-width:520px" placeholder="empty = all devices · names or addresses separated by commas · * allowed, e.g. SW-DXB-*, 10.30.3.10" value="${esc(w.devices || '')}"></div>
      <div class="row"><span class="k">When</span><select data-k="schedule.type"><option value="once" ${once ? 'selected' : ''}>One time</option><option value="weekly" ${!once ? 'selected' : ''}>Repeats weekly</option></select>
        ${once ? `<input type="datetime-local" data-k="from" value="${esc(toLocal(s.from))}" aria-label="From"> to <input type="datetime-local" data-k="to" value="${esc(toLocal(s.to))}" aria-label="To">`
          : `${DOWS.map((n, d) => `<label class="chk"><input type="checkbox" data-day="${d}" ${(s.days || []).includes(d) ? 'checked' : ''}> ${n}</label>`).join('')} <input type="time" data-k="start" value="${esc(s.start || '22:00')}" aria-label="Start"> to <input type="time" data-k="end" value="${esc(s.end || '02:00')}" aria-label="End"> <span class="muted">may pass midnight</span>`}</div>
      <div class="row"><span class="k">Note</span><input type="text" data-k="note" style="width:100%;max-width:520px" maxlength="300" placeholder="Why (optional), e.g. change ticket number" value="${esc(w.note || '')}"></div></div>`; }).join('')}`;
  };
  const load = async () => { const r = await api('/api/maintenance'); wins = r.windows.map((w) => ({ ...w, schedule: { ...w.schedule } })); status = Object.fromEntries(r.status.map((x) => [x.id, x.active])); draw(); };
  el.addEventListener('input', (e) => {
    const rule = e.target.closest('.rule'); if (!rule) return; const w = wins[+rule.dataset.i], k = e.target.dataset.k; dirty = true;
    if (e.target.dataset.day !== undefined) { const d = +e.target.dataset.day, set = new Set(w.schedule.days || []); if (e.target.checked) set.add(d); else set.delete(d); w.schedule.days = [...set].sort(); return; }
    if (!k) return; const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (k === 'from' || k === 'to') w.schedule[k] = v ? new Date(v).getTime() : 0; else if (k === 'start' || k === 'end') w.schedule[k] = v; else if (k.startsWith('schedule.')) return; else w[k] = v;
  });
  el.addEventListener('change', (e) => {
    const rule = e.target.closest('.rule'); if (!rule) return; const w = wins[+rule.dataset.i];
    if (e.target.dataset.k === 'schedule.type') { const t = e.target.value; w.schedule = t === 'once' ? { type: 'once', from: Math.ceil(Date.now() / 3600000) * 3600000, to: Math.ceil(Date.now() / 3600000) * 3600000 + 7200000 } : { type: 'weekly', days: [1, 2, 3, 4, 5], start: '22:00', end: '02:00' }; dirty = true; draw(); }
    if (e.target.dataset.k === 'enabled') rule.classList.toggle('off', !e.target.checked);
  });
  el.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.id === 'mwAdd') { wins.push(blank()); dirty = true; draw(); }
    else if (t.id === 'mwSave') { try { await api('/api/config', { method: 'PUT', body: { maintenance: wins } }); dirty = false; toast('Maintenance windows saved'); await load(); } catch (err) { toast(err.message, true); } }
    else if (t.dataset.act === 'del') { const i = +t.closest('.rule').dataset.i; if (await askConfirm(`Delete the window “${wins[i].name}”?`)) { wins.splice(i, 1); dirty = true; draw(); } }
  });
  load().catch((e) => { el.innerHTML = `<div class="empty"><b>Could not load maintenance windows</b>${esc(e.message)}</div>`; });
  timer = setInterval(() => { if (!dirty && !el.contains(document.activeElement)) api('/api/maintenance').then((r) => { status = Object.fromEntries(r.status.map((x) => [x.id, x.active])); draw(); }).catch(() => {}); }, 15000);
  return () => clearInterval(timer);
};
