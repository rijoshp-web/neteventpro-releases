'use strict';
// Copy to SQL Server (1.38). The local database stays the main store. This module copies logs / traps, alarms and devices to a
// Microsoft SQL Server database. It keeps a "copied up to here" mark per table, so after an outage of the SQL Server (or of this service)
// the copy simply carries on from the mark: nothing is lost as long as the rows are still in the local database.
// The SQL itself is built here; a small PowerShell program (sqlcopy.ps1, Windows PowerShell 5.1 + System.Data.SqlClient, nothing to install)
// only connects, runs the statements and bulk-loads the rows with SqlBulkCopy.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SCHEMA_VERSION = 3;   // 2 (1.39): views ne_syslog and ne_traps; 3 (1.47): table ne_poll (SNMP polling, 5-minute averages)
const TABLES = {
  logs: { sql: 'ne_logs', key: 'id', cols: [['id', 'bigint'], ['ts', 'datetime'], ['dev_ts', 'datetime'], ['src_ip', 'nvarchar(64)'], ['host', 'nvarchar(255)'], ['facility', 'int'], ['severity', 'int'], ['app', 'nvarchar(255)'], ['pid', 'nvarchar(100)'], ['msgid', 'nvarchar(100)'],
    ['message', 'nvarchar(max)'], ['tags', 'nvarchar(max)'], ['color', 'nvarchar(50)'], ['source', 'nvarchar(10)'], ['vb', 'nvarchar(max)'], ['seq', 'bigint']], index: 'ts' },
  alarms: { sql: 'ne_alarms', key: 'id', cols: [['id', 'bigint'], ['rule_id', 'nvarchar(100)'], ['rule_name', 'nvarchar(200)'], ['dev', 'nvarchar(255)'], ['host', 'nvarchar(255)'], ['src_ip', 'nvarchar(64)'], ['severity', 'int'], ['state', 'nvarchar(20)'],
    ['first_ts', 'datetime'], ['last_ts', 'datetime'], ['count', 'int'], ['message', 'nvarchar(1000)'], ['log_id', 'bigint'], ['ack_by', 'nvarchar(100)'], ['ack_ts', 'datetime'], ['cleared_ts', 'datetime'], ['cleared_by', 'nvarchar(100)'], ['esc_ts', 'datetime'],
    ['esc_min', 'int'], ['source', 'nvarchar(10)'], ['notes', 'nvarchar(max)'], ['upd', 'datetime']], index: 'first_ts' },
  devices: { sql: 'ne_devices', key: 'src_ip', cols: [['src_ip', 'nvarchar(64)'], ['host', 'nvarchar(255)'], ['first_seen', 'datetime'], ['last_seen', 'datetime'], ['count', 'bigint'], ['vendor', 'nvarchar(100)'], ['ips', 'nvarchar(max)']] },
};
TABLES.poll = { sql: 'ne_poll', key: 'id', cols: [['id', 'bigint'], ['dev', 'nvarchar(64)'], ['dev_name', 'nvarchar(255)'], ['k', 'nvarchar(40)'], ['inst', 'nvarchar(255)'], ['ts', 'datetime'], ['v_avg', 'float'], ['v_min', 'float'], ['v_max', 'float'], ['n', 'int']], index: 'ts' };
const QUERIES = {
  poll: 'SELECT rowid AS id, dev, k, inst, t AS ts, avg AS v_avg, min AS v_min, max AS v_max, n FROM poll_avg WHERE rowid > ? ORDER BY rowid LIMIT ?',
  logs: 'SELECT id, ts, dev_ts, src_ip, host, facility, severity, app, pid, msgid, message, tags, color, source, vb, seq FROM logs WHERE id > ? ORDER BY id LIMIT ?',
  alarms: 'SELECT id, rule_id, rule_name, dev, host, src_ip, severity, state, first_ts, last_ts, count, message, log_id, ack_by, ack_ts, cleared_ts, cleared_by, esc_ts, esc_min, source, notes, upd FROM alarms WHERE upd > ? AND upd <= ? ORDER BY upd, id LIMIT ?',
  devices: 'SELECT src_ip, host, first_seen, last_seen, count, vendor, ips FROM devices',
};
const NEEDS_NULL = new Set(['dev_ts', 'ack_ts', 'cleared_ts', 'esc_ts', 'first_seen', 'last_seen']);

const sqlName = (s) => '[' + String(s).replace(/\]/g, ']]') + ']';
const isoOf = (ms) => new Date(+ms).toISOString().replace('T', ' ').replace('Z', '');
const clean = (s) => String(s ?? '').replace(/\u0000/g, '');

/** the statements that create the tables (safe to run again) and record the schema version */
function schemaSql() {
  const out = ["IF OBJECT_ID(N'dbo.ne_schema', 'U') IS NULL CREATE TABLE dbo.ne_schema (version int NOT NULL, applied datetime2(3) NOT NULL)",
    `IF EXISTS (SELECT 1 FROM dbo.ne_schema WHERE version > ${SCHEMA_VERSION}) THROW 50001, 'This database was filled by a newer NetEventPro version. Use a newer NetEventPro or another database.', 1`];
  for (const t of Object.values(TABLES)) {
    const cols = t.cols.map(([n, ty]) => `${sqlName(n)} ${ty === 'datetime' ? 'datetime2(3)' : ty} ${n === t.key ? 'NOT NULL PRIMARY KEY' : 'NULL'}`).join(', ');
    out.push(`IF OBJECT_ID(N'dbo.${t.sql}', 'U') IS NULL CREATE TABLE dbo.${t.sql} (${cols})`);
    if (t.index) out.push(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'ix_${t.sql}_${t.index}' AND object_id = OBJECT_ID(N'dbo.${t.sql}')) CREATE INDEX ix_${t.sql}_${t.index} ON dbo.${t.sql} (${t.index})`);
  }
  for (const [v, w] of [['ne_syslog', "source <> N'snmp'"], ['ne_traps', "source = N'snmp'"]]) out.push(`IF OBJECT_ID(N'dbo.${v}', 'V') IS NULL EXEC(N'CREATE VIEW dbo.${v} AS SELECT * FROM dbo.ne_logs WHERE ${w.replace(/'/g, "''")}')`);
  out.push(`IF NOT EXISTS (SELECT 1 FROM dbo.ne_schema) INSERT INTO dbo.ne_schema (version, applied) VALUES (${SCHEMA_VERSION}, SYSUTCDATETIME()) ELSE UPDATE dbo.ne_schema SET version = ${SCHEMA_VERSION}, applied = SYSUTCDATETIME()`);
  return out;
}
/** statements to bring one batch into its table: a temporary table, filled by SqlBulkCopy, then merged (running a batch twice does no harm) */
function loadSql(name) {
  const t = TABLES[name], c = t.cols.map(([n]) => sqlName(n));
  const stg = `CREATE TABLE #stg (${t.cols.map(([n, ty]) => `${sqlName(n)} ${ty === 'datetime' ? 'datetime2(3)' : ty} NULL`).join(', ')})`;
  const upd = t.cols.filter(([n]) => n !== t.key).map(([n]) => `t.${sqlName(n)} = s.${sqlName(n)}`).join(', ');
  const merge = `MERGE dbo.${t.sql} AS t USING #stg AS s ON t.${sqlName(t.key)} = s.${sqlName(t.key)} WHEN MATCHED THEN UPDATE SET ${upd} WHEN NOT MATCHED THEN INSERT (${c.join(', ')}) VALUES (${c.map((x) => 's.' + x).join(', ')});`;
  return { before: [stg], after: [merge] };
}
function rowArray(name, r) {
  return TABLES[name].cols.map(([n, ty]) => {
    const v = r[n];
    if (v === null || v === undefined) return null;
    if (ty === 'datetime') return +v > 0 ? isoOf(v) : null;
    if (ty === 'bigint' || ty === 'int') return Number.isFinite(+v) ? Math.trunc(+v) : 0;
    if (ty === 'float') return Number.isFinite(+v) ? +v : null;
    return clean(v);
  });
}

/** run the PowerShell worker once: JSON in on stdin, one JSON line out. `NETEVENTPRO_SQLCOPY_WORKER` (a Node script) replaces it in tests. */
function runWorker(payload, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const fake = process.env.NETEVENTPRO_SQLCOPY_WORKER;
    const ps = path.join(__dirname, 'sqlcopy.ps1');
    const [cmd, args] = fake ? [process.execPath, [fake]] : process.platform === 'win32' ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps]] : ['pwsh', ['-NoProfile', '-NonInteractive', '-File', ps]];
    let out = '', err = '', done = false, child;
    const end = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    try { child = spawn(cmd, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { return resolve({ ok: false, error: `Could not start the SQL copy program: ${e.message}` }); }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* */ } end({ ok: false, error: 'The SQL Server did not answer in time (2 minutes).' }); }, timeoutMs);
    child.on('error', (e) => end({ ok: false, error: e.code === 'ENOENT' ? 'PowerShell was not found on this computer (Windows PowerShell 5.1 is needed).' : `Could not start the SQL copy program: ${e.message}` }));
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    child.on('close', () => {
      const line = out.trim().split('\n').filter(Boolean).pop();
      try { end(JSON.parse(line)); } catch { end({ ok: false, error: (err || out || 'The SQL copy program gave no answer.').trim().slice(0, 400) }); }
    });
    child.stdin.on('error', () => { /* the program ended early; close handles it */ });
    child.stdin.end(JSON.stringify(payload));
  });
}

/** a friendlier text for the usual SQL Server problems */
function explain(e, cfg) {
  const m = String(e || '');
  if (/certificate chain|not trusted|SSL Provider/i.test(m)) return m + ' Tick "Trust the server certificate" if the SQL Server uses its own certificate.';
  if (/Login failed/i.test(m) && cfg.auth === 'windows') return m + ' With Windows login the NetEventPro service runs as its Windows account (by default the computer account), so give that account a SQL login, or run the service as a domain account.';
  if (/Cannot open database/i.test(m)) return m + ' Create the database first, or tick "Create the database if it does not exist".';
  return m;
}

class SqlCopy {
  /** config: Config; db: the local DatabaseSync */
  constructor(config, db) {
    this.config = config; this.db = db; this.file = path.join(config.dir || '.', 'sqlcopy-state.json');
    this.state = { key: '', wm: {}, schemaOk: false, devHash: '', devAt: 0, total: { logs: 0, alarms: 0, devices: 0, poll: 0 }, lastOk: 0, lastError: '', lastErrorAt: 0, fails: 0, nextAt: 0 };
    try { Object.assign(this.state, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* first start */ }
    this.state.nextAt = 0; this.busy = false; this.stopped = false; this.last = { ms: 0, rows: 0 };
    this.timer = null;
  }
  cfg() { return this.config.get().sqlCopy || {}; }
  active() { const c = this.cfg(); return !!(c.enabled && c.server && c.database); }
  start() { this.schedule(2000); }
  stop() { this.stopped = true; clearTimeout(this.timer); this.saveState(); }
  schedule(ms) { if (this.stopped) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.tick().catch((e) => this.fail(e.message)).finally(() => this.schedule(Math.max(1000, (this.cfg().intervalSec || 5) * 1000))), ms); this.timer.unref?.(); }
  saveState() { try { fs.writeFileSync(this.file, JSON.stringify(this.state)); } catch { /* */ } }
  /** settings were saved: a new target means starting afresh, anything else just retries now */
  changed() { this.state.nextAt = 0; this.state.fails = 0; this.state.lastError = ''; this.schedule(500); }
  targetKey(c) { return [c.server, c.database, c.auth, c.user].join('|'); }
  conn(c = this.cfg(), over = {}) { return { server: c.server, database: c.database, auth: c.auth === 'sql' ? 'sql' : 'windows', user: c.user || '', password: c.password || '', encrypt: c.encrypt !== false, trust: !!c.trustCert, ...over }; }

  fail(msg) { const s = this.state; s.fails++; s.lastError = msg; s.lastErrorAt = Date.now(); s.nextAt = Date.now() + Math.min(300000, 5000 * 2 ** Math.min(s.fails, 6)); this.saveState(); }

  /** one round: create the tables if needed, then copy what is new (devices, logs / traps, alarms) */
  async tick() {
    if (this.busy || !this.active() || Date.now() < this.state.nextAt) return;
    this.busy = true; const c = this.cfg(), s = this.state, t0 = Date.now();
    try {
      const key = this.targetKey(c);
      if (s.key !== key) { s.key = key; s.wm = {}; s.schemaOk = false; s.devHash = ''; s.total = { logs: 0, alarms: 0, devices: 0, poll: 0 }; }
      if (s.schemaVer !== SCHEMA_VERSION) s.schemaOk = false;   // a newer layout (for example new views) is applied once after an update
      if (!s.schemaOk) {
        const r = await runWorker({ op: 'run', conn: this.conn(c), createDb: !!c.createDb, before: schemaSql(), bulk: null, after: [], query: 'SELECT MAX(version) AS version FROM dbo.ne_schema' });
        if (!r.ok) return this.fail(explain(r.error, c));
        s.schemaOk = true; s.schemaVer = SCHEMA_VERSION; s.schema = r.row?.version ?? SCHEMA_VERSION;
      }
      const maxLog = this.db.prepare('SELECT COALESCE(MAX(id),0) AS m FROM logs').get().m;
      const back = c.backfill || s.force;
      if (s.wm.logs === undefined) s.wm.logs = back ? 0 : maxLog;
      if (s.wm.alarms === undefined) s.wm.alarms = back ? 0 : Date.now();
      s.force = false;
      const batch = Math.min(5000, Math.max(100, +c.batch || 2000));
      if (c.copyDevices !== false && Date.now() - s.devAt > 60000) {
        const rows = this.db.prepare(QUERIES.devices).all(), h = JSON.stringify(rows).length + ':' + rows.reduce((a, r) => a + (+r.last_seen || 0) + (+r.count || 0), 0);
        if (rows.length && h !== s.devHash) { const r = await this.send('devices', rows); if (!r.ok) return this.fail(explain(r.error, c)); s.devHash = h; s.total.devices += rows.length; }
        s.devAt = Date.now();
      }
      for (let round = 0; round < 25; round++) {
        let moved = 0;
        if (c.copyLogs !== false || c.copyTraps !== false) {
          const all = this.db.prepare(QUERIES.logs).all(s.wm.logs, batch);
          if (all.length) {
            const rows = all.filter((r) => (r.source === 'snmp' ? c.copyTraps !== false : c.copyLogs !== false));
            if (rows.length) { const r = await this.send('logs', rows); if (!r.ok) return this.fail(explain(r.error, c)); s.total.logs += rows.length; moved += rows.length; }
            s.wm.logs = all[all.length - 1].id;
          }
        }
        if (c.copyAlarms !== false) {
          const bound = Date.now() - 20, all = this.db.prepare(QUERIES.alarms).all(s.wm.alarms, bound, batch);
          if (all.length) {
            const r = await this.send('alarms', all); if (!r.ok) return this.fail(explain(r.error, c));
            const last = all[all.length - 1].upd; s.wm.alarms = all.length >= batch && all[0].upd < last ? last - 1 : last; s.total.alarms += all.length; moved += all.length;
          }
        }
        if (c.copyPoll !== false && this.hasPoll()) {
          if (s.wm.poll === undefined) s.wm.poll = 0;
          const all = this.db.prepare(QUERIES.poll).all(s.wm.poll, batch);
          if (all.length) {
            const names = new Map(((this.config.get().polling || {}).devices || []).map((d) => [d.id, d.name]));
            const r = await this.send('poll', all.map((x) => ({ ...x, dev_name: names.get(x.dev) || x.dev }))); if (!r.ok) return this.fail(explain(r.error, c));
            s.wm.poll = all[all.length - 1].id; s.total.poll = (s.total.poll || 0) + all.length; moved += all.length;
          }
        }
        this.saveState();
        if (!moved) break;
      }
      s.fails = 0; s.lastError = ''; s.lastOk = Date.now(); this.last = { ms: Date.now() - t0, rows: 0 }; this.saveState();
    } finally { this.busy = false; }
  }
  hasPoll() { try { return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='poll_avg'").get(); } catch { return false; } }
  send(name, rows) {
    const q = loadSql(name);
    return runWorker({ op: 'run', conn: this.conn(), createDb: false, before: q.before, bulk: { cols: TABLES[name].cols.map(([n, ty]) => ({ n, t: ty === 'datetime' ? 'datetime' : ty === 'bigint' ? 'bigint' : ty === 'int' ? 'int' : ty === 'float' ? 'float' : 'nvarchar' })), rows: rows.map((r) => rowArray(name, r)) }, after: q.after, query: null });
  }

  /** the Test button: tries the settings in the form (not the saved ones) and reports what it found */
  async test(c) {
    const r = await runWorker({ op: 'probe', conn: this.conn(c), createDb: !!c.createDb, database: c.database }, 45000);
    if (!r.ok) return { ok: false, error: explain(r.error, c) };
    const x = r.row || {}, canCreate = !!(+x.dbcreator || +x.sysadmin);
    if (!x.dbExists && !c.createDb) return { ok: false, error: `The database "${c.database}" does not exist on this server. Create it, or tick "Create the database if it does not exist".`, version: x.version };
    if (!x.dbExists && !canCreate) return { ok: false, error: `The database "${c.database}" does not exist and this login may not create databases (needs the dbcreator or sysadmin role). Ask the SQL Server administrator to create it.`, version: x.version };
    return { ok: true, version: String(x.version || '').split('\n')[0], dbExists: !!x.dbExists, willCreate: !x.dbExists, canCreate, as: x.who || '' };
  }
  /** copy everything again from the start (rows are merged, so nothing is duplicated) */
  resetMarks(all = true) { this.state.wm = {}; this.state.devHash = ''; this.state.devAt = 0; if (all) this.state.force = true; this.state.nextAt = 0; this.saveState(); this.schedule(300); }

  status() {
    const c = this.cfg(), s = this.state; let pendingLogs = 0, pendingAlarms = 0;
    if (this.active()) try {
      if (s.wm.logs !== undefined) pendingLogs = this.db.prepare('SELECT COUNT(*) AS n FROM logs WHERE id > ?').get(s.wm.logs).n;
      if (s.wm.alarms !== undefined) pendingAlarms = this.db.prepare('SELECT COUNT(*) AS n FROM alarms WHERE upd > ?').get(s.wm.alarms).n;
    } catch { /* */ }
    return { enabled: !!c.enabled, configured: !!(c.server && c.database), state: !c.enabled ? 'off' : s.lastError ? 'error' : s.lastOk ? (pendingLogs + pendingAlarms > 200 ? 'catching-up' : 'ok') : 'starting',
      lastOk: s.lastOk, lastError: s.lastError, lastErrorAt: s.lastErrorAt, retryAt: s.lastError ? s.nextAt : 0, fails: s.fails, schema: s.schema || 0, total: s.total, pending: { logs: pendingLogs, alarms: pendingAlarms }, target: c.server && c.database ? `${c.server} / ${c.database}` : '' };
  }
}

module.exports = { SqlCopy, schemaSql, loadSql, rowArray, runWorker, TABLES, SCHEMA_VERSION, sqlName };
