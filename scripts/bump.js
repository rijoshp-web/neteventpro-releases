'use strict';
// Raises the version in package.json (the one place it is kept). The service, the dashboard, backups and the installer file name all read it.
//   npm run bump            -> 1.4.0 becomes 1.4.1   (fixes)
//   npm run bump -- minor   -> 1.4.0 becomes 1.5.0   (new features)
//   npm run bump -- major   -> 1.4.0 becomes 2.0.0
const fs = require('node:fs'), path = require('node:path');
const file = path.join(__dirname, '..', 'package.json'), pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
const kind = process.argv[2] || 'patch', [a, b, c] = String(pkg.version).split('.').map(Number);
const next = kind === 'major' ? [a + 1, 0, 0] : kind === 'minor' ? [a, b + 1, 0] : kind === 'patch' ? [a, b, c + 1] : null;
if (!next) { console.error('Use: patch, minor or major'); process.exit(1); }
pkg.version = next.join('.'); fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
console.log(`NetEventPro ${a}.${b}.${c} -> ${pkg.version}. Add a line to CHANGELOG.md.`);
