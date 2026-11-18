'use strict';
// One place for how the server writes dates and times in exports, reports and e-mails: the person's time zone
// (Settings → Storage and time → "Show time in") and date / clock format (Settings → Appearance).
// With no zone set the server's own zone is used. Calendar maths (yesterday, last month, daily 08:00) is done in that zone too.
let cfg = { zone: '', date: 'ymd', clock: '24' };
const cache = new Map();
const pad = (n, w = 2) => String(n).padStart(w, '0');
const okZone = (z) => { if (!z) return false; try { new Intl.DateTimeFormat('en', { timeZone: z }); return true; } catch { return false; } };
function configure(c) {
  const f = (c && c.format) || {}; const z = c && c.ntp && c.ntp.zone;
  cfg = { zone: okZone(z) ? z : '', date: ['ymd', 'dmy', 'mdy'].includes(f.date) ? f.date : 'ymd', clock: f.clock === '12' ? '12' : '24' };
}
const dtf = (zone) => { let f = cache.get(zone); if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); cache.set(zone, f); } return f; };
/** offset in ms between the wall clock of the zone and UTC at moment ts */
function offset(ts, zone = cfg.zone) {
  if (!zone) return -new Date(ts).getTimezoneOffset() * 60000;
  const g = {}; for (const p of dtf(zone).formatToParts(new Date(ts))) g[p.type] = +p.value;
  return Date.UTC(g.year, g.month - 1, g.day, g.hour === 24 ? 0 : g.hour, g.minute, g.second) - Math.floor(ts / 1000) * 1000;
}
/** a Date whose UTC fields (getUTCHours ...) show the wall clock of the zone */
const wall = (ts, zone) => new Date(ts + offset(ts, zone));
/** the real moment for a wall-clock time given as a UTC-based number (Date.UTC(y, m, d, h, mi)) */
function fromWall(w, zone) { let t = w - offset(w, zone); t = w - offset(t, zone); return t; }
function date(ts, zone) {
  const d = wall(ts, zone), y = d.getUTCFullYear(), m = pad(d.getUTCMonth() + 1), dd = pad(d.getUTCDate());
  return cfg.date === 'dmy' ? `${dd}/${m}/${y}` : cfg.date === 'mdy' ? `${m}/${dd}/${y}` : `${y}-${m}-${dd}`;
}
function time(ts, ms = false, zone) {
  const d = wall(ts, zone), h = d.getUTCHours(), mm = `${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${ms ? '.' + pad(d.getUTCMilliseconds(), 3) : ''}`;
  if (cfg.clock === '12') return `${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
  return `${pad(h)}:${mm}`;
}
const dateTime = (ts, zone) => (ts ? `${date(ts, zone)} ${time(ts, false, zone)}` : '');
/** for file names: always 20261118-1430 in the chosen zone */
function fileStamp(ts) { const d = wall(ts); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`; }
const settings = () => ({ ...cfg });
module.exports = { configure, offset, wall, fromWall, date, time, dateTime, fileStamp, settings, okZone };
