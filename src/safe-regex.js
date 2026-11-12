'use strict';
// Guard for regular expressions typed in by the user (rules, text replacement).
// A pattern such as (a+)+$ can take minutes on a short line and would freeze the receiver, which handles every
// message on one thread. Patterns are therefore (1) length-limited, (2) rejected when they nest repetition, and
// (3) run against nasty test strings inside a throw-away context with a time limit, so a runaway pattern is
// interrupted at save time instead of in production. This is best-effort, not a proof: keep patterns simple.
const vm = require('node:vm');

const MAX_PATTERN = 300;
// Patterns only ever look at the first 2000 characters of a field. Even a harmless-looking pattern such as .*error can take
// time proportional to the square of the text length, so one 16 KB message from a hostile sender could otherwise cost
// hundreds of milliseconds. (Plain-text rules are not affected: they search the whole message.)
const MAX_REGEX_INPUT = 2000;
const NESTED_REPEAT = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)\s*(?:[+*]|\{\d)/;
const PROBE_MS = 60;

function probeInputs(src) {
  const chars = [...new Set(src.match(/[A-Za-z0-9]/g) || [])].slice(0, 6);
  const out = [];
  for (const c of chars.length ? chars : ['a']) out.push(c.repeat(32) + '!', c.repeat(4000) + '!');
  out.push(' '.repeat(4000) + '!', 'a1 '.repeat(1500) + '!', '1'.repeat(4000) + '!', 'ab'.repeat(2000) + '!');
  return out;
}

/** Returns an error text, or null when the pattern looks safe to run on every message. */
function checkRegexSource(src, flags = '') {
  if (!src) return 'the pattern is empty';
  if (src.length > MAX_PATTERN) return `the pattern is longer than ${MAX_PATTERN} characters`;
  const f = String(flags).replace(/[gy]/g, '');
  try { new RegExp(src, f); } catch (e) { return `invalid regular expression (${e.message})`; }
  if (NESTED_REPEAT.test(src)) return 'nested repetition such as (a+)+ is not allowed because it can freeze the receiver';
  const ctx = vm.createContext({ src, f, s: '' });
  const script = new vm.Script('new RegExp(src, f).test(s)');
  for (const s of probeInputs(src)) {
    ctx.s = s;
    try { script.runInContext(ctx, { timeout: PROBE_MS }); }
    catch (e) { if (e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return 'it takes far too long on some text and could freeze the receiver; use a simpler pattern'; }
  }
  return null;
}

module.exports = { checkRegexSource, MAX_PATTERN, MAX_REGEX_INPUT };
