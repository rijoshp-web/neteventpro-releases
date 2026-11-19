'use strict';
/* 1.97.3 colour chooser. Every <input type="color"> in the application gets a swatch button that opens a small panel:
   the colours of the current theme, a balanced palette, a hex box and "Custom…" (the browser's own picker).
   The original input stays in the page (hidden) and still receives the value with normal input/change events,
   so every page keeps its own saving logic. An input with data-cx-none="Label" also offers "None": it then fires a
   "cx-none" event and gets data-unset="1"; picking a colour clears that again. */
(function () {
  const PALETTE = [
    ['Vivid', ['#e5484d', '#f2703d', '#f5a524', '#e2c221', '#8fd14f', '#30a46c', '#12a594', '#2fb5d6', '#3b82f6', '#6366f1', '#8e4ec6', '#d6409f']],
    ['Soft', ['#f8b4b6', '#fbc3a7', '#fbd896', '#f3e48e', '#cbe9a8', '#a8dcbf', '#9fdfd5', '#a5dcec', '#b4cdfb', '#c3c4f8', '#d8bdf0', '#f1b4d8']],
    ['Deep', ['#a3262b', '#b2461b', '#a86b00', '#8f7a00', '#4f7f1f', '#1d7a4f', '#0b6e63', '#0e7490', '#1d4ed8', '#3730a3', '#5b21b6', '#9d174d']],
    ['Greys', ['#ffffff', '#f1f3f5', '#dee2e6', '#adb5bd', '#868e96', '#5c6670', '#3d4650', '#2a3038', '#1a1f26', '#000000']]
  ];
  const THEME_VARS = [['--accent', 'Accent'], ['--ok', 'Good'], ['--s4', 'Warning'], ['--bad', 'Bad'], ['--c0', ''], ['--c1', ''], ['--c2', ''], ['--c3', ''], ['--c4', ''], ['--c5', ''], ['--text', 'Text'], ['--panel', 'Panel']];
  const toHex = (col) => {
    const i = document.createElement('i'); i.style.color = col; i.hidden = true; document.body.appendChild(i);
    const c = getComputedStyle(i).color; i.remove();
    let m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(c); let rgb = m ? [+m[1], +m[2], +m[3]] : null;
    if (!rgb) { m = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(c); if (m) rgb = [m[1] * 255, m[2] * 255, m[3] * 255]; }
    return rgb ? '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('') : '';
  };
  const themeColours = () => { const seen = new Set(), out = []; const st = getComputedStyle(document.getElementById('view') || document.documentElement);
    for (const [v, label] of THEME_VARS) { const raw = st.getPropertyValue(v).trim(); if (!raw) continue; const h = toHex(raw); if (h && !seen.has(h)) { seen.add(h); out.push([h, label || 'Theme colour']); } } return out; };
  const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v || '');
  let open = null;      // { panel, input, btn }
  const close = () => { if (!open) return; open.panel.remove(); open.btn.setAttribute('aria-expanded', 'false'); open = null; document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', onKey, true); };
  const away = (e) => { if (open && !open.panel.contains(e.target) && e.target !== open.btn && !open.btn.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); const b = open.btn; close(); b.focus(); } };
  const label = (inp) => inp.getAttribute('aria-label') || inp.title || inp.closest('.field')?.querySelector('label')?.textContent?.trim() || 'Colour';
  function paint(inp) {
    const b = inp._cxBtn; if (!b) return; const unset = inp.dataset.unset === '1' || inp.closest('.colw')?.classList.contains('unset');
    // 1.99.2: only touch what changed. Writing the same text again counted as a page change for the observer below, which
    // painted again on the next frame: an endless loop (60 repaints a second on every page with a colour box).
    const cx = unset ? 'transparent' : inp.value; if (b.style.getPropertyValue('--cx') !== cx) b.style.setProperty('--cx', cx);
    if (b.classList.contains('none') !== !!unset) b.classList.toggle('none', !!unset);
    const title = `${label(inp)}: ${unset ? (inp.dataset.cxNone || 'default') : inp.value.toUpperCase()}`; if (b.title !== title) b.title = title;
    const hx = b.querySelector('.cx-hex'), txt = unset ? (inp.dataset.cxNone || 'Default') : inp.value.toUpperCase(); if (hx && hx.textContent !== txt) hx.textContent = txt;
  }
  function set(inp, v) {
    if (!isHex(v)) return; delete inp.dataset.unset; inp.value = v.toLowerCase(); inp.closest('.colw')?.classList.remove('unset');
    inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); paint(inp);
  }
  function show(inp) {
    if (open && open.input === inp) return close(); close();
    const btn = inp._cxBtn, cur = (inp.dataset.unset === '1' ? '' : inp.value || '').toLowerCase();
    const sw = (h, t) => `<button type="button" class="cx-sw${h.toLowerCase() === cur ? ' on' : ''}" data-v="${h}" style="--cx:${h}" title="${t ? t + ' · ' : ''}${h.toUpperCase()}" aria-label="${t ? t + ' ' : ''}${h}"></button>`;
    const th = themeColours();
    const p = document.createElement('div'); p.className = 'cx-pop'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', label(inp));
    p.innerHTML = `${inp.dataset.cxNone !== undefined ? `<button type="button" class="cx-none-btn${inp.dataset.unset === '1' ? ' on' : ''}" data-none="1"><i></i>${inp.dataset.cxNone || 'None'}</button>` : ''}
      ${th.length ? `<div class="cx-h">This theme</div><div class="cx-row">${th.map(([h, t]) => sw(h, t)).join('')}</div>` : ''}
      ${PALETTE.map(([n, l]) => `<div class="cx-h">${n}</div><div class="cx-row">${l.map((h) => sw(h)).join('')}</div>`).join('')}
      <div class="cx-foot"><span class="cx-cur" style="--cx:${cur || 'transparent'}"></span><input type="text" class="cx-in" maxlength="7" value="${cur.toUpperCase()}" aria-label="Hex colour code" spellcheck="false"><button type="button" class="cx-custom">Custom…</button></div>`;
    document.body.appendChild(p);
    const r = btn.getBoundingClientRect(), pw = p.offsetWidth, ph = p.offsetHeight;
    let left = Math.min(Math.max(8, r.left), innerWidth - pw - 8), top = r.bottom + 6; if (top + ph > innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    const z = window.zf ? zf() : 1; p.style.left = left / z + 'px'; p.style.top = top / z + 'px';   // 1.99.3 screen positions in page pixels when the interface is scaled
    p.addEventListener('mousedown', (e) => e.stopPropagation());   // clicks in here never close the window or popover that holds the colour field
    p.addEventListener('click', (e) => {
      const s = e.target.closest('.cx-sw'); if (s) { set(inp, s.dataset.v); close(); btn.focus({ preventScroll: true }); return; }
      if (e.target.closest('[data-none]')) { inp.dataset.unset = '1'; inp.dispatchEvent(new CustomEvent('cx-none', { bubbles: true })); inp.closest('.colw')?.querySelector('.x')?.click(); paint(inp); close(); btn.focus({ preventScroll: true }); return; }
      if (e.target.closest('.cx-custom')) { close(); try { inp.showPicker ? inp.showPicker() : inp.click(); } catch { inp.click(); } }
    });
    const hx = p.querySelector('.cx-in'), cu = p.querySelector('.cx-cur');
    hx.addEventListener('input', () => { let v = hx.value.trim(); if (!v.startsWith('#')) v = '#' + v; if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + v.slice(1).replace(/./g, '$&$&'); const ok = isHex(v); hx.classList.toggle('bad', !ok && hx.value.length > 0); if (ok) cu.style.setProperty('--cx', v); });
    hx.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); let v = hx.value.trim(); if (!v.startsWith('#')) v = '#' + v; if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + v.slice(1).replace(/./g, '$&$&'); if (isHex(v)) { set(inp, v); close(); btn.focus(); } } });
    open = { panel: p, input: inp, btn }; btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', away, true); document.addEventListener('keydown', onKey, true);
    open.at = btn.getBoundingClientRect().top; (p.querySelector('.cx-sw.on') || p.querySelector('.cx-sw'))?.focus({ preventScroll: true });
  }
  function enhance(inp) {
    if (inp._cxBtn || inp.closest('.cx-pop')) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cx-btn'; b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', 'false');
    b.innerHTML = '<span class="cx-chip"></span><span class="cx-hex"></span>';
    inp.classList.add('cx-native'); inp.after(b); inp._cxBtn = b; b.disabled = inp.disabled;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); show(inp); });
    inp.addEventListener('input', () => paint(inp)); inp.addEventListener('change', () => paint(inp));
    paint(inp);
  }
  const scan = (root) => { if (root.nodeType !== 1) return; if (root.matches?.('input[type=color]')) enhance(root); root.querySelectorAll?.('input[type=color]').forEach(enhance); };
  let queued = new Set(), raf = 0;
  new MutationObserver((ms) => { for (const m of ms) { if (m.target.closest?.('.cx-btn')) continue; for (const n of m.addedNodes) queued.add(n); } if (!queued.size) return; if (!raf) raf = requestAnimationFrame(() => { raf = 0; const q = queued; queued = new Set(); q.forEach((n) => n.isConnected && scan(n)); for (const i of document.querySelectorAll('input.cx-native')) if (i._cxBtn) { i._cxBtn.disabled = i.disabled; paint(i); } }); })
    .observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('scroll', (e) => { if (!open || open.panel.contains(e.target)) return; if (Math.abs(open.btn.getBoundingClientRect().top - open.at) > 2) close(); }, true); window.addEventListener('resize', () => close());
  document.addEventListener('DOMContentLoaded', () => scan(document.body));
  window.NEPColor = { enhance, close };
})();
