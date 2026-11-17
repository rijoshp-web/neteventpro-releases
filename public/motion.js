/* NetEventPro motion: animation only, never colours. Every effect is plain CSS keyed off attributes on <html> (see the "1.86 motion" block in style.css), so it works with
   every theme, every look and every dashboard (including ones added later). This file keeps the switches, and does the few things CSS cannot do alone:
   rolling numbers, marking a tile as "just arrived", and gliding ranking bars to their new length. */
(() => {
  'use strict';
  const KEY = 'sp.motion';
  const LIST = [
    ['count', 'Number count-up', 'Numbers on tiles and badges roll up to their value, and roll to the new value when it changes.'],
    ['enter', 'Tile entrance', 'Tiles rise into place one after another when a dashboard or sheet opens.'],
    ['charts', 'Chart draw-in', 'Charts draw in when they first appear: line and bar charts wipe in from the left, round charts sweep clockwise, ranking bars grow from zero.'],
    ['glide', 'Smooth value changes', 'Ranking bars glide to their new length instead of jumping when the data refreshes.'],
    ['page', 'Page transitions', 'Pages fade and slide in when you switch between them.'],
    ['rows', 'Live rows', 'New log, trap and alarm rows slide in at the top.'],
    ['windows', 'Windows and menus', 'Dialogs, menus, pop-up panels and the detail drawer open with a soft scale or slide.'],
    ['hover', 'Hover and press', 'Tiles lift slightly under the pointer, buttons press down when clicked, and the side-bar icon pops when you open a page.'],
    ['pulse', 'Live pulse', 'The live-feed light breathes, and a number that changes flashes a soft ring.'],
    ['reorder', 'Tile movement', 'Tiles glide smoothly when you drag, resize or rearrange them while editing a dashboard.'],
  ];
  const root = document.documentElement;
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const read = () => { try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); if (j && typeof j === 'object') return { on: j.on !== false, off: Array.isArray(j.off) ? j.off.filter((k) => LIST.some((l) => l[0] === k)) : [] }; } catch { /* private mode */ } return { on: !reduced(), off: [] }; };
  let st = read();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* private mode */ } };
  const isOn = (k) => st.on && !st.off.includes(k);
  const apply = () => { root.dataset.anim = st.on ? 'on' : 'off'; for (const [k] of LIST) root.toggleAttribute('data-m-' + k, isOn(k)); };
  apply();
  window.MOTION = {
    LIST,
    isOn,
    master: () => st.on,
    setMaster(b) { st.on = !!b; save(); apply(); },
    set(k, b) { st.off = st.off.filter((x) => x !== k); if (!b) st.off.push(k); save(); apply(); },
  };

  // ----- numbers roll to their value -----------------------------------------------------------------------------------------------------
  const NUM_SEL = '.num, .badge';
  const reg = new Map();            // "<tile id>:<n>" -> last value, for numbers that live in re-painted tiles
  const regEl = new WeakMap();      // element -> last value, for numbers that change in place (badges)
  const mine = new WeakSet();       // text nodes this file writes, so its own writes are not mistaken for new data
  const NUM_RE = /^(\s*[^\d\-+.\s]{0,4}\s?)(-?\d[\d,]*(?:\.\d+)?)(.*)$/s;
  const fmt = (v, dec, comma) => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: comma });
  const numNode = (el) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (/\d/.test(n.nodeValue)) return n; return null; };
  const tween = (tn, from, to, dec, comma, pre, post) => {
    const t0 = performance.now(), dur = Math.min(1100, 500 + Math.abs(to - from) * 2);
    mine.add(tn);
    const step = (now) => {
      if (!tn.isConnected || tn.__mt !== t0) return;
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      tn.nodeValue = pre + fmt(k >= 1 ? to : from + (to - from) * e, dec, comma) + post;
      if (k < 1) requestAnimationFrame(step);
    };
    tn.__mt = t0; tn.nodeValue = pre + fmt(from, dec, comma) + post; requestAnimationFrame(step);
  };
  const countOne = (el, idx) => {
    if (mine.has(numNode(el) || {})) return;
    const tn = numNode(el); if (!tn) return;
    const m = NUM_RE.exec(tn.nodeValue); if (!m) return;
    const [, pre, num, post] = m, to = parseFloat(num.replace(/,/g, '')); if (!isFinite(to)) return;
    if (/\d/.test(post) || /[:/]/.test(pre + post)) return;                    // times, dates, ratios and "1h 20m" stay as they are
    const w = el.closest('.widget'), key = w ? w.dataset.id + ':' + idx : null;
    const prev = key ? reg.get(key) : regEl.get(el);
    if (key) reg.set(key, to); else regEl.set(el, to);
    if (to === prev) return;
    const from = prev === undefined ? 0 : prev;
    if (from === to) return;
    const dec = (num.split('.')[1] || '').length, comma = num.includes(',');
    if (prev !== undefined && isOn('pulse')) { el.classList.remove('m-pulse'); void el.offsetWidth; el.classList.add('m-pulse'); setTimeout(() => el.classList.remove('m-pulse'), 1000); }
    tween(tn, from, to, dec, comma, pre, post);
  };
  const scanCounts = (node) => {
    if (!isOn('count') || node.nodeType !== 1) return;
    const hits = []; if (node.matches?.(NUM_SEL)) hits.push(node); node.querySelectorAll?.(NUM_SEL).forEach((x) => hits.push(x));
    const per = new Map();
    for (const el of hits) { const w = el.closest('.widget'); const i = per.get(w) || 0; per.set(w, i + 1); countOne(el, i); }
  };

  // ----- ranking bars glide to the new length ---------------------------------------------------------------------------------------------
  const barW = new Map();
  const glide = (wb) => {
    const w = wb.closest('.widget'); if (!w) return;
    wb.querySelectorAll('.bar > i').forEach((b, i) => {
      const key = w.dataset.id + ':' + i, now = parseFloat(b.style.width); if (!isFinite(now)) return;
      const prev = barW.get(key); barW.set(key, now);
      if (isOn('glide') && prev !== undefined && Math.abs(prev - now) > 0.2 && !w.hasAttribute('data-m-chart')) { b.style.width = prev + '%'; void b.offsetWidth; b.style.width = now + '%'; }
    });
  };

  // ----- tiles arriving -------------------------------------------------------------------------------------------------------------------
  const filled = new WeakSet();
  const stamp = (wb) => {                       // a tile body painted for the first time: draw its chart in
    const w = wb.closest('.widget'); if (!w) return;
    w.querySelectorAll('.hm-row, .hostbars .row, .sevbars .row, tbody tr, .bg-row').forEach((r, i) => r.style.setProperty('--ri', Math.min(i, 24)));
    w.setAttribute('data-m-chart', ''); setTimeout(() => w.removeAttribute('data-m-chart'), 1700);
  };
  const arrive = (w, i) => { w.style.setProperty('--mi', Math.min(i, 16)); w.setAttribute('data-m-in', ''); setTimeout(() => w.removeAttribute('data-m-in'), 1100 + Math.min(i, 16) * 45); };

  let pendingPage = true;
  window.addEventListener('hashchange', () => { pendingPage = true; });
  const pageIn = (view) => { pendingPage = false; view.setAttribute('data-m-page', ''); clearTimeout(view.__mp); view.__mp = setTimeout(() => view.removeAttribute('data-m-page'), 520); };

  const queue = new Set(); let raf = 0;
  const flush = () => { raf = 0; const items = [...queue]; queue.clear(); for (const n of items) if (n.isConnected) scanCounts(n); };
  const later = (n) => { queue.add(n); if (!raf) raf = requestAnimationFrame(flush); };

  const onMut = (ms) => {
    for (const m of ms) {
      if (m.type === 'characterData') { const p = m.target.parentElement; if (p && !mine.has(m.target)) later(p.closest(NUM_SEL) || p); continue; }
      const t = m.target;
      if (t.id === 'view' && pendingPage && m.addedNodes.length) pageIn(t);
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (t.classList?.contains('dgrid') && n.matches('.widget, .dsec')) arrive(n, [...t.children].indexOf(n));
        if (t.classList?.contains('wb')) {
          if (!filled.has(t)) { filled.add(t); stamp(t); }
          glide(t);
        }
        later(n);
      }
      if (t.classList?.contains('wb') && !m.addedNodes.length && m.type === 'childList') filled.delete(t);
    }
  };
  const start = () => { new MutationObserver(onMut).observe(document.body, { childList: true, subtree: true, characterData: true }); document.querySelectorAll(NUM_SEL).forEach((n) => later(n)); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
