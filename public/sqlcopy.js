'use strict';
// "SQL Server" page (1.38): copy logs, traps, alarms and devices to a Microsoft SQL Server database.
// The local database stays the main store; the copy catches up by itself after an outage. Loaded after notify.js (shares $, esc, api, toast, can, denied, S ...).
(() => {
  const ago = (t) => { if (!t) return 'never'; const s = Math.round((Date.now() - t) / 1000); return s < 90 ? `${Math.max(0, s)} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };
  const num = (n) => Number(n || 0).toLocaleString();
  views.sqlcopy = (el) => {
    if (!can('settings')) { denied(el, 'SQL Server'); return null; }
    let c = null, timer = 0, alive = true;
    const v = (id) => $('#' + id, el);
    const form = () => ({ enabled: v('sqOn').checked, server: v('sqServer').value.trim(), database: v('sqDb').value.trim(), auth: v('sqAuth').value, user: v('sqUser').value.trim(), password: v('sqPass').value,
      encrypt: v('sqEnc').checked, trustCert: v('sqTrust').checked, createDb: v('sqCreate').checked, copyLogs: v('sqLogs').checked, copyTraps: v('sqTraps').checked, copyAlarms: v('sqAlarms').checked, copyDevices: v('sqDevs').checked, copyPoll: v('sqPoll').checked, backfill: v('sqBack').value === '1', intervalSec: c.intervalSec || 5, batch: c.batch || 2000 });
    const draw = () => {
      const s = c;
      el.innerHTML = `<div class="page-head"><h1>SQL Server</h1></div>
      <p class="muted" style="margin:0 0 10px;max-width:820px">Keep a <b>copy</b> of your syslog messages, SNMP traps, alarms and devices in a Microsoft SQL Server database, for reports, Power BI or long-term history. NetEventPro keeps working with its own local database as before: if the SQL Server is down, the copy waits and <b>catches up by itself</b> when it is back.</p>
      <div id="sqStatus" class="panel" style="margin-bottom:12px"></div>
      <div class="panel"><div class="form">
        <div class="field"><label>Copy</label><div><label class="chk"><input type="checkbox" id="sqOn" ${s.enabled ? 'checked' : ''}> <b>Copy to SQL Server is on</b></label></div></div>
        <div class="field"><label for="sqServer">SQL Server</label><div><input type="text" id="sqServer" style="width:320px" value="${esc(s.server)}" placeholder="sqlhost, sqlhost\\SQLEXPRESS or sqlhost,1433"><div class="hint">Server name or address; add \\instance or ,port when needed.</div></div></div>
        <div class="field"><label for="sqDb">Database</label><div><input type="text" id="sqDb" class="w-md" value="${esc(s.database)}"><div class="hint"><label class="chk"><input type="checkbox" id="sqCreate" ${s.createDb ? 'checked' : ''}> Create the database if it does not exist</label> (the login needs the <i>dbcreator</i> or <i>sysadmin</i> role; otherwise ask your SQL administrator to create an empty database and give the login <i>db_owner</i> on it). The tables are created automatically.</div></div></div>
        <div class="field"><label for="sqAuth">Login</label><div><select id="sqAuth"><option value="windows" ${s.auth !== 'sql' ? 'selected' : ''}>Windows login (the account the NetEventPro service runs as)</option><option value="sql" ${s.auth === 'sql' ? 'selected' : ''}>SQL Server login</option></select>
          <div class="hint" id="sqAuthHint"></div></div></div>
        <div class="field" id="sqSqlRow"><label for="sqUser">SQL login</label><div><input type="text" id="sqUser" class="w-md" value="${esc(s.user)}" autocomplete="off"> password <input type="password" id="sqPass" class="w-md" value="${esc(s.password)}" autocomplete="new-password"></div></div>
        <div class="field"><label>Connection</label><div><label class="chk"><input type="checkbox" id="sqEnc" ${s.encrypt !== false ? 'checked' : ''}> Encrypt the connection</label> &nbsp; <label class="chk"><input type="checkbox" id="sqTrust" ${s.trustCert ? 'checked' : ''}> Trust the server certificate</label><div class="hint">Tick “Trust” when the SQL Server uses its own (self-signed) certificate.</div></div></div>
        <div class="field"><label>What to copy</label><div><label class="chk"><input type="checkbox" id="sqLogs" ${s.copyLogs !== false ? 'checked' : ''}> Syslog messages</label> &nbsp; <label class="chk"><input type="checkbox" id="sqTraps" ${s.copyTraps !== false ? 'checked' : ''}> SNMP traps</label> &nbsp; <label class="chk"><input type="checkbox" id="sqAlarms" ${s.copyAlarms !== false ? 'checked' : ''}> Alarms (and every change of them)</label> &nbsp; <label class="chk"><input type="checkbox" id="sqDevs" ${s.copyDevices !== false ? 'checked' : ''}> Devices</label> &nbsp; <label class="chk"><input type="checkbox" id="sqPoll" ${s.copyPoll !== false ? 'checked' : ''}> SNMP polling readings (5-minute averages, table <code>ne_poll</code>)</label></div></div>
        <div class="field"><label for="sqBack">Starting point</label><div><select id="sqBack"><option value="0" ${!s.backfill ? 'selected' : ''}>Only what arrives from now on</option><option value="1" ${s.backfill ? 'selected' : ''}>Everything already stored here, then what arrives</option></select><div class="hint">Used the first time (or when the server or database name is changed). Rows are merged by number, so copying twice never makes duplicates.</div></div></div>
        <div class="field"><label>Save</label><div><div class="toolbar" style="margin:0"><button id="sqSave" class="primary">Save</button><button id="sqTest">Test connection</button><button id="sqRestart" title="Copy everything stored here again from the beginning">Copy everything again</button></div><div id="sqMsg" class="hint" role="status"></div></div></div>
      </div></div>
      <details class="panel" style="margin-top:12px"><summary><b>How it works and what to know</b></summary><ul class="muted" style="max-width:820px">
        <li>Tables in the database: <code>ne_logs</code> (syslog and traps, column <code>source</code>), <code>ne_alarms</code>, <code>ne_devices</code> and <code>ne_schema</code> (the version of the layout, so later versions can upgrade it), and two views: <code>ne_syslog</code> (only syslog messages) and <code>ne_traps</code> (only SNMP traps), which you can open like tables.</li>
        <li><b>Windows login</b> uses the account the NetEventPro service runs as. By default that is the computer account (<code>DOMAIN\\COMPUTER$</code> on a network); either add that account as a SQL login, or run the service as a domain account (Services → NetEventPro → Log On). <b>SQL login</b> works without any of that.</li>
        <li>The copy keeps a “copied up to here” mark. While the SQL Server is unreachable nothing is lost <b>as long as the messages are still stored here</b>: keep the local retention longer than the longest outage you want to survive. Failed attempts are retried with growing pauses (5 s up to 5 min).</li>
        <li>Alarm changes (acknowledge, clear, escalate) update the same row in SQL Server. Alarms or messages that are deleted or pruned here stay in SQL Server.</li>
        <li>The original raw packet is not copied (it stays in the local database).</li>
        <li>Needs Windows PowerShell 5.1, which is part of Windows. Nothing else to install.</li></ul></details>`;
      sync(); status();
    };
    const sync = () => { const sql = v('sqAuth').value === 'sql'; v('sqSqlRow').hidden = !sql; v('sqAuthHint').textContent = sql ? 'The login and password are stored in the settings file (readable by administrators only).' : 'No password is stored. The SQL Server must accept the service account (see “How it works”).'; };
    const status = async () => {
      let r; try { r = await api('/api/sqlcopy/status'); } catch (e) { return; } if (!alive || !v('sqStatus')) return;
      const col = r.state === 'ok' ? 'ok' : r.state === 'error' ? 'bad' : '', label = { off: 'Off', starting: 'Starting', ok: 'Up to date', 'catching-up': 'Catching up', error: 'Cannot reach the server' }[r.state] || r.state;
      v('sqStatus').innerHTML = `<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center"><span class="pill ${col}">${label}</span>
        <span>${r.target ? '<b>' + esc(r.target) + '</b>' : '<span class="muted">Not set up yet</span>'}</span>
        <span class="muted">Last successful copy: ${ago(r.lastOk)}</span>
        <span class="muted">Waiting to be copied: ${num(r.pending.logs)} messages, ${num(r.pending.alarms)} alarm changes</span>
        <span class="muted">Copied so far: ${num(r.total.logs)} messages, ${num(r.total.alarms)} alarm rows, ${num(r.total.devices)} devices</span></div>
        ${r.lastError ? `<div style="color:var(--s1);margin-top:8px"><b>Last error</b> (${ago(r.lastErrorAt)}${r.retryAt ? `, next try in ${Math.max(0, Math.round((r.retryAt - Date.now()) / 1000))} s` : ''}): ${esc(r.lastError)}</div>` : ''}`;
    };
    const say = (t, bad) => { const m = v('sqMsg'); m.textContent = t; m.style.color = bad === undefined ? '' : bad ? 'var(--s1)' : 'var(--ok)'; };
    el.addEventListener('change', (e) => { if (e.target.id === 'sqAuth') sync(); });
    el.addEventListener('click', async (e) => {
      const id = e.target.id; if (!['sqSave', 'sqTest', 'sqRestart'].includes(id)) return;
      e.target.disabled = true;
      try {
        if (id === 'sqSave') { const r = await api('/api/config', { method: 'PUT', body: { sqlCopy: form() } }); c = r.config.sqlCopy; say('Saved.' + (c.enabled ? ' The copy starts within a few seconds.' : ''), false); status(); }
        if (id === 'sqTest') {
          say('Testing…'); const r = await api('/api/sqlcopy/test', { method: 'POST', body: form() });
          say(r.ok ? `Connected${r.as ? ' as ' + r.as : ''}: ${r.version}. ${r.willCreate ? `The database will be created when you save and switch the copy on.` : 'The database exists.'}` : r.error, !r.ok);
        }
        if (id === 'sqRestart') { if (!await askConfirm('Copy everything stored here again from the beginning? Existing rows in SQL Server are updated, not duplicated. This can take a while for a large database.', 'Copy again')) return; await api('/api/sqlcopy/restart', { method: 'POST', body: {} }); say('Started. Watch “Waiting to be copied” above.', false); setTimeout(status, 1500); }
      } catch (err) { say(err.message, true); } finally { e.target.disabled = false; }
    });
    timer = setInterval(() => { if (alive) status(); }, 4000);
    (async () => { try { c = (await api('/api/config')).sqlCopy || {}; draw(); } catch (e) { el.innerHTML = `<div class="empty"><b>Could not load</b>${esc(e.message)}</div>`; } })();
    return () => { alive = false; clearInterval(timer); };
  };
})();
