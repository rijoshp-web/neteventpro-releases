'use strict';
/* NetEventPro load test for your own server (1.98.1). Sends realistic syslog and SNMP traps from thousands of simulated devices
   to a running NetEventPro, step by step, and writes a report: messages received or lost, the server's CPU and memory,
   and how quickly the dashboard and searches answered meanwhile.

   Run it on ANOTHER computer on the same network (so the test sender does not take the server's CPU), with Node.js 22:
     node loadtest.js --url http://nep-server:8514 --user admin --pass "your password" --target nep-server
   Options: --steps 1000,5000,10000,20000   messages per second per step     --secs 30   seconds per step
            --devices 3000   simulated devices   --udp 514 --tcp 514 --snmp 162   ports   --traps 500,2000   trap steps
            --tcp-steps 5000,20000           --cleanup   delete the test messages afterwards (they carry the process name neploadtest)
   Nothing on the server is changed except the test messages it stores. */
const dgram = require('node:dgram'), net = require('node:net'), fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : d; };

// ---------- sender (child process, so the counting side keeps its own CPU) ----------
if (arg('sender')) {
  const [proto, rate, secs, host, port, devices] = [arg('proto'), +arg('rate'), +arg('secs'), arg('host'), +arg('port'), +arg('devices', 3000)];
  const kinds = ['core-sw', 'dist-sw', 'acc-sw', 'fw', 'wlc', 'ups', 'pdu', 'srv', 'ntp', 'rtr'];
  const hosts = Array.from({ length: devices }, (_, i) => `lt-${kinds[i % kinds.length]}-${String(i).padStart(4, '0')}`);
  const T = [(h, n) => `<187>Nov 19 06:00:00 ${h} neploadtest: %LINK-3-UPDOWN: Interface GigabitEthernet1/0/${n % 48}, changed state to down`,
    (h, n) => `<189>Nov 19 06:00:00 ${h} neploadtest: %LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet1/0/${n % 48}, changed state to up`,
    (h, n) => `<190>Nov 19 06:00:00 ${h} neploadtest: %SEC-6-IPACCESSLOGP: list OUTSIDE denied tcp 10.${n % 250}.4.7(51544) -> 172.16.0.${n % 200}(443), 1 packet`,
    (h, n) => `<134>1 2026-11-19T06:00:00.000Z ${h} neploadtest 4121 - - Accepted publickey for netops from 10.20.${n % 250}.4 port 50122 ssh2`,
    (h, n) => `<131>1 2026-11-19T06:00:00.000Z ${h} neploadtest 0 FAN0105 - Fan redundancy is lost. Seq ${n}`,
    (h, n) => `<164>Nov 19 06:00:00 ${h} neploadtest: UPS: The battery charge is ${50 + n % 50} percent.`];
  const msg = (n) => T[n % T.length](hosts[(n * 7919) % devices], n);
  // a small SNMPv2c trap (linkDown) built by hand: community "public"
  const ber = (t, b) => { const l = b.length < 128 ? Buffer.from([b.length]) : b.length < 256 ? Buffer.from([0x81, b.length]) : Buffer.from([0x82, b.length >> 8, b.length & 255]); return Buffer.concat([Buffer.from([t]), l, b]); };
  const oid = (s) => { const p = s.split('.').map(Number), o = [40 * p[0] + p[1]]; for (const x of p.slice(2)) { const e = [x & 127]; let v = x >> 7; while (v) { e.unshift((v & 127) | 128); v >>= 7; } o.push(...e); } return ber(6, Buffer.from(o)); };
  const vb = (o, v) => ber(0x30, Buffer.concat([oid(o), v]));
  const trap = (n) => ber(0x30, Buffer.concat([ber(2, Buffer.from([1])), ber(4, Buffer.from('public')), ber(0xa7, Buffer.concat([ber(2, Buffer.from([n & 127])), ber(2, Buffer.from([0])), ber(2, Buffer.from([0])),
    ber(0x30, Buffer.concat([vb('1.3.6.1.2.1.1.3.0', ber(0x43, Buffer.from([1, 0]))), vb('1.3.6.1.6.3.1.1.4.1.0', oid('1.3.6.1.6.3.1.1.5.3')), vb('1.3.6.1.2.1.2.2.1.1.' + (n % 48 + 1), ber(2, Buffer.from([n % 48 + 1])))]))]))]));
  let sent = 0, n = 0; const t0 = Date.now(), end = t0 + secs * 1000;
  const done = () => { process.stdout.write(JSON.stringify({ sent, secs: (Date.now() - t0) / 1000 }) + '\n'); setTimeout(() => process.exit(0), 200); };
  if (proto === 'tcp') {
    const NS = 10, socks = []; let up = 0;
    for (let i = 0; i < NS; i++) socks.push(net.connect(port, host, () => { if (++up === NS) tick(); }));
    function tick() { const now = Date.now(); if (now >= end) { socks.forEach((s) => s.end()); return setTimeout(done, 500); } const want = Math.floor((now - t0) / 1000 * rate) - sent; for (let i = 0; i < want; i++) { const m = msg(n++); socks[n % NS].write(Buffer.byteLength(m) + ' ' + m); sent++; } setTimeout(tick, 5); }
  } else {
    const u = dgram.createSocket({ type: 'udp4', sendBufferSize: 8 * 1024 * 1024 }); let inflight = 0;
    const tick = () => { const now = Date.now(); if (now >= end) return setTimeout(done, 300); const want = Math.min(4000, Math.floor((now - t0) / 1000 * rate) - sent);
      for (let i = 0; i < want; i++) { const b = proto === 'trap' ? trap(n) : Buffer.from(msg(n)); n++; inflight++; u.send(b, port, host, () => { inflight--; }); sent++; } setTimeout(tick, inflight > 20000 ? 20 : 2); };
    tick();
  }
  return;
}

// ---------- controller ----------
const URL0 = String(arg('url', 'http://localhost:8514')).replace(/\/+$/, ''), TARGET = arg('target', new URL(URL0).hostname), SECS = +arg('secs', 30), DEV = +arg('devices', 3000);
const list = (k, d) => String(arg(k, d)).split(',').map(Number).filter((x) => x > 0);
const PLAN = [...list('steps', '1000,5000,10000,20000').map((r) => ['udp', r]), ...list('tcp-steps', '5000,20000').map((r) => ['tcp', r]), ...list('traps', '500,2000').map((r) => ['trap', r])];
const H = { 'content-type': 'application/json', 'X-Requested-With': 'NetEventPro' }; let cookie = '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, opts = {}) => { const t = Date.now(); const r = await fetch(URL0 + p, { ...opts, headers: { ...H, cookie, ...(opts.headers || {}) } }); const j = await r.json().catch(() => null); if (r.status === 401) throw new Error('Not signed in: check --user and --pass'); return { ms: Date.now() - t, j, status: r.status }; };
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : null; };
(async () => {
  if (arg('user')) { const r = await fetch(URL0 + '/api/login', { method: 'POST', headers: H, body: JSON.stringify({ username: arg('user'), password: String(arg('pass', '')) }) }); if (r.status !== 200) throw new Error('Sign-in failed (' + r.status + '): ' + ((await r.json().catch(() => ({}))).error || '')); cookie = (r.headers.get('set-cookie') || '').split(';')[0]; }
  const st0 = (await api('/api/state')).j; const ports = { udp: +arg('udp', st0.listeners.udp.port || 514), tcp: +arg('tcp', st0.listeners.tcp.port || 514), trap: +arg('snmp', st0.listeners.snmp.port || 162) };
  console.log(`NetEventPro ${st0.version} at ${URL0}, sending to ${TARGET} (UDP ${ports.udp}, TCP ${ports.tcp}, SNMP ${ports.trap}), ${DEV} devices, ${SECS} s per step`);
  const count = (L, proto) => (proto === 'trap' ? L.snmp.received : proto === 'tcp' ? L.tcp.packets : L.udp.packets);
  const results = [];
  for (const [proto, rate] of PLAN) {
    const L0 = (await api('/api/state')).j.listeners;
    const g = spawn(process.execPath, [__filename, '--sender', '1', '--proto', proto, '--rate', rate, '--secs', SECS, '--host', TARGET, '--port', ports[proto], '--devices', DEV]); let out = ''; g.stdout.on('data', (d) => out += d);
    const lat = { latest: [], search: [], dash: [], devices: [] }, cpu = [], mem = []; let running = true; g.on('exit', () => { running = false; });
    while (running) {
      lat.latest.push((await api('/api/logs?limit=500&countTotal=1')).ms);
      lat.search.push((await api('/api/logs?limit=500&text=' + encodeURIComponent('redundancy') + '&from=' + (Date.now() - 3600e3))).ms);
      lat.dash.push((await api('/api/dash', { method: 'POST', body: JSON.stringify({ from: Date.now() - 86400e3, to: Date.now(), tiles: [{ id: 'a', kind: 'count' }, { id: 'b', kind: 'series' }, { id: 'c', kind: 'top', by: 'host' }] }) })).ms);
      lat.devices.push((await api('/api/devices')).ms);
      const h = (await api('/api/health')).j; if (h?.system) { cpu.push(h.system.cpuPct); mem.push(h.system.rssMB); }
      await sleep(1000);
    }
    const sent = JSON.parse(out.trim().split('\n').pop()).sent; await sleep(3000);
    const L1 = (await api('/api/state')).j.listeners, got = count(L1, proto) - count(L0, proto);
    const r = { proto, rate, sent, received: got, lossPct: +(100 * Math.max(0, 1 - got / sent)).toFixed(2), cpuMax: Math.max(0, ...cpu), memMaxMB: Math.max(0, ...mem), p95: Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, pct(v, 0.95)])) };
    results.push(r); console.log(`${proto.toUpperCase().padEnd(4)} ${String(rate).padStart(6)}/s  sent ${sent}  received ${got}  lost ${r.lossPct}%  CPU max ${r.cpuMax}%  memory ${r.memMaxMB} MB  dashboard p95 ${r.p95.dash} ms`);
    await sleep(5000);
  }
  const hl = (await api('/api/health')).j; const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const md = [`# NetEventPro load test — ${new Date().toLocaleString()}`, '', `Server: NetEventPro ${st0.version}, ${hl?.system?.cores || '?'} CPU cores, platform ${hl?.system?.platform || '?'}, database ${hl?.db?.rows ?? '?'} messages (${hl?.db?.fileMB ?? '?'} MB).`,
    `Test: ${DEV} simulated devices, ${SECS} seconds per step, sent to ${TARGET}.`, '',
    '| Input | Rate /s | Sent | Received | Lost | CPU max | Memory max | Latest p95 | Search p95 | Dashboard 24 h p95 | Devices p95 |', '|---|---|---|---|---|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.proto} | ${r.rate} | ${r.sent} | ${r.received} | ${r.lossPct}% | ${r.cpuMax}% | ${r.memMaxMB} MB | ${r.p95.latest} ms | ${r.p95.search} ms | ${r.p95.dash} ms | ${r.p95.devices} ms |`), '',
    'Lost = sent minus received at the listener. Loss on UDP usually means the network buffer filled up: raise "UDP receive buffer" in Settings → Syslog inputs, or use TCP.',
    'Send this file (and loadtest-results.json) back for the sizing advice.'].join('\n');
  fs.writeFileSync(path.join(process.cwd(), `loadtest-results-${stamp}.md`), md); fs.writeFileSync(path.join(process.cwd(), 'loadtest-results.json'), JSON.stringify({ version: st0.version, devices: DEV, secs: SECS, results, health: hl }, null, 1));
  console.log(`\nReport written: loadtest-results-${stamp}.md`);
  if (arg('cleanup')) { const r = await api('/api/logs/delete', { method: 'POST', body: JSON.stringify({ matching: true, confirm: 'DELETE', q: { text: 'neploadtest' } }) }); console.log('Test messages deleted:', r.j?.deleted ?? r.j); }
})().catch((e) => { console.error('Stopped:', e.message); process.exit(1); });
