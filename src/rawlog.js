'use strict';
// Optional plain-text archive: one file per day (raw\syslog-YYYY-MM-DD.log), one line per message:
//   2026-10-25T09:14:03.120Z 10.0.0.5 <189>Oct 25 13:14:02 core-sw1 %LINK-3-UPDOWN: ...
// Easy to grep, tail, or ship elsewhere. The original packet text is written, before any text replacement.
const fs = require('node:fs');
const path = require('node:path');

const pad = (n) => String(n).padStart(2, '0');
const dayOf = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

class RawLog {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'raw');
    this.enabled = false; this.buf = new Map(); this.count = 0; this.lastError = '';
    this.timer = setInterval(() => this.flush(), 1000);
    this.timer.unref?.();
  }
  configure(enabled) {
    this.enabled = !!enabled;
    if (this.enabled) { try { fs.mkdirSync(this.dir, { recursive: true }); } catch (e) { this.lastError = e.message; } }
    else this.flush();
  }
  write(msg) {
    if (!this.enabled || this.count > 200000) return;
    // keep one message per line and make the file safe to view in a terminal (no control / escape characters)
    const text = String(msg.raw ?? msg.message).replace(/\r?\n/g, '\\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '?');
    const day = dayOf(msg.ts);
    let arr = this.buf.get(day); if (!arr) { arr = []; this.buf.set(day, arr); }
    arr.push(`${new Date(msg.ts).toISOString()} ${msg.srcIp} ${text}\n`);
    this.count++;
  }
  flush() {
    if (!this.buf.size) return;
    const pending = this.buf; this.buf = new Map(); this.count = 0;
    for (const [day, lines] of pending) {
      try { fs.appendFileSync(path.join(this.dir, `syslog-${day}.log`), lines.join('')); this.lastError = ''; }
      catch (e) { this.lastError = e.message; console.error('[rawlog]', e.message); }
    }
  }
  prune(retentionDays) {
    if (!(retentionDays > 0)) return 0;
    let removed = 0;
    try {
      const limit = dayOf(Date.now() - retentionDays * 86400000);
      for (const f of fs.readdirSync(this.dir)) {
        const m = /^syslog-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
        if (m && m[1] < limit) { fs.unlinkSync(path.join(this.dir, f)); removed++; }
      }
    } catch { /* folder may not exist yet */ }
    return removed;
  }
  close() { clearInterval(this.timer); this.flush(); }
}

module.exports = { RawLog };
