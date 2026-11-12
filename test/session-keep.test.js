'use strict';
// 1.49: signing in on a second PC must not sign out the first one, even when the sign-in upgrades an old password hash.
const test = require('node:test'); const assert = require('node:assert');
const { spawn } = require('node:child_process'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const ROOT = path.join(__dirname, '..'), WEB = 8561, H = { 'content-type': 'application/json', 'x-requested-with': 'NetEventPro' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const start = async (dir, n) => {
  const p = spawn('node', ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'src/server.js')], { env: { ...process.env, NETEVENTPRO_DATA: dir, NETEVENTPRO_UDP_PORT: '5561', NETEVENTPRO_TCP_PORT: '5561', NETEVENTPRO_WEB_PORT: String(WEB), NETEVENTPRO_SNMP_PORT: '5562', NETEVENTPRO_SCRYPT_N: String(n) }, cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${WEB}/api/state`, { headers: H })).status) break; } catch { /* starting */ } await sleep(250); }
  return p;
};
const stop = (p) => new Promise((r) => { p.once('exit', r); p.kill(); setTimeout(r, 3000); });
const api = (u, o = {}, ck) => fetch(`http://127.0.0.1:${WEB}${u}`, { ...o, headers: { ...H, ...(ck ? { cookie: ck } : {}), ...(o.headers || {}) } });
const login = async (username, password) => { const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) }); assert.equal(r.status, 200); return (r.headers.get('set-cookie') || '').split(';')[0]; };

test('a hash upgrade at sign-in keeps the other sessions signed in; a viewer cannot reach polling', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-')); let p = await start(dir, 1024);
  try {
    let r = await api('/api/config', { method: 'PUT', body: JSON.stringify({ adminPassword: 'correct-horse-battery' }) }); assert.equal(r.status, 200);
    const adm = 'Basic ' + Buffer.from('admin:correct-horse-battery').toString('base64');
    const up = await (await api('/api/users', { headers: { authorization: adm } })).json();
    r = await api('/api/users', { method: 'POST', headers: { authorization: adm }, body: JSON.stringify({ roles: up.roles, groups: [], users: [{ name: 'alice', roleId: 'viewer', password: 'alice-password-1' }, { name: 'omar', roleId: 'operator', password: 'omar-password-12' }] }) }); assert.equal(r.status, 200);
    await stop(p); p = await start(dir, 2048);                       // the stored hashes are now "old"
    const pc1 = await login('admin', 'correct-horse-battery');
    assert.equal((await api('/api/state', {}, pc1)).status, 200);
    const pc2 = await login('alice', 'alice-password-1');            // upgrades alice's hash
    assert.equal((await api('/api/state', {}, pc1)).status, 200, 'the first PC stays signed in');
    assert.equal((await api('/api/state', {}, pc2)).status, 200);
    const pc3 = await login('omar', 'omar-password-12');
    assert.equal((await api('/api/state', {}, pc1)).status, 200); assert.equal((await api('/api/state', {}, pc2)).status, 200); assert.equal((await api('/api/state', {}, pc3)).status, 200);
    // permissions: SNMP polling is for the administrator only
    for (const [ck, who] of [[pc2, 'viewer'], [pc3, 'operator']]) { assert.equal((await api('/api/poll/overview', {}, ck)).status, 403, who + ' has no polling'); assert.equal((await api('/api/poll/mibobjects?q=cpu', {}, ck)).status, 403); assert.equal((await api('/api/poll/devices', { method: 'POST', body: '{}' }, ck)).status, 403); }
    assert.equal((await api('/api/poll/overview', {}, pc1)).status, 200);
    assert.equal((await api('/api/poll/mibobjects?q=cpu&limit=5&offset=0&files=1', {}, pc1)).status, 200);
    // a viewer cannot change rules or settings; an operator can edit rules but not settings
    assert.equal((await api('/api/config', { method: 'PUT', body: JSON.stringify({ rules: [] }) }, pc2)).status, 403);
    assert.equal((await api('/api/config', { method: 'PUT', body: JSON.stringify({ rules: [] }) }, pc3)).status, 200);
    assert.equal((await api('/api/config', { method: 'PUT', body: JSON.stringify({ retentionDays: 9 }) }, pc3)).status, 403);
    const me = await (await api('/api/state', {}, pc2)).json(); assert.deepEqual(me.me.perms, ['view']);
  } finally { await stop(p); fs.rmSync(dir, { recursive: true, force: true }); }
});
