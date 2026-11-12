'use strict';
// Encrypts small secrets and files at rest with AES-256-GCM. The 32-byte key lives in `secret.key` in the data directory (owner-only file).
// This stops a copied config, queue or backup file from being readable on its own; it does NOT stop someone who can read the whole data
// directory (the key is next to the data). Text format: "enc1:" + base64(iv|tag|cipher). File format: magic "NEQ1" + iv|tag|cipher.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAGIC = Buffer.from('NEQ1');
class SecretBox {
  constructor(dir) {
    this.file = path.join(dir, 'secret.key'); this.key = null;
    try { const k = fs.readFileSync(this.file); if (k.length === 32) this.key = k; } catch { /* created on first use */ }
    if (!this.key) { this.key = crypto.randomBytes(32); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(this.file, this.key, { mode: 0o600 }); try { require('./config').restrictToAdmins(this.file); } catch { /* best effort */ } }
  }
  encBuf(buf) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', this.key, iv), ct = Buffer.concat([c.update(buf), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]); }
  decBuf(buf) { const d = crypto.createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12)); d.setAuthTag(buf.subarray(12, 28)); return Buffer.concat([d.update(buf.subarray(28)), d.final()]); }
  seal(text) { return 'enc1:' + this.encBuf(Buffer.from(String(text), 'utf8')).toString('base64'); }
  open(text) { const t = String(text || ''); if (!t.startsWith('enc1:')) return t; try { return this.decBuf(Buffer.from(t.slice(5), 'base64')).toString('utf8'); } catch { return ''; } }
  static isSealed(t) { return String(t || '').startsWith('enc1:'); }
  /** a file's bytes: MAGIC + encrypted. Returns null when the file is not in this format (plain, from an older version) */
  sealFile(buf) { return Buffer.concat([MAGIC, this.encBuf(buf)]); }
  openFile(buf) { if (buf.length < 4 + 28 || !buf.subarray(0, 4).equals(MAGIC)) return null; return this.decBuf(buf.subarray(4)); }
}
module.exports = { SecretBox };
