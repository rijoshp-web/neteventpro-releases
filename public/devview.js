'use strict';
// 1.99.10 "Device view": pictures of your devices on a floor plan, rack or drawing, each with its live state, open alarms and up
// to three readings. Views are drawn on a 1600 × 900 canvas scaled to the screen. Editing (admins and users with the polling
// permission): drag devices, choose a picture, draw lines between devices, labels, boxes that open another view, a background.
// Loaded after admin.js (shares $, $$, esc, api, toast, can, dialog, askConfirm, askText, S, zf) and icons.js (NEPIcons).
(() => {
  const W = 1600, H = 900;
  const SEVN = ['Emergency', 'Alert', 'Critical', 'Error', 'Warning', 'Notice', 'Info', 'Debug'];
  const ICONS = () => (window.NEPIcons ? window.NEPIcons.list() : []);
  const iconSvg = (name, size) => (window.NEPIcons ? window.NEPIcons.tile(name, size) || window.NEPIcons.tile('server', size) : '');
  // 1.99.12 modern device pictures (devpics.js, made from assets/stencils), shown without a frame; older views keep working through LEGACY
  const DP = () => window.NEPDevPics;
  const LEGACY = { server: 'server-2u', switch: 'switch-24port', router: 'router', shield: 'firewall', lock: 'firewall', battery: 'battery-bank', plug: 'pdu-strip', bolt: 'rectifier-shelf', voltage: 'rectifier-shelf', current: 'rectifier-shelf', sun: 'rectifier-shelf', generator: 'generator', antenna: 'microwave-dish', satellite: 'microwave-dish', signal: 'antenna-omni', clock: 'gps-clock', snowflake: 'air-conditioner', fan: 'air-conditioner', thermometer: 'sensor-temperature', flame: 'sensor-temperature', droplet: 'sensor-temperature', location: 'building', network: 'multiplexer', globe: 'internet-globe', cloud: 'cloud', phone: 'phone-ip', door: 'sensor-door', disk: 'storage-nas', cpu: 'server-1u', memory: 'server-1u', pulse: 'audio-processor', speed: 'encoder', arrows: 'switch-48port', user: 'pc-desktop', mail: 'pc-desktop', warning: 'smoke-detector', bell: 'smoke-detector' };
  /** the picture for an item: a modern one by its key; an icon from before 1.99.12 first by the device's name (rectifier, UPS …), then by the old icon */
  const devKey = (pic, name) => { const n = String(pic || '').replace(/^icon:/, ''); if (DP()?.has(n)) return n; const g = name ? guessName(name) : ''; return g || LEGACY[n] || 'server-2u'; };
  const devImg = (pic, name) => (DP() ? `<img class="dvdp" src="${DP().url(devKey(pic, name))}" alt="" draggable="false">` : iconSvg(String(pic).slice(5), 48));
  const GUESS = [[/wireless controller|\bwlc\b/, 'wireless-controller'], [/sd-?wan/, 'sd-wan-edge'], [/load ?balanc|\blb\b|\badc\b/, 'load-balancer'], [/\bvpn\b/, 'vpn-gateway'], [/console server|terminal server/, 'console-server'], [/\bkvm\b/, 'kvm-switch'], [/\bpoe\b/, 'switch-poe'], [/\bolt\b|\bpon\b/, 'olt-pon'], [/\bont\b|\bonu\b|modem/, 'ont-modem'], [/dwdm|cwdm|\bwdm\b|\botn\b|optical/, 'dwdm-terminal'], [/\bsdh\b|\bstm-?\d|\badm\b|sonet/, 'sdh-adm'], [/\bpdh\b|\be1\b|\bt1\b/, 'pdh-mux-e1'], [/tdm/, 'tdm-over-ip'], [/channel bank/, 'channel-bank'], [/blade/, 'blade-chassis'], [/cluster/, 'server-cluster'], [/\bvm\b|virtual|esxi|hyper-?v|vcenter/, 'virtual-server'], [/database|\bdb\b|sql|oracle/, 'database-server'], [/\bgpu\b/, 'gpu-server'], [/rect\w* controller|power controller|\bpsc\b|smartpack|\bcsu\b/, 'rectifier-controller'], [/rect\w* module/, 'rectifier-module'], [/dc ?distrib|\bdcdp\b|\bdcdu\b/, 'dc-distribution'], [/inverter/, 'inverter'], [/\bats\b|transfer switch/, 'ats-switch'], [/meter/, 'power-meter'], [/breaker|\bmcb\b|\bmdb\b/, 'circuit-breaker-panel'], [/solar|\bpv\b/, 'solar-charge-controller'], [/\bups\b/, 'ups'], [/rect|\bdc\b|power plant/, 'rectifier-shelf'], [/batt/, 'battery-bank'], [/pdu/, 'pdu-strip'], [/generat|genset/, 'generator'], [/\bfw\b|firewall/, 'firewall'], [/wi-?fi|wlan|\bap\b|access point/, 'wifi-access-point'], [/switch|\bsw\b/, 'switch-24port'], [/router|\brtr\b|\bgw\b|gateway/, 'router'], [/micro|\bmw\b|radio|link/, 'microwave-dish'], [/gps|ntp|time|clock/, 'gps-clock'], [/air ?con|hvac|cool|crac|\bac\b/, 'air-conditioner'], [/camera|\bcam\b|cctv/, 'camera'], [/\bmux|multiplex|sdh|\be1\b/, 'multiplexer'], [/transmit|\btx\b/, 'transmitter'], [/nas\b|storage|\bsan\b/, 'storage-nas'], [/audio|processor/, 'audio-processor'], [/encod/, 'encoder'], [/sensor|environment|temp/, 'sensor-temperature'], [/smoke|fire/, 'smoke-detector'], [/door/, 'sensor-door'], [/phone/, 'phone-ip'], [/printer/, 'printer'], [/plc|controller/, 'controller-plc'], [/odf|patch/, 'odf-patch-panel'], [/desktop|\bpc\b|workstation/, 'pc-desktop'], [/laptop/, 'laptop']];
  const guessName = (n) => { const x = String(n).toLowerCase(), t = GUESS.find(([re]) => re.test(x)); return t ? t[1] : ''; };
  const imgUrl = (id) => `/api/views/image?id=${encodeURIComponent(id)}`;
  const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem('nep.dv.' + k); localStorage.setItem('nep.dv.' + k, v); } catch { return null; } return null; };
  /** the colour class of an item: down or a Critical alarm = red, Error = orange, Warning = amber, fine = green, unknown = grey */
  const cls = (st) => {
    if (!st) return 'st-unk';
    if (st.state === 'gone' || st.state === 'off' || st.state === 'unknown' || st.state === 'stale') return st.sev !== null && st.sev <= 4 ? cls({ ...st, state: 'up' }) : 'st-unk';
    if (st.state === 'down' || (st.sev !== null && st.sev <= 2)) return 'st-crit';
    if (st.sev === 3) return 'st-err'; if (st.sev === 4) return 'st-warn'; return 'st-ok';
  };
  const stText = (st) => (!st ? 'Waiting…' : st.state === 'gone' ? (st.title || 'Removed') : st.state === 'off' ? 'Polling is off' : st.state === 'down' ? 'No answer' : st.state === 'stale' ? 'Probe not reporting' : st.state === 'unknown' ? 'Waiting for the first answer' : st.open ? `${st.open} open alarm${st.open === 1 ? '' : 's'}${st.sev !== null ? ' · worst ' + SEVN[st.sev] : ''}` : 'OK');

  views.devview = (el) => {
    let list = [], cur = null, edit = false, draft = null, status = {}, choices = null, canEdit = false, timer = 0, alive = true, sel = null, linkFrom = null, dirty = false, info = null, infoTimer = 0;   // info: the item whose details panel is open
    const k = () => { const w = $('.dvwrap', el); return w ? w.clientWidth / W : 1; };
    const markerOnly = (it) => it.pic === 'none';

    const load = async (keepId) => {
      try { const r = await api('/api/views'); list = r.views || []; canEdit = !!r.canEdit; } catch (e) { el.innerHTML = `<div class="page-head"><h1>Device view</h1></div><div class="empty"><b>Could not load</b>${esc(e.message)}</div>`; return; }
      const want = keepId || S.hq?.get('v') || pref('last');
      cur = list.find((v) => v.id === want) || list[0] || null; draw(); poll();
    };
    const poll = async () => {
      clearTimeout(timer); if (!alive || !cur || edit) return;
      try { const r = await api('/api/views/status?id=' + encodeURIComponent(cur.id)); if (!alive) return; status = r.items || {}; paintStatus(); } catch { /* next round */ }
      timer = setTimeout(poll, document.hidden ? 15000 : 5000);
    };
    const view = () => (edit ? draft : cur);

    // ---------- drawing ----------
    const itemHtml = (it) => {
      const st = status[it.id];
      if (it.kind === 'label') return `<div class="dvi dvlabel${sel === it.id ? ' sel' : ''}" data-id="${esc(it.id)}" style="left:${it.x}px;top:${it.y}px;font-size:${it.size}px">${esc(it.text || 'Text')}</div>`;
      const pic = String(it.pic || 'icon:server'), s = it.size || 96, mk = pic === 'none';
      const name = it.name || (it.kind === 'view' ? (list.find((v) => v.id === it.view)?.name || 'View') : (choices?.find((c) => c.src === it.src && c.ref === it.ref)?.name || st?.name || 'Device'));
      const picHtml = mk ? '' : pic.startsWith('img:') ? `<img src="${imgUrl(pic.slice(4))}" alt="" draggable="false">` : devImg(pic, it.kind === 'device' ? name : '');
      return `<div class="dvi ${cls(st)}${st && st.unack && cls(st) === 'st-crit' ? ' pulse' : ''}${sel === it.id ? ' sel' : ''}${linkFrom === it.id ? ' linkfrom' : ''}" data-id="${esc(it.id)}" style="left:${it.x}px;top:${it.y}px;--s:${s}px;--h:${mk ? (it.h || s) : s}px" title="${esc(stText(st))}" tabindex="0" role="button" aria-label="${esc(name)}: ${esc(stText(st))}">
        <div class="dvpic${pic.startsWith('img:') ? ' isimg' : ''}${mk ? ' marker' : ''}">${picHtml}${it.kind === 'view' ? '<span class="dvsub">open ›</span>' : ''}</div>
        <button type="button" class="dvbadge" ${st && st.open ? '' : 'hidden'} title="Show the open alarms" aria-label="Open alarms">${st ? st.open : ''}</button>
        ${mk && it.hideName ? '' : `<div class="dvname">${esc(name)}</div>`}${st && st.down ? `<div class="dvread"><span class="r-crit">${st.down} without answer</span></div>` : ''}</div>`;
    };
    const readHtml = (st) => (st && st.down ? `<span class="r-crit">${st.down} without answer</span>` : '');
    const linkSvg = (v) => {
      const pos = new Map(v.items.map((i) => [i.id, i]));
      return `<svg class="dvlinks" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${v.links.map((l, i) => { const a = pos.get(l.a), b = pos.get(l.b); if (!a || !b) return ''; const down = [status[l.a], status[l.b]].some((x) => x && x.state === 'down');
        return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${down ? 'down' : ''}" data-l="${i}"/>${edit ? `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="hit" data-l="${i}"/>` : ''}`; }).join('')}</svg>`;
    };
    const bgHtml = (v) => (v.bg?.mode === 'image' && v.bg.img ? `<img class="dvbg" src="${imgUrl(v.bg.img)}" alt="" draggable="false">${v.bg.dim ? `<div class="dvdim" style="opacity:${v.bg.dim / 100}"></div>` : ''}` : '');
    const canvasHtml = (v) => `<div class="dvwrap ${v.bg?.mode === 'grid' ? 'grid' : v.bg?.mode === 'plain' ? 'plain' : 'pic'}${edit ? ' editing' : ''}" id="dvWrap"><div class="dvcanvas" id="dvCanvas">${bgHtml(v)}${linkSvg(v)}${v.items.map(itemHtml).join('')}</div>${edit ? '' : ''}</div>`;

    const draw = () => {
      if (!alive) return; const v = view();
      const tabsH = list.length ? `<div class="gchips" role="tablist">${list.map((x) => `<button class="gchip${cur && x.id === cur.id ? ' on' : ''}" data-v="${esc(x.id)}" role="tab" ${edit ? 'disabled' : ''}>${esc(x.name)}</button>`).join('')}</div>` : '';
      const tools = edit ? `<div class="toolbar dvtools"><button id="dvAdd" class="primary">Add device</button><button id="dvAddL">Add text</button><button id="dvAddV" ${list.length > 1 ? '' : 'disabled title="Make a second view first"'}>Add box to another view</button><button id="dvLink" class="${linkFrom !== null ? 'on' : ''}" title="Click two devices to join them with a line; click a line to remove it">${linkFrom !== null ? 'Click the second device…' : 'Draw line'}</button><button id="dvBg">Background…</button><button id="dvRen">Rename</button><span class="spacer"></span><button id="dvDel" class="danger">Delete view</button><button id="dvCancel">Cancel</button><button id="dvSave" class="primary">Save</button></div>`
        : `<div class="toolbar"><span class="muted" id="dvSum"></span><span class="spacer"></span>${v ? '<button id="dvWall" title="Show this view on the whole screen, for a wall screen (the details panel works there too)">Wall screen</button>' : ''}${canEdit ? `${v ? '<button id="dvEdit">Edit</button>' : ''}<button id="dvNew" class="${v ? '' : 'primary'}">New view</button>` : ''}</div>`;
      el.innerHTML = `<div class="page-head"><h1>Device view</h1><span class="muted">Your devices as pictures with their live state</span></div>${tabsH}${tools}
        ${v ? `<div class="dvlayout${(edit && sel) || (!edit && info) ? ' withside' : ''}" id="dvStage">${stageInner(v)}</div>
          ${edit ? '<p class="muted" style="margin:6px 0 0">Drag pictures to move them. Click one to change it. Lines and boxes follow the devices.</p>' : '<div class="dvlegend muted"><span class="lg st-ok"></span>OK <span class="lg st-warn"></span>Warning <span class="lg st-err"></span>Error <span class="lg st-crit"></span>Critical or no answer <span class="lg st-unk"></span>Unknown or off</div>'}`
        : `<div class="empty steps"><b>No device view yet</b>${canEdit ? '<ol class="emsteps"><li><b>Make a view</b><span>For a room, a rack, a site or your whole network.</span></li><li><b>Place your devices</b><span>Polled devices and devices that send syslog or traps; pick a picture for each.</span></li><li><b>Watch it live</b><span>Each picture turns amber or red with its alarms, and shows up to three readings.</span></li></ol><button class="primary" id="dvNew2">New view</button>' : 'An administrator can make views here.'}</div>`}`;
      fit(); wire(); paintStatus(); requestAnimationFrame(fit);
    };
    const isWall = () => { const st = $('#dvStage', el); return !!st && (document.fullscreenElement === st || st.classList.contains('wall')); };
    const stageInner = (v) => `${canvasHtml(v)}${edit && sel ? `<aside class="panel dvside" id="dvSide">${sideHtml()}</aside>` : ''}${!edit && info ? `<aside class="panel dvside dvinfo" id="dvInfo" aria-live="polite"><div class="muted">Loading…</div></aside>` : ''}${edit ? '' : '<button class="dvwallx" id="dvWallX" title="Leave the wall screen">Leave wall screen</button>'}`;
    /** 1.99.12 redraws only the inside of the stage, so the wall screen (the stage is the full-screen element) stays on */
    const drawStage = () => {
      const st = $('#dvStage', el), v = view(); if (!st || !v) return draw();
      st.classList.toggle('withside', !!((edit && sel) || (!edit && info))); st.innerHTML = stageInner(v); fit(); wire(); paintStatus(); requestAnimationFrame(fit);
    };
    const setInfo = (id) => { info = id; drawStage(); };
    const fit = () => {
      const c = $('#dvCanvas', el), w = $('#dvWrap', el), st = $('#dvStage', el); if (!c || !w) return;
      if (st && (document.fullscreenElement === st || st.classList.contains('wall'))) {   // wall screen: as large as fits next to the panel
        const side = $('.dvside', st), aw = st.clientWidth - (side ? side.offsetWidth + 12 : 0) - 24, ah = st.clientHeight - 24, ww = Math.max(200, Math.min(aw, ah * W / H));
        w.style.width = ww + 'px'; w.style.height = (ww * H / W) + 'px';
      } else { w.style.width = ''; w.style.height = ''; }
      c.style.transform = `scale(${k()})`;
    };
    const paintStatus = () => {
      const v = view(); if (!v || edit) { if (!v) return; }
      for (const it of v.items) {
        if (it.kind === 'label') continue; const n = $(`.dvi[data-id="${CSS.escape(it.id)}"]`, el); if (!n) continue; const st = status[it.id];
        const c = cls(st); if (!n.classList.contains(c)) { n.classList.remove('st-ok', 'st-warn', 'st-err', 'st-crit', 'st-unk'); n.classList.add(c); }
        n.classList.toggle('pulse', !!(st && st.unack && c === 'st-crit')); n.title = stText(st);
        const b = $('.dvbadge', n); if (b) { b.hidden = !(st && st.open); b.textContent = st ? st.open : ''; }
        { const h = readHtml(st); let r = $('.dvread', n); if (h && !r) { r = document.createElement('div'); r.className = 'dvread'; n.appendChild(r); } if (r && r.innerHTML !== h) r.innerHTML = h; }
        if (it.kind === 'device' && DP() && String(it.pic || '').startsWith('icon:') && !DP().has(String(it.pic).slice(5))) { const im = $('.dvdp', n), u = DP().url(devKey(it.pic, it.name || st?.name || '')); if (im && im.getAttribute('src') !== u) im.setAttribute('src', u); }   // older icons follow the device name once it is known
        if (!it.name && st?.name) { const nm = $('.dvname', n); if (nm && nm.textContent !== st.name) { nm.textContent = st.name; n.setAttribute('aria-label', `${st.name}: ${stText(st)}`); } }
      }
      const svg = $('.dvlinks', el); if (svg) { const pos = new Map(v.items.map((i) => [i.id, i])); $$('line:not(.hit)', svg).forEach((ln) => { const l = v.links[+ln.dataset.l]; if (!l) return; ln.classList.toggle('down', [status[l.a], status[l.b]].some((x) => x && x.state === 'down')); void pos; }); }
      const sum = $('#dvSum', el); if (sum) { const all = v.items.filter((i) => i.kind === 'device').map((i) => status[i.id]).filter(Boolean); const bad = all.filter((x) => cls(x) === 'st-crit').length, warn = all.filter((x) => ['st-err', 'st-warn'].includes(cls(x))).length; sum.textContent = `${all.length} device${all.length === 1 ? '' : 's'}${bad ? ` · ${bad} critical or not answering` : ''}${warn ? ` · ${warn} with warnings or errors` : ''}${!bad && !warn && all.length ? ' · all fine' : ''}`; }
    };

    // ---------- side panel while editing ----------
    const selItem = () => draft?.items.find((i) => i.id === sel);
    const sideHtml = () => {
      const it = selItem(); if (!it) return '';
      if (it.kind === 'label') return `<h3>Text</h3><div class="form"><div class="field"><label for="sdT">Text</label><div><input type="text" id="sdT" value="${esc(it.text || '')}" maxlength="120"></div></div><div class="field"><label for="sdS">Size <output id="sdSo" class="dvnum">${it.size || 18}</output></label><div><input type="range" id="sdS" min="10" max="72" value="${it.size || 18}"></div></div></div><button id="sdDel" class="danger">Remove</button>`;
      const ch = it.kind === 'device' ? choices?.find((c) => c.src === it.src && c.ref === it.ref) : null;
      const curK = String(it.pic || '').startsWith('icon:') ? devKey(it.pic, ch?.name || it.name) : '';
      let lastG = ''; const pics = (DP() ? DP().list() : ICONS()).map((x) => { const head = x.group && x.group !== lastG ? `<div class="dvpg">${esc(x.group)}</div>` : ''; lastG = x.group || lastG; return `${head}<button class="dvpick dp${curK === x.k ? ' on' : ''}" data-pic="icon:${x.k}" title="${esc(x.label)}">${DP() ? `<img src="${DP().url(x.k)}" alt="${esc(x.label)}">` : iconSvg(x.k, 22)}</button>`; }).join('');
      return `<h3>${it.kind === 'view' ? 'Box to another view' : esc(ch?.name || 'Device')}</h3>${ch ? `<div class="muted" style="margin:-6px 0 8px">${esc(ch.host)} · ${ch.src === 'poll' ? 'SNMP polling' : 'syslog / traps'}</div>` : ''}
        <div class="form"><div class="field"><label for="sdN">Shown name</label><div><input type="text" id="sdN" value="${esc(it.name || '')}" placeholder="${esc(ch?.name || '')}" maxlength="60"></div></div>
        ${it.kind === 'view' ? `<div class="field"><label for="sdV">Opens</label><div><select id="sdV">${list.filter((v) => v.id !== draft.id).map((v) => `<option value="${esc(v.id)}" ${it.view === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></div></div>` : ''}
        <div class="field"><label for="sdS">${markerOnly(it) ? 'Width' : 'Size'} <output id="sdSo" class="dvnum">${it.size || 96}</output></label><div><input type="range" id="sdS" min="${markerOnly(it) ? 16 : 40}" max="${markerOnly(it) ? 600 : 240}" value="${it.size || 96}"></div></div>
        ${markerOnly(it) ? `<div class="field"><label for="sdH">Height <output id="sdHo" class="dvnum">${it.h || it.size || 96}</output></label><div><input type="range" id="sdH" min="16" max="600" value="${it.h || it.size || 96}"></div></div><label class="chk"><input type="checkbox" id="sdHN" ${it.hideName ? 'checked' : ''}> Hide the name (the drawing already shows it)</label>` : ''}</div>
        <div class="dvpicks" role="group" aria-label="Picture">${it.kind === 'device' ? `<button class="dvpick mk${markerOnly(it) ? ' on' : ''}" data-pic="none" title="Marker only: no picture, just a live coloured frame and alarm count. Put it over a device in your background drawing (for example a Visio drawing saved as SVG).">▢<span>Marker</span></button>` : ''}${pics}${it.kind === 'device' ? `<label class="dvpick upl" title="Your own picture (PNG, JPEG, WebP or SVG, up to 8 MB). More device drawings are in the NetEventPro folder under app\\assets\\stencils.">＋<input type="file" id="sdUp" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" hidden></label>` : ''}</div>
        ${it.kind === 'device' ? '<p class="muted" style="margin:8px 0 0;font-size:12px">The device\'s readings show in the details panel when you click it (outside edit mode).</p>' : ''}
        <div class="toolbar" style="margin-top:12px"><button id="sdDel" class="danger">Remove from view</button></div>`;
    };
    const redrawKeep = () => { const sc = $('#dvSide', el)?.scrollTop || 0; draw(); const s2 = $('#dvSide', el); if (s2) s2.scrollTop = sc; };

    // ---------- events ----------
    const wire = () => {
      $$('.gchip[data-v]', el).forEach((b) => { b.onclick = () => { cur = list.find((v) => v.id === b.dataset.v); pref('last', cur.id); status = {}; draw(); poll(); }; });
      const on = (id, f) => { const b = $('#' + id, el); if (b) b.onclick = f; };
      on('dvNew', newView); on('dvNew2', newView);
      on('dvEdit', async () => { if (!choices) { try { choices = (await api('/api/views/choices')).devices; } catch (e) { return toast(e.message, true); } } edit = true; info = null; draft = structuredClone(cur); sel = null; linkFrom = null; dirty = false; clearTimeout(timer); draw(); });
      on('dvWall', () => { const w = $('#dvStage', el); if (!w) return; (w.requestFullscreen ? w.requestFullscreen() : Promise.reject(new Error('no'))).catch(() => { w.classList.add('wall'); document.body.classList.add('dv-wall'); setTimeout(fit, 30); }); });
      on('dvWallX', () => { if (document.fullscreenElement) document.exitFullscreen(); const w = $('#dvStage', el); w?.classList.remove('wall'); document.body.classList.remove('dv-wall'); setTimeout(fit, 30); });
      if (!edit && info) fillInfo();
      on('dvCancel', async () => { if (dirty && !await askConfirm('Leave without saving your changes to this view?', 'Leave')) return; edit = false; draft = null; sel = null; linkFrom = null; draw(); poll(); });
      on('dvSave', save);
      on('dvDel', async () => { if (!await askConfirm(`Delete the view "${draft.name}"? The devices themselves are not changed.`, 'Delete')) return; try { await api('/api/views/delete', { method: 'POST', body: { id: draft.id } }); edit = false; draft = null; toast('View deleted'); load(); } catch (e) { toast(e.message, true); } });
      on('dvRen', async () => { const n = await askText('Name of this view', draft.name); if (n && n.trim()) { draft.name = n.trim().slice(0, 60); dirty = true; draw(); } });
      on('dvAdd', addDevice);
      on('dvAddL', () => { const it = { id: 'i' + Math.random().toString(36).slice(2, 10), kind: 'label', x: W / 2, y: 60, size: 22, text: 'Text' }; draft.items.push(it); sel = it.id; dirty = true; draw(); });
      on('dvAddV', () => { const other = list.find((v) => v.id !== draft.id); if (!other) return; const it = { id: 'i' + Math.random().toString(36).slice(2, 10), kind: 'view', view: other.id, x: W / 2, y: H / 2, size: 96, pic: 'icon:building', name: '' }; draft.items.push(it); sel = it.id; dirty = true; draw(); });
      on('dvLink', () => { linkFrom = linkFrom === null ? '' : null; draw(); });
      on('dvBg', background);
      const wrap = $('#dvWrap', el); if (!wrap) return;
      if (!edit) {
        wrap.onclick = (e) => { const n = e.target.closest('.dvi'); if (!n) { if (info) setInfo(null); return; } const it = cur.items.find((i) => i.id === n.dataset.id); if (!it) return; if (it.kind === 'view') { const v = list.find((x) => x.id === it.view); if (v) { cur = v; info = null; pref('last', v.id); status = {}; if (isWall()) drawStage(); else draw(); poll(); } } else if (it.kind === 'device') { if (e.target.closest('.dvbadge')) return alarmWindow(it); if (info !== it.id) setInfo(it.id); } };
        wrap.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.dvi')) { e.preventDefault(); e.target.click(); } };
        return;
      }
      // editing: drag, select, draw lines
      let drag = null;
      wrap.onpointerdown = (e) => {
        const hit = e.target.closest('line.hit'); if (hit) { draft.links.splice(+hit.dataset.l, 1); dirty = true; draw(); return; }
        const n = e.target.closest('.dvi'); if (!n) { if (sel) { sel = null; draw(); } return; }
        const it = draft.items.find((i) => i.id === n.dataset.id); if (!it) return;
        if (linkFrom !== null) { if (it.kind === 'label') return; if (!linkFrom) { linkFrom = it.id; draw(); return; } if (linkFrom !== it.id && !draft.links.some((l) => (l.a === linkFrom && l.b === it.id) || (l.b === linkFrom && l.a === it.id))) { draft.links.push({ a: linkFrom, b: it.id }); dirty = true; } linkFrom = ''; draw(); return; }
        e.preventDefault(); const sc = k() * zf(); drag = { it, n, sx: e.clientX, sy: e.clientY, x0: it.x, y0: it.y, sc, moved: false }; n.setPointerCapture(e.pointerId);
      };
      wrap.onpointermove = (e) => {
        if (!drag) return; const dx = (e.clientX - drag.sx) / drag.sc, dy = (e.clientY - drag.sy) / drag.sc; if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return; drag.moved = true;
        drag.it.x = Math.round(Math.min(W, Math.max(0, drag.x0 + dx))); drag.it.y = Math.round(Math.min(H, Math.max(0, drag.y0 + dy)));
        drag.n.style.left = drag.it.x + 'px'; drag.n.style.top = drag.it.y + 'px';
        $$('.dvlinks line', el).forEach((ln) => { const l = draft.links[+ln.dataset.l]; if (!l) return; if (l.a === drag.it.id) { ln.setAttribute('x1', drag.it.x); ln.setAttribute('y1', drag.it.y); } if (l.b === drag.it.id) { ln.setAttribute('x2', drag.it.x); ln.setAttribute('y2', drag.it.y); } });
      };
      wrap.onpointerup = () => { if (!drag) return; const d = drag; drag = null; if (d.moved) { dirty = true; return; } sel = d.it.id; draw(); };
      const side = $('#dvSide', el); if (side) wireSide(side);
    };
    const wireSide = (side) => {
      const it = selItem(); if (!it) return;
      const inp = (id, f) => { const x = $('#' + id, side); if (x) x.oninput = () => { f(x); dirty = true; const n = $(`.dvi[data-id="${CSS.escape(it.id)}"]`, el); if (n) { const tmp = document.createElement('div'); tmp.innerHTML = itemHtml(it); n.replaceWith(tmp.firstElementChild); } }; };
      inp('sdN', (x) => { it.name = x.value; }); inp('sdT', (x) => { it.text = x.value; }); inp('sdS', (x) => { it.size = +x.value; const o = $('#sdSo', side); if (o) o.textContent = x.value; }); inp('sdH', (x) => { it.h = +x.value; const o = $('#sdHo', side); if (o) o.textContent = x.value; });
      { const hn = $('#sdHN', side); if (hn) hn.onchange = () => { it.hideName = hn.checked; dirty = true; redrawKeep(); }; }
      const sv = $('#sdV', side); if (sv) sv.onchange = () => { it.view = sv.value; dirty = true; redrawKeep(); };
      $$('.dvpick[data-pic]', side).forEach((b) => { b.onclick = () => { it.pic = b.dataset.pic; if (it.pic === 'none' && !it.h) it.h = it.size || 96; dirty = true; redrawKeep(); }; });
            const up = $('#sdUp', side); if (up) up.onchange = () => upload(up.files[0], (id) => { it.pic = 'img:' + id; dirty = true; redrawKeep(); });
      const del = $('#sdDel', side); if (del) del.onclick = () => { draft.items = draft.items.filter((i) => i.id !== it.id); draft.links = draft.links.filter((l) => l.a !== it.id && l.b !== it.id); sel = null; dirty = true; draw(); };
    };
    const upload = (file, done) => {
      if (!file) return; if (file.size > 8 * 1048576) return toast('The picture is larger than 8 MB. Make it smaller first.', true);
      const fr = new FileReader(); fr.onload = async () => { try { const r = await api('/api/views/image', { method: 'POST', body: { data: fr.result } }); done(r.id); } catch (e) { toast(e.message, true); } }; fr.readAsDataURL(file);
    };

    // ---------- dialogs ----------
    const newView = async () => {
      const n = await askText('Name of the new view, for example "Server room" or "Rack A3"', ''); if (!n || !n.trim()) return;
      try { const r = await api('/api/views', { method: 'POST', body: { name: n.trim(), bg: { mode: 'grid' }, items: [], links: [] } }); pref('last', r.id); await load(r.id); const b = $('#dvEdit', el); if (b) b.click(); } catch (e) { toast(e.message, true); }
    };
    const addDevice = () => {
      const used = new Set(draft.items.filter((i) => i.kind === 'device').map((i) => i.src + '|' + i.ref));
      const dl = dialog('Add devices to this view', `<div class="toolbar" style="margin:0 0 8px"><input type="search" id="adQ" placeholder="Find by name, address or group" style="width:280px"><select id="adS"><option value="poll">Polled devices (SNMP polling)</option><option value="dev">Devices that send syslog or traps</option></select><span class="muted" id="adN"></span></div><div id="adL" style="max-height:360px;overflow:auto"></div><div class="toolbar" style="margin-top:12px"><span class="muted">Tick devices, then press Add. They are placed in a row; drag them where they belong.</span><span class="spacer"></span><button id="adNo">Cancel</button><button id="adOk" class="primary">Add</button></div>`, true);
      const picked = new Set();
      const paint = () => {
        const q = dl.$('#adQ').value.toLowerCase(), src = dl.$('#adS').value; const rows = choices.filter((c) => c.src === src && !used.has(c.src + '|' + c.ref) && (!q || (c.name + ' ' + c.host + ' ' + c.group).toLowerCase().includes(q)));
        dl.$('#adN').textContent = `${rows.length} found${picked.size ? ` · ${picked.size} ticked` : ''}`;
        dl.$('#adL').innerHTML = rows.length ? `<table class="data"><tbody>${rows.slice(0, 300).map((c) => `<tr><td style="width:28px"><input type="checkbox" class="adC" data-k="${esc(c.src + '|' + c.ref)}" ${picked.has(c.src + '|' + c.ref) ? 'checked' : ''} aria-label="${esc(c.name)}"></td><td><b>${esc(c.name)}</b> <span class="muted">${esc(c.host)}${c.group ? ' · ' + esc(c.group) : ''}</span></td></tr>`).join('')}</tbody></table>${rows.length > 300 ? '<p class="muted">Showing the first 300: type to narrow the list.</p>' : ''}` : '<p class="muted">Nothing to add here.</p>';
        $$('.adC', dl.back).forEach((c) => { c.onchange = () => { if (c.checked) picked.add(c.dataset.k); else picked.delete(c.dataset.k); dl.$('#adN').textContent = `${rows.length} found${picked.size ? ` · ${picked.size} ticked` : ''}`; }; });
      };
      dl.$('#adQ').oninput = paint; dl.$('#adS').onchange = paint; dl.$('#adNo').onclick = () => dl.close();
      dl.$('#adOk').onclick = () => {
        let i = 0; const n = picked.size, cols = Math.max(1, Math.min(10, n)), gap = Math.min(150, (W - 160) / cols);
        for (const key of picked) { const [src, ...rest] = key.split('|'), ref = rest.join('|'); const c = choices.find((x) => x.src === src && x.ref === ref); const guess = guessIcon(c?.name || '');
          draft.items.push({ id: 'i' + Math.random().toString(36).slice(2, 10), kind: 'device', src, ref, x: Math.round(80 + gap / 2 + (i % cols) * gap), y: Math.round(160 + Math.floor(i / cols) * 170), size: 120, pic: 'icon:' + guess, name: '', readings: c?.readings?.length > 1 ? [c.readings[1].k] : [] }); i++; }
        dl.close(); if (n) { dirty = true; draw(); toast(`${n} device${n === 1 ? '' : 's'} added`); }
      };
      paint(); dl.$('#adQ').focus();
    };
    /** a first picture from the device's name (the user can change it): words that most device names contain */
    const guessIcon = (n) => guessName(n) || 'server-2u';
    const background = () => {
      const bg = draft.bg || { mode: 'grid' };
      const dl = dialog('Background', `<div class="form"><div class="field"><label>Kind</label><div><label class="chk"><input type="radio" name="bgm" value="grid" ${bg.mode === 'grid' ? 'checked' : ''}> Grid</label> <label class="chk"><input type="radio" name="bgm" value="plain" ${bg.mode === 'plain' ? 'checked' : ''}> Plain</label> <label class="chk"><input type="radio" name="bgm" value="image" ${bg.mode === 'image' ? 'checked' : ''}> Picture</label></div></div>
        <div class="field"><label for="bgF">Picture</label><div><input type="file" id="bgF" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"><div class="muted">A floor plan, rack photo or network drawing (PNG, JPEG, WebP or SVG, up to 8 MB). It is fitted to the 16:9 canvas. For a Visio drawing: in Visio choose File, Export, SVG (or PNG), upload it here, then place devices with the picture "Marker only" over its shapes.</div><div id="bgP" style="margin-top:6px">${bg.img ? `<img src="${imgUrl(bg.img)}" alt="" style="max-width:320px;max-height:180px;border-radius:8px">` : ''}</div></div></div>
        <div class="field"><label for="bgD">Darken the picture</label><div><input type="range" id="bgD" min="0" max="80" value="${bg.dim || 0}"> <span class="muted">so the device names stay easy to read</span></div></div></div>
        <div class="toolbar" style="margin-top:12px"><span class="spacer"></span><button id="bgNo">Cancel</button><button id="bgOk" class="primary">Use</button></div>`);
      let img = bg.img || '';
      dl.$('#bgF').onchange = () => upload(dl.$('#bgF').files[0], (id) => { img = id; dl.$('#bgP').innerHTML = `<img src="${imgUrl(id)}" alt="" style="max-width:320px;max-height:180px;border-radius:8px">`; const r = dl.back.querySelector('input[value="image"]'); if (r) r.checked = true; });
      dl.$('#bgNo').onclick = () => dl.close();
      dl.$('#bgOk').onclick = () => { const m = dl.back.querySelector('input[name="bgm"]:checked')?.value || 'grid'; if (m === 'image' && !img) return toast('Choose a picture first.', true); draft.bg = { mode: m, img: m === 'image' ? img : '', dim: +dl.$('#bgD').value }; dirty = true; dl.close(); draw(); };
    };
    const save = async () => {
      try { const r = await api('/api/views', { method: 'POST', body: draft }); toast('View saved'); edit = false; draft = null; sel = null; linkFrom = null; dirty = false; await load(r.id); } catch (e) { toast(e.message, true); }
    };
    // ---------- 1.99.11 details panel (right side, also on the wall screen) and the alarm window ----------
    /** an icon for a reading, from its name and unit (temperature → thermometer, volts → voltage …) */
    const rIcon = (r) => {
      const t = `${r.label} ${r.unit}`.toLowerCase();
      const pick = /°c|°f|temp/.test(t) ? 'thermometer' : /humid|%rh|\brh\b/.test(t) ? 'droplet' : /\bv\b|volt/.test(t) ? 'voltage' : /\ba\b|amp|current/.test(t) ? 'current' : /\bw\b|kw|watt|power/.test(t) ? 'bolt'
        : /batt|charge/.test(t) ? 'battery' : /fan|rpm/.test(t) ? 'fan' : /dbm|snr|signal|rssi|level/.test(t) ? 'signal' : /bps|traffic|octet|rate|in\b|out\b/.test(t) ? 'arrows' : /cpu|load|util|%/.test(t) ? 'gauge'
        : /mem|ram/.test(t) ? 'memory' : /disk|stor|volume/.test(t) ? 'disk' : /time|uptime|offset|delay|ms\b/.test(t) ? 'clock' : /fuel|gen/.test(t) ? 'generator' : /door/.test(t) ? 'door' : /status|state|alarm|mode/.test(t) ? 'check' : 'chart';
      return iconSvg(pick, 18);
    };
    const spark = (vals) => {
      const v = (vals || []).filter((x) => x !== null && Number.isFinite(x)); if (v.length < 2) return '';
      const lo = Math.min(...v), hi = Math.max(...v), rg = hi - lo || 1, n = vals.length, pts = []; vals.forEach((x, i) => { if (x !== null && Number.isFinite(x)) pts.push(`${(i / (n - 1) * 100).toFixed(1)},${(26 - (x - lo) / rg * 22).toFixed(1)}`); });
      return `<svg class="dvspark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
    };
    const ago = (ts) => { if (!ts) return 'never'; const s2 = Math.round((Date.now() - ts) / 1000); return s2 < 60 ? `${s2} s ago` : s2 < 3600 ? `${Math.round(s2 / 60)} min ago` : s2 < 86400 ? `${Math.round(s2 / 3600)} h ago` : `${Math.round(s2 / 86400)} d ago`; };
    const upText = (cs) => { if (cs === null || cs === undefined || !Number.isFinite(+cs)) return '–'; const s2 = Math.floor(cs / 100), d = Math.floor(s2 / 86400), h = Math.floor(s2 % 86400 / 3600), m = Math.floor(s2 % 3600 / 60); return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`; };
    const openR = new Set();   // 1.99.12 readings opened in the details table (kept while the panel refreshes)
    /** the readings as a table, each row opens to its 24-hour trend or its per-port values */
    const rTable = (d) => {
      const rs = d.readings || []; if (!rs.length) return d.kind === 'poll' ? '<h4>Readings</h4><p class="muted">This device has no readings yet. Add them on its page in SNMP polling.</p>' : '';
      const openable = (r) => !!(r.rows?.length || (r.spark && r.spark.filter((x) => x !== null).length > 1));
      const allOpen = rs.filter(openable).every((r) => openR.has(r.k));
      const body = rs.map((r) => {
        const on = openR.has(r.k), canOpen = openable(r);
        const nums = (r.spark || []).filter((x) => x !== null && Number.isFinite(x)), unit = r.unit ? ' ' + r.unit : '';
        const detail = r.rows?.length ? `<table class="dvsubt"><tbody>${r.rows.map((x) => `<tr><td>${esc(x.inst)}</td><td class="${x.state ? 'r-' + esc(x.state) : ''}">${esc(x.text)}</td></tr>`).join('')}${r.more ? `<tr><td colspan="2" class="muted">+${r.more} more on the SNMP polling page</td></tr>` : ''}</tbody></table>`
          : nums.length > 1 ? `<div class="dvtrend">${spark(r.spark)}<div class="dvmm"><span>Lowest <b>${esc(String(+Math.min(...nums).toFixed(2)))}${esc(unit)}</b></span><span>Highest <b>${esc(String(+Math.max(...nums).toFixed(2)))}${esc(unit)}</b></span><span class="muted">last 24 h</span></div></div>` : '';
        return `<tbody class="${on ? 'open' : ''}"><tr class="rh${r.state ? ' r-' + esc(r.state) : ''}">
          <td class="ri">${rIcon(r)}</td><td class="rl" title="${esc(r.label)}">${esc(r.label)}</td><td class="rv">${esc(r.text)}</td>
          <td class="rx">${canOpen ? `<button type="button" class="ib" data-rk="${esc(r.k)}" aria-expanded="${on}" title="Show more" aria-label="Show more about ${esc(r.label)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>` : ''}</td></tr>
          ${canOpen ? `<tr class="rd"><td colspan="4">${detail}</td></tr>` : ''}</tbody>`;
      }).join('');
      return `<div class="dvrhead"><h4>Readings <span class="muted">${rs.length}</span></h4><button type="button" id="dvREx" class="linkbtn">${allOpen ? 'Collapse all' : 'Expand all'}</button></div><table class="dvrtab">${body}</table>`;
    };
    const fillInfo = async () => {
      clearTimeout(infoTimer); const box = $('#dvInfo', el); if (!box || !info || edit) return;
      const it = cur.items.find((i) => i.id === info); if (!it) return;
      let d; try { d = await api(`/api/views/item?id=${encodeURIComponent(cur.id)}&item=${encodeURIComponent(it.id)}`); } catch (e) { box.innerHTML = `<div class="muted">${esc(e.message)}</div>`; return; }
      if (!alive || info !== it.id || !$('#dvInfo', el)) return;
      const st = status[it.id] || { state: d.state, sev: d.sev, open: d.alarms, unack: d.unack }, c = cls(st);
      const pic = String(it.pic || 'icon:server'), picH = pic.startsWith('img:') ? `<img src="${imgUrl(pic.slice(4))}" alt="">` : devImg(pic === 'none' ? 'icon:' + guessIcon(d.name || '') : pic, d.name || '');
      const kpis = d.kind === 'poll' ? [['pulse', 'Answer time', d.rtt === null || d.rtt === undefined ? '–' : `${d.rtt} ms`, ''], ['clock', 'Uptime', upText(d.uptime), ''], ['bell', 'Open alarms', String(d.alarms || 0), d.alarms ? 'alarms' : '']]
        : [['clock', 'Last heard', ago(d.lastSeen), ''], ['list', 'Syslog', String(d.sys || 0), ''], ['bell', 'Open alarms', String(d.alarms || 0), d.alarms ? 'alarms' : '']];
      const sc = box.scrollTop;
      box.innerHTML = `<div class="dvih ${c}"><div class="dvihpic">${picH}</div><div class="dvihtxt"><h3>${esc(d.name || '')}</h3><div class="muted">${esc([d.host, d.group, d.kind === 'poll' ? (d.via ? 'probe ' + d.via : 'SNMP ' + (d.version || '')) : (d.vendor || 'syslog / traps')].filter(Boolean).join(' · '))}</div></div><button class="ib dvix" id="dvInfoX" title="Close" aria-label="Close the details">✕</button></div>
        <div class="dvstate ${c}">${esc(stText(st))}${d.error && st.state === 'down' ? ` · ${esc(d.error)}` : ''}</div>
        <div class="dvkpis">${kpis.map(([ic, l, v, act]) => `<${act ? 'button type="button" data-act="alarms"' : 'div'} class="dvkpi${act ? ' click' : ''}">${iconSvg(ic, 18)}<span class="v">${esc(v)}</span><span class="l">${esc(l)}</span></${act ? 'button' : 'div'}>`).join('')}</div>
        ${d.sysDescr ? `<p class="muted dvdescr" title="${esc(d.sysDescr)}">${esc(d.sysDescr)}</p>` : ''}
        <div class="toolbar dvlinksbar">${d.poll ? `<button data-go="#polling?d=${encodeURIComponent(d.poll)}">Open in SNMP polling</button>` : ''}${d.alarms ? '<button data-act="alarms">Show alarms</button>' : ''}</div>
        ${rTable(d)}`;
      box.scrollTop = sc;
      $$('[data-rk]', box).forEach((b) => { b.onclick = () => { const k2 = b.dataset.rk; if (openR.has(k2)) openR.delete(k2); else openR.add(k2); const on = openR.has(k2); b.setAttribute('aria-expanded', String(on)); b.closest('tbody')?.classList.toggle('open', on); }; });
      { const ea = $('#dvREx', box); if (ea) ea.onclick = () => { const all = (d.readings || []).filter((r) => r.rows?.length || r.spark).map((r) => r.k), anyClosed = all.some((k2) => !openR.has(k2)); openR.clear(); if (anyClosed) all.forEach((k2) => openR.add(k2)); fillInfo(); }; }
      $('#dvInfoX', box).onclick = () => setInfo(null);
      $$('[data-act="alarms"]', box).forEach((b) => { b.onclick = () => alarmWindow(it); });
      $$('[data-go]', box).forEach((b) => { b.onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); location.hash = b.dataset.go; }; });
      infoTimer = setTimeout(fillInfo, document.hidden ? 30000 : 10000);
    };
    /** the open alarms of one device, nothing else (the round alarm count, or Open alarms in the panel) */
    const alarmWindow = (it) => {
      const name = $(`.dvi[data-id="${CSS.escape(it.id)}"] .dvname`, el)?.textContent || status[it.id]?.name || 'Device';
      const host = document.fullscreenElement || document.body;
      const dl = dialog(`Open alarms · ${name}`, '<div id="pnA" class="muted">Loading…</div><div class="toolbar" style="margin-top:12px"><span class="spacer"></span><button id="pnX">Close</button></div>', true);
      if (host !== document.body) host.appendChild(dl.back);   // on the wall screen the window must be inside the full-screen part to be seen
      dl.$('#pnX').onclick = () => dl.close();
      const fill = async () => {
        try { const r = await api(`/api/views/alarms?id=${encodeURIComponent(cur.id)}&item=${encodeURIComponent(it.id)}`); const box = dl.$('#pnA'); if (!box) return;
          box.classList.remove('muted');
          box.innerHTML = r.alarms.length ? `<table class="data"><thead><tr><th>Severity</th><th>Alarm</th><th>Since</th><th></th></tr></thead><tbody>${r.alarms.map((a) => `<tr><td><span class="sevtag sev-${a.severity}">${esc(SEVN[a.severity] || a.severity)}</span></td><td><b>${esc(a.rule)}</b>${a.port ? ` <span class="portchip">${esc(a.port)}</span>` : ''}<div class="muted" style="font-size:12px">${esc(String(a.message).slice(0, 160))}</div></td><td class="nowrap">${new Date(a.first).toLocaleString()}${a.state === 'ack' ? `<div class="muted" style="font-size:12px">acknowledged${a.ackBy ? ' by ' + esc(a.ackBy) : ''}</div>` : ''}</td><td class="nowrap">${r.canAct ? `${a.state === 'open' ? `<button data-ack="${a.id}">Acknowledge</button> ` : ''}<button data-clr="${a.id}">Clear</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No open alarms.</p>';
          $$('button[data-ack],button[data-clr]', box).forEach((b) => { b.onclick = async () => { try { await api(b.dataset.ack ? '/api/alarms/ack' : '/api/alarms/clear', { method: 'POST', body: { ids: [+(b.dataset.ack || b.dataset.clr)] } }); toast(b.dataset.ack ? 'Acknowledged' : 'Cleared'); fill(); poll(); } catch (e) { toast(e.message, true); } }; });
        } catch (e) { const box = dl.$('#pnA'); if (box) box.textContent = e.message; }
      };
      fill();
    };

    const onResize = () => fit(); addEventListener('resize', onResize);
    let wasFs = false;
    const onFs = () => { if (!document.fullscreenElement) { document.body.classList.remove('dv-wall'); if (wasFs && alive && !edit) { wasFs = false; draw(); } } else wasFs = true; fit(); setTimeout(fit, 60); setTimeout(fit, 400); }; document.addEventListener('fullscreenchange', onFs);
    const ro = window.ResizeObserver ? new ResizeObserver(() => fit()) : null; if (ro) ro.observe(el);   // 1.99.11 the canvas follows any change of size (wall screen, panel opening, window)
    const onVis = () => { if (!document.hidden) poll(); }; document.addEventListener('visibilitychange', onVis);
    // 1.99.13 the device pictures (about 300 KB) are fetched only when Device view opens, not with every page
    if (!window.NEPDevPics) { const sc = document.createElement('script'); sc.src = 'devpics.js'; sc.onload = () => { if (alive && cur) draw(); }; document.head.appendChild(sc); }
    load();
    return () => { alive = false; ro?.disconnect(); clearTimeout(timer); clearTimeout(infoTimer); removeEventListener('resize', onResize); document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('visibilitychange', onVis); document.body.classList.remove('dv-wall'); };
  };
})();
