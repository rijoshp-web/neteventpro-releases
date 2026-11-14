#!/usr/bin/env node
'use strict';
/* Sends test syslog messages to NetEventPro at a steady rate, to see what a server can take. Messages are marked "loadtest" so they are easy to find and delete.
 *   node tools/loadtest.js --host 192.168.1.10 --port 514 --rate 500 --seconds 60 --sources 200
 *   options: --rate messages per second (default 500)   --seconds how long (default 30)   --sources how many different device names to pretend (default 100)
 *            --size extra text per message in bytes (default 60)   --ramp 1  step the rate up: 25%, 50%, 100% of --rate, a third of the time each
 * While it runs, watch System health and the Logs page. At the end it prints how many were sent. Compare with "Received" in System health:
 * a difference means packets were lost before the service saw them (raise the UDP receive buffer in Settings -> Network, or slow the senders).
 * It sends nothing else and never touches devices. Run it from another computer to include the network in the test. */
const dgram = require('node:dgram');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const host = opt('host', '127.0.0.1'), port = +opt('port', 514), rate = +opt('rate', 500), secs = +opt('seconds', 30), sources = +opt('sources', 100), size = +opt('size', 60), ramp = opt('ramp', '0') === '1';
const pad = 'x'.repeat(Math.max(0, size)), s = dgram.createSocket('udp4'); let sent = 0, errors = 0; const t0 = Date.now();
const msg = (i) => Buffer.from(`<${16 * 8 + (i % 8)}>${new Date().toISOString()} loadtest-${i % sources} lt[${i % 50}]: loadtest message ${i} ${pad}`);
const target = (el) => { const r = ramp ? rate * (el < secs / 3 ? 0.25 : el < 2 * secs / 3 ? 0.5 : 1) : rate; return r; };
let acc = 0, last = t0;
console.log(`Sending ${rate}/s for ${secs} s to ${host}:${port} from ${sources} pretend devices${ramp ? ' (stepped up)' : ''} ...`);
const tick = () => {
  const now = Date.now(), el = (now - t0) / 1000; acc += (now - last) / 1000 * target(el); last = now;
  while (acc >= 1) { acc--; s.send(msg(sent), port, host, (e) => { if (e) errors++; }); sent++; }
  if (el < secs) setTimeout(tick, 4); else setTimeout(() => { console.log(`Done: ${sent} messages sent in ${secs} s (${Math.round(sent / secs)}/s), ${errors} send errors.\nNow compare with "Received" on the System health page and the Logs page (search: loadtest).`); s.close(); }, 300);
};
tick();
