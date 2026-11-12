'use strict';
// Security helpers for the dashboard: two-factor codes (TOTP, RFC 6238), recovery codes, the password policy and
// a per-account lockout. Nothing here touches the network or the disk except TwoFactorStore (twofactor.json, mode 0600).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ---- Base32 + TOTP -------------------------------------------------------------------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32decode(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, ''); let bits = 0, val = 0; const out = [];
  for (const ch of clean) { val = (val << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
const newSecret = () => b32encode(crypto.randomBytes(20));
function hotp(secret, counter, digits = 6) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(buf).digest(), o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}
/** the time step that matches `code` (within one step either way for clock drift), or -1 */
function totpStep(secret, code, now = Date.now()) {
  const c = String(code || '').replace(/\s/g, ''); if (!/^\d{6}$/.test(c)) return -1;
  const cur = Math.floor(now / 30000); let hit = -1;
  for (let d = -1; d <= 1; d++) { const a = Buffer.from(hotp(secret, cur + d)), b = Buffer.from(c); if (crypto.timingSafeEqual(a, b)) hit = cur + d; }   // no early exit: same time either way
  return hit;
}
const otpauthUri = (secret, account, issuer = 'NetEventPro') => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// ---- recovery codes ----------------------------------------------------------------------------
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
function newRecoveryCodes(n = 10) { return Array.from({ length: n }, () => { const s = crypto.randomBytes(5).toString('hex'); return `${s.slice(0, 5)}-${s.slice(5)}`; }); }
const normCode = (c) => String(c || '').toLowerCase().replace(/[^a-f0-9]/g, '');

/** per-user two-factor state: { secret, recovery:[sha256], last (last used step), since } */
class TwoFactorStore {
  /** `box` (a SecretBox) encrypts the TOTP secrets in the file; a plain file from 1.43 is read and re-written encrypted */
  constructor(dir, box) {
    this.file = path.join(dir, 'twofactor.json'); this.map = {}; this.box = box || null; let plain = false;
    try { const d = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (d && typeof d === 'object') { this.map = d; for (const e of Object.values(d)) if (e && typeof e.secret === 'string') { if (e.secret.startsWith('enc1:')) e.secret = box ? box.open(e.secret) : ''; else plain = true; } } } catch { /* none yet */ }
    if (plain && box) { try { this.save(); } catch { /* next save */ } }
  }
  save() { const out = {}; for (const [n, e] of Object.entries(this.map)) out[n] = { ...e, secret: this.box ? this.box.seal(e.secret) : e.secret }; const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(out), { mode: 0o600 }); fs.renameSync(tmp, this.file); }
  has(name) { return !!this.map[name]?.secret; }
  names() { return Object.keys(this.map).filter((n) => this.has(n)); }
  /** starts (or restarts) setup: returns the new secret; it only counts once enable() has seen a right code */
  enable(name, secret, code) {
    const step = totpStep(secret, code); if (step < 0) return null;
    const codes = newRecoveryCodes(); this.map[name] = { secret, recovery: codes.map((c) => sha(normCode(c))), last: step, since: Date.now() }; this.save(); return codes;
  }
  disable(name) { if (this.map[name]) { delete this.map[name]; this.save(); } }
  /** a TOTP code (each time step works once) or a recovery code (works once). Returns 'totp' | 'recovery' | '' */
  check(name, code) {
    const e = this.map[name]; if (!e) return '';
    const step = totpStep(e.secret, code);
    if (step >= 0 && step > (e.last || 0)) { e.last = step; this.save(); return 'totp'; }
    const h = sha(normCode(code)), i = e.recovery.indexOf(h);
    if (i >= 0 && normCode(code).length === 10) { e.recovery.splice(i, 1); this.save(); return 'recovery'; }
    return '';
  }
  recoveryLeft(name) { return this.map[name]?.recovery?.length || 0; }
}

// ---- password policy ----------------------------------------------------------------------------
const POLICY_DEFAULT = { minLength: 8, complexity: false, accountLock: true, lockFails: 5, lockMinutes: 15, require2fa: false, webAllow: [], hsts: false };
function cleanPolicy(p, cur = POLICY_DEFAULT) {
  const o = { ...POLICY_DEFAULT, ...cur, ...(p && typeof p === 'object' ? p : {}) };
  const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  return {
    minLength: int(o.minLength, 8, 64, 8), complexity: !!o.complexity, accountLock: o.accountLock !== false, lockFails: int(o.lockFails, 3, 20, 5), lockMinutes: int(o.lockMinutes, 1, 1440, 15),
    require2fa: !!o.require2fa, hsts: !!o.hsts,
    webAllow: (Array.isArray(o.webAllow) ? o.webAllow : String(o.webAllow || '').split(/[\s,;]+/)).map((s) => String(s).trim()).filter(Boolean).slice(0, 200)
  };
}
/** the message for a password that breaks the policy, or '' */
function passwordProblem(pw, policy = POLICY_DEFAULT, name = '') {
  const p = cleanPolicy(policy);
  if (typeof pw !== 'string' || pw.length < p.minLength) return `The password must be at least ${p.minLength} characters.`;
  if (pw.length > 200) return 'The password is too long (200 characters at most).';
  if (p.complexity) {
    if (name && String(name).length >= 3 && pw.toLowerCase().includes(String(name).toLowerCase())) return 'The password must not contain the user name.';
    const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
    if (kinds < 3) return 'Use at least three of: lower-case letters, upper-case letters, digits, symbols.';
  }
  if (/^(.)\1+$/.test(pw) || ['password', '12345678', 'qwertyui', 'neteventpro'].includes(pw.toLowerCase())) return 'That password is too easy to guess.';
  return '';
}

// ---- account lockout (by user name, in addition to the per-address lock) ---------------------------------
class AccountGuard {
  constructor() { this.m = new Map(); }
  locked(name, policy) { if (policy.accountLock === false) return 0; const f = this.m.get(name); return f && f.until > Date.now() ? f.until : 0; }
  fail(name, policy) {
    if (policy.accountLock === false || !name) return; const now = Date.now(); let f = this.m.get(name);
    if (!f || now - f.first > policy.lockMinutes * 60000) f = { n: 0, first: now, until: 0 };
    f.n++; if (f.n >= policy.lockFails) { f.until = now + policy.lockMinutes * 60000; f.n = 0; f.first = now; }
    this.m.set(name, f); if (this.m.size > 2000) for (const [k, v] of this.m) if (v.until < now && now - v.first > 3600000) this.m.delete(k);
  }
  success(name) { this.m.delete(name); }
  unlock(name) { this.m.delete(name); }
  list() { const now = Date.now(); return [...this.m].filter(([, v]) => v.until > now).map(([name, v]) => ({ name, until: v.until })); }
}

module.exports = { b32encode, b32decode, newSecret, hotp, totpStep, otpauthUri, TwoFactorStore, newRecoveryCodes, POLICY_DEFAULT, cleanPolicy, passwordProblem, AccountGuard };
