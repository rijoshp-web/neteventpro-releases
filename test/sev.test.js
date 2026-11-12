'use strict';
const test = require('node:test'); const assert = require('node:assert');
const S = require('../src/sev'); const { buildWhere } = require('../src/query'); const { valueSeverity } = require('../src/traps'); const { RuleEngine } = require('../src/rules');
test('Minor and Cleared sit between the syslog levels', () => {
  assert.deepStrictEqual(S.ORDER.map((i) => S.NAMES[i]), ['emergency', 'alert', 'critical', 'error', 'minor', 'warning', 'notice', 'cleared', 'info', 'debug']);
  assert.ok(S.rank(8) > S.rank(3) && S.rank(8) < S.rank(4) && S.rank(9) > S.rank(5) && S.rank(9) < S.rank(6));
  assert.deepStrictEqual(S.upTo(8), [0, 1, 2, 3, 8]); assert.deepStrictEqual(S.upTo(4), [0, 1, 2, 3, 4, 8]);
});
test('search by "this severity or worse" follows the order', () => {
  assert.ok(buildWhere({ severityMax: 4 }).sql.includes('severity IN (0,1,2,3,4,8)'));
  assert.ok(buildWhere({ sevs: '8,9' }).args.join() === '8,9');
});
test('traps carry minor and cleared by word', () => {
  assert.strictEqual(valueSeverity([['alarmSeverity', '1', 'minor(4)']], []), 8);
  assert.strictEqual(valueSeverity([['alarmSeverity', '1', 'cleared(1)']], []), 9);
  assert.strictEqual(valueSeverity([['status', '1', '4']], [{ field: 'status', map: [{ value: '4', severity: 8 }, { value: '3', severity: 9 }] }]), 8);
});
test('rules: severity or worse uses the order, and a rule can set minor / cleared', () => {
  const re = new RuleEngine(); re.load([{ id: 'a', enabled: true, match: { severityMax: 4 }, actions: { tag: 'bad' } }, { id: 'b', enabled: true, match: { severities: [9] }, actions: { tag: 'c' } }]);
  const mk = (severity) => ({ host: 'h', app: '', message: 'x', srcIp: '1', severity, severityName: S.NAMES[severity], tags: [], source: 'syslog' });
  const tags = (sv) => { const m = mk(sv); re.apply?.(m); return m.tags; };
  assert.ok(tags(8).includes('bad')); assert.ok(!tags(5).includes('bad')); assert.ok(tags(9).includes('c'));
});
test('a trap view can name its severity column: the trap takes its severity from that column after the lookup', () => {
  const { severityOf } = require('../src/trapcols');
  const views = [{ id: 'v', match: '', cols: [{ label: 'Sev', field: 'st', sev: true, map: '5=Critical; 4=Minor; 3=Cleared\n@ 1.3.6.1.4.1.12148: 5=Cleared' }] }];
  const m = (oid, val) => ({ vb: JSON.stringify({ o: oid, n: 't', v: [['st', '1.1', val]] }), message: '', ts: 1, severity: 5 });
  assert.strictEqual(severityOf(views, '', m('1.3.6.1.4.1.674.1', '5')), 2);
  assert.strictEqual(severityOf(views, '', m('1.3.6.1.4.1.674.1', '4')), 8);
  assert.strictEqual(severityOf(views, '', m('1.3.6.1.4.1.12148.9', '5')), 9);
  assert.strictEqual(severityOf(views, '', m('1.3.6.1.4.1.674.1', '9')), null);
  assert.strictEqual(severityOf([{ id: 'v', cols: [{ field: 'st' }] }], '', m('1', '5')), null);
});
