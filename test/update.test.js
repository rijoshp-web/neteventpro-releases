'use strict';
const test = require('node:test'); const assert = require('node:assert'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http'); const crypto = require('node:crypto'); const cp = require('node:child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nepu-')); const app = path.join(tmp, 'app'), data = path.join(tmp, 'data'), pkgDir = path.join(tmp, 'pkg', 'neteventpro');
fs.mkdirSync(path.join(app, 'src'), { recursive: true }); fs.mkdirSync(data, { recursive: true }); fs.writeFileSync(path.join(app, 'src', 'server.js'), '// old'); fs.writeFileSync(path.join(app, 'package.json'), '{"version":"1.0.0"}');
process.env.NEP_UPDATE_ROOT = app;
const { Updater, readZip, plan, newer } = require('../src/update');

function makeZip(files, name) { fs.rmSync(path.join(tmp, 'pkg'), { recursive: true, force: true }); for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(pkgDir, f)), { recursive: true }); fs.writeFileSync(path.join(pkgDir, f), c); } const z = path.join(tmp, name); fs.rmSync(z, { force: true }); cp.execFileSync('zip', ['-qr', z, 'neteventpro'], { cwd: path.join(tmp, 'pkg') }); return fs.readFileSync(z); }
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519'), pubPem = publicKey.export({ type: 'spki', format: 'pem' });

test('version comparison', () => { assert.ok(newer('1.12.0', '1.11.9')); assert.ok(!newer('1.11.0', '1.11.0')); assert.ok(newer('2.0.0', '1.99.99')); });
test('the zip reader and path plan: only program folders, no tricks', () => {
  const zip = makeZip({ 'package.json': '{"version":"2.0.0"}', 'src/server.js': '// new', 'public/app.js': 'x', 'windows/svc.exe': 'no', 'installer/a.iss': 'no', 'data/syslog.db': 'no' }, 'a.zip');
  const f = plan(readZip(zip)).map((x) => x.rel).sort(); assert.deepStrictEqual(f, ['package.json', 'public/app.js', 'src/server.js']);
  assert.throws(() => plan([{ name: 'neteventpro/package.json', data: Buffer.from('{}') }, { name: 'neteventpro/src/../../evil.js', data: Buffer.from('x') }]), /unsafe/);
  assert.throws(() => plan([{ name: 'package.json', data: Buffer.from('{}') }, { name: 'C:/x.js', data: Buffer.from('x') }]), /unsafe/);
  assert.throws(() => plan([{ name: 'package.json', data: Buffer.from('{}') }, { name: 'src/a.js', data: Buffer.from('x') }]), /does not look like/);
});
test('check, verify and install a signed release; refuse a tampered or wrongly signed one', async () => {
  const zip = makeZip({ 'package.json': '{"version":"1.1.0"}', 'src/server.js': '// new version' }, 'r.zip');
  let served = { zip, sig: crypto.sign(null, zip, privateKey).toString('base64'), sha: crypto.createHash('sha256').update(zip).digest('hex') };
  const srv = http.createServer((q, r) => { if (q.url === '/latest.json') { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ version: '1.1.0', url: '/r.zip', sha256: served.sha, sig: served.sig, notes: 'n' })); } else if (q.url === '/r.zip') r.end(served.zip); else { r.statusCode = 404; r.end(); } });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${srv.address().port}`;
  let cfg = { update: { custom: true, url: base + '/latest.json', publicKey: pubPem } };
  const u = new Updater({ dir: data, get: () => cfg }, '1.0.0');
  const c = await u.check(); assert.strictEqual(c.available, true); assert.strictEqual(c.latest, '1.1.0'); assert.strictEqual(c.canInstall, true);
  cfg = { update: { custom: true, url: base + '/latest.json', publicKey: crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }) } };
  await assert.rejects(u.install(), /signature is not valid/); assert.strictEqual(fs.readFileSync(path.join(app, 'src', 'server.js'), 'utf8'), '// old');
  cfg = { update: { custom: true, url: base + '/latest.json', publicKey: pubPem } }; const good = served.zip;
  served.zip = Buffer.concat([good, Buffer.from('x')]); await assert.rejects(u.install(), /SHA-256/); assert.strictEqual(fs.readFileSync(path.join(app, 'src', 'server.js'), 'utf8'), '// old');
  served.zip = good; assert.strictEqual(await u.install(), '1.1.0');
  assert.strictEqual(fs.readFileSync(path.join(app, 'src', 'server.js'), 'utf8'), '// new version'); assert.ok(fs.existsSync(path.join(data, 'updates', 'backup-1.0.0', 'src', 'server.js'))); assert.ok(fs.existsSync(path.join(data, 'updates', 'pending.json')));
  cfg = { update: { custom: true, url: base + '/latest.json', publicKey: '' } }; const u2 = new Updater({ dir: data, get: () => cfg }, '1.0.0'); await u2.check(); assert.strictEqual(u2.pub().canInstall, true);
  await assert.rejects(u2.install(), /signature is not valid/);
  srv.close();
});
test('1.49: a server keeps its signed package and a probe installs it only after the signature checks', () => {
  const cfg0 = { dir: data, get: () => ({ update: {} }) }, up = path.join(data, 'updates'), keep = path.join(tmp, 'keep-updates');
  fs.rmSync(keep, { recursive: true, force: true }); fs.cpSync(up, keep, { recursive: true });
  const main = new Updater(cfg0, '1.1.0'), pk = main.probePackage(); assert.ok(pk, 'the package of the installed version is kept'); assert.strictEqual(pk.meta.version, '1.1.0');
  assert.strictEqual(new Updater(cfg0, '1.0.0').probePackage(), null, 'only the package of the running version is offered');
  const probe = new Updater(cfg0, '1.0.0'), meta = pk.meta;
  const otherKey = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  assert.throws(() => probe.installFromServer(pk.zip, meta, otherKey), /signature is not valid/);
  assert.throws(() => probe.installFromServer(Buffer.concat([pk.zip, Buffer.from('x')]), meta, pubPem), /SHA-256/);
  assert.throws(() => probe.installFromServer(pk.zip, { ...meta, sig: '' }, pubPem), /not signed/);
  assert.throws(() => new Updater(cfg0, '1.1.0').installFromServer(pk.zip, meta, pubPem), /not newer/);
  assert.strictEqual(probe.installFromServer(pk.zip, meta, pubPem), '1.1.0');
  fs.rmSync(up, { recursive: true, force: true }); fs.cpSync(keep, up, { recursive: true }); fs.writeFileSync(path.join(app, 'src', 'server.js'), '// old');   // leave things as the next test expects
});
test('1.50: a server updated from the installer offers its own program files; the probe checks the SHA-256', () => {
  const up = path.join(data, 'updates'), keep = path.join(tmp, 'keep2-updates'); fs.rmSync(keep, { recursive: true, force: true }); fs.cpSync(up, keep, { recursive: true });
  fs.writeFileSync(path.join(app, 'src', 'server.js'), '// new version');
  const cfg0 = { dir: data, get: () => ({ update: {} }) }, main = new Updater(cfg0, '1.1.0'), ob = main.ownBundle();
  assert.strictEqual(ob.version, '1.1.0'); assert.match(ob.sha256, /^[0-9a-f]{64}$/);
  const probe = new Updater(cfg0, '1.0.0');
  assert.throws(() => probe.installBundle(ob.blob, ob.version, '0'.repeat(64)), /SHA-256/);
  assert.throws(() => new Updater(cfg0, '1.1.0').installBundle(ob.blob, ob.version, ob.sha256), /not newer/);
  fs.writeFileSync(path.join(app, 'src', 'server.js'), '// changed on the probe');
  assert.strictEqual(probe.installBundle(ob.blob, ob.version, ob.sha256), '1.1.0');
  assert.strictEqual(fs.readFileSync(path.join(app, 'src', 'server.js'), 'utf8'), '// new version');
  fs.rmSync(up, { recursive: true, force: true }); fs.cpSync(keep, up, { recursive: true }); fs.writeFileSync(path.join(app, 'src', 'server.js'), '// old');
});
test('a version that keeps failing to start is rolled back', () => {
  const guard = `require(${JSON.stringify(path.resolve(__dirname, '../src/update.js'))}).bootGuard(${JSON.stringify(data)})`;
  const run = () => cp.spawnSync(process.execPath, ['-e', `process.env.NEP_UPDATE_ROOT=${JSON.stringify(app)}; ${guard}; process.exit(3)`], { env: { ...process.env, NEP_UPDATE_ROOT: app } });
  assert.strictEqual(run().status, 3); assert.strictEqual(run().status, 3); assert.strictEqual(run().status, 3);
  assert.strictEqual(run().status, 1);       // 4th start: restores the old files and exits
  assert.strictEqual(fs.readFileSync(path.join(app, 'src', 'server.js'), 'utf8'), '// old'); assert.ok(!fs.existsSync(path.join(data, 'updates', 'pending.json')));
});

test('Node.js update: checksum, test run, swap by rename, keep the old file, roll back', async () => {
  const dist = path.join(tmp, 'dist'), nodeDir = path.join(tmp, 'nodeapp'); fs.mkdirSync(nodeDir, { recursive: true });
  const target = path.join(nodeDir, 'node.exe'); fs.writeFileSync(target, '#!/bin/sh\necho old', { mode: 0o755 });
  const mkNode = (ver, script) => { fs.rmSync(path.join(tmp, 'pkg'), { recursive: true, force: true }); const d = path.join(tmp, 'pkg', `node-${ver}-win-x64`); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'node.exe'), script, { mode: 0o755 }); fs.writeFileSync(path.join(d, 'npm.cmd'), 'x'); const z = path.join(tmp, 'n.zip'); fs.rmSync(z, { force: true }); cp.execFileSync('zip', ['-qr', z, `node-${ver}-win-x64`], { cwd: path.join(tmp, 'pkg') }); return fs.readFileSync(z); };
  const major = process.version.split('.')[0], ver = `${major}.99.0`; let zip = mkNode(ver, `#!/bin/sh\nprintf ${ver}`), sums = (z) => `${crypto.createHash('sha256').update(z).digest('hex')}  node-${ver}-win-x64.zip\n`, shaOverride = null;
  const srv = http.createServer((q, r) => { if (q.url === '/index.json') r.end(JSON.stringify([{ version: ver, security: true }])); else if (q.url === `/${ver}/SHASUMS256.txt`) r.end(shaOverride || sums(zip)); else if (q.url === `/${ver}/node-${ver}-win-x64.zip`) r.end(zip); else { r.statusCode = 404; r.end(); } });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok)); process.env.NEP_NODE_PATH = target;
  const u = new Updater({ dir: data, get: () => ({ update: { custom: true, url: 'http://127.0.0.1:9/none.json', publicKey: '', nodeBase: `http://127.0.0.1:${srv.address().port}/` } }) }, '1.0.0');
  const c = await u.check(); assert.strictEqual(c.node.latest, ver); assert.strictEqual(c.node.behind, true); assert.strictEqual(c.node.canInstall, true);
  shaOverride = '0'.repeat(64) + `  node-${ver}-win-x64.zip\n`; await assert.rejects(u.installNode(), /SHA-256/); assert.strictEqual(fs.readFileSync(target, 'utf8'), '#!/bin/sh\necho old'); shaOverride = null;
  zip = mkNode(ver, '#!/bin/sh\nexit 3'); await assert.rejects(u.installNode(), /test run/); assert.strictEqual(fs.readFileSync(target, 'utf8'), '#!/bin/sh\necho old'); assert.ok(!fs.existsSync(path.join(nodeDir, 'node-new.exe')));
  zip = mkNode(ver, `#!/bin/sh\nprintf ${ver}`); assert.strictEqual(await u.installNode(), ver);
  assert.ok(fs.readFileSync(target, 'utf8').includes(`printf ${ver}`)); assert.strictEqual(fs.readFileSync(target + '.old', 'utf8'), '#!/bin/sh\necho old'); assert.ok(fs.existsSync(path.join(data, 'updates', 'pending-node.json')));
  // the program keeps failing to start with the new node: the old one is restored
  const { bootGuard } = require('../src/update'); const run = () => cp.spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.resolve(__dirname, '../src/update.js'))}).bootGuard(${JSON.stringify(data)}); process.exit(3)`]);
  assert.strictEqual(run().status, 3); assert.strictEqual(run().status, 3); assert.strictEqual(run().status, 3); assert.strictEqual(run().status, 1);
  assert.strictEqual(fs.readFileSync(target, 'utf8'), '#!/bin/sh\necho old'); assert.ok(!fs.existsSync(path.join(data, 'updates', 'pending-node.json')));
  delete process.env.NEP_NODE_PATH; srv.close();
});

test('built-in update source: no address or key has to be set', () => {
  const D = require('../src/update-defaults'); const u = new Updater({ dir: data, get: () => ({}) }, '1.0.0');
  assert.match(u.cfg.url, /^https:\/\/github\.com\/.+\/releases\/latest\/download\/latest\.json$/); assert.strictEqual(u.cfg.publicKey, D.publicKey); assert.strictEqual(u.cfg.autoCheck, true);
  assert.strictEqual(u.pub().hasKey, true);   /* the embedded key is a valid Ed25519 key */
  assert.doesNotThrow(() => crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(D.publicKey, 'base64')]), format: 'der', type: 'spki' }));
  assert.strictEqual(new Updater({ dir: data, get: () => ({ update: { url: 'http://x/y.json', publicKey: 'K', custom: true } }) }, '1.0.0').cfg.url, 'http://x/y.json');   /* a deliberate override wins */
  assert.strictEqual(new Updater({ dir: data, get: () => ({ update: { url: 'http://old/y.json', publicKey: 'OLD' } }) }, '1.0.0').cfg.publicKey, D.publicKey);   /* leftovers of an older version are ignored */
});
