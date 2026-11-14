'use strict';
/* NetEventPro dashboard — plain JavaScript, no external libraries, works fully offline. */

// ---------- helpers ----------------------------------------------------------------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SEV = ['Emergency', 'Alert', 'Critical', 'Error', 'Warning', 'Notice', 'Info', 'Debug', 'Minor', 'Cleared'];
const SEVORD = [0, 1, 2, 3, 8, 4, 5, 9, 6, 7];            // most serious first: Minor sits between Error and Warning, Cleared after Notice
const SEVRANK = []; SEVORD.forEach((id, i) => { SEVRANK[id] = i; });
const sevRank = (s) => SEVRANK[s] ?? 99;
const sevOpt = (i) => (i < 8 ? `${i} · ${SEV[i]}` : SEV[i]);
const css = (n) => getComputedStyle(document.getElementById('view') || document.documentElement).getPropertyValue(n).trim();   // read from the page area, so a dashboard theme that sets its own colours reaches the charts
const fmtN = (n) => Number(n || 0).toLocaleString();
const pad = (n, l = 2) => String(n).padStart(l, '0');
const timeOf = (ts, ms = true) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` + (ms ? '.' + pad(d.getMilliseconds(), 3) : ''); };
const dateOf = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ago = (sec) => sec < 5 ? 'just now' : sec < 90 ? `${Math.round(sec)}s ago` : sec < 5400 ? `${Math.round(sec / 60)} min ago` : sec < 172800 ? `${Math.round(sec / 3600)} h ago` : `${Math.round(sec / 86400)} d ago`;
const uptime = (s) => s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m` : `${Math.floor(s / 86400)}d ${Math.floor(s % 86400 / 3600)}h`;

async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: { 'X-Requested-With': 'NetEventPro' } };
  if (opts.body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  const r = await fetch(path, init);
  if (r.status === 401) { location.reload(); throw new Error('Signed out'); }   // the session ended: the page now shows the sign-in form
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).error || m; } catch { /* not json */ } throw new Error(m); }
  return r.json();
}
let toastTimer;
/** In-app yes/no box (replaces the browser's confirm(), which steals focus and can need several clicks). Resolves true / false. */
function askConfirm(message, okLabel) {
  return new Promise((resolve) => {
    const back = document.createElement('div'); back.className = 'modal-back';
    const danger = !okLabel || /delete|remove|restart|reset|wipe|clear/i.test(message + ' ' + (okLabel || ''));
    back.innerHTML = `<div class="modal" role="alertdialog" aria-modal="true" aria-label="Please confirm"><p class="confirm-msg"></p><div class="toolbar" style="margin:16px 0 0;justify-content:flex-end"><button type="button" data-a="no">Cancel</button><button type="button" data-a="yes" class="${danger ? 'danger' : 'primary'}"></button></div></div>`;
    $('.confirm-msg', back).textContent = message; const yes = $('[data-a="yes"]', back); yes.textContent = okLabel || 'Yes';
    const prev = document.activeElement; let done = false;
    const end = (v) => { if (done) return; done = true; back.remove(); document.removeEventListener('keydown', key, true); try { prev && prev.focus && prev.focus(); } catch { /* */ } resolve(v); };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(false); } else if (e.key === 'Enter' && e.target.dataset?.a !== 'no') { e.preventDefault(); e.stopPropagation(); end(true); } };
    document.addEventListener('keydown', key, true);
    back.addEventListener('click', (e) => { const a = e.target.dataset?.a; if (a) end(a === 'yes'); else if (e.target === back) end(false); });
    document.body.appendChild(back); yes.focus();
  });
}
/** In-app text box. Resolves the entered text, or null when cancelled. */
function askText(message, value = '') {
  return new Promise((resolve) => {
    const back = document.createElement('div'); back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><p class="confirm-msg"></p><textarea rows="3" style="width:100%" maxlength="300"></textarea><div class="toolbar" style="margin:16px 0 0;justify-content:flex-end"><button type="button" data-a="no">Cancel</button><button type="button" data-a="yes" class="primary">Save</button></div></div>`;
    $('.confirm-msg', back).textContent = message; const ta = $('textarea', back); ta.value = value; let done = false;
    const end = (v) => { if (done) return; done = true; back.remove(); resolve(v); };
    back.addEventListener('click', (e) => { const a = e.target.dataset?.a; if (a) end(a === 'yes' ? ta.value : null); else if (e.target === back) end(null); });
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') end(null); });
    document.body.appendChild(back); ta.focus();
  });
}
function toast(msg, err = false) { const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), err ? 5000 : 2200); }
const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

// ---------- global state --------------------------------------------------------------
const S = {
  info: null, stats: null, live: [], liveVersion: 0, streamOk: false, sound: store.get('sp.sound', '0') === '1',
  cur: 'syslog', prefs: {}, paused: false, pauseBuf: [], view: null, cleanup: null, newCount: 0
};
// Logs and SNMP traps are separate windows with separate filters and time ranges: S.filter and S.range always mean those of the window in use (S.cur)
const FSTATE = { syslog: { filter: { sevs: '', host: '', app: '', text: '' }, range: '' }, snmp: { filter: { sevs: '', host: '', app: '', text: '' }, range: '' } };
Object.defineProperties(S, { filter: { get: () => FSTATE[S.cur].filter, set: (v) => { FSTATE[S.cur].filter = v; }, enumerable: true }, range: { get: () => FSTATE[S.cur].range, set: (v) => { FSTATE[S.cur].range = v; }, enumerable: true } });
const listeners = new Set(); // live view subscribers: fn(newMessages)

// ---------- live stream -----------------------------------------------------------------
let es, lastBeat = 0, retryMs = 1000, retryTimer;
// The live feed must never stay dead: the server pings every 10 s; if nothing arrives for 30 s (sleeping PC, proxy cut the line, Wi-Fi change) or the browser gave up, reconnect by ourselves.
function reconnectStream(why) {
  clearTimeout(retryTimer); try { es?.close(); } catch { /* already closed */ }
  S.streamOk = false; renderStatus();
  retryTimer = setTimeout(connectStream, retryMs); retryMs = Math.min(15000, retryMs * 2);
}
setInterval(() => { if (es && S.info && Date.now() - lastBeat > 30000) { lastBeat = Date.now(); reconnectStream('silent'); } }, 5000);
for (const ev of ['online', 'focus', 'pageshow']) window.addEventListener(ev, () => { if (es && (!S.streamOk || es.readyState !== 1)) { retryMs = 1000; reconnectStream(ev); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && (!S.streamOk || Date.now() - lastBeat > 30000)) { retryMs = 1000; reconnectStream('visible'); } });
function connectStream() {
  clearTimeout(retryTimer); lastBeat = Date.now();
  if (es) { es.onerror = es.onopen = null; try { es.close(); } catch { /* already closed */ } }   // never keep two connections: every message would be counted twice
  const src = es = new EventSource('/api/stream?backlog=1000');
  es.addEventListener('ping', () => { lastBeat = Date.now(); if (!S.streamOk) { S.streamOk = true; renderStatus(); } });
  es.addEventListener('hello', (e) => {
    if (src !== es) return; lastBeat = Date.now(); const d = JSON.parse(e.data); S.live = d.messages; S.streamOk = true; S.liveVersion++; renderStatus(); listeners.forEach((fn) => fn(null));
  });
  es.addEventListener('batch', (e) => {
    if (src !== es) return; lastBeat = Date.now(); const d = JSON.parse(e.data);
    S.live.push(...d.messages); if (S.live.length > 5000) S.live.splice(0, S.live.length - 5000);
    for (const m of d.messages) { if (m.sound) beep(m.severity); if (m.notify) desktopNotify(m); }
    const nTrap = d.messages.filter((m) => m.source === 'snmp').length, nLog = d.messages.length - nTrap;
    if (S.view !== 'logs' && nLog) { S.newCount += nLog; $('#navLiveCount').textContent = S.newCount > 999 ? '999+' : S.newCount; }
    if (S.view !== 'traps' && nTrap) { S.newTraps = (S.newTraps || 0) + nTrap; $('#navTrapCount').textContent = S.newTraps > 999 ? '999+' : S.newTraps; }
    listeners.forEach((fn) => fn(d.messages, d.skipped));
  });
  es.onerror = () => { S.streamOk = false; renderStatus(); if (es.readyState === 2) reconnectStream('closed'); }; // while the browser is still retrying it reports readyState 0; after it gives up we start over
  es.onopen = () => { S.streamOk = true; retryMs = 1000; lastBeat = Date.now(); renderStatus(); };
}

function upShow(u) {
  const box = $('#upBox'), go = $('#updGo'), nb = $('#upNode'), st = $('#upState'); if (!box) return;
  if (!u) { box.innerHTML = '<span style="color:var(--bad)">No answer from the service</span>'; return; }
  const out = []; S.upAvail = !!(u.available && u.canInstall);
  if (u.latest) {
    if (u.available) { out.push(`<b>Version ${esc(u.latest)} is available${u.date ? ' (released ' + esc(u.date) + ')' : ''}.</b>${u.notes ? `<pre style="white-space:pre-wrap;max-width:760px;margin:4px 0;max-height:160px;overflow:auto">${esc(u.notes)}</pre>` : ''}`); if (st) st.textContent = '· update available'; }
    else { if (st) st.textContent = '· up to date'; out.push(`You have the newest version (${esc(u.latest)}${u.date ? ', released ' + esc(u.date) : ''}).`); }
  } else if (u.error) { if (st) st.textContent = ''; out.push(u.offline ? '<span class="muted">The update server cannot be reached from this PC (no internet?). Install a new version with the installer instead; connected probes still update from this server.</span>' : `<span style="color:var(--bad)">${esc(u.error)}</span>`); }
  if (u.node?.behind) out.push(`<b style="color:var(--s3)">Node.js ${esc(u.node.current)} has a newer release (${esc(u.node.latest)}${u.node.security ? ', security' : ''}).</b> ${u.node.canInstall ? '' : esc(u.node.why || '')}`);
  box.innerHTML = out.join('<br>') + (u.checkedAt ? ` <span class="muted">Checked ${esc(dateTime(u.checkedAt))}.</span>` : '');
  if (go) go.textContent = S.upAvail ? `Update to ${u.latest}` : 'Check for updates'; if (nb) nb.hidden = !(u.node?.behind && u.node.canInstall);
}
let audioCtx;
// Notification sounds are made in the browser (no files). Each is a list of notes: [frequency Hz (or [from, to] glide), start s, length s, wave]
const SOUNDS = {
  beep: ['Beep (default)', [[880, 0, .14, 'sine'], [660, .16, .14, 'sine']]],
  chime: ['Soft chime', [[1046, 0, .5, 'sine'], [1318, .18, .6, 'sine'], [1568, .36, .8, 'sine']]],
  bell: ['Bell', [[880, 0, 1.2, 'sine'], [1760, 0, .8, 'sine'], [2640, 0, .4, 'sine']]],
  ding: ['Single ding', [[1320, 0, .7, 'sine']]],
  doorbell: ['Two-tone doorbell', [[740, 0, .35, 'sine'], [587, .4, .6, 'sine']]],
  triple: ['Triple beep', [[1000, 0, .1, 'square'], [1000, .18, .1, 'square'], [1000, .36, .1, 'square']]],
  pulse: ['Sonar pulse', [[[1200, 600], 0, .6, 'sine']]],
  rise: ['Rising alert', [[500, 0, .15, 'triangle'], [700, .16, .15, 'triangle'], [900, .32, .25, 'triangle']]],
  fall: ['Falling alert', [[900, 0, .15, 'triangle'], [700, .16, .15, 'triangle'], [500, .32, .25, 'triangle']]],
  siren: ['Siren', [[[600, 1000], 0, .5, 'sawtooth'], [[1000, 600], .5, .5, 'sawtooth'], [[600, 1000], 1, .5, 'sawtooth']]],
  klaxon: ['Klaxon (critical)', [[440, 0, .35, 'sawtooth'], [330, .4, .35, 'sawtooth'], [440, .8, .35, 'sawtooth'], [330, 1.2, .35, 'sawtooth']]],
  buzzer: ['Buzzer', [[150, 0, .6, 'sawtooth'], [155, 0, .6, 'square']]],
  radar: ['Radar', [[[2000, 800], 0, .3, 'sine'], [[2000, 800], .5, .3, 'sine']]],
  none: ['Silent (desktop notification only)', []]
};
const SOUND_PREF = () => ({ normal: store.get('sp.soundName', 'beep'), crit: store.get('sp.soundCrit', 'klaxon'), vol: Math.min(1, Math.max(.05, +store.get('sp.soundVol', '0.6') || .6)) });
function playSound(name, vol) {
  const d = SOUNDS[name] || SOUNDS.beep; if (!audioCtx) return; const now = audioCtx.currentTime;
  for (const [f, off, len, wave] of d[1]) {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.type = wave;
    if (Array.isArray(f)) { o.frequency.setValueAtTime(f[0], now + off); o.frequency.linearRampToValueAtTime(f[1], now + off + len); } else o.frequency.value = f;
    const peak = Math.max(.001, .22 * vol * (wave === 'sawtooth' || wave === 'square' ? .5 : 1));
    g.gain.setValueAtTime(0.0001, now + off); g.gain.exponentialRampToValueAtTime(peak, now + off + .02); g.gain.exponentialRampToValueAtTime(0.0001, now + off + len);
    o.connect(g).connect(audioCtx.destination); o.start(now + off); o.stop(now + off + len + .05);
  }
}
// Chrome only lets a page make sound after the person has clicked or pressed a key on it. After a reload the sound setting is still on, so the audio engine is
// created (and woken up) on the first click or key press anywhere on the page.
function wakeAudio() {
  try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state !== 'running') audioCtx.resume?.(); } catch { /* no audio in this browser */ }
  return audioCtx && audioCtx.state === 'running';
}
for (const ev of ['pointerdown', 'keydown', 'touchstart']) document.addEventListener(ev, () => { if (S.sound && (!audioCtx || audioCtx.state !== 'running')) wakeAudio(); }, { capture: true, passive: true });
function beep(sev, test) {
  if (!S.sound && !test) return; if (!audioCtx) wakeAudio(); if (!audioCtx) return;
  const play = () => { const now = audioCtx.currentTime; if (!test && beep.last && now - beep.last < 1.5) return; beep.last = now; const p = SOUND_PREF(); playSound(sevRank(sev) <= 2 ? p.crit : p.normal, p.vol); };
  if (audioCtx.state === 'running') play(); else audioCtx.resume().then(play).catch(() => { /* Chrome blocks sound until the page has been clicked once */ });
}
function desktopNotify(m) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification(`${SEV[m.severity]} — ${m.host}`, { body: m.message.slice(0, 180), tag: 'neteventpro' });
}
function setSound(on) {
  S.sound = on; store.set('sp.sound', on ? '1' : '0');
  if (on) { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume?.(); if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); }
  const cb = $('#soundOn'); if (cb) cb.checked = on;
}

// ---------- filtering (same semantics as the server) -----------------------------------------
function termsOf(text) {
  const out = [];
  for (const raw of String(text || '').match(/"[^"]+"|\S+/g) || []) { let t = raw, neg = false; if (t.startsWith('-') && t.length > 1) { neg = true; t = t.slice(1); } out.push({ neg, t: t.replace(/^"|"$/g, '').toLowerCase() }); }
  return out;
}
const sevSetOf = (v) => String(v ?? '').split(',').filter((x) => x.trim() !== '').map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 9);
/** old saved filters carried one "severityMax"; fold that into the list of ticked severities */
function normFilter(f = {}) {
  let sevs = Array.isArray(f.sevs) ? f.sevs.join(',') : typeof f.sevs === 'string' ? f.sevs : '';
  if (!sevs && f.severityMax !== undefined && f.severityMax !== '' && f.severityMax !== null && Number.isFinite(+f.severityMax)) sevs = SEVORD.slice(0, Math.max(0, SEVORD.indexOf(Math.min(9, Math.max(0, +f.severityMax)))) + 1).sort((a, b) => a - b).join(',');
  return { sevs, host: f.host || '', app: f.app || '', text: f.text || (f.tag ? 'tag:' + f.tag : '') };
}
const sevLabel = (v) => { const a = sevSetOf(v); if (!a.length || a.length === 10) return 'All severities'; if (a.length <= 2) return a.map((i) => SEV[i]).join(' + '); return a.length + ' severities'; };
/** a small panel of tick boxes: pick any combination of severities. onChange gets "0,1,3" ("" = all) */
function sevPopover(anchor, value, onChange) {
  if ($('.popover')) { closePopovers(); return; }
  // an empty list means "all": show every box ticked so that unticking one reads naturally
  let cur = new Set(sevSetOf(value)); if (!cur.size) cur = new Set(SEVORD);
  const pop = document.createElement('div'); pop.className = 'popover'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Severities');
  const draw = () => { pop.innerHTML = '<div class="pop-title">Severities</div>' + SEVORD.map((i) => `<label class="chk" style="display:flex;gap:6px;padding:3px 0"><input type="checkbox" data-s="${i}" ${cur.has(i) ? 'checked' : ''}> ${sevOpt(i)}</label>`).join('') +
    '<div class="toolbar" style="margin:10px 0 0"><button data-q="all">Select all</button><button data-q="none" title="Untick everything, then tick only the severities you want">Deselect all</button><button data-q="err">Errors and worse</button><button data-q="warn">Warnings and worse</button></div>'; };
  const commit = () => onChange(cur.size === 10 || cur.size === 0 ? '' : [...cur].sort((a, b) => a - b).join(','));
  pop.addEventListener('change', (e) => { const i = e.target.dataset.s; if (i === undefined) return; if (e.target.checked) cur.add(+i); else cur.delete(+i); commit(); });
  pop.addEventListener('click', (e) => { const q = e.target.dataset.q; if (!q) return; cur = new Set(q === 'all' ? [...SEVORD] : q === 'none' ? [] : q === 'err' ? [0, 1, 2, 3] : [0, 1, 2, 3, 8, 4]); draw(); commit(); });
  draw(); document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect(); pop.style.top = (r.bottom + 6) + 'px'; pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 260)) + 'px';
  setTimeout(() => document.addEventListener('mousedown', function away(e) { if (!pop.isConnected) return document.removeEventListener('mousedown', away); if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); document.removeEventListener('mousedown', away); } }), 0);
}
/** rules saved with the old "at least / no more than" pair become a list of severities */
function upgradeSev(r) {
  const m = r.match || (r.match = {});
  if (!m.severities && (m.severityMax !== undefined || m.severityMin !== undefined)) {
    const hi = m.severityMax === undefined ? 7 : +m.severityMax, lo = m.severityMin === undefined ? 0 : +m.severityMin;
    const a = SEVORD.filter((id) => sevRank(id) >= sevRank(lo) && sevRank(id) <= sevRank(hi)); if (a.length && a.length < 10) m.severities = a;
  }
  delete m.severityMax; delete m.severityMin; if (m.severities && (!m.severities.length || m.severities.length === 10)) delete m.severities;
  return r;
}
function makeFilter(f) {
  const sevs = sevSetOf(f.sevs), sevAll = !sevs.length || sevs.length === 10;
  const hosts = f.host ? f.host.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : null;
  const app = f.app ? f.app.toLowerCase() : null; const terms = termsOf(f.text);
  return (m) => {
    if (!sevAll && !sevs.includes(m.severity)) return false;
    if (hosts && !hosts.includes(m.host.toLowerCase()) && !hosts.includes(m.srcIp)) return false;
    if (app && !(m.app || '').toLowerCase().includes(app)) return false;
    if (terms.length) {
      const hay = `${m.message} ${m.host} ${m.app}`.toLowerCase(), tg = (m.tags || []).map((g) => String(g).toLowerCase());
      for (const x of terms) { const has = x.t.startsWith('tag:') && x.t.length > 4 ? tg.includes(x.t.slice(4)) : hay.includes(x.t); if (has === x.neg) return false; }   // tag:name matches a message's tags
    }
    return true;
  };
}
function highlight(text, terms) {
  const pos = terms.filter((x) => !x.neg && x.t.length > 1 && !x.t.startsWith('tag:')).map((x) => x.t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!pos.length) return esc(text);
  const re = new RegExp(pos.join('|'), 'gi'); let out = '', last = 0, m;
  while ((m = re.exec(text))) { out += esc(text.slice(last, m.index)) + '<mark class="hl">' + esc(m[0]) + '</mark>'; last = m.index + m[0].length; if (!m[0].length) re.lastIndex++; }
  return out + esc(text.slice(last));
}

// ---------- columns (Live log and Search history) -------------------------------------------------
const COLUMN_DEFS = {
  date:     { label: 'Date', th: 'Date', cell: (m) => `<td class="muted">${dateOf(m.ts)}</td>` },
  time:     { label: 'Time received', th: 'Time', cell: (m) => `<td class="muted">${timeOf(m.ts)}</td>` },
  devtime:  { label: 'Time on the device', th: 'Device time', cell: (m) => `<td class="muted">${m.devTs ? timeOf(m.devTs, false) : ''}</td>` },
  host:     { label: 'Device', th: 'Device', cell: (m) => `<td><a href="#" class="hostlink" data-host="${esc(m.host)}" title="Show only this device">${esc(m.host)}</a></td>` },
  ip:       { label: 'Source IP address', th: 'Source IP', cell: (m) => `<td class="muted">${esc(m.srcIp)}</td>` },
  app:      { label: 'Process', th: 'Process', cell: (m) => `<td class="muted">${esc(m.app)}</td>` },
  pid:      { label: 'Process ID', th: 'PID', cell: (m) => `<td class="muted">${esc(m.pid)}</td>` },
  facility: { label: 'Facility', th: 'Facility', cell: (m) => `<td class="muted">${esc((S.info?.facilities || [])[m.facility] ?? m.facility)}</td>` },
  severity: { label: 'Severity', th: 'Severity', cell: (m) => `<td><span class="sevname">${SEV[effSev(m)]}</span></td>` },
  id:       { label: 'Message number', th: '#', cell: (m) => `<td class="muted">${m.seq || m.id}</td>` },
  snmpver:  { label: 'SNMP version', th: 'SNMP', cell: (m) => `<td class="muted">${esc(vbOf(m)?.ver || '')}</td>` },
  trap:     { label: 'Trap name', th: 'Trap', cell: (m) => `<td class="muted">${esc(m.msgid || '')}</td>` },
  message:  { label: 'Message', th: 'Message', cell: (m, terms) => `<td class="msg">${m._n > 1 ? `<span class="cnt" title="First seen ${dateOf(m._first)} ${timeOf(m._first)}, last seen ${dateOf(m.ts)} ${timeOf(m.ts)}">×${fmtN(m._n)}</span>` : ''}${highlight(m.message, terms)}${(m.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</td>` }
};
const DEFAULT_COLS = { logs: ['date', 'time', 'host', 'app', 'severity', 'message'], traps: ['date', 'time', 'host', 'severity', 'snmpver', 'trap', 'message'] };
const DEFAULT_W = { snmpver: 72, trap: 190, date: 112, time: 126, devtime: 126, host: 150, ip: 130, app: 120, pid: 72, facility: 100, severity: 100, id: 80 };   // message has no default: it takes the space that is left
const SORTERS = { date: (m) => m.ts, time: (m) => m.ts, devtime: (m) => m.devTs || 0, host: (m) => m.host.toLowerCase(), ip: (m) => String(m.srcIp).split('.').map((n) => n.padStart(3, '0')).join('.'),
  app: (m) => (m.app || '').toLowerCase(), trap: (m) => (m.msgid || '').toLowerCase(), pid: (m) => +m.pid || 0, facility: (m) => m.facility, severity: (m) => sevRank(effSev(m)), id: (m) => m.id, message: (m) => m.message.toLowerCase() };

/** [{id, visible}] in the saved order; columns added in later versions are appended hidden. */
function colList(view) {
  const saved = S.prefs.columns?.[view] || (view === 'logs' ? S.prefs.columns?.live || S.prefs.columns?.search : null), all = Object.keys(COLUMN_DEFS).filter((id) => view === 'traps' || (id !== 'trap' && id !== 'snmpver')), def = DEFAULT_COLS[view];
  let list;
  if (Array.isArray(saved) && saved.length) {
    list = saved.filter((c) => COLUMN_DEFS[c.id]).map((c) => ({ id: c.id, visible: c.visible !== false }));
    for (const id of all) if (!list.some((c) => c.id === id)) list.push({ id, visible: id === 'snmpver' });
  } else {
    list = def.map((id) => ({ id, visible: true }));
    for (const id of all) if (!def.includes(id)) list.push({ id, visible: false });
  }
  const m = list.find((c) => c.id === 'message'); if (m) m.visible = true; // the message itself can never be hidden
  return list;
}
const visibleCols = (view) => colList(view).filter((c) => c.visible).map((c) => c.id);
const wrapOn = (view) => (S.prefs.wrap?.[view] ?? (view === 'logs' ? S.prefs.wrap?.live : undefined)) !== false;
// ---- SNMP trap column views: columns chosen per trap type, filled from the trap's own values ----
const TV_DEFS = {};
const defOf = (id) => COLUMN_DEFS[id] || TV_DEFS[id];
function vbOf(m) {
  if (m._vb !== undefined) return m._vb;
  let v = m.vb; if (typeof v === 'string') { try { v = v ? JSON.parse(v) : null; } catch { v = null; } }
  return (m._vb = v && typeof v === 'object' ? v : null);
}
/** value of the trap variable `field` (a name like ifDescr, a full name like ifDescr.7, or an OID prefix) */
function vbValue(m, field) {
  const f = String(field).toLowerCase(), vb = vbOf(m);
  if (vb?.v) {
    for (const [n, o, val] of vb.v) { const nl = String(n).toLowerCase(); if (nl === f || nl.startsWith(f + '.') || nl.split('.')[0] === f || o === field || o.startsWith(field + '.')) return val; }
    return '';
  }
  const mt = new RegExp('(?:^|[:,] )' + field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\.[\\d.]+)? = ([^,]*)', 'i').exec(m.message || '');   // older traps: read it from the text
  return mt ? mt[1] : '';
}
/** one named value of a trap for a column recipe: a value name, the special names {agent} {source} {trap} {oid} {host} {severity} {message} {values}, with an optional :name / :num / :upper / :lower */
function recipeValue(m, key) {
  let [name, mod] = key.split(':').map((x) => x.trim()); const n = name.toLowerCase(); let v = '';
  const vb = vbOf(m);
  if (n === 'agent') v = vb?.a || /\[agent ([\d.]+)\]/.exec(m.message || '')?.[1] || m.srcIp || '';
  else if (n === 'source' || n === 'ip') v = m.srcIp || '';
  else if (n === 'trap') v = vb?.n || m.msgid || '';
  else if (n === 'oid') v = vb?.o || m.trapOid || '';
  else if (n === 'host' || n === 'device') v = m.host || '';
  else if (n === 'severity') v = SEV[m.severity] || '';
  else if (n === 'message') v = m.message || '';
  else if (n === 'number' || n === 'id') v = m.seq || m.id || '';
  else if (n === 'date') v = m.ts ? dateOf(m.ts) : '';
  else if (n === 'time') v = m.ts ? timeOf(m.ts, false) : '';
  else if (n === 'devtime') v = m.devTs ? dateOf(m.devTs) + ' ' + timeOf(m.devTs, false) : '';
  else if (n === 'app' || n === 'process') v = m.app || '';
  else if (n === 'pid') v = m.pid || '';
  else if (n === 'facility') v = (S.info?.facilities || [])[m.facility] ?? '';
  else if (n === 'version' || n === 'snmpversion' || n === 'ver') v = vbOf(m)?.ver || '';
  else if (n === 'mib') v = /^([A-Za-z0-9_-]+)::/.exec(m.message || '')?.[1] || '';
  else if (n === 'values') v = (vb?.v || []).map(([k, , val]) => `${k}=${val}`).join(', ');
  else v = vbValue(m, name);
  v = String(v ?? '').trim();
  if (mod === 'name') v = v.replace(/\(\s*-?\d+\s*\)\s*$/, '').trim(); else if (mod === 'num') v = (/\(\s*(-?\d+)\s*\)\s*$/.exec(v) || [])[1] ?? v; else if (mod === 'upper') v = v.toUpperCase(); else if (mod === 'lower') v = v.toLowerCase();
  return v;
}
/**
 * Text of one trap column. `spec` is a value name (ifDescr), or a recipe that combines several values:
 *   {alarmSource} – {alarmText} {alarmAdditionalText}      every {…} is replaced by that value
 *   {alarmText|upsAdvTrapText|values}                      the first one that is not empty
 * Empty values vanish together with the dash, comma or colon left dangling next to them.
 */
function cellText(m, spec) {
  spec = String(spec ?? ''); if (!spec.includes('{')) return vbValue(m, spec);
  const text = spec.replace(/\{([^{}]+)\}/g, (_, inner) => { for (const alt of inner.split('|')) { const v = recipeValue(m, alt.trim()); if (v) return v; } return '\u0001'; });
  return text.replace(/\s*[-–—:,;|/]*\s*\u0001(?:\s*[-–—:,;|/]*\s*\u0001)*/g, ' ').replace(/\u0001/g, '').replace(/\s{2,}/g, ' ').replace(/^[\s\-–—:,;|/]+|[\s\-–—:,;|/]+$/g, '').trim();
}
/** Lookup table of a column: "5=Critical; 4=Major; *=Unknown". The value is compared as written, without its number (major(3) -> major) and as its number. */
const MAPS = new Map();
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
  let r = MAPS.get(str); if (r) return r; r = { scoped: [], all: { pairs: new Map(), def: null } };
  for (const line of String(str).split('\n')) {      // a line may start with "@ trap name / vendor OID / /regex/ :" so it only applies to those traps
    const h = /^\s*@\s*([^:]+?)\s*:(.*)$/.exec(line), t = h ? { match: h[1], pairs: new Map(), def: null } : r.all, body = h ? h[2] : line;
    for (const part of body.split(';')) { const i = part.indexOf('='); if (i < 1) continue; const k = part.slice(0, i).trim().toLowerCase(), v = part.slice(i + 1).trim(); if (k === '*') t.def = v; else if (k) { t.pairs.set(k, v); for (const x of mapKeys(k)) if (!t.pairs.has(x)) t.pairs.set(x, v); } }
    if (h) r.scoped.push(t);
  }
  if (MAPS.size > 200) MAPS.clear(); MAPS.set(str, r); return r;
}
function applyMap(text, mapStr, m) {
  if (!mapStr || text === '' || text == null) return text; const t = parseMap(mapStr);
  const v = String(text).trim().toLowerCase(), mm = /^(.*?)\s*\(\s*(-?\d+)\s*\)\s*$/.exec(v), keys = mm ? [v, mm[1], mm[2]] : [v];
  const tables = [...t.scoped.filter((x) => m && trapMatches(m, x.match)), t.all];
  for (const x of tables) for (const k of keys) if (x.pairs.has(k)) return x.pairs.get(k);
  for (const x of tables) if (x.def !== null) return x.def;
  return text;
}
/** text of a trap column: its value or recipe, then its lookup table */
/** Text replacement in trap columns, applied when a trap is shown (old and new traps; the stored trap is not changed). Mirror of src/trapreplace.js. */
let REP_SRC = null, REP = []; const REP_FV = new WeakMap();
function compileRep(r) {
  try {
    const flags = 'g' + (r.matchCase ? '' : 'i'); let src;
    if (r.regex) src = r.find;
    else { const esc = r.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); src = /^\d{1,3}(\.\d{1,3}){3}$/.test(r.find) || /^\d+$/.test(r.find) ? `(?<![\\d.])${esc}(?!\\d|\\.\\d)` : r.wholeWord !== false ? `(?<![A-Za-z0-9_])${esc}(?![A-Za-z0-9_])` : esc; }
    return { re: new RegExp(src, flags), to: String(r.replace ?? ''), regex: !!r.regex, field: String(r.field || '').trim().toLowerCase(), rawField: String(r.field || '').trim(), cols: (r.cols || []).map((x) => String(x).trim().toLowerCase()).filter(Boolean) };
  } catch { return null; }
}
function trapRep() {
  const src = S.info?.config?.replacements; if (src === REP_SRC) return REP;
  REP_SRC = src; REP = (Array.isArray(src) ? src : []).filter((r) => r && r.enabled !== false && r.find && r.on !== 'syslog' && r.scope !== 'host').map(compileRep).filter(Boolean); return REP;
}
const repSwap = (it, v) => (it.regex ? v.replace(it.re, it.to) : v.replace(it.re, () => it.to));
function repFieldView(m, R) {
  const fr = R.filter((x) => x.field); if (!fr.length || !m.vb || !Array.isArray(m.vb.v)) return m;
  const hit = REP_FV.get(m); if (hit && hit.R === R) return hit.m;
  let changed = false;
  const v = m.vb.v.map((e) => {
    const old = String(e[2] ?? ''); if (!old) return e; let val = old; const nl = String(e[0]).toLowerCase(), o = String(e[1]);
    for (const it of fr) if (nl === it.field || nl.startsWith(it.field + '.') || nl.split('.')[0] === it.field || o === it.rawField || o.startsWith(it.rawField + '.')) val = repSwap(it, val);
    if (val === old) return e; changed = true; return [e[0], e[1], val, ...e.slice(3)];
  });
  const r = changed ? { ...m, vb: { ...m.vb, v } } : m; REP_FV.set(m, { R, m: r }); return r;
}
function repColText(text, label, field, R) {
  if (!text || !R.length || /\{message\}/i.test(field || '')) return text;
  const lab = String(label || '').trim().toLowerCase(); let t = String(text);
  for (const it of R) { if (it.field) continue; if (it.cols.length && !it.cols.includes(lab)) continue; t = repSwap(it, t); }
  return t;
}
/** a trap column without the text replacement (used for the severity, which must not change with a replaced word) */
const cellRaw = (m, c) => applyMap(cellText(m, c.field), c.map, m);
const cellOf = (m, c) => { const R = trapRep(); return R.length ? repColText(applyMap(cellText(repFieldView(m, R), c.field), c.map, m), c.label, c.field, R) : cellRaw(m, c); };
const tvSortKey = (m, c) => { const f = String(c.field).trim().toLowerCase(); if (f === '{date}' || f === '{time}') return m.ts; if (f === '{devtime}') return m.devTs || 0; if (f === '{number}' || f === '{id}') return +(m.seq || m.id) || 0; const t = String(cellOf(m, c)); return t !== '' && !isNaN(+t) ? +t : t.toLowerCase(); };
function trapMatches(m, match) {
  if (!match) return true; const vb = vbOf(m), oid = vb?.o || m.trapOid || '', name = vb?.n || m.msgid || '';
  const rx = /^\/(.+)\/([a-z]*)$/.exec(match); if (rx) { try { return new RegExp(rx[1], rx[2]).test(name) || new RegExp(rx[1], rx[2]).test(oid); } catch { return false; } }
  if (/^[\d.]+$/.test(match)) { const e = match.replace(/\.$/, ''); return oid === e || oid.startsWith(e + '.'); }
  return name.toLowerCase() === match.toLowerCase();
}
const tvWidth = (f) => { const k = String(f).trim().toLowerCase(); return { '{number}': 96, '{id}': 96, '{date}': 112, '{time}': 100, '{devtime}': 160, '{source}': 130, '{ip}': 130, '{agent}': 130, '{host}': 150, '{device}': 150, '{severity}': 100, '{pid}': 72, '{mib}': 130, '{app}': 110, '{message}': undefined }[k] ?? (/^\{[a-z]+(:name)?\}$/i.test(k) ? 140 : 200); };
const SEV_WORDS = { emergency: 0, alert: 1, critical: 2, fatal: 2, nonrecoverable: 1, major: 3, error: 3, high: 3, minor: 8, warning: 4, medium: 4, noncritical: 4, notice: 5, low: 5, normal: 5, ok: 5, cleared: 9, clear: 9, indeterminate: 5, info: 6, informational: 6, information: 6 };
/** the severity of a trap as the trap view's severity column shows it (the column ticked "This column is the severity"), else the stored one */
function effSev(m) {
  const v = m.source === 'snmp' || vbOf(m) ? activeTrapView() : null, c = v && v.cols.find((x) => x.sev); if (!c) return m.severity;
  const t = /^([a-z][a-z \-_]*?)\s*(?:\(\s*-?\d+\s*\))?$/i.exec(String(cellRaw(m, c)).trim()), k = t && t[1].toLowerCase().replace(/[ \-_]+/g, '');
  return k && SEV_WORDS[k] !== undefined ? SEV_WORDS[k] : m.severity;
}
/** the trap view in use (the only one, else the one chosen on the Traps page, else the default) */
function activeTrapView() { const vs = S.prefs.trapViews || [], id = vs.length === 1 ? vs[0].id : S.trapView === undefined ? S.prefs.trapViewDefault || '' : S.trapView; return vs.find((v) => v.id === id) || null; }
/** Columns button of the Traps page when a view is in use: show, hide and re-order the view's own columns */
function openViewColumns(view, anchor, onChange) {
  if ($('.popover')) { closePopovers(); return; }
  const pop = document.createElement('div'); pop.className = 'popover'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Choose columns');
  const render = () => {
    pop.innerHTML = `<div class="pop-title">Columns of “${esc(view.name)}”</div>` + view.cols.map((c, i) => `<div class="pop-row" data-i="${i}"><label class="chk"><input type="checkbox" ${c.hide ? '' : 'checked'}> ${esc(c.label)}</label><span class="spacer"></span><button data-mv="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button data-mv="1" ${i === view.cols.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button></div>`).join('') +
      `<label class="chk pop-wrap"><input type="checkbox" id="popMsg" ${view.message ? 'checked' : ''}> Also show the full message as the last column</label><div class="muted" style="margin-top:8px;max-width:300px">To add columns, change lookups or rename, use “Trap columns” in Settings.</div><div class="toolbar" style="margin:10px 0 0"><span class="spacer"></span><button class="primary" id="popDone">Done</button></div>`;
  };
  const commit = () => { S.prefs.trapViews = (S.prefs.trapViews || []).map((v) => (v.id === view.id ? view : v)); savePrefs(); onChange(); render(); };
  pop.addEventListener('change', (e) => { if (e.target.id === 'popMsg') { view.message = e.target.checked; return commit(); } const row = e.target.closest('.pop-row'); if (!row) return; view.cols[+row.dataset.i].hide = !e.target.checked; if (!view.cols[+row.dataset.i].hide) delete view.cols[+row.dataset.i].hide; commit(); });
  pop.addEventListener('click', (e) => { if (e.target.id === 'popDone') return closePopovers(); const b = e.target.closest('button[data-mv]'); if (!b) return; const i = +b.closest('.pop-row').dataset.i, j = i + +b.dataset.mv; if (j < 0 || j >= view.cols.length) return; [view.cols[i], view.cols[j]] = [view.cols[j], view.cols[i]]; commit(); });
  render(); document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect(); pop.style.top = (r.bottom + 6) + 'px'; pop.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  setTimeout(() => document.addEventListener('mousedown', function away(e) { if (!pop.isConnected) return document.removeEventListener('mousedown', away); if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); document.removeEventListener('mousedown', away); } }), 0);
}
function trapViewCols(view) {
  const ids = [];
  view.cols.forEach((c, i) => { const id = 'tv' + i; if (!c.hide) ids.push(id); TV_DEFS[id] = { label: c.label, th: esc(c.label), w: tvWidth(c.field), cell: (m) => { const t = esc(cellOf(m, c)); return `<td title="${t}">${t}</td>`; } }; SORTERS[id] = (m) => tvSortKey(m, c); });
  return [...(view.std === false ? [] : ['date', 'time', 'host', 'severity']), ...ids, ...(view.message ? ['message'] : [])];
}
function rowHtml(m, terms, cols, extra = '', sel = null) {
  const c = m.color ? ` data-c style="--rowc:${esc(m.color)}"` : '';
  return `<tr class="${extra} sev-${effSev(m)}" data-id="${m.id}"${c}><td class="sev"><i></i></td>${sel ? `<td class="selc"><input type="checkbox" data-sel="${m.id}" ${sel.has(m.id) ? 'checked' : ''} aria-label="Select message"></td>` : ''}${cols.map((id) => defOf(id).cell(m, terms)).join('')}</tr>`;
}

// preferences are kept on the server so they follow you to another browser; saved a moment after the last change
let prefsTimer;
function savePrefs() {
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => api('/api/config', { method: 'PUT', body: { uiPrefs: S.prefs } }).catch((e) => toast('Could not save your layout: ' + e.message, true)), 400);
}

/** Makes the columns of a table draggable (grab the right edge of a heading; double-click resets). Widths are remembered per table. */
let colDrag = false;
function enableColResize(table, key, redraw) {
  const head = table?.tHead?.rows[0]; if (!head) return; const ths = [...head.cells], W = ((S.colw ||= {})[key] ||= {}), saved = S.prefs.colw?.[key] || {};
  if (ths.some((th, i) => W[i] === undefined)) { table.style.tableLayout = 'auto'; table.style.width = ''; ths.forEach((th, i) => { if (W[i] === undefined) W[i] = saved[i] ?? Math.ceil(th.getBoundingClientRect().width); }); }
  const apply = () => { let cg = table.querySelector('colgroup'); if (!cg) { cg = document.createElement('colgroup'); table.prepend(cg); } cg.innerHTML = ths.map((th, i) => `<col style="width:${W[i]}px">`).join(''); table.style.tableLayout = 'fixed'; table.style.width = ths.reduce((n, th, i) => n + W[i], 0) + 'px'; };
  apply();
  ths.forEach((th, i) => {
    if (!th.textContent.trim() && !th.querySelector('input')) { /* narrow buttons column: still resizable */ }
    if (getComputedStyle(th).position === 'static') th.style.position = 'relative'; const h = document.createElement('span'); h.className = 'colrz'; h.title = 'Drag to resize · double-click to reset all columns'; th.appendChild(h);
    h.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); colDrag = true; const x0 = e.clientX, w0 = W[i]; document.body.classList.add('resizing');
      const move = (ev) => { W[i] = Math.max(30, Math.min(1200, Math.round(w0 + ev.clientX - x0))); apply(); };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.classList.remove('resizing'); setTimeout(() => { colDrag = false; }, 100); S.prefs.colw = { ...(S.prefs.colw || {}), [key]: { ...W } }; savePrefs(); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up); });
    h.addEventListener('dblclick', () => { delete S.colw[key]; if (S.prefs.colw) delete S.prefs.colw[key]; savePrefs(); redraw?.(); });
  });
}

function closePopovers() { $$('.popover').forEach((p) => p.remove()); }
function openColumnPicker(view, anchor, onChange) {
  if ($('.popover')) { closePopovers(); return; }
  const pop = document.createElement('div');
  pop.className = 'popover'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Choose columns');
  const render = () => {
    const list = colList(view);
    pop.innerHTML = '<div class="pop-title">Columns</div>' + list.map((c, i) =>
      `<div class="pop-row" data-id="${c.id}"><label class="chk"><input type="checkbox" ${c.visible ? 'checked' : ''} ${c.id === 'message' ? 'disabled' : ''}> ${esc(COLUMN_DEFS[c.id].label)}</label><span class="spacer"></span>` +
      `<button data-mv="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(COLUMN_DEFS[c.id].label)} up">↑</button><button data-mv="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(COLUMN_DEFS[c.id].label)} down">↓</button></div>`).join('') +
      `<label class="chk pop-wrap"><input type="checkbox" id="popWrap" ${wrapOn(view) ? 'checked' : ''}> Wrap long messages onto several lines</label>` +
      '<div class="toolbar" style="margin:10px 0 0"><button id="popReset">Reset to default</button><span class="spacer"></span><button class="primary" id="popDone">Done</button></div>';
  };
  const commit = (list) => { S.prefs.columns = { ...(S.prefs.columns || {}), [view]: list }; savePrefs(); onChange(); render(); };
  pop.addEventListener('change', (e) => {
    if (e.target.id === 'popWrap') { S.prefs.wrap = { ...(S.prefs.wrap || {}), [view]: e.target.checked }; savePrefs(); onChange(); return; }
    const row = e.target.closest('.pop-row'); if (!row) return;
    commit(colList(view).map((c) => (c.id === row.dataset.id ? { ...c, visible: e.target.checked } : c)));
  });
  pop.addEventListener('click', (e) => {
    if (e.target.id === 'popDone') return closePopovers();
    if (e.target.id === 'popReset') { if (S.prefs.columns) delete S.prefs.columns[view]; if (S.prefs.wrap) delete S.prefs.wrap[view]; savePrefs(); onChange(); render(); return; }
    const b = e.target.closest('button[data-mv]'); if (!b) return;
    const list = colList(view), i = list.findIndex((c) => c.id === b.closest('.pop-row').dataset.id), j = i + +b.dataset.mv;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]]; commit(list);
  });
  render(); document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect(); pop.style.top = (r.bottom + 6) + 'px'; pop.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  setTimeout(() => document.addEventListener('mousedown', function away(e) { if (!pop.isConnected) return document.removeEventListener('mousedown', away); if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); document.removeEventListener('mousedown', away); } }), 0);
}


// ---------- log look: font, size and per-severity colours ---------------------------------------------------------------------
// The font is a key into this fixed list and colours must be #rrggbb, so saved settings can never inject arbitrary CSS.
const FONTS = {
  mono: ['Cascadia Mono / Consolas (default)', 'var(--mono)'], consolas: ['Consolas', 'Consolas, monospace'], cascadia: ['Cascadia Code', '"Cascadia Code", Consolas, monospace'],
  courier: ['Courier New', '"Courier New", monospace'], lucida: ['Lucida Console', '"Lucida Console", monospace'], segoe: ['Segoe UI', '"Segoe UI", system-ui, sans-serif'],
  arial: ['Arial', 'Arial, Helvetica, sans-serif'], verdana: ['Verdana', 'Verdana, sans-serif'], tahoma: ['Tahoma', 'Tahoma, sans-serif'], calibri: ['Calibri', 'Calibri, "Segoe UI", sans-serif'],
  jetbrains: ['JetBrains Mono', '"JetBrains Mono", Consolas, monospace'], fira: ['Fira Code', '"Fira Code", "Fira Mono", Consolas, monospace'], sourcecode: ['Source Code Pro', '"Source Code Pro", Consolas, monospace'],
  robotomono: ['Roboto Mono', '"Roboto Mono", Consolas, monospace'], plexmono: ['IBM Plex Mono', '"IBM Plex Mono", Consolas, monospace'], ubuntumono: ['Ubuntu Mono', '"Ubuntu Mono", Consolas, monospace'],
  dejavu: ['DejaVu Sans Mono', '"DejaVu Sans Mono", Consolas, monospace'], inconsolata: ['Inconsolata', 'Inconsolata, Consolas, monospace'], hack: ['Hack', 'Hack, Consolas, monospace'], menlo: ['Menlo / Monaco', 'Menlo, Monaco, Consolas, monospace'],
  sfmono: ['SF Mono', '"SF Mono", Menlo, Consolas, monospace'], terminal: ['Terminal-style (Lucida, Courier)', '"Lucida Sans Typewriter", "Courier New", monospace'], ocr: ['Courier Prime / Courier', '"Courier Prime", Courier, monospace'],
  inter: ['Inter', 'Inter, "Segoe UI", system-ui, sans-serif'], roboto: ['Roboto', 'Roboto, "Segoe UI", sans-serif'], opensans: ['Open Sans', '"Open Sans", "Segoe UI", sans-serif'], lato: ['Lato', 'Lato, "Segoe UI", sans-serif'],
  segoeui: ['Segoe UI Variable', '"Segoe UI Variable Text", "Segoe UI", sans-serif'], trebuchet: ['Trebuchet MS', '"Trebuchet MS", sans-serif'], helvetica: ['Helvetica Neue', '"Helvetica Neue", Helvetica, Arial, sans-serif'],
  arialnarrow: ['Arial Narrow (more text per line)', '"Arial Narrow", Arial, sans-serif'], georgia: ['Georgia', 'Georgia, serif'], times: ['Times New Roman', '"Times New Roman", Times, serif'], system: ['System font', 'system-ui, sans-serif']
};
const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const STRENGTH = { soft: 16, medium: 40, solid: 100 };
const SUGGESTED = { 8: { bg: '#f59e42' }, 9: { bg: '#2fb5a3' }, 0: { bg: '#d6409f', bold: true }, 1: { bg: '#ee4d5b', bold: true }, 2: { bg: '#f2703d', bold: true }, 3: { bg: '#f5a524' }, 4: { bg: '#d9cf4a' }, 5: { bg: '#4da3ff' } };
function applyLook() {
  let st = $('#logLook'); if (!st) { st = document.createElement('style'); st.id = 'logLook'; document.head.appendChild(st); }
  const L = S.prefs.look || {}, f = FONTS[L.font] || FONTS.mono, size = Math.min(28, Math.max(9, +L.size || 13)), pct = STRENGTH[L.strength] || 40;
  let c = `table.log{font-family:${f[1]};font-size:${size}px}`;
  for (let k = 0; k < 10; k++) {
    const s = (L.sev || {})[k]; if (!s) continue; const sel = `table.log tr.sev-${k}`;
    if (isHex(s.color)) c += `${sel} td{color:${s.color}}${sel} .sevname,${sel} a{color:inherit}`;
    if (isHex(s.bg)) c += `${sel} td:not(.sev){background:${pct === 100 ? s.bg : `color-mix(in srgb, ${s.bg} ${pct}%, transparent)`}}`;
    if (s.bold) c += `${sel} td{font-weight:700}`;
  }
  st.textContent = c;
}
/** Draws the font / size / severity-colour editor into `box`. Changes apply at once and are saved with the other layout choices. */
function lookEditor(box) {
  const look = () => (S.prefs.look ||= {});
  const render = () => {
    const L = S.prefs.look || {}, size = Math.min(28, Math.max(9, +L.size || 13));
    box.innerHTML = `<div class="look-top">
      <label>Font <select data-lk="font" title="A font only shows if it is installed on this computer; otherwise the next one in its list is used">${Object.entries(FONTS).map(([k, [n]]) => `<option value="${k}" ${(L.font || 'mono') === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <label>Size <input type="number" data-lk="size" class="w-sm" min="9" max="28" value="${size}"> px</label>
      <label>Highlight <select data-lk="strength"><option value="soft" ${L.strength === 'soft' ? 'selected' : ''}>Light tint</option><option value="medium" ${!L.strength || L.strength === 'medium' ? 'selected' : ''}>Medium</option><option value="solid" ${L.strength === 'solid' ? 'selected' : ''}>Solid</option></select></label></div>
    <table class="data look-t"><thead><tr><th>Severity</th><th>Text colour</th><th>Highlight colour</th><th>Bold</th></tr></thead><tbody>${SEVORD.map((k) => { const n = SEV[k]; const s = (L.sev || {})[k] || {};
      return `<tr data-k="${k}"><td><span class="sevname sev-${k}">${n}</span></td>
        <td><label class="chk"><input type="checkbox" data-f="useColor" ${isHex(s.color) ? 'checked' : ''} aria-label="Change text colour for ${n}"><input type="color" data-f="color" value="${isHex(s.color) ? s.color : '#ffffff'}" aria-label="Text colour for ${n}"></label></td>
        <td><label class="chk"><input type="checkbox" data-f="useBg" ${isHex(s.bg) ? 'checked' : ''} aria-label="Highlight ${n} rows"><input type="color" data-f="bg" value="${isHex(s.bg) ? s.bg : '#f5a524'}" aria-label="Highlight colour for ${n}"></label></td>
        <td><input type="checkbox" data-f="bold" ${s.bold ? 'checked' : ''} aria-label="Bold ${n}"></td></tr>`; }).join('')}</tbody></table>
    <table class="log look-prev" aria-label="Preview"><tbody>${SEVORD.map((k) => { const n = SEV[k]; return `<tr class="sev-${k}"><td class="sev"><i></i></td><td class="muted">12:00:0${k % 10}</td><td><a href="#" onclick="return false">sw-core-1</a></td><td><span class="sevname">${n}</span></td><td class="msg">Sample ${n.toLowerCase()} message</td></tr>`; }).join('')}</tbody></table>
    <div class="toolbar" style="margin:0"><button data-lka="suggest">Use suggested colours</button><button data-lka="reset">Reset to default</button></div>`;
  };
  const changed = () => { applyLook(); savePrefs(); };
  box.addEventListener('input', (e) => {
    const k = e.target.dataset.lk, tr = e.target.closest('tr[data-k]');
    if (k) { const v = e.target.value; if (k === 'size') { if (v === '' || +v < 9 || +v > 28) return; look().size = Math.round(+v); } else look()[k] = v; return changed(); }
    if (!tr || !e.target.dataset.f) return;
    const sev = (look().sev ||= {}), s = (sev[tr.dataset.k] ||= {}), q = (n) => $(`[data-f="${n}"]`, tr);
    if (q('useColor').checked) s.color = q('color').value; else delete s.color;
    if (q('useBg').checked) s.bg = q('bg').value; else delete s.bg;
    if (q('bold').checked) s.bold = true; else delete s.bold;
    if (!Object.keys(s).length) delete sev[tr.dataset.k];
    changed();
  });
  box.addEventListener('click', (e) => {
    const a = e.target.dataset.lka; if (!a) return;
    if (a === 'reset') delete S.prefs.look; else look().sev = structuredClone(SUGGESTED), (look().strength = 'medium');
    changed(); render();
  });
  render();
}
function openLookPopover(anchor) {
  if ($('.popover')) { closePopovers(); return; }
  const pop = document.createElement('div'); pop.className = 'popover wide'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Log appearance');
  pop.innerHTML = '<div class="pop-title">Log appearance</div><div id="lookBox"></div><div class="toolbar" style="margin:10px 0 0"><span class="spacer"></span><button class="primary" id="lookDone">Done</button></div>';
  document.body.appendChild(pop); lookEditor($('#lookBox', pop)); $('#lookDone', pop).onclick = closePopovers;
  const r = anchor.getBoundingClientRect(); pop.style.top = (r.bottom + 6) + 'px'; pop.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  setTimeout(() => document.addEventListener('mousedown', function away(e) { if (!pop.isConnected) return document.removeEventListener('mousedown', away); if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); document.removeEventListener('mousedown', away); } }), 0);
}

// ---------- saved views: a named combination of time range, filters, columns, sort and grouping --------------------------------
function openViewsPopover(anchor) {
  if ($('.popover')) { closePopovers(); return; }
  const pop = document.createElement('div'); pop.className = 'popover'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Saved views');
  const list = () => S.prefs.views || [];
  const describe = (v) => [(RANGES.find((r) => r[0] === v.range) || [, 'Last hour'])[1], sevSetOf(normFilter(v.filter).sevs).length ? sevLabel(normFilter(v.filter).sevs) : '', v.filter.host, v.filter.app, v.filter.text].filter(Boolean).join(' · ');
  const render = () => {
    pop.innerHTML = '<div class="pop-title">Saved views</div>' + (list().length ? list().map((v) => `<div class="pop-row" data-id="${esc(v.id)}"><button class="ghost" data-apply style="flex:1;text-align:left;padding:4px 6px"><b>${esc(v.name)}</b><br><span class="muted" style="font-size:12px">${esc(describe(v))}</span></button><button data-upd title="Replace this view with what is on screen now">Update</button><button data-del class="danger" aria-label="Delete view ${esc(v.name)}">✕</button></div>`).join('')
      : '<p class="muted" style="margin:4px 0 8px">No saved views yet. Set the time range, filters, columns and sorting you want, then save them here.</p>') +
      '<div class="toolbar" style="margin:12px 0 0"><input type="text" id="vName" placeholder="Name for the current view" maxlength="60" style="flex:1;min-width:0"><button class="primary" id="vSave">Save</button></div>';
  };
  const snapshot = (name, id) => ({ id: id || 'v' + Date.now().toString(36), name, range: ['custom'].includes(S.range) ? '86400000' : S.range, filter: normFilter(S.filter), cols: visibleCols('logs'), sort: S.prefs.sort || null, group: S.prefs.group || 'off' });
  const commit = () => { savePrefs(); render(); };
  pop.addEventListener('click', (e) => {
    const row = e.target.closest('.pop-row'), v = row && list().find((x) => x.id === row.dataset.id);
    if (e.target.id === 'vSave') { const n = $('#vName', pop).value.trim(); if (!n) return toast('Give the view a name first', true); if (list().length >= 40) return toast('You can keep up to 40 views', true); S.prefs.views = [...list(), snapshot(n)]; return commit(); }
    if (!v) return;
    if (e.target.closest('[data-del]')) { S.prefs.views = list().filter((x) => x.id !== v.id); return commit(); }
    if (e.target.closest('[data-upd]')) { S.prefs.views = list().map((x) => (x.id === v.id ? snapshot(v.name, v.id) : x)); toast(`View "${v.name}" updated`); return commit(); }
    if (e.target.closest('[data-apply]')) {
      S.range = RANGES.some((r) => r[0] === v.range) ? v.range : '3600000'; S.filter = normFilter(v.filter);
      if (v.cols?.length) S.prefs.columns = { ...(S.prefs.columns || {}), logs: v.cols.map((id) => ({ id, visible: true })) };
      if (v.sort) S.prefs.sort = v.sort; else delete S.prefs.sort;
      S.prefs.group = v.group || 'off'; savePrefs(); closePopovers(); route(); toast(`View "${v.name}" applied`);
    }
  });
  render(); document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect(); pop.style.top = (r.bottom + 6) + 'px'; pop.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  setTimeout(() => document.addEventListener('mousedown', function away(e) { if (!pop.isConnected) return document.removeEventListener('mousedown', away); if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); document.removeEventListener('mousedown', away); } }), 0);
}

// ---------- detail drawer ---------------------------------------------------------------------------------------
/** detail window of a trap: every column of the trap view with its value (the message and the original packet follow unchanged) */
function tvFields(m) {
  const v = activeTrapView(); if (!v || !v.cols.length || (m.source !== 'snmp' && !vbOf(m))) return '';
  const rows = [...(v.std === false ? [] : [['Date', dateOf(m.ts)], ['Time', timeOf(m.ts, false)], ['Device', m.host], ['Severity', SEV[m.severity]]]), ...v.cols.map((c) => [c.label, cellOf(m, c)])];
  return rows.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${val === '' || val == null ? '<span class="muted">—</span>' : esc(val)}</dd>`).join('');
}
async function openDrawer(id, fallback) {
  const d = $('#drawer'); d.hidden = false; d.innerHTML = '<p class="muted">Loading…</p>';
  let m = fallback; let raw = '';
  try { const r = await api('/api/log/' + id); m = { ...fallback, ...r }; raw = r.raw; } catch { /* use what we have */ }
  if (!m) { d.innerHTML = '<p class="muted">Message not found.</p>'; return; }
  const tags = Array.isArray(m.tags) ? m.tags : String(m.tags || '').split(',').filter(Boolean);
  d.innerHTML = `<div class="page-head"><h3 style="margin:0">Message ${m.id}</h3><span class="spacer"></span><button id="dClose">Close</button></div>
    <dl class="kv">${tvFields(m) || `<dt>Received</dt><dd>${dateOf(m.ts)} ${timeOf(m.ts)}</dd>
    <dt>Device clock</dt><dd>${m.devTs ? dateOf(m.devTs) + ' ' + timeOf(m.devTs, false) : '<span class="muted">not provided</span>'}</dd>
    <dt>Device</dt><dd>${esc(m.host)} <span class="muted">(${esc(m.srcIp)})</span></dd>
    <dt>Severity</dt><dd><span class="sevname sev-${m.severity}">${SEV[m.severity]}</span> (${m.severity})</dd>
    <dt>Facility</dt><dd>${esc((S.info?.facilities || [])[m.facility] ?? m.facility)}</dd>
    <dt>Process</dt><dd>${esc(m.app) || '<span class="muted">—</span>'}${m.pid ? ' [' + esc(m.pid) + ']' : ''}</dd>
    `}${tags.length ? `<dt>Tags</dt><dd>${tags.map((t) => `<span class="tag" style="margin:0 6px 0 0">${esc(t)}</span>`).join('')}</dd>` : ''}</dl>
    <h2>Message</h2><pre class="raw">${esc(m.message)}</pre>
    ${raw ? `<h2>Original packet</h2><pre class="raw">${esc(raw)}</pre>` : ''}
    <div class="toolbar"><button id="dHost">Show only this device</button><button id="dRule">Create rule from message</button><button id="dCopy">Copy message</button></div>`;
  $('#dClose').onclick = () => { d.hidden = true; };
  $('#dCopy').onclick = () => { navigator.clipboard?.writeText(m.message).then(() => toast('Copied')); };
  $('#dHost').onclick = () => { S.cur = m.source === 'snmp' ? 'snmp' : 'syslog'; S.filter.host = m.host; d.hidden = true; const to = m.source === 'snmp' ? '#traps' : '#logs'; location.hash = to; if (S.view === to.slice(1)) route(); };
  $('#dRule').onclick = () => { sessionStorage.setItem('sp.ruleSeed', JSON.stringify({ host: m.host, app: m.app, text: m.message.slice(0, 60), source: m.source === 'snmp' ? 'snmp' : 'syslog', trap: m.msgid || '' })); d.hidden = true; location.hash = '#rules'; };
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#drawer').hidden = true; });

// ---------- status bar & banner -----------------------------------------------------------------------------------------------
// ---------- top-bar clock: the server's time (from your NTP server when set up), not this browser PC's own clock -------------------------------
const clockState = { base: 0, at: 0, info: null };
function syncClock(i) { if (i && i.now) { clockState.base = i.now; clockState.at = performance.now(); clockState.info = i.clock || null; } }
function drawClock() {
  const el = $('#clock'), wb = $('#wallBar'); if (!el && !wb) return; if (!clockState.base) { clockState.base = Date.now(); clockState.at = performance.now(); }   // before the server time arrives the PC's own clock is shown
  const c = clockState.info || {}, ms = clockState.base + (performance.now() - clockState.at), d = new Date(ms), zone = c.zone || undefined;
  let date, time, tz;
  try {
    date = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: zone }).format(d);
    time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: zone }).format(d);
    tz = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short', timeZone: zone }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value || '';
  } catch { date = d.toDateString(); time = d.toTimeString().slice(0, 8); tz = ''; }
  if (wb) { wb.querySelector('.wdate').textContent = date; wb.querySelector('.wtime').textContent = time; }
  if (!el) return;
  const state = c.ok ? 'ok' : c.enabled ? 'warn' : 'off';
  const tip = c.ok ? `Synchronised with NTP server ${c.server || ''} (stratum ${c.stratum}). This PC's clock differs by ${c.offsetMs} ms. Last sync ${new Date(c.lastSync).toLocaleTimeString()}.`
    : c.enabled ? `The NTP server did not answer${c.error ? ': ' + c.error : ''}. Showing the NetEventPro computer's own clock.` : "Showing the NetEventPro computer's own clock. Set up an NTP server in Settings → Time.";
  const sig = `${date}|${state}|${tip}`;
  if (el.dataset.sig !== sig) { el.dataset.sig = sig; el.title = tip; el.innerHTML = `<span class="cdate">${esc(date)}</span><span class="ctime"></span><span class="dot ${state === 'ok' ? 'ok' : state === 'warn' ? 'warn' : 'off'}"></span>`; }
  el.querySelector('.ctime').textContent = time;
}

function renderStatus() {
  const i = S.info; if (!i) return; const st = S.stats; const l = i.listeners;
  const item = (name, s) => `<span class="item"><span class="dot ${s.running ? 'ok' : 'bad'}"></span>${name} ${s.port ?? ''} <b>${s.running ? 'listening' : 'stopped'}</b></span>`;
  $('#statusBar').innerHTML = (i.config.udpEnabled ? item('UDP', l.udp) : '') + (i.config.tcpEnabled ? item('TCP', l.tcp) : '') + (i.config.tlsSyslogEnabled ? item('TLS', l.tls) : '') +
    (i.config.snmp?.enabled !== false && l.snmp ? item('SNMP trap', l.snmp) : '') +
    (st?.health ? `<a class="item" href="#health" title="System health: disk space, database, listeners, mail. Click to open the System health page."><span class="dot ${st.health.bad ? 'bad' : st.health.warn ? 'warn' : 'ok'}"></span>Health <b>${st.health.bad ? st.health.bad + ' problem' + (st.health.bad > 1 ? 's' : '') : st.health.warn ? st.health.warn + ' warning' + (st.health.warn > 1 ? 's' : '') : 'OK'}</b></a>` : '') +
    `<span class="item"><span class="dot ${S.streamOk ? 'ok' : 'bad'}"></span>Live feed <b>${S.streamOk ? 'connected' : 'reconnecting…'}</b></span>`;
  $('#verText').textContent = `v${i.version}`;
  const errs = [l.udp.error, l.tcp.error, i.webWarning].filter(Boolean); const b = $('#banner');
  b.hidden = !errs.length && !S.restartNeeded;
  b.innerHTML = esc(errs.join('  ')) + (S.restartNeeded ? ' Web settings changed — <button id="restartNow">Restart service now</button>' : '');
  $('#restartNow')?.addEventListener('click', restartService);
  $('#navSilent').textContent = st && st.silentDevices ? st.silentDevices : '';
  const hh = st?.health, nh = $('#navHealth'); if (nh) { const n = hh ? hh.bad + hh.warn : 0; nh.textContent = n || ''; nh.className = 'badge ' + (hh?.bad ? 'bad' : 'warn'); }
}
async function restartService() {
  if (!await askConfirm('Restart NetEventPro? The dashboard will reconnect in a few seconds. Messages sent during the restart may be lost.')) return;
  try { await api('/api/restart', { method: 'POST' }); } catch { /* connection drops */ }
  toast('Restarting…'); S.restartNeeded = false; setTimeout(() => location.reload(), 4000);
}
async function pollStats() {
  try { S.stats = await api('/api/stats'); S.info = { ...S.info, ...(await api('/api/state')) }; syncClock(S.info); drawClock(); renderStatus(); S.onStats?.(S.stats); if (typeof setBadge === 'function') setBadge(S.stats.alarms); } catch { /* server restarting */ }
}

// ============================ VIEWS ==========================================================================
const views = {};

// ---------- Logs (live stream + stored history in one view) -------------------------------------------------------------------

/** one calendar day (local time, 00:00 to 23:59:59.999): the default window of Logs, Traps and Alarm history (1.41) */
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayBounds = (key) => { const [y, m, d] = String(key || dayKey()).split('-').map(Number); const a = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0); return { from: a.getTime(), to: new Date(y, (m || 1) - 1, (d || 1) + 1, 0, 0, 0, 0).getTime() - 1 }; };
const dayShift = (key, n) => { const [y, m, d] = String(key).split('-').map(Number); return dayKey(new Date(y, m - 1, d + n)); };
const dayLabel = (key) => { const { from } = dayBounds(key); return new Date(from).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); };
/** the previous / next day buttons and the date picker (shared by Logs, Traps and Alarm history) */
const dayNavHtml = (id, key) => `<span class="daynav" id="${id}" hidden><button type="button" data-day="-1" title="Previous day" aria-label="Previous day">◀</button><input type="date" data-dayin value="${esc(key)}" max="${esc(dayKey())}" aria-label="Day"><button type="button" data-day="1" title="Next day" aria-label="Next day">▶</button><button type="button" data-day="today" title="Back to today">Today</button></span>`;
const RANGES = [['day', 'One day (00:00–23:59)'], ['900000', 'Last 15 minutes'], ['3600000', 'Last hour'], ['21600000', 'Last 6 hours'], ['86400000', 'Last 24 hours'], ['604800000', 'Last 7 days'], ['2592000000', 'Last 30 days'], ['0', 'Everything stored'], ['custom', 'Custom range…']];

// ---------- small line icons for buttons (inline SVG, drawn with the text colour) --------------------------------------------------------
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>', play: '<path d="m7 4 13 8-13 8z"/>',
  views: '<path d="M6 3h12v18l-6-4-6 4z"/>', columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
  look: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2-.6-1.2.2-2.5 1.6-2.5H17a4 4 0 0 0 4-4c0-5-4-9.5-9-9.5z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  download: '<path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>', more: '<path d="M12 5v14"/><path d="m6 13 6 6 6-6"/>',
  check: '<path d="m5 12 5 5 9-10"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>', filter: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>', file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>'
};
const ico = (n) => `<svg class="ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;
const ibtn = (id, icon, label, title, cls = '') => `<button id="${id}" class="ib ${cls}" title="${esc(title || label)}" aria-label="${esc(label)}">${ico(icon)}<span class="bt">${esc(label)}</span></button>`;
/** a small menu under a button: items = [{ icon, label, fn }] */
function menuPopover(anchor, items) {
  if ($('.popover')) { closePopovers(); return; }
  const pop = document.createElement('div'); pop.className = 'popover menu'; pop.setAttribute('role', 'menu');
  pop.innerHTML = items.map((it, i) => `<button role="menuitem" data-i="${i}" class="ib ghost">${ico(it.icon)}<span>${esc(it.label)}</span></button>`).join('');
  pop.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (!b) return; closePopovers(); items[+b.dataset.i].fn(); });
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect(); pop.style.top = (r.bottom + 6) + 'px'; pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px';
  setTimeout(() => document.addEventListener('mousedown', function away(e) { if (!pop.isConnected) return document.removeEventListener('mousedown', away); if (!pop.contains(e.target) && !anchor.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', away); } }), 0);
}

function logsView(el, main, SRC) {          // the same window for syslog messages (SRC 'syslog') and for SNMP traps (SRC 'snmp')
  const VIEW = SRC === 'snmp' ? 'traps' : 'logs', isSyslog = SRC !== 'snmp';
  S.cur = SRC; main.classList.add('fill'); if (isSyslog) { S.newCount = 0; $('#navLiveCount').textContent = ''; } else { S.newTraps = 0; $('#navTrapCount').textContent = ''; }
  const seed = JSON.parse(sessionStorage.getItem('sp.search') || '{}'); sessionStorage.removeItem('sp.search');
  if (seed.host !== undefined) { S.filter = normFilter({ host: seed.host, app: seed.app || '', text: seed.text || '' }); S.range = '86400000'; }   // "Logs" button on the Devices page
  if (seed.host === undefined) S.range = 'day';                  // 1.41: Logs and Traps open on today (00:00–23:59); the other ranges stay in the list
  if (!S.range || S.range === 'live' || !RANGES.some((r) => r[0] === S.range)) S.range = 'day';
  let day = dayKey();
  S.filter = normFilter(S.filter);
  const f = S.filter;
  el.innerHTML = `<div class="page-head"><h1>${isSyslog ? 'Logs' : 'SNMP traps'}</h1><span class="muted" id="resInfo"></span></div>
  <div class="toolbar filterbar">
    <select id="qRange" aria-label="Time range">${RANGES.map(([v, l]) => `<option value="${v}" ${S.range === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    ${dayNavHtml('dayNav', day)}
    <span id="customRange" hidden><input type="datetime-local" id="qFrom" aria-label="From"> to <input type="datetime-local" id="qTo" aria-label="To (leave empty for now)"></span>
    <button id="fSev" aria-haspopup="dialog" title="Choose one or more severities"></button>
    <input type="text" id="fHost" class="w-md" placeholder="Device or IP" value="${esc(f.host)}" list="hostList" title="Device name or IP address"><datalist id="hostList"></datalist>
    <input type="text" id="fApp" class="w-md" placeholder="Process" value="${esc(f.app)}">
    <input type="search" id="fText" class="grow" placeholder='${isSyslog ? "Search text" : "Search trap name, value or text"} · -word excludes · "exact phrase" · tag:name' value="${esc(f.text)}">
    <button class="primary ib" id="qGo" title="Search">${ico('search')}<span class="bt">Search</span></button>${ibtn('bClear', 'reset', 'Reset', 'Reset all filters')}
  </div>
  <div class="toolbar actionbar">
    ${ibtn('bPause', 'pause', 'Pause', 'Stop new messages from being added while you read')}
    <button id="qMore" class="ib" hidden>${ico('more')}<span class="bt">Load 500 more</span></button><span class="spacer"></span>
    <label class="repeat" title="Combine repeated messages into one line with a count">${ico('layers')}<select id="bGroup" aria-label="Group repeated messages"><option value="off">Repeats: show all</option><option value="same">Repeats: group identical</option><option value="similar">Repeats: group, ignore numbers</option></select></label>
    ${isSyslog ? '' : `${(S.prefs.trapViews || []).length === 1 ? '' : `<label class="repeat" title="Show the columns that fit one kind of trap. Each trap type has different values, so you choose them yourself.">${ico('columns')}<select id="tView" aria-label="Trap column view"><option value="">View: all traps</option>${(S.prefs.trapViews || []).map((v) => `<option value="${esc(v.id)}" ${(S.trapView === undefined ? S.prefs.trapViewDefault : S.trapView) === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>`}<button id="tViewEdit" class="ib" title="Create or change trap column views (Settings)">${ico('look')}<span class="bt">${(S.prefs.trapViews || []).length === 1 ? 'Trap columns' : 'Trap views'}</span></button>`}<span class="btngroup">${isSyslog ? ibtn('bViews', 'views', 'Views', 'Saved views') : ''}${ibtn('bCols', 'columns', 'Columns', 'Choose and order columns')}${ibtn('bLook', 'look', 'Appearance', 'Font, size and colours')}</span>
    ${can('delete') ? ibtn('bSelect', 'check', 'Select', 'Tick messages to delete them') + `<button id="bDelete" class="ib danger" hidden>${ico('x')}<span class="bt">Delete…</span></button>` : ''}
    ${ibtn('bExport', 'download', 'Export', 'Download the matching messages')}
  </div>
  <div class="logwrap" id="logwrap"><table class="log" id="lt"><colgroup id="cg"></colgroup><thead id="th"></thead><tbody id="tb"></tbody></table><div id="emptyMsg"></div></div>`;
  const tb = $('#tb'); const MAXDOM = 5000, MAXROWS = 20000;
  const tViews = () => (isSyslog ? [] : S.prefs.trapViews || []), trapSel = () => (tViews().length === 1 ? tViews()[0].id : S.trapView === undefined ? S.prefs.trapViewDefault || '' : S.trapView), tView = () => tViews().find((v) => v.id === trapSel()) || null;
  const colsNow = () => { const v = tView(); return v && v.cols.length ? trapViewCols(v) : visibleCols(VIEW); };
  let selOn = false; const sel = new Set(); let flt = makeFilter(f), terms = termsOf(f.text), shown = 0, cols = colsNow(), rows = [], lastQ = {}, sortTimer, seen = new Set(), loaded = false;
  const setSevLabel = () => { const n = sevSetOf(S.filter.sevs).length; $('#fSev').textContent = sevLabel(S.filter.sevs) + ' ▾'; $('#fSev').classList.toggle('on', n > 0 && n < 10); };
  const fixedEnd = () => (S.range === 'custom' && !!$('#qTo').value) || (S.range === 'day' && day !== dayKey());          // a range that ends in the past gets no new messages
  const windowStart = () => (S.range === 'day' ? dayBounds(day).from : S.range === 'custom' || S.range === '0' ? 0 : Date.now() - +S.range);
  const windowEnd = () => (S.range === 'day' && day !== dayKey() ? dayBounds(day).to : 0);
  const source = () => { const t0 = windowStart(), t1 = windowEnd(), v = tView(); let l = t0 ? rows.filter((m) => m.ts >= t0) : rows; if (t1) l = l.filter((m) => m.ts <= t1); return v && v.match ? l.filter((m) => trapMatches(m, v.match)) : l; };   // a "last hour" window keeps sliding
  const groupMode = () => S.prefs.group || 'off';
  let srcCount = 0;
  const grouped = (list) => {          // one line per distinct message, with how many times it came and when
    const mode = groupMode(); srcCount = list.length; if (mode === 'off') return list;
    const map = new Map();
    for (const m of list) {
      const k = `${m.host}\u0001${m.app}\u0001${m.severity}\u0001${mode === 'similar' ? m.message.replace(/\d+/g, '#') : m.message}`, g = map.get(k);
      if (!g) map.set(k, { ...m, _n: 1, _first: m.ts });
      else { const n = g._n + 1, first = Math.min(g._first, m.ts); if (m.id > g.id) Object.assign(g, m); g._n = n; g._first = first; }
    }
    return [...map.values()];
  };
  const ordered = (list0) => {
    const list = grouped(list0), sd = S.prefs.sort; const key = sd && cols.includes(sd.col) && SORTERS[sd.col];
    if (!key) return groupMode() !== 'off' ? list.sort((a, b) => b.id - a.id) : list;   // default: newest first
    const dir = sd.dir === 'asc' ? 1 : -1;
    return list.map((m) => [key(m), m]).sort((a, b) => (a[0] < b[0] ? -dir : a[0] > b[0] ? dir : b[1].id - a[1].id)).map((x) => x[1]);
  };
  const info = () => {
    const g = groupMode() !== 'off' ? `${fmtN(shown)} groups from ${fmtN(srcCount)} messages` : '';
    $('#resInfo').textContent = loaded ? `${fmtN(rows.length)}${lastQ.total > rows.length ? ' of ' + fmtN(lastQ.total) + (lastQ.capped ? '+' : '') : ''} matching messages` + (g ? ` · ${g}` : '') + (S.paused ? ` · paused (${fmtN(S.pauseBuf.length)} waiting)` : fixedEnd() ? '' : ' · live') : 'Loading…';
    $('#emptyMsg').innerHTML = shown || !loaded ? '' : `<div class="empty"><b>No matching messages</b>${fixedEnd() ? 'Widen the time range or loosen the filters.' : 'Nothing in this time range yet. New matching messages will appear here as they arrive.'}</div>`;
  };
  const render = () => {
    const list = ordered(source()); shown = list.length; tb.innerHTML = list.slice(0, MAXDOM).map((m) => rowHtml(m, terms, cols, '', selOn ? sel : null)).join(''); info();
    const hosts = [...new Set(rows.map((m) => m.host).concat(S.live.filter((m) => (m.source || 'syslog') === SRC).map((m) => m.host)))].sort().slice(0, 300); $('#hostList').innerHTML = hosts.map((h) => `<option value="${esc(h)}">`).join('');
  };
  const widthOf = (id) => S.prefs.widths?.[id] ?? DEFAULT_W[id] ?? TV_DEFS[id]?.w;
  const fitTable = () => { $('#lt').style.minWidth = (5 + (selOn ? 30 : 0) + cols.reduce((n, id) => n + (widthOf(id) || 320), 0)) + 'px'; };
  const drawHead = () => {
    const sd = S.prefs.sort;
    $('#th').innerHTML = '<tr><th class="sevc"></th>' + (selOn ? '<th class="selc"><input type="checkbox" id="selAll" aria-label="Select all shown"></th>' : '') + cols.map((id) => { const on = sd && sd.col === id;
      return `<th data-col="${id}" tabindex="0" aria-sort="${on ? (sd.dir === 'asc' ? 'ascending' : 'descending') : 'none'}" title="Click to sort"><span class="th-t">${defOf(id).th}</span><span class="arr">${on ? (sd.dir === 'asc' ? '▲' : '▼') : ''}</span><span class="rz" data-col="${id}" title="Drag to resize · double-click to reset"></span></th>`; }).join('') + '</tr>';
    $('#cg').innerHTML = '<col style="width:5px">' + (selOn ? '<col style="width:30px">' : '') + cols.map((id) => `<col data-col="${id}"${widthOf(id) ? ` style="width:${widthOf(id)}px"` : ''}>`).join('');
    fitTable();
  };
  const applyCols = () => { cols = colsNow(); $('#lt').classList.toggle('nowrap', !wrapOn(VIEW)); drawHead(); render(); };
  const setMode = () => {
    $('#qMore').hidden = !(rows.length < (lastQ.total || 0) && rows.length);
    $('#customRange').hidden = S.range !== 'custom'; $('#dayNav').hidden = S.range !== 'day';
    { const inp = $('#dayNav [data-dayin]'); inp.value = day; $('#dayNav [data-day="1"]').disabled = day >= dayKey(); $('#dayNav [data-day="today"]').disabled = day === dayKey(); }
  };
  const readFilters = () => { S.filter = { sevs: S.filter.sevs || '', host: $('#fHost').value.trim(), app: $('#fApp').value.trim(), text: $('#fText').value.trim() }; flt = makeFilter(S.filter); terms = termsOf(S.filter.text); };
  const params = () => {
    const q = { source: SRC }; const r = S.range;
    if (r === 'day') { const b = dayBounds(day); q.from = b.from; if (day !== dayKey()) q.to = b.to; } else if (r === 'custom') { if ($('#qFrom').value) q.from = new Date($('#qFrom').value).getTime(); if ($('#qTo').value) q.to = new Date($('#qTo').value).getTime(); } else if (r !== '0') q.from = Date.now() - +r;
    const g = S.filter, n = sevSetOf(g.sevs).length; if (n > 0 && n < 10) q.sevs = g.sevs; if (g.host) q.host = g.host; if (g.app) q.app = g.app; if (g.text) q.text = g.text; const tv = tView(); if (tv && tv.match && !/^\/.+\/[a-z]*$/.test(tv.match)) q.trap = tv.match; return q;
  };
  let runId = 0;
  const run = async (more) => {
    readFilters(); const q = more ? { ...lastQ, beforeId: rows[rows.length - 1].id } : params(); if (!more) lastQ = q;
    const my = ++runId; $('#qGo').disabled = true;
    try {
      const { total: _t, ...qq } = q;
      const r = await api('/api/logs?' + new URLSearchParams({ ...qq, limit: 500, ...(more ? {} : { countTotal: 1 }) }));
      if (my !== runId) return;      // a newer search was started meanwhile
      if (more) rows = rows.concat(r.rows.filter((x) => !seen.has(x.id))); else { rows = r.rows; lastQ.total = r.total; lastQ.capped = !!r.totalCapped; }
      seen = new Set(rows.map((x) => x.id)); loaded = true;
      render(); setMode();
    } catch (e) { toast(e.message, true); } finally { if (my === runId) $('#qGo').disabled = false; }
  };
  const add = (msgs) => {                // new messages stream into the window that is on screen
    if (!msgs) { clearTimeout(sortTimer); sortTimer = setTimeout(() => run(false), 300); return; }   // the live feed reconnected: reload so nothing is missed
    if (!loaded || fixedEnd()) return;
    if (S.paused) { S.pauseBuf.push(...msgs); return info(); }
    const tv0 = tView(); const ok = msgs.filter((m) => !seen.has(m.id) && (m.source || 'syslog') === SRC && flt(m) && (!tv0 || !tv0.match || trapMatches(m, tv0.match))); if (!ok.length) return;
    for (const m of ok) seen.add(m.id);
    rows = ok.slice().reverse().concat(rows); if (rows.length > MAXROWS) rows.length = MAXROWS;
    if (lastQ.total !== undefined) lastQ.total += ok.length;
    if (groupMode() !== 'off' || (S.prefs.sort && cols.includes(S.prefs.sort.col))) { clearTimeout(sortTimer); sortTimer = setTimeout(() => { render(); setMode(); }, 150); return; }   // sorted view: re-sort in one go, not per message
    const wrap = $('#logwrap'); const atTop = wrap.scrollTop < 40; const html = ok.slice(-500).reverse().map((m) => rowHtml(m, terms, cols, 'new', selOn ? sel : null)).join('');
    const h0 = wrap.scrollHeight; tb.insertAdjacentHTML('afterbegin', html); shown += ok.length;
    while (tb.rows.length > MAXDOM) tb.deleteRow(-1);
    if (!atTop) wrap.scrollTop += wrap.scrollHeight - h0; // keep reading position stable
    info(); setMode();
  };
  let tmr; const deb = () => { clearTimeout(tmr); tmr = setTimeout(() => run(false), 350); };
  $('#qRange').onchange = () => { S.range = $('#qRange').value; if (S.range === 'day') day = dayKey(); setMode(); if (S.range !== 'custom') run(false); };
  const goDay = (k) => { day = k > dayKey() ? dayKey() : k; setMode(); run(false); };
  $('#dayNav').addEventListener('click', (e) => { const b = e.target.closest('[data-day]'); if (!b) return; const v = b.dataset.day; goDay(v === 'today' ? dayKey() : dayShift(day, +v)); });
  $('#dayNav [data-dayin]').addEventListener('change', (e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) goDay(e.target.value); });
  $('#fSev').onclick = () => sevPopover($('#fSev'), S.filter.sevs, (v) => { S.filter.sevs = v; setSevLabel(); deb(); });
  ['fHost', 'fApp', 'fText'].forEach((id) => ($('#' + id).oninput = deb));
  el.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(tmr); run(false); } }));
  $('#qGo').onclick = () => run(false); $('#qMore').onclick = () => run(true);
  $('#bClear').onclick = () => { S.filter = normFilter({}); setSevLabel(); $('#fHost').value = $('#fApp').value = $('#fText').value = ''; run(false); };
  $('#bGroup').value = groupMode(); $('#bGroup').onchange = () => { S.prefs.group = $('#bGroup').value; savePrefs(); render(); };
  if (isSyslog) $('#bViews').onclick = () => { readFilters(); openViewsPopover($('#bViews')); };
  $('#bCols').onclick = () => { if (tView()?.cols.length) return openViewColumns(structuredClone(tView()), $('#bCols'), () => { applyCols(); }); openColumnPicker(VIEW, $('#bCols'), applyCols); };
  if (!isSyslog) {
    if ($('#tView')) $('#tView').onchange = () => { S.trapView = $('#tView').value; applyCols(); run(false); };
    $('#tViewEdit').onclick = () => { S.jump = 'sec-trapviews'; location.hash = '#settings'; };
  }
  $('#bLook').onclick = () => openLookPopover($('#bLook'));
  const setPause = (p) => { S.paused = p; $('#bPause').innerHTML = ico(p ? 'play' : 'pause') + `<span class="bt">${p ? 'Resume' : 'Pause'}</span>`; $('#bPause').classList.toggle('on', p); if (!p && S.pauseBuf.length) { const b = S.pauseBuf; S.pauseBuf = []; add(b); } info(); };
  $('#bPause').onclick = () => setPause(!S.paused);
  const exp = (fmt) => { readFilters(); const q = params(); location.href = '/api/export?' + new URLSearchParams({ ...q, format: fmt, max: 500000, ...(!isSyslog && tView()?.cols.length ? { view: tView().id } : {}) }); toast('Export started — it downloads as it is generated'); };
  $('#bExport').onclick = () => menuPopover($('#bExport'), [{ icon: 'file', label: 'Export as CSV', fn: () => exp('csv') }, { icon: 'file', label: 'Export as JSON', fn: () => exp('json') }]);
  const selInfo = () => { const b = $('#bDelete'); if (b) { b.hidden = !selOn; $('.bt', b).textContent = sel.size ? `Delete… (${fmtN(sel.size)})` : 'Delete…'; } };
  if (can('delete')) {
    $('#bSelect').onclick = () => { selOn = !selOn; sel.clear(); $('#bSelect').classList.toggle('on', selOn); drawHead(); render(); selInfo(); };
    tb.addEventListener('change', (e) => { const id = e.target.dataset.sel; if (id === undefined) return; if (e.target.checked) sel.add(+id); else sel.delete(+id); selInfo(); });
    $('#th').addEventListener('change', (e) => { if (e.target.id !== 'selAll') return; $$('[data-sel]', tb).forEach((c) => { c.checked = e.target.checked; if (e.target.checked) sel.add(+c.dataset.sel); else sel.delete(+c.dataset.sel); }); selInfo(); });
    $('#bDelete').onclick = () => menuPopover($('#bDelete'), [
      { icon: 'x', label: sel.size ? `Delete the ${fmtN(sel.size)} ticked message(s)` : 'Delete ticked messages (tick some first)', fn: async () => {
        if (!sel.size) return toast('Tick the messages to delete first', true);
        if (!await askConfirm(`Delete ${fmtN(sel.size)} ${isSyslog ? 'syslog message' : 'SNMP trap'}(s) for good? This cannot be undone.`, 'Delete')) return;
        try { const r = await api('/api/logs/delete', { method: 'POST', body: { ids: [...sel] } }); toast(`${fmtN(r.deleted)} deleted`); sel.clear(); await run(false); selInfo(); } catch (er) { toast(er.message, true); } } },
      { icon: 'x', label: 'Delete everything that matches the search…', fn: async () => {
        readFilters(); const q = params(); const n = lastQ.total ?? rows.length;
        const t = await askText(`This deletes ALL ${fmtN(n)} ${isSyslog ? 'syslog messages' : 'SNMP traps'} matching the time range and filters shown now, including ones not loaded on screen. Type DELETE to confirm.`, '');
        if (t === null) return; if (t.trim() !== 'DELETE') return toast('Not deleted: you did not type DELETE', true);
        try { const r = await api('/api/logs/delete', { method: 'POST', body: { matching: true, confirm: 'DELETE', q } }); toast(`${fmtN(r.deleted)} deleted`); sel.clear(); await run(false); selInfo(); } catch (er) { toast(er.message, true); } } }
    ]);
  }
  tb.addEventListener('click', (e) => {
    if (e.target.closest('.selc')) return;
    const h = e.target.closest('.hostlink'); if (h) { e.preventDefault(); $('#fHost').value = h.dataset.host; run(false); return; }
    const tr = e.target.closest('tr'); if (tr) openDrawer(+tr.dataset.id, rows.find((m) => m.id === +tr.dataset.id));
  });
  // click a heading to sort: ascending, then descending, then back to the default order
  let resizedAt = 0;
  const sortBy = (id) => {
    const sd = S.prefs.sort;
    if (!sd || sd.col !== id) S.prefs.sort = { col: id, dir: 'asc' }; else if (sd.dir === 'asc') S.prefs.sort = { col: id, dir: 'desc' }; else delete S.prefs.sort;
    savePrefs(); drawHead(); render();
  };
  $('#th').addEventListener('click', (e) => { if (e.target.closest('.rz') || Date.now() - resizedAt < 250) return; const th = e.target.closest('th[data-col]'); if (th) sortBy(th.dataset.col); });
  $('#th').addEventListener('keydown', (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; const th = e.target.closest('th[data-col]'); if (th) { e.preventDefault(); sortBy(th.dataset.col); } });
  $('#th').addEventListener('dblclick', (e) => { const h = e.target.closest('.rz'); if (!h) return; if (S.prefs.widths) delete S.prefs.widths[h.dataset.col]; savePrefs(); drawHead(); });
  $('#th').addEventListener('mousedown', (e) => {
    const h = e.target.closest('.rz'); if (!h || e.button !== 0) return; e.preventDefault();
    const id = h.dataset.col, col = $(`#cg col[data-col="${id}"]`), x0 = e.clientX, w0 = h.parentElement.getBoundingClientRect().width;
    document.body.classList.add('resizing');
    const move = (ev) => { const w = Math.max(40, Math.min(1200, Math.round(w0 + ev.clientX - x0))); col.style.width = w + 'px'; S.prefs.widths = { ...(S.prefs.widths || {}), [id]: w }; fitTable(); };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.classList.remove('resizing'); resizedAt = Date.now(); savePrefs(); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });
  setPause(S.paused); setMode(); setSevLabel(); applyCols(); listeners.add(add);
  run(false);
  return () => { listeners.delete(add); main.classList.remove('fill'); clearTimeout(tmr); clearTimeout(sortTimer); document.body.classList.remove('resizing'); };
}
views.logs = (el, main) => logsView(el, main, 'syslog');
views.traps = (el, main) => logsView(el, main, 'snmp');

// ---------- Devices ----------------------------------------------------------------------------------------------------------------
const DEV_COLS = [['state', 'State'], ['device', 'Device and display name'], ['vendor', 'Vendor'], ['group', 'Group'], ['sys', 'Syslog count'], ['traps', 'Trap count'], ['last', 'Last heard'], ['alarms', 'Open alarms'], ['mix', 'Severity mix'], ['expect', 'Expect every'], ['actions', 'Buttons']];
const devColList = () => { const saved = S.prefs.columns?.devices; const list = Array.isArray(saved) ? saved.filter((c) => DEV_COLS.some((d) => d[0] === c.id)).map((c) => ({ id: c.id, visible: c.visible !== false })) : []; for (const [id] of DEV_COLS) if (!list.some((c) => c.id === id)) list.push({ id, visible: true }); if (!list.some((c) => c.visible)) list[0].visible = true; return list; };
/** show / hide / re-order the columns of a simple table (Devices) */
function openSimpleColumns(anchor, title, labels, getList, setList, onChange) {
  if ($('.popover')) { closePopovers(); return; }
  const pop = document.createElement('div'); pop.className = 'popover'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', title);
  const render = () => { const list = getList(); pop.innerHTML = `<div class="pop-title">${esc(title)}</div>` + list.map((c, i) => `<div class="pop-row" data-id="${c.id}"><label class="chk"><input type="checkbox" ${c.visible ? 'checked' : ''}> ${esc(labels[c.id])}</label><span class="spacer"></span><button data-mv="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button data-mv="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button></div>`).join('') + '<div class="toolbar" style="margin:10px 0 0"><button id="popReset">Reset to default</button><span class="spacer"></span><button class="primary" id="popDone">Done</button></div>'; };
  const commit = (list) => { setList(list); onChange(); render(); };
  pop.addEventListener('change', (e) => { const row = e.target.closest('.pop-row'); if (row) commit(getList().map((c) => (c.id === row.dataset.id ? { ...c, visible: e.target.checked } : c))); });
  pop.addEventListener('click', (e) => { if (e.target.id === 'popDone') return closePopovers(); if (e.target.id === 'popReset') return commit(null); const b = e.target.closest('button[data-mv]'); if (!b) return; const list = getList(), i = list.findIndex((c) => c.id === b.closest('.pop-row').dataset.id), j = i + +b.dataset.mv; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; commit(list); });
  render(); document.body.appendChild(pop); const r = anchor.getBoundingClientRect(); pop.style.top = (r.bottom + 6) + 'px'; pop.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  setTimeout(() => document.addEventListener('mousedown', function away(e) { if (!pop.isConnected) return document.removeEventListener('mousedown', away); if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', away); } }), 0);
}
views.devices = (el) => {
  el.innerHTML = `<div class="page-head"><h1>Devices</h1><span class="muted" id="devInfo"></span><span class="spacer"></span><button id="devCols" class="ib">${ico('columns')}<span class="bt">Columns</span></button><button id="devCsv" class="ib">${ico('download')}<span class="bt">Export</span></button></div>
    <div class="chips" id="devChips"></div>
    <div class="toolbar filterbar"><input type="search" id="devQ" class="grow" placeholder="Search name, address, vendor, group or note" value="${esc(S.devQ || '')}">
      <select id="devStatus"><option value="">All states</option><option value="ok">Reporting now</option><option value="quiet">Quiet</option><option value="overdue">Overdue</option><option value="alarm">With open alarms</option><option value="muted">Alerts muted</option></select>
      <select id="devSrc"><option value="">Syslog and traps</option><option value="sys">Sends syslog</option><option value="trap">Sends SNMP traps</option></select>
      <select id="devGroup"><option value="">All groups</option></select><select id="devVendor"><option value="">All vendors</option></select></div>
    <div class="panel" style="padding:0;overflow:auto" id="devWrap"></div>
    <p class="muted" style="max-width:900px">A device is added when it first sends a syslog message or a trap. <b>Reporting</b> = heard in the last 15 minutes. <b>Quiet</b> = not heard for a while, which is normal for a device that only speaks when something happens. <b>Overdue</b> = it missed the time you expect it to report: set “Expect every … min” on a device that must report regularly (a UPS heartbeat, an NTP server), or use the global limit in Settings → Storage for devices that normally talk a lot.</p>`;
  let list = [];
  const state = (d) => (d.silent || d.overdue ? 'overdue' : d.ageSec < 900 ? 'ok' : 'quiet');
  const vis = () => {
    const q = $('#devQ').value.trim().toLowerCase(), st = $('#devStatus').value, sr = $('#devSrc').value, g = $('#devGroup').value, v = $('#devVendor').value;
    return list.filter((d) => (!q || [d.host, d.srcIp, d.alias, d.vendor, d.group, d.note].join(' ').toLowerCase().includes(q)) && (!st || (st === 'alarm' ? d.openAlarms > 0 : st === 'muted' ? d.muted : state(d) === st)) && (!sr || (sr === 'sys' ? d.sys > 0 : d.traps > 0)) && (!g || d.group === g) && (!v || d.vendor === v));
  };
  const options = () => {
    for (const [id, key, all] of [['devGroup', 'group', 'All groups'], ['devVendor', 'vendor', 'All vendors']]) { const sel = $('#' + id), cur = sel.value; const vals = [...new Set(list.map((d) => d[key]).filter(Boolean))].sort(); const sig = vals.join('\u0001'); if (sel.dataset.sig === sig) continue; sel.dataset.sig = sig; sel.innerHTML = `<option value="">${all}</option>` + vals.map((x) => `<option>${esc(x)}</option>`).join(''); sel.value = vals.includes(cur) ? cur : ''; }
  };
  let lastHtml = '';
  const draw = (force) => {
    const ae = document.activeElement;
    if (!force && (colDrag || (ae && $('#devWrap').contains(ae) && ['INPUT', 'SELECT'].includes(ae.tagName)))) return;   // do not disturb typing in a cell or a column drag
    const sh = vis(), n = (f) => list.filter(f).length;
    $('#devInfo').textContent = `${sh.length} of ${list.length} devices`;
    $('#devChips').innerHTML = `<span class="chip on"><b>${list.length}</b> devices</span><span class="chip"><b>${n((d) => state(d) === 'ok')}</b> reporting now</span><span class="chip ${n((d) => state(d) === 'overdue') ? 'bad' : ''}"><b>${n((d) => state(d) === 'overdue')}</b> overdue</span><span class="chip ${n((d) => d.openAlarms) ? 'warn' : ''}"><b>${n((d) => d.openAlarms)}</b> with open alarms</span><span class="chip"><b>${n((d) => d.traps > 0)}</b> send traps</span>`;
    if (!sh.length) { lastHtml = ''; $('#devWrap').innerHTML = list.length ? '<div class="empty"><b>No device matches</b>Change the filters above.</div>' : '<div class="empty"><b>No devices yet</b>Devices appear automatically when they send their first syslog message or SNMP trap.</div>'; return; }
    const html = `<table class="data compact devtbl" id="devTable"><thead><tr><th>State</th><th>Device</th><th>Vendor</th><th>Group</th><th class="num-r">Syslog</th><th class="num-r">Traps</th><th>Last heard</th><th class="num-r">Open alarms</th><th>Severity mix</th><th>Expect every</th><th></th></tr></thead><tbody>` +
      sh.map((d) => { const tot = d.sev.reduce((a, b) => a + b, 0) || 1, stt = state(d);
        const pill = stt === 'overdue' ? `<span class="pill bad" title="${d.silent ? 'It sent messages before and then stopped.' : 'It missed the expected interval.'}">Overdue</span>` : stt === 'ok' ? '<span class="pill ok">Reporting</span>' : '<span class="pill" title="Nothing heard for more than 15 minutes">Quiet</span>';
        return `<tr data-ip="${esc(d.key)}"><td>${pill}${d.muted ? ' <span class="muted small" title="alerts muted">🔕</span>' : ''}</td>
        <td><b>${esc(d.host)}</b> <span class="muted" title="${esc(d.srcIps.join(', '))}">${esc(d.srcIps.length > 1 ? d.srcIp + ' +' + (d.srcIps.length - 1) : d.srcIp)}</span> <input type="text" class="alias" style="width:130px" value="${esc(d.alias)}" placeholder="Display name (optional)" aria-label="Display name for ${esc(d.host)}"></td>
        <td>${esc(d.vendor) || '<span class="muted">—</span>'}</td>
        <td><input type="text" class="grp" style="width:110px" list="grpList" value="${esc(d.group)}" placeholder="e.g. Dubai DC" aria-label="Group"></td>
        <td class="num-r" title="${d.lastSyslog ? 'Last syslog ' + esc(new Date(d.lastSyslog).toLocaleString()) : 'No syslog since the service started'}">${fmtN(d.sys)}</td>
        <td class="num-r" title="${d.lastTrap ? 'Last trap ' + esc(new Date(d.lastTrap).toLocaleString()) : 'No trap since the service started'}">${fmtN(d.traps)}</td>
        <td class="muted" title="${esc(new Date(d.lastSeen).toLocaleString())}">${ago(d.ageSec)}</td>
        <td class="num-r">${d.openAlarms ? `<a href="#alarms" data-act="alarms">${d.openAlarms}</a>` : '0'}</td>
        <td><div class="minibar">${d.sev.map((n, i) => (n ? `<i style="width:${(n / tot) * 100}%;background:var(--s${i})" title="${SEV[i]}: ${fmtN(n)}"></i>` : '')).join('')}</div></td>
        <td><input type="number" class="expect" style="width:64px" min="0" max="525600" value="${d.expectMin || ''}" placeholder="off" title="Raise a ‘no messages’ alert when nothing is heard from this device for this many minutes. Empty = use the global limit." aria-label="Expect a message every minutes"> <span class="muted">min</span></td>
        <td><div style="display:flex;flex-wrap:nowrap;gap:4px">${d.sys ? '<button data-act="logs">Logs</button> ' : ''}${d.traps ? '<button data-act="traps">Traps</button> ' : ''}<button data-act="note" title="${esc(d.note || 'Add a note')}">${d.note ? 'Note ✎' : 'Note'}</button> <button data-act="mute">${d.muted ? 'Unmute' : 'Mute'}</button> <button data-act="forget" class="danger">Forget</button></div></td></tr>`; }).join('') + `</tbody></table><datalist id="grpList">${[...new Set(list.map((d) => d.group).filter(Boolean))].map((x) => `<option value="${esc(x)}">`).join('')}</datalist>`;
    if (html === lastHtml && !force) return; lastHtml = html; $('#devWrap').innerHTML = html;
    { const order = devColList().filter((c) => c.visible).map((c) => DEV_COLS.findIndex((d) => d[0] === c.id)); $$('#devTable tr').forEach((tr) => { const cells = [...tr.children]; if (cells.length === DEV_COLS.length) tr.replaceChildren(...order.map((i) => cells[i])); }); }
    if (!can('settings')) { $$('#devTable input').forEach((x) => { x.disabled = true; }); $$('#devTable button[data-act="note"], #devTable button[data-act="mute"], #devTable button[data-act="forget"]').forEach((x) => x.remove()); }   // viewing only: names, groups, notes, mute and forget change settings
    enableColResize($('#devTable'), 'dev', () => { lastHtml = ''; draw(true); });
  };
  $('#devCols').onclick = () => openSimpleColumns($('#devCols'), 'Device columns', Object.fromEntries(DEV_COLS), devColList, (l) => { if (l) S.prefs.columns = { ...(S.prefs.columns || {}), devices: l }; else if (S.prefs.columns) delete S.prefs.columns.devices; delete S.colw?.dev; if (S.prefs.colw) delete S.prefs.colw.dev; savePrefs(); }, () => { lastHtml = ''; draw(true); });
  const load = async () => { try { list = await api('/api/devices'); options(); draw(); } catch { /* ignore */ } };
  const saveInfo = async (key, patch) => {
    const cfg = await api('/api/config'), info = cfg.deviceInfo || {}; info[key] = { ...(info[key] || {}), ...patch };
    await api('/api/config', { method: 'PUT', body: { deviceInfo: info } }); await load();
  };
  let qT; el.addEventListener('input', (e) => { if (e.target.id === 'devQ') { S.devQ = e.target.value; clearTimeout(qT); qT = setTimeout(() => draw(true), 120); } });
  el.addEventListener('change', async (e) => {
    const t = e.target; if (['devStatus', 'devSrc', 'devGroup', 'devVendor'].includes(t.id)) return draw(true);
    const tr = t.closest('tr[data-ip]'); if (!tr) return; const ip = tr.dataset.ip; const dv = list.find((x) => x.key === ip);
    try {
      if (t.classList.contains('alias')) {
        const cfg = (await api('/api/config')).deviceAliases || {}; for (const k of dv ? dv.srcIps : []) delete cfg[k];
        if (t.value.trim()) cfg[ip] = t.value.trim(); else delete cfg[ip];
        await api('/api/config', { method: 'PUT', body: { deviceAliases: cfg } }); toast('Saved — new messages will use this name'); load();
      } else if (t.classList.contains('grp')) { await saveInfo(ip, { group: t.value.trim() }); toast('Group saved'); }
      else if (t.classList.contains('expect')) { await saveInfo(ip, { expectMin: +t.value || 0 }); toast(+t.value ? `An alert is raised when nothing is heard for ${+t.value} min` : 'Using the global limit'); }
    } catch (err) { toast(err.message, true); }
  });
  el.addEventListener('click', async (e) => {
    if (e.target.closest('#devCsv')) {
      const q2 = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"', h = ['Device', 'Display name', 'Address', 'Vendor', 'Group', 'State', 'Syslog since start', 'Traps since start', 'Last heard', 'Open alarms', 'Expect every (min)', 'Note'];
      const rows = vis().map((d) => [d.host, d.alias, d.srcIp, d.vendor, d.group, state(d), d.sys, d.traps, new Date(d.lastSeen).toLocaleString(), d.openAlarms, d.expectMin || '', d.note]);
      const blob = new Blob(['﻿' + [h, ...rows].map((r) => r.map(q2).join(',')).join('\r\n')], { type: 'text/csv' }), u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = 'devices.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000); return;
    }
    const b = e.target.closest('[data-act]'); if (!b) return; const tr = b.closest('tr[data-ip]'); if (!tr) return; const ip = tr.dataset.ip; const d = list.find((x) => x.key === ip);
    if (b.dataset.act === 'logs') { sessionStorage.setItem('sp.search', JSON.stringify({ host: d.host })); location.hash = '#logs'; }
    if (b.dataset.act === 'traps') { sessionStorage.setItem('sp.search', JSON.stringify({ host: d.host })); location.hash = '#traps'; }
    if (b.dataset.act === 'alarms') { e.preventDefault(); S.alarmState = 'active'; S.alarmSrc = ''; sessionStorage.setItem('sp.alarmQ', d.host); location.hash = '#alarms'; }
    if (b.dataset.act === 'note') { const v = await askText(`Note for ${d.host}`, d.note || ''); if (v !== null && v !== undefined) { try { await saveInfo(ip, { note: v.trim() }); } catch (err) { toast(err.message, true); } } }
    if (b.dataset.act === 'mute') { const cfg = (await api('/api/config')).mutedDevices || []; const nx = d.muted ? cfg.filter((x) => x !== ip && !d.srcIps.includes(x)) : [...cfg, ip]; await api('/api/config', { method: 'PUT', body: { mutedDevices: nx } }); load(); }
    if (b.dataset.act === 'forget' && await askConfirm(`Remove ${d.host} (${ip}) from the device list? Stored messages are kept, and the device returns if it sends again.`)) { await api('/api/device/forget', { method: 'POST', body: { key: ip } }); load(); }
  });
  $('#devStatus').value = ''; load(); const t = setInterval(load, 5000); return () => clearInterval(t);
};

// ---------- Rules ------------------------------------------------------------------------------------------------------------------------
const RULE_TEMPLATES = [
  { name: 'DNWP Connection Master: port and card alarms', match: { textAny: ['/Alarm: .*\\bSet:/', '/Unit Missing\\s*$/'] },
    actions: { tag: 'dnwp', color: '#f2703d', alarm: true, alarmBy: 'port', clearText: ['/Status:\\s*(No alarms|All disabled)/i', '/Unit Missing Cleared/'], sevMap: [{ text: '/Status:\\s*Critical/', severity: 2 }, { text: '/Status:\\s*Major/', severity: 3 }, { text: '/Status:\\s*Minor/', severity: 4 }] } },
  { name: 'DNWP Connection Master: path protection and clock switches', match: { textAny: ['Path protection switched', 'SDH clock switched'] },
    actions: { tag: 'dnwp', color: '#f5a524', alarm: true, alarmBy: 'port', alarmAutoClearMin: 240, clearText: ['/Reason:\\s*(No Request|Revert)/i'], sevMap: [{ text: '/Reason:/', severity: 4 }] } },
  { name: 'DNWP Connection Master: unit removed / inserted', match: { textAny: ['removed from unit slot'] },
    actions: { tag: 'dnwp', color: '#f2703d', alarm: true, alarmBy: 'port', clearText: ['inserted in unit slot'], sevMap: [{ text: 'removed from unit slot', severity: 3 }] } },
  { name: 'Alarm: link down — cleared by link up', set: [
    { name: 'Link down (alarm)', match: { tag: 'link-down' }, actions: { color: '#f5a524', alarm: true, alarmBy: 'port', alarmEscMin: 15 } },
    { name: 'Link up (clears alarm)', match: { tag: 'link-up' }, actions: { clearsRule: '#0', alarmBy: 'port' } }] },
  { name: 'Alarm: mains failure — cleared when restored', set: [
    { name: 'Mains failure (alarm)', match: { tag: 'mains-failure' }, actions: { color: '#f2703d', alarm: true, alarmEscMin: 10 } },
    { name: 'Mains restored (clears alarm)', match: { tag: 'mains-restored' }, actions: { clearsRule: '#0' } }] },
  { name: 'Alarm: routing neighbour down — cleared when up', set: [
    { name: 'Routing neighbour down (alarm)', match: { tag: 'routing-neighbor-down' }, actions: { color: '#ee4d5b', alarm: true, alarmEscMin: 10 } },
    { name: 'Routing neighbour up (clears alarm)', match: { tag: 'routing-neighbor-up' }, actions: { clearsRule: '#0' } }] },
  { name: 'Alarm: communication lost — cleared when restored', set: [
    { name: 'Communication lost (alarm)', match: { tag: 'comm-lost' }, actions: { color: '#f2703d', alarm: true, alarmEscMin: 15 } },
    { name: 'Communication restored (clears alarm)', match: { tag: 'comm-restored' }, actions: { clearsRule: '#0' } }] },
  { name: 'Interface down', match: { text: '/changed state to down|link.*down|link down/i' }, actions: { color: '#f5a524', tag: 'link', sound: true } },
  { name: 'Failed logins', match: { text: '/fail(ed)?.*(login|password|auth)|authentication failure|invalid user/i' }, actions: { color: '#f2703d', tag: 'auth' } },
  { name: 'Power and UPS events', match: { text: '/on battery|battery low|power (fail|lost|restored)|input voltage/i' }, actions: { color: '#d9cf4a', tag: 'power', sound: true } },
  { name: 'Hide debug noise', match: { severities: [7] }, actions: { drop: true } },
  { name: 'NetEventPro health alerts (email)', match: { host: 'NetEventPro', severities: [0, 1, 2, 3, 4] }, actions: { color: '#f5a524', tag: 'health', email: true } },
  { name: 'Link down — recognised by vendor tag', match: { tag: 'link-down' }, actions: { color: '#f5a524', sound: true } },
  { name: 'UPS on battery (APC) — email', match: { tag: 'on-battery' }, actions: { color: '#f2703d', sound: true, email: true } },
  { name: 'Mains failure (Eltek) — email', match: { tag: 'mains-failure' }, actions: { color: '#f2703d', sound: true, email: true } },
  { name: 'Failed logins — recognised by vendor tag', match: { tag: 'login-failed' }, actions: { color: '#f2703d' } }
];
const SNMP_RULE_TEMPLATES = [
  { source: 'snmp', name: 'Eltek SP2: power system alarm (on = raise, off = clear)', match: { trap: '/powerSystemTraps|1\\.3\\.6\\.1\\.4\\.1\\.12148\\./i', text: '/alarmSubsysStatusOnOff\\.\\d+\\s*=\\s*on/i' },
    actions: { color: '#f2703d', tag: 'eltek', alarm: true, alarmBy: '/alarmSubsysStatusOid\\.\\d+\\s*=\\s*([^,]+)/i', alarmEscMin: 15, clearText: ['/alarmSubsysStatusOnOff\\.\\d+\\s*=\\s*off/i'], sevMap: [{ text: '/majorAlarm/i', severity: 3 }, { text: '/minorAlarm/i', severity: 8 }] } },
  { source: 'snmp', name: 'Alarm: link down trap — cleared by link up trap', set: [
    { name: 'Link down trap (alarm)', match: { tag: 'link-down' }, actions: { color: '#f5a524', alarm: true, alarmBy: 'port', alarmEscMin: 15 } },
    { name: 'Link up trap (clears alarm)', match: { tag: 'link-up' }, actions: { clearsRule: '#0', alarmBy: 'port' } }] },
  { source: 'snmp', name: 'Alarm: trap names ending Failure / Lost / Down — cleared by Restored / Up / Normal', set: [
    { name: 'Failure trap (alarm)', match: { trap: '/(fail|failure|fault|lost|down|alarm)$/i' }, actions: { color: '#ee4d5b', alarm: true, alarmEscMin: 15 } },
    { name: 'Restored trap (clears alarm)', match: { trap: '/(restored|recovered|ok|up|normal|cleared)$/i' }, actions: { clearsRule: '#0' } }] },
  { source: 'snmp', name: 'Alarm: every trap of severity error or worse', match: { severityMax: 3 }, actions: { color: '#ee4d5b', alarm: true, alarmEscMin: 30 } },
  { source: 'snmp', name: 'Device restarted (coldStart / warmStart) — email', match: { trap: '/^(coldStart|warmStart)$/' }, actions: { color: '#d9cf4a', email: true } },
  { source: 'snmp', name: 'SNMP authentication failure — highlight', match: { trap: 'authenticationFailure' }, actions: { color: '#f2703d', tag: 'auth' } },
  { source: 'snmp', name: 'All traps from one vendor (enter its number, e.g. 1.3.6.1.4.1.318 = APC)', match: { trap: '1.3.6.1.4.1.318' }, actions: { color: '#f5a524', sound: true } },
  { source: 'snmp', name: 'Hide a noisy trap (enter its name)', match: { trap: 'noisyTrapName' }, actions: { drop: true } }
];
views.rules = (el) => {
  let rules = [], hooks = [], profs = []; let hits = {}; let tab = S.ruleTab === 'snmp' ? 'snmp' : 'syslog';
  const srcOf = (r) => (r.source === 'snmp' ? 'snmp' : 'syslog');
  const tpls = () => (tab === 'snmp' ? SNMP_RULE_TEMPLATES : RULE_TEMPLATES);
  const seed = sessionStorage.getItem('sp.ruleSeed');
  let editI = null, backup = null, isNew = false;
  const sevTxt = (r) => { const v = r.match?.severities; return v && v.length ? sevLabel(v.join(',')) : 'any severity'; };
  const whenTxt = (r) => { const m = r.match || {}; const parts = [sevTxt(r)]; if (m.textAny?.length) parts.push(m.textAny.length === 1 ? '“' + m.textAny[0] + '”' : 'any of ' + m.textAny.length + ' texts'); if (m.host) parts.push('device ' + m.host); if (m.trap) parts.push('trap ' + m.trap); if (m.tag) parts.push('tag ' + m.tag); if (m.text) parts.push('“' + m.text + '”'); if (m.notText) parts.push('not “' + m.notText + '”'); if (m.ip) parts.push('from ' + m.ip); if (m.repeat?.count) parts.push(`${m.repeat.count}× in ${m.repeat.withinSec}s`); if (m.days || m.from) parts.push('scheduled'); return parts.join(' · '); };
  const thenTxt = (r) => { const a = r.actions || {}, o = []; if (a.drop) o.push('<span class="pill bad">discard</span>'); if (a.color) o.push(`<span class="swatch" style="background:${esc(a.color)}" title="Highlight colour"></span>`); if (a.tag) o.push(`<span class="pill">tag ${esc(a.tag)}</span>`); if (a.severity !== undefined) o.push(`<span class="pill">severity ${a.severity}</span>`); if (a.alarm) o.push(`<span class="pill warn" title="${a.alarmBy ? 'One alarm per port / item' : 'One alarm per device'}">alarm${a.alarmBy ? ' / port' : ''}</span>`); if (a.clearText?.length) o.push('<span class="pill ok" title="This rule also clears its own alarms when a message contains one of its clear texts">clears itself</span>'); if (a.sevMap?.length) o.push('<span class="pill" title="Severity is taken from the message text">sev from text</span>'); if (a.clearsRule) { const t = rules.find((x) => x.id === a.clearsRule); o.push(`<span class="pill ok" title="Clears the alarms of ${esc(t?.name || '?')}">clears ${esc((t?.name || '?').slice(0, 18))}</span>`); } if (a.email) o.push('<span class="pill">email</span>'); if (a.webhook) o.push(`<span class="pill">webhook</span>`); if (a.sound) o.push('<span class="pill">sound</span>'); if (a.notify) o.push('<span class="pill">notify</span>'); if (a.stop) o.push('<span class="pill">stop</span>'); return o.join(' ') || '<span class="muted">—</span>'; };
  const draw = () => {
    const cnt = { syslog: rules.filter((r) => srcOf(r) === 'syslog').length, snmp: rules.filter((r) => srcOf(r) === 'snmp').length };
    const mine = rules.map((r, i) => [r, i]).filter(([r]) => srcOf(r) === tab);
    const first = rules.findIndex((x) => srcOf(x) === tab), last = rules.findLastIndex((x) => srcOf(x) === tab);
    el.innerHTML = `<div class="stickyhead"><div class="page-head"><h1>Rules &amp; alerts</h1><span class="muted">${tab === 'snmp' ? 'These rules run on SNMP traps only.' : 'These rules run on syslog messages only.'} Rules run top to bottom.</span><span class="spacer"></span>
      <select id="tpl"><option value="">Add from template…</option>${tpls().map((t, i) => `<option value="${i}">${esc(t.name)}</option>`).join('')}</select><button id="addRule">New rule</button><button id="expRules" title="Download all rules as a file to copy to another PC">Export</button><button id="impRules" title="Add rules from an exported file">Import</button><input type="file" id="impFile" accept=".json,application/json" hidden><button class="primary" id="saveRules">Save rules</button></div>
      <div class="tabs" role="tablist" style="margin:0"><button role="tab" class="tab ${tab === 'syslog' ? 'on' : ''}" data-tab="syslog">Syslog rules <span class="muted">${cnt.syslog}</span></button><button role="tab" class="tab ${tab === 'snmp' ? 'on' : ''}" data-tab="snmp">SNMP trap rules <span class="muted">${cnt.snmp}</span></button></div></div>
      ${mine.length ? `<div class="panel" style="padding:0;overflow:auto"><table class="data rules" id="ruleTable"><thead><tr><th>On</th><th>Name</th><th>When</th><th>Then</th><th class="num-r">Matches</th><th></th></tr></thead><tbody>${mine.map(([r, i]) => `<tr class="rrow ${r.enabled === false ? 'off' : ''}" data-i="${i}" id="rule_${esc(r.id)}" style="--rc:${esc(r.actions?.color || 'transparent')}">
        <td class="chk"><input type="checkbox" data-en="${i}" ${r.enabled !== false ? 'checked' : ''} aria-label="Rule on"></td>
        <td class="nowrap"><b>${esc(r.name)}</b>${r.note ? ` <span class="muted" title="${esc(r.note)}">ⓘ</span>` : ''}</td>
        <td class="cond" title="${esc(whenTxt(r))}">${esc(whenTxt(r))}</td><td>${thenTxt(r)}</td><td class="num-r muted" title="Messages this rule matched since the service started">${fmtN(hits[r.id] || 0)}</td>
        <td class="nowrap acts"><button class="ib" data-act="up" ${i === first ? 'disabled' : ''} title="Move up" aria-label="Move up">↑</button><button class="ib" data-act="down" ${i === last ? 'disabled' : ''} title="Move down" aria-label="Move down">↓</button><button data-act="edit" title="Edit this rule">Edit</button><button data-act="dup" title="Make a copy of this rule">Copy</button><button class="danger" data-act="del" title="Delete this rule">Delete</button></td></tr>`).join('')}</tbody></table></div>`
        : `<div class="panel empty"><b>No ${tab === 'snmp' ? 'SNMP trap' : 'syslog'} rules yet</b>${tab === 'snmp' ? 'Trap rules match the trap name or OID and its values. Use “Add from template…” for link down/up, restarts and more.' : 'Rules can highlight messages, tag them, play a sound, call a webhook, or drop noise before it is stored.'}</div>`}
      ${editI !== null && rules[editI] ? `<div class="modal-back" id="ruleModal"><div class="modal xwide" role="dialog" aria-modal="true" aria-label="Edit rule"><div class="toolbar" style="margin:0 0 8px"><h3 style="margin:0">${isNew ? 'New rule' : 'Edit rule'}</h3><span class="spacer"></span><button id="ruleCancel">Cancel</button><button class="primary" id="ruleDone">Done</button></div><div class="modal-scroll">${ruleHtml(rules[editI], editI, true)}</div><p class="muted" style="margin:8px 0 0">“Done” keeps your changes on this page. Click <b>Save rules</b> at the top of the page to make them active.</p></div></div>` : ''}`;
  };
  const closeEdit = (keep) => { if (!keep && editI !== null) { if (isNew) rules.splice(editI, 1); else if (backup) rules[editI] = backup; } editI = null; backup = null; isNew = false; draw(); };
  const openEdit = (i, fresh) => { editI = i; backup = fresh ? null : structuredClone(rules[i]); isNew = !!fresh; draw(); const nm = $('#ruleModal .name', el); if (nm) { nm.focus(); if (fresh) nm.select(); } };
  const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const ruleHtml = (r, i, inModal) => { const m = r.match || {}, a = r.actions || {}, sn = srcOf(r) === 'snmp', rep = m.repeat || {}, days = m.days || [];
    return `<div class="rule ${r.enabled === false ? 'off' : ''}" data-i="${i}" id="rule_${esc(r.id)}" style="border-left-color:${esc(a.color || 'var(--line2)')}">
    <div class="toolbar" style="margin:0"><label class="chk"><input type="checkbox" data-k="enabled" ${r.enabled !== false ? 'checked' : ''}> On</label>
      <input type="text" class="name" data-k="name" value="${esc(r.name)}" aria-label="Rule name"><span class="muted" title="Messages this rule matched since the service started">${fmtN(hits[r.id] || 0)} matches since start</span><span class="spacer"></span>
      <button data-act="test" title="Count how many of the last 24 hours of stored messages this rule would match">Test</button></div>
    <div class="rsec">1 · Which messages</div>
    <div class="row"><span class="k">Note</span><input type="text" data-k="note" style="width:100%;max-width:640px" maxlength="300" placeholder="What this rule is for (optional)" value="${esc(r.note || '')}"></div>
    <div class="row"><span class="k">When</span>
      <button type="button" data-sevbtn title="Pick one or more severities this rule applies to">${esc(sevLabel((m.severities || []).join(',')))} ▾</button>
      <input type="text" class="w-md" data-k="m.host" placeholder="${sn ? 'Device or IP contains' : 'Device contains'}" value="${esc(m.host || '')}">${sn ? `<input type="text" class="w-md" data-k="m.trap" placeholder="Trap name or OID, e.g. linkDown" title="A trap name (linkDown), a numeric OID prefix (1.3.6.1.4.1.318 = everything from APC) or a /regex/" value="${esc(m.trap || '')}">` : `<input type="text" class="w-md" data-k="m.app" placeholder="Process contains" value="${esc(m.app || '')}">`}
      <input type="text" class="w-md" data-k="m.tag" placeholder="Has tag, e.g. link-down" title="A tag added by the vendor recognisers (Settings) or by an earlier rule" value="${esc(m.tag || '')}">
      <input type="text" data-k="m.text" placeholder="${sn ? 'Values contain, e.g. ifOperStatus.3 = down' : 'Message contains, or /regex/i'}" title="Plain text searches the whole message. A /regex/ looks at the first 2000 characters." style="width:290px" value="${esc(m.text || '')}"></div>
    <div class="row"><span class="k">Or any of</span>
      <textarea data-k="m.textAny" rows="3" placeholder="${sn ? 'One per line: the trap values contain any of these' : 'Message contains ANY of these, one per line (text or /regex/). One rule can then cover many different messages.'}" title="OR: the rule applies when at least one line is found in the message. Combined with ‘Message contains’ above, both must hold." style="width:100%;max-width:640px">${esc((m.textAny || []).join('\n'))}</textarea></div>
    <div class="row"><span class="k">And only if</span>
      <input type="text" data-k="m.notText" placeholder="Message does NOT contain, or /regex/" title="The rule is skipped when this text is found: use it to leave out known harmless messages" style="width:260px" value="${esc(m.notText || '')}">
      <input type="text" data-k="m.ip" placeholder="Sent from IP or range, e.g. 10.20.0.0/16" title="One or more IPv4 addresses or ranges, separated by commas" style="width:250px" value="${esc(m.ip || '')}">
      <span class="muted">repeated</span><input type="number" class="w-sm" min="2" max="1000" data-k="rep.count" placeholder="times" title="Only fire when the same device matched this many times…" value="${rep.count || ''}"><span class="muted">within</span><input type="number" class="w-sm" min="1" max="86400" data-k="rep.sec" placeholder="sec" title="…within this many seconds" value="${rep.withinSec || ''}"><span class="muted">s</span></div>
    <div class="row"><span class="k">Schedule</span><span class="muted">only on</span>${DAYN.map((n, d) => `<label class="chk"><input type="checkbox" data-day="${d}" ${days.includes(d) ? 'checked' : ''}> ${n}</label>`).join('')}
      <span class="muted">between</span><input type="time" data-k="m.from" value="${esc(m.from || '')}" aria-label="From"><span class="muted">and</span><input type="time" data-k="m.to" value="${esc(m.to || '')}" aria-label="To"><span class="muted">(server time; may pass midnight; none ticked = every day)</span></div>
    <div class="rsec">2 · What happens to the message</div>
    <div class="row"><span class="k">Then</span>
      <label class="chk"><input type="color" data-k="a.color" value="${esc(a.color || '#f5a524')}"> <input type="checkbox" data-k="a.useColor" ${a.color ? 'checked' : ''}> Highlight</label>
      <input type="text" class="w-sm" data-k="a.tag" placeholder="Tag" value="${esc(a.tag || '')}">
      <select data-k="a.severity" title="Change the severity of the message before it is stored (and before the next rules look at it)"><option value="">Keep severity</option>${SEVORD.map((k) => `<option value="${k}" ${a.severity === k ? 'selected' : ''}>Set to ${sevOpt(k)}</option>`).join('')}</select>
      <label class="chk"><input type="checkbox" data-k="a.sound" ${a.sound ? 'checked' : ''}> Sound</label><label class="chk"><input type="checkbox" data-k="a.notify" ${a.notify ? 'checked' : ''}> Desktop notification</label>
      <label class="chk" title="Do not run the rules below this one for this message"><input type="checkbox" data-k="a.stop" ${a.stop ? 'checked' : ''}> Stop here</label>
      <label class="chk" style="margin-left:auto"><input type="checkbox" data-k="a.drop" ${a.drop ? 'checked' : ''}> Discard message</label></div>
    <div class="rsec">3 · Who is told when it matches</div>
    <div class="row"><span class="k">Notify</span>
      ${profs.length ? profMenu('data-prof', profs, a.profiles) : '<span class="muted">No profiles yet.</span> <a href="#notifications" class="muted">Create one</a>'}
      ${(a.profiles || []).some((id) => profs.find((p) => p.id === id)?.email?.on) ? `<label class="chk" title="Attach the PDF of everything that happened in the last 24 hours to this rule's e-mails"><input type="checkbox" data-k="a.emailReport" ${a.emailReport ? 'checked' : ''}> e-mails with 24-hour report</label>` : ''}
      <input type="number" class="w-sm" data-k="a.cooldownSec" min="0" placeholder="${(a.profiles || []).some((id) => profs.find((p) => p.id === id && (p.email?.on || p.sms?.on))) ? 300 : 60}" title="Seconds between alerts of this rule (default 300 when a profile sends e-mail or SMS, otherwise 60)" value="${a.cooldownSec ?? ''}"><span class="muted">sec between alerts</span>
      ${a.email || a.webhook ? `<span class="muted" title="Saved before notification profiles existed. It keeps working. Remove it once a profile does the same.">· old e-mail / webhook setting</span> <button type="button" data-legacy="1">Remove it</button>` : ''}</div>
    <div class="rsec">4 · Alarm</div>
    <div class="row"><span class="k">Alarm</span>
      <label class="chk"><input type="checkbox" data-k="a.alarm" ${a.alarm ? 'checked' : ''}> Raise an alarm</label>
      ${a.alarm ? `<span class="muted">escalate after</span><input type="number" class="w-sm" min="0" max="10080" data-k="a.alarmEscMin" placeholder="off" title="Minutes without acknowledgement before the escalation is sent. Empty = never" value="${a.alarmEscMin ?? ''}"><span class="muted">min, tell</span>${profs.length ? profMenu('data-eprof', profs, a.alarmEscProfiles) : '<span class="muted">(create a profile first)</span>'}<label class="chk" title="The escalation e-mail carries a PDF of everything that happened in the last 24 hours: alarms, messages and traps"><input type="checkbox" data-k="a.alarmEscReport" ${a.alarmEscReport !== false ? 'checked' : ''}> attach the 24-hour report</label><span class="brk"></span><span class="k"></span><label class="chk" title="When an escalated alarm clears (by hand, by a clearing rule or automatically) a recovery e-mail goes to the same recipients"><input type="checkbox" data-k="a.alarmEscClear" ${a.alarmEscClear !== false ? 'checked' : ''}> tell them when it clears</label>
      <span class="brk"></span><span class="k"></span><span class="muted" title="A port that keeps going down and up sends an alert for every change. With this on, it is told once as “flapping” and stays quiet until it settles.">flapping: after</span><input type="number" class="w-sm" min="2" max="1000" data-k="a.flapCount" placeholder="off" title="Number of changes (alarm raised or cleared) of the same device and port. Empty = flap detection off" value="${a.flapCount ?? ''}"><span class="muted">changes within</span><input type="number" class="w-sm" min="1" max="1440" data-k="a.flapMin" placeholder="10" title="Minutes" value="${a.flapMin ?? ''}"><span class="muted">min = one flapping alarm; ends after</span><input type="number" class="w-sm" min="1" max="1440" data-k="a.flapQuiet" placeholder="15" title="Quiet minutes before the flapping alarm clears itself" value="${a.flapQuiet ?? ''}"><span class="muted">quiet min</span><span class="brk"></span><span class="k"></span><span class="muted">clear by itself if not repeated for</span><input type="number" class="w-sm" min="0" max="525600" data-k="a.alarmAutoClearMin" placeholder="never" title="The alarm clears itself when this rule has not matched again for this many minutes (good for events that have no matching “restored” message)" value="${a.alarmAutoClearMin ?? ''}"><span class="muted">min</span>` : ''}
      <span class="muted">or, when this matches, clear the alarms of</span>
      <select data-k="a.clearsRule" title="Alarms of the chosen rule on the same device are cleared automatically"><option value="">no rule</option>${rules.filter((x, j) => j !== i && x.id && srcOf(x) === srcOf(r)).map((x) => `<option value="${esc(x.id)}" ${a.clearsRule === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
    <div class="row"><span class="k">Alarm per</span><select data-k="a.alarmMode" title="Decides what counts as ‘the same alarm’. With ‘port’, 50 link-downs of one switch are 50 alarms, and a link-up clears only its own port."><option value="">device (one alarm per device)</option><option value="port" ${a.alarmBy === 'port' ? 'selected' : ''}>port / interface (found automatically)</option><option value="custom" ${a.alarmBy && a.alarmBy !== 'port' ? 'selected' : ''}>own pattern (regular expression)</option></select>
      ${a.alarmBy && a.alarmBy !== 'port' ? `<input type="text" data-k="a.alarmBy" style="width:260px" placeholder="/slot (\\d+)/i" title="The first bracketed group (or the whole match) of the message names the item" value="${esc(a.alarmBy)}">` : ''}
      <span class="muted">Use the same setting on the rule that raises the alarm and on the rule that clears it, so a “link up” clears only the same port.</span></div>
    ${a.alarm ? `<div class="row"><span class="k">Clear when</span><textarea data-k="a.clearText" rows="2" placeholder="Optional. One per line (text or /regex/): a message containing any of these clears this rule's own alarm (the same port with “Alarm per port”). One rule can then raise and clear, no second rule needed." title="Example for Connection Master: /Status:\\s*(No alarms|All disabled)/i" style="width:100%;max-width:640px">${esc((a.clearText || []).join('\n'))}</textarea></div>
    <div class="row"><span class="k">Severity from message</span><textarea data-k="a.sevMap" rows="2" placeholder="Optional. One per line: text => severity number (0 emergency, 1 alert, 2 critical, 3 error, 4 warning), the first line that matches wins. Example: /Status:\\s*Major/ => 3" style="width:100%;max-width:640px">${esc((a.sevMap || []).map((x) => x.text + ' => ' + x.severity).join('\n'))}</textarea></div>` : ''}
    <div class="row" id="rt_${esc(r.id)}" hidden></div></div>`; };
  const load = async () => {
    const c = await api('/api/config'); rules = (c.rules || []).map(upgradeSev); hooks = c.webhooks || []; profs = (c.notifProfiles || []).filter((p) => p.enabled !== false); hits = (await api('/api/stats')).ruleHits || {};
    if (seed) { sessionStorage.removeItem('sp.ruleSeed'); const s = JSON.parse(seed); if (s.source === 'snmp') { tab = 'snmp'; S.ruleTab = 'snmp'; } rules.push({ id: 'r' + Date.now(), name: 'Rule for ' + (s.host || s.trap || 'new rule'), enabled: true, source: s.source === 'snmp' ? 'snmp' : 'syslog', match: s.source === 'snmp' ? { host: s.host, ...(s.trap ? { trap: s.trap } : {}) } : { host: s.host, text: s.text }, actions: { color: '#f5a524', tag: '' } }); toast('New rule added — adjust it and save'); editI = rules.length - 1; isNew = true; }
    draw();
  };
  const setKey = (r, k, v, el) => {
    r.match ||= {}; r.actions ||= {};
    if (k === 'enabled') r.enabled = v; else if (k === 'name') r.name = v; else if (k === 'note') { if (v) r.note = v; else delete r.note; }
    else if (k === 'rep.count' || k === 'rep.sec') { const rp = { ...(r.match.repeat || {}) }; if (k === 'rep.count') rp.count = +v || 0; else rp.withinSec = +v || 0; if (rp.count > 1 && rp.withinSec > 0) r.match.repeat = rp; else if (!rp.count && !rp.withinSec) delete r.match.repeat; else r.match.repeat = rp; }
    else if (k === 'm.textAny' || k === 'a.clearText') { const l = String(v).split('\n').map((x) => x.trim()).filter(Boolean); const o = k === 'm.textAny' ? r.match : r.actions, kk = k.slice(2); if (l.length) o[kk] = l; else delete o[kk]; }
    else if (k === 'a.sevMap') { const l = String(v).split('\n').map((x) => { const i = x.lastIndexOf('=>'); return i > 0 ? { text: x.slice(0, i).trim(), severity: +x.slice(i + 2).trim() } : null; }).filter((x) => x && x.text && Number.isInteger(x.severity) && x.severity >= 0 && x.severity <= 7); if (l.length) r.actions.sevMap = l; else delete r.actions.sevMap; }
    else if (k.startsWith('m.')) { const kk = k.slice(2); if (v === '' || v === undefined) delete r.match[kk]; else r.match[kk] = kk.startsWith('severity') ? +v : v; }
    else if (k === 'a.useColor') { if (!v) delete r.actions.color; else r.actions.color = $('[data-k="a.color"]', el.closest('.rule')).value; }
    else if (k === 'a.color') { if ($('[data-k="a.useColor"]', el.closest('.rule')).checked) r.actions.color = v; }
    else if (k.startsWith('a.')) { const kk = k.slice(2); if (kk === 'alarmEscReport' || kk === 'alarmEscClear') { if (v) delete r.actions[kk]; else r.actions[kk] = false; } else if (v === '' || v === false) delete r.actions[kk]; else r.actions[kk] = (kk === 'cooldownSec' || kk === 'alarmEscMin' || kk === 'severity' || kk === 'alarmAutoClearMin') ? +v : v; }
  };
  el.addEventListener('input', (e) => { if (e.target.dataset.day !== undefined) { const r = rules[+e.target.closest('.rule').dataset.i]; r.match ||= {}; const set = new Set(r.match.days || []); if (e.target.checked) set.add(+e.target.dataset.day); else set.delete(+e.target.dataset.day); if (set.size && set.size < 7) r.match.days = [...set].sort(); else delete r.match.days; return; } const k = e.target.dataset.k; if (!k) return; const r = rules[+e.target.closest('.rule').dataset.i]; setKey(r, k, e.target.type === 'checkbox' ? e.target.checked : e.target.value, e.target); });
  el.addEventListener('change', (e) => {
    if (e.target.dataset.k === 'a.alarmMode') { const r = rules[+e.target.closest('.rule').dataset.i]; r.actions ||= {}; const v = e.target.value; if (!v) delete r.actions.alarmBy; else r.actions.alarmBy = v === 'port' ? 'port' : '/port (\\S+)/i'; draw(); return; }
    if (e.target.dataset.prof !== undefined || e.target.dataset.eprof !== undefined) { const r = rules[+e.target.closest('.rule').dataset.i]; r.actions ||= {}; const key = e.target.dataset.prof !== undefined ? 'profiles' : 'alarmEscProfiles', id = e.target.dataset.prof ?? e.target.dataset.eprof; const set = new Set(r.actions[key] || []); if (e.target.checked) set.add(id); else set.delete(id); if (set.size) r.actions[key] = [...set]; else delete r.actions[key]; if (key === 'profiles') { const open = e.target.closest('.rule')?.dataset.i; draw(); const d = $(`.rule[data-i="${open}"] details.msel`); if (d) d.open = true; return; } const sm = e.target.closest('details.msel')?.querySelector('summary'); if (sm) { const ch = profs.filter((p) => set.has(p.id)); sm.textContent = !ch.length ? 'none' : ch.length <= 2 ? ch.map((p) => p.name).join(', ') : `${ch.length} profiles`; } return; }
    if (e.target.dataset.en !== undefined) { rules[+e.target.dataset.en].enabled = e.target.checked; e.target.closest('tr').classList.toggle('off', !e.target.checked); return; }
    if (e.target.dataset.k === 'a.alarm' || e.target.dataset.k === 'a.email') { draw(); return; } if (e.target.dataset.k === 'enabled') { e.target.closest('.rule').classList.toggle('off', !e.target.checked); } if (e.target.dataset.k === 'a.useColor' || e.target.dataset.k === 'a.color') e.target.closest('.rule').style.borderLeftColor = rules[+e.target.closest('.rule').dataset.i].actions.color || ''; });
  el.addEventListener('change', async (e) => {
    if (e.target.id !== 'impFile' || !e.target.files[0]) return;
    try {
      const j = JSON.parse(await e.target.files[0].text()); const list = Array.isArray(j) ? j : j.rules;
      if (!Array.isArray(list)) throw new Error('This file has no rules in it');
      let n = 0; for (const r of list) { if (!r || typeof r !== 'object' || !r.match) continue; rules.push({ ...r, id: 'r' + Date.now() + '_' + (n++) }); }
      e.target.value = ''; toast(`${n} rule${n === 1 ? '' : 's'} added. Press Save rules to make them active.`); draw();
    } catch (err) { toast('Import failed: ' + err.message, true); }
  });
  el.addEventListener('click', async (e) => {
    if (e.target.id === 'addRule') { const id = 'r' + Date.now(); rules.push({ id, name: 'New rule', enabled: true, source: tab, match: {}, actions: {} }); return openEdit(rules.length - 1, true); }
    if (e.target.id === 'expRules') { const blob = new Blob([JSON.stringify({ format: 'neteventpro-rules', version: 1, rules }, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'neteventpro-rules.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); return; }
    if (e.target.id === 'impRules') return el.querySelector('#impFile').click();
    if (e.target.dataset.legacy) { const r = rules[+e.target.closest('.rule').dataset.i]; for (const k of ['email', 'emailTo', 'emailCc', 'webhook']) delete r.actions[k]; return draw(); }
    if (e.target.id === 'ruleCancel') return closeEdit(false);
    if (e.target.id === 'ruleDone') return closeEdit(true);
    if (e.target.id === 'ruleModal') return;
    if (e.target.dataset.tab) { tab = e.target.dataset.tab; S.ruleTab = tab; draw(); }
    if (e.target.id === 'saveRules') {
      for (const r of rules) for (const k of ['host', 'app', 'text', 'trap']) { const v = r.match?.[k]; const m = v && /^\/(.+)\/([a-z]*)$/.exec(v); if (m) { try { new RegExp(m[1], m[2]); } catch (err) { return toast(`Rule "${r.name}": the regular expression is invalid (${err.message})`, true); } } }
      try { await api('/api/config', { method: 'PUT', body: { rules } }); toast('Rules saved and active'); load(); } catch (err) { toast(err.message, true); }
    }
    const sb = e.target.closest('[data-sevbtn]');
    if (sb) { const r = rules[+sb.closest('.rule').dataset.i]; return sevPopover(sb, (r.match.severities || []).join(','), (v) => { const a = sevSetOf(v); if (a.length) r.match.severities = a; else delete r.match.severities; sb.textContent = sevLabel(v) + ' ▾'; }); }
    const b = e.target.closest('button[data-act]'); if (!b) return; const i = +b.closest('[data-i]').dataset.i;
    if (b.dataset.act === 'edit') return openEdit(i, false);
    if (b.dataset.act === 'dup') { const c = structuredClone(rules[i]); c.id = 'r' + Date.now(); c.name = (c.name + ' (copy)').slice(0, 100); rules.splice(i + 1, 0, c); draw(); const n = document.getElementById('rule_' + c.id); n?.scrollIntoView({ block: 'center' }); n?.classList.add('flash'); return; }
    if (b.dataset.act === 'test') {
      const box = $('#rt_' + rules[i].id, el); box.hidden = false; box.innerHTML = '<span class="muted">Checking the last 24 hours…</span>';
      try { const r = await api('/api/rules/test', { method: 'POST', body: { rule: rules[i] } }); box.innerHTML = `<span class="k">Test</span><span><b>${fmtN(r.matched)}</b> of ${fmtN(r.checked)} ${srcOf(rules[i]) === 'snmp' ? 'traps' : 'messages'} in the last 24 hours${r.capped ? ' (newest 5,000)' : ''} would match.${r.note ? ' ' + esc(r.note) : ''}</span>${r.samples.map((x) => `<div class="muted trunc" style="flex-basis:100%;padding-left:92px">${esc(dateOf(x.ts))} ${esc(timeOf(x.ts, false))} · ${esc(x.host)} · ${esc(x.message)}</div>`).join('')}`; }
      catch (err) { box.innerHTML = `<span style="color:var(--bad)">${esc(err.message)}</span>`; }
      return;
    }
    if (b.dataset.act === 'del') { if (!await askConfirm(`Delete the rule “${rules[i].name}”? (Rules are only removed for good when you click Save rules.)`, 'Delete')) return; rules.splice(i, 1); } const sameSrc = (x) => srcOf(x) === srcOf(rules[i]); if (b.dataset.act === 'up') { const j = rules.findLastIndex((x, n) => n < i && sameSrc(x)); if (j >= 0) [rules[j], rules[i]] = [rules[i], rules[j]]; } if (b.dataset.act === 'down') { const j = rules.findIndex((x, n) => n > i && sameSrc(x)); if (j >= 0) [rules[j], rules[i]] = [rules[i], rules[j]]; } draw();
  });
  /** templates that used to say "send e-mail" now use the first notification profile that sends e-mail (none yet: choose one in the rule) */
  const tplMail = (a) => { if (a.email) { delete a.email; const pr = profs.find((x) => x.email?.on); if (pr) a.profiles = [pr.id]; else toast('This template sends e-mail: tick a notification profile in the rule (Notifications page → Profiles).'); } return a; };
  el.addEventListener('change', (e) => { if (e.target.id === 'tpl' && e.target.value !== '') { const t = structuredClone(tpls()[+e.target.value]); if (t.set) { const base = Date.now(), ids = t.set.map((_, n) => 'r' + (base + n)); t.set.forEach((r, n) => { const act = tplMail({ ...r.actions }); if (act.clearsRule && /^#\d+$/.test(act.clearsRule)) act.clearsRule = ids[+act.clearsRule.slice(1)]; rules.push({ id: ids[n], enabled: true, source: tab, name: r.name, match: r.match, actions: act }); }); } else rules.push({ id: 'r' + Date.now(), enabled: true, ...t, actions: tplMail({ ...t.actions }), source: tab }); draw(); } });
  load();
};

// ---------- Text replacement ---------------------------------------------------------------------------------------------------------------
function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => toast('Copied'), () => toast('Copy was blocked by the browser — select the text and press Ctrl+C', true));
  const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
  try { document.execCommand('copy'); toast('Copied'); } catch { toast('Select the text and press Ctrl+C', true); }
  t.remove();
}

views.replace = (el, _main, embedded) => {
  let list = [];
  const trapLabels = () => [...new Set((S.prefs?.trapViews || []).flatMap((v) => (v.cols || []).map((c) => c.label)).filter(Boolean))];
  const colPick = (r) => {
    const all = trapLabels(), on = new Set((r.cols || []).map((x) => x.toLowerCase())), extra = (r.cols || []).filter((x) => !all.some((l) => l.toLowerCase() === x.toLowerCase()));
    if (!all.length && !extra.length) return '<span class="muted" title="Create a trap column view in Settings, Trap columns first, then choose its columns here">All columns</span>';
    return `<details class="colpick"><summary>${r.cols?.length ? esc(r.cols.length === 1 ? r.cols[0] : r.cols.length + ' columns') : 'All columns'}</summary><div style="padding:6px 0;display:grid;gap:4px;min-width:150px">
      ${[...all, ...extra].map((l) => `<label class="chk"><input type="checkbox" data-col="${esc(l)}" ${on.has(l.toLowerCase()) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}<span class="muted">None ticked = all columns</span></div></details>`;
  };
  const SCOPES = [['message', 'Message text'], ['host', 'Device name'], ['trap', 'SNMP trap name and values'], ['all', 'Message, device and process']];
  const draw = () => {
    el.innerHTML = `<div class="${embedded ? 'toolbar' : 'page-head'}">${embedded ? '' : '<h1>Text replacement</h1>'}<span class="muted">Swap IP addresses, codes or words for readable names as messages arrive.</span><span class="spacer"></span>
      <button id="rpAdd">Add replacement</button><button class="primary" id="rpSave">Save replacements</button></div>
    <div class="panel" style="padding:0;overflow:auto;margin-bottom:14px">${list.length ? `<table class="data"><thead><tr><th>On</th><th>Find</th><th>Replace with</th><th>Find as</th><th>Apply to</th><th title="SNMP traps only: change only this trap value, e.g. alertCurrentStatus. Leave empty for the whole message.">Only in trap value</th><th title="SNMP traps only: the trap columns (of Settings, Trap columns) this replacement changes. All columns when none is ticked. It changes old and new traps when they are shown or exported.">Trap columns</th><th>Messages</th><th>Match case</th><th></th></tr></thead><tbody>${list.map((r, i) => `<tr data-i="${i}">
      <td><input type="checkbox" data-k="enabled" ${r.enabled !== false ? 'checked' : ''} aria-label="Turn on"></td>
      <td><input type="text" data-k="find" style="width:200px" value="${esc(r.find)}" placeholder="10.20.1.5" aria-label="Find"></td>
      <td><input type="text" data-k="replace" style="width:200px" value="${esc(r.replace)}" placeholder="Core-SW1" aria-label="Replace with"></td>
      <td><select data-k="regex" aria-label="Find as"><option value="0" ${r.regex ? '' : 'selected'}>Text</option><option value="1" ${r.regex ? 'selected' : ''}>Regular expression</option></select></td>
      <td><select data-k="scope" aria-label="Apply to">${SCOPES.map(([v, l]) => `<option value="${v}" ${(r.scope || 'message') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td><input type="text" data-k="field" style="width:150px" value="${esc(r.field || '')}" placeholder="e.g. alertCurrentStatus" aria-label="Only in this trap value" title="SNMP traps only. A trap value name (alertCurrentStatus, ifOperStatus.3 or an OID). The rule then changes only that value, so 5 can become Critical there and nowhere else."></td>
      <td>${colPick(r)}</td>
      <td><select data-k="on" aria-label="Messages it applies to" title="Which kind of message this replacement is used on"><option value="both" ${!r.on || r.on === 'both' ? 'selected' : ''}>Syslog and traps</option><option value="syslog" ${r.on === 'syslog' ? 'selected' : ''}>Syslog only</option><option value="snmp" ${r.on === 'snmp' ? 'selected' : ''}>SNMP traps only</option></select></td>
      <td><input type="checkbox" data-k="matchCase" ${r.matchCase ? 'checked' : ''} aria-label="Match case"></td>
      <td><button class="danger" data-del="${i}">Remove</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty"><b>No replacements yet</b>Add one, or paste a list below, to show device names instead of IP addresses.</div>'}</div>
    <p class="muted" style="max-width:760px">Replacements run top to bottom on every new message, before rules, search and alerts, so those all see the new text. Text matches whole words only: <code>10.0.0.1</code> never changes <code>10.0.0.15</code>. <b>For SNMP traps</b> the trap columns are changed when they are shown and exported, so <b>traps that are already stored change too</b>; choose which columns in “Trap columns” (none ticked = all). The Message column and the device name are changed as traps arrive. <b>More on SNMP traps</b> choose “SNMP trap name and values” to change the Trap column and every value in the trap columns, or fill “Only in trap value” (for example <code>alertCurrentStatus</code>, find <code>5</code>, replace <code>Critical</code>) to change one value only. A plain number is never found inside a longer number or an OID. Messages already stored keep the text they arrived with, and the original packet is always shown in the message details. Regular-expression rules only read the first 2000 characters of a message.</p>
    <fieldset><legend>Add many at once</legend>
      <textarea id="bulk" rows="5" placeholder="One per line, for example:&#10;10.20.1.5, Core-SW1&#10;10.20.1.6 = Core-SW2&#10;10.20.9.1 -> Edge-Firewall"></textarea>
      <div class="toolbar" style="margin:10px 0 0"><select id="bulkScope" aria-label="Apply to">${SCOPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><select id="bulkOn" aria-label="Messages"><option value="both">Syslog and traps</option><option value="syslog">Syslog only</option><option value="snmp">SNMP traps only</option></select><button id="bulkAdd">Add these</button></div></fieldset>
    <fieldset><legend>Try it</legend><div class="toolbar"><input type="text" id="rtHost" class="w-md" placeholder="Device name (optional)"><input type="text" id="rtMsg" style="width:420px" placeholder="Paste a message to see what it becomes"><button id="rtRun">Test</button></div><pre class="raw" id="rtOut" style="min-height:2.4em;margin:0"></pre></fieldset>`;
  };
  const load = async () => { list = (await api('/api/config')).replacements || []; draw(); };
  el.addEventListener('input', (e) => { const k = e.target.dataset.k; if (!k) return; const r = list[+e.target.closest('tr').dataset.i]; r[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; });
  el.addEventListener('change', (e) => { const cl = e.target.dataset.col; if (cl === undefined) return; const r = list[+e.target.closest('tr').dataset.i], set = new Set(r.cols || []); if (e.target.checked) set.add(cl); else set.delete(cl); r.cols = [...set]; const sm = e.target.closest('details').querySelector('summary'); sm.textContent = r.cols.length ? (r.cols.length === 1 ? r.cols[0] : r.cols.length + ' columns') : 'All columns'; });
  el.addEventListener('change', (e) => { if (e.target.dataset.k === 'regex') list[+e.target.closest('tr').dataset.i].regex = e.target.value === '1'; });
  el.addEventListener('click', async (e) => {
    const id = e.target.id;
    if (id === 'rpAdd') { list.push({ id: 'p' + Date.now(), enabled: true, find: '', replace: '', regex: false, wholeWord: true, matchCase: false, scope: 'message', on: 'both' }); draw(); }
    if (e.target.dataset.del !== undefined) { list.splice(+e.target.dataset.del, 1); draw(); }
    if (id === 'bulkAdd') {
      let added = 0, skipped = 0;
      for (const line of $('#bulk').value.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const m = /^\s*(.+?)\s*(?:,|=>|->|=|\t)\s*(.+?)\s*$/.exec(line);
        if (!m) { skipped++; continue; }
        list.push({ id: 'p' + Date.now() + added, enabled: true, find: m[1], replace: m[2], regex: false, wholeWord: true, matchCase: false, scope: $('#bulkScope').value, on: $('#bulkOn').value }); added++;
      }
      draw(); toast(`${added} added${skipped ? `, ${skipped} line(s) skipped (use "find, replace with")` : ''} — click Save to apply`, !added && skipped > 0);
    }
    if (id === 'rpSave') { try { const sv = await api('/api/config', { method: 'PUT', body: { replacements: list.filter((r) => r.find) } }); if (S.info?.config) S.info.config.replacements = sv.config?.replacements || list.filter((r) => r.find); toast('Replacements saved — they apply to new messages'); load(); } catch (err) { toast(err.message, true); } }
    if (id === 'rtRun') {
      try { const r = await api('/api/test-replace', { method: 'POST', body: { replacements: list.filter((x) => x.find), host: $('#rtHost').value, message: $('#rtMsg').value } });
        $('#rtOut').textContent = (r.host !== $('#rtHost').value ? `Device: ${r.host}\n` : '') + r.message; } catch (err) { toast(err.message, true); }
    }
  });
  load();
};

// ---------- Settings ------------------------------------------------------------------------------------------------------------------------
const VENDOR_FAMILIES = { cisco: 'Cisco IOS / IOS-XE / NX-OS', dell: 'Dell switches and iDRAC', hp: 'HP / HPE / Aruba switches', apc: 'APC UPS, PDU and NetBotz', eltek: 'Eltek power systems' };
const EMBED_TAB = { users: 'users', backup: 'backup', maintenance: 'maint', rules: 'rules', notifications: 'notify', sqlcopy: 'sqlcopy', reports: 'reports' };   // page -> its tab inside Settings
const SETTINGS_TABS = [['syslog', 'Syslog'], ['snmp', 'SNMP & MIBs'], ['trapcols', 'Trap columns'], ['replace', 'Text replacement'], ['storage', 'Storage & time'], ['access', 'Access & updates'], ['look', 'Look & sound'], ['rules', 'Rules & alerts', 'rules'], ['notify', 'Notifications', 'settings'], ['sqlcopy', 'SQL Server', 'settings'], ['reports', 'Reports', 'reports'], ['probe', 'Remote probes', 'settings'], ['users', 'Users', 'users'], ['backup', 'Backup', 'backup'], ['maint', 'Maintenance', 'rules']];
const TAB_OF = { 'sec-security': 'access', 'sec-inputs': 'syslog', 'sec-replace': 'replace', 'sec-vendor': 'syslog', 'sec-sysmsg': 'syslog', 'sec-fwd': 'syslog', 'sec-snmp': 'snmp', 'sec-trapfwd': 'snmp', 'sec-trapviews': 'trapcols', 'sec-storage': 'storage', 'sec-time': 'storage', 'sec-data': 'storage', 'sec-access': 'access', 'sec-update': 'access', 'sec-tools': 'access', 'sec-sendtest': 'syslog', 'sec-sessions': 'access', 'sec-appearance': 'look', 'sec-sound': 'look', 'sec-rules': 'rules', 'sec-notifs': 'notify', 'sec-sqlcopy': 'sqlcopy', 'sec-reports': 'reports', 'sec-probe': 'probe', 'sec-users': 'users', 'sec-backup': 'backup', 'sec-maint': 'maint' };
function sessionsMount(el) {
  const box = $('#sesBox', el); if (!box) return;
  const ago = (t) => { const s2 = Math.max(0, Math.round((Date.now() - t) / 1000)); return s2 < 60 ? s2 + ' s ago' : s2 < 5400 ? Math.round(s2 / 60) + ' min ago' : s2 < 172800 ? Math.round(s2 / 3600) + ' h ago' : Math.round(s2 / 86400) + ' d ago'; };
  const when = (t) => `${dateOf(t)} ${timeOf(t)}`;
  const load = async () => {
    try {
      const r = await api('/api/sessions');
      box.innerHTML = `${r.signIn ? '' : '<p class="muted">Sign-in is turned off (no dashboard password), so everyone who can reach this page has full access and no sessions are kept. Set a password under Dashboard access.</p>'}
        ${r.sessions.length ? `<div style="overflow:auto"><table class="data"><thead><tr><th>User</th><th>IP address</th><th>Browser</th><th>Signed in</th><th>Last active</th><th>Status</th><th></th></tr></thead><tbody>${r.sessions.map((x) => `<tr data-id="${esc(x.id)}"><td><b>${esc(x.user)}</b>${x.me ? ' <span class="pill">you</span>' : ''}</td><td>${esc(x.ip || '-')}</td><td>${esc(x.browser || '-')}</td><td>${when(x.since)}</td><td>${ago(x.last)}</td><td>${x.online ? '<span class="pill ok">online</span>' : '<span class="pill">idle</span>'}</td><td><button class="danger" data-so="1">${x.me ? 'Sign out (me)' : 'Sign out'}</button></td></tr>`).join('')}</tbody></table></div>` : (r.signIn ? '<p class="muted">Nobody is signed in.</p>' : '')}
        <h4 style="margin:14px 0 6px">Dashboards open right now <span class="muted">(live feed connections)</span></h4>
        ${r.live.length ? `<div style="overflow:auto"><table class="data"><thead><tr><th>User</th><th>IP address</th><th>Browser</th><th>Connected since</th></tr></thead><tbody>${r.live.map((x) => `<tr><td>${esc(x.user || '-')}</td><td>${esc(x.ip)}</td><td>${esc(x.browser || '-')}</td><td>${when(x.since)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">None.</p>'}
        <p class="muted" style="margin-top:8px">Signing a session out ends it at once; the person has to sign in again. Sign-ins and sign-outs are also written to the log as NetEventPro messages (System messages → “Who changed what”).</p>`;
    } catch (e) { box.textContent = e.message; }
  };
  load(); if (el._sesTimer) clearInterval(el._sesTimer); el._sesTimer = setInterval(() => { if (!document.body.contains(el)) clearInterval(el._sesTimer); else if (!document.hidden) load(); }, 10000);
  box.onclick = async (e) => {
    const b = e.target.closest('[data-so]'); if (!b) return; const tr = b.closest('tr'), who = tr.querySelector('b').textContent;
    if (!(await askConfirm(`Sign out “${who}” (${tr.children[1].textContent})? They have to sign in again.`, 'Sign out'))) return;
    try { await api('/api/sessions/revoke', { method: 'POST', body: { id: tr.dataset.id } }); toast('Signed out'); load(); } catch (err) { toast(err.message, true); }
  };
}
function probeMount(el) {
  const list = $('#prList', el); if (!list) return;
  const ago = (t) => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 90 ? m + ' min ago' : m < 2880 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
  const load = async () => {
    try {
      const r = await api('/api/probes');
      list._allow = Object.fromEntries(r.probes.map((x) => [x.id, x.allow || []]));
      list.innerHTML = r.probes.length ? `<table class="data"><thead><tr><th>Name</th><th>Last heard</th><th>From</th><th class="num-r">Packets</th><th></th></tr></thead><tbody>${r.probes.map((x) => `<tr data-id="${esc(x.id)}"><td><b>${esc(x.name)}</b>${x.enabled ? '' : ' <span class="pill">off</span>'}</td><td>${ago(x.last)}</td><td>${esc(x.ip || '')}</td><td class="num-r">${fmtN(x.packets)}</td><td><button data-pa="toggle">${x.enabled ? 'Switch off' : 'Switch on'}</button> <button data-pa="rot" title="Create a new token; the old one keeps working for 24 hours">New token</button> <button data-pa="allow" title="Only accept this probe from these addresses">Addresses${x.allow?.length ? ' (' + x.allow.length + ')' : ''}</button> <button data-pa="del">Remove</button></td></tr>`).join('')}</tbody></table>` : 'No probes yet.';
      const st = $('#prStatus', el); if (st) { const l = r.local; st.innerHTML = l.mode === 'probe' ? `<b>${l.lastError ? 'Not connected' : l.lastOk ? 'Connected' : 'Waiting'}</b> · sent ${fmtN(l.sent)} · waiting in the queue ${fmtN(l.queued)}${l.dropped ? ` · dropped (queue full) ${fmtN(l.dropped)}` : ''}${l.lastOk ? ` · last sent ${ago(l.lastOk)}` : ''}${l.lastError ? `<br><span style="color:var(--s3,#d33)">${esc(l.lastError)}</span>` : ''}` : 'This computer is not running as a probe yet: save the settings and this line will show the connection.'; }
    } catch (e) { list.textContent = e.message; }
  };
  load(); if (el._prTimer) clearInterval(el._prTimer); el._prTimer = setInterval(() => { if (!document.body.contains(el)) clearInterval(el._prTimer); else load(); }, 5000);
  $('#prMode', el).onchange = (e) => { $('#prCentral', el).hidden = e.target.value === 'probe'; $('#prProbe', el).hidden = e.target.value !== 'probe'; };
  $('#prAdd', el).onclick = async () => {
    const name = $('#prName', el).value.trim(); if (!name) return toast('Give the probe a name', true);
    try {
      const r = await api('/api/probes', { method: 'POST', body: { name } }); $('#prName', el).value = ''; const box = $('#prNew', el); box.hidden = false;
      box.innerHTML = `<b>Token for “${esc(r.name)}”</b> — copy it now, it is shown only once.<div class="toolbar" style="margin:6px 0"><input type="text" readonly id="prTok" style="width:380px;font-family:var(--mono,monospace)" value="${esc(r.token)}"><button id="prCopy">Copy</button></div><span class="muted">On the probe PC: Settings → Remote probes → This computer is “A probe”, enter this server's address, this token and the name.</span>`;
      $('#prCopy', box).onclick = () => { $('#prTok', box).select(); navigator.clipboard?.writeText(r.token).then(() => toast('Copied'), () => toast('Press Ctrl+C to copy')); }; load();
    } catch (e) { toast(e.message, true); }
  };
  list.onclick = async (e) => {
    const b = e.target.closest('[data-pa]'); if (!b) return; const id = b.closest('tr').dataset.id, name = b.closest('tr').querySelector('b').textContent;
    try {
      if (b.dataset.pa === 'rot') {
        if (!(await askConfirm(`Create a new token for “${name}”? The old token keeps working for 24 hours: enter the new one on the probe PC before then.`, 'New token'))) return;
        const r = await api('/api/probes/' + id + '/rotate', { method: 'POST', body: {} }); const box = $('#prNew', el); box.hidden = false;
        box.innerHTML = `<b>New token for “${esc(r.name)}”</b> — copy it now, it is shown only once.<div class="toolbar" style="margin:6px 0"><input type="text" readonly id="prTok" style="width:380px;font-family:var(--mono,monospace)" value="${esc(r.token)}"><button id="prCopy">Copy</button></div><span class="muted">Enter it on the probe PC (its page → Main server → Probe token). The old token stops working after 24 hours.</span>`;
        $('#prCopy', box).onclick = () => { $('#prTok', box).select(); navigator.clipboard?.writeText(r.token).then(() => toast('Copied'), () => toast('Press Ctrl+C to copy')); };
      } else if (b.dataset.pa === 'allow') {
        const cur = (list._allow?.[id] || []).join(', '); const v = await askText?.(`Addresses allowed to use the token of “${name}” (empty = any). Example: 203.0.113.5, 10.8.0.0/16`, cur);
        if (v == null) return; await api('/api/probes/' + id + '/allow', { method: 'POST', body: { allow: v } }); toast('Saved');
      } else if (b.dataset.pa === 'del') { if (!(await askConfirm(`Remove the probe “${name}”? It can no longer send to this server.`))) return; await api('/api/probes/' + id, { method: 'DELETE' }); }
      else await api('/api/probes/' + id, { method: 'PATCH', body: { enabled: b.textContent.trim() === 'Switch on' } });
      load();
    } catch (err) { toast(err.message, true); }
  };
}
views.settings = (el) => {
  let snmpCleanup = null; let c; const embedOpen = {}, embedClean = []; const rowsOf = (arr, cols) => arr.map((x, i) => `<tr data-i="${i}">${cols.map((col) => `<td>${col(x, i)}</td>`).join('')}<td><button class="danger" data-del="${i}">Remove</button></td></tr>`).join('');
  const draw = () => {
    const i = S.info, dd = i.dataDirs, sm = c.smtp, ls = i.listeners;
    const keep = { rp: $('#rpHost', el), snmp: $('#snmpHost', el), tv: $('#tvHost', el), us: $('#usersHost', el), bk: $('#backupHost', el), mt: $('#maintHost', el), ru: $('#rulesHost', el), nf: $('#notifHost', el), sq: $('#sqlHost', el), rpt: $('#reportsHost', el) };   // these two sections keep their state when the page is redrawn
    el.innerHTML = `<div class="stickyhead"><div class="page-head"><h1>Settings</h1><span class="spacer"></span><span id="dirtyMsg" class="dirtymsg" aria-live="polite"></span><label class="chk" style="margin:0" title="Show the explanation under each option"><input type="checkbox" id="showNotes" ${S.showNotes ? 'checked' : ''}> Show notes</label><button class="primary" id="saveAll" title="Saves every option on every tab of this page (Ctrl+S)">Save changes</button></div>
    <nav class="jump tabs" role="tablist" aria-label="Settings sections">${SETTINGS_TABS.filter((t) => !t[2] || can(t[2])).map(([id, n]) => `<a href="#settings" role="tab" data-tab="${id}" class="${(S.settingsTab || 'syslog') === id ? 'on' : ''}" aria-selected="${(S.settingsTab || 'syslog') === id}">${n}</a>`).join('')}</nav></div>
    <fieldset id="sec-inputs"><legend>Syslog inputs</legend><div class="form">
      <div class="field"><label>UDP</label><div><label class="chk"><input type="checkbox" id="udpEnabled" ${c.udpEnabled ? 'checked' : ''}> Receive on port</label> <input type="number" id="udpPort" class="w-sm" min="1" max="65535" value="${c.udpPort}"></div></div>
      <div class="field"><label for="udpRecvMB">UDP receive buffer</label><div><input type="number" id="udpRecvMB" class="w-sm" min="1" max="256" value="${c.udpRecvMB || 16}"> MB <span class="muted">A bigger buffer survives bursts of syslog. 16 MB is enough for hundreds of messages per second; use 64 MB or more for very large networks. System health shows what the operating system really granted.</span></div></div>
      <div class="field"><label>TCP</label><div><label class="chk"><input type="checkbox" id="tcpEnabled" ${c.tcpEnabled ? 'checked' : ''}> Receive on port</label> <input type="number" id="tcpPort" class="w-sm" min="1" max="65535" value="${c.tcpPort}"></div></div>
      <div class="field"><label>Secure syslog (TLS)</label><div><label class="chk"><input type="checkbox" id="tlsSyslogEnabled" ${c.tlsSyslogEnabled ? 'checked' : ''}> Receive on port</label> <input type="number" id="tlsSyslogPort" class="w-sm" min="1" max="65535" value="${c.tlsSyslogPort || 6514}"><div class="hint">Secure syslog is normal syslog over TCP inside an encrypted TLS connection (RFC 5425, standard port 6514). Nobody on the network can read the messages or change them on the way. It uses the same certificate as the HTTPS dashboard (Access &amp; updates). The device must trust that certificate and send to this port with TLS switched on. ${ls?.tls?.error ? `<br><span style="color:var(--bad)">${esc(ls.tls.error)}</span>` : ls?.tls?.running ? `<br>Listening · ${fmtN(ls.tls.packets)} messages · ${fmtN(ls.tls.handshakeErrors)} failed connections (a device that does not trust the certificate).` : ''}</div></div></div>
      <div class="field"><label for="syslogBind">Listen on address</label><div><input type="text" id="syslogBind" class="w-md" value="${esc(c.syslogBind)}"><div class="hint">0.0.0.0 accepts messages from every network adapter. Standard syslog port is 514.</div></div></div>
      <div class="field"><label for="allowedSources">Accept syslog only from</label><div><textarea id="allowedSources" rows="3" placeholder="Empty = accept from every device&#10;10.20.0.0/16&#10;192.168.1.50">${esc((c.allowedSources || []).join('\n'))}</textarea><div class="hint">One IPv4 address or range (like 10.20.0.0/16) per line. Anyone on the network can send fake syslog to an open receiver, so list your devices here. Include 127.0.0.1 to test from this computer. Refused so far: UDP ${fmtN(ls.udp.rejected || 0)}, TCP ${fmtN(ls.tcp.rejected || 0)}.</div></div></div></div></fieldset>
    <fieldset id="sec-access"><legend>Dashboard access</legend><div class="form">
      <div class="field"><label>Who can open it</label><div><select id="webBindSel"><option value="127.0.0.1" ${c.webBind === '127.0.0.1' ? 'selected' : ''}>This computer only</option><option value="0.0.0.0" ${c.webBind === '0.0.0.0' ? 'selected' : ''}>Other computers on the network</option></select> on port <input type="number" id="webPort" class="w-sm" value="${c.webPort}"></div></div>
      <div class="field"><label for="adminPassword">Password</label><div><input type="password" id="adminPassword" class="w-md" value="${esc(c.adminPassword)}" autocomplete="new-password" placeholder="No password"><div class="hint">At least 8 characters. User name is <b>admin</b>. Required before other computers can connect. Five wrong passwords lock that computer out for 5 minutes. Leave empty for no password.</div></div></div>
      <div class="field"><label for="sessIdle">Sign out after</label><div>${(() => { const P = [[1, '1 hour'], [4, '4 hours'], [12, '12 hours'], [24, '1 day'], [168, '1 week'], [0, 'Never (stay signed in)']]; const v = c.sessionIdleHours ?? 12; return `<select id="sessIdle">${P.map(([h, n]) => `<option value="${h}" ${v === h ? 'selected' : ''}>${n} without use</option>`.replace('Never (stay signed in) without use', 'Never (stay signed in)')).join('')}${P.some(([h]) => h === v) ? '' : `<option value="${v}" selected>${v} hours without use</option>`}</select>`; })()} <select id="sessMax" aria-label="Longest sign-in">${(() => { const P = [[1, '1 day'], [7, '7 days'], [30, '30 days'], [90, '90 days'], [0, 'No limit']]; const v = c.sessionMaxDays ?? 7; return P.map(([d, n]) => `<option value="${d}" ${v === d ? 'selected' : ''}>at most ${n}</option>`.replace('at most No limit', 'no overall limit')).join('') + (P.some(([d]) => d === v) ? '' : `<option value="${v}" selected>at most ${v} days</option>`); })()}</select>
        <div class="hint">Use “Never” for a monitoring PC that must always show the dashboard. People stay signed in while the page is open, and also after the service restarts or is updated. Signing out, or changing any password, still ends the sign-in. Choose a short time on shared computers.</div></div></div>
      <div class="field"><label for="tlsCert">HTTPS (optional)</label><div><input type="text" id="tlsCert" style="width:100%" value="${esc(c.tlsCertFile)}" placeholder="Certificate file, for example C:\\certs\\neteventpro.crt"><input type="text" id="tlsKey" style="width:100%;margin-top:6px" value="${esc(c.tlsKeyFile)}" placeholder="Private key file, for example C:\\certs\\neteventpro.key"><div class="hint">PEM files. Without HTTPS the password and log data cross the network unencrypted, so use it whenever other computers connect. Needs a service restart.</div><div class="toolbar" style="margin:8px 0 0"><button type="button" id="httpsMake">Create a certificate here…</button><a class="btn" id="httpsDl" href="/api/https/cert" download hidden>Download certificate</a></div><div id="httpsInfo" class="hint"></div></div></div></div></fieldset>
    <fieldset id="sec-time"><legend>Time (NTP)</legend><div class="form">
      <p class="muted" style="margin:0">The clock in the top bar can follow your own NTP server, so everyone sees the same trusted time. This only changes the dashboard clock: it does not change the clock of this PC or the time stored with messages.</p>
      <label class="chk"><input type="checkbox" id="ntpOn" ${c.ntp?.enabled ? 'checked' : ''}> Take the time from an NTP server</label>
      <div class="field"><label for="ntpServer">NTP server</label><div><input type="text" id="ntpServer" class="w-md" value="${esc(c.ntp?.server || '')}" placeholder="10.0.0.5 or ntp.corp.local"> port <input type="number" id="ntpPort" class="w-sm" min="1" max="65535" value="${c.ntp?.port || 123}"> <button type="button" id="ntpTest">Test</button> <span id="ntpResult" class="muted"></span><div class="hint">Uses UDP. Allow outgoing UDP 123 from this PC to the server.</div></div></div>
      <div class="field"><label for="ntpEvery">Check every</label><div><input type="number" id="ntpEvery" class="w-sm" min="1" max="1440" value="${c.ntp?.intervalMin || 15}"> minutes</div></div>
      <div class="field"><label for="ntpZone">Show time in</label><div><input type="text" id="ntpZone" class="w-md" list="zoneList" value="${esc(c.ntp?.zone || '')}" placeholder="Same as the browser"><datalist id="zoneList">${(Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : []).map((z) => `<option value="${esc(z)}">`).join('')}</datalist><div class="hint">A time zone name such as Asia/Dubai. Empty = each person's own browser setting.</div></div></div>
    </div></fieldset>
    <fieldset id="sec-storage"><legend>Storage</legend><div class="form">
      <div class="field"><label for="retSel">Keep messages and traps for</label><div>${(() => { const P = [[30, '30 days'], [90, '3 months'], [180, '6 months'], [365, '1 year'], [730, '2 years'], [1825, '5 years'], [0, 'Keep everything (never delete)']]; const known = P.some(([d]) => d === c.retentionDays); return `<select id="retSel">${P.map(([d, n]) => `<option value="${d}" ${c.retentionDays === d ? 'selected' : ''}>${n}</option>`).join('')}<option value="custom" ${known ? '' : 'selected'}>Another number of days…</option></select> <input type="number" id="retentionDays" class="w-sm" min="1" max="36500" value="${c.retentionDays || 30}" ${known ? 'hidden' : ''}> <span id="retDaysLbl" ${known ? 'hidden' : ''}>days</span>`; })()}
        <div class="hint">Older syslog messages and SNMP traps are deleted once a day. Choose “Keep everything” to never delete by age. The database is built for this: searching and paging stay fast with tens of millions of rows, and the screens only count up to 100,000 matches.</div></div></div>
      <div class="field"><label for="alarmRet">Keep cleared alarms for</label><div><select id="alarmRet">${[[-1, 'Same as messages'], [0, 'Keep everything (never delete)'], [90, '3 months'], [365, '1 year'], [730, '2 years'], [1825, '5 years']].map(([d, n]) => `<option value="${d}" ${(c.alarmRetentionDays ?? -1) === d ? 'selected' : ''}>${n}</option>`).join('')}${[-1, 0, 90, 365, 730, 1825].includes(c.alarmRetentionDays ?? -1) ? '' : `<option value="${c.alarmRetentionDays}" selected>${c.alarmRetentionDays} days</option>`}</select><div class="hint">Open and acknowledged alarms are never deleted. This only limits the cleared history.</div></div></div>
      <div class="field"><label for="maxDbMB">Maximum database size</label><div><input type="number" id="maxDbMB" class="w-sm" min="0" value="${c.maxDbMB}"> MB <span class="hint">0 = no size limit</span><div class="hint">Currently ${S.stats?.db.sizeMB ?? '?'} MB. When the limit is reached the oldest messages are removed first, even if the time above has not passed. To keep everything, set 0 here too and keep an eye on the free disk space (Health page warns you).</div></div></div>
      <div class="field"><label for="liveBufferSize">Live view memory</label><div><input type="number" id="liveBufferSize" class="w-sm" min="100" value="${c.liveBufferSize}"> messages</div></div>
      <div class="field"><label for="silentDeviceMinutes">Silent device alert</label><div><input type="number" id="silentDeviceMinutes" class="w-sm" min="0" value="${c.silentDeviceMinutes}"> minutes <div class="hint">Raises an error message when a known device stops sending. 0 turns it off.</div></div></div>
      <div class="field"><label for="diskWarnPercent">Disk space alerts</label><div><label class="chk"><input type="checkbox" id="healthAlerts" ${c.healthAlerts !== false ? 'checked' : ''}> Add a NetEventPro message when a self-check changes (see Health)</label><br>
        Warn below <input type="number" id="diskWarnPercent" class="w-sm" min="2" max="90" value="${c.diskWarnPercent ?? 15}"> % free, critical below <input type="number" id="diskCritPercent" class="w-sm" min="1" max="89" value="${c.diskCritPercent ?? 5}"> % free on the data drive</div></div>
      <div class="field"><label>Plain-text log files</label><div><label class="chk"><input type="checkbox" id="rawLogEnabled" ${c.rawLogEnabled ? 'checked' : ''}> Also write every message to a daily text file</label><div class="hint">One file per day in <code>${esc(dd.rawLogs)}</code>, one line per message, exactly as received. Easy to search with any text tool. Deleted after the retention period above.</div></div></div></div></fieldset>
    <fieldset id="sec-snmp"><legend>SNMP &amp; MIBs</legend><div id="snmpHost"></div></fieldset>
    <fieldset id="sec-trapviews"><legend>Trap column views</legend><div id="tvHost"></div></fieldset>
    <fieldset id="sec-replace"><legend>Text replacement <span class="muted">(syslog messages and/or SNMP traps: choose per entry)</span></legend><div id="rpHost"></div></fieldset>
    <fieldset id="sec-probe"><legend>Remote probes <span class="muted">(devices in another network)</span></legend>
      <p class="muted" style="margin-top:0;max-width:820px">Install NetEventPro on a PC in the other network and set it to <b>Probe</b>. Devices there send syslog and traps to the probe; the probe sends everything over HTTPS to this server, which handles it as if it had received it itself (names, rules, alarms, reports). If the link is down the probe keeps the messages and sends them when it is back. Messages from a probe carry the tag <code>probe:&lt;name&gt;</code> (search with <code>tag:probe:Site-B</code>).</p>
      <div class="field"><label for="prMode">This computer is</label><div><select id="prMode"><option value="central" ${c.mode !== 'probe' ? 'selected' : ''}>The main NetEventPro (receives from devices and from probes)</option><option value="probe" ${c.mode === 'probe' ? 'selected' : ''}>A probe (receives here, sends to the main NetEventPro)</option></select><div class="hint">After switching, the service restarts and this computer runs as a lean probe: no database, rules or reports, only receiving, queueing and sending. The page at this address then shows a small status and settings page (this computer only).</div></div></div>
      <div id="prCentral" ${c.mode === 'probe' ? 'hidden' : ''}>
        <h4 style="margin:14px 0 6px">Probes allowed to send to this server</h4>
        <p class="muted" style="margin:0 0 8px;max-width:820px">Each probe gets its own token. The probe PC must reach this server's dashboard port over HTTPS (or HTTP inside a safe network). Open the dashboard to the network first: Access &amp; updates → who can open the dashboard (a password is required).</p>
        <div id="prList" class="muted">Loading…</div>
        <div class="toolbar" style="margin-top:8px"><input type="text" id="prName" class="w-md" placeholder="Probe name, e.g. Site-B"><button id="prAdd">Add probe</button></div>
        <div id="prNew" class="panel" hidden style="margin-top:8px"></div>
      </div>
      <div id="prProbe" ${c.mode === 'probe' ? '' : 'hidden'}>
        <h4 style="margin:14px 0 6px">Where to send</h4>
        <div class="field"><label for="prServer">Main server address</label><div><input type="text" id="prServer" style="width:340px" value="${esc(c.probe?.server)}" placeholder="https://nms.example.com:8514"></div></div>
        <div class="field"><label for="prToken">Probe token</label><div><input type="password" id="prToken" style="width:340px" value="${esc(c.probe?.token)}" autocomplete="off" placeholder="paste the token made on the main server"></div></div>
        <div class="field"><label for="prNameP">This probe's name</label><div><input type="text" id="prNameP" class="w-md" value="${esc(c.probe?.name)}" placeholder="same as on the main server"></div></div>
        <div class="field"><label>Certificate</label><div><label class="chk"><input type="checkbox" id="prSelf" ${c.probe?.allowSelfSigned ? 'checked' : ''}> Accept a self-signed certificate of the main server</label></div></div>
        <div id="prStatus" class="muted">Checking…</div>
      </div>
    </fieldset>
    <fieldset id="sec-users"><legend>Users, roles and groups</legend><div id="usersHost" class="embed"></div></fieldset>
    <fieldset id="sec-backup"><legend>Backup and restore</legend><div id="backupHost" class="embed"></div></fieldset>
    <fieldset id="sec-maint"><legend>Maintenance windows</legend><div id="maintHost" class="embed"></div></fieldset>
    <fieldset id="sec-sysmsg"><legend>System messages <span class="muted">(NetEventPro's own messages in the log)</span></legend><p class="muted" style="margin-top:0;max-width:760px">NetEventPro writes some messages about itself into the log under the device name “NetEventPro”. Switch off what you do not want to see. Alarms and emails that the health checks send are not affected.</p>
      <div class="form"><label class="chk"><input type="checkbox" data-sm="all" ${c.systemMessages?.all !== false ? 'checked' : ''}> Write NetEventPro's own messages to the log (switch off for none)</label>
      <label class="chk"><input type="checkbox" data-sm="health" ${c.systemMessages?.health !== false ? 'checked' : ''}> Health check changes (failed, recovered)</label>
      <label class="chk"><input type="checkbox" data-sm="silent" ${c.systemMessages?.silent !== false ? 'checked' : ''}> Silent devices (“No messages from …”, “sending again”)</label>
      <label class="chk"><input type="checkbox" data-sm="audit" ${c.systemMessages?.audit !== false ? 'checked' : ''}> Who changed what (settings, rules, users, deletions)</label></div></fieldset>
    <fieldset id="sec-vendor"><legend>Vendor recognition <span class="muted">(adds tags to syslog messages and trap texts)</span></legend><p class="muted" style="margin-top:0;max-width:760px">Recognises common messages from these makers and adds short tags, for example <code>cisco</code>, <code>link-down</code>, <code>if:Gi1/0/1</code>, <code>on-battery</code>, <code>mains-failure</code>. Search them on the Logs page with <code>tag:link-down</code>, or use “Has tag” in a rule. Nothing in the message itself is changed.</p>
      <div class="form">${Object.entries(VENDOR_FAMILIES).map(([k, n]) => `<label class="chk"><input type="checkbox" data-vendor="${k}" ${c.vendorParsers?.[k] !== false ? 'checked' : ''}> ${esc(n)}</label>`).join('')}</div>
      <div class="hint" style="max-width:760px;margin-top:8px">The patterns follow wording these makers commonly use. Your firmware may phrase things differently: a message that is not recognised just gets no tag, and you can add your own with a rule (“Message contains” + “Tag”). Applies to new messages only.</div></fieldset>
    <fieldset id="sec-update"><legend>Updates</legend>
      <div class="upbar"><div><b>NetEventPro ${esc(S.info.version)}</b> <span id="upState" class="muted"></span></div><span class="spacer"></span><button id="updGo" class="primary">Check for updates</button> <button id="upNode" class="primary" hidden>Update Node.js</button></div>
      <div id="upBox" class="small" style="margin-top:6px"></div></fieldset>
    <fieldset id="sec-appearance"><legend>Appearance</legend><div class="form"><div class="field"><label for="themeSel">Colour theme</label><div><select id="themeSel">${window.NEP.THEMES.map(([id, n]) => `<option value="${id}" ${document.documentElement.dataset.theme === id ? 'selected' : ''}>${n}</option>`).join('')}</select> <span class="muted">Applies at once. Saved in this browser.</span></div></div>
      <div class="field"><label for="dashSel">Dashboard theme</label><div><select id="dashSel">${window.NEP.DASHES.map(([id, n]) => `<option value="${id}" ${document.documentElement.dataset.dash === id ? 'selected' : ''}>${n}</option>`).join('')}</select> <span class="muted">Changes only the look of the Dashboard page (the layout stays the same). Saved in this browser.</span></div></div></div></fieldset>
    <fieldset id="sec-sound"><legend>Sound and desktop alerts</legend><label class="chk"><input type="checkbox" id="soundOn" ${S.sound ? 'checked' : ''}> Play a sound when a rule with the “Sound” action matches or a new alarm is raised</label> <button id="soundTest">Test normal sound</button> <button id="soundTestCrit">Test critical sound</button>
      <div class="form" style="margin-top:8px"><div class="field"><label for="sndNormal">Normal alerts</label><div><select id="sndNormal">${Object.entries(SOUNDS).map(([k, v]) => `<option value="${k}" ${SOUND_PREF().normal === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div></div>
      <div class="field"><label for="sndCrit">Critical (Emergency, Alert, Critical)</label><div><select id="sndCrit">${Object.entries(SOUNDS).map(([k, v]) => `<option value="${k}" ${SOUND_PREF().crit === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div></div>
      <div class="field"><label for="sndVol">Volume</label><div><input type="range" id="sndVol" min="5" max="100" value="${Math.round(SOUND_PREF().vol * 100)}"></div></div></div>
      <div class="hint" style="max-width:700px">Saved in this browser only, and the dashboard page must stay open. Turning it on also lets rules show desktop notifications: the browser asks for permission once.</div></fieldset>
    <fieldset id="sec-rules"><legend>Rules &amp; alerts</legend><div id="rulesHost" class="embed"></div></fieldset>
    <fieldset id="sec-notifs"><legend>Notifications</legend><div id="notifHost" class="embed"></div></fieldset>
    <fieldset id="sec-sqlcopy"><legend>SQL Server</legend><div id="sqlHost" class="embed"></div></fieldset>
    <fieldset id="sec-reports"><legend>Reports</legend><div id="reportsHost" class="embed"></div></fieldset>
    <fieldset id="sec-fwd"><legend>Forward syslog to another collector</legend><p class="muted" style="margin-top:0">Relay every received <b>syslog</b> message to a SIEM or second syslog server (SNMP traps are forwarded below). Messages dropped by rules are not forwarded. The original text is sent, before any text replacement.</p>
      <table class="data"><tbody id="fwRows">${rowsOf(c.forwardTargets, [(t) => `<input type="text" class="w-md" data-f="name" placeholder="Name" value="${esc(t.name)}">`, (t) => `<input type="text" class="w-md" data-f="host" placeholder="Host or IP" value="${esc(t.host)}">`, (t) => `<input type="number" class="w-sm" data-f="port" value="${t.port}">`, (t) => `<select data-f="protocol"><option ${t.protocol === 'udp' ? 'selected' : ''}>udp</option><option ${t.protocol === 'tcp' ? 'selected' : ''}>tcp</option></select>`, (t) => `<select data-f="minSeverity" title="Only forward this severity or worse"><option value="">all severities</option>${SEV.map((s, k) => `<option value="${k}" ${String(t.minSeverity) === String(k) ? 'selected' : ''}>${s} or worse</option>`).join('')}</select>`])}</tbody></table><div class="toolbar" style="margin-top:8px"><button id="addFw">Add destination</button></div></fieldset>
    <fieldset id="sec-trapfwd"><legend>Forward SNMP traps (northbound to another manager)</legend><p class="muted" style="margin-top:0;max-width:780px">Send every received <b>SNMP trap</b> on to an upper-level NMS (for example a central manager or an alarm platform) as a new SNMP trap with the same values. In SNMPv2c the original sender's address is added as <code>snmpTrapAddress.0</code> so the manager can tell which device it came from. Traps dropped by rules are not forwarded.</p>
      <table class="data"><tbody id="tfRows">${rowsOf(c.trapForwardTargets || [], [(t) => `<input type="text" class="w-md" data-f="name" placeholder="Name" value="${esc(t.name)}">`, (t) => `<input type="text" class="w-md" data-f="host" placeholder="Manager host or IP" value="${esc(t.host)}">`, (t) => `<input type="number" class="w-sm" data-f="port" value="${t.port}" title="UDP port, usually 162">`, (t) => `<input type="text" class="w-md" data-f="community" placeholder="Community" value="${esc(t.community || 'public')}" autocomplete="off">`, (t) => `<select data-f="version" title="Trap format"><option value="v2c" ${t.version !== 'v1' ? 'selected' : ''}>SNMPv2c</option><option value="v1" ${t.version === 'v1' ? 'selected' : ''}>SNMPv1</option><option value="v3" ${t.version === 'v3' ? 'selected' : ''}>SNMPv3</option></select>`,
        (t) => { const o = (list, cur) => list.map((x) => `<option ${cur === x ? 'selected' : ''}>${x}</option>`).join(''); return `<div class="v3cell" ${t.version === 'v3' ? '' : 'hidden'} style="display:${t.version === 'v3' ? 'flex' : 'none'};flex-wrap:wrap;gap:4px;max-width:420px"><input type="text" class="w-sm" data-f="user" placeholder="v3 user" value="${esc(t.user)}" autocomplete="off"><select data-f="level"><option value="authPriv" ${(t.level || 'authPriv') === 'authPriv' ? 'selected' : ''}>auth + encryption</option><option value="authNoPriv" ${t.level === 'authNoPriv' ? 'selected' : ''}>auth only</option><option value="noAuthNoPriv" ${t.level === 'noAuthNoPriv' ? 'selected' : ''}>none</option></select><select data-f="authProto" title="Authentication">${o(['SHA', 'MD5', 'SHA224', 'SHA256', 'SHA384', 'SHA512'], t.authProto || 'SHA')}</select><input type="password" class="w-sm" data-f="authPass" placeholder="auth password" value="${esc(t.authPass)}" autocomplete="new-password"><select data-f="privProto" title="Encryption">${o(['AES128', 'AES192', 'AES256', 'DES'], t.privProto || 'AES128')}</select><input type="password" class="w-sm" data-f="privPass" placeholder="encryption password" value="${esc(t.privPass)}" autocomplete="new-password"></div>`; }, (t) => `<select data-f="minSeverity" title="Only forward this severity or worse"><option value="">all severities</option>${SEV.map((s, k) => `<option value="${k}" ${String(t.minSeverity) === String(k) ? 'selected' : ''}>${s} or worse</option>`).join('')}</select>`])}</tbody></table><div class="toolbar" style="margin-top:8px"><button id="addTf">Add manager</button></div><p class="muted" style="max-width:820px">For <b>SNMPv3</b> this computer is the sending engine: on the receiving manager create the user with the same protocols and passwords, and give it this <b>engine ID</b>: <code id="v3Engine">…</code> (it never changes). Passwords must be at least 8 characters.</p></fieldset>
    <fieldset id="sec-data"><legend>Where your data is stored</legend>
      <table class="data"><tbody>${[['Message database', dd.db], ['Settings file', dd.config], ['Plain-text logs', dd.rawLogs], ['Service logs', dd.serviceLogs], ['Data folder', dd.data]].map(([n, p]) => `<tr><td>${n}</td><td><code>${esc(p)}</code></td><td style="text-align:right"><button data-copy="${esc(p)}">Copy path</button></td></tr>`).join('')}</tbody></table>
      <p class="muted" style="max-width:780px;margin-bottom:0">To browse these files, open the Start menu entry “NetEventPro data folder”, or paste a path into the File Explorer address bar. The folder is limited to administrators, so Windows asks you to continue. The database is a standard SQLite file with one table, <code>logs</code>: open it with a free viewer such as DB Browser for SQLite. While the service runs, copy <b>all</b> the <code>syslog.db*</code> files together, or stop the service first.</p></fieldset>
    <fieldset id="sec-sendtest"><legend>Send a test message</legend><p class="muted" style="margin-top:0">Sends one syslog message to this server, to see it arrive on the Logs page and test rules, alarms and forwarding. (Test SNMP traps: SNMP &amp; MIBs → Check the receiver.)</p><div class="form">
      <div class="field"><label>Send a test message</label><div class="toolbar" style="margin:0"><select id="tSev">${SEV.slice(0, 8).map((s, k) => `<option value="${k}" ${k === 3 ? 'selected' : ''}>${s}</option>`).join('')}</select><input type="text" id="tMsg" value="Test message from the dashboard" style="width:260px"><button id="tSend">Send</button></div></div>
</div></fieldset>
    <fieldset id="sec-security"><legend>Security <span class="muted">(passwords, two-factor, who may connect, audit log)</span></legend>
      <div id="secBox" class="muted">Loading…</div>
    </fieldset>
    <fieldset id="sec-sessions"><legend>Login sessions <span class="muted">(who is using the dashboard)</span></legend>
      <div id="sesBox" class="muted">Loading…</div>
    </fieldset>
    <fieldset id="sec-tools"><legend>Service</legend><div class="form">
      <div class="field"><label>Service</label><div class="toolbar" style="margin:0"><button id="restart">Restart service</button><button class="danger" id="wipe">Delete all stored messages</button></div></div>
      <div class="field"><label>About</label><div class="muted">NetEventPro v${esc(i.version)} · Node ${esc(i.node)}${i.https ? ' · HTTPS on' : ''}</div></div></div></fieldset>`;
    if (keep.rp) $('#rpHost', el).replaceWith(keep.rp); else views.replace($('#rpHost', el), null, true);
    if (keep.snmp) $('#snmpHost', el).replaceWith(keep.snmp); else snmpCleanup = views.snmp($('#snmpHost', el), null, true);
    api('/api/update/status').then(upShow).catch(() => {});
    if (keep.tv) $('#tvHost', el).replaceWith(keep.tv); else trapViewsEditor($('#tvHost', el));
    for (const [k, id, v] of [['us', 'usersHost', 'users'], ['bk', 'backupHost', 'backup'], ['mt', 'maintHost', 'maintenance'], ['ru', 'rulesHost', 'rules'], ['nf', 'notifHost', 'notifications'], ['sq', 'sqlHost', 'sqlcopy'], ['rpt', 'reportsHost', 'reports']]) { if (keep[k]) $('#' + id, el).replaceWith(keep[k]); else { const h = $('#' + id, el); if (S.settingsTab === EMBED_TAB[v] || embedOpen[id]) { embedOpen[id] = 1; const cl = views[v](h, null, true); if (cl) embedClean.push(cl); } } }
    if (S.jump) { if (TAB_OF[S.jump]) S.settingsTab = TAB_OF[S.jump]; S.jump = null; }
    el.classList.add('scompact'); el.classList.toggle('shownotes', !!S.showNotes);
    $$('fieldset[id^="sec-"]', el).forEach((f) => {   /* long explanations become a small (i) button; sections with their own Save button say so */
      f.classList.toggle('own-save', !!f.querySelector(':scope > .embed'));
      const intro = f.querySelector(':scope > p.muted:not([id])'), leg = f.querySelector(':scope > legend');
      const fold = (n, host, before) => { if (!n || n.id || n.dataset.fold || n.querySelector('input,button,select,textarea') || /var\(--bad\)/.test(n.innerHTML) || n.textContent.length < 40) return; n.dataset.fold = '1'; n.classList.add('note'); const b = document.createElement('button'); b.type = 'button'; b.className = 'info'; b.textContent = 'i'; b.title = 'Show or hide the note'; b.setAttribute('aria-label', 'Show or hide the note'); b.addEventListener('click', () => n.classList.toggle('open')); host.insertBefore(b, before || null); };
      fold(intro, leg, null);
      $$('.hint, .muted.small', f).forEach((h) => { if (h.closest('.embed')) return; const host = h.parentNode; fold(h, host, h); });
    });
    setDirty(dirty);
    showTab();
    httpsRefresh(el);
    probeMount(el); sessionsMount(el); securityMount(el);
    api('/api/snmp').then((r) => { const e = $('#v3Engine', el); if (e) e.textContent = r.engineId || '-'; }).catch(() => {});
  };
  const showTab = () => {      // one group of sections at a time; all stay in the page so Save settings keeps every value
    const tab = SETTINGS_TABS.some(([id]) => id === S.settingsTab) ? S.settingsTab : 'syslog';
    $$('fieldset[id^="sec-"]', el).forEach((f) => { f.hidden = (TAB_OF[f.id] || 'syslog') !== tab; });
    $$('nav.tabs a', el).forEach((a) => { const on = a.dataset.tab === tab; a.classList.toggle('on', on); a.setAttribute('aria-selected', on); });
  };
  const collect = (sel) => $$(sel + ' tr', el).map((tr) => Object.fromEntries($$('[data-f]', tr).map((x) => [x.dataset.f, x.value])));
  const sync = () => { c.forwardTargets = collect('#fwRows').map((t) => ({ ...t, port: +t.port, enabled: true })); c.trapForwardTargets = collect('#tfRows').map((t) => ({ ...t, port: +t.port, enabled: true })); };
  let dirty = false;
  const setDirty = (v) => { dirty = v; const m = $('#dirtyMsg', el), b = $('#saveAll', el); if (m) { m.textContent = v ? '● Unsaved changes' : '✓ All changes saved'; m.classList.toggle('on', v); } if (b) b.classList.toggle('pulse', v); };
  const onEdit = (e) => { const t = e.target; if (!t || !t.closest || t.closest('.embed, .jump') || /^(showNotes|themeSel|dashSel|soundOn|sndNormal|sndCrit|sndVol|tSev|tMsg|ntpResult)$/.test(t.id)) return; if (!dirty) setDirty(true); };
  el.addEventListener('input', onEdit); el.addEventListener('change', onEdit);
  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && $('#saveAll', el)) { e.preventDefault(); $('#saveAll', el).click(); } };
  const onLeave = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  document.addEventListener('keydown', onKey); window.addEventListener('beforeunload', onLeave);
  const load = async () => { c = await api('/api/config'); dirty = false; draw(); };
  el.addEventListener('click', async (e) => {
    if (e.target.closest('#rpHost, #snmpHost, #tvHost, #usersHost, #backupHost, #maintHost, #rulesHost, #notifHost, #sqlHost, #reportsHost')) return;   // those sections handle their own clicks
    const tabA = e.target.closest('a[data-tab]'); if (tabA) { e.preventDefault(); S.settingsTab = tabA.dataset.tab; const hid = { users: ['usersHost', 'users'], backup: ['backupHost', 'backup'], maint: ['maintHost', 'maintenance'], rules: ['rulesHost', 'rules'], notify: ['notifHost', 'notifications'], sqlcopy: ['sqlHost', 'sqlcopy'], reports: ['reportsHost', 'reports'] }[S.settingsTab]; if (hid && !embedOpen[hid[0]]) { embedOpen[hid[0]] = 1; const cl = views[hid[1]]($('#' + hid[0], el), null, true); if (cl) embedClean.push(cl); } showTab(); window.scrollTo?.(0, 0); return; }
    const id = e.target.id; sync();
    if (e.target.dataset.copy !== undefined) return copyText(e.target.dataset.copy);
    if (id === 'showNotes') { S.showNotes = e.target.checked; el.classList.toggle('shownotes', S.showNotes); return; }
    if (id === 'addTf' || id === 'addFw' || e.target.dataset.del !== undefined) dirty = true;
    if (id === 'addTf') { (c.trapForwardTargets ||= []).push({ name: '', host: '', port: 162, community: 'public', version: 'v2c', enabled: true, minSeverity: '' }); draw(); }
    if (id === 'addFw') { c.forwardTargets.push({ name: '', host: '', port: 514, protocol: 'udp', enabled: true, minSeverity: '' }); draw(); }
    if (e.target.dataset.del !== undefined) { const body = e.target.closest('tbody').id; const i = +e.target.dataset.del; (body === 'tfRows' ? c.trapForwardTargets : c.forwardTargets).splice(i, 1); draw(); }
    if (id === 'updGo') {
      if (!S.upAvail) { e.target.disabled = true; e.target.textContent = 'Checking…'; try { upShow(await api('/api/update/check', { method: 'POST', body: {} })); } catch (er) { upShow({ error: er.message }); } e.target.disabled = false; return; }
      if (!await askConfirm('Update now? The service restarts for a few seconds and messages sent during that moment may be lost. Your settings and data are kept. If the new version fails to start, the old one is put back automatically.', 'Update')) return;
      e.target.disabled = true; e.target.textContent = 'Updating…';
      try { const r = await api('/api/update/install', { method: 'POST', body: { confirm: 'INSTALL' } }); $('#upBox').innerHTML = `Version ${esc(r.version)} installed. Restarting…`; for (let i = 0; i < 45; i++) { await new Promise((ok) => setTimeout(ok, 2000)); try { const x = await fetch('/api/update/status', { cache: 'no-store' }); if (x.status < 500 && i > 1) break; } catch {} } location.reload(); }
      catch (er) { e.target.disabled = false; upShow({ error: er.message }); }
      return;
    }
    if (id === 'upNode') { if (!await askConfirm('Update Node.js now? The program downloads it from nodejs.org, tests it, swaps node.exe (the old one is kept as node.exe.old) and restarts the service. This takes about a minute and messages sent during the restart may be lost.', 'Update Node.js')) return; $('#upNode').disabled = true; toast('Downloading Node.js…'); try { const r = await api('/api/update/node', { method: 'POST', body: { confirm: 'INSTALL NODE' } }); toast(`Node.js ${r.version} installed. Restarting…`); setTimeout(() => location.reload(), 10000); } catch (e) { toast(e.message, true); $('#upNode').disabled = false; } return; }
    if (id === 'soundTest' || id === 'soundTestCrit') { if (!S.sound) setSound(true); wakeAudio(); beep.last = 0; beep(id === 'soundTest' ? 4 : 1, true); }
    if (id === 'tSend') { await api('/api/test-message', { method: 'POST', body: { severity: +$('#tSev').value, message: $('#tMsg').value } }); toast('Test message sent — see it on the Logs page'); }
    if (id === 'restart') restartService();
    if (id === 'ntpTest') { const out = $('#ntpResult', el); out.textContent = 'Asking…'; try { const r = await api('/api/ntp/test', { method: 'POST', body: { server: $('#ntpServer').value.trim(), port: +$('#ntpPort').value || 123 } }); out.style.color = r.ok ? 'var(--ok)' : 'var(--s1)'; out.textContent = r.ok ? `Works — stratum ${r.stratum}, this PC is ${r.offsetMs} ms off, round trip ${r.delayMs} ms` : r.error; } catch (err) { out.style.color = 'var(--s1)'; out.textContent = err.message; } return; }
    if (id === 'httpsMake') return httpsWizard(el);
    if (id === 'wipe' && await askConfirm('Delete ALL stored messages? This cannot be undone.')) { await api('/api/clear', { method: 'POST' }); toast('All messages deleted'); }
    if (id === 'saveAll') {
      const v = (k) => $('#' + k).value, ck = (k) => $('#' + k).checked;
      const body = { tlsSyslogEnabled: ck('tlsSyslogEnabled'), tlsSyslogPort: +v('tlsSyslogPort') || 6514, udpEnabled: ck('udpEnabled'), tcpEnabled: ck('tcpEnabled'), udpPort: +v('udpPort'), udpRecvMB: +v('udpRecvMB') || 16, tcpPort: +v('tcpPort'), syslogBind: v('syslogBind').trim(), allowedSources: v('allowedSources'),
        webBind: v('webBindSel'), webPort: +v('webPort'), adminPassword: v('adminPassword'), tlsCertFile: v('tlsCert').trim(), tlsKeyFile: v('tlsKey').trim(),
        retentionDays: v('retSel') === 'custom' ? Math.max(1, +v('retentionDays') || 30) : +v('retSel'), alarmRetentionDays: +v('alarmRet'), sessionIdleHours: +v('sessIdle'), sessionMaxDays: +v('sessMax'), maxDbMB: +v('maxDbMB'), liveBufferSize: +v('liveBufferSize'), silentDeviceMinutes: +v('silentDeviceMinutes'), rawLogEnabled: ck('rawLogEnabled'),
        ntp: { enabled: ck('ntpOn'), server: v('ntpServer').trim(), port: +v('ntpPort') || 123, intervalMin: +v('ntpEvery') || 15, zone: v('ntpZone').trim() },
        mode: v('prMode'), probe: { server: v('prServer').trim(), token: v('prToken'), name: v('prNameP').trim(), allowSelfSigned: ck('prSelf') },
        systemMessages: Object.fromEntries($$('[data-sm]', el).map((x) => [x.dataset.sm, x.checked])), vendorParsers: Object.fromEntries($$('[data-vendor]', el).map((x) => [x.dataset.vendor, x.checked])), healthAlerts: ck('healthAlerts'), diskWarnPercent: +v('diskWarnPercent'), diskCritPercent: +v('diskCritPercent'),
        forwardTargets: c.forwardTargets.filter((t) => t.host), trapForwardTargets: (c.trapForwardTargets || []).filter((t) => t.host) };
      try { await $('#snmpHost', el)?._saveIfDirty?.(); } catch (e) { return toast(e.message, true); }
      try { const r = await api('/api/config', { method: 'PUT', body }); toast('Settings saved'); dirty = false; if (r.restartRequired) { S.restartNeeded = true; } c = r.config; await pollStats(); draw(); } catch (err) { toast(err.message, true); }
    }
  });
  el.addEventListener('change', (e) => { if (e.target.dataset?.f === 'version') { const cell = e.target.closest('tr')?.querySelector('.v3cell'); if (cell) { const on = e.target.value === 'v3'; cell.hidden = !on; cell.style.display = on ? 'flex' : 'none'; } } if (e.target.id === 'retSel') { const cu = e.target.value === 'custom'; $('#retentionDays').hidden = !cu; $('#retDaysLbl').hidden = !cu; } if (e.target.id === 'themeSel') window.NEP.setTheme(e.target.value); if (e.target.id === 'dashSel') window.NEP.setDash(e.target.value); if (e.target.id === 'soundOn') setSound(e.target.checked); if (e.target.id === 'sndNormal' || e.target.id === 'sndCrit') { store.set(e.target.id === 'sndNormal' ? 'sp.soundName' : 'sp.soundCrit', e.target.value); if (!S.sound) setSound(true); wakeAudio(); beep.last = 0; beep(e.target.id === 'sndNormal' ? 4 : 1, true); } if (e.target.id === 'sndVol') { store.set('sp.soundVol', String(e.target.value / 100)); if (!S.sound) setSound(true); wakeAudio(); beep.last = 0; beep(4, true); } });
  load();
  return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onLeave); el.classList.remove('scompact', 'shownotes'); snmpCleanup?.(); embedClean.forEach((f) => f()); };
};


/** compact multi-choice dropdown of notification profiles (1.39): a button showing the choice and a small menu of ticks */
function profMenu(attr, profs, chosen) {
  const sel = profs.filter((p) => (chosen || []).includes(p.id)), label = !sel.length ? 'none' : sel.length <= 2 ? sel.map((p) => p.name).join(', ') : `${sel.length} profiles`;
  const tip = (p) => esc([p.email?.on ? 'E-mail ' + p.email.to : '', p.sms?.on ? 'SMS ' + p.sms.to : '', p.webhook?.on ? 'Webhook' : ''].filter(Boolean).join(' · '));
  return `<details class="msel"><summary title="Choose who is told">${esc(label)}</summary><div class="menu">${profs.map((p) => `<label class="chk" title="${tip(p)}"><input type="checkbox" ${attr}="${esc(p.id)}" ${(chosen || []).includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}<a href="#notifications" class="muted">Manage profiles</a></div></details>`;
}

// ---------- router ---------------------------------------------------------------------------------------------------------------------------------
function route() {
  const rawHash = location.hash.slice(1) || 'dashboard'; let name = rawHash.split('?')[0]; S.hq = new URLSearchParams(rawHash.split('?')[1] || '');
  if (name === 'live' || name === 'search') name = 'logs';                                   // old bookmarks
  if (EMBED_TAB[name] && S.info?.me?.perms?.includes('settings')) { S.settingsTab = EMBED_TAB[name]; name = 'settings'; history.replaceState(null, '', '#settings'); }
  if (name === 'snmp') { name = 'settings'; S.jump = 'sec-snmp'; history.replaceState(null, '', '#settings'); }
  if (name === 'replace') { name = 'settings'; S.jump = 'sec-replace'; history.replaceState(null, '', '#settings'); }
  const VIEW_PERM = { rules: 'rules', maintenance: 'rules', notifications: 'settings', sqlcopy: 'settings', settings: 'settings', reports: 'reports', users: 'users', backup: 'backup', polling: 'polling' };   // a typed address cannot open a page the account has no right to
  if (VIEW_PERM[name] && S.info?.me && !S.info.me.perms.includes(VIEW_PERM[name])) name = 'dashboard';
  const view = views[name] ? name : 'dashboard';
  S.cleanup?.(); S.cleanup = null; S.view = view; $('#drawer').hidden = true; closePopovers();
  $$('.rail a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  const main = $('#view'); main.classList.remove('fill'); main.innerHTML = ''; const el = document.createElement('div'); el.className = 'viewbox'; main.appendChild(el);   // each visit gets its own box; a late redraw from a page you already left lands in a discarded box
  if (view === 'logs') { S.newCount = 0; $('#navLiveCount').textContent = ''; }
  if (view === 'traps') { S.newTraps = 0; $('#navTrapCount').textContent = ''; }
  S.cleanup = views[view](el, main) || null; main.scrollTop = 0;
}
window.addEventListener('hashchange', route);

(async function init() {
  const theme = store.get('sp.theme', matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const THEMES = [['dark', 'Dark (default)'], ['midnight', 'Midnight blue'], ['graphite', 'Graphite'], ['black', 'Black (OLED)'], ['nord', 'Nord'], ['dracula', 'Dracula'], ['solarized', 'Solarized dark'], ['forest', 'Forest'], ['light', 'Light']];
  const setTheme = (t) => { if (!THEMES.some((x) => x[0] === t)) t = 'dark'; document.documentElement.dataset.theme = t; store.set('sp.theme', t); if (S.onStats && S.stats) S.onStats(S.stats); };
  const shell = $('.shell'), tgl = $('#railToggle');
  const setRail = (c) => { shell.classList.toggle('collapsed', c); store.set('sp.rail', c ? '1' : '0'); tgl.innerHTML = c ? '&raquo;' : '&laquo;'; tgl.setAttribute('aria-expanded', String(!c)); const t = c ? 'Expand side panel' : 'Collapse side panel'; tgl.title = t; tgl.setAttribute('aria-label', t); setTimeout(() => window.dispatchEvent(new Event('resize')), 200); };
  tgl.onclick = () => setRail(!shell.classList.contains('collapsed')); setRail(store.get('sp.rail', '0') === '1');
  const fs = $('#fsBtn'); fs.hidden = !document.fullscreenEnabled;
  fs.onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch((e) => toast('Your browser did not allow full screen: ' + e.message, true)); };
  document.addEventListener('fullscreenchange', () => { const on = !!document.fullscreenElement; $('.lbl', fs).textContent = on ? 'Exit full screen' : 'Full screen'; fs.setAttribute('aria-pressed', String(on)); setTimeout(() => window.dispatchEvent(new Event('resize')), 200); });
  const DASHES = [['classic', 'Classic', ['#3b82f6', '#e5484d', '#f5a524', '#30a46c']], ['noc', 'NOC (Grafana)', ['#73bf69', '#f2cc0c', '#5794f2', '#f2495c']], ['pbi', 'Power BI light', ['#118dff', '#12239e', '#e66c37', '#e044a7']], ['pbidark', 'Power BI dark', ['#2b88ff', '#8a6cff', '#ff8f4d', '#f36bb5']], ['midnight', 'Midnight violet', ['#8b5cf6', '#22d3ee', '#f472b6', '#facc15']], ['aurora', 'Aurora', ['#2dd4bf', '#a78bfa', '#38bdf8', '#4ade80']], ['sunset', 'Sunset', ['#fb923c', '#f43f5e', '#fbbf24', '#c084fc']], ['ocean', 'Deep ocean', ['#38bdf8', '#0ea5e9', '#34d399', '#818cf8']], ['neon', 'Neon night', ['#00f5d4', '#ff2e93', '#fee440', '#7b61ff']], ['forest', 'Forest', ['#4ade80', '#a3e635', '#fbbf24', '#2dd4bf']], ['slate', 'Slate light', ['#475569', '#2563eb', '#d97706', '#059669']]];
  const setDash = (d) => { if (!DASHES.some((x) => x[0] === d)) d = 'classic'; document.documentElement.dataset.dash = d; store.set('sp.dash', d); if (S.onStats && S.stats) S.onStats(S.stats); };
  window.NEP = { THEMES, setTheme, DASHES, setDash }; setTheme(theme); setDash(store.get('sp.dash', 'classic'));
  try { S.info = await api('/api/state'); S.stats = await api('/api/stats'); } catch (e) { $('#view').innerHTML = `<div class="empty"><b>Cannot reach the NetEventPro service</b>${esc(e.message)}. Check that the NetEventPro service is running.</div>`; return; }
  S.prefs = S.info.config.uiPrefs || {};
  { const m2 = S.info.me; if (m2?.need2fa) { try { if (!sessionStorage.getItem('n2fa')) { sessionStorage.setItem('n2fa', '1'); toast('Please set up two-factor sign-in: Settings → Access & updates → Security.'); } } catch { /* no storage */ } } }
  { const me = S.info.me || { perms: [] }; $$('.rail a[data-perm]').forEach((l) => { l.hidden = !me.perms.includes(l.dataset.perm); }); const st = $('.rail a[data-view="settings"]'); if (st) st.hidden = !me.perms.includes('settings'); if (me.perms.includes('settings')) $$('.rail a[data-view="users"], .rail a[data-view="backup"], .rail a[data-view="maintenance"], .rail a[data-view="rules"], .rail a[data-view="notifications"], .rail a[data-view="sqlcopy"], .rail a[data-view="reports"]').forEach((l) => { l.hidden = true; });
    $('#signOut').hidden = !!me.anonymous; $('#meText').textContent = me.anonymous ? '' : `${me.name} · ${(me.roles || []).join(', ')}`; }
  $('#signOut').onclick = async () => { try { await api('/api/logout', { method: 'POST' }); } catch { /* reload anyway */ } location.reload(); };
  syncClock(S.info); drawClock(); setInterval(drawClock, 250);
  applyLook(); renderStatus(); connectStream(); route(); setInterval(pollStats, 2000);
})();

// ---------- every pop-up window can be dragged by its title ---------------------------------------------------------------------------
(function dragWindows() {
  const BAR = '.pop-title, h1, h2, h3, h4, .modal-title';
  const grab = (win) => {
    if (win.dataset.drag) return; win.dataset.drag = '1';
    const barOf = () => win.querySelector(BAR) || win.firstElementChild;   // looked up when needed: some windows redraw their contents
    const mark = () => { const b = barOf(); if (b) { b.classList.add('drag-bar'); b.title ||= 'Drag to move this window'; } };
    mark(); new MutationObserver(mark).observe(win, { childList: true });
    win.addEventListener('pointerdown', (e) => {
      const bar = barOf(); if (!bar || !bar.contains(e.target)) return;
      if (e.button !== 0 || e.target.closest('button, input, select, textarea, a, label')) return;
      const fixed = getComputedStyle(win).position === 'fixed', x0 = e.clientX, y0 = e.clientY, r = win.getBoundingClientRect();
      const base = win.style.transform.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/), tx0 = base ? +base[1] : 0, ty0 = base ? +base[2] : 0;
      e.preventDefault();
      const move = (ev) => {
        const dx = Math.min(innerWidth - 40 - r.left, Math.max(40 - r.right, ev.clientX - x0)), dy = Math.min(innerHeight - 30 - r.top, Math.max(-r.top, ev.clientY - y0));   // keep the title bar on screen
        if (fixed) { win.style.left = (r.left + dx) + 'px'; win.style.top = (r.top + dy) + 'px'; } else win.style.transform = `translate(${tx0 + dx}px, ${ty0 + dy}px)`;
      };
      const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up); };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
    });
  };
  const scan = (n) => { if (n.nodeType !== 1) return; if (n.matches('.modal, .popover')) grab(n); n.querySelectorAll?.('.modal, .popover').forEach(grab); };
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach(scan))).observe(document.body, { childList: true });
})();

// ---------- HTTPS certificate made in the app ---------------------------------------------------------------------------------------------
async function httpsRefresh(el) {
  const box = $('#httpsInfo', el); if (!box) return;
  try {
    const i = await api('/api/https'); $('#httpsDl', el).hidden = !i.cert;
    box.innerHTML = i.certError ? esc(i.certError) : i.cert ? `Certificate in use: <b>${esc(i.cert.names || i.cert.subject)}</b> — valid until ${esc(i.cert.validTo)}${i.cert.expired ? ' <b style="color:var(--s1)">(expired)</b>' : ''}${i.running ? '' : ' · not active until the service restarts'}. Install the downloaded file on each PC as a <i>Trusted Root Certification Authority</i> to remove the browser warning.` : '';
  } catch { /* not allowed or restarting */ }
}
async function httpsWizard(settingsEl) {
  const info = await api('/api/https').catch(() => ({ suggested: '' }));
  const dlg = dialog('Create an HTTPS certificate', `<p class="muted" style="margin-top:0">Makes a certificate and private key on this computer, with no other software needed. List every name or IP address people will type to open the dashboard: a browser rejects a certificate that does not list the address used.</p>
    <div class="field"><label for="cgHosts">Names and addresses</label><div><textarea id="cgHosts" rows="3" style="width:100%">${esc(info.suggested)}</textarea><div class="hint">Separate with commas or spaces, for example <code>syslog01, syslog01.corp.local, 10.1.2.3</code></div></div></div>
    <div class="field"><label for="cgDays">Valid for</label><div><input type="number" id="cgDays" class="w-sm" min="30" max="3650" value="825"> days</div></div>
    ${info.cert ? '<p class="muted">A certificate is already set up. The old files are kept next to the new ones (renamed .old-…).</p>' : ''}
    <div id="cgOut"></div><div class="toolbar" style="margin:14px 0 0"><span class="spacer"></span><button type="button" id="cgCancel">Close</button><button type="button" class="primary" id="cgGo">Create certificate</button></div>`);
  const out = dlg.$('#cgOut'); dlg.$('#cgCancel').onclick = dlg.close;
  dlg.$('#cgGo').onclick = async () => {
    const go = dlg.$('#cgGo'); go.disabled = true; out.innerHTML = '<p class="muted">Creating…</p>';
    try {
      const r = await api('/api/https/generate', { method: 'POST', body: { hosts: dlg.$('#cgHosts').value, days: +dlg.$('#cgDays').value } });
      const ci = $('#tlsCert', settingsEl), ki = $('#tlsKey', settingsEl); if (ci) ci.value = r.certFile; if (ki) ki.value = r.keyFile;
      out.innerHTML = `<p><b>Done.</b> Certificate for ${esc(r.names.join(', '))}, valid until ${esc(r.validTo.slice(0, 10))}.<br>Saved in <code>${esc(r.certFile)}</code>. Restart the service to switch the dashboard to <b>https</b>; this page will then reopen on the https address.</p><div class="toolbar" style="margin:0"><a class="btn" href="/api/https/cert" download>Download certificate</a><button type="button" class="primary" id="cgRestart">Restart now</button></div>`;
      go.hidden = true; httpsRefresh(settingsEl);
      dlg.$('#cgRestart').onclick = async () => { try { await api('/api/restart', { method: 'POST' }); } catch { /* connection drops */ } dlg.close(); toast('Restarting…'); setTimeout(() => { location.href = 'https://' + location.host + '/#settings'; }, 5000); };
    } catch (err) { out.innerHTML = `<p style="color:var(--s1)">${esc(err.message)}</p>`; go.disabled = false; }
  };
}
