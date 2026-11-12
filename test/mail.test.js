'use strict';
// E-mail look and structure: the HTML escalation mail, the plain-text twin, and the MIME layout with an attached report.
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { renderHtml, renderText, stamp } = require('../src/mailtpl');
const { sendMail, AlertMailer, buildAlert } = require('../src/mailer');

const esc = { kind: 'escalation', title: 'Alarm not acknowledged', subtitle: 'Nobody acknowledged this alarm within 15 minutes.', severity: 2, severityName: 'critical', host: 'cm-dxb-1', srcIp: '10.203.242.22', rule: 'DNWP Connection Master: port and card alarms', port: '5/8e1',
  state: 'Open, not acknowledged', message: 'ET1-LOS: Loss Of Signal <script>alert(1)</script>', source: 'syslog', first: Date.now() - 20 * 60000, last: Date.now() - 60000, count: 4, notes: [{ ts: Date.now(), by: 'rijosh', text: 'engineer on the way' }],
  others: [{ severity: 3, rule: 'SFP alarm', port: '3/1sdhsfp', since: Date.now() - 3600000 }], sum: { raised: 12, cleared: 9, open: 3, escalated: 1, topDevices: [['cm-dxb-1', 7]], topRules: [['DNWP port alarms', 8]] }, link: 'http://noc-pc:8514/#alarms', attached: 'neteventpro-last-24-hours-20261101-1116.pdf' };

test('the escalation e-mail shows every detail, escapes the message and names the attachment', () => {
  const h = renderHtml(esc), t = renderText(esc);
  for (const need of ['cm-dxb-1', '10.203.242.22', '5/8e1', 'Critical', 'DNWP Connection Master', 'engineer on the way', 'SFP alarm', 'cm-dxb-1', 'Open the alarm in NetEventPro', 'last 24 hours at a glance', 'neteventpro-last-24-hours-20261101-1116.pdf']) assert.ok(h.includes(need), 'html lacks ' + need);
  assert.ok(!h.includes('<script>'), 'the message must be escaped'); assert.ok(h.includes('&lt;script&gt;'));
  for (const need of ['ALARM NOT ACKNOWLEDGED', 'cm-dxb-1 (10.203.242.22)', '5/8e1', 'Last 24 hours:', 'raised 12, cleared 9', 'Attached: neteventpro-last-24-hours']) assert.ok(t.includes(need), 'text lacks ' + need);
});
test('times are shown with seconds, in the chosen time zone', () => {
  const ts = Date.UTC(2026, 10, 1, 7, 16, 7);
  assert.strictEqual(stamp(ts, 'Asia/Dubai'), '2026-11-01 11:16:07'); assert.strictEqual(stamp(ts, 'UTC'), '2026-11-01 07:16:07'); assert.match(stamp(ts, 'Not/AZone'), /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
});
test('a normal alert mail has the same look', () => {
  const m = buildAlert({ rule: { name: 'Critical and above' }, suppressed: 2 }, { ts: Date.now(), host: 'sw1', srcIp: '10.0.0.1', severity: 2, severityName: 'critical', facilityName: 'local7', app: 'sshd', pid: '12', message: 'disk failure' }, 'ops@example.com', {});
  const h = renderHtml(m.o), t = renderText(m.o);
  assert.ok(/Critical on sw1/.test(h) && h.includes('sshd[12]') && h.includes('2 similar alert(s)')); assert.ok(t.includes('Facility:') && t.includes('disk failure')); assert.match(m.subject, /^\[NetEventPro\] CRITICAL on sw1/);
});

// a tiny SMTP server that keeps the message, to check the MIME structure
function fakeSmtp() {
  const got = []; const srv = net.createServer((s) => {
    s.write('220 hi\r\n'); let data = false, raw = '', buf = '';
    s.on('data', (d) => { buf += d.toString('latin1'); let i; while ((i = buf.indexOf('\r\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (data) { if (line === '.') { data = false; got.push(raw); raw = ''; s.write('250 ok\r\n'); } else raw += line + '\n'; continue; }
      if (/^EHLO/i.test(line)) s.write('250 hi\r\n'); else if (/^DATA/i.test(line)) { data = true; s.write('354 go\r\n'); } else if (/^QUIT/i.test(line)) { s.write('221 bye\r\n'); s.end(); } else s.write('250 ok\r\n'); } });
    s.on('error', () => {});
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, got, port: srv.address().port })));
}
const part = (raw, type) => { const m = new RegExp(`Content-Type: ${type}[^\\n]*\\n(?:[A-Za-z-]+:[^\\n]*\\n)*\\n([A-Za-z0-9+/=\\n]+)`).exec(raw); return m ? Buffer.from(m[1].replace(/\n/g, ''), 'base64').toString('utf8') : null; };

test('HTML mail with a PDF: text, HTML and the attachment arrive in the right MIME layers', async () => {
  const { srv, got, port } = await fakeSmtp();
  try {
    const pdf = Buffer.from('%PDF-1.4 fake report', 'latin1');
    await sendMail({ host: '127.0.0.1', port, security: 'none', from: 'NEP <nep@example.com>' }, { to: 'ops@example.com', subject: 'x', text: renderText(esc), html: renderHtml(esc), attachments: [{ filename: 'report 24h.pdf', contentType: 'application/pdf', data: pdf }] });
    const raw = got[0]; assert.match(raw, /Content-Type: multipart\/mixed/); assert.match(raw, /Content-Type: multipart\/alternative/); assert.match(raw, /filename="report_24h\.pdf"/);
    assert.ok(part(raw, 'text/plain').includes('cm-dxb-1')); assert.ok(part(raw, 'text/html').includes('<table')); assert.ok(part(raw, 'application/pdf').startsWith('%PDF-1.4'));
    await sendMail({ host: '127.0.0.1', port, security: 'none', from: 'nep@example.com' }, { to: 'ops@example.com', subject: 'y', text: 'plain only' });
    assert.ok(!/multipart/.test(got[1]) && /text\/plain/.test(got[1]));
    await sendMail({ host: '127.0.0.1', port, security: 'none', from: 'nep@example.com' }, { to: 'ops@example.com', subject: 'z', text: 't', html: '<b>h</b>' });
    assert.match(got[2], /^Content-Type: multipart\/alternative/m); assert.ok(!/multipart\/mixed/.test(got[2]));
  } finally { srv.close(); }
});

test('the recovery e-mail is green, says cleared and carries no report', async () => {
  const { srv, got, port } = await fakeSmtp();
  try {
    const cfg = { get: () => ({ smtp: { host: '127.0.0.1', port, security: 'none', from: 'nep@example.com', to: 'ops@example.com', maxPerHour: 30 }, webBind: '0.0.0.0', webPort: 8514 }) };
    const m = new AlertMailer(cfg); m.reportFn = async () => { throw new Error('must not be called'); };
    m.enqueueRecovery({}, { ...esc, kind: 'recovery', title: 'Alarm cleared', subtitle: 'This alarm was escalated and has now cleared after 20 min.', state: 'Cleared', clearedTs: esc.first + 20 * 60000, attached: undefined }); await new Promise((r) => setTimeout(r, 400));
    assert.match(got[0], /Subject: .*CLEARED: CRITICAL on cm-dxb-1/); const html = part(got[0], 'text/html');
    assert.ok(html.includes('Alarm cleared') && html.includes('#2e7d32') && html.includes('Recovery') && html.includes('was open for') && !/attachment/.test(got[0]) && !html.includes('Acknowledge or clear the alarm'));
    assert.ok(part(got[0], 'text/plain').includes('Cleared:'));
  } finally { srv.close(); }
});

test('the escalation mailer attaches the report when asked, and says so when it cannot', async () => {
  const { srv, got, port } = await fakeSmtp();
  try {
    const cfg = { get: () => ({ smtp: { host: '127.0.0.1', port, security: 'none', from: 'nep@example.com', to: 'ops@example.com', maxPerHour: 30 }, webBind: '0.0.0.0', webPort: 8514 }) };
    const m = new AlertMailer(cfg); m.reportFn = async () => [{ name: 'last24h.pdf', type: 'application/pdf', data: Buffer.from('%PDF-x') }];
    m.enqueueEscalation({ report: true }, { ...esc, attached: undefined }); await new Promise((r) => setTimeout(r, 400));
    assert.match(got[0], /filename="last24h\.pdf"/); assert.ok(part(got[0], 'text/html').includes('last24h.pdf'));
    m.enqueueEscalation({ report: false }, { ...esc, attached: undefined }); await new Promise((r) => setTimeout(r, 400));
    assert.ok(!/attachment/.test(got[1]));
    m.reportFn = async () => { throw new Error('disk full'); }; m.enqueueEscalation({ report: true }, { ...esc, attached: undefined }); await new Promise((r) => setTimeout(r, 400));
    assert.ok(!/attachment/.test(got[2]) && part(got[2], 'text/plain').includes('could not be attached: disk full'));
    assert.strictEqual(m.stat.sent, 3);
  } finally { srv.close(); }
});
