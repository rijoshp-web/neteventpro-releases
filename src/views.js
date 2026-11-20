'use strict';
// 1.99.10 Device view: pictures of your devices on a floor plan, rack or drawing, each showing its live state, open alarms
// and a few readings. A view is { id, name, bg: { mode: 'plain' | 'grid' | 'image', img }, items: [...], links: [...] }.
// Items are placed on a 1600 × 900 canvas (the page scales it to the screen). An item is a polled device (src 'poll'),
// a device that sends syslog / traps (src 'dev'), a text label (kind 'label') or a box that opens another view (kind 'view').
// Background pictures and device pictures you upload are kept in the database (table view_images, so backups include them; PNG, JPEG or WebP only).
const crypto = require('node:crypto');
const { matchItem } = require('./readings');

const W = 1600, H = 900, MAX_VIEWS = 50, MAX_ITEMS = 500, MAX_LINKS = 1000, MAX_IMG = 3 * 1048576;
const s = (v, n) => String(v ?? '').slice(0, n);
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const idOk = (v) => /^[a-z0-9]{4,24}$/i.test(String(v || ''));
const newId = (p) => p + crypto.randomBytes(5).toString('hex');
const SEVRANK = (sev) => (Number.isInteger(sev) ? sev : 9);   // 0 = emergency is the worst

/** what an image file really is, by its first bytes (the name and the browser's word are not trusted) */
function imageType(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: 'png', type: 'image/png' };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null;
}

class ViewStore {
  constructor(config, db, deps = {}) {
    this.config = config; this.db = db; this.polling = deps.polling || null; this.engine = deps.engine || null; this.alarms = deps.alarms || null;
    try { this.db.exec('CREATE TABLE IF NOT EXISTS view_images (id TEXT PRIMARY KEY, type TEXT NOT NULL, data BLOB NOT NULL, ts INTEGER NOT NULL)'); } catch (e) { console.error('[views] table', e.message); }
  }
  list() { return (this.config.get().views || []).map((v) => ({ ...v })); }
  get(id) { return this.list().find((v) => v.id === id) || null; }

  /** checks a view sent from the page and keeps only what is known */
  clean(b, old) {
    const bad = (m) => { const e = new Error(m); e.status = 400; throw e; };
    const name = s(b.name, 60).trim(); if (!name) bad('Give the view a name.');
    const bgm = ['plain', 'grid', 'image'].includes(b.bg?.mode) ? b.bg.mode : 'grid';
    const bg = { mode: bgm, img: bgm === 'image' && idOk(b.bg?.img) ? String(b.bg.img) : '', dim: num(b.bg?.dim, 0, 80, 0) };
    if (bgm === 'image' && !bg.img) bg.mode = 'grid';
    const items = [], seen = new Set();
    for (const it of (Array.isArray(b.items) ? b.items : []).slice(0, MAX_ITEMS)) {
      const kind = ['device', 'label', 'view'].includes(it.kind) ? it.kind : 'device';
      const id = idOk(it.id) && !seen.has(it.id) ? String(it.id) : newId('i'); seen.add(id);
      const o = { id, kind, x: Math.round(num(it.x, 0, W, 100)), y: Math.round(num(it.y, 0, H, 100)), size: Math.round(num(it.size, 40, 240, 96)), name: s(it.name, 60) };
      if (kind === 'device') {
        o.src = it.src === 'dev' ? 'dev' : 'poll'; o.ref = s(it.ref, 260); if (!o.ref) continue;
        o.pic = /^(icon:[a-z]{2,20}|img:[a-z0-9]{4,24})$/i.test(String(it.pic || '')) ? String(it.pic) : 'icon:server';
        o.readings = (Array.isArray(it.readings) ? it.readings : []).slice(0, 3).map((r) => s(r, 120)).filter(Boolean);
      } else if (kind === 'label') { o.text = s(it.text, 120); o.size = Math.round(num(it.size, 10, 72, 18)); }
      else { o.view = idOk(it.view) ? String(it.view) : ''; o.pic = /^(icon:[a-z]{2,20})$/.test(String(it.pic || '')) ? String(it.pic) : 'icon:location'; }
      items.push(o);
    }
    const ids = new Set(items.map((i) => i.id)), links = [], lk = new Set();
    for (const l of (Array.isArray(b.links) ? b.links : []).slice(0, MAX_LINKS)) {
      const a = String(l.a || ''), z = String(l.b || ''); if (a === z || !ids.has(a) || !ids.has(z)) continue;
      const key = [a, z].sort().join('|'); if (lk.has(key)) continue; lk.add(key); links.push({ a, b: z, label: s(l.label, 40) });
    }
    return { id: old?.id || (idOk(b.id) ? String(b.id) : newId('v')), name, bg, items, links };
  }
  save(b) {
    const all = this.list(), old = b.id ? all.find((v) => v.id === b.id) : null;
    if (!old && all.length >= MAX_VIEWS) { const e = new Error(`At most ${MAX_VIEWS} views.`); e.status = 400; throw e; }
    const v = this.clean(b, old), list = old ? all.map((x) => (x.id === old.id ? v : x)) : [...all, v];
    this.config.update({ views: list }); this.tidyImages(list); return v;
  }
  remove(id) { const all = this.list(), v = all.find((x) => x.id === id); if (!v) return null; const list = all.filter((x) => x.id !== id); this.config.update({ views: list }); this.tidyImages(list); return v; }

  // ---------- pictures ----------
  saveImage(dataUrl) {
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
    const bad = (t) => { const e = new Error(t); e.status = 400; throw e; };
    if (!m) bad('Choose a PNG, JPEG or WebP picture.');
    const buf = Buffer.from(m[2], 'base64'); if (buf.length > MAX_IMG) bad('The picture is larger than 3 MB. Make it smaller first.');
    const t = imageType(buf); if (!t) bad('This file is not a PNG, JPEG or WebP picture.');
    const id = 'm' + crypto.randomBytes(6).toString('hex');
    this.db.prepare('INSERT INTO view_images (id, type, data, ts) VALUES (?, ?, ?, ?)').run(id, t.type, buf, Date.now()); return id;
  }
  image(id) {
    if (!idOk(id)) return null; const r = this.db.prepare('SELECT type, data FROM view_images WHERE id = ?').get(id); if (!r) return null;
    const buf = Buffer.from(r.data); const t = imageType(buf); return t ? { buf, type: t.type } : null;
  }
  /** pictures no view uses any more are deleted (an upload that was never saved into a view is kept for a day) */
  tidyImages(list = this.list()) {
    try {
      const used = new Set();
      for (const v of list) { if (v.bg?.img) used.add(v.bg.img); for (const it of v.items || []) if (String(it.pic || '').startsWith('img:')) used.add(it.pic.slice(4)); }
      const del = this.db.prepare('DELETE FROM view_images WHERE id = ?');
      for (const r of this.db.prepare('SELECT id, ts FROM view_images').all()) if (!used.has(r.id) && Date.now() - r.ts > 86400000) del.run(r.id);
    } catch (e) { console.error('[views] tidy', e.message); }
  }

  // ---------- what to choose from ----------
  /** the devices that can be placed: polled devices and devices that send syslog / traps */
  choices() {
    const out = [];
    if (this.polling) for (const d of this.polling.devices()) {
      const prof = this.polling.profile(d.profile && d.profile !== 'auto' ? d.profile : 'generic');
      out.push({ src: 'poll', ref: d.id, name: d.name, host: d.host, group: d.group || '', readings: [{ k: 'rtt', label: 'Answer time', unit: 'ms' }, ...(prof.metrics || []).filter((m) => m.on !== false).map((m) => ({ k: m.k, label: m.label || m.k, unit: m.unit || '' }))].slice(0, 80) });
    }
    if (this.engine) for (const d of this.engine.deviceList().slice(0, 20000)) out.push({ src: 'dev', ref: d.key, name: d.name || d.host, host: d.srcIp || '', group: d.group || '', readings: [] });
    return out;
  }

  // ---------- live state ----------
  /** the live state of every device item of a view: { items: { id: { state, sev, open, unack, title, readings: [{ label, text, state }] } } } */
  status(id) {
    const v = this.get(id); if (!v) return null;
    const open = this.alarms ? [...this.alarms.open.values()] : [];
    const byDev = new Map(), byIp = new Map();
    for (const r of open) { (byDev.get(r.dev) || byDev.set(r.dev, []).get(r.dev)).push(r); if (r.src_ip) (byIp.get(r.src_ip) || byIp.set(r.src_ip, []).get(r.src_ip)).push(r); }
    const pdevs = this.polling ? new Map(this.polling.devices().map((d) => [d.id, d])) : new Map();
    const hostN = new Map(); for (const d of pdevs.values()) hostN.set(d.host, (hostN.get(d.host) || 0) + 1);   // an address several polled devices share (a relay, a simulator) does not tell them apart
    const sdevs = this.engine ? new Map(this.engine.deviceList().map((d) => [d.key, d])) : new Map();
    const lk = this.polling ? this.polling.lookupMetrics() : new Map(), lks = this.polling ? new Map(this.polling.lookups().map((l) => [l.id, l])) : new Map();
    const fmt = (v) => (Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));
    const out = {}, views = new Map(this.list().map((x) => [x.id, x]));
    const sum = (alist) => { let sev = null, unack = 0; for (const r of alist) { if (sev === null || SEVRANK(r.severity) < SEVRANK(sev)) sev = r.severity; if (r.state === 'open') unack++; } return { sev, open: alist.length, unack }; };
    const one = (it) => {
      if (it.src === 'poll') {
        const d = pdevs.get(it.ref); if (!d) return { state: 'gone', sev: null, open: 0, unack: 0, title: 'This polled device was removed', readings: [] };
        const rt = this.polling.state(d), st = this.polling.shownState(d, rt);
        const al = [...new Map([...(byDev.get(String(d.name).toLowerCase()) || []), ...(hostN.get(d.host) === 1 ? byIp.get(d.host) || [] : [])].map((r) => [r.id, r])).values()];
        const prof = this.polling.profile(d.profile && d.profile !== 'auto' ? d.profile : 'generic'), meta = new Map((prof.metrics || []).map((m) => [m.k, m]));
        const readings = (it.readings || []).map((k) => {
          if (k === 'rtt') return { label: 'Answer time', text: rt.rtt === null || rt.rtt === undefined ? '–' : `${rt.rtt} ms`, state: '' };
          const m = meta.get(k); if (!m) return null; let x = rt.last.get(k + '|'), text = '–', state = '';
          if (!x) for (const [key, y] of rt.last) if (key.startsWith(k + '|')) { x = y; break; }
          if (x && Number.isFinite(x.v)) {
            const l = lk.get(k), items = l ? (lks.get(l.lookup)?.items || []) : []; const hit = items.length ? matchItem(items, x.v) : null;
            text = hit ? hit.label : `${fmt(x.v)}${m.unit ? ' ' + m.unit : ''}`; state = hit ? hit.state || '' : '';
          } else if (rt.texts) { const t = rt.texts.get(k + '|') || [...rt.texts].find(([key]) => key.startsWith(k + '|'))?.[1]; if (t) text = String(t.s).slice(0, 40); }
          return { label: m.label || k, text, state };
        }).filter(Boolean);
        return { state: st === 'off' ? 'off' : st === 'down' ? 'down' : st === 'up' ? 'up' : st === 'stale' ? 'stale' : 'unknown', ...sum(al), title: `${d.name} · ${d.host}`, name: d.name, readings, poll: d.id };
      }
      const d = sdevs.get(it.ref); if (!d) return { state: 'gone', sev: null, open: 0, unack: 0, title: 'This device is no longer in the device list', readings: [] };
      const al = byDev.get(d.key) || [];
      return { state: d.overdue ? 'down' : 'up', ...sum(al), title: `${d.name || d.host} · ${d.srcIp || ''}`, name: d.name || d.host, readings: [], dev: d.key, last: d.lastSeen || 0 };
    };
    for (const it of v.items) {
      if (it.kind === 'device') out[it.id] = one(it);
      else if (it.kind === 'view') {   // a box that opens another view takes the worst state of what is in it
        const sub = views.get(it.view); if (!sub) { out[it.id] = { state: 'gone', sev: null, open: 0, unack: 0, readings: [] }; continue; }
        let sev = null, openN = 0, unack = 0, down = 0;
        for (const x of sub.items) if (x.kind === 'device') { const r = one(x); if (r.sev !== null && (sev === null || SEVRANK(r.sev) < SEVRANK(sev))) sev = r.sev; openN += r.open; unack += r.unack; if (r.state === 'down') down++; }
        out[it.id] = { state: down ? 'down' : 'up', sev, open: openN, unack, down, readings: [] };
      }
    }
    return { at: Date.now(), items: out };
  }
}
/** the open alarms of one device item, newest first (for the panel that opens when you click a device) */
ViewStore.prototype.itemAlarms = function (viewId, itemId) {
  const v = this.get(viewId), it = v && v.items.find((x) => x.id === itemId); if (!it || it.kind !== 'device' || !this.alarms) return null;
  let keys = new Set(), ips = new Set();
  if (it.src === 'poll') { const all = this.polling?.devices() || [], d = all.find((x) => x.id === it.ref); if (d) { keys.add(String(d.name).toLowerCase()); if (all.filter((x) => x.host === d.host).length === 1) ips.add(d.host); } }
  else keys.add(it.ref);
  return [...this.alarms.open.values()].filter((r) => keys.has(r.dev) || (r.src_ip && ips.has(r.src_ip))).sort((a, b) => b.first_ts - a.first_ts).slice(0, 50)
    .map((r) => ({ id: r.id, severity: r.severity, state: r.state, rule: r.rule_name, port: r.inst_txt || r.inst || '', message: r.message, first: r.first_ts, ackBy: r.ack_by || '' }));
};
module.exports = { ViewStore, imageType, W, H };
