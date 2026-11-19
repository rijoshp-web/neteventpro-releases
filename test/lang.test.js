'use strict';
// 1.98.0: screen text lives in public/lang-en.js. Every key a page asks for must be there, every {value} it fills in must exist,
// and the user's own severity names reach e-mails, reports and exports.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
global.window = {};
require(path.join(root, 'public', 'lang-en.js'));
const LANG = global.window.NEP_LANG, T = global.window.T;

test('every text key used by the pages is in the language file', () => {
  const missing = [];
  for (const f of fs.readdirSync(path.join(root, 'public')).filter((x) => x.endsWith('.js') && x !== 'lang-en.js')) {
    const src = fs.readFileSync(path.join(root, 'public', f), 'utf8');
    for (const m of src.matchAll(/'((?:ops|setup|common)\.[a-z0-9.]+)'/g)) if (!(m[1] in LANG)) missing.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('T fills in values and leaves unknown keys visible', () => {
  assert.equal(T('setup.time.bad', { z: 'Mars/Base' }), '"Mars/Base" is not a time zone name. Pick one from the list, such as Europe/London.');
  assert.equal(T('no.such.key'), 'no.such.key');
  assert.match(T('setup.time.bad'), /^"\{z\}" is not/);
});

test('the Help page text is in the language file, one entry per section', () => {
  const help = global.window.NEP_HELP;
  assert.ok(Array.isArray(help) && help.length >= 20);
  for (const s of help) { assert.ok(s.id && s.title && s.html, 'section ' + s.id); assert.doesNotMatch(s.html, /\$\{/); }
  const ids = help.map((s) => s.id); assert.equal(new Set(ids).size, ids.length);
  assert.ok(!help.some((s) => /private key|npm run|release\.js keygen/i.test(s.html)), 'no build-PC instructions for customers');
});

test('own severity names and colours: cleaned, used by labels, reset when removed', () => {
  const SEVX = require('../src/sev');
  SEVX.configure({ sevNames: { 3: 'Major', 4: '  <b>Minor-ish</b>  ', 9: '' }, sevColors: { 3: '#7B2CBF', 5: 'red' } });
  assert.equal(SEVX.label(3), 'Major');
  assert.equal(SEVX.label(4), 'bMinor-ish/b');             // no markup characters
  assert.equal(SEVX.label(9), 'Cleared');                   // empty keeps the standard name
  assert.equal(SEVX.COLORS[3], '#7b2cbf'); assert.equal(SEVX.COLORS[5], SEVX.DEF_COLORS[5]);
  assert.equal(require('../src/mailtpl').SEV_NAMES[3], 'Major');          // e-mails see the same array
  SEVX.configure({});
  assert.equal(SEVX.label(3), 'Error'); assert.equal(SEVX.COLORS[3], SEVX.DEF_COLORS[3]);
  assert.equal(SEVX.NAMES[3], 'error');                     // the internal words never change
});
