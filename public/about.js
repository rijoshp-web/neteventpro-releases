'use strict';
// Settings → About (1.91): version, licence, who you are, this server, copyright. Loaded after app.js (shares $, esc, api, toast, dateOf, timeOf).
function aboutMount(el) {
  const box = $('#aboutBox', el); if (!box) return;
  const when = (t) => (t ? `${new Date(t).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })} ${new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '–');
  const dur = (s) => { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`; };
  const row = (k, v) => `<tr><td style="width:190px;color:var(--muted)">${esc(k)}</td><td>${v}</td></tr>`;
  api('/api/about').then((a) => {
    const L = a.license, S = a.server
    const pill = { licensed: ['Activated', 'ok'], grace: [`Not activated, ${L.graceDaysLeft} day${L.graceDaysLeft === 1 ? '' : 's'} left`, 'warn'], expired: ['Expired', 'bad'], wrongmachine: ['Wrong computer', 'bad'], unlicensed: ['Not activated', 'bad'] }[L.state] || [L.state, ''];
    const text = [`NetEventPro ${a.version}`, `Licence: ${pill[0]}${L.customer ? ' · ' + L.customer : ''}${L.licenseId ? ' · ' + L.licenseId : ''}`, `Machine code: ${L.machine}`, `Computer: ${S.host} · ${S.os} · Node ${S.node}`, `Signed in as: ${a.you.name}`].join('\n');
    box.className = '';
    box.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:4px"><span style="font-size:22px;font-weight:700">NetEventPro</span><span style="font-size:16px">version <b>${esc(a.version)}</b></span><span class="pill ${pill[1]}">${esc(pill[0])}</span><span class="spacer"></span><button id="abCopy" title="Copy these details for a support request">Copy details</button></div>
      <div class="muted" style="margin-bottom:12px">${esc(a.copyright)} Syslog, SNMP trap and polling monitor.</div>
      <h4 style="margin:10px 0 4px">Licence</h4>
      <table class="data" style="max-width:820px"><tbody>
        ${row('Status', `<span class="pill ${pill[1]}">${esc(pill[0])}</span> ${L.error ? `<span class="muted">${esc(L.error)}</span>` : ''}`)}
        ${row('Licensed to', esc(L.customer || '–'))}
        ${row('Edition', esc(L.edition || '–'))}
        ${row('Licence number', esc(L.licenseId || '–'))}
        ${row('Issued', esc(L.issued || '–'))}
        ${row('Valid until', L.state === 'licensed' || L.state === 'expired' ? esc(L.expires || 'No end date') : '–')}
        ${row('Included features', (L.features || []).map((f) => `<span style="white-space:nowrap;margin-right:12px;color:${f.on ? 'inherit' : 'var(--muted)'}">${f.on ? '✔' : '✖'} ${esc(f.name)}</span>`).join(' ') || '–')}
        ${row('Polled devices allowed', L.maxDevices ? String(L.maxDevices) : 'No limit')}
        ${row('Locked to', L.anyMachine ? 'Any computer' : 'This computer only')}
        ${row('Machine code', `<code style="user-select:all">${esc(L.machine)}</code> <button id="abMc">Copy</button>`)}
        ${row('Activated on', esc(when(L.activatedAt)))}
      </tbody></table>
      ${S.dataDir ? `<details style="margin:8px 0 0"><summary class="muted" style="cursor:pointer">Enter a new key (renewal or change)</summary><div style="margin-top:6px"><textarea id="abKey" rows="3" style="width:100%;max-width:820px;font-family:ui-monospace,Consolas,monospace;font-size:12px" placeholder="NEP1-…" spellcheck="false"></textarea><div class="toolbar" style="margin:6px 0 0"><button class="primary" id="abAct">Activate</button><span id="abMsg" class="muted"></span></div></div></details>` : ''}
      <h4 style="margin:14px 0 4px">You</h4>
      <table class="data" style="max-width:820px"><tbody>
        ${row('Signed in as', a.you.anonymous ? 'Nobody: no sign-in is set, so everyone who can open the dashboard is an administrator' : `<b>${esc(a.you.name)}</b>${a.you.fullName ? ' · ' + esc(a.you.fullName) : ''}`)}
        ${row('Role', esc((a.you.roles || []).join(', ') || '–'))}
        ${row('Two-factor sign-in', a.you.anonymous ? 'Not applicable (no sign-in is set)' : a.you.twofa ? 'On' : 'Off')}
      </tbody></table>
      <h4 style="margin:14px 0 4px">This server</h4>
      <table class="data" style="max-width:820px"><tbody>
        ${row('Computer', esc(S.host))}
        ${row('Operating system', esc(S.os))}
        ${row('Runtime', 'Node.js ' + esc(S.node.replace(/^v/, '')))}
        ${row('Type', esc(S.mode === 'central' || !S.mode ? 'Central server' : S.mode))}
        ${row('Running since', `${esc(when(S.started))} (${esc(dur(S.uptimeSec))})`)}
        ${row('Program files updated', esc(when(S.installed)))}
        ${row('Dashboard', `${S.web.https ? 'https' : 'http'} · ${esc(S.web.bind === '127.0.0.1' ? 'this computer only' : S.web.bind)} · port ${S.web.port}`)}
        ${row('Listening', [S.ports.udp ? 'syslog UDP ' + S.ports.udp : '', S.ports.tcp ? 'syslog TCP ' + S.ports.tcp : '', S.ports.trap ? 'SNMP traps ' + S.ports.trap : ''].filter(Boolean).join(' · ') || '–')}
        ${S.dataDir ? row('Data folder', `<code>${esc(S.dataDir)}</code>`) : ''}
        ${row('Memory in use', S.memoryMB + ' MB')}
        ${row('Users / polled devices', `${a.counts.users} / ${a.counts.polledDevices}`)}
      </tbody></table>
      ${a.support ? `<h4 style="margin:14px 0 4px">Support</h4><div>${esc(a.support)}</div>` : ''}
      <h4 style="margin:14px 0 4px">Copyright and licence</h4>
      <p class="muted" style="max-width:820px;margin:0">NetEventPro and its documentation are protected by copyright. ${esc(a.copyright)} The program is licensed, not sold: one activation key allows use on the computer named in it. Copying, resale, renting out or sharing the program or its key, and removing or bypassing the activation, are not permitted. The program is built on Node.js, which is used under its own open-source licence (MIT).</p>`;
    $('#abCopy', box).onclick = async () => { try { await navigator.clipboard.writeText(text); toast('Details copied'); } catch { toast('Could not copy', true); } };
    $('#abMc', box).onclick = async () => { try { await navigator.clipboard.writeText(L.machine); toast('Machine code copied'); } catch { toast('Could not copy', true); } };
    const act = $('#abAct', box); if (act) act.onclick = async () => {
      const msg = $('#abMsg', box); msg.textContent = ''; act.disabled = true;
      try { await api('/api/license/activate', { method: 'POST', body: { key: $('#abKey', box).value } }); toast('Activated'); aboutMount(el); }
      catch (e) { msg.textContent = e.message; msg.style.color = 'var(--bad)'; toast(e.message, true); }
      act.disabled = false;
    };
  }).catch((e) => { box.textContent = e.message; });
}
