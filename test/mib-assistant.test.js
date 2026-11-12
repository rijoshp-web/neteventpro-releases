'use strict';
const test = require('node:test'); const assert = require('node:assert'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { MibStore } = require('../src/mib');
const mib = (name, extra = '') => `${name} DEFINITIONS ::= BEGIN
IMPORTS enterprises FROM SNMPv2-SMI;
vend OBJECT IDENTIFIER ::= { enterprises 4242 }
grp OBJECT IDENTIFIER ::= { vend 5 }
trapOne TRAP-TYPE ENTERPRISE grp VARIABLES { } DESCRIPTION "x" ::= 7
${extra}
END
`;
const store = (files) => { const m = new MibStore(fs.mkdtempSync(path.join(os.tmpdir(), 'nep-as-'))); for (const [n, t] of Object.entries(files)) m.add(n, t); return m; };

test('MIB assistant: tells why a trap OID is not named', () => {
  const m = store({ 'a.mib': mib('A-MIB') });
  const ok = m.diagnose([1, 3, 6, 1, 4, 1, 4242, 5, 0, 7]); assert.strictEqual(ok.state, 'resolved'); assert.strictEqual(ok.name, 'A-MIB::trapOne');
  const none = m.diagnose([1, 3, 6, 1, 4, 1, 9999, 1, 0, 3], 'Acme'); assert.strictEqual(none.state, 'no-vendor-mib'); assert.match(none.advice, /Acme/);
  const other = m.diagnose([1, 3, 6, 1, 4, 1, 4242, 9, 0, 7]);         // same vendor, same trap number, other tree
  assert.strictEqual(other.state, 'other-oid'); assert.strictEqual(other.candidates[0].name, 'A-MIB::trapOne'); assert.match(other.advice, /different tree/);
  const nd = m.diagnose([1, 3, 6, 1, 4, 1, 4242, 5, 0, 99]); assert.strictEqual(nd.state, 'not-defined'); assert.deepStrictEqual(nd.files, ['a.mib']);
  const st = m.diagnose([1, 3, 6, 1, 2, 1, 2, 2, 1, 77]); assert.strictEqual(st.state, 'standard');
});
test('MIB assistant: a MIB that imports a module that is not loaded is reported by file', () => {
  const m = store({ 'x.mib': 'X-MIB DEFINITIONS ::= BEGIN\nIMPORTS enterprises FROM SNMPv2-SMI vendRoot FROM VENDOR-ROOT-MIB;\nxNode OBJECT IDENTIFIER ::= { vendRoot 1 }\nEND\n' });
  const f = m.fileInfo('x.mib'); assert.deepStrictEqual(f.missing, ['VENDOR-ROOT-MIB']);
  m.add('root.mib', 'VENDOR-ROOT-MIB DEFINITIONS ::= BEGIN\nIMPORTS enterprises FROM SNMPv2-SMI;\nvendRoot OBJECT IDENTIFIER ::= { enterprises 777 }\nEND\n');
  assert.deepStrictEqual(m.fileInfo('x.mib').missing, []);
});
