'use strict';
const test = require('node:test'); const assert = require('node:assert');
const { applyMap } = require('../src/trapcols');
const m = { trapOid: '1.3.6.1.4.1.12148.1.2', msgid: 'x', message: '' };
test('several values in one lookup entry', () => {
  const map = '@ 1.3.6.1.4.1.12148: 0,2,3,8=Critical; 1=Cleared; 4-6=Major\n5=Other';
  for (const v of ['0', '2', '3', '8']) assert.equal(applyMap(v, map, m), 'Critical', v);
  assert.equal(applyMap('1', map, m), 'Cleared');
  for (const v of ['4', '5', '6']) assert.equal(applyMap(v, map, m), 'Major', v);
  assert.equal(applyMap('7', map, m), '7');
  assert.equal(applyMap('critical(3)', 'critical|major=High', m), 'High');
  assert.equal(applyMap('3', '3=Single; 2,3=Pair', m), 'Single', 'an explicit entry wins over a list');
});
