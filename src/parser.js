'use strict';
// Syslog parser: RFC 5424, RFC 3164 (BSD) and a tolerant fallback for the
// many "almost syslog" formats real network gear sends.

const FACILITIES = [
  'kern', 'user', 'mail', 'daemon', 'auth', 'syslog', 'lpr', 'news',
  'uucp', 'cron', 'authpriv', 'ftp', 'ntp', 'audit', 'alert', 'clock',
  'local0', 'local1', 'local2', 'local3', 'local4', 'local5', 'local6', 'local7'
];
const SEVERITIES = require('./sev').NAMES;
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

const RE_PRI = /^<(\d{1,3})>/;
const RE_5424 = /^(\d{1,2}) (\S+) (\S+) (\S+) (\S+) (\S+) (-|(?:\[(?:[^\]\\]|\\.)*\])+) ?([\s\S]*)$/;
const RE_3164 = /^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(?:(\S+)\s+)?([\s\S]*)$/;
const RE_ISO_PREFIX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s+(\S+)\s+([\s\S]*)$/;
// "app[pid]: msg" or "app: msg"
const RE_TAG = /^([^\s:\[]{1,64})(?:\[(\d+)\])?:\s?([\s\S]*)$/;
// Cisco IOS style "%FAC-SEV-MNEMONIC: text" (sometimes prefixed by a sequence number)
const RE_CISCO = /(%[A-Z0-9_]+-(\d)-[A-Z0-9_]+)/;

function nilToNull(v) { return v === '-' ? null : v; }

function parseSD(sd) {
  if (!sd || sd === '-') return null;
  const out = {};
  const re = /\[([^\s\]=]+)((?:\s+[^\s=]+="(?:[^"\\]|\\.)*")*)\]/g;
  let m;
  while ((m = re.exec(sd))) {
    const params = {};
    const pre = /([^\s=]+)="((?:[^"\\]|\\.)*)"/g;
    let p;
    while ((p = pre.exec(m[2]))) params[p[1]] = p[2].replace(/\\(["\\\]])/g, '$1');
    out[m[1]] = params;
  }
  return Object.keys(out).length ? out : null;
}

function bsdTimestamp(mon, day, hh, mm, ss, now) {
  const month = MONTHS[mon];
  if (month === undefined) return null;
  let d = new Date(now.getFullYear(), month, +day, +hh, +mm, +ss);
  // BSD syslog has no year: if the date lands >1 day in the future it belongs to last year
  if (d.getTime() - now.getTime() > 86400000) d = new Date(now.getFullYear() - 1, month, +day, +hh, +mm, +ss);
  return d;
}

/**
 * @param {Buffer|string} raw
 * @param {string} srcIp   address the packet came from
 * @returns normalized message object
 */
function parse(raw, srcIp, now = new Date()) {
  let text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  text = text.replace(/\u0000+$/, '').replace(/[\r\n]+$/, '');
  const original = text;

  const msg = {
    ts: now.getTime(),            // time received (epoch ms)
    devTs: null,                  // timestamp claimed by the device (epoch ms) if parseable
    srcIp: srcIp || '',
    host: srcIp || '',
    facility: 1, severity: 5,
    facilityName: 'user', severityName: 'notice',
    app: '', pid: '', msgid: '',
    message: text,
    format: 'raw',
    sd: null,
    raw: original
  };

  const pm = RE_PRI.exec(text);
  let hasPri = false;
  if (pm) {
    const pri = +pm[1];
    if (pri <= 191) {
      msg.facility = pri >> 3;
      msg.severity = pri & 7;
      hasPri = true;
      text = text.slice(pm[0].length);
    }
  }
  msg.facilityName = FACILITIES[msg.facility] || String(msg.facility);
  msg.severityName = SEVERITIES[msg.severity];

  let m;
  if (hasPri && (m = RE_5424.exec(text))) {
    // <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID SD MSG
    msg.format = 'rfc5424';
    const t = nilToNull(m[2]);
    if (t) { const ms = Date.parse(t); if (!Number.isNaN(ms)) msg.devTs = ms; }
    msg.host = nilToNull(m[3]) || msg.srcIp;
    msg.app = nilToNull(m[4]) || '';
    msg.pid = nilToNull(m[5]) || '';
    msg.msgid = nilToNull(m[6]) || '';
    msg.sd = parseSD(m[7]);
    msg.message = m[8].replace(/^\uFEFF/, '');
  } else if ((m = RE_3164.exec(text))) {
    msg.format = 'rfc3164';
    const d = bsdTimestamp(m[1], m[2], m[3], m[4], m[5], now);
    if (d) msg.devTs = d.getTime();
    let rest = m[7];
    if (m[6]) {
      // The "hostname" may actually be the start of a tag (e.g. "su: ..." with no host)
      if (/:$/.test(m[6]) || /\[\d+\]:?$/.test(m[6])) rest = m[6] + ' ' + rest;
      else msg.host = m[6];
    }
    const tm = RE_TAG.exec(rest);
    if (tm) { msg.app = tm[1]; msg.pid = tm[2] || ''; msg.message = tm[3]; }
    else msg.message = rest;
  } else if ((m = RE_ISO_PREFIX.exec(text))) {
    msg.format = 'iso-ts';
    const ms = Date.parse(m[1]); if (!Number.isNaN(ms)) msg.devTs = ms;
    msg.host = m[2];
    const tm = RE_TAG.exec(m[3]);
    if (tm) { msg.app = tm[1]; msg.pid = tm[2] || ''; msg.message = tm[3]; } else msg.message = m[3];
  } else {
    msg.message = text;
    const tm = RE_TAG.exec(text);
    if (hasPri && tm) { msg.app = tm[1]; msg.pid = tm[2] || ''; msg.message = tm[3]; }
  }

  // Cisco-style mnemonic: derive app, and (if no PRI) severity
  const cm = RE_CISCO.exec(msg.message);
  if (cm) {
    if (!msg.app) msg.app = cm[1].replace(/^%/, '').split('-')[0];
    msg.mnemonic = cm[1];
    if (!hasPri) { msg.severity = +cm[2]; msg.severityName = SEVERITIES[msg.severity]; }
  }

  msg.message = msg.message.trim();
  return msg;
}

/**
 * TCP stream framer. Supports RFC 6587 octet-counting ("123 <34>1 ...")
 * and newline-delimited framing, auto-detected per frame.
 */
class StreamFramer {
  constructor(onFrame, maxFrame = 65536) {
    this.buf = Buffer.alloc(0);
    this.onFrame = onFrame;
    this.maxFrame = maxFrame;
  }
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (!this.buf.length) return;
      // skip stray line breaks between frames
      let skip = 0;
      while (skip < this.buf.length && (this.buf[skip] === 0x0a || this.buf[skip] === 0x0d)) skip++;
      if (skip) { this.buf = this.buf.subarray(skip); if (!this.buf.length) return; }

      const first = this.buf[0];
      if (first >= 0x31 && first <= 0x39) { // starts with 1-9: maybe octet counting
        let i = 0;
        while (i < this.buf.length && i < 7 && this.buf[i] >= 0x30 && this.buf[i] <= 0x39) i++;
        if (i < this.buf.length && this.buf[i] === 0x20 && i > 0 && i < 7) {
          const len = parseInt(this.buf.subarray(0, i).toString('ascii'), 10);
          if (len > 0 && len <= this.maxFrame) {
            if (this.buf.length < i + 1 + len) return; // wait for the rest
            this.onFrame(this.buf.subarray(i + 1, i + 1 + len));
            this.buf = this.buf.subarray(i + 1 + len);
            continue;
          }
        }
      }
      const nl = this.buf.indexOf(0x0a);
      if (nl === -1) {
        if (this.buf.length > this.maxFrame) { this.onFrame(this.buf); this.buf = Buffer.alloc(0); }
        return;
      }
      this.onFrame(this.buf.subarray(0, nl));
      this.buf = this.buf.subarray(nl + 1);
    }
  }
}

module.exports = { parse, StreamFramer, FACILITIES, SEVERITIES };
