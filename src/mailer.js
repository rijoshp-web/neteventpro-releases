'use strict';
// Minimal SMTP client (no dependencies): plain, STARTTLS or implicit TLS; AUTH PLAIN / LOGIN.
const net = require('node:net');
const tls = require('node:tls');
const os = require('node:os');
const crypto = require('node:crypto');
const { renderHtml, renderText } = require('./mailtpl');

const TIMEOUT_MS = 20000;
const ADDR_RE = /^[^\s<>@,;"()[\]\\]+@[^\s<>@,;"()[\]\\]+$/;

const oneLine = (s) => String(s ?? '').replace(/[\r\n\u0000]+/g, ' ').trim();
const addrOf = (s) => { const m = /<([^<>]+)>/.exec(s); return (m ? m[1] : String(s)).trim(); };
const validAddress = (a) => ADDR_RE.test(a) && a.length <= 254;

/** "a@x.com, b@y.com" -> ['a@x.com','b@y.com']; throws on an invalid address (also blocks header injection). */
function parseRecipients(str) {
  const list = String(str || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  if (list.length > 20) throw new Error('At most 20 email recipients are allowed');
  for (const a of list) if (!validAddress(a)) throw new Error(`"${a}" is not a valid email address`);
  return list;
}

function encodeHeader(text) {
  const s = oneLine(text).slice(0, 200);
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const words = []; let cur = '';
  for (const ch of s) { if (Buffer.byteLength(cur + ch) > 36) { words.push(cur); cur = ''; } cur += ch; }
  if (cur) words.push(cur);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join('\r\n ');
}

class Session {
  constructor(sock) { this.buf = ''; this.lines = []; this.waiter = null; this.err = null; this.attach(sock); }
  attach(sock) {
    this.sock = sock; sock.setEncoding('utf8');
    this.onData = (d) => { this.buf += d; let i; while ((i = this.buf.indexOf('\n')) >= 0) { this.lines.push(this.buf.slice(0, i).replace(/\r$/, '')); this.buf = this.buf.slice(i + 1); } this.check(); };
    this.onClose = () => this.fail(new Error('connection closed by the mail server'));
    this.onError = (e) => this.fail(e);
    sock.on('data', this.onData); sock.on('close', this.onClose); sock.on('error', this.onError);
    sock.setTimeout(TIMEOUT_MS, () => this.fail(new Error('the mail server did not answer in time')));
  }
  detach() { const s = this.sock; s.off('data', this.onData); s.off('close', this.onClose); s.off('error', this.onError); s.setTimeout(0); }
  check() {
    if (!this.waiter) return;
    const idx = this.lines.findIndex((l) => /^\d{3}( |$)/.test(l));
    if (idx < 0) return;
    const resp = this.lines.splice(0, idx + 1); const w = this.waiter; this.waiter = null;
    w.resolve({ code: +resp[idx].slice(0, 3), lines: resp });
  }
  fail(e) { this.err = this.err || e; if (this.waiter) { const w = this.waiter; this.waiter = null; w.reject(this.err); } }
  read() { if (this.err) return Promise.reject(this.err); return new Promise((resolve, reject) => { this.waiter = { resolve, reject }; this.check(); }); }
  async expect(codes) {
    const r = await this.read();
    if (!codes.includes(r.code)) throw new Error(`mail server answered: ${r.lines.join(' ').slice(0, 300)}`);
    return r;
  }
  async cmd(line, codes) { if (this.err) throw this.err; this.sock.write(line + '\r\n'); return this.expect(codes); }
}

function openSocket(smtp) {
  return new Promise((resolve, reject) => {
    const host = smtp.host, port = +smtp.port || 587;
    let sock;
    const done = () => { sock.off('error', reject); sock.setTimeout(0); resolve(sock); };
    if (smtp.security === 'tls') {
      sock = tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: !smtp.allowSelfSigned }, done);
    } else sock = net.connect({ host, port }, done);
    sock.once('error', reject);
    sock.setTimeout(TIMEOUT_MS, () => sock.destroy(new Error(`could not connect to ${host}:${port} (timed out)`)));
  });
}

function certHint(e) {
  const m = String(e.message || e);
  return /self.signed|unable to verify|certificate|CERT_/i.test(m) ? `${m} — if the server uses an internal or self-signed certificate, tick "Accept self-signed certificate".` : m;
}

/**
 * smtp: { host, port, security:'none'|'starttls'|'tls', user, password, from, allowSelfSigned }
 * mail: { to: 'a@x.com, b@y.com', subject, text }
 */
async function sendMail(smtp, mail) {
  if (!smtp || !smtp.host) throw new Error('No mail server is configured');
  const from = oneLine(smtp.from), fromAddr = addrOf(from);
  if (!validAddress(fromAddr)) throw new Error('The "From" address is not valid');
  const rcpts0 = parseRecipients(mail.to);
  if (!rcpts0.length) throw new Error('No recipients: set default recipients in Settings or on the rule');
  const ccs = mail.cc ? parseRecipients(mail.cc).filter((a) => !rcpts0.includes(a)) : [];
  const rcpts = [...rcpts0, ...ccs];

  const ehloName = (os.hostname() || 'localhost').replace(/[^A-Za-z0-9.-]/g, '') || 'localhost';
  let sock;
  try { sock = await openSocket(smtp); } catch (e) { throw new Error(certHint(e)); }
  const s = new Session(sock);
  try {
    await s.expect([220]);
    let caps = (await s.cmd(`EHLO ${ehloName}`, [250])).lines;

    if (smtp.security === 'starttls') {
      if (!caps.some((l) => /^250[ -]STARTTLS\b/i.test(l))) throw new Error('the server does not offer STARTTLS — choose "None" or "SSL/TLS" instead');
      await s.cmd('STARTTLS', [220]);
      s.detach();
      const secure = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket: sock, servername: net.isIP(smtp.host) ? undefined : smtp.host, rejectUnauthorized: !smtp.allowSelfSigned }, () => resolve(t));
        t.once('error', reject);
      }).catch((e) => { throw new Error(certHint(e)); });
      sock = secure; s.buf = ''; s.lines = []; s.attach(sock);
      caps = (await s.cmd(`EHLO ${ehloName}`, [250])).lines;
    }

    if (smtp.user) {
      const mech = (caps.map((l) => /^250[ -]AUTH\s+(.*)$/i.exec(l)).filter(Boolean).map((m) => m[1].toUpperCase()).join(' ')).split(/\s+/);
      if (mech.includes('PLAIN')) await s.cmd('AUTH PLAIN ' + Buffer.from(`\u0000${smtp.user}\u0000${smtp.password || ''}`, 'utf8').toString('base64'), [235]);
      else if (mech.includes('LOGIN')) {
        await s.cmd('AUTH LOGIN', [334]);
        await s.cmd(Buffer.from(smtp.user, 'utf8').toString('base64'), [334]);
        await s.cmd(Buffer.from(smtp.password || '', 'utf8').toString('base64'), [235]);
      } else throw new Error('the server does not offer a login method this app supports (PLAIN or LOGIN). Clear the user name if no login is needed.');
    }

    await s.cmd(`MAIL FROM:<${fromAddr}>`, [250]);
    for (const r of rcpts) await s.cmd(`RCPT TO:<${r}>`, [250, 251]);
    await s.cmd('DATA', [354]);

    const wrap = (buf) => buf.toString('base64').replace(/.{1,76}/g, '$&\r\n');
    const textPart = (ct, data) => `Content-Type: ${ct}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(Buffer.from(String(data ?? ''), 'utf8'))}`;
    const files = (mail.attachments || []).slice(0, 5);
    const rnd = () => '=_sp_' + crypto.randomBytes(12).toString('hex');
    // the readable part: plain text, or text plus HTML (the mail program shows the HTML and keeps the text as a fallback)
    let bodyCt, bodyData;
    if (mail.html) { const ba = rnd(); bodyCt = `multipart/alternative; boundary="${ba}"`; bodyData = `--${ba}\r\n${textPart('text/plain', mail.text)}--${ba}\r\n${textPart('text/html', mail.html)}--${ba}--\r\n`; }
    else { bodyCt = 'text/plain; charset=utf-8'; bodyData = wrap(Buffer.from(String(mail.text ?? ''), 'utf8')); }
    let typeHeaders, content;
    if (!files.length) { typeHeaders = [`Content-Type: ${bodyCt}`, ...(mail.html ? [] : ['Content-Transfer-Encoding: base64'])]; content = bodyData; }
    else {
      const bd = rnd(); typeHeaders = [`Content-Type: multipart/mixed; boundary="${bd}"`];
      content = `--${bd}\r\nContent-Type: ${bodyCt}\r\n${mail.html ? '' : 'Content-Transfer-Encoding: base64\r\n'}\r\n${bodyData}` +
        files.map((a) => { const fn = String(a.filename || 'attachment').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100);
          return `--${bd}\r\nContent-Type: ${String(a.contentType || 'application/octet-stream').replace(/[^\w./+-]/g, '')}; name="${fn}"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${fn}"\r\n\r\n${wrap(a.data)}`; }).join('') + `--${bd}--\r\n`;
    }
    const headers = [
      `From: ${encodeHeader(from)}`, `To: ${rcpts0.join(', ')}`, ...(ccs.length ? [`Cc: ${ccs.join(', ')}`] : []), `Subject: ${encodeHeader(mail.subject)}`,
      `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`, `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${ehloName}>`,
      'MIME-Version: 1.0', ...typeHeaders, 'X-Mailer: NetEventPro', 'Auto-Submitted: auto-generated'
    ];
    await s.cmd(headers.join('\r\n') + '\r\n\r\n' + content + '\r\n.', [250]);   // base64 body never has lines starting with "." so no dot-stuffing is needed
    try { sock.write('QUIT\r\n'); } catch { /* ignore */ }
    return { ok: true, recipients: rcpts.length };
  } catch (e) {
    throw new Error(certHint(e));
  } finally {
    try { sock.destroy(); } catch { /* ignore */ }
  }
}

/** one-line description of where the dashboard is, for the "open in NetEventPro" button (only when other PCs can reach it) */
function dashboardLink(cfg, hash = '#alarms') {
  if (!cfg || cfg.webBind === '127.0.0.1' || cfg.webBind === 'localhost') return '';
  const host = cfg.webBind && cfg.webBind !== '0.0.0.0' && cfg.webBind !== '::' ? cfg.webBind : (os.hostname() || '').replace(/[^A-Za-z0-9.-]/g, '');
  return host ? `${cfg.tlsCertFile ? 'https' : 'http'}://${host}:${cfg.webPort || 8514}/${hash}` : '';
}

function buildAlert(info, msg, to, cfg = {}) {
  const sev = String(msg.severityName || '').toUpperCase();
  const one = oneLine(msg.message).slice(0, 90);
  const zone = cfg.ntp?.zone || '';
  const o = { kind: 'alert', title: `${msg.severityName ? msg.severityName[0].toUpperCase() + msg.severityName.slice(1) : 'Alert'} on ${oneLine(msg.host)}`, subtitle: `Rule: ${oneLine(info.rule?.name)}`, severity: msg.severity, host: oneLine(msg.host), srcIp: oneLine(msg.srcIp),
    rule: oneLine(info.rule?.name), source: msg.source, time: msg.ts, facility: msg.facilityName, process: oneLine(msg.app) + (msg.pid ? `[${oneLine(msg.pid)}]` : ''), message: String(msg.message ?? ''), suppressed: info.suppressed || 0, zone, link: dashboardLink(cfg, msg.source === 'snmp' ? '#traps' : '#logs') };
  const lines = [
    `Rule:      ${oneLine(info.rule?.name)}`,
    `Time:      ${new Date(msg.ts).toISOString()}`,
    `Device:    ${oneLine(msg.host)}${msg.srcIp && msg.srcIp !== msg.host ? ` (${oneLine(msg.srcIp)})` : ''}`,
    `Severity:  ${msg.severityName} (${msg.severity})`,
    `Facility:  ${msg.facilityName}`,
    `Process:   ${oneLine(msg.app) || '-'}${msg.pid ? `[${oneLine(msg.pid)}]` : ''}`,
    '', 'Message:', String(msg.message)
  ];
  if (info.suppressed) lines.push('', `(${info.suppressed} similar alert(s) were not emailed since the previous email for this rule.)`);
  lines.push('', '--', 'Sent by NetEventPro');
  return { to, cc: info.cc || '', subject: `[NetEventPro] ${sev} on ${oneLine(msg.host)}: ${one}`, text: lines.join('\r\n'), o };
}

/** Queues alert emails: one connection at a time, hourly cap, and a clear status for the dashboard. */
class AlertMailer {
  constructor(config) {
    this.config = config; this.queue = []; this.busy = false; this.stamps = [];
    this.stat = { sent: 0, failed: 0, skipped: 0, lastError: '', lastSentAt: 0 };
    this.onResult = null;          // (mail, errorOrNull) after every send; (info, reason) through onSkip: the Notifications delivery log listens here
    this.onSkip = null;
    this.reportFn = null;          // async () => [{ name, type, data }]: the last-24-hours report to attach (set by the server)
  }
  status() { return { ...this.stat, queued: this.queue.length }; }
  /** room in the hourly budget and the queue? (records why not) */
  admit(info) {
    const smtp = this.config.get().smtp || {};
    const to = info.noDefault ? info.to : (info.to || smtp.to);
    if (!smtp.host || !smtp.from || !to) { this.stat.skipped++; this.stat.lastError = 'Email is not set up yet (Notifications → E-mail server)'; this.onSkip?.(info, this.stat.lastError); return null; }
    const now = Date.now(); const cap = smtp.maxPerHour || 30;
    this.stamps = this.stamps.filter((t) => now - t < 3600000);
    if (this.stamps.length >= cap) { this.stat.skipped++; this.stat.lastError = `Hourly email limit (${cap}) reached — further alerts are skipped until it resets`; this.onSkip?.(info, this.stat.lastError); return null; }
    if (this.queue.length >= 50) { this.stat.skipped++; this.onSkip?.(info, 'The e-mail queue is full (50 waiting)'); return null; }
    this.stamps.push(now); return { smtp, to };
  }
  /** info: { rule, suppressed, to, cc, report }  (report = attach the last-24-hours report) */
  enqueue(info, msg) {
    const ok = this.admit(info); if (!ok) return;
    const cfg = this.config.get(), m = buildAlert(info, msg, ok.to, cfg);
    this.queue.push({ ...m, cc: info.noDefault ? (info.cc || '') : (info.cc || ok.smtp.cc || ''), report: !!info.report, o: m.o, meta: info.meta });
    this.pump();
  }
  /** the escalation e-mail of one alarm: ctx has what the page and the text need (see mailtpl.js) */
  enqueueEscalation(info, o) {
    const ok = this.admit(info); if (!ok) return;
    const cfg = this.config.get(); o.zone = cfg.ntp?.zone || ''; o.link = dashboardLink(cfg, '#alarms');
    this.queue.push({ to: ok.to, cc: info.noDefault ? (info.cc || '') : (info.cc || ok.smtp.cc || ''), subject: `[NetEventPro] ESCALATION: ${o.severityName.toUpperCase()} on ${oneLine(o.host)}: ${oneLine(o.rule)}${o.port ? ' ' + oneLine(o.port) : ''}`.slice(0, 200), text: '', o: { ...o, kind: 'escalation' }, report: !!info.report, meta: info.meta });
    this.pump();
  }
  /** the recovery e-mail of an escalated alarm that has cleared */
  enqueueRecovery(info, o) {
    const ok = this.admit(info); if (!ok) return;
    const cfg = this.config.get(); o.zone = cfg.ntp?.zone || ''; o.link = dashboardLink(cfg, '#alarms');
    this.queue.push({ to: ok.to, cc: info.noDefault ? (info.cc || '') : (info.cc || ok.smtp.cc || ''), subject: `[NetEventPro] CLEARED: ${o.severityName.toUpperCase()} on ${oneLine(o.host)}: ${oneLine(o.rule)}${o.port ? ' ' + oneLine(o.port) : ''}`.slice(0, 200), text: '', o: { ...o, kind: 'recovery' }, report: false, meta: info.meta });
    this.pump();
  }
  async pump() {
    if (this.busy) return; this.busy = true;
    try {
      while (this.queue.length) {
        const mail = this.queue.shift();
        try {
          if (mail.o) {
            const o = { ...mail.o };
            if (mail.report && this.reportFn) { try { const files = await this.reportFn(); if (files?.length) { mail.attachments = files.map((f) => ({ filename: f.name, contentType: f.type, data: f.data })); o.attached = files[0].name; } } catch (e) { o.attachNote = 'The last-24-hours report could not be attached: ' + oneLine(e.message).slice(0, 160); } }
            mail.html = renderHtml(o); mail.text = renderText(o);
          }
          await sendMail(this.config.get().smtp, mail); this.stat.sent++; this.stat.lastSentAt = Date.now(); this.stat.lastError = ''; this.onResult?.(mail, null);
        }
        catch (e) { this.stat.failed++; this.stat.lastError = e.message; this.onResult?.(mail, e); }
      }
    } finally { this.busy = false; }
  }
  async sendTest(to) {
    const smtp = this.config.get().smtp || {};
    try {
      await sendMail(smtp, { to: to || smtp.to, subject: '[NetEventPro] Test email', text: 'This is a test email from NetEventPro.\r\nIf you can read this, alert emails will reach you.\r\n' });
      this.stat.lastError = ''; return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }
}

module.exports = { sendMail, parseRecipients, validAddress, addrOf, AlertMailer, buildAlert, dashboardLink };
