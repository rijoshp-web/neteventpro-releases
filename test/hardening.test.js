'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Replacer } = require('../src/replace');
const { RuleEngine } = require('../src/rules');
const { MAX_REGEX_INPUT } = require('../src/safe-regex');

const apply = (rules, msg) => { const r = new Replacer(); r.load(rules); const m = { host: '', app: '', message: '', ...msg }; r.apply(m); return m; };

test('regex replacement: a quadratic pattern on a 16 KB message stays cheap', () => {
  // ".*foo" is accepted by the pattern checker, but on 16 KB of text without "foo" it used to take ~200 ms per message,
  // enough for one hostile sender to slow the whole receiver to a crawl.
  const big = 'error on port '.repeat(1200).slice(0, 16384);
  const r = new Replacer(); r.load([{ find: '.*foo', replace: 'X', regex: true }]);   // (loading runs the pattern safety probes: not timed)
  r.apply({ host: '', app: '', message: big });
  const t = process.hrtime.bigint();
  for (let i = 0; i < 5; i++) r.apply({ host: '', app: '', message: big });
  const msEach = Number(process.hrtime.bigint() - t) / 1e6 / 5;
  assert.ok(msEach < 25, `took ${msEach.toFixed(1)} ms per message`);   // about 4 ms with the limit, about 200 ms without it
});

test('regex replacement: only the first part of a long message is searched, the rest is kept', () => {
  const head = 'a '.repeat(1100), tail = ' secret-7 ' + 'z'.repeat(5000);   // the secret starts after character 2000
  const rule = [{ find: 'secret-(\\d)', replace: 'S$1', regex: true }];
  assert.ok(head.length > MAX_REGEX_INPUT);
  assert.ok(apply(rule, { message: head + tail }).message === head + tail, 'text after the limit is not rewritten');
  assert.equal(apply(rule, { message: 'x'.repeat(1900) + ' secret-7' }).message, 'x'.repeat(1900) + ' S7', 'text before the limit is');
  assert.equal(apply([{ find: 'secret-(\\d)', replace: 'S$1', regex: true }], { message: 'x secret-7 y' }).message, 'x S7 y');
  assert.equal(MAX_REGEX_INPUT, 2000);
});

test('plain-text replacement still covers the whole message', () => {
  const m = 'q '.repeat(5000) + '10.1.1.1 end';
  assert.ok(apply([{ find: '10.1.1.1', replace: 'Core' }], { message: m }).message.endsWith('Core end'));
});

test('rules: a /regex/ condition reads the first 2000 characters, plain text reads everything', () => {
  const re = new RuleEngine();
  const msg = (text) => ({ severity: 6, facility: 1, host: 'h', srcIp: '1.1.1.1', app: '', message: 'x'.repeat(3000) + text, tags: [] });
  re.load([{ id: 'a', enabled: true, match: { text: '/needle/' }, actions: { tag: 'rx' } }, { id: 'b', enabled: true, match: { text: 'needle' }, actions: { tag: 'plain' } }]);
  const m = msg(' needle'); re.apply(m);
  assert.deepEqual(m.tags, ['plain']);
  const near = { severity: 6, facility: 1, host: 'h', srcIp: '1.1.1.1', app: '', message: 'a needle here', tags: [] }; re.apply(near);
  assert.deepEqual(near.tags, ['rx', 'plain']);
});
