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
  // ---------- 1.99.17 drawing helpers ----------
  /** the empty band above and below the drawing inside a picture (most device pictures are wide and low): the name sits right under the drawing */
  const TRIM = new Map(), trimWait = new Set();
  const trimOf = (url, done) => {
    if (TRIM.has(url)) return TRIM.get(url); if (trimWait.has(url)) return null; trimWait.add(url);
    const im = new Image(); im.onload = () => { try { const n = 96, c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d'), r = Math.min(n / (im.naturalWidth || n), n / (im.naturalHeight || n)), w = (im.naturalWidth || n) * r, h = (im.naturalHeight || n) * r; g.drawImage(im, (n - w) / 2, (n - h) / 2, w, h); const d = g.getImageData(0, 0, n, n).data; let t = n, b = -1; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (d[(y * n + x) * 4 + 3] > 20) { if (y < t) t = y; if (y > b) b = y; } TRIM.set(url, b >= t ? [Math.max(0, t - 1) / n, Math.min(n, b + 2) / n] : [0, 1]); } catch { TRIM.set(url, [0, 1]); } trimWait.delete(url); done?.(); };
    im.onerror = () => { TRIM.set(url, [0, 1]); trimWait.delete(url); }; im.src = url; return null;
  };
  const PALETTE = ['', '#0ea5e9', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7', '#ec4899', '#64748b', '#ffffff', '#111827'];
  const SHAPES = [['rect', 'Rectangle'], ['round', 'Rounded box'], ['ellipse', 'Circle / ellipse'], ['diamond', 'Diamond'], ['hexagon', 'Hexagon'], ['cylinder', 'Cylinder (database)'], ['cloud', 'Cloud'], ['zone', 'Zone (dashed area with a title)']];
  /** a shape as SVG, w × h canvas pixels */
  const shapeSvg = (it) => {
    const w = it.size, h = it.h, sw = it.sw ?? 2, i = sw / 2 + .5, fill = it.fill || 'var(--accent)', stroke = it.stroke || (it.shape === 'zone' ? 'var(--muted)' : 'var(--line2)');
    const st = `fill:${fill};fill-opacity:${(it.fa ?? 18) / 100};stroke:${stroke};stroke-width:${sw};${it.dash || it.shape === 'zone' ? `stroke-dasharray:${sw * 4} ${sw * 3};` : ''}`;
    let g;
    if (it.shape === 'round' || it.shape === 'zone') g = `<rect x="${i}" y="${i}" width="${w - 2 * i}" height="${h - 2 * i}" rx="${Math.min(w, h) * (it.shape === 'zone' ? .08 : .16)}"/>`;
    else if (it.shape === 'ellipse') g = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - i}" ry="${h / 2 - i}"/>`;
    else if (it.shape === 'diamond') g = `<polygon points="${w / 2},${i} ${w - i},${h / 2} ${w / 2},${h - i} ${i},${h / 2}"/>`;
    else if (it.shape === 'hexagon') { const q = Math.min(w * .25, h * .5); g = `<polygon points="${q},${i} ${w - q},${i} ${w - i},${h / 2} ${w - q},${h - i} ${q},${h - i} ${i},${h / 2}"/>`; }
    else if (it.shape === 'cylinder') { const ry = Math.min(h * .14, 34), rx = w / 2 - i; g = `<path d="M${i} ${ry + i}V${h - ry - i}A${rx} ${ry} 0 0 0 ${w - i} ${h - ry - i}V${ry + i}"/><ellipse cx="${w / 2}" cy="${ry + i}" rx="${rx}" ry="${ry}"/>`; }
    else if (it.shape === 'cloud') g = `<path transform="scale(${w / 100} ${h / 64})" vector-effect="non-scaling-stroke" d="M26 58C12 58 4 50 4 40c0-9 7-16 16-17 2-11 11-19 23-19 9 0 17 5 21 13 3-2 6-3 10-3 10 0 18 8 18 18v1c4 2 6 6 6 11 0 8-6 14-14 14z"/>`;
    else g = `<rect x="${i}" y="${i}" width="${w - 2 * i}" height="${h - 2 * i}" rx="2"/>`;
    return `<svg class="dvsvg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" style="${st}">${g}</svg>`;
  };
  /** the line between two items: straight, elbow (right angles, like a Visio connector) or curved; it starts and ends at the edge of each item */
  const ROUTES = [['straight', 'Straight', '<path d="M4 20 20 4"/>'], ['elbow', 'Elbow (right angles)', '<path d="M4 20h8V4h8"/>'], ['curve', 'Curved', '<path d="M4 20C4 8 20 16 20 4"/>']];
  const routeIco = (r) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(ROUTES.find((x) => x[0] === r) || ROUTES[0])[2]}</svg>`;
  const pref = (k, v) => { try { if (v === undefined) return localStorage.getItem('nep.dv.' + k); localStorage.setItem('nep.dv.' + k, v); } catch { return null; } return null; };
  /** the colour class of an item: down or a Critical alarm = red, Error = orange, Warning = amber, fine = green, unknown = grey */
  const cls = (st) => {
    if (!st) return 'st-unk';
    if (st.state === 'gone' || st.state === 'off' || st.state === 'unknown' || st.state === 'stale') return st.sev !== null && st.sev <= 4 ? cls({ ...st, state: 'up' }) : 'st-unk';
    if (st.state === 'down' || (st.sev !== null && st.sev <= 2)) return 'st-crit';
    if (st.sev === 3) return 'st-err'; if (st.sev === 4) return 'st-warn'; return 'st-ok';
  };
  const stText = (st) => (!st ? 'Waiting…' : st.text ? st.text : st.state === 'gone' ? (st.title || 'Removed') : st.state === 'off' ? 'Polling is off' : st.state === 'down' ? 'No answer' : st.state === 'stale' ? 'Probe not reporting' : st.state === 'unknown' ? 'Waiting for the first answer' : st.open ? `${st.open} open alarm${st.open === 1 ? '' : 's'}${st.sev !== null ? ' · worst ' + SEVN[st.sev] : ''}` : 'OK');

  views.devview = (el) => {
    let list = [], cur = null, edit = false, draft = null, status = {}, linkSt = [], portCache = {}, choices = null, canEdit = false, timer = 0, alive = true, sel = null, linkFrom = null, dirty = false, info = null, infoTimer = 0;   // info: the item whose details panel is open
    const k = () => { const w = $('.dvwrap', el); return w ? w.clientWidth / W : 1; };
    const markerOnly = (it) => it.pic === 'none';
    let lineRoute = ['straight', 'elbow', 'curve'].includes(pref('route')) ? pref('route') : 'straight', hist = [], fut = [], clip = null;   // 1.99.17 new lines' type; undo / redo; copied item
    const nid = () => 'i' + Math.random().toString(36).slice(2, 10);
    const monitored = (it) => it && (it.kind === 'device' || it.kind === 'server');
    /** the picture of an item as a URL (for the trim of empty space), or '' */
    const picUrl = (it) => { const pic = String(it.pic || ''); if (!pic || pic === 'none') return ''; if (pic.startsWith('img:')) return imgUrl(pic.slice(4)); if (!DP()) return ''; const ch = it.kind === 'device' ? choices?.find((c) => c.src === it.src && c.ref === it.ref) : null; return DP().url(devKey(pic, it.kind === 'device' ? (it.name || ch?.name || status[it.id]?.name || '') : '')); };
    const trimFor = (it) => { const u = picUrl(it); return u ? trimOf(u, () => { if (alive) requestAnimationFrame(applyTrim); }) : null; };
    const applyTrim = () => { const v = view(); if (!v) return; for (const it of v.items) { const t = trimFor(it); if (!t) continue; const n = $(`.dvi[data-id="${CSS.escape(it.id)}"] .dvpic.trim`, el); if (n) { n.style.setProperty('--t', t[0]); n.style.setProperty('--b', t[1]); } } relink(); };
    /** half the width and height of what a line meets at an item */
    const half = (it) => {
      if (!it || it.kind === 'label') return [0, 0]; if (it.kind === 'shape') return [it.size / 2, it.h / 2];
      const sz = it.size || 96; if (it.pic === 'none') return [sz / 2, (it.h || sz) / 2]; const t = trimFor(it) || [.2, .8]; return [sz * .46, sz * (t[1] - t[0]) / 2 + 4];
    };
    /** where a line from the centre c towards point p leaves the item */
    const edgePt = (c, p, it) => { const [hw, hh] = half(it), dx = p.x - c.x, dy = p.y - c.y, len = Math.hypot(dx, dy); if (!len || (!hw && !hh)) return { x: c.x, y: c.y }; const ux = dx / len, uy = dy / len; const t = Math.min(ux ? hw / Math.abs(ux) : 1e9, uy ? hh / Math.abs(uy) : 1e9, len * .45); return { x: +(c.x + ux * t).toFixed(1), y: +(c.y + uy * t).toFixed(1) }; };
    /** the path of a link and the middle point for its label */
    const lnGeo = (a, b, l) => {
      const r = l.route || 'straight', dx = b.x - a.x, dy = b.y - a.y;
      if (r === 'elbow') {
        if (Math.abs(dx) >= Math.abs(dy)) { const mx = Math.round(a.x + dx / 2), A = edgePt(a, { x: mx, y: a.y }, a), B = edgePt(b, { x: mx, y: b.y }, b); return { d: `M${A.x} ${A.y}H${mx}V${b.y}H${B.x}`, mx, my: (a.y + b.y) / 2 }; }
        const my = Math.round(a.y + dy / 2), A = edgePt(a, { x: a.x, y: my }, a), B = edgePt(b, { x: b.x, y: my }, b); return { d: `M${A.x} ${A.y}V${my}H${b.x}V${B.y}`, mx: (a.x + b.x) / 2, my };
      }
      if (r === 'curve') {
        const len = Math.hypot(dx, dy) || 1, k = (l.bend ?? 30) / 100 * len * .6, cx = (a.x + b.x) / 2 - dy / len * k, cy = (a.y + b.y) / 2 + dx / len * k, c = { x: cx, y: cy }, A = edgePt(a, c, a), B = edgePt(b, c, b);
        return { d: `M${A.x} ${A.y}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${B.x} ${B.y}`, mx: (A.x + 2 * cx + B.x) / 4, my: (A.y + 2 * cy + B.y) / 4 };
      }
      const A = edgePt(a, b, a), B = edgePt(b, a, b); return { d: `M${A.x} ${A.y}L${B.x} ${B.y}`, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    };
    let relinkRaf = 0;
    const relink = () => { if (relinkRaf) return; relinkRaf = requestAnimationFrame(() => { relinkRaf = 0; const v = view(), svg = $('.dvlinks', el); if (!v || !svg) return; const tmp = document.createElement('div'); tmp.innerHTML = linkSvg(v); const n = tmp.firstElementChild; if (n && n.innerHTML !== svg.innerHTML) svg.innerHTML = n.innerHTML; }); };
    /** undo / redo: every change is kept (up to 100 steps) */
    const commit = () => { if (!edit || !draft) return; const j = JSON.stringify(draft); if (hist[hist.length - 1] !== j) { hist.push(j); if (hist.length > 100) hist.shift(); fut = []; } };
    const undo = () => { commit(); if (hist.length < 2) return toast('Nothing to undo'); fut.push(hist.pop()); draft = JSON.parse(hist[hist.length - 1]); if (sel && !String(sel).startsWith('L:') && !draft.items.some((i) => i.id === sel)) sel = null; if (String(sel || '').startsWith('L:') && !draft.links[+String(sel).slice(2)]) sel = null; dirty = true; draw(); };
    const redo = () => { if (!fut.length) return toast('Nothing to redo'); const j = fut.pop(); hist.push(j); draft = JSON.parse(j); if (sel && !String(sel).startsWith('L:') && !draft.items.some((i) => i.id === sel)) sel = null; dirty = true; draw(); };

    const load = async (keepId) => {
      try { const r = await api('/api/views'); list = r.views || []; canEdit = !!r.canEdit; } catch (e) { el.innerHTML = `<div class="page-head"><h1>Device view</h1></div><div class="empty"><b>Could not load</b>${esc(e.message)}</div>`; return; }
      const want = keepId || S.hq?.get('v') || pref('last');
      cur = list.find((v) => v.id === want) || list[0] || null; draw(); poll();
    };
    const poll = async () => {
      clearTimeout(timer); if (!alive || !cur || edit) return;
      try { const r = await api('/api/views/status?id=' + encodeURIComponent(cur.id)); if (!alive) return; status = r.items || {}; linkSt = r.links || []; paintStatus(); } catch { /* next round */ }
      timer = setTimeout(poll, document.hidden ? 15000 : 5000);
    };
    const view = () => (edit ? draft : cur);

    // ---------- drawing ----------
    const itemHtml = (it) => {
      const st = status[it.id], isSel = sel === it.id, rz = edit && isSel ? '<span class="dvrz" title="Drag to resize"></span>' : '';
      if (it.kind === 'label') return `<div class="dvi dvlabel${isSel ? ' sel' : ''}" data-id="${esc(it.id)}" style="left:${it.x}px;top:${it.y}px;font-size:${it.size}px">${esc(it.text || 'Text')}</div>`;
      if (it.kind === 'shape') return `<div class="dvi dvshape${isSel ? ' sel' : ''}" data-id="${esc(it.id)}" style="left:${it.x}px;top:${it.y}px;width:${it.size}px;height:${it.h}px">${shapeSvg(it)}${it.text ? `<div class="dvstext${it.shape === 'zone' || it.ta === 'top' ? ' top' : ''}" style="font-size:${it.ts || 16}px;${it.tc ? 'color:' + it.tc : ''}">${esc(it.text)}</div>` : ''}${rz}</div>`;
      const pic = String(it.pic || 'icon:server'), s = it.size || 96, mk = pic === 'none', deco = it.kind === 'deco';
      const name = it.name || (it.kind === 'view' ? (list.find((v) => v.id === it.view)?.name || 'View') : it.kind === 'server' ? (st?.name || 'NetEventPro server') : deco ? '' : (choices?.find((c) => c.src === it.src && c.ref === it.ref)?.name || st?.name || 'Device'));
      const picHtml = mk ? '' : pic.startsWith('img:') ? `<img src="${imgUrl(pic.slice(4))}" alt="" draggable="false">` : devImg(pic, it.kind === 'device' ? name : '');
      const t = mk ? null : trimFor(it), tip = deco ? name : stText(st);
      return `<div class="dvi ${deco ? 'deco' : cls(st)}${st && st.unack && cls(st) === 'st-crit' ? ' pulse' : ''}${isSel ? ' sel' : ''}${linkFrom === it.id ? ' linkfrom' : ''}" data-id="${esc(it.id)}" style="left:${it.x}px;top:${it.y}px;--s:${s}px;--h:${mk ? (it.h || s) : s}px" ${deco ? '' : `title="${esc(tip)}"`} tabindex="0" role="${deco ? 'img' : 'button'}" aria-label="${esc(name || 'Picture')}${deco ? '' : ': ' + esc(tip)}">
        <div class="dvpic${pic.startsWith('img:') ? ' isimg' : ''}${mk ? ' marker' : ' trim'}" ${t ? `style="--t:${t[0]};--b:${t[1]}"` : ''}>${picHtml}${it.kind === 'view' ? '<span class="dvsub">open ›</span>' : ''}${rz}</div>
        ${deco ? '' : `<button type="button" class="dvbadge" ${st && st.open ? '' : 'hidden'} title="Show the open alarms" aria-label="Open alarms">${st ? st.open : ''}</button>`}
        ${(mk || deco) && it.hideName ? '' : name ? `<div class="dvname">${esc(name)}</div>` : ''}${st && st.down ? `<div class="dvread"><span class="r-crit">${st.down} without answer</span></div>` : ''}</div>`;
    };
    const readHtml = (st) => (st && st.down ? `<span class="r-crit">${st.down} without answer</span>` : '');
    const linkSvg = (v) => {
      const pos = new Map(v.items.map((i) => [i.id, i]));
      // 1.99.14 each link shows its state (up, busy, down, unknown) and, when it follows a port, the port and its use on a label in the middle
      // 1.99.17 straight, elbow or curved; arrows, dashes, width and an own colour (state colours win when a link is down or busy)
      let defs = '';
      const body = v.links.map((l, i) => {
        const a = pos.get(l.a), b = pos.get(l.b); if (!a || !b) return ''; const ls = edit ? null : linkSt[i];
        const st = ls ? ls.state : !monitored(a) && !monitored(b) && !l.port ? 'none' : [status[l.a], status[l.b]].some((x) => x && x.state === 'down') ? 'down' : 'up';
        let txt = edit ? (l.port ? `${l.label ? l.label + ' · ' : ''}${l.port.name}` : l.label || '') : ls?.text || l.label || ''; if (txt.length > 30) txt = txt.slice(0, 29) + '…';
        const g = lnGeo(a, b, l), on = edit && sel === 'L:' + i, lw = l.lw || 4, own = l.color && (edit || st === 'up' || st === 'none');
        const css = `stroke-width:${on ? lw + 3 : lw}px;${own ? `stroke:${l.color};` : ''}${l.dash === 'dash' ? `stroke-dasharray:${lw * 3} ${lw * 2.2};` : l.dash === 'dot' ? `stroke-dasharray:0.1 ${lw * 2.2};stroke-linecap:round;` : ''}`;
        const arr = l.arrow || 'none'; let mk = '';
        if (arr !== 'none') { defs += `<marker id="dvm${i}" class="dvah st-${st}${on ? ' on' : ''}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="${Math.max(3, 14 / Math.sqrt(lw))}" markerHeight="${Math.max(3, 14 / Math.sqrt(lw))}" orient="auto-start-reverse"><path d="M0 0L10 5 0 10z" ${own ? `style="fill:${l.color}"` : ''}/></marker>`; mk = `${arr === 'end' || arr === 'both' ? ` marker-end="url(#dvm${i})"` : ''}${arr === 'start' || arr === 'both' ? ` marker-start="url(#dvm${i})"` : ''}`; }
        return `<path d="${g.d}" class="ln st-${st}${l.port ? ' port' : ''}${on ? ' on' : ''}${own ? ' own' : ''}" data-l="${i}" style="${css}"${mk}><title>${esc(ls?.why || '')}</title></path>${txt ? `<g class="lnlab st-${st}" data-l="${i}" transform="translate(${g.mx} ${g.my})"><rect x="${-(txt.length * 4.1 + 10)}" y="-12" width="${txt.length * 8.2 + 20}" height="24" rx="12"/><text text-anchor="middle" y="5">${esc(txt)}</text></g>` : ''}${edit ? `<path d="${g.d}" class="hit" data-l="${i}"/>` : ''}`;
      }).join('');
      return `<svg class="dvlinks" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
    };
    const bgHtml = (v) => (v.bg?.mode === 'image' && v.bg.img ? `<img class="dvbg" src="${imgUrl(v.bg.img)}" alt="" draggable="false">${v.bg.dim ? `<div class="dvdim" style="opacity:${v.bg.dim / 100}"></div>` : ''}` : '');
    const canvasHtml = (v) => `<div class="dvwrap ${v.bg?.mode === 'grid' ? 'grid' : v.bg?.mode === 'plain' ? 'plain' : 'pic'}${edit ? ' editing' : ''}" id="dvWrap"><div class="dvcanvas" id="dvCanvas">${bgHtml(v)}${v.items.filter((i) => i.kind === 'shape').map(itemHtml).join('')}${linkSvg(v)}${v.items.filter((i) => i.kind !== 'shape').map(itemHtml).join('')}</div>${edit ? '' : ''}</div>`;

    const draw = () => {
      if (!alive) return; const v = view();
      const tabsH = list.length ? `<div class="gchips" role="tablist">${list.map((x) => `<button class="gchip${cur && x.id === cur.id ? ' on' : ''}" data-v="${esc(x.id)}" role="tab" ${edit ? 'disabled' : ''}>${esc(x.name)}</button>`).join('')}</div>` : '';
      const tools = edit ? `<div class="toolbar dvtools"><button id="dvAdd" class="primary">Add device</button><button id="dvAddS" title="This NetEventPro server (the monitoring PC). Its colour follows the System health checks.">Add this server</button><button id="dvAddP" title="A picture that is not monitored, to complete the drawing: a PC, a patch panel, a cloud, a rack">Add picture</button><button id="dvAddL" title="Text (T)">Add text</button><button id="dvShape" aria-haspopup="menu" title="Rectangle (R), ellipse (O) and more shapes">Shape ▾</button>
          <span class="btngroup dvlinebtns"><button id="dvLink" class="${linkFrom !== null ? 'on' : ''}" title="Click two items to join them with a line (L). Click a line to change it.">${linkFrom !== null ? (linkFrom ? 'Click the second item…' : 'Click the first item…') : 'Draw line'}</button>${ROUTES.map(([r, label], n) => `<button class="ib dvroute${lineRoute === r ? ' on' : ''}" data-route="${r}" title="${label} line (${n + 1})" aria-label="${label} line" aria-pressed="${lineRoute === r}">${routeIco(r)}</button>`).join('')}</span>
          <button id="dvAddV" ${list.length > 1 ? '' : 'disabled title="Make a second view first"'}>Box to another view</button><button id="dvBg">Background…</button><button id="dvRen">Rename</button><button id="dvKeys" class="ib" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">⌨</button><span class="spacer"></span><button id="dvUndo" class="ib" title="Undo (Ctrl+Z)" aria-label="Undo" ${hist.length > 1 ? '' : 'disabled'}>↶</button><button id="dvRedo" class="ib" title="Redo (Ctrl+Y)" aria-label="Redo" ${fut.length ? '' : 'disabled'}>↷</button><button id="dvDel" class="danger">Delete view</button><button id="dvCancel">Cancel</button><button id="dvSave" class="primary" title="Save (Ctrl+S)">Save</button></div>`
        : `<div class="toolbar"><span class="muted" id="dvSum"></span><span class="spacer"></span>${v ? '<button id="dvWall" title="Show this view on the whole screen, for a wall screen (the details panel works there too)">Wall screen</button>' : ''}${canEdit ? `${v ? '<button id="dvEdit">Edit</button>' : ''}<button id="dvNew" class="${v ? '' : 'primary'}">New view</button>` : ''}</div>`;
      el.innerHTML = `<div class="page-head"><h1>Device view</h1><span class="muted">Your devices as pictures with their live state</span></div>${tabsH}${tools}
        ${v ? `<div class="dvlayout" id="dvStage">${stageInner(v)}</div>
          ${edit ? '<p class="muted" style="margin:6px 0 0">Drag to move; drag the corner handle to resize. Click an item or a line to change it. Arrow keys move the selected item, Delete removes it, Ctrl+Z undoes. Press ? for all shortcuts.</p>' : '<div class="dvlegend muted"><span class="lg st-ok"></span>OK <span class="lg st-warn"></span>Warning <span class="lg st-err"></span>Error <span class="lg st-crit"></span>Critical or no answer <span class="lg st-unk"></span>Unknown or off</div>'}`
        : `<div class="empty steps"><b>No device view yet</b>${canEdit ? '<ol class="emsteps"><li><b>Make a view</b><span>For a room, a rack, a site or your whole network.</span></li><li><b>Place your devices</b><span>Polled devices and devices that send syslog or traps; pick a picture for each.</span></li><li><b>Watch it live</b><span>Each picture turns amber or red with its alarms, and shows up to three readings.</span></li></ol><button class="primary" id="dvNew2">New view</button>' : 'An administrator can make views here.'}</div>`}`;
      { const stg = $('#dvStage', el); if (stg) stg.classList.toggle('withside', sideOk() || infoOk()); }
      fit(); wire(); paintStatus(); requestAnimationFrame(fit); commit();
    };
    const isWall = () => { const st = $('#dvStage', el); return !!st && (document.fullscreenElement === st || st.classList.contains('wall')); };
    /** 1.99.17 the details panel is shown only for a device or this server that is in the view (it stayed on "Loading…" for an item that was not there any more) */
    const infoOk = () => !!(info && !edit && cur && cur.items.some((i) => i.id === info && monitored(i)));
    const sideOk = () => !!(edit && sel && (String(sel).startsWith('L:') ? draft.links[+String(sel).slice(2)] : draft.items.some((i) => i.id === sel)));
    const stageInner = (v) => { if (info && !infoOk()) info = null; return `${edit ? '' : `<div class="dvwallbar"><span class="wname">${esc(v.name)}</span><span class="wdate"></span><span class="wtime"></span></div>`}${canvasHtml(v)}${sideOk() ? `<aside class="panel dvside" id="dvSide">${sideHtml()}</aside>` : ''}${infoOk() ? `<aside class="panel dvside dvinfo" id="dvInfo" aria-live="polite"><div class="muted">Loading…</div></aside>` : ''}${edit ? '' : '<div class="dvtip" id="dvTip" hidden></div><button class="dvwallx" id="dvWallX" title="Leave the wall screen">Leave wall screen</button>'}`; };
    /** 1.99.12 redraws only the inside of the stage, so the wall screen (the stage is the full-screen element) stays on */
    const drawStage = () => {
      const st = $('#dvStage', el), v = view(); if (!st || !v) return draw();
      st.innerHTML = stageInner(v); st.classList.toggle('withside', sideOk() || infoOk()); fit(); wire(); paintStatus(); requestAnimationFrame(fit);
    };
    const setInfo = (id) => { info = id; drawStage(); };
    const fit = () => {
      const c = $('#dvCanvas', el), w = $('#dvWrap', el), st = $('#dvStage', el); if (!c || !w) return;
      if (st && (document.fullscreenElement === st || st.classList.contains('wall'))) {   // wall screen: as large as fits next to the panel
        const cs = getComputedStyle(st), side = $('.dvside', st), aw = st.clientWidth - (side ? side.offsetWidth + 12 : 0) - 24, ah = st.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom), ww = Math.max(200, Math.min(aw, ah * W / H));
        w.style.width = ww + 'px'; w.style.height = (ww * H / W) + 'px';
      } else { w.style.width = ''; w.style.height = ''; }
      c.style.transform = `scale(${k()})`;
    };
    const paintStatus = () => {
      const v = view(); if (!v || edit) { if (!v) return; }
      for (const it of v.items) {
        if (!monitored(it) && it.kind !== 'view') continue; const n = $(`.dvi[data-id="${CSS.escape(it.id)}"]`, el); if (!n) continue; const st = status[it.id];
        const c = cls(st); if (!n.classList.contains(c)) { n.classList.remove('st-ok', 'st-warn', 'st-err', 'st-crit', 'st-unk'); n.classList.add(c); }
        n.classList.toggle('pulse', !!(st && st.unack && c === 'st-crit')); n.title = stText(st);
        const b = $('.dvbadge', n); if (b) { b.hidden = !(st && st.open); b.textContent = st ? st.open : ''; }
        { const h = readHtml(st); let r = $('.dvread', n); if (h && !r) { r = document.createElement('div'); r.className = 'dvread'; n.appendChild(r); } if (r && r.innerHTML !== h) r.innerHTML = h; }
        if (it.kind === 'device' && DP() && String(it.pic || '').startsWith('icon:') && !DP().has(String(it.pic).slice(5))) { const im = $('.dvdp', n), u = DP().url(devKey(it.pic, it.name || st?.name || '')); if (im && im.getAttribute('src') !== u) im.setAttribute('src', u); }   // older icons follow the device name once it is known
        if (!it.name && st?.name) { const nm = $('.dvname', n); if (nm && nm.textContent !== st.name) { nm.textContent = st.name; n.setAttribute('aria-label', `${st.name}: ${stText(st)}`); } }
      }
      const svg = $('.dvlinks', el); if (svg && !edit) { const html = linkSvg(v); const tmp = document.createElement('div'); tmp.innerHTML = html; const nsvg = tmp.firstElementChild; if (nsvg && nsvg.innerHTML !== svg.innerHTML) svg.innerHTML = nsvg.innerHTML; }
      const sum = $('#dvSum', el); if (sum) { const all = v.items.filter((i) => i.kind === 'device').map((i) => status[i.id]).filter(Boolean); const bad = all.filter((x) => cls(x) === 'st-crit').length, warn = all.filter((x) => ['st-err', 'st-warn'].includes(cls(x))).length; sum.textContent = `${all.length} device${all.length === 1 ? '' : 's'}${bad ? ` · ${bad} critical or not answering` : ''}${warn ? ` · ${warn} with warnings or errors` : ''}${!bad && !warn && all.length ? ' · all fine' : ''}`; }
    };

    // ---------- side panel while editing ----------
    const selItem = () => draft?.items.find((i) => i.id === sel);
    const sideHtml = () => {
      if (String(sel || '').startsWith('L:')) return linkSide();
      const it = selItem(); if (!it) return '';
      const swatch = (id, cur2, title) => `<div class="dvsw" role="group" aria-label="${title}" data-sw="${id}">${PALETTE.map((c) => `<button type="button" class="dvswc${(cur2 || '') === c ? ' on' : ''}" data-c="${c}" title="${c || 'Theme colour'}" aria-label="${c || 'Theme colour'}" style="${c ? '--c:' + c : ''}">${c ? '' : 'A'}</button>`).join('')}<label class="dvswc pick" title="Another colour"><input type="color" value="${cur2 || '#0ea5e9'}" data-cin="${id}">＋</label></div>`;
      const order = `<div class="toolbar" style="margin-top:12px"><button id="sdDup" title="Duplicate (Ctrl+D)">Duplicate</button><button id="sdFront" title="Bring to front (])">To front</button><button id="sdBack" title="Send to back ([)">To back</button><button id="sdDel" class="danger" title="Remove (Delete)">Remove</button></div>`;
      if (it.kind === 'shape') return `<h3>Shape</h3><div class="form">
        <div class="field"><label for="shK">Kind</label><div><select id="shK">${SHAPES.map(([k2, l2]) => `<option value="${k2}" ${it.shape === k2 ? 'selected' : ''}>${l2}</option>`).join('')}</select></div></div>
        <div class="field"><label for="shT">Text</label><div><textarea id="shT" rows="2" maxlength="200">${esc(it.text || '')}</textarea></div></div>
        <div class="field"><label for="shTS">Text size <output id="shTSo" class="dvnum">${it.ts || 16}</output></label><div><input type="range" id="shTS" min="10" max="72" value="${it.ts || 16}"></div></div>
        <div class="field"><label>Text colour</label><div>${swatch('tc', it.tc, 'Text colour')}</div></div>
        <label class="chk"><input type="checkbox" id="shTop" ${it.ta === 'top' || it.shape === 'zone' ? 'checked' : ''} ${it.shape === 'zone' ? 'disabled' : ''}> Text at the top</label>
        <div class="field"><label>Fill</label><div>${swatch('fill', it.fill, 'Fill colour')}</div></div>
        <div class="field"><label for="shFA">Fill strength <output id="shFAo" class="dvnum">${it.fa ?? 18}%</output></label><div><input type="range" id="shFA" min="0" max="100" value="${it.fa ?? 18}"></div></div>
        <div class="field"><label>Line</label><div>${swatch('stroke', it.stroke, 'Line colour')}</div></div>
        <div class="field"><label for="shSW">Line width <output id="shSWo" class="dvnum">${it.sw ?? 2}</output></label><div><input type="range" id="shSW" min="0" max="12" value="${it.sw ?? 2}"></div></div>
        <label class="chk"><input type="checkbox" id="shD" ${it.dash ? 'checked' : ''}> Dashed line</label>
        <div class="field dvwh"><label>Size</label><div><input type="number" id="shW" min="16" max="1600" value="${it.size}" aria-label="Width"> × <input type="number" id="shH" min="16" max="900" value="${it.h}" aria-label="Height"></div></div></div>${order}`;
      if (it.kind === 'label') return `<h3>Text</h3><div class="form"><div class="field"><label for="sdT">Text</label><div><input type="text" id="sdT" value="${esc(it.text || '')}" maxlength="120"></div></div><div class="field"><label for="sdS">Size <output id="sdSo" class="dvnum">${it.size || 18}</output></label><div><input type="range" id="sdS" min="10" max="72" value="${it.size || 18}"></div></div></div>${order}`;
      const ch = it.kind === 'device' ? choices?.find((c) => c.src === it.src && c.ref === it.ref) : null;
      const curK = String(it.pic || '').startsWith('icon:') ? devKey(it.pic, ch?.name || it.name) : '';
      let lastG = ''; const pics = (DP() ? DP().list() : ICONS()).map((x) => { const head = x.group && x.group !== lastG ? `<div class="dvpg">${esc(x.group)}</div>` : ''; lastG = x.group || lastG; return `${head}<button class="dvpick dp${curK === x.k ? ' on' : ''}" data-pic="icon:${x.k}" title="${esc(x.label)}">${DP() ? `<img src="${DP().url(x.k)}" alt="${esc(x.label)}">` : iconSvg(x.k, 22)}</button>`; }).join('');
      return `<h3>${it.kind === 'view' ? 'Box to another view' : it.kind === 'server' ? 'This NetEventPro server' : it.kind === 'deco' ? 'Picture (not monitored)' : esc(ch?.name || 'Device')}</h3>${it.kind === 'server' ? '<div class="muted" style="margin:-6px 0 8px">Green when the System health checks are fine, amber with warnings, red when a check fails.</div>' : it.kind === 'deco' ? '<div class="muted" style="margin:-6px 0 8px">Completes the drawing. It has no state and no alarms.</div>' : ''}${ch ? `<div class="muted" style="margin:-6px 0 8px">${esc(ch.host)} · ${ch.src === 'poll' ? 'SNMP polling' : 'syslog / traps'}</div>` : ''}
        <div class="form"><div class="field"><label for="sdN">Shown name</label><div><input type="text" id="sdN" value="${esc(it.name || '')}" placeholder="${esc(ch?.name || (it.kind === 'server' ? 'NetEventPro server' : it.kind === 'deco' ? 'No name' : ''))}" maxlength="60"></div></div>
        ${it.kind === 'view' ? `<div class="field"><label for="sdV">Opens</label><div><select id="sdV">${list.filter((v) => v.id !== draft.id).map((v) => `<option value="${esc(v.id)}" ${it.view === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></div></div>` : ''}
        <div class="field"><label for="sdS">${markerOnly(it) ? 'Width' : 'Size'} <output id="sdSo" class="dvnum">${it.size || 96}</output></label><div><input type="range" id="sdS" min="${markerOnly(it) ? 16 : 40}" max="${markerOnly(it) ? 600 : 240}" value="${it.size || 96}"></div></div>
        ${it.kind === 'deco' || it.kind === 'server' ? `<label class="chk"><input type="checkbox" id="sdHN" ${it.hideName ? 'checked' : ''}> Hide the name</label>` : ''}
        ${markerOnly(it) ? `<div class="field"><label for="sdH">Height <output id="sdHo" class="dvnum">${it.h || it.size || 96}</output></label><div><input type="range" id="sdH" min="16" max="600" value="${it.h || it.size || 96}"></div></div><label class="chk"><input type="checkbox" id="sdHN" ${it.hideName ? 'checked' : ''}> Hide the name (the drawing already shows it)</label>` : ''}</div>
        <div class="dvpicks" role="group" aria-label="Picture">${it.kind === 'device' ? `<button class="dvpick mk${markerOnly(it) ? ' on' : ''}" data-pic="none" title="Marker only: no picture, just a live coloured frame and alarm count. Put it over a device in your background drawing (for example a Visio drawing saved as SVG).">▢<span>Marker</span></button>` : ''}${pics}${it.kind !== 'view' ? `<label class="dvpick upl" title="Your own picture (PNG, JPEG, WebP or SVG, up to 8 MB). More device drawings are in the NetEventPro folder under app\\assets\\stencils.">＋<input type="file" id="sdUp" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" hidden></label>` : ''}</div>
        ${it.kind === 'device' ? '<p class="muted" style="margin:8px 0 0;font-size:12px">The device\'s readings show in the details panel when you click it (outside edit mode).</p>' : ''}
        ${order}`;
    };
    /** 1.99.14 settings of the selected link: label, which port it follows and what its label shows */
    const linkSide = () => {
      const l = draft.links[+String(sel).slice(2)]; if (!l) return '';
      const nm = (id) => { const it = draft.items.find((i) => i.id === id); const ch = it && choices?.find((c) => c.src === it.src && c.ref === it.ref); return it?.name || ch?.name || (it?.kind === 'view' ? 'View box' : 'Device'); };
      const end = l.port?.end || 'a', endId = end === 'b' ? l.b : l.a, pc = portCache[endId];
      const opts = pc ? pc.ports.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}${p.alias ? ' · ' + esc(p.alias) : ''}${p.status ? ' (' + esc(p.status) + ')' : ''}</option>`).join('') : '';
      return `<h3>Link</h3><div class="muted" style="margin:-6px 0 10px">${esc(nm(l.a))} ↔ ${esc(nm(l.b))}</div>
        <div class="form"><div class="field"><label for="lkL">Label</label><div><input type="text" id="lkL" value="${esc(l.label || '')}" maxlength="40" placeholder="for example Uplink, Fibre 1"></div></div>
        <div class="field"><label for="lkF">Colour follows</label><div><select id="lkF"><option value="">Both devices (red when one does not answer)</option><option value="a" ${l.port && end === 'a' ? 'selected' : ''}>A port on ${esc(nm(l.a))}</option><option value="b" ${l.port && end === 'b' ? 'selected' : ''}>A port on ${esc(nm(l.b))}</option></select></div></div>
        ${l.port ? `<div class="field"><label for="lkP">Port</label><div><input type="text" id="lkP" list="lkPL" value="${esc(l.port.name)}" maxlength="120" placeholder="Gi1/0/24"><datalist id="lkPL">${opts}</datalist>
          <div class="muted" style="font-size:12px;margin-top:4px">${!pc ? 'Loading the ports…' : pc.kind === 'poll' ? (pc.ports.length ? `${pc.ports.length} ports reported by this device. Type to search.` : 'This device has not reported its ports yet (they come with the next poll).') : pc.ports.length ? 'Ports seen in this device\'s alarms. A link turns red while an alarm is open on that port.' : 'No port names seen in this device\'s alarms yet. Type the port as the messages write it, for example Gi1/0/24.'}</div></div></div>
        <div class="field"><label for="lkS">Label shows</label><div><select id="lkS"><option value="port" ${l.show !== 'util' && l.show !== 'none' ? 'selected' : ''}>Port name and state</option><option value="util" ${l.show === 'util' ? 'selected' : ''}>How busy it is (% and speed)</option><option value="none" ${l.show === 'none' ? 'selected' : ''}>Nothing (colour only)</option></select></div></div>` : ''}</div>
        <div class="form dvlnform"><div class="field"><label>Line type</label><div class="dvseg">${ROUTES.map(([r, label]) => `<button type="button" class="${(l.route || 'straight') === r ? 'on' : ''}" data-lr="${r}" title="${label}" aria-pressed="${(l.route || 'straight') === r}">${routeIco(r)}<span>${label.split(' ')[0]}</span></button>`).join('')}</div></div>
          ${l.route === 'curve' ? `<div class="field"><label for="lkB">Curve <output id="lkBo" class="dvnum">${l.bend ?? 30}</output></label><div><input type="range" id="lkB" min="-100" max="100" value="${l.bend ?? 30}"><div class="muted" style="font-size:12px">Below 0 bends to the other side.</div></div></div>` : ''}
          <div class="field"><label for="lkA">Arrows</label><div><select id="lkA">${[['none', 'None'], ['end', 'At the second item'], ['start', 'At the first item'], ['both', 'Both ends']].map(([x, t]) => `<option value="${x}" ${(l.arrow || 'none') === x ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
          <div class="field"><label for="lkD">Line style</label><div><select id="lkD">${[['solid', 'Solid'], ['dash', 'Dashed'], ['dot', 'Dotted']].map(([x, t]) => `<option value="${x}" ${(l.dash || 'solid') === x ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
          <div class="field"><label for="lkW">Width <output id="lkWo" class="dvnum">${l.lw || 4}</output></label><div><input type="range" id="lkW" min="1" max="12" value="${l.lw || 4}"></div></div>
          <div class="field"><label>Colour</label><div>${`<div class="dvsw" data-sw="lcolor">${PALETTE.map((c) => `<button type="button" class="dvswc${(l.color || '') === c ? ' on' : ''}" data-c="${c}" title="${c || 'Follows the state'}" aria-label="${c || 'Follows the state'}" style="${c ? '--c:' + c : ''}">${c ? '' : 'A'}</button>`).join('')}<label class="dvswc pick" title="Another colour"><input type="color" value="${l.color || '#0ea5e9'}" data-cin="lcolor">＋</label></div>`}<div class="muted" style="font-size:12px">A: the colour follows the state. An own colour is used while the link is up; red and amber still show problems.</div></div></div></div>
        <p class="muted" style="font-size:12px;margin:8px 0 0">Green: up · amber: over 90% busy or a minor alarm · red: down · grey: not known.</p>
        <div class="toolbar" style="margin-top:12px"><button id="lkDel" class="danger">Remove link</button></div>`;
    };
    const loadPorts = async (itemId) => { if (portCache[itemId] || !draft?.id) return; try { portCache[itemId] = await api(`/api/views/ports?id=${encodeURIComponent(draft.id)}&item=${encodeURIComponent(itemId)}`); } catch { portCache[itemId] = { kind: 'dev', ports: [] }; } if (String(sel || '').startsWith('L:')) redrawKeep(); };
    const wireLink = (side) => {
      const i = +String(sel).slice(2), l = draft.links[i]; if (!l) return;
      if (l.port) loadPorts(l.port.end === 'b' ? l.b : l.a);
      const lab = $('#lkL', side); if (lab) lab.oninput = () => { l.label = lab.value; dirty = true; };
      const f = $('#lkF', side); if (f) f.onchange = () => { l.port = f.value ? { end: f.value, name: l.port?.end === f.value ? l.port.name : '' } : null; if (l.port && !l.show) l.show = 'port'; dirty = true; redrawKeep(); };
      const pp = $('#lkP', side); if (pp) pp.oninput = () => { l.port.name = pp.value; dirty = true; };
      const sh = $('#lkS', side); if (sh) sh.onchange = () => { l.show = sh.value; dirty = true; };
      const del = $('#lkDel', side); if (del) del.onclick = () => { draft.links.splice(i, 1); sel = null; dirty = true; draw(); };
      $$('[data-lr]', side).forEach((b) => { b.onclick = () => { l.route = b.dataset.lr; dirty = true; redrawKeep(); }; });
      const bend = $('#lkB', side); if (bend) bend.oninput = () => { l.bend = +bend.value; $('#lkBo', side).textContent = bend.value; dirty = true; relink(); };
      const ar = $('#lkA', side); if (ar) ar.onchange = () => { l.arrow = ar.value; dirty = true; relink(); commit(); };
      const ds = $('#lkD', side); if (ds) ds.onchange = () => { l.dash = ds.value; dirty = true; relink(); commit(); };
      const lw = $('#lkW', side); if (lw) lw.oninput = () => { l.lw = +lw.value; $('#lkWo', side).textContent = lw.value; dirty = true; relink(); };
      wireSwatch(side, 'lcolor', (c) => { l.color = c; relink(); });
      side.addEventListener('change', commit);
    };
    /** colour buttons: a colour from the row, the theme colour (empty) or any colour */
    const wireSwatch = (side, id, set) => {
      const box = $(`[data-sw="${id}"]`, side); if (!box) return;
      const mark = (c) => $$('.dvswc[data-c]', box).forEach((b) => b.classList.toggle('on', b.dataset.c === c));
      $$('.dvswc[data-c]', box).forEach((b) => { b.onclick = () => { set(b.dataset.c); mark(b.dataset.c); dirty = true; commit(); }; });
      const ci = $(`[data-cin="${id}"]`, box); if (ci) { ci.oninput = () => { set(ci.value.toLowerCase()); mark(''); dirty = true; }; ci.onchange = commit; }
    };
    const redrawKeep = () => { const sc = $('#dvSide', el)?.scrollTop || 0; draw(); const s2 = $('#dvSide', el); if (s2) s2.scrollTop = sc; };

    // ---------- events ----------
    const wire = () => {
      $$('.gchip[data-v]', el).forEach((b) => { b.onclick = () => { cur = list.find((v) => v.id === b.dataset.v); pref('last', cur.id); status = {}; info = null; hideTip(); draw(); poll(); }; });
      const on = (id, f) => { const b = $('#' + id, el); if (b) b.onclick = f; };
      on('dvNew', newView); on('dvNew2', newView);
      on('dvEdit', async () => { if (!choices) { try { choices = (await api('/api/views/choices')).devices; } catch (e) { return toast(e.message, true); } } edit = true; info = null; hideTip(); draft = structuredClone(cur); sel = null; linkFrom = null; dirty = false; hist = [JSON.stringify(draft)]; fut = []; clearTimeout(timer); draw(); });
      on('dvWall', () => { const w = $('#dvStage', el); if (!w) return; (w.requestFullscreen ? w.requestFullscreen() : Promise.reject(new Error('no'))).catch(() => { w.classList.add('wall'); document.body.classList.add('dv-wall'); setTimeout(fit, 30); }); });
      on('dvWallX', () => { if (document.fullscreenElement) document.exitFullscreen(); const w = $('#dvStage', el); w?.classList.remove('wall'); document.body.classList.remove('dv-wall'); setTimeout(fit, 30); });
      if (!edit && info) fillInfo();
      on('dvCancel', async () => { if (dirty && !await askConfirm('Leave without saving your changes to this view?', 'Leave')) return; edit = false; draft = null; sel = null; linkFrom = null; draw(); poll(); });
      on('dvSave', save);
      on('dvDel', async () => { if (!await askConfirm(`Delete the view "${draft.name}"? The devices themselves are not changed.`, 'Delete')) return; try { await api('/api/views/delete', { method: 'POST', body: { id: draft.id } }); edit = false; draft = null; toast('View deleted'); load(); } catch (e) { toast(e.message, true); } });
      on('dvRen', async () => { const n = await askText('Name of this view', draft.name); if (n && n.trim()) { draft.name = n.trim().slice(0, 60); dirty = true; draw(); } });
      on('dvAdd', addDevice);
      on('dvAddL', () => place({ id: nid(), kind: 'label', x: W / 2, y: 60, size: 22, text: 'Text' }));
      on('dvAddS', () => place({ id: nid(), kind: 'server', x: W / 2, y: H / 2, size: 120, pic: 'icon:server-tower', name: '' }));
      on('dvAddP', () => place({ id: nid(), kind: 'deco', x: W / 2, y: H / 2, size: 110, pic: 'icon:pc-desktop', name: '' }));
      on('dvShape', () => menuPopover($('#dvShape', el), SHAPES.map(([k2, l2]) => ({ icon: 'plus', label: l2, fn: () => addShape(k2) }))));
      on('dvKeys', keysHelp); on('dvUndo', undo); on('dvRedo', redo);
      $$('[data-route]', el).forEach((b) => { b.onclick = () => setRoute(b.dataset.route); });
      on('dvAddV', () => { const other = list.find((v) => v.id !== draft.id); if (!other) return; const it = { id: nid(), kind: 'view', view: other.id, x: W / 2, y: H / 2, size: 96, pic: 'icon:building', name: '' }; draft.items.push(it); sel = it.id; dirty = true; draw(); });
      on('dvLink', () => { linkFrom = linkFrom === null ? '' : null; draw(); });
      on('dvBg', background);
      const wrap = $('#dvWrap', el); if (!wrap) return;
      if (!edit) {
        wrap.onclick = (e) => { const n = e.target.closest('.dvi'); if (!n) { if (info) setInfo(null); return; } const it = cur.items.find((i) => i.id === n.dataset.id); if (!it) return; if (it.kind === 'view') { const v = list.find((x) => x.id === it.view); if (v) { cur = v; info = null; pref('last', v.id); status = {}; if (isWall()) drawStage(); else draw(); poll(); } } else if (monitored(it)) { hideTip(); if (e.target.closest('.dvbadge')) return alarmWindow(it); if (info !== it.id) setInfo(it.id); } };
        wireTip(wrap);
        wrap.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.dvi')) { e.preventDefault(); e.target.click(); } };
        return;
      }
      // editing: drag, resize (corner handle), select, draw lines
      let drag = null;
      wrap.onpointerdown = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        const hit = e.target.closest('.hit'); if (hit) { sel = 'L:' + hit.dataset.l; linkFrom = null; draw(); return; }   // 1.99.14 a click selects the link (settings in the side panel) instead of deleting it
        const n = e.target.closest('.dvi'); if (!n) { if (sel) { sel = null; draw(); } return; }
        const it = draft.items.find((i) => i.id === n.dataset.id); if (!it) return;
        if (linkFrom !== null) { if (it.kind === 'label') return; if (!linkFrom) { linkFrom = it.id; draw(); return; } if (linkFrom !== it.id && !draft.links.some((l) => (l.a === linkFrom && l.b === it.id) || (l.b === linkFrom && l.a === it.id))) { draft.links.push({ a: linkFrom, b: it.id, route: lineRoute }); dirty = true; } linkFrom = ''; draw(); return; }
        e.preventDefault(); const sc = k() * zf();
        if (e.target.closest('.dvrz')) { drag = { mode: 'rz', it, n, sx: e.clientX, sy: e.clientY, x0: it.x, y0: it.y, w0: it.size || 96, h0: it.h || it.size || 96, sc, moved: false }; wrap.setPointerCapture(e.pointerId); return; }
        drag = { it, n, sx: e.clientX, sy: e.clientY, x0: it.x, y0: it.y, sc, moved: false }; wrap.setPointerCapture(e.pointerId);
      };
      wrap.onpointermove = (e) => {
        if (!drag) return; const dx = (e.clientX - drag.sx) / drag.sc, dy = (e.clientY - drag.sy) / drag.sc; if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return; drag.moved = true;
        const it = drag.it;
        if (drag.mode === 'rz') {   // shapes and markers: the opposite corner stays; pictures: the size follows the handle
          if (it.kind === 'shape' || it.pic === 'none') { const w = Math.round(Math.max(16, Math.min(it.kind === 'shape' ? W : 600, drag.w0 + dx))), h = Math.round(Math.max(16, Math.min(it.kind === 'shape' ? H : 600, drag.h0 + dy))); it.size = w; it.h = h; it.x = Math.round(drag.x0 + (w - drag.w0) / 2); it.y = Math.round(drag.y0 + (h - drag.h0) / 2); }
          else if (it.kind === 'label') return;
          else it.size = Math.round(Math.max(40, Math.min(240, drag.w0 + Math.max(dx, dy) * 1.4)));
          const tmp = document.createElement('div'); tmp.innerHTML = itemHtml(it); const nn = tmp.firstElementChild; drag.n.replaceWith(nn); drag.n = nn; relink();
          const side = $('#dvSide', el); if (side) { const set = (id, v2) => { const x = $('#' + id, side); if (x) x.value = v2; }; set('shW', it.size); set('shH', it.h); set('sdS', it.size); set('sdH', it.h || it.size); const o = $('#sdSo', side); if (o) o.textContent = it.size; const o2 = $('#sdHo', side); if (o2) o2.textContent = it.h || it.size; }
          return;
        }
        it.x = Math.round(Math.min(W, Math.max(0, drag.x0 + dx))); it.y = Math.round(Math.min(H, Math.max(0, drag.y0 + dy)));
        drag.n.style.left = it.x + 'px'; drag.n.style.top = it.y + 'px'; relink();
      };
      wrap.onpointerup = () => { if (!drag) return; const d = drag; drag = null; if (d.moved) { dirty = true; commit(); const b = $('#dvUndo', el); if (b) b.disabled = hist.length < 2; return; } if (sel !== d.it.id) { sel = d.it.id; draw(); } };
      const side = $('#dvSide', el); if (side) wireSide(side);
    };
    const wireSide = (side) => {
      if (String(sel || '').startsWith('L:')) return wireLink(side);
      const it = selItem(); if (!it) return;
      const inp = (id, f) => { const x = $('#' + id, side); if (x) x.oninput = () => { f(x); dirty = true; const n = $(`.dvi[data-id="${CSS.escape(it.id)}"]`, el); if (n) { const tmp = document.createElement('div'); tmp.innerHTML = itemHtml(it); n.replaceWith(tmp.firstElementChild); } }; };
      inp('sdN', (x) => { it.name = x.value; }); inp('sdT', (x) => { it.text = x.value; }); inp('sdS', (x) => { it.size = +x.value; const o = $('#sdSo', side); if (o) o.textContent = x.value; }); inp('sdH', (x) => { it.h = +x.value; const o = $('#sdHo', side); if (o) o.textContent = x.value; });
      { const hn = $('#sdHN', side); if (hn) hn.onchange = () => { it.hideName = hn.checked; dirty = true; redrawKeep(); }; }
      const sv = $('#sdV', side); if (sv) sv.onchange = () => { it.view = sv.value; dirty = true; redrawKeep(); };
      $$('.dvpick[data-pic]', side).forEach((b) => { b.onclick = () => { it.pic = b.dataset.pic; if (it.pic === 'none' && !it.h) it.h = it.size || 96; dirty = true; redrawKeep(); }; });
            const up = $('#sdUp', side); if (up) up.onchange = () => upload(up.files[0], (id) => { it.pic = 'img:' + id; dirty = true; redrawKeep(); });
      const del = $('#sdDel', side); if (del) del.onclick = () => removeSel();
      { const b = $('#sdDup', side); if (b) b.onclick = () => duplicate(); }
      { const b = $('#sdFront', side); if (b) b.onclick = () => reorder(1); }
      { const b = $('#sdBack', side); if (b) b.onclick = () => reorder(-1); }
      if (it.kind === 'shape') {
        const redo1 = () => { dirty = true; const n = $(`.dvi[data-id="${CSS.escape(it.id)}"]`, el); if (n) { const tmp = document.createElement('div'); tmp.innerHTML = itemHtml(it); n.replaceWith(tmp.firstElementChild); } relink(); };
        const o = (id, f) => { const x = $('#' + id, side); if (x) x.oninput = () => { f(x); redo1(); }; };
        o('shT', (x) => { it.text = x.value; }); o('shTS', (x) => { it.ts = +x.value; $('#shTSo', side).textContent = x.value; }); o('shFA', (x) => { it.fa = +x.value; $('#shFAo', side).textContent = x.value + '%'; }); o('shSW', (x) => { it.sw = +x.value; $('#shSWo', side).textContent = x.value; });
        o('shW', (x) => { const v2 = Math.round(+x.value); if (v2 >= 16 && v2 <= W) it.size = v2; }); o('shH', (x) => { const v2 = Math.round(+x.value); if (v2 >= 16 && v2 <= H) it.h = v2; });
        { const x = $('#shK', side); if (x) x.onchange = () => { it.shape = x.value; redo1(); commit(); redrawKeep(); }; }
        { const x = $('#shD', side); if (x) x.onchange = () => { it.dash = x.checked; redo1(); commit(); }; }
        { const x = $('#shTop', side); if (x) x.onchange = () => { it.ta = x.checked ? 'top' : 'center'; redo1(); commit(); }; }
        wireSwatch(side, 'fill', (c) => { it.fill = c; redo1(); }); wireSwatch(side, 'stroke', (c) => { it.stroke = c; redo1(); }); wireSwatch(side, 'tc', (c) => { it.tc = c; redo1(); });
      }
      side.addEventListener('change', commit);
    };
    // ---------- 1.99.17 editing actions (buttons and keyboard) ----------
    const removeSel = () => {
      if (!sel) return; if (String(sel).startsWith('L:')) { draft.links.splice(+String(sel).slice(2), 1); }
      else { const id = sel; draft.items = draft.items.filter((i) => i.id !== id); draft.links = draft.links.filter((l) => l.a !== id && l.b !== id); }
      sel = null; dirty = true; draw();
    };
    const place = (it) => { draft.items.push(it); sel = it.id; dirty = true; draw(); };
    const duplicate = (src) => { const it = src || selItem(); if (!it) return; const c = { ...structuredClone(it), id: nid(), x: Math.min(W, it.x + 24), y: Math.min(H, it.y + 24) }; place(c); };
    const reorder = (dir) => { const it = selItem(); if (!it) return; draft.items = draft.items.filter((i) => i !== it); if (dir > 0) draft.items.push(it); else draft.items.unshift(it); dirty = true; draw(); };
    const addShape = (shape) => place({ id: nid(), kind: 'shape', shape, x: W / 2, y: H / 2, size: shape === 'zone' ? 520 : shape === 'ellipse' ? 180 : 220, h: shape === 'zone' ? 320 : shape === 'ellipse' ? 180 : 140, fill: '', fa: shape === 'zone' ? 6 : 18, stroke: '', sw: 2, dash: false, text: shape === 'zone' ? 'Zone' : '', ts: 16, tc: '', ta: shape === 'zone' ? 'top' : 'center' });
    const nudge = (dx, dy) => { const it = selItem(); if (!it) return; it.x = Math.round(Math.min(W, Math.max(0, it.x + dx))); it.y = Math.round(Math.min(H, Math.max(0, it.y + dy))); const n = $(`.dvi[data-id="${CSS.escape(it.id)}"]`, el); if (n) { n.style.left = it.x + 'px'; n.style.top = it.y + 'px'; } relink(); dirty = true; clearTimeout(nudge.t); nudge.t = setTimeout(commit, 400); };
    const setRoute = (r) => { lineRoute = r; pref('route', r); if (String(sel || '').startsWith('L:')) { const l = draft.links[+String(sel).slice(2)]; if (l) { l.route = r; dirty = true; } } else if (linkFrom === null) linkFrom = ''; draw(); };
    const keysHelp = () => { const d = dialog('Keyboard shortcuts in Device view', `<table class="data dvkeys"><tbody>${[['Ctrl+S', 'Save'], ['Ctrl+Z', 'Undo'], ['Ctrl+Y or Ctrl+Shift+Z', 'Redo'], ['Delete or Backspace', 'Remove the selected item or line'], ['Arrow keys', 'Move the selected item 1 pixel (with Shift: 10)'], ['Ctrl+D', 'Duplicate the selected item'], ['Ctrl+C, Ctrl+V', 'Copy and paste an item'], ['L', 'Draw a line (click two items)'], ['1, 2, 3', 'Straight, elbow or curved line (also changes the selected line)'], ['T', 'Add text'], ['R', 'Add a rectangle'], ['O', 'Add an ellipse'], ['Z', 'Add a zone'], [']  [', 'Bring to front, send to back'], ['Tab', 'Select the next item'], ['Esc', 'Stop drawing lines, then clear the selection'], ['?', 'This list']].map(([k2, t]) => `<tr><td><kbd>${esc(k2)}</kbd></td><td>${esc(t)}</td></tr>`).join('')}</tbody></table><div class="toolbar" style="margin-top:12px"><span class="spacer"></span><button class="primary" id="dvKeysX">Close</button></div>`); d.$('#dvKeysX').onclick = () => d.close(); };
    const onKey = (e) => {
      if (!alive || !edit || !draft || $('.modal-back')) return;
      const tag = e.target?.tagName, typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable, ctrl = e.ctrlKey || e.metaKey, key = e.key;
      if (ctrl && key.toLowerCase() === 's') { e.preventDefault(); return save(); }
      if (typing) { if (key === 'Escape') e.target.blur(); return; }
      if (ctrl && key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
      if (ctrl && key.toLowerCase() === 'y') { e.preventDefault(); return redo(); }
      if (ctrl && key.toLowerCase() === 'd') { e.preventDefault(); return duplicate(); }
      if (ctrl && key.toLowerCase() === 'c') { const it = selItem(); if (it) { clip = structuredClone(it); toast('Copied'); } return; }
      if (ctrl && key.toLowerCase() === 'v') { if (clip) { e.preventDefault(); duplicate(clip); clip = { ...clip, x: Math.min(W, clip.x + 24), y: Math.min(H, clip.y + 24) }; } return; }
      if (ctrl || e.altKey) return;
      if (key === 'Delete' || key === 'Backspace') { if (sel) { e.preventDefault(); removeSel(); } return; }
      if (key.startsWith('Arrow') && selItem()) { e.preventDefault(); const st = e.shiftKey ? 10 : 1; return nudge(key === 'ArrowLeft' ? -st : key === 'ArrowRight' ? st : 0, key === 'ArrowUp' ? -st : key === 'ArrowDown' ? st : 0); }
      if (key === 'Escape') { if (linkFrom !== null) { linkFrom = null; draw(); } else if (sel) { sel = null; draw(); } return; }
      if (key === 'Tab') { const its = draft.items; if (!its.length) return; e.preventDefault(); const ix = its.findIndex((i) => i.id === sel); sel = its[(ix + (e.shiftKey ? -1 : 1) + its.length) % its.length].id; linkFrom = null; return draw(); }
      const k3 = key.toLowerCase();
      if (k3 === 'l') { linkFrom = linkFrom === null ? '' : null; return draw(); }
      if (key === '1' || key === '2' || key === '3') return setRoute(ROUTES[+key - 1][0]);
      if (k3 === 't') return place({ id: nid(), kind: 'label', x: W / 2, y: 60, size: 22, text: 'Text' });
      if (k3 === 'r') return addShape('rect'); if (k3 === 'o') return addShape('ellipse'); if (k3 === 'z') return addShape('zone');
      if (key === ']') return reorder(1); if (key === '[') return reorder(-1);
      if (key === '?') return keysHelp();
    };
    document.addEventListener('keydown', onKey);
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
    const rTable = (d, title = 'Readings') => {
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
      return `<div class="dvrhead"><h4>${esc(title)} <span class="muted">${rs.length}</span></h4><button type="button" id="dvREx" class="linkbtn">${allOpen ? 'Collapse all' : 'Expand all'}</button></div><table class="dvrtab">${body}</table>`;
    };
    const closeBtn = '<button class="dvix" id="dvInfoX" title="Close" aria-label="Close the details"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
    /** 1.99.17 the details of an item, kept for a few seconds (the panel and the small window on hover share them) */
    const itemCache = new Map();
    const getItem = async (id, maxAge = 0) => { const c = itemCache.get(id); if (c && maxAge && Date.now() - c.t < maxAge) return c.d; const d = await api(`/api/views/item?id=${encodeURIComponent(cur.id)}&item=${encodeURIComponent(id)}`); itemCache.set(id, { t: Date.now(), d }); return d; };
    /** 1.99.17 a small window with the same details when the mouse rests on a device or this server */
    let tipFor = null, tipTimer = 0;
    const hideTip = () => { clearTimeout(tipTimer); tipFor = null; const t = $('#dvTip', el); if (t) t.hidden = true; };
    const tipHtml = (it, d) => {
      const st = status[it.id] || { state: d.state, sev: d.sev, open: d.alarms }, c = cls(st);
      const k2 = d.kind === 'server' ? [['Running for', d.uptime === null || d.uptime === undefined ? '–' : upText(d.uptime * 100)], ['Messages / s', d.eps === null || d.eps === undefined ? '–' : String(Math.round(d.eps * 10) / 10)], ['Devices', String(d.devices ?? '–')]]
        : d.kind === 'poll' ? [['Answer', d.rtt === null || d.rtt === undefined ? '–' : `${d.rtt} ms`], ['Uptime', upText(d.uptime)], ['Alarms', String(d.alarms || 0)]] : [['Last heard', ago(d.lastSeen)], ['Syslog', String(d.sys || 0)], ['Alarms', String(d.alarms || 0)]];
      const rs = (d.readings || []).slice(0, 10);
      return `<div class="dvtip-h ${c}"><b>${esc(d.name || '')}</b><span>${esc(d.host || '')}</span></div><div class="dvtip-s ${c}">${esc(stText(st))}</div>
        <div class="dvtip-k">${k2.map(([l, v]) => `<span><i>${esc(l)}</i><b>${esc(v)}</b></span>`).join('')}</div>
        ${rs.length ? `<table class="dvtip-r"><tbody>${rs.map((r) => `<tr class="${r.state ? 'r-' + esc(r.state) : ''}"><td>${esc(r.label)}</td><td>${esc(r.text)}</td></tr>`).join('')}</tbody></table>${(d.readings || []).length > rs.length ? `<div class="muted dvtip-more">+${d.readings.length - rs.length} more · click for all</div>` : ''}` : ''}`;
    };
    const placeTip = (tip, n) => {
      const stg = $('#dvStage', el); if (!stg) return; const sr = stg.getBoundingClientRect(), r = (n.querySelector('.dvpic') || n).getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = r.right - sr.left + 10, y = r.top - sr.top + r.height / 2 - th / 2; if (x + tw > sr.width - 6) x = r.left - sr.left - tw - 10; if (x < 6) x = Math.max(6, r.left - sr.left + r.width / 2 - tw / 2);
      y = Math.max(6, Math.min(y, stg.clientHeight - th - 6)); tip.style.left = x + 'px'; tip.style.top = y + 'px';
    };
    const wireTip = (wrap) => {
      wrap.onpointerover = (e) => {
        if (e.pointerType && e.pointerType !== 'mouse') return; const n = e.target.closest?.('.dvi'); if (!n) return;
        const it = cur?.items.find((i) => i.id === n.dataset.id); if (!monitored(it)) return; if (tipFor === it.id) return;
        hideTip(); tipFor = it.id;
        tipTimer = setTimeout(async () => {
          let d; try { d = await getItem(it.id, 15000); } catch { return; } const tip = $('#dvTip', el); if (!tip || tipFor !== it.id || !n.isConnected) return;
          tip.innerHTML = tipHtml(it, d); tip.hidden = false; placeTip(tip, n);
        }, 280);
      };
      wrap.onpointerout = (e) => { const n = e.target.closest?.('.dvi'); if (n && !n.contains(e.relatedTarget)) hideTip(); };
      wrap.onpointerleave = hideTip;
    };
    const fillInfo = async () => {
      clearTimeout(infoTimer); const box = $('#dvInfo', el); if (!box || !info || edit) return;
      const it = cur.items.find((i) => i.id === info); if (!it) { setInfo(null); return; }
      let d; try { d = await getItem(it.id); } catch (e) { if (!$('#dvInfo', el)) return; box.innerHTML = `<div class="dvih"><div class="dvihtxt"><div class="muted">${esc(e.message)}</div></div>${closeBtn}</div>`; $('#dvInfoX', box).onclick = () => setInfo(null); infoTimer = setTimeout(fillInfo, 15000); return; }
      if (!alive || info !== it.id || !$('#dvInfo', el)) return;
      const st = status[it.id] || { state: d.state, sev: d.sev, open: d.alarms, unack: d.unack }, c = cls(st);
      const pic = String(it.pic || 'icon:server'), picH = pic.startsWith('img:') ? `<img src="${imgUrl(pic.slice(4))}" alt="">` : devImg(pic === 'none' ? 'icon:' + guessIcon(d.name || '') : pic, d.name || '');
      const kpis = d.kind === 'server' ? [['clock', 'Running for', d.uptime === null || d.uptime === undefined ? '–' : upText(d.uptime * 100), ''], ['pulse', 'Messages / s', d.eps === null || d.eps === undefined ? '–' : String(Math.round(d.eps * 10) / 10), ''], ['list', 'Devices', String(d.devices ?? '–'), '']] : d.kind === 'poll' ? [['pulse', 'Answer time', d.rtt === null || d.rtt === undefined ? '–' : `${d.rtt} ms`, ''], ['clock', 'Uptime', upText(d.uptime), ''], ['bell', 'Open alarms', String(d.alarms || 0), d.alarms ? 'alarms' : '']]
        : [['clock', 'Last heard', ago(d.lastSeen), ''], ['list', 'Syslog', String(d.sys || 0), ''], ['bell', 'Open alarms', String(d.alarms || 0), d.alarms ? 'alarms' : '']];
      const sc = box.scrollTop;
      box.innerHTML = `<div class="dvih ${c}"><div class="dvihpic">${picH}</div><div class="dvihtxt"><h3>${esc(d.name || '')}</h3><div class="muted">${esc([d.host, d.group, d.kind === 'server' ? 'NetEventPro' + (S.info?.version ? ' ' + S.info.version : '') : d.kind === 'poll' ? (d.via ? 'probe ' + d.via : 'SNMP ' + (d.version || '')) : (d.vendor || 'syslog / traps')].filter(Boolean).join(' · '))}</div></div>${closeBtn}</div>
        <div class="dvstate ${c}">${esc(stText(st))}${d.error && st.state === 'down' ? ` · ${esc(d.error)}` : ''}</div>
        <div class="dvkpis">${kpis.map(([ic, l, v, act]) => `<${act ? 'button type="button" data-act="alarms"' : 'div'} class="dvkpi${act ? ' click' : ''}">${iconSvg(ic, 18)}<span class="v">${esc(v)}</span><span class="l">${esc(l)}</span></${act ? 'button' : 'div'}>`).join('')}</div>
        ${d.sysDescr ? `<p class="muted dvdescr" title="${esc(d.sysDescr)}">${esc(d.sysDescr)}</p>` : ''}
        <div class="toolbar dvlinksbar">${d.kind === 'server' ? '<button data-go="#health">Open System health</button>' : ''}${d.poll ? `<button data-go="#polling?d=${encodeURIComponent(d.poll)}">Open in SNMP polling</button>` : ''}${d.alarms ? '<button data-act="alarms">Show alarms</button>' : ''}</div>
        ${rTable(d, d.kind === 'server' ? 'Health checks' : 'Readings')}`;
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
    return () => { alive = false; document.removeEventListener('keydown', onKey); hideTip(); ro?.disconnect(); clearTimeout(timer); clearTimeout(infoTimer); removeEventListener('resize', onResize); document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('visibilitychange', onVis); document.body.classList.remove('dv-wall'); };
  };
})();
