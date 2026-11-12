'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const tls = require('node:tls');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { Replacer, checkReplacement } = require('../src/replace');
const { SourceFilter } = require('../src/acl');
const { hashPassword, verifyPassword, LoginGuard } = require('../src/auth');
const { RuleEngine } = require('../src/rules');
const { sendMail, parseRecipients } = require('../src/mailer');

// ---------------------------------------------------------------- text replacement
const apply = (rules, msg) => { const r = new Replacer(); r.load(rules); const m = { host: '', app: '', message: '', ...msg }; r.apply(m); return m; };

test('replacement: IPv4 address becomes a name, but never inside a longer address', () => {
  const rule = [{ find: '10.0.0.1', replace: 'Core-SW1' }];
  assert.equal(apply(rule, { message: 'link to 10.0.0.1 is down' }).message, 'link to Core-SW1 is down');
  assert.equal(apply(rule, { message: 'peer 10.0.0.1:179 reset, 10.0.0.1.' }).message, 'peer Core-SW1:179 reset, Core-SW1.');
  for (const s of ['10.0.0.15', '110.0.0.1', '10.0.0.1.5', 'x10.0.0.1']) assert.equal(apply(rule, { message: s }).message, s === 'x10.0.0.1' ? 'xCore-SW1' : s, s);
});

test('replacement: scope, case and literal $ in replacement', () => {
  assert.equal(apply([{ find: 'srv', replace: 'Server', scope: 'host' }], { host: 'SRV', message: 'srv up' }).host, 'Server');
  assert.equal(apply([{ find: 'srv', replace: 'Server', scope: 'host' }], { host: 'SRV', message: 'srv up' }).message, 'srv up');
  assert.equal(apply([{ find: 'srv', replace: 'S', matchCase: true }], { message: 'SRV srv' }).message, 'SRV S');
  assert.equal(apply([{ find: 'cost', replace: '$& $1' }], { message: 'cost' }).message, '$& $1');
  assert.equal(apply([{ find: 'a', replace: 'b', scope: 'all' }], { host: 'a', app: 'a', message: 'a' }).app, 'b');
});

test('replacement: regex with capture groups, disabled and invalid rules', () => {
  assert.equal(apply([{ find: 'Gi0/(\\d+)', replace: 'Uplink-$1', regex: true }], { message: 'Gi0/24 down' }).message, 'Uplink-24 down');
  assert.equal(apply([{ find: 'x', replace: 'y', enabled: false }], { message: 'x' }).message, 'x');
  assert.ok(checkReplacement({ find: '(a+)+$', replace: '', regex: true }));
  assert.ok(checkReplacement({ find: '(', replace: '', regex: true }));
  assert.ok(checkReplacement({ find: '', replace: '' }));
  assert.equal(checkReplacement({ find: 'ok', replace: 'fine' }), null);
});

// ---------------------------------------------------------------- allowed sources
test('allowed sources: exact, CIDR and empty list', () => {
  const f = new SourceFilter();
  assert.equal(f.allows('1.2.3.4'), true);
  f.load(['10.1.0.0/16', '192.168.1.5', '::1']);
  assert.equal(f.allows('10.1.200.3'), true); assert.equal(f.allows('10.2.0.1'), false);
  assert.equal(f.allows('192.168.1.5'), true); assert.equal(f.allows('192.168.1.6'), false);
  assert.equal(f.allows('::1'), true); assert.equal(f.allows('::2'), false);
  f.load(['0.0.0.0/0']); assert.equal(f.allows('8.8.8.8'), true);
  assert.deepEqual(SourceFilter.validate(['10.0.0.0/33', 'banana', '10.0.0.1', '300.1.1.1']), ['10.0.0.0/33', 'banana', '300.1.1.1']);
});

// ---------------------------------------------------------------- passwords
test('password hashing and login lockout', async () => {
  const h = await hashPassword('correct horse');
  assert.match(h, /^scrypt\$/); assert.ok(!h.includes('correct'));
  assert.equal(await verifyPassword('correct horse', h), true);
  assert.equal(await verifyPassword('wrong', h), false);
  assert.equal(await verifyPassword('x', 'not-a-hash'), false);
  const g = new LoginGuard({ maxFails: 3, lockMs: 1000 });
  g.fail('1.1.1.1'); g.fail('1.1.1.1'); assert.equal(g.locked('1.1.1.1'), false);
  g.fail('1.1.1.1'); assert.equal(g.locked('1.1.1.1'), true); assert.equal(g.locked('2.2.2.2'), false);
  g.success('1.1.1.1'); assert.equal(g.locked('1.1.1.1'), false);
});

// ---------------------------------------------------------------- rules: email action
test('rules: email action shares one cooldown and counts suppressed alerts', () => {
  const re = new RuleEngine();
  re.load([{ id: 'r1', name: 'mail me', enabled: true, match: { severityMax: 3 }, actions: { email: true, emailTo: 'a@b.co', cooldownSec: 600 } }]);
  const m = () => ({ severity: 2, facility: 1, host: 'h', srcIp: '1.1.1.1', app: '', message: 'x', tags: [] });
  assert.equal(re.apply(m()).emails.length, 1);
  assert.equal(re.apply(m()).emails.length, 0); assert.equal(re.apply(m()).emails.length, 0);
  re.lastFired.set('r1', Date.now() - 601000);
  const again = re.apply(m()).emails;
  assert.equal(again.length, 1); assert.equal(again[0].suppressed, 2); assert.equal(again[0].to, 'a@b.co');
});

// ---------------------------------------------------------------- SMTP client against a fake server
function makeCert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-cert-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=localhost'], { stdio: 'ignore' });
    return { key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) };
  } catch { return null; }
}
const CERT = makeCert();

function fakeSmtp({ mode = 'none', auth = null, mechs = 'PLAIN LOGIN' } = {}) {
  const mails = []; const log = [];
  function attach(sock, secure, greet = !secure) {
    let buf = '', inData = false, mail = { rcpts: [], data: '' }, authed = !auth, loginStep = 0, loginUser = '';
    const w = (s) => sock.write(s + '\r\n');
    sock.setEncoding('utf8');
    sock.on('error', () => {});
    sock.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\r\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2); on(line); } });
    function on(line) {
      log.push(line);
      if (inData) { if (line === '.') { inData = false; mails.push(mail); mail = { rcpts: [], data: '' }; w('250 queued'); } else mail.data += line + '\r\n'; return; }
      if (loginStep === 1) { loginUser = Buffer.from(line, 'base64').toString(); loginStep = 2; return w('334 UGFzc3dvcmQ6'); }
      if (loginStep === 2) { loginStep = 0; authed = auth && loginUser === auth.user && Buffer.from(line, 'base64').toString() === auth.pass; return authed ? w('235 ok') : w('535 bad credentials'); }
      const up = line.toUpperCase();
      if (up.startsWith('EHLO')) {
        const caps = ['250-localhost'];
        if (mode === 'starttls' && !secure) caps.push('250-STARTTLS');
        if (auth && (secure || mode === 'none')) caps.push(`250-AUTH ${mechs}`);
        caps.push('250 8BITMIME'); return caps.forEach(w);
      }
      if (up === 'STARTTLS') {
        w('220 ready'); sock.removeAllListeners('data');
        const t = new tls.TLSSocket(sock, { isServer: true, key: CERT.key, cert: CERT.cert }); attach(t, true); return;
      }
      if (up.startsWith('AUTH PLAIN')) {
        const [, u, p] = Buffer.from(line.slice(11), 'base64').toString().split('\u0000');
        authed = auth && u === auth.user && p === auth.pass; return authed ? w('235 ok') : w('535 bad credentials');
      }
      if (up === 'AUTH LOGIN') { loginStep = 1; return w('334 VXNlcm5hbWU6'); }
      if (up.startsWith('MAIL FROM:')) { if (!authed) return w('530 authentication required'); mail.from = line.slice(10); return w('250 ok'); }
      if (up.startsWith('RCPT TO:')) { mail.rcpts.push(line.slice(8)); return w('250 ok'); }
      if (up === 'DATA') { inData = true; return w('354 go'); }
      if (up === 'QUIT') { w('221 bye'); return sock.end(); }
      w('500 what');
    }
    if (greet) w('220 fake ESMTP');
  }
  const server = mode === 'implicit' ? tls.createServer({ key: CERT.key, cert: CERT.cert }, (s) => { attach(s, true, true); }) : net.createServer((s) => attach(s, false));
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, mails, log, close: () => server.close() })));
}
const decodeBody = (data) => Buffer.from(data.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
const base = (port, extra = {}) => ({ host: '127.0.0.1', port, security: 'none', user: '', password: '', from: 'NetEventPro <alerts@example.com>', ...extra });

test('smtp: plain delivery, headers and body', async () => {
  const s = await fakeSmtp();
  try {
    await sendMail(base(s.port), { to: 'a@x.com, b@y.com', subject: 'Hello', text: 'Line one\r\n.starts with dot' });
    const m = s.mails[0];
    assert.deepEqual(m.rcpts, ['<a@x.com>', '<b@y.com>']); assert.equal(m.from, '<alerts@example.com>');
    assert.match(m.data, /^From: NetEventPro <alerts@example\.com>\r\n/); assert.match(m.data, /\r\nSubject: Hello\r\n/); assert.match(m.data, /Content-Transfer-Encoding: base64/);
    assert.equal(decodeBody(m.data), 'Line one\r\n.starts with dot');
  } finally { s.close(); }
});

test('smtp: AUTH PLAIN, AUTH LOGIN, wrong password', async () => {
  const s = await fakeSmtp({ auth: { user: 'bob', pass: 'pw!' } });
  try {
    await sendMail(base(s.port, { user: 'bob', password: 'pw!' }), { to: 'a@x.com', subject: 's', text: 't' });
    await assert.rejects(sendMail(base(s.port, { user: 'bob', password: 'nope' }), { to: 'a@x.com', subject: 's', text: 't' }), /535/);
    assert.equal(s.mails.length, 1);
  } finally { s.close(); }
  const l = await fakeSmtp({ auth: { user: 'bob', pass: 'pw!' }, mechs: 'LOGIN' });
  try { await sendMail(base(l.port, { user: 'bob', password: 'pw!' }), { to: 'a@x.com', subject: 's', text: 't' }); assert.equal(l.mails.length, 1); } finally { l.close(); }
});

test('smtp: STARTTLS and implicit TLS, certificate checked unless self-signed is accepted', { skip: !CERT && 'openssl not available' }, async () => {
  const st = await fakeSmtp({ mode: 'starttls', auth: { user: 'u', pass: 'p' } });
  try {
    await assert.rejects(sendMail(base(st.port, { security: 'starttls', user: 'u', password: 'p' }), { to: 'a@x.com', subject: 's', text: 't' }), /self.signed|certificate/i);
    await sendMail(base(st.port, { security: 'starttls', user: 'u', password: 'p', allowSelfSigned: true }), { to: 'a@x.com', subject: 's', text: 'secret body' });
    assert.equal(decodeBody(st.mails[0].data), 'secret body');
    const i = st.log.findIndex((l) => /^STARTTLS/i.test(l)), a = st.log.findIndex((l) => /^AUTH/i.test(l));
    assert.ok(i >= 0 && a > i, 'credentials are only sent after the connection is encrypted');
  } finally { st.close(); }
  const im = await fakeSmtp({ mode: 'implicit' });
  try { await sendMail(base(im.port, { security: 'tls', allowSelfSigned: true }), { to: 'a@x.com', subject: 's', text: 't' }); assert.equal(im.mails.length, 1); } finally { im.close(); }
});

test('smtp: STARTTLS required but not offered; unreachable server; bad addresses', async () => {
  const s = await fakeSmtp();
  try { await assert.rejects(sendMail(base(s.port, { security: 'starttls' }), { to: 'a@x.com', subject: 's', text: 't' }), /STARTTLS/); } finally { s.close(); }
  await assert.rejects(sendMail(base(1), { to: 'a@x.com', subject: 's', text: 't' }), /ECONNREFUSED|connect/i);
  await assert.rejects(sendMail(base(25, { from: 'not an address' }), { to: 'a@x.com', subject: 's', text: 't' }), /From/);
  assert.throws(() => parseRecipients('a@x.com, evil@x.com\r\nBcc: z@z.com'), /not a valid/);
  assert.throws(() => parseRecipients('nobody'), /not a valid/);
});

test('smtp: header injection through the subject is neutralised; non-ASCII subject is encoded', async () => {
  const s = await fakeSmtp();
  try {
    await sendMail(base(s.port), { to: 'a@x.com', subject: 'Hi\r\nBcc: attacker@evil.com\r\n\r\ninjected body', text: 't' });
    const head = s.mails[0].data.split('\r\n\r\n')[0];
    assert.ok(!/^Bcc:/mi.test(head), 'no injected header'); assert.match(head, /^Subject: Hi Bcc: attacker@evil\.com injected body$/m);
    await sendMail(base(s.port), { to: 'a@x.com', subject: 'Prüfung ✓ Gerät ausgefallen', text: 't' });
    assert.match(s.mails[1].data.split('\r\n\r\n')[0], /Subject: =\?UTF-8\?B\?/);
  } finally { s.close(); }
});
