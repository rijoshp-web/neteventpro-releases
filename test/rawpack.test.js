'use strict';
const test = require('node:test'); const assert = require('node:assert');
const { packRaw, rawText, rowOut } = require('../src/query');
test('the original packet is stored shorter and always comes back exactly', () => {
  const cases = [
    ['<189>Nov 18 12:00:00 core-sw-01 %LINK-3-UPDOWN: Interface Gi1/0/5, changed state to down', 'Interface Gi1/0/5, changed state to down'],
    ['<13>2026-11-18T12:00:00Z host app[12]: short', 'short'],                     // message too short: kept whole
    ['<13>host app: Uplink A went down', 'Gi0/1 went down'],                          // message changed by text replacement: kept whole
    ['SNMPv2c trap from 10.0.0.1 | trapOID 1.3.6.1.6.3.1.1.5.3', 'linkDown on ifIndex 3'],
    ['', ''], [null, 'x'], ['<13>x: same text here', '<13>x: same text here']
  ];
  for (const [raw, msg] of cases) {
    const stored = packRaw(raw, msg);
    assert.strictEqual(rawText(stored, msg), raw, JSON.stringify(raw));
    if (typeof raw === 'string' && typeof stored === 'string') assert.ok(stored.length <= raw.length + 1);
  }
  assert.ok(packRaw(cases[0][0], cases[0][1]).length < cases[0][0].length * 0.6);
  assert.strictEqual(rowOut({ id: 1, message: cases[0][1], raw: packRaw(cases[0][0], cases[0][1]), tags: '' }).raw, cases[0][0]);
});
