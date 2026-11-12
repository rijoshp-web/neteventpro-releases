'use strict';
// stands in for sqlcopy.ps1 in tests: records every request and answers like the real worker
const fs = require('node:fs');
let s = ''; process.stdin.on('data', (d) => { s += d; }).on('end', () => {
  const p = JSON.parse(s), out = process.env.FAKE_SQL_LOG;
  if (out) fs.appendFileSync(out, JSON.stringify({ op: p.op, conn: p.conn, createDb: p.createDb, before: p.before, after: p.after, rows: p.bulk ? p.bulk.rows.length : 0, first: p.bulk ? p.bulk.rows[0] : null, cols: p.bulk ? p.bulk.cols.length : 0 }) + '\n');
  const mode = process.env.FAKE_SQL_MODE || 'ok';
  if (mode === 'down') return console.log(JSON.stringify({ ok: false, error: 'A network-related error occurred while establishing a connection to SQL Server' }));
  if (p.op === 'probe') return console.log(JSON.stringify({ ok: true, row: { version: 'Microsoft SQL Server 2022 (fake)\nline2', who: 'DOM\\svc', dbcreator: mode === 'nocreate' ? 0 : 1, sysadmin: 0, dbExists: mode !== 'nodb' && mode !== 'nocreate' } }));
  console.log(JSON.stringify({ ok: true, rows: p.bulk ? p.bulk.rows.length : 0, row: p.query ? { version: 1 } : undefined }));
});
