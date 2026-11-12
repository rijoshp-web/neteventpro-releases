'use strict';
const $ = (s) => document.querySelector(s);
const api = async (url, method = 'GET', body) => {
  const r = await fetch(url, { method, headers: { 'X-Requested-With': 'NetEventPro', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j;
};
const n = (x) => Number(x || 0).toLocaleString();
const ago = (t) => { if (!t) return 'never'; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? s + ' s ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago'; };
let loaded = false, avail = false;
function draw(v) {
  const a = v.auth || {}; $('#login').hidden = a.signedIn !== false; $('#app').hidden = a.signedIn === false; $('#so').hidden = !(a.passwordSet && a.signedIn !== false); $('#ver').textContent = 'v' + v.version;
  if (a.signedIn === false) return;
  drawSec(v);
  const s = v.status, st = $('#state');
  const ok = s.lastOk && !s.lastError, none = !v.settings.server || !v.settings.tokenSet;
  st.className = 'big ' + (none || s.lastError ? 'bad' : ok || !s.queued ? 'ok' : '');
  st.textContent = none ? 'Not set up: enter the server address and token' : s.lastError ? 'Not connected' : s.lastOk ? 'Connected' : 'Waiting for the first packet';
  $('#err').textContent = s.lastError ? s.lastError + ' (' + ago(s.lastErrorAt) + ')' : '';
  const rows = [['Received', n(s.received)], ['Sent', n(s.sent)], ['Waiting in the queue', n(s.queued)], ['Dropped (queue full)', n(s.dropped)], ['Last sent', ago(s.lastOk)]];
  if (v.poll && (v.poll.devices || v.poll.queued)) rows.push(['SNMP polling: devices', n(v.poll.devices)], ['SNMP polling: polls made', n(v.poll.polls)], ['SNMP polling: results waiting', n(v.poll.queued)], ['SNMP polling: device list from the server', ago(v.poll.lastSync)]);
  $('#stats').innerHTML = rows.map(([k, x]) => `<span>${k}</span><span>${x}</span>`).join('');
  $('#ver').textContent = 'v' + v.version; $('#qf').textContent = v.queueFile;
  const L = v.listeners, one = (name, x) => `${name}: ${x.running ? 'listening on ' + x.port : 'not running'}${x.error ? ' (' + x.error + ')' : ''}`;
  $('#lst').textContent = [one('UDP syslog', L.udp), one('TCP syslog', L.tcp), one('SNMP traps', L.snmp)].join(' · ');
  if (!loaded) {
    loaded = true; const c = v.settings;
    $('#srv').value = c.server; $('#nm').value = c.name; $('#tok').placeholder = c.tokenSet ? '******** (saved; type a new token to replace it)' : $('#tok').placeholder; $('#self').checked = c.allowSelfSigned;
    $('#udpOn').checked = c.udpEnabled; $('#udpPort').value = c.udpPort; $('#tcpOn').checked = c.tcpEnabled; $('#tcpPort').value = c.tcpPort; $('#snmpOn').checked = c.snmpEnabled; $('#snmpPort').value = c.snmpPort; $('#src').value = c.allowedSources;
    $('#upUrl').value = v.updateCfg.url; $('#upAutoSrv').checked = v.updateCfg.probeAuto !== false; $('#upTrust').checked = v.updateCfg.probeTrust !== false; { const a = v.update && v.update.auto; $('#upAutoMsg').textContent = a ? (a.error ? 'Last check: ' + a.error : a.offered ? 'The main server offers version ' + a.offered + '.' : a.last ? 'Up to date with the main server (checked ' + new Date(a.last).toLocaleTimeString() + ').' : '') : ''; } if (v.updateCfg.hasKey) $('#upKey').placeholder = '******** (saved; paste a new key to replace it)';
  }
  const u = v.update; if (u) { avail = !!u.available; $('#upGo').hidden = !(u.canInstall); if (u.available) $('#upMsg').textContent = 'Version ' + u.latest + ' is available.'; }
}
async function refresh() { try { draw(await api('/api/probe/view')); } catch (e) { $('#state').textContent = 'The service is not answering'; $('#state').className = 'big bad'; } }
const say = (el, t, bad) => { const e = $(el); e.textContent = t; e.style.color = bad ? 'var(--s1)' : ''; };
$('#save').onclick = async () => { try { await api('/api/probe/settings', 'PUT', { server: $('#srv').value, name: $('#nm').value, token: $('#tok').value, allowSelfSigned: $('#self').checked }); $('#tok').value = ''; say('#msg', 'Saved.'); refresh(); } catch (e) { say('#msg', e.message, true); } };
$('#test').onclick = async () => { say('#msg', 'Testing…'); try { const r = await api('/api/probe/test', 'POST', {}); say('#msg', r.ok ? 'The main server accepted this probe.' : r.error, !r.ok); } catch (e) { say('#msg', e.message, true); } };
$('#saveNet').onclick = async () => { try { await api('/api/probe/settings', 'PUT', { udpEnabled: $('#udpOn').checked, udpPort: $('#udpPort').value, tcpEnabled: $('#tcpOn').checked, tcpPort: $('#tcpPort').value, snmpEnabled: $('#snmpOn').checked, snmpPort: $('#snmpPort').value, allowedSources: $('#src').value }); setTimeout(refresh, 600); } catch (e) { alert(e.message); } };
$('#upSave').onclick = async () => { try { await api('/api/probe/update', 'PUT', { url: $('#upUrl').value, publicKey: $('#upKey').value, probeAuto: $('#upAutoSrv').checked, probeTrust: $('#upTrust').checked }); $('#upKey').value = ''; say('#upMsg', 'Saved.'); refresh(); } catch (e) { say('#upMsg', e.message, true); } };
$('#upCheck').onclick = async () => { say('#upMsg', 'Checking…'); try { const u = await api('/api/update/check', 'POST', {}); say('#upMsg', u.error ? u.error : u.available ? 'Version ' + u.latest + ' is available.' : 'This probe is up to date.', !!u.error); refresh(); } catch (e) { say('#upMsg', e.message, true); } };
$('#upGo').onclick = async () => { if (!confirm('Install the update now? The probe restarts.')) return; try { await api('/api/update/install', 'POST', { confirm: 'INSTALL' }); say('#upMsg', 'Installed. The probe restarts…'); setTimeout(() => location.reload(), 8000); } catch (e) { say('#upMsg', e.message, true); } };
$('#restart').onclick = async () => { if (!confirm('Restart the probe service?')) return; try { await api('/api/restart', 'POST', {}); } catch { /* the service closes */ } setTimeout(() => location.reload(), 6000); };
$('#central').onclick = async () => { if (!confirm('Make this computer a full NetEventPro again? The service restarts. Messages already sent stay on the main server; waiting packets stay in the queue file and are not sent while this is a full server.')) return; try { await api('/api/probe/mode', 'POST', { confirm: 'CENTRAL' }); } catch (e) { alert(e.message); return; } setTimeout(() => location.reload(), 7000); };
refresh(); setInterval(refresh, 3000);

let secLoaded = false;
function drawSec(v) {
  const x = v.security, a = v.auth;
  const warns = [];
  if (!a.passwordSet) warns.push('No password is set: anyone who can use this computer can change this probe. Set one below.');
  if (x.plainHttp && !x.requireHttps) warns.push('The server address is plain http://: logs and the token are readable on the network. Use https://.');
  if (x.bindActive !== '127.0.0.1' && !a.https) warns.push('This page is open to the network without HTTPS: the password can be read on the network. Create a certificate.');
  $('#secWarn').innerHTML = warns.map((w) => '• ' + w.replace(/</g, '&lt;')).join('<br>');
  $('#pwDel').hidden = !a.passwordSet; $('#pwSet').textContent = a.passwordSet ? 'Change password' : 'Set password'; $('#pwCur').hidden = !a.passwordSet;
  $('#httpsState').textContent = a.https ? 'On' + (x.tlsActive ? '' : ' (applies after restart)') : 'Off'; $('#httpsOff').hidden = !x.tlsCertFile;
  $('#pinState').textContent = x.pinSha256 ? 'Pinned: ' + x.pinSha256.slice(0, 16) + '…' : 'Not pinned'; $('#pinDel').hidden = !x.pinSha256;
  if (!secLoaded) { secLoaded = true; $('#wb').value = x.webBind; $('#wa').value = x.webAllow.join(', '); $('#reqHttps').checked = x.requireHttps; $('#rl').value = x.rateLimit; }
}
async function loadAudit() { try { const r = await api('/api/probe/audit'); $('#auditList').innerHTML = r.rows.length ? r.rows.map((x) => `<div>${new Date(x.t).toLocaleString()} · ${String(x.text).replace(/</g, '&lt;')}</div>`).join('') : 'Nothing yet.'; } catch { /* signed out */ } }
$('#lgo').onclick = async () => { try { await api('/api/probe/login', 'POST', { password: $('#lpw').value }); $('#lpw').value = ''; $('#lmsg').textContent = ''; secLoaded = false; refresh(); } catch (e) { $('#lmsg').textContent = e.message; } };
$('#lpw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#lgo').click(); });
$('#signout').onclick = async () => { await api('/api/probe/logout', 'POST', {}).catch(() => {}); refresh(); };
$('#pwSet').onclick = async () => { try { await api('/api/probe/password', 'POST', { current: $('#pwCur').value, password: $('#pwNew').value }); $('#pwCur').value = ''; $('#pwNew').value = ''; say('#pwMsg', 'Password saved.'); refresh(); loadAudit(); } catch (e) { say('#pwMsg', e.message, true); } };
$('#pwDel').onclick = async () => { if (!confirm('Remove the password? The page is then open to anyone who can use this computer.')) return; try { await api('/api/probe/password', 'POST', { current: $('#pwCur').value, password: '', confirm: 'REMOVE' }); say('#pwMsg', 'Password removed.'); refresh(); } catch (e) { say('#pwMsg', e.message, true); } };
$('#secSave').onclick = async () => { try { await api('/api/probe/settings', 'PUT', { webBind: $('#wb').value, webAllow: $('#wa').value, requireHttps: $('#reqHttps').checked, rateLimit: $('#rl').value }); say('#secMsg', 'Saved. A change of “Open from” applies after restart.'); refresh(); loadAudit(); } catch (e) { say('#secMsg', e.message, true); } };
$('#httpsGen').onclick = async () => { try { const r = await api('/api/probe/https/generate', 'POST', {}); say('#secMsg', 'Certificate created for ' + r.names.join(', ') + '. Restart the service to use HTTPS.'); refresh(); loadAudit(); } catch (e) { say('#secMsg', e.message, true); } };
$('#httpsOff').onclick = async () => { try { await api('/api/probe/https/off', 'POST', {}); say('#secMsg', 'HTTPS is off after restart.'); refresh(); } catch (e) { say('#secMsg', e.message, true); } };
$('#pinGet').onclick = async () => { try { const r = await api('/api/probe/pin/fetch', 'POST', {}); if (!r.ok) return say('#secMsg', r.error, true); if (confirm('Trust only this certificate?\n\n' + r.subject + '\nIssuer: ' + r.issuer + '\nValid until: ' + r.validTo + '\nSHA-256: ' + r.fingerprint + (r.trusted ? '' : '\n\nThe certificate is not signed by a trusted authority (self-signed). Check the fingerprint on the main server before you accept.'))) { await api('/api/probe/pin', 'POST', { fingerprint: r.fingerprint }); say('#secMsg', 'Pinned.'); refresh(); loadAudit(); } } catch (e) { say('#secMsg', e.message, true); } };
$('#pinDel').onclick = async () => { try { await api('/api/probe/pin', 'POST', { fingerprint: '' }); say('#secMsg', 'Pin removed.'); refresh(); } catch (e) { say('#secMsg', e.message, true); } };
loadAudit(); setInterval(loadAudit, 15000);
