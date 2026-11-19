#!/usr/bin/env node
'use strict';
// NetEventPro SNMP device simulator: 20 kinds of network and power equipment on one computer, each on its own UDP port,
// answering SNMP v1 and v2c (GET, GETNEXT, GETBULK) with values that change over time. Nothing to install: Node.js 22 only.
//
//   node snmpsim.js                          start all devices on ports 16101 ... (community: public)
//   node snmpsim.js --add http://NEP:8514 --user admin --pass "..."   also add them, with their readings, to NetEventPro
//   node snmpsim.js --remove http://NEP:8514 --user admin --pass "..." remove the devices it added (names start with "SIM ")
//   options: --host 0.0.0.0 (listen on all addresses, default) or 127.0.0.1, --base 16101, --community public, --insecure
//
// Standard values use the standard MIBs (system, IF-MIB, HOST-RESOURCES-MIB, UPS-MIB). Equipment-specific values use the
// enterprise number 32473, which IANA reserves for examples and documentation, so nothing pretends to be a real product.
// readings.md (written next to this file) lists every device with the readings to add, if you prefer adding them by hand.
const dgram = require('node:dgram'); const fs = require('node:fs'); const path = require('node:path');

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2); const arg = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const HOST = arg('host', '0.0.0.0'), BASE = +arg('base', 16101), COMM = String(arg('community', 'public'));
if (arg('insecure')) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// ---------------------------------------------------------------- BER (the SNMP encoding)
const T = { INT: 0x02, OCT: 0x04, NULL: 0x05, OID: 0x06, SEQ: 0x30, IP: 0x40, C32: 0x41, G32: 0x42, TT: 0x43, C64: 0x46, NSO: 0x80, NSI: 0x81, EOM: 0x82 };
const len = (n) => (n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]));
const tlv = (t, v) => Buffer.concat([Buffer.from([t]), len(v.length), v]);
function encInt(n) { n = BigInt(Math.trunc(Number(n))); const b = []; for (;;) { b.unshift(Number(n & 255n)); const done = (n >= -128n && n <= 127n); n >>= 8n; if (done) break; } return Buffer.from(b); }
function encUns(n) { n = BigInt(Math.max(0, Math.trunc(Number(n)))); const b = []; do { b.unshift(Number(n & 255n)); n >>= 8n; } while (n > 0n); if (b[0] & 0x80) b.unshift(0); return Buffer.from(b); }
function encOid(a) { const out = [40 * a[0] + a[1]]; for (const x of a.slice(2)) { const s = []; let v = x; do { s.unshift(v & 127); v = Math.floor(v / 128); } while (v > 0); for (let i = 0; i < s.length - 1; i++) s[i] |= 128; out.push(...s); } return Buffer.from(out); }
function read(buf, i) { const t = buf[i]; let l = buf[i + 1], h = 2; if (l & 0x80) { const n = l & 127; l = 0; for (let k = 0; k < n; k++) l = l * 256 + buf[i + 2 + k]; h = 2 + n; } return { t, s: i + h, e: i + h + l }; }
function decInt(buf, s, e) { let v = BigInt(buf[s] & 0x80 ? -1 : 0); for (let i = s; i < e; i++) v = (v << 8n) | BigInt(buf[i]); return BigInt.asIntN(64, v); }
function decOid(buf, s, e) { const a = [Math.floor(buf[s] / 40), buf[s] % 40]; let v = 0; for (let i = s + 1; i < e; i++) { v = v * 128 + (buf[i] & 127); if (!(buf[i] & 128)) { a.push(v); v = 0; } } return a; }
const oid = (s) => s.split('.').filter(Boolean).map(Number);
const cmp = (a, b) => { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; };
function encVal(v) {
  switch (v.type) {
    case 'int': return tlv(T.INT, encInt(v.value)); case 'str': return tlv(T.OCT, Buffer.isBuffer(v.value) ? v.value : Buffer.from(String(v.value)));
    case 'oid': return tlv(T.OID, encOid(oid(v.value))); case 'c32': return tlv(T.C32, encUns(Number(BigInt(Math.trunc(v.value)) & 0xffffffffn)));
    case 'g32': return tlv(T.G32, encUns(Math.max(0, Math.min(4294967295, v.value)))); case 'tt': return tlv(T.TT, encUns(v.value % 4294967296));
    case 'c64': return tlv(T.C64, encUns(v.value)); case 'ip': return tlv(T.IP, Buffer.from(String(v.value).split('.').map(Number)));
    default: return tlv(T.NULL, Buffer.alloc(0));
  }
}

// ---------------------------------------------------------------- values that move
const t0 = Date.now(), up = () => Math.floor((Date.now() - t0) / 10) + 8640000 * 3;      // uptime in hundredths of a second (starts at 3 days)
const wave = (mid, amp, periodS, phase = 0) => mid + amp * Math.sin((Date.now() / 1000 / periodS) * 2 * Math.PI + phase);
const jit = (x, j) => x + (Math.random() * 2 - 1) * j;
const step = (periodS, n) => Math.floor(Date.now() / 1000 / periodS) % n;                 // changes every periodS seconds, n states
const counter = (rate, phase = 0) => () => Math.floor(((Date.now() - t0) / 1000) * rate * (1 + 0.3 * Math.sin(Date.now() / 60000 + phase)) + phase * 1e7);

// ---------------------------------------------------------------- building blocks
const S = (o, type, f) => [o, type, f];                   // f: a value or a function returning one
const E = '1.3.6.1.4.1.32473';                            // the documentation enterprise number
function system(descr, model, name, loc) { return [S('1.3.6.1.2.1.1.1.0', 'str', descr), S('1.3.6.1.2.1.1.2.0', 'oid', `${E}.${model}`), S('1.3.6.1.2.1.1.3.0', 'tt', up), S('1.3.6.1.2.1.1.4.0', 'str', 'noc@example.net'), S('1.3.6.1.2.1.1.5.0', 'str', name), S('1.3.6.1.2.1.1.6.0', 'str', loc), S('1.3.6.1.2.1.1.7.0', 'int', 72)]; }
function interfaces(list) {      // list: [name, speed Mbit/s, up?, rate bytes/s]
  const out = [S('1.3.6.1.2.1.2.1.0', 'int', list.length)];
  list.forEach(([name, mbit, isUp, rate], i) => {
    const n = i + 1, c = (r, ph) => counter(isUp ? r : 0, ph); const inC = c(rate, n), outC = c(rate * 0.6, n + 50);
    const err = () => (isUp && n % 7 === 0 ? Math.floor((Date.now() - t0) / 30000) : 0);
    out.push(S(`1.3.6.1.2.1.2.2.1.1.${n}`, 'int', n), S(`1.3.6.1.2.1.2.2.1.2.${n}`, 'str', name), S(`1.3.6.1.2.1.2.2.1.3.${n}`, 'int', 6), S(`1.3.6.1.2.1.2.2.1.5.${n}`, 'g32', Math.min(4294967295, mbit * 1e6)),
      S(`1.3.6.1.2.1.2.2.1.7.${n}`, 'int', 1), S(`1.3.6.1.2.1.2.2.1.8.${n}`, 'int', isUp ? 1 : 2), S(`1.3.6.1.2.1.2.2.1.10.${n}`, 'c32', inC), S(`1.3.6.1.2.1.2.2.1.14.${n}`, 'c32', err),
      S(`1.3.6.1.2.1.2.2.1.16.${n}`, 'c32', outC), S(`1.3.6.1.2.1.31.1.1.1.1.${n}`, 'str', name), S(`1.3.6.1.2.1.31.1.1.1.6.${n}`, 'c64', inC), S(`1.3.6.1.2.1.31.1.1.1.10.${n}`, 'c64', outC),
      S(`1.3.6.1.2.1.31.1.1.1.15.${n}`, 'g32', mbit), S(`1.3.6.1.2.1.31.1.1.1.18.${n}`, 'str', isUp ? `link ${n}` : ''));
  });
  return out;
}
function hostResources(cores, storages) {   // storages: [name, sizeGB, usedPct]
  const out = []; for (let c = 1; c <= cores; c++) out.push(S(`1.3.6.1.2.1.25.3.3.1.2.${c}`, 'int', () => Math.round(Math.max(1, Math.min(100, jit(wave(35, 25, 300, c), 8))))));
  storages.forEach(([name, gb, pct], i) => { const n = i + 1, units = 4096, size = Math.round((gb * 1073741824) / units); out.push(S(`1.3.6.1.2.1.25.2.3.1.3.${n}`, 'str', name), S(`1.3.6.1.2.1.25.2.3.1.4.${n}`, 'int', units), S(`1.3.6.1.2.1.25.2.3.1.5.${n}`, 'int', size), S(`1.3.6.1.2.1.25.2.3.1.6.${n}`, 'int', () => Math.round(size * Math.min(0.99, wave(pct, 3, 900, n) / 100)))); });
  out.push(S('1.3.6.1.2.1.25.1.6.0', 'g32', () => Math.round(wave(180, 40, 600))));
  return out;
}
const r1 = (x) => Math.round(x), r10 = (x) => Math.round(x * 10), r100 = (x) => Math.round(x * 100);

// ---------------------------------------------------------------- the devices
// Each: name, kind, sysDescr, readings (what to add in NetEventPro), mib (the objects), options (v1Only, noSystem, drop, delayMs)
const R = (label, unit, oidS, o = {}) => ({ label, unit, oid: oidS, t: o.walk ? 'walk' : 'oid', agg: o.walk ? (o.agg || 'each') : 'avg', ...(o.names ? { nameOid: o.names } : {}), ...(o.scale ? { scale: o.scale } : {}), ...(o.dtype ? { dtype: o.dtype } : {}), ...(o.items ? { items: o.items } : {}), ...(o.alarms ? { alarms: o.alarms } : {}) });
const OKBAD = (ok, bad, okL = 'OK', badL = 'Alarm') => [{ op: '=', v: ok, label: okL, state: 'ok' }, { op: '=', v: bad, label: badL, state: 'crit' }];
const ifR = [R('Traffic in', 'B', '1.3.6.1.2.1.31.1.1.1.6', { walk: true, names: '1.3.6.1.2.1.31.1.1.1.1', dtype: 'counter' }), R('Port status', '', '1.3.6.1.2.1.2.2.1.8', { walk: true, names: '1.3.6.1.2.1.31.1.1.1.1', items: OKBAD(1, 2, 'Up', 'Down') })];

const DEVICES = [
  { name: 'Core switch', kind: 'switch', descr: 'Example 48-port gigabit core switch, firmware 9.2.1', model: '1.1', loc: 'Main hall, rack A1',
    mib: () => [...system('Example 48-port gigabit core switch, firmware 9.2.1', '1.1', 'core-sw-01', 'Main hall, rack A1'), ...interfaces([...Array.from({ length: 48 }, (_, i) => [`Gi1/0/${i + 1}`, 1000, i % 5 !== 3, 2e6 + i * 3e4]), ['Te1/1/1', 10000, true, 6e7], ['Te1/1/2', 10000, true, 4e7]]),
      S(`${E}.2.1.1.0`, 'int', () => r1(jit(wave(28, 18, 240), 4))), S(`${E}.2.1.2.0`, 'int', () => r1(wave(46, 4, 900))), S(`${E}.2.1.3.0`, 'int', () => r1(wave(41, 3, 1200))), S(`${E}.2.1.4.1`, 'int', 1), S(`${E}.2.1.4.2`, 'int', () => (step(600, 6) === 5 ? 2 : 1))],
    readings: [R('CPU load', '%', `${E}.2.1.1.0`, { alarms: [{ op: '>', value: 85, severity: 3 }] }), R('Memory used', '%', `${E}.2.1.2.0`), R('Temperature', '°C', `${E}.2.1.3.0`, { alarms: [{ op: '>', value: 55, severity: 3 }] }), R('Power supply', '', `${E}.2.1.4`, { walk: true, items: OKBAD(1, 2) }), ...ifR] },
  { name: 'Edge router', kind: 'router', model: '1.2', mib: () => [...system('Example edge router, 8 ports, software 17.6', '1.2', 'edge-rtr-01', 'Main hall, rack A2'), ...interfaces([['ge-0/0/0 WAN-ISP1', 1000, true, 4e7], ['ge-0/0/1 WAN-ISP2', 1000, true, 1.5e7], ['ge-0/0/2 LAN', 1000, true, 5e7], ['ge-0/0/3', 1000, false, 0], ['xe-0/1/0', 10000, true, 2e8], ['lo0', 1000, true, 1e3], ['tun0', 100, true, 2e5], ['mgmt0', 100, true, 5e3]]),
      S(`${E}.2.2.1.0`, 'int', () => r1(jit(wave(22, 15, 200), 5))), S(`${E}.2.2.2.0`, 'int', () => r1(wave(61, 5, 1800))), S(`${E}.2.2.3.0`, 'g32', () => r1(wave(812000, 3000, 600))), S(`${E}.2.2.4.1`, 'int', 6), S(`${E}.2.2.4.2`, 'int', () => (step(400, 5) === 4 ? 3 : 6))],
    readings: [R('CPU load', '%', `${E}.2.2.1.0`), R('Memory used', '%', `${E}.2.2.2.0`), R('BGP routes', '', `${E}.2.2.3.0`), R('BGP session', '', `${E}.2.2.4`, { walk: true, items: [{ op: '=', v: 6, label: 'Established', state: 'ok' }, { op: '=', v: 3, label: 'Active (down)', state: 'crit' }] }), ...ifR] },
  { name: 'Firewall', kind: 'firewall', model: '1.3', mib: () => [...system('Example firewall cluster member, OS 7.4', '1.3', 'fw-01', 'Main hall, rack A2'), ...interfaces([['outside', 1000, true, 3e7], ['inside', 1000, true, 4e7], ['dmz', 1000, true, 5e6], ['sync', 1000, true, 1e5]]),
      S(`${E}.2.3.1.0`, 'g32', () => r1(jit(wave(42000, 15000, 600), 2000))), S(`${E}.2.3.2.0`, 'int', () => r1(jit(wave(35, 20, 300), 6))), S(`${E}.2.3.3.0`, 'str', () => (step(900, 10) === 9 ? 'standby' : 'active')), S(`${E}.2.3.4.0`, 'c32', counter(40))],
    readings: [R('Sessions', '', `${E}.2.3.1.0`), R('CPU load', '%', `${E}.2.3.2.0`), R('Cluster role', '', `${E}.2.3.3.0`, { dtype: 'text' }), R('Blocked connections', '/s', `${E}.2.3.4.0`, { dtype: 'counter' }), ...ifR] },
  { name: 'Windows server', kind: 'server', model: '1.4', mib: () => [...system('Hardware: Example server - Software: Windows Server 2022 Standard', '1.4', 'srv-app-01', 'Server room, rack B3'), ...interfaces([['Ethernet0', 10000, true, 8e6], ['Ethernet1', 10000, true, 2e6]]), ...hostResources(8, [['C:\\ Label:OS', 200, 62], ['D:\\ Label:Data', 2000, 71], ['Physical Memory', 64, 58]])],
    readings: [R('CPU load', '%', '1.3.6.1.2.1.25.3.3.1.2', { walk: true, agg: 'avg' }), R('Processes', '', '1.3.6.1.2.1.25.1.6.0'), R('Disk used (blocks)', '', '1.3.6.1.2.1.25.2.3.1.6', { walk: true, names: '1.3.6.1.2.1.25.2.3.1.3' })] },
  { name: 'Linux server', kind: 'server', model: '1.5', mib: () => [...system('Linux srv-db-01 6.8.0 x86_64', '1.5', 'srv-db-01', 'Server room, rack B4'), ...interfaces([['eth0', 10000, true, 1.2e7], ['eth1', 10000, true, 3e6], ['lo', 10, true, 1e4]]), ...hostResources(16, [['/', 100, 48], ['/var/lib/db', 4000, 83], ['Physical memory', 128, 77]]),
      S('1.3.6.1.4.1.2021.10.1.3.1', 'str', () => (wave(1.8, 1.2, 300)).toFixed(2)), S('1.3.6.1.4.1.2021.10.1.3.2', 'str', () => (wave(1.6, 0.8, 900)).toFixed(2))],
    readings: [R('CPU load', '%', '1.3.6.1.2.1.25.3.3.1.2', { walk: true, agg: 'max' }), R('Load average 1 min', '', '1.3.6.1.4.1.2021.10.1.3.1'), R('Processes', '', '1.3.6.1.2.1.25.1.6.0')] },
  { name: 'Rectifier plant', kind: 'rectifier', model: '3.1', mib: () => [...system('Example 48 V DC power system controller, 4 rectifiers', '3.1', 'dc-plant-01', 'Power room, row 1'),
      S(`${E}.3.1.1.0`, 'int', () => r100(jit(wave(54.2, 0.25, 600), 0.03))), S(`${E}.3.1.2.0`, 'int', () => r10(jit(wave(86, 9, 300), 0.8))), S(`${E}.3.1.3.0`, 'int', () => r10(jit(wave(2.5, 1.8, 900), 0.2))),
      S(`${E}.3.1.4.0`, 'int', () => r10(wave(24.5, 2, 1800))), S(`${E}.3.1.5.0`, 'int', () => r1(wave(97, 2, 3600))), S(`${E}.3.1.6.0`, 'int', () => (step(500, 8) === 7 ? 2 : 1)),
      ...[1, 2, 3, 4].flatMap((n) => [S(`${E}.3.1.10.1.2.${n}`, 'str', `Rectifier ${n}`), S(`${E}.3.1.10.1.3.${n}`, 'int', () => (n === 3 && step(700, 6) === 5 ? 2 : 1)), S(`${E}.3.1.10.1.4.${n}`, 'int', () => r10(n === 3 && step(700, 6) === 5 ? 0 : jit(wave(21.5, 2.5, 300, n), 0.4))), S(`${E}.3.1.10.1.5.${n}`, 'int', () => r1(wave(38 + n, 3, 1200, n)))])],
    readings: [R('Battery voltage', 'V', `${E}.3.1.1.0`, { scale: 0.01, alarms: [{ op: '<', value: 50, severity: 2 }, { op: '>', value: 57.5, severity: 3 }] }), R('Load current', 'A', `${E}.3.1.2.0`, { scale: 0.1 }), R('Battery current', 'A', `${E}.3.1.3.0`, { scale: 0.1 }),
      R('Battery temperature', '°C', `${E}.3.1.4.0`, { scale: 0.1, alarms: [{ op: '>', value: 35, severity: 3 }] }), R('Battery capacity', '%', `${E}.3.1.5.0`), R('Mains', '', `${E}.3.1.6.0`, { items: OKBAD(1, 2, 'On', 'Mains failure') }),
      R('Rectifier status', '', `${E}.3.1.10.1.3`, { walk: true, names: `${E}.3.1.10.1.2`, items: OKBAD(1, 2, 'OK', 'Failed') }), R('Rectifier current', 'A', `${E}.3.1.10.1.4`, { walk: true, names: `${E}.3.1.10.1.2`, scale: 0.1 }), R('Rectifier temperature', '°C', `${E}.3.1.10.1.5`, { walk: true, names: `${E}.3.1.10.1.2` })] },
  { name: 'UPS', kind: 'ups', model: '3.2', mib: () => [...system('Example online UPS 10 kVA, network card 3.1', '3.2', 'ups-01', 'Power room, row 2'),
      S('1.3.6.1.2.1.33.1.2.1.0', 'int', () => (step(800, 10) === 9 ? 3 : 2)), S('1.3.6.1.2.1.33.1.2.3.0', 'int', () => r1(wave(42, 6, 1800))), S('1.3.6.1.2.1.33.1.2.4.0', 'int', () => r1(wave(99, 1, 3600))), S('1.3.6.1.2.1.33.1.2.5.0', 'int', () => r10(wave(272, 2, 900))),
      S('1.3.6.1.2.1.33.1.2.7.0', 'int', () => r1(wave(27, 2, 1800))), S('1.3.6.1.2.1.33.1.3.3.1.3.1', 'int', () => r1(jit(wave(231, 4, 300), 1))), S('1.3.6.1.2.1.33.1.4.1.0', 'int', () => (step(800, 10) === 9 ? 5 : 3)), S('1.3.6.1.2.1.33.1.4.4.1.5.1', 'int', () => r1(jit(wave(48, 10, 600), 2)))],
    readings: [R('Battery status', '', '1.3.6.1.2.1.33.1.2.1.0', { items: [{ op: '=', v: 2, label: 'Normal', state: 'ok' }, { op: '=', v: 3, label: 'Low', state: 'crit' }, { op: '=', v: 4, label: 'Depleted', state: 'crit' }] }), R('Runtime left', 'min', '1.3.6.1.2.1.33.1.2.3.0', { alarms: [{ op: '<', value: 15, severity: 2 }] }),
      R('Battery charge', '%', '1.3.6.1.2.1.33.1.2.4.0'), R('Battery voltage', 'V', '1.3.6.1.2.1.33.1.2.5.0', { scale: 0.1 }), R('Battery temperature', '°C', '1.3.6.1.2.1.33.1.2.7.0'), R('Input voltage', 'V', '1.3.6.1.2.1.33.1.3.3.1.3.1'),
      R('Output source', '', '1.3.6.1.2.1.33.1.4.1.0', { items: [{ op: '=', v: 3, label: 'Normal', state: 'ok' }, { op: '=', v: 4, label: 'Bypass', state: 'warn' }, { op: '=', v: 5, label: 'On battery', state: 'crit' }] }), R('Output load', '%', '1.3.6.1.2.1.33.1.4.4.1.5.1', { alarms: [{ op: '>', value: 80, severity: 3 }] })] },
  { name: 'Multiplexer', kind: 'multiplexer', model: '4.1', mib: () => [...system('Example SDH/PDH multiplexer STM-4, 16 x E1', '4.1', 'mux-01', 'Transmission room, rack T1'),
      ...[1, 2].flatMap((n) => [S(`${E}.4.1.1.1.2.${n}`, 'str', `STM-4 line ${n}`), S(`${E}.4.1.1.1.3.${n}`, 'int', () => r10(jit(wave(n === 1 ? -14.5 : -18.2, 0.6, 900, n), 0.15))), S(`${E}.4.1.1.1.4.${n}`, 'int', () => r10(wave(-2.1, 0.2, 1800, n))), S(`${E}.4.1.1.1.5.${n}`, 'int', () => (n === 2 && step(600, 7) === 6 ? 2 : 1))]),
      ...Array.from({ length: 16 }, (_, i) => i + 1).flatMap((n) => [S(`${E}.4.1.2.1.2.${n}`, 'str', `E1 ${n}`), S(`${E}.4.1.2.1.3.${n}`, 'int', () => (n === 7 ? 3 : n === 12 && step(300, 4) === 3 ? 2 : 1)), S(`${E}.4.1.2.1.4.${n}`, 'c32', () => (n === 12 ? Math.floor((Date.now() - t0) / 5000) : 0))]),
      S(`${E}.4.1.3.0`, 'int', () => (step(600, 7) === 6 ? 1 : 0) + (step(300, 4) === 3 ? 1 : 0) + 1), S(`${E}.4.1.4.0`, 'str', 'Synchronised to STM-4 line 1')],
    readings: [R('Optical receive power', 'dBm', `${E}.4.1.1.1.3`, { walk: true, names: `${E}.4.1.1.1.2`, scale: 0.1, alarms: [{ op: '<', value: -25, severity: 2 }] }), R('Optical transmit power', 'dBm', `${E}.4.1.1.1.4`, { walk: true, names: `${E}.4.1.1.1.2`, scale: 0.1 }),
      R('Line status', '', `${E}.4.1.1.1.5`, { walk: true, names: `${E}.4.1.1.1.2`, items: OKBAD(1, 2, 'OK', 'LOS') }), R('E1 status', '', `${E}.4.1.2.1.3`, { walk: true, names: `${E}.4.1.2.1.2`, items: [{ op: '=', v: 1, label: 'OK', state: 'ok' }, { op: '=', v: 2, label: 'AIS', state: 'warn' }, { op: '=', v: 3, label: 'Not in use', state: 'unk' }] }),
      R('E1 errored seconds', '', `${E}.4.1.2.1.4`, { walk: true, names: `${E}.4.1.2.1.2`, dtype: 'counter' }), R('Active alarms', '', `${E}.4.1.3.0`), R('Clock source', '', `${E}.4.1.4.0`, { dtype: 'text' })] },
  { name: 'PDU', kind: 'pdu', model: '3.3', mib: () => [...system('Example metered rack PDU 32 A, 24 outlets', '3.3', 'pdu-a1', 'Main hall, rack A1'),
      S(`${E}.3.3.1.0`, 'int', () => r10(jit(wave(14.2, 2.5, 600), 0.2))), S(`${E}.3.3.2.0`, 'int', () => r1(jit(wave(3250, 500, 600), 40))), S(`${E}.3.3.3.0`, 'int', () => r1(wave(230, 3, 900))), S(`${E}.3.3.4.0`, 'c32', counter(0.9)),
      ...Array.from({ length: 8 }, (_, i) => i + 1).flatMap((n) => [S(`${E}.3.3.10.1.2.${n}`, 'str', `Outlet ${n}`), S(`${E}.3.3.10.1.3.${n}`, 'int', () => r10(n === 8 ? 0 : jit(wave(1.6 + n * 0.1, 0.3, 400, n), 0.05)))])],
    readings: [R('Total current', 'A', `${E}.3.3.1.0`, { scale: 0.1, alarms: [{ op: '>', value: 25, severity: 3 }] }), R('Power', 'W', `${E}.3.3.2.0`), R('Voltage', 'V', `${E}.3.3.3.0`), R('Energy', 'kWh', `${E}.3.3.4.0`, { scale: 0.001 }), R('Outlet current', 'A', `${E}.3.3.10.1.3`, { walk: true, names: `${E}.3.3.10.1.2`, scale: 0.1 })] },
  { name: 'Generator', kind: 'generator', model: '3.4', mib: () => { const run = () => step(900, 8) === 7; return [...system('Example 250 kVA diesel generator controller', '3.4', 'genset-01', 'Yard'),
      S(`${E}.3.4.1.0`, 'int', () => (run() ? 2 : 1)), S(`${E}.3.4.2.0`, 'int', () => r1(wave(78, 4, 7200))), S(`${E}.3.4.3.0`, 'int', () => r1(run() ? wave(84, 4, 300) : 38)), S(`${E}.3.4.4.0`, 'int', () => r10(wave(27.4, 0.4, 600))),
      S(`${E}.3.4.5.0`, 'int', () => 1243 + Math.floor((Date.now() - t0) / 3600000)), S(`${E}.3.4.6.0`, 'int', () => r1(run() ? jit(1500, 6) : 0)), S(`${E}.3.4.7.0`, 'str', () => (run() ? 'Running, on load' : 'Auto, ready'))]; },
    readings: [R('Engine state', '', `${E}.3.4.1.0`, { items: [{ op: '=', v: 1, label: 'Stopped (ready)', state: 'ok' }, { op: '=', v: 2, label: 'Running', state: 'warn' }, { op: '=', v: 3, label: 'Fault', state: 'crit' }] }), R('Fuel level', '%', `${E}.3.4.2.0`, { alarms: [{ op: '<', value: 30, severity: 3 }] }),
      R('Coolant temperature', '°C', `${E}.3.4.3.0`), R('Starter battery', 'V', `${E}.3.4.4.0`, { scale: 0.1 }), R('Run hours', 'h', `${E}.3.4.5.0`), R('Engine speed', 'rpm', `${E}.3.4.6.0`), R('Mode', '', `${E}.3.4.7.0`, { dtype: 'text' })] },
  { name: 'Environment sensor', kind: 'environment', model: '5.1', mib: () => [...system('Example environment monitor, 4 probes', '5.1', 'env-01', 'Server room'),
      ...[['Cold aisle', 21], ['Hot aisle', 33], ['Ceiling', 27], ['Battery room', 24]].flatMap(([nm, base], i) => [S(`${E}.5.1.1.1.2.${i + 1}`, 'str', nm), S(`${E}.5.1.1.1.3.${i + 1}`, 'int', () => r10(jit(wave(base, 1.5, 900, i), 0.2))), S(`${E}.5.1.1.1.4.${i + 1}`, 'int', () => r1(wave(45, 6, 1800, i)))]),
      S(`${E}.5.1.2.0`, 'int', () => (step(450, 9) === 8 ? 2 : 1)), S(`${E}.5.1.3.0`, 'int', 1), S(`${E}.5.1.4.0`, 'int', () => r1(wave(410, 60, 1200)))],
    readings: [R('Temperature', '°C', `${E}.5.1.1.1.3`, { walk: true, names: `${E}.5.1.1.1.2`, scale: 0.1, alarms: [{ op: '>', value: 35, severity: 3 }] }), R('Humidity', '%', `${E}.5.1.1.1.4`, { walk: true, names: `${E}.5.1.1.1.2` }),
      R('Door', '', `${E}.5.1.2.0`, { items: OKBAD(1, 2, 'Closed', 'Open') }), R('Water leak', '', `${E}.5.1.3.0`, { items: OKBAD(1, 2, 'Dry', 'Water detected') }), R('CO2', 'ppm', `${E}.5.1.4.0`)] },
  { name: 'Time server', kind: 'time', model: '6.1', mib: () => [...system('Example GPS time and frequency server, NTP/PTP', '6.1', 'ntp-01', 'Main hall, rack A3'), ...interfaces([['eth0', 1000, true, 4e4]]),
      S(`${E}.6.1.1.0`, 'int', () => (step(1200, 12) === 11 ? 2 : 1)), S(`${E}.6.1.2.0`, 'int', () => r1(wave(10, 2, 1800))), S(`${E}.6.1.3.0`, 'int', () => r1(jit(0, 40))), S(`${E}.6.1.4.0`, 'int', () => (step(1200, 12) === 11 ? 2 : 1)), S(`${E}.6.1.5.0`, 'g32', () => r1(wave(1800, 300, 300)))],
    readings: [R('GPS lock', '', `${E}.6.1.1.0`, { items: OKBAD(1, 2, 'Locked', 'Holdover') }), R('Satellites', '', `${E}.6.1.2.0`, { alarms: [{ op: '<', value: 4, severity: 3 }] }), R('Time offset', 'ns', `${E}.6.1.3.0`), R('Stratum', '', `${E}.6.1.4.0`), R('NTP requests', '/s', `${E}.6.1.5.0`)] },
  { name: 'Audio processor', kind: 'audio', model: '7.1', mib: () => [...system('Example broadcast audio processor and delay, 8 channels', '7.1', 'audio-01', 'Studio rack S2'),
      ...Array.from({ length: 8 }, (_, i) => i + 1).flatMap((n) => [S(`${E}.7.1.1.1.2.${n}`, 'str', `Channel ${n}`), S(`${E}.7.1.1.1.3.${n}`, 'int', () => r10(n === 6 ? -90 : jit(wave(-18, 4, 30, n), 1.5))), S(`${E}.7.1.1.1.4.${n}`, 'int', () => (n === 6 ? 2 : 1))]),
      S(`${E}.7.1.2.0`, 'int', 7000), S(`${E}.7.1.3.0`, 'str', 'Preset 3: Evening news'), S(`${E}.7.1.4.0`, 'int', () => r1(wave(41, 2, 1800)))],
    readings: [R('Input level', 'dBFS', `${E}.7.1.1.1.3`, { walk: true, names: `${E}.7.1.1.1.2`, scale: 0.1, alarms: [{ op: '<', value: -60, severity: 3, forSec: 30 }] }), R('Silence', '', `${E}.7.1.1.1.4`, { walk: true, names: `${E}.7.1.1.1.2`, items: OKBAD(1, 2, 'Audio present', 'Silence') }),
      R('Delay', 'ms', `${E}.7.1.2.0`), R('Preset', '', `${E}.7.1.3.0`, { dtype: 'text' }), R('Temperature', '°C', `${E}.7.1.4.0`)] },
  { name: 'Microwave link', kind: 'radio', model: '8.1', mib: () => [...system('Example licensed microwave radio 18 GHz', '8.1', 'mw-site-b', 'Roof'), ...interfaces([['radio', 400, true, 2e7], ['eth1', 1000, true, 2e7]]),
      S(`${E}.8.1.1.0`, 'int', () => r10(jit(wave(-41, 3, 600), 0.5))), S(`${E}.8.1.2.0`, 'int', () => r10(jit(wave(36, 2.5, 600), 0.4))), S(`${E}.8.1.3.0`, 'str', () => (wave(36, 2.5, 600) > 34 ? '1024QAM' : '512QAM')), S(`${E}.8.1.4.0`, 'int', () => r1(wave(34, 4, 1200)))],
    readings: [R('Receive level', 'dBm', `${E}.8.1.1.0`, { scale: 0.1, alarms: [{ op: '<', value: -60, severity: 2 }] }), R('Signal to noise', 'dB', `${E}.8.1.2.0`, { scale: 0.1 }), R('Modulation', '', `${E}.8.1.3.0`, { dtype: 'text' }), R('Temperature', '°C', `${E}.8.1.4.0`), ...ifR] },
  { name: 'Air conditioner', kind: 'cooling', model: '5.2', mib: () => { const comp = () => wave(24.5, 1.2, 900) > 24.5; return [...system('Example precision air conditioner 40 kW', '5.2', 'crac-01', 'Server room'),
      S(`${E}.5.2.1.0`, 'int', () => r10(jit(wave(18.5, 0.8, 900), 0.1))), S(`${E}.5.2.2.0`, 'int', () => r10(jit(wave(24.5, 1.2, 900), 0.1))), S(`${E}.5.2.3.0`, 'int', 220), S(`${E}.5.2.4.0`, 'int', () => (comp() ? 1 : 0)), S(`${E}.5.2.5.0`, 'int', () => r1(wave(70, 15, 600)))]; },
    readings: [R('Supply air', '°C', `${E}.5.2.1.0`, { scale: 0.1 }), R('Return air', '°C', `${E}.5.2.2.0`, { scale: 0.1, alarms: [{ op: '>', value: 28, severity: 3 }] }), R('Set point', '°C', `${E}.5.2.3.0`, { scale: 0.1 }), R('Compressor', '', `${E}.5.2.4.0`, { items: [{ op: '=', v: 0, label: 'Off', state: 'ok' }, { op: '=', v: 1, label: 'Running', state: 'ok' }] }), R('Fan speed', '%', `${E}.5.2.5.0`)] },
  { name: 'Storage NAS', kind: 'storage', model: '1.6', mib: () => [...system('Example NAS 12 bays, storage OS 7.2', '1.6', 'nas-01', 'Server room, rack B5'), ...interfaces([['bond0', 10000, true, 3e7]]), ...hostResources(4, [['Volume 1', 48000, 74], ['Volume 2', 24000, 39], ['Physical memory', 32, 41]]),
      ...Array.from({ length: 6 }, (_, i) => i + 1).flatMap((n) => [S(`${E}.1.6.1.1.2.${n}`, 'str', `Disk ${n}`), S(`${E}.1.6.1.1.3.${n}`, 'int', () => r1(wave(36 + n, 2, 1800, n))), S(`${E}.1.6.1.1.4.${n}`, 'int', () => (n === 4 && step(900, 5) === 4 ? 3 : 1))])],
    readings: [R('Disk temperature', '°C', `${E}.1.6.1.1.3`, { walk: true, names: `${E}.1.6.1.1.2` }), R('Disk status', '', `${E}.1.6.1.1.4`, { walk: true, names: `${E}.1.6.1.1.2`, items: [{ op: '=', v: 1, label: 'Normal', state: 'ok' }, { op: '=', v: 3, label: 'Failing', state: 'crit' }] }), R('CPU load', '%', '1.3.6.1.2.1.25.3.3.1.2', { walk: true, agg: 'avg' })] },
  { name: 'Wi-Fi controller', kind: 'wireless', model: '8.2', mib: () => [...system('Example wireless LAN controller, 120 access points', '8.2', 'wlc-01', 'Main hall, rack A2'), ...interfaces([['port1', 10000, true, 9e7], ['port2', 10000, true, 2e7]]),
      S(`${E}.8.2.1.0`, 'int', () => r1(wave(118, 2, 3600))), S(`${E}.8.2.2.0`, 'int', 120), S(`${E}.8.2.3.0`, 'g32', () => r1(jit(wave(1450, 600, 3600), 30)))],
    readings: [R('Access points online', '', `${E}.8.2.1.0`, { alarms: [{ op: '<', value: 115, severity: 3 }] }), R('Access points total', '', `${E}.8.2.2.0`), R('Wireless clients', '', `${E}.8.2.3.0`), ...ifR] },
  { name: 'Legacy SNMPv1 device', kind: 'legacy', model: '9.1', v1Only: true, mib: () => [...system('Example legacy alarm unit (SNMPv1 only)', '9.1', 'legacy-01', 'Power room'), S(`${E}.9.1.1.0`, 'int', () => r1(wave(48, 1, 900))), S(`${E}.9.1.2.0`, 'int', () => (step(700, 7) === 6 ? 1 : 0))],
    readings: [R('Supply voltage', 'V', `${E}.9.1.1.0`), R('Alarm input', '', `${E}.9.1.2.0`, { items: OKBAD(0, 1, 'Normal', 'Alarm') })], note: 'answers SNMPv1 only (set the version to v1)' },
  { name: 'Vendor-only controller', kind: 'restricted', model: '9.2', noSystem: true, mib: () => [S(`${E}.9.2.1.0`, 'int', () => r10(wave(13.6, 0.2, 600))), S(`${E}.9.2.2.0`, 'int', () => r1(wave(31, 3, 900)))],
    readings: [R('Bus voltage', 'V', `${E}.9.2.1.0`, { scale: 0.1 }), R('Cabinet temperature', '°C', `${E}.9.2.2.0`)], note: 'shows no standard values (no uptime, no system name), like some power controllers' },
  { name: 'Flaky remote site', kind: 'unreliable', model: '9.3', drop: 0.15, delayMs: 350, mib: () => [...system('Example remote site router over a weak link', '9.3', 'remote-07', 'Remote site 7'), ...interfaces([['wan', 20, true, 4e5], ['lan', 100, true, 3e5]]), S(`${E}.9.3.1.0`, 'int', () => r1(jit(wave(30, 20, 300), 5)))],
    readings: [R('CPU load', '%', `${E}.9.3.1.0`), ...ifR], note: 'answers slowly (about 350 ms) and loses about 15 % of requests' }
];

// ---------------------------------------------------------------- one agent per device
function agent(dev, port) {
  let tbl = null, tblAt = 0;
  const table = () => { if (!tbl || Date.now() - tblAt > 60000) { tbl = dev.mib().map(([o, type, f]) => ({ o: oid(o), type, f })).sort((a, b) => cmp(a.o, b.o)); tblAt = Date.now(); } return tbl; };
  const val = (e) => { const v = typeof e.f === 'function' ? e.f() : e.f; return { type: e.type, value: v }; };
  const find = (o) => { const t = table(); let lo = 0, hi = t.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1, c = cmp(t[m].o, o); if (c === 0) return t[m]; if (c < 0) lo = m + 1; else hi = m - 1; } return null; };
  const after = (o) => { const t = table(); let lo = 0, hi = t.length; while (lo < hi) { const m = (lo + hi) >> 1; if (cmp(t[m].o, o) <= 0) lo = m + 1; else hi = m; } return t[lo] || null; };
  const sock = dgram.createSocket('udp4'); dev.stats = { req: 0 };
  sock.on('message', (buf, rinfo) => {
    try {
      const top = read(buf, 0); if (top.t !== T.SEQ) return;
      const vr = read(buf, top.s), ver = Number(decInt(buf, vr.s, vr.e)), cm = read(buf, vr.e), community = buf.subarray(cm.s, cm.e).toString();
      if (community !== COMM || ver > 1 || (dev.v1Only && ver !== 0)) return;     // wrong community or version: silence, like a real agent
      const pdu = read(buf, cm.e), rid = read(buf, pdu.s), e1 = read(buf, rid.e), e2 = read(buf, e1.e), vbl = read(buf, e2.e);
      const reqId = decInt(buf, rid.s, rid.e), a2 = Number(decInt(buf, e2.s, e2.e)), a1 = Number(decInt(buf, e1.s, e1.e));
      const oids = []; for (let i = vbl.s; i < vbl.e;) { const vb = read(buf, i), o = read(buf, vb.s); oids.push(decOid(buf, o.s, o.e)); i = vb.e; }
      if (pdu.t === 0xa5 && ver === 0) return;
      if (dev.drop && Math.random() < dev.drop) return;
      dev.stats.req++;
      let status = 0, index = 0; const out = [];
      const enc = (o, v) => tlv(T.SEQ, Buffer.concat([tlv(T.OID, encOid(o)), v.type === 'nso' ? tlv(T.NSO, Buffer.alloc(0)) : v.type === 'nsi' ? tlv(T.NSI, Buffer.alloc(0)) : v.type === 'eom' ? tlv(T.EOM, Buffer.alloc(0)) : encVal(v)]));
      if (pdu.t === 0xa0) oids.forEach((o, i) => { const e = find(o); if (e) out.push(enc(o, val(e))); else if (ver === 0) { if (!status) { status = 2; index = i + 1; } out.push(enc(o, { type: 'null' })); } else out.push(enc(o, { type: 'nsi' })); });
      else if (pdu.t === 0xa1) oids.forEach((o, i) => { const e = after(o); if (e) out.push(enc(e.o, val(e))); else if (ver === 0) { if (!status) { status = 2; index = i + 1; } out.push(enc(o, { type: 'null' })); } else out.push(enc(o, { type: 'eom' })); });
      else if (pdu.t === 0xa5) { const nonRep = Math.max(0, a1), maxRep = Math.max(1, Math.min(50, a2 || 10));
        oids.slice(0, nonRep).forEach((o) => { const e = after(o); out.push(e ? enc(e.o, val(e)) : enc(o, { type: 'eom' })); });
        for (const o0 of oids.slice(nonRep)) { let o = o0; for (let k = 0; k < maxRep; k++) { const e = after(o); if (!e) { out.push(enc(o, { type: 'eom' })); break; } out.push(enc(e.o, val(e))); o = e.o; } } }
      else return;
      const body = Buffer.concat([tlv(T.INT, encInt(reqId)), tlv(T.INT, encInt(status)), tlv(T.INT, encInt(index)), tlv(T.SEQ, Buffer.concat(out))]);
      const msg = tlv(T.SEQ, Buffer.concat([tlv(T.INT, encInt(ver)), tlv(T.OCT, Buffer.from(community)), tlv(0xa2, body)]));
      const send = () => sock.send(msg, rinfo.port, rinfo.address); if (dev.delayMs) setTimeout(send, dev.delayMs * (0.7 + Math.random() * 0.6)); else send();
    } catch { /* a broken request: ignore */ }
  });
  return new Promise((res, rej) => { sock.once('error', rej); sock.bind(port, HOST === '0.0.0.0' ? undefined : HOST, () => res(sock)); });
}

// ---------------------------------------------------------------- readings.md
function writeList() {
  const L = ['# Simulated devices and their readings', '', `Community: \`${COMM}\`, version v2c (the legacy device: v1). Host: the computer running snmpsim.js. Values change over time.`, ''];
  DEVICES.forEach((d, i) => {
    L.push(`## SIM ${d.name}  (UDP port ${BASE + i})`, '', d.note ? `*${d.note}*` : '', '', '| Reading | Unit | OID | How | Notes |', '|---|---|---|---|---|');
    for (const r of d.readings) L.push(`| ${r.label} | ${r.unit} | \`${r.oid}\` | ${r.t === 'walk' ? `table, ${r.agg === 'each' ? 'one value each' : r.agg}${r.nameOid ? `, names \`${r.nameOid}\`` : ''}` : 'single value'} | ${[r.scale ? `× ${r.scale}` : '', r.dtype && r.dtype !== 'number' ? r.dtype : '', r.items ? r.items.map((x) => `${x.v}=${x.label}`).join(', ') : '', (r.alarms || []).map((a) => `alarm ${a.op} ${a.value}`).join(', ')].filter(Boolean).join('; ')} |`);
    L.push('');
  });
  try { fs.writeFileSync(path.join(__dirname, 'readings.md'), L.join('\n')); } catch { /* read-only folder */ }
}

// ---------------------------------------------------------------- add / remove in NetEventPro
async function server(urlS, fn) {
  const U = String(urlS).replace(/\/+$/, ''), H = { 'content-type': 'application/json', 'X-Requested-With': 'NetEventPro' }; let cookie = '';
  if (arg('user')) { const r = await fetch(U + '/api/login', { method: 'POST', headers: H, body: JSON.stringify({ username: arg('user'), password: String(arg('pass', '')) }) }); if (r.status !== 200) throw new Error(`sign-in refused (${r.status}): check --user and --pass`); cookie = (r.headers.get('set-cookie') || '').split(';')[0]; }
  const api = async (p, method = 'GET', body) => { const r = await fetch(U + p, { method, headers: { ...H, cookie }, body: body === undefined ? undefined : JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (r.status >= 400) throw new Error(`${p}: ${j.error || r.status}`); return j; };
  return fn(api);
}
const myIp = () => { for (const l of Object.values(require('node:os').networkInterfaces())) for (const a of l || []) if (a.family === 'IPv4' && !a.internal) return a.address; return '127.0.0.1'; };
async function addAll(urlS) {
  const host = String(arg('as', HOST === '0.0.0.0' ? myIp() : HOST));
  await server(urlS, async (api) => {
    const have = (await api('/api/poll/devices')).devices || [];
    for (const [i, d] of DEVICES.entries()) {
      const name = `SIM ${d.name}`; if (have.some((x) => x.name === name)) { console.log(`  ${name}: already there`); continue; }
      const r = await api('/api/poll/devices', 'POST', { name, host, port: BASE + i, version: d.v1Only ? 'v1' : 'v2c', community: COMM, intervalSec: 30, timeoutMs: d.delayMs ? 2000 : 1500, retries: 1, group: 'Simulator', site: 'Lab', ifMode: d.mib().some(([o]) => o.startsWith('1.3.6.1.2.1.2.2.1.')) ? 'auto' : 'none' });
      const id = r.id;
      if (!id) { console.log(`  ${name}: added, but its id was not returned; add the readings by hand (readings.md)`); continue; }
      await api('/api/poll/readings', 'POST', { id, readings: d.readings }); console.log(`  ${name}: added with ${d.readings.length} readings (port ${BASE + i})`);
    }
  });
}
async function removeAll(urlS) {
  await server(urlS, async (api) => { const list = ((await api('/api/poll/devices')).devices || []).filter((x) => String(x.name).startsWith('SIM ')); for (const d of list) { await api('/api/poll/delete', 'POST', { id: d.id }); console.log('  removed', d.name); } if (!list.length) console.log('  no simulated devices found'); });
}

// ---------------------------------------------------------------- start
(async () => {
  if (arg('remove')) { await removeAll(arg('remove')); return; }
  writeList();
  const ok = [];
  for (const [i, d] of DEVICES.entries()) { try { await agent(d, BASE + i); ok.push(d); } catch (e) { console.error(`  ${d.name}: port ${BASE + i} could not be opened (${e.code || e.message})`); } }
  console.log(`\nNetEventPro SNMP simulator: ${ok.length} devices, community "${COMM}", listening on ${HOST}\n`);
  DEVICES.forEach((d, i) => console.log(`  UDP ${String(BASE + i).padEnd(6)} SIM ${d.name.padEnd(24)} ${String(d.readings.length).padStart(2)} readings${d.note ? '  (' + d.note + ')' : ''}`));
  console.log(`\nThe readings to add are listed in ${path.join(__dirname, 'readings.md')}`);
  if (arg('add')) { console.log(`\nAdding the devices to ${arg('add')} ...`); try { await addAll(arg('add')); console.log('Done. Open SNMP polling in NetEventPro.'); } catch (e) { console.error('Could not add the devices: ' + (e.cause?.code || e.message)); } }
  console.log('\nPress Ctrl+C to stop.');
  setInterval(() => {}, 1 << 30);
})();
