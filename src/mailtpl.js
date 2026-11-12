'use strict';
// E-mail look for alert and escalation messages: a self-contained HTML page (tables and inline styles only, so Outlook,
// Gmail and phone mail apps all show it the same way) plus the plain-text twin that is sent alongside it.

const SEV_COLORS = ['#b71c1c', '#c62828', '#d84315', '#e65100', '#f9a825', '#1565c0', '#2e7d32', '#616161', '#fb8c00', '#00897b'];
const SEV_NAMES = ['Emergency', 'Alert', 'Critical', 'Error', 'Warning', 'Notice', 'Info', 'Debug', 'Minor', 'Cleared'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const one = (s) => String(s ?? '').replace(/[\r\n\u0000]+/g, ' ').trim();
const N = (v) => Number(v || 0).toLocaleString('en-US');

/** "2026-11-01 11:16:07" in the given time zone (an IANA name), or the server's own zone */
function stamp(ts, zone) {
  if (!ts) return '';
  const d = new Date(ts); const p = (n) => String(n).padStart(2, '0');
  if (zone) { try { const f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d); const g = (t) => f.find((x) => x.type === t).value; return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')}`; } catch { /* unknown zone: use the server's */ } }
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function span(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return 'under a minute'; if (m < 90) return `${m} min`; if (m < 2880) return `${Math.round(m / 60 * 10) / 10} h`; return `${Math.round(m / 144) / 10} days`;
}

const row = (k, v, mono) => (v === '' || v === undefined || v === null ? '' : `<tr><td style="padding:7px 12px 7px 0;color:#6b7785;font-size:13px;white-space:nowrap;vertical-align:top;width:130px">${esc(k)}</td><td style="padding:7px 0;color:#1d2733;font-size:14px;${mono ? 'font-family:Consolas,Menlo,monospace;' : ''}vertical-align:top">${v}</td></tr>`);
const kpi = (label, value, color) => `<td align="center" style="padding:12px 6px;background:#f4f6f9;border-radius:8px;width:25%"><div style="font-size:22px;font-weight:700;color:${color}">${esc(N(value))}</div><div style="font-size:11px;color:#6b7785;text-transform:uppercase;letter-spacing:.04em;margin-top:2px">${esc(label)}</div></td>`;
const list = (title, items) => (items && items.length ? `<div style="font-size:12px;color:#6b7785;text-transform:uppercase;letter-spacing:.05em;margin:16px 0 6px">${esc(title)}</div><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${items.map(([a, b]) => `<tr><td style="padding:5px 0;border-bottom:1px solid #edf0f4;font-size:13px;color:#1d2733">${esc(a)}</td><td align="right" style="padding:5px 0;border-bottom:1px solid #edf0f4;font-size:13px;color:#4a5663;white-space:nowrap">${esc(b)}</td></tr>`).join('')}</table>` : '');

/**
 * @param o { kind: 'escalation'|'alert', title, subtitle, severity, host, srcIp, rule, port, state, message, source, first, last, count, escMin, rules, notes[],
 *            sum { raised, cleared, open, escalated, topDevices[[name,n]], topRules[[name,n]] }, others[{severity,host,rule,since}], link, zone, attached, attachNote, suppressed }
 */
function renderHtml(o) {
  const sev = Math.min(9, Math.max(0, +o.severity || 0)), rec = o.kind === 'recovery', col = rec ? '#2e7d32' : SEV_COLORS[sev], z = o.zone;
  const esc24 = o.kind === 'escalation';
  const details = [
    row('Device', `<b>${esc(o.host)}</b>${o.srcIp && o.srcIp !== o.host ? ` <span style="color:#6b7785">(${esc(o.srcIp)})</span>` : ''}`),
    row('Alarm', esc(o.rule)), row('Port / item', o.port ? esc(o.port) : ''),
    row('Severity', `<span style="display:inline-block;background:${col};color:#fff;border-radius:10px;padding:1px 10px;font-size:12px;font-weight:600">${esc(SEV_NAMES[sev])}</span>`),
    row('Source', o.source === 'snmp' ? 'SNMP trap' : o.source ? 'Syslog' : ''),
    row('State', o.state ? esc(o.state) : ''),
    row('Raised', o.first ? `${esc(stamp(o.first, z))} <span style="color:#6b7785">· ${rec ? 'was open for' : 'open for'} ${esc(span((rec && o.clearedTs ? o.clearedTs : Date.now()) - o.first))}</span>` : ''),
    row('Cleared', rec && o.clearedTs ? esc(stamp(o.clearedTs, z)) : ''),
    row('Last repeat', o.last && o.count > 1 ? esc(stamp(o.last, z)) : ''), row('Repeats', o.count > 1 ? `${esc(N(o.count))} times` : ''),
    row('Facility', o.facility && o.facility !== '-' ? esc(o.facility) : ''), row('Process', o.process ? esc(o.process) : ''), row('Rule', o.ruleName && o.ruleName !== o.rule ? esc(o.ruleName) : ''), row('Time', !o.first && o.time ? esc(stamp(o.time, z)) : '')
  ].join('');
  const notes = (o.notes || []).length ? `<div style="font-size:12px;color:#6b7785;text-transform:uppercase;letter-spacing:.05em;margin:16px 0 6px">Notes</div>${o.notes.slice(-3).map((n) => `<div style="font-size:13px;color:#1d2733;margin-bottom:6px"><span style="color:#6b7785">${esc(stamp(n.ts, z))} · ${esc(n.by)}</span><br>${esc(n.text)}</div>`).join('')}` : '';
  const sum = o.sum ? `<div style="font-size:12px;color:#6b7785;text-transform:uppercase;letter-spacing:.05em;margin:22px 0 8px">The last 24 hours at a glance</div>
      <table width="100%" cellpadding="0" cellspacing="6" style="border-collapse:separate"><tr>${kpi('Raised', o.sum.raised, '#1565c0')}${kpi('Cleared', o.sum.cleared, '#2e7d32')}${kpi('Open now', o.sum.open, o.sum.open ? '#c62828' : '#6b7785')}${kpi('Escalated', o.sum.escalated, o.sum.escalated ? '#e65100' : '#6b7785')}</tr></table>
      ${list('Busiest devices', (o.sum.topDevices || []).map(([a, b]) => [a, `${N(b)} alarms`]))}${list('Most frequent alarms', (o.sum.topRules || []).map(([a, b]) => [a, `${N(b)}×`]))}` : '';
  const others = (o.others || []).length ? list('Other open alarms on this device', o.others.map((x) => [`${SEV_NAMES[x.severity] || ''} · ${x.rule}${x.port ? ' · ' + x.port : ''}`, `open ${span(Date.now() - x.since)}`])) : '';
  const btn = o.link ? `<table cellpadding="0" cellspacing="0" style="margin:22px 0 4px"><tr><td style="background:${col};border-radius:6px"><a href="${esc(o.link)}" style="display:inline-block;padding:11px 22px;color:#fff;text-decoration:none;font-weight:600;font-size:14px">Open the alarm in NetEventPro</a></td></tr></table>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:#e9edf2;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e9edf2"><tr><td align="center" style="padding:24px 10px">
<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #d9dfe7">
 <tr><td style="background:${col};padding:22px 28px;color:#ffffff">
   <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.85">NetEventPro · ${esc24 ? 'Escalation' : rec ? 'Recovery' : 'Alert'}</div>
   <div style="font-size:23px;font-weight:700;margin-top:6px;line-height:1.25">${esc(o.title)}</div>
   ${o.subtitle ? `<div style="font-size:14px;margin-top:6px;opacity:.95">${esc(o.subtitle)}</div>` : ''}
 </td></tr>
 <tr><td style="padding:22px 28px 26px">
   <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${details}</table>
   <div style="font-size:12px;color:#6b7785;text-transform:uppercase;letter-spacing:.05em;margin:16px 0 6px">Message</div>
   <div style="background:#f4f6f9;border-left:4px solid ${col};border-radius:4px;padding:11px 14px;font-family:Consolas,Menlo,monospace;font-size:13px;color:#1d2733;white-space:pre-wrap;word-break:break-word">${esc(o.message)}</div>
   ${o.suppressed ? `<div style="font-size:12px;color:#6b7785;margin-top:8px">${esc(N(o.suppressed))} similar alert(s) were not e-mailed since the previous e-mail for this rule.</div>` : ''}
   ${notes}${btn}${others}${sum}
   ${o.attached ? `<div style="margin-top:20px;padding:11px 14px;background:#eaf3fe;border-radius:6px;font-size:13px;color:#1b4a7a">📎 <b>${esc(o.attached)}</b> is attached: everything that happened in the system during the last 24 hours (alarms, messages and traps).</div>` : ''}
   ${o.attachNote ? `<div style="margin-top:12px;font-size:12px;color:#8a5a00">${esc(o.attachNote)}</div>` : ''}
   ${esc24 ? '<div style="margin-top:16px;font-size:12px;color:#6b7785">Acknowledge or clear the alarm in NetEventPro to stop further escalation. You get one escalation e-mail per alarm.</div>' : ''}
 </td></tr>
 <tr><td style="background:#f4f6f9;padding:12px 28px;font-size:11px;color:#8a95a3">Sent by NetEventPro${o.zone ? ` · times in ${esc(o.zone)}` : ''}</td></tr>
</table></td></tr></table></body></html>`;
}


/** The e-mail body of a scheduled report (design "Minimal", dark). Every block is a fixed-width table (so the columns line up in Outlook, Gmail and phone apps)
 *  and a small <style> block narrows paddings and number sizes on phones. o.activeRows = [{ severity, cells: [[label, value], ...] }] in the columns of the Alarms window. */
function renderReportHtml(o) {
  const z = o.zone, al = o.alarms, err = (a) => [0, 1, 2, 3].reduce((n, i) => n + (a[i] || 0), 0);
  const C = { txt: '#e6edf5', mut: '#9fb0c3', dim: '#7d8da1', line: '#243142', red: '#ff6b6b', amb: '#ffb74d', grn: '#4cd08a', blu: '#5ab0ff', pur: '#c58bff' };
  // a row of three equal number blocks
  const trio = (items) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;border-collapse:collapse"><tr>${items.map(([v, l, c]) => `<td class="kpi" width="33%" valign="top" align="left" style="padding:6px 8px 6px 0;width:33.33%"><div class="num" style="font-size:34px;font-weight:300;color:${c};line-height:1.05;white-space:nowrap">${esc(v)}</div><div class="lbl" style="font-size:11px;color:${C.mut};text-transform:uppercase;letter-spacing:.07em;margin-top:6px;line-height:1.3">${esc(l)}</div></td>`).join('')}</tr></table>`;
  const rule = `<div style="height:1px;line-height:1px;font-size:1px;background:${C.line};margin:18px 0">&nbsp;</div>`;
  const head = (t) => `<div style="font-size:12px;color:${C.mut};text-transform:uppercase;letter-spacing:.08em;margin:0 0 8px">${esc(t)}</div>`;
  const listOf = (title, rows) => (rows && rows.length ? `<tr><td class="px" style="padding:16px 34px 0">${head(title)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed">${rows.slice(0, 5).map((r) => `<tr><td style="padding:8px 8px 8px 0;border-top:1px solid ${C.line};font-size:13px;color:${C.txt};word-break:break-word">${esc(r.key)}</td><td width="70" align="right" style="padding:8px 0;border-top:1px solid ${C.line};font-size:13px;color:${C.mut};width:70px;white-space:nowrap">${esc(N(r.n))}</td></tr>`).join('')}</table></td></tr>` : '');
  const act = (o.activeRows || []).slice(0, 8);
  // each active alarm is a card: headline = first two columns that are not the severity, then one "label  value" line per remaining column (the columns and their order are those of the Alarms window)
  const card = (a) => {
    const cells = (a.cells || []).filter(([, v]) => v !== '' && v !== undefined && v !== null), isSev = ([l]) => l === 'Severity';
    const body = cells.filter((c) => !isSev(c)), headCells = body.slice(0, 2), rest = body.slice(2);
    const col = SEV_COLORS[Math.min(9, Math.max(0, +a.severity || 0))];
    return `<tr><td style="padding:0 0 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#121a24;border-radius:8px"><tr><td width="5" style="width:5px;background:${col};border-radius:8px 0 0 8px;font-size:1px;line-height:1px">&nbsp;</td><td style="padding:10px 12px">
      <div style="font-size:14px;color:${C.txt};font-weight:600;word-break:break-word">${headCells.map(([, v]) => esc(one(v))).join(' <span style="color:' + C.dim + ';font-weight:400">·</span> ')}</div>
      ${rest.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;margin-top:6px">${rest.map(([l, v]) => `<tr><td class="alb" width="104" valign="top" style="width:104px;padding:2px 8px 2px 0;font-size:11px;color:${C.dim};text-transform:uppercase;letter-spacing:.05em">${esc(l)}</td><td valign="top" style="padding:2px 0;font-size:12px;color:${C.mut};word-break:break-word">${esc(one(v).slice(0, 220))}</td></tr>`).join('')}</table>` : ''}
    </td></tr></table></td></tr>`;
  };
  const alarms = act.length ? `<tr><td class="px" style="padding:6px 34px 0">${head('Active alarms')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${act.map(card).join('')}</table>${o.activeMore > 0 ? `<div style="font-size:12px;color:${C.dim};margin-top:2px">and ${esc(N(o.activeMore))} more in NetEventPro</div>` : ''}</td></tr>` : '';
  const avg = o.avgClearMs ? span(o.avgClearMs) : '–';
  const style = `<style>@media only screen and (max-width:620px){.wrap{width:100%!important}.px{padding-left:18px!important;padding-right:18px!important}.num{font-size:26px!important}.lbl{font-size:10px!important}.ttl{font-size:23px!important}.alb{width:84px!important}}</style>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${esc(o.title)}</title>${style}</head>
<body style="margin:0;padding:0;background:#0a0f16;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0f16"><tr><td align="center" style="padding:16px 8px">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#0e141c;border-radius:14px;overflow:hidden;border:1px solid ${C.line}">
 <tr><td class="px" style="padding:30px 34px 6px;color:${C.txt}"><div style="font-size:12px;color:${C.dim};letter-spacing:.14em;text-transform:uppercase">NetEventPro</div><div class="ttl" style="font-size:28px;font-weight:300;margin-top:8px;line-height:1.2;word-break:break-word">${esc(o.title)}</div><div style="font-size:13px;color:${C.mut};margin-top:6px;line-height:1.5">${esc(stamp(o.from, z))}<br>to ${esc(stamp(o.to, z))}</div></td></tr>
 ${o.intro ? `<tr><td class="px" style="padding:12px 34px 0;font-size:14px;line-height:1.5;color:${C.txt};white-space:pre-wrap">${esc(o.intro)}</td></tr>` : ''}
 <tr><td class="px" style="padding:18px 34px 6px">${trio([[N(al ? al.open + al.ack : 0), 'Active alarms', (al && al.open + al.ack) ? C.red : C.grn], [N(o.total), 'Syslog', C.blu], [N(o.trapTotal), 'SNMP traps', C.pur]])}${rule}
   ${trio([[N(o.raised), 'Alarms raised', C.blu], [N(o.cleared), 'Cleared', C.grn], [avg, 'Average to clear', C.amb]])}${rule}
   ${trio([[N(err(o.sevN) + err(o.trapSev)), 'Errors and worse', C.red], [N((o.sevN[4] || 0) + (o.trapSev[4] || 0)), 'Warnings', C.amb], [N(Math.max(o.devices || 0, o.trapDevices || 0)), 'Devices', C.txt]])}</td></tr>
 ${alarms}${listOf('Busiest devices', o.hosts)}${listOf('Busiest processes', o.apps)}
 ${o.attached ? `<tr><td class="px" style="padding:20px 34px 0"><div style="padding:11px 14px;background:#1b2735;border-radius:6px;font-size:13px;color:${C.mut};word-break:break-word">📎 Attached: <b>${esc(o.attached)}</b></div></td></tr>` : ''}
 <tr><td style="height:24px;line-height:24px;font-size:1px">&nbsp;</td></tr>
 <tr><td class="px" style="background:#151d28;padding:12px 34px;font-size:11px;color:${C.dim}">Sent by NetEventPro${z ? ` · times in ${esc(z)}` : ''}</td></tr>
</table></td></tr></table></body></html>`;
}

/** the plain-text twin of the report e-mail */
function renderReportText(o) {
  const al = o.alarms, err = (a) => [0, 1, 2, 3].reduce((n, i) => n + (a[i] || 0), 0);
  return [o.intro || `Report: ${o.title}`, `Period: ${stamp(o.from, o.zone)} to ${stamp(o.to, o.zone)}`, '',
    `ALARMS   active ${al ? al.open : 0}, acknowledged ${al ? al.ack : 0}, raised ${o.raised}, cleared ${o.cleared}`,
    `SYSLOG   ${o.total} messages, ${err(o.sevN)} errors and worse, ${o.sevN[4]} warnings, ${o.devices} devices`,
    `TRAPS    ${o.trapTotal} traps, ${err(o.trapSev)} errors and worse, ${o.trapSev[4]} warnings, ${o.trapDevices} devices`,
    '', o.attached ? `Attached: ${o.attached}` : 'The report is attached.', '', '--', 'Sent by NetEventPro'].join('\r\n');
}

/** the plain-text version (for mail apps that do not show HTML) */
function renderText(o) {
  const z = o.zone; const L = [];
  L.push(o.title.toUpperCase()); if (o.subtitle) L.push(o.subtitle); L.push('');
  const kv = (k, v) => { if (v !== '' && v !== undefined && v !== null) L.push(`${(k + ':').padEnd(13)}${v}`); };
  kv('Device', one(o.host) + (o.srcIp && o.srcIp !== o.host ? ` (${one(o.srcIp)})` : '')); kv('Alarm', one(o.rule)); kv('Port / item', one(o.port)); kv('Severity', `${SEV_NAMES[Math.min(9, Math.max(0, +o.severity || 0))]} (${o.severity})`);
  kv('Facility', o.facility && o.facility !== '-' ? o.facility : ''); kv('Process', o.process); kv('Source', o.source === 'snmp' ? 'SNMP trap' : o.source ? 'Syslog' : ''); kv('State', one(o.state));
  kv('Raised', o.first ? `${stamp(o.first, z)} (${o.kind === 'recovery' ? 'was open for' : 'open for'} ${span((o.kind === 'recovery' && o.clearedTs ? o.clearedTs : Date.now()) - o.first)})` : o.time ? stamp(o.time, z) : ''); kv('Cleared', o.kind === 'recovery' && o.clearedTs ? stamp(o.clearedTs, z) : ''); kv('Last repeat', o.last && o.count > 1 ? stamp(o.last, z) : ''); kv('Repeats', o.count > 1 ? `${o.count} times` : '');
  L.push('', 'Message:', String(o.message ?? ''));
  if (o.suppressed) L.push('', `(${o.suppressed} similar alert(s) were not e-mailed since the previous e-mail for this rule.)`);
  if ((o.notes || []).length) { L.push('', 'Notes:'); for (const n of o.notes.slice(-3)) L.push(`  ${stamp(n.ts, z)} ${n.by}: ${n.text}`); }
  if ((o.others || []).length) { L.push('', 'Other open alarms on this device:'); for (const x of o.others) L.push(`  ${SEV_NAMES[x.severity] || ''} - ${x.rule}${x.port ? ' - ' + x.port : ''} (open ${span(Date.now() - x.since)})`); }
  if (o.sum) { L.push('', 'Last 24 hours:', `  raised ${o.sum.raised}, cleared ${o.sum.cleared}, open now ${o.sum.open}, escalated ${o.sum.escalated}`); }
  if (o.attached) L.push('', `Attached: ${o.attached} (everything that happened in the last 24 hours).`);
  if (o.attachNote) L.push(o.attachNote);
  if (o.link) L.push('', o.link);
  L.push('', '--', 'Sent by NetEventPro');
  return L.join('\r\n');
}

module.exports = { renderHtml, renderText, renderReportHtml, renderReportText, stamp, span, SEV_NAMES };
