'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, StreamFramer } = require('../src/parser');

const NOW = new Date('2026-10-24T08:00:00Z');

test('RFC 5424 with structured data', () => {
  const m = parse('<165>1 2026-10-24T07:59:00.003Z core-sw1 ospfd 4312 ID47 [exampleSDID@32473 iut="3" eventSource="Application"] Adjacency lost', '10.0.0.1', NOW);
  assert.equal(m.format, 'rfc5424');
  assert.equal(m.facility, 20); assert.equal(m.severity, 5);
  assert.equal(m.host, 'core-sw1'); assert.equal(m.app, 'ospfd'); assert.equal(m.pid, '4312'); assert.equal(m.msgid, 'ID47');
  assert.equal(m.sd.exampleSDID_32473 ?? m.sd['exampleSDID@32473'].iut, m.sd['exampleSDID@32473'].iut);
  assert.equal(m.sd['exampleSDID@32473'].iut, '3');
  assert.equal(m.message, 'Adjacency lost');
});

test('RFC 5424 nil values fall back to source IP', () => {
  const m = parse('<14>1 - - - - - - hello', '10.1.1.1', NOW);
  assert.equal(m.host, '10.1.1.1'); assert.equal(m.message, 'hello'); assert.equal(m.devTs, null);
});

test('RFC 3164 classic', () => {
  const m = parse("<34>Oct 11 22:14:15 mymachine su[123]: 'su root' failed on /dev/pts/8", '10.0.0.2', NOW);
  assert.equal(m.format, 'rfc3164');
  assert.equal(m.facility, 4); assert.equal(m.severity, 2); assert.equal(m.severityName, 'critical');
  assert.equal(m.host, 'mymachine'); assert.equal(m.app, 'su'); assert.equal(m.pid, '123');
  assert.match(m.message, /^'su root' failed/);
});

test('RFC 3164 without hostname keeps source IP', () => {
  const m = parse('<13>Oct 24 07:00:00 sshd[55]: Accepted publickey for root', '192.168.1.5', NOW);
  assert.equal(m.host, '192.168.1.5'); assert.equal(m.app, 'sshd');
});

test('Cisco IOS style message', () => {
  const m = parse('<189>1234: Oct 24 07:01:02: %LINEPROTO-5-UPDOWN: Line protocol on Interface Gi0/1, changed state to down', '10.9.9.9', NOW);
  assert.equal(m.severity, 5);
  assert.equal(m.mnemonic, '%LINEPROTO-5-UPDOWN');
});

test('no PRI at all still parses (APC / odd devices)', () => {
  const m = parse('UPS: On battery power', '10.5.5.5', NOW);
  assert.equal(m.severity, 5); assert.equal(m.host, '10.5.5.5'); assert.equal(m.message, 'UPS: On battery power');
});

test('invalid PRI is treated as text', () => {
  const m = parse('<999>garbage', '1.1.1.1', NOW);
  assert.equal(m.message, '<999>garbage');
});

test('TCP framer: newline and octet counting', () => {
  const frames = [];
  const f = new StreamFramer((b) => frames.push(b.toString()));
  f.push(Buffer.from('<14>one\n<14>tw'));
  f.push(Buffer.from('o\n'));
  const body = '<14>counted message with\nnewline';
  f.push(Buffer.from(`${body.length} ${body}`));
  f.push(Buffer.from('<14>last\r\n'));
  assert.deepEqual(frames, ['<14>one', '<14>two', body, '<14>last\r']);
});
