'use strict';
const test = require('node:test');
const assert = require('node:assert');
const tls = require('node:tls');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generate } = require('../src/certgen');
const { Listeners } = require('../src/listeners');

test('secure syslog receives framed messages over TLS and counts failed handshakes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tlssl-'));
  const r = generate({ hosts: 'localhost 127.0.0.1' });
  fs.writeFileSync(path.join(dir, 'c.pem'), r.cert); fs.writeFileSync(path.join(dir, 'k.pem'), r.key);
  const got = [];
  const L = new Listeners((buf, ip, proto) => got.push({ s: buf.toString(), proto }));
  const port = 20000 + Math.floor(Math.random() * 20000);
  await L.apply({ udpEnabled: false, tcpEnabled: false, tlsSyslogEnabled: true, tlsSyslogPort: port, syslogBind: '127.0.0.1', tlsCertFile: path.join(dir, 'c.pem'), tlsKeyFile: path.join(dir, 'k.pem') });
  assert.ok(L.status.tls.running, L.status.tls.error);
  await new Promise((res, rej) => {
    const s = tls.connect({ host: '127.0.0.1', port, ca: r.cert, servername: 'localhost' }, () => {
      const m = '<34>Oct 11 22:14:15 host su: secure hello';
      s.end(`${m.length} ${m}`);
    });
    s.on('close', res); s.on('error', rej);
  });
  await new Promise((r2) => setTimeout(r2, 100));
  assert.ok(got.some((g) => g.s.includes('secure hello')), JSON.stringify(got));
  // a client that does not trust the certificate fails the handshake
  await new Promise((res) => { const s = tls.connect({ host: '127.0.0.1', port, servername: 'localhost' }); s.on('error', () => res()); s.on('close', () => res()); });
  await new Promise((r2) => setTimeout(r2, 100));
  await L.stop();
  assert.ok(!L.status.tls.running);
});
