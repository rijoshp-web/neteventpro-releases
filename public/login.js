'use strict';
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
