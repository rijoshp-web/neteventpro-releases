'use strict';
// Builds the SQL WHERE clause for searches. Used by the database reader threads. Everything the user types is bound
// as a parameter (never pasted into the SQL), LIKE wildcards are escaped, and sizes are capped so a single request
// cannot make the database do unbounded work.

const SEV = require('./sev');
const COLS = 'id, ts, dev_ts AS devTs, src_ip AS srcIp, host, facility, severity, app, pid, msgid, message, tags, color, source, vb, seq';
const MAX_TERMS = 8, MAX_TERM_LEN = 200, MAX_HOSTS = 20;

const TAG_SQL = "(',' || tags || ',') LIKE ? ESCAPE '\\'";
const intOrNull = (v) => { if (v === undefined || v === null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null; };

/** "0,1,3" or [0,1,3] -> sorted unique list of severities 0-9, or null when none given */
function parseSevs(v) {
  if (v === undefined || v === null || v === '') return null;
  const a = (Array.isArray(v) ? v : String(v).split(',')).map((x) => (String(x).trim() === '' ? NaN : Number(x))).filter((n) => Number.isInteger(n) && n >= 0 && n <= 9);
  return a.length ? [...new Set(a)].sort() : null;
}

function buildWhere(q = {}) {
  const where = []; const args = [];
  const from = intOrNull(q.from), to = intOrNull(q.to), before = intOrNull(q.beforeId), sev = intOrNull(q.severityMax), sevMin = intOrNull(q.severityMin), fac = intOrNull(q.facility);
  if (from !== null) { where.push('ts >= ?'); args.push(from); }
  if (to !== null) { where.push('ts <= ?'); args.push(to); }
  if (before !== null) { where.push('id < ?'); args.push(before); }
  if (sev !== null && sev >= 0 && sev <= 9) { const l = SEV.upTo(sev); where.push(`severity IN (${l.join(',')})`); }          // "this severity or worse" follows the severity order, not the number
  if (sevMin !== null && sevMin >= 0 && sevMin <= 9) { const l = SEV.from(sevMin); where.push(`severity IN (${l.join(',')})`); }
  const sevs = parseSevs(q.sevs); if (sevs) { where.push(`severity IN (${sevs.map(() => '?').join(',')})`); args.push(...sevs); }
  if (fac !== null) { where.push('facility = ?'); args.push(fac); }
  if (q.source === 'syslog' || q.source === 'snmp') where.push(`source = '${q.source}'`);      // a fixed word (never user text), written into the SQL so the small trap index can be used
  if (q.trap) {          // SNMP trap name (exact) or numeric OID prefix; trap data is kept as {"o":"<trap oid>","n":"<name>",...}
    const t = String(q.trap).slice(0, 200);
    if (/^[\d.]+$/.test(t)) { const e = t.replace(/\.$/, ''); where.push("(vb LIKE ? ESCAPE '\\' OR vb LIKE ? ESCAPE '\\')"); args.push(`{"o":"${e}"%`, `{"o":"${e}.%`); }
    else { where.push('msgid = ? COLLATE NOCASE'); args.push(t); }
  }
  if (q.host) {
    const hosts = String(q.host).split(',').map((s) => s.trim().slice(0, 253)).filter(Boolean).slice(0, MAX_HOSTS);
    if (hosts.length) {
      where.push('(' + hosts.map(() => '(host = ? OR src_ip = ?)').join(' OR ') + ')');
      for (const h of hosts) args.push(h, h);
    }
  }
  if (q.app) { where.push("app LIKE ? ESCAPE '\\'"); args.push('%' + String(q.app).slice(0, MAX_TERM_LEN).replace(/[\\%_]/g, '\\$&') + '%'); }
  if (q.tag) { where.push(TAG_SQL); args.push('%,' + String(q.tag).slice(0, 64).replace(/[\\%_,]/g, '\\$&') + ',%'); }
  if (q.text) {
    // space separated terms are ANDed; a leading "-" excludes; "quoted phrases" stay together
    const terms = (String(q.text).slice(0, 1000).match(/"[^"]+"|\S+/g) || []).slice(0, MAX_TERMS);
    for (const raw of terms) {
      let term = raw; let neg = false;
      if (term.startsWith('-') && term.length > 1) { neg = true; term = term.slice(1); }
      term = term.replace(/^"|"$/g, '').slice(0, MAX_TERM_LEN);
      if (/^tag:./i.test(term)) {   // tag:link-down finds messages carrying that tag (-tag:x excludes)
        where.push(`${neg ? 'NOT ' : ''}${TAG_SQL}`); args.push('%,' + term.slice(4, 68).replace(/[\\%_,]/g, '\\$&') + ',%'); continue;
      }
      const like = '%' + term.replace(/[\\%_]/g, '\\$&') + '%';
      where.push(`${neg ? 'NOT ' : ''}(message LIKE ? ESCAPE '\\' OR host LIKE ? ESCAPE '\\' OR app LIKE ? ESCAPE '\\')`);
      args.push(like, like, like);
    }
  }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
}

const rowOut = (r) => ({ ...r, tags: r.tags ? String(r.tags).split(',') : [] });

module.exports = { COLS, buildWhere, rowOut, parseSevs };
