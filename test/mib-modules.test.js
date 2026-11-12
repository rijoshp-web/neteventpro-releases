'use strict';
// The same name in two MIBs (Dell: alertGroup = 10892.1.5000 in MIB-Dell-10892, 10892.5.3 in IDRAC-MIB) must not depend on which file loads first.
const test = require('node:test'); const assert = require('node:assert'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { MibStore } = require('../src/mib');
const mod = (name, root, trap) => `${name} DEFINITIONS ::= BEGIN
IMPORTS enterprises FROM SNMPv2-SMI;
vend OBJECT IDENTIFIER ::= { enterprises 4242 }
grp OBJECT IDENTIFIER ::= { vend ${root} }
${trap} TRAP-TYPE
    ENTERPRISE grp
    VARIABLES { }
    DESCRIPTION "x"
    ::= 7
END
`;
for (const [label, order] of [['a first', ['a.mib', 'b.mib']], ['b first', ['b.mib', 'a.mib']]]) {
  test('same name in two modules resolves inside its own module (' + label + ')', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nep-mod-')); const m = new MibStore(dir);
    const text = { 'a.mib': mod('A-MIB', 1, 'trapA'), 'b.mib': mod('B-MIB', 5, 'trapB') };
    for (const f of order) m.add(f, text[f]);
    assert.strictEqual(m.name([1, 3, 6, 1, 4, 1, 4242, 1, 0, 7], true), 'A-MIB::trapA');
    assert.strictEqual(m.name([1, 3, 6, 1, 4, 1, 4242, 5, 0, 7], true), 'B-MIB::trapB');
    assert.strictEqual(m.lookup('B-MIB::grp').oid, '1.3.6.1.4.1.4242.5');
    assert.strictEqual(m.lookup('trapB').oid, '1.3.6.1.4.1.4242.5.0.7');
    assert.strictEqual(m.lookup('grp.0.7').exact, true);            // a plain name picks the module whose full OID is known
    assert.strictEqual(m.stats().unresolved, 0);
  });
}

test('1.49: MIB value picker: search by file name, by file, numbers behind textual conventions, paging', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'); const { MibStore } = require('../src/mib');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mibpick-'));
  fs.writeFileSync(path.join(dir, 'ACME-TEMP-MIB.mib'), `ACME-TEMP-MIB DEFINITIONS ::= BEGIN
IMPORTS OBJECT-TYPE, Gauge32, enterprises FROM SNMPv2-SMI TEXTUAL-CONVENTION FROM SNMPv2-TC;
acme OBJECT IDENTIFIER ::= { enterprises 99999 }
AcmeCelsius ::= TEXTUAL-CONVENTION STATUS current DESCRIPTION "x" SYNTAX Gauge32
acmeTemp OBJECT-TYPE SYNTAX AcmeCelsius MAX-ACCESS read-only STATUS current DESCRIPTION "x" ::= { acme 1 }
acmeName OBJECT-TYPE SYNTAX OCTET STRING MAX-ACCESS read-only STATUS current DESCRIPTION "x" ::= { acme 2 }
acmeFan OBJECT-TYPE SYNTAX Gauge32 MAX-ACCESS read-only STATUS current DESCRIPTION "x" ::= { acme 3 }
END
`);
  const m = new MibStore(dir);
  const all = m.readings('', 100); assert.deepStrictEqual(all.objects.map((o) => o.name), ['acmeFan', 'acmeTemp'], 'a number defined through a textual convention is offered, text is not');
  assert.strictEqual(m.readings('acme-temp-mib.mib', 100).total, 2, 'the MIB file name is searched');
  assert.strictEqual(m.readings('', 100, { file: 'ACME-TEMP-MIB.mib' }).total, 2); assert.strictEqual(m.readings('', 100, { file: 'OTHER.mib' }).total, 0);
  assert.strictEqual(m.readings('acme fan', 100).total, 1, 'all words must match');
  const p2 = m.readings('', 1, { offset: 1 }); assert.strictEqual(p2.total, 2); assert.deepStrictEqual(p2.objects.map((o) => o.name), ['acmeTemp']);
  assert.deepStrictEqual(m.readingFiles().map((f) => [f.file, f.count]), [['ACME-TEMP-MIB.mib', 2]]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('1.50.1: a table with named value lists and text numbers is offered completely, and its comment column names the rows', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'); const { MibStore } = require('../src/mib');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mibtab-'));
  fs.writeFileSync(path.join(dir, 'ACME-ANALOG-MIB.mib'), `ACME-ANALOG-MIB DEFINITIONS ::= BEGIN
IMPORTS OBJECT-TYPE, enterprises FROM SNMPv2-SMI DisplayString FROM RFC1213-MIB;
AlarmColor ::= INTEGER { gray(0), green(1), yellow(2), red(3) }
acme OBJECT IDENTIFIER ::= { enterprises 99998 }
anTable OBJECT-TYPE SYNTAX SEQUENCE OF AnEntry ACCESS not-accessible STATUS mandatory DESCRIPTION "x" ::= { acme 1 }
anEntry OBJECT-TYPE SYNTAX AnEntry ACCESS not-accessible STATUS mandatory DESCRIPTION "x" INDEX { anCh } ::= { anTable 1 }
AnEntry ::= SEQUENCE { anCh INTEGER, anComment DisplayString, anVoltageValue DisplayString, anStatus AlarmColor }
anCh OBJECT-TYPE SYNTAX INTEGER ACCESS read-only STATUS mandatory DESCRIPTION "x" ::= { anEntry 1 }
anComment OBJECT-TYPE SYNTAX DisplayString ACCESS read-only STATUS mandatory DESCRIPTION "x" ::= { anEntry 2 }
anVoltageValue OBJECT-TYPE SYNTAX DisplayString ACCESS read-only STATUS mandatory DESCRIPTION "x" ::= { anEntry 3 }
anStatus OBJECT-TYPE SYNTAX AlarmColor ACCESS read-only STATUS mandatory DESCRIPTION "x" ::= { anEntry 4 }
END
`);
  const m = new MibStore(dir), r = m.readings('', 100, { entry: '1.3.6.1.4.1.99998.1.1' });
  assert.deepStrictEqual(r.objects.map((o) => o.name).sort(), ['anCh', 'anStatus', 'anVoltageValue'], 'enumerated and text-number columns are included, the name column is not');
  assert.strictEqual(r.nameOid, '1.3.6.1.4.1.99998.1.1.2'); assert.ok(r.objects.find((o) => o.name === 'anVoltageValue').text);
  fs.rmSync(dir, { recursive: true, force: true });
});
