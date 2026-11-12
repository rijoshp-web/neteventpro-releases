'use strict';
// Text replacement applied to every incoming message before rules and storage.
// Typical use: swap IP addresses for device names ("10.20.1.5" -> "Core-SW1") or expand cryptic codes.
//
// rule: { id, enabled, find, replace, regex, wholeWord, matchCase, scope }
//   scope: 'message' (message text), 'host' (device name column), 'trap' (SNMP: the trap name and every value shown in the trap columns, plus the message) or 'all' (message, device name and process)
//   cols: optional, SNMP only: the labels of the trap columns the rule changes (empty = every trap column). Applied when the columns are shown and exported, see trapreplace.js
//   field: optional, SNMP only: the rule changes only the value of this trap variable (a name such as alertCurrentStatus, a name with its index, or an OID prefix), e.g. 5 -> Critical
//   Plain-text rules match whole words only (an IPv4 address never matches inside a longer address),
//   unless wholeWord is false. Regex rules support $1, $2 ... in the replacement.
// The original packet is never changed: it stays available in the message detail panel and in raw logs.

const MAX_FIND = 300, MAX_REPLACE = 300;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isIPv4 = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);

const { checkRegexSource, MAX_REGEX_INPUT } = require('./safe-regex');   // best-effort guard against patterns that can freeze the receiver

function checkReplacement(r) {
  if (!r || typeof r.find !== 'string' || !r.find.length) return 'the "find" text is empty';
  if (r.find.length > MAX_FIND) return `the "find" text is longer than ${MAX_FIND} characters`;
  if (String(r.replace ?? '').length > MAX_REPLACE) return `the replacement is longer than ${MAX_REPLACE} characters`;
  if (r.scope && !['message', 'host', 'trap', 'all'].includes(r.scope)) return 'unknown "apply to" value';
  if (r.regex) return checkRegexSource(r.find, r.matchCase ? '' : 'i');
  return null;
}

function compile(r) {
  const flags = 'g' + (r.matchCase ? '' : 'i');
  let src;
  if (r.regex) src = r.find;
  else {
    const esc = escapeRe(r.find);
    if (isIPv4(r.find) || /^\d+$/.test(r.find)) src = `(?<![\\d.])${esc}(?!\\d|\\.\\d)`;      // an address or a plain number is never found inside a longer number or an OID such as 1.3.6.1.4.1.674.10892.5.3
    else if (r.wholeWord !== false) src = `(?<![A-Za-z0-9_])${esc}(?![A-Za-z0-9_])`;
    else src = esc;
  }
  return {
    re: new RegExp(src, flags), to: String(r.replace ?? ''), regex: !!r.regex, scope: r.scope || 'message', field: r.field ? String(r.field).trim().slice(0, 120).toLowerCase() : '', rawField: r.field ? String(r.field).trim().slice(0, 120) : '', on: ['syslog', 'snmp'].includes(r.on) ? r.on : 'both',
    cols: Array.isArray(r.cols) ? r.cols.map((x) => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 40) : [],
    needle: r.regex ? null : (r.matchCase ? r.find : r.find.toLowerCase()), matchCase: !!r.matchCase
  };
}

class Replacer {
  constructor() { this.items = []; }
  load(list) {
    this.items = [];
    for (const r of list || []) {
      if (!r || r.enabled === false || checkReplacement(r)) continue;
      try { this.items.push(compile(r)); } catch { /* skip broken rule */ }
    }
  }
  get size() { return this.items.length; }

  /** a rule limited to one trap variable: change that value (and the same "name = value" in the message text) */
  applyField(msg, it, kind) {
    if (kind !== 'snmp' || !msg.vb || !Array.isArray(msg.vb.v)) return;
    const f = it.field;
    for (const e of msg.vb.v) {
      const nl = String(e[0]).toLowerCase(), o = String(e[1]);
      if (!(nl === f || nl.startsWith(f + '.') || nl.split('.')[0] === f || o === it.rawField || o.startsWith(it.rawField + '.'))) continue;
      const old = String(e[2] ?? ''); if (!old) continue;
      const now = it.regex ? old.replace(it.re, it.to) : old.replace(it.re, () => it.to);
      if (now === old) continue;
      e[2] = now; if (msg.message) msg.message = msg.message.replace(`${e[0]} = ${old}`, () => `${e[0]} = ${now}`);
    }
  }

  /** Mutates msg.message / msg.host / msg.app. */
  apply(msg) {
    if (!this.items.length) return;
    let lowMsg = null, lowHost = null, lowApp = null;
    const kind = msg.source === 'snmp' ? 'snmp' : 'syslog';
    for (const it of this.items) {
      if (it.on !== 'both' && it.on !== kind) continue;
      if (it.field) continue;                                                      // "only in this trap value": done when the trap columns are shown (trapreplace.js), so old traps change too
      // SNMP: the trap columns are changed when they are shown (old and new traps, only the chosen columns); at arrival only the message text is changed, and not when columns were chosen
      const doMsg = (it.scope === 'message' || it.scope === 'trap' || it.scope === 'all') && !(kind === 'snmp' && it.cols.length);
      const doHost = it.scope === 'host' || it.scope === 'all';
      const doApp = it.scope === 'all';
      // pattern rules only read the first MAX_REGEX_INPUT characters (the rest is kept as it is); plain-text rules read everything
      const swap = (s) => {
        if (!it.regex) return s.replace(it.re, () => it.to);
        return s.length > MAX_REGEX_INPUT ? s.slice(0, MAX_REGEX_INPUT).replace(it.re, it.to) + s.slice(MAX_REGEX_INPUT) : s.replace(it.re, it.to);
      };
      if (doMsg && msg.message) {
        let hit = true;
        if (it.needle !== null) { if (it.matchCase) hit = msg.message.includes(it.needle); else { lowMsg ??= msg.message.toLowerCase(); hit = lowMsg.includes(it.needle); } }
        if (hit) { msg.message = swap(msg.message); lowMsg = null; }
      }
      if (doHost && msg.host) {
        let hit = true;
        if (it.needle !== null) { if (it.matchCase) hit = msg.host.includes(it.needle); else { lowHost ??= msg.host.toLowerCase(); hit = lowHost.includes(it.needle); } }
        if (hit) { msg.host = swap(msg.host); lowHost = null; }
      }
      if (doApp && msg.app) {
        let hit = true;
        if (it.needle !== null) { if (it.matchCase) hit = msg.app.includes(it.needle); else { lowApp ??= msg.app.toLowerCase(); hit = lowApp.includes(it.needle); } }
        if (hit) { msg.app = swap(msg.app); lowApp = null; }
      }
    }
  }
}

module.exports = { compile, Replacer, checkReplacement, checkRegexSource };
