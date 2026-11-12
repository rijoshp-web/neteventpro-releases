'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

// OWASP asks for at least N=2^17 at r=8; 2^16 (64 MB, about 0.2 s) is the compromise for a service that also hashes on a small server. Older hashes keep working and are upgraded at the next sign-in.
const N = Number(process.env.NETEVENTPRO_SCRYPT_N) || 65536, R = 8, P = 1, KEYLEN = 32, MAXMEM = 256 * 1024 * 1024;

/** Password hash format: scrypt$N$r$p$salt(base64)$key(base64) — the password itself is never stored. */
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}
function hashPasswordSync(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  const parts = String(stored || '').split('$');
  if (parts[0] !== 'scrypt' || parts.length !== 6) return false;
  const n = +parts[1], r = +parts[2], p = +parts[3];
  if (!(n >= 1024 && n <= 1 << 20 && r >= 1 && r <= 32 && p >= 1 && p <= 16)) return false;
  const salt = Buffer.from(parts[4], 'base64'), expect = Buffer.from(parts[5], 'base64');
  const key = await scrypt(pw, salt, expect.length, { N: n, r, p, maxmem: 256 * n * r });
  return key.length === expect.length && crypto.timingSafeEqual(key, expect);
}

/** true when a stored hash is weaker than what new passwords get */
function needsRehash(stored) { const p = String(stored || '').split('$'); return p[0] === 'scrypt' && p.length === 6 && +p[1] < N; }

/** Slows down password guessing: 5 wrong passwords from one address lock that address out for 5 minutes. */
class LoginGuard {
  constructor({ maxFails = 5, lockMs = 300000, windowMs = 300000 } = {}) {
    this.maxFails = maxFails; this.lockMs = lockMs; this.windowMs = windowMs; this.fails = new Map();
  }
  locked(ip) { const f = this.fails.get(ip); return !!f && f.until > Date.now(); }
  fail(ip) {
    const now = Date.now(); let f = this.fails.get(ip);
    if (!f || now - f.first > this.windowMs) f = { n: 0, first: now, until: 0 };
    f.n++; if (f.n >= this.maxFails) { f.until = now + this.lockMs; f.n = 0; f.first = now; }
    this.fails.set(ip, f);
    if (this.fails.size > 1000) for (const [k, v] of this.fails) if (v.until < now && now - v.first > this.windowMs) this.fails.delete(k);
  }
  success(ip) { this.fails.delete(ip); }
}

module.exports = { needsRehash, hashPassword, hashPasswordSync, verifyPassword, LoginGuard };
