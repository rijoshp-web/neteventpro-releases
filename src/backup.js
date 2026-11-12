'use strict';
const { prepareFolder } = require('./fsutil');
// Backup and restore. A backup is ONE file (.spbak): a gzip-compressed list of files (database, settings, users, report state),
// optionally encrypted with a passphrase (AES-256-GCM, key from scrypt). Files are streamed, so a multi-gigabyte database does
// not have to fit in memory. Restoring never swaps files under a running service: the chosen parts are checked and staged,
// and applied by the next start, which first keeps the current files in a "before-restore-..." folder.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { latestSlot, checkFolder } = require('./reports');

const MAGIC_ENC = Buffer.from('SPBKE1'); const ALLOWED = ['manifest.json', 'syslog.db', 'config.json', 'users.json', 'reports-state.json'];
const PART_FILES = { db: ['syslog.db'], settings: ['config.json', 'reports-state.json'], users: ['users.json'] };
const NAME_RE = /^[A-Za-z0-9._-]{1,100}\.spbak$/;
const pad = (n) => String(n).padStart(2, '0');
const userErr = (m, status = 400) => Object.assign(new Error(m), { userFacing: true, status });

async function* encrypt(source, pass) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.scryptSync(pass, salt, 32, { N: 16384, r: 8, p: 1 });
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  yield Buffer.concat([MAGIC_ENC, salt, iv]);
  for await (const chunk of source) { const o = c.update(chunk); if (o.length) yield o; }
  yield c.final(); yield c.getAuthTag();
}
const ENC_HEAD = MAGIC_ENC.length + 16 + 12;

function openPlain(file, pass) {
  const fd = fs.openSync(file, 'r'); const head = Buffer.alloc(ENC_HEAD); const n = fs.readSync(fd, head, 0, ENC_HEAD, 0); fs.closeSync(fd);
  if (n >= 2 && head[0] === 0x1f && head[1] === 0x8b) return { encrypted: false, stream: fs.createReadStream(file).pipe(zlib.createGunzip()) };
  if (n >= ENC_HEAD && head.subarray(0, MAGIC_ENC.length).equals(MAGIC_ENC)) {
    if (!pass) throw userErr('This backup is encrypted. Enter its passphrase.');
    const size = fs.statSync(file).size; if (size < ENC_HEAD + 16) throw userErr('The backup file is damaged (too short).');
    const tagFd = fs.openSync(file, 'r'); const tag = Buffer.alloc(16); fs.readSync(tagFd, tag, 0, 16, size - 16); fs.closeSync(tagFd);
    const key = crypto.scryptSync(pass, head.subarray(MAGIC_ENC.length, MAGIC_ENC.length + 16), 32, { N: 16384, r: 8, p: 1 });
    const d = crypto.createDecipheriv('aes-256-gcm', key, head.subarray(MAGIC_ENC.length + 16, ENC_HEAD)); d.setAuthTag(tag);
    const src = fs.createReadStream(file, { start: ENC_HEAD, end: size - 17 }); const gun = zlib.createGunzip();
    src.pipe(d).pipe(gun); d.on('error', (e) => gun.destroy(new Error('wrong passphrase or damaged file'))); src.on('error', (e) => gun.destroy(e));
    return { encrypted: true, stream: gun };
  }
  throw userErr('This is not a NetEventPro backup file.');
}
function isEncrypted(file) {
  try { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(MAGIC_ENC.length); fs.readSync(fd, b, 0, b.length, 0); fs.closeSync(fd); return b.equals(MAGIC_ENC); } catch { return false; }
}

/** pulls exact byte counts out of an async iterable */
class ByteReader {
  constructor(iter) { this.it = iter[Symbol.asyncIterator](); this.buf = Buffer.alloc(0); this.done = false; }
  async fill(n) { while (this.buf.length < n && !this.done) { const { value, done } = await this.it.next(); if (done) this.done = true; else this.buf = Buffer.concat([this.buf, value]); } }
  async read(n) { await this.fill(n); if (this.buf.length < n) throw new Error('the backup ends too early (damaged file)'); const o = this.buf.subarray(0, n); this.buf = this.buf.subarray(n); return o; }
  async copy(n, ws) {
    let left = n;
    while (left > 0) {
      await this.fill(1); if (!this.buf.length) throw new Error('the backup ends too early (damaged file)');
      const take = Math.min(left, this.buf.length), piece = this.buf.subarray(0, take); this.buf = this.buf.subarray(take); left -= take;
      if (!ws.write(piece)) await new Promise((r) => ws.once('drain', r));
    }
  }
}

/** extracts the (allow-listed) files of a backup into dir; returns the manifest */
async function extract(file, pass, dir, wanted) {
  const { stream } = openPlain(file, pass); const rd = new ByteReader(stream); let manifest = null;
  fs.mkdirSync(dir, { recursive: true });
  try {
    for (;;) {
      const nl = (await rd.read(4)).readUInt32LE(0); if (nl === 0) break; if (nl > 200) throw new Error('the backup is damaged');
      const name = (await rd.read(nl)).toString('utf8'); const size = Number((await rd.read(8)).readBigUInt64LE(0));
      if (!ALLOWED.includes(name)) throw new Error(`unexpected file "${name.slice(0, 40)}" inside the backup`);
      if (name === 'manifest.json') { if (size > 1e6) throw new Error('the backup is damaged'); manifest = JSON.parse((await rd.read(size)).toString('utf8')); continue; }
      if (wanted && !wanted.includes(name)) { // skip
        let left = size; while (left > 0) { const t = Math.min(left, 1 << 20); await rd.read(t); left -= t; } continue;
      }
      const ws = fs.createWriteStream(path.join(dir, name)); await rd.copy(size, ws); await new Promise((res, rej) => ws.end((e) => (e ? rej(e) : res())));
    }
  } catch (e) { stream.destroy(); throw userErr(`The backup could not be read: ${e.message}`); }
  stream.destroy();
  if (!manifest || !['NetEventPro', 'SyslogPro'].includes(manifest.app)) throw userErr('This is not a NetEventPro backup file.');
  return manifest;
}
async function readManifest(file, pass) {
  const { stream } = openPlain(file, pass); const rd = new ByteReader(stream);
  try {
    const nl = (await rd.read(4)).readUInt32LE(0); const name = (await rd.read(nl)).toString('utf8'); const size = Number((await rd.read(8)).readBigUInt64LE(0));
    if (name !== 'manifest.json' || size > 1e6) throw new Error('not a NetEventPro backup'); return JSON.parse((await rd.read(size)).toString('utf8'));
  } catch (e) { throw userErr(`The backup could not be read: ${e.message}`); } finally { stream.destroy(); }
}

class Backups {
  constructor({ config, store, dir, version }) {
    this.config = config; this.store = store; this.root = dir; this.dir = path.join(dir, 'backups'); this.version = version; this.busy = false; this.status = {};
    fs.mkdirSync(this.dir, { recursive: true });
    this.timer = setInterval(() => this.tick().catch((e) => console.error('[backup]', e.message)), 60000); this.timer.unref?.();
    try { this.pending = JSON.parse(fs.readFileSync(path.join(dir, 'restore-pending', 'pending.json'), 'utf8')); } catch { this.pending = null; }
  }
  close() { clearInterval(this.timer); }
  list() {
    return fs.readdirSync(this.dir).filter((n) => NAME_RE.test(n)).map((n) => { const st = fs.statSync(path.join(this.dir, n)); return { name: n, size: st.size, mtime: st.mtimeMs, encrypted: isEncrypted(path.join(this.dir, n)), auto: n.startsWith('auto-') }; }).sort((a, b) => b.mtime - a.mtime);
  }
  pathOf(name) { if (!NAME_RE.test(String(name))) throw userErr('Unknown backup.', 404); const p = path.join(this.dir, name); if (!fs.existsSync(p)) throw userErr('Unknown backup.', 404); return p; }
  remove(name) { fs.unlinkSync(this.pathOf(name)); }

  async tick() {
    const b = this.config.get().backup; if (!b?.enabled || this.busy) return;
    const slot = latestSlot({ type: 'daily', time: b.time }, Date.now()); this.status.since ||= Date.now();
    if (slot > (this.status.lastRun || this.status.since) && Date.now() - slot < 12 * 3600000) { this.status.lastRun = Date.now(); await this.create({ auto: true, includeDb: b.includeDb !== false, passphrase: b.passphrase || '', folder: b.folder || '' }).catch(() => {}); }
  }

  async create({ includeDb = true, passphrase = '', auto = false, folder = '' } = {}) {
    if (this.busy) throw userErr('A backup is already running.', 429);
    this.busy = true; const d = new Date(); let name = `${auto ? 'auto-' : ''}neteventpro-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.spbak`;
    const tmpDb = path.join(this.root, 'tmp'); fs.mkdirSync(tmpDb, { recursive: true }); const dbCopy = path.join(tmpDb, `bk-${crypto.randomBytes(6).toString('hex')}.db`);
    let dest = path.join(this.dir, name); for (let i = 2; fs.existsSync(dest); i++) dest = path.join(this.dir, name.replace(/\.spbak$/, `-${i}.spbak`));
    name = path.basename(dest); const tmp = dest + '.part';
    let cfgCopy = '';
    try {
      if (includeDb) await this.store.backup(dbCopy);
      const files = [];
      const add = (n, p) => { if (fs.existsSync(p)) files.push({ name: n, path: p, size: fs.statSync(p).size }); };
      if (includeDb) add('syslog.db', dbCopy);
      cfgCopy = path.join(tmpDb, `bk-cfg-${crypto.randomBytes(6).toString('hex')}.json`); fs.writeFileSync(cfgCopy, this.config.plainJson(), { mode: 0o600 });   // secrets readable: the copy may be restored on another computer (protect it with a passphrase)
      add('config.json', cfgCopy); add('users.json', path.join(this.root, 'users.json')); add('reports-state.json', path.join(this.root, 'reports-state.json'));
      const manifest = Buffer.from(JSON.stringify({ app: 'NetEventPro', version: this.version, created: Date.now(), files: files.map((f) => ({ name: f.name, size: f.size })), includesDb: includeDb, host: require('node:os').hostname() }));
      const entry = (n, size) => { const nb = Buffer.from(n); const h = Buffer.alloc(4 + nb.length + 8); h.writeUInt32LE(nb.length, 0); nb.copy(h, 4); h.writeBigUInt64LE(BigInt(size), 4 + nb.length); return h; };
      async function* body() {
        yield entry('manifest.json', manifest.length); yield manifest;
        for (const f of files) { yield entry(f.name, f.size); for await (const c of fs.createReadStream(f.path)) yield c; }
        yield Buffer.alloc(4);
      }
      const gz = zlib.createGzip({ level: 6 }); const src = Readable.from(body()).pipe(gz);
      await pipeline(passphrase ? Readable.from(encrypt(src, passphrase)) : src, fs.createWriteStream(tmp, { mode: 0o600 }));
      fs.renameSync(tmp, dest);
      let extra = '';
      if (folder) { try { const bc = this.config.get().backup || {}, fd = await prepareFolder(checkFolder(folder), bc.folder === folder ? bc.folderUser : '', bc.folder === folder ? bc.folderPassword : ''); fs.copyFileSync(dest, path.join(fd, name)); extra = ` and copied to ${fd}`; if (auto) this.prune(fd); } catch (e) { extra = ` (the copy to ${folder} FAILED: ${e.message})`; this.status.copyError = e.message; } }
      if (auto) this.prune(this.dir);
      this.status.last = { ok: true, name, at: Date.now(), message: 'Saved ' + name + extra, auto };
      return { name, size: fs.statSync(dest).size, note: extra };
    } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ } this.status.last = { ok: false, at: Date.now(), message: e.message, auto }; throw e; }
    finally { try { fs.rmSync(dbCopy, { force: true }); if (cfgCopy) fs.rmSync(cfgCopy, { force: true }); } catch { /* ignore */ } this.busy = false; }
  }
  /** keeps the newest N automatic backups in a folder (never touches manual ones) */
  prune(dir) {
    const keep = Math.max(1, +this.config.get().backup?.keep || 7);
    const mine = fs.readdirSync(dir).filter((n) => (n.startsWith('auto-neteventpro-') || n.startsWith('auto-syslogpro-')) && NAME_RE.test(n)).sort().reverse();
    for (const old of mine.slice(keep)) { try { fs.unlinkSync(path.join(dir, old)); } catch { /* ignore */ } }
  }

  /** what is inside (needs the passphrase for an encrypted backup) */
  async inspect(name, pass) { const m = await readManifest(this.pathOf(name), pass); return { created: m.created, version: m.version, host: m.host, files: m.files, includesDb: m.includesDb }; }

  /** checks the chosen parts and stages them; the next start applies them */
  async stageRestore(name, pass, parts) {
    const file = this.pathOf(name); parts = (Array.isArray(parts) ? parts : []).filter((p) => PART_FILES[p]);
    if (!parts.length) throw userErr('Choose what to restore.');
    const stage = path.join(this.root, 'restore-pending'); fs.rmSync(stage, { recursive: true, force: true });
    const wanted = parts.flatMap((p) => PART_FILES[p]);
    try {
      const m = await extract(file, pass, stage, wanted);
      const got = parts.filter((p) => PART_FILES[p].some((f) => fs.existsSync(path.join(stage, f))));
      if (!got.length) throw userErr('The backup does not contain what you chose.');
      if (got.includes('db')) {
        const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(path.join(stage, 'syslog.db'), { readOnly: true });
        try { const r = db.prepare('PRAGMA quick_check').get(); if (Object.values(r)[0] !== 'ok') throw new Error('database check failed'); db.prepare('SELECT COUNT(*) FROM logs').get(); }
        catch (e) { throw userErr('The database inside the backup is damaged or is not a NetEventPro database (' + e.message + ').'); } finally { db.close(); }
      }
      if (got.includes('settings')) { try { JSON.parse(fs.readFileSync(path.join(stage, 'config.json'), 'utf8')); } catch { throw userErr('The settings inside the backup are damaged.'); } }
      if (got.includes('users')) { try { JSON.parse(fs.readFileSync(path.join(stage, 'users.json'), 'utf8')); } catch { throw userErr('The users inside the backup are damaged.'); } }
      const pending = { parts: got, from: name, created: m.created, staged: Date.now() }; fs.writeFileSync(path.join(stage, 'pending.json'), JSON.stringify(pending)); this.pending = pending;
      return pending;
    } catch (e) { fs.rmSync(stage, { recursive: true, force: true }); throw e; }
  }
  cancelRestore() { fs.rmSync(path.join(this.root, 'restore-pending'), { recursive: true, force: true }); this.pending = null; }
}

/** runs at start-up BEFORE anything opens the files */
function applyPendingRestore(dir) {
  const stage = path.join(dir, 'restore-pending'); let p;
  try { p = JSON.parse(fs.readFileSync(path.join(stage, 'pending.json'), 'utf8')); } catch { return null; }
  const d = new Date(); const safe = path.join(dir, `before-restore-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`);
  fs.mkdirSync(safe, { recursive: true }); const done = [];
  try {
    for (const part of p.parts) for (const f of PART_FILES[part]) {
      const from = path.join(stage, f); if (!fs.existsSync(from)) continue;
      const targets = f === 'syslog.db' ? ['syslog.db', 'syslog.db-wal', 'syslog.db-shm'] : [f];
      for (const t of targets) { const cur = path.join(dir, t); if (fs.existsSync(cur)) fs.renameSync(cur, path.join(safe, t)); }
      fs.renameSync(from, path.join(dir, f)); done.push(f);
    }
    fs.rmSync(stage, { recursive: true, force: true });
    console.log(`[restore] restored ${done.join(', ')} from ${p.from}; the previous files were kept in ${safe}`);
    return { done, safe };
  } catch (e) { console.error('[restore] FAILED:', e.message, '— previous files are in', safe); return null; }
}

module.exports = { Backups, applyPendingRestore, NAME_RE, userErr };
