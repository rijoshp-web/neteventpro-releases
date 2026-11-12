'use strict';
const SEVX = require('./sev');
// Alarm console. A rule with the "Raise an alarm" action turns matching messages into ONE alarm per rule and device (repeats only raise the
// counter), so a flapping port is a single line instead of hundreds. An alarm is Open until somebody acknowledges it; it is Cleared by hand,
// or automatically by a rule whose action is "Clears alarms of rule …" (for example "link up" clearing "link down" on the same device).
// Alarms live in the message database (table "alarms"), so they survive a restart and are part of a backup.

const MAX_ACTIVE = 20000, MAX_NOTES = 50;

const { checkRegexSource } = require('./safe-regex');
const PORT_ABBR = [['tengigabitethernet', 'te'], ['twentyfivegige', 'twe'], ['fortygigabitethernet', 'fo'], ['hundredgige', 'hu'], ['tengigabit', 'te'], ['tengige', 'te'], ['gigabitethernet', 'gi'], ['fastethernet', 'fa'], ['port-channel', 'po'], ['portchannel', 'po'], ['ethernet', 'eth']];
const normPort = (v) => { let x = String(v).toLowerCase().replace(/\s+/g, ''); for (const [a, b] of PORT_ABBR) if (x.startsWith(a)) { x = b + x.slice(a.length); break; } return x.slice(0, 60); };
const customRe = new Map();
/** Which port / item of a device does this message talk about? '' = the device as a whole.
 *  spec 'port' = automatic (interface name such as Gi1/0/24, ifDescr / ifIndex of a trap, "port 24"); "/regex/" = first group (or the whole match) of your own pattern. */
function instanceOf(msg, spec) {
  if (!spec) return '';
  const text = String(msg.message || '').slice(0, 2000);
  if (spec === 'port') {
    let m = /ifDescr\.\d+\s*=\s*([^,\[\]]+?)\s*(?:,|\[|\]|$)/i.exec(text); if (m) return normPort(m[1]);
    m = /\b((?:ten|twenty|forty|hundred)?(?:gigabit|gige|fast)?ethernet\s?\d+(?:\/\d+)*(?:\.\d+)?|(?:twe|hu|fo|te|gi|fa|eth|et|po|vl|vlan|tu|lo)\s?\d+(?:\/\d+)*(?:\.\d+)?|port-?channel\s?\d+|port\s+\d+(?:\/\d+)*)\b/i.exec(text); if (m) return normPort(m[1]);
    m = /ifIndex\.(\d+)/i.exec(text); if (m) return 'ifindex' + m[1];
    // transmission and multiplexer gear (DNWP Connection Master and similar) name the port "card/port" followed by its type: "5/8 E1:", "13/1 SDH LP[1-1-1-1]:", "5/1 SDH LP[1-1-1-1] - Reason".
    // Card/port plus the type words are the key, so an LP, an SFP and an E1 of the same card number are different alarms and a clear message names the same one.
    m = /(?:^|[\s:])(\d{1,3}\/\d{1,3}(?:\/\d{1,3})?(?:\s+[^\s:]+){0,3}?)(?=\s*(?::|\s-\s|$))/.exec(text); if (m) return normPort(m[1]);
    m = /\bslot\s+(\d{1,3})\b/i.exec(text); if (m) return 'slot' + m[1];                   // "Unit Missing", "removed from unit slot 3"
    m = /\bAlarm:\s*(\d{1,3}\s+[A-Za-z][^:]{0,30}?)\s*:/.exec(text); if (m) return normPort(m[1]);   // "Alarm: 1 POWER (BITS): ..."
    return '';
  }
  const g = /^\/(.+)\/([gimsuy]*)$/.exec(String(spec)); if (!g) return '';
  let re = customRe.get(spec);
  if (re === undefined) { try { re = checkRegexSource(g[1], g[2]) ? null : new RegExp(g[1], g[2].replace(/[gy]/g, '')); } catch { re = null; } if (customRe.size > 200) customRe.clear(); customRe.set(spec, re); }
  const m = re && re.exec(text); return m ? String(m[1] ?? m[0]).toLowerCase().trim().slice(0, 80) : '';
}

class AlarmStore {
  constructor(store, mail) {
    this.db = store.db; this.mail = mail; this.open = new Map();   // alarm id -> row of an alarm that is not cleared (kept in memory, flushed in batches)
    this.dirty = new Set(); this.refused = 0;
    this.db.exec(`CREATE TABLE IF NOT EXISTS alarms (
      id INTEGER PRIMARY KEY AUTOINCREMENT, rule_id TEXT, rule_name TEXT, dev TEXT, host TEXT, src_ip TEXT, severity INTEGER, state TEXT,
      first_ts INTEGER, last_ts INTEGER, count INTEGER, message TEXT, log_id INTEGER, ack_by TEXT, ack_ts INTEGER, cleared_ts INTEGER, cleared_by TEXT,
      esc_ts INTEGER, esc_min INTEGER, esc_to TEXT, notes TEXT);
      CREATE INDEX IF NOT EXISTS alarms_state ON alarms(state, last_ts);
      CREATE INDEX IF NOT EXISTS alarms_key ON alarms(rule_id, dev, state);
      CREATE INDEX IF NOT EXISTS alarms_first ON alarms(first_ts);
      CREATE INDEX IF NOT EXISTS alarms_cleared ON alarms(cleared_ts);`);
    try { this.db.exec("ALTER TABLE alarms ADD COLUMN source TEXT NOT NULL DEFAULT 'syslog'"); this.db.exec("UPDATE alarms SET source = 'snmp' WHERE log_id IN (SELECT id FROM logs WHERE source = 'snmp' AND ts >= " + (Date.now() - 3 * 86400000) + ')'); } catch { /* already there */ }
    try { this.db.exec("ALTER TABLE alarms ADD COLUMN inst TEXT NOT NULL DEFAULT ''"); } catch { /* already there */ }
    try { this.db.exec('ALTER TABLE alarms ADD COLUMN auto_min INTEGER NOT NULL DEFAULT 0'); } catch { /* already there */ }
    try { this.db.exec('ALTER TABLE alarms ADD COLUMN esc_rep INTEGER NOT NULL DEFAULT 1'); } catch { /* already there */ }
    try { this.db.exec("ALTER TABLE alarms ADD COLUMN esc_prof TEXT NOT NULL DEFAULT ''"); } catch { /* already there */ }     // notification profiles to tell when it escalates / clears (1.37)
    try { this.db.exec('ALTER TABLE alarms ADD COLUMN upd INTEGER NOT NULL DEFAULT 0'); this.db.exec('UPDATE alarms SET upd = MAX(last_ts, COALESCE(cleared_ts,0), COALESCE(ack_ts,0), COALESCE(esc_ts,0))'); } catch { /* already there */ }     // last change (1.38: what still has to be copied to SQL Server)
    try { this.db.exec('ALTER TABLE alarms ADD COLUMN esc_clr INTEGER NOT NULL DEFAULT 1'); } catch { /* already there */ }     // e-mail again when an escalated alarm clears (1.36)
    try { this.db.exec('ALTER TABLE alarms ADD COLUMN esc_sent INTEGER NOT NULL DEFAULT 0'); this.db.exec("UPDATE alarms SET esc_sent = 1 WHERE esc_ts > 0 AND esc_min > 0 AND state != 'cleared'"); } catch { /* already there */ }   // the escalation e-mail was queued   // attach the 24-hour report to the escalation e-mail
    for (const r of this.db.prepare("SELECT * FROM alarms WHERE state != 'cleared'").all()) this.open.set(r.id, r);
    this.flapEv = new Map(); this.flapOn = new Map(); this.flapCfg = new Map();   // flap detection (1.40): events per alarm key, keys that are flapping now, settings per rule
    for (const r of this.open.values()) if (/ \(flapping\)$/.test(r.rule_name)) this.flapOn.set(r.rule_id + '|' + r.dev + '|' + r.inst, { id: r.id, last: r.last_ts, quiet: 15 });
    this.timers = [setInterval(() => this.flush(), 2000), setInterval(() => this.escalate(), 30000), ];
    for (const t of this.timers) t.unref?.();
  }
  stop() { for (const t of this.timers) clearInterval(t); this.flush(); }

  /** number of open or acknowledged alarms of a device (any of its keys / addresses) */
  openFor(keys) { const k = new Set(keys.map((x) => String(x))); let n = 0; for (const r of this.open.values()) if (k.has(r.dev) || k.has(r.src_ip)) n++; return n; }

  static key(ruleId, dev, inst = '') { return ruleId + '|' + dev + (inst ? '|' + inst : ''); }

  /** Called for a message that matched a rule with the alarm action. Returns the alarm row (new or updated), or null when refused. */
  prep(sql) { this._ps ||= new Map(); let st = this._ps.get(sql); if (!st) { st = this.db.prepare(sql); this._ps.set(sql, st); } return st; }   // statements are prepared once, not for every message
  raise(msg, rule) {
    // every matching message is its own alarm line (no merging, no repeat counter)
    const a = rule.actions || {}, inst = instanceOf(msg, a.alarmBy), now = msg.ts || Date.now();
    if (this.open.size >= MAX_ACTIVE) { this.refused++; return null; }
    const row = {
      rule_id: rule.id, rule_name: String(rule.name || '').slice(0, 100), dev: msg.devKey || msg.srcIp, host: String(msg.host || '').slice(0, 253), src_ip: String(msg.srcIp || ''), inst,
      severity: msg.severity, state: 'open', first_ts: now, last_ts: now, count: 1, message: String(msg.message).slice(0, 500), log_id: msg.id || 0,
      ack_by: '', ack_ts: 0, cleared_ts: 0, cleared_by: '', esc_ts: 0, esc_min: Math.max(0, +a.alarmEscMin || 0), esc_to: String(a.alarmEscTo || ''), esc_prof: (Array.isArray(a.alarmEscProfiles) ? a.alarmEscProfiles : []).map(String).join(','), auto_min: Math.max(0, +a.alarmAutoClearMin || 0), esc_rep: a.alarmEscReport === false ? 0 : 1, esc_clr: a.alarmEscClear === false ? 0 : 1, esc_sent: 0, notes: '[]', source: msg.source === 'snmp' ? 'snmp' : 'syslog'
    };
    row.upd = Date.now();
    const r = this.prep(`INSERT INTO alarms (rule_id, rule_name, dev, host, src_ip, severity, state, first_ts, last_ts, count, message, log_id, ack_by, ack_ts, cleared_ts, cleared_by, esc_ts, esc_min, esc_to, esc_prof, notes, source, auto_min, inst, esc_rep, esc_clr, esc_sent, upd)
      VALUES (@rule_id,@rule_name,@dev,@host,@src_ip,@severity,@state,@first_ts,@last_ts,@count,@message,@log_id,@ack_by,@ack_ts,@cleared_ts,@cleared_by,@esc_ts,@esc_min,@esc_to,@esc_prof,@notes,@source,@auto_min,@inst,@esc_rep,@esc_clr,@esc_sent,@upd)`).run(row);
    row.id = Number(r.lastInsertRowid); this.open.set(row.id, row); return row;
  }

  /** A rule that clears alarms matched a message: clear the alarms of `targetRuleId` on the same device. */
  clearBy(targetRuleId, msg, byRule, alarmBy = '') {
    const dev = msg.devKey || msg.srcIp, now = msg.ts || Date.now(), inst = instanceOf(msg, alarmBy);
    for (const row of [...this.open.values()]) if (row.rule_id === targetRuleId && row.dev === dev && (!inst || row.inst === inst)) { if (this.flapOn.has(row.rule_id + '|' + row.dev + '|' + row.inst)) continue; this._clear(row, `auto: ${byRule || 'rule'}`, now); }   // every alarm line of that rule on the device (and port)   // no port named: every alarm of that rule on the device
  }

  _clear(row, by, now = Date.now()) {
    row.state = 'cleared'; row.cleared_ts = now; row.cleared_by = String(by).slice(0, 80);
    this.open.delete(row.id); this.dirty.delete(row.id); this.save(row);
    if (row.esc_sent && row.esc_clr !== 0) this.mailRecovery(row, now);
  }
  save(r) {
    this.prep(`UPDATE alarms SET esc_min=?, esc_to=?, esc_rep=?, esc_sent=?, upd=?, auto_min=?, severity=?, state=?, last_ts=?, count=?, message=?, log_id=?, ack_by=?, ack_ts=?, cleared_ts=?, cleared_by=?, esc_ts=?, notes=? WHERE id=?`)
      .run(r.esc_min || 0, r.esc_to || '', r.esc_rep === 0 ? 0 : 1, r.esc_sent ? 1 : 0, Date.now(), r.auto_min || 0, r.severity, r.state, r.last_ts, r.count, r.message, r.log_id, r.ack_by, r.ack_ts, r.cleared_ts, r.cleared_by, r.esc_ts, r.notes, r.id);
  }
  flush() {
    if (!this.dirty.size) return; const ids = [...this.dirty]; this.dirty.clear();
    try { this.db.exec('BEGIN'); for (const r of this.open.values()) if (ids.includes(r.id)) this.save(r); this.db.exec('COMMIT'); }
    catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* */ } console.error('[alarms] flush', e.message); }
  }

  byId(id) { const r = this.open.get(+id); return r || this.db.prepare('SELECT * FROM alarms WHERE id = ?').get(+id); }
  addNote(row, by, text) {
    const notes = JSON.parse(row.notes || '[]'); notes.push({ ts: Date.now(), by, text: String(text).slice(0, 1000) });
    row.notes = JSON.stringify(notes.slice(-MAX_NOTES));
  }
  /** acknowledge: someone has seen it and owns it (stops the escalation) */
  ack(ids, by, note) {
    let n = 0;
    for (const id of ids) { const r = this.byId(id); if (!r || r.state !== 'open') continue; r.state = 'ack'; r.ack_by = by; r.ack_ts = Date.now(); if (note) this.addNote(r, by, note); this.save(r); n++; }
    return n;
  }
  /** delete alarm records (any state) */
  remove(ids) {
    this.flush(); let n = 0; const st = this.db.prepare('DELETE FROM alarms WHERE id = ?');
    for (const id of ids) { const r = this.byId(id); if (r && r.state !== 'cleared') this.open.delete(r.id); this.dirty.delete(id); n += Number(st.run(id).changes); }
    return n;
  }
  clear(ids, by, note) {
    let n = 0;
    for (const id of ids) { const r = this.byId(id); if (!r || r.state === 'cleared') continue; if (note) this.addNote(r, by, note); this._clear(r, by); n++; }
    return n;
  }
  note(id, by, text) { const r = this.byId(id); if (!r) return false; this.addNote(r, by, text); this.save(r); return true; }

  list({ state = 'active', q = '', sevs = null, limit = 200, offset = 0, source = '', since = 0, to = 0, sort = '' } = {}) {
    this.flush();
    const where = [], args = [];
    if (state === 'active') where.push("state != 'cleared'"); else if (state === 'escalated') where.push("state != 'cleared' AND esc_ts > 0"); else if (state === 'open' || state === 'ack' || state === 'cleared') { where.push('state = ?'); args.push(state); }
    if (source === 'syslog' || source === 'snmp') { where.push('source = ?'); args.push(source); }
    // a period keeps every alarm that existed during it: raised before its end and not cleared before its start (open alarms always count)
    if (since > 0) { where.push('(cleared_ts IS NULL OR cleared_ts = 0 OR cleared_ts >= ?)'); args.push(since); }
    if (to > 0) { where.push('first_ts <= ?'); args.push(to); }
    if (sevs && sevs.length) where.push(`severity IN (${sevs.map(() => '?').join(',')})`), args.push(...sevs);
    if (q) { where.push("(host LIKE ? ESCAPE '\\' OR rule_name LIKE ? ESCAPE '\\' OR message LIKE ? ESCAPE '\\' OR src_ip LIKE ? ESCAPE '\\')"); const like = '%' + String(q).replace(/[\\%_]/g, '\\$&') + '%'; args.push(like, like, like, like); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = this.db.prepare(`SELECT * FROM alarms ${w} ORDER BY ${orderBy(sort)} LIMIT ? OFFSET ?`).all(...args, Math.min(500, limit), Math.max(0, offset));
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM alarms ${w}`).get(...args).n;
    return { alarms: rows.map(view), total };
  }
  /** cleared alarms older than the retention period are removed so the alarm history cannot grow for ever (open alarms are never removed) */
  prune(days) {
    if (!(days > 0)) return 0; this.flush();
    return Number(this.db.prepare("DELETE FROM alarms WHERE state = 'cleared' AND cleared_ts > 0 AND cleared_ts < ?").run(Date.now() - Math.max(days, 30) * 86400000).changes) || 0;
  }
  counts() {
    const c = { open: 0, ack: 0, worstOpen: 7, latest: null };
    for (const r of this.open.values()) { if (r.state === 'open') { c.open++; if (SEVX.rank(r.severity) < SEVX.rank(c.worstOpen)) c.worstOpen = r.severity; if (!c.latest || r.first_ts > c.latest.ts) c.latest = { id: r.id, ts: r.first_ts, severity: r.severity, host: r.host, rule: r.rule_name, port: r.inst || '' }; } else c.ack++; }
    c.clearedToday = this.db.prepare("SELECT COUNT(*) AS n FROM alarms WHERE state = 'cleared' AND cleared_ts > ?").get(Date.now() - 86400000).n;
    c.refused = this.refused;
    c.openSnmp = [...this.open.values()].filter((r) => r.state === 'open' && r.source === 'snmp').length;
    c.escalated = [...this.open.values()].filter((r) => r.esc_ts).length; return c;
  }

  /** alarms raised or cleared between two moments (for reports): rows plus totals */
  between(from, to, limit = 2000) {
    this.flush();
    const w = '(first_ts BETWEEN ? AND ? OR cleared_ts BETWEEN ? AND ?)', a = [from, to, from, to];
    const rows = this.db.prepare(`SELECT * FROM alarms WHERE ${w} ORDER BY first_ts DESC LIMIT ?`).all(...a, Math.min(20000, limit)).map(view);
    const raised = this.db.prepare('SELECT COUNT(*) AS n FROM alarms WHERE first_ts BETWEEN ? AND ?').get(from, to).n;
    const cl = this.db.prepare("SELECT COUNT(*) AS n, AVG(cleared_ts - first_ts) AS avg, MAX(cleared_ts - first_ts) AS max FROM alarms WHERE state = 'cleared' AND cleared_ts BETWEEN ? AND ?").get(from, to);
    return { rows, raised, cleared: cl.n, avgClearMs: Math.round(cl.avg || 0), maxClearMs: cl.max || 0,
      bySource: this.db.prepare('SELECT source, COUNT(*) AS n FROM alarms WHERE first_ts BETWEEN ? AND ? GROUP BY source').all(from, to).map((x) => ({ source: x.source, n: x.n })) };
  }
  /** history summary for the alarm page and the dashboard: how many were raised / cleared in the period and how long they took to clear */
  summary(since = Date.now() - 86400000) {
    const raised = this.db.prepare('SELECT COUNT(*) AS n FROM alarms WHERE first_ts >= ?').get(since).n;
    // total = every alarm that was raised, cleared or is still open in the period, so it is never smaller than Active or Cleared
    const total = this.db.prepare("SELECT COUNT(*) AS n FROM alarms WHERE first_ts >= ? OR cleared_ts >= ? OR state != 'cleared'").get(since, since).n;
    const cleared = this.db.prepare("SELECT COUNT(*) AS n, AVG(cleared_ts - first_ts) AS avg, MAX(cleared_ts - first_ts) AS max FROM alarms WHERE state = 'cleared' AND cleared_ts >= ?").get(since);
    const oldest = [...this.open.values()].reduce((a, r) => (!a || r.first_ts < a.first_ts ? r : a), null);
    const escalatedPeriod = this.db.prepare('SELECT COUNT(*) AS n FROM alarms WHERE esc_ts >= ?').get(since).n;
    return { since, raised, total, escalatedPeriod, cleared: cleared.n, avgClearMs: Math.round(cleared.avg || 0), maxClearMs: cleared.max || 0, oldestOpen: oldest ? view(oldest) : null,
      bySource: this.db.prepare("SELECT source, COUNT(*) AS n FROM alarms WHERE first_ts >= ? OR cleared_ts >= ? OR state != 'cleared' GROUP BY source").all(since, since).map((x) => ({ source: x.source, n: x.n })),
      topRules: this.db.prepare('SELECT rule_name AS rule, COUNT(*) AS n FROM alarms WHERE first_ts >= ? GROUP BY rule_name ORDER BY n DESC LIMIT 5').all(since).map((x) => ({ rule: x.rule, n: x.n })),
      topDevices: this.db.prepare('SELECT host, COUNT(*) AS n FROM alarms WHERE first_ts >= ? GROUP BY host ORDER BY n DESC LIMIT 5').all(since).map((x) => ({ host: x.host, n: x.n })) };
  }

  /** the escalation e-mail: what the alarm is, how long it has been open, the other open alarms of the device and the last 24 hours at a glance */
  mailEscalation(r, now = Date.now()) {
    if (!this.mail) return;
    try {
      const sum = this.summary(now - 86400000), c = this.counts();
      const o = { title: 'Alarm not acknowledged', subtitle: `Nobody acknowledged this alarm within ${r.esc_min} minute${r.esc_min === 1 ? '' : 's'}.`, severity: r.severity, severityName: SEV[r.severity] || '', host: r.host, srcIp: r.src_ip, rule: r.rule_name, port: r.inst || '',
        state: 'Open, not acknowledged', message: r.message, source: r.source, first: r.first_ts, last: r.last_ts, count: r.count, escMin: r.esc_min, notes: JSON.parse(r.notes || '[]'),
        others: [...this.open.values()].filter((x) => x !== r && x.dev === r.dev).sort((x, y) => SEVX.rank(x.severity) - SEVX.rank(y.severity) || x.first_ts - y.first_ts).slice(0, 5).map((x) => ({ severity: x.severity, rule: x.rule_name, port: x.inst || '', since: x.first_ts })),
        sum: { raised: sum.raised, cleared: sum.cleared, open: c.open + c.ack, escalated: c.escalated, topDevices: sum.topDevices.map((x) => [x.host, x.n]), topRules: sum.topRules.map((x) => [x.rule, x.n]) } };
      if (r.esc_prof && this.notify) this.notify.dispatch(r.esc_prof.split(','), 'escalation', { o, report: r.esc_rep !== 0 });
      else this.mail.enqueueEscalation({ to: r.esc_to || '', report: r.esc_rep !== 0 }, o);
    } catch (e) { console.error('[alarms] escalation e-mail:', e.message); }
  }
  /** the recovery e-mail: an alarm that had been escalated has cleared (by hand, by a clearing rule or automatically) */
  mailRecovery(r, now = Date.now()) {
    if (!this.mail) return;
    try {
      const o = { title: 'Alarm cleared', subtitle: `This alarm was escalated and has now cleared after ${spanText(now - r.first_ts)} (${String(r.cleared_by || '').replace(/^auto: /, 'automatically: ') || 'cleared'}).`, severity: r.severity, severityName: SEV[r.severity] || '', host: r.host, srcIp: r.src_ip, rule: r.rule_name, port: r.inst || '',
        state: 'Cleared', message: r.message, source: r.source, first: r.first_ts, last: r.last_ts, count: r.count, clearedTs: now, notes: JSON.parse(r.notes || '[]'),
        others: [...this.open.values()].filter((x) => x !== r && x.dev === r.dev).sort((x, y) => SEVX.rank(x.severity) - SEVX.rank(y.severity) || x.first_ts - y.first_ts).slice(0, 5).map((x) => ({ severity: x.severity, rule: x.rule_name, port: x.inst || '', since: x.first_ts })) };
      if (r.esc_prof && this.notify) this.notify.dispatch(r.esc_prof.split(','), 'recovery', { o });
      else this.mail.enqueueRecovery({ to: r.esc_to || '' }, o);
    } catch (e) { console.error('[alarms] recovery e-mail:', e.message); }
  }
  /** open alarms that nobody acknowledged within the rule's time get one escalation e-mail */

  // ---------------- flap detection (1.40) ----------------
  // A port that goes down and up again and again would send an alert for every change. When a rule has flap detection and the same alarm key
  // (rule + device + port) changes `flapCount` times within `flapMin` minutes, ONE "(flapping)" alarm is raised and told, the single alarms and
  // their alerts stop, and the flapping alarm clears itself after `flapQuiet` quiet minutes.
  flapSettings(rule) { const a = rule?.actions || {}; const count = +a.flapCount || 0; return count >= 2 ? { count, min: Math.max(1, +a.flapMin || 10), quiet: Math.max(1, +a.flapQuiet || 15) } : null; }
  flapKey(rule, msg, alarmBy) { return rule.id + '|' + (msg.devKey || msg.srcIp) + '|' + instanceOf(msg, alarmBy ?? (rule.actions || {}).alarmBy); }
  /** a message of a rule with an alarm: 'start' (it began flapping now: alert once), true (flapping: stay quiet) or false (normal) */
  flapEvent(msg, rule) {
    const f = this.flapSettings(rule); if (!f) return false;
    this.flapCfg.set(rule.id, f); const key = this.flapKey(rule, msg), now = msg.ts || Date.now();
    const on = this.flapOn.get(key);
    if (on) { on.last = now; on.quiet = f.quiet; return true; }
    const ev = (this.flapEv.get(key) || []).filter((t) => now - t < f.min * 60000); ev.push(now); this.flapEv.set(key, ev);
    if (this.flapEv.size > 5000) for (const [k, v] of this.flapEv) if (!v.length || now - v[v.length - 1] > 3600000) this.flapEv.delete(k);
    return ev.length >= f.count ? 'start' : false;
  }
  /** a clearing message (link up) counts as a change too */
  flapClearEvent(ruleId, msg, alarmBy) {
    const f = this.flapCfg.get(ruleId); if (!f) return;
    const key = ruleId + '|' + (msg.devKey || msg.srcIp) + '|' + instanceOf(msg, alarmBy), now = msg.ts || Date.now(), on = this.flapOn.get(key);
    if (on) { on.last = now; return; }
    const ev = (this.flapEv.get(key) || []).filter((t) => now - t < f.min * 60000); ev.push(now); this.flapEv.set(key, ev);
  }
  isFlapping(ruleId, msg, alarmBy) { return this.flapOn.has(ruleId + '|' + (msg.devKey || msg.srcIp) + '|' + instanceOf(msg, alarmBy)); }
  /** raise the single flapping alarm (or refresh it) */
  flapRaise(msg, rule, start) {
    const f = this.flapSettings(rule) || { count: 0, min: 10, quiet: 15 }, key = this.flapKey(rule, msg), now = msg.ts || Date.now();
    const text = `Flapping: ${(this.flapEv.get(key) || []).length || f.count} changes within ${f.min} min. Last: ${String(msg.message).slice(0, 300)}`;
    if (start) {
      const row = this.raise({ ...msg, message: text }, { ...rule, name: `${rule.name} (flapping)` });
      if (row) { this.flapOn.set(key, { id: row.id, last: now, quiet: f.quiet }); this.flapEv.delete(key); this.addNote(row, 'system', `Flapping started: ${f.count} changes within ${f.min} minutes. Single alarms and alerts for this item stop until it is quiet for ${f.quiet} minutes.`); this.dirty.add(row.id); }
      return row;
    }
    const on = this.flapOn.get(key), row = on && this.open.get(on.id);
    if (row) { row.count++; row.last_ts = now; row.message = `Flapping: ${row.count} changes so far. Last: ${String(msg.message).slice(0, 300)}`.slice(0, 500); this.dirty.add(row.id); }
    return row || null;
  }
  flapSweep(now = Date.now()) {
    for (const [key, on] of this.flapOn) {
      const row = this.open.get(on.id);
      if (!row) { this.flapOn.delete(key); continue; }
      if (now - on.last >= (on.quiet || 15) * 60000) { this.flapOn.delete(key); this.addNote(row, 'system', `Flapping stopped: quiet for ${on.quiet || 15} minutes.`); this._clear(row, 'auto: flapping stopped', now); }
    }
  }
  escalate(now = Date.now()) {
    this.flapSweep(now);
    for (const r of [...this.open.values()]) if (r.auto_min && now - r.last_ts >= r.auto_min * 60000) this._clear(r, `auto: not repeated for ${r.auto_min} min`, now);
    const mailed = new Set(); let sent = 0;     // a burst of identical alarms sends one e-mail per rule, device and port, and at most 10 per round
    for (const r of this.open.values()) {
      if (r.state !== 'open' || !r.esc_min || r.esc_ts || now - r.first_ts < r.esc_min * 60000) continue;
      r.esc_ts = now; this.save(r);
      const k = r.rule_id + '|' + r.dev + '|' + r.inst; if (mailed.has(k) || sent >= 10) continue; mailed.add(k); sent++; this.mailEscalation(r, now); r.esc_sent = 1; this.save(r);
    }
  }
}

const ORDER = {
  severity: `CASE state WHEN 'open' THEN 0 WHEN 'ack' THEN 1 ELSE 2 END, ${SEVX.RANK_SQL}, last_ts DESC`, newest: 'first_ts DESC', oldest: 'first_ts ASC', recent: 'last_ts DESC', count: 'count DESC',
  longest: "(CASE WHEN cleared_ts > 0 THEN cleared_ts ELSE strftime('%s','now') * 1000 END) - first_ts DESC", cleared: 'cleared_ts DESC'
};
/** "raised:desc" (click on a column heading) or one of the older names above; only fixed words reach the SQL */
const SORT_COLS = { severity: SEVX.RANK_SQL, device: 'host COLLATE NOCASE', alarm: 'rule_name COLLATE NOCASE', port: 'inst COLLATE NOCASE', message: 'message COLLATE NOCASE', raised: 'first_ts', last: 'last_ts', cleared: 'cleared_ts', count: 'count', source: 'source', ack: 'ack_ts', esc: 'esc_ts', clearedby: 'cleared_by COLLATE NOCASE',
  duration: "((CASE WHEN cleared_ts > 0 THEN cleared_ts ELSE CAST(strftime('%s','now') AS INTEGER) * 1000 END) - first_ts)", state: "CASE state WHEN 'open' THEN 0 WHEN 'ack' THEN 1 ELSE 2 END", by: "(CASE WHEN state = 'cleared' THEN cleared_by ELSE ack_by END) COLLATE NOCASE" };
function orderBy(sort) {
  const m = /^([a-z]+):(asc|desc)$/.exec(String(sort || ''));
  if (m && SORT_COLS[m[1]]) { const d = m[2].toUpperCase(); return `${SORT_COLS[m[1]]} ${d}, id ${d}`; }
  return ORDER[sort] || ORDER.severity;
}
const SEV = SEVX.NAMES;
const spanText = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`; };
const view = (r) => ({ id: r.id, ruleId: r.rule_id, rule: r.rule_name, device: r.dev, host: r.host, srcIp: r.src_ip, severity: r.severity, state: r.state, first: r.first_ts, last: r.last_ts, count: r.count,
  message: r.message, logId: r.log_id, ackBy: r.ack_by, ackTs: r.ack_ts, clearedTs: r.cleared_ts, clearedBy: r.cleared_by, escalated: !!r.esc_ts, escTs: r.esc_ts || 0, escMin: r.esc_min, source: r.source || 'syslog', autoClearMin: r.auto_min || 0, port: r.inst || '', notes: JSON.parse(r.notes || '[]') });

module.exports = { AlarmStore, instanceOf };
