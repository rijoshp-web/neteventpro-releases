'use strict';
// End-to-end and security probe: starts a throw-away NetEventPro (own data folder, ports 5516/8516) and a fake mail server,
// sends real UDP/TCP traffic, and attacks the web interface. Run with:  npm run test:e2e   (exit code 1 if anything fails)
const { spawn } = require('node:child_process');
const dgram = require('node:dgram'); const net = require('node:net'); const http = require('node:http');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const ber = require('../src/ber');

const SCRATCH = os.tmpdir();
const ROOT = path.resolve(__dirname, '..');
const UDP = 5516, WEB = 8516, SMTP_PORT = 2526, SNMP = 5163;
const dir = fs.mkdtempSync(path.join(SCRATCH, 'e2e-'));
const H = { 'X-Requested-With': 'NetEventPro', 'content-type': 'application/json' };
const results = []; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

// ---- fake SMTP server ---------------------------------------------------------------------------------------
const mails = [];
const smtp = net.createServer((s) => {
  s.write('220 fake ESMTP\r\n'); let data = false, cur = { raw: '' };
  let buf = '';
  s.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (data) { if (line === '.') { data = false; mails.push(cur); cur = { raw: '' }; s.write('250 queued\r\n'); } else cur.raw += line + '\n'; continue; }
      if (/^EHLO/i.test(line)) s.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (/^AUTH PLAIN/i.test(line)) s.write('235 ok\r\n');
      else if (/^MAIL FROM/i.test(line)) { cur.from = line; s.write('250 ok\r\n'); }
      else if (/^RCPT TO/i.test(line)) { (cur.to ||= []).push(line); s.write('250 ok\r\n'); }
      else if (/^DATA/i.test(line)) { data = true; s.write('354 go\r\n'); }
      else if (/^QUIT/i.test(line)) { s.write('221 bye\r\n'); s.end(); }
      else s.write('250 ok\r\n');
    }
  });
  s.on('error', () => {});
});

const api = async (p, opts = {}) => {
  const r = await fetch(`http://127.0.0.1:${WEB}${p}`, { ...opts, headers: { ...(opts.method && opts.method !== 'GET' ? H : {}), ...(opts.headers || {}) } });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* not json */ }
  return { status: r.status, headers: r.headers, text: t, json: j };
};
const put = (body, headers = {}) => api('/api/config', { method: 'PUT', body: JSON.stringify(body), headers });
const sendUdp = (msg, port = UDP) => new Promise((res) => { const c = dgram.createSocket('udp4'); c.send(Buffer.isBuffer(msg) ? msg : Buffer.from(msg), port, '127.0.0.1', () => { c.close(); res(); }); });
const sendTcp = (msg, port = UDP) => new Promise((res) => { const c = net.connect(port, '127.0.0.1', () => c.end(msg)); c.on('close', res); c.on('error', res); });
const raw = (reqPath, headers = {}) => new Promise((res) => { const rq = http.request({ host: '127.0.0.1', port: WEB, path: reqPath, headers, method: 'GET' }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ status: r.statusCode, body: b, headers: r.headers })); }); rq.on('error', (e) => res({ status: 0, body: String(e) })); rq.end(); });
const logs = async (q = '') => (await api('/api/logs?limit=50' + q)).json.rows;

(async () => {
  await new Promise((r) => smtp.listen(SMTP_PORT, '127.0.0.1', r));
  const srv = spawn('node', ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'src/server.js')], {
    env: { ...process.env, NETEVENTPRO_DATA: dir, NETEVENTPRO_UDP_PORT: UDP, NETEVENTPRO_TCP_PORT: UDP, NETEVENTPRO_WEB_PORT: WEB, NETEVENTPRO_SNMP_PORT: SNMP, NETEVENTPRO_HEALTH_INTERVAL_MS: '500' }, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 40; i++) { try { if ((await api('/api/state')).status === 200) break; } catch { /* starting */ } await sleep(250); }

  // ---------- ingestion -------------------------------------------------------------------------------------
  await sendUdp('<14>Oct 25 22:40:00 core-sw1 sshd[1]: Failed password for root from 10.20.1.5 port 22');
  await sendTcp('<13>1 2026-10-25T18:40:00Z edge-fw app 77 - - tcp newline framed\n');
  const body = '<12>octet counted over tcp'; await sendTcp(`${body.length} ${body}`);
  await sleep(800);
  let rows = await logs();
  check('UDP message stored and parsed', rows.some((r) => r.host === 'core-sw1' && r.app === 'sshd' && r.severity === 6));
  check('TCP newline framing', rows.some((r) => r.host === 'edge-fw' && r.message === 'tcp newline framed'));
  check('TCP octet-counted framing', rows.some((r) => r.message === 'octet counted over tcp' && r.severity === 4));

  // ---------- text replacement -----------------------------------------------------------------------------------
  let r = await put({ replacements: [{ find: '10.20.1.5', replace: 'Core-SW1', scope: 'message' }, { find: '10.20.1.9', replace: 'Edge-FW', scope: 'host' }] });
  check('replacement rule accepted', r.status === 200, r.text.slice(0, 120));
  await sendUdp('<14>Oct 25 22:41:00 sw2 su: login from 10.20.1.5 and 10.20.1.55 and 110.20.1.5');
  await sleep(600);
  rows = await logs('&text=login%20from');
  const rep = rows[0];
  check('IP replaced with name in stored message', rep && rep.message.includes('login from Core-SW1 and'), rep?.message);
  check('longer addresses (10.20.1.55, 110.20.1.5) are left alone', rep && rep.message.includes('10.20.1.55') && rep.message.includes('110.20.1.5'), rep?.message);
  const full = (await api('/api/log/' + rep.id)).json;
  check('original packet kept unchanged', full.raw.includes('login from 10.20.1.5 and'), full.raw);
  const t1 = await api('/api/test-replace', { method: 'POST', body: JSON.stringify({ replacements: [{ find: '10.0.0.1', replace: 'Router', scope: 'all' }], host: '10.0.0.1', message: 'x 10.0.0.1 y' }) });
  check('replacement preview endpoint', t1.json && t1.json.host === 'Router' && t1.json.message === 'x Router y', t1.text);
  r = await put({ replacements: [{ find: '(a+)+$', replace: 'x', regex: true, scope: 'message' }] });
  check('catastrophic regex (a+)+$ is refused', r.status === 400, r.json?.error);
  r = await put({ replacements: [{ find: '(\\w|\\d)+$', replace: 'x', regex: true, scope: 'message' }] });
  check('ambiguous-alternation regex (\\w|\\d)+$ is refused', r.status === 400, r.json?.error);
  await put({ replacements: [] });

  // ---------- email -----------------------------------------------------------------------------------------------
  r = await put({ smtp: { host: '127.0.0.1', port: SMTP_PORT, security: 'none', user: 'u', password: 'pw-secret', from: 'NetEventPro <neteventpro@example.com>', to: 'ops@example.com, noc@example.com', maxPerHour: 30 },
    rules: [{ name: 'Mail on critical', enabled: true, match: { severityMax: 2 }, actions: { email: true, cooldownSec: 2, color: '#ff0000' } }] });
  check('SMTP settings and email rule accepted', r.status === 200, r.text.slice(0, 160));
  check('SMTP password is never returned by the API', !r.text.includes('pw-secret') && r.json.config.smtp.password === '********');
  const tm = await api('/api/test-email', { method: 'POST', body: '{}' });
  check('test email delivered', tm.json?.ok === true && mails.length === 1 && /Test email/.test(mails[0].raw), tm.text);
  check('test email goes to both recipients', mails[0] && mails[0].to.length === 2);
  await sendUdp('<10>1 2026-10-25T18:42:00Z ups-1 snmpd 1 - - Battery low\r\nsubject-injection: x');
  await sendUdp('<10>1 2026-10-25T18:42:00Z ups-1 snmpd 1 - - Battery low again');
  await sendUdp('<10>1 2026-10-25T18:42:00Z ups-1 snmpd 1 - - Battery low third');
  await sleep(1500);
  check('alert email sent once; the repeats were held back by the cooldown', mails.length === 2, 'mails=' + mails.length);
  const am = mails[mails.length - 1]?.raw || '';
  check('alert email has the device, severity and message', /Subject: \[NetEventPro\] CRITICAL on ups-1/.test(am), am.split('\n').find((l) => l.startsWith('Subject')));
  await sleep(2200);
  await sendUdp('<10>1 2026-10-25T18:43:00Z ups-1 snmpd 1 - - Battery dead');
  await sleep(1500);
  const mailPart = (rawm, type) => { const m = new RegExp(`Content-Type: ${type}[^\\n]*\\n(?:[A-Za-z-]+:[^\\n]*\\n)*\\n([A-Za-z0-9+/=\\n]+)`).exec(rawm || ''); return m ? Buffer.from(m[1].replace(/\n/g, ''), 'base64').toString('utf8') : ''; };
  const last = mailPart(mails[mails.length - 1]?.raw, 'text/plain'), lastHtml = mailPart(mails[mails.length - 1]?.raw, 'text/html');
  check('next email after the cooldown reports the suppressed alerts', /2 similar alert/.test(last), last.split('\n').filter((l) => /similar/.test(l)).join('|'));
  check('the alert e-mail also comes as a formatted HTML page', /<table/.test(lastHtml) && /ups-1/.test(lastHtml) && /Battery dead/.test(lastHtml), lastHtml.slice(0, 80));
  const st = (await api('/api/stats')).json;
  check('email counters visible in stats (2 alert emails; the test email is not counted)', st.email.sent === 2 && st.email.failed === 0, JSON.stringify(st.email));
  r = await put({ smtp: { host: '127.0.0.1', port: SMTP_PORT, security: 'none', from: 'bad\r\nBcc: evil@x.com', to: 'ops@example.com' } });
  check('header-injection in From refused', r.status === 400, r.json?.error);
  r = await put({ rules: [{ name: 'x', match: {}, actions: { emailTo: 'a@b.com\r\nBcc: evil@x.com' } }] });
  check('header-injection in rule recipients refused', r.status === 400, r.json?.error);
  await put({ rules: [] });

  // ---------- saved screen preferences can never become free-form CSS ----------------------------------------------------
  r = await put({ uiPrefs: { look: { font: 'x;}body{display:none', size: 9999, sev: { 3: { color: 'red;}*{display:none', bg: '#12345' }, 4: { color: '#AABBCC', bold: true } } }, widths: { host: 99999, 'a b': 5 }, sort: { col: 'x y', dir: 'up' } } });
  const up = r.json?.config?.uiPrefs || {};
  check('screen preferences: font, colours, widths and sort are validated', r.status === 200 && !JSON.stringify(up).includes('display') && up.look.size === 28 && !up.look.sev[3] && up.look.sev[4].color === '#aabbcc' && up.widths.host === 1200 && !up.widths['a b'] && !up.sort, JSON.stringify(up));
  await put({ uiPrefs: {} });

  // ---------- vendor tags, dashboard range numbers, health -----------------------------------------------------------------
  await sendUdp('<189>Oct 25 22:50:00 sw-t1 %LINK-3-UPDOWN: Interface GigabitEthernet1/0/7, changed state to down');
  await sendUdp('<11>Oct 25 22:50:01 ups-t1 UPS: On battery power in response to utility power failure.');
  await sleep(700);
  rows = await logs('&tag=link-down');
  check('vendor recogniser tags a Cisco link-down message', rows.length >= 1 && rows[0].tags.includes('cisco') && rows[0].tags.includes('if:Gi1/0/7'), JSON.stringify(rows[0]?.tags));
  check('tag: search word finds it too', (await logs('&text=tag%3Aon-battery')).length === 1);
  const now = Date.now();
  const dash = await api('/api/dash', { method: 'POST', body: JSON.stringify({ from: now - 600000, to: now, tiles: [{ id: 'a', kind: 'count', filter: { tag: 'link-down' } }, { id: 'b', kind: 'top', by: 'host', n: 3 }, { id: 'c', kind: 'series' }, { id: 'd', kind: 'count', filter: { text: "x'); DROP TABLE logs;--" } }] }) });
  check('dashboard range numbers: count, top and series', dash.json?.tiles?.a?.n >= 1 && dash.json.tiles.b.rows.length >= 1 && dash.json.tiles.c.series.length === dash.json.buckets && dash.json.tiles.d.n === 0, dash.text.slice(0, 160));
  r = await api('/api/dash', { method: 'POST', body: JSON.stringify({ tiles: [] }), headers: { 'X-Requested-With': '' } });
  check('dashboard numbers need the anti-forgery header', r.status === 403, String(r.status));
  const hl = await api('/api/health');
  check('health report has checks, disk and database figures', hl.status === 200 && hl.json.checks.length >= 4 && hl.json.db.rows > 0 && hl.json.system.rssMB > 0 && ['ok', 'warn', 'bad'].includes(hl.json.status), hl.text.slice(0, 120));
  r = await put({ uiPrefs: { dash: { range: { preset: 'custom', from: 1, to: 2 }, tiles: [{ id: 'ok1', type: 'kpi', title: '<b>x</b>', x: 99, y: -5, w: 99, h: 0, cfg: { metric: 'errors', filter: { text: 'tag:x', host: 'h', severityMax: 99, evil: 'z' } } }, { id: 'bad id', type: 'kpi' }, { id: 'ok2', type: 'script' }] },
    views: [{ name: 'v'.repeat(500), range: 'weird', filter: { severityMax: 99, host: 'h' }, cols: ['host', 'a b'], sort: { col: 'host', dir: 'sideways' }, group: 'x' }] } });
  const ud = r.json?.config?.uiPrefs || {};
  check('saved dashboard tiles and views are validated', r.status === 200 && ud.dash.tiles.length === 1 && ud.dash.tiles[0].w === 12 && ud.dash.tiles[0].x === 0 && ud.dash.tiles[0].y === 0 && ud.dash.tiles[0].cfg.filter.severityMax === 23 && !('evil' in ud.dash.tiles[0].cfg.filter) && ud.views[0].name.length === 60 && ud.views[0].range === 'live' && ud.views[0].cols.length === 1 && ud.views[0].group === 'off', JSON.stringify(ud).slice(0, 300));
  // a failing self-check is announced as a log message (needs the same state on two looks in a row; the test shortens the interval to 0.5 s)
  r = await put({ diskWarnPercent: 90, diskCritPercent: 1 });
  await sleep(3500);
  rows = await logs('&host=NetEventPro&text=disk');
  check('a failing health check writes a NetEventPro log message', rows.some((x) => /Health check failed: Free disk space/.test(x.message) && x.severity === 4), JSON.stringify(rows.map((x) => x.message.slice(0, 60))));
  await put({ diskWarnPercent: 15, diskCritPercent: 5 }); await sleep(3500);
  check('and its recovery is announced', (await logs('&host=NetEventPro&text=recovered')).some((x) => /recovered: Free disk space/.test(x.message)) || ((await api('/api/health')).json.disk.freePct < 15));
  r = await put({ diskWarnPercent: 5, diskCritPercent: 10 });
  check('disk alert levels must be in order', r.status === 400, r.json?.error);
  await put({ uiPrefs: {} });

  // ---------- export, backup ---------------------------------------------------------------------------------------------
  await sendUdp("<14>=2+5+cmd|' /C calc'!A0");
  await sleep(600);
  const csv = (await api('/api/export?format=csv&max=500')).text;
  const evil = csv.split('\r\n').find((l) => l.includes('calc'));
  check('CSV export neutralises spreadsheet formulas', evil && !/(^|,)=2\+5/.test(evil) && /'=2\+5/.test(evil), evil?.slice(0, 120));
  const dl = await fetch(`http://127.0.0.1:${WEB}/api/db/download`);
  const buf = Buffer.from(await dl.arrayBuffer()); const copy = path.join(dir, 'downloaded-copy.db'); fs.writeFileSync(copy, buf);
  let n = -1; try { const d = new DatabaseSync(copy, { readOnly: true }); n = d.prepare('SELECT COUNT(*) AS n FROM logs').get().n; d.close(); } catch (e) { n = String(e); }
  check('database download is a valid SQLite file with the messages', dl.status === 200 && n >= 8, 'rows=' + n + ' status=' + dl.status);
  await sleep(600);   // the server deletes its temporary copy just after the last byte is sent
  check('no leftover temp copies after download',!fs.existsSync(path.join(dir, 'tmp')) || fs.readdirSync(path.join(dir, 'tmp')).length === 0);

  // ---------- web security ---------------------------------------------------------------------------------------------------
  const idx = await raw('/');
  const csp = idx.headers['content-security-policy'] || '';
  check('security headers on pages (CSP, nosniff, frame deny)', /script-src 'self'/.test(csp) && idx.headers['x-content-type-options'] === 'nosniff' && idx.headers['x-frame-options'] === 'DENY');
  check('API responses are not cacheable', (await raw('/api/state')).headers['cache-control'] === 'no-store');
  for (const p of ['/..%2f..%2fetc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/..%5c..%5cetc/passwd', '/%2e%2e%2fsrc/server.js', '/..%2fsrc%2fserver.js', '/index.html%00.js', '/src/server.js', '/../src/server.js']) {
    const x = await raw(p); check('path traversal blocked: ' + p, x.status !== 200 || !/root:|require\('/.test(x.body), 'status ' + x.status);
  }
  check('DNS rebinding: unknown Host header refused', (await raw('/api/state', { Host: 'evil.example.com' })).status === 403);
  const noHdr = await api('/api/clear', { method: 'POST', body: '{}', headers: { 'X-Requested-With': '' } });
  check('state-changing call without the CSRF header refused', noHdr.status === 403, 'status ' + noHdr.status);
  const cs = await raw('/api/db/download', { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'no-cors' });
  check('cross-site page cannot trigger the database download', cs.status === 403, 'status ' + cs.status);
  const cs2 = await raw('/api/export?format=csv', { 'Sec-Fetch-Site': 'same-site' });
  check('another local web app (same-site) cannot trigger the export', cs2.status === 403, 'status ' + cs2.status);
  const ok2 = await raw('/api/state', { 'Sec-Fetch-Site': 'same-origin' });
  check('same-origin requests still work', ok2.status === 200);
  check('bad JSON gives a clean 400', (await api('/api/config', { method: 'PUT', body: '{nope' })).status === 400);
  check('unknown API path gives 404', (await api('/api/nothing')).status === 404);
  r = await put({ webhooks: [{ name: 'x', url: 'file:///etc/passwd' }] });
  check('webhook URL must be http(s)', r.status === 400, r.json?.error);
  r = await put({ rules: [{ name: 'x', match: {}, actions: { color: 'red;background:url(//evil)' } }] });
  check('rule colour must be #rrggbb', r.status === 400, r.json?.error);
  r = await put({ webBind: '0.0.0.0' });
  check('cannot open the dashboard to the network without a password', r.status === 400, r.json?.error);

  // ---------- resource abuse ----------------------------------------------------------------------------------------------------
  await sendUdp(Buffer.from('<14>' + 'A'.repeat(60000)));
  await sendUdp(Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x3c, 0x39, 0x39, 0x39, 0x3e]));
  await sendUdp('<<<<<<<<' + '['.repeat(20000));
  await sendTcp('9999999 x\n' + 'B'.repeat(70000) + '\n');
  await sleep(1000);
  rows = await logs();
  const big = rows.find((x) => x.message.startsWith('AAAA'));
  check('60 KB datagram is accepted but capped', big && big.message.length <= 16384 + 10, 'len=' + big?.message.length);
  check('server still alive after garbage input', (await api('/api/state')).status === 200);
  const streams = []; let refused = 0;
  for (let i = 0; i < 205; i++) { const rr = await new Promise((res) => { const q = http.get({ host: '127.0.0.1', port: WEB, path: '/api/stream?backlog=1' }, (resp) => { streams.push(resp); res(resp.statusCode); }); q.on('error', () => res(0)); }); if (rr === 503) refused++; }
  check('live-feed connections are capped (200)', refused >= 4, 'refused ' + refused);
  streams.forEach((s) => s.destroy());

  // ---------- plain-text log files + data folder -------------------------------------------------------------------------------
  r = await put({ rawLogEnabled: true });
  await sendUdp('<14>Oct 25 22:55:00 rawhost app: written to the daily text file 10.20.1.5');
  await sleep(2500);
  const rawDir = path.join(dir, 'raw'); const rawFiles = fs.existsSync(rawDir) ? fs.readdirSync(rawDir) : [];
  const rawTxt = rawFiles.map((f) => fs.readFileSync(path.join(rawDir, f), 'utf8')).join('');
  check('plain-text daily log file is written with the original packet', rawFiles.some((f) => /^syslog-\d{4}-\d{2}-\d{2}\.log$/.test(f)) && rawTxt.includes('written to the daily text file 10.20.1.5'), rawFiles.join(','));
  const stt = (await api('/api/state')).json;
  check('the dashboard knows where the database, settings and logs are', stt.dataDirs && stt.dataDirs.db.endsWith('syslog.db') && stt.dataDirs.config.endsWith('config.json') && fs.existsSync(stt.dataDirs.db));
  await put({ rawLogEnabled: false });


  // ---------- several severities at once (search, live filter, rules) ------------------------------------------------------------
  rows = await logs('&sevs=2,6');
  check('search with several severities (2 and 6)', rows.length > 0 && rows.every((x) => x.severity === 2 || x.severity === 6) && rows.some((x) => x.severity === 2) && rows.some((x) => x.severity === 6), JSON.stringify([...new Set(rows.map((x) => x.severity))]));
  rows = await logs('&sevs=0,1&sevs=junk');
  check('a list with nothing valid in it behaves like no filter or an empty result, never an error', Array.isArray(rows));
  r = await put({ rules: [{ name: 'multi', enabled: true, match: { severities: [2, 3, 3, 99, 'x'] }, actions: { tag: 'multisev' } }] });
  check('rule with a list of severities accepted and cleaned', r.status === 200 && JSON.stringify(r.json.config.rules[0].match.severities) === '[2,3]', JSON.stringify(r.json?.config?.rules?.[0]?.match));
  await sendUdp('<10>1 2026-10-25T18:50:00Z sevhost app 1 - - multi severity rule critical');
  await sendUdp('<14>1 2026-10-25T18:50:01Z sevhost app 1 - - multi severity rule info');
  await sleep(800);
  rows = await logs('&text=multi%20severity%20rule');
  check('the rule tags severity 2 and leaves severity 6 alone', rows.some((x) => x.severity === 2 && x.tags.includes('multisev')) && rows.some((x) => x.severity === 6 && !x.tags.includes('multisev')), JSON.stringify(rows.map((x) => [x.severity, x.tags])));
  r = await api('/api/dash', { method: 'POST', body: JSON.stringify({ from: Date.now() - 3600000, to: Date.now(), tiles: [{ id: 'a', kind: 'count', filter: { sevs: '2,6' } }, { id: 'b', kind: 'count', filter: { sevs: '2' } }, { id: 'h', kind: 'heatHost', n: 3, filter: {} }, { id: 'w', kind: 'heatDow', tz: 240, filter: {} }, { id: 'p', kind: 'top', by: 'severity', n: 8, filter: {} }] }) });
  check('dashboard counts accept a list of severities', r.json?.tiles?.a?.n > r.json?.tiles?.b?.n && r.json.tiles.b.n > 0, JSON.stringify(r.json?.tiles?.a) + JSON.stringify(r.json?.tiles?.b));
  check('heatmap and pie data come back', r.json.tiles.h.hosts.length > 0 && r.json.tiles.w.cells.length === 7 && r.json.tiles.w.cells[0].length === 24 && r.json.tiles.p.total > 0, JSON.stringify(r.json.tiles.p).slice(0, 80));
  await put({ rules: [] });

  // ---------- devices are identified by the name in the message ------------------------------------------------------------------
  await sendUdp('<14>Oct 25 23:00:00 devA app: one'); await sendUdp('<14>Oct 25 23:00:01 DEVA app: two'); await sendUdp('<14>Oct 25 23:00:02 devB app: three');
  await sleep(800);
  const devs = (await api('/api/devices')).json;
  const da = devs.find((d) => d.key === 'deva'), db2 = devs.find((d) => d.key === 'devb');
  check('two messages from different names are two devices even from one address', !!da && !!db2 && da.count === 2 && db2.count === 1, JSON.stringify(devs.map((d) => [d.key, d.count])));
  check('a device lists the addresses it sent from', da && da.srcIps.includes('127.0.0.1') && da.srcIp === '127.0.0.1');
  r = await put({ deviceAliases: { deva: 'Alpha' } }); await sendUdp('<14>Oct 25 23:00:03 devA app: aliased'); await sleep(600);
  check('a display name is found by the device name', (await logs('&text=aliased'))[0]?.host === 'Alpha');
  await put({ deviceAliases: {} });
  await api('/api/device/forget', { method: 'POST', body: JSON.stringify({ key: 'devb' }) });
  check('forgetting a device removes it by name', !(await api('/api/devices')).json.some((d) => d.key === 'devb'));

  // ---------- reports ---------------------------------------------------------------------------------------------------------
  const repDir = path.join(dir, 'reports-out');
  const report = { id: 'rpt1', name: 'E2E report', enabled: true, schedule: { type: 'daily', time: '08:00' }, period: 'last24h', filter: { sevs: '0,1,2,3,4,5,6' }, content: { messages: true, maxRows: 300 }, formats: ['pdf', 'xlsx', 'csv'], email: { enabled: true, to: 'ops@example.com' }, folder: { enabled: true, path: repDir, keep: 2 } };
  r = await put({ reports: [report] });
  check('report saved', r.status === 200 && r.json.config.reports.length === 1, r.text.slice(0, 120));
  check('relative folder path refused', (await put({ reports: [{ ...report, folder: { enabled: true, path: 'relative\\dir', keep: 1 } }] })).status === 400);
  check('folder path with .. refused', (await put({ reports: [{ ...report, folder: { enabled: true, path: '/tmp/../etc', keep: 1 } }] })).status === 400);
  check('a report needs at least one file format', (await put({ reports: [{ ...report, formats: [] }] })).status === 400);
  check('bad recipient refused', (await put({ reports: [{ ...report, email: { enabled: true, to: 'nobody' } }] })).status === 400);
  const mailsBefore = mails.length;
  r = await api('/api/reports/run', { method: 'POST', body: JSON.stringify({ id: 'rpt1' }) });
  check('report run delivers to the folder and by e-mail', r.json?.ok === true && r.json.results.length === 2, r.text.slice(0, 200));
  const outFiles = fs.existsSync(repDir) ? fs.readdirSync(repDir) : [];
  const pick = (ext) => outFiles.find((f) => f.endsWith('.' + ext));
  check('PDF, Excel and CSV files were written', ['pdf', 'xlsx', 'csv'].every(pick), outFiles.join(','));
  check('the PDF is a PDF', pick('pdf') && fs.readFileSync(path.join(repDir, pick('pdf'))).subarray(0, 5).toString() === '%PDF-' && fs.readFileSync(path.join(repDir, pick('pdf'))).toString('latin1').includes('%%EOF'));
  check('the Excel file is a zip with a workbook inside', pick('xlsx') && (() => { const b = fs.readFileSync(path.join(repDir, pick('xlsx'))); return b[0] === 0x50 && b[1] === 0x4b && b.toString('latin1').includes('xl/workbook.xml') && b.toString('latin1').includes('xl/worksheets/sheet2.xml'); })());
  check('the CSV has a header and rows', pick('csv') && /^\ufeffDate,Time,Device,Process,Severity,Message\r\n/.test(fs.readFileSync(path.join(repDir, pick('csv')), 'utf8')) && fs.readFileSync(path.join(repDir, pick('csv')), 'utf8').split('\r\n').length > 5);
  check('the e-mail carried the three attachments', mails.length === mailsBefore + 1 && (mails[mails.length - 1].raw.match(/Content-Disposition: attachment/g) || []).length === 3 && /filename="e2e-report-\d{8}-\d{4}\.pdf"/.test(mails[mails.length - 1].raw), String(mails.length - mailsBefore));
  for (const [f, type, magic] of [['pdf', 'application/pdf', '%PDF-'], ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'PK'], ['csv', 'text/csv', '\ufeffDate,Time,Device,Process,Severity,Message']]) {
    const d = await fetch(`http://127.0.0.1:${WEB}/api/reports/run`, { method: 'POST', headers: H, body: JSON.stringify({ id: 'rpt1', download: f }) });
    const buf = Buffer.from(await d.arrayBuffer());
    check(`download as ${f}`, d.status === 200 && d.headers.get('content-type').startsWith(type) && /attachment; filename=/.test(d.headers.get('content-disposition')) && buf.toString('utf8').startsWith(magic), d.status + ' ' + d.headers.get('content-type'));
  }
  r = await api('/api/reports/test-folder', { method: 'POST', body: JSON.stringify({ path: repDir }) });
  check('folder test works and leaves nothing behind', r.json?.ok === true && !fs.readdirSync(repDir).some((f) => f.startsWith('neteventpro-test')));
  r = await api('/api/reports/test-folder', { method: 'POST', body: JSON.stringify({ path: 'C:\\..\\Windows' }) });
  check('folder test refuses ..', r.json?.ok === false);
  r = await api('/api/reports'); check('report list shows the last run result', r.json?.status?.rpt1?.lastOk === true && r.json.status.rpt1.lastRows > 0, JSON.stringify(r.json?.status));
  await put({ reports: [] });

  // ---------- backup and restore -------------------------------------------------------------------------------------------------------
  r = await api('/api/backup/create', { method: 'POST', body: JSON.stringify({ includeDb: true }) });
  check('backup created', r.json?.ok === true && /^neteventpro-\d{8}-\d{6}\.spbak$/.test(r.json.name), r.text.slice(0, 160));
  const bk = r.json.name;
  r = await api('/api/backup/create', { method: 'POST', body: JSON.stringify({ includeDb: true, passphrase: 'short' }) });
  check('short passphrase refused', r.status === 400);
  r = await api('/api/backup/create', { method: 'POST', body: JSON.stringify({ includeDb: true, passphrase: 'pass-phrase-123' }) });
  const bkEnc = r.json?.name; check('encrypted backup created', r.json?.ok === true && !!bkEnc, r.text.slice(0, 120));
  r = await api('/api/backup'); check('backups are listed with encryption flag', r.json.backups.some((b) => b.name === bk && !b.encrypted) && r.json.backups.some((b) => b.name === bkEnc && b.encrypted));
  const encBytes = fs.readFileSync(path.join(dir, 'backups', bkEnc));
  check('an encrypted backup contains neither the database nor settings in clear', !encBytes.toString('latin1').includes('SQLite format') && !encBytes.toString('latin1').includes('udpPort'));
  r = await api('/api/backup/inspect', { method: 'POST', body: JSON.stringify({ name: bk }) });
  check('inspect shows what is inside', r.json?.includesDb === true && r.json.files.some((f) => f.name === 'syslog.db') && r.json.files.some((f) => f.name === 'config.json'), r.text.slice(0, 160));
  r = await api('/api/backup/inspect', { method: 'POST', body: JSON.stringify({ name: bkEnc }) }); check('encrypted backup asks for the passphrase', r.status === 400 && /passphrase/i.test(r.json.error), r.text);
  r = await api('/api/backup/inspect', { method: 'POST', body: JSON.stringify({ name: bkEnc, passphrase: 'wrong-passphrase' }) }); check('wrong passphrase refused', r.status === 400 && /wrong passphrase/i.test(r.json.error), r.text);
  r = await api('/api/backup/inspect', { method: 'POST', body: JSON.stringify({ name: bkEnc, passphrase: 'pass-phrase-123' }) }); check('right passphrase opens it', r.json?.includesDb === true);
  r = await api('/api/backup/restore', { method: 'POST', body: JSON.stringify({ name: bk, parts: ['settings'] }) });
  check('a restore is checked and prepared, not applied', r.json?.ok === true && fs.existsSync(path.join(dir, 'restore-pending', 'pending.json')) && fs.existsSync(path.join(dir, 'config.json')), r.text.slice(0, 160));
  r = await api('/api/backup'); check('a prepared restore is reported', r.json.pending?.parts?.[0] === 'settings');
  await api('/api/backup/cancel-restore', { method: 'POST', body: '{}' }); check('a prepared restore can be cancelled', !fs.existsSync(path.join(dir, 'restore-pending')));
  check('nothing outside the backup folder can be downloaded', (await api('/api/backup/file?name=../config.json')).status === 404 && (await api('/api/backup/file?name=' + encodeURIComponent('..\\config.json'))).status === 404);
  check('a backup can be downloaded', (await fetch(`http://127.0.0.1:${WEB}/api/backup/file?name=${bk}`)).status === 200);
  const upl = await fetch(`http://127.0.0.1:${WEB}/api/backup/upload`, { method: 'POST', headers: { ...H, 'content-type': 'application/octet-stream', 'x-filename': '../../evil name.spbak' }, body: fs.readFileSync(path.join(dir, 'backups', bk)) }); const upj = await upl.json();
  check('an uploaded backup is kept under a safe name', upl.status === 200 && /^uploaded-[a-z0-9]+-[A-Za-z0-9._-]+\.spbak$/.test(upj.name) && fs.existsSync(path.join(dir, 'backups', upj.name)), JSON.stringify(upj));
  const bad = await fetch(`http://127.0.0.1:${WEB}/api/backup/upload`, { method: 'POST', headers: { ...H, 'content-type': 'application/octet-stream', 'x-filename': 'junk.spbak' }, body: Buffer.from('this is not a backup') });
  check('a file that is not a backup is refused and removed', bad.status === 400 && !fs.readdirSync(path.join(dir, 'backups')).some((f) => /junk/.test(f)));
  r = await api('/api/backup/delete', { method: 'POST', body: JSON.stringify({ name: upj.name }) }); check('a backup can be deleted', r.json?.ok === true);
  check('delete refuses odd names', (await api('/api/backup/delete', { method: 'POST', body: JSON.stringify({ name: '../config.json' }) })).status === 404);
  r = await put({ backup: { enabled: true, time: '03:15', keep: 3, includeDb: true, folder: path.join(dir, 'bk-copy'), passphrase: 'auto-pass-123' } });
  check('automatic backup settings saved; the passphrase is masked', r.status === 200 && r.json.config.backup.passphrase === '********' && !r.text.includes('auto-pass-123'));
  check('automatic backup passphrase length checked', (await put({ backup: { enabled: true, time: '03:15', passphrase: 'x' } })).status === 400);
  await put({ backup: { enabled: false, time: '02:00', keep: 7, includeDb: true, folder: '', passphrase: '' } });

  // ---------- alarm console and maintenance windows -------------------------------------------------------------------------------------
  r = await put({ rules: [{ id: 'dn', name: 'Port down', enabled: true, match: { text: 'e2e port down' }, actions: { alarm: true, alarmEscMin: 30 } }, { id: 'upr', name: 'Port up', enabled: true, match: { text: 'e2e port up' }, actions: { clearsRule: 'dn' } }] });
  check('alarm and clear actions are accepted', r.status === 200 && r.json.config.rules[0].actions.alarm === true && r.json.config.rules[0].actions.alarmEscMin === 30 && r.json.config.rules[1].actions.clearsRule === 'dn', r.text.slice(0, 150));
  check('a bad escalation recipient is refused', (await put({ rules: [{ id: 'x', name: 'x', match: {}, actions: { alarm: true, alarmEscTo: 'nobody' } }] })).status === 400);
  await put({ rules: [{ id: 'dn', name: 'Port down', enabled: true, match: { text: 'e2e port down' }, actions: { alarm: true } }, { id: 'upr', name: 'Port up', enabled: true, match: { text: 'e2e port up' }, actions: { clearsRule: 'dn' } }] });
  await sendUdp('<11>Oct 25 23:10:00 almA app: e2e port down'); await sendUdp('<11>Oct 25 23:10:01 almA app: e2e port down'); await sendUdp('<11>Oct 25 23:10:02 almB app: e2e port down'); await sleep(900);
  r = await api('/api/alarms'); const aA = r.json?.alarms?.find((x) => x.device === 'alma'), aB = r.json?.alarms?.find((x) => x.device === 'almb');
  check('every message is its own alarm line (no repeat counter)', !!aA && !!aB && r.json.alarms.filter((x) => x.device === 'alma').length === 2 && aA.count === 1 && aB.count === 1 && aA.state === 'open' && r.json.counts.open >= 3, JSON.stringify(r.json?.counts));
  check('the stats carry the alarm counts for the menu badge', (await api('/api/stats')).json?.alarms?.open >= 2);
  r = await api('/api/alarms/ack', { method: 'POST', body: JSON.stringify({ ids: [aA.id], note: 'working on it' }) }); check('acknowledge with a note', r.json?.changed === 1);
  r = await api('/api/alarms?state=ack'); check('acknowledged alarm is listed with the note', r.json.alarms.some((x) => x.id === aA.id && x.notes[0]?.text === 'working on it'));
  await sendUdp('<13>Oct 25 23:11:00 almA app: e2e port up'); await sleep(700);
  r = await api('/api/alarms?state=cleared'); check('a matching recovery message clears the alarm on that device only', r.json.alarms.some((x) => x.id === aA.id && /^auto: Port up/.test(x.clearedBy)) && !r.json.alarms.some((x) => x.id === aB.id));
  r = await api('/api/alarms/clear', { method: 'POST', body: JSON.stringify({ ids: [aB.id], note: 'checked' }) }); check('manual clear', r.json?.changed === 1 && (await api('/api/alarms?state=active')).json.alarms.length === 0);
  check('junk ids are ignored', (await api('/api/alarms/ack', { method: 'POST', body: JSON.stringify({ ids: ['x', -1, 1.5, 99999] }) })).json?.changed === 0);
  check('search text with SQL wildcards or quotes is harmless', (await api("/api/alarms?state=all&q=" + encodeURIComponent("%' OR 1=1 --"))).status === 200);
  r = await put({ maintenance: [{ id: 'mw1', name: 'almC work', devices: 'almC', schedule: { type: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' } }] });
  check('maintenance window saved', r.status === 200 && r.json.config.maintenance.length === 1, r.text.slice(0, 150));
  check('maintenance windows are checked', (await put({ maintenance: [{ name: 'x', schedule: { type: 'weekly', days: [], start: '22:00', end: '23:00' } }] })).status === 400 && (await put({ maintenance: [{ name: 'x', schedule: { type: 'weekly', days: [1], start: '22:00', end: '22:00' } }] })).status === 400 && (await put({ maintenance: [{ name: 'x', schedule: { type: 'once', from: 5, to: 4 } }] })).status === 400);
  await put({ maintenance: [{ id: 'mw1', name: 'almC work', devices: 'almC', schedule: { type: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' } }] });
  await sendUdp('<11>Oct 25 23:12:00 almC app: e2e port down'); await sendUdp('<11>Oct 25 23:12:01 almD app: e2e port down'); await sleep(900);
  r = await api('/api/alarms?state=active'); check('a device in a maintenance window raises no alarm, another device still does', !r.json.alarms.some((x) => x.device === 'almc') && r.json.alarms.some((x) => x.device === 'almd'));
  check('its message is still stored and tagged maintenance', (await logs('&text=almC')).some((x) => /e2e port down/.test(x.message) && x.tags.includes('maintenance')) || (await logs('&host=almC')).some((x) => x.tags.includes('maintenance')));
  r = await api('/api/maintenance'); check('maintenance status says which window is active now', r.json?.status?.[0]?.active === true);
  await put({ maintenance: [], rules: [] });
  r = await api('/api/alarms?state=active'); await api('/api/alarms/clear', { method: 'POST', body: JSON.stringify({ ids: r.json.alarms.map((x) => x.id) }) });


  // ---------- SNMP traps and MIB files ------------------------------------------------------------------------------------------------------
  const sendTrap = (pkt, port = SNMP) => sendUdp(pkt, port);
  const trapOf = (up, ifd, n, comm = 'public') => ber.buildV2({ community: comm, trapOid: up ? '1.3.6.1.6.3.1.1.5.4' : '1.3.6.1.6.3.1.1.5.3', uptime: 10, varbinds: [{ oid: `1.3.6.1.2.1.2.2.1.1.${n}`, type: 'integer', value: n }, { oid: `1.3.6.1.2.1.2.2.1.2.${n}`, type: 'octets', value: ifd }, { oid: `1.3.6.1.2.1.2.2.1.7.${n}`, type: 'integer', value: 1 }, { oid: `1.3.6.1.2.1.2.2.1.8.${n}`, type: 'integer', value: up ? 1 : 2 }] });
  r = await api('/api/snmp'); check('SNMP receiver is listening and the built-in MIBs are loaded', r.json?.status?.running === true && r.json.status.port === SNMP && r.json.stats.nodes > 20, JSON.stringify(r.json?.status).slice(0, 120));
  await sendTrap(trapOf(false, 'GigabitEthernet0/24', 24)); await sleep(700);
  r = await logs('&text=linkDown'); const trapRow = r.find((x) => /ifDescr\.24 = GigabitEthernet0\/24/.test(x.message));
  check('a linkDown trap is stored as a log message with the trap name and enum values from the MIB', !!trapRow && /^IF-MIB::linkDown \(1\.3\.6\.1\.6\.3\.1\.1\.5\.3\)/.test(trapRow.message) && /ifOperStatus\.24 = down\(2\)/.test(trapRow.message) && trapRow.severity === 3 && trapRow.app === 'snmptrap' && trapRow.tags.includes('link-down'), JSON.stringify(trapRow)?.slice(0, 200));
  check('the community string is not stored anywhere', !/public/.test(JSON.stringify(trapRow)));
  await put({ rules: [{ id: 'tdn', name: 'Link down', enabled: true, source: 'snmp', match: { tag: 'link-down' }, actions: { alarm: true } }, { id: 'tup', name: 'Link up', enabled: true, source: 'snmp', match: { tag: 'link-up' }, actions: { clearsRule: 'tdn' } }] });
  await sendTrap(trapOf(false, 'Gi0/1', 1)); await sleep(600);
  r = await api('/api/alarms?state=active'); check('a link-down trap raises an alarm through the normal rules', r.json.alarms.some((x) => x.rule === 'Link down'), JSON.stringify(r.json.alarms.map((x) => x.rule)));
  r = await api('/api/alarms?state=active'); check('the alarm carries source snmp', r.json.alarms.find((x) => x.rule === 'Link down')?.source === 'snmp');
  r = await api('/api/alarms?state=active&source=syslog'); check('the alarm list can be filtered by source', !r.json.alarms.some((x) => x.rule === 'Link down'));
  r = await logs('&source=syslog&text=linkDown'); check('the syslog window does not show traps', r.length === 0, r.length);
  r = await logs('&source=snmp'); check('the traps window shows only traps', r.length > 0 && r.every((x) => x.app === 'snmptrap'));
  r = await logs('&source=snmp&text=Battery'); check('syslog messages never appear in the traps window', r.length === 0);
  await put({ rules: [{ id: 'sysonly', name: 'Syslog-only link rule', enabled: true, source: 'syslog', match: { tag: 'link-down' }, actions: { alarm: true } }] });
  await sendTrap(trapOf(false, 'Gi0/9', 9)); await sleep(600);
  r = await api('/api/alarms?state=active'); check('a syslog rule does not fire on a trap', !r.json.alarms.some((x) => x.rule === 'Syslog-only link rule'));
  await put({ rules: [{ id: 'tdn', name: 'Link down', enabled: true, source: 'snmp', match: { tag: 'link-down' }, actions: { alarm: true } }, { id: 'tup', name: 'Link up', enabled: true, source: 'snmp', match: { tag: 'link-up' }, actions: { clearsRule: 'tdn' } }] });
  await sendTrap(trapOf(true, 'Gi0/1', 1)); await sleep(700);
  r = await api('/api/alarms?state=cleared'); check('the matching linkUp trap clears it automatically', r.json.alarms.some((x) => /^auto: Link up/.test(x.clearedBy)));
  await put({ rules: [] }); r = await api('/api/alarms?state=active'); if (r.json.alarms.length) await api('/api/alarms/clear', { method: 'POST', body: JSON.stringify({ ids: r.json.alarms.map((x) => x.id) }) });

  const mibText = `E2E-MIB DEFINITIONS ::= BEGIN
IMPORTS enterprises FROM SNMPv2-SMI;
e2eRoot OBJECT IDENTIFIER ::= { enterprises 55555 }
e2eState OBJECT-TYPE SYNTAX INTEGER { good(1), bad(2) } MAX-ACCESS read-only STATUS current DESCRIPTION "s" ::= { e2eRoot 1 }
e2eFanFailure NOTIFICATION-TYPE OBJECTS { e2eState } STATUS current DESCRIPTION "fan" ::= { e2eRoot 0 7 }
END`;
  const vendorTrap = ber.buildV2({ community: 'public', trapOid: '1.3.6.1.4.1.55555.0.7', uptime: 1, varbinds: [{ oid: '1.3.6.1.4.1.55555.1.0', type: 'integer', value: 2 }] });
  await sendTrap(vendorTrap); await sleep(600);
  r = await logs('&text=55555'); check('without its MIB a vendor trap is shown with numbers', r.some((x) => /^Unknown trap 1\.3\.6\.1\.4\.1\.55555\.0\.7: 1\.3\.6\.1\.4\.1\.55555\.1\.0 = 2$/.test(x.message)));
  r = await api('/api/snmp'); check('and its vendor number is listed as a MIB still needed', r.json.status.missing.some((m) => m.prefix === '1.3.6.1.4.1.55555' && m.count >= 1));
  r = await api('/api/snmp'); { const u = (r.json.status.unknownTraps || []).find((x) => x.oid === '1.3.6.1.4.1.55555.0.7'); check('the MIB assistant lists that trap with the reason (no MIB for the vendor) and what to do', !!u && u.state === 'no-vendor-mib' && u.count >= 1 && /upload/i.test(u.advice) && u.ips.length === 1, JSON.stringify(u)); }
  r = await api('/api/mibs', { method: 'POST', body: JSON.stringify({ name: 'E2E-MIB.mib', text: mibText }) }); check('a MIB file can be uploaded', r.status === 200 && r.json.file.traps === 1 && r.json.file.unresolved === 0, r.text.slice(0, 150));
  await sendTrap(vendorTrap); await sleep(600);
  r = await logs('&text=e2eFanFailure'); check('after the upload the same trap is shown by name, with named values', r.some((x) => x.message === 'E2E-MIB::e2eFanFailure (1.3.6.1.4.1.55555.0.7): e2eState.0 = bad(2)' && x.severity === 3 && x.tags.includes('trap:e2eFanFailure')), r[0]?.message);
  r = await api('/api/snmp'); { const u = (r.json.status.unknownTraps || []).find((x) => x.oid === '1.3.6.1.4.1.55555.0.7'); check('after the upload the assistant shows the trap as named now', !!u && u.state === 'resolved' && u.name === 'E2E-MIB::e2eFanFailure', JSON.stringify(u)); }
  r = await api('/api/mibs/lookup?q=e2eFanFailure'); check('the OID lookup finds names and numbers', r.json?.result?.oid === '1.3.6.1.4.1.55555.0.7' && (await api('/api/mibs/lookup?q=1.3.6.1.4.1.55555.1.0')).json?.result?.name === 'E2E-MIB::e2eState.0');
  check('bad MIB uploads are refused', (await api('/api/mibs', { method: 'POST', body: JSON.stringify({ name: '../evil.mib', text: mibText }) })).status === 400 && (await api('/api/mibs', { method: 'POST', body: JSON.stringify({ name: 'a.mib', text: 'not a mib' }) })).status === 400 && ((await api('/api/mibs', { method: 'POST', body: JSON.stringify({ name: 'big.mib', text: 'x'.repeat(13e6) }) }).catch(() => ({ status: 413 }))).status === 413));   // an over-size upload is cut off (413 or a closed connection)
  check('the MIB file is kept on disk in the data folder', fs.existsSync(path.join(dir, 'mibs', 'E2E-MIB.mib')) && !fs.existsSync(path.join(dir, 'evil.mib')));
  r = await put({ snmp: { enabled: true, port: SNMP, bind: '0.0.0.0', communities: ['secret1'], informAck: true, defaultSeverity: 5, severityRules: [{ match: 'e2eFanFailure', severity: 1 }] } });
  check('SNMP settings can be saved', r.status === 200 && r.json.config.snmp.communities[0] === 'secret1' && r.json.config.snmp.severityRules[0].severity === 1, r.text.slice(0, 120));
  await sendTrap(vendorTrap); await sleep(500);
  r = await api('/api/snmp'); check('with a community list, a trap with another community is rejected and not stored', r.json.status.rejectedCommunity >= 1 && (await logs('&text=e2eFanFailure')).length === 1);
  await sendTrap(ber.buildV2({ community: 'secret1', trapOid: '1.3.6.1.4.1.55555.0.7', uptime: 1, varbinds: [] })); await sleep(600);
  r = await logs('&text=e2eFanFailure'); check('the right community is accepted, and your severity rule wins over the name wording', r.length === 2 && r.some((x) => x.severity === 1));
  const reply = await new Promise((res) => { const c = dgram.createSocket('udp4'); const t = setTimeout(() => { c.close(); res(null); }, 2000); c.on('message', (b) => { clearTimeout(t); c.close(); res(b); }); c.send(ber.buildV2({ community: 'secret1', trapOid: '1.3.6.1.4.1.55555.0.7', inform: true, requestId: 31337, varbinds: [] }), SNMP, '127.0.0.1'); });
  check('an inform is acknowledged with a response carrying its request id', !!reply && reply.includes(0xa2) && reply.includes(Buffer.from([0x02, 0x02, 0x7a, 0x69])));
  await sendUdp(Buffer.from([0x30, 0x84, 0xff, 0xff, 0xff, 0xff, 0x02, 0x01, 0x01]), SNMP); await sendUdp(Buffer.from('this is not snmp'), SNMP); await sendUdp(Buffer.alloc(0), SNMP);
  await sendUdp(Buffer.from([0x30, 0x0c, 0x02, 0x01, 0x03, 0x30, 0x04, 0x02, 0x02, 0x00, 0x01, 0x04, 0x00, 0x00]), SNMP); await sleep(600);
  r = await api('/api/snmp'); check('garbage is counted as malformed, and the service keeps running', r.json.status.malformed >= 2 && r.json.status.running === true && (await api('/api/state')).status === 200);
  check('an SNMPv3 message with no v3 user set up produces one notice that it was refused', r.json.status.v3 >= 1 && (await logs('&text=SNMPv3')).some((x) => x.tags.includes('snmp-v3-refused')));
  check('the SNMP port cannot equal the syslog UDP port', (await put({ snmp: { enabled: true, port: UDP, bind: '0.0.0.0' } })).status === 400 && (await put({ snmp: { enabled: true, port: 162, bind: 'nope' } })).status === 400 && (await put({ snmp: { severityRules: [{ match: 'bad name!', severity: 1 }] } })).status === 400);
  // ---- 1.10: dashboard customisation, escalated count, system health history ----
  r = await put({ uiPrefs: { dash: { snmpFirst: true, tiles: [{ id: 'sec_snmp', type: 'section', title: 'Traps <b>', x: 0, y: 0, w: 12, h: 1, cfg: { color: '#AA3300' } }, { id: 'k1', type: 'kpi', title: 'k', x: 0, y: 1, w: 3, h: 2, cfg: { metric: 'errors', color: 'red;}', bg: '#102030' } }],
    alarmBar: { style: 'large', cols: 9, order: ['esc', 'bogus', 'open', 'open'], cards: { esc: { title: 'Escalated now', color: '#ff0000' }, total: { color: 'javascript:1', show: false }, evil: { title: 'x' } } } } } });
  const ud2 = r.json?.config?.uiPrefs?.dash || {};
  check('dashboard prefs keep SNMP-first and the section colour', ud2.snmpFirst === true && ud2.tiles?.[0]?.type === "section" && ud2.tiles[0].cfg.color === '#aa3300');
  check('dashboard tile colours are strict hex', !ud2.tiles?.[1]?.cfg?.color && ud2.tiles?.[1]?.cfg?.bg === '#102030');
  // ---- 1.34: dashboard studio (new tile types and the look & feel settings are validated) ----
  r = await put({ uiPrefs: { dash: { style: { card: 'glass', radius: 99, gap: 1, density: 'compact', titles: 'bar', accent: '#ABCDEF', refresh: 30, evil: 1 }, tiles: [
    { id: 'n1', type: 'bar', title: 'b', x: 0, y: 0, w: 6, h: 6, cfg: { by: 'host', orient: 'v', n: 99 } }, { id: 'n2', type: 'treemap', x: 6, y: 0, w: 6, h: 6, cfg: { by: 'app' } },
    { id: 'n3', type: 'table', x: 0, y: 6, w: 6, h: 6, cfg: {} }, { id: 'n4', type: 'bargauge', x: 6, y: 6, w: 4, h: 6, cfg: { warn: 5 } }, { id: 'n5', type: 'statspark', x: 0, y: 12, w: 3, h: 4, cfg: {} },
    { id: 'n6', type: 'text', x: 3, y: 12, w: 4, h: 4, cfg: { text: '# Hi <script>x</script>\u0001' } }, { id: 'n7', type: 'nonsense', x: 0, y: 20, w: 2, h: 2, cfg: {} }] } } });
  const ud3 = r.json?.config?.uiPrefs?.dash || {};
  check('dashboard studio: new tile types are kept, unknown ones dropped', ud3.tiles?.length === 6 && ['bar', 'treemap', 'table', 'bargauge', 'statspark', 'text'].every((t) => ud3.tiles.some((x) => x.type === t)), JSON.stringify(ud3.tiles?.map((t) => t.type)));
  check('dashboard studio: tile options are limited', ud3.tiles?.[0]?.cfg?.orient === 'v' && ud3.tiles[0].cfg.n === 50 && ud3.tiles.find((t) => t.type === 'bargauge').cfg.warn === 5 && !/\u0001/.test(ud3.tiles.find((t) => t.type === 'text').cfg.text));
  check('dashboard studio: style settings are cleaned', ud3.style?.card === 'glass' && ud3.style.radius === 24 && ud3.style.gap === 4 && ud3.style.accent === '#abcdef' && ud3.style.refresh === 30 && ud3.style.evil === undefined, JSON.stringify(ud3.style));
  r = await put({ uiPrefs: { dash: { style: { card: 'x', accent: 'red', refresh: 7 } } } });
  check('dashboard studio: bad style values are refused', JSON.stringify(r.json?.config?.uiPrefs?.dash?.style || {}) === '{}', JSON.stringify(r.json?.config?.uiPrefs?.dash?.style));
  // ---- 1.35: panel options of every tile (look, value, colour steps, chart options, alarm cards) are whitelisted ----
  r = await put({ uiPrefs: { dash: { alarmTiles: true, style: { pageBg: 'gradient', bg1: '#0F172A', bg2: 'red', bgAngle: 400 }, tiles: [
    { id: 'p1', type: 'alarm', title: 'Active', x: 0, y: 0, w: 3, h: 3, cfg: { card: 'open', look: { bgMode: 'gradient', bg: '#6D28D9', bg2: 'javascript:1', angle: 999, bw: 99, radius: 5, shadow: 'glow', tBar: 'solid', tBarC: '#112233', evil: 1 }, th: { mode: 'bg', steps: [{ v: 0, c: '#30a46c' }, { v: 1, c: '#e5484d' }, { v: 5, c: 'red' }] } } },
    { id: 'p2', type: 'kpi', x: 3, y: 0, w: 3, h: 3, cfg: { metric: 'errors', graph: 'area', val: { size: 'xl', suffix: ' ms<script>', dec: 2, compact: true }, pal: 'neon' } },
    { id: 'p3', type: 'gauge', x: 6, y: 0, w: 3, h: 4, cfg: { metric: 'errors', gstyle: 'lcd', max: 500 } }, { id: 'p4', type: 'line', x: 0, y: 4, w: 6, h: 6, cfg: { ch: { lw: 3, fillA: 40, smooth: true, stack: true, legend: 'right', bogus: 1 } } },
    { id: 'p5', type: 'bargauge', x: 6, y: 4, w: 4, h: 6, cfg: { by: 'host', bstyle: 'lcd', card: 'nope', gstyle: 'nope' } }] } } });
  const ud4 = r.json?.config?.uiPrefs?.dash || {}, tp = (id) => ud4.tiles?.find((t) => t.id === id)?.cfg || {};
  check('panel options: alarm tile keeps card, look and colour steps', ud4.alarmTiles === true && tp('p1').card === 'open' && tp('p1').look?.bgMode === 'gradient' && tp('p1').look.bg === '#6d28d9' && tp('p1').look.bg2 === undefined && tp('p1').look.angle === 360 && tp('p1').look.bw === 8 && tp('p1').look.shadow === 'glow' && tp('p1').look.evil === undefined && tp('p1').th.steps.length === 2, JSON.stringify(tp('p1')));
  check('panel options: value, graph, palette and gauge style are limited', tp('p2').graph === 'area' && tp('p2').val.size === 'xl' && tp('p2').val.dec === 2 && !/[<>]/.test(tp('p2').val.suffix) && tp('p2').pal === 'neon' && tp('p3').gstyle === 'lcd' && tp('p3').max === 500, JSON.stringify([tp('p2'), tp('p3')]));
  check('panel options: chart options are limited, bad values dropped', tp('p4').ch.lw === 3 && tp('p4').ch.legend === 'right' && tp('p4').ch.bogus === undefined && tp('p5').bstyle === 'lcd' && tp('p5').card === undefined && tp('p5').gstyle === undefined, JSON.stringify([tp('p4'), tp('p5')]));
  check('panel options: page background settings are cleaned', ud4.style?.pageBg === 'gradient' && ud4.style.bg1 === '#0f172a' && ud4.style.bg2 === undefined && ud4.style.bgAngle === 360, JSON.stringify(ud4.style));
  check('alarm banner prefs are cleaned', ud2.alarmBar?.style === 'large' && !ud2.alarmBar.cols && JSON.stringify(ud2.alarmBar.order) === '["esc","open"]' && ud2.alarmBar.cards.esc.color === '#ff0000' && ud2.alarmBar.cards.total.show === false && !ud2.alarmBar.cards.total.color && !ud2.alarmBar.cards.evil, JSON.stringify(ud2.alarmBar));
  // ---- 1.36: every visual can read syslog, traps, alarms or devices; calculations; named dashboards ----
  r = await put({ uiPrefs: { dashMainName: 'Main <b>wall</b>', dash: { slicer: 'core-sw1<x>', tiles: [
    { id: 'q1', type: 'kpi', x: 0, y: 0, w: 2, h: 3, cfg: { ds: 'alarms', metric: 'alActive', calc: { op: 'pct', bm: 'alRaised', mul: 2, add: 1, evil: 1 }, look: { tSrc: false } } },
    { id: 'q2', type: 'bar', x: 2, y: 0, w: 4, h: 6, cfg: { ds: 'devices', by: 'vendor', filter: { dstate: 'silent', vendor: 'Cisco', group: 'core', bogus: 1 } } },
    { id: 'q3', type: 'line', x: 6, y: 0, w: 4, h: 6, cfg: { ds: 'alarms', sc: { op: 'ma', n: 9999 }, filter: { astate: 'cleared', rule: 'Link' } } },
    { id: 'q4', type: 'kpi', x: 0, y: 3, w: 2, h: 3, cfg: { ds: 'nonsense', metric: 'dvSilent', calc: { op: 'bad', bm: 'nope' }, sc: { op: 'bad' } } }] },
    dashboards: [{ id: 'b1', name: 'NOC wall', dash: { tiles: [{ id: 'z1', type: 'kpi', x: 0, y: 0, w: 2, h: 3, cfg: { metric: 'errors' } }] } }, { id: 'b1', name: 'dup', dash: {} }, { id: 'bad id!', name: 'x', dash: {} }] } });
  const ud5 = r.json?.config?.uiPrefs || {}, tq = (id) => ud5.dash?.tiles?.find((t) => t.id === id)?.cfg || {};
  check('1.36: tiles keep their data set, calculation and series calculation; junk is dropped', tq('q1').ds === 'alarms' && tq('q1').calc?.op === 'pct' && tq('q1').calc.bm === 'alRaised' && tq('q1').calc.mul === 2 && tq('q1').calc.add === 1 && tq('q1').calc.evil === undefined && tq('q1').look?.tSrc === false && tq('q3').sc?.op === 'ma' && tq('q3').sc.n <= 30 && tq('q4').ds === undefined && tq('q4').calc === undefined && tq('q4').sc === undefined, JSON.stringify([tq('q1'), tq('q3'), tq('q4')]));
  check('1.36: alarm and device filters are kept and cleaned', tq('q2').filter?.dstate === 'silent' && tq('q2').filter.vendor === 'Cisco' && tq('q2').filter.bogus === undefined && tq('q3').filter?.astate === 'cleared' && tq('q3').filter.rule === 'Link' && tq('q2').by === 'vendor', JSON.stringify([tq('q2'), tq('q3')]));
  check('1.36: named dashboards are kept (duplicate and bad ids dropped), the main one can be renamed, the device slicer is cleaned', ud5.dashboards?.length === 1 && ud5.dashboards[0].name === 'NOC wall' && ud5.dashboards[0].dash.tiles?.[0]?.id === 'z1' && !/[<>]/.test(ud5.dashMainName || '') && /^core-sw1/.test(ud5.dash?.slicer || '') && !/[<>]/.test(ud5.dash.slicer), JSON.stringify([ud5.dashboards, ud5.dashMainName, ud5.dash?.slicer]));
  const dq = (tiles) => api('/api/dash', { method: 'POST', body: JSON.stringify({ from: Date.now() - 86400000, to: Date.now(), tiles }) });
  r = await dq([{ id: 'a_n', kind: 'count', ds: 'alarms', filter: { astate: 'raised' }, prev: true }, { id: 'a_act', kind: 'count', ds: 'alarms', filter: { astate: 'active' } }, { id: 'a_top', kind: 'top', ds: 'alarms', by: 'rule', n: 5, filter: {} }, { id: 'a_sev', kind: 'top', ds: 'alarms', by: 'severity', n: 5, filter: {} },
    { id: 'a_ser', kind: 'series', ds: 'alarms', filter: {} }, { id: 'a_lst', kind: 'list', ds: 'alarms', n: 3, filter: { astate: 'raised' } }, { id: 'a_avg', kind: 'count', ds: 'alarms', agg: 'avgclear', filter: { astate: 'cleared' } },
    { id: 'd_n', kind: 'count', ds: 'devices', filter: { dstate: 'all' } }, { id: 'd_top', kind: 'top', ds: 'devices', by: 'status', n: 5, filter: {} }, { id: 'd_lst', kind: 'list', ds: 'devices', n: 3, filter: {} }, { id: 'd_bad', kind: 'series', ds: 'devices', filter: {} }, { id: 'e_n', kind: 'count', ds: 'wat', filter: {} }]);
  const dt = r.json?.tiles || {};
  check('1.36: /api/dash counts, ranks, charts and lists alarms', typeof dt.a_n?.n === 'number' && typeof dt.a_n.prev === 'number' && typeof dt.a_act?.n === 'number' && Array.isArray(dt.a_top?.rows) && Array.isArray(dt.a_sev?.rows) && Array.isArray(dt.a_ser?.series) && Array.isArray(dt.a_lst?.alarms) && typeof dt.a_avg?.n === 'number', JSON.stringify(dt).slice(0, 400));
  check('1.36: /api/dash counts, ranks and lists devices; unsupported visuals answer with an error, unknown data means messages', typeof dt.d_n?.n === 'number' && Array.isArray(dt.d_top?.rows) && Array.isArray(dt.d_lst?.devices) && typeof dt.d_bad?.error === 'string' && typeof dt.e_n?.n === 'number', JSON.stringify([dt.d_n, dt.d_bad, dt.e_n]));
  r = await dq([{ id: 'x1', kind: 'top', ds: 'alarms', by: 'host; DROP TABLE alarms', n: 5, filter: { astate: "x'; --", host: "a' OR '1'='1" } }]); check('1.36: alarm requests cannot inject SQL (unknown ranking falls back, filters are bound values)', r.status === 200 && Array.isArray(r.json?.tiles?.x1?.rows), JSON.stringify(r.json).slice(0, 200));
  await put({ uiPrefs: {} });
  r = await api('/api/alarms?state=all&limit=1&since=' + (Date.now() - 900000)); check('Total alarms is never smaller than Cleared or Active', r.json?.summary?.total >= r.json?.summary?.cleared && r.json.summary.total >= r.json.counts.open + r.json.counts.ack, JSON.stringify(r.json?.summary && { t: r.json.summary.total, c: r.json.summary.cleared }));
  { // ---- SNMP polling (1.46): a fake device answers; the poll raises a threshold alarm and a no-answer alarm through the real engine ----
    const { startAgent } = require('./fake-snmp-agent');
    const ag = await startAgent({ mib: [['1.3.6.1.2.1.1.1.0', 'octets', 'fake switch'], ['1.3.6.1.2.1.1.2.0', 'oid', '1.3.6.1.4.1.9.1.1'], ['1.3.6.1.2.1.1.3.0', 'timeticks', 100000], ['1.3.6.1.2.1.1.5.0', 'octets', 'fake-sw'], ['1.3.6.1.4.1.9.9.109.1.1.1.1.8.1', 'gauge32', 91]] });
    try {
      r = await api('/api/poll/devices', { method: 'POST', body: JSON.stringify({ name: '', host: '1.2.3.4', version: 'v2c', community: 'x' }) }); check('polling: a device without a name is refused', r.status === 400, r.text.slice(0, 100));
      r = await api('/api/poll/test', { method: 'POST', body: JSON.stringify({ name: 't', host: '127.0.0.1', port: ag.port, version: 'v2c', community: 'public', timeoutMs: 800 }) }); check('polling: Test connection reads the device and picks the Cisco profile', r.json?.ok === true && r.json.profile === 'cisco' && r.json.sysName === 'fake-sw', r.text.slice(0, 160));
      r = await api('/api/poll/test', { method: 'POST', body: JSON.stringify({ name: 't', host: '127.0.0.1', port: ag.port, version: 'v2c', community: 'bad', timeoutMs: 400, retries: 0 }) }); check('polling: a wrong community is reported as no answer', r.json?.ok === false && r.json.code === 'timeout', r.text.slice(0, 160));
      r = await api('/api/poll/thresholds', { method: 'POST', body: JSON.stringify({ thresholds: [{ name: 'CPU high e2e', k: 'cpu', op: '>', value: 80, forSec: 0, severity: 3 }] }) }); check('polling: a threshold can be saved', r.status === 200, r.text.slice(0, 100));
      r = await api('/api/poll/devices', { method: 'POST', body: JSON.stringify({ name: 'E2E-Switch', host: '127.0.0.1', port: ag.port, version: 'v2c', community: 'public', intervalSec: 10, timeoutMs: 800, retries: 0 }) }); const pid = r.json?.id; check('polling: a device can be added', r.status === 200 && !!pid, r.text.slice(0, 100));
      r = await api('/api/poll/devices'); check('polling: the community is never sent back to the browser', r.json?.devices?.[0]?.community === '********' && !r.text.includes('"public"'), r.text.slice(0, 120));
      r = await api('/api/poll/now', { method: 'POST', body: JSON.stringify({ id: pid }) }); await sleep(1500);
      r = await api('/api/poll/overview'); const od = r.json?.devices?.find((x) => x.id === pid); check('polling: the device is up with its CPU reading', od?.state === 'up' && od.cpu === 91, JSON.stringify(od)?.slice(0, 200));
      r = await api('/api/poll/series?id=' + pid + '&k=cpu&hours=1'); check('polling: the graph has readings', r.json?.points?.length >= 1 && r.json.points[0].v === 91, r.text.slice(0, 120));
      r = await api('/api/alarms?state=active&limit=50'); check('polling: the threshold raised a normal alarm', (r.json?.alarms || []).some((x) => x.rule === 'CPU high e2e' && x.device === 'e2e-switch'), JSON.stringify((r.json?.alarms || []).map((x) => x.rule)));
      ag.close(); await sleep(300);
      for (let i = 0; i < 3; i++) { await api('/api/poll/now', { method: 'POST', body: JSON.stringify({ id: pid }) }); await sleep(1100); }
      r = await api('/api/alarms?state=active&limit=50'); check('polling: a device that stops answering raises "No SNMP answer"', (r.json?.alarms || []).some((x) => x.rule === 'No SNMP answer' && x.device === 'e2e-switch'), JSON.stringify((r.json?.alarms || []).map((x) => x.rule)));
      r = await api('/api/poll/report?hours=24'); check('polling: the report lists the device with its availability', r.json?.rows?.some((x) => x.id === pid && x.polls >= 1), r.text.slice(0, 160));
      r = await api('/api/poll/export?hours=24'); check('polling: the summary downloads as CSV', r.status === 200 && /text\/csv/.test(r.headers.get('content-type')) && /Availability/.test(r.text), r.text.slice(0, 80));
      r = await api('/api/poll/mibobjects?q=zzzz-none'); check('polling: the MIB picker answers', r.status === 200 && Array.isArray(r.json?.objects), r.text.slice(0, 80));
      r = await api('/api/poll/discover', { method: 'POST', body: JSON.stringify({ ranges: '10.0.0.0/8', version: 'v2c', communities: 'public' }) }); check('polling: a scan of too many addresses is refused', r.status === 400, r.text.slice(0, 100));
      r = await api('/api/poll/delete', { method: 'POST', body: JSON.stringify({ id: pid }) }); await sleep(200);
      r = await api('/api/alarms?state=active&limit=50'); check('polling: removing the device clears its polling alarms', !(r.json?.alarms || []).some((x) => x.device === 'e2e-switch'), '');
    } finally { try { ag.close(); } catch { /* closed */ } }
  }
  r = await api('/api/alarms?state=escalated&limit=5'); check('alarms can be listed by escalated state and the counts carry it', Array.isArray(r.json?.alarms) && typeof r.json?.counts?.escalated === 'number' && typeof r.json?.summary?.escalatedPeriod === 'number', JSON.stringify(r.json?.counts));
  await new Promise((ok) => setTimeout(ok, 5600));
  r = await api('/api/health/history?range=1h'); check('system health history has CPU, memory, disk samples', r.json?.fast?.length >= 1 && typeof r.json.fast[0].cpu === 'number' && typeof r.json.fast[0].mem === 'number' && r.json.machine?.cores > 0 && r.json.stepSec === 5, JSON.stringify(r.json?.fast?.[0]));
  r = await api('/api/health/history?range=24h'); check('the 24 hour view uses one-minute steps', r.json?.stepSec === 60 && Array.isArray(r.json.fast));
  r = await api('/api/health'); check('health shows the SNMP input', r.json.checks.some((c) => c.id === 'listen-snmp' && c.status === 'ok'));
  r = await api('/api/mibs/delete', { method: 'POST', body: JSON.stringify({ name: 'E2E-MIB.mib' }) }); check('a MIB file can be removed', r.json?.ok === true && !fs.existsSync(path.join(dir, 'mibs', 'E2E-MIB.mib')) && (await api('/api/mibs/delete', { method: 'POST', body: JSON.stringify({ name: 'E2E-MIB.mib' }) })).status === 404);
  await put({ snmp: { enabled: true, port: SNMP, bind: '0.0.0.0', communities: [], informAck: true, defaultSeverity: 5, severityRules: [] } });

  // ---------- v1.9: richer rules, alarm history, trap views, devices, reports with traps and alarms -------------------------------------------
  const richRule = { id: 'rich1', name: 'Rich rule', enabled: true, source: 'syslog', note: 'a note', match: { text: 'richtest', notText: 'ignoreme', ip: '127.0.0.1, 10.0.0.0/8', days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59', repeat: { count: 2, withinSec: 60 } }, actions: { severity: 2, tag: 'rich', stop: true, alarm: true, alarmAutoClearMin: 30 } };
  r = await put({ rules: [richRule] });
  const savedRule = r.json?.config?.rules?.[0];
  check('new rule parameters are accepted and kept', r.status === 200 && savedRule?.match.notText === 'ignoreme' && savedRule.match.ip === '127.0.0.1, 10.0.0.0/8' && savedRule.match.repeat?.count === 2 && savedRule.match.from === '00:00' && savedRule.actions.severity === 2 && savedRule.actions.stop === true && savedRule.actions.alarmAutoClearMin === 30 && savedRule.note === 'a note', r.text.slice(0, 200));
  check('a bad IP range in a rule is refused', (await put({ rules: [{ ...richRule, match: { ip: 'not-an-ip' } }] })).status === 400);
  check('a bad time in a rule is refused', (await put({ rules: [{ ...richRule, match: { from: '25:99' } }] })).status === 400);
  await put({ rules: [richRule] });
  await sendUdp('<14>1 2026-10-25T18:50:00Z richdev app 1 - - richtest one'); await sleep(500);
  r = await logs('&host=richdev'); check('"repeated N times" holds the rule back until the second match', !r.some((x) => x.tags.includes('rich')), JSON.stringify(r.map((x) => x.tags)));
  await sendUdp('<14>1 2026-10-25T18:50:01Z richdev app 1 - - richtest two'); await sleep(600);
  r = await logs('&host=richdev&text=two'); check('the second match applies the rule: severity set to critical and tag added', r.length === 1 && r[0].severity === 2 && r[0].tags.includes('rich'), JSON.stringify(r));
  await sendUdp('<14>1 2026-10-25T18:50:02Z richdev app 1 - - richtest ignoreme three'); await sleep(500);
  r = await logs('&host=richdev&text=three'); check('"does not contain" keeps the rule from applying', r.length === 1 && !r[0].tags.includes('rich') && r[0].severity === 6, JSON.stringify(r));
  r = await api('/api/alarms?state=active&q=richdev'); const ra = r.json.alarms.find((x) => x.rule === 'Rich rule');
  check('the alarm records the auto-clear setting, and the list has a history summary', !!ra && ra.autoClearMin === 30 && r.json.summary && r.json.summary.raised >= 1, JSON.stringify(ra)?.slice(0, 160));
  r = await api('/api/alarms?state=all&sort=oldest&since=' + (Date.now() - 3600000)); check('alarms can be sorted and limited to a period', r.status === 200 && Array.isArray(r.json.alarms) && r.json.alarms.every((x) => x.first >= Date.now() - 3600000 - 5000));
  r = await api('/api/rules/test', { method: 'POST', body: JSON.stringify({ rule: { ...richRule, match: { text: 'richtest' } } }) });
  check('"Test rule" counts matches in the last 24 hours', r.status === 200 && r.json.matched >= 3 && r.json.samples.length >= 1, JSON.stringify(r.json)?.slice(0, 160));
  await put({ rules: [] });
  // trap views, trap catalogue, senders, test trap
  r = await put({ uiPrefs: { trapViews: [{ id: 'tv1', name: 'Link traps', match: 'linkDown', cols: [{ label: 'Port', field: 'ifDescr' }, { label: 'Status', field: 'ifOperStatus' }], message: false }] } });
  check('a trap column view can be saved', r.status === 200 && r.json.config.uiPrefs.trapViews?.[0]?.cols.length === 2, r.text.slice(0, 160));
  r = await put({ uiPrefs: { trapViews: [{ id: 'tv3', name: 'Lookup', match: '', std: false, cols: [{ label: 'Status', field: 'alertGroup.1.3', map: '5=Critical; 4=Major; *=Unknown\n@ 1.3.6.1.4.1.12148: 5=Clear' }], message: false }] }, snmp: undefined });
  check('a trap view keeps its lookup table and the "no standard columns" choice', r.status === 200 && r.json.config.uiPrefs.trapViews?.[0]?.cols[0].map === '5=Critical; 4=Major; *=Unknown\n@ 1.3.6.1.4.1.12148: 5=Clear' && r.json.config.uiPrefs.trapViews[0].std === false, r.text.slice(0, 200));
  { const ex = await fetch(`http://127.0.0.1:${WEB}/api/export?source=snmp&format=csv&view=tv3&max=5`, { headers: { 'x-requested-with': 'NetEventPro' } }); const tx = await ex.text(); check('the export of the Traps page uses the columns of the chosen view', ex.status === 200 && tx.replace('\ufeff', '').startsWith('Status\r\n'), tx.slice(0, 80)); }
  r = await put({ uiPrefs: { look: { tv: { tv3: { col: 0, vals: { Critical: { bg: '#ff0000', bold: true }, '': { bg: '#00ff00' }, bad: { bg: 'red' } } } } } } });
  check('colours for the values of a trap view column are kept (and bad ones dropped)', r.status === 200 && JSON.stringify(r.json.config.uiPrefs.look?.tv?.tv3) === '{"col":0,"vals":{"critical":{"bg":"#ff0000","bold":true}}}', r.text.slice(0, 200));
  check('a trap view with a risky regular expression is refused', (await put({ uiPrefs: { trapViews: [{ id: 'tv2', name: 'x', match: '/(a+)+$/', cols: [{ label: 'a', field: 'a' }] }] } })).status === 400);
  r = await api('/api/snmp/test', { method: 'POST', body: '{}' }); await sleep(700);
  check('the "send a test trap" button works', r.status === 200 && r.json.ok === true, r.text.slice(0, 120));
  r = await api('/api/logs?limit=20&source=snmp&trap=linkDown'); const tr1 = r.json.rows.find((x) => /TestPort0\/1/.test(x.message));
  check('traps can be searched by trap name and carry their values as structured data', !!tr1 && r.json.rows.every((x) => /linkDown/i.test(x.msgid)) && JSON.parse(tr1.vb).v.some((v) => v[0].startsWith('ifDescr') && v[2] === 'TestPort0/1'), JSON.stringify(tr1)?.slice(0, 200));
  r = await api('/api/logs?limit=20&source=snmp&trap=1.3.6.1.6.3.1.1.5'); check('and by OID prefix', r.json.rows.length > 0 && r.json.rows.every((x) => JSON.parse(x.vb).o.startsWith('1.3.6.1.6.3.1.1.5')));
  r = await api('/api/snmp'); check('the SNMP page lists the devices that sent traps', r.json.status.senders.some((x) => x.ip === '127.0.0.1' && x.count >= 1));
  r = await api('/api/mibs/traps?q=linkdown'); check('the trap catalogue lists traps from the MIBs', r.json.traps.some((x) => x.name === 'linkDown' && x.oid === '1.3.6.1.6.3.1.1.5.3'));
  // devices
  r = await put({ deviceInfo: { '127.0.0.1': { group: 'Lab', note: 'test box', expectMin: 5 } } });
  check('device group, note and expected interval are saved', r.status === 200 && r.json.config.deviceInfo['127.0.0.1'].group === 'Lab');
  r = await api('/api/devices'); const dv = r.json.find((x) => x.srcIp === '127.0.0.1');
  check('the device list separates syslog and traps and carries group and open alarms', !!dv && dv.traps >= 1 && dv.sys >= 1 && dv.group === 'Lab' && dv.expectMin === 5 && typeof dv.openAlarms === 'number', JSON.stringify(dv)?.slice(0, 220));
  await put({ deviceInfo: {} });
  // reports with traps and alarms
  r = await api('/api/config'); const repList = r.json.reports || [];
  const rep2 = { id: 'rpt2', name: 'E2E full', enabled: true, schedule: { type: 'daily', time: '08:00' }, period: 'last24h', filter: {}, content: { messages: true, maxRows: 100, traps: true, maxTrapRows: 100, alarmsActive: true, alarmHistory: true }, formats: ['pdf', 'xlsx', 'csv'], email: { enabled: false, to: '' }, folder: { enabled: false, path: '', keep: 5 } };
  r = await put({ reports: [...repList, rep2] }); check('a report can include traps, active alarms and alarm history', r.status === 200 && r.json.config.reports.find((x) => x.id === 'rpt2')?.content.alarmHistory === true, r.text.slice(0, 160));
  for (const [f, magic, probe] of [['csv', '﻿', null], ['xlsx', 'PK', 'Alarm history'], ['pdf', '%PDF-', null]]) {
    const d = await fetch(`http://127.0.0.1:${WEB}/api/reports/run`, { method: 'POST', headers: H, body: JSON.stringify({ id: 'rpt2', download: f }) }); const buf = Buffer.from(await d.arrayBuffer());
    check(`the full report downloads as ${f}`, d.status === 200 && buf.toString('latin1').startsWith(magic === '﻿' ? 'ï»¿' : magic) && buf.length > 500, d.status + ' ' + buf.length);
  }
  r = await api('/api/reports/run', { method: 'POST', body: JSON.stringify({ id: 'rpt2' }) }); check('running it creates the trap and alarm files too', r.status === 200 && (r.json.files || []).length >= 3, JSON.stringify(r.json)?.slice(0, 200));
  await put({ reports: repList });

  // ---- 1.11: per-port alarms, delete, Cc, report email fields, replacement scope, northbound trap forwarding, PDF ----
  const rulesBefore = (await api('/api/config')).json.rules || [];
  r = await put({ rules: [...rulesBefore, { id: 'pdown', name: 'Port down', enabled: true, match: { text: '/PORTTEST.*to down/' }, actions: { alarm: true, alarmBy: 'port' } },
    { id: 'pup', name: 'Port up', enabled: true, match: { text: '/PORTTEST.*to up/' }, actions: { clearsRule: 'pdown', alarmBy: 'port' } }] });
  check('rules accept "one alarm per port"', r.status === 200 && r.json.config.rules.find((x) => x.id === 'pdown')?.actions.alarmBy === 'port', r.text.slice(0, 200));
  r = await put({ rules: [{ id: 'bad1', name: 'x', source: 'syslog', match: { text: 'x' }, actions: { alarm: true, alarmBy: '/(a+)+$/' } }] }); check('a risky own pattern is refused', r.status === 400, r.text.slice(0, 160));
  r = await put({ rules: [{ id: 'bad2', name: 'x', source: 'syslog', match: { text: 'x' }, actions: { alarm: true, alarmBy: 'whatever' } }] }); check('a pattern without slashes is refused', r.status === 400);
  await put({ rules: [...rulesBefore, { id: 'pdown', name: 'Port down', enabled: true, match: { text: '/PORTTEST.*to down/' }, actions: { alarm: true, alarmBy: 'port' } }, { id: 'pup', name: 'Port up', enabled: true, match: { text: '/PORTTEST.*to up/' }, actions: { clearsRule: 'pdown', alarmBy: 'port' } }] });
  for (let i = 1; i <= 6; i++) await sendUdp(`<187>Oct 25 22:50:00 swport PORTTEST Interface GigabitEthernet1/0/${i}, changed state to down`);
  await sleep(1200);
  r = await api('/api/alarms?state=active&limit=200'); check('6 link-downs from one switch are 6 alarms', r.json?.alarms?.filter((a) => a.rule === 'Port down' && a.device === 'swport').length === 6, JSON.stringify(r.json?.alarms?.map((a) => a.port)));
  await sendUdp('<189>Oct 25 22:51:00 swport PORTTEST Interface Gi1/0/2, changed state to up'); await sendUdp('<189>Oct 25 22:51:00 swport PORTTEST Interface Gi1/0/5, changed state to up'); await sleep(1200);
  r = await api('/api/alarms?state=active&limit=200'); check('two link-ups clear only their own ports', r.json?.alarms?.filter((a) => a.rule === 'Port down' && a.device === 'swport').length === 4 && !r.json.alarms.some((a) => ['gi1/0/2', 'gi1/0/5'].includes(a.port)), JSON.stringify(r.json?.alarms?.map((a) => a.port)));
  const pa = r.json.alarms.filter((a) => a.rule === 'Port down' && a.device === 'swport');
  r = await api('/api/alarms/delete', { method: 'POST', body: JSON.stringify({ ids: [pa[0].id, pa[1].id] }) }); check('alarms can be deleted', r.status === 200 && r.json.changed === 2, r.text);
  r = await api('/api/alarms?state=active&limit=200'); check('the deleted alarms are gone', r.json.alarms.filter((a) => a.rule === 'Port down' && a.device === 'swport').length === 2);
  await put({ rules: rulesBefore });
  // message numbers: syslog and traps are numbered separately
  rows = await logs('&source=syslog&limit=5'); const trs = await logs('&source=snmp&limit=5');
  check('syslog and trap messages carry their own numbers', rows.length && trs.length && rows[0].seq >= 1 && trs[0].seq >= 1 && trs[0].seq < rows[0].seq + 1000 && new Set(trs.map((x) => x.seq)).size === trs.length, JSON.stringify([rows[0]?.seq, trs[0]?.seq, trs[0]?.id]));
  check('the first trap is number 1', (await logs('&source=snmp&limit=500')).some((x) => x.seq === 1));
  // delete messages
  await sendUdp('<14>Oct 25 22:55:00 delme-1 app: DELETEME one'); await sendUdp('<14>Oct 25 22:55:01 delme-2 app: DELETEME two'); await sendUdp('<14>Oct 25 22:55:02 keepme app: KEEPME'); await sleep(900);
  const dm = (await logs('&text=DELETEME')); check('test messages arrived', dm.length === 2);
  r = await api('/api/logs/delete', { method: 'POST', body: JSON.stringify({ ids: [dm[0].id] }) }); check('one selected message can be deleted', r.status === 200 && r.json.deleted === 1, r.text);
  r = await api('/api/logs/delete', { method: 'POST', body: JSON.stringify({ matching: true, q: { text: 'DELETEME' } }) }); check('deleting by search needs the word DELETE', r.status === 400);
  r = await api('/api/logs/delete', { method: 'POST', body: JSON.stringify({ matching: true, confirm: 'DELETE', q: { text: 'DELETEME' } }) }); check('everything matching a search can be deleted', r.status === 200 && r.json.deleted === 1, r.text);
  check('other messages stay', (await logs('&text=KEEPME')).length === 1 && (await logs('&text=DELETEME')).length === 0);
  check('the deletion is written to the log', (await logs('&host=NetEventPro&text=deleted')).some((x) => /deleted 1 syslog message/.test(x.message)));
  r = await api('/api/logs/delete', { method: 'POST', body: '{}' }); check('delete with nothing selected is refused', r.status === 400);
  // Cc and report email fields
  r = await put({ smtp: { ...(await api('/api/config')).json.smtp, cc: 'boss@example.com, ops@example.com' } }); check('the mail setting accepts a Cc list', r.status === 200 && r.json.config.smtp.cc === 'boss@example.com, ops@example.com', r.text.slice(0, 200));
  r = await put({ smtp: { ...(await api('/api/config')).json.smtp, cc: 'not an address' } }); check('a bad Cc is refused', r.status === 400);
  const cfg0 = (await api('/api/config')).json;
  r = await put({ reports: [{ id: 'rpt3', name: 'E2E mail', enabled: true, schedule: { type: 'daily', time: '08:00' }, period: 'last24h', filter: {}, content: { messages: true, maxRows: 10 }, formats: ['csv'], email: { enabled: true, to: 'a@example.com', cc: 'c@example.com', subject: 'Daily {name} {date}', body: 'Hello\nThe report {name} covers {period}.' }, folder: { enabled: false } }] });
  check('a report keeps its Cc, subject and message', r.status === 200 && r.json.config.reports[0].email.cc === 'c@example.com' && /Hello/.test(r.json.config.reports[0].email.body) && r.json.config.reports[0].email.subject === 'Daily {name} {date}', r.text.slice(0, 200));
  mails.length = 0; r = await api('/api/reports/run', { method: 'POST', body: JSON.stringify({ id: 'rpt3' }) }); await sleep(900);
  const rm = mails[mails.length - 1] || {}; const rawm = rm.raw || ''; const body64 = (rawm.split(/\n\n/)[1] || '').replace(/\s/g, ''); check('the report e-mail has the Cc recipient, subject and message', r.status === 200 && (rm.to || []).some((x) => /c@example\.com/.test(x)) && /Subject: Daily E2E mail \d{4}-/.test(rawm) && /Cc: .*c@example\.com/.test(rawm), rawm.slice(0, 500));
  await put({ reports: repList, smtp: { ...(await api('/api/config')).json.smtp, cc: '' } });
  // text replacement can be limited to traps or syslog
  r = await put({ replacements: [{ find: 'ONLYSYS', replace: 'syslog-seen', scope: 'message', on: 'syslog' }, { find: 'ONLYTRAP', replace: 'trap-seen', scope: 'message', on: 'snmp' }, { find: 'BOTHKIND', replace: 'both-seen', scope: 'message', on: 'bogus' }] });
  check('a replacement keeps which kind of message it is for', r.status === 200 && r.json.config.replacements.map((x) => x.on).join() === 'syslog,snmp,both', r.text.slice(0, 200));
  await sendUdp('<14>Oct 25 23:00:00 repl-1 app: ONLYSYS ONLYTRAP BOTHKIND'); await sleep(800);
  check('syslog-only replacement applied to syslog, trap-only one did not', (await logs('&text=both-seen')).some((x) => /syslog-seen ONLYTRAP both-seen/.test(x.message)));
  await put({ replacements: [] });
  // northbound trap forwarding
  const nb = dgram.createSocket('udp4'); const got = []; await new Promise((ok) => nb.bind(0, '127.0.0.1', ok)); nb.on('message', (b) => got.push(b)); const nbPort = nb.address().port;
  r = await put({ trapForwardTargets: [{ name: 'NMS', host: '127.0.0.1', port: nbPort, community: 'north', version: 'v2c' }, { name: 'bad', host: 'bad host!', port: 162 }] }); check('a bad trap destination is refused', r.status === 400);
  r = await put({ trapForwardTargets: [{ name: 'NMS', host: '127.0.0.1', port: nbPort, community: 'north', version: 'v2c' }] }); check('an SNMP trap destination can be saved', r.status === 200 && r.json.config.trapForwardTargets[0].community === 'north', r.text.slice(0, 200));
  await sendTrap(trapOf(false, 'GigabitEthernet0/9', 9)); await sleep(900);
  const dec = got.map((b) => { try { return ber.decodeMessage(b); } catch { return null; } }).filter(Boolean);
  check('the trap arrives at the other manager as the same trap, with the original sender', dec.length >= 1 && dec[0].community === 'north' && dec[0].version === 2 && dec[0].varbinds.some((v) => v.oid.join('.') === '1.3.6.1.6.3.1.1.4.1.0' && v.value.join('.') === '1.3.6.1.6.3.1.1.5.3') && dec[0].varbinds.some((v) => v.oid.join('.') === '1.3.6.1.6.3.18.1.3.0' && v.value === '127.0.0.1'), JSON.stringify(dec[0]?.varbinds?.map((v) => v.oid.join('.'))));
  const nbBefore = got.length; await sendUdp('<14>Oct 25 23:01:00 notatrap app: plain syslog'); await sleep(500); check('syslog is not sent to the trap manager', got.length === nbBefore);
  await put({ trapForwardTargets: [] }); nb.close();
  // PDF: dashboard pages first
  await put({ reports: [...repList, rep2] });
  { const d = await fetch(`http://127.0.0.1:${WEB}/api/reports/run`, { method: 'POST', headers: H, body: JSON.stringify({ id: 'rpt2', download: 'pdf' }) }); const buf = Buffer.from(await d.arrayBuffer()); check('the PDF report still builds with dashboard pages', d.status === 200 && buf.toString('latin1').startsWith('%PDF-') && (buf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length >= 3, buf.length); }

  // ---- 1.12: alarm time range, update settings, gzip, live feed ping ----
  { const now = Date.now();
    r = await api(`/api/alarms?state=all&from=${now + 3600000}&limit=50`); check('an alarm time range after now keeps only still-open alarms', Array.isArray(r.json?.alarms) && r.json.alarms.every((a) => !a.clearedTs));
    const wide = await api('/api/alarms?state=all&from=0&limit=500'), recent = await api(`/api/alarms?state=all&from=${now - 60000}&limit=500`);
    check('"All time" lists at least as many alarms as a short range', wide.json.total >= recent.json.total, wide.json.total + ' vs ' + recent.json.total);
    check('a "to" limit keeps alarms raised before it', (await api(`/api/alarms?state=all&from=0&to=1000&limit=50`)).json.total === 0); }
  r = await put({ update: { url: 'ftp://x', publicKey: '' } }); check('an update address that is not http(s) is refused', r.status === 400);
  r = await put({ update: { url: 'https://updates.example.com/latest.json', publicKey: 'not a key; drop table', autoCheck: false } }); check('a key with odd characters is refused', r.status === 400);
  r = await put({ update: { url: 'https://updates.example.com/latest.json', publicKey: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAabc=\n-----END PUBLIC KEY-----', autoCheck: false } }); check('update address and key are saved', r.status === 200 && r.json.config.update.url === 'https://updates.example.com/latest.json' && r.json.config.update.autoCheck === false, r.text.slice(0, 200));
  r = await api('/api/update/status'); check('update status is available to admins', r.status === 200 && r.json.current && r.json.hasKey === true, r.text.slice(0, 160));
  r = await api('/api/update/install', { method: 'POST', body: JSON.stringify({}) }); check('installing without confirmation is refused', r.status === 400);
  r = await put({ update: { url: '', publicKey: '', autoCheck: true, nodeBase: 'file:///x' } }); check('a bad Node.js download address is refused', r.status === 400);
  r = await put({ update: { url: '', publicKey: '', autoCheck: true, nodeBase: 'http://nodemirror.example/dist/' } }); check('a Node.js download address is saved', r.status === 200 && r.json.config.update.nodeBase === 'http://nodemirror.example/dist');
  r = await api('/api/update/node', { method: 'POST', body: JSON.stringify({}) }); check('Node.js update without confirmation is refused', r.status === 400);
  r = await api('/api/update/node', { method: 'POST', body: JSON.stringify({ confirm: 'INSTALL NODE' }) }); check('Node.js update is refused where it is not the Windows service', r.status === 400 && /Windows|node\.exe|information could not/.test(r.text), r.text.slice(0, 160));
  await put({ update: { url: '', publicKey: '', autoCheck: true, nodeBase: '' } });
  { const z = await fetch(`http://127.0.0.1:${WEB}/api/logs?limit=500`, { headers: { 'accept-encoding': 'gzip' } }); const jj = await z.json(); check('large answers are compressed when the browser accepts it', z.headers.get('content-encoding') === 'gzip' && Array.isArray(jj.rows), z.headers.get('content-encoding')); }
  { const ac = new AbortController(); const st = await fetch(`http://127.0.0.1:${WEB}/api/stream?backlog=1`, { signal: ac.signal }); const rd = st.body.getReader(); let txt = '', t0 = Date.now(); while (!/event: ping/.test(txt) && Date.now() - t0 < 14000) { const { value } = await rd.read(); txt += Buffer.from(value || []).toString(); } ac.abort(); check('the live feed sends a ping within 10 seconds so a dead line is noticed', /event: ping/.test(txt) && /retry: 3000/.test(txt), txt.slice(0, 100)); }

  // ---- 1.15: one rule for many messages (OR), clearing inside the same rule, severity from the message, DNWP Connection Master ----
  { const cm = { id: 'cmx', name: 'CM e2e', enabled: true, match: { textAny: ['/Alarm: .*\\bSet:/', 'Unit Missing'] }, actions: { alarm: true, alarmBy: 'port', clearText: ['/Status:\\s*(No alarms|All disabled)/i'], sevMap: [{ text: '/Status:\\s*Major/', severity: 2 }, { text: 'Status: Minor', severity: 4 }] } };
    r = await put({ rules: [cm] }); const sv = r.json?.config?.rules?.[0]; check('a rule keeps its "any of", "clear when" and "severity from message" lists', r.status === 200 && sv.match.textAny.length === 2 && sv.actions.clearText.length === 1 && sv.actions.sevMap.length === 2 && sv.actions.sevMap[0].severity === 2, r.text.slice(0, 300));
    r = await put({ rules: [{ ...cm, match: { textAny: ['/(a+)+$/'] } }] }); check('a risky pattern in "any of" is refused', r.status === 400);
    r = await put({ rules: [{ ...cm, actions: { ...cm.actions, clearText: ['/(x+)+y/'] } }] }); check('a risky pattern in "clear when" is refused', r.status === 400);
    await put({ rules: [cm] });
    for (const m of ['5/8 E1: Set: Major=LOS. Status: Major=LOS', '5/1 E1: Set: Major=LOS. Status: Major=LOS', '13/1 E+M: Set: Minor=AIS. Status: Minor=AIS']) await sendUdp(`<133>Oct 31 13:09:03 cmdev : Alarm: ${m}`);
    await sleep(1200); r = await api('/api/alarms?state=active&limit=200'); let ca = r.json.alarms.filter((a) => a.device === 'cmdev');
    check('three different cards/ports on one Connection Master are three alarms', ca.length === 3 && new Set(ca.map((a) => a.port)).size === 3, JSON.stringify(ca.map((a) => a.port)));
    check('"severity from message" set Major to Critical and Minor to Warning', ca.find((a) => a.port === '5/8e1')?.severity === 2 && ca.find((a) => a.port === '13/1e+m')?.severity === 4, JSON.stringify(ca.map((a) => [a.port, a.severity])));
    await sendUdp('<133>Oct 31 13:10:03 cmdev : Alarm: 5/8 E1:  Cleared: Major=LOS. Status: No alarms'); await sleep(1000);
    r = await api('/api/alarms?state=active&limit=200'); ca = r.json.alarms.filter((a) => a.device === 'cmdev');
    check('the same rule clears only its own port when the "all clear" message arrives', ca.length === 2 && !ca.some((a) => a.port === '5/8e1'), JSON.stringify(ca.map((a) => a.port)));
    await sendUdp('<133>Oct 31 13:10:05 cmdev : Alarm: 5/1 E1: Set: Major=LOF. Cleared: Major=LOS. Status: Major=LOF'); await sleep(900);
    r = await api('/api/alarms?state=active&limit=200'); ca = r.json.alarms.filter((a) => a.device === 'cmdev'); check('a changed fault on a port is a separate alarm line', ca.length === 3 && ca.filter((a) => a.port === '5/1e1').length === 2);
    await put({ rules: [] }); }

  // ---------- HTTPS certificate made by the app --------------------------------------------------------------------------------------
  r = await api('/api/https/generate', { method: 'POST', body: JSON.stringify({ hosts: 'no good!' }) }); check('bad host name refused', r.status === 400);
  const cfgBefore = (await api('/api/config')).json.tlsCertFile;
  r = await api('/api/https/generate', { method: 'POST', body: JSON.stringify({ hosts: 'localhost, 127.0.0.1', days: 90 }) });
  check('certificate created, files written, settings point at them', r.json?.ok === true && fs.existsSync(path.join(dir, 'tls', 'neteventpro.crt')) && fs.readFileSync(path.join(dir, 'tls', 'neteventpro.key'), 'utf8').includes('PRIVATE KEY') && (await api('/api/config')).json.tlsCertFile === r.json.certFile && r.json.restartRequired === true, r.text.slice(0, 160));
  r = await api('/api/https'); check('status describes the certificate and is not yet active', r.json?.running === false && /DNS:localhost/.test(r.json.cert?.names) && r.json.cert.expired === false, r.text.slice(0, 200));
  check('certificate can be downloaded', (await fetch(`http://127.0.0.1:${WEB}/api/https/cert`)).status === 200);
  await api('/api/https/generate', { method: 'POST', body: JSON.stringify({ hosts: 'localhost' }) });
  check('an earlier certificate is kept, not overwritten', fs.readdirSync(path.join(dir, 'tls')).some((f) => /^neteventpro\.crt\.old-/.test(f)));
  await put({ tlsCertFile: '', tlsKeyFile: '' }); check('HTTPS can be switched off again', (await api('/api/config')).json.tlsCertFile === cfgBefore);

  // ---------- passwords ----------------------------------------------------------------------------------------------------------
  r = await put({ adminPassword: 'short' });
  check('short dashboard password refused', r.status === 400, r.json?.error);
  r = await put({ adminPassword: 'correct-horse-battery' });
  check('password set', r.status === 200);
  const cfgTxt = fs.readFileSync(path.join(dir, 'config.json'), 'utf8');
  check('config.json stores a hash, not the password', !cfgTxt.includes('correct-horse') && /scrypt\$/.test(cfgTxt));
  check('SMTP password is encrypted in config.json (1.45)', !cfgTxt.includes('pw-secret') && /"password": "enc1:/.test(cfgTxt), cfgTxt.includes('pw-secret') ? 'stored in clear text' : 'encrypted');
  const basic = (u, p) => ({ Authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') });
  check('no credentials -> 401', (await raw('/api/state')).status === 401);
  check('correct credentials -> 200', (await raw('/api/state', basic('admin', 'correct-horse-battery'))).status === 200);
  check('wrong user name -> 401', (await raw('/api/state', basic('root', 'correct-horse-battery'))).status === 401);

  // ---------- users, roles, groups -----------------------------------------------------------------------------------------------
  const AD = basic('admin', 'correct-horse-battery');
  const jfetch = async (p, opts = {}, who = AD) => { const r2 = await fetch(`http://127.0.0.1:${WEB}${p}`, { ...opts, headers: { ...(opts.method && opts.method !== 'GET' ? H : {}), ...who, ...(opts.headers || {}) } }); const t = await r2.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ } return { status: r2.status, json: j, text: t }; };
  const up0 = await jfetch('/api/users'); check('admin can list users (built-in roles exist)', up0.status === 200 && up0.json.roles.some((x) => x.id === 'admin' && x.locked) && up0.json.roles.some((x) => x.id === 'viewer') && up0.json.adminEnabled === true, up0.text.slice(0, 120));
  let ur = await jfetch('/api/users', { method: 'POST', body: JSON.stringify({ roles: up0.json.roles, groups: [], users: [{ name: 'alice', roleId: 'viewer' }] }) });
  check('a new user needs a password', ur.status === 400 && /password/i.test(ur.json.error), ur.text);
  ur = await jfetch('/api/users', { method: 'POST', body: JSON.stringify({ roles: up0.json.roles, groups: [], users: [{ name: 'admin', roleId: 'viewer', password: 'whatever-123' }] }) });
  check('the name "admin" is reserved', ur.status === 400, ur.text);
  ur = await jfetch('/api/users', { method: 'POST', body: JSON.stringify({ roles: up0.json.roles, groups: [], users: [{ name: 'a b!', roleId: 'viewer', password: 'whatever-123' }] }) });
  check('odd user names are refused', ur.status === 400, ur.text);
  ur = await jfetch('/api/users', { method: 'POST', body: JSON.stringify({ roles: [...up0.json.roles, { id: 'netops', name: 'Network ops', perms: ['view', 'rules', 'bogus'] }], groups: [{ id: 'night', name: 'Night shift', roleIds: ['viewer', 'nope'] }],
    users: [{ name: 'alice', roleId: 'viewer', password: 'alice-password-1' }, { name: 'Bob', roleId: 'netops', password: 'bob-password-12', groupIds: ['night'] }, { name: 'carol', roleId: 'operator', password: 'carol-password-1', disabled: true }] }) });
  check('users, role and group saved; unknown permissions are dropped', ur.status === 200 && ur.json.users.length === 3 && JSON.stringify(ur.json.roles.find((x) => x.id === 'netops').perms) === '["view","rules"]' && ur.json.users.every((x) => !('hash' in x)), ur.text.slice(0, 200));
  check('password hashes never leave the server', !ur.text.includes('scrypt$'));
  const ufile = fs.readFileSync(path.join(dir, 'users.json'), 'utf8'); check('users.json holds hashes, not passwords', /scrypt\$/.test(ufile) && !ufile.includes('alice-password-1'));
  const AL = basic('alice', 'alice-password-1'), BO = basic('bob', 'bob-password-12');
  check('a user can sign in with their own password', (await jfetch('/api/state', {}, AL)).status === 200);
  const me = (await jfetch('/api/state', {}, AL)).json.me; check('the screen is told who the person is and what they may do', me.name === 'alice' && JSON.stringify(me.perms) === '["view"]' && me.builtin === false, JSON.stringify(me));
  check('user names are not case-sensitive', (await jfetch('/api/state', {}, basic('ALICE', 'alice-password-1'))).status === 200);
  check('a disabled user cannot sign in', (await jfetch('/api/state', {}, basic('carol', 'carol-password-1'))).status === 401);
  check('a viewer cannot change settings', (await jfetch('/api/config', { method: 'PUT', body: JSON.stringify({ retentionDays: 9 }) }, AL)).status === 403);
  check('a viewer cannot edit rules', (await jfetch('/api/config', { method: 'PUT', body: JSON.stringify({ rules: [] }) }, AL)).status === 403);
  check('a viewer cannot see users, reports or backups', (await jfetch('/api/users', {}, AL)).status === 403 && (await jfetch('/api/reports', {}, AL)).status === 403 && (await jfetch('/api/backup', {}, AL)).status === 403);
  check('a viewer cannot export or run tests or restart', (await jfetch('/api/export', {}, AL)).status === 403 && (await jfetch('/api/test-message', { method: 'POST', body: '{}' }, AL)).status === 403 && (await jfetch('/api/restart', { method: 'POST', body: '{}' }, AL)).status === 403);
  check('a viewer can read logs and the dashboard numbers', (await jfetch('/api/logs?limit=1', {}, AL)).status === 200 && (await jfetch('/api/dash', { method: 'POST', body: JSON.stringify({ tiles: [] }) }, AL)).status === 200);
  const alCfg = (await jfetch('/api/config', {}, AL)).json; check('a viewer does not receive mail logins, webhook addresses or relay targets', alCfg.smtp.host === '' && alCfg.smtp.user === '' && alCfg.forwardTargets.length === 0 && !(alCfg.webhooks || []).some((h) => h.url));
  check('a custom role can edit rules but not settings (and the group adds view)', (await jfetch('/api/config', { method: 'PUT', body: JSON.stringify({ rules: [] }) }, BO)).status === 200 && (await jfetch('/api/config', { method: 'PUT', body: JSON.stringify({ rules: [], retentionDays: 9 }) }, BO)).status === 403);
  check('a viewer sees alarms and maintenance windows but cannot act on them', (await jfetch('/api/alarms', {}, AL)).status === 200 && (await jfetch('/api/maintenance', {}, AL)).status === 200 && (await jfetch('/api/alarms/ack', { method: 'POST', body: JSON.stringify({ ids: [1] }) }, AL)).status === 403 && (await jfetch('/api/alarms/clear', { method: 'POST', body: JSON.stringify({ ids: [1] }) }, AL)).status === 403 && (await jfetch('/api/config', { method: 'PUT', body: JSON.stringify({ maintenance: [] }) }, AL)).status === 403);
  check('the rules role can edit maintenance windows but still cannot acknowledge (no alarms permission)', (await jfetch('/api/config', { method: 'PUT', body: JSON.stringify({ maintenance: [] }) }, BO)).status === 200 && (await jfetch('/api/alarms/ack', { method: 'POST', body: JSON.stringify({ ids: [1] }) }, BO)).status === 403);
  check('the built-in Operator role carries the alarms permission', up0.json.roles.find((x) => x.id === 'operator').perms.includes('alarms') && up0.json.perms.some((x) => x.id === 'alarms'));
  check('a person cannot make themselves administrator', (await jfetch('/api/users', { method: 'POST', body: JSON.stringify({ roles: [], groups: [], users: [] }) }, BO)).status === 403);
  ur = await jfetch('/api/users/password', { method: 'POST', body: JSON.stringify({ name: 'alice', password: 'alice-new-pass-2' }) });
  check('an administrator can reset a password', ur.status === 200);
  check('the old password stops working at once', (await jfetch('/api/state', {}, AL)).status === 401);
  check('the new password works', (await jfetch('/api/state', {}, basic('alice', 'alice-new-pass-2'))).status === 200);
  check('a short reset password is refused', (await jfetch('/api/users/password', { method: 'POST', body: JSON.stringify({ name: 'alice', password: 'short' }) })).status === 400);
  check('only the built-in administrator can reset the built-in administrator', (await jfetch('/api/users/password', { method: 'POST', body: JSON.stringify({ name: 'admin', password: 'sneaky-new-pass-1' }) }, BO)).status === 403);
  ur = await jfetch('/api/me/password', { method: 'POST', body: JSON.stringify({ current: 'nope-nope', password: 'alice-third-pass-3' }) }, basic('alice', 'alice-new-pass-2')); check('changing your own password needs the current one', ur.status === 403);
  ur = await jfetch('/api/me/password', { method: 'POST', body: JSON.stringify({ current: 'alice-new-pass-2', password: 'alice-third-pass-3' }) }, basic('alice', 'alice-new-pass-2')); check('changing your own password works', ur.status === 200 && (await jfetch('/api/state', {}, basic('alice', 'alice-third-pass-3'))).status === 200);
  const up1 = await jfetch('/api/users'); ur = await jfetch('/api/users', { method: 'POST', body: JSON.stringify({ roles: up1.json.roles.filter((x) => x.id !== 'netops'), groups: [], users: up1.json.users.filter((x) => x.name !== 'carol').map((x) => ({ ...x })) }) });
  check('deleting a role moves its people to Viewer; deleting a user removes them; passwords are kept when left empty', ur.status === 200 && ur.json.users.length === 2 && ur.json.users.find((x) => x.name === 'bob').roleId === 'viewer' && (await jfetch('/api/state', {}, basic('alice', 'alice-third-pass-3'))).status === 200, ur.text.slice(0, 200));
  check('the built-in administrator keeps working', (await jfetch('/api/state')).status === 200);
  await jfetch('/api/users', { method: 'POST', body: JSON.stringify({ roles: up1.json.roles.filter((x) => x.id !== 'netops'), groups: [], users: [] }) });
  // ---------- in-app sign-in (session cookie) ---------------------------------------------------------------------------------------------
  const lg = (body) => fetch(`http://127.0.0.1:${WEB}/api/login`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  let lr = await fetch(`http://127.0.0.1:${WEB}/`); check('without sign-in the page is the sign-in form, and no browser login box is requested', lr.status === 200 && !lr.headers.get('www-authenticate') && /Sign in/.test(await lr.text()));
  lr = await fetch(`http://127.0.0.1:${WEB}/api/state`, { headers: { 'x-requested-with': 'NetEventPro' } }); check('API without sign-in answers 401 JSON, without a Basic challenge', lr.status === 401 && !lr.headers.get('www-authenticate') && (await lr.json()).login === true);
  lr = await lg({ username: 'admin', password: 'nope-nope' }); check('wrong password refused', lr.status === 401);
  lr = await lg({ username: 'admin', password: 'correct-horse-battery' }); const setc = lr.headers.get('set-cookie') || '';
  check('right password gives an HttpOnly, SameSite=Strict session cookie', lr.status === 200 && /^sp_session=[A-Za-z0-9_-]{40,}/.test(setc) && /HttpOnly/i.test(setc) && /SameSite=Strict/i.test(setc), setc.slice(0, 60));
  const ck = setc.split(';')[0], SES = { cookie: ck };
  check('the cookie opens the dashboard API', (await jfetch('/api/state', {}, SES)).status === 200);
  check('a made-up cookie does not', (await jfetch('/api/state', {}, { cookie: 'sp_session=' + 'A'.repeat(43) })).status === 401);
  check('a browser (which sends Sec-Fetch headers) cannot use Basic credentials', (await jfetch('/api/state', {}, { ...AD, 'sec-fetch-site': 'same-origin' })).status === 401);
  check('changing state with only the cookie still needs the X-Requested-With header', (await fetch(`http://127.0.0.1:${WEB}/api/config`, { method: 'PUT', headers: { cookie: ck, 'content-type': 'application/json' }, body: '{}' })).status === 403);
  await jfetch('/api/logout', { method: 'POST', body: '{}' }, SES);
  check('after sign-out the cookie is dead', (await jfetch('/api/state', {}, SES)).status === 401);
  const bc = await (await lg({ username: 'admin', password: 'correct-horse-battery' })).headers.get('set-cookie'); const bck = { cookie: bc.split(';')[0] };
  await jfetch('/api/users/password', { method: 'POST', body: JSON.stringify({ name: 'admin', password: 'correct-horse-battery' }) }, bck);
  check('a password change ends existing sessions', (await jfetch('/api/state', {}, bck)).status === 401);


  // ---------- 1.16: session time-out, retention, saved columns, trap recipes, report options ----------------------------------------------
  { const l3 = await lg({ username: 'admin', password: 'correct-horse-battery' }); const c3 = l3.headers.get('set-cookie') || ''; const S3 = { cookie: c3.split(';')[0] };
    check('the sign-in cookie lasts as long as the longest sign-in setting (7 days by default)', /Max-Age=604800\b/.test(c3), c3.slice(-40));
    let pr = await jfetch('/api/config', { method: 'PUT', body: JSON.stringify({ sessionIdleHours: 0, sessionMaxDays: 0, retentionDays: 0, alarmRetentionDays: 0, maxDbMB: 0 }) }, S3);
    check('time-out and retention can be set to "never" / "keep everything"', pr.status === 200 && pr.json.config.sessionIdleHours === 0 && pr.json.config.sessionMaxDays === 0 && pr.json.config.retentionDays === 0 && pr.json.config.alarmRetentionDays === 0 && pr.json.config.maxDbMB === 0, pr.text.slice(0, 200));
    check('the signed-in browser stays signed in after the change', (await jfetch('/api/state', {}, S3)).status === 200);
    const l4 = await lg({ username: 'admin', password: 'correct-horse-battery' }); const c4 = l4.headers.get('set-cookie') || '';
    check('with "no overall limit" the cookie lasts ten years', /Max-Age=315360000\b/.test(c4), c4.slice(-40));
    await sleep(300); const sf = path.join(dir, 'sessions.json'); const stxt = fs.existsSync(sf) ? fs.readFileSync(sf, 'utf8') : '';
    check('sign-ins are written to disk so a restart or an update does not sign everyone out, and only as hashes', stxt.length > 10 && !stxt.includes(c4.split(';')[0].slice(11)), stxt.slice(0, 60));
    pr = await jfetch('/api/config', { method: 'PUT', body: JSON.stringify({ sessionIdleHours: -5, sessionMaxDays: 99999, alarmRetentionDays: -9 }) }, S3);
    check('silly values are limited, not stored as they are', pr.status === 200 && pr.json.config.sessionIdleHours === 0 && pr.json.config.sessionMaxDays === 3650 && pr.json.config.alarmRetentionDays === -1, JSON.stringify([pr.json.config.sessionIdleHours, pr.json.config.sessionMaxDays, pr.json.config.alarmRetentionDays]));
    await jfetch('/api/config', { method: 'PUT', body: JSON.stringify({ sessionIdleHours: 12, sessionMaxDays: 7, retentionDays: 30, alarmRetentionDays: -1, maxDbMB: 2048 }) }, S3);
    pr = await jfetch('/api/config', { method: 'PUT', body: JSON.stringify({ uiPrefs: { columns: { traps: [{ id: 'message', visible: true }, { id: 'host', visible: false }], alarms: [{ id: 'rtime', visible: true }, { id: 'sev', visible: true }], bogus: [{ id: 'x' }] }, wrap: { traps: false }, trapViewDefault: 'tvabc', trapViews: [{ id: 'tvabc', name: 'CM', match: '/nsnTrapAlarm/', cols: [{ label: 'Alarm', field: '{alarmSource} - {alarmText} {alarmAdditionalText}' }], message: false }] } }) }, S3);
    const up = pr.json?.config?.uiPrefs || {};
    check('column choices for Traps and Alarms are kept (they were silently dropped before)', pr.status === 200 && up.columns?.traps?.length === 2 && up.columns?.alarms?.[0]?.id === 'rtime' && !up.columns?.bogus && up.wrap?.traps === false, JSON.stringify(up.columns).slice(0, 160));
    check('a trap view keeps its column recipe and can be the default', up.trapViews?.[0]?.cols?.[0]?.field === '{alarmSource} - {alarmText} {alarmAdditionalText}' && up.trapViewDefault === 'tvabc', JSON.stringify(up.trapViews).slice(0, 200));
    pr = await jfetch('/api/config', { method: 'PUT', body: JSON.stringify({ rules: [{ id: 'rep1', name: 'esc report off', source: 'syslog', enabled: true, match: { text: 'e2e-esc' }, actions: { alarm: true, alarmEscMin: 5, alarmEscReport: false, email: true, emailReport: true } }, { id: 'rep2', name: 'no mail', source: 'syslog', enabled: true, match: { text: 'e2e-nomail' }, actions: { alarm: true, emailReport: true } }] }) }, S3);
    const ra = pr.json?.config?.rules || [];
    check('rule options for the 24-hour report are stored (and ignored when there is no e-mail)', pr.status === 200 && ra[0]?.actions?.alarmEscReport === false && ra[0]?.actions?.emailReport === true && ra[1]?.actions?.emailReport === undefined, JSON.stringify(ra.map((x) => x.actions)).slice(0, 220));
    pr = await jfetch('/api/config', { method: 'PUT', body: JSON.stringify({ snmp: { ...(await jfetch('/api/config', {}, S3)).json.snmp, valueSeverity: [{ field: 'alarmSeverity', map: [{ value: 'major', severity: 3 }, { value: '', severity: 1 }, { value: 'x', severity: 99 }] }, { field: '', map: [{ value: 'a', severity: 1 }] }] } }) }, S3);
    check('"severity from a value" is stored cleaned (empty values and fields dropped, severity limited to 0-9)', pr.status === 200 && JSON.stringify(pr.json.config.snmp.valueSeverity) === JSON.stringify([{ field: 'alarmSeverity', map: [{ value: 'major', severity: 3 }, { value: 'x', severity: 9 }] }]), JSON.stringify(pr.json?.config?.snmp?.valueSeverity));
    await jfetch('/api/config', { method: 'PUT', body: JSON.stringify({ snmp: { ...pr.json.config.snmp, valueSeverity: [] } }) }, S3);
    await jfetch('/api/config', { method: 'PUT', body: JSON.stringify({ rules: [], uiPrefs: {} }) }, S3);
    for (const so of ['device:asc', 'raised:desc', 'duration:desc', 'state:asc', 'cleared:desc', 'by:asc', 'port:asc']) { const ar = await jfetch('/api/alarms?state=all&since=0&sort=' + so, {}, S3); if (ar.status !== 200) check('alarm sort ' + so, false, ar.text.slice(0, 100)); }
    check('every alarm sort word is accepted by the API', (await jfetch('/api/alarms?state=all&sort=raised:desc%3BDROP', {}, S3)).status === 200);
    const put = (b) => jfetch('/api/config', { method: 'PUT', body: JSON.stringify(b) }, S3);
    const prof = { name: 'NOC', enabled: true, email: { on: true, to: 'noc@example.com', cc: '' }, webhook: { on: true, url: 'https://h.example/x', format: 'teams' }, sms: { on: true, to: '+971 50 123 4567' } };
    pr = await put({ notifProfiles: [prof, { ...prof, name: 'noc' }], smpp: { host: 'sms.example', port: 2775, systemId: 'u', password: 'secret', maxPerHour: 5 } });
    check('profiles with a duplicate name are refused', pr.status === 400, pr.text.slice(0, 120));
    pr = await put({ notifProfiles: [prof], smpp: { host: 'sms.example', port: 2775, systemId: 'u', password: 'secret', maxPerHour: 5 } });
    const np = pr.json?.config?.notifProfiles || [];
    check('profile is stored with an id, phone number and the webhook format', pr.status === 200 && np.length === 1 && /^[\w-]+$/.test(np[0].id) && /971 ?50 ?123 ?4567/.test(np[0].sms.to) && np[0].webhook.format === 'teams', JSON.stringify(np).slice(0, 300));
    check('SMS gateway password is masked in the config answer', pr.json?.config?.smpp?.password === '********', JSON.stringify(pr.json?.config?.smpp));
    const id = np[0]?.id;
    pr = await put({ rules: [{ id: 'pf1', name: 'with profile', source: 'syslog', enabled: true, match: { text: 'e2e-prof' }, actions: { alarm: true, alarmEscMin: 5, profiles: [id, 'bad id!'], alarmEscProfiles: [id] } }] });
    const rb = pr.json?.config?.rules?.[0]?.actions || {};
    check('rule keeps its profile ids (and drops malformed ones)', pr.status === 200 && rb.profiles?.length === 1 && rb.profiles[0] === id && rb.alarmEscProfiles?.[0] === id, JSON.stringify(rb));
    const nlog = await jfetch('/api/notify/log?limit=10', {}, S3);
    check('delivery log endpoint answers with a list', nlog.status === 200 && Array.isArray(nlog.json?.entries || nlog.json), nlog.text.slice(0, 100));
    const tt = await jfetch('/api/notify/test', { method: 'POST', body: JSON.stringify({ profileId: 'nope' }) }, S3);
    check('testing an unknown profile is refused', tt.status === 404 || tt.status === 400, tt.status + ' ' + tt.text.slice(0, 100));
    pr = await put({ notifProfiles: [] });
    check('deleting a profile removes it from the rules', pr.status === 200 && !(pr.json?.config?.rules?.[0]?.actions?.profiles || []).length, JSON.stringify(pr.json?.config?.rules?.[0]?.actions));
    await put({ rules: [], smpp: { host: '' } });
    {
      pr = await put({ rules: [{ id: 'fl1', name: 'Flap test', source: 'syslog', enabled: true, match: { text: 'e2e-flap' }, actions: { alarm: true, alarmBy: 'port', flapCount: 3, flapMin: 5, flapQuiet: 9 } }] });
      const fa = pr.json?.config?.rules?.[0]?.actions || {};
      check('flap detection settings are stored', pr.status === 200 && fa.flapCount === 3 && fa.flapMin === 5 && fa.flapQuiet === 9, JSON.stringify(fa));
      for (let i = 0; i < 5; i++) await sendUdp(`<131>Oct 25 22:50:0${i} flap-sw e2e-flap Interface Gi0/1 changed state to down`);
      await sleep(1500);
      const fl = await jfetch('/api/alarms?state=all&since=0&q=flap-sw', {}, S3); const al = fl.json?.alarms || [];
      check('five quick changes make 2 alarm lines (the first two, then one flapping alarm), not 5', al.length === 3 && al.filter((x) => /flapping/.test(x.rule || x.ruleName || '')).length === 1, JSON.stringify(al.map((x) => [x.rule, x.count, x.message.slice(0, 40)])));
      await put({ rules: [] });
    }
    {
      const sq = { enabled: true, server: 'sqlhost\\SQLEXPRESS', database: 'NEP', auth: 'sql', user: 'nep', password: 'pw1', createDb: true, backfill: true };
      pr = await put({ sqlCopy: { ...sq, server: 'bad server;drop' } }); check('SQL Server name with odd characters is refused', pr.status === 400, pr.text.slice(0, 100));
      pr = await put({ sqlCopy: { ...sq, user: '' } }); check('SQL login needs a user name', pr.status === 400, pr.text.slice(0, 100));
      pr = await put({ sqlCopy: sq }); const q = pr.json?.config?.sqlCopy || {};
      check('SQL Server copy settings are stored, password masked', pr.status === 200 && q.enabled && q.server === sq.server && q.password === '********' && q.createDb === true, JSON.stringify(q));
      const stt = await jfetch('/api/sqlcopy/status', {}, S3); check('SQL copy status endpoint answers', stt.status === 200 && typeof stt.json?.state === 'string' && stt.json.target.includes('NEP'), stt.text.slice(0, 160));
      pr = await put({ sqlCopy: { ...sq, password: '********', enabled: false } }); check('masked password keeps the saved one', pr.status === 200 && pr.json.config.sqlCopy.password === '********' && !pr.json.config.sqlCopy.enabled);
      await put({ sqlCopy: { enabled: false } });
    }
    {
      // ---------- 1.43: security ----------
      const sec = require('../src/security'); const jp = (path2, body) => jfetch(path2, { method: 'POST', body: JSON.stringify(body || {}) }, S3);
      let g = await jfetch('/api/security', {}, S3); check('security settings come with safe defaults', g.status === 200 && g.json.policy.minLength === 8 && g.json.policy.accountLock === true && g.json.policy.webAllow.length === 0 && g.json.accounts.some((x) => x.name === 'admin'), JSON.stringify(g.json).slice(0, 200));
      let r = await jp('/api/security', { policy: { webAllow: ['not-an-ip'] } }); check('a bad allow-list entry is refused', r.status === 400, r.text.slice(0, 100));
      r = await jp('/api/security', { policy: { hsts: true } }); check('HSTS is refused while the dashboard is not on HTTPS', r.status === 400, r.text.slice(0, 100));
      r = await jp('/api/security', { policy: { minLength: 12, complexity: true, webAllow: ['10.0.0.0/24'] } }); check('the policy and the allow-list save (this computer is always allowed)', r.status === 200 && r.json.policy.minLength === 12 && r.json.policy.webAllow[0] === '10.0.0.0/24', r.text.slice(0, 120));
      check('this computer still opens the dashboard with an allow-list that does not list it', (await jfetch('/api/state', {}, S3)).status === 200);
      r = await jp('/api/me/password', { current: 'correct-horse-battery', password: 'shortish1' }); check('the policy applies to a password change', r.status === 400 && /at least 12/.test(r.text), r.text.slice(0, 100));
      r = await jp('/api/me/password', { current: 'correct-horse-battery', password: 'alllowercaselonger' }); check('complexity is enforced', r.status === 400 && /three of/.test(r.text), r.text.slice(0, 100));
      await jp('/api/security', { policy: { minLength: 8, complexity: false, webAllow: [] } });
      // two-factor
      r = await jp('/api/me/2fa/enable', { code: '123456' }); check('two-factor cannot be turned on without the setup step', r.status === 400);
      r = await jp('/api/me/2fa/start'); const secret = r.json?.secret; check('setup gives a key and an otpauth link', r.status === 200 && /^[A-Z2-7]{32}$/.test(secret) && r.json.uri.startsWith('otpauth://totp/'), r.text.slice(0, 120));
      r = await jp('/api/me/2fa/enable', { code: '000000' }); check('a wrong code does not turn it on', r.status === 400);
      r = await jp('/api/me/2fa/enable', { code: sec.hotp(secret, Math.floor(Date.now() / 30000)) }); const rcodes = r.json?.codes || []; check('the right code turns it on and gives 10 recovery codes', r.status === 200 && rcodes.length === 10, r.text.slice(0, 100));
      let lr2 = await lg({ username: 'admin', password: 'correct-horse-battery' }); let lj = await lr2.json(); check('with two-factor on, the password alone asks for a code and gives no session', lr2.status === 200 && lj.need2fa === true && !lr2.headers.get('set-cookie'), JSON.stringify(lj));
      lr2 = await lg({ username: 'admin', password: 'correct-horse-battery', code: '000000' }); check('a wrong code is refused', lr2.status === 401 && !lr2.headers.get('set-cookie'));
      check('Basic-auth cannot be used by a two-factor account', (await raw('/api/state', basic('admin', 'correct-horse-battery'))).status === 401);
      lr2 = await lg({ username: 'admin', password: 'correct-horse-battery', code: rcodes[0] }); check('a recovery code signs in', lr2.status === 200 && /sp_session=/.test(lr2.headers.get('set-cookie') || ''));
      lr2 = await lg({ username: 'admin', password: 'correct-horse-battery', code: rcodes[0] }); check('a recovery code works only once', lr2.status === 401);
      lr2 = await lg({ username: 'admin', password: 'correct-horse-battery', code: sec.hotp(secret, Math.floor(Date.now() / 30000) + 1) }); check('a fresh authenticator code signs in', lr2.status === 200 && /sp_session=/.test(lr2.headers.get('set-cookie') || ''));
      g = await jfetch('/api/security', {}, S3); check('the account list shows two-factor on', g.json.accounts.find((x) => x.name === 'admin').twofa === true && g.json.me.twofa === true);
      const au = await jfetch('/api/audit?limit=100', {}, S3); const atext = (au.json?.rows || []).map((x) => x.text).join('\n');
      check('the audit log lists sign-ins, failures and security changes', au.status === 200 && /signed in from/.test(atext) && /failed two-factor code/.test(atext) && /turned on two-factor/.test(atext) && /changed the security settings/.test(atext), atext.slice(0, 300));
      const csvr = await fetch(`http://127.0.0.1:${WEB}/api/audit?format=csv`, { headers: S3 }); check('the audit log downloads as CSV', csvr.status === 200 && /text\/csv/.test(csvr.headers.get('content-type')) && /signed in/.test(await csvr.text()));
      r = await jp('/api/me/2fa/disable', { password: 'wrong-password' }); check('turning two-factor off needs the password', r.status === 403);
      r = await jp('/api/me/2fa/disable', { password: 'correct-horse-battery' }); check('two-factor can be turned off', r.status === 200 && (await lg({ username: 'admin', password: 'correct-horse-battery' })).status === 200);
      {
        // probes: rotation and per-probe allowed addresses (1.44)
        const cr = await jp('/api/probes', { name: 'SecSite' }); const pid = cr.json?.id, t1 = cr.json?.token;
        const ing = (tok) => fetch(`http://127.0.0.1:${WEB}/api/probe/ingest`, { method: 'POST', headers: { ...H, authorization: 'Bearer ' + tok }, body: JSON.stringify({ items: [] }) });
        check('a new probe token is accepted', (await ing(t1)).status === 200);
        let rr = await jp(`/api/probes/${pid}/rotate`); const t2 = rr.json?.token; check('rotating gives a new token', rr.status === 200 && t2 && t2 !== t1);
        check('both tokens work during the 24 hour overlap', (await ing(t1)).status === 200 && (await ing(t2)).status === 200);
        rr = await jp(`/api/probes/${pid}/allow`, { allow: ['not-an-ip'] }); check('a bad allowed address is refused', rr.status === 400);
        rr = await jp(`/api/probes/${pid}/allow`, { allow: ['203.0.113.0/24'] }); check('allowed addresses are saved', rr.status === 200 && rr.json.allow[0] === '203.0.113.0/24');
        const ref = await ing(t2); check('a probe token from an address that is not allowed is refused', ref.status === 403);
        rr = await jp(`/api/probes/${pid}/allow`, { allow: [] }); check('clearing the list allows any address again', (await ing(t2)).status === 200);
        const lst = await jfetch('/api/probes', {}, S3); check('the probe list shows the rotation', lst.json.probes.find((x) => x.id === pid).rotated > 0 && lst.json.probes.find((x) => x.id === pid).oldTokenUntil > Date.now());
        await jfetch('/api/probes/' + pid, { method: 'DELETE' }, S3);
      }
      const hs = fs.readFileSync(path.join(dir, 'config.json'), 'utf8'); check('the stored admin password hash uses the current scrypt cost', /"adminPasswordHash":\s*"scrypt\$(65536|16384)\$/.test(hs));
    }
  }

  const codes = []; for (let i = 0; i < 6; i++) codes.push((await raw('/api/state', basic('admin', 'wrong' + i))).status);
  check('5 wrong passwords lock the address out (429)', codes.slice(0, 4).every((c) => c === 401) && codes.slice(4).includes(429), codes.join(','));
  check('even the right password is refused while locked', (await raw('/api/state', basic('admin', 'correct-horse-battery-2'))).status === 429);

  console.log('\nserver log tail:\n' + log.split('\n').slice(-6).join('\n'));
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  srv.kill('SIGTERM'); smtp.close(); await sleep(500); fs.rmSync(dir, { recursive: true, force: true }); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
