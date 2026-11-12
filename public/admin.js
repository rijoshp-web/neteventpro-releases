'use strict';
// Users, reports and backup pages. Loaded after app.js (shares its helpers: $, $$, esc, api, toast, S, views ...).

const can = (perm) => !!(S.info?.me?.perms || []).includes(perm);
const HDR = { 'X-Requested-With': 'NetEventPro', 'content-type': 'application/json' };
const dateTime = (ts) => (ts ? new Date(ts).toLocaleString() : '–');
const humanBytes = (n) => (n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
/** saves a file the server sends (blob) and names it from the server's file name */
async function downloadFrom(url, body, fallbackName) {
  const r = await fetch(url, { method: 'POST', headers: HDR, body: JSON.stringify(body) });
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).error || m; } catch { /* not json */ } throw new Error(m); }
  const blob = await r.blob(), name = (/filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '') || [])[1] || fallbackName;
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 20000);
}
/** a simple dialog; returns { back, close } */
function dialog(title, html, wide) {
  const back = document.createElement('div'); back.className = 'modal-back';
  back.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3 style="margin:0 0 10px">${esc(title)}</h3><div id="dlgBody">${html}</div></div>`;
  document.body.appendChild(back); const close = () => back.remove();
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); }); back.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  return { back, close, $: (s) => $(s, back) };
}
const uid = (p) => p + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36);
const denied = (el, what) => { el.innerHTML = `<div class="page-head"><h1>${esc(what)}</h1></div><div class="empty"><b>Not available for your account</b>Ask an administrator for access.</div>`; };

// =============================== Users ===============================================================================================
views.users = (el) => {
  if (!can('users')) return denied(el, 'Users');
  let d = null; const me = S.info.me;
  const draw = () => {
    const roleOpts = (sel) => d.roles.map((r) => `<option value="${esc(r.id)}" ${r.id === sel ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
    el.innerHTML = `<div class="page-head"><h1>Users</h1><span class="muted">Signed in as <b>${esc(me.name || 'nobody (sign-in is off)')}</b> · ${esc((me.roles || []).join(', '))}</span></div>
    ${d.adminEnabled ? '' : '<div class="banner" style="display:block;position:static;margin:0 0 14px">Sign-in is turned off, so users have no effect. Set a dashboard password first: Settings → Dashboard access.</div>'}
    <fieldset><legend>Built-in administrator</legend>
      <p class="muted" style="margin-top:0">The user name <code>admin</code> always has every permission and can not be removed. ${me.builtin && !me.anonymous ? 'Reset its password here.' : 'Only the administrator can change its password.'}</p>
      ${me.builtin && !me.anonymous ? '<div class="toolbar" style="margin:0"><input type="password" id="admPw" class="w-md" placeholder="New password (8+ characters)" autocomplete="new-password"><button id="admSet">Set admin password</button></div>' : ''}
    </fieldset>
    <fieldset><legend>Users</legend>
      <div style="overflow:auto"><table class="data" id="uTable"><thead><tr><th>User name</th><th>Full name</th><th>E-mail</th><th>Role</th><th>Groups</th><th>Password</th><th>Off</th><th></th></tr></thead><tbody>
      ${d.users.map((u, i) => `<tr data-i="${i}"><td>${u._new ? `<input type="text" class="w-sm" data-u="name" value="${esc(u.name)}" placeholder="login name" maxlength="32">` : `<b>${esc(u.name)}</b>${u.lastLogin ? `<div class="muted" style="font-size:12px">last sign-in ${esc(dateTime(u.lastLogin))}</div>` : ''}`}</td>
        <td><input type="text" class="w-md" data-u="fullName" value="${esc(u.fullName || '')}" maxlength="100"></td><td><input type="text" class="w-md" data-u="email" value="${esc(u.email || '')}" maxlength="200"></td>
        <td><select data-u="roleId">${roleOpts(u.roleId)}</select></td>
        <td>${d.groups.length ? d.groups.map((g) => `<label class="chk" style="display:inline-flex;margin-right:8px"><input type="checkbox" data-ug="${esc(g.id)}" ${u.groupIds.includes(g.id) ? 'checked' : ''}> ${esc(g.name)}</label>`).join('') : '<span class="muted">no groups yet</span>'}</td>
        <td><input type="password" class="w-md" data-u="_pw" placeholder="${u._new ? 'required (8+ characters)' : 'leave empty to keep'}" autocomplete="new-password"></td>
        <td><input type="checkbox" data-u="disabled" ${u.disabled ? 'checked' : ''} title="A disabled user can not sign in"></td>
        <td><button class="danger" data-act="delUser">Delete</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">No users yet. The built-in administrator can always sign in.</td></tr>'}
      </tbody></table></div>
      <div class="toolbar" style="margin:10px 0 0"><button id="addUser">Add user</button></div>
    </fieldset>
    <fieldset><legend>Roles</legend><p class="muted" style="margin-top:0">A role is a set of permissions. A person gets the permissions of their role plus those of every role given to their groups.</p>
      ${d.roles.map((r, i) => `<div class="rule" data-r="${i}" style="border-left-color:${r.locked ? 'var(--accent)' : 'var(--line2)'}"><div class="toolbar" style="margin:0"><input type="text" class="name" data-r="name" value="${esc(r.name)}" ${r.locked ? 'disabled' : ''} maxlength="60"> ${r.locked ? '<span class="pill">built in · always everything</span>' : '<button class="danger" data-act="delRole">Delete</button>'}</div>
        <div class="row">${d.perms.map((p) => `<label class="chk" title="${esc(p.label)}"><input type="checkbox" data-rp="${esc(p.id)}" ${r.perms.includes(p.id) ? 'checked' : ''} ${r.locked ? 'disabled' : ''}> ${esc(p.label)}</label>`).join('')}</div></div>`).join('')}
      <div class="toolbar" style="margin:0"><button id="addRole">Add role</button></div>
      <p class="muted" style="margin-bottom:0">“Manage users, roles and groups” is as powerful as administrator: such a person can give themselves any permission.</p>
    </fieldset>
    <fieldset><legend>Groups</legend><p class="muted" style="margin-top:0">Use groups to give the same roles to several people, for example a “Night shift” group with the Operator role.</p>
      ${d.groups.map((g, i) => `<div class="rule" data-g="${i}"><div class="toolbar" style="margin:0"><input type="text" class="name" data-g="name" value="${esc(g.name)}" maxlength="60"><button class="danger" data-act="delGroup">Delete</button></div>
        <div class="row"><span class="k">Roles</span>${d.roles.map((r) => `<label class="chk"><input type="checkbox" data-gr="${esc(r.id)}" ${g.roleIds.includes(r.id) ? 'checked' : ''}> ${esc(r.name)}</label>`).join('')}</div></div>`).join('') || '<p class="muted">No groups yet.</p>'}
      <div class="toolbar" style="margin:0"><button id="addGroup">Add group</button></div>
    </fieldset>
    <div class="toolbar"><button class="primary" id="saveAll">Save users, roles and groups</button></div>
    ${me.anonymous ? '' : `<fieldset><legend>My password</legend><div class="toolbar" style="margin:0"><input type="password" id="myCur" class="w-md" placeholder="Current password" autocomplete="current-password"><input type="password" id="myNew" class="w-md" placeholder="New password (8+ characters)" autocomplete="new-password"><button id="myPw">Change my password</button></div><p class="muted" style="margin-bottom:0">After changing it, your browser asks you to sign in again.</p></fieldset>`}`;
  };
  const load = async () => { d = await api('/api/users'); d.users.forEach((u) => { u.groupIds ||= []; }); draw(); };
  el.addEventListener('input', (e) => {
    const t = e.target, tr = t.closest('tr[data-i]'), rr = t.closest('[data-r]'), gg = t.closest('[data-g]');
    if (tr && t.dataset.u) d.users[+tr.dataset.i][t.dataset.u] = t.type === 'checkbox' ? t.checked : t.value;
    else if (t.dataset.r && rr) d.roles[+rr.dataset.r].name = t.value; else if (t.dataset.g && gg) d.groups[+gg.dataset.g].name = t.value;
  });
  el.addEventListener('change', (e) => {
    const t = e.target, tr = t.closest('tr[data-i]'), rr = t.closest('[data-r]'), gg = t.closest('[data-g]');
    if (tr && t.dataset.ug) { const u = d.users[+tr.dataset.i]; u.groupIds = u.groupIds.filter((x) => x !== t.dataset.ug); if (t.checked) u.groupIds.push(t.dataset.ug); }
    if (rr && t.dataset.rp) { const r = d.roles[+rr.dataset.r]; r.perms = r.perms.filter((x) => x !== t.dataset.rp); if (t.checked) r.perms.push(t.dataset.rp); }
    if (gg && t.dataset.gr) { const g = d.groups[+gg.dataset.g]; g.roleIds = g.roleIds.filter((x) => x !== t.dataset.gr); if (t.checked) g.roleIds.push(t.dataset.gr); }
  });
  el.addEventListener('click', async (e) => {
    const id = e.target.id, act = e.target.dataset.act;
    try {
      if (id === 'addUser') { d.users.push({ name: '', fullName: '', email: '', roleId: d.roles.some((r) => r.id === 'viewer') ? 'viewer' : d.roles[0].id, groupIds: [], disabled: false, _new: true }); draw(); }
      else if (id === 'addRole') { d.roles.push({ id: uid('r'), name: 'New role', perms: ['view'] }); draw(); }
      else if (id === 'addGroup') { d.groups.push({ id: uid('g'), name: 'New group', roleIds: [] }); draw(); }
      else if (act === 'delUser') { const u = d.users[+e.target.closest('tr').dataset.i]; if (await askConfirm(`Delete the user ${u.name || '(new)'}?`)) { d.users.splice(+e.target.closest('tr').dataset.i, 1); draw(); } }
      else if (act === 'delRole') { const r = d.roles[+e.target.closest('[data-r]').dataset.r]; if (await askConfirm(`Delete the role ${r.name}? People who had it become Viewers.`)) { d.roles.splice(+e.target.closest('[data-r]').dataset.r, 1); d.users.forEach((u) => { if (u.roleId === r.id) u.roleId = 'viewer'; }); d.groups.forEach((g) => { g.roleIds = g.roleIds.filter((x) => x !== r.id); }); draw(); } }
      else if (act === 'delGroup') { const g = d.groups[+e.target.closest('[data-g]').dataset.g]; if (await askConfirm(`Delete the group ${g.name}?`)) { d.groups.splice(+e.target.closest('[data-g]').dataset.g, 1); d.users.forEach((u) => { u.groupIds = u.groupIds.filter((x) => x !== g.id); }); draw(); } }
      else if (id === 'saveAll') {
        const body = { roles: d.roles, groups: d.groups, users: d.users.map((u) => ({ name: u.name, fullName: u.fullName, email: u.email, roleId: u.roleId, groupIds: u.groupIds, disabled: !!u.disabled, password: u._pw || undefined })) };
        d = await api('/api/users', { method: 'POST', body }); d.users.forEach((u) => { u.groupIds ||= []; }); draw(); toast('Saved');
      } else if (id === 'admSet') { await api('/api/users/password', { method: 'POST', body: { name: 'admin', password: $('#admPw').value } }); toast('Administrator password changed — sign in again'); setTimeout(() => location.reload(), 1500); }
      else if (id === 'myPw') { await api('/api/me/password', { method: 'POST', body: { current: $('#myCur').value, password: $('#myNew').value } }); toast('Password changed — sign in again'); setTimeout(() => location.reload(), 1500); }
    } catch (err) { toast(err.message, true); }
  });
  load().catch((e) => { el.innerHTML = `<div class="empty"><b>Could not load users</b>${esc(e.message)}</div>`; });
};

// =============================== Reports =============================================================================================
const REPORT_PERIODS = [['last24h', 'Last 24 hours'], ['last7d', 'Last 7 days'], ['last30d', 'Last 30 days'], ['prevday', 'Yesterday (midnight to midnight)'], ['prevweek', 'The previous 7 full days'], ['prevmonth', 'Previous calendar month']];
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const REPORT_TEMPLATES = [
  { name: 'Daily errors summary', schedule: { type: 'daily', time: '07:30' }, period: 'prevday', filter: { sevs: '0,1,2,3' }, formats: ['pdf', 'xlsx'] },
  { name: 'Weekly report — everything', schedule: { type: 'weekly', dow: 1, time: '08:00' }, period: 'prevweek', filter: {}, formats: ['pdf'], content: { messages: false } },
  { name: 'Daily alarm report (syslog and SNMP)', schedule: { type: 'daily', time: '07:00' }, period: 'prevday', filter: {}, formats: ['pdf', 'xlsx'], content: { messages: false, traps: false, alarmsActive: true, alarmHistory: true } },
  { name: 'Weekly SNMP trap report', schedule: { type: 'weekly', dow: 1, time: '08:00' }, period: 'prevweek', filter: {}, formats: ['pdf', 'xlsx'], content: { messages: false, traps: true, maxTrapRows: 5000, alarmHistory: true } },
  { name: 'Monthly device report', schedule: { type: 'monthly', dom: 1, time: '06:00' }, period: 'prevmonth', filter: {}, formats: ['xlsx', 'pdf'], content: { messages: true, maxRows: 20000 } }
];
views.reports = (el) => {
  if (!can('reports')) return denied(el, 'Reports');
  let reports = [], status = {}, smtpReady = false, dirty = false; let timer, editI = null, backupRep = null, isNewRep = false;
  const blank = (t = {}) => ({ id: uid('rp'), name: 'New report', enabled: true, schedule: { type: 'daily', time: '08:00', dow: 1, dom: 1 }, period: 'last24h', filter: {}, content: { messages: true, maxRows: 5000 }, formats: ['pdf'], email: { enabled: false, to: '' }, folder: { enabled: false, path: '', keep: 30 }, ...t, schedule: { type: 'daily', time: '08:00', dow: 1, dom: 1, ...(t.schedule || {}) }, content: { messages: true, maxRows: 5000, traps: false, alarmsActive: false, alarmHistory: false, ...(t.content || {}) } });
  const stat = (r) => { const s = status[r.id] || {}; if (s.running) return '<span class="pill warn">Running…</span>'; if (!s.lastRun) return '<span class="muted">Never run</span>'; return `<span class="pill ${s.lastOk ? 'ok' : 'bad'}">${s.lastOk ? 'OK' : 'Failed'}</span> <span class="muted">${esc(dateTime(s.lastRun))}${s.lastRows !== undefined ? ` · ${fmtN(s.lastRows)} messages` : ''} — ${esc(s.lastMessage || '')}</span>`; };
  const draw = () => {
    el.innerHTML = `<div class="page-head"><h1>Reports</h1><span class="muted">Scheduled reports as PDF, Excel and CSV — e-mailed and/or saved to a folder or network share. Times are the server's local time.</span></div>
    ${smtpReady ? '' : '<p class="muted">E-mail is not set up yet (Notifications → E-mail server), so e-mail delivery will fail until it is.</p>'}
    <div class="toolbar"><button id="addRep">Add report</button> <span class="muted">or start from:</span> ${REPORT_TEMPLATES.map((t, i) => `<button data-tpl="${i}">${esc(t.name)}</button>`).join('')}<span class="spacer"></span><button class="primary" id="saveRep">Save reports</button></div>
    ${reports.length ? `<div class="panel" style="padding:0;overflow:auto"><table class="data rules" id="repTable"><thead><tr><th>On</th><th>Name</th><th>Schedule</th><th>Covers</th><th>Contents</th><th>Delivery</th><th>Last run</th><th></th></tr></thead><tbody>${reports.map((r, i) => repRow(r, i)).join('')}</tbody></table></div>` : '<div class="empty"><b>No reports yet</b>Add a report, or start from one of the examples above.</div>'}
    ${editI !== null && reports[editI] ? `<div class="modal-back" id="repModal"><div class="modal xwide" role="dialog" aria-modal="true" aria-label="Edit report"><div class="toolbar" style="margin:0 0 8px"><h3 style="margin:0">${isNewRep ? 'New report' : 'Edit report'}</h3><span class="spacer"></span><button id="repCancel">Cancel</button><button class="primary" id="repDone">Done</button></div><div class="modal-scroll">${repHtml(reports[editI], editI)}</div><p class="muted" style="margin:8px 0 0">“Done” keeps your changes on this page. Click <b>Save reports</b> to make them active.</p></div></div>` : ''}`;
  };
  const repHtml = (r, i) => `<div class="rule ${r.enabled ? '' : 'off'}" data-i="${i}">
      <div class="toolbar" style="margin:0"><label class="chk"><input type="checkbox" data-k="enabled" ${r.enabled ? 'checked' : ''}> On</label><input type="text" class="name" data-k="name" value="${esc(r.name)}" maxlength="100" aria-label="Report name"><span class="spacer"></span>${stat(r)}</div>
      <div class="row"><span class="k">When</span><select data-k="schedule.type"><option value="hourly" ${r.schedule.type === 'hourly' ? 'selected' : ''}>Every hour at minute</option><option value="daily" ${r.schedule.type === 'daily' ? 'selected' : ''}>Every day at</option><option value="weekly" ${r.schedule.type === 'weekly' ? 'selected' : ''}>Every week on</option><option value="monthly" ${r.schedule.type === 'monthly' ? 'selected' : ''}>Every month on day</option></select>
        ${r.schedule.type === 'weekly' ? `<select data-k="schedule.dow">${DOW.map((n, k) => `<option value="${k}" ${+r.schedule.dow === k ? 'selected' : ''}>${n}</option>`).join('')}</select>` : ''}
        ${r.schedule.type === 'monthly' ? `<input type="number" class="w-sm" min="1" max="28" data-k="schedule.dom" value="${esc(r.schedule.dom)}" title="Day of the month (1-28)">` : ''}
        <input type="time" data-k="schedule.time" value="${esc(r.schedule.time)}" aria-label="Time"> <span class="k" style="min-width:0">covering</span>
        <select data-k="period">${REPORT_PERIODS.map(([v, l]) => `<option value="${v}" ${r.period === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="row"><span class="k">Include</span><button type="button" data-sevbtn>${esc(sevLabel(r.filter.sevs))} ▾</button><input type="text" class="w-md" data-k="filter.host" placeholder="Device" value="${esc(r.filter.host || '')}"><input type="text" class="w-md" data-k="filter.app" placeholder="Process" value="${esc(r.filter.app || '')}"><input type="text" class="w-sm" data-k="filter.tag" placeholder="Tag" value="${esc(r.filter.tag || '')}"><input type="text" data-k="filter.text" placeholder="Text · -word · tag:name" style="width:210px" value="${esc(r.filter.text || '')}"></div>
      <div class="row"><span class="k">Syslog</span><label class="chk"><input type="checkbox" data-k="content.messages" ${r.content.messages !== false ? 'checked' : ''}> List the syslog messages</label>${r.content.messages !== false ? `<span class="muted">newest</span> <input type="number" class="w-sm" min="1" max="100000" data-k="content.maxRows" value="${esc(r.content.maxRows)}"> <span class="muted">at most (the PDF shows 1,500)</span>` : ''}<span class="muted">· the syslog summary, severity chart, trend and top devices and processes are always included. The filter above applies to syslog and traps.</span></div>
      <div class="row"><span class="k">Also include</span><label class="chk"><input type="checkbox" data-k="content.traps" ${r.content.traps ? 'checked' : ''}> SNMP traps (summary, top traps and senders, list)</label>${r.content.traps ? `<span class="muted">newest</span> <input type="number" class="w-sm" min="1" max="100000" data-k="content.maxTrapRows" value="${esc(r.content.maxTrapRows ?? 2000)}"> <span class="muted">traps at most</span>` : ''}
        <label class="chk"><input type="checkbox" data-k="content.alarmsActive" ${r.content.alarmsActive ? 'checked' : ''}> Active alarms (open and acknowledged, at report time)</label>
        <label class="chk"><input type="checkbox" data-k="content.alarmHistory" ${r.content.alarmHistory ? 'checked' : ''}> Alarm history (raised or cleared in the period, with times and duration)</label></div>
      <div class="row"><span class="k">Files</span>${['pdf', 'xlsx', 'csv'].map((f) => `<label class="chk"><input type="checkbox" data-fmt="${f}" ${r.formats.includes(f) ? 'checked' : ''}> ${f === 'xlsx' ? 'Excel (.xlsx)' : f === 'pdf' ? 'PDF' : 'CSV'}</label>`).join('')}</div>
      <div class="row"><span class="k">Send</span><label class="chk"><input type="checkbox" data-k="email.enabled" ${r.email.enabled ? 'checked' : ''}> E-mail to</label><input type="text" data-k="email.to" placeholder="a@x.com, b@y.com (empty = the default alert list)" style="width:300px" value="${esc(r.email.to || '')}"><span class="muted">Cc</span><input type="text" data-k="email.cc" placeholder="optional, comma separated" style="width:240px" value="${esc(r.email.cc || '')}"></div>
      <div class="row"><span class="k">Subject</span><input type="text" data-k="email.subject" maxlength="200" placeholder="empty = the report name and date" style="width:100%;max-width:640px" value="${esc(r.email.subject || '')}" title="You can use {name}, {date}, {period}, {count}"></div>
      <div class="row"><span class="k">Message</span><textarea data-k="email.body" rows="3" maxlength="2000" placeholder="empty = a short standard text. You can use {name}, {date}, {period}, {count}" style="width:100%;max-width:640px">${esc(r.email.body || '')}</textarea></div>
      <div class="row"><span class="k">Save</span><label class="chk"><input type="checkbox" data-k="folder.enabled" ${r.folder.enabled ? 'checked' : ''}> To a folder</label><input type="text" data-k="folder.path" placeholder="\\\\server\\share\\reports  or  D:\\Reports" style="width:300px" value="${esc(r.folder.path || '')}"><button type="button" data-act="testFolder">Test folder</button><span class="muted">keep newest</span><input type="number" class="w-sm" min="0" max="1000" data-k="folder.keep" value="${esc(r.folder.keep ?? 30)}" title="0 = keep all"><span class="muted">per file type</span></div>
      <div class="row"><span class="k"></span><span class="muted">Network share sign-in</span><input type="text" data-k="folder.user" placeholder="user (DOMAIN\\user or .\\user)" style="width:210px" autocomplete="off" value="${esc(r.folder.user || '')}" title="Only for a network share (\\\\server\\share). Empty = the service's own account is used."><input type="password" data-k="folder.password" placeholder="password" style="width:170px" autocomplete="new-password" value="${esc(r.folder.password || '')}"><span class="muted">optional; used only for this folder</span></div>
      <div class="row"><button data-act="run">Run now and deliver</button><span class="muted">or download:</span><button data-act="dl" data-f="pdf">PDF</button><button data-act="dl" data-f="xlsx">Excel</button><button data-act="dl" data-f="csv">CSV</button></div></div>`;
  const repRow = (r, i) => { const sc = r.schedule, when = sc.type === 'hourly' ? `every hour at :${String(sc.time || '00:00').slice(3)}` : sc.type === 'daily' ? `daily ${sc.time}` : sc.type === 'weekly' ? `${DOW[+sc.dow]} ${sc.time}` : `day ${sc.dom} monthly ${sc.time}`, per = (REPORT_PERIODS.find(([v]) => v === r.period) || [0, r.period])[1], c = r.content || {};
    const parts = [c.messages !== false ? 'syslog' : '', c.traps ? 'traps' : '', c.alarmsActive ? 'active alarms' : '', c.alarmHistory ? 'alarm history' : ''].filter(Boolean).join(' · '), dl = [r.email.enabled ? 'e-mail' + (r.email.cc ? ' + cc' : '') : '', r.folder.enabled ? 'folder' : ''].filter(Boolean).join(' + ') || 'download only';
    return `<tr class="rrow ${r.enabled ? '' : 'off'}" data-i="${i}"><td class="chk"><input type="checkbox" data-en="${i}" ${r.enabled ? 'checked' : ''} aria-label="Report on"></td><td class="nowrap"><b>${esc(r.name)}</b></td><td class="nowrap">${esc(when)}</td><td class="nowrap">${esc(per)}</td><td class="cond" title="${esc(parts)}">${esc(parts)}</td><td class="nowrap">${esc(dl)} <span class="muted">${r.formats.map((f) => f.toUpperCase()).join('/')}</span></td><td class="nowrap">${stat(r)}</td>
      <td class="nowrap acts"><button data-act="run" title="Create the report now and deliver it">Run now</button><button data-act="edit">Edit</button><button class="danger" data-act="del">Delete</button></td></tr>`; };
  const load = async () => { const r = await api('/api/reports'); reports = r.reports.map((x) => ({ ...blank(), ...x, filter: x.filter || {}, schedule: { ...blank().schedule, ...x.schedule } })); status = r.status; smtpReady = r.smtpReady; draw(); };
  const setPath = (r, path, v) => { const [a, b] = path.split('.'); if (b) (r[a] ||= {})[b] = v; else r[a] = v; if (path.startsWith('filter.') && v === '') delete r.filter[b]; dirty = true; };
  el.addEventListener('input', (e) => { const k = e.target.dataset.k; if (!k) return; const r = reports[+e.target.closest('.rule').dataset.i]; setPath(r, k, e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? (e.target.value === '' ? '' : +e.target.value) : e.target.value); });
  el.addEventListener('change', (e) => {
    if (e.target.dataset.en !== undefined) { reports[+e.target.dataset.en].enabled = e.target.checked; dirty = true; e.target.closest('tr').classList.toggle('off', !e.target.checked); return; }
    const rule = e.target.closest('.rule'); if (!rule) return; const r = reports[+rule.dataset.i];
    if (e.target.dataset.fmt) { r.formats = r.formats.filter((f) => f !== e.target.dataset.fmt); if (e.target.checked) r.formats.push(e.target.dataset.fmt); dirty = true; }
    if (['schedule.type', 'content.messages', 'content.traps', 'enabled'].includes(e.target.dataset.k)) { setPath(r, e.target.dataset.k, e.target.type === 'checkbox' ? e.target.checked : e.target.value); draw(); }
  });
  const runIt = async (r, label, fn) => { if (dirty) return toast('Save the reports first, then run.', true); try { toast(label); await fn(); } catch (err) { toast(err.message, true); } load().catch(() => {}); };
  el.addEventListener('click', async (e) => {
    const rule = e.target.closest('[data-i]'); const r = rule && reports[+rule.dataset.i]; const act = e.target.dataset.act;
    if (e.target.id === 'addRep') { reports.push(blank()); dirty = true; editI = reports.length - 1; backupRep = null; isNewRep = true; draw(); }
    else if (e.target.id === 'repCancel') { if (isNewRep) reports.splice(editI, 1); else if (backupRep) reports[editI] = backupRep; editI = null; backupRep = null; isNewRep = false; draw(); }
    else if (e.target.id === 'repDone') { editI = null; backupRep = null; isNewRep = false; draw(); }
    else if (act === 'edit') { editI = +rule.dataset.i; backupRep = structuredClone(r); isNewRep = false; draw(); }
    else if (e.target.dataset.tpl !== undefined) { reports.push(blank(structuredClone(REPORT_TEMPLATES[+e.target.dataset.tpl]))); dirty = true; editI = reports.length - 1; backupRep = null; isNewRep = true; draw(); }
    else if (e.target.id === 'saveRep') { try { const out = await api('/api/config', { method: 'PUT', body: { reports } }); dirty = false; toast('Reports saved'); await load(); } catch (err) { toast(err.message, true); } }
    else if (e.target.closest('[data-sevbtn]')) { const b = e.target.closest('[data-sevbtn]'); sevPopover(b, r.filter.sevs || '', (v) => { if (v) r.filter.sevs = v; else delete r.filter.sevs; b.textContent = sevLabel(v) + ' ▾'; dirty = true; }); }
    else if (act === 'del') { if (await askConfirm(`Delete the report "${r.name}"?`)) { reports.splice(+rule.dataset.i, 1); dirty = true; draw(); } }
    else if (act === 'testFolder') { try { const t = await api('/api/reports/test-folder', { method: 'POST', body: { id: r.id, path: r.folder.path, user: r.folder.user || '', password: r.folder.password || '' } }); toast(t.ok ? `Folder works: ${t.folder}` : t.error, !t.ok); } catch (err) { toast(err.message, true); } }
    else if (act === 'run') runIt(r, 'Creating the report…', async () => { const o = await api('/api/reports/run', { method: 'POST', body: { id: r.id } }); toast(o.results.map((x) => `${x.where}: ${x.detail}`).join(' · '), !o.ok); });
    else if (act === 'dl') runIt(r, 'Creating the file…', () => downloadFrom('/api/reports/run', { id: r.id, download: e.target.dataset.f }, 'report.' + e.target.dataset.f));
  });
  load().catch((e) => { el.innerHTML = `<div class="empty"><b>Could not load reports</b>${esc(e.message)}</div>`; });
  timer = setInterval(() => { if (!dirty && editI === null && !el.contains(document.activeElement)) api('/api/reports').then((r) => { status = r.status; draw(); }).catch(() => {}); }, 8000);
  return () => clearInterval(timer);
};

// =============================== Backup and restore ==================================================================================
views.backup = (el) => {
  if (!can('backup')) return denied(el, 'Backup');
  let d = null, timer;
  const draw = () => {
    const c = d.config;
    el.innerHTML = `<div class="page-head"><h1>Backup &amp; restore</h1><span class="muted">Database ${esc(humanBytes(d.dbBytes))} · backups are kept in the data folder under <code>backups</code></span></div>
    ${d.pending ? `<div class="banner" style="display:block;position:static;margin:0 0 14px">A restore from <b>${esc(d.pending.from)}</b> (${esc(d.pending.parts.map((p) => ({ db: 'messages', settings: 'settings', users: 'users' }[p])).join(', '))}) is ready. It is applied when the service restarts. Your current files are kept first. <button id="restartNow2" class="primary">Restart service now</button> <button id="cancelRestore">Cancel the restore</button></div>` : ''}
    <fieldset><legend>Create a backup</legend>
      <div class="form"><label class="chk"><input type="checkbox" id="bkDb" checked> Include the message database (${esc(humanBytes(d.dbBytes))}). Without it the backup holds only settings, users and rules.</label>
      <div class="field"><label for="bkPass">Passphrase (optional)</label><div><input type="password" id="bkPass" class="w-md" autocomplete="new-password" placeholder="Encrypts the file"><div class="hint">A backup contains settings, the e-mail password and password hashes. Encrypt it if it leaves this computer. <b>Without the passphrase an encrypted backup can not be opened.</b></div></div></div>
      <div class="toolbar" style="margin:0"><button class="primary" id="bkNow" ${d.busy ? 'disabled' : ''}>${d.busy ? 'Backup running…' : 'Create backup now'}</button> ${d.last ? `<span class="muted">Last: ${d.last.ok ? 'OK' : '<b>failed</b>'} — ${esc(d.last.message)} (${esc(dateTime(d.last.at))})</span>` : ''}</div></div>
    </fieldset>
    <fieldset><legend>Saved backups</legend>
      <div style="overflow:auto"><table class="data"><thead><tr><th>File</th><th>Created</th><th class="num-r">Size</th><th></th><th></th></tr></thead><tbody>
      ${d.backups.map((b) => `<tr data-n="${esc(b.name)}" data-enc="${b.encrypted ? 1 : 0}"><td><b>${esc(b.name)}</b> ${b.encrypted ? '<span class="pill">encrypted</span>' : ''} ${b.auto ? '<span class="pill">automatic</span>' : ''}</td><td class="muted">${esc(dateTime(b.mtime))}</td><td class="num-r">${esc(humanBytes(b.size))}</td>
        <td style="white-space:nowrap"><a class="btn" href="/api/backup/file?name=${encodeURIComponent(b.name)}" download>Download</a> <button data-act="restore">Restore…</button> <button class="danger" data-act="del">Delete</button></td><td></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No backups yet.</td></tr>'}
      </tbody></table></div>
      <div class="toolbar" style="margin:12px 0 0"><span class="muted">Restore from a file on this PC:</span><input type="file" id="upFile" accept=".spbak"><button id="upGo">Upload</button><span id="upInfo" class="muted"></span></div>
    </fieldset>
    <fieldset><legend>Automatic daily backup</legend><div class="form">
      <label class="chk"><input type="checkbox" id="abOn" ${c.enabled ? 'checked' : ''}> Make a backup every day at <input type="time" id="abTime" value="${esc(c.time)}"></label>
      <div class="field"><label for="abKeep">Keep the newest</label><div><input type="number" id="abKeep" class="w-sm" min="1" max="365" value="${esc(c.keep)}"> automatic backups <div class="hint">Older automatic backups are deleted. Manual backups are never deleted automatically.</div></div></div>
      <label class="chk"><input type="checkbox" id="abDb" ${c.includeDb !== false ? 'checked' : ''}> Include the message database</label>
      <div class="field"><label for="abFolder">Also copy to a folder</label><div><input type="text" id="abFolder" style="width:100%;max-width:420px" value="${esc(c.folder || '')}" placeholder="\\\\server\\share\\neteventpro-backups  (optional)"><div class="hint">A network share keeps a copy even if this computer fails.</div></div></div>
      <div class="field"><label for="abFUser">Share sign-in</label><div><input type="text" id="abFUser" style="width:210px" autocomplete="off" value="${esc(c.folderUser || '')}" placeholder="user (optional)"> <input type="password" id="abFPass" style="width:170px" autocomplete="new-password" value="${esc(c.folderPassword || '')}" placeholder="password"><div class="hint">For a network share: the user name and password to open it with. Empty = the service's own account is used.</div></div></div>
      <div class="field"><label for="abPass">Passphrase</label><div><input type="password" id="abPass" class="w-md" value="${esc(c.passphrase)}" autocomplete="new-password" placeholder="optional — encrypts automatic backups"></div></div>
      <div class="toolbar" style="margin:0"><button class="primary" id="abSave">Save automatic backup settings</button></div></div>
    </fieldset>`;
  };
  const load = async () => { d = await api('/api/backup'); if (!el.contains(document.activeElement) || document.activeElement === document.body) draw(); };
  const restoreDialog = (name, enc) => {
    const dlg = dialog('Restore ' + name, `<p class="muted" style="margin-top:0">Nothing changes until you confirm. The restore is applied when the service restarts, and your current files are kept in a <code>before-restore-…</code> folder in the data folder.</p>
      ${enc ? '<div class="field"><label for="rsPass">Passphrase</label><input type="password" id="rsPass" class="w-md" autocomplete="off"></div>' : ''}
      <div class="toolbar"><button class="primary" id="rsRead">Read the backup</button></div><div id="rsOut"></div>`, true);
    const read = async () => {
      try {
        const info = await api('/api/backup/inspect', { method: 'POST', body: { name, passphrase: dlg.$('#rsPass')?.value || '' } });
        dlg.$('#rsOut').innerHTML = `<p>Made ${esc(dateTime(info.created))} on <b>${esc(info.host || '?')}</b> (NetEventPro ${esc(info.version || '?')}).</p>
          <label class="chk" style="display:flex"><input type="checkbox" data-p="db" ${info.includesDb ? 'checked' : 'disabled'}> Messages database ${info.includesDb ? '— replaces ALL messages stored now' : '(not in this backup)'}</label>
          <label class="chk" style="display:flex"><input type="checkbox" data-p="settings" checked> Settings, rules, reports, e-mail and passwords — including ports and the dashboard password</label>
          <label class="chk" style="display:flex"><input type="checkbox" data-p="users" ${info.files.some((f) => f.name === 'users.json') ? 'checked' : 'disabled'}> Users, roles and groups</label>
          <div class="toolbar" style="margin-top:12px"><button class="primary" id="rsGo">Prepare the restore</button><button id="rsX">Cancel</button></div>`;
        dlg.$('#rsX').onclick = dlg.close;
        dlg.$('#rsGo').onclick = async () => {
          const parts = [...dlg.back.querySelectorAll('[data-p]')].filter((x) => x.checked).map((x) => x.dataset.p);
          try { dlg.$('#rsGo').disabled = true; await api('/api/backup/restore', { method: 'POST', body: { name, passphrase: dlg.$('#rsPass')?.value || '', parts } }); dlg.close(); toast('Restore prepared — restart the service to apply it'); load(); } catch (err) { toast(err.message, true); dlg.$('#rsGo').disabled = false; }
        };
      } catch (err) { toast(err.message, true); }
    };
    dlg.$('#rsRead').onclick = read;
  };
  el.addEventListener('click', async (e) => {
    const t = e.target, tr = t.closest('tr[data-n]'), act = t.dataset.act;
    try {
      if (t.id === 'bkNow') { t.disabled = true; toast('Creating the backup…'); const pass = $('#bkPass').value; await api('/api/backup/create', { method: 'POST', body: { includeDb: $('#bkDb').checked, passphrase: pass } }); toast('Backup created'); await load(); draw(); }
      else if (act === 'del') { if (await askConfirm(`Delete ${tr.dataset.n}? This cannot be undone.`)) { await api('/api/backup/delete', { method: 'POST', body: { name: tr.dataset.n } }); await load(); draw(); } }
      else if (act === 'restore') restoreDialog(tr.dataset.n, tr.dataset.enc === '1');
      else if (t.id === 'restartNow2') restartService();
      else if (t.id === 'cancelRestore') { await api('/api/backup/cancel-restore', { method: 'POST', body: {} }); await load(); draw(); }
      else if (t.id === 'abSave') {
        const backup = { enabled: $('#abOn').checked, time: $('#abTime').value || '02:00', keep: +$('#abKeep').value || 7, includeDb: $('#abDb').checked, folder: $('#abFolder').value.trim(), folderUser: $('#abFUser').value.trim(), folderPassword: $('#abFPass').value, passphrase: $('#abPass').value };
        await api('/api/config', { method: 'PUT', body: { backup } }); toast('Saved'); await load(); draw();
      } else if (t.id === 'upGo') {
        const f = $('#upFile').files[0]; if (!f) return toast('Choose a .spbak file first.', true);
        $('#upInfo').textContent = 'Uploading…'; const r = await fetch('/api/backup/upload', { method: 'POST', headers: { 'X-Requested-With': 'NetEventPro', 'x-filename': f.name, 'content-type': 'application/octet-stream' }, body: f });
        const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); $('#upInfo').textContent = ''; toast('Uploaded'); await load(); draw();
      }
    } catch (err) { toast(err.message, true); $('#upInfo') && ($('#upInfo').textContent = ''); load().then(draw).catch(() => {}); }
  });
  load().then(draw).catch((e) => { el.innerHTML = `<div class="empty"><b>Could not load backups</b>${esc(e.message)}</div>`; });
  timer = setInterval(() => { if (d && (d.busy || d.pending)) load().then(() => { if (!el.contains(document.activeElement) || document.activeElement === document.body) draw(); }).catch(() => {}); }, 4000);
  return () => clearInterval(timer);
};
