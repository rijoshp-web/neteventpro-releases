'use strict';
// 1.99.1 What kept the service busy? Node runs the receiving, the saving, the rules and the web pages on one thread, so a single
// slow job (a database write held up by a slow disk or antivirus, a big delete, a report) holds everything else up. Each
// regular job is run through run(label, fn); any job that blocks for 200 ms or more is noted with its name, as is a long memory
// clean-up. System health then says which job was running when the service paused, instead of only how long the pause was.
const { performance, PerformanceObserver } = require('node:perf_hooks');

const MIN_MS = 200;
const recent = [];          // { label, ms, at } at = when the job ended (Date.now())
let cur = '';

function note(label, ms) { recent.push({ label, ms: Math.round(ms), at: Date.now() }); if (recent.length > 300) recent.splice(0, recent.length - 300); }

/** run fn as the named job (only the part before its first await blocks the thread, and only that part is measured) */
function run(label, fn) {
  const prev = cur; cur = prev ? `${prev} → ${label}` : label; const name = cur, t0 = performance.now();
  try { return fn(); } finally { const ms = performance.now() - t0; cur = prev; if (ms >= MIN_MS) note(name, ms); }
}
/** for a step inside a long loop: const t0 = performance.now(); ...; done(label, t0) */
function done(label, t0) { const ms = performance.now() - t0; if (ms >= MIN_MS) note(cur ? `${cur} → ${label}` : label, ms); }

try {
  new PerformanceObserver((list) => { for (const e of list.getEntries()) if (e.duration >= MIN_MS) note('memory clean-up (garbage collection)', e.duration); }).observe({ entryTypes: ['gc'] });
} catch { /* not available */ }

/** the jobs that ended between from and to (ms timestamps), longest first */
function between(from, to) { return recent.filter((r) => r.at >= from && r.at <= to + 100).sort((a, b) => b.ms - a.ms); }

/** plain-words cause of a pause from prevTick to now, and a hint when the job is a known slow-disk symptom */
function explain(from, to) {
  const jobs = between(from, to); if (!jobs.length) return { cause: 'not one of the tracked jobs (often the computer itself: short of memory, a busy disk or another program using the processor)', jobs: [] };
  const top = jobs[0], disk = /saving messages|database|deleting|word index|summaries|devices to the database/.test(top.label);
  return { cause: `${top.label} (${top.ms} ms)`, hint: disk ? 'Database work was slow. On Windows this is most often antivirus scanning the database while it is written: add the NetEventPro data folder (C:\\ProgramData\\NetEventPro) to the antivirus exclusions, or check that the disk is not full or failing.' : '', jobs: jobs.slice(0, 5) };
}

module.exports = { run, done, between, explain, _recent: recent };
