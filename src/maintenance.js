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
  status(now = Date.now()) { const act = new Set(this.activeWindows(now).map((w) => w.id)); return this.list.map((w) => ({ id: w.id, active: act.has(w.id) })); }
}

module.exports = { Maintenance, windowActive };
