'use strict';
// Dashboard answers about devices (1.36): count, a ranking by vendor / status / group / kind of sender, or the list of devices. Works on the device list in memory.
const status = (d) => (d.silent ? 'Silent' : d.muted ? 'Muted' : d.overdue ? 'Overdue' : d.idle ? 'Idle' : 'Reporting');
const kindOf = (d) => (d.sys && d.traps ? 'Syslog and traps' : d.traps ? 'Traps only' : 'Syslog only');
function pick(list, f = {}) {
  const st = f.dstate || 'all', host = String(f.host || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
  return list.filter((d) => {
    if (st === 'reporting' && status(d) !== 'Reporting') return false; if (st === 'silent' && !d.silent) return false; if (st === 'muted' && !d.muted) return false; if (st === 'overdue' && !d.overdue) return false;
    if (st === 'alarms' && !d.openAlarms) return false; if (st === 'syslog' && !d.sys) return false; if (st === 'trap' && !d.traps) return false;
    if (f.vendor && String(d.vendor || '').toLowerCase() !== String(f.vendor).toLowerCase()) return false; if (f.group && String(d.group || '').toLowerCase() !== String(f.group).toLowerCase()) return false;
    if (host.length && !host.some((h) => [d.host, d.alias, d.srcIp, ...(d.srcIps || [])].some((x) => String(x || '').toLowerCase().includes(h)))) return false;
    return true;
  });
}
function run(list, t) {
  const rows = pick(list, t.filter);
  if (t.kind === 'count' || t.kind === 'distinct') return { n: rows.length };
  if (t.kind === 'top') {
    const key = { vendor: (d) => d.vendor || 'Unknown', status, group: (d) => d.group || 'No group', kind: kindOf }[t.by] || ((d) => d.vendor || 'Unknown'), m = new Map();
    for (const d of rows) { const k = key(d); m.set(k, (m.get(k) || 0) + 1); }
    return { rows: [...m].sort((a, b) => b[1] - a[1]).slice(0, Math.min(25, t.n || 10)).map(([k, n]) => ({ key: k, n })), total: rows.length };
  }
  if (t.kind === 'list') return { devices: rows.sort((a, b) => (b.openAlarms || 0) - (a.openAlarms || 0) || b.lastSeen - a.lastSeen).slice(0, Math.min(50, t.n || 8)).map((d) => ({ host: d.alias || d.host || d.srcIp, srcIp: d.srcIp, vendor: d.vendor, status: status(d), lastSeen: d.lastSeen, count: d.count, openAlarms: d.openAlarms || 0, sev: d.lastSeverity })) };
  return { error: 'This visual is not available for devices' };
}
module.exports = { run, status, pick };
