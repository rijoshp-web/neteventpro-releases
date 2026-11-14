#!/usr/bin/env node
'use strict';
/* A fake SNMP device to try NetEventPro polling on one computer, with no real equipment.
 *   node tools/fake-device.js                 -> listens on UDP 1161, community "public", SNMP v1 / v2c
 *   node tools/fake-device.js --port 1162     -> a second device (start one process per device)
 *   node tools/fake-device.js --host 0.0.0.0  -> reachable from other PCs (default: this PC only)
 *   node tools/fake-device.js --addresses 200 -> 200 devices on 127.0.1.1 - 127.0.1.200 (for a capacity test on one computer)
 * Type a command in this window while it runs:  hot | cool | critical | down <n> | up <n> | status | help | quit
 * It is a test tool: it answers the same questions a real device does, but it is not a real device. */
const { startAgent } = require('../test/fake-snmp-agent');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const port = +opt('port', 1161), host = opt('host', '127.0.0.1');

const SYS = '1.3.6.1.2.1.1', IF = '1.3.6.1.2.1.2.2.1', IFX = '1.3.6.1.2.1.31.1.1.1', ENT = '1.3.6.1.4.1.99999';
const ifs = ['GigabitEthernet1/0/1', 'GigabitEthernet1/0/2', 'GigabitEthernet1/0/3', 'Vlan1'];
const rooms = ['Room A', 'Room B', 'Room C', 'Room D'];
const st = { up: [1, 1, 2, 1], inO: [5e9, 1e6, 0, 2e8], outO: [3e9, 2e6, 0, 1e8], temp: [22, 6, 6, 6], cpu: 12, ticks: 17 * 24 * 360000 };
const code = (t) => (t >= 40 ? 3 : t >= 30 ? 2 : 1);   /* 1 = normal, 2 = high, 3 = critical */
const mib = () => {
  const m = [[`${SYS}.1.0`, 'octets', 'Fake NetEventPro test device'], [`${SYS}.3.0`, 'timeticks', st.ticks], [`${SYS}.5.0`, 'octets', 'FAKE-DEVICE-1'], [`${SYS}.2.0`, 'oid', '1.3.6.1.4.1.99999'],
    ['1.3.6.1.4.1.9.9.109.1.1.1.1.8.1', 'gauge32', st.cpu]];
  ifs.forEach((n, i) => { const x = i + 1; m.push([`${IF}.2.${x}`, 'octets', n], [`${IF}.8.${x}`, 'integer', st.up[i]], [`${IFX}.1.${x}`, 'octets', n], [`${IFX}.6.${x}`, 'counter64', st.inO[i]], [`${IFX}.10.${x}`, 'counter64', st.outO[i]], [`${IF}.14.${x}`, 'counter32', 0], [`${IF}.20.${x}`, 'counter32', 0]); });
  rooms.forEach((n, i) => { const x = i + 1; m.push([`${ENT}.1.1.1.${x}`, 'octets', n], [`${ENT}.1.1.2.${x}`, 'integer', st.temp[i]], [`${ENT}.1.1.3.${x}`, 'integer', code(st.temp[i])]); });
  for (let n = 1; n <= 16; n++) m.push([`${ENT}.2.${n}.0`, 'integer', 10 * n + (n % 3)]);   /* 16 more single values, for a test with 20 readings per device */
  return m;
};
const many = +opt('addresses', 0);   /* --addresses 200: answer on 127.0.1.1 ... 127.0.1.200 (each from its own address) to try 200 devices on one computer */
(async () => {
  const extra = []; if (many > 1) for (let i = 0; i < Math.min(many, 1000); i++) extra.push(await startAgent({ mib: mib(), port, host: `127.0.${1 + Math.floor(i / 250)}.${(i % 250) + 1}` }).catch(() => null));
  if (many > 1) { console.log(`${extra.filter(Boolean).length} fake devices answer on 127.0.1.1 upwards (250 per third number: 127.0.1.x, 127.0.2.x ...), port ${port}. Add them in NetEventPro with those host addresses.`); }
  const ag = many > 1 ? { set: (o, v) => extra.forEach((e) => e && e.set(o, v)), seen: { requests: 0 } } : await startAgent({ mib: mib(), port, host });
  const push = () => { for (const [o, , v] of mib()) ag.set(o, v); };
  setInterval(() => {   /* the device lives: time passes, traffic flows, the temperature drifts a little */
    st.ticks += 1000; st.cpu = Math.max(2, Math.min(95, Math.round(st.cpu + (Math.random() - 0.5) * 8)));
    ifs.forEach((_, i) => { if (st.up[i] === 1) { st.inO[i] += Math.round(Math.random() * 4e6); st.outO[i] += Math.round(Math.random() * 2e6); } });
    st.temp = st.temp.map((t, i) => (i === 0 ? t : Math.max(4, Math.min(60, t + Math.round((Math.random() - 0.5) * 2))))); push();
  }, 5000).unref();
  console.log(`Fake device listening on ${host}:${port} (UDP, SNMP v1/v2c, community "public").\nAdd it in NetEventPro -> SNMP polling -> Add device: host 127.0.0.1, port ${port}, v2c, community public.\nTable of 4 rows: ${ENT}.1.1.2 (value) with names in ${ENT}.1.1.1 and a status code in ${ENT}.1.1.3 (1 normal, 2 high, 3 critical).\nCommands: hot | cool | critical | down <n> | up <n> | status | quit`);
  const help = () => console.log('hot (Room A 33) | critical (Room A 45) | cool (Room A 22) | down <1-4> | up <1-4> | status | quit');
  require('node:readline').createInterface({ input: process.stdin }).on('line', (l) => {
    const [c, n] = l.trim().toLowerCase().split(/\s+/), i = (+n || 0) - 1;
    if (c === 'hot') st.temp[0] = 33; else if (c === 'critical') st.temp[0] = 45; else if (c === 'cool') st.temp[0] = 22;
    else if ((c === 'down' || c === 'up') && i >= 0 && i < ifs.length) st.up[i] = c === 'down' ? 2 : 1;
    else if (c === 'quit' || c === 'exit') process.exit(0); else if (c === 'status') console.log(JSON.stringify({ temps: st.temp, interfaces: st.up.map((u, k) => `${ifs[k]}=${u === 1 ? 'up' : 'down'}`), cpu: st.cpu, requests: ag.seen.requests })); else if (c) help();
    push();
  });
})();
