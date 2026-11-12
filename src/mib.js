'use strict';
// MIB files: reads standard SMIv1 / SMIv2 text MIBs (the files vendors publish) and answers "what is this OID called?".
// Only what trap display needs is extracted: names and numbers of objects, traps/notifications, and the named values of integer
// objects (up(1), down(2)). The text of a MIB is never run. A few core definitions (SNMPv2-MIB, IF-MIB) are built in.

const fs = require('node:fs');
const path = require('node:path');

const MAX_FILE_BYTES = 16 * 1024 * 1024, MAX_FILES = 5000, MAX_DEFS = 3000000;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

// names every MIB may build on without importing them from a file
const BASE = {
  ccitt: [0], iso: [1], 'joint-iso-ccitt': [2], org: [1, 3], dod: [1, 3, 6], internet: [1, 3, 6, 1], directory: [1, 3, 6, 1, 1], mgmt: [1, 3, 6, 1, 2], 'mib-2': [1, 3, 6, 1, 2, 1],
  transmission: [1, 3, 6, 1, 2, 1, 10], experimental: [1, 3, 6, 1, 3], private: [1, 3, 6, 1, 4], enterprises: [1, 3, 6, 1, 4, 1], security: [1, 3, 6, 1, 5], snmpV2: [1, 3, 6, 1, 6],
  snmpDomains: [1, 3, 6, 1, 6, 1], snmpProxys: [1, 3, 6, 1, 6, 2], snmpModules: [1, 3, 6, 1, 6, 3], zeroDotZero: [0, 0]
};
const MACROS = new Set(['OBJECT-TYPE', 'NOTIFICATION-TYPE', 'TRAP-TYPE', 'MODULE-IDENTITY', 'OBJECT-IDENTITY', 'OBJECT-GROUP', 'NOTIFICATION-GROUP', 'MODULE-COMPLIANCE', 'AGENT-CAPABILITIES']);

const BUILTIN = `
SNMPv2-MIB DEFINITIONS ::= BEGIN
system OBJECT IDENTIFIER ::= { mib-2 1 }
sysDescr OBJECT-TYPE SYNTAX DisplayString ::= { system 1 }
sysObjectID OBJECT-TYPE SYNTAX OBJECT IDENTIFIER ::= { system 2 }
sysUpTime OBJECT-TYPE SYNTAX TimeTicks ::= { system 3 }
sysContact OBJECT-TYPE SYNTAX DisplayString ::= { system 4 }
sysName OBJECT-TYPE SYNTAX DisplayString ::= { system 5 }
sysLocation OBJECT-TYPE SYNTAX DisplayString ::= { system 6 }
snmpMIB OBJECT IDENTIFIER ::= { snmpModules 1 }
snmpMIBObjects OBJECT IDENTIFIER ::= { snmpMIB 1 }
snmpTrap OBJECT IDENTIFIER ::= { snmpMIBObjects 4 }
snmpTrapOID OBJECT-TYPE SYNTAX OBJECT IDENTIFIER ::= { snmpTrap 1 }
snmpTrapEnterprise OBJECT-TYPE SYNTAX OBJECT IDENTIFIER ::= { snmpTrap 3 }
snmpTraps OBJECT IDENTIFIER ::= { snmpMIBObjects 5 }
coldStart NOTIFICATION-TYPE ::= { snmpTraps 1 }
warmStart NOTIFICATION-TYPE ::= { snmpTraps 2 }
authenticationFailure NOTIFICATION-TYPE ::= { snmpTraps 5 }
egpNeighborLoss NOTIFICATION-TYPE ::= { snmpTraps 6 }
END
IF-MIB DEFINITIONS ::= BEGIN
interfaces OBJECT IDENTIFIER ::= { mib-2 2 }
ifNumber OBJECT-TYPE SYNTAX Integer32 ::= { interfaces 1 }
ifTable OBJECT-TYPE SYNTAX SEQUENCE OF IfEntry ::= { interfaces 2 }
ifEntry OBJECT-TYPE SYNTAX IfEntry ::= { ifTable 1 }
ifIndex OBJECT-TYPE SYNTAX InterfaceIndex ::= { ifEntry 1 }
ifDescr OBJECT-TYPE SYNTAX DisplayString ::= { ifEntry 2 }
ifType OBJECT-TYPE SYNTAX INTEGER ::= { ifEntry 3 }
ifMtu OBJECT-TYPE SYNTAX Integer32 ::= { ifEntry 4 }
ifSpeed OBJECT-TYPE SYNTAX Gauge32 ::= { ifEntry 5 }
ifPhysAddress OBJECT-TYPE SYNTAX PhysAddress ::= { ifEntry 6 }
ifAdminStatus OBJECT-TYPE SYNTAX INTEGER { up(1), down(2), testing(3) } ::= { ifEntry 7 }
ifOperStatus OBJECT-TYPE SYNTAX INTEGER { up(1), down(2), testing(3), unknown(4), dormant(5), notPresent(6), lowerLayerDown(7) } ::= { ifEntry 8 }
ifLastChange OBJECT-TYPE SYNTAX TimeTicks ::= { ifEntry 9 }
ifMIB OBJECT IDENTIFIER ::= { mib-2 31 }
ifMIBObjects OBJECT IDENTIFIER ::= { ifMIB 1 }
ifXTable OBJECT-TYPE SYNTAX SEQUENCE OF IfXEntry ::= { ifMIBObjects 1 }
ifXEntry OBJECT-TYPE SYNTAX IfXEntry ::= { ifXTable 1 }
ifName OBJECT-TYPE SYNTAX DisplayString ::= { ifXEntry 1 }
ifAlias OBJECT-TYPE SYNTAX DisplayString ::= { ifXEntry 18 }
linkDown NOTIFICATION-TYPE OBJECTS { ifIndex, ifAdminStatus, ifOperStatus } ::= { snmpTraps 3 }
linkUp NOTIFICATION-TYPE OBJECTS { ifIndex, ifAdminStatus, ifOperStatus } ::= { snmpTraps 4 }
END
`;

// ---- reading a file ---------------------------------------------------------------------------------------------------------------
const TOKEN = /"[^"]*"|--[^\r\n]*?(?:--|(?=[\r\n]|$))|::=|\.\.|[{}()\[\],;|]|[A-Za-z0-9_]+(?:[-.][A-Za-z0-9_]+)*|\S/g;

function tokenize(text) {
  const out = [];
  for (const m of text.matchAll(TOKEN)) {
    const t = m[0];
    if (t.startsWith('--')) continue;
    out.push(t);
  }
  return out;
}
const isName = (t) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(t);
const isNum = (t) => /^\d+$/.test(t);
const stripModule = (t) => { const i = t.lastIndexOf('.'); return i > 0 && /^[A-Za-z]/.test(t) ? t.slice(i + 1) : t; };

/** reads { name(1), other 2, ... } starting at the "{" token; returns [entries, index after the "}"] */
function enumList(tk, i) {
  const out = new Map(); i++;
  while (i < tk.length && tk[i] !== '}') {
    const name = tk[i];
    if (isName(name) && tk[i + 1] === '(') {
      let j = i + 2, neg = false; if (tk[j] === '-') { neg = true; j++; }
      if (isNum(tk[j])) { out.set((neg ? -1 : 1) * Number(tk[j]), name); i = j + 1; if (tk[i] === ')') i++; continue; }
    }
    i++;
  }
  return [out, i + 1];
}

/** Parses one MIB file. Returns { modules, defs, types, imports } */
// IANA private enterprise numbers of the vendors NetEventPro users meet most; used to tell which vendor a MIB belongs to
const { NAMES: VENDORS } = require('./enterprises');
const stdOrg = /IETF|Internet Engineering|IEEE|RFC|ISO/i;
/** vendor of a MIB: the enterprise number it hangs under, else the ORGANIZATION line the author wrote, else standard (IETF/IEEE) */
function vendorOf(text) {
  const nums = []; for (const m of text.matchAll(/\benterprises\s+(\d+)\b|1\.3\.6\.1\.4\.1\.(\d+)\b/g)) nums.push(+(m[1] || m[2]));
  for (const n of nums) if (VENDORS[n]) return VENDORS[n];
  const o = /ORGANIZATION\s+"([^"]{1,200})"/.exec(text); const org = o ? o[1].replace(/\s+/g, ' ').trim() : '';
  if (org && stdOrg.test(org)) return 'Standard';
  if (org) return org.slice(0, 60);
  if (nums.length) return 'enterprise ' + nums[0];
  return '';
}
function parseMib(text) {
  const tk = tokenize(text);
  const res = { modules: [], defs: [], types: new Map(), bases: new Map(), imports: new Set(), importsFrom: new Map(), vendor: vendorOf(text) };
  let module = '', i = 0;
  const guard = tk.length * 4 + 100; let steps = 0;
  const oidBlock = (j) => {      // "{ a b(1) 2 }" starting at "{": returns [components, next index]
    const comps = []; j++;
    while (j < tk.length && tk[j] !== '}') {
      const t = tk[j];
      if (isNum(t)) { comps.push({ num: Number(t) }); j++; } else if (/^[A-Za-z]/.test(t)) {
        if (tk[j + 1] === '(' && isNum(tk[j + 2])) { comps.push({ name: stripModule(t), num: Number(tk[j + 2]) }); j += 4; } else { comps.push({ name: stripModule(t) }); j++; }
      } else j++;
    }
    return [comps, j + 1];
  };
  while (i < tk.length) {
    if (++steps > guard) break;
    const t = tk[i], nx = tk[i + 1];
    if (nx === 'DEFINITIONS' && tk[i + 2] === '::=') { module = t; res.modules.push(t); i += 3; continue; }
    if (t === 'IMPORTS') {
      i++; const names = [];
      while (i < tk.length && tk[i] !== ';') {
        if (tk[i] === 'FROM') { const m = tk[i + 1]; if (m) { res.imports.add(m); for (const n of names) if (/^[A-Za-z]/.test(n) && !res.importsFrom.has(n)) res.importsFrom.set(n, m); } names.length = 0; i += 2; } else { names.push(tk[i]); i++; }
      }
      i++; continue;
    }
    if (t === 'EXPORTS') { while (i < tk.length && tk[i] !== ';') i++; i++; continue; }
    if (nx === 'MACRO' && tk[i + 2] === '::=') { while (i < tk.length && tk[i] !== 'END') i++; i++; continue; }
    // name OBJECT IDENTIFIER ::= { ... }
    if (isName(t) && nx === 'OBJECT' && tk[i + 2] === 'IDENTIFIER' && tk[i + 3] === '::=' && tk[i + 4] === '{') {
      const [comps, j] = oidBlock(i + 4); res.defs.push({ name: t, module, kind: 'node', comps }); i = j; continue;
    }
    // name MACRO-KEYWORD ... ::= { ... }  (or "::= 5" for SMIv1 TRAP-TYPE)
    if (isName(t) && MACROS.has(nx)) {
      const kind = nx; let j = i + 2; const d = { name: t, module, kind, comps: null, syntax: '', enums: null, objects: [], enterprise: '', trapNum: null };
      while (j < tk.length && tk[j] !== '::=') {
        const k = tk[j];
        if (k === 'SYNTAX') {
          j++; let ty = tk[j] || '';
          if (ty === 'OCTET' && tk[j + 1] === 'STRING') { ty = 'OCTET STRING'; j++; } else if (ty === 'OBJECT' && tk[j + 1] === 'IDENTIFIER') { ty = 'OBJECT IDENTIFIER'; j++; } else if (ty === 'SEQUENCE' && tk[j + 1] === 'OF') { ty = 'SEQUENCE OF'; j += 2; }
          d.syntax = ty; j++;
          if (tk[j] === '{') { const [e, nj] = enumList(tk, j); d.enums = e; j = nj; }
          continue;
        }
        if ((k === 'OBJECTS' || k === 'VARIABLES' || k === 'NOTIFICATIONS') && tk[j + 1] === '{') {
          j += 2; while (j < tk.length && tk[j] !== '}') { if (isName(tk[j])) d.objects.push(stripModule(tk[j])); j++; }
          j++; continue;
        }
        if (k === 'ENTERPRISE') { d.enterprise = stripModule(tk[j + 1] || ''); j += 2; continue; }
        j++;
      }
      if (tk[j] === '::=') {
        if (tk[j + 1] === '{') { const [comps, nj] = oidBlock(j + 1); d.comps = comps; j = nj; } else if (kind === 'TRAP-TYPE' && isNum(tk[j + 1])) { d.trapNum = Number(tk[j + 1]); j += 2; } else j++;
      }
      if (d.comps || d.trapNum !== null) res.defs.push(d);
      i = j; continue;
    }
    // Type ::= ... : textual conventions and plain enumerations give names to integer values
    if (/^[A-Z]/.test(t) && nx === '::=') {
      let j = i + 2;
      if (tk[j] === 'TEXTUAL-CONVENTION') {
        while (j < tk.length && tk[j] !== 'SYNTAX') j++;
        j++; res.bases.set(t, tk[j] === 'OCTET' || tk[j] === 'OBJECT' ? tk[j] + ' ' + (tk[j + 1] || '') : tk[j] || '');   // what the type is made of (Gauge32, Counter64, OCTET STRING ...)
        if (tk[j] === 'OCTET' || tk[j] === 'OBJECT') j++;
        j++; if (tk[j] === '{') { const [e, nj] = enumList(tk, j); res.types.set(t, e); j = nj; }
      } else if ((tk[j] === 'INTEGER' || tk[j] === 'ENUMERATED' || tk[j] === 'BITS') && tk[j + 1] === '{') { const [e, nj] = enumList(tk, j + 1); res.types.set(t, e); j = nj; } else if (tk[j] === 'INTEGER' && tk[j + 1] === '(') { /* range only */ }
      i = Math.max(j, i + 2); continue;
    }
    i++;
  }
  return res;
}

// ---- the set of loaded MIBs -------------------------------------------------------------------------------------------------------
class MibStore {
  /** @param dir folder that holds the uploaded MIB files (created on first upload) */
  constructor(dir) {
    this.dir = dir; this.files = new Map(); this.version = 0;
    this.builtin = parseMib(BUILTIN);
    this.load();
  }
  load() {
    this.files.clear();
    let names = []; try { names = fs.readdirSync(this.dir); } catch { /* none uploaded yet */ }
    for (const n of names.sort()) {
      if (!FILE_RE.test(n) || this.files.size >= MAX_FILES) continue;
      try { const st = fs.statSync(path.join(this.dir, n)); if (!st.isFile() || st.size > MAX_FILE_BYTES) continue; this.files.set(n, { parsed: parseMib(fs.readFileSync(path.join(this.dir, n), 'utf8')), size: st.size, mtime: st.mtimeMs }); } catch (e) { console.error(`[mib] ${n}: ${e.message}`); }
    }
    this.build();
  }
  /** checks a MIB and stores it. Throws an Error with a plain message when the file is not usable. */
  add(name, text) {
    name = String(name || '').trim();
    if (!FILE_RE.test(name)) throw userErr('The file name may only contain letters, digits, dot, dash and underscore.');
    if (typeof text !== 'string' || !text.trim()) throw userErr('The file is empty.');
    if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw userErr('The MIB file is larger than 16 MB.');
    if (text.includes('\u0000')) throw userErr('This is a binary file, not a text MIB.');
    if (!this.files.has(name) && this.files.size >= MAX_FILES) throw userErr(`At most ${MAX_FILES} MIB files are supported.`);
    if (!/\bDEFINITIONS\b/.test(text) || !/\bBEGIN\b/.test(text)) throw userErr('This does not look like a MIB file (no "DEFINITIONS ::= BEGIN" found).');
    const parsed = parseMib(text);
    if (!parsed.defs.length && !parsed.types.size) throw userErr('No object or trap definitions were found in this file.');
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = path.join(this.dir, name + '.tmp'); fs.writeFileSync(tmp, text); fs.renameSync(tmp, path.join(this.dir, name));
    this.files.set(name, { parsed, size: Buffer.byteLength(text), mtime: Date.now() });
    this.build();
    return this.fileInfo(name);
  }
  remove(name) {
    if (!this.files.has(name)) return false;
    try { fs.rmSync(path.join(this.dir, name), { force: true }); } catch { /* already gone */ }
    this.files.delete(name); this.build(); return true;
  }

  /** works out the number of every definition (a definition may refer to one in a file that was uploaded later) */
  build() {
    this.nodes = new Map(); this.names = new Map(); this.same = new Map(); this.types = new Map(); this.bases = new Map(); this.unresolved = new Map();
    const base = new Map(Object.entries(BASE));
    const all = []; let total = 0;
    // Names are resolved per module, like real MIB tools: a name defined in the file's own module wins, then the module its IMPORTS name, and only then any module.
    // (Several vendors use the same name for different things: "alertGroup" is 10892.1.5000 in MIB-Dell-10892 but 10892.5.3 in IDRAC-MIB. A single global list made the result depend on file order.)
    this.byModule = new Map(); const defined = new Map();
    const take = (parsed, builtin, file) => { for (const [k, v] of parsed.types) if (!this.types.has(k)) this.types.set(k, v); for (const [k, v] of parsed.bases) if (!this.bases.has(k)) this.bases.set(k, v); for (const d of parsed.defs) { if (++total > MAX_DEFS) return; all.push({ d, builtin, file, imp: parsed.importsFrom }); let set = defined.get(d.module); if (!set) defined.set(d.module, set = new Set()); set.add(d.name); } };
    take(this.builtin, true, ''); for (const [n, f] of this.files) take(f.parsed, false, n);
    const inModule = (mod, name) => { const m = mod && this.byModule.get(mod); return m ? m.get(name)?.oid : undefined; };
    const resolver = (e) => (name) => {
      if (defined.get(e.d.module)?.has(name)) return inModule(e.d.module, name) || null;          // defined in the same module: wait until it is placed
      const from = e.imp?.get(name); if (from && defined.get(from)?.has(name)) return inModule(from, name) || null;   // defined in the module it is imported from
      return base.get(name) || this.names.get(name)?.oid;
    };
    let pending = all;
    for (let round = 0; round < 64 && pending.length; round++) {
      const later = [];
      for (const e of pending) {
        const oid = this.numberOf(e.d, resolver(e));
        if (!oid) { later.push(e); continue; }
        this.register(e, oid);
      }
      if (later.length === pending.length) break;
      pending = later;
    }
    for (const e of pending) { const d = e.d; const key = d.comps ? (d.comps[0].name || '') : d.enterprise; this.unresolved.set(d.name, { module: d.module, file: e.file, needs: key }); }
    for (const [n, f] of this.files) {
      const missing = [...f.parsed.imports].filter((m) => !this.hasModule(m));
      f.missing = missing;
    }
    // what is loaded for each vendor number (1.3.6.1.4.1.N): files, and every trap, for the "MIB assistant"
    this.ent = new Map();
    for (const node of this.nodes.values()) {
      const o = node.oid; if (o.length < 7 || o[0] !== 1 || o[1] !== 3 || o[2] !== 6 || o[3] !== 1 || o[4] !== 4 || o[5] !== 1) continue;
      let x = this.ent.get(o[6]); if (!x) this.ent.set(o[6], x = { files: new Set(), traps: [], nodes: 0 });
      x.nodes++; if (node.file) x.files.add(node.file);
      if (node.kind === 'TRAP-TYPE' || node.kind === 'NOTIFICATION-TYPE') x.traps.push(node);
    }
    this.version++;
  }
  /** Why is this trap OID not named, and what to do about it? Never guesses a name: it only reports what the loaded MIBs contain.
   *  state: resolved | no-vendor-mib | other-oid | not-defined | standard | unknown.  vendor = display name of the enterprise number (optional) */
  diagnose(oid, vendor = '') {
    const ex = this.exact(oid); if (ex) return { state: 'resolved', name: (ex.module ? ex.module + '::' : '') + ex.name, file: ex.file || '' };
    const isEnt = oid.length >= 7 && oid.slice(0, 6).join('.') === '1.3.6.1.4.1', num = isEnt ? oid[6] : null;
    if (!isEnt) {
      const f = this.find(oid); const near = f && f.node.oid.length >= 6 ? this.name(f.node.oid, true) : null;
      return { state: 'standard', near, advice: near ? `Only the parent ${near} is known. The MIB that defines this trap is not loaded (or defines it elsewhere).` : 'This is not a vendor trap and no loaded MIB knows it. Add the standard MIB it belongs to.' };
    }
    const label = vendor || VENDORS[num] || 'enterprise ' + num, x = this.ent.get(num);
    if (!x || !x.nodes) return { state: 'no-vendor-mib', vendor: label, enterprise: num, advice: `No MIB for ${label} is loaded. Download the MIB of this device (model and firmware) from the vendor and upload it.` };
    const last = oid[oid.length - 1], cands = x.traps.filter((t) => t.oid[t.oid.length - 1] === last);
    const files = [...x.files].slice(0, 6);
    if (cands.length) {
      const c = cands.slice(0, 3).map((t) => ({ name: (t.module ? t.module + '::' : '') + t.name, oid: t.oid.join('.'), file: t.file || '' }));
      return { state: 'other-oid', vendor: label, enterprise: num, candidates: c, files, advice: `${label} MIBs are loaded, but none defines this exact OID. The device sends it under a different tree than the MIB: probably a newer or older firmware, or the other SMI version of the same MIB. Trap number ${last} exists as ${c.map((t) => t.name).join(' / ')}. Get the MIB version that matches this device.` };
    }
    return { state: 'not-defined', vendor: label, enterprise: num, files, advice: `${label} MIBs are loaded (${files.join(', ')}${x.files.size > files.length ? ' …' : ''}) but none defines this trap. Get the MIB for this device model / firmware, or the vendor's full MIB package.` };
  }
  numberOf(d, oidOf) {
    if (d.kind === 'TRAP-TYPE') { const ent = oidOf(d.enterprise); return ent ? [...ent, 0, d.trapNum] : null; }
    let oid = null;
    for (let k = 0; k < d.comps.length; k++) {
      const c = d.comps[k];
      if (k === 0) {
        if (c.num !== undefined && c.name === undefined) oid = [c.num];
        else if (c.num !== undefined) oid = [c.num];
        else { const o = oidOf(c.name); if (!o) return null; oid = o.slice(); }
      } else if (c.num !== undefined) oid.push(c.num); else { const o = oidOf(c.name); if (!o) return null; oid = o.slice(); }
    }
    return oid && oid.length ? oid : null;
  }
  register(e, oid) {
    const d = e.d, key = oid.join('.');
    const node = { name: d.name, module: d.module || '', oid, kind: d.kind === 'node' ? 'node' : d.kind, syntax: d.syntax || '', enums: d.enums, objects: d.objects, builtin: e.builtin, file: e.file };
    if (!this.nodes.has(key) || this.nodes.get(key).builtin) this.nodes.set(key, node);
    const have = this.names.get(d.name);
    if (!have || have.builtin) this.names.set(d.name, node);
    (this.same ||= new Map()).set(d.name, [...(this.same.get(d.name) || []), node]);
    let mm = this.byModule.get(node.module); if (!mm) this.byModule.set(node.module, mm = new Map());
    if (!mm.has(d.name) || mm.get(d.name).builtin) mm.set(d.name, node);
  }
  hasModule(m) {
    if (this.builtin.modules.includes(m) || ['SNMPv2-SMI', 'SNMPv2-TC', 'SNMPv2-CONF', 'RFC-1212', 'RFC-1215', 'RFC1155-SMI', 'RFC1065-SMI', 'RFC1158-MIB', 'RFC1213-MIB'].includes(m)) return true;
    for (const f of this.files.values()) if (f.parsed.modules.includes(m)) return true;
    return false;
  }

  // ---- lookups ---------------------------------------------------------------------------------------------------------------------
  /** longest known prefix of an OID: { node, suffix:[...] } or null */
  find(oid) {
    for (let n = oid.length; n >= 1; n--) {
      const node = this.nodes.get(oid.slice(0, n).join('.'));
      if (node) return { node, suffix: oid.slice(n) };
    }
    return null;
  }
  /** "IF-MIB::ifDescr.3" for an OID, or null when no MIB knows it */
  name(oid, withModule = false) {
    const f = this.find(oid); if (!f) return null;
    if (f.node.oid.length < 7 && f.suffix.length) return null;               // do not call 1.3.6.1.4.1.9999.5 "enterprises.9999.5": an unknown vendor stays numeric
    return (withModule && f.node.module ? f.node.module + '::' : '') + f.node.name + (f.suffix.length ? '.' + f.suffix.join('.') : '');
  }
  /** an exact match, for traps: the node whose OID is exactly this */
  exact(oid) { return this.nodes.get(oid.join('.')) || null; }
  /** accepts "1.3.6...", ".1.3.6...", "ifDescr.3", "IF-MIB::ifDescr.3" */
  lookup(q) {
    q = String(q || '').trim(); if (!q) return null;
    let oid = null;
    if (/^\.?\d+(\.\d+)*$/.test(q)) oid = q.replace(/^\./, '').split('.').map(Number);
    else {
      const m = /^(?:[A-Za-z0-9-]+::)?([A-Za-z][A-Za-z0-9_-]*)((?:\.\d+)*)$/.exec(q); if (!m) return null;
      const suffix = m[2].split('.').filter(Boolean).map(Number), qual = /^([A-Za-z0-9-]+)::/.exec(q);
      let cands = this.same.get(m[1]) || []; if (qual) cands = cands.filter((x) => x.module === qual[1]);
      // the same name can exist in several MIBs (alertGroup): take the one whose full OID is a known node, else the first loaded
      const pick = cands.find((x) => this.nodes.has([...x.oid, ...suffix].join('.'))) || cands[0];
      const n = pick || this.names.get(m[1]); const b = n ? n.oid : BASE[m[1]]; if (!b) return null;
      oid = [...b, ...suffix];
    }
    if (oid.length > 128 || oid.some((x) => !Number.isSafeInteger(x))) return null;
    const f = this.find(oid);
    return { oid: oid.join('.'), name: this.name(oid, true), kind: f?.node.kind || null, syntax: f?.node.syntax || '', exact: !!f && !f.suffix.length, enums: f ? this.enumsOf(f.node) : null, objects: f?.node.objects || [], file: f?.node.file || '' };
  }
  enumsOf(node) {
    if (node.enums) return node.enums;
    return (node.syntax && this.types.get(node.syntax)) || null;
  }
  fileInfo(n) {
    const f = this.files.get(n); if (!f) return null;
    const defs = f.parsed.defs; const objs = defs.filter((d) => d.kind === 'OBJECT-TYPE').length, traps = defs.filter((d) => d.kind === 'NOTIFICATION-TYPE' || d.kind === 'TRAP-TYPE').length;
    const unresolved = this._waiting ? this._waiting.get(n) || 0 : [...this.unresolved.values()].filter((u) => u.file === n).length;
    return { name: n, size: f.size, mtime: f.mtime, modules: f.parsed.modules, definitions: defs.length, objects: objs, traps, unresolved, missing: f.missing || [], vendor: f.parsed.vendor || '' };
  }
  /** every trap / notification the loaded MIBs define: { name, module, oid, objects[], file } */
  catalog(q = '', limit = 300) {
    const needle = String(q).toLowerCase().trim(), out = [];
    for (const n of this.nodes.values()) {
      if (n.kind !== 'NOTIFICATION-TYPE' && n.kind !== 'TRAP-TYPE') continue;
      const oid = n.oid.join('.'); if (needle && !(`${n.name} ${n.module} ${oid}`.toLowerCase().includes(needle))) continue;
      out.push({ name: n.name, module: n.module, oid, objects: n.objects || [], file: n.builtin ? '(built in)' : n.file || '' });
    }
    out.sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name));
    return { total: out.length, traps: out.slice(0, limit) };
  }
  /** the basic SNMP type behind a syntax name (follows textual conventions: CiscoGauge -> Gauge32) */
  baseType(syn) { let t = String(syn || '').trim(); for (let i = 0; i < 6 && this.bases.has(t); i++) t = String(this.bases.get(t)).trim(); if (this.types.has(t)) return 'INTEGER'; return t; }   // a named list of values (AlarmColor ::= INTEGER { green(1) ... }) is an INTEGER
  /** the MIB files that define polled numbers, for the file picker: [{ file, module, count }] */
  readingFiles() {
    const by = new Map(); for (const o of this.readingList()) { const k = o.file || o.module; const e = by.get(k) || { file: o.file, module: o.module, count: 0 }; e.count++; by.set(k, e); }
    return [...by.values()].sort((a, b) => (a.file || a.module).localeCompare(b.file || b.module));
  }
  /** every readable number the loaded MIBs define (cached per MIB version) */
  readingList() {
    if (this._rl && this._rl.v === this.version) return this._rl.list;
    const NUM = /^(Integer32|Unsigned32|Gauge32|Gauge|Counter32|Counter64|Counter|TimeTicks|INTEGER|Integer|Unsigned|UInteger32|Percent\w*)\b/i, TEXTNUM = /(value|level|low|high|temp|volt|curr|power|speed|rate|count|percent|limit|thresh|load|freq|humid|batt|capacity|used|free|total|reading|amp|watt)/i, SKIP = /^(RowStatus|StorageType|TimeStamp|TestAndIncr|AutonomousType|TruthValue|TAddress|Counter64Pointer)$/i;
    const list = [];
    for (const n of this.nodes.values()) {
      if (n.kind !== 'OBJECT-TYPE' || !n.syntax || n.builtin) continue;
      const syn = String(n.syntax).trim(); if (/SEQUENCE|OBJECT IDENTIFIER|IpAddress|BITS/i.test(syn) || SKIP.test(syn)) continue;
      const base = this.baseType(syn); let text = false;
      if (/OCTET|DisplayString|SnmpAdminString/i.test(syn) || /OCTET|DisplayString/i.test(base)) { if (!TEXTNUM.test(n.name)) continue; text = true; }   // text that holds a number ("12.4"), judged by its name
      else if (!NUM.test(base) || /OBJECT|BITS/i.test(base)) continue;
      const parent = this.nodes.get(n.oid.slice(0, -1).join('.')); const column = !!(parent && /Entry$/.test(parent.name));
      const oid = n.oid.join('.'), mod = n.module || '', file = n.file || '', entry = column ? parent.oid.join('.') : '';
      list.push({ name: n.name, module: mod, oid, syntax: syn, column, entry, text, counter: !text && /counter/i.test(base), enums: this.enumsOf(n) || null, file, hay: `${n.name} ${mod} ${file} ${oid}`.toLowerCase() });
    }
    list.sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name));
    this._rl = { v: this.version, list }; return list;
  }
  /** readable numbers the loaded MIBs define, for building a polling profile: { name, module, oid, syntax, column, counter, enums, file }.
   *  q: words (all must match name, module, MIB file name or OID); file: only this MIB file; offset/limit: paging. */
  readings(q = '', limit = 100, opts = {}) {
    const words = String(q).toLowerCase().split(/\s+/).filter(Boolean), file = String(opts.file || '').toLowerCase(), off = Math.max(0, +opts.offset || 0), out = []; let total = 0;
    for (const o of this.readingList()) {
      if (opts.entry && o.entry !== opts.entry) continue;
      if (file && o.file.toLowerCase() !== file && o.module.toLowerCase() !== file) continue;
      if (words.length && !words.every((w) => o.hay.includes(w))) continue;
      if (total >= off && out.length < limit) { const { hay, ...r } = o; out.push(r); }
      total++;
    }
    const r = { total, offset: off, objects: out };
    if (opts.entry) { // a text column of the same table that can name its rows (name, descr, label ...)
      const ent = this.nodes.get(String(opts.entry)); const kids = [...this.nodes.values()].filter((n) => n.kind === 'OBJECT-TYPE' && n.oid.length === String(opts.entry).split('.').length + 1 && n.oid.join('.').startsWith(opts.entry + '.'));
      kids.sort((a, b) => a.oid[a.oid.length - 1] - b.oid[b.oid.length - 1]); const TEXTNUM_RE = /(value|level|low|high|temp|volt|curr|power|speed|rate|count|percent|limit|thresh|load|freq|humid|batt|reading)/i; const nm = kids.find((n) => /(OCTET|DisplayString|SnmpAdminString)/i.test(String(n.syntax)) && /(name|descr|comment|label|location|id$)/i.test(n.name) && !TEXTNUM_RE.test(n.name)) || kids.find((n) => /(OCTET|DisplayString|SnmpAdminString)/i.test(String(n.syntax)));
      r.nameOid = nm ? nm.oid.join('.') : ''; if (r.nameOid) { r.objects = r.objects.filter((o) => o.oid !== r.nameOid); r.total = r.objects.length; } r.nameName = nm ? nm.name : ''; r.entryName = ent ? ent.name : '';
    }
    return r;
  }
  list() {       // the number of names still waiting for a MIB is counted once for all files (not once per file)
    const waiting = new Map(); for (const u of this.unresolved.values()) waiting.set(u.file, (waiting.get(u.file) || 0) + 1); this._waiting = waiting;
    try { return [...this.files.keys()].map((n) => this.fileInfo(n)); } finally { this._waiting = null; }
  }
  stats() { return { files: this.files.size, nodes: this.nodes.size, unresolved: this.unresolved.size, version: this.version }; }
}

function userErr(msg) { const e = new Error(msg); e.userFacing = true; e.status = 400; return e; }

/** Copies the standard MIBs shipped with the app (starter-mibs next to src) into the MIB folder, once.
 *  - a file is only offered once (names are remembered in .starter-offered), so a MIB the user removes stays removed;
 *  - nothing is ever overwritten, and a module that a file of the user already defines is skipped (no duplicates). */
function installStarterMibs(dir, srcDir = path.join(__dirname, '..', 'starter-mibs')) {
  const res = { copied: 0, skipped: 0 };
  let names; try { names = fs.readdirSync(srcDir).filter((n) => /\.mib$/i.test(n) && FILE_RE.test(n)); } catch { return res; }
  if (!names.length) return res;
  fs.mkdirSync(dir, { recursive: true });
  const markFile = path.join(dir, '.starter-offered');
  let offered = new Set(); try { offered = new Set(fs.readFileSync(markFile, 'utf8').split(/\r?\n/).filter(Boolean)); } catch { /* first run */ }
  const have = new Set(), modOf = (t) => { const m = /^\s*([A-Za-z][A-Za-z0-9-]*)\s+DEFINITIONS\b/m.exec(t); return m ? m[1] : ''; };
  for (const n of fs.readdirSync(dir)) { if (!FILE_RE.test(n)) continue; try { const st = fs.statSync(path.join(dir, n)); if (st.isFile() && st.size < MAX_FILE_BYTES) have.add(modOf(fs.readFileSync(path.join(dir, n), 'utf8').slice(0, 200000))); } catch { /* unreadable */ } }
  const fresh = [];
  for (const n of names.sort()) {
    if (offered.has(n)) continue; fresh.push(n);
    const dst = path.join(dir, n); if (fs.existsSync(dst)) { res.skipped++; continue; }
    try { const t = fs.readFileSync(path.join(srcDir, n), 'utf8'), mod = modOf(t); if (mod && have.has(mod)) { res.skipped++; continue; } fs.writeFileSync(dst, t); res.copied++; } catch { res.skipped++; }
  }
  if (fresh.length) { try { fs.appendFileSync(markFile, fresh.join('\n') + '\n'); } catch { /* read-only folder: tries again next start */ } }
  return res;
}

module.exports = { installStarterMibs, VENDORS, MibStore, parseMib, tokenize, FILE_RE, MAX_FILE_BYTES };
