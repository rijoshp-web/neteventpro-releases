'use strict';
// 1.44: probe security — sign-in for the local page, encrypted queue and token, certificate pinning, rate limit, token rotation.
const test = require('node:test'); const assert = require('node:assert'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const http = require('node:http'); const https = require('node:https'); const dgram = require('node:dgram'); const { spawn } = require('node:child_process');
const certgen = require('../src/certgen'); const { Probe, ProbeRegistry } = require('../src/probe'); const { SecretBox } = require('../src/secretbox');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hdr = { 'X-Requested-With': 'NetEventPro', 'content-type': 'application/json' };

test('secret box round trip, tamper detection and file format', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-')); const b = new SecretBox(dir);
  const t = b.seal('hunter2'); assert.match(t, /^enc1:/); assert.equal(b.open(t), 'hunter2'); assert.equal(b.open('plain'), 'plain');
  assert.equal(b.open(t.slice(0, -4) + 'AAAA'), '', 'a damaged value is not decrypted');
  const f = b.sealFile(Buffer.from('[1,2]')); assert.equal(b.openFile(f).toString(), '[1,2]'); assert.equal(b.openFile(Buffer.from('[1,2]')), null);
  assert.equal(new SecretBox(dir).open(t), 'hunter2', 'the key is kept in the data directory');
});

test('pinned certificate: the right fingerprint connects, a wrong one sends nothing', async () => {
  const g = certgen.generate({ hosts: '127.0.0.1' }); let hits = 0;
  const srv = https.createServer({ cert: g.cert, key: g.key }, (req, res) => { hits++; req.resume(); req.on('end', () => { res.writeHead(200); res.end('{}'); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const u = new URL(`https://127.0.0.1:${srv.address().port}/`);
  const fp = g.fingerprint.toLowerCase().replace(/[^0-9a-f]/g, '');
  const info = await Probe.fetchPin(u.origin); assert.equal(info.fingerprint, fp); assert.equal(info.trusted, false);
  const s = await Probe.pinnedSocket(u, fp); s.destroy();
  await assert.rejects(Probe.pinnedSocket(u, 'a'.repeat(64)), /does not match the pinned/);
  const cfg = { get: () => ({ mode: 'probe', probe: {} }) }; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-')); const p = new Probe(cfg, dir); p.shutdown();
  await p.post({ server: u.origin, token: 'nep_x', pinSha256: fp }, { items: [] }); assert.equal(hits, 1, 'a pinned self-signed server is accepted without "accept self-signed"');
  await assert.rejects(p.post({ server: u.origin, token: 'nep_x', pinSha256: 'b'.repeat(64) }, { items: [] }), /does not match/); assert.equal(hits, 1, 'nothing reached the wrong certificate');
  await assert.rejects(p.post({ server: 'http://127.0.0.1:9', token: 'x', requireHttps: true }, { items: [] }), /Require HTTPS/);
  srv.close();
});

test('rate limit per sender and token rotation with a 24 hour overlap', () => {
  let conf = { mode: 'probe', probe: { rateLimit: 3 }, probes: [] }; const cfg = { get: () => conf, update: (x) => { conf = { ...conf, ...x }; } };
  const p = new Probe(cfg, fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'))); p.shutdown();
  for (let i = 0; i < 10; i++) p.add('s', Buffer.from('x'), '10.0.0.1'); p.add('s', Buffer.from('x'), '10.0.0.2');
  assert.equal(p.q.length, 4, '3 from the first sender, 1 from the second'); assert.equal(p.s.limited, 7);
  const reg = new ProbeRegistry(cfg); const a = reg.create('Site'); assert.equal(reg.find(a.token).name, 'Site');
  const b = reg.rotate(a.id); assert.notEqual(a.token, b.token); assert.ok(reg.find(b.token) && reg.find(a.token), 'both tokens work during the overlap');
  conf.probes[0].prevUntil = Date.now() - 1; assert.equal(reg.find(a.token), null, 'the old token stops after the overlap'); assert.ok(reg.find(b.token));
  assert.ok(reg.list()[0].rotated > 0);
});

test('the probe page: sign-in, lockout of guessing, encrypted queue and token on disk', async (t) => {
  const main = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(503); res.end('{"error":"down"}'); }); });
  await new Promise((r) => main.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nep-probe-sec-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ mode: 'probe', probe: { server: `http://127.0.0.1:${main.address().port}`, token: 'nep_plain_token', name: 'S' } }));
  const env = { ...process.env, NETEVENTPRO_DATA: dir, NETEVENTPRO_UDP_PORT: '5841', NETEVENTPRO_TCP_PORT: '5841', NETEVENTPRO_WEB_PORT: '8841', NETEVENTPRO_SNMP_PORT: '5842', NETEVENTPRO_SCRYPT_N: '4096', NODE_NO_WARNINGS: '1' };
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'src', 'server.js')], { env, stdio: 'ignore' });
  t.after(() => { child.kill(); main.close(); });
  const web = (p, o = {}) => fetch('http://127.0.0.1:8841' + p, o);
  for (let i = 0; i < 40; i++) { try { if ((await web('/')).ok) break; } catch { /* starting */ } await sleep(250); }
  const cfgText = () => fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
  assert.ok(!cfgText().includes('nep_plain_token') && /enc1:/.test(cfgText()), 'the token is encrypted in config.json after start');
  let r = await web('/api/probe/view'); let v = await r.json(); assert.equal(v.auth.passwordSet, false); assert.equal(v.security.rateLimit, 0);
  r = await web('/api/probe/settings', { method: 'PUT', headers: hdr, body: JSON.stringify({ webBind: '0.0.0.0' }) }); assert.equal(r.status, 400, 'network access needs a password first');
  r = await web('/api/probe/password', { method: 'POST', headers: hdr, body: JSON.stringify({ password: 'short' }) }); assert.equal(r.status, 400);
  r = await web('/api/probe/password', { method: 'POST', headers: hdr, body: JSON.stringify({ password: 'a-good-long-password' }) }); assert.equal(r.status, 200);
  const ck = (r.headers.get('set-cookie') || '').split(';')[0]; assert.match(ck, /^pr_session=/); assert.match(r.headers.get('set-cookie'), /HttpOnly.*SameSite=Strict|SameSite=Strict.*HttpOnly/);
  assert.equal((await web('/api/probe/view', { headers: { cookie: ck } })).status, 200);
  v = await (await web('/api/probe/view')).json(); assert.equal(v.auth.signedIn, false); assert.equal(v.settings, undefined, 'a signed-out view shows nothing');
  assert.equal((await web('/api/probe/audit')).status, 401); assert.equal((await web('/api/probe/settings', { method: 'PUT', headers: hdr, body: '{}' })).status, 401);
  r = await web('/api/probe/login', { method: 'POST', headers: hdr, body: JSON.stringify({ password: 'wrong' }) }); assert.equal(r.status, 401);
  r = await web('/api/probe/login', { method: 'POST', headers: hdr, body: JSON.stringify({ password: 'a-good-long-password' }) }); assert.equal(r.status, 200); const ck2 = r.headers.get('set-cookie').split(';')[0];
  const au = await (await web('/api/probe/audit', { headers: { cookie: ck2 } })).json(); assert.ok(au.rows.some((x) => /failed sign-in/.test(x.text)) && au.rows.some((x) => /signed in/.test(x.text)));
  r = await web('/api/probe/settings', { method: 'PUT', headers: { ...hdr, cookie: ck2 }, body: JSON.stringify({ rateLimit: 50, webAllow: 'bad-ip' }) }); assert.equal(r.status, 400);
  r = await web('/api/probe/settings', { method: 'PUT', headers: { ...hdr, cookie: ck2 }, body: JSON.stringify({ rateLimit: 50, requireHttps: true, webAllow: '10.0.0.0/8' }) }); assert.equal(r.status, 200);
  v = await r.json(); assert.equal(v.security.rateLimit, 50); assert.equal(v.security.requireHttps, true);
  assert.ok(!/nep_plain_token|a-good-long-password/.test(JSON.stringify(v)), 'no secrets in the view');
  await web('/api/probe/logout', { method: 'POST', headers: { ...hdr, cookie: ck2 } }); assert.equal((await web('/api/probe/audit', { headers: { cookie: ck2 } })).status, 401, 'signed out');
  // the queue file is encrypted
  const udp = dgram.createSocket('udp4'); await new Promise((rr) => udp.send(Buffer.from('<134>1 2026-11-06T08:00:00Z h1 app - - - secret-log-text'), 5841, '127.0.0.1', rr)); udp.close();
  await sleep(6500); const q = fs.readFileSync(path.join(dir, 'probe-queue.json')); assert.equal(q.subarray(0, 4).toString(), 'NEQ1'); assert.ok(!q.toString('latin1').includes('c2VjcmV0') && !q.toString('latin1').includes('secret-log-text'));
  // guessing is slowed: five wrong passwords lock the address
  let last = 0; for (let i = 0; i < 6; i++) last = (await web('/api/probe/login', { method: 'POST', headers: hdr, body: JSON.stringify({ password: 'nope' + i }) })).status;
  assert.equal(last, 429);
});
