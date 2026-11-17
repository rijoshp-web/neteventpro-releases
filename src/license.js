'use strict';
/* NetEventPro licence.  Copyright (c) NetEventPro. All rights reserved.
   An activation key is a small signed certificate (Ed25519): it names the customer, the machine it was issued for, the edition and an optional expiry.
   The program only holds the PUBLIC half of the signing key, so it can check a key but cannot make one. Checking needs no internet.
   The key is typed in once, on the first start. It is kept in the data folder, which an update never touches, so updating never asks again.
   A copy of the program (or of its data folder) on another computer does not match the machine in the key and stays locked. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA+oAZfWZRq9XHwLcX9Rz2VbFq6cSijD7BC6Q6ubxz8RA=
-----END PUBLIC KEY-----`;
const PREFIX = 'NEP1-';
/** The parts of the program a key can switch on or off. A key with no "features" list (every key made before 1.92) has all of them. */
const FEATURES = { polling: 'SNMP polling', traps: 'SNMP trap receiver', reports: 'Scheduled reports', notify: 'Alert delivery (email, SMS, webhook)', probes: 'Remote probes', export: 'Log export and database download' };
const GRACE_DAYS = 14;       // an installation that existed before licensing was added keeps working for this long, so an update never stops a running system

const b64u = (b) => Buffer.from(b).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

function rawMachineId() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      const m = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out); if (m) return m[1];
    } else if (process.platform === 'darwin') {
      const out = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5000 });
      const m = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out); if (m) return m[1];
    } else {
      for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) { try { const v = fs.readFileSync(f, 'utf8').trim(); if (v) return v; } catch { /* next */ } }
    }
  } catch { /* fall through */ }
  const nics = Object.values(os.networkInterfaces()).flat().filter((n) => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00').map((n) => n.mac).sort();
  return os.hostname() + '|' + (nics[0] || '');
}
/** The code a customer sends to get a key: 16 letters/digits in four groups, the same on every start of the same computer. */
function machineCode(raw = rawMachineId()) {
  const h = crypto.createHash('sha256').update('NEP|' + raw).digest('hex').slice(0, 16).toUpperCase();
  return h.match(/.{4}/g).join('-');
}
const flat = (c) => String(c || '').replace(/[^0-9A-Za-z*]/g, '').toUpperCase();

function verifyKey(key, pubPem = PUBLIC_KEY) {
  const s = String(key || '').replace(/\s+/g, '');
  if (!s.startsWith(PREFIX)) return { ok: false, error: 'That is not a NetEventPro activation key. It starts with NEP1-.' };
  const [p, sig] = s.slice(PREFIX.length).split('.');
  if (!p || !sig) return { ok: false, error: 'The key is incomplete. Copy all of it, including the part after the dot.' };
  let good = false;
  try { good = crypto.verify(null, Buffer.from(p), crypto.createPublicKey(pubPem), fromB64u(sig)); } catch { good = false; }
  if (!good) return { ok: false, error: 'The key is not valid. Check that nothing was cut off or changed.' };
  let d; try { d = JSON.parse(fromB64u(p).toString('utf8')); } catch { return { ok: false, error: 'The key is damaged.' }; }
  if (!d || d.v !== 1) return { ok: false, error: 'This key is for a different version of the program.' };
  return { ok: true, data: d };
}

// License.testKey is set only by the test suite (test/license-hook.js)
class License {
  constructor(dir, opts = {}) {
    this.file = path.join(dir, 'license.json'); this.dir = dir;
    this.pub = opts.publicKey || License.testKey || PUBLIC_KEY; this.machine = opts.machine || machineCode();
    this.rec = {}; this.cache = null;
    try { this.rec = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.rec = {}; }
    // an installation that already holds data before licensing existed is given a grace period once
    if (!this.rec.key && !this.rec.graceStart) {
      const existing = ['config.json', 'users.json'].some((f) => fs.existsSync(path.join(dir, f)));
      if (existing) { this.rec.graceStart = Date.now(); this.save(); }
    }
    // the setup program (or an administrator) may leave the key in a file next to the data
    try { const kf = path.join(dir, 'license-key.txt'); if (!this.rec.key && fs.existsSync(kf)) { const r = this.activate(fs.readFileSync(kf, 'utf8')); if (r.ok) fs.rmSync(kf, { force: true }); } } catch { /* shown on the activation page */ }
  }
  save() { try { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.rec, null, 1), { mode: 0o600 }); } catch { /* read-only data folder: the key must be typed again after a restart */ } this.cache = null; }
  /** state: licensed | grace | expired | wrongmachine | unlicensed */
  status() {
    const now = Date.now(); if (this.cache && now - this.cache.t < 30000) return this.cache.v;
    let v = { state: 'unlicensed', machine: this.machine };
    if (this.rec.key) {
      const r = verifyKey(this.rec.key, this.pub);
      if (!r.ok) v = { state: 'unlicensed', machine: this.machine, error: r.error };
      else {
        const d = r.data, bound = flat(d.machine) === '*' || flat(d.machine) === flat(this.machine);
        const exp = d.expires ? Date.parse(d.expires + 'T23:59:59Z') : 0;
        const info = { machine: this.machine, customer: d.customer || '', edition: d.edition || 'Standard', licenseId: d.id || '', issued: d.issued || '', expires: d.expires || null, anyMachine: flat(d.machine) === '*', activatedAt: this.rec.activatedAt || null, features: Array.isArray(d.features) ? d.features.filter((f) => f in FEATURES) : null, maxDevices: Number.isInteger(d.maxDevices) && d.maxDevices > 0 ? d.maxDevices : 0 };
        if (!bound) v = { ...info, state: 'wrongmachine', error: 'This key was issued for a different computer.' };
        else if (exp && now > exp) v = { ...info, state: 'expired', error: 'This licence expired on ' + d.expires + '.' };
        else v = { ...info, state: 'licensed' };
      }
    }
    if (v.state !== 'licensed' && this.rec.graceStart && !this.rec.key) {
      const left = this.rec.graceStart + GRACE_DAYS * 86400000 - now;
      if (left > 0) v = { state: 'grace', machine: this.machine, graceDaysLeft: Math.ceil(left / 86400000) };
    }
    this.cache = { t: now, v }; return v;
  }
  /** is this part of the program included in the key? Before activation (grace) and for keys without a list, everything is. */
  has(f) { const v = this.status(); return v.state !== 'licensed' || !v.features || v.features.includes(f); }
  maxDevices() { const v = this.status(); return v.state === 'licensed' ? v.maxDevices || 0 : 0; }
  ok() { const s = this.status().state; return s === 'licensed' || s === 'grace'; }
  activate(key) {
    const r = verifyKey(key, this.pub); if (!r.ok) return r;
    const d = r.data;
    if (flat(d.machine) !== '*' && flat(d.machine) !== flat(this.machine)) return { ok: false, error: 'This key was issued for a different computer (' + (d.machine || '?') + '). This computer\'s machine code is ' + this.machine + '.' };
    if (d.expires && Date.now() > Date.parse(d.expires + 'T23:59:59Z')) return { ok: false, error: 'This key expired on ' + d.expires + '.' };
    this.rec = { key: String(key).replace(/\s+/g, ''), activatedAt: Date.now() }; this.save();
    return { ok: true, status: this.status() };
  }
}

module.exports = { FEATURES, License, verifyKey, machineCode, PUBLIC_KEY, PREFIX, GRACE_DAYS };
