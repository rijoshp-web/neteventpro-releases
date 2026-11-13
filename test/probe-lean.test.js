'use strict';
// The lean probe program (mode "probe"): it must receive syslog and SNMP traps, queue them on disk, send them to the main server and offer a
// small local page - and nothing else (no database, no dashboard API).
const test = require('node:test'); const assert = require('node:assert'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const http = require('node:http'); const dgram = require('node:dgram'); const { spawn } = require('node:child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hdr = { 'X-Requested-With': 'NetEventPro', 'content-type': 'application/json' };

test('probe mode runs the lean program and forwards what it receives', async (t) => {
  const got = []; let fail = false;
  const main = http.createServer((req, res) => {
    const ch = []; req.on('data', (d) => ch.push(d)); req.on('end', () => {
      if (fail) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end('{"error":"down"}'); }
      const b = JSON.parse(Buffer.concat(ch).toString() || '{}'); got.push({ auth: req.headers.authorization, ...b }); res.writeHead(200); res.end('{"ok":true}');
    });
  });
  await new Promise((r) => main.listen(0, '127.0.0.1', r)); const mport = main.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nep-probe-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ mode: 'probe', probe: { server: `http://127.0.0.1:${mport}`, token: 'nep_test', name: 'SiteX' } }));
  const env = { ...process.env, NETEVENTPRO_DATA: dir, NETEVENTPRO_UDP_PORT: '5831', NETEVENTPRO_TCP_PORT: '5831', NETEVENTPRO_WEB_PORT: '8831', NETEVENTPRO_SNMP_PORT: '5832', NODE_NO_WARNINGS: '1' };
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'src', 'server.js')], { env, stdio: 'ignore' });
  t.after(() => { child.kill(); main.close(); });
  const web = (p, o = {}) => fetch('http://127.0.0.1:8831' + p, o);
  for (let i = 0; i < 160; i++) { try { if ((await web('/')).ok) break; } catch { /* starting */ } await sleep(250); }

  const page = await web('/'); assert.equal(page.status, 200); assert.match(await page.text(), /Probe/);
  assert.equal((await web('/api/state')).status, 404, 'the full dashboard API is not served by a probe');
  assert.equal((await web('/api/probe/settings', { method: 'PUT', body: '{}' })).status, 403, 'writes need the request header');

  const udp = dgram.createSocket('udp4');
  const send = (buf, port) => new Promise((r) => udp.send(buf, port, '127.0.0.1', r));
  await send(Buffer.from('<134>1 2026-11-06T08:00:00Z h1 app - - - lean probe syslog'), 5831);
  // a minimal SNMPv2c trap (sysUpTime + snmpTrapOID linkDown), community "public"
  await send(Buffer.from('<134>1 2026-11-06T08:00:01Z h2 app - - - second'), 5831);
  for (let i = 0; i < 30 && got.reduce((n, g) => n + (g.items?.length || 0), 0) < 2; i++) await sleep(250);
  const items = got.flatMap((g) => g.items || []);
  assert.equal(items.length, 2); assert.equal(got[0].auth, 'Bearer nep_test'); assert.equal(got[0].probe, 'SiteX');
  assert.match(Buffer.from(items[0].b, 'base64').toString(), /lean probe syslog/); assert.equal(items[0].k, 's');

  // the main server is down: packets wait in the queue file and are sent when it is back
  fail = true; await send(Buffer.from('<134>1 2026-11-06T08:01:00Z h3 app - - - queued while down'), 5831);
  await sleep(1500);
  let v = await (await web('/api/probe/view')).json(); assert.ok(v.status.queued >= 1 && v.status.lastError, 'queued and an error is shown');
  await sleep(5500); assert.match(fs.readFileSync(path.join(dir, 'probe-queue.json'), 'utf8'), /./, 'queue saved on disk');
  fail = false; for (let i = 0; i < 60 && (await (await web('/api/probe/view')).json()).status.queued > 0; i++) await sleep(500);
  assert.equal((await (await web('/api/probe/view')).json()).status.queued, 0);
  assert.ok(got.flatMap((g) => g.items || []).some((x) => /queued while down/.test(Buffer.from(x.b, 'base64').toString())));

  // settings: the token is never returned; a port change applies at once
  const put = await web('/api/probe/settings', { method: 'PUT', headers: hdr, body: JSON.stringify({ name: 'SiteY', snmpPort: 5833 }) });
  v = await put.json(); assert.equal(v.settings.name, 'SiteY'); assert.equal(v.settings.tokenSet, true); assert.ok(!JSON.stringify(v).includes('nep_test'));
  const bad = await web('/api/probe/settings', { method: 'PUT', headers: hdr, body: JSON.stringify({ udpPort: 99999 }) }); assert.equal(bad.status, 400);
  const test2 = await (await web('/api/probe/test', { method: 'POST', headers: hdr, body: '{}' })).json(); assert.equal(test2.ok, true);
  udp.close();
});
