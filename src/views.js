'use strict';
// 1.99.10 Device view: pictures of your devices on a floor plan, rack or drawing, each showing its live state, open alarms
// and a few readings. A view is { id, name, bg: { mode: 'plain' | 'grid' | 'image', img }, items: [...], links: [...] }.
// Items are placed on a 1600 × 900 canvas (the page scales it to the screen). An item is a polled device (src 'poll'),
// a device that sends syslog / traps (src 'dev'), a text label (kind 'label') or a box that opens another view (kind 'view').
// Background pictures and device pictures you upload are kept in the database (table view_images, so backups include them; PNG, JPEG or WebP only).
const crypto = require('node:crypto');
const { matchItem } = require('./readings');

const W = 1600, H = 900, MAX_VIEWS = 50, MAX_ITEMS = 500, MAX_LINKS = 1000, MAX_IMG = 8 * 1048576;   // 1.99.11 8 MB: drawings saved from Visio can be large
const s = (v, n) => String(v ?? '').slice(0, n);
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const idOk = (v) => /^[a-z0-9]{4,24}$/i.test(String(v || ''));
const newId = (p) => p + crypto.randomBytes(5).toString('hex');
const SEVRANK = (sev) => (Number.isInteger(sev) ? sev : 9);   // 0 = emergency is the worst
const SHAPES = ['rect', 'round', 'ellipse', 'diamond', 'hexagon', 'cylinder', 'cloud', 'zone'];
const col = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : '');

/** what an image file really is, by its first bytes (the name and the browser's word are not trusted) */
function imageType(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: 'png', type: 'image/png' };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  // 1.99.11 SVG (a Visio drawing saved as SVG): shown only as a picture (<img>), where scripts never run; served with a policy that blocks them anyway
  { const head = buf.subarray(0, 2048).toString('utf8').replace(/^\uFEFF/, '').replace(/<\?xml[^>]*\?>/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/i, '').trimStart(); if (/^<svg[\s>]/i.test(head)) return { ext: 'svg', type: 'image/svg+xml' }; }
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
      const kind = ['device', 'label', 'view', 'shape', 'deco', 'server'].includes(it.kind) ? it.kind : 'device';   // 1.99.17 shapes, pictures that are not monitored, and this NetEventPro server
      const id = idOk(it.id) && !seen.has(it.id) ? String(it.id) : newId('i'); seen.add(id);
      const o = { id, kind, x: Math.round(num(it.x, 0, W, 100)), y: Math.round(num(it.y, 0, H, 100)), size: Math.round(num(it.size, 16, 600, 96)), name: s(it.name, 60) };
      if (kind === 'device') {
        o.src = it.src === 'dev' ? 'dev' : 'poll'; o.ref = s(it.ref, 260); if (!o.ref) continue;
        o.pic = /^(icon:[a-z0-9-]{2,40}|img:[a-z0-9]{4,24}|none)$/i.test(String(it.pic || '')) ? String(it.pic) : 'icon:server';   // none = marker only: a live ring over a shape of the background drawing
        o.h = Math.round(num(it.h, 20, 600, o.size)); o.hideName = it.hideName === true;
        o.readings = [];
      } else if (kind === 'label') { o.text = s(it.text, 120); o.size = Math.round(num(it.size, 10, 72, 18)); }
      else if (kind === 'shape') {
        o.shape = SHAPES.includes(it.shape) ? it.shape : 'rect'; o.size = Math.round(num(it.size, 16, W, 220)); o.h = Math.round(num(it.h, 16, H, 140));
        o.fill = col(it.fill); o.fa = Math.round(num(it.fa, 0, 100, 18)); o.stroke = col(it.stroke); o.sw = Math.round(num(it.sw, 0, 12, 2)); o.dash = it.dash === true;
        o.text = s(it.text, 200); o.ts = Math.round(num(it.ts, 10, 72, 16)); o.tc = col(it.tc); o.ta = ['center', 'top'].includes(it.ta) ? it.ta : 'center';
      } else if (kind === 'deco' || kind === 'server') {
        o.pic = /^(icon:[a-z0-9-]{2,40}|img:[a-z0-9]{4,24})$/i.test(String(it.pic || '')) ? String(it.pic) : (kind === 'server' ? 'icon:server-tower' : 'icon:server-2u'); o.hideName = it.hideName === true;
      }
      else { o.view = idOk(it.view) ? String(it.view) : ''; o.pic = /^(icon:[a-z0-9-]{2,40})$/.test(String(it.pic || '')) ? String(it.pic) : 'icon:building'; }
      items.push(o);
    }
    const ids = new Set(items.map((i) => i.id)), links = [], lk = new Set();
    for (const l of (Array.isArray(b.links) ? b.links : []).slice(0, MAX_LINKS)) {
      const a = String(l.a || ''), z = String(l.b || ''); if (a === z || !ids.has(a) || !ids.has(z)) continue;
      const key = [a, z].sort().join('|'); if (lk.has(key)) continue; lk.add(key);
      // 1.99.14 a link can follow one port: { end: 'a' | 'b', name: interface name as the device calls it }; show = what the line's label says
      const pn = s(l.port?.name, 120).trim(), port = pn ? { end: l.port?.end === 'b' ? 'b' : 'a', name: pn } : null;
      // 1.99.17 how the line is drawn: straight, elbow (right angles, like a Visio connector) or curved; arrows, dashes, width and an own colour
      links.push({ a, b: z, label: s(l.label, 40), port, show: ['port', 'util', 'none'].includes(l.show) ? l.show : 'port',
        route: ['straight', 'elbow', 'curve'].includes(l.route) ? l.route : 'straight', bend: Math.round(num(l.bend, -100, 100, 30)), arrow: ['none', 'end', 'start', 'both'].includes(l.arrow) ? l.arrow : 'none',
        dash: ['solid', 'dash', 'dot'].includes(l.dash) ? l.dash : 'solid', lw: Math.round(num(l.lw, 1, 12, 4)), color: col(l.color) });
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
    const m = /^data:image\/(png|jpeg|webp|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
    const bad = (t) => { const e = new Error(t); e.status = 400; throw e; };
    if (!m) bad('Choose a PNG, JPEG, WebP or SVG picture.');
    const buf = Buffer.from(m[2], 'base64'); if (buf.length > MAX_IMG) bad('The picture is larger than 8 MB. Make it smaller first.');
    const t = imageType(buf); if (!t) bad('This file is not a PNG, JPEG, WebP or SVG picture.');
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
      else if (it.kind === 'server') out[it.id] = this.serverState();
      else if (it.kind === 'view') {   // a box that opens another view takes the worst state of what is in it
        const sub = views.get(it.view); if (!sub) { out[it.id] = { state: 'gone', sev: null, open: 0, unack: 0, readings: [] }; continue; }
        let sev = null, openN = 0, unack = 0, down = 0;
        for (const x of sub.items) if (x.kind === 'device') { const r = one(x); if (r.sev !== null && (sev === null || SEVRANK(r.sev) < SEVRANK(sev))) sev = r.sev; openN += r.open; unack += r.unack; if (r.state === 'down') down++; }
        out[it.id] = { state: down ? 'down' : 'up', sev, open: openN, unack, down, readings: [] };
      }
    }
    // 1.99.14 every link's state: a link that follows a port takes that port's state (polled interface status and use, or an open alarm
    // on that port of a syslog / trap device); other links are down when a device at either end is down
    const itemsById = new Map(v.items.map((i) => [i.id, i])), linksOut = [];
    const low = (x) => String(x || '').trim().toLowerCase();
    const fmtBps = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' Gbit/s' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' Mbit/s' : b >= 1e3 ? Math.round(b / 1e3) + ' kbit/s' : Math.round(b) + ' bit/s');
    for (const l of v.links) {
      const ea = out[l.a], eb = out[l.b];
      const ends = [ea, eb].filter(Boolean), anyDown = ends.some((x) => x.state === 'down'), anyUnknown = ends.some((x) => ['unknown', 'gone', 'stale', 'off'].includes(x.state));
      let state = anyDown ? 'down' : anyUnknown ? 'unknown' : 'up', text = '', why = anyDown ? 'a device at one end does not answer' : '';
      if (!ends.length && !l.port) { linksOut.push({ state: 'none', text: (l.label || '').slice(0, 60), why: '' }); continue; }   // 1.99.17 a line between shapes or pictures that are not monitored: drawn in its own colour
      if (l.port) {
        const it = itemsById.get(l.port.end === 'b' ? l.b : l.a), pname = low(l.port.name);
        let found = false;
        if (it?.src === 'poll' && pdevs.get(it.ref)) {
          const rt = this.polling.state(pdevs.get(it.ref)), ifc = (rt.ifaces || []).find((x) => low(x.name) === pname || (x.alias && low(x.alias) === pname));
          if (ifc) {
            found = true; const use = ifc.speed > 0 && (Number.isFinite(ifc.in) || Number.isFinite(ifc.out)) ? Math.max(ifc.in || 0, ifc.out || 0) / ifc.speed * 100 : null;
            state = ifc.status === 'down' ? 'down' : ifc.status === 'up' ? (use !== null && use >= 90 ? 'warn' : 'up') : 'unknown';
            why = ifc.status === 'down' ? `port ${ifc.name} is down` : use !== null && use >= 90 ? `port ${ifc.name} is ${Math.round(use)}% used` : `port ${ifc.name} is ${ifc.status}`;
            text = l.show === 'util' && use !== null ? `${Math.round(use)}% · ${fmtBps(Math.max(ifc.in || 0, ifc.out || 0))}` : l.show === 'none' ? '' : `${ifc.name} ${ifc.status === 'down' ? 'down' : ifc.status === 'up' ? (use !== null ? Math.round(use) + '%' : 'up') : ''}`.trim();
          }
        }
        if (!found) {
          const key = it?.src === 'poll' ? String(pdevs.get(it.ref)?.name || '').toLowerCase() : it?.ref;
          const al = open.filter((r) => r.dev === key && (low(r.inst_txt) === pname || low(r.inst) === pname));
          const worst = al.reduce((m, r) => (m === null || SEVRANK(r.severity) < SEVRANK(m) ? r.severity : m), null);
          if (al.length) { state = worst !== null && worst <= 3 ? 'down' : 'warn'; why = `open alarm on port ${l.port.name}: ${al[0].rule_name || al[0].message || ''}`.slice(0, 160); }
          else if (!anyDown) { state = anyUnknown ? 'unknown' : 'up'; why = `no open alarm on port ${l.port.name}`; }
          text = l.show === 'none' ? '' : l.port.name + (al.length ? ' down' : '');
        }
      }
      if (l.label) text = text ? `${l.label} · ${text}` : l.label;
      linksOut.push({ state, text: text.slice(0, 60), why });
    }
    return { at: Date.now(), items: out, links: linksOut };
  }
}
/** 1.99.14 the ports a link can follow at one device item: the interfaces a polled device reports, or the ports seen in alarms of a syslog / trap device */
ViewStore.prototype.itemPorts = function (viewId, itemId) {
  const v = this.get(viewId), it = v && v.items.find((x) => x.id === itemId); if (!it || it.kind !== 'device') return null;
  if (it.src === 'poll') {
    const d = this.polling?.devices().find((x) => x.id === it.ref); if (!d) return { kind: 'poll', ports: [] };
    const rt = this.polling.state(d);
    return { kind: 'poll', ports: (rt.ifaces || []).slice(0, 2000).map((i) => ({ name: i.name, alias: i.alias || '', status: i.status, speed: i.speed || 0 })) };
  }
  const seen = new Map();
  for (const r of this.alarms ? this.alarms.open.values() : []) if (r.dev === it.ref) { const n = String(r.inst_txt || r.inst || '').trim(); if (n) seen.set(n.toLowerCase(), n); }
  try { for (const r of (this.alarms?.db || this.db).prepare("SELECT DISTINCT COALESCE(NULLIF(inst_txt, ''), inst) AS n FROM alarms WHERE dev = ? AND COALESCE(NULLIF(inst_txt, ''), inst) <> '' ORDER BY n LIMIT 300").all(it.ref)) seen.set(String(r.n).toLowerCase(), String(r.n)); } catch { /* older alarm tables */ }
  return { kind: 'dev', ports: [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((name) => ({ name, alias: '', status: '', speed: 0 })) };
};
/** the open alarms of one device item, newest first (for the panel that opens when you click a device) */
ViewStore.prototype.itemAlarms = function (viewId, itemId) {
  const v = this.get(viewId), it = v && v.items.find((x) => x.id === itemId); if (!it || it.kind !== 'device' || !this.alarms) return null;
  let keys = new Set(), ips = new Set();
  if (it.src === 'poll') { const all = this.polling?.devices() || [], d = all.find((x) => x.id === it.ref); if (d) { keys.add(String(d.name).toLowerCase()); if (all.filter((x) => x.host === d.host).length === 1) ips.add(d.host); } }
  else keys.add(it.ref);
  return [...this.alarms.open.values()].filter((r) => keys.has(r.dev) || (r.src_ip && ips.has(r.src_ip))).sort((a, b) => b.first_ts - a.first_ts).slice(0, 50)
    .map((r) => ({ id: r.id, severity: r.severity, state: r.state, rule: r.rule_name, port: r.inst_txt || r.inst || '', message: r.message, first: r.first_ts, ackBy: r.ack_by || '' }));
};
/** 1.99.11 everything the details panel shows for one device item: who it is, how it answers, every enabled reading (value,
 *  meaning, a small 24-hour graph for single values) and the open alarm count. Readings are no longer drawn under the pictures. */
ViewStore.prototype.itemDetail = function (viewId, itemId) {
  const v = this.get(viewId), it = v && v.items.find((x) => x.id === itemId); if (!it || (it.kind !== 'device' && it.kind !== 'server')) return null;
  if (it.kind === 'server') return this.serverDetail(it);
  const st = (this.status(viewId)?.items || {})[itemId] || {};
  if (it.src !== 'poll') {
    const d = this.engine?.deviceList().find((x) => x.key === it.ref); if (!d) return { kind: 'dev', name: it.name || it.ref, state: 'gone', alarms: st.open || 0, readings: [] };
    return { kind: 'dev', name: it.name || d.name || d.host, host: d.srcIp || '', vendor: d.vendor || '', group: d.group || '', state: st.state, sev: st.sev ?? null, alarms: st.open || 0, unack: st.unack || 0, lastSeen: d.lastSeen || 0, sys: d.sys || 0, traps: d.traps || 0, overdue: !!d.overdue, dev: d.key, readings: [] };
  }
  const det = this.polling?.detail(it.ref); if (!det) return { kind: 'poll', name: it.name || 'Device', state: 'gone', alarms: 0, readings: [] };
  const lk = this.polling.lookupMetrics(), lks = new Map(this.polling.lookups().map((l) => [l.id, l])), now = Date.now();
  const fmt = (x) => (x === null || x === undefined || !Number.isFinite(+x) ? '–' : Math.abs(x) >= 1000 ? String(Math.round(x)) : Math.abs(x) >= 100 ? String(Math.round(x * 10) / 10) : String(Math.round(x * 100) / 100));
  const word = (k, x) => { const l = lk.get(k), items = l ? lks.get(l.lookup)?.items || [] : []; return items.length && Number.isFinite(+x) ? matchItem(items, +x) : null; };
  const readings = [];
  for (const m of det.profile.metrics.slice(0, 80)) {
    const r = { k: m.k, label: m.label || m.k, unit: m.unit || '', text: '–', state: '', spark: null, rows: null };
    if (det.insts[m.k]) {
      const ent = Object.entries(det.insts[m.k]); r.rows = ent.slice(0, 12).map(([i, x]) => { const w = word(m.k, x); return { inst: i, text: w ? w.label : `${fmt(x)}${m.unit ? ' ' + m.unit : ''}`, state: w?.state || '' }; });
      r.text = `${ent.length} value${ent.length === 1 ? '' : 's'}`; r.more = Math.max(0, ent.length - 12);
    } else if (det.values[m.k] !== undefined) {
      const x = det.values[m.k], w = word(m.k, x); r.text = w ? w.label : `${fmt(x)}${m.unit ? ' ' + m.unit : ''}`; r.state = w?.state || ''; r.value = x;
      if (!w) { try { r.spark = this.polling.series(it.ref, m.k, '', now - 86400000, now, 48).map((p) => (p.v === null || p.v === undefined ? null : Math.round(p.v * 1000) / 1000)); } catch { r.spark = null; } }
    } else if (det.texts[m.k]) {
      const t = det.texts[m.k][''] || Object.values(det.texts[m.k])[0]; const sv = String(t?.s ?? ''); const w = /^\s*-?\d+(\.\d+)?\s*$/.test(sv) ? word(m.k, +sv) : null;
      r.text = w ? w.label : sv.slice(0, 80) || '–'; r.state = w?.state || '';
    }
    readings.push(r);
  }
  const d = det.device;
  return { kind: 'poll', name: it.name || d.name, host: d.host, port: d.port, version: d.version, group: d.group || '', via: det.via || '', state: det.state, sev: st.sev ?? null, alarms: st.open || 0, unack: st.unack || 0,
    rtt: det.rtt, lastOk: det.lastOk, error: det.error || '', downSince: det.downSince || 0, sysName: det.sysName, sysDescr: String(det.sysDescr || '').slice(0, 200), uptime: det.values.uptime ?? null, poll: d.id, readings };
};
/** 1.99.17 this NetEventPro server as an item: its state follows the health checks (System health page) */
ViewStore.prototype.serverState = function () {
  const h = this.engine?.health, sm = h?.summary || null, checks = h?.last?.checks || [];
  const bad = sm ? sm.bad : checks.filter((c) => c.status === 'bad').length, warn = sm ? sm.warn : checks.filter((c) => c.status === 'warn').length;
  const text = bad ? `${bad} health check${bad === 1 ? '' : 's'} failed` : warn ? `${warn} health warning${warn === 1 ? '' : 's'}` : 'Running · health OK';
  return { state: 'up', sev: bad ? 2 : warn ? 4 : null, open: 0, unack: 0, title: `${require('node:os').hostname()} · NetEventPro`, name: 'NetEventPro server', text, readings: [] };
};
ViewStore.prototype.serverDetail = function (it) {
  const h = this.engine?.health, snap = h?.last || null, st = this.serverState(), os = require('node:os');
  const map = { ok: 'ok', warn: 'warn', bad: 'crit' };
  const word = { ok: 'OK', warn: 'Warning', bad: 'Failed' };
  const readings = (snap?.checks || []).slice(0, 40).map((c, i) => ({ k: 'hc' + i, label: String(c.label || c.id || 'Check'), unit: '', text: word[c.status] || String(c.status || ''), state: map[c.status] || '', spark: null, rows: c.detail ? [{ inst: String(c.detail).slice(0, 300), text: '', state: '' }] : null }));
  return { kind: 'server', name: it.name || 'NetEventPro server', host: os.hostname(), state: 'up', sev: st.sev, text: st.text, alarms: 0, unack: 0,
    uptime: snap?.system?.uptimeSec ?? null, eps: snap?.ingest?.eps ?? null, devices: snap?.ingest?.devices ?? null, version: process.env.npm_package_version || '', readings };
};
module.exports = { ViewStore, imageType, W, H };
