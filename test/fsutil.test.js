'use strict';
const test = require('node:test'); const assert = require('node:assert'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { ensureDir, isUnc } = require('../src/fsutil');
test('ensureDir: existing folder is used as it is, new nested folder is created, UNC paths are recognised', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nep-fs-'));
  assert.strictEqual(ensureDir(d), d); const n = path.join(d, 'a', 'b'); assert.strictEqual(ensureDir(n), n); assert.ok(fs.statSync(n).isDirectory());
  assert.ok(isUnc('\\\\10.1.1.1\\Share\\x') && !isUnc('C:\\x'));
  const f = path.join(d, 'file'); fs.writeFileSync(f, 'x'); assert.throws(() => ensureDir(path.join(f, 'sub')));
});
test('prepareFolder: a sign-in is only used for a network share on Windows; a normal folder just works', async () => {
  const { prepareFolder, connectShare } = require('../src/fsutil'); const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nep-fs2-'));
  assert.strictEqual(await prepareFolder(path.join(d, 'x'), 'user', 'pw'), path.join(d, 'x'));
  await connectShare('\\\\10.1.1.1\\share', 'user', 'pw');   // not Windows here: nothing to do, no error
});
