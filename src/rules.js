'use strict';
// Rule engine. A rule has { id, name, enabled, match, actions }.
//
// match (all specified conditions must hold):
//   severityMax   0-9  this severity or worse (0 = emergency ... 7 = debug, 8 = minor, 9 = cleared; ordered by seriousness, see sev.js)
//   severityMin   0-9  this severity or less serious
//   severities    [0-9,...] message severity is one of these (any combination)
//   host          substring (case-insens.) of host / source IP, or /regex/flags
//   app           substring of app/process name, or /regex/flags
//   text          substring of message, or /regex/flags
//   facility      number
//   textAny       [text or /regex/, ...] the message must contain at least ONE of these (OR); also needs `text` when both are given
//   notText       the message must NOT contain this (text or /regex/)
//   ip            comma separated source addresses or IPv4 ranges (10.1.0.0/16, 192.168.1.5)
//   days / from / to   only on these weekdays (0 = Sunday) and between these server-local times "HH:MM" (an overnight window like 22:00-06:00 works)
//   repeat        { count, withinSec }: only fires once the same device matched this rule `count` times within `withinSec` seconds
//   trap          (SNMP rules) trap name, or a numeric OID prefix such as 1.3.6.1.4.1.318, or /regex/
//
// source: 'syslog' (default, also for rules made before traps existed) or 'snmp'. A rule only looks at messages of its own source.
//
// actions:
//   color    '#rrggbb'  highlight row in the live view
//   tag      string     label added to the message
//   drop     bool       discard the message (not stored, not shown, not forwarded)
//   sound    bool       play a sound in the dashboard
//   notify   bool       desktop notification in the dashboard
//   webhook  string     name of a configured webhook to call
//   email    bool       send an alert email (SMTP settings), emailTo = optional recipients overriding the default list
//   alarm    bool       raise one alarm per rule and device in the Alarms console (repeats raise its counter); alarmEscMin / alarmEscTo = e-mail again if nobody acknowledges it in that many minutes (alarmEscClear:false = no recovery e-mail when the escalated alarm clears; alarmEscReport:false = without the 24-hour report; emailReport:true = attach the 24-hour report to this rule's alert e-mails too)
//   severity bool/0-7  set the message severity before later rules and storage (a rule can promote or demote)
//   stop     bool       do not run any later rules for this message
//   flapCount / flapMin / flapQuiet  flap detection: flapCount changes of the same alarm key within flapMin minutes = one "(flapping)" alarm, quiet for flapQuiet minutes = it clears (1.40)
//   alarmAutoClearMin number  the alarm clears itself when it did not repeat for this many minutes
//   clearsRule string   id of another rule: its alarms for the same device are cleared when this rule matches (link up clears link down)
//   clearText   [text or /regex/, ...] a message of this rule's device that matches ANY of these clears this rule's own alarm (same port when alarmBy is set) instead of raising it: one rule can raise and clear
//   sevMap      [{ text, severity }] first entry whose text matches sets the message severity (e.g. "Status: Major" -> 3), used by the alarm
//   cooldownSec number  min seconds between webhook / email alerts for this rule (default 60, or 300 when emailing)

const { parseSevs } = require('./query');
const SEVX = require('./sev');
const { SourceFilter } = require('./acl');
const { checkRegexSource, MAX_REGEX_INPUT } = require('./safe-regex');
const MAX_MATCH_INPUT = MAX_REGEX_INPUT;   // regular expressions only look at the first 2000 characters of a field

const matchers = (v) => (Array.isArray(v) ? v : []).map(toMatcher).filter(Boolean);
function toMatcher(spec) {
  if (spec === undefined || spec === null || spec === '') return null;
  const s = String(spec);
  const m = /^\/(.+)\/([gimsuy]*)$/.exec(s);
  if (m) {
    // invalid or risky patterns (also ones typed straight into config.json) never run
    if (checkRegexSource(m[1], m[2])) return () => false;
    try { const re = new RegExp(m[1], m[2].replace(/[gy]/g, '')); return (v) => re.test(v.length > MAX_MATCH_INPUT ? v.slice(0, MAX_MATCH_INPUT) : v); } catch { return () => false; }
  }
  const needle = s.toLowerCase();
  return (v) => v.toLowerCase().includes(needle);
}

const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return Math.min(23, h) * 60 + Math.min(59, m); };
function inSchedule(c, now = new Date()) {
  if (c.days && !c.days.includes(now.getDay())) return false;
  if (c.from !== null && c.to !== null) { const t = now.getHours() * 60 + now.getMinutes(); return c.from <= c.to ? t >= c.from && t <= c.to : t >= c.from || t <= c.to; }
  return true;
}

class RuleEngine {
  constructor() { this.seen = new Map(); this.compiled = []; this.lastFired = new Map(); this.suppressed = new Map(); this.hits = new Map(); }

  load(rules) {
    this.compiled = (rules || []).filter(r => r && r.enabled !== false).map(r => {
      const mt = r.match || {};
      const trap = mt.trap ? String(mt.trap) : ''; const ac = r.actions || {};
      return {
        rule: r,
        source: r.source === 'snmp' ? 'snmp' : 'syslog',
        trap: !trap ? null : /^[\d.]+$/.test(trap) ? ((m) => (v) => v === m || v.startsWith(m + '.'))(trap.replace(/\.$/, '')) : toMatcher(trap),
        trapIsOid: /^[\d.]+$/.test(trap),
        sevMax: mt.severityMax === undefined || mt.severityMax === '' ? null : +mt.severityMax,
        sevMin: mt.severityMin === undefined || mt.severityMin === '' ? null : +mt.severityMin,
        sevs: parseSevs(mt.severities),
        facility: mt.facility === undefined || mt.facility === '' ? null : +mt.facility,
        host: toMatcher(mt.host),
        app: toMatcher(mt.app),
        text: toMatcher(mt.text),
        notText: toMatcher(mt.notText),
        textAny: (() => { const l = matchers(mt.textAny); return l.length ? l : null; })(),
        clear: (() => { const l = matchers(ac.clearText); return l.length ? l : null; })(),
        sevMap: (() => { const l = (Array.isArray(ac.sevMap) ? ac.sevMap : []).map((x) => ({ m: toMatcher(x && x.text), sev: Math.trunc(+(x && x.severity)) })).filter((x) => x.m && x.sev >= 0 && x.sev <= 9); return l.length ? l : null; })(),
        ip: mt.ip ? ((f) => (f.load(String(mt.ip).split(/[\s,;]+/).filter(Boolean)), f))(new SourceFilter()) : null,
        days: Array.isArray(mt.days) && mt.days.length && mt.days.length < 7 ? mt.days.map(Number) : null,
        from: /^\d{1,2}:\d{2}$/.test(mt.from || '') ? toMin(mt.from) : null, to: /^\d{1,2}:\d{2}$/.test(mt.to || '') ? toMin(mt.to) : null,
        repeat: mt.repeat && +mt.repeat.count > 1 && +mt.repeat.withinSec > 0 ? { count: Math.min(1000, +mt.repeat.count), ms: Math.min(86400, +mt.repeat.withinSec) * 1000 } : null,
        tag: mt.tag ? String(mt.tag).toLowerCase() : null
      };
    });
  }

  /** Applies all rules to msg. Mutates msg.tags / msg.color. Returns { drop, sound, notify, webhooks[], emails[], alarms[], clears[] }.
   *  quiet = the device is in a maintenance window: tags, colours, dropping and alarm-clearing still work, but nothing alerts and no alarm is raised. */
  apply(msg, quiet = false) {
    const out = { drop: false, sound: false, notify: false, webhooks: [], emails: [], notifs: [], alarms: [], clears: [] };
    const source = msg.source === 'snmp' ? 'snmp' : 'syslog';
    for (const c of this.compiled) {
      if (c.source !== source) continue;
      if (msg.poll && !String(c.rule.id || '').startsWith('poll-')) continue;   /* SNMP polling alarms are told by their own rules only (set on the reading); your syslog rules do not see them, so nobody is told twice. They stay in the Logs list for history. */
      if (c.trap && !(c.trapIsOid ? c.trap(msg.trapOid || '') : (c.trap(msg.msgid || '') || c.trap(msg.trapOid || '')))) continue;
      if (c.sevMax !== null && SEVX.rank(msg.severity) > SEVX.rank(c.sevMax)) continue;
      if (c.sevMin !== null && SEVX.rank(msg.severity) < SEVX.rank(c.sevMin)) continue;
      if (c.sevs && !c.sevs.includes(msg.severity)) continue;
      if (c.facility !== null && msg.facility !== c.facility) continue;
      if (c.host && !(c.host(msg.host) || c.host(msg.srcIp))) continue;
      if (c.app && !c.app(msg.app || '')) continue;
      if (c.ip && !c.ip.allows(msg.srcIp)) continue;
      if ((c.days || c.from !== null) && !inSchedule(c)) continue;
      if (c.tag && !(msg.tags || []).some((t) => String(t).toLowerCase() === c.tag)) continue;   // a tag added by a vendor parser or an earlier rule

      const a = c.rule.actions || {};
      const id = c.rule.id;
      if (c.clear && c.clear.some((f) => f(msg.message))) {   // "all clear" message: clear this rule's own alarm (the same port when alarmBy is set) instead of raising one
        this.hits.set(id, (this.hits.get(id) || 0) + 1); out.clears.push({ id, by: c.rule.name, alarmBy: a.alarmBy || '' }); continue;
      }
      if (c.text && !c.text(msg.message)) continue;
      if (c.textAny && !c.textAny.some((f) => f(msg.message))) continue;
      if (c.notText && c.notText(msg.message)) continue;
      if (c.repeat && !this.repeated(c, id + '|' + (msg.devKey || msg.srcIp))) continue;
      this.hits.set(id, (this.hits.get(id) || 0) + 1);
      if (a.drop) { out.drop = true; return out; }
      if (c.sevMap) for (const x of c.sevMap) if (x.m(msg.message)) { msg.severity = x.sev; break; }
      if (a.severity !== undefined && a.severity !== '' && a.severity !== false && +a.severity >= 0 && +a.severity <= 9) msg.severity = Math.trunc(+a.severity);
      msg.severityName = SEVX.NAMES[msg.severity] || msg.severityName;
      if (a.color && !msg.color) msg.color = a.color;
      if (a.tag) { (msg.tags ||= []); if (!msg.tags.includes(a.tag)) msg.tags.push(a.tag); }
      if (a.clearsRule) out.clears.push({ id: a.clearsRule, by: c.rule.name, alarmBy: a.alarmBy || '' });
      if (quiet) { if (a.stop) break; continue; }
      if (a.alarm) out.alarms.push(c.rule);
      if (a.sound) out.sound = true;
      if (a.notify) out.notify = true;
      const hasP = Array.isArray(a.profiles) && a.profiles.length > 0;
      if (a.webhook || a.email || hasP) {
        // one shared cooldown per rule for webhook + email; emails default to 5 minutes so a noisy device cannot flood an inbox
        const now = Date.now();
        const cd = (a.cooldownSec === undefined || a.cooldownSec === '' ? (a.email || (hasP && this.noisy && this.noisy(a.profiles)) ? 300 : 60) : +a.cooldownSec) * 1000;
        const last = this.lastFired.get(id) || 0;
        if (now - last >= cd) {
          const suppressed = this.suppressed.get(id) || 0;
          if (hasP) out.notifs.push({ profiles: a.profiles, rule: c.rule, suppressed, report: !!a.emailReport });
          if (a.webhook) out.webhooks.push({ hook: a.webhook, rule: c.rule, suppressed });
          if (a.email) out.emails.push({ rule: c.rule, suppressed, to: a.emailTo || '', cc: a.emailCc || '', report: !!a.emailReport });
          this.lastFired.set(id, now);
          this.suppressed.set(id, 0);
        } else {
          this.suppressed.set(id, (this.suppressed.get(id) || 0) + 1);
        }
      }
      if (a.stop) break;
    }
    return out;
  }

  /** true once the same device has matched this rule `repeat.count` times within the window */
  repeated(c, key) {
    const now = Date.now(), arr = (this.seen.get(key) || []).filter((t) => now - t <= c.repeat.ms); arr.push(now);
    if (arr.length > c.repeat.count) arr.splice(0, arr.length - c.repeat.count);
    if (this.seen.size > 20000) this.seen.clear();
    this.seen.set(key, arr);
    return arr.length >= c.repeat.count;
  }

  hitCounts() { return Object.fromEntries(this.hits); }
}

module.exports = { RuleEngine };
