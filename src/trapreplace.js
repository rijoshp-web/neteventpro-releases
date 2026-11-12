'use strict';
// Text replacement for the trap columns, applied when a trap is SHOWN or EXPORTED (not when it arrives), so traps that are already stored change too
// and the choice of columns can be changed at any time. The stored trap is never changed. Keep this in step with trapRep* in public/app.js.
//   a rule applies when its "Messages" choice includes SNMP and its scope is not "Device name" only
//   rule.field: only the value of that trap variable (changed before the columns are built)
//   rule.cols : labels of the trap view columns to change (empty = all columns). A column made of {message} is skipped: the message text is changed on arrival.
const { compile } = require('./replace');

function rulesFor(list) {
  const out = [];
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || r.enabled === false || !r.find || r.on === 'syslog' || r.scope === 'host') continue;
    try { const c = compile(r); c.on = r.on || 'both'; out.push(c); } catch { /* broken rule */ }
  }
  return out;
}
const swap = (it, s) => (it.regex ? s.replace(it.re, it.to) : s.replace(it.re, () => it.to));

/** the trap with its variable values changed by the "only in this trap value" rules (a copy; the stored trap stays as it is) */
function fieldView(m, rules) {
  const fr = rules.filter((x) => x.field); if (!fr.length || !m.vb || !Array.isArray(m.vb.v)) return m;
  let changed = false;
  const v = m.vb.v.map((e) => {
    let val = String(e[2] ?? ''); if (!val) return e;
    const nl = String(e[0]).toLowerCase(), o = String(e[1]);
    for (const it of fr) { if (nl === it.field || nl.startsWith(it.field + '.') || nl.split('.')[0] === it.field || o === it.rawField || o.startsWith(it.rawField + '.')) val = swap(it, val); }
    if (val === String(e[2] ?? '')) return e; changed = true; return [e[0], e[1], val, ...e.slice(3)];
  });
  return changed ? { ...m, vb: { ...m.vb, v } } : m;
}

/** the text of one trap column after the replacements that are meant for that column */
function colText(text, label, field, rules) {
  if (!text || !rules.length || /\{message\}/i.test(field || '')) return text;
  const lab = String(label || '').trim().toLowerCase(); let t = String(text);
  for (const it of rules) { if (it.field) continue; if (it.cols.length && !it.cols.includes(lab)) continue; t = swap(it, t); }
  return t;
}
module.exports = { rulesFor, fieldView, colText };
