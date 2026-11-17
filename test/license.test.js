'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), { spawn } = require('node:child_process');
const { License, verifyKey, machineCode, GRACE_DAYS } = require('../src/license');
const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const PUB = fx('license-test-public.pem'), PRIV = crypto.createPrivateKey(fx('license-test-private.pem'));
const mk = (o = {}, priv = PRIV) => { const p = Buffer.from(JSON.stringify({ v: 1, id: 'T1', customer: 'Acme', edition: 'Standard', machine: '*', issued: '2026-01-01', expires: null, ...o })).toString('base64url'); return 'NEP1-' + p + '.' + crypto.sign(null, Buffer.from(p), priv).toString('base64url'); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nep-lic-'));

test('a signed key is accepted, a changed or foreign key is not', () => {
  assert.equal(verifyKey(mk(), PUB).ok, true);
  const k = mk(); const [h, p, s] = [k.slice(0, 5), k.slice(5).split('.')[0], k.split('.')[1]];
  const forged = h + Buffer.from(JSON.stringify({ v: 1, customer: 'Me', machine: '*', expires: null })).toString('base64url') + '.' + s;
  assert.equal(verifyKey(forged, PUB).ok, false, 'payload changed after signing');
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  assert.equal(verifyKey(mk({}, other), PUB).ok, false, 'signed by somebody else');
  assert.equal(verifyKey('hello', PUB).ok, false);
  assert.equal(verifyKey('NEP1-abc', PUB).ok, false);
  assert.equal(verifyKey(' ' + k.replace('.', '\n.') + ' ', PUB).ok, true, 'line breaks and spaces from copy and paste are ignored');
});

test('a key works only on the computer it was issued for', () => {
  const d = tmp(), mine = '1111-2222-3333-4444';
  const l = new License(d, { publicKey: PUB, machine: mine });
  assert.equal(l.status().state, 'unlicensed'); assert.equal(l.ok(), false);
  assert.match(l.activate(mk({ machine: 'AAAA-BBBB-CCCC-DDDD' })).error, /different computer/);
  assert.equal(l.ok(), false);
  assert.equal(l.activate(mk({ machine: '1111-2222-3333-4444' })).ok, true);
  assert.equal(l.status().state, 'licensed'); assert.equal(l.status().customer, 'Acme');
  // the key is kept for the next start (this is what makes updates silent) ...
  assert.equal(new License(d, { publicKey: PUB, machine: mine }).ok(), true);
  // ... and the same data folder copied to another computer stays locked
  const other = new License(d, { publicKey: PUB, machine: '9999-9999-9999-9999' });
  assert.equal(other.ok(), false); assert.equal(other.status().state, 'wrongmachine');
});

test('an expired key is refused and a lapsing licence locks again', () => {
  const d = tmp(), l = new License(d, { publicKey: PUB, machine: 'A'.repeat(16) });
  assert.match(l.activate(mk({ expires: '2020-01-01' })).error, /expired/);
  assert.equal(l.activate(mk({ expires: '2999-01-01' })).ok, true);
  const rec = JSON.parse(fs.readFileSync(path.join(d, 'license.json'), 'utf8')); rec.key = mk({ expires: '2020-01-01' }); fs.writeFileSync(path.join(d, 'license.json'), JSON.stringify(rec));
  assert.equal(new License(d, { publicKey: PUB, machine: 'A'.repeat(16) }).status().state, 'expired');
});

test('an installation that already holds data gets a grace period once; a fresh one does not', () => {
  const fresh = tmp(); assert.equal(new License(fresh, { publicKey: PUB, machine: 'B'.repeat(16) }).status().state, 'unlicensed');
  const old = tmp(); fs.writeFileSync(path.join(old, 'config.json'), '{}');
  const l = new License(old, { publicKey: PUB, machine: 'B'.repeat(16) });
  assert.equal(l.status().state, 'grace'); assert.equal(l.ok(), true); assert.equal(l.status().graceDaysLeft, GRACE_DAYS);
  const rec = JSON.parse(fs.readFileSync(path.join(old, 'license.json'), 'utf8')); rec.graceStart = Date.now() - (GRACE_DAYS + 1) * 86400000; fs.writeFileSync(path.join(old, 'license.json'), JSON.stringify(rec));
  assert.equal(new License(old, { publicKey: PUB, machine: 'B'.repeat(16) }).ok(), false, 'grace is over');
});

test('a key left in license-key.txt by the setup program is used once and removed', () => {
  const d = tmp(); fs.writeFileSync(path.join(d, 'license-key.txt'), mk());
  assert.equal(new License(d, { publicKey: PUB, machine: 'C'.repeat(16) }).ok(), true);
  assert.equal(fs.existsSync(path.join(d, 'license-key.txt')), false);
});

test('the machine code looks like four groups of four and is stable', () => {
  assert.match(machineCode(), /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/); assert.equal(machineCode(), machineCode());
});

test('a program without a key serves only the activation page and collects nothing', async () => {
  const d = tmp(), web = 18791, udp = 15791;
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'src', 'server.js')], { env: { ...process.env, NETEVENTPRO_DATA: d, NETEVENTPRO_WEB_PORT: String(web), NETEVENTPRO_UDP_PORT: String(udp), NETEVENTPRO_TCP_PORT: String(udp), NETEVENTPRO_SNMP_PORT: '15792' }, stdio: 'ignore' });
  try {
    let page = ''; for (let i = 0; i < 60; i++) { try { page = await (await fetch(`http://127.0.0.1:${web}/`)).text(); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
    assert.match(page, /Activate/); assert.doesNotMatch(page, /id="view"/);
    const H = { 'content-type': 'application/json', 'X-Requested-With': 'NetEventPro' };
    const st = await fetch(`http://127.0.0.1:${web}/api/state`); assert.equal(st.status, 402);
    const lg = await fetch(`http://127.0.0.1:${web}/api/logs`); assert.equal(lg.status, 402);
    const lic = await (await fetch(`http://127.0.0.1:${web}/api/license`)).json(); assert.equal(lic.state, 'unlicensed'); assert.match(lic.machine, /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    const bad = await fetch(`http://127.0.0.1:${web}/api/license/activate`, { method: 'POST', headers: H, body: JSON.stringify({ key: mk() }) });
    assert.equal(bad.status, 400, 'a key signed by anyone but the owner is refused');
    const js = await (await fetch(`http://127.0.0.1:${web}/app.js`)).text(); assert.doesNotMatch(js, /views\./, 'the program code is not served while locked');
  } finally { p.kill(); }
});

test('a key can switch features off and limit polled devices; a key without a list has everything', () => {
  const act = (o) => { const l = new License(tmp(), { publicKey: PUB, machine: '1111-2222-3333-4444' }); assert.equal(l.activate(mk(o)).ok, true); return l; };
  const all = act({});
  for (const f of ['polling', 'traps', 'reports', 'notify', 'probes', 'export']) assert.equal(all.has(f), true, f);
  assert.equal(all.maxDevices(), 0);
  const lim = act({ features: ['traps', 'polling', 'bogus'], maxDevices: 25 });
  assert.equal(lim.has('polling'), true); assert.equal(lim.has('traps'), true);
  assert.equal(lim.has('reports'), false); assert.equal(lim.has('notify'), false); assert.equal(lim.has('export'), false);
  assert.equal(lim.maxDevices(), 25);
  assert.equal(act({ features: [] }).has('polling'), false, 'an empty list means nothing extra');
  // before activation (14-day grace) nothing is taken away
  const g = new License(tmp(), { publicKey: PUB, machine: '1' }); assert.equal(g.has('polling'), true);
});

test('automatic update runs only when switched on, inside the chosen hour, once per version', () => {
  const { Updater } = require('../src/update'); const u = Object.create(Updater.prototype); u.info = { latest: '9.9.9' }; u.busy = false; u.auto = null;
  const at = (h) => new Date(2026, 0, 5, h, 10);
  assert.equal(u.autoDue({ autoInstall: false, installHour: 3 }, at(3)), false, 'off by default');
  assert.equal(u.autoDue({ autoInstall: true, installHour: 3 }, at(4)), false, 'outside the hour');
  assert.equal(u.autoDue({ autoInstall: true, installHour: 3 }, at(3)), true);
  u.auto = { version: '9.9.9', at: at(3).getTime() };
  assert.equal(u.autoDue({ autoInstall: true, installHour: 3 }, at(3)), false, 'the same version is not retried within a day');
  u.auto = { version: '9.9.8', at: at(3).getTime() }; assert.equal(u.autoDue({ autoInstall: true, installHour: 3 }, at(3)), true, 'a newer version is');
  u.busy = true; assert.equal(u.autoDue({ autoInstall: true, installHour: 3 }, at(3)), false);
});
