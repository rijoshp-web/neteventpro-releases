'use strict';
// Maintenance windows: while one is active for a device, that device's messages are still stored and searchable (tagged "maintenance"),
// but they raise no alarms, send no e-mail / webhook / sound / desktop alert, and the device cannot become "Silent".
// A window is one-off (from ... to ...) or repeats on chosen weekdays between two times of day (server's local time; may pass midnight).

const norm = (s) => String(s || '').trim().toLowerCase();
function globToRe(g) { return new RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'); }
const hm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? +m[1] * 60 + +m[2] : null; };

function windowActive(w, now) {
  if (w.enabled === false) return false;
  const s = w.schedule || {};
  if (s.type === 'once') return now >= s.from && now < s.to;
  const d = new Date(now), min = d.getHours() * 60 + d.getMinutes(), day = d.getDay(), a = hm(s.start), b = hm(s.end), days = s.days || [];
  if (a === null || b === null || a === b) return false;
  if (a < b) return days.includes(day) && min >= a && min < b;
  return (days.includes(day) && min >= a) || (days.includes((day + 6) % 7) && min < b);     // runs past midnight
}

class Maintenance {
  constructor(config) { this.list = []; this.cacheAt = 0; this.cache = []; this.load(config.get().maintenance); config.onChange((c) => this.load(c.maintenance)); }
  load(list) {
    this.list = (Array.isArray(list) ? list : []).map((w) => ({ ...w, _m: (String(w.devices || '').split(/[,\s;]+/).map(norm).filter(Boolean)).map((t) => (t.includes('*') ? globToRe(t) : t)) }));
    this.cacheAt = 0;
  }
  /** windows active right now (recomputed at most once a second) */
  activeWindows(now = Date.now()) {
    if (now - this.cacheAt > 1000 || now < this.cacheAt) { this.cache = this.list.filter((w) => windowActive(w, now)); this.cacheAt = now; }
    return this.cache;
  }
  covers(w, names) { if (!w._m.length) return true; return w._m.some((t) => names.some((n) => (typeof t === 'string' ? n === t : t.test(n)))); }
  /** the window that silences this device now, or null. names = device key / host / address */
  forDevice(names, now = Date.now()) { const ns = names.map(norm).filter(Boolean); for (const w of this.activeWindows(now)) if (this.covers(w, ns)) return w; return null; }
  forMessage(msg, now = Date.now()) { return this.forDevice([msg.devKey, msg.host, msg.srcIp], now); }
  /** 1.99.14 the times each window covered between from and to, as [[start, end], ...] per window (for availability: planned work is not downtime).
   *  Uses the windows as they are set now; a weekly window is worked out day by day in the server's local time. */
  intervals(from, to) {
    const out = [];
    for (const w of this.list) {
      if (w.enabled === false) continue; const s = w.schedule || {}, r = [];
      if (s.type === 'once') { const a = Math.max(from, +s.from || 0), b = Math.min(to, +s.to || 0); if (b > a) r.push([a, b]); }
      else {
        const a = hm(s.start), b = hm(s.end), days = s.days || []; if (a === null || b === null || a === b || !days.length) continue;
        const d = new Date(from); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 1);
        for (let i = 0; i < 400 && d.getTime() < to; i++, d.setDate(d.getDate() + 1)) {
          if (!days.includes(d.getDay())) continue;
          const st = new Date(d); st.setHours(Math.floor(a / 60), a % 60, 0, 0); const en = new Date(d); if (b <= a) en.setDate(en.getDate() + 1); en.setHours(Math.floor(b / 60), b % 60, 0, 0);
          const x = Math.max(from, st.getTime()), y = Math.min(to, en.getTime()); if (y > x) r.push([x, y]);
        }
      }
      if (r.length) out.push({ w, ranges: r });
    }
    return out;
  }
  /** the merged times any window covering these device names was on, between from and to */
  rangesFor(names, from, to, iv = this.intervals(from, to)) {
    const ns = names.map(norm).filter(Boolean), all = [];
    for (const x of iv) if (this.covers(x.w, ns)) all.push(...x.ranges);
    all.sort((p, q) => p[0] - q[0]); const m = [];
    for (const r of all) { const l = m[m.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else m.push([...r]); }
    return m;
  }
  status(now = Date.now()) { const act = new Set(this.activeWindows(now).map((w) => w.id)); return this.list.map((w) => ({ id: w.id, active: act.has(w.id) })); }
}

module.exports = { Maintenance, windowActive };
