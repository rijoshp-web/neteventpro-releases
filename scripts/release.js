'use strict';
// Makes a signed release that the dashboard can install (Settings -> Updates).
//   node scripts/release.js keygen                     one time: creates release-private.pem (KEEP SECRET, never put it on the server) and prints the public key
//   node scripts/release.js build <base-url> [key.pem] writes release/NetEventPro-<version>.zip and release/latest.json; upload both files to <base-url>
// <base-url> is the folder on your web server (or the GitHub release download address) that will hold the two files, e.g. https://updates.example.com/neteventpro/
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto'); const cp = require('node:child_process');
const root = path.resolve(__dirname, '..'); const [cmd, base, keyFile = path.join(root, 'release-private.pem')] = process.argv.slice(2);
if (cmd === 'keygen') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(path.join(root, 'release-private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.log('Private key saved to release-private.pem. Keep it secret and backed up (it is not part of the program files).\nPublic key (paste into Settings -> Updates):\n');
  console.log(publicKey.export({ type: 'spki', format: 'pem' }));
} else if (cmd === 'build') {
  const baseUrl = base || (process.env.GITHUB_REPOSITORY ? `https://github.com/${process.env.GITHUB_REPOSITORY}/releases/latest/download/` : '');   // on GitHub the address is worked out by itself
  if (!/^https?:\/\//.test(baseUrl)) { console.error('Usage: node scripts/release.js build https://your.server/folder/ [private-key.pem]'); process.exit(1); }
  const ver = require('../package.json').version, out = path.join(root, 'release'), name = `NetEventPro-${ver}.zip`; fs.mkdirSync(out, { recursive: true });
  fs.rmSync(path.join(out, name), { force: true });
  // only the program files go into the package (the same list the updater is allowed to replace); anything else in the folder, such as the installer build output with node.exe, is left out
  const files = []; const keepDirs = ['src', 'public', 'scripts', 'assets', 'test', 'starter-mibs'], keepFiles = ['package.json', 'README.md', 'CHANGELOG.md', 'SECURITY.md'];
  (function walk(d, rel) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name), r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) { if (rel || keepDirs.includes(e.name)) walk(f, r); } else if (e.isFile() && (rel || keepFiles.includes(e.name))) files.push({ name: 'neteventpro/' + r, data: fs.readFileSync(f) }); } })(root, '');
  fs.writeFileSync(path.join(out, name), require('../src/xlsx').zip(files));
  const zip = fs.readFileSync(path.join(out, name)), key = crypto.createPrivateKey(process.env.NEP_RELEASE_KEY ? process.env.NEP_RELEASE_KEY.replace(/\\n/g, '\n') : fs.readFileSync(keyFile));
  const m = { version: ver, date: new Date().toISOString().slice(0, 10), url: baseUrl.replace(/\/?$/, '/') + name, sha256: crypto.createHash('sha256').update(zip).digest('hex'), sig: crypto.sign(null, zip, key).toString('base64'),
    notes: (fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').split(/^## /m)[1] || '').replace(/^[^\n]*\n/, '').trim().slice(0, 3000) };
  fs.writeFileSync(path.join(out, 'latest.json'), JSON.stringify(m, null, 2)); console.log(`Created release/${name} (${(fs.statSync(path.join(out, name)).size / 1048576).toFixed(1)} MB) and release/latest.json. Upload both to ${baseUrl}`);
} else console.log('Commands: keygen | build <base-url> [key.pem]');
