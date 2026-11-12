'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const tls = require('node:tls');
const { generate, parseHosts } = require('../src/certgen');

test('generated certificate lists every name and address and matches its key', () => {
  const r = generate({ hosts: 'Syslog01, syslog01.corp.local 10.1.2.3,fe80::1, *.lab.local' });
  const x = new crypto.X509Certificate(r.cert);
  for (const n of ['DNS:syslog01', 'DNS:syslog01.corp.local', 'DNS:*.lab.local', 'IP Address:10.1.2.3', 'IP Address:FE80:0:0:0:0:0:0:1']) assert.ok(x.subjectAltName.includes(n), n + ' in ' + x.subjectAltName);
  assert.ok(x.checkPrivateKey(crypto.createPrivateKey(r.key)));
  assert.ok(x.checkHost('syslog01') && x.checkIP('10.1.2.3') && !x.checkIP('10.1.2.4'));
  assert.deepStrictEqual(x.keyUsage, ['1.3.6.1.5.5.7.3.1']);
  assert.ok(Date.parse(x.validTo) > Date.now() + 800 * 86400000);
  tls.createSecureContext({ cert: r.cert, key: r.key });   // usable by an HTTPS server
});

test('two certificates never share a serial or key', () => {
  const a = new crypto.X509Certificate(generate({ hosts: 'a' }).cert), b = new crypto.X509Certificate(generate({ hosts: 'a' }).cert);
  assert.notStrictEqual(a.serialNumber, b.serialNumber); assert.notStrictEqual(a.fingerprint256, b.fingerprint256);
});

test('host list is cleaned and bad input refused', () => {
  assert.deepStrictEqual(parseHosts('A, a;B  10.0.0.1 [::1]'), { dns: ['a', 'b'], ips: ['10.0.0.1', '::1'] });
  for (const bad of ['', ' , ', 'bad name!', '-x', 'a..b', 'http://x']) assert.throws(() => parseHosts(bad), bad);
  assert.throws(() => parseHosts(Array.from({ length: 31 }, (_, i) => 'h' + i).join(',')));
});
