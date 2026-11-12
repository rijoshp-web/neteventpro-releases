'use strict';
const test = require('node:test'); const assert = require('node:assert'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { MibStore, installStarterMibs } = require('../src/mib');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nep-mib-'));
const SRC = path.join(__dirname, '..', 'starter-mibs');

test('every shipped standard MIB loads and has all its imports', () => {
  const m = new MibStore(SRC); const names = fs.readdirSync(SRC).filter((n) => n.endsWith('.mib'));
  assert.ok(names.length > 150, 'the starter pack is there');
  for (const n of names) { const i = m.fileInfo(n); assert.deepStrictEqual(i.missing, [], n + ' misses imports'); assert.strictEqual(i.unresolved, 0, n + ' has unresolved names'); }
  assert.strictEqual(m.name([1, 3, 6, 1, 2, 1, 2, 2, 1, 8], true).endsWith('ifOperStatus'), true);
});
test('starter MIBs are copied once, never overwrite, never come back after a delete, and skip modules the user already has', () => {
  const dir = tmp(), src = tmp();
  const mib = (mod, extra = '') => `${mod} DEFINITIONS ::= BEGIN\nIMPORTS enterprises FROM SNMPv2-SMI;\nx${mod.replace(/-/g, '')} OBJECT IDENTIFIER ::= { enterprises 99${extra} }\nEND\n`;
  fs.writeFileSync(path.join(src, 'A-MIB.mib'), mib('A-MIB')); fs.writeFileSync(path.join(src, 'B-MIB.mib'), mib('B-MIB')); fs.writeFileSync(path.join(src, 'C-MIB.mib'), mib('C-MIB'));
  fs.writeFileSync(path.join(dir, 'my-b.mib'), mib('B-MIB', '1'));            // the user already has module B-MIB under another file name
  fs.writeFileSync(path.join(dir, 'A-MIB.mib'), 'A-MIB DEFINITIONS ::= BEGIN\n-- user copy\nEND\n');   // same file name: kept as it is
  let r = installStarterMibs(dir, src); assert.deepStrictEqual(r, { copied: 1, skipped: 2 });
  assert.ok(fs.existsSync(path.join(dir, 'C-MIB.mib')) && !fs.existsSync(path.join(dir, 'B-MIB.mib')));
  assert.ok(fs.readFileSync(path.join(dir, 'A-MIB.mib'), 'utf8').includes('user copy'));
  fs.unlinkSync(path.join(dir, 'C-MIB.mib')); r = installStarterMibs(dir, src); assert.deepStrictEqual(r, { copied: 0, skipped: 0 });   // removed by the user: stays removed
  fs.writeFileSync(path.join(src, 'D-MIB.mib'), mib('D-MIB')); r = installStarterMibs(dir, src); assert.strictEqual(r.copied, 1);   // a file new in a later version is offered
  assert.strictEqual(installStarterMibs(dir, path.join(src, 'nope')).copied, 0);
});
