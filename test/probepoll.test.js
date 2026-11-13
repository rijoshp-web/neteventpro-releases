'use strict';
// SNMP polling through a probe (1.48): a real central server and a real probe program, a fake SNMP device that only the probe is told about.
const test = require('node:test'); const assert = require('node:assert'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawn } = require('node:child_process');
const { startAgent } = require('./fake-snmp-agent');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { 'X-Requested-With': 'NetEventPro', 'content-type': 'application/json' };
const MIB = [['1.3.6.1.2.1.1.1.0', 'octets', 'Probe-side switch'], ['1.3.6.1.2.1.1.2.0', 'oid', '1.3.6.1.4.1.9.1.1'], ['1.3.6.1.2.1.1.3.0', 'timeticks', 500000], ['1.3.6.1.2.1.1.5.0', 'octets', 'far-sw'],
  ['1.3.6.1.4.1.9.9.109.1.1.1.1.8.1', 'gauge32', 77], ['1.3.6.1.2.1.31.1.1.1.1.1', 'octets', 'Gi1'], ['1.3.6.1.2.1.2.2.1.3.1', 'integer', 6], ['1.3.6.1.2.1.2.2.1.8.1', 'integer', 1], ['1.3.6.1.2.1.31.1.1.1.6.1', 'counter64', 0]];

test('a probe polls a device for the server: test, readings, interfaces, no-answer alarm', { timeout: 150000 }, async (t) => {
  const agent = await startAgent({ mib: MIB });
  const d1 = fs.mkdtempSync(path.join(os.tmpdir(), 'nep-pp-c-')), d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nep-pp-p-'));
  const spawnSrv = (dir, env) => spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'src', 'server.js')], { env: { ...process.env, NETEVENTPRO_DATA: dir, NODE_NO_WARNINGS: '1', ...env }, stdio: 'ignore' });
  const central = spawnSrv(d1, { NETEVENTPRO_UDP_PORT: '5841', NETEVENTPRO_TCP_PORT: '5841', NETEVENTPRO_WEB_PORT: '8841', NETEVENTPRO_SNMP_PORT: '5842' });
  let probe = null;
  t.after(async () => { central.kill(); probe?.kill(); try { agent.close(); } catch { /* closed */ } await sleep(800); for (const d of [d1, d2]) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* temp folder: the system cleans it */ } } });
  const api = async (p, body) => { const r = await fetch('http://127.0.0.1:8841' + p, body === undefined ? { headers: H } : { method: 'POST', headers: H, body: JSON.stringify(body) }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch { /* */ } return { status: r.status, json: j, text: txt }; };
  for (let i = 0; i < 40; i++) { try { if ((await api('/api/state')).status === 200) break; } catch { /* starting */ } await sleep(250); }
  const pr = await api('/api/probes', { name: 'SiteP' }); assert.ok(pr.json?.token, pr.text);
  fs.writeFileSync(path.join(d2, 'config.json'), JSON.stringify({ mode: 'probe', probe: { server: 'http://127.0.0.1:8841', token: pr.json.token, name: 'SiteP' } }));
  probe = spawnSrv(d2, { NETEVENTPRO_UDP_PORT: '5843', NETEVENTPRO_TCP_PORT: '5843', NETEVENTPRO_WEB_PORT: '8843', NETEVENTPRO_SNMP_PORT: '5844' });

  await api('/api/poll/settings', { missesBeforeDown: 1 });
  const add = await api('/api/poll/devices', { name: 'Far-Switch', host: '127.0.0.1', port: agent.port, version: 'v2c', community: 'public', intervalSec: 10, timeoutMs: 800, retries: 0, profile: 'auto', ifMode: 'auto', via: pr.json.id });
  assert.ok(add.json?.id, add.text);
  const list = await api('/api/poll/devices'); assert.equal(list.json.devices[0].via, pr.json.id); assert.equal(list.json.probes[0].name, 'SiteP');

  // the central server does not poll it itself
  await sleep(1500); let ov = await api('/api/poll/overview'); assert.equal(ov.json.devices[0].state, 'unknown');

  // Test connection runs on the probe (it asks the server every 10 seconds)
  const test1 = await api('/api/poll/test', { name: 'x', host: '127.0.0.1', port: agent.port, version: 'v2c', community: 'public', timeoutMs: 800, via: pr.json.id });
  assert.equal(test1.json?.ok, true, test1.text); assert.equal(test1.json.profile, 'cisco'); assert.equal(test1.json.sysName, 'far-sw');

  // readings arrive through the probe
  let dev = null; for (let i = 0; i < 60; i++) { ov = await api('/api/poll/overview'); dev = ov.json.devices[0]; if (dev.state === 'up' && dev.cpu !== null) break; await sleep(1000); }
  assert.equal(dev.state, 'up', JSON.stringify(dev)); assert.equal(dev.cpu, 77); assert.equal(dev.via, 'SiteP'); assert.equal(dev.profile, 'cisco');
  const det = await api('/api/poll/device?id=' + add.json.id); assert.equal(det.json.ifaces.length, 1); assert.equal(det.json.device.ifSelected?.[0] ?? 'Gi1', 'Gi1');
  const ser = await api(`/api/poll/series?id=${add.json.id}&k=cpu&hours=1`); assert.ok(ser.json.points.length >= 1 && ser.json.points[0].v === 77);

  // the probe loses the device: the server raises the alarm
  agent.close();
  let alarm = null; for (let i = 0; i < 60 && !alarm; i++) { const a = await api('/api/alarms?state=active&limit=50'); alarm = (a.json?.alarms || []).find((x) => x.rule === 'No SNMP answer' && x.device === 'far-switch'); if (!alarm) await sleep(1000); }
  assert.ok(alarm, 'no-answer alarm raised from the probe result');

  // a probe result for a device that is not the probe's is refused
  const bad = await fetch('http://127.0.0.1:8841/api/probe/pollresults', { method: 'POST', headers: { ...H, authorization: 'Bearer ' + pr.json.token }, body: JSON.stringify({ results: [{ dev: 'nope', res: { ok: true, ts: Date.now(), readings: [] } }] }) });
  assert.equal((await bad.json()).accepted, 0);
  assert.equal((await fetch('http://127.0.0.1:8841/api/probe/pollcfg', { method: 'POST', headers: { ...H, authorization: 'Bearer nep_wrong_token_value' }, body: '{}' })).status, 401);
});

test('probe poller keeps results while the link is down and sends them in order afterwards', async () => {
  const { ProbePoller } = require('../src/probepoll'); const { SecretBox } = require('../src/secretbox');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nep-pq-')); const agent = await startAgent({ mib: MIB }); let down = true; const sent = [];
  const probe = { on: true, box: new SecretBox(dir), cfg: () => ({ server: 'http://x', token: 'nep_xxxxxxxxxxxx', name: 'P' }),
    post: async (c, body, p) => { if (down) throw new Error('Cannot connect to the server (refused).'); if (p.endsWith('pollcfg')) return { devices: [{ id: 'd1', name: 'a', host: '127.0.0.1', port: agent.port, version: 'v2c', community: 'public', intervalSec: 10, timeoutMs: 500, retries: 0 }], profiles: require('../src/pollcore').BUILTIN.map((x) => ({ ...x })), workers: 2, tasks: [] }; sent.push(...body.results); return { ok: true }; } };
  const pp = new ProbePoller(probe, dir);
  try {
    pp.cfg = { devices: [{ id: 'd1', name: 'a', host: '127.0.0.1', port: agent.port, version: 'v2c', community: 'public', intervalSec: 10, timeoutMs: 500, retries: 0 }], profiles: require('../src/pollcore').BUILTIN.map((x) => ({ ...x })), workers: 2 };
    for (let i = 0; i < 3; i++) { pp.out.push({ dev: 'd1', res: await pp.collector.collect(pp.cfg.devices[0], pp.cfg.profiles) }); await sleep(20); }
    await pp.flush(); assert.equal(pp.out.length, 3, 'nothing lost while down'); assert.ok(pp.nextSend > Date.now(), 'backs off');
    down = false; pp.nextSend = 0; await pp.flush(); assert.equal(pp.out.length, 0); assert.equal(sent.length, 3); assert.ok(sent[0].res.ts <= sent[2].res.ts && sent[0].res.ok === true);
    pp.dirty = true; pp.save(); assert.ok(!fs.readFileSync(path.join(dir, 'probe-poll-queue.json'), 'utf8').includes('far-sw'), 'queue file is encrypted');
  } finally { pp.shutdown(); agent.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
