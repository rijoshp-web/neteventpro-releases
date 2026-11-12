'use strict';
// 1.45: secrets in config.json and twofactor.json are encrypted on disk, readable in memory, and plain values from older versions are converted.
const test = require('node:test'); const assert = require('node:assert'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');

function freshConfig(initial) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nep-sec-')); if (initial) fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(initial));
  process.env.NETEVENTPRO_DATA = dir; const { Config } = require('../src/config'); return { dir, cfg: new Config() };
}

test('older plain secrets are converted to encrypted ones, and read back plain in memory', () => {
  const { dir, cfg } = freshConfig({ smtp: { host: 'h', password: 'smtp-secret' }, smpp: { password: 'smpp-secret' }, sqlCopy: { password: 'sql-secret' }, webhooks: [{ name: 'w', url: 'https://hooks.example/abc-token' }], notifProfiles: [{ id: 'a', name: 'n', webhook: { on: true, url: 'https://teams.example/xyz-token' } }], reports: [{ id: 'r', folder: { password: 'share-secret' } }] });
  assert.equal(cfg.get().smtp.password, 'smtp-secret'); assert.equal(cfg.get().notifProfiles[0].webhook.url, 'https://teams.example/xyz-token');
  const disk = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
  for (const t of ['smtp-secret', 'smpp-secret', 'sql-secret', 'abc-token', 'xyz-token', 'share-secret']) assert.ok(!disk.includes(t), t + ' must not be on disk');
  assert.equal((disk.match(/enc1:/g) || []).length, 6);
  const again = new (require('../src/config').Config)(); assert.equal(again.get().sqlCopy.password, 'sql-secret'); assert.equal(again.get().reports[0].folder.password, 'share-secret');
  again.update({ smtp: { ...again.get().smtp, password: 'new-pass' } });
  assert.ok(!fs.readFileSync(path.join(dir, 'config.json'), 'utf8').includes('new-pass')); assert.equal(new (require('../src/config').Config)().get().smtp.password, 'new-pass');
  assert.ok(again.plainJson().includes('new-pass'), 'a backup copy carries readable settings so it restores on another computer');
});

test('empty secrets stay empty, and a lost key does not crash (the secret is just gone)', () => {
  const { dir, cfg } = freshConfig({ smtp: { host: 'h', password: '' } });
  cfg.update({ smtp: { ...cfg.get().smtp, password: 'x' } }); fs.writeFileSync(path.join(dir, 'secret.key'), Buffer.alloc(32, 7));
  const lost = new (require('../src/config').Config)(); assert.equal(lost.get().smtp.password, ''); assert.equal(lost.get().smtp.host, 'h');
});

test('two-factor secrets are encrypted in twofactor.json and a 1.43 plain file is converted', () => {
  const sec = require('../src/security'); const { SecretBox } = require('../src/secretbox'); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf2-'));
  const secret = sec.newSecret(); fs.writeFileSync(path.join(dir, 'twofactor.json'), JSON.stringify({ bob: { secret, recovery: [], last: 0 } }));
  const box = new SecretBox(dir); const st = new sec.TwoFactorStore(dir, box);
  assert.ok(st.has('bob')); assert.ok(!fs.readFileSync(path.join(dir, 'twofactor.json'), 'utf8').includes(secret));
  assert.ok(st.check('bob', sec.hotp(secret, Math.floor(Date.now() / 30000))) === 'totp');
  assert.ok(!fs.readFileSync(path.join(dir, 'twofactor.json'), 'utf8').includes(secret)); assert.ok(new sec.TwoFactorStore(dir, box).has('bob'));
});
