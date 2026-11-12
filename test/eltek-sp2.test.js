'use strict';
// Eltek SP2 powerSystemTraps.16: alarmSubsysStatusOnOff on(1) raises, off(0) clears the same alarm (same alarm OID).
const test = require('node:test'); const assert = require('node:assert'); const { DatabaseSync } = require('node:sqlite');
const { AlarmStore } = require('../src/alarms'); const { RuleEngine } = require('../src/rules');
const RULE = { id: 'e1', name: 'Eltek SP2 power alarm', enabled: true, source: 'snmp', match: { trap: '/powerSystemTraps|1\\.3\\.6\\.1\\.4\\.1\\.12148\\./i', text: '/alarmSubsysStatusOnOff\\.\\d+\\s*=\\s*on/i' },
  actions: { alarm: true, alarmBy: '/alarmSubsysStatusOid\\.\\d+\\s*=\\s*([^,]+)/i', clearText: ['/alarmSubsysStatusOnOff\\.\\d+\\s*=\\s*off/i'], sevMap: [{ text: '/majorAlarm/i', severity: 3 }, { text: '/minorAlarm/i', severity: 8 }] } };
const txt = (oid, onoff, val = 'minorAlarm(2)') => `SP2-MIB::powerSystemTraps.16 (1.3.6.1.4.1.12148.10.1.2.16): alarmSubsysSourceDescr.0 = Recv.error, alarmSubsysStatusOid.0 = SP2-MIB::${oid}, alarmSubsysStatusValue.0 = ${val}, alarmSubsysStatusOnOff.0 = ${onoff}, alarmMeasuredVarValue.0 = 1`;
test('Eltek SP2 trap: on raises, off clears, other alarms stay', () => {
  const a = new AlarmStore({ db: new DatabaseSync(':memory:') }, { enqueue() {} }); a.stop(); const eng = new RuleEngine(); eng.load([RULE]); let t = Date.now() - 1e5;
  const send = (m) => { const msg = { ts: (t += 1000), host: 'SP2-1', srcIp: '10.0.0.5', devKey: 'SP2-1', severity: 5, facility: 16, message: m, source: 'snmp', msgid: 'powerSystemTraps.16', trapOid: '1.3.6.1.4.1.12148.10.1.2.16', tags: [] }; const o = eng.apply(msg); for (const c of o.clears) a.clearBy(c.id, msg, c.by, c.alarmBy); for (const r of o.alarms) a.raise(msg, r); return msg; };
  const m1 = send(txt('eNexus.18.3.1.0', 'on(1)')); assert.strictEqual(m1.severity, 8);
  send(txt('eNexus.18.3.2.0', 'on(1)', 'majorAlarm(3)'));
  assert.strictEqual(a.open.size, 2);
  send(txt('eNexus.18.3.1.0', 'off(0)'));
  assert.deepStrictEqual([...a.open.values()].map((r) => r.inst), ['senexus.18.3.2.0'.replace('senexus', 'sp2-mib::enexus')]);
});
