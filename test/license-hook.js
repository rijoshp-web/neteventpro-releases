'use strict';
// Used only by the test suite: node --require test/license-hook.js src/server.js
// It makes the program trust a throw-away test signing key and leaves a matching "any computer" key in the data folder, so test servers start activated.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { License } = require('../src/license');
const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
License.testKey = fx('license-test-public.pem');
const dir = process.env.NETEVENTPRO_DATA;
if (dir && !process.env.NEP_TEST_NO_KEY) {
  fs.mkdirSync(dir, { recursive: true });
  const p = Buffer.from(JSON.stringify({ v: 1, id: 'TEST', customer: 'Test suite', edition: 'Standard', machine: '*', issued: '2026-01-01', expires: null })).toString('base64url');
  fs.writeFileSync(path.join(dir, 'license-key.txt'), 'NEP1-' + p + '.' + crypto.sign(null, Buffer.from(p), crypto.createPrivateKey(fx('license-test-private.pem'))).toString('base64url'));
}
