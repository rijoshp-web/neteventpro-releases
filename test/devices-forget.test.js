'use strict';
// 1.99.1 "Forget all" on the Devices page: one step, names and groups kept unless asked, messages kept, devices come back
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), dgram = require('node:dgram');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { 'content-type': 'application/json', 'X-Requested-With': 'NetEventPro' };

test('forget all devices', { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nep-fa-')), base = 46400;
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--require', path.join(__dirname, 'license-hook.js'), path.join(__dirname, '..', 'src', 'server.js')], { env: { ...process.env, NETEVENTPRO_DATA: dir, NETEVENTPRO_UDP_PORT: base, NETEVENTPRO_TCP_PORT: base, NETEVENTPRO_WEB_PORT: base + 1, NETEVENTPRO_SNMP_PORT: base + 2 }, stdio: 'ignore' });
  const api = async (u, method, body) => { const r = await fetch(`http://127.0.0.1:${base + 1}${u}`, { method: method || 'GET', headers: H, body: body && JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const send = (msg) => new Promise((res) => { const c = dgram.createSocket('udp4'); c.send(Buffer.from(msg), base, '127.0.0.1', () => { c.close(); res(); }); });
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${base + 1}/api/state`); break; } catch { await sleep(250); } }
    for (let i = 0; i < 300; i++) await send(`<14>Nov 19 10:00:00 fa-${i} app: forget all test`);
    await sleep(1500);
    assert.equal((await api('/api/devices')).json.length, 300);
    await api('/api/config', 'PUT', { deviceInfo: { 'fa-1': { group: 'Keep' } }, deviceAliases: { 'fa-2': 'Two' }, mutedDevices: ['fa-3'] });
    let r = await api('/api/devices/forget', 'POST', { all: true });
    assert.equal(r.json.removed, 300); assert.equal((await api('/api/devices')).json.length, 0);
    let c = (await api('/api/config')).json; assert.equal(c.deviceInfo['fa-1'].group, 'Keep'); assert.equal(c.deviceAliases['fa-2'], 'Two');
    const logs = (await api('/api/logs?limit=500&text=' + encodeURIComponent('forget all test'))).json.rows; assert.equal(logs.length, 300, 'messages are kept');
    await send('<14>Nov 19 10:00:01 fa-1 app: back'); await send('<14>Nov 19 10:00:01 fa-2 app: back'); await sleep(900);
    assert.deepEqual((await api('/api/devices')).json.map((d) => d.key).sort(), ['fa-1', 'fa-2']);
    r = await api('/api/devices/forget', 'POST', { all: true, wipeInfo: true }); assert.equal(r.json.removed, 2);
    c = (await api('/api/config')).json; assert.deepEqual(c.deviceInfo, {}); assert.deepEqual(c.deviceAliases, {}); assert.deepEqual(c.mutedDevices, []);
  } finally { p.kill('SIGTERM'); await sleep(300); fs.rmSync(dir, { recursive: true, force: true }); }
});
