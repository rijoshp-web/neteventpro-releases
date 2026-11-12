'use strict';
// "Accept syslog only from these sources": list of IPv4 addresses, IPv4 CIDR ranges (10.0.0.0/24) or exact IPv6 addresses.

function ip4ToInt(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s));
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((x) => x > 255)) return null;
  return (((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0);
}
const looksIPv6 = (s) => /^[0-9a-fA-F:]+$/.test(s) && s.includes(':') && s.length <= 45;

function parseEntry(entry) {
  const e = String(entry).trim();
  if (!e) return null;
  const [addr, bitsStr] = e.split('/');
  if (bitsStr !== undefined) {
    const bits = /^\d{1,2}$/.test(bitsStr) ? +bitsStr : -1;
    const n = ip4ToInt(addr);
    if (n === null || bits < 0 || bits > 32) return { error: e };
    const mask = bits === 0 ? 0 : ((~0 << (32 - bits)) >>> 0);
    return { net: (n & mask) >>> 0, mask };
  }
  const n = ip4ToInt(addr);
  if (n !== null) return { net: n, mask: 0xffffffff };
  if (looksIPv6(addr)) return { v6: addr.toLowerCase() };
  return { error: e };
}

class SourceFilter {
  constructor() { this.v4 = []; this.v6 = new Set(); }
  static validate(list) {
    return (list || []).map((x) => ({ x, p: parseEntry(x) })).filter((r) => r.p && r.p.error).map((r) => r.x);
  }
  load(list) {
    this.v4 = []; this.v6 = new Set();
    for (const entry of list || []) {
      const p = parseEntry(entry);
      if (!p || p.error) continue;
      if (p.v6) this.v6.add(p.v6); else this.v4.push(p);
    }
  }
  get active() { return this.v4.length > 0 || this.v6.size > 0; }
  allows(ip) {
    if (!this.active) return true;
    const n = ip4ToInt(ip);
    if (n !== null) return this.v4.some((r) => ((n & r.mask) >>> 0) === r.net);
    return this.v6.has(String(ip).toLowerCase());
  }
}

module.exports = { SourceFilter, ip4ToInt };
