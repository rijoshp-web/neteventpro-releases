'use strict';
// SNMP trap test generator. Sends v2c traps, a v1 trap and an inform to NetEventPro so you can see names resolved from MIB files and
// alarms raised and cleared.
//
// Run:  node test/send-trap-test.js [--target 127.0.0.1] [--port 162] [--community public] [--delay 5] [--scenario 1,2 | all] [--mib-loaded]
//       Windows with the installed app (no separate Node needed):
//       & "C:\Program Files\NetEventPro\node\node.exe" send-trap-test.js --target 127.0.0.1 --delay 5
//
// Upload test/NETEVENTPRO-TEST-MIB.mib on the SNMP page first for scenarios 3 and 4 (otherwise those show numbers, which is also a useful test).
// For scenarios 1 and 2 to raise/clear alarms add the "link down / link up" template pair in Rules & alerts. Traps carry the tags
// link-down / link-up, so the same rules that work for syslog work for traps.
const dgram = require('node:dgram');
const { buildV1, buildV2, decodeMessage } = require('../src/ber');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? (process.argv[i + 1] ?? true) : d; };
const target = String(arg('target', '127.0.0.1')), port = +arg('port', 162), community = String(arg('community', 'public')), delay = +arg('delay', 5) * 1000, pick = String(arg('scenario', 'all'));
const IF = (n) => ({ idx: { oid: `1.3.6.1.2.1.2.2.1.1.${n}`, type: 'integer', value: n }, descr: (s) => ({ oid: `1.3.6.1.2.1.2.2.1.2.${n}`, type: 'octets', value: s }), adm: (v) => ({ oid: `1.3.6.1.2.1.2.2.1.7.${n}`, type: 'integer', value: v }), oper: (v) => ({ oid: `1.3.6.1.2.1.2.2.1.8.${n}`, type: 'integer', value: v }) });
const link = (up, name, n) => { const i = IF(n); return buildV2({ community, trapOid: up ? '1.3.6.1.6.3.1.1.5.4' : '1.3.6.1.6.3.1.1.5.3', uptime: Math.floor(process.uptime() * 100), varbinds: [i.idx, i.descr(name), i.adm(1), i.oper(up ? 1 : 2)] }); };
const SP = '1.3.6.1.4.1.99999';
const sp = (trap, state, loc) => buildV2({ community, trapOid: `${SP}.2.${trap}`, uptime: Math.floor(process.uptime() * 100), varbinds: [{ oid: `${SP}.1.1.0`, type: 'integer', value: state }, { oid: `${SP}.1.3.0`, type: 'octets', value: loc }] });

const DELL = '1.3.6.1.4.1.674.10892.5.3';   // Dell iDRAC alertGroup (alertCurrentStatus = 1.3.0, as in the IDRAC-MIB-SMIv2 module)
const idrac = (status, msg) => buildV2({ community, trapOid: `${DELL}.2.1.0.2473`, uptime: Math.floor(process.uptime() * 100), varbinds: [{ oid: `${DELL}.1.1.0`, type: 'octets', value: 'iDRAC-TEST-01' }, { oid: `${DELL}.1.2.0`, type: 'octets', value: msg }, { oid: `${DELL}.1.3.0`, type: 'integer', value: status }] });

const SCENARIOS = [
  { n: 1, title: 'Standard linkDown (v2c) then linkUp  ->  alarm raised, then cleared', steps: [
    ['linkDown, severity error, tags link-down and if:Gi0/1', link(false, 'GigabitEthernet0/1', 3)], ['linkUp clears the alarm', link(true, 'GigabitEthernet0/1', 3)]] },
  { n: 2, title: 'SNMPv1 trap (old equipment): generic linkDown, then coldStart', steps: [
    ['v1 linkDown is shown like the v2c one (v1 numbers converted)', buildV1({ community, enterprise: '1.3.6.1.4.1.8072', agentAddr: '10.0.0.9', generic: 2, uptime: 500, varbinds: [IF(7).idx, IF(7).descr('Fa0/7')] })],
    ['coldStart (device restarted)', buildV1({ community, enterprise: '1.3.6.1.4.1.8072', agentAddr: '10.0.0.9', generic: 0, uptime: 10 })]] },
  { n: 3, title: 'Vendor trap from the sample MIB  ->  names and "mains(1)/battery(2)" come from the MIB', steps: [
    ['spPowerLost, spPowerState.0 = battery(2), severity error ("Lost")', sp(1, 2, 'Rack 4, Dubai DC')],
    ['spPowerRestored, severity notice', sp(2, 1, 'Rack 4, Dubai DC')]] },
  { n: 4, title: 'Vendor trap with a threshold wording  ->  severity warning', steps: [
    ['spTemperatureHigh with spTemperature.0 = 41', buildV2({ community, trapOid: `${SP}.2.3`, uptime: 100, varbinds: [{ oid: `${SP}.1.2.0`, type: 'integer', value: 41 }, { oid: `${SP}.1.3.0`, type: 'octets', value: 'Rack 4' }] })]] },
  { n: 5, title: 'Trap whose MIB is not loaded  ->  stays numeric and appears under "MIBs still needed" on the SNMP page', steps: [
    ['"Unknown trap 1.3.6.1.4.1.77777.0.1" and vendor 77777 in the missing-MIB list', buildV2({ community, trapOid: '1.3.6.1.4.1.77777.0.1', uptime: 5, varbinds: [{ oid: '1.3.6.1.4.1.77777.1.1.0', type: 'integer', value: 3 }, { oid: '1.3.6.1.4.1.77777.1.2.0', type: 'octets', value: 'hello' }] })]] },
  { n: 7, title: 'Dell iDRAC style trap: alertCurrentStatus = 5 (critical), then 4 (nonCritical), then 3 (ok)  ->  check the Severity column', steps: [
    ['alertGroup.1.3.0 = 5: critical (word shows only if IDRAC-MIB-SMIv2 is loaded; otherwise add the rule 1.3.0: 5=critical)', idrac(5, 'The system board battery is low.')],
    ['alertGroup.1.3.0 = 4: nonCritical -> warning', idrac(4, 'The fan redundancy is lost.')],
    ['alertGroup.1.3.0 = 3: ok -> never sets a severity by itself', idrac(3, 'The power supply redundancy is restored.')]] },
  { n: 6, title: 'Inform (needs an answer)  ->  NetEventPro replies and the message appears once', steps: [
    ['inform for spPowerLost, reply expected', 'inform'], ] }
];

const sock = dgram.createSocket('udp4');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (b) => new Promise((res, rej) => sock.send(b, port, target, (e) => (e ? rej(e) : res())));

async function sendInform() {
  const pkt = buildV2({ community, trapOid: `${SP}.2.1`, inform: true, requestId: 4242, uptime: 100, varbinds: [{ oid: `${SP}.1.1.0`, type: 'integer', value: 2 }, { oid: `${SP}.1.3.0`, type: 'octets', value: 'Rack 9' }] });
  const reply = new Promise((resolve) => { const t = setTimeout(() => resolve(null), 3000); sock.once('message', (b) => { clearTimeout(t); resolve(b); }); });
  await send(pkt); const r = await reply;
  if (!r) return '  reply : none within 3 s (is "Reply to informs" on, and is the community accepted?)';
  try { const ok = r[r.indexOf(0xa2)] === 0xa2 && r.includes(Buffer.from([0x02, 0x02, 0x10, 0x92])); return `  reply : received ${r.length} bytes (GetResponse, request id 4242 ${ok ? 'echoed' : 'NOT echoed'})`; } catch { return '  reply : received'; }
}

(async () => {
  const wanted = pick === 'all' ? SCENARIOS : SCENARIOS.filter((s) => pick.split(',').map((x) => +x.trim()).includes(s.n));
  if (!wanted.length) { console.error('No such scenario. Use --scenario 1,2 or all.'); process.exit(1); }
  console.log(`Sending SNMP traps to ${target}:${port}, community "${community}", ${delay / 1000} s between traps. Keep the Logs page open (search: snmp).\n`);
  for (const sc of wanted) {
    console.log(`=== Scenario ${sc.n}: ${sc.title}`);
    for (const [expect, pkt] of sc.steps) {
      if (pkt === 'inform') console.log(`  sent  : inform (request id 4242)\n  expect: ${expect}\n${await sendInform()}`);
      else { await send(pkt); const t = decodeMessage(pkt); console.log(`  sent  : SNMPv${t.version === 1 ? 1 : '2c'} ${t.kind}, ${t.varbinds.length} variables\n  expect: ${expect}`); }
      await sleep(delay);
    }
    console.log('');
  }
  sock.close(); console.log('Done.');
})().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
