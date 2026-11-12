'use strict';
// SNMP receiver setup and MIB files (shown inside Settings → SNMP & MIBs)
const SNMP_SEV = ['emergency', 'alert', 'critical', 'error', 'warning', 'notice', 'info', 'debug', 'minor', 'cleared'];
views.snmp = (el, _main, embedded) => {
  let d = null, timer, busy = false, mibFilter = '', v3Local = null, dirty = false;
  const v3Read = () => [...el.querySelectorAll('#v3Rows tr')].map((tr) => Object.fromEntries([...tr.querySelectorAll('[data-v]')].map((x) => [x.dataset.v, x.value])));
  const n = (v) => Number(v || 0).toLocaleString();
  const sevRulesText = (rules) => (rules || []).map((r) => `${r.match} = ${SNMP_SEV[r.severity]}`).join('\n');
  const parseRules = (txt) => txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^([A-Za-z0-9_.:-]+)\s*[=:]\s*(\d|[A-Za-z]+)$/.exec(l); if (!m) throw new Error(`Severity rule not understood: "${l}". Write one per line, like  upsOnBattery = critical  or  1.3.6.1.4.1.318.0.5 = 2.`);
    const sev = /^\d$/.test(m[2]) ? +m[2] : SNMP_SEV.indexOf(m[2].toLowerCase()); if (sev < 0 || sev > 9) throw new Error(`"${m[2]}" is not a severity (0-9, or ${SNMP_SEV.join(', ')}).`);
    return { match: m[1], severity: sev };
  });

  // "Severity from a value":  alarmSeverity: critical=2, major=3, minor=4   (one line per value name; the number or the word of the trap's own value = the severity here)
  const valRulesText = (rules) => (rules || []).map((r) => `${r.field}${r.match ? ' @ ' + r.match : ''}: ${r.map.map((m) => `${m.value}=${SNMP_SEV[m.severity]}`).join(', ')}`).join('\n');
  const parseValRules = (txt) => txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const hd = /^([A-Za-z0-9_.-]+)\s*(?:@\s*(.+?))?\s*:/.exec(l); const i = hd ? hd[0].length - 1 : -1; const f = hd ? hd[1] : ''; const match = hd?.[2] ? hd[2].trim() : ''; if (!f) throw new Error(`Severity from a value, not understood: "${l}". Write  valueName: value=severity, value=severity  (for example  alarmSeverity: major=error, minor=warning).`);
    const map = l.slice(i + 1).split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const m = /^(.+?)\s*=\s*(\d|[A-Za-z]+)$/.exec(x); if (!m) throw new Error(`"${x}" in "${f}" is not  value=severity.`); const sev = /^\d$/.test(m[2]) ? +m[2] : SNMP_SEV.indexOf(m[2].toLowerCase()); if (sev < 0 || sev > 9) throw new Error(`"${m[2]}" is not a severity (0-9, or ${SNMP_SEV.join(', ')}).`); return { value: m[1].trim(), severity: sev }; });
    return match ? { field: f, match, map } : { field: f, map };
  });

  const statusPanel = () => {
    const s = d.status, c = d.config;
    const pill = !c.enabled ? '<span class="pill">Off</span>' : s.running ? '<span class="pill ok">Listening</span>' : '<span class="pill bad">Not running</span>';
    const kv = (a) => `<table class="data"><tbody>${a.map(([k, v]) => `<tr><td>${k}</td><td style="text-align:right">${v}</td></tr>`).join('')}</tbody></table>`;
    return `<div class="panel"><h2>Receiver ${pill}</h2>
      ${s.error ? `<p class="muted" style="color:var(--bad)">${esc(s.error)}</p>` : ''}
      ${c.enabled && s.running ? `<p class="muted">Point your devices' SNMP trap destination at <b>this computer, UDP port ${s.port}</b>, SNMP v1, v2c or v3.</p>` : ''}
      ${kv([['Traps received', n(s.decoded)], ['… SNMP v1 / v2c', `${n(s.v1)} / ${n(s.v2c)}`], ['… informs (answered)', `${n(s.informs)} (${n(s.informsAcked)})`],
        ['Refused: sender not allowed', n(s.rejectedSource)], ['Refused: wrong community', n(s.rejectedCommunity)], ['Not SNMP / damaged', n(s.malformed)], ['SNMP v3 accepted / refused', s.v3 ? `${n(s.v3Ok)} / ${n(s.v3Refused)}${s.v3LastError ? ` <span class="muted" title="${esc(s.v3LastError)}">(last: ${esc(String(s.v3LastError).slice(0, 80))})</span>` : ''}` : '0'],
        ['Last trap', s.lastAt ? ago((Date.now() - s.lastAt) / 1000) : 'none yet']])}</div>`;
  };
  const missingPanel = () => {
    const m = d.status.missing;
    return `<div class="panel"><h2>MIBs still needed</h2>${m.length ? `<p class="muted">These traps or values could not be named, so they show as numbers. Upload the MIB files of the equipment below, then new traps are shown by name.</p>
      <div style="overflow-x:auto"><table class="data"><thead><tr><th>Equipment</th><th>OID prefix</th><th>Seen</th><th>Last</th><th>Example</th></tr></thead><tbody>${m.map((x) => `<tr><td>${esc(x.vendor || 'unknown')}</td><td><code>${esc(x.prefix)}</code></td><td>${n(x.count)}</td><td>${ago((Date.now() - x.last) / 1000)}</td><td><code>${esc(x.sample)}</code></td></tr>`).join('')}</tbody></table></div>
      ${d.canManage ? '<div class="toolbar"><button data-act="clearmissing">Clear this list</button></div>' : ''}` : '<p class="muted">Nothing is missing: every trap received so far could be named.</p>'}</div>`;
  };
  // ---- MIB assistant: why is a trap not named, and which file is missing ----
  const STATE = { 'no-vendor-mib': ['No vendor MIB', 'bad'], 'other-oid': ['Other OID in MIB', 'warn'], 'not-defined': ['Not in the MIBs', 'warn'], standard: ['Std MIB missing', 'warn'], resolved: ['Named now', 'ok'] };
  const needFiles = () => (d.mibs || []).filter((f) => f.missing && f.missing.length);
  const assistantText = () => {
    const u = (d.status.unknownTraps || []).filter((x) => x.state !== 'resolved'), nf = needFiles();
    return ['NetEventPro MIB assistant report', '', ...u.map((x) => `${x.oid}  seen ${x.count}x  from ${(x.ips || []).join(', ') || '-'}\n  ${(STATE[x.state] || [x.state])[0]}: ${x.advice || ''}${x.candidates ? '\n  candidates: ' + x.candidates.map((c) => c.name + ' (' + c.oid + ')').join('; ') : ''}\n  example: ${x.sample || ''}`), ...(nf.length ? ['', 'MIB files that need other MIBs:', ...nf.map((f) => `  ${f.name} needs ${f.missing.join(', ')}`)] : [])].join('\n');
  };
  const assistantPanel = () => {
    const u = d.status.unknownTraps || [], nf = needFiles();
    const rows = u.map((x) => { const st = STATE[x.state] || [x.state, 'warn'];
      return `<tr><td>${(x.ips || []).map((i) => esc(i)).join('<br>') || '<span class="muted">-</span>'}</td><td><code>${esc(x.oid)}</code><div class="muted" style="font-size:11.5px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(x.sample || '')}">${esc(x.sample || '')}</div></td><td>${n(x.count)}</td><td>${ago((Date.now() - x.last) / 1000)}</td>
      <td><span class="pill ${st[1]}" style="white-space:nowrap">${esc(st[0])}</span>${x.vendor ? `<div class="muted">${esc(x.vendor)}</div>` : ''}</td>
      <td style="min-width:300px">${x.state === 'resolved' ? `Now named <b>${esc(x.name)}</b>${x.file ? ` (${esc(x.file)})` : ''}. New traps show by name; the ones already received keep their old text.` : esc(x.advice || '')}${(x.candidates || []).length ? `<div class="muted">Look at: ${x.candidates.map((c) => `<code>${esc(c.name)}</code> in ${esc(c.file || 'built-in')}`).join(' · ')}</div>` : ''}</td>
      <td><button data-act="asklookup" data-oid="${esc(x.oid)}">Look up</button></td></tr>`; }).join('');
    return `<div class="panel" style="grid-column:1/-1"><h2>MIB assistant</h2>
      <p class="muted">Every trap whose own OID no loaded MIB defines is listed here with the reason and what to do. Upload the missing MIB with <b>Upload MIB files…</b> in the MIB files panel below; the list then updates by itself (a trap shows “Named now”).</p>
      ${u.length ? `<div style="overflow-x:auto"><table class="data"><thead><tr><th>From</th><th>Trap OID</th><th>Seen</th><th>Last</th><th>Problem</th><th>What to do</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">No unknown traps so far: every trap received could be matched to a MIB definition.</p>'}
      ${nf.length ? `<h3 style="margin:14px 0 6px;font-size:14px">MIB files that need other MIBs</h3><p class="muted">These files are loaded, but they import MIBs that are not loaded, so some of their names stay unresolved. Get each missing module from the same vendor download and upload it (any order).</p>
      <div style="overflow-x:auto"><table class="data"><thead><tr><th>File</th><th>Vendor</th><th>Missing MIB modules</th></tr></thead><tbody>${nf.map((f) => `<tr><td><b>${esc(f.name)}</b></td><td>${esc(f.vendor || '')}</td><td>${f.missing.map((m) => `<code>${esc(m)}</code>`).join(', ')}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="toolbar"><button data-act="copyassist">Copy report</button>${d.canManage && u.length ? '<button data-act="clearmissing">Clear this list</button>' : ''}</div></div>`;
  };
  const filesPanel = () => {
    const vend = {}; for (const f of d.mibs) { const v = f.vendor || 'unknown'; vend[v] = (vend[v] || 0) + 1; }
    const top = Object.entries(vend).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `${esc(k)} <b>${v}</b>`).join(' · ');
    return `<div class="panel"><h2>MIB files</h2>
    <p class="muted">Built in: SNMPv2-MIB and IF-MIB (standard traps such as linkDown, linkUp, coldStart). Add the MIBs of your equipment (Cisco, Dell, HP, APC PowerNet, Eltek, Spectracom …). A MIB that imports another one resolves once the other is uploaded, in any order.</p>
    <div class="toolbar"><button class="primary" data-act="mibmgr">${d.canManage ? 'Upload MIB files…' : 'Show MIB files…'}</button><span class="muted">${d.mibs.length} file${d.mibs.length === 1 ? '' : 's'} · ${d.mibs.filter((f) => !f.missing.length && !f.unresolved).length} complete</span></div>
    ${top ? `<p class="muted" style="margin:6px 0 0">${top}</p>` : '<p class="muted">No MIB files uploaded yet.</p>'}
    <p class="muted">Names known: ${n(d.stats.nodes)}${d.stats.unresolved ? ` · ${n(d.stats.unresolved)} waiting for the MIB they build on` : ''}</p></div>`;
  };
  // ---- the MIB manager window: upload, filter by name or vendor, scroll through any number of files ----
  let mgr = null;
  const mgrRows = () => {
    const q = (mgr.q || '').toLowerCase(), v = mgr.vendor || '';
    const list = d.mibs.filter((f) => (!q || (f.name + ' ' + f.modules.join(' ') + ' ' + (f.vendor || '')).toLowerCase().includes(q)) && (!v || (f.vendor || 'unknown') === v));
    const dir = mgr.dir === 'desc' ? -1 : 1, key = mgr.sort || 'name';
    list.sort((x, y) => { const a = key === 'objects' || key === 'traps' ? x[key] - y[key] : String(key === 'vendor' ? x.vendor || '~' : key === 'module' ? x.modules[0] || '' : x.name).toLowerCase().localeCompare(String(key === 'vendor' ? y.vendor || '~' : key === 'module' ? y.modules[0] || '' : y.name).toLowerCase()); return a * dir; });
    return { list, html: list.map((f) => `<tr><td><b>${esc(f.name)}</b></td><td>${f.vendor ? esc(f.vendor) : '<span class="muted">unknown</span>'}</td><td>${esc(f.modules.join(', '))}</td><td class="num-r">${n(f.objects)}</td><td class="num-r">${n(f.traps)}</td>
      <td>${f.missing.length ? `<span class="pill warn">needs ${esc(f.missing.join(', '))}</span> ` : ''}${f.unresolved ? `<span class="pill warn">${n(f.unresolved)} not numbered yet</span>` : (f.missing.length ? '' : '<span class="pill ok">OK</span>')}</td>
      <td style="white-space:nowrap"><a href="/api/mibs/file?name=${encodeURIComponent(f.name)}" download>Download</a>${d.canManage ? ` · <a href="#" class="danger-link" data-del="${esc(f.name)}">Remove</a>` : ''}</td></tr>`).join('') };
  };
  const mgrDraw = () => {
    if (!mgr) return; const sc = mgr.dlg.back.querySelector('.modal-scroll'), top = sc ? sc.scrollTop : 0, r = mgrRows();
    const vendors = [...new Set(d.mibs.map((f) => f.vendor || 'unknown'))].sort((x, y) => x.localeCompare(y));
    mgr.dlg.back.querySelector('#mgrVendor').innerHTML = `<option value="">All vendors (${d.mibs.length})</option>` + vendors.map((x) => `<option value="${esc(x)}" ${mgr.vendor === x ? 'selected' : ''}>${esc(x)} (${d.mibs.filter((f) => (f.vendor || 'unknown') === x).length})</option>`).join('');
    mgr.dlg.back.querySelector('#mgrCount').textContent = `${r.list.length} of ${d.mibs.length} files`;
    mgr.dlg.back.querySelector('#mgrBody').innerHTML = r.html || '<tr><td colspan="7" class="muted">No MIB files match.</td></tr>';
    mgr.dlg.back.querySelectorAll('th[data-sort]').forEach((th) => { th.dataset.on = th.dataset.sort === (mgr.sort || 'name') ? (mgr.dir === 'desc' ? '▼' : '▲') : ''; });
    if (sc) sc.scrollTop = top;
  };
  const openManager = () => {
    mgr = { q: '', vendor: '', sort: 'name', dir: 'asc' };
    const dlg = dialog('MIB files', `<div class="toolbar" style="margin:0 0 8px">${d.canManage ? '<input type="file" id="mgrFiles" multiple accept=".mib,.my,.txt,.smi,.xml,text/plain" hidden><button class="primary" id="mgrPick">Upload MIB files…</button>' : ''}<input type="search" id="mgrQ" placeholder="Filter by file, module or vendor" style="width:260px;max-width:100%"><select id="mgrVendor" aria-label="Vendor"></select><span class="muted" id="mgrCount"></span><span class="spacer"></span><button id="mgrClose">Close</button></div>
      <div class="muted" id="mgrMsg" style="margin-bottom:6px">${d.canManage ? 'Pick one or many .mib files at once, in any order. The vendor is read from each MIB.' : ''}</div>
      <div class="modal-scroll mgrscroll"><table class="data compact mgrtable"><thead><tr><th data-sort="name">File</th><th data-sort="vendor">Vendor</th><th data-sort="module">Module</th><th class="num-r" data-sort="objects">Objects</th><th class="num-r" data-sort="traps">Traps</th><th>Status</th><th></th></tr></thead><tbody id="mgrBody"></tbody></table></div>`, true);
    dlg.back.querySelector('.modal').classList.add('xwide'); mgr.dlg = dlg; const b = dlg.back;
    const close = dlg.close; dlg.close = () => { mgr = null; close(); }; b.querySelector('#mgrClose').onclick = dlg.close;
    b.addEventListener('mousedown', (e) => { if (e.target === b) mgr = null; }); b.addEventListener('keydown', (e) => { if (e.key === 'Escape') mgr = null; });
    b.querySelector('#mgrQ').addEventListener('input', (e) => { mgr.q = e.target.value; mgrDraw(); });
    b.querySelector('#mgrVendor').addEventListener('change', (e) => { mgr.vendor = e.target.value; mgrDraw(); });
    b.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => { const k = th.dataset.sort; if ((mgr.sort || 'name') === k) mgr.dir = mgr.dir === 'asc' ? 'desc' : 'asc'; else { mgr.sort = k; mgr.dir = 'asc'; } mgrDraw(); }));
    b.querySelector('#mgrPick')?.addEventListener('click', () => b.querySelector('#mgrFiles').click());
    b.querySelector('#mgrFiles')?.addEventListener('change', (e) => { if (e.target.files.length) upload([...e.target.files], b.querySelector('#mgrMsg')); });
    b.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-del]'); if (!a) return; e.preventDefault(); const name = a.dataset.del;
      if (!(await askConfirm(`Remove the MIB file “${name}”? Traps that use it will show numbers again.`, 'Remove'))) return;
      try { await api('/api/mibs/delete', { method: 'POST', body: { name } }); toast('MIB file removed'); d = await api('/api/snmp'); draw(); mgrDraw(); } catch (err) { toast(err.message, true); }
    });
    mgrDraw(); b.querySelector('#mgrQ').focus();
  };
  const sendersPanel = () => {
    const a = d.status.senders || [];
    return `<div class="panel"><h2>Devices sending traps</h2>${a.length ? `<div style="overflow-x:auto"><table class="data"><thead><tr><th>Device</th><th class="num-r">Traps</th><th>v1 / v2c</th><th>Informs</th><th>Not named</th><th>Last trap</th><th>When</th></tr></thead><tbody>${a.map((x) => `<tr><td><a href="#traps" data-host="${esc(x.ip)}">${esc(x.ip)}</a></td><td class="num-r">${n(x.count)}</td><td>${n(x.v1)} / ${n(x.v2c)}</td><td>${n(x.informs)}</td><td>${x.unnamed ? `<span class="pill warn" title="Traps with numbers that no MIB could name">${n(x.unnamed)}</span>` : '0'}</td><td><code>${esc(x.lastTrap)}</code></td><td class="muted">${ago((Date.now() - x.last) / 1000)}</td></tr>`).join('')}</tbody></table></div><p class="muted">Counted since the service started. “Not named” traps need that vendor's MIB file.</p>` : '<p class="muted">No device has sent a trap since the service started.</p>'}</div>`;
  };
  const catalogPanel = () => `<div class="panel"><h2>Trap catalogue</h2><p class="muted">Every trap defined by the MIB files above. Search by name, number or module, then make a rule for it.</p>
    <div class="toolbar"><input type="search" id="catQ" placeholder="Search, e.g. battery, linkDown, 1.3.6.1.4.1.318" style="flex:1;min-width:220px;max-width:480px"><button data-act="catalog">Search</button></div><div id="catOut" style="overflow-x:auto"></div></div>`;
  const toolsPanel = () => d.canManage ? `<div class="panel"><h2>Check the receiver</h2><p class="muted">Sends one test linkDown trap to this receiver from this computer. Use it to see the full path work: port, filters, MIB names, severity, rules and alarms.</p><div class="toolbar"><select id="testVer" aria-label="Version"><option value="v2c">SNMP v2c</option><option value="v3">SNMP v3 (uses the first user below)</option></select><button class="primary" data-act="test">Send a test trap</button><span class="muted" id="testMsg"></span></div></div>` : '';
  const lookupPanel = () => `<div class="panel"><h2>Look up an OID or name</h2>
    <div class="toolbar"><input type="text" id="oidQ" placeholder="1.3.6.1.4.1.318.0.5  or  upsOnBattery  or  IF-MIB::ifOperStatus.3" style="flex:1;min-width:240px;max-width:560px"><button data-act="lookup">Look up</button></div><div id="oidOut"></div></div>`;
  const v3Row = (u, i) => {
    const o = (list, cur) => list.map((x) => `<option ${cur === x ? 'selected' : ''}>${x}</option>`).join('');
    return `<tr data-i="${i}"><td><input type="text" class="w-sm" data-v="name" value="${esc(u.name)}" autocomplete="off"></td><td><select data-v="level"><option value="authPriv" ${u.level === 'authPriv' ? 'selected' : ''}>auth + encryption</option><option value="authNoPriv" ${u.level === 'authNoPriv' ? 'selected' : ''}>auth only</option><option value="noAuthNoPriv" ${u.level === 'noAuthNoPriv' ? 'selected' : ''}>none</option></select></td><td><select data-v="authProto">${o(['SHA', 'MD5', 'SHA224', 'SHA256', 'SHA384', 'SHA512'], u.authProto)}</select></td><td><input type="password" class="w-sm" data-v="authPass" value="${esc(u.authPass)}" autocomplete="new-password"></td><td><select data-v="privProto">${o(['AES128', 'AES192', 'AES256', 'DES'], u.privProto)}</select></td><td><input type="password" class="w-sm" data-v="privPass" value="${esc(u.privPass)}" autocomplete="new-password"></td><td><button class="danger" data-act="v3del">Remove</button></td></tr>`;
  };
  const settingsPanel = () => {
    if (!d.canManage) return '';
    const c = d.config;
    return `<div class="panel snmpset"><h2>Receiver settings</h2>
      <div class="row"><span class="k">Receive traps</span><label class="chk"><input type="checkbox" id="snEnabled" ${c.enabled ? 'checked' : ''}> on UDP port</label> <input type="number" id="snPort" class="w-sm" min="1" max="65535" value="${c.port}"> <span class="muted">standard is 162</span></div>
      <div class="row"><span class="k">Listen on address</span><input type="text" id="snBind" class="w-sm" value="${esc(c.bind)}"></div>
      <div class="row"><span class="k">Community names</span><textarea id="snComm" rows="3" style="width:100%;max-width:360px" placeholder="empty = accept any community; one name per line">${esc((c.communities || []).join('\n'))}</textarea></div>
      <div class="row"><span class="k"></span><span class="muted">SNMP v1/v2c send the community name unencrypted, so it is only a weak filter. “Accept syslog only from” in Settings also limits which devices may send traps.</span></div>
      <div class="row"><span class="k">Informs</span><label class="chk"><input type="checkbox" id="snAck" ${c.informAck !== false ? 'checked' : ''}> Reply to informs (the sender stops repeating them)</label></div>
      <div class="row"><span class="k">SNMPv3 users</span><div style="flex:1">
        <div class="muted" style="margin-bottom:6px;max-width:760px">SNMPv3 traps are checked and decrypted with these users (create the same user, protocols and passwords on the device). For <b>traps</b> the device needs no setting for this computer; for <b>informs</b> give the device this computer's engine ID: <code>${esc(d.engineId || '')}</code>. Passwords must be 8 to 100 characters.</div>
        <table class="data"><thead><tr><th>User</th><th>Security</th><th>Authentication</th><th>Password</th><th>Encryption</th><th>Password</th><th></th></tr></thead><tbody id="v3Rows">${(v3Local || c.v3Users || []).map((u, i) => v3Row(u, i)).join('')}</tbody></table>
        <div class="toolbar" style="margin-top:6px"><button data-act="v3add">Add SNMPv3 user</button></div></div></div>
      <div class="row"><span class="k">Unknown severity</span><select id="snDef">${SEVORD.map((i) => `<option value="${i}" ${c.defaultSeverity === i ? 'selected' : ''}>${sevOpt(i)}</option>`).join('')}</select> <span class="muted">used when the trap name does not say (“…Failure” → error, “…Restored” → notice, “…High” → warning are chosen automatically)</span></div>
      <div class="row"><span class="k">Severity rules</span><textarea id="snRules" rows="4" style="width:100%;max-width:520px" placeholder="upsOnBattery = critical&#10;1.3.6.1.4.1.318.0.5 = 2">${esc(sevRulesText(c.severityRules))}</textarea></div>
      <div class="row"><span class="k">Severity from a value</span><textarea id="snVal" rows="4" style="width:100%;max-width:520px" placeholder="alarmSeverity: critical=critical, major=error, minor=warning, cleared=notice&#10;alertGroup.1.3 @ 1.3.6.1.4.1.674: 5=critical, 4=warning, 3=notice&#10;status @ eltek: 5=notice, 1=critical" title="Some traps carry their own severity. Say which value it is and what each value means here.">${esc(valRulesText(c.valueSeverity))}</textarea><div class="hint" style="max-width:520px">For traps that carry their own severity. One line per value name, then <code>value=severity</code> pairs. The value can be the word (<code>major</code>) or the number (<code>3</code>, <code>5</code>). When the same number means something else for another vendor, add <code>@ trap name, vendor OID or /regex/</code> after the value name to limit the line to those traps (put the specific lines first). It sets the Severity column, row colour, rules and alarms of that trap.</div></div>
      <div class="toolbar"><button class="primary" data-act="save">Save</button></div></div>`;
  };
  const saveReceiver = async () => {
    busy = true;
        const snmp = { enabled: $('#snEnabled').checked, port: +$('#snPort').value, bind: $('#snBind').value.trim(), communities: $('#snComm').value, informAck: $('#snAck').checked, defaultSeverity: +$('#snDef').value, severityRules: parseRules($('#snRules').value), valueSeverity: parseValRules($('#snVal').value), v3Users: v3Read() };
        v3Local = null; dirty = false;
        await api('/api/config', { method: 'PUT', body: { snmp } }); toast('SNMP settings saved'); await new Promise((r) => setTimeout(r, 400)); d = await api('/api/snmp'); draw();
    busy = false;
  };
  el._saveIfDirty = async () => { if (dirty) await saveReceiver(); };
  const draw = () => {
    if (!d) return;
    const cat = $('#catOut', el)?.innerHTML || '', cq = $('#catQ', el)?.value || '';
    const keepSet = dirty ? el.querySelector('.snmpset') : null;      // settings being edited are never redrawn by the 5-second refresh
    el.innerHTML = `${embedded ? '' : '<div class="page-head"><h1>SNMP &amp; MIBs</h1></div>'}
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">${statusPanel()}${missingPanel()}${assistantPanel()}</div>
      <div class="grid" style="margin-top:14px">${filesPanel()}${sendersPanel()}${toolsPanel()}${lookupPanel()}${catalogPanel()}${settingsPanel()}</div>`;
    if (cat) { $('#catOut', el).innerHTML = cat; $('#catQ', el).value = cq; }
    if (keepSet) { const n = el.querySelector('.snmpset'); if (n) n.replaceWith(keepSet); }
  };
  el.addEventListener('input', (e) => { if (e.target.closest?.('.snmpset')) dirty = true; });
  el.addEventListener('change', (e) => { if (e.target.closest?.('.snmpset')) dirty = true; });
  let mibVer = -1;
  const load = async () => { d = await api('/api/snmp'); if (d.stats.version !== mibVer) { mibVer = d.stats.version; mgrDraw(); } if (!el.contains(document.activeElement) || document.activeElement === document.body) draw(); else { /* keep what the user is typing */ el.querySelector('.grid')?.firstElementChild && (el.querySelector('.grid').innerHTML = statusPanel() + missingPanel()); } };

  const upload = async (files, msgEl) => {
    const msg = msgEl || $('#mibMsg'); const out = [];
    for (const f of files) {
      if (msg) msg.textContent = `Uploading ${f.name} …`;
      try {
        const text = await f.text(); const r = await api('/api/mibs', { method: 'POST', body: { name: f.name.replace(/[^A-Za-z0-9._-]/g, '_'), text } });
        out.push(`${r.file.name}: ${r.file.objects} objects, ${r.file.traps} traps${r.file.missing.length ? ` — also upload ${r.file.missing.join(', ')}` : ''}`);
      } catch (e) { out.push(`${f.name}: ${e.message}`); toast(`${f.name}: ${e.message}`, true); }
    }
    d = await api('/api/snmp'); draw(); mgrDraw(); const m2 = msgEl || $('#mibMsg'); if (m2) m2.textContent = out.join(' · ');
  };
  el.addEventListener('input', (e) => { if (e.target.id !== 'mibQ') return; mibFilter = e.target.value.trim(); const q = mibFilter.toLowerCase(); el.querySelectorAll('#mibTable tbody tr').forEach((tr) => { tr.hidden = !!q && !tr.dataset.q.includes(q); }); });
  el.addEventListener('change', (e) => { if (e.target.id === 'mibFiles' && e.target.files.length) upload([...e.target.files]); });
  el.addEventListener('keydown', (e) => { if (e.target.id === 'catQ' && e.key === 'Enter') el.querySelector('[data-act="catalog"]').click(); if (e.target.id === 'oidQ' && e.key === 'Enter') el.querySelector('[data-act="lookup"]').click(); });
  el.addEventListener('click', async (e) => {
    const hl = e.target.closest('a[data-host]'); if (hl) { sessionStorage.setItem('sp.search', JSON.stringify({ host: hl.dataset.host })); }
    const t = e.target.closest('[data-act]'); if (!t || busy) return; if (t.tagName === 'A') e.preventDefault(); const act = t.dataset.act;
    try {
      if (act === 'mibmgr') openManager();
      else if (act === 'pick') $('#mibFiles').click();
      else if (act === 'del') { if (await askConfirm(`Remove the MIB file “${t.dataset.name}”? Traps that use it will show numbers again.`, 'Remove')) { await api('/api/mibs/delete', { method: 'POST', body: { name: t.dataset.name } }); toast('MIB file removed'); d = await api('/api/snmp'); draw(); } }
      else if (act === 'test') { const r = await api('/api/snmp/test', { method: 'POST', body: { version: $('#testVer')?.value === 'v3' ? 'v3' : 'v2c' } }); const m = $('#testMsg'); if (m) m.textContent = r.note; setTimeout(async () => { d = await api('/api/snmp'); draw(); }, 1200); }
      else if (act === 'catalog') { const r = await api('/api/mibs/traps?q=' + encodeURIComponent($('#catQ').value.trim())); $('#catOut').innerHTML = r.traps.length ? `<table class="data"><thead><tr><th>Trap</th><th>Module</th><th>Number</th><th>Carries</th><th></th></tr></thead><tbody>${r.traps.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td class="muted">${esc(x.module)}</td><td><code>${esc(x.oid)}</code></td><td class="muted" style="white-space:normal">${esc(x.objects.join(', ')) || '—'}</td><td style="white-space:nowrap"><button data-act="mkrule" data-name="${esc(x.name)}">Make a rule</button> <button data-act="mkview" data-name="${esc(x.name)}" data-vals="${esc(x.objects.join(','))}">Column view</button></td></tr>`).join('')}</tbody></table><p class="muted">${r.total > r.traps.length ? `Showing ${r.traps.length} of ${n(r.total)}. Narrow the search.` : `${n(r.total)} trap(s).`}</p>` : '<p class="muted">No trap matches.</p>'; }
      else if (act === 'mkrule') { sessionStorage.setItem('sp.ruleSeed', JSON.stringify({ host: '', source: 'snmp', trap: t.dataset.name, text: '' })); location.hash = '#rules'; }
      else if (act === 'mkview') { trapViewDialog({ id: '', name: t.dataset.name, match: t.dataset.name, cols: t.dataset.vals.split(',').filter(Boolean).slice(0, 8).map((v) => ({ label: v, field: v })), message: false }, async (v) => { v.id = 'tv' + Date.now().toString(36); const mk = v.makeDefault; delete v.makeDefault; await saveTrapViews([...(S.prefs.trapViews || []), v], mk ? v.id : undefined); S.trapView = v.id; toast('Trap view saved — open the Traps page to see it'); }); }
      else if (act === 'v3add') { dirty = true; $('#v3Rows', el).insertAdjacentHTML('beforeend', v3Row({ name: '', level: 'authPriv', authProto: 'SHA', authPass: '', privProto: 'AES128', privPass: '' }, 0)); }
      else if (act === 'v3del') { dirty = true; t.closest('tr').remove(); }
      else if (act === 'asklookup') { const q = $('#oidQ'); if (q) { q.value = t.dataset.oid; el.querySelector('[data-act="lookup"]')?.click(); q.scrollIntoView({ block: 'center' }); } }
      else if (act === 'copyassist') { try { await navigator.clipboard.writeText(assistantText()); toast('Report copied'); } catch { toast('Could not copy; select the table and copy it', true); } }
      else if (act === 'clearmissing') { await api('/api/snmp/reset-missing', { method: 'POST', body: {} }); d = await api('/api/snmp'); draw(); }
      else if (act === 'lookup') {
        const q = $('#oidQ').value.trim(); if (!q) return;
        const r = (await api('/api/mibs/lookup?q=' + encodeURIComponent(q))).result, out = $('#oidOut');
        out.innerHTML = !r ? '<p class="muted">Not a valid OID or name.</p>' : `<table class="data"><tbody><tr><td>OID</td><td><code>${esc(r.oid)}</code></td></tr><tr><td>Name</td><td>${r.name ? esc(r.name) + (r.exact ? '' : ' <span class="muted">(closest known object plus index)</span>') : '<span class="muted">not in any loaded MIB</span>'}</td></tr>
          ${r.kind ? `<tr><td>Kind</td><td>${esc(r.kind)}${r.syntax ? ' · ' + esc(r.syntax) : ''}</td></tr>` : ''}${r.enums ? `<tr><td>Values</td><td>${Object.entries(r.enums).map(([k, v]) => `${esc(v)}(${esc(k)})`).join(', ')}</td></tr>` : ''}
          ${r.objects.length ? `<tr><td>Carries</td><td>${r.objects.map(esc).join(', ')}</td></tr>` : ''}${r.file ? `<tr><td>File</td><td>${esc(r.file)}</td></tr>` : ''}</tbody></table>`;
      } else if (act === 'save') { busy = true; await saveReceiver(); }
    } catch (err) { toast(err.message, true); } finally { busy = false; }
  });
  load().catch((e) => { el.innerHTML = `<div class="empty"><b>Could not load SNMP</b>${esc(e.message)}</div>`; });
  timer = setInterval(() => { if (!document.hidden && !busy) load().catch(() => {}); }, 5000);
  return () => clearInterval(timer);
};

// ---------- SNMP trap column views (Settings → Trap column views) ---------------------------------------------------------------
// Every vendor's traps carry different values, so a view says: "for this trap (name, OID prefix or /regex/) show these columns".
// A column is either one value (ifDescr) or a recipe that joins several: {alarmSource} - {alarmText} {alarmAdditionalText}
const RECIPE_HELP = 'Type one value name, or join several values with curly brackets, e.g. <code>{alarmSource} - {alarmText} {alarmAdditionalText}</code>. <code>{a|b}</code> takes the first that is not empty, <code>{alarmSeverity:name}</code> removes the number from <code>major(3)</code>. Also available: <code>{agent}</code> <code>{source}</code> <code>{trap}</code> <code>{oid}</code> <code>{host}</code> <code>{values}</code> (all values), and the message fields <code>{number}</code> <code>{date}</code> <code>{time}</code> <code>{devtime}</code> <code>{severity}</code> <code>{message}</code> <code>{app}</code> <code>{pid}</code> <code>{mib}</code> (the MIB file the trap comes from). <b>Lookup</b>: turns a value into the words you want, e.g. <code>5=Critical; 4=Major; 3=Minor; *=Unknown</code> (the number or the word of the value; <code>*</code> = anything else). <b>One column for every vendor</b>: take the first value that exists, <code>{alertGroup.1.3.0|alarmSeverity|severity}</code>, and give the lookup one line per vendor, each starting with <code>@ vendor OID or trap name:</code>, e.g. <code>@ 1.3.6.1.4.1.674: 5=Critical; 4=Warning</code> then <code>@ 1.3.6.1.4.1.12148: 5=Clear</code>. A line without @ is used for all other traps.';
const STD_LAYOUT = [
  ['Msg Number', '{number}'], ['Date', '{date}'], ['Time', '{time}'], ['Device', '{source}'], ['Agent IP', '{agent}'], ['SNMP version', '{version}'], ['Host', '{host}'], ['Severity', '{severity}'], ['Message', '{message}'], ['PID', '{pid}'],
  ['Service tag / device number', '{serviceTag|systemServiceTag|deviceNumber|alarmSource}'], ['Alarm group', '{alertGroup|alarmGroup|alertFQDD}'], ['Alarm category', '{alertCategory|alarmCategory|alarmType}'], ['MIB', '{mib}']].map(([label, field]) => (label === 'Severity' ? { label, field, sev: true } : { label, field }));
const TRAP_VIEW_EXAMPLES = [
  { name: 'Standard trap table (Msg number, date, time, device, agent IP, host, severity, message, PID, group, category, MIB)', match: '', message: false, std: false, cols: STD_LAYOUT },
  { name: 'DNWP Connection Master alarms', match: '/nsnTrapAlarm/', message: false, cols: [
    { label: 'Alarm', field: '{alarmSource} - {alarmText} {alarmAdditionalText}' }, { label: 'Alarm severity', field: '{alarmSeverity:name}' }, { label: 'Event time', field: '{alarmEventTime}' },
    { label: 'Alarm ID', field: '{alarmId}' }, { label: 'Agent', field: '{agent}' }] },
  { name: 'Any vendor: trap, text and all values', match: '', message: false, cols: [
    { label: 'Trap', field: '{trap|oid}' }, { label: 'Alarm text', field: '{alarmText|upsAdvTrapText|sysDescr|ifDescr|values}' }, { label: 'Alarm severity', field: '{alarmSeverity:name|severity}' }, { label: 'Agent', field: '{agent}' }] }
];
async function trapViewDialog(view, done) {
  const v = structuredClone(view || { id: '', name: '', match: '', cols: [], message: false, std: false });
  const d = dialog(view ? 'Change trap view' : 'New trap view', `<div class="form">
    <div class="field"><label for="tvName">Name</label><div><input type="text" id="tvName" class="w-md" maxlength="60" value="${esc(v.name)}" placeholder="e.g. APC UPS alarms"></div></div>
    <div class="field"><label for="tvMatch">Which traps</label><div><input type="text" id="tvMatch" class="w-md" maxlength="200" value="${esc(v.match)}" placeholder="trap name, or 1.3.6.1.4.1.318 for a whole vendor, or /regex/"><div class="hint">Empty = every trap. A vendor number (1.3.6.1.4.1.…) covers all traps of that vendor.</div></div></div>
    <div class="field"><label>Columns</label><div><div id="tvCols"></div><div class="toolbar" style="margin:6px 0"><button type="button" id="tvAdd">Add column</button><button type="button" id="tvStdFill" title="Fill the list with message number, date, time, device, agent IP, host, severity, message, PID and the optional columns">Start from the standard table</button></div>
      <div class="hint" style="max-width:640px">${RECIPE_HELP}</div>
      <div class="muted" id="tvKnownHead" style="margin-top:8px"></div><div id="tvKnown" class="chips"></div></div></div>
    <div class="field"><label></label><div><label class="chk"><input type="checkbox" id="tvStd" ${v.std !== false ? 'checked' : ''}> Also show the standard Date, Time, Device and Severity columns first (untick to show only the columns above)</label><br><label class="chk"><input type="checkbox" id="tvMsg" ${v.message ? 'checked' : ''}> Also show the full message as the last column</label><br><label class="chk"><input type="checkbox" id="tvDef" ${S.prefs.trapViewDefault && S.prefs.trapViewDefault === v.id ? 'checked' : ''}> Open the Traps page with this view</label></div></div>
    <div class="toolbar" style="margin:12px 0 0"><span class="spacer"></span><button id="tvCancel">Cancel</button><button class="primary" id="tvSave">Save view</button></div></div>`, true);
  const known = new Map(); let samples = [], focus = -1;        // value name -> example; recent traps of this kind (for the preview)
  const preview = (c) => { const row = samples[0]; if (!row || !String(c.field).trim()) return ''; const t = cellOf(row, c); return t ? esc(t) : '<span class="muted">(empty for the latest trap)</span>'; };
  const drawCols = () => {
    d.$('#tvCols').innerHTML = v.cols.map((c, i) => `<div style="margin:0 0 8px" data-i="${i}"><div class="toolbar" style="margin:0 0 2px"><input type="text" class="w-sm" data-f="label" placeholder="Column title" maxlength="40" value="${esc(c.label)}"><textarea rows="1" style="width:340px;max-width:100%;min-height:34px;resize:both;overflow:auto;font-family:inherit" data-f="field" placeholder="value name, or {a} - {b} to join values" maxlength="400" title="Drag the corner to make the box bigger">${esc(c.field)}</textarea><label class="chk" style="font-size:12px" title="Tick this on your Severity column: the trap then takes its severity from this column (after the lookup), so alarms, rules, filters, colours and emails all follow it. The words used: critical, major, minor, warning, cleared, notice, info …"><input type="checkbox" data-f="sev" ${c.sev ? 'checked' : ''}> This column is the severity</label><textarea rows="2" style="width:340px;max-width:100%" data-f="map" placeholder="Lookup: 5=Critical; 4=Major; *=Unknown&#10;@ 1.3.6.1.4.1.674: 5=Critical; 4=Major   (only for these traps)&#10;@ 1.3.6.1.4.1.12148: 0,2,3,8=Critical; 1=Cleared   (several values, one entry)" title="Optional. Turns the value into the words you want. One line per vendor: start a line with @ and a trap name, vendor OID or /regex/ to use it only for those traps. Separate entries with ;" maxlength="6000">${esc(c.map || '')}</textarea>
      <button data-mv="-1" ${i ? '' : 'disabled'} aria-label="Move up">↑</button><button data-mv="1" ${i < v.cols.length - 1 ? '' : 'disabled'} aria-label="Move down">↓</button><button data-del class="danger" aria-label="Remove column">✕</button></div><div class="muted tvprev" style="margin-left:2px;font-size:12px">${samples.length ? 'Latest trap: ' + preview(c) : ''}</div></div>`).join('') || '<div class="muted">No columns yet — click a value below or “Add column”.</div>';
  };
  const drawKnown = () => {
    d.$('#tvKnownHead').textContent = known.size ? 'Values seen in recent traps of this kind (click to add as a column, or to insert into the box you are typing in):' : 'No recent traps match yet, so no value names can be suggested. Type the value names yourself, or send a test trap and reopen this window.';
    d.$('#tvKnown').innerHTML = [...known].map(([n, ex]) => `<button class="chip" data-k="${esc(n)}" title="e.g. ${esc(ex)}">${esc(n)}</button>`).join('');
  };
  const loadKnown = async () => {
    known.clear(); samples = [];
    try {
      const m = d.$('#tvMatch').value.trim(), p = new URLSearchParams({ source: 'snmp', limit: 60 }); if (m && !/^\/.+\/[a-z]*$/.test(m)) p.set('trap', m);
      const r = await api('/api/logs?' + p);
      for (const row of r.rows) { if (m && /^\/.+\/[a-z]*$/.test(m) && !trapMatches(row, m)) continue; samples.push(row); for (const [n, , val] of vbOf(row)?.v || []) { const base = String(n).split('.')[0]; if (!known.has(base)) known.set(base, val); } }
    } catch { /* suggestions are optional */ }
    drawKnown(); const act = document.activeElement; if (!act || !d.$('#tvCols').contains(act)) drawCols(); else d.$$('.tvprev').forEach((el, i) => { el.innerHTML = samples.length ? 'Latest trap: ' + preview(v.cols[i]) : ''; });
  };
  drawCols(); loadKnown();
  let t; d.$('#tvMatch').addEventListener('input', () => { clearTimeout(t); t = setTimeout(loadKnown, 400); });
  d.$('#tvCols').addEventListener('focusin', (e) => { const r = e.target.closest('[data-i]'); if (r && e.target.dataset.f === 'field') focus = +r.dataset.i; });
  d.$('#tvCols').addEventListener('input', (e) => { const r = e.target.closest('[data-i]'); const i = +r.dataset.i; if (e.target.dataset.f === 'sev') { v.cols.forEach((x) => { delete x.sev; }); if (e.target.checked) v.cols[i].sev = true; drawCols(); return; } v.cols[i][e.target.dataset.f] = e.target.value; if (e.target.dataset.f === 'field' || e.target.dataset.f === 'map') r.querySelector('.tvprev').innerHTML = samples.length ? 'Latest trap: ' + preview(v.cols[i]) : ''; });
  d.$('#tvCols').addEventListener('click', (e) => {
    const row = e.target.closest('[data-i]'); if (!row) return; const i = +row.dataset.i;
    if (e.target.closest('[data-del]')) { v.cols.splice(i, 1); focus = -1; } else if (e.target.dataset.mv) { const j = i + +e.target.dataset.mv; [v.cols[i], v.cols[j]] = [v.cols[j], v.cols[i]]; } else return; drawCols();
  });
  d.$('#tvAdd').onclick = () => { if (v.cols.length >= 24) return toast('At most 24 columns.', true); v.cols.push({ label: '', field: '' }); focus = v.cols.length - 1; drawCols(); d.$(`#tvCols [data-i="${focus}"] [data-f="label"]`)?.focus(); };
  d.$('#tvKnown').addEventListener('click', (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k; if (!k) return;
    if (focus >= 0 && v.cols[focus]) { const c = v.cols[focus]; c.field = c.field.trim() ? `${c.field.trim()} {${k}}` : (/^[A-Za-z0-9_.-]+$/.test(k) ? k : `{${k}}`); if (!c.label) c.label = k; drawCols(); return; }
    if (v.cols.length >= 24) return toast('At most 24 columns.', true); v.cols.push({ label: k, field: /^[A-Za-z0-9_.-]+$/.test(k) ? k : `{${k}}` }); drawCols();
  });
  d.$('#tvStdFill').onclick = async () => { if (v.cols.some((c) => c.field.trim()) && !(await askConfirm('Replace the columns in this list with the standard table?'))) return; v.cols = structuredClone(STD_LAYOUT); d.$('#tvStd').checked = false; focus = -1; drawCols(); };
  d.$('#tvCancel').onclick = d.close;
  d.$('#tvSave').onclick = async () => {
    v.name = d.$('#tvName').value.trim(); v.match = d.$('#tvMatch').value.trim(); v.message = d.$('#tvMsg').checked; v.std = d.$('#tvStd').checked; v.cols = v.cols.filter((c) => c.field.trim()).map((c) => ({ label: c.label, field: c.field, ...(c.map && c.map.trim() ? { map: c.map } : {}), ...(c.sev ? { sev: true } : {}), ...(c.hide ? { hide: true } : {}) })); v.makeDefault = d.$('#tvDef').checked;
    if (!v.name) return toast('Give the view a name.', true);
    if (!v.cols.length && !v.message && v.std === false) return toast('Add at least one column.', true);
    try { await done(v); d.close(); } catch (e) { toast(e.message, true); }
  };
}
async function saveTrapViews(list, defaultId) {
  const prefs = { ...(S.prefs || {}), trapViews: list };
  if (defaultId !== undefined) { if (defaultId) prefs.trapViewDefault = defaultId; else delete prefs.trapViewDefault; }
  else if (prefs.trapViewDefault && !list.some((x) => x.id === prefs.trapViewDefault)) delete prefs.trapViewDefault;
  const r = await api('/api/config', { method: 'PUT', body: { uiPrefs: prefs } }); S.prefs = r.config?.uiPrefs || prefs; S.info.config.uiPrefs = S.prefs;
}
function trapViewsEditor(host) {
  const draw = () => {
    const list = S.prefs.trapViews || [], canEdit = can('customize');
    host.innerHTML = `<p class="muted" style="margin-top:0;max-width:820px">Traps from different vendors carry completely different values, so one fixed set of columns cannot fit them all. A view shows the values you choose for one kind of trap, e.g. an alarm text that joins <code>alarmSource</code>, <code>alarmText</code> and <code>alarmAdditionalText</code> into one column, with severity, time and agent address as their own columns. Choose the view on the Traps page with the “View” box.</p>
      ${list.length ? `<table class="data"><thead><tr><th>View</th><th>Traps covered</th><th>Columns</th><th></th></tr></thead><tbody>${list.map((v, i) => `<tr data-i="${i}"><td><b>${esc(v.name)}</b>${S.prefs.trapViewDefault === v.id ? ' <span class="pill">opens first</span>' : ''}</td><td>${v.match ? `<code>${esc(v.match)}</code>` : '<span class="muted">all traps</span>'}</td><td style="white-space:normal">${esc(v.cols.map((c) => c.label).join(', ')) || '<span class="muted">—</span>'}</td><td style="white-space:nowrap"><button data-a="show">Show traps</button>${canEdit ? ' <button data-a="edit">Change</button> <button data-a="del" class="danger">Delete</button>' : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No views yet.</p>'}
      ${canEdit ? `<div class="toolbar"><button id="tvNew" class="primary">New view</button><select id="tvEx" aria-label="Add an example view"><option value="">Add an example view…</option>${TRAP_VIEW_EXAMPLES.map((x, i) => `<option value="${i}">${esc(x.name)}</option>`).join('')}</select><button id="tvExp" title="Download the views as a file to copy to another PC">Export</button><button id="tvImp" title="Add views from an exported file">Import</button><input type="file" id="tvFile" accept=".json,application/json" hidden></div>` : '<p class="muted">You need the “customize” permission to change views.</p>'}`;
  };
  const afterSave = async (v, list, i) => {
    if (i === undefined) { v.id = 'tv' + Date.now().toString(36); list.push(v); } else list[i] = v;
    const mk = v.makeDefault; delete v.makeDefault; await saveTrapViews(list, mk ? v.id : (S.prefs.trapViewDefault === v.id ? '' : undefined)); S.trapView = v.id; draw(); toast('View saved — open the Traps page to see it');
  };
  host.addEventListener('change', async (e) => {
    if (e.target.id === 'tvFile' && e.target.files[0]) {
      try {
        const j = JSON.parse(await e.target.files[0].text()); const inc = Array.isArray(j) ? j : j.views;
        if (!Array.isArray(inc)) throw new Error('This file has no trap views in it');
        const list = [...(S.prefs.trapViews || [])]; let n = 0;
        for (const v of inc) { if (!v || !Array.isArray(v.cols)) continue; const c = structuredClone(v); c.id = 'tv' + Date.now().toString(36) + (n++); delete c.makeDefault; list.push(c); }
        e.target.value = ''; await saveTrapViews(list); draw(); toast(`${n} view${n === 1 ? '' : 's'} imported`);
      } catch (err) { toast('Import failed: ' + err.message, true); }
      return;
    }
    if (e.target.id !== 'tvEx' || e.target.value === '') return; const ex = structuredClone(TRAP_VIEW_EXAMPLES[+e.target.value]); e.target.value = '';
    trapViewDialog({ id: '', ...ex }, (v) => afterSave(v, [...(S.prefs.trapViews || [])]));
  });
  host.addEventListener('click', async (e) => {
    const list = [...(S.prefs.trapViews || [])];
    if (e.target.id === 'tvExp') { const blob = new Blob([JSON.stringify({ format: 'neteventpro-trap-views', version: 1, views: list }, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'neteventpro-trap-views.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); return; }
    if (e.target.id === 'tvImp') return host.querySelector('#tvFile').click();
    if (e.target.id === 'tvNew') return trapViewDialog(null, (v) => afterSave(v, list));
    const b = e.target.closest('[data-a]'); if (!b) return; const i = +b.closest('tr').dataset.i;
    if (b.dataset.a === 'show') { S.trapView = list[i].id; location.hash = '#traps'; return; }
    if (b.dataset.a === 'edit') return trapViewDialog(list[i], (v) => afterSave(v, list, i));
    if (b.dataset.a === 'del' && await askConfirm(`Delete the trap view “${list[i].name}”?`)) { list.splice(i, 1); try { await saveTrapViews(list); if (S.trapView && !list.some((x) => x.id === S.trapView)) S.trapView = ''; draw(); } catch (err) { toast(err.message, true); } }
  });
  draw();
}
