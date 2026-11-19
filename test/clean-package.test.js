'use strict';
// What ships to customers must not carry anything from the author's own system: no personal data files, no private keys,
// and no equipment names, sites or time zones from one installation.
const test = require('node:test'); const assert = require('node:assert'); const fs = require('node:fs'); const path = require('node:path');
const root = path.join(__dirname, '..');
const SHIPPED = ['src', 'public', 'starter-mibs', 'assets', 'windows'];
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, out); else out.push(f); } return out; };
const files = SHIPPED.flatMap((d) => fs.existsSync(path.join(root, d)) ? walk(path.join(root, d)) : []);

test('the shipped folders hold no data, key or database files', () => {
  const bad = files.filter((f) => /\.(pem|key|db|db-wal|db-shm|nepbak)$/i.test(f) || /(^|[\\/])(config\.json|secret\.key|release-private\.pem)$/i.test(f));
  assert.deepStrictEqual(bad, []);
});
test('the update package contains program folders only', () => {
  const src = fs.readFileSync(path.join(root, 'scripts', 'release.js'), 'utf8');
  const m = /const keepDirs = \[([^\]]*)\]/.exec(src); assert.ok(m);
  const dirs = m[1].split(',').map((x) => x.trim().replace(/'/g, ''));
  for (const forbidden of ['data', 'test', 'tools', 'docs', 'scripts', 'installer', 'release']) assert.ok(!dirs.includes(forbidden), forbidden + ' must not ship');
});
test('no equipment names, sites or time zones from the author\'s own system in the shipped code', () => {
  const ALLOW = [/src[\\/]enterprises\.js$/];   // a vendor-number lookup table (1.98.0: the Help text, now in lang-en.js, is checked too)
  const terms = /dnwp|connection master|dubai|\beltek\b|\bspectracom\b|\beventide\b/i;
  const hits = [];
  for (const f of files.filter((x) => /\.(js|html|css|json|txt|xml|vbs|ps1)$/i.test(x) && !ALLOW.some((a) => a.test(x)))) {
    const t = fs.readFileSync(f, 'utf8'); const m = terms.exec(t); if (m) hits.push(path.relative(root, f) + ': ' + m[0]);
  }
  assert.deepStrictEqual(hits, []);
});
