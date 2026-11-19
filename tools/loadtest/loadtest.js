'use strict';
/* NetEventPro load test for your own server (1.98.1). Sends realistic syslog and SNMP traps from thousands of simulated devices
   to a running NetEventPro, step by step, and writes a report: messages received or lost, the server's CPU and memory,
   and how quickly the dashboard and searches answered meanwhile.

   Run it on ANOTHER computer on the same network (so the test sender does not take the server's CPU), with Node.js 22:
     node loadtest.js --url http://nep-server:8514 --user admin --pass "your password" --target nep-server
   Options: --steps 1000,5000,10000,20000   messages per second per step     --secs 30   seconds per step
            --devices 3000   simulated devices   --udp 514 --tcp 514 --snmp 162   ports   --traps 500,2000   trap steps
            --tcp-steps 5000,20000           --cleanup   delete the test messages, traps and lt- devices afterwards
            --plain     only messages that alarm rules do not match (pure receiving speed); without it, 1 in 4 messages is a
                        link-down or fan alarm, as in real life, so your rules are tested too
            --insecure  accept the server's own (self-signed) https certificate
   Nothing on the server is changed except the test messages it stores. */
const dgram = require('node:dgram'), net = require('node:net'), fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
const arg0 = (k) => process.argv.includes('--' + k);
if (arg0('insecure')) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
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
  const P = [(h, n) => `<190>Nov 19 06:00:00 ${h} neploadtest: %SEC-6-IPACCESSLOGP: list INSIDE permitted tcp 10.${n % 250}.4.7(51544) -> 172.16.0.${n % 200}(443), 1 packet`,
    (h, n) => `<134>1 2026-11-19T06:00:00.000Z ${h} neploadtest 4121 - - Accepted publickey for netops from 10.20.${n % 250}.4 port 50122 ssh2`,
    (h, n) => `<190>Nov 19 06:00:00 ${h} neploadtest: DOT11-6-ASSOC: Station 3c22.fb91.${(n % 65536).toString(16)} Associated KEY_MGMT[WPA2 PSK]`,
    (h, n) => `<189>Nov 19 06:00:00 ${h} neploadtest: %SYS-5-CONFIG_I: Configured from console by netops on vty0 (10.0.0.${n % 250})`];
  const TT = arg('plain') ? P : T;
  const msg = (n) => TT[n % TT.length](hosts[(n * 7919) % devices], n);
  // a small SNMPv2c trap (linkDown) built by hand: community "public"
  const ber = (t, b) => { const l = b.length < 128 ? Buffer.from([b.length]) : b.length < 256 ? Buffer.from([0x81, b.length]) : Buffer.from([0x82, b.length >> 8, b.length & 255]); return Buffer.concat([Buffer.from([t]), l, b]); };
  const oid = (s) => { const p = s.split('.').map(Number), o = [40 * p[0] + p[1]]; for (const x of p.slice(2)) { const e = [x & 127]; let v = x >> 7; while (v) { e.unshift((v & 127) | 128); v >>= 7; } o.push(...e); } return ber(6, Buffer.from(o)); };
  const vb = (o, v) => ber(0x30, Buffer.concat([oid(o), v]));
  const trap = (n) => ber(0x30, Buffer.concat([ber(2, Buffer.from([1])), ber(4, Buffer.from('public')), ber(0xa7, Buffer.concat([ber(2, Buffer.from([n & 127])), ber(2, Buffer.from([0])), ber(2, Buffer.from([0])),
    ber(0x30, Buffer.concat([vb('1.3.6.1.2.1.1.3.0', ber(0x43, Buffer.from([1, 0]))), vb('1.3.6.1.6.3.1.1.4.1.0', oid('1.3.6.1.6.3.1.1.5.3')), vb('1.3.6.1.2.1.2.2.1.1.' + (n % 48 + 1), ber(2, Buffer.from([n % 48 + 1]))), vb('1.3.6.1.2.1.1.6.0', ber(4, Buffer.from('neploadtest')))]))]))]));
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
    const g = spawn(process.execPath, [__filename, '--sender', '1', '--proto', proto, '--rate', rate, '--secs', SECS, '--host', TARGET, '--port', ports[proto], '--devices', DEV, ...(arg0('plain') ? ['--plain', '1'] : [])]); let out = ''; g.stdout.on('data', (d) => out += d);
    const lat = { latest: [], search: [], dash: [], devices: [] }, cpu = [], mem = []; let running = true; g.on('exit', () => { running = false; });
    while (running) {
      lat.latest.push((await api('/api/logs?limit=500&countTotal=1')).ms);
      lat.search.push((await api('/api/logs?limit=500&text=' + encodeURIComponent('redundancy') + '&from=' + (Date.now() - 3600e3))).ms);
      lat.dash.push((await api('/api/dash', { method: 'POST', body: JSON.stringify({ from: Date.now() - 86400e3, to: Date.now(), tiles: [{ id: 'a', kind: 'count' }, { id: 'b', kind: 'series' }, { id: 'c', kind: 'top', by: 'host' }] }) })).ms);
      lat.devices.push((await api('/api/devices')).ms);
      const h = (await api('/api/health')).j; if (h?.system) { cpu.push(h.system.cpuPct); mem.push(h.system.rssMB); }
      await sleep(1000);
    }
    const sent = JSON.parse(out.trim().split('\n').pop()).sent;
    // wait until the server has caught up: its counter stops rising and nothing waits to be stored (a server that is behind is not losing yet)
    let last = -1, still = 0, changedAt = 0; const tEnd = Date.now();
    for (;;) { await sleep(1000); const L = (await api('/api/state')).j.listeners, h = (await api('/api/health')).j, c = count(L, proto); const q = h?.db?.queue || 0;
      if (last >= 0 && (c !== last || q > 0)) changedAt = Date.now();
      if (c === last && q === 0) { if (++still >= 3) break; } else still = 0; last = c; if (Date.now() - tEnd > 180000) break; }
    const behindSec = changedAt ? Math.round((changedAt - tEnd) / 1000) : 0;
    const L1 = (await api('/api/state')).j.listeners, got = count(L1, proto) - count(L0, proto);
    const cores = (await api('/api/health')).j?.system?.cores || 1, core = Math.round(Math.max(0, ...cpu) * cores);
    const r = { proto, rate, sent, received: got, lossPct: +(100 * Math.max(0, 1 - got / sent)).toFixed(2), behindSec, cpuMax: Math.max(0, ...cpu), oneCorePct: Math.min(100, core), memMaxMB: Math.max(0, ...mem), p95: Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, pct(v, 0.95)])) };
    results.push(r); console.log(`${proto.toUpperCase().padEnd(4)} ${String(rate).padStart(6)}/s  sent ${sent}  received ${got}  lost ${r.lossPct}%${behindSec ? `  (caught up ${behindSec} s after the step: too fast for this server)` : ''}  CPU ${r.cpuMax}% of all = about ${r.oneCorePct}% of one core${r.oneCorePct >= 90 ? ' (FULL)' : ''}  memory ${r.memMaxMB} MB  dashboard p95 ${r.p95.dash} ms`);
    await sleep(5000);
  }
  const hl = (await api('/api/health')).j; const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const md = [`# NetEventPro load test — ${new Date().toLocaleString()}`, '', `Server: NetEventPro ${st0.version}, ${hl?.system?.cores || '?'} CPU cores, platform ${hl?.system?.platform || '?'}, database ${hl?.db?.rows ?? '?'} messages (${hl?.db?.fileMB ?? '?'} MB).`,
    `Test: ${DEV} simulated devices, ${SECS} seconds per step, sent to ${TARGET}.`, '',
    `Messages: ${arg0('plain') ? 'plain (no alarm-rule matches)' : 'realistic (1 in 4 is a link-down or fan alarm, so alarm rules are tested too)'}.`, '',
    '| Input | Rate /s | Sent | Received | Lost | Caught up after | CPU (one core) | Memory max | Latest p95 | Search p95 | Dashboard 24 h p95 | Devices p95 |', '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.proto} | ${r.rate} | ${r.sent} | ${r.received} | ${r.lossPct}% | ${r.behindSec ? r.behindSec + ' s' : 'at once'} | ${r.oneCorePct}% | ${r.memMaxMB} MB | ${r.p95.latest} ms | ${r.p95.search} ms | ${r.p95.dash} ms | ${r.p95.devices} ms |`), '',
    'NetEventPro takes in messages on one processor core. "Caught up after" means the server was still working through a queue after the step ended: that rate is more than it can keep up with for long.',
    'Lost = sent minus received at the listener. Loss on UDP usually means the network buffer filled up: raise "UDP receive buffer" in Settings → Syslog inputs, or use TCP.',
    'Send this file (and loadtest-results.json) back for the sizing advice.'].join('\n');
  fs.writeFileSync(path.join(process.cwd(), `loadtest-results-${stamp}.md`), md); fs.writeFileSync(path.join(process.cwd(), 'loadtest-results.json'), JSON.stringify({ version: st0.version, devices: DEV, secs: SECS, results, health: hl }, null, 1));
  console.log(`\nReport written: loadtest-results-${stamp}.md`);
  if (arg('cleanup')) {
    let total = 0; for (const source of ['syslog', 'snmp']) for (let i = 0; i < 20; i++) { const r = await api('/api/logs/delete', { method: 'POST', body: JSON.stringify({ matching: true, confirm: 'DELETE', q: { text: 'neploadtest', source } }) }); const n = +(r.j?.deleted ?? 0); total += n; if (!n) break; await sleep(2000); }
    const devs = (await api('/api/devices')).j || []; let gone = 0; for (const d of devs) if (/^lt-/.test(d.host || d.key || '')) { await api('/api/device/forget', { method: 'POST', body: JSON.stringify({ key: d.key }) }); gone++; }
    console.log(`Cleaned up: ${total} test messages and traps, ${gone} test devices. Alarms raised for lt- devices are cleared on the Alarms page.`);
  }
})().catch((e) => {
  const c = e.cause || {}, why = c.code === 'ECONNREFUSED' ? `nothing answers at ${URL0} — check the address and port you open in the browser` : c.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || c.code === 'SELF_SIGNED_CERT_IN_CHAIN' || /certificate/i.test(c.message || '') ? 'the server uses its own https certificate — add --insecure' : c.code === 'ECONNRESET' || /wrong version|EPROTO/i.test(c.code + (c.message || '')) ? 'try https:// instead of http:// (or the other way round)' : (c.message || '');
  console.error('Stopped:', e.message + (why ? ' — ' + why : '')); process.exit(1);
});
