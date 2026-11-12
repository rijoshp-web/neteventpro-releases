'use strict';
// Notifications page (1.37): profiles (who is told and how), the e-mail server, the SMS gateway (SMPP) and the delivery log.
// Rules (Rules & alerts) only pick profiles; the text, severity and cooldown stay in the rules. Loaded after admin.js (shares $, $$, esc, api, toast, dialog, S ...).
(() => {
  const TABS = [['profiles', 'Profiles'], ['email', 'E-mail server'], ['sms', 'SMS gateway (SMPP)'], ['log', 'Delivery log']];
  const FORMATS = [['generic', 'Generic JSON (n8n, Node-RED, own tools)'], ['teams', 'Microsoft Teams (Workflows flow)'], ['slack', 'Slack / Mattermost style ({"text": …})']];
  const EMPTY = () => ({ id: '', name: '', enabled: true, email: { on: false, to: '', cc: '' }, webhook: { on: false, url: '', format: 'generic' }, sms: { on: false, to: '' } });
  const KIND = { alert: 'Alert', escalation: 'Escalation', recovery: 'Cleared', test: 'Test' };

  views.notifications = (el) => {
    if (!can('settings')) { denied(el, 'Notifications'); return null; }
    let c = null, tab = S.notifyTab || 'profiles', timer = 0, alive = true;
    const rulesUsing = (id) => (c.rules || []).filter((r) => (r.actions?.profiles || []).includes(id) || (r.actions?.alarmEscProfiles || []).includes(id)).length;
    const chip = (on, label, title) => `<span class="pill ${on ? 'ok' : ''}" title="${esc(title || '')}" style="${on ? '' : 'opacity:.45'}">${label}</span>`;
    const save = async (patch) => { const r = await api('/api/config', { method: 'PUT', body: patch }); c = r.config; S.info.config = { ...S.info.config, notifProfiles: c.notifProfiles, smpp: c.smpp, smtp: c.smtp, rules: c.rules }; return c; };

    const head = () => `<div class="page-head"><h1>Notifications</h1></div>
      <p class="muted" style="margin:0 0 10px">Set up <b>how</b> and <b>to whom</b> alerts are sent: e-mail addresses, SMS numbers and webhook addresses, grouped into <b>profiles</b>. On <a href="#rules">Rules &amp; alerts</a> each rule picks one or more profiles. The text, the severity and the pause between alerts stay in the rule.</p>
      <div class="tabs" role="tablist">${TABS.map(([k, n]) => `<button role="tab" class="tab ${tab === k ? 'on' : ''}" data-tab="${k}" aria-selected="${tab === k}">${n}</button>`).join('')}</div><div id="nBody"></div>`;

    // ---------------- profiles ----------------
    const profilesTab = () => {
      const list = c.notifProfiles || [], smtpOk = !!(c.smtp?.host && c.smtp?.from), smsOk = !!c.smpp?.host;
      return `<div class="toolbar" style="margin:10px 0"><button class="primary" id="pAdd">Add profile</button><span class="muted">${list.length} profile${list.length === 1 ? '' : 's'}</span></div>` + (list.length ? `<div class="panel" style="padding:0;overflow:auto"><table class="data"><thead><tr><th>Name</th><th>Methods</th><th>Goes to</th><th>Used by</th><th></th></tr></thead><tbody>${list.map((p) => {
        const to = [p.email?.on ? p.email.to : '', p.sms?.on ? p.sms.to : '', p.webhook?.on ? hostOf(p.webhook.url) : ''].filter(Boolean).join(' · ');
        const warn = [p.email?.on && !smtpOk ? 'E-mail server is not set up' : '', p.sms?.on && !smsOk ? 'SMS gateway is not set up' : ''].filter(Boolean).join('; ');
        return `<tr data-id="${esc(p.id)}"><td><b>${esc(p.name)}</b>${p.enabled === false ? ' <span class="pill">off</span>' : ''}${warn ? `<div class="hint" style="color:var(--s3)">${esc(warn)}</div>` : ''}</td>
          <td>${chip(p.email?.on, 'E-mail')} ${chip(p.sms?.on, 'SMS')} ${chip(p.webhook?.on, 'Webhook' + (p.webhook?.on && p.webhook.format !== 'generic' ? ' · ' + p.webhook.format : ''))}</td>
          <td class="trunc" style="max-width:360px" title="${esc(to)}">${esc(to) || '<span class="muted">nobody yet</span>'}</td><td>${rulesUsing(p.id)} rule${rulesUsing(p.id) === 1 ? '' : 's'}</td>
          <td style="white-space:nowrap"><button data-act="test">Test</button> <button data-act="edit">Edit</button> <button data-act="dup" title="Make a copy">Copy</button> <button class="danger" data-act="del">Delete</button></td></tr>`;
      }).join('')}</tbody></table></div>` : `<div class="panel empty"><b>No notification profiles yet</b>Add a profile such as “NOC team” (e-mail addresses), “On-call phone” (SMS numbers) or “Teams chat” (webhook). Then pick it in a rule.</div>`);
    };
    const profileDialog = (p0) => {
      const p = structuredClone(p0 || EMPTY()), isNew = !p0;
      const d = dialog(isNew ? 'Add notification profile' : 'Edit notification profile', `<form id="pForm" class="form">
        <div class="field"><label for="pName">Name</label><div><input type="text" id="pName" class="w-md" maxlength="100" value="${esc(p.name)}" placeholder="NOC team" required> <label class="chk"><input type="checkbox" id="pOn" ${p.enabled !== false ? 'checked' : ''}> Enabled</label></div></div>
        <fieldset><legend><label class="chk"><input type="checkbox" id="eOn" ${p.email.on ? 'checked' : ''}> <b>E-mail</b></label></legend>
          <div class="field"><label for="eTo">To</label><div><input type="text" id="eTo" style="width:100%;max-width:420px" value="${esc(p.email.to)}" placeholder="noc@example.com, oncall@example.com"><div class="hint">Separate addresses with commas. Uses the mail server on the “E-mail server” tab.</div></div></div>
          <div class="field"><label for="eCc">Cc</label><div><input type="text" id="eCc" style="width:100%;max-width:420px" value="${esc(p.email.cc)}" placeholder="optional"></div></div></fieldset>
        <fieldset><legend><label class="chk"><input type="checkbox" id="sOn" ${p.sms.on ? 'checked' : ''}> <b>SMS</b></label></legend>
          <div class="field"><label for="sTo">Phone numbers</label><div><input type="text" id="sTo" style="width:100%;max-width:420px" value="${esc(p.sms.to)}" placeholder="+971501234567, +971551234567"><div class="hint">International form with the country code. Sent through the “SMS gateway (SMPP)” tab. The text is short (160 characters).</div></div></div></fieldset>
        <fieldset><legend><label class="chk"><input type="checkbox" id="wOn" ${p.webhook.on ? 'checked' : ''}> <b>Webhook</b></label></legend>
          <div class="field"><label for="wUrl">Web address</label><div><input type="text" id="wUrl" style="width:100%;max-width:520px" value="${esc(p.webhook.url)}" placeholder="https://…"></div></div>
          <div class="field"><label for="wFmt">Format</label><div><select id="wFmt">${FORMATS.map(([k, n]) => `<option value="${k}" ${p.webhook.format === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select><div class="hint" id="wHint"></div></div></div></fieldset>
        <div id="pErr" class="hint" style="color:var(--s1)" role="alert"></div>
        <div class="toolbar"><button class="primary" type="submit">Save</button><button type="button" id="pCancel">Cancel</button></div></form>`, true);
      const q = d.$, hint = () => { q('#wHint').textContent = q('#wFmt').value === 'teams' ? 'Sends the usual fields plus an Adaptive Card. In your Teams Workflows flow, set the card to the expression triggerBody()?[\'attachments\']?[0]?[\'content\'].' : q('#wFmt').value === 'slack' ? 'Sends {"text": "…"}.' : 'Sends text, rule and a message object with host, severity and text.'; };
      hint(); q('#wFmt').onchange = hint; q('#pCancel').onclick = d.close; q('#pName').focus();
      q('#pForm').onsubmit = async (e) => {
        e.preventDefault(); q('#pErr').textContent = '';
        const np = { ...p, name: q('#pName').value.trim(), enabled: q('#pOn').checked, email: { on: q('#eOn').checked, to: q('#eTo').value.trim(), cc: q('#eCc').value.trim() }, sms: { on: q('#sOn').checked, to: q('#sTo').value.trim() }, webhook: { on: q('#wOn').checked, url: q('#wUrl').value.trim(), format: q('#wFmt').value } };
        const all = (c.notifProfiles || []).filter((x) => x.id !== p.id); all.push(np);
        try { await save({ notifProfiles: isNew ? all : (c.notifProfiles || []).map((x) => (x.id === p.id ? np : x)) }); d.close(); toast('Profile saved'); draw(); } catch (err) { q('#pErr').textContent = err.message; }
      };
    };
    const resultText = (r) => Object.entries(r).map(([k, v]) => `${{ email: 'E-mail', sms: 'SMS', webhook: 'Webhook', none: '' }[k]}${k === 'none' ? '' : ': '}${v.ok ? 'sent' + (v.sent ? ` to ${v.sent}` : '') : 'failed – ' + v.error}`).join('\n');
    const profilesClick = async (e) => {
      if (e.target.id === 'pAdd') return profileDialog(null);
      const b = e.target.closest('button[data-act]'); if (!b) return; const id = b.closest('tr').dataset.id, p = (c.notifProfiles || []).find((x) => x.id === id); if (!p) return;
      if (b.dataset.act === 'edit') return profileDialog(p);
      if (b.dataset.act === 'dup') { const n = structuredClone(p); n.id = ''; n.name = p.name + ' copy'; try { await save({ notifProfiles: [...c.notifProfiles, n] }); draw(); } catch (err) { toast(err.message, true); } return; }
      if (b.dataset.act === 'del') { const n = rulesUsing(id); if (!await askConfirm(`Delete the profile “${p.name}”?${n ? ` It is used by ${n} rule${n === 1 ? '' : 's'}; those rules will no longer send through it.` : ''}`, 'Delete')) return; try { await save({ notifProfiles: c.notifProfiles.filter((x) => x.id !== id) }); draw(); } catch (err) { toast(err.message, true); } return; }
      if (b.dataset.act === 'test') {
        b.disabled = true; b.textContent = 'Sending…';
        try { const r = await api('/api/notify/test', { method: 'POST', body: { profileId: id } }); const bad = Object.values(r).some((v) => !v.ok); toast(resultText(r), bad); } catch (err) { toast(err.message, true); } finally { b.disabled = false; b.textContent = 'Test'; }
      }
    };

    // ---------------- e-mail server ----------------
    const emailTab = () => { const sm = c.smtp || {}; return `<div class="panel"><div class="form">
      <p class="muted" style="margin:0">The mail server that sends every e-mail alert and report. Who receives the alerts is set in a profile.</p>
      <div class="field"><label for="smHost">Mail server</label><div><input type="text" id="smHost" class="w-md" value="${esc(sm.host)}" placeholder="smtp.example.com"> port <input type="number" id="smPort" class="w-sm" min="1" max="65535" value="${sm.port}"> <select id="smSec" aria-label="Encryption"><option value="starttls" ${sm.security === 'starttls' ? 'selected' : ''}>STARTTLS (usually port 587)</option><option value="tls" ${sm.security === 'tls' ? 'selected' : ''}>SSL/TLS (usually port 465)</option><option value="none" ${sm.security === 'none' ? 'selected' : ''}>None (port 25, internal relay)</option></select></div></div>
      <div class="field"><label for="smUser">User name</label><div><input type="text" id="smUser" class="w-md" value="${esc(sm.user)}" autocomplete="off"><div class="hint">Leave empty if the server needs no login.</div></div></div>
      <div class="field"><label for="smPass">Password</label><div><input type="password" id="smPass" class="w-md" value="${esc(sm.password)}" autocomplete="new-password"></div></div>
      <div class="field"><label for="smFrom">From address</label><div><input type="text" id="smFrom" style="width:320px" value="${esc(sm.from)}" placeholder="NetEventPro &lt;syslog@example.com&gt;"></div></div>
      <div class="field"><label for="smTo">Default recipients</label><div><input type="text" id="smTo" style="width:320px" value="${esc(sm.to || '')}" placeholder="optional"><div class="hint">Only used by reports that have no recipient list of their own. Alerts go to the profiles chosen in the rules.</div></div></div>
      <div class="field"><label for="smCc">Default Cc</label><div><input type="text" id="smCc" style="width:320px" value="${esc(sm.cc || '')}" placeholder="optional"><div class="hint">Copied on report e-mails.</div></div></div>
      <div class="field"><label>Options</label><div><label class="chk"><input type="checkbox" id="smSelf" ${sm.allowSelfSigned ? 'checked' : ''}> Accept a self-signed certificate</label> &nbsp; Send at most <input type="number" id="smMax" class="w-sm" min="1" max="1000" value="${sm.maxPerHour}"> e-mails per hour</div></div>
      <div class="field"><label>Test</label><div><div class="toolbar" style="margin:0"><input type="text" id="smTestTo" style="width:260px" placeholder="Send the test to"><button id="smSave" class="primary">Save</button><button id="smTest">Save and send test e-mail</button></div><div id="smStatus" class="hint" role="status"></div></div></div></div></div>`; };
    const smtpForm = () => ({ host: $('#smHost').value.trim(), port: +$('#smPort').value, security: $('#smSec').value, user: $('#smUser').value.trim(), password: $('#smPass').value, from: $('#smFrom').value.trim(), to: $('#smTo').value.trim(), cc: $('#smCc').value.trim(), allowSelfSigned: $('#smSelf').checked, maxPerHour: +$('#smMax').value });
    const emailClick = async (e) => {
      if (e.target.id !== 'smSave' && e.target.id !== 'smTest') return;
      const st = $('#smStatus'); st.textContent = e.target.id === 'smTest' ? 'Sending…' : 'Saving…'; st.style.color = ''; e.target.disabled = true;
      try {
        await save({ smtp: smtpForm() });
        if (e.target.id === 'smSave') { st.textContent = 'Saved.'; st.style.color = 'var(--ok)'; return; }
        const to = $('#smTestTo').value.trim() || c.smtp.to; if (!to) { st.textContent = 'Saved. Type an address to send the test to.'; return; }
        const r = await api('/api/test-email', { method: 'POST', body: { to } });
        st.textContent = r.ok ? 'Test e-mail sent. Check the inbox (and the spam folder).' : 'Could not send: ' + r.error; st.style.color = r.ok ? 'var(--ok)' : 'var(--s1)';
      } catch (err) { st.textContent = err.message; st.style.color = 'var(--s1)'; } finally { e.target.disabled = false; }
    };

    // ---------------- SMS gateway ----------------
    const smsTab = () => { const s = c.smpp || {}, n = (v) => (v === '' || v === undefined || v === null ? '' : v); return `<div class="panel"><div class="form">
      <p class="muted" style="margin:0">NetEventPro connects straight to your SMS gateway with the SMPP protocol (version 3.4). Ask your SMS provider for the address, port, system id and password, and whether they need an encrypted (TLS) connection or the IP address of this server added to a list of allowed addresses.</p>
      <div class="field"><label for="spHost">Gateway address</label><div><input type="text" id="spHost" class="w-md" value="${esc(s.host)}" placeholder="smsc.example.com"> port <input type="number" id="spPort" class="w-sm" min="1" max="65535" value="${s.port || 2775}"> <label class="chk"><input type="checkbox" id="spTls" ${s.tls ? 'checked' : ''}> TLS</label> <label class="chk"><input type="checkbox" id="spSelf" ${s.allowSelfSigned ? 'checked' : ''}> accept a self-signed certificate</label></div></div>
      <div class="field"><label for="spId">System id</label><div><input type="text" id="spId" class="w-md" maxlength="16" value="${esc(s.systemId)}" autocomplete="off"><div class="hint">The login name (up to 16 characters).</div></div></div>
      <div class="field"><label for="spPass">Password</label><div><input type="password" id="spPass" class="w-md" maxlength="16" value="${esc(s.password)}" autocomplete="new-password"><div class="hint">Up to 16 characters (an SMPP limit).</div></div></div>
      <div class="field"><label for="spSrc">Sender</label><div><input type="text" id="spSrc" class="w-md" maxlength="20" value="${esc(s.sourceAddr)}" placeholder="NetEventPro"><div class="hint">The name or number the text appears to come from. Some countries and providers only allow a registered sender name.</div></div></div>
      <div class="field"><label for="spBind">Connection type</label><div><select id="spBind"><option value="transceiver" ${s.bind !== 'transmitter' ? 'selected' : ''}>Transceiver (most gateways)</option><option value="transmitter" ${s.bind === 'transmitter' ? 'selected' : ''}>Transmitter (send only)</option></select> &nbsp; Send at most <input type="number" id="spMax" class="w-sm" min="1" max="1000" value="${s.maxPerHour || 30}"> texts per hour</div></div>
      <details><summary class="muted" style="cursor:pointer">Advanced (only if your provider asks)</summary><div class="field"><label>System type</label><div><input type="text" id="spType" class="w-sm" maxlength="13" value="${esc(s.systemType)}"></div></div>
        <div class="field"><label>Address types</label><div class="muted">sender TON <input type="number" id="spSTon" class="w-sm" min="0" max="6" value="${n(s.sourceTon)}" placeholder="auto"> NPI <input type="number" id="spSNpi" class="w-sm" min="0" max="18" value="${n(s.sourceNpi)}" placeholder="auto"> &nbsp; destination TON <input type="number" id="spDTon" class="w-sm" min="0" max="6" value="${n(s.destTon)}" placeholder="1"> NPI <input type="number" id="spDNpi" class="w-sm" min="0" max="18" value="${n(s.destNpi)}" placeholder="1"></div></div></details>
      <div class="field"><label>Test</label><div><div class="toolbar" style="margin:0"><button id="spSave" class="primary">Save</button><button id="spTest">Save and test the connection</button></div><div id="spStatus" class="hint" role="status"></div><div class="hint">The connection test logs in and out without sending a text. To send a real text, use the Test button of a profile.</div></div></div></div></div>`; };
    const smppForm = () => { const o = (id) => $(id).value.trim(); return { host: o('#spHost'), port: +$('#spPort').value, tls: $('#spTls').checked, allowSelfSigned: $('#spSelf').checked, systemId: o('#spId'), password: $('#spPass').value, sourceAddr: o('#spSrc'), bind: $('#spBind').value, maxPerHour: +$('#spMax').value, systemType: o('#spType'), sourceTon: o('#spSTon'), sourceNpi: o('#spSNpi'), destTon: o('#spDTon'), destNpi: o('#spDNpi') }; };
    const smsClick = async (e) => {
      if (e.target.id !== 'spSave' && e.target.id !== 'spTest') return;
      const st = $('#spStatus'); st.textContent = e.target.id === 'spTest' ? 'Connecting…' : 'Saving…'; st.style.color = ''; e.target.disabled = true;
      try {
        await save({ smpp: smppForm() });
        if (e.target.id === 'spSave') { st.textContent = 'Saved.'; st.style.color = 'var(--ok)'; return; }
        const r = await api('/api/test-smpp', { method: 'POST', body: {} });
        st.textContent = r.ok ? 'Connected and logged in. The gateway accepted the login.' : 'Could not connect: ' + r.error; st.style.color = r.ok ? 'var(--ok)' : 'var(--s1)';
      } catch (err) { st.textContent = err.message; st.style.color = 'var(--s1)'; } finally { e.target.disabled = false; }
    };

    // ---------------- delivery log ----------------
    const logTab = () => `<div class="toolbar" style="margin:10px 0"><button id="lgRefresh">Refresh</button><span class="muted">The last 300 attempts to send an alert, newest first. Failed ones show why.</span></div><div id="lgBox" class="panel" style="padding:0;overflow:auto"></div>`;
    const logLoad = async () => {
      const box = $('#lgBox'); if (!box) return;
      try {
        const r = await api('/api/notify/log?limit=300'); const rows = r.entries || [];
        box.innerHTML = rows.length ? `<table class="data"><thead><tr><th>Time</th><th>Result</th><th>Method</th><th>Profile</th><th>What</th><th>Rule</th><th>Device</th><th>To</th></tr></thead><tbody>${rows.map((x) => `<tr><td style="white-space:nowrap">${esc(dateTime(x.ts))}</td><td>${x.ok ? '<span class="pill ok">sent</span>' : `<span class="pill bad" title="${esc(x.error || '')}">failed</span>`}${x.ok ? '' : `<div class="hint" style="max-width:320px">${esc(x.error || '')}</div>`}</td><td>${esc({ email: 'E-mail', sms: 'SMS', webhook: 'Webhook' }[x.channel] || x.channel || '')}</td><td>${esc(x.profile || '')}</td><td>${esc(KIND[x.kind] || x.kind || '')}</td><td>${esc(x.rule || '')}</td><td>${esc(x.host || '')}</td><td class="trunc" style="max-width:220px" title="${esc(x.to || '')}">${esc(x.to || '')}</td></tr>`).join('')}</tbody></table>`
          : '<div class="empty"><b>Nothing sent yet</b>When a rule with a notification profile fires, every e-mail, text and webhook call is listed here.</div>';
      } catch (err) { box.innerHTML = `<div class="empty"><b>Could not load the log</b>${esc(err.message)}</div>`; }
    };

    const hostOf = (u) => { try { return new URL(u).host; } catch { return ''; } };
    const draw = () => {
      el.innerHTML = head(); const body = $('#nBody', el); clearInterval(timer);
      body.innerHTML = tab === 'profiles' ? profilesTab() : tab === 'email' ? emailTab() : tab === 'sms' ? smsTab() : logTab();
      if (tab === 'log') { logLoad(); $('#lgRefresh', el).onclick = logLoad; timer = setInterval(() => { if (alive) logLoad(); }, 5000); }
    };
    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab]'); if (t) { tab = S.notifyTab = t.dataset.tab; return draw(); }
      if (tab === 'profiles') profilesClick(e); else if (tab === 'email') emailClick(e); else if (tab === 'sms') smsClick(e);
    });
    (async () => { try { c = (await api('/api/config')); draw(); } catch (e) { el.innerHTML = `<div class="empty"><b>Could not load</b>${esc(e.message)}</div>`; } })();
    return () => { alive = false; clearInterval(timer); };
  };
})();
