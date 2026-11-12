'use strict';
// Alarm test generator. Sends "problem" and "recovered" syslog messages in the order a real device would, so you can watch the
// Alarms page raise, count and auto-clear alarms.
//
// Prepare once: Rules & alerts -> "Add from template" -> add these four pairs (each adds an alarm rule and its recovery rule), then Save rules:
//   Alarm: link down - cleared by link up | Alarm: mains failure - cleared when restored
//   Alarm: routing neighbour down - cleared when up | Alarm: communication lost - cleared when restored
//
// Run:   node test/send-alarm-test.js [--target 127.0.0.1] [--port 514] [--tcp] [--delay 6] [--scenario 1,3 | all]
const dgram = require('node:dgram');
const net = require('node:net');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? (process.argv[i + 1] ?? true) : d; };
const target = String(arg('target', '127.0.0.1')), port = +arg('port', 514), useTcp = process.argv.includes('--tcp'), delay = +arg('delay', 6) * 1000;
const pick = String(arg('scenario', 'all'));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${MON[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const msg = (sev, host, text) => `<${23 * 8 + sev}>${stamp()} ${host} ${text}`;
const CISCO = (host, ifn, state) => msg(state === 'down' ? 3 : 5, host, `%LINK-3-UPDOWN: Interface ${ifn}, changed state to ${state}`);

// each step: [what you should see afterwards, message]
const SCENARIOS = [
  { n: 1, title: 'Link down, repeated, then link up on the same device  ->  ONE alarm (count 3), then auto-cleared', steps: [
    ['Alarm "Link down (alarm)" on SW-TEST-01 appears (Open, count 1)', CISCO('SW-TEST-01', 'GigabitEthernet0/1', 'down')],
    ['Count goes to 2', CISCO('SW-TEST-01', 'GigabitEthernet0/1', 'down')], ['Count goes to 3 (still one line)', CISCO('SW-TEST-01', 'GigabitEthernet0/1', 'down')],
    ['Alarm is CLEARED automatically ("auto: Link up (clears alarm)")', CISCO('SW-TEST-01', 'GigabitEthernet0/1', 'up')]] },
  { n: 2, title: 'Mains failure then mains restored on an Eltek power plant  ->  alarm raised, then auto-cleared', steps: [
    ['Alarm "Mains failure (alarm)" on ELTEK-RECT-01', msg(2, 'ELTEK-RECT-01', 'SmartPack: Mains failure')],
    ['Alarm cleared automatically', msg(5, 'ELTEK-RECT-01', 'SmartPack: Mains OK')]] },
  { n: 3, title: 'OSPF neighbour down then up  ->  alarm raised, then auto-cleared', steps: [
    ['Alarm "Routing neighbour down (alarm)" on RTR-TEST-01', msg(5, 'RTR-TEST-01', '%OSPF-5-ADJCHG: Process 1, Nbr 10.1.1.2 on GigabitEthernet0/0 from FULL to DOWN, Neighbor Down: Dead timer expired')],
    ['Alarm cleared automatically', msg(5, 'RTR-TEST-01', '%OSPF-5-ADJCHG: Process 1, Nbr 10.1.1.2 on GigabitEthernet0/0 from LOADING to FULL, Loading Done')]] },
  { n: 4, title: 'APC UPS communication lost then restored  ->  alarm raised, then auto-cleared', steps: [
    ['Alarm "Communication lost (alarm)" on APC-UPS-01', msg(4, 'APC-UPS-01', 'apc: Communication lost with the UPS')],
    ['Alarm cleared automatically', msg(5, 'APC-UPS-01', 'apc: Communication established with the UPS')]] },
  { n: 5, title: 'Recovery arrives from a DIFFERENT device  ->  the alarm must STAY open (clearing is per device)', steps: [
    ['Alarm on SW-TEST-02 appears', CISCO('SW-TEST-02', 'GigabitEthernet0/5', 'down')],
    ['SW-TEST-02 alarm is NOT cleared (the "up" came from SW-TEST-03)', CISCO('SW-TEST-03', 'GigabitEthernet0/5', 'up')]] },
  { n: 6, title: 'KNOWN LIMIT: two ports down on one device, one comes back  ->  the single alarm is cleared although Gi0/2 is still down', steps: [
    ['One alarm on SW-TEST-04 (Gi0/1)', CISCO('SW-TEST-04', 'GigabitEthernet0/1', 'down')],
    ['Same alarm, count 2 (Gi0/2 also down)', CISCO('SW-TEST-04', 'GigabitEthernet0/2', 'down')],
    ['Alarm clears even though Gi0/2 is still down: alarms are per rule and device, not per port', CISCO('SW-TEST-04', 'GigabitEthernet0/1', 'up')]] },
  { n: 7, title: 'Problem that never recovers  ->  stays Open: use it to test Acknowledge, notes, manual Clear and escalation', steps: [
    ['Alarm on SW-OPEN-01 stays Open until you act', CISCO('SW-OPEN-01', 'GigabitEthernet0/9', 'down')]] }
];

const wanted = pick === 'all' ? SCENARIOS : SCENARIOS.filter((s) => pick.split(',').map((x) => +x.trim()).includes(s.n));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!wanted.length) { console.error('No such scenario. Use --scenario 1,2 or all.'); process.exit(1); }
  let send, close = () => {};
  if (useTcp) {
    const sock = net.connect(port, target); await new Promise((res, rej) => { sock.once('connect', res); sock.once('error', rej); });
    send = (m) => new Promise((r) => sock.write(m + '\n', r)); close = () => sock.end();
  } else {
    const s = dgram.createSocket('udp4'); send = (m) => new Promise((r, j) => s.send(Buffer.from(m), port, target, (e) => (e ? j(e) : r()))); close = () => s.close();
  }
  console.log(`Sending to ${target}:${port} over ${useTcp ? 'TCP' : 'UDP'}, ${delay / 1000} s between messages. Keep the Alarms page open.\n`);
  for (const sc of wanted) {
    console.log(`\n=== Scenario ${sc.n}: ${sc.title}`);
    for (const [expect, m] of sc.steps) { await send(m); console.log(`  sent  : ${m}\n  expect: ${expect}`); await sleep(delay); }
  }
  console.log('\nDone. Alarms still Open now (should be only scenario 5: SW-TEST-02, and scenario 7: SW-OPEN-01).');
  close();
}
main().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
