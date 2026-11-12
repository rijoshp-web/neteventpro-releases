'use strict';
// Notification profiles (like PRTG): a profile only says HOW and TO WHOM to send (e-mail addresses, a webhook address, SMS numbers).
// What is sent (the text, the severity, the cooldown) comes from the rule that fires. Rules pick one or more profiles.
const fs = require('node:fs');
const path = require('node:path');
const { sendSms, cleanNumber } = require('./smpp');

const SEV_NAMES = ['emergency', 'alert', 'critical', 'error', 'warning', 'notice', 'info', 'debug'];
const one = (s) => String(s ?? '').replace(/[\r\n\u0000]+/g, ' ').trim();
const MAX_LOG = 300;

class Notifier {
  /** config: Config; mail: AlertMailer */
  constructor(config, mail) {
    this.config = config; this.mail = mail; this.log = []; this.smsStamps = [];
    this.file = path.join(config.dir || '.', 'notify-log.jsonl');
    try { this.log = fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).slice(-MAX_LOG).map((l) => JSON.parse(l)); } catch { /* none yet */ }
    this.writes = 0;
    if (mail) {
      mail.onResult = (m, err) => { if (m.meta) this.record({ ...m.meta, ok: !err, error: err ? err.message : '' }); };
      mail.onSkip = (info, why) => { if (info.meta) this.record({ ...info.meta, ok: false, error: why }); };
    }
  }

  profiles(ids) {
    const all = this.config.get().notifProfiles || [], want = new Set((Array.isArray(ids) ? ids : []).map(String));
    return all.filter((p) => want.has(p.id) && p.enabled !== false);
  }
  /** does any of these profiles e-mail or text? (the rule's default cooldown is longer then) */
  noisy(ids) { return this.profiles(ids).some((p) => p.email?.on || p.sms?.on); }

  record(e) {
    const row = { ts: Date.now(), ...e }; this.log.push(row); if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
    try {
      fs.appendFileSync(this.file, JSON.stringify(row) + '\n');
      if (++this.writes % 100 === 0) fs.writeFileSync(this.file, this.log.map((x) => JSON.stringify(x)).join('\n') + '\n');
    } catch { /* the log is a convenience; never stop an alert for it */ }
  }
  entries(limit = 200) { return this.log.slice(-Math.min(1000, Math.max(1, +limit || 200))).reverse(); }

  // ---- what each kind of alert looks like in text ----
  /** ctx for kind 'alert': { rule, suppressed, msg }; for 'escalation' / 'recovery': { o } (the same facts the e-mail page shows) */
  facts(kind, ctx) {
    if (kind === 'alert') {
      const m = ctx.msg, sev = String(m.severityName || SEV_NAMES[m.severity] || '');
      return { kind, severity: m.severity, sevName: sev, host: one(m.host), srcIp: one(m.srcIp), rule: one(ctx.rule?.name), port: '', message: String(m.message ?? ''), app: one(m.app), facility: one(m.facilityName), source: m.source || 'syslog', time: m.ts || Date.now(), suppressed: ctx.suppressed || 0,
        head: `[${sev.toUpperCase()}] ${one(m.host)} ${m.app ? one(m.app) + ': ' : ''}${one(m.message)}` + (ctx.suppressed ? `\n(+${ctx.suppressed} similar alerts suppressed in the last cooldown window)` : ''), sms: `${sev.toUpperCase()} ${one(m.host)}: ${one(m.message)}` };
    }
    const o = ctx.o, sev = String(o.severityName || SEV_NAMES[o.severity] || ''), esc = kind === 'escalation';
    const tag = esc ? 'ESCALATION' : 'CLEARED', what = `${one(o.rule)}${o.port ? ' ' + one(o.port) : ''}`;
    return { kind, severity: o.severity, sevName: sev, host: one(o.host), srcIp: one(o.srcIp), rule: one(o.rule), port: one(o.port), message: String(o.message ?? ''), app: '', facility: '', source: o.source || 'syslog', time: Date.now(), suppressed: 0,
      head: `[${tag}] ${sev.toUpperCase()} on ${one(o.host)}: ${what}${esc ? ` (not acknowledged for ${o.escMin} min)` : ''}\n${one(o.message)}`, sms: `${tag} ${sev.toUpperCase()} ${one(o.host)}: ${what}` };
  }

  /** the JSON that is posted for a webhook. generic = the format used since 1.0; slack = {text}; teams = generic + an Adaptive Card (a Teams Workflows flow can post it as it is) */
  webhookBody(format, f) {
    const generic = { text: f.head, rule: f.rule, suppressed: f.suppressed, kind: f.kind,
      message: { time: new Date(f.time).toISOString(), host: f.host, srcIp: f.srcIp, severity: f.sevName, facility: f.facility, app: f.app, text: f.message } };
    if (format === 'slack') return { text: f.head };
    if (format !== 'teams') return generic;
    const colour = f.kind === 'recovery' ? 'Good' : f.severity <= 3 ? 'Attention' : f.severity === 4 ? 'Warning' : 'Accent';
    const title = f.kind === 'recovery' ? `Cleared: ${f.host}` : f.kind === 'escalation' ? `Escalation: ${f.sevName} on ${f.host}` : `${f.sevName[0]?.toUpperCase() || ''}${f.sevName.slice(1)} on ${f.host}`;
    const facts = [['Device', f.host + (f.srcIp && f.srcIp !== f.host ? ` (${f.srcIp})` : '')], ['Severity', f.sevName], ['Rule', f.rule + (f.port ? ' ' + f.port : '')], ['Time', new Date(f.time).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'], ['Source', f.source === 'snmp' ? 'SNMP trap' : 'Syslog']];
    return { ...generic, type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4',
      body: [{ type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', color: colour, wrap: true }, { type: 'FactSet', facts: facts.map(([title2, value]) => ({ title: title2, value: value || '-' })) }, { type: 'TextBlock', text: f.message.slice(0, 1500), wrap: true }] } }] };
  }

  async postWebhook(url, format, f) {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctrl.signal, redirect: 'error', body: JSON.stringify(this.webhookBody(format, f)) });
      if (!r.ok) throw new Error(`the web address answered ${r.status}`);
    } finally { clearTimeout(to); }
  }

  smsRoom() {
    const cap = this.config.get().smpp?.maxPerHour || 30, now = Date.now(); this.smsStamps = this.smsStamps.filter((t) => now - t < 3600000);
    if (this.smsStamps.length >= cap) return false; this.smsStamps.push(now); return true;
  }
  async textTo(p, f, meta) {
    const smpp = this.config.get().smpp || {}, numbers = String(p.sms.to || '').split(/[,;\s]+/).map(cleanNumber).filter(Boolean);
    if (!numbers.length) return this.record({ ...meta, channel: 'sms', ok: false, error: 'No valid phone numbers in this profile' });
    if (!this.smsRoom()) return this.record({ ...meta, channel: 'sms', to: numbers.join(', '), ok: false, error: `Hourly SMS limit (${smpp.maxPerHour || 30}) reached; the text was skipped` });
    try {
      const r = await sendSms(smpp, numbers, f.sms);
      this.record({ ...meta, channel: 'sms', to: numbers.join(', '), ok: !r.failed.length && r.sent > 0, error: r.failed.map((x) => `${x.to}: ${x.error}`).join('; '), detail: `${r.sent} sent` });
    } catch (e) { this.record({ ...meta, channel: 'sms', to: numbers.join(', '), ok: false, error: e.message }); }
  }

  /** send one alert to every channel of every chosen profile. Never throws: a broken channel is written to the delivery log */
  dispatch(ids, kind, ctx) {
    let f; try { f = this.facts(kind, ctx); } catch (e) { return console.error('[notify]', e.message); }
    for (const p of this.profiles(ids)) {
      const meta = { profile: p.name, kind, rule: f.rule, host: f.host };
      try {
        if (p.email?.on) {
          const info = { rule: ctx.rule || { name: f.rule }, suppressed: ctx.suppressed || 0, to: p.email.to || '', cc: p.email.cc || '', report: !!ctx.report, noDefault: true, meta: { ...meta, channel: 'email', to: p.email.to || '' } };
          if (kind === 'alert') this.mail.enqueue(info, ctx.msg); else if (kind === 'escalation') this.mail.enqueueEscalation(info, ctx.o); else this.mail.enqueueRecovery(info, ctx.o);
        }
        if (p.webhook?.on && p.webhook.url) this.postWebhook(p.webhook.url, p.webhook.format, f).then(() => this.record({ ...meta, channel: 'webhook', to: hostOf(p.webhook.url), ok: true, error: '' }), (e) => this.record({ ...meta, channel: 'webhook', to: hostOf(p.webhook.url), ok: false, error: e.message }));
        if (p.sms?.on) this.textTo(p, f, meta);
      } catch (e) { this.record({ ...meta, channel: 'profile', ok: false, error: e.message }); }
    }
  }

  /** the "Test" button of a profile: sends a sample alert through the chosen channels and answers for each */
  async test(profile, only) {
    const fake = { ts: Date.now(), host: 'test-device', srcIp: '127.0.0.1', severity: 3, severityName: 'error', facilityName: 'user', app: 'test', message: 'This is a test alert from NetEventPro', source: 'syslog' };
    const f = this.facts('alert', { rule: { name: 'Test' }, suppressed: 0, msg: fake }), out = {}, meta = { profile: profile.name, kind: 'test', rule: 'Test', host: 'test-device' };
    const want = (c) => (!only || only === c) && profile[c]?.on;
    if (want('email')) { const r = await this.mail.sendTest(profile.email.to); out.email = r; this.record({ ...meta, channel: 'email', to: profile.email.to || '', ok: !!r.ok, error: r.error || '' }); }
    if (want('webhook') && profile.webhook.url) { try { await this.postWebhook(profile.webhook.url, profile.webhook.format, f); out.webhook = { ok: true }; } catch (e) { out.webhook = { ok: false, error: e.message }; } this.record({ ...meta, channel: 'webhook', to: hostOf(profile.webhook.url), ok: out.webhook.ok, error: out.webhook.error || '' }); }
    if (want('sms')) {
      const numbers = String(profile.sms.to || '').split(/[,;\s]+/).map(cleanNumber).filter(Boolean);
      if (!numbers.length) out.sms = { ok: false, error: 'No valid phone numbers in this profile' };
      else try { const r = await sendSms(this.config.get().smpp, numbers, 'NetEventPro test: SMS alerts work'); out.sms = { ok: !r.failed.length && r.sent > 0, error: r.failed.map((x) => `${x.to}: ${x.error}`).join('; '), sent: r.sent }; } catch (e) { out.sms = { ok: false, error: e.message }; }
      this.record({ ...meta, channel: 'sms', to: numbers.join(', '), ok: out.sms.ok, error: out.sms.error || '' });
    }
    if (!Object.keys(out).length) out.none = { ok: false, error: 'This profile has no channel switched on.' };
    return out;
  }
}
const hostOf = (u) => { try { return new URL(u).host; } catch { return ''; } };

module.exports = { Notifier };
