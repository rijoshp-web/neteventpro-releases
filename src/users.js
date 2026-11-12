'use strict';
// Users, roles and groups. Stored in users.json next to config.json (never inside config.json, so the settings
// screen and its API can not read or write password hashes).
//
//   permission  lets the person ...
//   view        see logs, dashboard, devices and health
//   customize   change shared dashboard layouts, saved views and table looks
//   export      download CSV / JSON exports and a copy of the database
//   rules       create and edit alert rules
//   settings    change settings, send test messages, restart, clear data
//   reports     create, edit and run scheduled reports
//   backup      make and restore backups
//   polling     use SNMP polling (view and configure; Administrator only by default)
//   users       manage users, roles and groups (this is as powerful as admin: such a person can give themselves any permission)
//
// A user has one role and may be in groups; each group carries roles too. A person's permissions are the union.
// The built-in "admin" account is not stored here: its password lives in config.json (adminPasswordHash) and it always has every permission.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashPassword, verifyPassword } = require('./auth');

const PERMS = [
  ['view', 'View logs, dashboard, devices and health'], ['customize', 'Change dashboard layouts and saved views'], ['export', 'Export logs and download the database'],
  ['rules', 'Create and edit alert rules'], ['settings', 'Change settings and run tests'], ['reports', 'Manage scheduled reports'],
  ['backup', 'Make and restore backups'], ['users', 'Manage users, roles and groups'], ['alarms', 'Acknowledge, clear and comment on alarms'], ['delete', 'Delete logs, SNMP traps and alarms'], ['polling', 'SNMP polling: view and configure device polling']
];
const PERM_IDS = PERMS.map((p) => p[0]);
const ALL = (id, name, perms, extra = {}) => ({ id, name, perms, ...extra });
const BUILTIN_ROLES = () => [
  ALL('admin', 'Administrator', PERM_IDS.slice(), { locked: true }),
  ALL('operator', 'Operator', ['view', 'customize', 'export', 'rules', 'reports', 'alarms']),
  ALL('viewer', 'Viewer', ['view'])
];
const ID_RE = /^[a-z0-9_]{1,24}$/;
const NAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;

class UserStore {
  constructor(dir, restrict) {
    this.file = path.join(dir, 'users.json'); this.restrict = restrict || (() => {}); this.version = 1;
    this.data = { roles: BUILTIN_ROLES(), groups: [], users: [] };
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (d && typeof d === 'object') {
        this.data = this.clean(d, true);
        if (!(d.v >= 2)) { const op = this.data.roles.find((r) => r.id === 'operator'); if (op && !op.perms.includes('alarms')) op.perms.push('alarms'); try { this.save(); } catch { /* */ } }   // older file: the new Alarms permission goes to Operator once
      }
    } catch { /* first run */ }
    if (!this.data.roles.some((r) => r.id === 'admin')) this.data.roles.unshift(BUILTIN_ROLES()[0]);
    this.data.roles.find((r) => r.id === 'admin').perms = PERM_IDS.slice();
  }

  /** sanitises a whole structure (used for what is read from disk and for what the screen sends); hashes are kept only when `trusted` */
  clean(d, trusted) {
    const roles = [], seenR = new Set();
    for (const r of Array.isArray(d.roles) ? d.roles.slice(0, 50) : []) {
      if (!r || !ID_RE.test(r.id) || seenR.has(r.id)) continue; seenR.add(r.id);
      roles.push({ id: r.id, name: String(r.name || r.id).trim().slice(0, 60) || r.id, perms: [...new Set((Array.isArray(r.perms) ? r.perms : []).filter((p) => PERM_IDS.includes(p)))], ...(r.id === 'admin' ? { locked: true } : {}) });
    }
    const groups = [], seenG = new Set();
    for (const g of Array.isArray(d.groups) ? d.groups.slice(0, 100) : []) {
      if (!g || !ID_RE.test(g.id) || seenG.has(g.id)) continue; seenG.add(g.id);
      groups.push({ id: g.id, name: String(g.name || g.id).trim().slice(0, 60) || g.id, roleIds: [...new Set((Array.isArray(g.roleIds) ? g.roleIds : []).filter((x) => seenR.has(x)))] });
    }
    const users = [], seenU = new Set();
    for (const u of Array.isArray(d.users) ? d.users.slice(0, 500) : []) {
      const name = String(u?.name || '').trim().toLowerCase();
      if (!NAME_RE.test(name) || name === 'admin' || seenU.has(name)) continue; seenU.add(name);
      users.push({
        name, fullName: String(u.fullName || '').trim().slice(0, 100), email: String(u.email || '').trim().slice(0, 200),
        roleId: seenR.has(u.roleId) ? u.roleId : 'viewer', groupIds: [...new Set((Array.isArray(u.groupIds) ? u.groupIds : []).filter((x) => seenG.has(x)))],
        disabled: !!u.disabled, created: Number(u.created) || Date.now(), lastLogin: Number(u.lastLogin) || 0,
        ...(trusted && typeof u.hash === 'string' ? { hash: u.hash } : {})
      });
    }
    return { roles, groups, users, v: 2 };
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 }); fs.renameSync(tmp, this.file); this.restrict(this.file);
    this.version++;
  }

  get enabled() { return this.data.users.length > 0; }
  find(name) { return this.data.users.find((u) => u.name === String(name).toLowerCase()); }

  /** { name, roleNames, perms:Set } for a stored user, or null when unknown / disabled */
  identity(name) {
    const u = this.find(name); if (!u || u.disabled) return null;
    const roleIds = new Set([u.roleId]); for (const gid of u.groupIds) { const g = this.data.groups.find((x) => x.id === gid); if (g) for (const r of g.roleIds) roleIds.add(r); }
    const perms = new Set(); const names = [];
    for (const id of roleIds) { const r = this.data.roles.find((x) => x.id === id); if (r) { names.push(r.name); for (const p of r.perms) perms.add(p); } }
    return { name: u.name, fullName: u.fullName, roleNames: names, perms };
  }
  static adminIdentity() { return { name: 'admin', fullName: 'Built-in administrator', roleNames: ['Administrator'], perms: new Set(PERM_IDS), builtin: true }; }

  async verify(name, pass) {
    const u = this.find(name);
    // always spend the same time, so response time does not reveal whether a name exists
    const ok = await verifyPassword(pass, u?.hash || DUMMY);
    if (!u || u.disabled || !ok) return false;
    u.lastLogin = Date.now(); this.dirty = true; return true;
  }
  flushLogins() { if (this.dirty) { this.dirty = false; try { this.save(); this.version--; } catch { /* ignore */ } } }

  publicView() {
    return { perms: PERMS.map(([id, label]) => ({ id, label })), roles: this.data.roles, groups: this.data.groups, users: this.data.users.map(({ hash, ...u }) => ({ ...u, hasPassword: !!hash })) };
  }

  /** replaces roles, groups and users from the screen. A user's password is set only when "password" is given; new users need one. */
  async replace(body, minLen = 8) {
    const c = this.clean(body, false);
    if (!c.roles.some((r) => r.id === 'admin')) c.roles.unshift(BUILTIN_ROLES()[0]);
    c.roles.find((r) => r.id === 'admin').perms = PERM_IDS.slice();
    const incoming = new Map((Array.isArray(body.users) ? body.users : []).map((u) => [String(u?.name || '').trim().toLowerCase(), u]));
    for (const u of c.users) {
      const raw = incoming.get(u.name), old = this.find(u.name), pw = raw && typeof raw.password === 'string' ? raw.password : '';
      if (pw) {
        const bad = typeof minLen === 'function' ? minLen(pw, u.name) : pw.length < minLen ? `The password must be at least ${minLen} characters.` : '';
        if (bad) throw userErr(`${u.name}: ${bad}`);
        if (pw.length > 200) throw userErr(`The password for ${u.name} is too long.`);
        u.hash = await hashPassword(pw);
      } else if (old?.hash) u.hash = old.hash;
      else throw userErr(`Set a password for the new user ${u.name}.`);
      if (old) { u.created = old.created; u.lastLogin = old.lastLogin; }
    }
    for (const r of Array.isArray(body.users) ? body.users : []) {   // names that were rejected silently would confuse: say so
      const n = String(r?.name || '').trim().toLowerCase();
      if (n === 'admin') throw userErr('"admin" is the built-in account; choose another user name.');
      if (!NAME_RE.test(n)) throw userErr(`"${String(r?.name || '').slice(0, 40)}" is not a valid user name (2-32 letters, digits, dot, dash or underscore; start with a letter or digit).`);
    }
    this.data = c; this.save();
  }

  async setPassword(name, pw, minLen = 8) {
    const u = this.find(name); if (!u) throw userErr('Unknown user.');
    const bad = typeof minLen === 'function' ? minLen(pw, u.name) : pw.length < minLen ? `The password must be at least ${minLen} characters.` : '';
    if (bad) throw userErr(bad);
    if (pw.length > 200) throw userErr('The password is too long.');
    u.hash = await hashPassword(pw); this.save();
  }
}
const DUMMY = 'scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(32).toString('base64');
function userErr(m) { const e = new Error(m); e.userFacing = true; e.status = 400; return e; }

module.exports = { UserStore, PERMS, PERM_IDS };
