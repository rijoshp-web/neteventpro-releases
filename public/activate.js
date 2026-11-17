'use strict';
try { const t = localStorage.getItem('sp.theme'); if (t) document.documentElement.dataset.theme = t; } catch {}
const $ = (id) => document.getElementById(id), err = $('err'), go = $('go');
const call = (u, o = {}) => fetch(u, { ...o, headers: { 'content-type': 'application/json', 'X-Requested-With': 'NetEventPro' } }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => ({})) }));
call('/api/license').then((r) => {
  $('mc').value = r.j.machine || '';
  if (r.j.state === 'expired') $('why').textContent = r.j.error + ' Enter a renewed key to continue.';
  else if (r.j.state === 'wrongmachine') $('why').textContent = r.j.error + ' Send the machine code below to your supplier.';
  else if (r.j.error) $('why').textContent = r.j.error;
});
$('cp').onclick = async () => { try { await navigator.clipboard.writeText($('mc').value); $('cp').textContent = 'Copied'; } catch { $('mc').select(); document.execCommand('copy'); $('cp').textContent = 'Copied'; } setTimeout(() => { $('cp').textContent = 'Copy'; }, 1500); };
$('f').addEventListener('submit', async (e) => {
  e.preventDefault(); err.textContent = ''; go.disabled = true; go.textContent = 'Checking…';
  try {
    const r = await call('/api/license/activate', { method: 'POST', body: JSON.stringify({ key: $('k').value }) });
    if (r.j.ok) { go.textContent = 'Activated'; location.replace('/'); return; }
    err.textContent = r.j.error || 'The key was not accepted.';
  } catch { err.textContent = 'Could not reach the server.'; }
  go.disabled = false; go.textContent = 'Activate';
});
