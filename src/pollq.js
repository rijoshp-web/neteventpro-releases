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
  }
  return out;
}
const groupKey = (it, per) => (per === 'instance' ? `${it.dev}|${it.inst}` : per === 'all' ? '*' : it.dev);
const groupName = (it, per, many) => (per === 'instance' ? (it.inst ? (many ? `${it.name} ${it.inst}` : it.inst) : it.name) : per === 'all' ? 'All' : it.name);

function run(polling, t, ctx) {
  const info = polling.metricInfo(t.k) || {}, unit = info.unit || '', label = info.label || t.k;
  if (!t.k) return { error: 'Choose a reading' };
  const list = items(polling, t);
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
    return { series, groups: groups.map((e) => e.name), unit, label, value: true };
  }
  return { error: 'This visual is not available for polled values' };
}

module.exports = { run, clean, AGG: Object.keys(AGG) };
