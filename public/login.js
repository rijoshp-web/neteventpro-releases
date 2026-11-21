'use strict';
// 1.99.3 the same automatic size as the app on large screens (4K, 8K, wall displays at 100 % scaling)
(() => { const fit = () => { let pref = 'auto'; try { pref = localStorage.getItem('sp.uiZoom') || 'auto'; } catch { /* default */ } const a = Math.min(innerWidth / 1920, innerHeight / 1080), z = pref === 'auto' ? (a < 1.2 ? 1 : Math.min(4, Math.round(a * 4) / 4)) : Math.min(4, Math.max(0.75, +pref || 1)); document.documentElement.style.zoom = z === 1 ? '' : String(z); }; fit(); addEventListener('resize', fit); })();
try { const t = localStorage.getItem('sp.theme'); if (t) document.documentElement.dataset.theme = t; } catch {}   // the sign-in page follows the colour theme chosen in this browser
const pw = document.getElementById('pw'), pin = document.getElementById('p'), caps = document.getElementById('caps');
pw.addEventListener('click', () => { const show = pin.type === 'password'; pin.type = show ? 'text' : 'password'; pw.textContent = show ? 'Hide' : 'Show'; pw.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); pw.setAttribute('aria-pressed', String(show)); pin.focus(); });
const capCheck = (e) => { caps.hidden = !(e.getModifierState && e.getModifierState('CapsLock')); };
pin.addEventListener('keydown', capCheck); pin.addEventListener('keyup', capCheck); pin.addEventListener('blur', () => { caps.hidden = true; });
const f = document.getElementById('f'), err = document.getElementById('err'), go = document.getElementById('go'), codeRow = document.getElementById('codeRow'), codeIn = document.getElementById('c');
f.addEventListener('submit', async (e) => {
  e.preventDefault(); err.textContent = ''; go.disabled = true; go.textContent = 'Signing in…';
  try {
    const body = { username: document.getElementById('u').value, password: document.getElementById('p').value };
    if (!codeRow.hidden) body.code = codeIn.value;
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Requested-With': 'NetEventPro' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && !j.need2fa) { location.reload(); return; }          // the same address now opens the dashboard (the #page in the address is kept)
    if (j.need2fa) { codeRow.hidden = false; codeIn.focus(); if (j.error) { err.textContent = j.error; codeIn.select(); } go.disabled = false; go.textContent = 'Sign in'; return; }
    err.textContent = j.error || 'Sign-in failed (' + r.status + ').'; document.getElementById('p').select();
  } catch { err.textContent = 'Cannot reach the NetEventPro service.'; }
  go.disabled = false; go.textContent = 'Sign in';
});

// 1.88 a saved or leftover password must never appear here, so nobody can reveal it with "Show": the field starts empty, browser autofill is refused (autocomplete="new-password"),
// anything a browser still drops in without the person typing or pasting is wiped, and "Show" always goes back to hidden when the page is shown again.
let typed = false; const un = document.getElementById('u');
const wipe = () => { if (!typed) { pin.value = ''; } };
const hideAgain = () => { pin.type = 'password'; pw.textContent = 'Show'; pw.setAttribute('aria-pressed', 'false'); pw.setAttribute('aria-label', 'Show password'); };
pin.addEventListener('keydown', (e) => { if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete' || e.ctrlKey || e.metaKey) typed = true; });
pin.addEventListener('paste', () => { typed = true; });
pin.addEventListener('focus', () => { pin.removeAttribute('readonly'); });
pin.addEventListener('input', () => { if (!pin.value) typed = false; });
[0, 120, 400, 1000, 2500].forEach((ms) => setTimeout(wipe, ms));
window.addEventListener('pageshow', () => { typed = false; pin.value = ''; codeIn.value = ''; hideAgain(); [0, 150, 600].forEach((ms) => setTimeout(wipe, ms)); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !typed) pin.value = ''; });
