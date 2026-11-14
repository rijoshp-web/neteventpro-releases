'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { hashPasswordSync } = require('./auth');

/**
 * Windows: only SYSTEM and Administrators (plus the signed-in user when the app is started by hand) may read a file.
 * config.json holds the SMTP password, webhook addresses and the password hash. (Linux/macOS use file mode 0600 instead.)
 * The tray icon and shortcuts do not need config.json: the service publishes the dashboard address in ui\web.json.
 */
function restrictToAdmins(file) {
  if (process.platform !== 'win32') return;
  try {
    const grants = ['*S-1-5-18:(F)', '*S-1-5-32-544:(F)'];
    const who = process.env.USERNAME;
    if (who && !who.endsWith('$') && who.toUpperCase() !== 'SYSTEM') grants.push(`${process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' : ''}${who}:(F)`);
    execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'icacls.exe'), [file, '/inheritance:r', '/grant:r', ...grants], { stdio: 'ignore', timeout: 15000, windowsHide: true });
  } catch (e) { console.error(`[config] could not restrict access to ${file}: ${e.message}`); }
}

// Data directory: %ProgramData%\NetEventPro on Windows, ./data elsewhere (dev).
// The setup program renames the folder of an older installation (SyslogPro) to NetEventPro. If only the old folder exists (an
// installation that was updated online only, never with the new setup program) it is used as it is, so no data is ever left behind.
const envv = (n) => process.env['NETEVENTPRO_' + n] || process.env['SYSLOGPRO_' + n];
function dataDir() {
  if (envv('DATA')) return envv('DATA');
  if (process.platform === 'win32' && process.env.ProgramData) {
    const fresh = path.join(process.env.ProgramData, 'NetEventPro'), old = path.join(process.env.ProgramData, 'SyslogPro');
    return !fs.existsSync(fresh) && fs.existsSync(old) ? old : fresh;
  }
  return path.join(process.cwd(), 'data');
}

const DEFAULTS = {
  udpPort: 514,
  udpRecvMB: 16,                  // 1.59: size of the operating-system receive buffer of the UDP syslog socket (a bigger buffer survives bursts)
  tcpPort: 514,
  udpEnabled: true,
  tcpEnabled: true,
  syslogBind: '0.0.0.0',
  tlsSyslogEnabled: false,        // secure syslog (syslog over TLS, RFC 5425); uses the same certificate as the HTTPS dashboard
  tlsSyslogPort: 6514,
  allowedSources: [],             // accept syslog only from these IPs / CIDR ranges; empty = accept from anywhere
  webPort: 8514,
  webBind: '127.0.0.1',           // 0.0.0.0 lets other PCs open the dashboard (only honoured when a password is set)
  adminPasswordHash: '',          // scrypt hash; set through the dashboard, never stored in clear text
  tlsCertFile: '', tlsKeyFile: '',// optional HTTPS for the dashboard (PEM files)
  retentionDays: 730,             // messages and traps (2 years since 1.41); 0 = keep everything
  alarmRetentionDays: -1,         // cleared alarms: -1 = same as messages, 0 = keep everything, or a number of days
  maxDbMB: 0,                     // oldest messages are pruned when the DB grows past this (0 = no size limit; the default since 1.41, so the 2-year retention is what decides)
  security: {},                   // password policy, account lockout, two-factor reminder, web allow-list, HSTS (see src/security.js)
  sessionIdleHours: 12,           // signed out after this many hours without use (0 = never)
  sessionMaxDays: 7,              // and at most this many days after signing in (0 = never)
  liveBufferSize: 5000,           // messages kept in memory for the live view
  silentDeviceMinutes: 15,        // raise an alert when a known device stops sending for this long (0 = off)
  rawLogEnabled: false,           // also write plain-text daily files to <data folder>\raw
  update: { url: '', publicKey: '', autoCheck: true, nodeBase: '', autoProbes: true, probeAuto: true, probeTrust: true },   // autoProbes: a central server offers its update to its probes; probeAuto: a probe installs what its server offers   // online update: address of latest.json and the release public key
  trapForwardTargets: [],         // northbound SNMP: [{ name, host, port:162, community, version:'v2c'|'v1', minSeverity, enabled }]
  forwardTargets: [],             // [{ name, host, port, protocol:'udp'|'tcp', enabled:true }]
  replacements: [],               // [{ id, enabled, find, replace, regex, wholeWord, matchCase, scope }]
  polling: { enabled: true, workers: 5, workersAuto: true, gapMs: 30, defaultIntervalSec: 60, keepRawDays: 7, keepAvgDays: 365, missesBeforeDown: 3, noAnswerSeverity: 3, noAnswerProfiles: [], devices: [], profiles: [], profileOff: {}, thresholds: [] },   // SNMP polling (see polling.js)
  smtp: { host: '', port: 587, security: 'starttls', user: '', password: '', from: '', to: '', cc: '', allowSelfSigned: false, maxPerHour: 30 },
  rules: [
    {
      id: 'r-default-critical',
      name: 'Critical and above',
      enabled: true,
      match: { severityMax: 2 },
      actions: { color: '#ff4d4f', tag: 'critical', sound: true }
    }
  ],
  notifProfiles: [],              // [{ id, name, enabled, email:{ on, to, cc }, webhook:{ on, url, format:'generic'|'teams'|'slack' }, sms:{ on, to } }]  who is told and how; rules pick profiles (1.37)
  sqlCopy: { enabled: false, server: '', database: 'NetEventPro', auth: 'windows', user: '', password: '', encrypt: true, trustCert: false, createDb: false, copyLogs: true, copyTraps: true, copyAlarms: true, copyDevices: true, copyPoll: true, backfill: false, batch: 2000, intervalSec: 5 },   // copy to SQL Server (1.38)
  smpp: { host: '', port: 2775, tls: false, allowSelfSigned: false, systemId: '', password: '', systemType: '', bind: 'transceiver', sourceAddr: 'NetEventPro', sourceTon: '', sourceNpi: '', destTon: '', destNpi: '', maxPerHour: 30 },   // SMS gateway (SMSC)
  webhooks: [],                   // [{ name, url, enabled }] used by rule action "webhook"
  deviceInfo: {},                 // { "10.0.0.1": { group: "Dubai DC", note: "...", expectMin: 30 } }  group, note and "must report at least every N minutes"
  deviceAliases: {},              // { "10.0.0.1": "Core-SW1" }
  mutedDevices: [],
  mode: 'central',                // 'central' = the normal NetEventPro; 'probe' = only receive here and send everything to a central NetEventPro
  probe: { server: '', token: '', name: '', allowSelfSigned: false, requireHttps: false, pinSha256: '', rateLimit: 0, pwHash: '', webBind: '127.0.0.1', webAllow: [], tlsCertFile: '', tlsKeyFile: '' },   // token is stored encrypted (enc1:); pwHash = this page's own sign-in
  probes: [],                     // central side: [{ id, name, tokenHash, enabled, created }] the probes that may send to this server
  systemMessages: { all: true, health: true, silent: true, audit: true },   // NetEventPro's own messages in the log (health checks, silent devices, who changed what)
  vendorParsers: { cisco: true, dell: true, hp: true, apc: true, eltek: true },   // add tags such as "link-down" to messages these vendors send
  healthAlerts: true,             // write a NetEventPro message when a self-check changes state (disk, listeners, delays ...)
  ntp: { enabled: false, server: '', port: 123, intervalMin: 15, zone: '' },   // dashboard clock: time from your NTP server (display only; this PC's clock is not changed)
  maintenance: [],                // maintenance windows (see maintenance.js)
  snmp: { enabled: true, port: 162, bind: '0.0.0.0', communities: [], informAck: true, defaultSeverity: 5, severityRules: [], valueSeverity: [] },   // SNMP trap receiver (see traps.js); communities empty = accept any
  reports: [],                    // scheduled reports (see reports.js)
  backup: { enabled: false, time: '02:00', keep: 7, includeDb: true, folder: '', passphrase: '' },   // automatic daily backup
  diskWarnPercent: 15, diskCritPercent: 5,   // free space on the data drive that raises a warning / critical alert
  uiPrefs: {}                     // dashboard layout, saved views and log table choices
};

/**
 * 1.37: the e-mail and webhook choices that rules carried (emailTo, emailCc, webhook, alarmEscTo, "default recipients") become notification profiles.
 * Runs once, when a config.json from an older version is loaded. The rule then lists the profile ids; the old keys are removed from the rule.
 */
function migrateNotifications(c) {
  const profiles = Array.isArray(c.notifProfiles) ? c.notifProfiles : (c.notifProfiles = []), byKey = new Map(); let n = 0;
  const nid = () => { let id; do { id = 'np' + (++n); } while (profiles.some((p) => p.id === id)); return id; };
  const mk = (key, name, parts) => { if (byKey.has(key)) return byKey.get(key); const p = { id: nid(), name: String(name).slice(0, 100), enabled: true, email: { on: false, to: '', cc: '' }, webhook: { on: false, url: '', format: 'generic' }, sms: { on: false, to: '' }, ...parts }; profiles.push(p); byKey.set(key, p.id); return p.id; };
  const smtp = c.smtp || {};
  const mail = (to, cc) => { const t = String(to || smtp.to || '').trim(), cs = String(cc || (to ? '' : smtp.cc) || '').trim(); return mk('m|' + t + '|' + cs, to ? `E-mail ${t}`.slice(0, 60) : 'E-mail (default recipients)', { email: { on: true, to: t, cc: cs } }); };
  for (const r of c.rules || []) {
    const a = r && r.actions; if (!a || typeof a !== 'object') continue;
    const ids = [];
    if (a.email) { ids.push(mail(a.emailTo, a.emailCc)); delete a.email; delete a.emailTo; delete a.emailCc; }
    if (a.webhook) { const h = (c.webhooks || []).find((x) => x && x.name === a.webhook); if (h && h.url) ids.push(mk('w|' + h.name, 'Webhook: ' + h.name, { enabled: h.enabled !== false, webhook: { on: true, url: h.url, format: 'generic' } })); delete a.webhook; }
    if (ids.length) a.profiles = [...new Set([...(Array.isArray(a.profiles) ? a.profiles : []), ...ids])];
    if (a.alarm && a.alarmEscMin) { a.alarmEscProfiles = [mail(a.alarmEscTo, '')]; delete a.alarmEscTo; }
  }
}

/** every place in config.json that holds a secret; they are encrypted on disk (enc1:) and plain in memory */
function eachSecret(c, fn) {
  const at = (o, k) => { if (o && typeof o === 'object' && typeof o[k] === 'string' && o[k]) fn(o, k); };
  at(c.smtp, 'password'); at(c.sqlCopy, 'password'); at(c.smpp, 'password'); at(c.backup, 'passphrase'); at(c.backup, 'folderPassword');
  for (const p of c.notifProfiles || []) at(p?.webhook, 'url');
  for (const w of c.webhooks || []) at(w, 'url');
  for (const r of c.reports || []) at(r?.folder, 'password');
  for (const t of c.trapForwardTargets || []) { at(t, 'authPass'); at(t, 'privPass'); }
  for (const u of c.snmp?.v3Users || []) { at(u, 'authPass'); at(u, 'privPass'); }
  for (const d of c.polling?.devices || []) { at(d, 'community'); at(d, 'authPass'); at(d, 'privPass'); }
  at(c.update, 'password');
}

class Config {
  constructor() {
    this.dir = dataDir();
    fs.mkdirSync(this.dir, { recursive: true });
    this.box = new (require('./secretbox').SecretBox)(this.dir);
    this.file = path.join(this.dir, 'config.json');
    this.listeners = [];
    this.data = this.load();
    if (fs.existsSync(this.file)) restrictToAdmins(this.file);   // also covers a config.json written by the installer
  }
  load() {
    let user = {};
    let sealedNow = false;
    try { user = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* first run */ }
    eachSecret(user, (o, k) => { if (o[k].startsWith('enc1:')) o[k] = this.box.open(o[k]); else sealedNow = true; });   // plain value from an older version: written encrypted below
    const merged = { ...structuredClone(DEFAULTS), ...user };
    // the setup program renamed ProgramData\SyslogPro to ProgramData\NetEventPro: certificate files kept in the old folder are found in the new one
    for (const k of ['tlsCertFile', 'tlsKeyFile']) if (merged[k] && /\\SyslogPro\\/i.test(merged[k]) && !fs.existsSync(merged[k])) { const m = merged[k].replace(/\\SyslogPro\\/i, '\\NetEventPro\\'); if (fs.existsSync(m)) merged[k] = m; }
    for (const r of merged.rules || []) if (r?.match?.host === 'SyslogPro') r.match.host = 'NetEventPro';   // the application's own messages come from the host "NetEventPro" since 1.8.0
    merged.snmp = { ...DEFAULTS.snmp, ...(user.snmp && typeof user.snmp === 'object' ? user.snmp : {}) };
    merged.polling = { ...DEFAULTS.polling, ...(user.polling && typeof user.polling === 'object' ? user.polling : {}) };
    merged.smtp = { ...DEFAULTS.smtp, ...(user.smtp && typeof user.smtp === 'object' ? user.smtp : {}) };
    merged.sqlCopy = { ...DEFAULTS.sqlCopy, ...(user.sqlCopy && typeof user.sqlCopy === 'object' ? user.sqlCopy : {}) };
    merged.smpp = { ...DEFAULTS.smpp, ...(user.smpp && typeof user.smpp === 'object' ? user.smpp : {}) };
    // upgrade from versions that stored the dashboard password in clear text
    let migrated = false;
    if (!merged.retention2y) {      // 1.41: keep everything for at least 2 years; the size cap of earlier versions would have pruned sooner
      if (merged.retentionDays > 0 && merged.retentionDays < 730) merged.retentionDays = 730;
      if (merged.maxDbMB === 2048) merged.maxDbMB = 0;
      merged.retention2y = true; migrated = true;
    }
    if (!merged.notifMigrated) { migrateNotifications(merged); merged.notifMigrated = true; migrated = true; }
    if (typeof merged.adminPassword === 'string') {
      if (merged.adminPassword && !merged.adminPasswordHash) merged.adminPasswordHash = hashPasswordSync(merged.adminPassword);
      delete merged.adminPassword; migrated = true;
    }
    if (migrated || sealedNow) { this.data = merged; this.save(); }
    // allow env override for dev/testing
    if (envv('UDP_PORT')) merged.udpPort = +envv('UDP_PORT');
    if (envv('TCP_PORT')) merged.tcpPort = +envv('TCP_PORT');
    if (envv('SNMP_PORT')) merged.snmp.port = +envv('SNMP_PORT');
    if (envv('WEB_PORT')) merged.webPort = +envv('WEB_PORT');
    return merged;
  }
  save() {
    const tmp = this.file + '.tmp';
    // config.json holds secrets (SMTP password, webhook URLs): owner-only where the OS supports it
    const out = structuredClone(this.data); eachSecret(out, (o, k) => { o[k] = this.box.seal(o[k]); });
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2), { mode: 0o600 });
    restrictToAdmins(tmp);   // before the rename: the renamed file keeps the permissions of the temporary one
    fs.renameSync(tmp, this.file);
  }
  get() { return this.data; }
  /** the settings with secrets readable (for a backup that is moved to another computer, where secret.key is not available) */
  plainJson() { return JSON.stringify(this.data, null, 2); }
  update(patch) {
    this.data = { ...this.data, ...patch };
    this.save();
    for (const fn of this.listeners) { try { fn(this.data, patch); } catch (e) { console.error('config listener', e); } }
    return this.data;
  }
  onChange(fn) { this.listeners.push(fn); }
}

module.exports = { Config, DEFAULTS, dataDir, restrictToAdmins, migrateNotifications };
