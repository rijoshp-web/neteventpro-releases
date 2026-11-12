'use strict';
// Traffic generator for trying out NetEventPro.
//   node test/send-test.js [--host 127.0.0.1] [--port 514] [--tcp] [--rate 20] [--count 0]
// rate = messages per second, count = 0 means run until Ctrl+C.
const dgram = require('node:dgram');
const net = require('node:net');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? (process.argv[i + 1] ?? true) : d; };
const host = arg('host', '127.0.0.1'), port = +arg('port', 514), tcp = process.argv.includes('--tcp');
const rate = +arg('rate', 20), count = +arg('count', 0);

const devices = [
  { name: 'core-sw1', ip: 'Cisco', msgs: [
    [5, 'LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet0/%d, changed state to up'],
    [3, 'LINK-3-UPDOWN: Interface GigabitEthernet0/%d, changed state to down'],
    [4, 'SPANTREE-4-BLOCK_PORT_TYPE: Blocking GigabitEthernet0/%d on VLAN0010'] ] },
  { name: 'ups-rack3', msgs: [[6, 'Input voltage %d V, load 41%'], [4, 'On battery power, runtime %d min'], [2, 'Battery low, shutdown imminent']] },
  { name: 'fw-edge', msgs: [[6, 'ALLOW tcp 10.0.%d.5:44211 -> 8.8.8.8:443'], [4, 'DENY udp 203.0.113.%d:5060 -> 10.0.0.9:5060'], [3, 'VPN tunnel to branch-%d is down']] },
  { name: 'srv-dc01', msgs: [[6, 'sshd[%d]: Accepted publickey for admin'], [5, 'cron[%d]: job finished'], [3, 'kernel: disk I/O error on sda%d']] }
];

let sock;
if (tcp) { sock = net.connect(port, host); sock.on('error', (e) => { console.error(e.message); process.exit(1); }); }
else sock = dgram.createSocket('udp4');

let sent = 0;
function one() {
  const d = devices[Math.floor(Math.random() * devices.length)];
  const [sev, tpl] = d.msgs[Math.floor(Math.random() * d.msgs.length)];
  const text = tpl.replace('%d', String(1 + Math.floor(Math.random() * 48)));
  const ts = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const m = `<${(16 + Math.floor(Math.random() * 3)) * 8 + sev}>1 ${ts} ${d.name} app ${1000 + (sent % 90)} - - ${text}`;
  if (tcp) sock.write(m + '\n'); else sock.send(Buffer.from(m), port, host);
  sent++;
  if (count && sent >= count) { setTimeout(() => { console.log('sent', sent); process.exit(0); }, 300); }
}
const perTick = Math.max(1, Math.round(rate / 20));
setInterval(() => { for (let i = 0; i < perTick; i++) { if (count && sent >= count) return; one(); } }, 1000 / (rate / perTick));
console.log(`sending ~${rate} msg/s to ${tcp ? 'tcp' : 'udp'}://${host}:${port} (Ctrl+C to stop)`);
