'use strict';
// 1.98.1 high availability with two real servers: copied messages, settings follow the primary, the standby holds back
// notifications, takes over when the primary stops, and hands back when it returns.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dgram = require('node:dgram');
const HAmod = require('../src/ha');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { 'content-type': 'application/json', 'X-Requested-With': 'NetEventPro' };
function start(dir, base) {
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--require', path.join(__dirname, 'license-hook.js'), path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, NETEVENTPRO_DATA: dir, NETEVENTPRO_UDP_PORT: base, NETEVENTPRO_TCP_PORT: base, NETEVENTPRO_WEB_PORT: base + 1, NETEVENTPRO_SNMP_PORT: base + 2 }, stdio: 'ignore' });
  return p;
}
async function ready(port) { for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/api/state`); return; } catch { await sleep(250); } } throw new Error('server did not start'); }
const api = async (port, p, body) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, body === undefined ? { headers: H } : { method: p === '/api/config' ? 'PUT' : 'POST', headers: H, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) }; };
const send = (port, msg) => new Promise((res) => { const c = dgram.createSocket('udp4'); c.send(Buffer.from(msg), port, '127.0.0.1', () => { c.close(); res(); }); });

test('signed requests and sealed settings', () => {
  const box = HAmod.seal('a-shared-key-of-16+', { x: 1, secret: 'pw' });
  assert.deepEqual(HAmod.open('a-shared-key-of-16+', box), { x: 1, secret: 'pw' });
  assert.throws(() => HAmod.open('another-key-of-16chars', box));
  assert.notEqual(HAmod.sign('k1', '1', 'GET', '/a', ''), HAmod.sign('k2', '1', 'GET', '/a', ''));
});

test('a primary and a standby: copy, settings, take over, hand back', { timeout: 150000 }, async () => {
  const dA = fs.mkdtempSync(path.join(os.tmpdir(), 'nep-haA-')), dB = fs.mkdtempSync(path.join(os.tmpdir(), 'nep-haB-'));
  const A = 46100, B = 46200, KEY = 'shared-ha-key-for-tests-123';
  let pa = start(dA, A), pb = start(dB, B);
  try {
    await ready(A + 1); await ready(B + 1);
    let r = await api(A + 1, '/api/config', { ha: { role: 'primary', partner: `http://127.0.0.1:${B + 1}`, sharedKey: 'short' } }); assert.equal(r.status, 400);
    r = await api(A + 1, '/api/config', { ha: { role: 'primary', partner: `http://127.0.0.1:${B + 1}`, sharedKey: KEY, copyMessages: true }, silentDeviceMinutes: 42 });
    assert.equal(r.status, 200); assert.equal(r.json.config.ha.sharedKey, '********');
    r = await api(B + 1, '/api/config', { ha: { role: 'standby', partner: `http://127.0.0.1:${A + 1}`, sharedKey: KEY } }); assert.equal(r.status, 200);
    // a wrong key is refused by the partner endpoints
    const bad = await fetch(`http://127.0.0.1:${A + 1}/api/ha/peer`, { headers: { 'x-nep-ha': `${Date.now()}.${'0'.repeat(64)}` } }); assert.equal(bad.status, 401);
    r = await api(B + 1, '/api/ha/check', {}); assert.equal(r.json.ok, true, JSON.stringify(r.json));
    // settings follow the primary
    r = await api(B + 1, '/api/ha/sync', {}); assert.equal(r.json.ok, true, JSON.stringify(r.json));
    assert.equal((await api(B + 1, '/api/config')).json.silentDeviceMinutes, 42);
    assert.equal((await api(B + 1, '/api/config')).json.ha.role, 'standby');          // its own HA settings are kept
    // messages received by the primary are copied to the standby
    await send(A, '<11>Nov 19 10:00:00 ha-dev app: copied to the standby 1');
    await sleep(2500);
    const logsB = (await api(B + 1, '/api/logs?limit=20&text=' + encodeURIComponent('copied to the standby'))).json.rows || [];
    assert.ok(logsB.some((m) => m.host === 'ha-dev'), 'the standby has the copy');
    let st = (await api(B + 1, '/api/state')).json.ha; assert.deepEqual(st, { role: 'standby', state: 'passive' });
    // the primary stops: the standby takes over after 3 missed answers
    pa.kill('SIGTERM'); await sleep(1000);
    for (let i = 0; i < 30 && st.state !== 'active'; i++) { await sleep(1000); st = (await api(B + 1, '/api/state')).json.ha; }
    assert.equal(st.state, 'active');
    const hs = (await api(B + 1, '/api/ha/status')).json; assert.ok(hs.takeoverAt > 0 && hs.misses >= 3);
    // the primary comes back: after 30 s of answers the standby hands back
    pa = start(dA, A); await ready(A + 1);
    for (let i = 0; i < 50 && st.state !== 'passive'; i++) { await sleep(1000); st = (await api(B + 1, '/api/state')).json.ha; }
    assert.equal(st.state, 'passive');
  } finally { pa.kill('SIGTERM'); pb.kill('SIGTERM'); await sleep(800); fs.rmSync(dA, { recursive: true, force: true }); fs.rmSync(dB, { recursive: true, force: true }); }
});
