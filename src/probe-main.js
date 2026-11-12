'use strict';
// The lean program that runs when this computer is a PROBE (config mode "probe"). It receives syslog and SNMP traps, keeps them in a queue on
// disk and sends them to the main NetEventPro (see probe.js). Nothing else is loaded: no database, rules, alarms, reports, MIB files, e-mail,
// users or dashboard. The only web page is a small status and settings page that opens from this computer only.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const dgram = require('node:dgram');
const { Probe } = require('./probe');
const { ProbePoller } = require('./probepoll');
const { Listeners } = require('./listeners');
const { SourceFilter } = require('./acl');
const { hashPassword, verifyPassword, needsRehash, LoginGuard } = require('./auth');
const secmod = require('./security');
const certgen = require('./certgen');
const { restrictToAdmins } = require('./config');

const PAGES = { '/': ['probe.html', 'text/html; charset=utf-8'], '/probe.js': ['probe.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
const HEAD = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store',
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'" };
const XRW = new Set(['NetEventPro', 'SyslogPro']);
const isPort = (n) => Number.isInteger(n) && n >= 1 && n <= 65535;
const clean = (a) => (a || '').replace(/^::ffff:/, '');

async function run(config, { version, updater, root = path.join(__dirname, '..', 'public') } = {}) {
  const probe = new Probe(config, config.dir); const poller = new ProbePoller(probe, config.dir);      // SNMP polling of devices in this network (1.48)
  const sources = new SourceFilter(); sources.load(config.get().allowedSources);
  const listeners = new Listeners((buf, ip) => probe.addSyslog(buf, ip), (ip) => sources.allows(ip));
  // ---- this page's own security (1.44): sign-in, audit log, optional HTTPS and network access ----
  const guard = new LoginGuard({ maxFails: 5, lockMs: 600000, windowMs: 600000 }), sess = new Map(), SESS_IDLE = 30 * 60000, shaT = (x) => crypto.createHash('sha256').update(x).digest('hex');
  const auditFile = path.join(config.dir, 'probe-audit.log');
  const audit = (text) => { try { if (fs.existsSync(auditFile) && fs.statSync(auditFile).size > 1e6) fs.renameSync(auditFile, auditFile + '.1'); fs.appendFileSync(auditFile, JSON.stringify({ t: Date.now(), text }) + '\n', { mode: 0o600 }); } catch { /* best effort */ } };
  const readAudit = (n = 100) => { try { return fs.readFileSync(auditFile, 'utf8').trim().split('\n').slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse(); } catch { return []; } };
  const tlsOn = () => { const p = config.get().probe || {}; return !!(p.tlsCertFile && p.tlsKeyFile && fs.existsSync(p.tlsCertFile) && fs.existsSync(p.tlsKeyFile)); };
  let bindNow = '127.0.0.1', tlsNow = false;
  const webFilter = new SourceFilter(); webFilter.load((config.get().probe || {}).webAllow);
  { const p0 = config.get().probe || {}; if (p0.token && !probe.box.constructor.isSealed(p0.token)) config.update({ probe: { ...p0, token: probe.box.seal(p0.token) } }); }   // an older plain token is encrypted once
  const snmp = { running: false, port: null, error: '', packets: 0, rejected: 0 }; let trapSock = null;

  const startTraps = (c) => new Promise((resolve) => {
    const s = c.snmp || {};
    if (trapSock) { try { trapSock.close(); } catch { /* closing */ } trapSock = null; snmp.running = false; }
    if (!s.enabled) return resolve();
    const bind = s.bind || '0.0.0.0', sock = dgram.createSocket({ type: bind.includes(':') ? 'udp6' : 'udp4', reuseAddr: false }); snmp.port = s.port; snmp.error = '';
    sock.on('error', (e) => { snmp.running = false; snmp.error = e.code === 'EADDRINUSE' ? `UDP port ${s.port} is already in use by another program.` : e.code === 'EACCES' ? `No permission to use UDP port ${s.port}.` : e.message; console.error('[snmp]', snmp.error); try { sock.close(); } catch { /* ignore */ } resolve(); });
    sock.on('message', (buf, rinfo) => { const ip = clean(rinfo.address); if (!sources.allows(ip)) { snmp.rejected++; return; } snmp.packets++; probe.addTrap(buf, ip, rinfo, sock); });
    sock.bind(s.port, bind, () => { try { sock.setRecvBufferSize(4 * 1024 * 1024); } catch { /* OS may cap it */ } snmp.running = true; trapSock = sock; console.log(`[snmp] listening on ${bind}:${s.port} (probe)`); resolve(); });
  });
  const applyNet = async (c) => { sources.load(c.allowedSources); await listeners.apply({ ...c, tlsSyslogEnabled: false }); await startTraps(c); };
  await applyNet(config.get());
  let prev = JSON.stringify([config.get().udpPort, config.get().tcpPort, config.get().udpEnabled, config.get().tcpEnabled, config.get().syslogBind, config.get().snmp]);
  config.onChange((c) => { const k = JSON.stringify([c.udpPort, c.tcpPort, c.udpEnabled, c.tcpEnabled, c.syslogBind, c.snmp]); sources.load(c.allowedSources); if (k !== prev) { prev = k; applyNet(c); } });

  const view = () => {
    const c = config.get(), p = c.probe || {};
    return { poll: poller.status(), version, auth: { passwordSet: !!p.pwHash, signedIn: true, https: tlsOn() }, security: { requireHttps: !!p.requireHttps, pinSha256: p.pinSha256 || '', rateLimit: p.rateLimit || 0, webBind: p.webBind || '127.0.0.1', webAllow: p.webAllow || [], tlsCertFile: p.tlsCertFile || '', tlsKeyFile: p.tlsKeyFile || '', bindActive: bindNow, tlsActive: tlsNow, plainHttp: /^http:\/\//i.test(p.server || '') }, status: probe.status(), settings: { server: p.server || '', name: p.name || '', tokenSet: !!p.token, allowSelfSigned: !!p.allowSelfSigned, udpPort: c.udpPort, tcpPort: c.tcpPort, udpEnabled: c.udpEnabled !== false, tcpEnabled: c.tcpEnabled !== false, snmpEnabled: c.snmp?.enabled !== false, snmpPort: c.snmp?.port || 162, allowedSources: c.allowedSources || '' },
      listeners: { udp: listeners.status.udp, tcp: listeners.status.tcp, snmp }, update: updater ? { ...updater.pub(), auto: { error: auto.error, last: auto.last, offered: auto.offered } } : null, updateCfg: { url: c.update?.url || '', hasKey: !!c.update?.publicKey, probeAuto: c.update?.probeAuto !== false, probeTrust: c.update?.probeTrust !== false }, queueFile: probe.file };
  };
  const read = (req) => new Promise((resolve, reject) => { const ch = []; let n = 0; req.on('data', (d) => { n += d.length; if (n > 65536) { reject(Object.assign(new Error('Too large'), { code: 413 })); req.destroy(); } else ch.push(d); }); req.on('end', () => { try { resolve(ch.length ? JSON.parse(Buffer.concat(ch).toString()) : {}); } catch { reject(Object.assign(new Error('Invalid JSON'), { code: 400 })); } }); });
  const json = (res, o, code = 200) => { res.writeHead(code, { ...HEAD, 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
  const fail = (msg, code = 400) => Object.assign(new Error(msg), { code });

  function save(b) {
    const c = config.get(), p = { ...(c.probe || {}) }, out = {};
    if ('server' in b) { const s = String(b.server || '').trim().slice(0, 300); if (s) { try { new URL(s.includes('://') ? s : 'https://' + s); } catch { throw fail('The server address is not valid. Example: https://nms.example.com:8514'); } } p.server = s; }
    if ('name' in b) p.name = String(b.name || '').trim().slice(0, 60);
    if ('token' in b && b.token && b.token !== '********') { p.token = probe.box.seal(String(b.token).trim().slice(0, 200)); audit('saved a new probe token'); }
    if ('allowSelfSigned' in b) p.allowSelfSigned = !!b.allowSelfSigned;
    if ('requireHttps' in b) p.requireHttps = !!b.requireHttps;
    if ('rateLimit' in b) { const n = Math.round(Number(b.rateLimit)); if (!(n >= 0 && n <= 100000)) throw fail('The limit is a number of packets per second from 0 (off) to 100000.'); p.rateLimit = n; }
    if ('webAllow' in b) { const l = (Array.isArray(b.webAllow) ? b.webAllow : String(b.webAllow || '').split(/[\s,;]+/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 50), bad = SourceFilter.validate(l); if (bad.length) throw fail(`Not an IP address or range: ${bad.slice(0, 3).join(', ')}`); p.webAllow = l; webFilter.load(l); }
    if ('webBind' in b) { const v = b.webBind === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1'; if (v !== '127.0.0.1' && !p.pwHash) throw fail('Set a password for this page first. Without it nobody should reach it from the network.'); p.webBind = v; }
    if (b.server !== undefined || b.requireHttps !== undefined || b.allowSelfSigned !== undefined || b.rateLimit !== undefined || b.webBind !== undefined || b.webAllow !== undefined) audit('changed probe settings');
    out.probe = p;
    for (const k of ['udpPort', 'tcpPort']) if (k in b) { if (!isPort(+b[k])) throw fail('Ports are numbers from 1 to 65535.'); out[k] = +b[k]; }
    for (const k of ['udpEnabled', 'tcpEnabled']) if (k in b) out[k] = !!b[k];
    if ('snmpEnabled' in b || 'snmpPort' in b) { if ('snmpPort' in b && !isPort(+b.snmpPort)) throw fail('Ports are numbers from 1 to 65535.'); out.snmp = { ...(c.snmp || {}), enabled: 'snmpEnabled' in b ? !!b.snmpEnabled : c.snmp?.enabled !== false, port: 'snmpPort' in b ? +b.snmpPort : c.snmp?.port || 162 }; }
    if ('allowedSources' in b) out.allowedSources = String(b.allowedSources || '').slice(0, 4000);
    config.update(out);
  }

  const handler = async (req, res) => {
    try {
      const host = (req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, ''), rip = clean(req.socket.remoteAddress), isLoop = rip === '127.0.0.1' || rip === '::1';
      if (bindNow === '127.0.0.1') { if (!['localhost', '127.0.0.1', '::1'].includes(host)) { res.writeHead(403, HEAD); return res.end('Forbidden host'); } }   // DNS-rebinding guard while the page is only for this computer
      else if (!isLoop && webFilter.active && !webFilter.allows(rip)) { res.writeHead(403, HEAD); return res.end('This address is not allowed'); }
      const url = new URL(req.url, 'http://x'), p = url.pathname;
      if (!p.startsWith('/api/')) {
        const f = PAGES[p]; if (!f || (req.method !== 'GET' && req.method !== 'HEAD')) { res.writeHead(404, HEAD); return res.end('Not found'); }
        const body = fs.readFileSync(path.join(root, f[0])); res.writeHead(200, { ...HEAD, 'content-type': f[1], 'content-length': body.length }); return res.end(req.method === 'HEAD' ? undefined : body);
      }
      const site = req.headers['sec-fetch-site']; if (site && site !== 'same-origin' && site !== 'none') return json(res, { error: 'Cross-site request refused' }, 403);
      if (req.method !== 'GET' && !XRW.has(req.headers['x-requested-with'])) return json(res, { error: 'Missing X-Requested-With header' }, 403);
      // ---- sign-in (only when a password is set; without one the page is for this computer only) ----
      const cookie = /(?:^|;\s*)pr_session=([A-Za-z0-9_-]{20,80})/.exec(req.headers.cookie || ''), pwh = (config.get().probe || {}).pwHash;
      const sk = cookie ? shaT(cookie[1]) : '', se = sk && sess.get(sk), liveSess = !!(se && Date.now() - se.last < SESS_IDLE);
      if (liveSess) se.last = Date.now(); else if (se) sess.delete(sk);
      const setCookie = (tok, age) => ({ 'set-cookie': `pr_session=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${tlsNow ? '; Secure' : ''}` });
      if (p === '/api/probe/login' && req.method === 'POST') {
        if (!pwh) return json(res, { ok: true });
        if (guard.locked(rip)) return json(res, { error: 'Too many wrong passwords. Try again in 10 minutes.' }, 429);
        const b = await read(req);
        if (!(await verifyPassword(String(b.password || ''), pwh))) { guard.fail(rip); audit(`failed sign-in from ${rip}`); return json(res, { error: 'Wrong password.' }, 401); }
        guard.success(rip); audit(`signed in from ${rip}`);
        if (needsRehash(pwh)) { try { config.update({ probe: { ...(config.get().probe || {}), pwHash: await hashPassword(String(b.password)) } }); } catch { /* old hash keeps working */ } }
        const tok = crypto.randomBytes(32).toString('base64url'); sess.set(shaT(tok), { last: Date.now(), ip: rip }); if (sess.size > 50) sess.delete(sess.keys().next().value);
        res.writeHead(200, { ...HEAD, ...setCookie(tok, 86400), 'content-type': 'application/json; charset=utf-8' }); return res.end('{"ok":true}');
      }
      if (p === '/api/probe/logout' && req.method === 'POST') { if (sk) sess.delete(sk); res.writeHead(200, { ...HEAD, ...setCookie('', 0), 'content-type': 'application/json; charset=utf-8' }); return res.end('{"ok":true}'); }
      if (pwh && !liveSess) {
        if (p === '/api/probe/view' && req.method === 'GET') return json(res, { version, auth: { passwordSet: true, signedIn: false } });
        return json(res, { error: 'Sign in required', login: true }, 401);
      }
      if (p === '/api/probe/view' && req.method === 'GET') return json(res, view());
      if (p === '/api/probe/password' && req.method === 'POST') {
        const b = await read(req), np = String(b.password || '');
        if (pwh && !(await verifyPassword(String(b.current || ''), pwh))) { audit(`wrong current password when changing the password (${rip})`); throw fail('The current password is not correct.', 403); }
        const bad = secmod.passwordProblem(np, { minLength: 10 }, ''); if (bad && np !== '') throw fail(bad);
        if (np === '') { if (!pwh) throw fail('There is no password to remove.'); if (b.confirm !== 'REMOVE') throw fail('Confirmation is missing.'); if ((config.get().probe || {}).webBind !== '127.0.0.1') throw fail('Set "Who can open this page" to this computer only first.'); }
        config.update({ probe: { ...(config.get().probe || {}), pwHash: np ? await hashPassword(np) : '' } }); sess.clear(); audit(np ? 'set a new password' : 'removed the password');
        if (np) { const tok = crypto.randomBytes(32).toString('base64url'); sess.set(shaT(tok), { last: Date.now(), ip: rip }); res.writeHead(200, { ...HEAD, ...setCookie(tok, 86400), 'content-type': 'application/json; charset=utf-8' }); return res.end('{"ok":true}'); }
        return json(res, { ok: true });
      }
      if (p === '/api/probe/audit' && req.method === 'GET') return json(res, { rows: readAudit() });
      if (p === '/api/probe/pin/fetch' && req.method === 'POST') { const c = config.get().probe || {}; try { return json(res, { ok: true, ...(await Probe.fetchPin(c.server || '')) }); } catch (e) { return json(res, { ok: false, error: e.message }); } }
      if (p === '/api/probe/pin' && req.method === 'POST') {
        const b = await read(req), fp = String(b.fingerprint || '').toLowerCase().replace(/[^0-9a-f]/g, ''); if (fp && fp.length !== 64) throw fail('That is not a SHA-256 fingerprint.');
        config.update({ probe: { ...(config.get().probe || {}), pinSha256: fp } }); audit(fp ? `pinned the server certificate ${fp.slice(0, 16)}…` : 'removed the certificate pin'); return json(res, { ok: true });
      }
      if (p === '/api/probe/https/generate' && req.method === 'POST') {
        const b = await read(req); const g = certgen.generate({ hosts: String(b.hosts || certgen.defaultHosts().join(', ')) }); const d = path.join(config.dir, 'tls'); fs.mkdirSync(d, { recursive: true });
        const crt = path.join(d, 'probe.crt'), key = path.join(d, 'probe.key'); fs.writeFileSync(crt, g.cert); fs.writeFileSync(key, g.key, { mode: 0o600 }); try { restrictToAdmins(key); } catch { /* best effort */ }
        config.update({ probe: { ...(config.get().probe || {}), tlsCertFile: crt, tlsKeyFile: key } }); audit('created a certificate for this page'); return json(res, { ok: true, names: g.names, fingerprint: g.fingerprint, restart: true });
      }
      if (p === '/api/probe/https/off' && req.method === 'POST') { config.update({ probe: { ...(config.get().probe || {}), tlsCertFile: '', tlsKeyFile: '' } }); audit('turned HTTPS off for this page'); return json(res, { ok: true, restart: true }); }
      if (p === '/api/probe/sessions/clear' && req.method === 'POST') { sess.clear(); audit('signed out all browsers'); return json(res, { ok: true }); }
      if (p === '/api/probe/settings' && req.method === 'PUT') { save(await read(req)); return json(res, view()); }
      if (p === '/api/probe/test' && req.method === 'POST') {
        const c = probe.cfg(); if (!c.server || !c.token) throw fail('Enter the server address and the token first, and save.');
        try { await probe.post(c, { probe: c.name || '', items: [] }); return json(res, { ok: true }); } catch (e) { return json(res, { ok: false, error: e.message }); }
      }
      if (p === '/api/probe/mode' && req.method === 'POST') { const b = await read(req); if (b.confirm !== 'CENTRAL') throw fail('Confirmation is missing.'); config.update({ mode: 'central' }); json(res, { ok: true }); setTimeout(() => shutdown(1), 600); return; }
      if (p === '/api/restart' && req.method === 'POST') { json(res, { ok: true }); setTimeout(() => shutdown(1), 300); return; }
      if (p === '/api/probe/update' && req.method === 'PUT') { const b = await read(req); const cur = config.get().update || {}; config.update({ update: { ...cur, url: String(b.url || '').trim().slice(0, 500), publicKey: b.publicKey ? String(b.publicKey).trim().slice(0, 2000) : cur.publicKey || '', probeAuto: b.probeAuto !== false, probeTrust: b.probeTrust !== false } }); return json(res, view()); }
      if (p === '/api/update/check' && req.method === 'POST' && updater) return json(res, await updater.check());
      if (p === '/api/update/install' && req.method === 'POST' && updater) {
        const b = await read(req); if (b.confirm !== 'INSTALL') throw fail('Confirmation is missing.');
        const v = await updater.install().catch((e) => { throw fail(e.message); }); json(res, { ok: true, version: v }); setTimeout(() => shutdown(1), 800); return;
      }
      json(res, { error: 'Not found' }, 404);
    } catch (e) { json(res, { error: e.message }, e.code >= 400 && e.code < 600 ? e.code : 500); }
  };

  const c0 = config.get(), pr0 = c0.probe || {};
  // the page listens on this computer only, unless a password is set and "other computers" was chosen; HTTPS when a certificate is set
  bindNow = pr0.webBind === '0.0.0.0' && pr0.pwHash ? '0.0.0.0' : '127.0.0.1'; tlsNow = tlsOn();
  if (tlsNow) HEAD['strict-transport-security'] = 'max-age=31536000';
  const mk = () => { const s = tlsNow ? https.createServer({ cert: fs.readFileSync(pr0.tlsCertFile), key: fs.readFileSync(pr0.tlsKeyFile), minVersion: 'TLSv1.2' }, handler) : http.createServer(handler); s.headersTimeout = 15000; s.requestTimeout = 30000; return s; };
  const server = mk(), server6 = mk(); server6.on('error', () => { /* no IPv6 on this PC */ });
  server.once('error', (e) => console.error(`[web] the probe status page cannot listen on ${bindNow}:${c0.webPort} — ${e.message}`));
  const scheme = tlsNow ? 'https' : 'http';
  await new Promise((r) => server.listen(c0.webPort, bindNow, () => { console.log(`[web] probe page at ${scheme}://127.0.0.1:${c0.webPort}/ (${bindNow === '127.0.0.1' ? 'this computer only' : 'network access, sign-in required'})`); r(); }));
  // "localhost" is IPv6 (::1) first on many Windows PCs: listen there as well, or the shortcut and the typed address would not connect
  await new Promise((r) => { server6.once('error', r); server6.listen(c0.webPort, '::1', () => r()); });
  try { const d = path.join(config.dir, 'ui'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'web.json'), JSON.stringify({ scheme, port: c0.webPort, bind: '127.0.0.1' })); } catch { /* not critical */ }
  // ---- 1.49: install the update that the main server offers (the package was signed by the release key; it is checked here before anything is written) ----
  const auto = { busy: false, error: '', last: 0, offered: '' };
  const autoUpdate = async () => {
    const u = config.get().update || {}, c = probe.cfg();
    if (!probe.on || auto.busy || !updater || u.probeAuto === false || !c.server || !c.token) return;
    auto.busy = true;
    try {
      const info = await probe.post(c, { probe: c.name || '', version }, '/api/probe/selfupdate'); auto.last = Date.now(); auto.error = '';
      if (!info || !info.available) { auto.offered = ''; return; }
      auto.offered = info.version;
      const pkg = async () => { const r = await probe.post(c, { probe: c.name || '', version }, '/api/probe/selfupdatepkg'); return Buffer.from(String(r && r.data || ''), 'base64'); };
      let v;
      if (info.unsigned) {   // the main server was updated from the installer: the update is its own program files, taken over the authenticated probe link
        if (u.probeTrust === false) throw new Error(`The server offers ${info.version} (its installed program files), and this probe is set not to trust the server for updates. Update this probe with the installer, or tick "Trust the main server" in Settings → Updates.`);
        v = updater.installBundle(await pkg(), info.version, info.sha256);
      } else {
        const own = String(u.publicKey || require('./update-defaults').publicKey || '').trim(), key = own || (c.pinSha256 ? String(info.publicKey || '') : '');   // the server's key is trusted only over a pinned certificate
        if (!key) throw new Error(`The server offers ${info.version}, but this probe has no release public key (Settings → Updates) and no pinned server certificate to trust the server's key.`);
        v = updater.installFromServer(await pkg(), { version: info.version, sha256: info.sha256, sig: info.sig }, key);
      }
      audit(`updated from ${version} to ${v} (offered by the main server)`); console.log(`[neteventpro] updated to ${v} from the main server; restarting`); setTimeout(() => shutdown(1), 800);
    } catch (e) { auto.error = e.message; } finally { auto.busy = false; }
  };
  { const t1 = setInterval(() => autoUpdate().catch(() => {}), 5 * 60000), t2 = setTimeout(() => autoUpdate().catch(() => {}), 45000); t1.unref?.(); t2.unref?.(); }
  console.log(`[neteventpro] v${version} PROBE mode, data dir: ${config.dir}`);

  function shutdown(code = 0) {
    console.log('[neteventpro] shutting down');
    try { probe.shutdown(); } catch { /* ignore */ }
    try { poller.shutdown(); } catch { /* ignore */ }
    try { server.close(); server6.close(); trapSock?.close(); } catch { /* ignore */ }
    listeners.stop().finally(() => process.exit(code)); setTimeout(() => process.exit(code), 2000).unref();
  }
  process.on('SIGINT', () => shutdown(0)); process.on('SIGTERM', () => shutdown(0));
  process.on('uncaughtException', (e) => console.error('[fatal]', e)); process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
  return { shutdown, probe, server };
}
module.exports = { run };
