'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const sec = require('../src/security');
const { hashPassword, needsRehash } = require('../src/auth');

test('TOTP matches the RFC 6238 test vector and tolerates one step of clock drift', () => {
  const secret = sec.b32encode(Buffer.from('12345678901234567890'));
  assert.equal(sec.hotp(secret, Math.floor(59 / 30)), '287082');
  const now = 1700000000000, code = sec.hotp(secret, Math.floor(now / 30000));
  assert.ok(sec.totpStep(secret, code, now) > 0);
  assert.ok(sec.totpStep(secret, code, now + 30000) > 0);
  assert.equal(sec.totpStep(secret, code, now + 95000), -1);
  assert.equal(sec.totpStep(secret, 'abcdef', now), -1);
});

test('two-factor store: a code works once, recovery codes work once, state survives a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-')); const st = new sec.TwoFactorStore(dir); const secret = sec.newSecret();
  assert.equal(st.enable('bob', secret, '000000'), null);
  const code = sec.hotp(secret, Math.floor(Date.now() / 30000)); const rec = st.enable('bob', secret, code);
  assert.equal(rec.length, 10); assert.ok(st.has('bob'));
  assert.equal(st.check('bob', code), '');                       // the enabling code is already used
  assert.equal(st.check('bob', rec[0]), 'recovery'); assert.equal(st.check('bob', rec[0]), '');
  assert.equal(st.recoveryLeft('bob'), 9);
  const again = new sec.TwoFactorStore(dir); assert.ok(again.has('bob')); assert.equal(again.recoveryLeft('bob'), 9);
  again.disable('bob'); assert.ok(!new sec.TwoFactorStore(dir).has('bob'));
});

test('password policy', () => {
  const pol = sec.cleanPolicy({ minLength: 12, complexity: true });
  assert.match(sec.passwordProblem('short1A!', pol), /at least 12/);
  assert.match(sec.passwordProblem('alllowercaseletters', pol), /three of/);
  assert.match(sec.passwordProblem('Rijosh-Secret-2026', pol, 'rijosh'), /user name/);
  assert.equal(sec.passwordProblem('Tr1cky-Pass-Phrase', pol, 'rijosh'), '');
  assert.equal(sec.passwordProblem('longenough', sec.POLICY_DEFAULT), '');
  assert.match(sec.passwordProblem('aaaaaaaaaa'), /easy to guess/);
});

test('policy sanitising clamps values and splits the allow-list', () => {
  const p = sec.cleanPolicy({ minLength: 2, lockFails: 99, lockMinutes: 0, webAllow: '10.0.0.0/24, 192.168.1.5;  ' });
  assert.equal(p.minLength, 8); assert.equal(p.lockFails, 20); assert.equal(p.lockMinutes, 1); assert.deepEqual(p.webAllow, ['10.0.0.0/24', '192.168.1.5']);
});

test('account lockout locks after N fails, unlocks, and can be switched off', () => {
  const g = new sec.AccountGuard(), pol = sec.cleanPolicy({ lockFails: 3, lockMinutes: 5 });
  for (let i = 0; i < 2; i++) g.fail('bob', pol); assert.equal(g.locked('bob', pol), 0);
  g.fail('bob', pol); assert.ok(g.locked('bob', pol) > Date.now()); assert.equal(g.list()[0].name, 'bob');
  g.unlock('bob'); assert.equal(g.locked('bob', pol), 0);
  const off = sec.cleanPolicy({ accountLock: false }); for (let i = 0; i < 9; i++) g.fail('al', off); assert.equal(g.locked('al', off), 0);
});

test('new hashes use the stronger cost and older hashes are flagged for an upgrade', async () => {
  const h = await hashPassword('x'); assert.equal(needsRehash(h), false);
  assert.equal(needsRehash('scrypt$16384$8$1$AAAA$BBBB'), true);
});
