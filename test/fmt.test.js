'use strict';
const test = require('node:test'); const assert = require('node:assert');
const F = require('../src/fmt');
const T = Date.UTC(2026, 10, 18, 10, 5, 9);            // 2026-11-18 10:05:09 UTC

test('time zone, date order and clock format follow the settings', () => {
  F.configure({ ntp: { zone: 'Asia/Tokyo' }, format: { date: 'dmy', clock: '24' } });
  assert.strictEqual(F.dateTime(T), '18/11/2026 19:05:09');
  F.configure({ ntp: { zone: 'America/New_York' }, format: { date: 'mdy', clock: '12' } });
  assert.strictEqual(F.dateTime(T), '11/18/2026 5:05:09 AM');
  F.configure({ ntp: { zone: 'Europe/London' }, format: { date: 'ymd', clock: '24' } });
  assert.strictEqual(F.dateTime(T), '2026-11-18 10:05:09');
  assert.strictEqual(F.fileStamp(T), '20261118-1005');
  F.configure({ ntp: { zone: 'not/a-zone' }, format: { date: 'x', clock: 'y' } });
  assert.deepStrictEqual(F.settings(), { zone: '', date: 'ymd', clock: '24' });
});
test('calendar maths happens in the chosen zone, also across a daylight-saving change', () => {
  F.configure({ ntp: { zone: 'Asia/Dubai' } });
  assert.strictEqual(F.fromWall(Date.UTC(2026, 10, 18, 0, 0)), Date.UTC(2026, 10, 17, 20, 0));       // Dubai midnight = 20:00 UTC the day before
  F.configure({ ntp: { zone: 'Europe/London' } });
  assert.strictEqual(F.fromWall(Date.UTC(2026, 6, 1, 8, 0)), Date.UTC(2026, 6, 1, 7, 0));             // summer time: 08:00 London = 07:00 UTC
  assert.strictEqual(F.fromWall(Date.UTC(2026, 11, 1, 8, 0)), Date.UTC(2026, 11, 1, 8, 0));
  F.configure({});
});
