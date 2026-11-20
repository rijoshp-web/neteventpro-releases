'use strict';
// 1.99.2 SNMP polling as a dashboard data source, in the same shapes as messages and alarms, so every visual can show polled
// values: a number (count), values over time (series), a ranking (top) and a list. A tile picks a reading (its key), the polled
// devices (none = every device that has the reading), which instances (all, or one such as "Port 1"), how several values
// are combined (average, highest, lowest, sum, latest, number of) and, for rankings and lines, one entry per device or per instance.
const AGG = {
  avg: (v) => v.reduce((a, b) => a + b, 0) / v.length, max: (v) => Math.max(...v), min: (v) => Math.min(...v),
  sum: (v) => v.reduce((a, b) => a + b, 0), last: (v) => v[v.length - 1], count: (v) => v.length
};
const agg = (name, v) => (v.length ? (AGG[name] || AGG.avg)(v) : null);
const round = (x) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

/** the request fields of a polling tile, made safe (called by sanitizeDashRequest) */
function clean(t) {
  return {
    k: String(t.k || '').slice(0, 80), devs: (Array.isArray(t.devs) ? t.devs : []).slice(0, 200).map((x) => String(x).slice(0, 80)),
    inst: String(t.inst ?? '*').slice(0, 120), pagg: Object.hasOwn(AGG, t.pagg) ? t.pagg : 'avg', per: ['device', 'instance', 'all'].includes(t.per) ? t.per : 'device', n: Math.min(Math.max(+t.n || 10, 1), 50)
  };
}

/** the latest value of every matching device and instance: [{ dev, name, inst, v, ts }] */
function items(polling, t) {
  const want = new Set(t.devs), out = [], ks = new Set(polling.keysOf ? polling.keysOf(t.k) : [t.k]);
  for (const d of polling.devices()) {
    if (want.size && !want.has(d.id)) continue;
    const rt = polling.rt.get(d.id); if (!rt) continue;
    for (const [key, x] of rt.last) {
      const i = key.indexOf('|'), k = key.slice(0, i); if (!ks.has(k)) continue; const inst = key.slice(i + 1);
      if (t.inst !== '*' && inst !== t.inst) continue;
      if (typeof x.v !== 'number' || !Number.isFinite(x.v)) continue;
      out.push({ dev: d.id, name: d.name || d.host, k, inst, v: x.v, ts: x.ts || 0 });
    }
    // 1.99.7 a reading kept as text whose value is a number ("23.5", "Temp 23.5 C") is shown too
    if (rt.texts) for (const [key, x] of rt.texts) {
      const i = key.indexOf('|'), k = key.slice(0, i); if (!ks.has(k)) continue; const inst = key.slice(i + 1);
      if (t.inst !== '*' && inst !== t.inst) continue; if (rt.last.has(key)) continue;
      const m = /-?\d+(?:\.\d+)?/.exec(String(x.s)); if (!m) continue;
      out.push({ dev: d.id, name: d.name || d.host, k, inst, v: +m[0], ts: x.ts || 0 });
    }
  }
  return out;
}

/** 1.99.7 why a polling tile has nothing to show, in words the user can act on */
function why(polling, t) {
  const info = polling.metricInfo(t.k) || {}, name = `${info.label || t.k}${info.unit ? ' (' + info.unit + ')' : ''}`;
  const ks = new Set(polling.keysOf ? polling.keysOf(t.k) : [t.k]);
  if (!ks.size) return `No polled device has a reading named "${name}" any more.`;
  const want = new Set(t.devs), has = new Set();
  { const pids = new Set((polling.profiles ? polling.profiles() : []).filter((p) => (p.own || p.builtin === false) && p.metrics.some((m) => ks.has(m.k))).map((p) => p.id)); for (const d of polling.devices()) if (pids.has(d.profile) || pids.has('dev-' + d.id)) has.add(d.id); }   // 1.99.8 own readings or a template
  if (!String(t.k).startsWith('L:')) for (const d of polling.devices()) has.add(d.id);   // a standard value (answer time, uptime ...): every device can have it
  if (!has.size) return `No polled device uses a reading named "${name}" (it is only in a reading set that no device uses). Choose the reading your devices have, for example the name shown on the device page in SNMP polling.`;   // 1.99.10
  const devs = polling.devices().filter((d) => !want.size || want.has(d.id)), parts = [];
  const without = want.size ? devs.filter((d) => !has.has(d.id)) : [];   // only the ticked devices are worth naming
  for (const d of devs.filter((x) => has.has(x.id)).slice(0, 6)) {
    const rt = polling.rt.get(d.id), nm = d.name || d.host;
    if (d.enabled === false) parts.push(`${nm}: polling is off`);
    else if (!rt || !rt.lastTry) parts.push(`${nm}: not polled yet`);
    else if (!rt.lastOk) parts.push(`${nm}: no SNMP answer (${String(rt.error || 'no answer').slice(0, 80)})`);
    else {
      const anyKey = [...rt.last.keys(), ...(rt.texts ? rt.texts.keys() : [])].some((key) => ks.has(key.slice(0, key.indexOf('|'))));
      if (!anyKey) parts.push(`${nm}: answers${d.via ? ` (through probe ${(polling.probeName && polling.probeName(d.via)) || d.via})` : ''}, but has no value for this reading yet: open the device in SNMP polling and use Test read on the reading`);
      else if (t.inst !== '*') parts.push(`${nm}: no instance named "${t.inst}"`);
      else { const tx = rt.texts && [...rt.texts].find(([key]) => ks.has(key.slice(0, key.indexOf('|')))); parts.push(`${nm}: the value is text${tx ? ` ("${String(tx[1].s).slice(0, 40)}")` : ''}, not a number`); }
    }
  }
  if (without.length) parts.push(`${without.slice(0, 4).map((d) => d.name || d.host).join(', ')}${without.length > 4 ? ` and ${without.length - 4} more` : ''}: no reading named "${name}"`);
  return parts.length ? `No values for "${name}". ${parts.join('; ')}.` : `No values for "${name}" yet.`;
}
const groupKey = (it, per) => (per === 'instance' ? `${it.dev}|${it.inst}` : per === 'all' ? '*' : it.dev);
const groupName = (it, per, many) => (per === 'instance' ? (it.inst ? (many ? `${it.name} ${it.inst}` : it.inst) : it.name) : per === 'all' ? 'All' : it.name);

function run(polling, t, ctx) {
  const info = polling.metricInfo(t.k) || {}, unit = info.unit || '', label = info.label || t.k;
  if (!t.k) return { error: 'Choose a reading' };
  const list = items(polling, t);
  if (!list.length && t.kind !== 'series') return { ...(t.kind === 'count' || t.kind === 'distinct' ? { n: null } : { rows: [] }), unit, label, why: why(polling, t) };
  if (t.kind === 'count' || t.kind === 'distinct') {
    const v = round(agg(t.pagg, list.map((x) => x.v)));
    return { n: v, unit, label, of: list.length, at: list.reduce((m, x) => Math.max(m, x.ts), 0) };
  }
  if (t.kind === 'top') {
    const g = new Map(), devsN = new Set(list.map((x) => x.dev)).size;
    for (const it of list) { const k = groupKey(it, t.per); const e = g.get(k) || { key: k, name: groupName(it, t.per, devsN > 1), vs: [] }; e.vs.push(it.v); g.set(k, e); }
    const rows = [...g.values()].map((e) => ({ key: e.name, id: e.key, name: e.name, n: round(agg(t.pagg, e.vs)) })).filter((r) => r.n !== null).sort((a, b) => b.n - a.n);
    return { rows: rows.slice(0, t.n), total: round(rows.reduce((s, r) => s + Math.max(0, r.n), 0)), unit, label, value: true };
  }
  if (t.kind === 'list') {
    return { rows: list.sort((a, b) => a.name.localeCompare(b.name) || a.inst.localeCompare(b.inst)).slice(0, t.n).map((x) => ({ dev: x.dev, name: x.name, inst: x.inst, v: round(x.v), ts: x.ts })), unit, label };
  }
  if (t.kind === 'series') {
    const { bucketMs, firstBucket, buckets } = ctx; if (!bucketMs || !buckets) return { error: 'No time range' };
    const from = firstBucket * bucketMs, to = (firstBucket + buckets) * bucketMs;
    // the groups: one line per device / instance (at most 12, the ones with the highest latest value), or one line for all
    const g = new Map(), devsN = new Set(list.map((x) => x.dev)).size;
    for (const it of list) { const k = groupKey(it, t.per); const e = g.get(k) || { key: k, name: groupName(it, t.per, devsN > 1), parts: [], last: [] }; e.parts.push(it); e.last.push(it.v); g.set(k, e); }
    const groups = [...g.values()].sort((a, b) => (agg(t.pagg, b.last) ?? 0) - (agg(t.pagg, a.last) ?? 0)).slice(0, 12);
    const series = Array.from({ length: buckets }, () => new Array(groups.length).fill(null));
    groups.forEach((e, gi) => {
      const sums = Array.from({ length: buckets }, () => []);
      for (const it of e.parts.slice(0, 60)) for (const p of polling.series(it.dev, it.k, it.inst, from, to, buckets)) { const b = Math.floor(p.t / bucketMs) - firstBucket; if (b >= 0 && b < buckets && p.v !== null) sums[b].push(p.v); }
      sums.forEach((vs, b) => { series[b][gi] = round(agg(t.per === 'all' ? t.pagg : (t.pagg === 'count' ? 'count' : 'avg'), vs)); });
    });
    return { series, groups: groups.map((e) => e.name), unit, label, value: true, ...(list.length ? {} : { why: why(polling, t) }) };
  }
  return { error: 'This visual is not available for polled values' };
}

module.exports = { run, clean, AGG: Object.keys(AGG) };
