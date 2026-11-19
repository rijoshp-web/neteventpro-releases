'use strict';
// 1.99.1 a long pause is traced to the job that caused it
const test = require('node:test');
const assert = require('node:assert/strict');
const busy = require('../src/busy');
const block = (ms) => { const t = Date.now(); while (Date.now() - t < ms) { /* busy */ } };

test('a job that blocks is named, nested jobs show their path, short jobs are not noted', () => {
  const t0 = Date.now();
  busy.run('quick job', () => block(5));
  busy.run('saving messages to the database', () => block(320));
  busy.run('answering the web page (/api/x)', () => busy.run('scheduled reports', () => block(250)));
  const x = busy.explain(t0, Date.now());
  assert.match(x.cause, /^saving messages to the database \(\d+ ms\)$/);
  assert.match(x.hint, /antivirus/);
  assert.ok(x.jobs.some((j) => j.label === 'answering the web page (/api/x) → scheduled reports'));
  assert.ok(!x.jobs.some((j) => j.label === 'quick job'));
  assert.equal(busy.run('value', () => 42), 42, 'run passes the result through');
});

test('a pause with no tracked job says so, without a disk hint', () => {
  const now = Date.now() + 10000;
  const x = busy.explain(now, now + 1000);
  assert.match(x.cause, /not one of the tracked jobs/); assert.deepEqual(x.jobs, []);
});
