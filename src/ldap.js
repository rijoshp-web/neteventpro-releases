'use strict';
// 1.98.1 Sign-in with a company directory (Microsoft Active Directory or another LDAP server). No libraries: the few LDAP
// operations needed (bind, search, StartTLS, unbind) are written here in BER, the same encoding SNMP uses.
//
// A sign-in: connect (ldaps:// or ldap:// with StartTLS), bind with the service account (or anonymously), find the user with
// the user filter, bind as that user with the typed password, read the groups (memberOf, optionally nested groups), then
// map groups to NetEventPro roles. Nothing about the user is stored: roles are worked out again at every sign-in.
const net = require('node:net');
const tls = require('node:tls');
const fs = require('node:fs');

// ---------- BER ----------
function len(n) { if (n < 0x80) return Buffer.from([n]); const b = []; while (n > 0) { b.unshift(n & 0xff); n >>= 8; } return Buffer.from([0x80 | b.length, ...b]); }
const tlv = (tag, body) => { body = Buffer.isBuffer(body) ? body : Buffer.from(body); return Buffer.concat([Buffer.from([tag]), len(body.length), body]); };
const seq = (tag, ...parts) => tlv(tag, Buffer.concat(parts));
const str = (s, tag = 0x04) => tlv(tag, Buffer.from(String(s), 'utf8'));
const int = (n, tag = 0x02) => { const b = []; let v = n; do { b.unshift(v & 0xff); v >>= 8; } while (v > 0); if (b[0] & 0x80) b.unshift(0); return tlv(tag, Buffer.from(b)); };
const bool = (v, tag = 0x01) => tlv(tag, Buffer.from([v ? 0xff : 0]));
/** reads one TLV at offset; null when the buffer does not hold all of it yet */
function read(buf, off = 0) {
  if (buf.length < off + 2) return null; const tag = buf[off]; let l = buf[off + 1], p = off + 2;
  if (l & 0x80) { const n = l & 0x7f; if (n > 4 || buf.length < p + n) return n > 4 ? { bad: true } : null; l = 0; for (let i = 0; i < n; i++) l = l * 256 + buf[p + i]; p += n; }
  if (buf.length < p + l) return null;
  return { tag, start: p, end: p + l, body: buf.subarray(p, p + l), next: p + l };
}
function children(b) { const out = []; let o = 0; while (o < b.length) { const t = read(b, o); if (!t || t.bad) break; out.push(t); o = t.next; } return out; }
const toInt = (b) => { let v = 0; for (const x of b) v = v * 256 + x; return v; };

// ---------- filters (RFC 4515) ----------
/** a value typed by a person, made safe to put in a filter */
const escapeValue = (v) => String(v).replace(/[\\*()\u0000]/g, (c) => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0'));
const unescape = (v) => Buffer.from(v.replace(/\\([0-9a-fA-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
function parseFilter(s) {
  let i = 0;
  const one = () => {
    if (s[i] !== '(') throw new Error('A filter part must start with "(" at position ' + (i + 1));
    i++; let out;
    if (s[i] === '&' || s[i] === '|') { const tag = s[i] === '&' ? 0xa0 : 0xa1; i++; const parts = []; while (s[i] === '(') parts.push(one()); out = seq(tag, ...parts); }
    else if (s[i] === '!') { i++; out = seq(0xa2, one()); }
    else {
      const end = s.indexOf(')', i); if (end < 0) throw new Error('A filter part is not closed with ")"');
      const item = s.slice(i, end); i = end;
      const m = /^([^=~<>:]*)(:[^:=]+)?(:[^:=]+)?(~=|>=|<=|:=|=)(.*)$/.exec(item); if (!m) throw new Error('Not a filter item: ' + item);
      const attr = m[1], op = m[4], val = m[5];
      if (op === ':=') {        // extensible match: attr[:dn][:rule]:=value  (used for nested AD groups)
        const rest = [m[2], m[3]].filter(Boolean).map((x) => x.slice(1)); const dn = rest.includes('dn'), rule = rest.find((x) => x !== 'dn');
        out = seq(0xa9, ...(rule ? [str(rule, 0x81)] : []), ...(attr ? [str(attr, 0x82)] : []), tlv(0x83, unescape(val)), ...(dn ? [bool(true, 0x84)] : []));
      } else if (op === '=' && val === '*') out = str(attr, 0x87);
      else if (op === '=' && val.includes('*')) {
        const parts = val.split('*'), subs = [];
        parts.forEach((p, k) => { if (!p) return; subs.push(tlv(k === 0 ? 0x80 : k === parts.length - 1 ? 0x82 : 0x81, unescape(p))); });
        out = seq(0xa4, str(attr), seq(0x30, ...subs));
      } else out = seq({ '=': 0xa3, '>=': 0xa5, '<=': 0xa6, '~=': 0xa8 }[op], str(attr), tlv(0x04, unescape(val)));
    }
    if (s[i] !== ')') throw new Error('Expected ")" at position ' + (i + 1)); i++; return out;
  };
  s = String(s || '').trim(); if (!s.startsWith('(')) s = '(' + s + ')';
  const f = one(); if (i !== s.length) throw new Error('Unexpected text after the filter'); return f;
}

// ---------- connection ----------
const RESULT = { 0: 'success', 1: 'operations error', 2: 'protocol error', 3: 'time limit exceeded', 4: 'size limit exceeded', 7: 'authentication method not supported', 8: 'stronger authentication required', 13: 'confidentiality required (use LDAPS or StartTLS)', 32: 'no such object (check the base DN)', 34: 'invalid DN syntax', 48: 'inappropriate authentication', 49: 'invalid credentials', 50: 'insufficient access rights', 51: 'busy', 52: 'unavailable', 53: 'unwilling to perform' };
class Conn {
  constructor(sock, timeout) { this.sock = sock; this.timeout = timeout; this.id = 0; this.buf = Buffer.alloc(0); this.wait = new Map(); this.attach(sock); }
  attach(sock) {
    this.sock = sock;
    sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.pump(); });
    const fail = (e) => { for (const w of this.wait.values()) w.reject(e); this.wait.clear(); };
    sock.on('error', fail); sock.on('close', () => fail(new Error('The directory server closed the connection.')));
  }
  pump() {
    for (;;) {
      const t = read(this.buf); if (!t) return; if (t.bad || t.tag !== 0x30) { this.sock.destroy(); return; }
      const [idT, op] = children(t.body); this.buf = this.buf.subarray(t.next);
      const w = this.wait.get(toInt(idT.body)); if (w) w.onOp(op);
    }
  }
  /** sends one request; resolves with the list of answers once the final one (done) arrives */
  request(opTlv, isDone) {
    const id = ++this.id; const msg = seq(0x30, int(id), opTlv);
    return new Promise((resolve, reject) => {
      const got = []; const tm = setTimeout(() => { this.wait.delete(id); reject(new Error('The directory server did not answer in time.')); }, this.timeout);
      this.wait.set(id, { reject: (e) => { clearTimeout(tm); reject(e); }, onOp: (op) => { got.push(op); if (isDone(op)) { clearTimeout(tm); this.wait.delete(id); resolve(got); } } });
      this.sock.write(msg);
    });
  }
  static result(op) { const [code, dn, diag] = children(op.body); return { code: toInt(code.body), matched: dn ? dn.body.toString() : '', message: diag ? diag.body.toString() : '' }; }
  async bind(dn, password) {
    const [op] = await this.request(seq(0x60, int(3), str(dn), str(password, 0x80)), (o) => o.tag === 0x61);
    return Conn.result(op);
  }
  async search(base, filter, attrs, sizeLimit = 0) {
    const ops = await this.request(seq(0x63, str(base), int(2, 0x0a), int(0, 0x0a), int(sizeLimit), int(Math.ceil(this.timeout / 1000)), bool(false), parseFilter(filter), seq(0x30, ...attrs.map((a) => str(a)))), (o) => o.tag === 0x65);
    const done = Conn.result(ops[ops.length - 1]); const entries = [];
    for (const op of ops) if (op.tag === 0x64) {
      const [dn, at] = children(op.body); const e = { dn: dn.body.toString(), attrs: {} };
      for (const a of children(at.body)) { const [type, vals] = children(a.body); e.attrs[type.body.toString().toLowerCase()] = children(vals.body).map((v) => v.body.toString()); }
      entries.push(e);
    }
    return { entries, done };
  }
  async startTls() {
    const [op] = await this.request(seq(0x77, str('1.3.6.1.4.1.1466.20037', 0x80)), (o) => o.tag === 0x78);
    const r = Conn.result(op); if (r.code !== 0) throw new Error('The server refused StartTLS: ' + (RESULT[r.code] || r.code) + (r.message ? ' — ' + r.message : ''));
  }
  close() { try { this.sock.write(seq(0x30, int(++this.id), tlv(0x42, Buffer.alloc(0)))); } catch { /* */ } try { this.sock.end(); this.sock.destroy(); } catch { /* */ } }
}
function tlsOpts(c, host) { const o = { servername: net.isIP(host) ? undefined : host, rejectUnauthorized: c.verifyCert !== false }; if (c.caFile) { try { o.ca = fs.readFileSync(c.caFile); } catch (e) { throw new Error('The CA certificate file cannot be read: ' + e.message); } } return o; }
async function connect(c) {
  const u = new URL(String(c.url || '')); const secure = u.protocol === 'ldaps:'; if (!['ldap:', 'ldaps:'].includes(u.protocol)) throw new Error('The server address must start with ldap:// or ldaps://');
  const host = u.hostname.replace(/^\[|\]$/g, ''), port = +u.port || (secure ? 636 : 389), timeout = Math.min(30000, Math.max(1000, +c.timeoutMs || 8000));
  const sock = await new Promise((resolve, reject) => {
    const s = secure ? tls.connect({ host, port, ...tlsOpts(c, host) }) : net.connect({ host, port });
    const tm = setTimeout(() => { s.destroy(); reject(new Error(`No answer from ${host}:${port}.`)); }, timeout);
    s.once(secure ? 'secureConnect' : 'connect', () => { clearTimeout(tm); resolve(s); });
    s.once('error', (e) => { clearTimeout(tm); reject(new Error(`Cannot reach ${host}:${port}: ${e.message}`)); });
  });
  const conn = new Conn(sock, timeout);
  if (!secure && c.startTls) {
    await conn.startTls();
    sock.removeAllListeners('data'); sock.removeAllListeners('error'); sock.removeAllListeners('close');
    const t = await new Promise((resolve, reject) => { const s = tls.connect({ socket: sock, ...tlsOpts(c, host) }); s.once('secureConnect', () => resolve(s)); s.once('error', (e) => reject(new Error('TLS with the directory failed: ' + e.message))); });
    conn.attach(t);
  }
  return conn;
}

const cnOf = (dn) => (/^\s*cn=((?:\\.|[^,])+)/i.exec(dn) || [])[1]?.replace(/\\(.)/g, '$1') || '';
/** the role ids for a list of group DNs (a mapping names a group by its full DN or just its CN), or the default role */
function rolesFor(groups, c) {
  const have = new Set(); for (const g of groups) { have.add(g.toLowerCase()); have.add(cnOf(g).toLowerCase()); }
  const ids = []; for (const m of c.groupRoles || []) if (m && m.group && m.roleId && have.has(String(m.group).trim().toLowerCase()) && !ids.includes(m.roleId)) ids.push(m.roleId);
  if (!ids.length && c.defaultRoleId) ids.push(c.defaultRoleId);
  return ids;
}

/**
 * Checks a user name and password against the directory. Resolves { ok, dn, fullName, mail, groups, roleIds, steps } or
 * { ok:false, reason, steps }. `steps` is a plain-language log for the Test button.
 */
async function authenticate(c, user, password) {
  const steps = [], step = (t) => steps.push(t);
  if (!user || !password) return { ok: false, reason: 'Enter a user name and a password.', steps };     // an empty password would be an anonymous bind, which many servers accept
  let conn;
  try {
    conn = await connect(c); step(`Connected to ${c.url}${c.startTls && !/^ldaps:/i.test(c.url) ? ' (StartTLS)' : ''}.`);
    if (c.bindDN) { const r = await conn.bind(c.bindDN, c.bindPassword || ''); if (r.code !== 0) return { ok: false, reason: `The service account could not sign in: ${RESULT[r.code] || 'code ' + r.code}${r.message ? ' — ' + r.message : ''}.`, steps }; step('Service account signed in.'); }
    const filter = String(c.userFilter || '(&(objectClass=person)(|(sAMAccountName={user})(userPrincipalName={user})(uid={user})))').split('{user}').join(escapeValue(user));
    const s = await conn.search(c.baseDN || '', filter, ['displayName', 'cn', 'mail', 'memberOf'], 2);
    if (s.done.code !== 0 && s.done.code !== 4) return { ok: false, reason: `The user search failed: ${RESULT[s.done.code] || 'code ' + s.done.code}${s.done.message ? ' — ' + s.done.message : ''}.`, steps };
    if (!s.entries.length) { step('No user found with that name.'); return { ok: false, reason: 'Wrong user name or password.', steps }; }
    if (s.entries.length > 1) { step('More than one user matched: make the user filter stricter.'); return { ok: false, reason: 'More than one directory user has that name.', steps }; }
    const e = s.entries[0]; step(`Found ${e.dn}.`);
    const r = await conn.bind(e.dn, password);
    if (r.code !== 0) { step(`Password check: ${RESULT[r.code] || 'code ' + r.code}.`); return { ok: false, reason: 'Wrong user name or password.', steps }; }
    step('Password is right.');
    let groups = e.attrs.memberof || [];
    if (c.nested) {
      if (c.bindDN) await conn.bind(c.bindDN, c.bindPassword || '');
      const g = await conn.search(c.baseDN || '', `(member:1.2.840.113556.1.4.1941:=${escapeValue(e.dn)})`, ['cn']);
      if (g.done.code === 0) groups = [...new Set([...groups, ...g.entries.map((x) => x.dn)])];
    }
    step(groups.length ? `Groups: ${groups.map((x) => cnOf(x) || x).join(', ')}.` : 'The user is in no groups.');
    const roleIds = rolesFor(groups, c);
    return { ok: true, dn: e.dn, fullName: (e.attrs.displayname || e.attrs.cn || [''])[0], mail: (e.attrs.mail || [''])[0], groups, roleIds, steps };
  } catch (err) { step(err.message); return { ok: false, reason: err.message, steps }; }
  finally { conn?.close(); }
}

module.exports = { authenticate, rolesFor, parseFilter, escapeValue, cnOf, _ber: { read, children, seq, str, int, tlv, toInt } };
