'use strict';
// My account (1.88): every signed-in person, whatever their role, can change their own password, set up two-factor sign-in and pick the look of the app.
// Needs no permission: it uses only /api/me, /api/me/password and /api/me/2fa/*. Loaded after app.js (shares $, $$, esc, api, toast, views).
views.account = (el) => {
  let me = null;
  const grp = (s) => String(s).replace(/(.{4})/g, '$1 ').trim();
  const themes = () => ['Dark', 'Palette', 'Light', 'Special'].map((g) => `<div class="tgroup"><div class="tgname">${g === 'Special' ? 'Special looks' : g + ' themes'}</div><div class="tcards">${window.NEP.THEMES.filter(([id]) => window.NEP.THEME_META[id][4] === g).map(([id, n]) => { const m = window.NEP.THEME_META[id]; return `<button type="button" class="tcard" role="radio" aria-checked="${document.documentElement.dataset.theme === id}" data-theme-pick="${id}" title="${esc(m[5])}"><span class="tprev" style="background:${m[0]}"><i style="background:${m[1]}"></i><b style="background:${m[2]}"></b><u style="background:${m[3]}"></u></span><span class="tname">${esc(n)}</span></button>`; }).join('')}</div></div>`).join('');
  const motion = () => `<label class="chk"><input type="checkbox" id="mo_master" ${window.MOTION.master() ? 'checked' : ''}> Animate the app and the dashboards</label><div class="mogrid">${window.MOTION.LIST.map(([k, n, d]) => `<label class="chk mo" title="${esc(d)}"><input type="checkbox" id="mo_${k}" data-motion="${k}" ${window.MOTION.isOn(k) ? 'checked' : ''} ${window.MOTION.master() ? '' : 'disabled'}> <span><b>${esc(n)}</b><small class="muted">${esc(d)}</small></span></label>`).join('')}</div>`;
  const twofa = () => me.anonymous ? '<p class="muted">Sign-in is switched off for this server, so there is nothing to protect with a code.</p>'
    : me.twofa ? `<p><span class="pill ok">On</span> You need a code from your authenticator app to sign in. ${me.recoveryLeft} recovery code${me.recoveryLeft === 1 ? '' : 's'} left.</p>
        <div class="toolbar" style="margin:0"><input type="password" id="tfPw" class="w-md" placeholder="Your password" autocomplete="new-password"><button id="tfOff">Turn off</button></div>`
    : `<p class="muted">Adds a 6-digit code from an app such as Microsoft Authenticator, Google Authenticator or Authy to every sign-in. Scripts that use basic authentication cannot type a code, so keep scripts on a separate account without it.</p><div id="tfSetup"><div class="toolbar" style="margin:0"><input type="password" id="tfPw0" class="w-sm" autocomplete="current-password" placeholder="Your current password"> <button class="primary" id="tfStart">Set up two-factor sign-in</button></div></div>`;
  const draw = () => {
    el.innerHTML = `<div class="page-head"><h1>My account</h1></div>
      <fieldset><legend>Who you are</legend><div class="form">
        <div class="field"><label>Signed in as</label><div><b>${esc(me.name || '')}</b>${me.fullName ? ' · ' + esc(me.fullName) : ''}</div></div>
        <div class="field"><label>Role</label><div>${esc((me.roles || []).join(', ') || '–')}</div></div>
        <div class="field"><label>What you can do</label><div class="muted">${esc((me.perms || []).join(', ') || 'nothing')}</div></div></div></fieldset>
      ${me.anonymous ? '' : `<fieldset id="acPw"><legend>My password</legend><div class="toolbar" style="margin:0"><input type="password" id="myCur" class="w-md" placeholder="Current password" autocomplete="off"><input type="password" id="myNew" class="w-md" placeholder="New password" autocomplete="new-password"><button id="myPw">Change my password</button></div><p class="muted" style="margin-bottom:0">After changing it you sign in again. ${me.builtin ? 'This is the built-in administrator password.' : ''}</p></fieldset>`}
      <fieldset id="acTf"><legend>Two-factor sign-in</legend>${twofa()}</fieldset>
      <fieldset id="acLook"><legend>Appearance</legend><div class="form">
        <div class="field"><label>Colour theme</label><div><div id="themeGrid" class="themegrid" role="radiogroup" aria-label="Colour theme">${themes()}</div><span class="muted">Applies at once. Saved in this browser.</span></div></div>
        <div class="field"><label>Animations</label><div id="moBox">${motion()}</div></div></div></fieldset>`;
  };
  const load = async () => { try { me = await api('/api/me'); draw(); } catch (e) { el.textContent = e.message; } };
  el.addEventListener('click', async (e) => {
    const t = e.target, id = t.id, tp = t.closest && t.closest('[data-theme-pick]');
    if (tp) { window.NEP.setTheme(tp.dataset.themePick); $$('#themeGrid .tcard').forEach((b) => b.setAttribute('aria-checked', String(b === tp))); return; }
    try {
      if (id === 'myPw') { await api('/api/me/password', { method: 'POST', body: { current: $('#myCur', el).value, password: $('#myNew', el).value } }); toast('Password changed. Please sign in again.'); setTimeout(() => location.reload(), 900); }
      else if (id === 'tfStart') {
        const r = await api('/api/me/2fa/start', { method: 'POST', body: { password: $('#tfPw0', el).value } });
        $('#tfSetup', el).innerHTML = `<p>Open your authenticator app, choose <b>Add account → Scan a QR code</b> and scan this code:</p><div class="qrbox" style="display:inline-block;padding:6px;background:#fff;border-radius:10px;line-height:0">${(() => { try { return window.QR.svg(r.uri, 4); } catch { return ''; } })()}</div><p class="muted">Cannot scan? Choose <b>Enter a setup key</b> and type this key (time based): <code style="font-size:15px;user-select:all">${esc(grp(r.secret))}</code></p><p class="muted"><p class="muted">On the phone itself, open this link instead: <span style="user-select:all;word-break:break-all">${esc(r.uri)}</span>. Then type the 6-digit code the app shows:</p>
          <div class="toolbar" style="margin:0"><input type="text" id="tfCode" class="w-sm" inputmode="numeric" maxlength="8" autocomplete="one-time-code" placeholder="123456"><button class="primary" id="tfOn">Turn on</button></div>`;
      } else if (id === 'tfOn') {
        const r = await api('/api/me/2fa/enable', { method: 'POST', body: { code: $('#tfCode', el).value } });
        $('#tfSetup', el).innerHTML = `<p><span class="pill ok">On</span> Save these recovery codes somewhere safe. Each one works once if you lose the phone. They are shown only now.</p><pre style="user-select:all">${esc(r.codes.join('\n'))}</pre><button id="tfDone">I saved them</button>`;
      } else if (id === 'tfDone') load();
      else if (id === 'tfOff') { await api('/api/me/2fa/disable', { method: 'POST', body: { password: $('#tfPw', el).value } }); toast('Two-factor sign-in is off'); load(); }
    } catch (err) { toast(err.message, true); }
  });
  el.addEventListener('change', (e) => { const t = e.target; if (!t.id || !t.id.startsWith('mo_')) return; if (t.id === 'mo_master') { window.MOTION.setMaster(t.checked); el.querySelectorAll('[data-motion]').forEach((x) => { x.disabled = !t.checked; }); } else window.MOTION.set(t.dataset.motion, t.checked); });
  load();
};
