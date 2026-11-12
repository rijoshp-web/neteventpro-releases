'use strict';
const test = require('node:test'); const assert = require('node:assert');

// ---- 1.30: SNMP trap columns ----
const { Replacer: R2 } = require('../src/replace');
const trapMsg = () => ({ source: 'snmp', host: '10.1.1.1', app: 'snmptrap', msgid: 'alertPowerSupplyFailure', message: 'IDRAC-MIB::alertPowerSupplyFailure (1.3.6.1.4.1.674.10892.5.3.2.1.0.2185): alertCurrentStatus.0 = critical(5), alertFQDD.0 = PSU.Slot.1, ifIndex.5 = 5',
  vb: { o: '1.3.6.1.4.1.674.10892.5.3.2.1.0.2185', n: 'alertPowerSupplyFailure', v: [['alertCurrentStatus.0', '1.3.6.1.4.1.674.10892.5.3.1.3.0', 'critical(5)'], ['alertFQDD.0', '1.3.6.1.4.1.674.10892.5.3.1.6.0', 'PSU.Slot.1'], ['ifIndex.5', '1.3.6.1.2.1.2.2.1.1.5', '5']] } });
test('a plain number is not replaced inside an OID', () => {
  const r = new R2(); r.load([{ find: '5', replace: 'FIVE', scope: 'message', on: 'snmp' }]); const m = trapMsg(); r.apply(m);
  assert.ok(m.message.includes('10892.5.3.2.1.0.2185'), m.message); assert.ok(m.message.includes('critical(FIVE)'));
});
const TR = require('../src/trapreplace'); const TC = require('../src/trapcols');
test('"only in trap value": the stored trap is not changed, the shown column is (old and new traps)', () => {
  const rules = TR.rulesFor([{ find: '5', replace: 'Critical', field: 'alertCurrentStatus', on: 'snmp' }]); const m = trapMsg();
  new R2().apply(m); assert.strictEqual(m.vb.v[0][2], 'critical(5)', 'not changed on arrival');
  const v = TR.fieldView(m, rules); assert.strictEqual(v.vb.v[0][2], 'critical(Critical)'); assert.strictEqual(v.vb.v[2][2], '5', 'the other 5 (ifIndex) is untouched'); assert.strictEqual(m.vb.v[0][2], 'critical(5)');
});
test('trap columns: replacement only in the chosen columns, also in the export', () => {
  TC.setReplacements([{ find: 'PSU', replace: 'Power supply', on: 'snmp', scope: 'trap', cols: ['Detail'] }, { find: 'alertPowerSupplyFailure', replace: 'PSU input lost', on: 'snmp', scope: 'trap' }]);
  const view = { std: false, cols: [{ label: 'Trap', field: '{trap}' }, { label: 'Detail', field: 'alertFQDD' }, { label: 'Other', field: 'alertFQDD' }] };
  const cols = TC.viewColumns(view), m = trapMsg(), get = (l) => cols.find((c) => c.label === l).get(m);
  assert.strictEqual(get('Detail'), 'Power supply.Slot.1'); assert.strictEqual(get('Other'), 'PSU.Slot.1', 'a column that was not chosen is unchanged');
  assert.strictEqual(get('Trap'), 'PSU input lost'); assert.strictEqual(m.vb.n, 'alertPowerSupplyFailure', 'the stored trap is unchanged');
  TC.setReplacements([]);
});
test('a rule with chosen columns does not change the message text on arrival; syslog-only and device-only rules are not used for traps', () => {
  const r = new R2(); r.load([{ find: 'critical', replace: 'CRIT', scope: 'message', on: 'snmp', cols: ['Status'] }]); const m = trapMsg(); r.apply(m); assert.ok(m.message.includes('critical(5)'));
  assert.strictEqual(TR.rulesFor([{ find: 'a', replace: 'b', on: 'syslog' }, { find: 'a', replace: 'b', scope: 'host' }, { find: 'a', replace: 'b', enabled: false }]).length, 0);
});
