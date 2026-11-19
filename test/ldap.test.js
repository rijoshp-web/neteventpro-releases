'use strict';
// 1.98.1 company directory sign-in, against a small LDAP server written here (plain with StartTLS, and LDAPS).
const test = require('node:test');
const assert = require('node:assert/strict');
const LDAP = require('../src/ldap');

const { fakeServer, makeCert, BASE } = require('./fake-ldap');
const cert = makeCert();
const MAP = [{ group: 'NOC Operators', roleId: 'operator' }, { group: 'CN=All Staff,OU=Groups,DC=corp,DC=local', roleId: 'viewer' }];

test('LDAPS: service account, user search, password check, groups and nested groups, role mapping', async () => {
  const { srv, port, seen } = await fakeServer({ secure: true, cert });
  try {
    const c = { url: `ldaps://127.0.0.1:${port}`, verifyCert: false, bindDN: 'CN=svc,OU=Service,DC=corp,DC=local', bindPassword: 'svc-pass', baseDN: BASE, nested: true, groupRoles: MAP };
    let r = await LDAP.authenticate(c, 'jane', 'Jane-Pass-1');
    assert.equal(r.ok, true, r.reason); assert.equal(r.fullName, 'Jane Doe'); assert.deepEqual(r.roleIds, ['operator', 'viewer']);
    assert.ok(seen.includes('bind CN=Jane Doe,OU=People,DC=corp,DC=local ok'));
    r = await LDAP.authenticate(c, 'jane', 'wrong'); assert.equal(r.ok, false); assert.equal(r.reason, 'Wrong user name or password.');
    r = await LDAP.authenticate(c, 'nobody', 'x'); assert.equal(r.ok, false); assert.equal(r.reason, 'Wrong user name or password.');
    r = await LDAP.authenticate(c, 'jane', ''); assert.equal(r.ok, false);                       // never an anonymous bind with an empty password
    r = await LDAP.authenticate(c, 'bob', 'Bob-Pass-1'); assert.equal(r.ok, true); assert.deepEqual(r.roleIds, []);   // right password, no mapped group
    r = await LDAP.authenticate({ ...c, defaultRoleId: 'viewer' }, 'bob', 'Bob-Pass-1'); assert.deepEqual(r.roleIds, ['viewer']);
    r = await LDAP.authenticate({ ...c, bindPassword: 'bad' }, 'jane', 'Jane-Pass-1'); assert.equal(r.ok, false); assert.match(r.reason, /service account/);
    r = await LDAP.authenticate(c, 'jane*)(uid=*', 'Jane-Pass-1'); assert.equal(r.ok, false);    // filter characters in the name are escaped
  } finally { srv.close(); }
});

test('ldap:// with StartTLS, and a certificate check that fails on an unknown certificate', async () => {
  const { srv, port } = await fakeServer({ secure: false, cert });
  try {
    const c = { url: `ldap://127.0.0.1:${port}`, startTls: true, verifyCert: false, bindDN: 'CN=svc,OU=Service,DC=corp,DC=local', bindPassword: 'svc-pass', baseDN: BASE, groupRoles: MAP };
    const r = await LDAP.authenticate(c, 'jane', 'Jane-Pass-1'); assert.equal(r.ok, true, r.reason + ' ' + r.steps.join(' | ')); assert.deepEqual(r.roleIds, ['operator']);
    const r2 = await LDAP.authenticate({ ...c, verifyCert: true }, 'jane', 'Jane-Pass-1'); assert.equal(r2.ok, false); assert.match(r2.reason, /TLS|certificate|self.signed/i);
  } finally { srv.close(); }
});

test('filters and helpers', () => {
  assert.equal(LDAP.escapeValue('a*(b)\\'), 'a\\2a\\28b\\29\\5c');
  assert.equal(LDAP.cnOf('CN=NOC\\, Ops,OU=G,DC=x'), 'NOC, Ops');
  assert.throws(() => LDAP.parseFilter('(&(a=b)'), /closed|Expected/);
  assert.equal(LDAP.parseFilter('(mail=*)')[0], 0x87);
});
