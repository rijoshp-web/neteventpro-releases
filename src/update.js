'use strict';
// Online update: check a release manifest, download the package, verify it, replace the program files, restart.
// Safety rules (an update is code that will run on this PC, so these are strict):
//  * the package must carry an Ed25519 signature that matches the public key saved in Settings (nothing unsigned is ever installed);
//  * the SHA-256 in the manifest must match the download;
//  * only the program folders are replaced (src, public, scripts, assets and a few text files). Settings, the database and users are never touched;
//  * paths in the package are checked (no "..", no drive letters), and the old files are kept so the update can be rolled back;
//  * if the new version does not start, the old files are put back automatically (boot guard below).

const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto'); const zlib = require('node:zlib');
const ROOT = process.env.NEP_UPDATE_ROOT ? path.resolve(process.env.NEP_UPDATE_ROOT) : path.resolve(__dirname, '..');   // the override is for tests only
const ALLOWED_TOP = ['src', 'public', 'scripts', 'assets', 'test', 'starter-mibs'], ALLOWED_FILES = ['package.json', 'README.md', 'CHANGELOG.md', 'SECURITY.md'];
const DEFAULTS = require('./update-defaults');
const MAX_ZIP = 60 * 1024 * 1024, MAX_UNPACKED = 150 * 1024 * 1024, MAX_ENTRIES = 20000;

const semver = (v) => String(v || '').replace(/^v/, '').split('-')[0].split('.').map((x) => parseInt(x, 10) || 0).concat([0, 0, 0]).slice(0, 3);
function newer(a, b) { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; }

async function get(url, limit, ms = 20000) {
  if (!/^https?:\/\//i.test(url)) throw new Error('The update address must start with https:// (or http:// on your own network).');
  let r; const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  try { r = await fetch(url, { signal: AbortSignal.timeout(ms), redirect: 'follow', headers: { 'user-agent': 'NetEventPro-updater' } }); }
  catch (e) {   // "fetch failed" alone says nothing: show why
    const code = e.cause?.code || e.name; const why = { ECONNREFUSED: 'nothing is listening there (is the web server running?)', ENOTFOUND: 'the name could not be found (no DNS or no internet)', ETIMEDOUT: 'no answer (a firewall may block it)', EAI_AGAIN: 'the name could not be looked up (no DNS or no internet)', ECONNRESET: 'the connection was cut', TimeoutError: 'no answer in time', CERT_HAS_EXPIRED: 'its certificate has expired', UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'its certificate is not trusted by this PC' }[code] || code || e.message;
    throw new Error(`Cannot reach ${host}: ${why}.`);
  }
  if (!r.ok) throw new Error(`The update server answered ${r.status} ${r.statusText || ''}`.trim());
  const len = +r.headers.get('content-length') || 0; if (len > limit) throw new Error(`The download is ${(len / 1048576).toFixed(0)} MB; more than ${(limit / 1048576).toFixed(0)} MB is not allowed. Rebuild the release with the newest scripts/release.js (it leaves out unrelated folders).`);
  const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > limit) throw new Error(`The download is ${(buf.length / 1048576).toFixed(0)} MB; more than ${(limit / 1048576).toFixed(0)} MB is not allowed. Rebuild the release with the newest scripts/release.js (it leaves out unrelated folders).`);
  return buf;
}

function publicKeyOf(text) {
  const t = String(text || '').trim(); if (!t) throw new Error('No update public key is set. Paste the release public key in Settings → Updates first.');
  try { return t.includes('BEGIN') ? crypto.createPublicKey(t) : crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(t, 'base64')]), format: 'der', type: 'spki' }); }
  catch { throw new Error('The update public key is not valid (use the PEM text or the 32-byte base64 key made by "node scripts/release.js keygen").'); }
}

/** a minimal ZIP reader (stored and deflate entries) so the app needs no extra software */
function readZip(buf, want) {
  let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('The package is not a valid zip file.');
  const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16); if (n > MAX_ENTRIES) throw new Error('The package has too many files.');
  const out = []; let total = 0;
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The package directory is damaged.');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lh = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl); p += 46 + nl + el + cl;
    if (name.endsWith('/') || (want && !want(name))) continue; total += usize; if (total > MAX_UNPACKED) throw new Error('The package unpacks to more than allowed.');
    const ln = buf.readUInt16LE(lh + 26), le = buf.readUInt16LE(lh + 28), start = lh + 30 + ln + le, raw = buf.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: MAX_UNPACKED }) : null; if (!data) throw new Error('Unsupported compression in the package.');
    out.push({ name, data });
  }
  return out;
}

/** package names -> safe relative paths inside the program folder (anything else throws) */
function plan(entries) {
  let prefix = ''; const first = entries.find((e) => e.name.endsWith('package.json') && e.name.split('/').length <= 2); if (!first) throw new Error('The package has no package.json.');
  if (first.name.includes('/')) prefix = first.name.slice(0, first.name.indexOf('/') + 1);
  const files = [];
  for (const e of entries) {
    if (prefix && !e.name.startsWith(prefix)) continue; const rel = e.name.slice(prefix.length).replace(/\\/g, '/');
    if (!rel || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel) || rel.split('/').some((s) => s === '..' || s === '' || s === '.')) throw new Error('The package contains an unsafe path: ' + e.name);
    const top = rel.split('/')[0]; if (rel.includes('/') ? !ALLOWED_TOP.includes(top) : !ALLOWED_FILES.includes(rel)) continue;   // other files (installer, service wrapper, node) are never replaced online
    files.push({ rel, data: e.data });
  }
  if (!files.some((f) => f.rel === 'src/server.js')) throw new Error('The package does not look like NetEventPro (src/server.js is missing).');
  return files;
}

class Updater {
  constructor(config, version) { this.config = config; this.version = version; this.info = { checkedAt: 0, error: '', current: version, available: false }; this.busy = false; }
  get cfg() { const u = this.config.get().update || {}; return { ...u, url: u.url || DEFAULTS.url, publicKey: u.publicKey || DEFAULTS.publicKey, autoCheck: u.autoCheck !== false }; }   /* nothing to set up: the built-in address and key are used unless a config file overrides them */
  get nodeBase() { return (this.cfg.nodeBase || 'https://nodejs.org/dist').replace(/\/+$/, ''); }
  /** where the program's own node.exe is. Only a copy that runs from its own "node" folder (the installed service) may be replaced. */
  nodeTarget() {
    const t = process.env.NEP_NODE_PATH || process.execPath;
    if (!process.env.NEP_NODE_PATH && process.platform !== 'win32') return { ok: false, why: 'Automatic Node.js update is for the Windows service. Update Node.js with your system package manager here.', target: t };
    if (!process.env.NEP_NODE_PATH && path.basename(t).toLowerCase() !== 'node.exe') return { ok: false, why: 'This copy does not run from its own node.exe.', target: t };
    try { fs.accessSync(path.dirname(t), fs.constants.W_OK); } catch { return { ok: false, why: 'The service has no permission to write to ' + path.dirname(t), target: t }; }
    return { ok: true, why: '', target: t };
  }
  get dir() { return path.join(this.config.dir, 'updates'); }

  /** looks at the release manifest (and, where the internet is reachable, at the newest Node.js patch release for this major version) */
  async check() {
    const c = this.cfg, info = { checkedAt: Date.now(), error: '', current: this.version, available: false, node: null };
    try {
      const m = JSON.parse((await get(c.url, 65536, 15000)).toString('utf8'));
      if (!m || typeof m.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(m.version)) throw new Error('The release file has no valid version number.');
      info.latest = m.version; info.notes = String(m.notes || '').slice(0, 4000); info.available = newer(m.version, this.version); info.date = String(m.date || '').slice(0, 40);
      info.manifest = { version: m.version, url: new URL(String(m.url || ''), c.url).href, sha256: String(m.sha256 || '').toLowerCase(), sig: String(m.sig || '') };
    } catch (e) { info.error = e.name === 'TimeoutError' ? 'The update server did not answer in time.' : e.message; if (/Cannot reach|did not answer/.test(info.error)) info.offline = true; }
    try {   // runtime patch level: Node itself is the other thing that needs security updates
      const idx = JSON.parse((await get(this.nodeBase + '/index.json', 2e6, 8000)).toString('utf8')), major = process.version.split('.')[0];
      const best = idx.find((x) => x.version.startsWith(major + '.')); if (best) info.node = { current: process.version, latest: best.version, behind: newer(best.version, process.version), security: !!best.security, canInstall: this.nodeTarget().ok, why: this.nodeTarget().why };
    } catch (e) { info.node = null; info.nodeError = e.message; }
    this.info = info; return this.pub();
  }
  pub() { const { manifest, ...rest } = this.info; return { ...rest, canInstall: !!(this.info.available && manifest && this.cfg.publicKey), hasKey: !!this.cfg.publicKey, busy: this.busy }; }

  /** Replaces node.exe with the newest patch release of the same major version. Windows will not let a running exe be overwritten, but it does let it be renamed:
   *  download -> check SHA-256 against nodejs.org's list -> test-run the new file -> rename old to node.exe.old -> put new in place -> restart. */
  async installNode() {
    if (this.busy) throw new Error('An update is already running.'); this.busy = true;
    try {
      await this.check(); const n = this.info.node; if (!n) throw new Error('Node.js information could not be read from ' + this.nodeBase);
      const tg = this.nodeTarget(); if (!tg.ok) throw new Error(tg.why); if (!n.behind) throw new Error(`Node.js ${n.current} is already the newest ${process.version.split('.')[0]}.x release.`);
      const file = `node-${n.latest}-win-x64.zip`, base = `${this.nodeBase}/${n.latest}`;
      const sums = (await get(`${base}/SHASUMS256.txt`, 1e6, 15000)).toString('utf8'), line = sums.split('\n').find((l) => l.trim().endsWith('  ' + file) || l.trim().endsWith(' ' + file));
      const want = line && line.trim().split(/\s+/)[0].toLowerCase(); if (!/^[0-9a-f]{64}$/.test(want || '')) throw new Error(`No checksum for ${file} was published.`);
      const zip = await get(`${base}/${file}`, 150 * 1024 * 1024, 600000);
      if (crypto.createHash('sha256').update(zip).digest('hex') !== want) throw new Error('The Node.js download does not match its published SHA-256. Nothing was changed.');
      const ent = readZip(zip, (nm) => nm.toLowerCase().endsWith('/node.exe') && nm.split('/').length === 2)[0]; if (!ent) throw new Error('node.exe was not found in the Node.js package.');
      if (!process.env.NEP_NODE_PATH && (ent.data.length < 10e6 || ent.data.subarray(0, 2).toString('latin1') !== 'MZ')) throw new Error('The downloaded node.exe does not look like a Windows program.');
      const dir = path.dirname(tg.target), fresh = path.join(dir, 'node-new.exe'), old = tg.target + '.old';
      fs.writeFileSync(fresh, ent.data, { mode: 0o755 });
      try {   // the new file must run and have the database part before it replaces anything
        const out = require('node:child_process').execFileSync(fresh, ['-e', "require('node:sqlite');require('node:crypto');process.stdout.write(process.version)"], { timeout: 20000, windowsHide: true }).toString().trim();
        if (out !== n.latest) throw new Error(`it reports ${out || 'nothing'}, expected ${n.latest}`);
      } catch (e) { fs.rmSync(fresh, { force: true }); throw new Error('The new node.exe did not pass its test run (' + e.message.split('\n')[0] + '). Nothing was changed.'); }
      fs.rmSync(old, { force: true }); fs.renameSync(tg.target, old);
      try { fs.renameSync(fresh, tg.target); } catch (e) { fs.renameSync(old, tg.target); fs.rmSync(fresh, { force: true }); throw new Error('Could not put the new node.exe in place: ' + e.message); }
      fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(path.join(this.dir, 'pending-node.json'), JSON.stringify({ from: process.version, to: n.latest, target: tg.target, old, attempts: 0, at: Date.now() }));
      return n.latest;
    } finally { this.busy = false; }
  }

  /** download, verify, back up and replace the program files. Returns the new version; the caller restarts the service. */
  async install() {
    if (this.busy) throw new Error('An update is already running.'); this.busy = true;
    try {
      if (!this.info.manifest) await this.check(); const m = this.info.manifest; if (!m || !this.info.available) throw new Error(this.info.error || 'There is no newer version to install.');
      const key = publicKeyOf(this.cfg.publicKey);
      if (!/^[0-9a-f]{64}$/.test(m.sha256) || !m.sig) throw new Error('The release is not signed (sha256 and sig are required).');
      const zip = await get(m.url, MAX_ZIP, 120000);
      if (crypto.createHash('sha256').update(zip).digest('hex') !== m.sha256) throw new Error('The download does not match its SHA-256. Nothing was installed.');
      if (!crypto.verify(null, zip, key, Buffer.from(m.sig, 'base64'))) throw new Error('The signature is not valid for your public key. Nothing was installed.');
      const v = this.apply(zip, m.version);
      try { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(path.join(this.dir, 'probe-package.zip'), zip); fs.writeFileSync(path.join(this.dir, 'probe-package.json'), JSON.stringify({ version: m.version, sha256: m.sha256, sig: m.sig })); } catch { /* probes then cannot be updated from here */ }
      return v;
    } finally { this.busy = false; }
  }
  /** writes a verified package over the program files (backup first, boot guard afterwards). Returns the version. */
  apply(zip, version) { return this.applyFiles(plan(readZip(zip)), version); }
  applyFiles(files, version) {
    const pk = files.find((f) => f.rel === 'package.json'); let pv; try { pv = JSON.parse(pk.data.toString('utf8')).version; } catch { pv = ''; }
    if (!files.some((f) => f.rel === 'src/server.js')) throw new Error('The package does not look like NetEventPro (src/server.js is missing).');
    if (pv !== version) throw new Error(`The package contains version ${pv || '?'} but the release file says ${version}. Nothing was installed.`);
    const bak = path.join(this.dir, 'backup-' + this.version); fs.rmSync(bak, { recursive: true, force: true });
    for (const t of [...ALLOWED_TOP, ...ALLOWED_FILES]) if (fs.existsSync(path.join(ROOT, t))) fs.cpSync(path.join(ROOT, t), path.join(bak, t), { recursive: true });
    const stage = path.join(this.dir, 'stage-' + version); fs.rmSync(stage, { recursive: true, force: true });
    for (const f of files) { const d = path.join(stage, f.rel); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, f.data); }   // everything is written to a staging folder first
    fs.writeFileSync(path.join(this.dir, 'pending.json'), JSON.stringify({ from: this.version, to: version, backup: bak, attempts: 0, at: Date.now() }));
    const topDirs = new Set(files.map((f) => f.rel.split('/')[0]).filter((t) => ALLOWED_TOP.includes(t)));
    for (const t of topDirs) { fs.rmSync(path.join(ROOT, t), { recursive: true, force: true }); fs.cpSync(path.join(stage, t), path.join(ROOT, t), { recursive: true }); }
    for (const f of files) if (!f.rel.includes('/')) fs.copyFileSync(path.join(stage, f.rel), path.join(ROOT, f.rel));
    fs.rmSync(stage, { recursive: true, force: true }); this.info.available = false; return version;
  }
  /** the program files of this running installation (src, public, package.json ...), for probes when this server was not updated online but from the installer (1.50) */
  ownBundle() {
    const files = [], walk = (abs, rel) => { for (const e of fs.readdirSync(abs, { withFileTypes: true })) { const a = path.join(abs, e.name), r = rel + '/' + e.name; if (e.isDirectory()) walk(a, r); else if (e.isFile()) files.push({ rel: r, data: fs.readFileSync(a) }); } };
    for (const t of ['src', 'public', 'scripts', 'assets']) if (fs.existsSync(path.join(ROOT, t))) walk(path.join(ROOT, t), t);
    for (const f of ALLOWED_FILES) if (fs.existsSync(path.join(ROOT, f))) files.push({ rel: f, data: fs.readFileSync(path.join(ROOT, f)) });
    files.sort((a, b) => (a.rel < b.rel ? -1 : 1)); const h = crypto.createHash('sha256'); for (const f of files) { h.update(f.rel + '\0'); h.update(f.data); }
    const blob = require('node:zlib').gzipSync(Buffer.from(JSON.stringify(files.map((f) => [f.rel, f.data.toString('base64')])))); return { version: this.version, sha256: h.digest('hex'), blob };
  }
  /** a probe installs the bundle of its own main server (no signature: the link is the authenticated, encrypted probe link and the SHA-256 is checked) */
  installBundle(blob, version, sha256) {
    if (this.busy) throw new Error('An update is already running.'); this.busy = true;
    try {
      if (!newer(version, this.version)) throw new Error('That version is not newer.');
      const list = JSON.parse(require('node:zlib').gunzipSync(blob, { maxOutputLength: 200 * 1024 * 1024 }).toString('utf8')), files = plan(list.map(([name, b]) => ({ name, data: Buffer.from(b, 'base64') })));
      const h = crypto.createHash('sha256'); for (const f of files.slice().sort((a, b) => (a.rel < b.rel ? -1 : 1))) { h.update(f.rel + '\0'); h.update(f.data); }
      if (h.digest('hex') !== sha256) throw new Error('The files do not match their SHA-256. Nothing was installed.');
      return this.applyFiles(files, version);
    } finally { this.busy = false; }
  }
  /** the package this server was updated with, kept so probes can be updated from here (1.49). null when this version was not installed online. */
  probePackage() {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(this.dir, 'probe-package.json'), 'utf8')); if (meta.version !== this.version) return null;
      const zip = fs.readFileSync(path.join(this.dir, 'probe-package.zip')); if (crypto.createHash('sha256').update(zip).digest('hex') !== meta.sha256) return null;
      return { meta, zip };
    } catch { return null; }
  }
  /** a probe installs what its main server offers, after checking the hash and the signature with the release public key */
  installFromServer(zip, meta, keyText) {
    if (this.busy) throw new Error('An update is already running.'); this.busy = true;
    try {
      if (!newer(meta.version, this.version)) throw new Error('That version is not newer.');
      if (!/^[0-9a-f]{64}$/.test(meta.sha256 || '') || !meta.sig) throw new Error('The package is not signed.');
      if (crypto.createHash('sha256').update(zip).digest('hex') !== meta.sha256) throw new Error('The package does not match its SHA-256. Nothing was installed.');
      if (!crypto.verify(null, zip, publicKeyOf(keyText), Buffer.from(meta.sig, 'base64'))) throw new Error('The signature is not valid for the public key. Nothing was installed.');
      return this.apply(zip, meta.version);
    } finally { this.busy = false; }
  }
}

/** Runs first when the program starts. After an update the new version has 3 tries to stay up for 90 seconds; otherwise the old files come back. */
function nodeGuard(dataDir) {
  const f = path.join(dataDir, 'updates', 'pending-node.json'); let p; try { p = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return; }
  if (p.attempts >= 3) {    // the new node.exe starts but the program keeps failing: put the old one back (a running exe can be renamed)
    try { fs.renameSync(p.target, p.target + '.bad'); fs.renameSync(p.old, p.target); } catch (e) { console.error('[update] node rollback failed:', e.message); }
    fs.rmSync(f, { force: true }); try { fs.writeFileSync(path.join(dataDir, 'updates', 'rolled-back.txt'), `Node.js ${p.to} did not work; ${p.from} was restored at ${new Date().toISOString()}\n`); } catch { /* ignore */ }
    console.error(`[update] Node.js ${p.to} failed; restoring ${p.from}`); process.exit(1);
  }
  p.attempts++; fs.writeFileSync(f, JSON.stringify(p));
  const t = setTimeout(() => { fs.rmSync(f, { force: true }); console.log(`[update] Node.js ${p.to} is running; update complete`); }, 90000); t.unref();
}
function bootGuard(dataDir) {
  nodeGuard(dataDir);
  const f = path.join(dataDir, 'updates', 'pending.json'); let p; try { p = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
  if (p.attempts >= 3) {
    try { for (const t of [...ALLOWED_TOP, ...ALLOWED_FILES]) if (fs.existsSync(path.join(p.backup, t))) { fs.rmSync(path.join(ROOT, t), { recursive: true, force: true }); fs.cpSync(path.join(p.backup, t), path.join(ROOT, t), { recursive: true }); } } catch (e) { console.error('[update] rollback failed:', e.message); }
    fs.rmSync(f, { force: true }); fs.writeFileSync(path.join(dataDir, 'updates', 'rolled-back.txt'), `Version ${p.to} did not start; ${p.from} was restored at ${new Date().toISOString()}\n`);
    console.error(`[update] version ${p.to} did not start; restoring ${p.from}`); process.exit(1);
  }
  p.attempts++; fs.writeFileSync(f, JSON.stringify(p));
  const t = setTimeout(() => { fs.rmSync(f, { force: true }); console.log(`[update] version ${p.to} is running; update complete`); }, 90000); t.unref();
  return p;
}
module.exports = { Updater, bootGuard, readZip, plan, newer };
