'use strict';
const XRW = new Set(['NetEventPro', 'SyslogPro']);   // the request header the dashboard sends; the old value is still accepted so a browser that cached the old page keeps working

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { Config, restrictToAdmins } = require('./config');
const { UserStore } = require('./users');
const secmod = require('./security');
const { needsRehash, hashPassword: hashPw } = require('./auth');
const { Reports, PERIODS, checkFolder, testFolder } = require('./reports');
const { Backups, applyPendingRestore } = require('./backup');
const { dataDir } = require('./config');
const certgen = require('./certgen');
const ntpmod = require('./ntp');
const { AlarmStore } = require('./alarms');
const { Maintenance } = require('./maintenance');
const { Store } = require('./store');
const { pipeline } = require('node:stream/promises');
const { Engine, makeLiveFilter } = require('./engine');
const { RuleEngine } = require('./rules');
const { Health } = require('./health');
const { FAMILIES } = require('./vendors');
const { Listeners } = require('./listeners');
const { Probe, ProbeRegistry } = require('./probe');
const { V3Engine, AUTH_PROTOCOLS, PRIV_PROTOCOLS } = require('./snmpv3');
const { MibStore, installStarterMibs } = require('./mib');
const { TrapReceiver } = require('./traps');
const { FACILITIES, SEVERITIES } = require('./parser');
const { hashPassword, verifyPassword, LoginGuard } = require('./auth');
const { SourceFilter } = require('./acl');
const { parseSevs } = require('./query');
const { Replacer, checkReplacement, checkRegexSource } = require('./replace');
const { parseRecipients, validAddress, addrOf } = require('./mailer');
const { sendSms, cleanNumber } = require('./smpp');
const { SqlCopy } = require('./sqlcopy');
const { Polling } = require('./polling');
const { cleanPollSpec } = require('./readings');

const VERSION = require('../package.json').version;
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' };
const MAX_SSE_CLIENTS = 200;
const COUNT_CAP = 100000;

// Locks the page down: scripts only from this server, no framing, no external requests.
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const SEC_HEADERS = {
  'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin', 'cross-origin-resource-policy': 'same-origin', 'permissions-policy': 'camera=(), microphone=(), geolocation=()'
};

// settings the dashboard may change (everything else in config.json is ignored)
const EDITABLE = ['tlsSyslogEnabled', 'tlsSyslogPort', 'udpPort', 'udpRecvMB', 'tcpPort', 'udpEnabled', 'tcpEnabled', 'syslogBind', 'allowedSources', 'webPort', 'webBind', 'adminPassword', 'tlsCertFile', 'tlsKeyFile',
  'retentionDays', 'alarmRetentionDays', 'maxDbMB', 'sessionIdleHours', 'sessionMaxDays', 'liveBufferSize', 'silentDeviceMinutes', 'rawLogEnabled', 'forwardTargets', 'trapForwardTargets', 'update', 'replacements', 'smtp', 'rules', 'webhooks', 'notifProfiles', 'smpp', 'sqlCopy', 'deviceAliases', 'deviceInfo', 'mutedDevices', 'uiPrefs', 'vendorParsers', 'systemMessages', 'healthAlerts', 'diskWarnPercent', 'diskCritPercent', 'reports', 'backup', 'ntp', 'maintenance', 'snmp', 'mode', 'probe'];

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const isLoopback = (b) => ['127.0.0.1', '::1', 'localhost'].includes(b);

async function main() {
  applyPendingRestore(dataDir());     // a restore chosen in the dashboard is applied here, before any file is opened
  const config = new Config();
  try {   // the setup program asks for a change of type (full / probe) on an existing installation by leaving this file
    const f = path.join(config.dir, 'apply-setup.json');
    if (fs.existsSync(f)) {
      const o = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
      const patch = {}; if (o.mode === 'probe' || o.mode === 'central') patch.mode = o.mode;
      if (o.probe && typeof o.probe === 'object') patch.probe = { ...(config.get().probe || {}), ...Object.fromEntries(['server', 'token', 'name'].filter((k) => typeof o.probe[k] === 'string').map((k) => [k, o.probe[k].slice(0, 300)])) };
      config.update(patch); fs.rmSync(f, { force: true }); console.log(`[setup] applied the type chosen in the setup program: ${patch.mode || 'unchanged'}`);
    }
  } catch (e) { console.error('[setup] apply-setup.json ignored:', e.message); }
  require('./update').bootGuard(config.dir);    // after an update: put the old files back if the new version keeps failing to start
  const updater = new (require('./update').Updater)(config, VERSION);
  if (config.get().update?.autoCheck !== false) { setTimeout(() => updater.check().catch(() => {}), 60000).unref?.(); setInterval(() => { if (config.get().update?.autoCheck !== false) updater.check().catch(() => {}); }, 6 * 3600000).unref?.(); }
  // a probe is a lean program of its own: only the listeners, the queue and a small local status page (see probe-main.js)
  if (config.get().mode === 'probe') { await require('./probe-main').run(config, { version: VERSION, updater }); return; }
  const store = new Store(config.dir);
  const users = new UserStore(config.dir, restrictToAdmins);
  const loginFlush = setInterval(() => users.flushLogins(), 60000); loginFlush.unref?.();
  const engine = new Engine(config, store);
  const sources = new SourceFilter(); sources.load(config.get().allowedSources);
  const probe = new Probe(config, config.dir), probes = new ProbeRegistry(config);
  const listeners = new Listeners((buf, ip, proto) => (probe.on ? probe.addSyslog(buf, ip) : engine.handlePacket(buf, ip, proto)), (ip) => sources.allows(ip));
  await listeners.apply(config.get());
  try { const r = installStarterMibs(path.join(config.dir, 'mibs')); if (r.copied) console.log(`[snmp] ${r.copied} standard MIB files added to the MIB folder`); } catch (e) { console.error('[snmp] standard MIBs:', e.message); }
  const mibs = new MibStore(path.join(config.dir, 'mibs'));
  const traps = new TrapReceiver({ config, mibs, engine, isAllowed: (ip) => sources.allows(ip) });
  const v3 = new V3Engine(config.dir); traps.v3 = v3; engine.trapForwarder.v3 = v3;
  traps.forward = (buf, ip, rinfo) => { if (!probe.on) return false; probe.addTrap(buf, ip, rinfo, traps.sock); return true; };
  await traps.apply(config.get());
  const health = new Health({ config, store, engine, listeners, traps }); engine.health = health;
  const audit = (who, text) => { try { engine.internalMessage(5, `${who?.name || 'admin'} ${text}`, 'NetEventPro', 'audit', 'audit'); } catch { /* logging the action is best effort */ } };
  const reports = new Reports({ config, store, dir: config.dir });
  engine.mail.reportFn = () => reports.quick24h();      // escalation e-mails carry the last-24-hours PDF
  const ntp = new ntpmod.NtpClock(config); ntp.start();
  const maint = new Maintenance(config); engine.maint = maint;
  const sqlcopy = new SqlCopy(config, store.db); sqlcopy.start(); config.onChange((c, patch) => { if (patch && 'sqlCopy' in patch) sqlcopy.changed(); });
  const alarms = new AlarmStore(store, engine.mail); alarms.notify = engine.notify; engine.alarms = alarms; reports.alarms = alarms;
  const polling = new Polling(config, store, engine); health.polling = polling; engine.extraRules = () => polling.rules(); engine.applyConfig(config.get()); polling.start();
  const backups = new Backups({ config, store, dir: config.dir, version: VERSION });
  try { fs.rmSync(path.join(config.dir, 'tmp'), { recursive: true, force: true }); } catch { /* nothing to clean */ }
  const guard = new LoginGuard(); const authCache = new Map();
  const twofa = new secmod.TwoFactorStore(config.dir, config.box), acct = new secmod.AccountGuard(), pending2fa = new Map();
  const policy = () => secmod.cleanPolicy(config.get().security);
  const webFilter = new SourceFilter(); const loadWebFilter = (c) => webFilter.load(secmod.cleanPolicy(c.security).webAllow); loadWebFilter(config.get());
  const cleanName = (x) => String(x || '').replace(/[^\w.@-]/g, '').slice(0, 40);
  const state = { webWarning: '', https: false, bind: config.get().webBind, lastTestEmail: 0 };

  let prevNet = netKey(config.get());
  config.onChange((c) => { sources.load(c.allowedSources); loadWebFilter(c); const k = netKey(c); if (k !== prevNet) { prevNet = k; listeners.apply(c); } traps.apply(c); });

  // ---- SSE clients ------------------------------------------------------
  const clients = new Set();
  engine.on('messages', (batch) => {
    for (const c of clients) {
      let list = batch.filter(c.filter);
      if (!list.length) continue;
      let skipped = 0;
      if (list.length > 400) { skipped = list.length - 400; list = list.slice(-400); }
      c.res.write(`event: batch\ndata: ${JSON.stringify({ messages: list.map(slim), skipped })}\n\n`);
      // a browser that stopped reading would make the service buffer everything in memory: cut it off instead
      if (c.res.writableLength > 8 * 1024 * 1024) { clients.delete(c); c.res.destroy(); }
    }
  });
  const heartbeat = setInterval(() => { for (const c of clients) { try { c.res.write(`event: ping\ndata: ${Date.now()}\n\n`); } catch { clients.delete(c); } } }, 10000);
  heartbeat.unref?.();

  // ---- authentication ------------------------------------------------------
  const ANON = { name: '', fullName: '', roleNames: ['Administrator'], perms: new Set(UserStore.adminIdentity().perms), builtin: true, anonymous: true };
  // Signed-in browsers hold a random session cookie (kept in memory: a service restart signs everyone out). Only a hash of the token is stored.
  const sessions = new Map();
  const COOKIE = 'sp_session', HOUR = 3600000, TEN_YEARS = 10 * 365 * 86400;
  // how long a browser stays signed in: Settings → Dashboard access. 0 = never (an always-on screen on a PC keeps showing the dashboard)
  const idleMs = (cfg) => { const h = Number(cfg.sessionIdleHours); return h > 0 ? h * HOUR : Infinity; };
  const maxMs = (cfg) => { const d = Number(cfg.sessionMaxDays); return d > 0 ? d * 24 * HOUR : Infinity; };
  const sessionFile = path.join(config.dir, 'sessions.json');
  const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
  try { for (const [k, v] of JSON.parse(fs.readFileSync(sessionFile, 'utf8'))) if (/^[0-9a-f]{64}$/.test(k) && v && typeof v.name === 'string') sessions.set(k, { name: v.name, ver: String(v.ver), born: +v.born || 0, last: +v.last || 0, ip: String(v.ip || ''), ua: String(v.ua || '') }); } catch { /* none yet */ }
  let sessDirty = false;
  const saveSessions = () => { if (!sessDirty) return; sessDirty = false; try { fs.writeFileSync(sessionFile, JSON.stringify([...sessions]), { mode: 0o600 }); } catch { /* the sign-in simply is not kept over a restart */ } };
  const authVersion = (cfg) => sha(String(cfg.adminPasswordHash || '') + '\0' + users.version);   // changes when any password, role or user changes
  const cookieOf = (req) => { const m = /(?:^|;\s*)sp_session=([A-Za-z0-9_-]{20,80})/.exec(req.headers.cookie || ''); return m ? m[1] : ''; };
  const sessionCookie = (token, maxAge) => `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${state.https ? '; Secure' : ''}`;
  const cookieAge = (cfg) => { const m = maxMs(cfg); return m === Infinity ? TEN_YEARS : Math.floor(m / 1000); };   // the server enforces the idle time; the cookie only has to outlive it
  function newSession(name, cfg, req) {
    const token = crypto.randomBytes(32).toString('base64url'), now = Date.now();
    sessions.set(sha(token), { name, ver: authVersion(cfg), born: now, last: now, ip: req ? remoteIp(req) : '', ua: req ? uaName(req.headers['user-agent']) : '' }); sessDirty = true;
    if (sessions.size > 500) for (const [k, v] of sessions) if (now - v.last > idleMs(cfg) || sessions.size > 500) sessions.delete(k);
    saveSessions(); return token;
  }
  const sessionTimer = setInterval(() => { const now = Date.now(), cfg = config.get(); for (const [k, v] of sessions) if (now - v.last > idleMs(cfg) || now - v.born > maxMs(cfg)) { sessions.delete(k); sessDirty = true; } saveSessions(); }, 60000); sessionTimer.unref?.();
  const isLoopbackIp = (ip) => ip === '127.0.0.1' || ip === '::1';
  /** a password hash made with older, cheaper settings is replaced by a current one right after a right password (other sessions stay signed in) */
  async function rehash(user, pass, cfg) {
    try {
      const before = authVersion(config.get());
      if (user === 'admin') { if (needsRehash(cfg.adminPasswordHash)) config.update({ adminPasswordHash: await hashPw(pass) }); }
      else { const u = users.find(user); if (u && needsRehash(u.hash)) { u.hash = await hashPw(pass); users.save(); } }
      // a silent hash upgrade is not a password change: sessions that were valid before stay valid (1.49: signing in on a second PC no longer signs the first one out)
      const after = authVersion(config.get());
      if (after !== before) { for (const se of sessions.values()) if (se.ver === before) se.ver = after; sessDirty = true; saveSessions(); }
    } catch { /* the old hash keeps working */ }
  }
  /** { status: 'ok' | 'denied' | 'locked', who } — who has .perms (a Set) */
  async function checkAuth(req, cfg) {
    if (!cfg.adminPasswordHash && !users.enabled) return { status: 'ok', who: ANON };
    const tok = cookieOf(req);
    if (tok) {
      const k = sha(tok), se = sessions.get(k), now = Date.now();
      if (se && now - se.last <= idleMs(cfg) && now - se.born <= maxMs(cfg) && se.ver === authVersion(cfg)) {
        const who = se.name === 'admin' ? UserStore.adminIdentity() : users.identity(se.name);
        if (who) { if (now - se.last > 300000) sessDirty = true; se.last = now; return { status: 'ok', who, session: k }; }
      }
      if (se) sessions.delete(k);
    }
    const hdr = req.headers.authorization || '';
    // HTTP Basic stays for scripts and tools, but a browser never uses it (it would survive "sign out" as a saved login)
    if (!hdr.startsWith('Basic ') || req.headers['sec-fetch-site']) return { status: 'denied' };
    const ip = remoteIp(req);
    const key = crypto.createHash('sha256').update(hdr).update('\0').update(cfg.adminPasswordHash || '').update('\0').update(String(users.version)).digest('hex');
    const hit = authCache.get(key);
    if (hit && hit.exp > Date.now()) {
      const who = hit.name === 'admin' ? UserStore.adminIdentity() : users.identity(hit.name);
      if (who) return { status: 'ok', who };
    }
    if (guard.locked(ip)) return { status: 'locked' };
    const decoded = Buffer.from(hdr.slice(6), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    const user = (i < 0 ? decoded : decoded.slice(0, i)).trim().toLowerCase(), pass = i < 0 ? '' : decoded.slice(i + 1);
    let ok = false;
    if (user === 'admin') ok = !!cfg.adminPasswordHash && await verifyPassword(pass, cfg.adminPasswordHash);
    else ok = await users.verify(user, pass);
    if (ok && twofa.has(user)) ok = false;   // two-factor accounts sign in on the web page only (a script cannot type a code)
    if (ok && !isLoopbackIp(ip) && acct.locked(user, policy())) ok = false;
    if (ok) {
      guard.success(ip); authCache.set(key, { exp: Date.now() + 300000, name: user });
      if (authCache.size > 200) for (const [k, v] of authCache) if (v.exp < Date.now()) authCache.delete(k);
      return { status: 'ok', who: user === 'admin' ? UserStore.adminIdentity() : users.identity(user) };
    }
    guard.fail(ip); acct.fail(user, policy()); return { status: 'denied' };
  }

  // ---- remote probes: packets forwarded by a NetEventPro probe running in another network ----
  /** the probe a request belongs to (Bearer token, allowed address, switched on), or null after the answer was sent */
  function probeAuth(req, res, cfg) {
    if (req.method !== 'POST') { json(res, { error: 'POST only' }, 405); return null; }
    const ip = remoteIp(req); if (guard.locked(ip)) { json(res, { error: 'Too many failed attempts. Try again in 5 minutes.' }, 429, { 'retry-after': '300' }); return null; }
    const m = /^Bearer\s+(\S{10,300})$/.exec(req.headers.authorization || '');
    const pr = m && probes.find(m[1]);
    if (!pr) { guard.fail(ip); json(res, { error: 'Unknown probe token' }, 401); return null; }
    if (pr.enabled === false) { json(res, { error: 'This probe is switched off on the server' }, 403); return null; }
    if ((pr.allow || []).length) { const f = new SourceFilter(); f.load(pr.allow); if (!f.allows(ip)) { audit({ name: 'probe' }, `refused "${pr.name}": its token came from ${ip}, which is not in its allowed addresses`); json(res, { error: 'This address is not allowed for this probe' }, 403); return null; } }
    if (cfg.mode === 'probe') { json(res, { error: 'This computer is itself a probe' }, 409); return null; }
    return pr;
  }
  /** SNMP polling through a probe: it asks for its devices and jobs, and sends its results */
  async function probePoll(req, res, cfg, kind) {
    const pr = probeAuth(req, res, cfg); if (!pr) return; const b = await readJson(req, 12e6);
    if (kind === 'cfg') { probes.note(pr, 0, remoteIp(req)); return json(res, polling.pollConfigFor(pr.id)); }
    const n = polling.ingestFromProbe(pr.id, b.results, b.tasks); probes.note(pr, 0, remoteIp(req)); return json(res, { ok: true, accepted: n });
  }
  /** a probe asks whether this server has a newer program version for it (1.49). The package is the signed one this server was updated with; the probe checks the signature itself. */
  async function probeUpdate(req, res, cfg, kind) {
    const pr = probeAuth(req, res, cfg); if (!pr) return; const b = await readJson(req, 65536);
    const off = cfg.update?.autoProbes === false, nw = require('./update').newer, pv = String(b.version || '0.0.0');
    if (off || !nw(updater.version, pv)) return json(res, { available: false, off });
    const pk = updater.probePackage(), pub = updater.cfg.publicKey;
    if (pk) {   // this server was updated online: the signed package
      if (kind === 'info') return json(res, { available: true, version: pk.meta.version, sha256: pk.meta.sha256, sig: pk.meta.sig, publicKey: pub, size: pk.zip.length });
      audit({ name: 'probe' }, `sent version ${pk.meta.version} (signed package) to probe "${pr.name}" (it runs ${str(b.version, 20)})`);
      return json(res, { version: pk.meta.version, data: pk.zip.toString('base64') });
    }
    // 1.50: this server was updated from the installer (no internet): its own program files are the update
    const ob = updater.ownBundle();
    if (kind === 'info') return json(res, { available: true, unsigned: true, version: ob.version, sha256: ob.sha256, size: ob.blob.length });
    audit({ name: 'probe' }, `sent version ${ob.version} (program files of this server) to probe "${pr.name}" (it runs ${str(b.version, 20)})`);
    return json(res, { version: ob.version, unsigned: true, data: ob.blob.toString('base64') });
  }
  async function probeIngest(req, res, cfg) {
    const pr = probeAuth(req, res, cfg); if (!pr) return; const ip = remoteIp(req);
    const b = await readJson(req, 12e6); const items = Array.isArray(b.items) ? b.items.slice(0, 2000) : [];
    let n = 0; const now = Date.now();
    for (const it of items) {
      if (!it || typeof it.b !== 'string' || typeof it.ip !== 'string' || !/^[0-9a-fA-F:.]{2,45}$/.test(it.ip)) continue;
      const buf = Buffer.from(it.b, 'base64'); if (!buf.length || buf.length > 8192) continue;
      const t = Number.isFinite(+it.t) && +it.t > 0 && +it.t <= now + 60000 ? Math.round(+it.t) : now, opts = { ts: t, via: pr.name };
      if (it.k === 't') { if (cfg.snmp?.enabled !== false) traps.onPacket(buf, it.ip, null, { ...opts, fromProbe: true }); } else engine.handlePacket(buf, it.ip, 'probe', opts);
      n++;
    }
    probes.note(pr, n, ip);
    return json(res, { ok: true, accepted: n });
  }

  // ---- HTTP handler --------------------------------------------------------
  const handler = async (req, res) => {
    try {
      const cfg = config.get();
      const url = new URL(req.url, 'http://localhost');
      const q = Object.fromEntries(url.searchParams);

      // who may open the dashboard (Settings → Access → Security). This computer itself is always allowed, so a wrong list can be fixed on the server.
      const pol = policy();
      if (state.https && pol.hsts) res.setHeader('strict-transport-security', 'max-age=31536000');
      if (pol.webAllow.length && !url.pathname.startsWith('/api/probe/p') && url.pathname !== '/api/probe/ingest') { const rip = remoteIp(req); if (!isLoopbackIp(rip) && !webFilter.allows(rip)) return send(res, 403, 'This address is not allowed to open the dashboard'); }
      // DNS-rebinding protection while the dashboard is only reachable from this computer
      if (isLoopback(state.bind)) {
        const host = (req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
        if (!['localhost', '127.0.0.1', '::1'].includes(host)) return send(res, 403, 'Forbidden host');
      }
      // Browsers say where a request came from. The dashboard only ever calls its own API, so refuse API calls started by
      // another website or by another local web app (same site, different port): they could otherwise make this service
      // build a full database copy or run a huge export without anyone asking. ("none" = typed in the address bar.)
      const site = req.headers['sec-fetch-site'];
      if (url.pathname.startsWith('/api/') && site && site !== 'same-origin' && site !== 'none') return send(res, 403, 'Cross-site request refused');
      // sign-in and sign-out are handled before the normal check: the sign-in page posts here
      if (url.pathname === '/api/login' || url.pathname === '/api/logout') {
        if (req.method !== 'POST' || !XRW.has(req.headers['x-requested-with'])) return send(res, 405, 'Method not allowed');
        if (url.pathname === '/api/logout') { const t = cookieOf(req); if (t) { const se = sessions.get(sha(t)); if (se) audit({ name: se.name }, `signed out (${se.ip || 'unknown address'})`); sessions.delete(sha(t)); sessDirty = true; saveSessions(); } return json(res, { ok: true }, 200, { 'set-cookie': sessionCookie('', 0) }); }
        if (!cfg.adminPasswordHash && !users.enabled) return json(res, { ok: true });
        const ip = remoteIp(req); if (guard.locked(ip)) return json(res, { error: 'Too many failed attempts. Try again in 5 minutes.' }, 429, { 'retry-after': '300' });
        const b = await readJson(req); const user = String(b.username || '').trim().toLowerCase(), pass = String(b.password || ''), code = String(b.code || ''), pol2 = policy();
        const until = isLoopbackIp(ip) ? 0 : acct.locked(user, pol2);   // the server's own console can always try (that is how a locked-out admin gets back in)
        if (until) return json(res, { error: `This account is locked after too many wrong attempts. Try again in ${Math.max(1, Math.ceil((until - Date.now()) / 60000))} minutes.` }, 429, { 'retry-after': String(Math.ceil((until - Date.now()) / 1000)) });
        let ok = false;
        if (user === 'admin') ok = !!cfg.adminPasswordHash && await verifyPassword(pass, cfg.adminPasswordHash);
        else if (user) ok = await users.verify(user, pass);
        if (!ok) { guard.fail(ip); acct.fail(user, pol2); audit({ name: cleanName(user) || '?' }, `failed sign-in from ${ip}`); return json(res, { error: 'Wrong user name or password.' }, 401); }
        if (twofa.has(user)) {
          if (!code) return json(res, { need2fa: true });
          const kind = twofa.check(user, code);
          if (!kind) { guard.fail(ip); acct.fail(user, pol2); audit({ name: user }, `failed two-factor code from ${ip}`); return json(res, { error: 'That code is not correct, or it was already used.', need2fa: true }, 401); }
          if (kind === 'recovery') audit({ name: user }, `signed in with a recovery code (${twofa.recoveryLeft(user)} left)`);
        }
        guard.success(ip); acct.success(user); audit({ name: user }, `signed in from ${ip}`);
        await rehash(user, pass, cfg);
        return json(res, { ok: true }, 200, { 'set-cookie': sessionCookie(newSession(user, config.get(), req), cookieAge(cfg)) });
      }
      // a remote probe sends its packets here with its own token (no dashboard sign-in, no cookies)
      if (url.pathname === '/api/probe/ingest') return await probeIngest(req, res, cfg);
      if (url.pathname === '/api/probe/selfupdate') return await probeUpdate(req, res, cfg, 'info');
      if (url.pathname === '/api/probe/selfupdatepkg') return await probeUpdate(req, res, cfg, 'pkg');
      if (url.pathname === '/api/probe/pollcfg') return await probePoll(req, res, cfg, 'cfg');
      if (url.pathname === '/api/probe/pollresults') return await probePoll(req, res, cfg, 'results');
      const auth = await checkAuth(req, cfg);
      if (auth.status === 'locked') return send(res, 429, 'Too many failed sign-in attempts. Try again in 5 minutes.', 'text/plain; charset=utf-8', { 'retry-after': '300' });
      if (auth.status !== 'ok') {
        // no "WWW-Authenticate" header: that is what makes a browser pop up its own login box. The page shows its own sign-in form instead.
        if (url.pathname.startsWith('/api/')) return json(res, { error: 'Sign in required', login: true }, 401);
        if (url.pathname === '/login.js' || url.pathname === '/style.css') return serveStatic(req, res, url.pathname);
        return serveStatic(req, res, '/login.html', { 'cache-control': 'no-store' });
      }
      // CSRF guard: a custom header cannot be added by a cross-site form or by a cross-origin request without a CORS pre-flight (which is never granted)
      if (req.method !== 'GET' && req.method !== 'HEAD' && !XRW.has(req.headers['x-requested-with'])) return send(res, 403, 'Missing X-Requested-With header');

      req.who = auth.who; req.sessionKey = auth.session;
      if (url.pathname.startsWith('/api/')) return await api(req, res, url, q);
      return serveStatic(req, res, url.pathname);
    } catch (e) {
      if (e instanceof HttpError) return json(res, { error: e.message }, e.code);
      if (e && e.userFacing) return json(res, { error: e.message }, e.status || 503);
      console.error('[http]', e);
      if (!res.headersSent) json(res, { error: 'Internal error — see the service log' }, 500);
      else res.end();
    }
  };

  const CONFIG_KEY_PERM = { rules: 'rules', maintenance: 'rules', uiPrefs: 'customize', reports: 'reports', backup: 'backup' };   // every other setting needs "settings"
  async function api(req, res, url, q) {
    const p = url.pathname;
    const cfg = config.get();
    const who = req.who || ANON;
    const need = (perm) => { if (!who.perms.has(perm)) throw new HttpError(403, `Your account is not allowed to do this (it needs the "${perm}" permission).`); };
    const meInfo = () => ({ name: who.name, fullName: who.fullName, roles: who.roleNames, perms: [...who.perms], builtin: !!who.builtin, anonymous: !!who.anonymous, twofa: twofa.has(who.name), need2fa: !who.anonymous && policy().require2fa && !twofa.has(who.name) });
    const POST = req.method === 'POST';

    // ---- SNMP polling (1.46) ----
    if (p.startsWith('/api/poll/')) {
      need('polling');   // 1.49: SNMP polling belongs to the Administrator (or a role that was given this permission)
      const wrap = (fn) => { try { return fn(); } catch (e) { if (e.status) throw new HttpError(e.status, e.message); throw e; } };
      if (p === '/api/poll/overview' && req.method === 'GET') { need('polling'); return json(res, polling.overview()); }
      if (p === '/api/poll/devices' && req.method === 'GET') { need('polling'); return json(res, { devices: polling.devices().map((d) => polling.mask(d)), profiles: polling.profiles().filter((x) => !x.own).map((x) => ({ id: x.id, name: x.name })), probes: (cfg.probes || []).map((x) => ({ id: x.id, name: x.name })) }); }
      if (p === '/api/poll/device' && req.method === 'GET') { need('polling'); const d = polling.detail(url.searchParams.get('id') || ''); if (!d) throw new HttpError(404, 'No such device.'); return json(res, d); }
      if (p === '/api/poll/catalog' && req.method === 'GET') { need('polling'); return json(res, polling.pollCatalog()); }
      if (p === '/api/poll/tile' && req.method === 'POST') { need('polling'); const b = await readJson(req); return json(res, polling.pollTile(b)); }
      if (p === '/api/poll/series' && req.method === 'GET') {
        need('polling'); const id = url.searchParams.get('id') || '', k = str(url.searchParams.get('k'), 40), inst = str(url.searchParams.get('inst'), 200), hours = Math.min(24 * 365, Math.max(1, +url.searchParams.get('hours') || 24)), to = Date.now();
        if (!polling.devices().some((d) => d.id === id)) throw new HttpError(404, 'No such device.');
        return json(res, { k, inst, from: to - hours * 3600000, to, points: polling.series(id, k, inst, to - hours * 3600000, to, 300), ...polling.metricInfo(k) });
      }
      if (p === '/api/poll/report' && req.method === 'GET') { need('polling'); return json(res, polling.summary(+url.searchParams.get('hours') || 24)); }
      if (p === '/api/poll/export' && req.method === 'GET') {
        need('polling'); need('export'); const id = url.searchParams.get('id') || '', text = polling.csv(+url.searchParams.get('hours') || 24, id); if (text === null) throw new HttpError(404, 'No such device.');
        audit(who, id ? 'exported SNMP polling readings of a device (CSV)' : 'exported the SNMP polling summary (CSV)');
        res.writeHead(200, { ...SEC_HEADERS, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="NetEventPro-polling${id ? '-readings' : '-summary'}.csv"`, 'cache-control': 'no-store' }); return res.end(text);
      }
      if (p === '/api/poll/mibobjects' && req.method === 'GET') { need('polling'); const r = mibs.readings(str(url.searchParams.get('q'), 100), clampInt(url.searchParams.get('limit'), 1, 500, 100), { file: str(url.searchParams.get('file'), 80), entry: str(url.searchParams.get('entry'), 120), offset: clampInt(url.searchParams.get('offset'), 0, 1e7, 0) }); if (url.searchParams.get('files')) r.files = mibs.readingFiles(); return json(res, r); }
      if (p === '/api/poll/keys' && req.method === 'GET') { need('polling'); return json(res, { keys: polling.keyList() }); }
      if (p === '/api/poll/devices' && POST) {
        need('polling'); const b = await readJson(req); const d = wrap(() => polling.saveDevice(b));
        audit(who, `${b.id ? 'changed' : 'added'} the polled device "${d.name}" (${d.host}, SNMP ${d.version})`); return json(res, { ok: true, id: d.id });
      }
      if (p === '/api/poll/delete' && POST) { need('polling'); const b = await readJson(req), d = polling.deleteDevice(String(b.id || '')); if (!d) throw new HttpError(404, 'No such device.'); audit(who, `removed the polled device "${d.name}"`); return json(res, { ok: true }); }
      if (p === '/api/poll/discover' && POST) { need('polling'); const b = await readJson(req); const id = wrap(() => polling.startDiscovery(b)); audit(who, `started an SNMP discovery of ${str(b.ranges, 120)}`); return json(res, { id }); }
      if (p === '/api/poll/discover' && req.method === 'GET') { need('polling'); const st = polling.discoveryStatus(url.searchParams.get('id') || ''); if (!st) throw new HttpError(404, 'No such discovery.'); return json(res, st); }
      if (p === '/api/poll/discover/stop' && POST) { need('polling'); const b = await readJson(req); polling.stopDiscovery(String(b.id || '')); return json(res, { ok: true }); }
      if (p === '/api/poll/discover/add' && POST) { need('polling'); const b = await readJson(req); const n = wrap(() => polling.addDiscovered(String(b.id || ''), (Array.isArray(b.hosts) ? b.hosts : []).map(String).slice(0, 1024), { site: str(b.site, 60), intervalSec: clampInt(b.intervalSec, 10, 3600, 60) })); audit(who, `added ${n} polled device${n === 1 ? '' : 's'} from a discovery`); return json(res, { ok: true, added: n }); }
      if (p === '/api/poll/test' && POST) { need('polling'); const b = await readJson(req); return json(res, await polling.testDevice(b)); }
      if (p === '/api/poll/now' && POST) { need('polling'); const b = await readJson(req); if (!polling.pollNow(String(b.id || ''))) throw new HttpError(404, 'No such device.'); return json(res, { ok: true }); }
      if (p === '/api/poll/interfaces' && POST) { need('polling'); const b = await readJson(req); if (!polling.setInterfaces(String(b.id || ''), b.selected, b.mode)) throw new HttpError(404, 'No such device.'); audit(who, `changed the monitored interfaces of a polled device`); return json(res, { ok: true }); }
      if (p === '/api/poll/settings' && req.method === 'GET') { need('polling'); return json(res, polling.publicSettings()); }
      if (p === '/api/poll/settings' && POST) { need('polling'); const b = await readJson(req); polling.saveSettings(b); audit(who, 'changed the SNMP polling settings'); return json(res, { ok: true }); }
      if (p === '/api/poll/profiles' && req.method === 'GET') { need('polling'); return json(res, { profiles: polling.profiles().filter((x) => !x.own), off: polling.cfg.profileOff || {} }); }
      if (p === '/api/poll/profiles' && POST) { need('polling'); const b = await readJson(req); const out = polling.saveProfiles(b.profiles, b.off); audit(who, `saved the SNMP polling profiles (${out.length} custom)`); return json(res, { ok: true }); }
      if (p === '/api/poll/readings' && req.method === 'GET') { need('polling'); const r = polling.readingsInfo(url.searchParams.get('id') || ''); if (!r) throw new HttpError(404, 'No such device.'); return json(res, { ...r, notifProfiles: (cfg.notifProfiles || []).map((x) => ({ id: x.id, name: x.name })) }); }
      if (p === '/api/poll/readings' && POST) { need('polling'); const b = await readJson(req); const out = wrap(() => polling.saveReadings(String(b.id || ''), b.readings)); audit(who, `saved the SNMP readings of a polled device (${out.length})`); return json(res, { ok: true, readings: out }); }
      if (p === '/api/poll/readings/test' && POST) { need('polling'); const b = await readJson(req); return json(res, await wrap(() => polling.testReading(String(b.id || ''), b.reading))); }
      if (p === '/api/poll/lookups/items' && POST) { need('polling'); const b = await readJson(req); return json(res, { items: polling.itemsFromEnums(b.enums) }); }
      if (p === '/api/poll/layout' && POST) { need('polling'); const b = await readJson(req); const l = wrap(() => polling.saveLayout(String(b.id || ''), b.layout)); return json(res, { ok: true, layout: l }); }
      if (p === '/api/poll/readings/copy' && POST) { need('polling'); const b = await readJson(req); const r = wrap(() => polling.copyReadings(String(b.id || ''), String(b.from || ''), !!b.replace)); audit(who, `copied ${r.count} SNMP readings to a polled device`); return json(res, { ok: true, ...r }); }
      if (p === '/api/poll/templates' && req.method === 'GET') { need('polling'); return json(res, { templates: polling.templates() }); }
      if (p === '/api/poll/templates' && POST) { need('polling'); const b = await readJson(req); const id = wrap(() => polling.saveTemplate(b.name, b.from ? String(b.from) : '', b.id ? String(b.id) : '')); audit(who, `saved the SNMP readings template "${str(b.name, 60)}"`); return json(res, { ok: true, id }); }
      if (p === '/api/poll/templates/delete' && POST) { need('polling'); const b = await readJson(req); if (!polling.deleteTemplate(String(b.id || ''))) throw new HttpError(404, 'No such template.'); audit(who, 'deleted an SNMP readings template'); return json(res, { ok: true }); }
      if (p === '/api/poll/lookups' && req.method === 'GET') { need('polling'); return json(res, { lookups: polling.lookups().filter((l) => !l.owner), tell: polling.lookupTell(), notifProfiles: (cfg.notifProfiles || []).map((x) => ({ id: x.id, name: x.name })) }); }
      if (p === '/api/poll/lookups' && POST) { need('polling'); const b = await readJson(req); const out = polling.saveLookups(b.lookups); if (Array.isArray(b.tell)) polling.setLookupTell(b.tell); audit(who, `saved the SNMP polling lookups (${out.filter((x) => !x.builtin).length} own)`); return json(res, { ok: true, lookups: out }); }
      if (p === '/api/poll/lookups/fromenums' && POST) { need('polling'); const b = await readJson(req); const id = polling.lookupFromEnums(b.name, b.enums); return json(res, { ok: !!id, id }); }
      if (p === '/api/poll/thresholds' && req.method === 'GET') { need('polling'); return json(res, { thresholds: (polling.cfg.thresholds || []).filter((t) => !t.owner), keys: polling.keyList(), notifProfiles: (cfg.notifProfiles || []).map((x) => ({ id: x.id, name: x.name })) }); }
      if (p === '/api/poll/thresholds' && POST) { need('polling'); const b = await readJson(req); const out = polling.saveThresholds(b.thresholds); audit(who, `saved the SNMP polling thresholds (${out.length})`); return json(res, { ok: true }); }
      throw new HttpError(404, 'Unknown request.');
    }
    if (p === '/api/probes' && req.method === 'GET') { need('settings'); return json(res, { probes: probes.list(), local: probe.status() }); }
    if (p === '/api/probe/status') return json(res, probe.status());
    if (p === '/api/probes' && POST) {
      need('settings'); const b = await readJson(req), name = str(b.name, 60); if (!name) throw new HttpError(400, 'Give the probe a name (for example the site it is in).');
      if ((cfg.probes || []).some((x) => x.name.toLowerCase() === name.toLowerCase())) throw new HttpError(400, 'A probe with this name already exists.');
      if ((cfg.probes || []).length >= 100) throw new HttpError(400, 'At most 100 probes.');
      const r = probes.create(name); audit(who, `added the probe "${name}"`); return json(res, r);
    }
    { const m2 = /^\/api\/probes\/([\w-]+)\/(rotate|allow)$/.exec(p);
      if (m2 && POST) {
        need('settings'); const hit = (cfg.probes || []).find((x) => x.id === m2[1]); if (!hit) throw new HttpError(404, 'No such probe.');
        if (m2[2] === 'rotate') { const r = probes.rotate(hit.id); audit(who, `created a new token for the probe "${hit.name}" (the old one works 24 more hours)`); return json(res, r); }
        const b = await readJson(req), list = (Array.isArray(b.allow) ? b.allow : String(b.allow || '').split(/[\s,;]+/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 50);
        const bad = SourceFilter.validate(list); if (bad.length) throw new HttpError(400, `Not an IP address or range: ${bad.slice(0, 3).join(', ')}`);
        probes.setAllow(hit.id, list); audit(who, `set the allowed addresses of the probe "${hit.name}" to ${list.join(', ') || 'any'}`); return json(res, { ok: true, allow: list });
      } }
    { const m = /^\/api\/probes\/([\w-]+)$/.exec(p);
      if (m && (req.method === 'DELETE' || req.method === 'PATCH')) {
        need('settings'); const hit = (cfg.probes || []).find((x) => x.id === m[1]); if (!hit) throw new HttpError(404, 'No such probe.');
        if (req.method === 'DELETE') { probes.remove(hit.id); audit(who, `removed the probe "${hit.name}"`); } else { const b = await readJson(req); probes.setEnabled(hit.id, b.enabled !== false); audit(who, `${b.enabled !== false ? 'enabled' : 'disabled'} the probe "${hit.name}"`); }
        return json(res, { ok: true });
      } }
    if (p === '/api/sessions' && req.method === 'GET') {
      need('settings'); const now = Date.now(), mine = req.sessionKey;
      const list = [...sessions].map(([k, v]) => ({ id: k.slice(0, 16), user: v.name, ip: v.ip || '', browser: v.ua || '', since: v.born, last: v.last, online: now - v.last < 120000, me: k === mine })).sort((a, b) => b.last - a.last);
      const live = [...clients].map((c) => ({ ip: c.ip, user: c.user, browser: c.ua, since: c.since }));
      return json(res, { signIn: !!(cfg.adminPasswordHash || users.enabled), sessions: list, live, now });
    }
    if (p === '/api/sessions/revoke' && POST) {
      need('settings'); const b = await readJson(req), id = String(b.id || ''); const hit = [...sessions].find(([k]) => k.slice(0, 16) === id);
      if (!hit) throw new HttpError(404, 'That session is already gone.');
      sessions.delete(hit[0]); sessDirty = true; saveSessions(); audit(who, `signed out ${hit[1].name} (${hit[1].ip || 'unknown address'}) by force`);
      for (const c of [...clients]) if (c.sessionKey === hit[0]) { try { c.res.destroy(); } catch { /* closed */ } clients.delete(c); }
      return json(res, { ok: true });
    }
    if (p === '/api/me') return json(res, meInfo());
    if (p === '/api/me/password' && POST) {
      if (who.anonymous) throw new HttpError(400, 'Sign-in is not turned on, so there is no password to change.');
      const b = await readJson(req), cur = String(b.current ?? ''), pw = String(b.password ?? '');
      if (who.builtin) {
        if (!(await verifyPassword(cur, cfg.adminPasswordHash))) throw new HttpError(403, 'The current password is not correct.');
        { const bad = secmod.passwordProblem(pw, policy(), 'admin'); if (bad) throw new HttpError(400, bad); }
        config.update({ adminPasswordHash: await hashPassword(pw) }); audit(who, 'changed the administrator password');
      } else {
        if (!(await users.verify(who.name, cur))) throw new HttpError(403, 'The current password is not correct.');
        await users.setPassword(who.name, pw, (x, n) => secmod.passwordProblem(x, policy(), n)); audit(who, 'changed their own password');
      }
      authCache.clear(); return json(res, { ok: true });
    }
    // ---- security: policy, two-factor, audit log ----
    if (p === '/api/security' && req.method === 'GET') {
      need('settings');
      return json(res, { policy: policy(), accounts: users.data.users.map((u) => ({ name: u.name, twofa: twofa.has(u.name), disabled: !!u.disabled, lastLogin: u.lastLogin || 0 })).concat([{ name: 'admin', twofa: twofa.has('admin'), disabled: false, lastLogin: 0, builtin: true }]), locked: acct.list(), me: { twofa: twofa.has(who.name), recoveryLeft: twofa.recoveryLeft(who.name), anonymous: !!who.anonymous }, signIn: !!(cfg.adminPasswordHash || users.enabled), yourIp: remoteIp(req) });
    }
    if (p === '/api/security' && POST) {
      need('settings'); const b = await readJson(req), np = secmod.cleanPolicy(b.policy, policy());
      const badIps = SourceFilter.validate(np.webAllow); if (badIps.length) throw new HttpError(400, `Not an IP address or range: ${badIps.slice(0, 3).join(', ')}`);
      const f = new SourceFilter(); f.load(np.webAllow); const me = remoteIp(req);
      if (np.webAllow.length && !isLoopbackIp(me) && !f.allows(me)) throw new HttpError(400, `Your own address (${me}) is not in the list, so you would lock yourself out. Add it first.`);
      if (np.hsts && !state.https) throw new HttpError(400, 'HSTS needs the dashboard to run on HTTPS first (Settings → Access → HTTPS).');
      config.update({ security: np }); audit(who, 'changed the security settings'); return json(res, { ok: true, policy: np });
    }
    if (p === '/api/security/unlock' && POST) { need('settings'); const b = await readJson(req); acct.unlock(String(b.name || '').toLowerCase()); audit(who, `unlocked the account ${cleanName(b.name)}`); return json(res, { ok: true }); }
    if (p === '/api/me/2fa/start' && POST) {
      if (who.anonymous) throw new HttpError(400, 'Turn sign-in on first (Settings → Access → Password).');
      const secret = secmod.newSecret(); pending2fa.set(who.name, { secret, t: Date.now() });
      return json(res, { secret, uri: secmod.otpauthUri(secret, who.name) });
    }
    if (p === '/api/me/2fa/enable' && POST) {
      const b = await readJson(req), pend = pending2fa.get(who.name);
      if (!pend || Date.now() - pend.t > 15 * 60000) throw new HttpError(400, 'Start again: the setup code expired.');
      const codes = twofa.enable(who.name, pend.secret, String(b.code || '')); if (!codes) throw new HttpError(400, 'That code is not correct. Check the phone clock and try the next code.');
      pending2fa.delete(who.name); audit(who, 'turned on two-factor sign-in'); return json(res, { ok: true, codes });
    }
    if (p === '/api/me/2fa/disable' && POST) {
      const b = await readJson(req), pw = String(b.password || '');
      const good = who.builtin ? await verifyPassword(pw, cfg.adminPasswordHash) : await users.verify(who.name, pw);
      if (!good) throw new HttpError(403, 'The password is not correct.');
      twofa.disable(who.name); audit(who, 'turned off two-factor sign-in'); return json(res, { ok: true });
    }
    if (p === '/api/security/2fa-reset' && POST) {
      need('users'); const b = await readJson(req), n = String(b.name || '').toLowerCase();
      if (n === 'admin' && !who.builtin) throw new HttpError(403, 'Only the built-in administrator can reset its own two-factor sign-in.');
      twofa.disable(n); audit(who, `reset two-factor sign-in for ${cleanName(n)}`); return json(res, { ok: true });
    }
    if (p === '/api/audit' && req.method === 'GET') {
      need('settings'); const limit = Math.min(Math.max(+q.limit || 300, 1), 5000);
      const rows = await store.query({ trap: 'audit', from: q.from, to: q.to, text: q.text }, limit);
      if (q.format === 'csv') {
        const esc2 = (x) => { const t = String(x ?? ''); return /^[=+\-@]/.test(t) ? "'" + t : t; }, csv = (x) => '"' + esc2(x).replace(/"/g, '""') + '"';
        res.writeHead(200, { ...SEC_HEADERS, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="NetEventPro-audit.csv"', 'cache-control': 'no-store' });
        return res.end('\ufeffTime,Who and what\r\n' + rows.map((r) => `${csv(new Date(r.ts).toISOString())},${csv(r.message)}`).join('\r\n') + '\r\n');
      }
      return json(res, { rows: rows.map((r) => ({ id: r.id, ts: r.ts, text: r.message })) });
    }
    if (p === '/api/users' || p.startsWith('/api/users/')) {
      need('users');
      if (p === '/api/users' && req.method === 'GET') return json(res, { ...users.publicView(), adminEnabled: !!cfg.adminPasswordHash });
      if (p === '/api/users' && POST) {
        if (!cfg.adminPasswordHash) throw new HttpError(400, 'Set the dashboard password first (Settings → Dashboard access). Without it nobody has to sign in, so users would have no effect.');
        { const before = users.data.users.map((u) => u.name); await users.replace(await readJson(req), (x, n) => secmod.passwordProblem(x, policy(), n)); const after = users.data.users.map((u) => u.name); authCache.clear();
          for (const n of after.filter((x) => !before.includes(x))) audit(who, `added the user ${n}`); for (const n of before.filter((x) => !after.includes(x))) { twofa.disable(n); audit(who, `removed the user ${n}`); }
          audit(who, 'saved users, roles and groups'); }
        return json(res, { ...users.publicView(), adminEnabled: true });
      }
      if (p === '/api/users/password' && POST) {
        const b = await readJson(req), name = String(b.name ?? '').toLowerCase(), pw = String(b.password ?? '');
        if (name === 'admin') {
          if (!who.builtin) throw new HttpError(403, 'Only the built-in administrator can change its own password.');
          { const bad = secmod.passwordProblem(pw, policy(), 'admin'); if (bad) throw new HttpError(400, bad); }
          config.update({ adminPasswordHash: await hashPassword(pw) }); audit(who, 'changed the administrator password');
        } else { await users.setPassword(name, pw, (x, n) => secmod.passwordProblem(x, policy(), n)); audit(who, `set a new password for ${name}`); }
        authCache.clear(); return json(res, { ok: true });
      }
      return json(res, { error: 'not found' }, 404);
    }
    if (['/api/stream', '/api/state', '/api/stats', '/api/devices', '/api/health', '/api/health/history', '/api/dash', '/api/logs'].includes(p) || p.startsWith('/api/log/') || (p === '/api/config' && req.method === 'GET')) need('view');
    if (p === '/api/reports' && req.method === 'GET') { need('reports'); return json(res, { reports: maskReports(cfg.reports), status: Object.fromEntries((cfg.reports || []).map((r) => [r.id, reports.statusOf(r.id)])), periods: PERIODS, smtpReady: !!(cfg.smtp?.host && cfg.smtp?.from) }); }
    if (p === '/api/reports/run' && POST) {
      need('reports'); const b = await readJson(req); const def = (cfg.reports || []).find((r) => r.id === b.id);
      if (!def) throw new HttpError(404, 'Save the report first, then run it.');
      if (['csv', 'xlsx', 'pdf'].includes(b.download)) {
        const r = await reports.run({ ...def, formats: [b.download] }, { deliver: false }); const f = r.files[0];
        res.writeHead(200, { ...SEC_HEADERS, 'content-type': f.type, 'content-length': f.data.length, 'content-disposition': `attachment; filename="${f.name}"`, 'cache-control': 'no-store' }); return res.end(f.data);
      }
      const r = await reports.run(def, { deliver: true }); return json(res, { ok: r.results.every((x) => x.ok), results: r.results, files: r.files.map((f) => f.name), total: r.summary.total });
    }
    if (p === '/api/reports/test-folder' && POST) { need('reports'); const b = await readJson(req); try { const saved = (cfg.reports || []).find((r) => r.id === b.id)?.folder || {}; return json(res, { ok: true, folder: await testFolder(b.path, String(b.user || '').slice(0, 200), b.password === '********' ? saved.password || '' : String(b.password || '').slice(0, 200)) }); } catch (e) { return json(res, { ok: false, error: e.message }); } }

    if (p.startsWith('/api/backup')) {
      need('backup');
      if (p === '/api/backup' && req.method === 'GET') return json(res, { backups: backups.list(), busy: backups.busy, last: backups.status.last || null, pending: backups.pending, config: { ...cfg.backup, passphrase: cfg.backup?.passphrase ? '********' : '', folderPassword: cfg.backup?.folderPassword ? '********' : '' }, dbBytes: (() => { try { return fs.statSync(store.file).size; } catch { return 0; } })() });
      if (p === '/api/backup/create' && POST) { const b = await readJson(req); const pass = String(b.passphrase || ''); if (pass && pass.length < 8) throw new HttpError(400, 'The passphrase must be at least 8 characters.'); return json(res, { ok: true, ...(await backups.create({ includeDb: b.includeDb !== false, passphrase: pass, folder: '' })) }); }
      if (p === '/api/backup/file' && req.method === 'GET') {
        const file = backups.pathOf(q.name); const st = fs.statSync(file);
        res.writeHead(200, { ...SEC_HEADERS, 'content-type': 'application/octet-stream', 'content-length': st.size, 'content-disposition': `attachment; filename="${q.name}"`, 'cache-control': 'no-store' });
        return void pipeline(fs.createReadStream(file), res).catch(() => {});
      }
      if (p === '/api/backup/delete' && POST) { const b = await readJson(req); backups.remove(String(b.name)); return json(res, { ok: true }); }
      if (p === '/api/backup/inspect' && POST) { const b = await readJson(req); return json(res, await backups.inspect(String(b.name), String(b.passphrase || ''))); }
      if (p === '/api/backup/restore' && POST) { const b = await readJson(req); return json(res, { ok: true, pending: await backups.stageRestore(String(b.name), String(b.passphrase || ''), b.parts) }); }
      if (p === '/api/backup/cancel-restore' && POST) { backups.cancelRestore(); return json(res, { ok: true }); }
      if (p === '/api/backup/upload' && POST) {
        const name = String(req.headers['x-filename'] || 'uploaded.spbak').replace(/[^A-Za-z0-9._-]/g, '_').replace(/\.spbak$/i, '').slice(0, 60) || 'uploaded';
        const dest = path.join(backups.dir, `uploaded-${Date.now().toString(36)}-${name}.spbak`), tmp = dest + '.part'; let size = 0;
        const limit = 200 * 1024 ** 3;
        try {
          await pipeline(req, async function* (src) { for await (const c of src) { size += c.length; if (size > limit) throw new HttpError(413, 'The backup file is too large.'); yield c; } }, fs.createWriteStream(tmp, { mode: 0o600 }));
          fs.renameSync(tmp, dest);
        } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
        try { await backups.inspect(path.basename(dest), 'x'); } catch (e) { if (!/encrypted|passphrase/i.test(e.message)) { fs.rmSync(dest, { force: true }); throw e; } }
        return json(res, { ok: true, name: path.basename(dest) });
      }
      return json(res, { error: 'not found' }, 404);
    }

    // ---- SNMP traps and MIB files ----
    if (p === '/api/snmp' && req.method === 'GET') {
      need('view'); const full = who.perms.has('settings');
      return json(res, { engineId: v3.id, config: full ? { ...cfg.snmp, v3Users: maskV3(cfg.snmp?.v3Users) } : { ...cfg.snmp, communities: [], v3Users: [] }, status: traps.status(), mibs: mibs.list(), stats: mibs.stats(), canManage: full, builtin: ['SNMPv2-MIB', 'IF-MIB'] });
    }
    if (p === '/api/mibs/traps' && req.method === 'GET') { need('view'); return json(res, mibs.catalog(String(q.q || '').slice(0, 100), clampInt(q.limit, 1, 1000, 300))); }
    if (p === '/api/mibs/file' && req.method === 'GET') {
      need('view'); const nm = String(q.name || ''); if (!/^[A-Za-z0-9._-]{1,100}$/.test(nm) || !mibs.files.has(nm)) throw new HttpError(404, 'That MIB file is not loaded.');
      return send(res, 200, fs.readFileSync(path.join(config.dir, 'mibs', nm)), 'text/plain; charset=utf-8', { 'content-disposition': `attachment; filename="${nm}"` });
    }
    if (p === '/api/snmp/test' && req.method === 'POST') {          // sends one linkDown trap to this receiver, so the whole path (port, filters, MIB names, rules, alarms) can be checked without a real device
      need('settings'); const sc = cfg.snmp || {}; if (!sc.enabled) throw new HttpError(400, 'The SNMP receiver is switched off.');
      const ber = require('./ber'), dgram = require('node:dgram');
      const pkt = ber.buildV2({ community: (sc.communities && sc.communities[0]) || 'public', trapOid: '1.3.6.1.6.3.1.1.5.3', uptime: 12345, varbinds: [{ oid: '1.3.6.1.2.1.2.2.1.1.1', type: 'integer', value: 1 }, { oid: '1.3.6.1.2.1.2.2.1.2.1', type: 'octets', value: Buffer.from('TestPort0/1') }, { oid: '1.3.6.1.2.1.2.2.1.7.1', type: 'integer', value: 1 }, { oid: '1.3.6.1.2.1.2.2.1.8.1', type: 'integer', value: 2 }] });
      const tb = await readJson(req).catch(() => ({}));
      if (tb && tb.version === 'v3') {          // SNMPv3 test: built with one of the users set up under SNMPv3 users (this computer is the sending engine)
        const u = (sc.v3Users || []).find((x) => x.name === tb.user) || (sc.v3Users || [])[0];
        if (!u) throw new HttpError(400, 'Add an SNMPv3 user first (Settings → SNMP & MIBs → SNMPv3 users) and save.');
        const vbs = [{ oid: '1.3.6.1.2.1.2.2.1.1.1', type: 'integer', value: 1 }, { oid: '1.3.6.1.2.1.2.2.1.2.1', type: 'octets', value: Buffer.from('TestPort0/1') }, { oid: '1.3.6.1.2.1.2.2.1.7.1', type: 'integer', value: 1 }, { oid: '1.3.6.1.2.1.2.2.1.8.1', type: 'integer', value: 2 }];
        const pdu = ber.pduV2({ uptime: 12345, trapOid: [1, 3, 6, 1, 6, 3, 1, 1, 5, 3], requestId: Math.floor(Math.random() * 1e6) + 1, varbinds: vbs });
        const pkt3 = v3.buildTrap({ user: u.name, level: u.level, authProto: u.authProto, authPass: u.authPass, privProto: u.privProto, privPass: u.privPass }, pdu);
        const sock3 = dgram.createSocket('udp4'); await new Promise((ok, no) => sock3.send(pkt3, sc.port, '127.0.0.1', (e) => (e ? no(e) : ok()))); sock3.close();
        return json(res, { ok: true, note: `A test SNMPv3 linkDown trap was sent to 127.0.0.1 as user "${u.name}" (${u.level || 'noAuthNoPriv'}). It appears on the Traps page with SNMP version v3 (if it does not, the receiver status shows why).` });
      }
      const sock = dgram.createSocket('udp4'); await new Promise((ok, no) => sock.send(pkt, sc.port, '127.0.0.1', (e) => (e ? no(e) : ok()))); sock.close();
      return json(res, { ok: true, note: 'A test linkDown trap was sent to 127.0.0.1. It appears on the Traps page as device 127.0.0.1 (if “Accept syslog only from” is used, 127.0.0.1 must be allowed).' });
    }
    if (p === '/api/mibs/lookup' && req.method === 'GET') { need('view'); return json(res, { result: mibs.lookup(String(q.q || '').slice(0, 300)) }); }
    if (p === '/api/mibs' && req.method === 'POST') {
      need('settings'); const b = await readJson(req, 12e6);
      return json(res, { ok: true, file: mibs.add(String(b.name || ''), b.text), stats: mibs.stats() });
    }
    if (p === '/api/mibs/delete' && req.method === 'POST') {
      need('settings'); const b = await readJson(req);
      if (!mibs.remove(String(b.name || ''))) throw new HttpError(404, 'That MIB file is not loaded.');
      return json(res, { ok: true, stats: mibs.stats() });
    }
    if (p === '/api/snmp/reset-missing' && req.method === 'POST') { need('settings'); traps.unres.clear(); traps.unk.clear(); return json(res, { ok: true }); }

    // ---- alarm console and maintenance windows ----
    if (p === '/api/alarms' && req.method === 'GET') {
      need('view');
      return json(res, { ...alarms.list({ state: String(q.state || 'active'), q: String(q.q || '').slice(0, 100), sevs: parseSevs(q.sevs), limit: clampInt(q.limit, 1, 500, 200), offset: clampInt(q.offset, 0, 1e6, 0), source: String(q.source || ''), since: clampInt(q.since || q.from, 0, 9e15, 0), to: clampInt(q.to, 0, 9e15, 0), sort: String(q.sort || '') }), counts: alarms.counts(), summary: alarms.summary(clampInt(q.since || q.from, 0, 9e15, 0) || (q.since === '0' || q.from === '0' ? 1 : Date.now() - 86400000)), canAct: who.perms.has('alarms') });
    }
    if (p === '/api/alarms/delete-matching' && req.method === 'POST') {
      need('delete'); const b = await readJson(req); const f = Object.fromEntries(new URLSearchParams(String(b.query || '')));
      const n = alarms.removeMatching({ state: String(f.state || 'active'), q: String(f.q || '').slice(0, 100), sevs: parseSevs(f.sevs), source: String(f.source || ''), since: clampInt(f.since || f.from, 0, 9e15, 0), to: clampInt(f.to, 0, 9e15, 0) });
      audit(who, `deleted ${n} alarm record(s) matching a filter`); return json(res, { ok: true, changed: n });
    }
    if (p.startsWith('/api/alarms/') && req.method === 'POST') {
      if (p !== '/api/alarms/delete') need('alarms'); const b = await readJson(req); const by = who.name || 'admin';
      const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
      const note = typeof b.note === 'string' ? b.note.trim().slice(0, 1000) : '';
      if (p === '/api/alarms/ack') return json(res, { ok: true, changed: alarms.ack(ids, by, note) });
      if (p === '/api/alarms/delete') { need('delete'); const n = alarms.remove(ids); audit(who, `deleted ${n} alarm record(s)`); return json(res, { ok: true, changed: n }); }
      if (p === '/api/alarms/clear') return json(res, { ok: true, changed: alarms.clear(ids, by, note) });
      if (p === '/api/alarms/note') { if (!note || !ids.length) throw new HttpError(400, 'Write a note first.'); return json(res, { ok: alarms.note(ids[0], by, note) }); }
      return json(res, { error: 'not found' }, 404);
    }
    if (p === '/api/maintenance' && req.method === 'GET') { need('view'); return json(res, { windows: cfg.maintenance || [], status: maint.status(), now: Date.now() }); }

    if (p === '/api/export') need('export');
    if (p === '/api/db/download') need('backup');
    if (['/api/test-message', '/api/test-webhook', '/api/test-email', '/api/test-replace', '/api/device/forget', '/api/clear', '/api/restart'].includes(p)) need('settings');

    if (p === '/api/stream' && req.method === 'GET') {
      if (clients.size >= MAX_SSE_CLIENTS) return send(res, 503, 'Too many open dashboards');
      res.writeHead(200, { ...SEC_HEADERS, 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      req.socket.setTimeout(0); req.socket.setKeepAlive(true, 15000); req.socket.setNoDelay(true); res.write('retry: 3000\n\n');
      const client = { res, filter: makeLiveFilter(q), ip: remoteIp(req), since: Date.now(), user: req.who?.name || '', sessionKey: req.sessionKey, ua: uaName(req.headers['user-agent']) };
      const backlog = engine.recent(q, Math.min(+q.backlog || 300, 2000));
      res.write(`event: hello\ndata: ${JSON.stringify({ messages: backlog.map(slim), version: VERSION })}\n\n`);
      clients.add(client);
      req.on('close', () => clients.delete(client)); res.on('error', () => clients.delete(client));
      return;
    }

    if (p === '/api/state') return json(res, {
      version: VERSION, now: ntp.now(), clock: (({ server, ...rest }) => (who.perms.has('settings') ? { server, ...rest } : rest))(ntp.info()), platform: process.platform, node: process.version,
      dataDirs: { data: config.dir, db: store.file, config: config.file, rawLogs: path.join(config.dir, 'raw'), serviceLogs: path.join(config.dir, 'logs') }, backupBusy: !!state.backupBusy,
      listeners: { ...listeners.status, snmp: traps.status() }, config: publicConfig(cfg, who.perms.has('settings')), facilities: FACILITIES, severities: SEVERITIES,
      me: meInfo(), authEnabled: !!cfg.adminPasswordHash || users.enabled, https: state.https, webBindActive: state.bind, webWarning: state.webWarning
    });

    if (p === '/api/stats') return json(res, { ...(await engine.statsSnapshot()), alarms: alarms.counts() });
    if (p === '/api/devices') return json(res, engine.deviceList());
    if (p === '/api/health') return json(res, await health.snapshot());
    if (p === '/api/health/history') return json(res, { ...health.history(['15m', '1h', '24h'].includes(q.range) ? q.range : '1h'), machine: health.machine(), disk: health.diskInfo() });
    if (p === '/api/dash' && req.method === 'POST') return json(res, await dashData(await readJson(req)));

    if (p === '/api/rules/test' && POST) {          // how many of the last 24 hours of stored messages would this rule match? (nothing is changed, no alert is sent)
      need('rules'); const b = await readJson(req); const rule = sanitizeRules([b.rule || {}])[0]; delete rule.match.repeat; rule.enabled = true; rule.id = 'test';
      const re = new RuleEngine(); re.load([rule]);
      const rows = await store.query({ source: rule.source, from: Date.now() - 86400000 }, 5000);
      let n = 0; const samples = [];
      for (const r of rows) {
        let vb = null; try { vb = r.vb ? JSON.parse(r.vb) : null; } catch { /* old row */ }
        const msg = { ...r, tags: [...(r.tags || [])], devKey: String(r.host).toLowerCase(), trapOid: vb?.o || '', source: r.source === 'snmp' ? 'snmp' : 'syslog' };
        const before = re.hits.get('test') || 0; re.apply(msg, true);
        if ((re.hits.get('test') || 0) > before) { n++; if (samples.length < 5) samples.push({ ts: r.ts, host: r.host, severity: msg.severity, message: String(r.message).slice(0, 200) }); }
      }
      return json(res, { matched: n, checked: rows.length, capped: rows.length >= 5000, samples, note: rule.match.repeat === undefined && b.rule?.match?.repeat ? 'The “N times within X seconds” condition is not part of this test.' : '' });
    }
    if (p === '/api/logs/delete' && req.method === 'POST') {
      need('delete'); const b = await readJson(req);
      let n;
      if (Array.isArray(b.ids)) n = await store.deleteLogs({ ids: b.ids.map(Number).filter((x) => Number.isInteger(x) && x > 0).slice(0, 20000) });
      else if (b.matching && b.q && typeof b.q === 'object' && b.confirm === 'DELETE') { const { id: _i, ...qq } = b.q; n = await store.deleteLogs({ q: { ...qq, source: b.q.source === 'snmp' ? 'snmp' : 'syslog' } }); }   // every message of the chosen kind that matches the filters on screen
      else throw new HttpError(400, 'Select messages first.');
      audit(who, `deleted ${n} ${b.q?.source === 'snmp' ? 'SNMP trap' : 'syslog'} message(s)`); return json(res, { ok: true, deleted: n });
    }
    if (p === '/api/logs') {
      const limit = Math.min(+q.limit || 500, 5000);
      const [rows, total] = await Promise.all([store.query(q, limit), q.countTotal ? store.count(q) : undefined]);
      return json(res, { rows, total: total > COUNT_CAP ? COUNT_CAP : total, totalCapped: total !== undefined && total > COUNT_CAP });
    }
    if (p.startsWith('/api/log/')) {
      const id = +p.split('/').pop(); store.flush();
      const row = store.db.prepare('SELECT id, ts, dev_ts AS devTs, src_ip AS srcIp, host, facility, severity, app, pid, msgid, message, tags, color, raw, source FROM logs WHERE id = ?').get(id);
      return row ? json(res, row) : json(res, { error: 'not found' }, 404);
    }

    if (p === '/api/export') return exportLogs(req, res, q);
    if (p === '/api/db/download') return downloadDb(req, res);

    // ---- HTTPS certificate made by the app itself ----
    if (p === '/api/https' && req.method === 'GET') {
      need('settings');
      const info = { running: state.https, certFile: cfg.tlsCertFile || '', keyFile: cfg.tlsKeyFile || '', suggested: certgen.defaultHosts().join(', '), cert: null };
      if (cfg.tlsCertFile) { try { const x = new (require('node:crypto').X509Certificate)(fs.readFileSync(cfg.tlsCertFile)); info.cert = { subject: x.subject.replace(/\n/g, ', '), names: x.subjectAltName || '', validFrom: x.validFrom, validTo: x.validTo, expired: Date.parse(x.validTo) < Date.now(), fingerprint: x.fingerprint256, selfSigned: x.subject === x.issuer }; } catch (e) { info.certError = 'The certificate file cannot be read: ' + e.message; } }
      return json(res, info);
    }
    if (p === '/api/https/generate' && req.method === 'POST') {
      need('settings');
      const b = await readJson(req);
      let out; try { out = certgen.generate({ hosts: b.hosts, days: b.days }); } catch (e) { throw new HttpError(400, e.message); }
      const dir = path.join(config.dir, 'tls'); fs.mkdirSync(dir, { recursive: true });
      const crt = path.join(dir, 'neteventpro.crt'), key = path.join(dir, 'neteventpro.key'), stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
      for (const f of [crt, key]) if (fs.existsSync(f)) fs.renameSync(f, f + '.old-' + stamp);      // never overwrite a certificate that might be in use elsewhere
      fs.writeFileSync(crt, out.cert); fs.writeFileSync(key, out.key, { mode: 0o600 }); restrictToAdmins(key);   // on Windows the mode above is ignored, so also lock the key file to Administrators / SYSTEM
      config.update({ tlsCertFile: crt, tlsKeyFile: key });
      return json(res, { ok: true, restartRequired: true, certFile: crt, keyFile: key, names: out.names, validTo: out.notAfter.toISOString(), fingerprint: out.fingerprint });
    }
    if (p === '/api/https/cert' && req.method === 'GET') {
      need('settings');
      if (!cfg.tlsCertFile || !fs.existsSync(cfg.tlsCertFile)) throw new HttpError(404, 'No certificate is set up.');
      res.writeHead(200, { ...SEC_HEADERS, 'content-type': 'application/x-x509-ca-cert', 'content-disposition': 'attachment; filename="neteventpro.crt"', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(cfg.tlsCertFile));
    }

    if (p === '/api/config' && req.method === 'GET') return json(res, publicConfig(cfg, who.perms.has('settings')));
    if (p === '/api/config' && req.method === 'PUT') {
      const body = await readJson(req);
      for (const k of Object.keys(body)) need(CONFIG_KEY_PERM[k] || 'settings');
      const patch = await sanitize(body, cfg);
      const webChanged = ['webPort', 'webBind', 'tlsCertFile', 'tlsKeyFile'].some((k) => k in patch && patch[k] !== cfg[k]);
      config.update(patch);
      return json(res, { ok: true, restartRequired: webChanged, config: publicConfig(config.get(), who.perms.has('settings')) });
    }

    if (p === '/api/ntp/test' && req.method === 'POST') {
      need('settings'); const b = await readJson(req); const server = String(b.server || '').trim();
      if (!ntpmod.validHost(server)) throw new HttpError(400, 'Enter the NTP server name or IP address first.');
      try { const r = await ntpmod.sample(server, clampInt(b.port, 1, 65535, 123), 3); return json(res, { ok: true, offsetMs: Math.round(r.offsetMs), delayMs: Math.round(r.delayMs), stratum: r.stratum }); }
      catch (e) { return json(res, { ok: false, error: e.message }); }
    }
    if (p === '/api/test-message' && req.method === 'POST') {
      const b = await readJson(req);
      const sev = clampInt(b.severity, 0, 7, 6);
      const fac = clampInt(b.facility, 0, 23, 1);
      const text = String(b.message || 'Test message from the NetEventPro dashboard').slice(0, 1000);
      engine.handlePacket(Buffer.from(`<${fac * 8 + sev}>${new Date().toISOString().replace(/\.\d+Z$/, 'Z')} ${String(b.host || 'dashboard-test').replace(/\s+/g, '-').slice(0, 100)} test[1]: ${text}`), '127.0.0.1', 'api');
      return json(res, { ok: true });
    }
    if (p === '/api/test-webhook' && req.method === 'POST') {
      const b = await readJson(req);
      const hook = (cfg.webhooks || []).find((h) => h.name === b.name);
      if (!hook) return json(res, { error: 'unknown webhook' }, 404);
      const fake = { ts: Date.now(), host: 'test-device', srcIp: '127.0.0.1', severity: 3, severityName: 'error', facilityName: 'user', app: 'test', message: 'This is a test alert from NetEventPro' };
      const result = await new Promise((resolve) => {
        const once = (e) => { engine.off('webhook', once); resolve(e); };
        engine.on('webhook', once);
        engine.callWebhook({ hook: hook.name, rule: { name: 'Test' }, suppressed: 0 }, fake);
        setTimeout(() => { engine.off('webhook', once); resolve({ ok: false, error: 'timeout' }); }, 7000);
      });
      return json(res, result);
    }
    if (p === '/api/sqlcopy/status' && req.method === 'GET') { need('settings'); return json(res, sqlcopy.status()); }
    if (p === '/api/sqlcopy/test' && POST) {
      need('settings'); const b = await readJson(req); if (Date.now() - (state.lastNotifyTest || 0) < 3000) throw new HttpError(429, 'Wait a few seconds between tests.'); state.lastNotifyTest = Date.now();
      const cur = cfg.sqlCopy || {}, f = b && typeof b === 'object' ? b : {};
      const c = { ...cur, ...f, password: f.password === '********' || f.password === undefined ? cur.password || '' : String(f.password).slice(0, 128) };
      if (!c.server || !c.database) throw new HttpError(400, 'Give the SQL Server and the database name first.');
      if (!/^[A-Za-z0-9.\-_:,\\[\]]+$/.test(c.server) || !/^[A-Za-z0-9_$# .\-]{1,100}$/.test(c.database)) throw new HttpError(400, 'The SQL Server or database name is not valid.');
      return json(res, await sqlcopy.test({ ...c, auth: c.auth === 'sql' ? 'sql' : 'windows', user: String(c.user || '').slice(0, 128), encrypt: c.encrypt !== false, trustCert: !!c.trustCert, createDb: !!c.createDb }));
    }
    if (p === '/api/sqlcopy/restart' && POST) { need('settings'); sqlcopy.resetMarks(true); return json(res, { ok: true }); }
    if (p === '/api/notify/log' && req.method === 'GET') { need('settings'); return json(res, { entries: engine.notify.entries(q.limit) }); }
    if (p === '/api/notify/test' && POST) {
      need('settings'); const b = await readJson(req);
      const prof = (cfg.notifProfiles || []).find((x) => x.id === b.profileId); if (!prof) throw new HttpError(404, 'Save the profile first, then test it.');
      if (Date.now() - (state.lastNotifyTest || 0) < 3000) throw new HttpError(429, 'Wait a few seconds between tests.'); state.lastNotifyTest = Date.now();
      return json(res, await engine.notify.test(prof, ['email', 'webhook', 'sms'].includes(b.channel) ? b.channel : ''));
    }
    if (p === '/api/test-smpp' && POST) {     // connection test: connect and log in, nothing is sent
      need('settings'); if (Date.now() - (state.lastNotifyTest || 0) < 3000) throw new HttpError(429, 'Wait a few seconds between tests.'); state.lastNotifyTest = Date.now();
      try { await sendSms(cfg.smpp, [], ''); return json(res, { ok: true }); } catch (e) { return json(res, { ok: false, error: e.message }); }
    }
    if (p === '/api/test-email' && req.method === 'POST') {
      const b = await readJson(req);
      if (Date.now() - state.lastTestEmail < 3000) throw new HttpError(429, 'Wait a few seconds between test emails.');
      state.lastTestEmail = Date.now();
      let to = '';
      if (b.to) { try { parseRecipients(b.to); to = String(b.to); } catch (e) { throw new HttpError(400, e.message); } }
      return json(res, await engine.mail.sendTest(to));
    }
    if (p === '/api/test-replace' && req.method === 'POST') {
      const b = await readJson(req);
      const rep = new Replacer(); rep.load(sanitizeReplacements(b.replacements));
      const msg = { host: String(b.host ?? '').slice(0, 200), app: String(b.app ?? '').slice(0, 100), message: String(b.message ?? '').slice(0, 2000) };
      rep.apply(msg);
      return json(res, { host: msg.host, app: msg.app, message: msg.message, active: rep.size });
    }
    if (p === '/api/device/forget' && req.method === 'POST') { const b = await readJson(req); engine.forgetDevice(String(b.key ?? b.srcIp)); return json(res, { ok: true }); }
    if (p === '/api/clear' && req.method === 'POST') { store.clearAll(); engine.live.length = 0; return json(res, { ok: true }); }
    if (p === '/api/update/status' && req.method === 'GET') { need('settings'); return json(res, updater.pub()); }
    if (p === '/api/update/check' && POST) { need('settings'); return json(res, await updater.check()); }
    if (p === '/api/update/install' && POST) {
      need('settings'); const b = await readJson(req); if (b.confirm !== 'INSTALL') return json(res, { error: 'Confirmation is missing.' }, 400);
      let v; try { v = await updater.install(); } catch (e) { audit(who, `update failed: ${e.message}`); return json(res, { error: e.message }, 400); }
      audit(who, `update installed: ${VERSION} -> ${v}`); json(res, { ok: true, version: v }); setTimeout(() => shutdown(1), 800); return;
    }
    if (p === '/api/update/node' && POST) {
      need('settings'); const b = await readJson(req); if (b.confirm !== 'INSTALL NODE') return json(res, { error: 'Confirmation is missing.' }, 400);
      let v; try { v = await updater.installNode(); } catch (e) { audit(who, `Node.js update failed: ${e.message}`); return json(res, { error: e.message }, 400); }
      audit(who, `Node.js updated: ${process.version} -> ${v}`); json(res, { ok: true, version: v }); setTimeout(() => shutdown(1), 800); return;
    }
    if (p === '/api/restart' && req.method === 'POST') { json(res, { ok: true }); setTimeout(() => shutdown(1), 300); return; }  // non-zero exit makes the Windows service manager restart us

    return json(res, { error: 'not found' }, 404);
  }

  // streams the result page by page and waits whenever the browser is slow, so a big export never stalls the receiver or fills memory
  async function exportLogs(req, res, q) {
    const fmt = q.format === 'json' ? 'json' : 'csv';
    const name = `syslog-export-${new Date().toISOString().replace(/[:.]/g, '-')}.${fmt}`;
    let closed = false; res.on('close', () => { closed = true; });
    const flushTo = async (text) => {
      if (closed) return;
      if (!res.write(text)) await new Promise((resolve) => { const done = () => { res.off('drain', done); res.off('close', done); resolve(); }; res.once('drain', done); res.once('close', done); });
    };
    res.writeHead(200, { ...SEC_HEADERS, 'content-type': fmt === 'json' ? 'application/x-ndjson' : 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' });
    try {
      const tv = q.view ? (config.get().uiPrefs?.trapViews || []).find((v) => v.id === q.view) : null, vcols = tv ? require('./trapcols').viewColumns(tv) : null;      // the Traps page exports the columns of the chosen view
      // the CSV has the columns of the window it came from (Live log / Search, or Traps), in the same order and with the same headings
      const ccols = vcols || (fmt === 'csv' ? require('./viewcols').logColumns(config.get().uiPrefs, q.source === 'snmp' ? 'traps' : 'logs') : null);
      let buf = ccols && fmt === 'csv' ? '\ufeff' + ccols.map((c) => csv(c.label)).join(',') + '\r\n' : '';
      const max = Math.min(Math.max(+q.max || 100000, 1), 2000000);
      for await (const r of store.iterate(q, max)) {
        if (closed) break;
        if (vcols && fmt === 'json') buf += JSON.stringify(Object.fromEntries(vcols.map((c) => [c.label, c.get(r)]))) + '\n';
        else if (ccols && fmt === 'csv') buf += ccols.map((c) => csv(c.get(r))).join(',') + '\r\n';
        else if (fmt === 'json') buf += JSON.stringify({ ...r, time: new Date(r.ts).toISOString(), facility: FACILITIES[r.facility], severity: SEVERITIES[r.severity] }) + '\n';
        else buf += [r.id, new Date(r.ts).toISOString(), r.devTs ? new Date(r.devTs).toISOString() : '', r.srcIp, r.host, FACILITIES[r.facility], SEVERITIES[r.severity], r.app, r.pid, r.message, (r.tags || []).join('|')].map(csv).join(',') + '\r\n';
        if (buf.length > 65536) { await flushTo(buf); buf = ''; }
      }
      if (buf) await flushTo(buf);
    } catch (e) { console.error('[export]', e.message); }
    finally { res.end(); }
  }

  // a consistent copy of the whole message database, made by SQLite itself (safe while messages are arriving)
  async function downloadDb(req, res) {
    if (state.backupBusy) throw new HttpError(429, 'A database copy is already being prepared. Wait for it to finish.');
    state.backupBusy = true;
    const dir = path.join(config.dir, 'tmp'); fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `copy-${crypto.randomBytes(8).toString('hex')}.db`);
    try {
      await store.backup(dest);
      const size = fs.statSync(dest).size;
      res.writeHead(200, { ...SEC_HEADERS, 'content-type': 'application/octet-stream', 'content-length': size, 'content-disposition': `attachment; filename="neteventpro-${new Date().toISOString().slice(0, 10)}.db"`, 'cache-control': 'no-store' });
      await pipeline(fs.createReadStream(dest), res);
    } catch (e) {
      if (!res.headersSent) throw (e.userFacing ? e : new HttpError(500, 'The database copy could not be made: ' + e.message + ' (it needs free disk space about the size of the database).'));
    } finally { fs.rm(dest, { force: true }, () => {}); state.backupBusy = false; }
  }

  function serveStatic(req, res, pathname, extra = {}) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad request'); }
    if (rel.includes('\0')) return send(res, 400, 'Bad request');
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
    const type = MIME[path.extname(file).toLowerCase()];
    if (!type) return send(res, 404, 'Not found');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'Not found');
      res.writeHead(200, { ...SEC_HEADERS, 'content-type': type, 'cache-control': 'no-cache', ...extra, ...(state.https && !/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(req.headers.host || '') ? { 'strict-transport-security': 'max-age=31536000' } : {}) });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  }

  // ---- start web server (HTTPS when a certificate is configured) -----------
  function makeServer() {
    const c = config.get();
    let srv;
    if (c.tlsCertFile && c.tlsKeyFile) {
      try {
        srv = https.createServer({ cert: fs.readFileSync(c.tlsCertFile), key: fs.readFileSync(c.tlsKeyFile), minVersion: 'TLSv1.2' }, handler);
        state.https = true;
      } catch (e) {
        state.webWarning = `The HTTPS certificate could not be loaded (${e.message}). The dashboard is limited to this computer over plain http until this is fixed in Settings → Security.`;
        state.bind = '127.0.0.1';
      }
    }
    if (!srv) srv = http.createServer(handler);
    srv.requestTimeout = 3600000;   // long enough to upload a large backup file; slow clients are still cut off by headersTimeout and the sign-in check
     srv.headersTimeout = 15000; srv.keepAliveTimeout = 5000;
    return srv;
  }
  const server = makeServer();

  const c0 = config.get();
  if (!isLoopback(state.bind) && !c0.adminPasswordHash) {
    state.bind = '127.0.0.1';
    state.webWarning = 'The dashboard is set to allow other computers, but no password is set, so it is limited to this computer. Set a password in Settings → Security.';
  } else if (!state.webWarning) state.bind = c0.webBind;
  if (!isLoopback(state.bind) && !state.https) {
    state.webWarning ||= 'The dashboard is open to the network over plain http: the password and the log data cross the network unencrypted. Add an HTTPS certificate in Settings → Security, or only use it on a trusted network or VPN.';
  }

  await new Promise((resolve) => {
    server.once('error', (e) => { console.error(`[web] cannot listen on ${state.bind}:${c0.webPort} — ${e.message}`); state.webWarning = `The dashboard could not start on port ${c0.webPort}: ${e.message}`; resolve(false); });
    server.listen(c0.webPort, state.bind, () => { console.log(`[web] dashboard at ${state.https ? 'https' : 'http'}://${state.bind === '0.0.0.0' ? 'localhost' : state.bind}:${c0.webPort}/`); resolve(true); });
  });
  try {   // lets the tray icon and shortcuts find the dashboard without reading config.json
    const d = path.join(config.dir, 'ui'); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'web.json'), JSON.stringify({ scheme: state.https ? 'https' : 'http', port: c0.webPort, bind: state.bind }));
  } catch { /* not critical */ }
  console.log(`[neteventpro] v${VERSION} data dir: ${config.dir}`);

  // dashboard tiles for a time range: one request per refresh, answered from one database reader; identical requests within 4 s share one answer
  const dashCache = new Map();
  async function dashData(body) {
    const full = sanitizeDashRequest(body), req = { ...full, tiles: full.tiles.filter((t) => t.ds !== 'devices') }, key = JSON.stringify(req), hit = dashCache.get(key);
    let value;
    if (hit && Date.now() - hit.at < 4000) value = hit.value;
    else { value = await store.dash(req); dashCache.set(key, { at: Date.now(), value }); if (dashCache.size > 50) dashCache.delete(dashCache.keys().next().value); }
    const dv = full.tiles.filter((t) => t.ds === 'devices'); if (!dv.length) return value;
    const list = engine.deviceList(); value = { ...value, tiles: { ...value.tiles } };
    for (const t of dv) value.tiles[t.id] = require('./devq').run(list, t);
    return value;
  }

  function shutdown(code = 0) {
    console.log('[neteventpro] shutting down');
    health.close(); sqlcopy.stop(); polling.stop(); alarms.stop(); reports.close(); backups.close(); engine.shutdown(); store.close();
    for (const c of clients) c.res.end();
    try { probe.shutdown(); } catch { /* ignore */ }
    server.close(); Promise.all([traps.stop(), listeners.stop()]).finally(() => process.exit(code));
    setTimeout(() => process.exit(code), 2000).unref();
  }
  config.onChange((c) => { if (c.mode === 'probe') { audit({ name: 'admin' }, 'switched this computer to a probe: restarting'); setTimeout(() => shutdown(1), 1500); } });   // the probe is a different, lean program: it starts after a restart
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('uncaughtException', (e) => console.error('[fatal]', e));
  process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
}

// ---- helpers ---------------------------------------------------------------
const netKey = (c) => JSON.stringify([c.udpRecvMB, c.udpPort, c.tcpPort, c.udpEnabled, c.tcpEnabled, c.syslogBind, c.tlsSyslogEnabled, c.tlsSyslogPort, c.tlsCertFile, c.tlsKeyFile]);
const slim = (m) => ({ id: m.id, ts: m.ts, devTs: m.devTs, srcIp: m.srcIp, host: m.host, facility: m.facility, severity: m.severity, app: m.app, pid: m.pid, msgid: m.msgid, source: m.source, message: m.message, tags: m.tags, color: m.color, sound: m.sound || undefined, notify: m.notify || undefined, vb: m.vb || undefined });
// CSV cells that start with = + - @ would be run as formulas by Excel: a log line can be attacker-controlled, so neutralise them
const csv = (v) => { let s = String(v ?? ''); if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
/** "Chrome on Windows" from a User-Agent header (short, for the sessions list) */
function uaName(ua) {
  ua = String(ua || ''); const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl|python|node|axios/i.test(ua) ? 'Script' : ua ? 'Browser' : '';
  const o = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return [b, o].filter(Boolean).join(' on ');
}
const remoteIp = (req) => (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
function send(res, code, body, type = 'text/plain; charset=utf-8', extra = {}) {
  // big JSON answers (log pages, statistics) are compressed when the browser accepts it: 10x less to send over a slow link
  if (typeof body === 'string' && body.length > 2048 && /json/.test(type) && /\bgzip\b/.test(res.req?.headers?.['accept-encoding'] || '')) {
    const z = require('node:zlib').gzipSync(body, { level: 1 });
    res.writeHead(code, { ...SEC_HEADERS, 'content-type': type, 'cache-control': 'no-store', 'content-encoding': 'gzip', vary: 'accept-encoding', ...extra }); return res.end(z);
  }
  res.writeHead(code, { ...SEC_HEADERS, 'content-type': type, 'cache-control': 'no-store', ...extra }); res.end(body);
}
function json(res, obj, code = 200, headers) { send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8', headers); }
function readJson(req, limit = 2e6) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Request is too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { const t = Buffer.concat(chunks).toString('utf8'); resolve(t ? JSON.parse(t) : {}); } catch { reject(new HttpError(400, 'The request is not valid JSON')); } });
    req.on('error', reject);
  });
}
const clampInt = (v, lo, hi, d) => { const n = Math.round(+v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const str = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

const maskV3 = (list) => (list || []).map((u) => ({ ...u, authPass: u.authPass ? '********' : '', privPass: u.privPass ? '********' : '' }));
const maskReports = (list) => (list || []).map((r) => (r?.folder?.password ? { ...r, folder: { ...r.folder, password: '********' } } : r));
function publicConfig(c, full = true) {
  const o = {};
  for (const k of EDITABLE) if (k !== 'adminPassword') o[k] = c[k];
  o.adminPassword = c.adminPasswordHash ? '********' : '';
  o.smtp = { ...c.smtp, password: c.smtp?.password ? '********' : '' };
  o.smpp = { ...(c.smpp || {}), password: c.smpp?.password ? '********' : '' };
  o.sqlCopy = { ...(c.sqlCopy || {}), password: c.sqlCopy?.password ? '********' : '' };
  o.backup = { ...c.backup, passphrase: c.backup?.passphrase ? '********' : '', folderPassword: c.backup?.folderPassword ? '********' : '' };
  o.reports = maskReports(c.reports);
  o.probe = { ...(c.probe || {}), token: c.probe?.token ? '********' : '' };
  o.snmp = { ...c.snmp, v3Users: maskV3(c.snmp?.v3Users) };
  o.trapForwardTargets = (c.trapForwardTargets || []).map((t) => (t.version === 'v3' ? { ...t, authPass: t.authPass ? '********' : '', privPass: t.privPass ? '********' : '' } : t));
  if (!full) {
    o.probe = { server: '', token: '', name: '', allowSelfSigned: false };      // people without the "settings" permission see what the screens need, not mail logins, webhook addresses or relay targets
    o.smtp = { host: '', port: 587, security: 'starttls', user: '', password: '', from: '', to: '' };
    o.webhooks = (c.webhooks || []).map((h) => ({ name: h.name, url: '', enabled: h.enabled }));
    o.notifProfiles = (c.notifProfiles || []).map((x) => ({ id: x.id, name: x.name, enabled: x.enabled, email: { on: !!x.email?.on, to: '', cc: '' }, webhook: { on: !!x.webhook?.on, url: '', format: x.webhook?.format || 'generic' }, sms: { on: !!x.sms?.on, to: '' } }));
    o.smpp = { host: '', port: 2775, tls: false, systemId: '', password: '' };
    o.sqlCopy = { enabled: !!c.sqlCopy?.enabled };
    o.backup = { enabled: false, time: '02:00', keep: 7, includeDb: true, folder: '', passphrase: '' }; o.reports = [];
    o.ntp = { enabled: !!c.ntp?.enabled, server: '', port: 123, intervalMin: 15, zone: c.ntp?.zone || '' };
    o.snmp = { ...c.snmp, communities: [], v3Users: [] };
    o.forwardTargets = []; o.trapForwardTargets = []; o.allowedSources = ''; o.tlsCertFile = ''; o.tlsKeyFile = '';
  }
  return o;
}

const bad = (m) => { throw new HttpError(400, m); };

function sanitizeReplacements(list) {
  if (!Array.isArray(list)) return [];
  if (list.length > 500) bad('At most 500 text replacements are supported.');
  return list.map((r, i) => {
    const o = {
      id: str(r?.id, 40) || 'p' + Date.now() + i, enabled: r?.enabled !== false, find: String(r?.find ?? '').slice(0, 400), replace: String(r?.replace ?? '').slice(0, 400),
      regex: !!r?.regex, wholeWord: r?.wholeWord !== false, matchCase: !!r?.matchCase, scope: ['message', 'host', 'trap', 'all'].includes(r?.scope) ? r.scope : 'message', field: String(r?.field ?? '').trim().slice(0, 120), cols: (Array.isArray(r?.cols) ? r.cols : []).map((x) => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 40), on: ['syslog', 'snmp'].includes(r?.on) ? r.on : 'both'
    };
    const err = checkReplacement(o);
    if (err) bad(`Text replacement ${i + 1} ("${o.find.slice(0, 30)}"): ${err}.`);
    return o;
  });
}

function sanitizeRules(list) {
  if (list.length > 200) bad('At most 200 rules are supported.');
  const num = (v, lo, hi) => (v === undefined || v === '' || v === null ? undefined : clampInt(v, lo, hi, undefined));
  return list.map((r, i) => {
    const name = str(r?.name, 100) || 'Rule ' + (i + 1);
    const m = r?.match || {}, a = r?.actions || {};
    const match = {};
    for (const [k, lo, hi] of [['severityMax', 0, 9], ['severityMin', 0, 9], ['facility', 0, 23]]) { const n = num(m[k], lo, hi); if (n !== undefined) match[k] = n; }
    { const sv = parseSevs(m.severities); if (sv) match.severities = sv; }
    for (const k of ['host', 'app', 'text', 'notText']) {
      const v = str(m[k], 300); if (!v) continue;
      const rx = /^\/(.+)\/([a-z]*)$/.exec(v);
      if (rx) { const err = checkRegexSource(rx[1], rx[2]); if (err) bad(`Rule "${name}", ${k}: ${err}.`); }
      match[k] = v;
    }
    { const tg = str(m.tag, 64); if (tg) match.tag = tg; }
    const lines = (v, what) => { const l = (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => String(x).trim().slice(0, 300)).filter(Boolean).slice(0, 40); for (const x of l) { const rx = /^\/(.+)\/([a-z]*)$/.exec(x); if (rx) { const err = checkRegexSource(rx[1], rx[2]); if (err) bad(`Rule "${name}", ${what}: ${err}.`); } } return l; };
    { const l = lines(m.textAny, 'message contains any of'); if (l.length) match.textAny = l; }
    if (m.ip) { const list = String(m.ip).split(/[\s,;]+/).filter(Boolean).slice(0, 50); const badIp = SourceFilter.validate(list); if (badIp.length) bad(`Rule "${name}": "${badIp[0]}" is not an IP address or range.`); if (list.length) match.ip = list.join(', '); }
    if (Array.isArray(m.days)) { const d = [...new Set(m.days.map(Number).filter((x) => x >= 0 && x <= 6))]; if (d.length && d.length < 7) match.days = d; }
    for (const k of ['from', 'to']) if (m[k]) { if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(m[k]))) bad(`Rule "${name}": time must look like 08:30.`); match[k] = String(m[k]); }
    if (m.repeat && +m.repeat.count > 1) { const c = num(m.repeat.count, 2, 1000), w = num(m.repeat.withinSec, 1, 86400); if (c && w) match.repeat = { count: c, withinSec: w }; }
    { const tp = str(m.trap, 200); if (tp) { const rx = /^\/(.+)\/([a-z]*)$/.exec(tp); if (rx) { const err = checkRegexSource(rx[1], rx[2]); if (err) bad(`Rule "${name}", trap: ${err}.`); } match.trap = tp; } }
    const actions = {};
    if (a.color) { if (!/^#[0-9a-fA-F]{6}$/.test(String(a.color))) bad(`Rule "${name}": the highlight colour is not valid.`); actions.color = String(a.color).toLowerCase(); }
    if (a.tag) actions.tag = str(a.tag, 40);
    { const sv = num(a.severity, 0, 9); if (sv !== undefined) actions.severity = sv; }
    if (a.stop) actions.stop = true;
    for (const k of ['drop', 'sound', 'notify', 'email']) if (a[k]) actions[k] = true;
    if (a.email && a.emailReport) actions.emailReport = true;
    if (a.webhook) actions.webhook = str(a.webhook, 100);
    { const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => str(x, 40)).filter((x) => /^[\w-]{1,40}$/.test(x)))].slice(0, 20); const pl = ids(a.profiles); if (pl.length) actions.profiles = pl; if (a.alarm) { const el = ids(a.alarmEscProfiles); if (el.length) actions.alarmEscProfiles = el; } }
    if (a.emailReport && !actions.email && actions.profiles) actions.emailReport = true;
    if (a.alarm) {
      actions.alarm = true; const em = num(a.alarmEscMin, 0, 10080); if (em) actions.alarmEscMin = em; const ac = num(a.alarmAutoClearMin, 0, 525600); if (ac) actions.alarmAutoClearMin = ac;
      { const fc = num(a.flapCount, 2, 1000); if (fc) { actions.flapCount = fc; actions.flapMin = num(a.flapMin, 1, 1440) || 10; actions.flapQuiet = num(a.flapQuiet, 1, 1440) || 15; } }
      if (a.alarmEscReport === false) actions.alarmEscReport = false;
      if (a.alarmEscClear === false) actions.alarmEscClear = false;
      if (a.alarmEscTo) { try { parseRecipients(a.alarmEscTo); } catch (e) { bad(`Rule "${name}": ${e.message}.`); } actions.alarmEscTo = str(a.alarmEscTo, 400); }
    }
    if (a.alarmBy) { const ab = String(a.alarmBy); if (ab === 'port') actions.alarmBy = 'port'; else { const g = /^\/(.+)\/([gimsuy]*)$/.exec(ab); const why = g ? checkRegexSource(g[1], g[2]) : 'write it between slashes, for example /port (\\d+)/'; if (why) bad(`Rule "${name}": the "one alarm per" pattern is not usable: ${why}`); else actions.alarmBy = ab.slice(0, 200); } }
    if (a.clearsRule) actions.clearsRule = str(a.clearsRule, 40);
    { const l = lines(a.clearText, 'clear when'); if (l.length) actions.clearText = l; }
    if (Array.isArray(a.sevMap)) { const l = a.sevMap.slice(0, 20).map((x) => ({ text: String(x?.text || '').trim().slice(0, 300), severity: num(x?.severity, 0, 9) })).filter((x) => x.text && x.severity !== undefined); for (const x of l) { const rx = /^\/(.+)\/([a-z]*)$/.exec(x.text); if (rx) { const err = checkRegexSource(rx[1], rx[2]); if (err) bad(`Rule "${name}", severity from message: ${err}.`); } } if (l.length) actions.sevMap = l; }
    if (a.emailTo) { try { parseRecipients(a.emailTo); } catch (e) { bad(`Rule "${name}": ${e.message}.`); } actions.emailTo = str(a.emailTo, 400); }
    if (a.emailCc) { try { parseRecipients(a.emailCc); } catch (e) { bad(`Rule "${name}" Cc: ${e.message}.`); } actions.emailCc = str(a.emailCc, 400); }
    const cd = num(a.cooldownSec, 0, 86400); if (cd !== undefined) actions.cooldownSec = cd;
    return { id: str(r?.id, 40) || 'r' + Date.now() + i, name, note: str(r?.note, 300) || undefined, enabled: r?.enabled !== false, source: r?.source === 'snmp' ? 'snmp' : 'syslog', match, actions };
  });
}

const TILE_TYPES = ['kpi', 'trend', 'sevbars', 'top', 'latest', 'rate', 'io', 'health', 'silent', 'pie', 'line', 'heat', 'gauge', 'snmpstatus', 'section', 'bar', 'treemap', 'table', 'bargauge', 'statspark', 'text', 'alarm', 'poll'];
const KPI_METRICS = ['total', 'errors', 'warnings', 'hosts', 'perMinute', 'count', 'received', 'eps', 'devices', 'silent', 'stored', 'dbSize', 'dropped', 'diskFree', 'alActive', 'alOpen', 'alAck', 'alEsc', 'alRaised', 'alCleared', 'alAvgClear', 'dvAll', 'dvReporting', 'dvSilent', 'dvMuted', 'dvOverdue', 'dvAlarms', 'dvSyslog', 'dvTrap'];
/** a tile filter: only these keys, only text or small numbers */
function cleanTileFilter(f) {
  const o = {}; if (!f || typeof f !== 'object') return o;
  for (const k of ['severityMax', 'severityMin', 'facility']) if (f[k] !== undefined && f[k] !== '' && f[k] !== null && Number.isFinite(+f[k])) o[k] = Math.min(23, Math.max(0, Math.round(+f[k])));
  { const sv = parseSevs(f.sevs); if (sv) o.sevs = sv.join(','); }
  for (const [k, n] of [['host', 200], ['app', 100], ['text', 300], ['tag', 64]]) { const v = String(f[k] ?? '').trim().slice(0, n); if (v) o[k] = v; }
  if (['syslog', 'snmp', 'all'].includes(f.source)) o.source = f.source;
  if (['raised', 'active', 'open', 'ack', 'esc', 'cleared'].includes(f.astate)) o.astate = f.astate;                 // alarms: which alarms count
  if (['all', 'reporting', 'silent', 'muted', 'overdue', 'alarms', 'syslog', 'trap'].includes(f.dstate)) o.dstate = f.dstate;      // devices: which devices count
  for (const [k, n] of [['rule', 100], ['vendor', 60], ['group', 60]]) { const v = String(f[k] ?? '').trim().slice(0, n); if (v) o[k] = v; }
  return o;
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const oneOf = (v, list) => (list.includes(v) ? v : undefined);
/** Panel options of a dashboard tile (1.35): look (background, border, shadow, title), value display, colour thresholds, chart options. Everything is whitelisted. */
function sanitizeTileLook(c) {
  const out = {}, put = (k, v) => { if (v !== undefined && v !== null && !(typeof v === 'number' && !Number.isFinite(v))) out[k] = v; };
  const num = (v, lo, hi) => (v === undefined || v === '' || !Number.isFinite(+v) ? undefined : Math.min(hi, Math.max(lo, Math.round(+v * 100) / 100)));
  const hex = (v) => (typeof v === 'string' && HEX6.test(v) ? v.toLowerCase() : undefined);
  const l = c.look && typeof c.look === 'object' ? c.look : null;
  if (l) {
    const o = {}, set = (k, v) => { if (v !== undefined) o[k] = v; };
    set('bgMode', oneOf(l.bgMode, ['none', 'solid', 'gradient'])); set('bg', hex(l.bg)); set('bg2', hex(l.bg2)); set('angle', num(l.angle, 0, 360)); set('bgAlpha', num(l.bgAlpha, 0, 100));
    set('bw', num(l.bw, 0, 8)); set('bc', hex(l.bc)); set('radius', num(l.radius, 0, 32)); set('shadow', oneOf(l.shadow, ['none', 'soft', 'strong', 'glow'])); set('pad', num(l.pad, 0, 32)); set('tc', hex(l.tc));
    set('tShow', typeof l.tShow === 'boolean' ? l.tShow : undefined); set('tAlign', oneOf(l.tAlign, ['left', 'center', 'right'])); set('tSize', num(l.tSize, 10, 28)); set('tColor', hex(l.tColor));
    set('tBar', oneOf(l.tBar, ['none', 'solid', 'gradient'])); set('tBarC', hex(l.tBarC)); set('tBarC2', hex(l.tBarC2)); set('tUpper', typeof l.tUpper === 'boolean' ? l.tUpper : undefined); set('tSrc', typeof l.tSrc === 'boolean' ? l.tSrc : undefined);
    if (Object.keys(o).length) out.look = o;
  }
  const v = c.val && typeof c.val === 'object' ? c.val : null;
  if (v) {
    const o = {}, set = (k, x) => { if (x !== undefined) o[k] = x; };
    set('size', oneOf(v.size, ['auto', 's', 'm', 'l', 'xl'])); set('align', oneOf(v.align, ['left', 'center', 'right'])); set('dec', num(v.dec, 0, 4));
    if (typeof v.prefix === 'string' && v.prefix) o.prefix = v.prefix.replace(/[<>\u0000-\u001f]/g, '').slice(0, 12);
    if (typeof v.suffix === 'string' && v.suffix) o.suffix = v.suffix.replace(/[<>\u0000-\u001f]/g, '').slice(0, 12);
    set('compact', typeof v.compact === 'boolean' ? v.compact : undefined); set('sub', typeof v.sub === 'boolean' ? v.sub : undefined);
    if (Object.keys(o).length) out.val = o;
  }
  const th = c.th && typeof c.th === 'object' ? c.th : null;
  if (th) {
    const o = {}; const mode = oneOf(th.mode, ['none', 'value', 'bg', 'grad']); if (mode) o.mode = mode;
    if (Array.isArray(th.steps)) { const st = th.steps.slice(0, 6).map((x) => ({ v: num(x?.v, -1e12, 1e12), c: hex(x?.c) })).filter((x) => x.c && (x.v !== undefined || false)); if (st.length) o.steps = st; }
    if (Object.keys(o).length) out.th = o;
  }
  const ch = c.ch && typeof c.ch === 'object' ? c.ch : null;
  if (ch) {
    const o = {}, set = (k, x) => { if (x !== undefined) o[k] = x; };
    set('lw', num(ch.lw, 0.5, 6)); set('fillA', num(ch.fillA, 0, 100)); for (const k of ['smooth', 'pts', 'stack', 'grid', 'axis', 'grad']) set(k, typeof ch[k] === 'boolean' ? ch[k] : undefined);
    set('legend', oneOf(ch.legend, ['bottom', 'right', 'hide'])); set('bars', oneOf(ch.bars, ['bars', 'line', 'area']));
    if (Object.keys(o).length) out.ch = o;
  }
  put('graph', oneOf(c.graph, ['none', 'area', 'line'])); put('gstyle', oneOf(c.gstyle, ['arc', 'ring', 'lcd', 'bar'])); put('bstyle', oneOf(c.bstyle, ['gradient', 'lcd', 'solid']));
  put('pal', oneOf(c.pal, ['theme', 'classic', 'powerbi', 'grafana', 'warm', 'cool', 'neon', 'pastel', 'mono'])); put('card', oneOf(c.card, ['open', 'ack', 'esc', 'cleared', 'total']));
  put('tmode', oneOf(c.tmode, ['tag', 'name']));
  return out;
}

function sanitizeDashPrefs(d) {
  const out = {}; const r = d.range;
  if (r && typeof r === 'object') {
    if (['15m', '1h', '6h', '24h', '7d', '30d', 'today', 'yesterday', 'all'].includes(r.preset)) out.range = { preset: r.preset };
    else if (r.preset === 'custom' && Number.isFinite(+r.from) && Number.isFinite(+r.to)) out.range = { preset: 'custom', from: Math.round(+r.from), to: Math.round(+r.to) };
  }
  if (typeof d.slicer === 'string' && d.slicer.trim()) out.slicer = d.slicer.replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 100);      // one device that every tile of this dashboard is limited to (1.36)
  if (d.blank === true) out.blank = true;             // a new dashboard that starts empty (1.42.1)
  if (d.snmpFirst === true) out.snmpFirst = true;     // show the SNMP trap section above the Syslog section
  if (d.alarmBar && typeof d.alarmBar === 'object') {
    const ab = d.alarmBar, o = {}, ids = ['open', 'ack', 'esc', 'cleared', 'total'];
    if (ab.hide === true) o.hide = true;
    if (['cards', 'compact', 'large'].includes(ab.style)) o.style = ab.style;
    if (Number.isInteger(+ab.cols) && +ab.cols >= 1 && +ab.cols <= 5) o.cols = +ab.cols;
    if (Array.isArray(ab.order)) o.order = [...new Set(ab.order.filter((x) => ids.includes(x)))];
    if (ab.cards && typeof ab.cards === 'object') {
      o.cards = {};
      for (const k of ids) { const c = ab.cards[k]; if (!c || typeof c !== 'object') continue; const e = {};
        if (c.show === false) e.show = false; if (typeof c.title === 'string' && c.title.trim()) e.title = c.title.trim().slice(0, 30);
        if (typeof c.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.color)) e.color = c.color.toLowerCase();
        if (Object.keys(e).length) o.cards[k] = e; }
    }
    out.alarmBar = o;
  }
  if (d.style && typeof d.style === 'object') {      // how the dashboard looks (1.34): card style, corners, spacing, density, titles, accent colour, refresh
    const s = d.style, o = {}, num = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(+v)));
    if (['solid', 'raised', 'glass', 'outline', 'accent'].includes(s.card)) o.card = s.card;
    if (Number.isFinite(+s.radius)) o.radius = num(s.radius, 0, 24);
    if (Number.isFinite(+s.gap)) o.gap = num(s.gap, 4, 24);
    if (['compact', 'normal', 'comfortable'].includes(s.density)) o.density = s.density;
    if (['normal', 'upper', 'bar'].includes(s.titles)) o.titles = s.titles;
    if (typeof s.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.accent)) o.accent = s.accent.toLowerCase();
    if ([0, 5, 10, 30, 60, 300].includes(+s.refresh)) o.refresh = +s.refresh;
    if (['none', 'solid', 'gradient'].includes(s.pageBg)) o.pageBg = s.pageBg;
    for (const k of ['bg1', 'bg2']) if (typeof s[k] === 'string' && HEX6.test(s[k])) o[k] = s[k].toLowerCase();
    if (Number.isFinite(+s.bgAngle)) o.bgAngle = num(s.bgAngle, 0, 360);
    out.style = o;
  }
  if (d.alarmTiles) out.alarmTiles = true;       // the alarm cards became ordinary tiles once (1.35); not converted again
  if (d.snmpTiles) out.snmpTiles = true;       // the trap section was added to this layout once; do not add it again after the user removed it
  if (Array.isArray(d.tiles)) {
    const seen = new Set();
    out.tiles = d.tiles.slice(0, 80).filter((t) => t && typeof t === 'object' && /^[a-z0-9_]{1,24}$/.test(t.id) && TILE_TYPES.includes(t.type) && !seen.has(t.id) && seen.add(t.id)).map((t) => {
      const c = t.cfg && typeof t.cfg === 'object' ? t.cfg : {}, cfg = {};
      if (KPI_METRICS.includes(c.metric)) cfg.metric = c.metric;
      if (['host', 'app', 'severity', 'facility', 'msgid', 'rule', 'state', 'source', 'vendor', 'status', 'group', 'kind'].includes(c.by)) cfg.by = c.by;
      if (['syslog', 'snmp', 'events', 'alarms', 'devices', 'system'].includes(c.ds)) cfg.ds = c.ds;       // which data the tile shows (1.36)
      if (c.calc && typeof c.calc === 'object') {                // calculation on the value: percent, ratio, difference, per minute ... (1.36)
        const k = {}, nm = (v, lo, hi) => (Number.isFinite(+v) && v !== '' && v !== null ? Math.min(hi, Math.max(lo, Math.round(+v * 1e6) / 1e6)) : undefined);
        if (['pct', 'ratio', 'diff', 'sum', 'perMin', 'perHour', 'perDay', 'delta', 'deltaPct'].includes(c.calc.op)) k.op = c.calc.op;
        if (KPI_METRICS.includes(c.calc.bm)) k.bm = c.calc.bm; if (['syslog', 'snmp', 'events', 'alarms', 'devices'].includes(c.calc.bds)) k.bds = c.calc.bds;
        const mu = nm(c.calc.mul, -1e9, 1e9), ad = nm(c.calc.add, -1e12, 1e12); if (mu !== undefined) k.mul = mu; if (ad !== undefined) k.add = ad;
        if (Object.keys(k).length) cfg.calc = k;
      }
      if (c.sc && typeof c.sc === 'object' && ['cum', 'ma', 'rate', 'diff'].includes(c.sc.op)) cfg.sc = { op: c.sc.op, ...(Number.isFinite(+c.sc.n) ? { n: Math.min(30, Math.max(2, Math.round(+c.sc.n))) } : {}) };
      if (['count', 'pct'].includes(c.rm)) cfg.rm = c.rm;
      if (Number.isFinite(+c.n)) cfg.n = Math.min(50, Math.max(1, Math.round(+c.n)));
      if (['severity', 'total'].includes(c.mode)) cfg.mode = c.mode; else if (['hostTime', 'dowHour'].includes(c.mode)) cfg.mode = c.mode;
      if (['donut', 'pie'].includes(c.style)) cfg.style = c.style;
      if (['v', 'h'].includes(c.orient)) cfg.orient = c.orient;
      if (typeof c.text === 'string') cfg.text = c.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 2000);
      if (c.fill !== undefined) cfg.fill = !!c.fill;
      for (const k of ['color', 'bg']) if (typeof c[k] === 'string' && /^#[0-9a-fA-F]{6}$/.test(c[k])) cfg[k] = c[k].toLowerCase();
      for (const k of ['max', 'warn', 'crit']) if (c[k] !== undefined && c[k] !== '' && Number.isFinite(+c[k])) cfg[k] = Math.min(1e12, Math.max(0, +c[k]));
      Object.assign(cfg, sanitizeTileLook(c));
      const f = cleanTileFilter(c.filter); if (Object.keys(f).length) cfg.filter = f;
      if (t.type === 'poll') { cfg.poll = cleanPollSpec(c.poll); }
      if (['square', 'round', 'circle', 'hex', 'hexo'].includes(c.shape)) cfg.shape = c.shape;
      if (['blue', 'traffic', 'heat', 'cool', 'mono'].includes(c.theme)) cfg.theme = c.theme;
      const w = Math.min(12, Math.max(1, Math.round(+t.w) || 4));
      return { id: t.id, type: t.type, title: String(t.title || '').slice(0, 60), x: Math.min(12 - w, Math.max(0, Math.round(+t.x) || 0)), y: Math.min(999, Math.max(0, Math.round(+t.y) || 0)), w, h: Math.min(40, Math.max(1, Math.round(+t.h) || 4)), cfg };
    });
  }
  return out;
}
const timeOk = (t, d) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(t)) ? String(t) : d);
function sanitizeReports(list, cur) {
  if (!Array.isArray(list)) return [];
  if (list.length > 30) bad('At most 30 reports are supported.');
  const seen = new Set();
  return list.map((r, i) => {
    const name = str(r?.name, 100) || 'Report ' + (i + 1); let id = /^[a-z0-9_]{1,24}$/.test(r?.id) && !seen.has(r.id) ? r.id : 'rp' + Date.now().toString(36) + i; seen.add(id);
    const sc = r?.schedule || {}; const schedule = { type: ['hourly', 'daily', 'weekly', 'monthly'].includes(sc.type) ? sc.type : 'daily', time: timeOk(sc.time, '08:00'), dow: clampInt(sc.dow, 0, 6, 1), dom: clampInt(sc.dom, 1, 28, 1) };
    const formats = ['pdf', 'xlsx', 'csv'].filter((f) => (Array.isArray(r?.formats) ? r.formats : []).includes(f)); if (!formats.length) bad(`Report "${name}": choose at least one file format.`);
    const em = r?.email || {}, fo = r?.folder || {};
    const email = { enabled: !!em.enabled, to: str(em.to, 500), cc: str(em.cc, 500), subject: str(em.subject, 200), body: String(em.body ?? '').replace(/[^\S\n]+/g, ' ').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, 2000) };
    if (email.to) { try { parseRecipients(email.to); } catch (e) { bad(`Report "${name}": ${e.message}`); } }
    if (email.cc) { try { parseRecipients(email.cc); } catch (e) { bad(`Report "${name}" Cc: ${e.message}`); } }
    const folder = { enabled: !!fo.enabled, path: str(fo.path, 500), keep: clampInt(fo.keep, 0, 1000, 30), user: str(fo.user, 200), password: fo.password === '********' ? ((cur || []).find((x) => x.id === id)?.folder?.password || '') : String(fo.password ?? '').slice(0, 200) };
    if (folder.enabled) { try { checkFolder(folder.path); } catch (e) { bad(`Report "${name}": ${e.message}`); } }
    const ct = r?.content || {};
    return { id, name, enabled: r?.enabled !== false, schedule, period: Object.keys(PERIODS).includes(r?.period) ? r.period : 'last24h', filter: cleanTileFilter(r?.filter), content: { messages: ct.messages !== false, maxRows: clampInt(ct.maxRows, 1, 100000, 5000), traps: !!ct.traps, maxTrapRows: clampInt(ct.maxTrapRows, 1, 100000, 2000), alarmsActive: !!ct.alarmsActive, alarmHistory: !!ct.alarmHistory, maxAlarmRows: clampInt(ct.maxAlarmRows, 1, 20000, 2000) }, formats, email, folder };
  });
}
function sanitizeMaintenance(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.slice(0, 100).map((w, i) => {
    const name = str(w?.name, 100) || 'Maintenance ' + (i + 1); const sc = w?.schedule || {};
    let schedule;
    if (sc.type === 'once') {
      const from = Number(sc.from), to = Number(sc.to);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) bad(`Window "${name}": the end must be after the start.`);
      schedule = { type: 'once', from: Math.round(from), to: Math.round(to) };
    } else {
      const days = [...new Set((Array.isArray(sc.days) ? sc.days : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
      const t = (v) => (/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : null);
      if (!days.length) bad(`Window "${name}": choose at least one day.`);
      if (!t(sc.start) || !t(sc.end) || sc.start === sc.end) bad(`Window "${name}": give a start and an end time that differ (for example 22:00 to 02:00).`);
      schedule = { type: 'weekly', days, start: String(sc.start), end: String(sc.end) };
    }
    let id = str(w?.id, 40) || 'm' + Date.now() + i; while (seen.has(id)) id += 'x'; seen.add(id);
    return { id, name, enabled: w?.enabled !== false, devices: str(w?.devices, 1000), note: str(w?.note, 300), schedule };
  });
}
function sanitizeSnmp(s, cur) {
  s = s && typeof s === 'object' ? s : {};
  let comms = s.communities; if (typeof comms === 'string') comms = comms.split(/[\r\n,]+/);
  comms = (Array.isArray(comms) ? comms : []).map((x) => String(x).replace(/[\u0000-\u001f\u007f]/g, '').trim()).filter(Boolean);
  if (comms.length > 50) bad('At most 50 SNMP community names are supported.');
  if (comms.some((x) => x.length > 64)) bad('A community name can be at most 64 characters.');
  const bind = String(s.bind ?? cur.bind ?? '0.0.0.0'); if (!net.isIP(bind)) bad('The SNMP listen address must be an IP address such as 0.0.0.0.');
  const rules = (Array.isArray(s.severityRules) ? s.severityRules : []).slice(0, 200).map((r) => ({ match: str(r?.match, 100), severity: clampInt(r?.severity, 0, 9, 5) })).filter((r) => r.match);
  for (const r of rules) if (!/^[A-Za-z0-9_.:-]+$/.test(r.match)) bad(`"${r.match}": a trap severity rule takes a trap name (such as upsOnBattery) or a numeric OID (such as 1.3.6.1.4.1.318.0.5).`);
  // "severity from a value": the trap carries its own severity value (alarmSeverity = major(3), alertGroup.1.3.0 = 5); each entry says which value to read and what each value means here
  const vsev = (Array.isArray(s.valueSeverity) ? s.valueSeverity : []).slice(0, 30).map((e) => ({ field: str(e?.field, 100), match: str(e?.match, 200), map: (Array.isArray(e?.map) ? e.map : []).slice(0, 40).map((m) => ({ value: str(m?.value, 80), severity: clampInt(m?.severity, 0, 9, 5) })).filter((m) => m.value) })).filter((e) => e.field && e.map.length).map((e) => (e.match ? e : { field: e.field, map: e.map }));
  const curUsers = cur.v3Users || [], seen = new Set();
  const v3Users = (Array.isArray(s.v3Users) ? s.v3Users : []).slice(0, 100).map((u) => {
    const name = str(u?.name, 64); if (!name) return null; if (seen.has(name)) bad(`The SNMPv3 user "${name}" is listed twice.`); seen.add(name);
    const level = ['authPriv', 'authNoPriv', 'noAuthNoPriv'].includes(u?.level) ? u.level : 'authPriv', old = curUsers.find((x) => x.name === name) || {};
    const authProto = AUTH_PROTOCOLS.includes(u?.authProto) ? u.authProto : 'SHA', privProto = PRIV_PROTOCOLS.includes(u?.privProto) ? u.privProto : 'AES128';
    const pick = (v, o) => (v === '********' ? o || '' : String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100));
    const authPass = level === 'noAuthNoPriv' ? '' : pick(u?.authPass, old.authPass), privPass = level === 'authPriv' ? pick(u?.privPass, old.privPass) : '';
    if (level !== 'noAuthNoPriv' && (authPass.length < 8)) bad(`SNMPv3 user "${name}": the authentication password must be 8 to 100 characters.`);
    if (level === 'authPriv' && privPass.length < 8) bad(`SNMPv3 user "${name}": the encryption password must be 8 to 100 characters.`);
    return { name, level, authProto, authPass, privProto, privPass };
  }).filter(Boolean);
  return { enabled: !!s.enabled, port: clampInt(s.port, 1, 65535, 162), bind, communities: comms, v3Users, informAck: s.informAck !== false, defaultSeverity: clampInt(s.defaultSeverity, 0, 9, 5), severityRules: rules, valueSeverity: vsev };
}
function sanitizeNtp(n) {
  n = n && typeof n === 'object' ? n : {};
  const server = String(n.server || '').trim(), enabled = !!n.enabled;
  if (enabled && !ntpmod.validHost(server)) bad('Enter the NTP server as a name or IP address, for example 10.0.0.5 or ntp.corp.local.');
  if (server && !ntpmod.validHost(server)) bad('The NTP server name is not valid.');
  let zone = String(n.zone || '').trim();
  if (zone) { try { new Intl.DateTimeFormat('en', { timeZone: zone }); } catch { bad(`"${zone}" is not a time zone name (for example Asia/Dubai).`); } }
  return { enabled, server, port: clampInt(n.port, 1, 65535, 123), intervalMin: clampInt(n.intervalMin, 1, 1440, 15), zone };
}
function sanitizeBackup(b, cur) {
  b = b && typeof b === 'object' ? b : {};
  const o = { enabled: !!b.enabled, time: timeOk(b.time, '02:00'), keep: clampInt(b.keep, 1, 365, 7), includeDb: b.includeDb !== false, folder: str(b.folder, 500), folderUser: str(b.folderUser, 200), folderPassword: b.folderPassword === '********' ? (cur.folderPassword || '') : String(b.folderPassword ?? '').slice(0, 200), passphrase: b.passphrase === '********' ? (cur.passphrase || '') : String(b.passphrase ?? '').slice(0, 200) };
  if (o.folder) { try { checkFolder(o.folder); } catch (e) { bad('Backup folder: ' + e.message); } }
  if (o.passphrase && o.passphrase.length < 8) bad('The backup passphrase must be at least 8 characters.');
  return o;
}
/** body of POST /api/dash */
function sanitizeDashRequest(b) {
  b = b && typeof b === 'object' ? b : {};
  const lo5 = (v) => Math.floor(+v / 5000) * 5000, hi5 = (v) => Math.ceil(+v / 5000) * 5000;     // 5 s steps (the end rounds up so the newest messages are never cut off), so refreshes from several dashboards can share one answer
  const tiles = (Array.isArray(b.tiles) ? b.tiles : []).slice(0, 80).filter((t) => t && /^[a-z0-9_]{1,24}$/.test(t.id) && ['count', 'distinct', 'series', 'top', 'list', 'heatHost', 'heatDow'].includes(t.kind)).map((t) => ({
    id: t.id, kind: t.kind, ds: ['alarms', 'devices'].includes(t.ds) ? t.ds : 'events', agg: t.agg === 'avgclear' ? 'avgclear' : '', tz: clampInt(t.tz, -840, 840, 0), prev: !!t.prev, by: ['host', 'app', 'severity', 'facility', 'msgid', 'rule', 'state', 'source', 'vendor', 'status', 'group', 'kind'].includes(t.by) ? t.by : 'host', n: Math.min(50, Math.max(1, Math.round(+t.n) || 10)), filter: cleanTileFilter(t.filter)
  }));
  const from = Number.isFinite(+b.from) && +b.from > 0 ? lo5(b.from) : 0, to = Number.isFinite(+b.to) ? hi5(b.to) : hi5(Date.now());
  return { from, to, tiles };
}

function sanitizeUiPrefs(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return {};
  const id = (x) => typeof x === 'string' && /^[a-z0-9_]{1,24}$/.test(x);
  const out = {};
  if (Array.isArray(p.dashboard)) out.dashboard = p.dashboard.slice(0, 30).filter((w) => w && id(w.id)).map((w) => ({ id: w.id, visible: w.visible !== false, size: w.size === 'full' ? 'full' : 'half' }));
  if (p.columns && typeof p.columns === 'object') {
    out.columns = {};
    for (const v of ['live', 'search', 'logs', 'traps', 'alarms', 'devices']) if (Array.isArray(p.columns[v])) out.columns[v] = p.columns[v].slice(0, 30).filter((c) => c && id(c.id)).map((c) => ({ id: c.id, visible: c.visible !== false }));
  }
  if (p.wrap && typeof p.wrap === 'object') out.wrap = { live: p.wrap.live !== false, search: p.wrap.search !== false, logs: p.wrap.logs !== false, traps: p.wrap.traps !== false };
  // log table: column widths in pixels, the sort column, and the look (font, size, per-severity colours). Colours are strict #rrggbb
  // and the font is only a key into a fixed list in the page, so nothing a client sends can end up as free-form CSS.
  const hex = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : '');
  if (p.colw && typeof p.colw === 'object' && !Array.isArray(p.colw)) {   // widths of the columns of the Devices, Alarms, Rules and Reports tables: { table: { columnNumber: pixels } }
    out.colw = {};
    for (const [k, v] of Object.entries(p.colw).slice(0, 12)) if (/^[a-z]{1,12}$/.test(k) && v && typeof v === 'object') { const o = {}; for (const [i, w] of Object.entries(v).slice(0, 30)) if (/^\d{1,2}$/.test(i) && Number.isFinite(+w)) o[i] = Math.min(1200, Math.max(30, Math.round(+w))); out.colw[k] = o; }
  }
  if (p.widths && typeof p.widths === 'object' && !Array.isArray(p.widths)) {
    out.widths = {};
    for (const [k, v] of Object.entries(p.widths).slice(0, 30)) if (id(k) && Number.isFinite(+v)) out.widths[k] = Math.min(1200, Math.max(40, Math.round(+v)));
  }
  if (p.sort && typeof p.sort === 'object' && id(p.sort.col)) out.sort = { col: p.sort.col, dir: p.sort.dir === 'asc' ? 'asc' : 'desc' };
  if (['off', 'same', 'similar'].includes(p.group)) out.group = p.group;
  if (Array.isArray(p.views)) {          // saved log views: a name, a time range, filters, columns and the sort
    const sev = (v) => (v === '' || v === undefined || v === null ? '' : Math.min(9, Math.max(0, Math.round(+v) || 0)));
    out.views = p.views.slice(0, 40).filter((v) => v && typeof v === 'object').map((v, i) => ({
      id: /^[a-z0-9_]{1,24}$/.test(v.id) ? v.id : 'v' + Date.now().toString(36) + i, name: String(v.name || 'View').slice(0, 60),
      range: ['live', '900000', '3600000', '86400000', '604800000', '2592000000', '0'].includes(String(v.range)) ? String(v.range) : 'live',
      filter: { severityMax: sev(v.filter?.severityMax), sevs: (parseSevs(v.filter?.sevs) || []).join(','), host: String(v.filter?.host || '').slice(0, 200), app: String(v.filter?.app || '').slice(0, 100), text: String(v.filter?.text || '').slice(0, 300) },
      cols: Array.isArray(v.cols) ? v.cols.filter(id).slice(0, 20) : [],
      sort: v.sort && id(v.sort.col) ? { col: v.sort.col, dir: v.sort.dir === 'asc' ? 'asc' : 'desc' } : null,
      group: ['off', 'same', 'similar'].includes(v.group) ? v.group : 'off'
    }));
  }
  if (Array.isArray(p.trapViews)) {      // SNMP trap column views: which trap(s) a view covers and the columns to show for them
    const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
    out.trapViews = p.trapViews.slice(0, 60).filter((v) => v && typeof v === 'object').map((v, i) => {
      const match = txt(v.match, 200), rx = /^\/(.+)\/([a-z]*)$/.exec(match);
      if (rx && checkRegexSource(rx[1], rx[2])) bad('A trap view has an invalid or risky regular expression.');
      return { id: /^[a-z0-9_]{1,24}$/.test(v.id) ? v.id : 'tv' + Date.now().toString(36) + i, name: txt(v.name, 60) || 'Trap view', match,
        cols: (Array.isArray(v.cols) ? v.cols : []).slice(0, 24).map((c) => ({ label: txt(c?.label, 40), field: txt(c?.field, 400), hide: c?.hide === true, sev: c?.sev === true, map: String(c?.map ?? '').replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').split('\n').map((l) => l.trim()).filter(Boolean).join('\n').slice(0, 6000) })).filter((c) => c.field).map((c) => ({ label: c.label || c.field, field: c.field, ...(c.hide ? { hide: true } : {}), ...(c.sev ? { sev: true } : {}), ...(c.map ? { map: c.map } : {}) })),
        std: v.std !== false,
        message: v.message === true, sevs: parseSevs(v.sevs) ? parseSevs(v.sevs).join(',') : '' };
    });
  }
  if (id(p.trapViewDefault)) out.trapViewDefault = p.trapViewDefault;
  if (p.dash && typeof p.dash === 'object') out.dash = sanitizeDashPrefs(p.dash);
  if (Array.isArray(p.dashboards)) {        // named dashboards (1.36): the first dashboard is "dash" above; the others are saved here under their own names
    const seen = new Set();
    out.dashboards = p.dashboards.slice(0, 20).filter((x) => x && typeof x === 'object' && /^[a-z0-9_]{1,24}$/.test(x.id) && !seen.has(x.id) && seen.add(x.id)).map((x) => ({ id: x.id, name: String(x.name ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 40) || 'Dashboard', dash: sanitizeDashPrefs(x.dash && typeof x.dash === 'object' ? x.dash : {}) }));
  }
  if (typeof p.dashMainName === 'string') out.dashMainName = p.dashMainName.replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 40);
  if (p.look && typeof p.look === 'object' && !Array.isArray(p.look)) {
    const l = p.look, look = {};
    if (id(l.font)) look.font = l.font;
    if (Number.isFinite(+l.size)) look.size = Math.min(28, Math.max(9, Math.round(+l.size)));
    if (['soft', 'medium', 'solid'].includes(l.strength)) look.strength = l.strength;
    if (l.sev && typeof l.sev === 'object') {
      look.sev = {};
      for (let k = 0; k < 10; k++) {
        const s = l.sev[k]; if (!s || typeof s !== 'object') continue;
        const e = {}; if (hex(s.color)) e.color = hex(s.color); if (hex(s.bg)) e.bg = hex(s.bg); if (s.bold === true) e.bold = true;
        if (Object.keys(e).length) look.sev[k] = e;
      }
    }
    if (l.tv && typeof l.tv === 'object' && !Array.isArray(l.tv)) {        // colours for the values of one column of a trap view (e.g. your own severity words)
      look.tv = {};
      for (const [vid, t] of Object.entries(l.tv).slice(0, 60)) {
        if (!id(vid) || !t || typeof t !== 'object') continue; const vals = {};
        for (const [k, e] of Object.entries(t.vals && typeof t.vals === 'object' ? t.vals : {}).slice(0, 80)) {
          const key = String(k).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().toLowerCase().slice(0, 60); if (!key || !e || typeof e !== 'object') continue;
          const o = {}; if (hex(e.color)) o.color = hex(e.color); if (hex(e.bg)) o.bg = hex(e.bg); if (e.bold === true) o.bold = true; if (Object.keys(o).length) vals[key] = o;
        }
        look.tv[vid] = { col: Math.min(23, Math.max(-1, Math.trunc(+t.col) || 0)), vals };
      }
    }
    out.look = look;
  }
  return out;
}

async function sanitize(body, current) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) bad('Expected a JSON object.');
  const out = {};
  for (const k of EDITABLE) if (k in body) out[k] = body[k];
  const num = (k, lo, hi) => { if (k in out) out[k] = clampInt(out[k], lo, hi, current[k]); };
  num('udpPort', 1, 65535); num('udpRecvMB', 1, 256); num('tcpPort', 1, 65535); num('tlsSyslogPort', 1, 65535); num('webPort', 1, 65535);
  num('retentionDays', 0, 36500); num('alarmRetentionDays', -1, 36500); num('maxDbMB', 0, 10485760); num('sessionIdleHours', 0, 8760); num('sessionMaxDays', 0, 3650); num('liveBufferSize', 100, 100000); num('silentDeviceMinutes', 0, 100000);
  for (const k of ['tlsSyslogEnabled', 'udpEnabled', 'tcpEnabled', 'rawLogEnabled', 'healthAlerts']) if (k in out) out[k] = !!out[k];
  num('diskWarnPercent', 1, 90); num('diskCritPercent', 1, 90);
  if ('mode' in out) out.mode = out.mode === 'probe' ? 'probe' : 'central';
  if ('probe' in out) { const v = out.probe && typeof out.probe === 'object' ? out.probe : {}; const cur = current.probe || {}; const server = str(v.server, 300); if (server && !/^(https?:\/\/)?[^\s/]+(:\d+)?(\/.*)?$/i.test(server)) bad('The central server address is not valid. Example: https://nms.example.com:8514'); out.probe = { server, token: v.token === '********' ? cur.token || '' : str(v.token, 200), name: str(v.name, 60), allowSelfSigned: !!v.allowSelfSigned }; }
  if ('systemMessages' in out) { const v = out.systemMessages && typeof out.systemMessages === 'object' ? out.systemMessages : {}; out.systemMessages = Object.fromEntries(['all', 'health', 'silent', 'audit'].map((k) => [k, v[k] !== false])); }
  if ('vendorParsers' in out) { const v = out.vendorParsers && typeof out.vendorParsers === 'object' ? out.vendorParsers : {}; out.vendorParsers = Object.fromEntries(Object.keys(FAMILIES).map((k) => [k, v[k] !== false])); }
  if ('syslogBind' in out && !net.isIP(String(out.syslogBind))) bad('"Listen on address" must be an IP address such as 0.0.0.0.');
  if ('webBind' in out) { out.webBind = String(out.webBind); if (!(net.isIP(out.webBind) || out.webBind === 'localhost')) bad('The dashboard address must be an IP address.'); }

  if ('allowedSources' in out) {
    let list = out.allowedSources;
    if (typeof list === 'string') list = list.split(/[\s,;]+/);
    if (!Array.isArray(list)) bad('Allowed sources must be a list.');
    list = list.map((x) => String(x).trim()).filter(Boolean);
    if (list.length > 500) bad('At most 500 allowed sources are supported.');
    const invalid = SourceFilter.validate(list);
    if (invalid.length) bad(`Not a valid IPv4 address, IPv4 range (10.0.0.0/24) or IPv6 address: ${invalid.slice(0, 5).join(', ')}`);
    out.allowedSources = list;
  }

  if ('adminPassword' in out) {
    const pw = String(out.adminPassword ?? ''); delete out.adminPassword;
    if (pw === '********') { /* unchanged */ }
    else if (pw === '') out.adminPasswordHash = '';
    else {
      if (pw.length < 8) bad('The dashboard password must be at least 8 characters.');
      if (pw.length > 200) bad('The dashboard password is too long.');
      out.adminPasswordHash = await hashPassword(pw);
    }
  }
  for (const k of ['tlsCertFile', 'tlsKeyFile']) if (k in out) out[k] = str(out[k], 500);

  for (const k of ['forwardTargets', 'rules', 'webhooks', 'replacements']) if (k in out && !Array.isArray(out[k])) delete out[k];
  if ('forwardTargets' in out) {
    if (out.forwardTargets.length > 50) bad('At most 50 forwarding destinations are supported.');
    out.forwardTargets = out.forwardTargets.map((t) => {
      const host = str(t?.host, 253);
      if (host && !/^[A-Za-z0-9.\-_:]+$/.test(host)) bad(`"${host}" is not a valid host name or address.`);
      return { name: str(t?.name, 100), host, port: clampInt(t?.port, 1, 65535, 514), protocol: t?.protocol === 'tcp' ? 'tcp' : 'udp', enabled: t?.enabled !== false, minSeverity: t?.minSeverity === '' || t?.minSeverity === undefined ? '' : clampInt(t.minSeverity, 0, 9, 7) };
    });
  }
  if ('update' in out) {          // online update settings
    const u = out.update && typeof out.update === 'object' ? out.update : {}, cur = (current && current.update) || {};   /* the screen only sends the probe options; address, key and Node.js source are kept as they are (config-file override only) */
    const keep = (k) => (k in u ? String(u[k] || '').trim().slice(0, k === 'publicKey' ? 2000 : 300) : cur[k] || '');
    const url = keep('url'), key = keep('publicKey'), nb = keep('nodeBase').replace(/\/+$/, '');
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) bad('The update address must start with https:// (or http:// on your own network).');
    if (key && !/^[A-Za-z0-9+/=\s-]*(BEGIN PUBLIC KEY[A-Za-z0-9+/=\s-]*)?$/.test(key)) bad('The update public key has unexpected characters.');
    if (nb && !/^https?:\/\/[^\s]+$/i.test(nb)) bad('The Node.js download address must start with https:// (or http:// on your own network).');
    const flag = (k) => (k in u ? u[k] !== false : cur[k] !== false);
    out.update = { url, publicKey: key, custom: 'custom' in u ? u.custom === true : cur.custom === true, autoCheck: flag('autoCheck'), nodeBase: nb, autoProbes: flag('autoProbes'), probeAuto: flag('probeAuto'), probeTrust: flag('probeTrust') };
  }
  if ('trapForwardTargets' in out) {
    if (!Array.isArray(out.trapForwardTargets)) delete out.trapForwardTargets;
    else {
      if (out.trapForwardTargets.length > 20) bad('At most 20 SNMP trap destinations are supported.');
      out.trapForwardTargets = out.trapForwardTargets.map((t) => {
        const host = str(t?.host, 253); if (host && !/^[A-Za-z0-9.\-_:]+$/.test(host)) bad(`"${host}" is not a valid host name or address.`);
        const community = String(t?.community ?? 'public').replace(/[^\x20-\x7e]/g, '').slice(0, 64) || 'public';
        const version = t?.version === 'v1' ? 'v1' : t?.version === 'v3' ? 'v3' : 'v2c', v3 = {};
        if (version === 'v3') {
          const old = (current.trapForwardTargets || []).find((x) => x.version === 'v3' && x.host === host && x.port === clampInt(t?.port, 1, 65535, 162) && x.user === str(t?.user, 64)) || {};
          const level = ['authPriv', 'authNoPriv', 'noAuthNoPriv'].includes(t?.level) ? t.level : 'authPriv', pick = (v, o) => (v === '********' ? o || '' : String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100));
          Object.assign(v3, { user: str(t?.user, 64), level, authProto: AUTH_PROTOCOLS.includes(t?.authProto) ? t.authProto : 'SHA', privProto: PRIV_PROTOCOLS.includes(t?.privProto) ? t.privProto : 'AES128', authPass: level === 'noAuthNoPriv' ? '' : pick(t?.authPass, old.authPass), privPass: level === 'authPriv' ? pick(t?.privPass, old.privPass) : '' });
          if (host && !v3.user) bad('An SNMPv3 destination needs a user name.');
          if (host && level !== 'noAuthNoPriv' && v3.authPass.length < 8) bad('SNMPv3 destination: the authentication password must be 8 to 100 characters.');
          if (host && level === 'authPriv' && v3.privPass.length < 8) bad('SNMPv3 destination: the encryption password must be 8 to 100 characters.');
        }
        return { name: str(t?.name, 100), host, port: clampInt(t?.port, 1, 65535, 162), community, version, ...v3, enabled: t?.enabled !== false, minSeverity: t?.minSeverity === '' || t?.minSeverity === undefined ? '' : clampInt(t.minSeverity, 0, 9, 7) };
      });
    }
  }
  if ('rules' in out) out.rules = sanitizeRules(out.rules);
  if ('reports' in out) out.reports = sanitizeReports(out.reports, current.reports || []);
  if ('ntp' in out) out.ntp = sanitizeNtp(out.ntp);
  if ('snmp' in out) out.snmp = sanitizeSnmp(out.snmp, current.snmp || {});
  if ('maintenance' in out) out.maintenance = sanitizeMaintenance(out.maintenance);
  if ('backup' in out) out.backup = sanitizeBackup(out.backup, current.backup || {});
  if ('replacements' in out) out.replacements = sanitizeReplacements(out.replacements);
  if ('webhooks' in out) {
    if (out.webhooks.length > 50) bad('At most 50 webhooks are supported.');
    out.webhooks = out.webhooks.map((h) => {
      const url = str(h?.url, 500);
      if (url) { let u; try { u = new URL(url); } catch { bad(`Webhook "${str(h?.name, 40)}": the URL is not valid.`); } if (!['http:', 'https:'].includes(u.protocol)) bad(`Webhook "${str(h?.name, 40)}": only http:// and https:// URLs are allowed.`); }
      return { name: str(h?.name, 100), url, enabled: h?.enabled !== false };
    });
  }
  if ('notifProfiles' in out) {
    const list = Array.isArray(out.notifProfiles) ? out.notifProfiles : [], seen = new Set(), names = new Set();
    if (list.length > 50) bad('At most 50 notification profiles are supported.');
    out.notifProfiles = list.map((x, i) => {
      const name = str(x?.name, 100); if (!name) bad(`Notification profile ${i + 1} needs a name.`);
      if (names.has(name.toLowerCase())) bad(`There are two notification profiles named "${name}".`); names.add(name.toLowerCase());
      let id = /^[\w-]{1,40}$/.test(String(x?.id || '')) ? String(x.id) : ''; if (!id || seen.has(id)) id = 'np' + Date.now().toString(36) + i + Math.floor(Math.random() * 1000).toString(36); seen.add(id);
      const em = x?.email || {}, wh = x?.webhook || {}, sm = x?.sms || {};
      const email = { on: !!em.on, to: str(em.to, 800), cc: str(em.cc, 800) };
      if (email.to) { try { parseRecipients(email.to); } catch (e) { bad(`Profile "${name}": ${e.message}.`); } } if (email.cc) { try { parseRecipients(email.cc); } catch (e) { bad(`Profile "${name}" Cc: ${e.message}.`); } }
      if (email.on && !email.to) bad(`Profile "${name}": e-mail is switched on but there is no recipient.`);
      const webhook = { on: !!wh.on, url: str(wh.url, 600), format: ['generic', 'teams', 'slack'].includes(wh.format) ? wh.format : 'generic' };
      if (webhook.url) { let u; try { u = new URL(webhook.url); } catch { bad(`Profile "${name}": the webhook address is not valid.`); } if (!['http:', 'https:'].includes(u.protocol)) bad(`Profile "${name}": only http:// and https:// webhook addresses are allowed.`); }
      if (webhook.on && !webhook.url) bad(`Profile "${name}": webhook is switched on but there is no address.`);
      const nums = String(sm.to || '').split(/[,;\n]+/).map((v) => v.trim()).filter(Boolean);
      if (nums.length > 20) bad(`Profile "${name}": at most 20 phone numbers.`);
      for (const nn of nums) if (!cleanNumber(nn)) bad(`Profile "${name}": "${nn.slice(0, 30)}" is not a phone number (use the international form, for example +971501234567).`);
      const sms = { on: !!sm.on, to: nums.join(', ') };
      if (sms.on && !nums.length) bad(`Profile "${name}": SMS is switched on but there is no phone number.`);
      return { id, name, enabled: x?.enabled !== false, email, webhook, sms };
    });
    // a deleted profile disappears from the rules that used it
    const keep = new Set(out.notifProfiles.map((x) => x.id)), strip = (rs) => (rs || []).map((r) => { const a = r.actions || {}; const pl = (a.profiles || []).filter((i) => keep.has(i)), el = (a.alarmEscProfiles || []).filter((i) => keep.has(i)); const na = { ...a }; if (pl.length) na.profiles = pl; else delete na.profiles; if (el.length) na.alarmEscProfiles = el; else delete na.alarmEscProfiles; return { ...r, actions: na }; });
    if ('rules' in out) out.rules = strip(out.rules); else if ((current.rules || []).some((r) => (r.actions?.profiles || r.actions?.alarmEscProfiles || []).some((i) => !keep.has(i)))) out.rules = strip(current.rules);
  }
  if ('smpp' in out) {
    const s = (out.smpp && typeof out.smpp === 'object') ? out.smpp : {}, cur = current.smpp || {}, opt = (v, hi) => (v === '' || v === null || v === undefined ? '' : clampInt(v, 0, hi, 0));
    const o = { host: str(s.host, 200), port: clampInt(s.port, 1, 65535, 2775), tls: !!s.tls, allowSelfSigned: !!s.allowSelfSigned, systemId: str(s.systemId, 16), password: s.password === '********' ? (cur.password || '') : String(s.password ?? '').slice(0, 16), systemType: str(s.systemType, 13),
      bind: s.bind === 'transmitter' ? 'transmitter' : 'transceiver', sourceAddr: str(s.sourceAddr, 20), sourceTon: opt(s.sourceTon, 6), sourceNpi: opt(s.sourceNpi, 18), destTon: opt(s.destTon, 6), destNpi: opt(s.destNpi, 18), maxPerHour: clampInt(s.maxPerHour, 1, 1000, 30) };
    if (o.host && !/^[A-Za-z0-9.\-_:[\]]+$/.test(o.host)) bad('The SMS gateway name is not valid.');
    out.smpp = o;
  }
  if ('sqlCopy' in out) {
    const s = (out.sqlCopy && typeof out.sqlCopy === 'object') ? out.sqlCopy : {}, cur = current.sqlCopy || {};
    const o = { enabled: !!s.enabled, server: str(s.server, 200), database: str(s.database, 100), auth: s.auth === 'sql' ? 'sql' : 'windows', user: str(s.user, 128), password: s.password === '********' ? (cur.password || '') : String(s.password ?? '').slice(0, 128),
      encrypt: s.encrypt !== false, trustCert: !!s.trustCert, createDb: !!s.createDb, copyLogs: s.copyLogs !== false, copyTraps: s.copyTraps !== false, copyAlarms: s.copyAlarms !== false, copyDevices: s.copyDevices !== false, copyPoll: s.copyPoll !== false, backfill: !!s.backfill,
      batch: clampInt(s.batch, 100, 5000, 2000), intervalSec: clampInt(s.intervalSec, 2, 3600, 5) };
    if (o.server && !/^[A-Za-z0-9.\-_:,\\[\]]+$/.test(o.server)) bad('The SQL Server name is not valid (use name, name\\instance or name,port).');
    if (o.database && !/^[A-Za-z0-9_$# .\-]{1,100}$/.test(o.database)) bad('The database name may only use letters, digits, space and _ $ # . -');
    if (o.enabled && (!o.server || !o.database)) bad('Give the SQL Server and the database name before switching the copy on.');
    if (o.enabled && o.auth === 'sql' && !o.user) bad('Give the SQL login name, or choose Windows login.');
    out.sqlCopy = o;
  }
  if ('smtp' in out) {
    const s = (out.smtp && typeof out.smtp === 'object') ? out.smtp : {}, cur = current.smtp || {};
    const o = {
      host: str(s.host, 200), port: clampInt(s.port, 1, 65535, 587), security: ['none', 'starttls', 'tls'].includes(s.security) ? s.security : 'starttls',
      user: str(s.user, 200), password: s.password === '********' ? (cur.password || '') : String(s.password ?? '').slice(0, 500),
      from: str(s.from, 200), to: str(s.to, 800), cc: str(s.cc, 800), allowSelfSigned: !!s.allowSelfSigned, maxPerHour: clampInt(s.maxPerHour, 1, 1000, 30)
    };
    if (o.host && !/^[A-Za-z0-9.\-_:[\]]+$/.test(o.host)) bad('The mail server name is not valid.');
    if (o.from && !validAddress(addrOf(o.from))) bad('The "From" email address is not valid.');
    if (o.to) { try { parseRecipients(o.to); } catch (e) { bad(e.message + '.'); } }
    if (o.cc) { try { parseRecipients(o.cc); } catch (e) { bad('Cc: ' + e.message + '.'); } }
    out.smtp = o;
  }
  if ('deviceInfo' in out) {
    const a = out.deviceInfo;
    if (!a || typeof a !== 'object' || Array.isArray(a)) delete out.deviceInfo;
    else { const clean = {}; for (const [k, v] of Object.entries(a).slice(0, 5000)) { const key = str(k, 253); if (!key || !v || typeof v !== 'object') continue; const o = {}; const g = str(v.group, 60), n = str(v.note, 300), e = clampInt(v.expectMin, 0, 525600, 0); if (g) o.group = g; if (n) o.note = n; if (e) o.expectMin = e; if (Object.keys(o).length) clean[key] = o; } out.deviceInfo = clean; }
  }
  if ('deviceAliases' in out) {
    const a = out.deviceAliases;
    if (!a || typeof a !== 'object' || Array.isArray(a)) delete out.deviceAliases;
    else { const clean = {}; for (const [k, v] of Object.entries(a).slice(0, 5000)) { const key = str(k, 253), val = str(v, 100); if (key && val) clean[key] = val; } out.deviceAliases = clean; }
  }
  if ('mutedDevices' in out) out.mutedDevices = Array.isArray(out.mutedDevices) ? out.mutedDevices.slice(0, 5000).map((x) => str(x, 253)).filter(Boolean) : current.mutedDevices;
  if ('uiPrefs' in out) out.uiPrefs = sanitizeUiPrefs(out.uiPrefs);

  // checks that need the final combined settings
  const fin = { ...current, ...out };
  if (fin.diskCritPercent >= fin.diskWarnPercent) bad('The critical free-space percentage must be lower than the warning percentage.');
  if (!isLoopback(fin.webBind) && !fin.adminPasswordHash) bad('Set a dashboard password before allowing other computers to open the dashboard.');
  if (fin.snmp?.enabled && fin.udpEnabled && fin.snmp.port === fin.udpPort) bad('The SNMP trap port must be different from the UDP syslog port.');
  if (fin.tlsSyslogEnabled && [fin.webPort, fin.tcpEnabled ? fin.tcpPort : -1].includes(fin.tlsSyslogPort)) bad('The secure syslog port must be different from the TCP syslog port and from the dashboard port.');
  if (fin.tlsSyslogEnabled && !(fin.tlsCertFile && fin.tlsKeyFile)) bad('Secure syslog needs a certificate. Set one up under Access & updates → HTTPS first.');
  if (fin.tcpEnabled && fin.tcpPort === fin.webPort) bad('The dashboard port must be different from the TCP syslog port.');
  for (const t of fin.trapForwardTargets || []) { if (t.enabled !== false && ['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(String(t.host).toLowerCase()) && fin.snmp?.enabled && t.port === fin.snmp.port) bad(`Forwarding traps to ${t.host}:${t.port} would send every trap back into this receiver.`); }
  for (const t of fin.forwardTargets || []) {
    const selfHost = ['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(String(t.host).toLowerCase());
    if (t.enabled !== false && selfHost && ((t.protocol === 'tcp' && fin.tcpEnabled && t.port === fin.tcpPort) || (t.protocol !== 'tcp' && fin.udpEnabled && t.port === fin.udpPort))) bad(`Forwarding to ${t.host}:${t.port} would send every message back to NetEventPro itself.`);
  }
  if (fin.tlsCertFile || fin.tlsKeyFile) {
    if (!(fin.tlsCertFile && fin.tlsKeyFile)) bad('Enter both the HTTPS certificate file and the key file, or leave both empty.');
    for (const f of [fin.tlsCertFile, fin.tlsKeyFile]) if (!fs.existsSync(f)) bad(`File not found on this computer: ${f}`);
  }
  return out;
}

main().catch((e) => { console.error('[fatal] startup failed:', e); process.exit(1); });
