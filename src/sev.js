'use strict';
// Severity scale. 0-7 are the syslog levels. 8 = Minor and 9 = Cleared were added for alarm-style traps; they are stored as 8 and 9
// but sit in the order Emergency, Alert, Critical, Error, Minor, Warning, Notice, Cleared, Info, Debug. Every "worse than" comparison
// goes through rank(), never through the raw number.
const NAMES = ['emergency', 'alert', 'critical', 'error', 'warning', 'notice', 'info', 'debug', 'minor', 'cleared'];
const ORDER = [0, 1, 2, 3, 8, 4, 5, 9, 6, 7];            // most serious first
const RANK = []; ORDER.forEach((id, i) => { RANK[id] = i; });
const rank = (s) => (RANK[s] ?? 99);
const upTo = (s) => ORDER.filter((id) => rank(id) <= rank(s)).sort((a, b) => a - b);      // this severity and every more serious one
const from = (s) => ORDER.filter((id) => rank(id) >= rank(s)).sort((a, b) => a - b);      // this severity and every less serious one
const syslogNum = (s) => (s === 8 ? 4 : s === 9 ? 5 : s);                                // what a plain syslog PRI can carry
const RANK_SQL = 'CASE severity WHEN 8 THEN 4 WHEN 4 THEN 5 WHEN 5 THEN 6 WHEN 9 THEN 7 WHEN 6 THEN 8 WHEN 7 THEN 9 ELSE severity END';
/** words traps use for their severity -> our severity (a value is read without its number and without spaces or dashes: "non-critical(4)" -> noncritical) */
const WORDS = { emergency: 0, alert: 1, critical: 2, fatal: 2, nonrecoverable: 1, major: 3, error: 3, high: 3, minor: 8, warning: 4, medium: 4, noncritical: 4, notice: 5, low: 5, normal: 5, ok: 5, cleared: 9, clear: 9, indeterminate: 5, info: 6, informational: 6, information: 6 };
const fromWord = (text) => { const m = /^([a-z][a-z \-_]*?)\s*(?:\(\s*-?\d+\s*\))?$/i.exec(String(text ?? '').trim()); const k = m && m[1].toLowerCase().replace(/[ \-_]+/g, ''); return k && WORDS[k] !== undefined ? WORDS[k] : null; };
module.exports = { WORDS, fromWord, NAMES, ORDER, RANK, rank, upTo, from, syslogNum, RANK_SQL, COUNT: 10 };
