'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { decodeMessage, buildV1, buildV2, buildInformReply, BerError } = require('../src/ber');
const { MibStore, parseMib } = require('../src/mib');
const { trapToMessage, severityFor } = require('../src/traps');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mibs-'));
const SNMP = { defaultSeverity: 5, severityRules: [] };

const APC_LIKE = `
POWERNET-TEST-MIB DEFINITIONS ::= BEGIN
IMPORTS
    enterprises, OBJECT-TYPE, NOTIFICATION-TYPE   FROM SNMPv2-SMI   -- comment here
    DisplayString FROM SNMPv2-TC;
apc OBJECT IDENTIFIER ::= { enterprises 318 }
upsMib OBJECT IDENTIFIER ::= { apc 1 }   -- group
UpsState ::= TEXTUAL-CONVENTION
    STATUS current
    DESCRIPTION "State -- not a comment ::= { }"
    SYNTAX INTEGER { normal(1), onBattery(2), lowBattery(3) }
upsBasicState OBJECT-TYPE
    SYNTAX UpsState
    MAX-ACCESS read-only
    STATUS current
    DESCRIPTION "The state."
    ::= { upsMib 4 }
upsBatteryTemp OBJECT-TYPE
    SYNTAX INTEGER { ok(0), hot(-1) }
    MAX-ACCESS read-only
    STATUS current
    DESCRIPTION "x"
    ::= { upsMib 5 }
upsOnBattery NOTIFICATION-TYPE
    OBJECTS { upsBasicState, upsBatteryTemp }
    STATUS current
    DESCRIPTION "On battery."
    ::= { upsMib 0 2 }
END
`;
const V1_MIB = `
OLD-MIB DEFINITIONS ::= BEGIN
IMPORTS enterprises FROM RFC1155-SMI  TRAP-TYPE FROM RFC-1215;
eltek OBJECT IDENTIFIER ::= { enterprises 12148 }
mainsFailure TRAP-TYPE
    ENTERPRISE eltek
    VARIABLES { sysName }
    DESCRIPTION "mains"
    ::= 7
END
`;

test('decodes a v2c trap that was built by the encoder', () => {
  const pkt = buildV2({ community: 'public', trapOid: '1.3.6.1.6.3.1.1.5.3', uptime: 12345, varbinds: [
    { oid: '1.3.6.1.2.1.2.2.1.1.3', type: 'integer', value: 3 }, { oid: '1.3.6.1.2.1.2.2.1.2.3', type: 'octets', value: 'GigabitEthernet0/1' },
    { oid: '1.3.6.1.2.1.2.2.1.8.3', type: 'integer', value: 2 }, { oid: '1.3.6.1.4.1.9.9.1.0', type: 'counter64', value: 2n ** 40n }] });
  const t = decodeMessage(pkt);
  assert.equal(t.version, 2); assert.equal(t.kind, 'trap2'); assert.equal(t.community, 'public'); assert.equal(t.varbinds.length, 6);
  assert.deepEqual(t.varbinds[1].value, [1, 3, 6, 1, 6, 3, 1, 1, 5, 3]);
  assert.equal(t.varbinds[5].value, 2 ** 40);
});

test('decodes a v1 trap and numbers (negative, large, long lengths)', () => {
  const big = 'x'.repeat(300);
  const t = decodeMessage(buildV1({ community: 'c', enterprise: '1.3.6.1.4.1.318', agentAddr: '10.1.2.3', generic: 6, specific: 5, uptime: 99, varbinds: [
    { oid: '1.3.6.1.4.1.318.1.1', type: 'integer', value: -129 }, { oid: '1.3.6.1.4.1.318.1.2', type: 'octets', value: big }, { oid: '1.3.6.1.4.1.318.1.3', type: 'oid', value: '1.3.6.1.4.1.318.999999' }] }));
  assert.equal(t.version, 1); assert.equal(t.agentAddr, '10.1.2.3'); assert.equal(t.specific, 5);
  assert.equal(t.varbinds[0].value, -129); assert.equal(t.varbinds[1].value.length, 300); assert.deepEqual(t.varbinds[2].value.slice(-1), [999999]);
});

test('an inform is answered with the same request id and variables', () => {
  const t = decodeMessage(buildV2({ community: 'pub', trapOid: '1.3.6.1.4.1.1.0.1', inform: true, requestId: 777, varbinds: [] }));
  assert.equal(t.kind, 'inform');
  const r = Buffer.from(buildInformReply(t)); assert.equal(r.includes(Buffer.from([0xa2])), true);
  assert.equal(r.includes(t.varbindBytes), true);
});

test('SNMPv3 is recognised but not decoded; garbage never crashes the decoder', () => {
  const v3 = Buffer.from([0x30, 0x0c, 0x02, 0x01, 0x03, 0x30, 0x04, 0x02, 0x02, 0x00, 0x01, 0x04, 0x00, 0x00]);
  assert.equal(decodeMessage(v3).version, 3);
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const good = buildV2({ community: 'public', trapOid: '1.3.6.1.6.3.1.1.5.4', varbinds: [{ oid: '1.3.6.1.2.1.1.5.0', type: 'octets', value: 'abc' }] });
  for (let i = 0; i < 5000; i++) {
    const b = Buffer.from(good); const n = 1 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
    const cut = rnd() < 0.3 ? b.subarray(0, Math.floor(rnd() * b.length)) : b;
    try { decodeMessage(cut); } catch (e) { assert.ok(e instanceof BerError, 'only BerError may escape: ' + e); }
  }
});

test('MIB parser: SMIv2 objects, textual-convention values, notifications with 0 in the path', () => {
  const d = tmp(); const m = new MibStore(d);
  const info = m.add('apc.mib', APC_LIKE);
  assert.equal(info.unresolved, 0); assert.deepEqual(info.missing, []);
  assert.equal(m.exact([1, 3, 6, 1, 4, 1, 318, 1, 2]), null);            // numbered 1.0.2 is the trap, 1.2 does not exist
  assert.equal(m.lookup('upsOnBattery').oid, '1.3.6.1.4.1.318.1.0.2');
  assert.equal(m.lookup('1.3.6.1.4.1.318.1.4.0').name, 'POWERNET-TEST-MIB::upsBasicState.0');
  assert.equal(m.lookup('upsBasicState').enums.get(2), 'onBattery');
  assert.equal(m.lookup('upsBatteryTemp').enums.get(-1), 'hot');
});

test('MIB parser: SMIv1 TRAP-TYPE becomes enterprise.0.n', () => {
  const m = new MibStore(tmp()); m.add('old.mib', V1_MIB);
  assert.equal(m.lookup('mainsFailure').oid, '1.3.6.1.4.1.12148.0.7');
});

test('a MIB can be uploaded before the MIB it depends on; it resolves when the other arrives', () => {
  const m = new MibStore(tmp());
  const child = `CHILD-MIB DEFINITIONS ::= BEGIN IMPORTS vendor FROM PARENT-MIB; thing OBJECT IDENTIFIER ::= { vendor 5 } END`;
  const parent = `PARENT-MIB DEFINITIONS ::= BEGIN vendor OBJECT IDENTIFIER ::= { enterprises 4242 } END`;
  let i = m.add('child.mib', child); assert.equal(i.unresolved, 1); assert.deepEqual(i.missing, ['PARENT-MIB']);
  m.add('parent.mib', parent);
  assert.equal(m.fileInfo('child.mib').unresolved, 0); assert.equal(m.lookup('thing').oid, '1.3.6.1.4.1.4242.5');
});

test('uploaded MIBs survive a restart; delete removes them; bad files are refused', () => {
  const d = tmp(); let m = new MibStore(d); m.add('apc.mib', APC_LIKE);
  m = new MibStore(d); assert.equal(m.lookup('upsOnBattery').oid, '1.3.6.1.4.1.318.1.0.2');
  assert.equal(m.remove('apc.mib'), true); assert.equal(m.lookup('upsOnBattery'), null);
  for (const [n, t] of [['../x.mib', APC_LIKE], ['a.mib', ''], ['a.mib', 'hello world'], ['a.mib', 'X DEFINITIONS ::= BEGIN END'], ['a.mib', 'bin\u0000ary DEFINITIONS BEGIN']]) assert.throws(() => m.add(n, t));
  assert.equal(fs.readdirSync(d).length, 0);
});

test('the tokenizer survives hostile text', () => {
  for (const t of ['"unterminated', '{{{{{{', '::= ::= ::=', 'a OBJECT-TYPE '.repeat(1000), 'x DEFINITIONS ::= BEGIN IMPORTS a, b, c', 'a MACRO ::= BEGIN', 'T ::= TEXTUAL-CONVENTION']) parseMib(t);
});

test('linkDown trap becomes a readable message with tags and enum names', () => {
  const m = new MibStore(tmp());
  const t = decodeMessage(buildV2({ community: 'public', trapOid: '1.3.6.1.6.3.1.1.5.3', uptime: 8640000, varbinds: [
    { oid: '1.3.6.1.2.1.2.2.1.1.3', type: 'integer', value: 3 }, { oid: '1.3.6.1.2.1.2.2.1.2.3', type: 'octets', value: 'GigabitEthernet0/1' },
    { oid: '1.3.6.1.2.1.2.2.1.7.3', type: 'integer', value: 1 }, { oid: '1.3.6.1.2.1.2.2.1.8.3', type: 'integer', value: 2 }] }));
  const r = trapToMessage(t, '10.1.1.1', m, SNMP);
  assert.match(r.msg.message, /^IF-MIB::linkDown \(1\.3\.6\.1\.6\.3\.1\.1\.5\.3\): ifIndex\.3 = 3, ifDescr\.3 = GigabitEthernet0\/1, ifAdminStatus\.3 = up\(1\), ifOperStatus\.3 = down\(2\)$/);
  assert.equal(r.msg.severity, 3); assert.equal(r.msg.app, 'snmptrap'); assert.equal(r.msg.msgid, 'linkDown');
  assert.deepEqual(r.msg.tags, ['snmp', 'trap:linkDown', 'link-down', 'if:Gi0/1']);
  assert.match(r.msg.raw, /trapOID 1\.3\.6\.1\.6\.3\.1\.1\.5\.3 \| uptime 8640000 \| 1\.3\.6\.1\.2\.1\.2\.2\.1\.1\.3 = 3/);
  assert.equal(r.unresolved.length, 0); assert.ok(!/public/.test(r.msg.raw + r.msg.message), 'the community string must not be stored');
});

test('unknown vendor trap stays numeric and is reported as a missing MIB; uploading the MIB resolves it', () => {
  const m = new MibStore(tmp());
  const pkt = buildV2({ community: 'public', trapOid: '1.3.6.1.4.1.318.1.0.2', varbinds: [{ oid: '1.3.6.1.4.1.318.1.4.0', type: 'integer', value: 2 }] });
  let r = trapToMessage(decodeMessage(pkt), '10.2.2.2', m, SNMP);
  assert.match(r.msg.message, /^Unknown trap 1\.3\.6\.1\.4\.1\.318\.1\.0\.2: 1\.3\.6\.1\.4\.1\.318\.1\.4\.0 = 2$/); assert.deepEqual(r.unresolved, ['1.3.6.1.4.1.318']);
  m.add('apc.mib', APC_LIKE);
  r = trapToMessage(decodeMessage(pkt), '10.2.2.2', m, SNMP);
  assert.equal(r.msg.message, 'POWERNET-TEST-MIB::upsOnBattery (1.3.6.1.4.1.318.1.0.2): upsBasicState.0 = onBattery(2)'); assert.equal(r.unresolved.length, 0);
  assert.ok(r.msg.tags.includes('trap:upsOnBattery'));
});

test('v1 traps: generic traps map to snmpTraps, enterprise-specific to enterprise.0.n; agent address shown when it differs', () => {
  const m = new MibStore(tmp()); m.add('old.mib', V1_MIB);
  let r = trapToMessage(decodeMessage(buildV1({ enterprise: '1.3.6.1.4.1.12148', agentAddr: '10.9.9.9', generic: 6, specific: 7, uptime: 1, varbinds: [{ oid: '1.3.6.1.2.1.1.5.0', type: 'octets', value: 'PLANT-1' }] })), '10.0.0.5', m, SNMP);
  assert.equal(r.msg.message, 'OLD-MIB::mainsFailure (1.3.6.1.4.1.12148.0.7): sysName.0 = PLANT-1 [agent 10.9.9.9]'); assert.equal(r.msg.severity, 3);
  r = trapToMessage(decodeMessage(buildV1({ enterprise: '1.3.6.1.4.1.8072', agentAddr: '10.0.0.5', generic: 0, specific: 0, uptime: 1 })), '10.0.0.5', m, SNMP);
  assert.match(r.msg.message, /^SNMPv2-MIB::coldStart/);
  r = trapToMessage(decodeMessage(buildV1({ enterprise: '1.3.6.1.4.1.8072', agentAddr: '10.0.0.5', generic: 2, specific: 0, uptime: 1, varbinds: [{ oid: '1.3.6.1.2.1.2.2.1.1.9', type: 'integer', value: 9 }] })), '10.0.0.5', m, SNMP);
  assert.deepEqual(r.msg.tags.slice(0, 3), ['snmp', 'trap:linkDown', 'link-down']);
});

test('severity: your rules first, standard traps, then wording of the trap name', () => {
  assert.equal(severityFor('linkDown', '1.3.6.1.6.3.1.1.5.3', SNMP), 3);
  assert.equal(severityFor('upsPowerRestored', '1.2', SNMP), 5);
  assert.equal(severityFor('fanFailure', '1.2', SNMP), 3);
  assert.equal(severityFor('tempThresholdExceeded', '1.2', SNMP), 4);
  assert.equal(severityFor('somethingElse', '1.2', { defaultSeverity: 6, severityRules: [] }), 6);
  assert.equal(severityFor('fanFailure', '1.2', { severityRules: [{ match: 'FANFAILURE', severity: 1 }] }), 1);
  assert.equal(severityFor('x', '1.3.6.1.4.1.318.0.5', { severityRules: [{ match: '1.3.6.1.4.1.318', severity: 2 }] }), 2);
});

test('values: text, MAC, hex, ticks, IP, OID', () => {
  const m = new MibStore(tmp());
  const t = decodeMessage(buildV2({ community: 'p', trapOid: '1.3.6.1.4.1.9.0.1', varbinds: [
    { oid: '1.3.6.1.4.1.9.1', type: 'octets', value: Buffer.from([1, 2, 3, 4, 5, 6]) }, { oid: '1.3.6.1.4.1.9.2', type: 'octets', value: Buffer.from([0xde, 0xad]) },
    { oid: '1.3.6.1.4.1.9.3', type: 'timeticks', value: 8640000 + 360000 + 6000 + 100 }, { oid: '1.3.6.1.4.1.9.4', type: 'ipaddress', value: '10.0.0.1' }, { oid: '1.3.6.1.4.1.9.5', type: 'oid', value: '1.3.6.1.6.3.1.1.5.4' }] }));
  const msg = trapToMessage(t, '1.1.1.1', m, SNMP).msg.message;
  assert.match(msg, /9\.1 = 01:02:03:04:05:06/); assert.match(msg, /9\.2 = 0xdead/); assert.match(msg, /9\.3 = 1d 01:01:01/); assert.match(msg, /9\.4 = 10\.0\.0\.1/); assert.match(msg, /9\.5 = IF-MIB::linkUp/);
});

test('severity from a value inside the trap: Dell iDRAC "5" and Connection Master "major(3)" end up in the same Severity column', () => {
  const m = new MibStore(tmp());   // no vendor MIB: names are numbers, so the rules use the number form of the value name
  const rules = { defaultSeverity: 6, severityRules: [], valueSeverity: [
    { field: '1.3.6.1.4.1.674.10892.5.3.2.1.1.3', map: [{ value: '5', severity: 2 }, { value: '4', severity: 4 }, { value: '3', severity: 6 }] },
    { field: 'alarmSeverity', map: [{ value: 'critical', severity: 2 }, { value: 'major', severity: 3 }, { value: 'minor', severity: 4 }, { value: 'cleared', severity: 5 }] }] };
  const idrac = (v) => buildV2({ community: 'public', trapOid: '1.3.6.1.4.1.674.10892.5.3.2.1.0.2473', uptime: 1, varbinds: [{ oid: '1.3.6.1.4.1.674.10892.5.3.2.1.1.2.0', type: 'octets', value: 'Power supply redundancy is lost.' }, { oid: '1.3.6.1.4.1.674.10892.5.3.2.1.1.3.0', type: 'integer', value: v }] });
  const sevOf = (pkt) => trapToMessage(decodeMessage(pkt), '10.0.0.5', m, rules).msg.severity;
  assert.strictEqual(sevOf(idrac(5)), 2); assert.strictEqual(sevOf(idrac(4)), 4); assert.strictEqual(sevOf(idrac(3)), 6); assert.strictEqual(sevOf(idrac(9)), 6, 'a value nobody mapped keeps the normal rules');
  // a value written as "major(3)" matches by word or by number
  const { valueSeverity } = require('../src/traps');
  assert.strictEqual(valueSeverity([['alarmSeverity', '1.2.3', 'major(3)']], rules.valueSeverity), 3);
  assert.strictEqual(valueSeverity([['alarmSeverity', '1.2.3', 'major(3)']], [{ field: 'alarmSeverity', map: [{ value: '3', severity: 1 }] }]), 1);
  assert.strictEqual(valueSeverity([['alertGroup.1.3.0', '1.2.3', '5']], [{ field: 'alertGroup.1.3', map: [{ value: '5', severity: 2 }] }]), 2);
  assert.strictEqual(valueSeverity([['alertGroup.1.30.0', '1.2.3', '5']], [{ field: 'alertGroup.1.3', map: [{ value: '5', severity: 2 }] }]), null, 'alertGroup.1.3 is not alertGroup.1.30');
});

test('severity words inside any trap are understood without a single setting', () => {
  const { valueSeverity } = require('../src/traps');
  assert.strictEqual(valueSeverity([['alarmSeverity', '1', 'major(3)']], []), 3);
  assert.strictEqual(valueSeverity([['x', '1', 'a'], ['perceivedSeverity.4', '1', 'critical']], undefined), 2);
  assert.strictEqual(valueSeverity([['alertSeverity', '1', 'Non-Critical']], []), 4);
  assert.strictEqual(valueSeverity([['alertGroup.1.3.0', '1', '5']], []), null, 'a bare number is not guessed');
  assert.strictEqual(valueSeverity([['severityText', '1', 'major']], []), null, 'text fields are not severities');
  assert.strictEqual(valueSeverity([['alarmSeverity', '1', 'major(3)']], [{ field: 'alarmSeverity', map: [{ value: 'major', severity: 2 }] }]), 2, 'your own line wins');
});

test('a status value with a severity word (Dell alertCurrentStatus = critical(5)) sets the severity; an "ok" status never does', () => {
  const { valueSeverity } = require('../src/traps');
  assert.strictEqual(valueSeverity([['alertCurrentStatus', '1', 'critical(5)']], []), 2);
  assert.strictEqual(valueSeverity([['alertCurrentStatus', '1', 'nonCritical(4)']], []), 4);
  assert.strictEqual(valueSeverity([['alertCurrentStatus', '1', 'nonRecoverable(6)']], []), 1);
  assert.strictEqual(valueSeverity([['alertCurrentStatus', '1', 'ok(3)']], []), null);
  assert.strictEqual(valueSeverity([['batteryStatus', '1', 'normal']], []), null);
});

test('severity lines can be limited to one vendor with a match, so 5 means different things for different traps', () => {
  const { valueSeverity } = require('../src/traps');
  const rules = [{ field: 'status', match: '1.3.6.1.4.1.674', map: [{ value: '5', severity: 2 }] }, { field: 'status', match: '/eltek/i', map: [{ value: '5', severity: 5 }] }];
  const vb = [['status', '1.2.3', '5']];
  assert.strictEqual(valueSeverity(vb, rules, { oid: '1.3.6.1.4.1.674.10892.5.3.2.1', name: 'alertGroup' }), 2);
  assert.strictEqual(valueSeverity(vb, rules, { oid: '1.3.6.1.4.1.12148.1', name: 'EltekAlarm' }), 5);
  assert.strictEqual(valueSeverity(vb, rules, { oid: '1.3.6.1.4.1.999.1', name: 'other' }), null);
});
