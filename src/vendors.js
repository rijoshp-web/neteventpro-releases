'use strict';
// Vendor message recognisers. They read the message text and add short tags such as "cisco", "link-down" and "if:Gi1/0/1", so you can
// search `tag:link-down`, match a tag in a rule, or count events per kind. They only ever ADD tags: nothing is removed or rewritten.
//
// The patterns come from message wording these vendors are commonly seen to use. Your firmware may word things differently, so treat
// them as a starting point: a message that is not recognised simply gets no tag (add your own with a rule: "Message contains" + "Tag").

const MAX_TAGS = 4;

const FAMILIES = {
  cisco: 'Cisco IOS / IOS-XE / NX-OS',
  dell: 'Dell switches and iDRAC',
  hp: 'HP / HPE / Aruba switches',
  apc: 'APC UPS, PDU and NetBotz',
  eltek: 'Eltek power systems'
};

const clean = (s) => String(s).replace(/[,\s]+/g, '').slice(0, 40);
const ifName = (s) => { // GigabitEthernet1/0/1 -> Gi1/0/1 so the tag stays short
  const m = /^(GigabitEthernet|TenGigabitEthernet|FastEthernet|TwentyFiveGigE|HundredGigE|FortyGigabitEthernet|Ethernet|Port-channel|Vlan|Loopback|Tunnel|mgmt)(.*)$/i.exec(s);
  if (!m) return clean(s);
  const short = { gigabitethernet: 'Gi', tengigabitethernet: 'Te', fastethernet: 'Fa', twentyfivegige: 'Twe', hundredgige: 'Hu', fortygigabitethernet: 'Fo', ethernet: 'Eth', 'port-channel': 'Po', vlan: 'Vl', loopback: 'Lo', tunnel: 'Tu', mgmt: 'mgmt' }[m[1].toLowerCase()];
  return clean(short + m[2]);
};

// Each entry: [family, test(text, msg) -> array of tags or null]. Cheap prefilters keep the cost per message small.
const RULES = [
  ['cisco', (t) => {
    const m = /%([A-Z][A-Z0-9_]{1,20})-(\d)-([A-Z][A-Z0-9_]{1,30})\s*:\s*(.*)/.exec(t); if (!m) return null;
    const [, fac, , mn, rest] = m; const tags = ['cisco'];
    const up = /\bchanged state to (up|down)\b|\bis (up|down)\b/i.exec(rest), ifm = /\b((?:Gigabit|TenGigabit|Fast|TwentyFiveGig|HundredGig|FortyGigabit)?Ethernet[\d/.:]+|Gi[\d/.]+|Te[\d/.]+|Fa[\d/.]+|Po\d+|Port-channel\d+|Vlan\d+)\b/i.exec(rest);
    if ((fac === 'LINK' || fac === 'LINEPROTO' || /UPDOWN/.test(mn)) && up) tags.push(`link-${(up[1] || up[2]).toLowerCase()}`);
    else if (fac === 'SYS' && /CONFIG/.test(mn)) tags.push('config-change');
    else if (/LOGIN_FAILED|AUTHFAIL|LOGIN_Failed|AUTHENTICATION_FAIL/i.test(mn) || /login failed|authentication failed/i.test(rest)) tags.push('login-failed');
    else if (/LOGIN_SUCCESS|LOGIN_Success/i.test(mn)) tags.push('login-ok');
    else if (/^(OSPF|BGP|DUAL|EIGRP|ISIS)/.test(fac) && /ADJ|NBR/.test(mn)) tags.push(/\b(down|Idle|reset|lost)\b/i.test(rest) ? 'routing-neighbor-down' : /\b(up|Full|Established)\b/i.test(rest) ? 'routing-neighbor-up' : 'routing-neighbor');
    else if (/ERR_DISABLE|ERRDISABLE/.test(mn)) tags.push('err-disabled');
    else if (/^(SPANTREE|STP)/.test(fac)) tags.push('stp');
    else if (/^(ENVMON|PLATFORM_ENV|ENVM|C4K_CHASSIS|PLATFORM)/.test(fac) && /temp|fan|power|PS|supply/i.test(`${mn} ${rest}`)) tags.push('environment');
    else if (/CPUHOG|CPU_RISING|HIGH_CPU/i.test(mn)) tags.push('cpu-high');
    else if (/IPACCESSLOG|ACL|SEC-6/i.test(`${fac}${mn}`) && /denied/i.test(rest)) tags.push('acl-deny');
    else if (/DUPLEX|SPEED_MISMATCH|DUPLEX_MISMATCH/i.test(mn)) tags.push('duplex-mismatch');
    else if (/RELOAD|RESTART|BOOT/i.test(mn)) tags.push('reload');
    if (ifm && tags.length > 1) tags.push('if:' + ifName(ifm[1]));
    return tags;
  }],
  ['dell', (t, msg) => {
    // iDRAC / OpenManage event ids: PSU0003, TMP0118, FAN0001, VLT0200, RAC0182, SYS1003 ...
    const id = /\b(PSU|PWR|TMP|FAN|VLT|CPU|MEM|RAC|SYS|STOR|PDR|BAT|DIM|HWC|NIC|LNK|SEC|SUP|USR|LOG)(\d{4})\b/.exec(t);
    const idrac = id && /idrac|dell|server|power supply|temperature|fan|drive|memory/i.test(t);
    // Dell Networking N-series / PowerConnect: %LINK-W-Down: gi1/0/1   %STP-W-PORTSTATUS ...
    const nm = /%([A-Z_]+)-([A-Z])-([A-Za-z_]+):\s*(.*)/.exec(t);
    if (idrac) {
      const tags = ['dell']; const k = { PSU: 'power-supply', PWR: 'power', TMP: 'temperature', FAN: 'fan', VLT: 'voltage', CPU: 'cpu', MEM: 'memory', DIM: 'memory', PDR: 'disk', STOR: 'storage', BAT: 'battery' }[id[1]];
      if (k) tags.push(k); tags.push('code:' + id[1] + id[2]); return tags;
    }
    if (nm && /^(LINK|STP|DOT1X|SYSTEM|TRAPMGR)$/.test(nm[1]) && /^[WIEN]$/.test(nm[2]) && /dell|powerconnect|n\d{4}|%LINK-[WI]-(Up|Down)/i.test(`${msg.app || ''} ${msg.host} ${t}`)) {
      const tags = ['dell']; const ud = /\b(up|down)\b/i.exec(nm[3] + ' ' + nm[4]);
      if (nm[1] === 'LINK' && ud) tags.push('link-' + ud[1].toLowerCase()); else if (nm[1] === 'STP') tags.push('stp');
      const p = /\b((?:gi|te|fo|tw|po|ch)\d[\d/]*)\b/i.exec(nm[4]); if (p && tags.length > 1) tags.push('if:' + clean(p[1]));
      return tags;
    }
    return null;
  }],
  ['hp', (t, msg) => {
    // ProCurve / ArubaOS-Switch:  "port 12 is now on-line"  "FFI: port 5-Excessive Broadcasts"  "mgr: SME ..."  "auth: ..."
    const m = /\bport\s+([\w/.]+)\s+is\s+now\s+(on|off)-line/i.exec(t);
    if (m) return ['hp', 'link-' + (m[2].toLowerCase() === 'on' ? 'up' : 'down'), 'if:' + clean(m[1])];
    const hpish = /procurve|aruba|hpe|hewlett|comware|\b(ports|FFI|mgr|auth|system|stp|lacp|dhcp-snoop|sntp|ip|vlan|ospf|bgp|udld):\s/i;
    if (!hpish.test(`${msg.app || ''} ${t}`)) return null;
    if (/^\s*(ports|FFI):/i.test(t) && /excessive|broadcast|multicast|loop/i.test(t)) return ['hp', 'storm'];
    if (/\b(login|authentication)\b.*\b(fail|invalid|denied)/i.test(t)) return ['hp', 'login-failed'];
    if (/\bmgr:.*(config|saved|running)/i.test(t)) return ['hp', 'config-change'];
    if (/\b(fan|power supply|temperature)\b/i.test(t) && /(fail|fault|critical|over|high|removed)/i.test(t)) return ['hp', 'environment'];
    return /procurve|aruba|hpe|hewlett|comware/i.test(`${msg.app || ''} ${t}`) ? ['hp'] : null;
  }],
  ['apc', (t, msg) => {
    const apcish = /\bAPC\b|UPS:|NetBotz|PowerChute|Smart-?UPS|Symmetra|Rack PDU|Environment:|Battery:|Input:|Output:|Bypass:/i.test(`${msg.app || ''} ${t}`);
    if (!apcish) return null;
    const rules = [
      [/on battery|running on battery|utility power (failure|fail)|input power not acceptable|power failure/i, 'on-battery'],
      [/returned from battery|utility power restored|power restored|input power (is )?(acceptable|restored)/i, 'power-restored'],
      [/low battery|battery.*(low|depleted|exhausted)|runtime.*(low|below)/i, 'low-battery'],
      [/(battery|batteries).*(replace|bad|fail|disconnect)|replace.*battery/i, 'battery-replace'],
      [/overload/i, 'overload'],
      [/self-?test.*(fail|not passed)|failed self-?test/i, 'self-test-failed'],
      [/self-?test.*(pass|ok)/i, 'self-test-ok'],
      [/(communication|comm).*(lost|fail)|lost communication|no longer.*communicat/i, 'comm-lost'],
      [/(communication|comm).*(established|restored)/i, 'comm-restored'],
      [/temperature.*(violation|high|exceed|above)|over.?temp|high temperature/i, 'temperature-high'],
      [/humidity.*(violation|high|low|exceed)/i, 'humidity'],
      [/bypass/i, 'bypass'],
      [/(smoke|leak|door|motion|vibration|water)/i, 'sensor-alarm']
    ];
    const tags = ['apc']; for (const [re, name] of rules) if (re.test(t)) { tags.push(name); break; }
    return tags;
  }],
  ['eltek', (t, msg) => {
    const vendor = /eltek|smartpack|flatpack|powerpack|netpack|valere|minipack/i.test(`${msg.app || ''} ${msg.host} ${t}`);
    // [pattern, tag, usable without the maker's name]. Only wording that is specific to DC power plants is tagged without a vendor name,
    // so ordinary messages ("battery", "voltage") on other equipment are not mistaken for it.
    const rules = [
      [/mains?\s*(fail|failure|lost|alarm|out)\b/i, 'mains-failure', true],
      [/mains?\s*(ok|restored|returned|normal)\b/i, 'mains-restored', true],
      [/rectifier\s*\d*\s*(fail|failure|alarm|lost|missing|comm)/i, 'rectifier-fail', true],
      [/(load|battery|distribution)\s*(fuse|breaker|mcb)\s*(alarm|fail|blown|open|trip)/i, 'fuse-alarm', true],
      [/battery.*(low|disconnect|fail|alarm|test.*fail)|low battery/i, 'battery-alarm', false],
      [/(high|low|over|under)[\s-]*(dc\s*)?voltage|voltage.*(high|low)/i, 'voltage-alarm', false],
      [/(high|over)[\s-]*temp|temperature.*(high|alarm|over)/i, 'temperature-high', false],
      [/(communication|comm)\s*(lost|fail|error)|lost communication/i, 'comm-lost', false],
      [/alarm.*(cleared|ended|reset)/i, 'alarm-cleared', false]
    ];
    for (const [re, name, generic] of rules) if (re.test(t) && (vendor || generic)) return vendor ? ['eltek', name] : [name];
    return vendor ? ['eltek'] : null;
  }]
];

/** Adds tags to msg.tags (at most MAX_TAGS added in total). `enabled` is an object like { cisco: true, ... }; missing keys count as on. */
function tagMessage(msg, enabled = {}) {
  // the parser splits "%LINK-3-UPDOWN: Interface ..." into process "%LINK-3-UPDOWN" and a message, so look at both together
  if (!msg.message || msg.message.length > 4000) return;
  const text = msg.app ? `${msg.app}: ${msg.message}` : msg.message;
  const have = msg.tags || (msg.tags = []); let added = 0;
  for (const [fam, fn] of RULES) {
    if (enabled[fam] === false) continue;
    let tags; try { tags = fn(text, msg); } catch { tags = null; }
    if (!tags) continue;
    for (const t of tags) { if (added >= MAX_TAGS) return; if (!have.includes(t)) { have.push(t); added++; } }
    if (tags.length > 1 || fam === 'cisco') return;   // first family that recognises the message wins
  }
}

module.exports = { tagMessage, FAMILIES, MAX_TAGS, ifName };
