'use strict';
// Settings → Access & updates → Security (1.43): password policy, account lockout, web allow-list, two-factor sign-in and the audit log.
// Loaded after app.js (shares $, esc, api, toast, askConfirm, dateOf, timeOf).
function securityMount(el) {
  const box = $('#secBox', el); if (!box) return;
  let d = null;
  const grp = (s) => String(s).replace(/(.{4})/g, '$1 ').trim();
  const draw = () => {
    const p = d.policy, me = d.me;
    box.innerHTML = `
      <div class="form">
        <div class="field"><label for="spLen">Password length</label><div>at least <select id="spLen">${[8, 10, 12, 14, 16, 20].map((n) => `<option ${p.minLength === n ? 'selected' : ''}>${n}</option>`).join('')}</select> characters
          <label class="chk" style="margin-top:6px"><input type="checkbox" id="spCx" ${p.complexity ? 'checked' : ''}> Also require three of: lower case, upper case, digits, symbols</label>
          <div class="hint">Applies to every new password (not to passwords that already exist). Passwords that contain the user name, or are very common, are refused.</div></div></div>
        <div class="field"><label>Account lockout</label><div><label class="chk"><input type="checkbox" id="spLock" ${p.accountLock ? 'checked' : ''}> Lock an account after <input type="number" id="spFails" class="w-sm" min="3" max="20" value="${p.lockFails}"> wrong passwords or codes, for <input type="number" id="spMin" class="w-sm" min="1" max="1440" value="${p.lockMinutes}"> minutes</label>
          <div class="hint">This is in addition to the lock on the sending address (5 wrong tries, 5 minutes). The server's own console is never locked out, so you can always get back in from there.</div></div></div>
        <div class="field"><label for="spAllow">Allowed addresses</label><div><textarea id="spAllow" rows="2" style="width:100%" placeholder="Empty = any computer that can reach the port. Example: 10.0.0.0/24, 192.168.1.15">${esc(p.webAllow.join(', '))}</textarea>
          <div class="hint">Only these computers may open the dashboard. This computer itself is always allowed. Your address now: <b>${esc(d.yourIp)}</b>. Remote probes are not affected (they have their own token).</div></div></div>
        <div class="field"><label>Other</label><div><label class="chk"><input type="checkbox" id="spHsts" ${p.hsts ? 'checked' : ''}> HSTS: tell browsers to use only HTTPS for this address (needs HTTPS above)</label>
          <label class="chk"><input type="checkbox" id="spReq" ${p.require2fa ? 'checked' : ''}> Remind everyone who has no two-factor sign-in to set it up</label></div></div>
        <div class="toolbar" style="margin:0"><button class="primary" id="spSave">Save security settings</button></div>
      </div>
      <h4 style="margin:18px 0 6px">My two-factor sign-in</h4>
      ${me.anonymous || !d.signIn ? '<p class="muted">Turn sign-in on first (a dashboard password).</p>' : me.twofa ? `<p><span class="pill ok">On</span> You need a code from your authenticator app to sign in. ${me.recoveryLeft} recovery code${me.recoveryLeft === 1 ? '' : 's'} left.</p>
        <div class="toolbar" style="margin:0"><input type="password" id="tfPw" class="w-md" placeholder="Your password" autocomplete="current-password"><button id="tfOff">Turn off</button></div>`
        : `<p class="muted">Adds a 6-digit code from an app such as Microsoft Authenticator, Google Authenticator or Authy to every sign-in. Basic-auth scripts cannot use it, so keep scripts on a separate account without it.</p><div id="tfSetup"><button id="tfStart">Set up…</button></div>`}
      <h4 style="margin:18px 0 6px">Accounts</h4>
      <div style="overflow:auto"><table class="data"><thead><tr><th>Account</th><th>Two-factor</th><th>Locked</th><th></th></tr></thead><tbody>${d.accounts.map((a) => { const lk = d.locked.find((x) => x.name === a.name); return `<tr data-n="${esc(a.name)}"><td><b>${esc(a.name)}</b>${a.builtin ? ' <span class="muted">(built-in)</span>' : ''}${a.disabled ? ' <span class="muted">(disabled)</span>' : ''}</td><td>${a.twofa ? '<span class="pill ok">On</span>' : '<span class="muted">Off</span>'}</td><td>${lk ? `<span class="pill bad">until ${esc(timeOf(lk.until))}</span>` : '<span class="muted">No</span>'}</td><td>${lk ? '<button data-un>Unlock</button> ' : ''}${a.twofa ? '<button data-rs>Reset two-factor</button>' : ''}</td></tr>`; }).join('')}</tbody></table></div>
      <h4 style="margin:18px 0 6px">Audit log <span class="muted">(who changed what, and every sign-in and failed sign-in; kept like the other messages)</span></h4>
      <div class="toolbar" style="margin:0 0 6px"><input type="text" id="auText" class="w-md" placeholder="Filter, for example a user name"><button id="auGo">Show</button><a class="btn" id="auCsv" href="/api/audit?format=csv&limit=5000" download>Download CSV</a></div>
      <div id="auList" class="muted">Loading…</div>`;
    loadAudit();
  };
  const loadAudit = async () => {
    const out = $('#auList', box); if (!out) return;
    try {
      const t = $('#auText', box).value.trim(), r = await api('/api/audit?limit=300' + (t ? '&text=' + encodeURIComponent(t) : ''));
      $('#auCsv', box).href = '/api/audit?format=csv&limit=5000' + (t ? '&text=' + encodeURIComponent(t) : '');
      out.innerHTML = r.rows.length ? `<div style="max-height:320px;overflow:auto"><table class="data"><thead><tr><th>Time</th><th>What happened</th></tr></thead><tbody>${r.rows.map((x) => `<tr><td class="nowrap">${esc(dateOf(x.ts))} ${esc(timeOf(x.ts))}</td><td>${esc(x.text)}</td></tr>`).join('')}</tbody></table></div>` : 'Nothing recorded yet.';
    } catch (e) { out.textContent = e.message; }
  };
  const load = async () => { try { d = await api('/api/security'); draw(); } catch (e) { box.textContent = e.message; } };
  box.onclick = async (e) => {
    const id = e.target.id, tr = e.target.closest('tr[data-n]');
    try {
      if (id === 'spSave') {
        await api('/api/security', { method: 'POST', body: { policy: { minLength: +$('#spLen', box).value, complexity: $('#spCx', box).checked, accountLock: $('#spLock', box).checked, lockFails: +$('#spFails', box).value, lockMinutes: +$('#spMin', box).value, webAllow: $('#spAllow', box).value.split(/[\s,;]+/).filter(Boolean), hsts: $('#spHsts', box).checked, require2fa: $('#spReq', box).checked } } });
        toast('Security settings saved'); load();
      } else if (id === 'auGo') loadAudit();
      else if (id === 'tfStart') {
        const r = await api('/api/me/2fa/start', { method: 'POST', body: {} });
        $('#tfSetup', box).innerHTML = `<p>In your authenticator app choose <b>Add account → Enter a setup key</b> and type this key (time based):</p><p><code style="font-size:16px;user-select:all">${esc(grp(r.secret))}</code></p><p class="muted">Or open this link on the phone that has the app: <a href="${esc(r.uri)}">${esc('otpauth link')}</a>. Then type the 6-digit code it shows:</p>
          <div class="toolbar" style="margin:0"><input type="text" id="tfCode" class="w-sm" inputmode="numeric" maxlength="8" autocomplete="one-time-code" placeholder="123456"><button class="primary" id="tfOn">Turn on</button></div>`;
      } else if (id === 'tfOn') {
        const r = await api('/api/me/2fa/enable', { method: 'POST', body: { code: $('#tfCode', box).value } });
        $('#tfSetup', box).innerHTML = `<p><span class="pill ok">On</span> Save these recovery codes somewhere safe. Each one works once if you lose the phone. They are shown only now.</p><pre style="user-select:all">${esc(r.codes.join('\n'))}</pre><button id="tfDone">I saved them</button>`;
      } else if (id === 'tfDone') load();
      else if (id === 'tfOff') { await api('/api/me/2fa/disable', { method: 'POST', body: { password: $('#tfPw', box).value } }); toast('Two-factor sign-in is off'); load(); }
      else if (tr && e.target.hasAttribute('data-un')) { await api('/api/security/unlock', { method: 'POST', body: { name: tr.dataset.n } }); toast('Unlocked'); load(); }
      else if (tr && e.target.hasAttribute('data-rs')) { if (await askConfirm(`Turn off two-factor sign-in for “${tr.dataset.n}”? They sign in with the password only until they set it up again.`, 'Reset')) { await api('/api/security/2fa-reset', { method: 'POST', body: { name: tr.dataset.n } }); toast('Reset'); load(); } }
    } catch (err) { toast(err.message, true); }
  };
  load();
}
