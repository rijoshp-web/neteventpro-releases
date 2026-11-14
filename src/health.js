'use strict';
// Self-monitoring: is the receiver healthy (disk space, database, listeners, delays, memory, mail)? A snapshot feeds the Health page and the
// dashboard tile; once a minute the same checks run and a change of state (OK -> warning, warning -> OK ...) is written into the log as a
// NetEventPro message, so your normal rules (colour, sound, email) can react to it. Rule tip: Device = "NetEventPro".
const fs = require('node:fs');
const os = require('node:os');

const SEV = { ok: 0, warn: 1, bad: 2 };
const worst = (a, b) => (SEV[b] > SEV[a] ? b : a);
const GB = 1073741824, MB = 1048576;

const EVERY = Math.max(200, +(process.env.NETEVENTPRO_HEALTH_INTERVAL_MS || process.env.SYSLOGPRO_HEALTH_INTERVAL_MS) || 30000);   // (shortened by the tests)

class Health {
  /** @param deps { config, store, engine, listeners } */
  constructor({ config, store, engine, listeners, traps }) {
    this.config = config; this.store = store; this.engine = engine; this.listeners = listeners; this.traps = traps;
    this.lag = []; this.lastTick = Date.now(); this.cpuPrev = process.cpuUsage(); this.cpuAt = Date.now(); this.cpuPct = 0;
    this.prev = new Map();        // check id -> { status, pending, pendingCount }
    this.fwErr = new Map();       // forwarder errors at the last look
    this.last = null; this.busy = null; this.cacheAt = 0;
    this.hist = { fast: [], slow: [] };   // system samples: every 5 s for 1 hour, every minute for 24 hours (kept in memory, restarts empty)
    this.sysPrev = this.cpuTimes(); this.netPrev = null; this.slowAcc = [];
    this.timers = [
      setInterval(() => this.tick(), 500),
      setInterval(() => this.sample().catch(() => {}), 5000),
      setInterval(() => this.check().catch((e) => console.error('[health]', e.message)), EVERY)
    ];
    for (const t of this.timers) t.unref?.();
    setTimeout(() => this.check().catch(() => {}), EVERY < 30000 ? EVERY : 20000).unref?.();
  }

  tick() {   // how late did this timer fire? A busy or frozen process fires late.
    const now = Date.now(), late0 = Math.max(0, now - this.lastTick - 500), prevTick = this.lastTick; this.lastTick = now;
    /* 1.59: a gap of 15 seconds or more is not "too busy", it is a computer that slept, a paused virtual machine or a frozen process: it is reported as that */
    const late = late0 >= 15000 ? 0 : late0; if (late0 >= 15000) { (this.suspends ||= []).push({ at: prevTick, ms: late0 + 500 }); this.suspends = this.suspends.slice(-20); }
    this.lag.push([now, late]); while (this.lag.length && this.lag[0][0] < now - 60000) this.lag.shift();
    const dt = now - this.cpuAt;
    if (dt >= 5000) { const u = process.cpuUsage(this.cpuPrev); this.cpuPct = Math.round(((u.user + u.system) / 1000) / dt * 100 / os.cpus().length * 10) / 10; this.cpuPrev = process.cpuUsage(); this.cpuAt = now; }
  }

  cpuTimes() { let idle = 0, total = 0; for (const c of os.cpus()) { for (const k in c.times) total += c.times[k]; idle += c.times.idle; } return { idle, total }; }

  /** total bytes in/out of all network interfaces from the operating system (null where it cannot be read) */
  async netBytes() {
    try {
      if (process.platform === 'linux') {
        let rx = 0, tx = 0;
        for (const l of fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)) { const [n, rest] = l.split(':'); if (!rest || n.trim() === 'lo') continue; const f = rest.trim().split(/\s+/); rx += +f[0] || 0; tx += +f[8] || 0; }
        return { rx, tx };
      }
      if (process.platform === 'win32' || process.platform === 'darwin') {
        const { execFile } = require('node:child_process');
        const out = await new Promise((res, rej) => execFile(process.platform === 'win32' ? 'netstat' : 'netstat', process.platform === 'win32' ? ['-e'] : ['-ib'], { timeout: 4000, windowsHide: true }, (e, o) => (e ? rej(e) : res(String(o)))));
        if (process.platform === 'win32') { for (const l of out.split(/\r?\n/)) { const m = l.match(/(\d[\d.,\s]*\d|\d)\s+(\d[\d.,\s]*\d|\d)\s*$/); if (m && /\d{4,}/.test(l)) return { rx: +m[1].replace(/\D/g, ''), tx: +m[2].replace(/\D/g, '') }; } }
      }
    } catch { /* not available */ }
    return null;
  }

  async sample() {
    const now = Date.now(), t = this.cpuTimes(), dT = t.total - this.sysPrev.total, dI = t.idle - this.sysPrev.idle; this.sysPrev = t;
    const cpu = dT > 0 ? Math.max(0, Math.min(100, (1 - dI / dT) * 100)) : 0;
    const totalMem = os.totalmem(), freeMem = os.freemem(), disk = this.diskInfo();
    let rxBps = null, txBps = null; const nb = await this.netBytes();
    if (nb && this.netPrev && now > this.netPrev.at) { const dt = (now - this.netPrev.at) / 1000; rxBps = Math.max(0, (nb.rx - this.netPrev.rx) / dt); txBps = Math.max(0, (nb.tx - this.netPrev.tx) / dt); }
    if (nb) this.netPrev = { ...nb, at: now };
    const smp = { t: now, cpu: Math.round(cpu * 10) / 10, mem: Math.round((1 - freeMem / totalMem) * 1000) / 10, disk: disk ? Math.round((100 - disk.freePct) * 10) / 10 : null,
      rx: rxBps === null ? null : Math.round(rxBps), tx: txBps === null ? null : Math.round(txBps), eps: this.engine.currentEps(), proc: this.cpuPct, rss: Math.round(process.memoryUsage().rss / MB), lag: this.lag.reduce((m, x) => Math.max(m, x[1]), 0) };
    this.hist.fast.push(smp); if (this.hist.fast.length > 720) this.hist.fast.shift();
    this.slowAcc.push(smp);
    const last = this.hist.slow[this.hist.slow.length - 1];
    if (!last || now - last.t >= 60000) {   // one-minute average (peak for the rates) for the 24 hour view
      const a = this.slowAcc, avg = (k) => { const v = a.map((x) => x[k]).filter((x) => x !== null); return v.length ? Math.round(v.reduce((p, c) => p + c, 0) / v.length * 10) / 10 : null; };
      this.hist.slow.push({ t: now, cpu: avg('cpu'), mem: avg('mem'), disk: avg('disk'), rx: avg('rx'), tx: avg('tx'), eps: avg('eps'), proc: avg('proc'), rss: avg('rss'), lag: Math.max(...a.map((x) => x.lag)) });
      this.slowAcc = []; if (this.hist.slow.length > 1440) this.hist.slow.shift();
    }
  }

  history(range = '1h') { return { fast: range === '24h' ? this.hist.slow : this.hist.fast.slice(-(range === '15m' ? 180 : 720)), range, stepSec: range === '24h' ? 60 : 5 }; }

  /** facts that do not change quickly: machine, operating system, processor, network cards */
  machine() {
    const c = os.cpus(), nets = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) for (const a of list || []) if (!a.internal && a.family === 'IPv4') nets.push({ name, ip: a.address, mac: a.mac });
    return { host: os.hostname(), os: `${os.type()} ${os.release()}`, arch: os.arch(), cpuModel: (c[0]?.model || '').replace(/\s+/g, ' ').trim(), cores: c.length, speedMHz: c[0]?.speed || 0, totalMemGB: Math.round(os.totalmem() / GB * 10) / 10, load: process.platform === 'win32' ? null : os.loadavg().map((x) => Math.round(x * 100) / 100), uptimeSec: Math.round(os.uptime()), nets };
  }

  diskInfo() {
    try {
      const s = fs.statfsSync(this.config.dir); const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
      return { path: this.config.dir, totalGB: total / GB, freeGB: free / GB, freePct: total ? free / total * 100 : 0 };
    } catch { return null; }
  }

  async snapshot(force = false) {
    if (!force && this.last && Date.now() - this.cacheAt < 4000) return this.last;
    if (this.busy) return this.busy;
    this.busy = this.build().then((s) => { this.last = s; this.cacheAt = Date.now(); return s; }).finally(() => { this.busy = null; });
    return this.busy;
  }

  async build() {
    const cfg = this.config.get(), eng = this.engine, st = this.store, now = Date.now();
    const mem = process.memoryUsage(); const lagMax = this.lag.reduce((m, x) => Math.max(m, x[1]), 0);
    const disk = this.diskInfo(); const ls = this.listeners?.status || { udp: {}, tcp: {} };
    let oldest = null; try { oldest = await st.oldest(); } catch { /* reader busy */ }
    const rows = st.totalRows(), usedMB = st.usedMB(), fileMB = st.sizeMB();
    const spanDays = oldest ? (now - oldest) / 86400000 : 0;
    const rowsPerDay = spanDays >= 0.04 ? rows / spanDays : null;                  // needs about an hour of history
    const bytesPerRow = rows ? usedMB * MB / rows : 0;
    const dayMB = rowsPerDay ? rowsPerDay * bytesPerRow / MB : null;
    let plateauMB = dayMB !== null && cfg.retentionDays > 0 ? dayMB * cfg.retentionDays : null;
    if (cfg.maxDbMB > 0 && (plateauMB === null || plateauMB > cfg.maxDbMB)) plateauMB = cfg.maxDbMB;
    const daysLeft = disk && dayMB && plateauMB === null ? disk.freeGB * 1024 / dayMB : null;
    const email = eng.mail.status(), fw = [...eng.forwarder.status(), ...eng.trapForwarder.status()], smtp = cfg.smtp || {};

    const checks = [];
    const add = (id, label, status, detail, alert = true) => checks.push({ id, label, status, detail, alert });
    if (disk) {
      const crit = +cfg.diskCritPercent || 5, warn = +cfg.diskWarnPercent || 15;
      const s = disk.freePct < crit ? 'bad' : disk.freePct < warn ? 'warn' : 'ok';
      add('disk', 'Free disk space', s, `${disk.freeGB.toFixed(1)} GB free of ${disk.totalGB.toFixed(0)} GB (${disk.freePct.toFixed(0)}%) on the drive holding ${disk.path}. Warning below ${warn}%, critical below ${crit}%.`);
      if (plateauMB !== null) add('disk-fit', 'Storage plan fits the disk', plateauMB / 1024 > disk.freeGB * 0.9 ? 'warn' : 'ok',
        `At the current rate the database settles around ${(plateauMB / 1024).toFixed(1)} GB (${cfg.retentionDays ? cfg.retentionDays + '-day retention' : 'no time limit'}${cfg.maxDbMB ? `, ${cfg.maxDbMB} MB cap` : ''}); ${disk.freeGB.toFixed(1)} GB is free.`);
      else if (daysLeft !== null) add('disk-fit', 'Storage plan fits the disk', daysLeft < 14 ? 'warn' : 'ok', `Retention and size are unlimited: at the current rate the disk fills in about ${Math.round(daysLeft)} days.`);
    } else add('disk', 'Free disk space', 'warn', 'Could not read the free space of the data drive.', false);
    for (const [name, key] of [['UDP', 'udp'], ['TCP', 'tcp']]) {
      const on = cfg[key + 'Enabled'], x = ls[key] || {};
      if (on) add('listen-' + key, `${name} syslog input`, x.running ? 'ok' : 'bad', x.running ? `Listening on port ${x.port}.` : `Not running${x.error ? ': ' + x.error : ''}. Devices cannot send ${name} syslog.`);
    }
    if (cfg.snmp?.enabled && this.traps) { const x = this.traps.status(); add('listen-snmp', 'SNMP trap input', x.running ? 'ok' : 'bad', x.running ? `Listening on UDP port ${x.port}.` : `Not running${x.error ? ': ' + x.error : ''}. Devices cannot send traps.`); }
    const peakQ = st.peakQueue ? st.peakQueue() : 0;
    add('store', 'Database writer', st.droppedOnOverflow > 0 ? 'bad' : (st.queue.length > 20000 || peakQ > 50000) ? 'warn' : 'ok',
      st.droppedOnOverflow > 0 ? `${st.droppedOnOverflow} messages were dropped because the disk could not keep up.` : `${st.queue.length} messages waiting to be written (the most in the last hour or two: ${peakQ}).${peakQ > 50000 ? ' The writer fell far behind during a burst: use a faster disk, keep fewer days in the database, or reduce what is sent.' : ''}`);
    const recentSus = (this.suspends || []).filter((x) => x.at + x.ms > now - 900000).pop();
    if (recentSus) { const mins = recentSus.ms / 60000; add('suspend', 'Service was suspended', 'warn', `The service did not run for ${mins >= 1 ? mins.toFixed(1) + ' minutes' : Math.round(recentSus.ms / 1000) + ' seconds'} (from ${new Date(recentSus.at).toLocaleTimeString()}): the computer slept or hibernated, a virtual machine was paused, or the process was frozen. Messages sent to this server during that time were not received and polling skipped its turns. Turn off sleep and hibernation on the server (Windows: Settings → System → Power). This notice goes away 15 minutes after the gap.`, false); }
    if (cfg.udpEnabled && ls.udp && ls.udp.running && ls.udp.wantBuf) { const got = ls.udp.recvBuf, want = ls.udp.wantBuf; add('udp-buf', 'UDP receive buffer', got && got < want * 0.9 ? 'warn' : 'ok', got ? `${(got / 1048576).toFixed(1)} MB granted by the operating system${got < want * 0.9 ? ` (${(want / 1048576).toFixed(0)} MB asked for): a burst of syslog may overflow it and packets would be lost before the service sees them. On Linux raise net.core.rmem_max; Windows normally grants it` : ''}. Change it in Settings → Network (UDP receive buffer).` : 'Size not reported by the operating system.', got && got < want * 0.9); }
    if (this.polling && this.polling.cfg.enabled !== false) {
      const pc = this.polling.capacity();
      if (pc.local > 0) add('poll-late', 'Polling keeps up', pc.late === 0 ? 'ok' : pc.late > Math.max(3, pc.local * 0.2) ? 'bad' : 'warn',
        pc.late === 0 ? `${pc.local} devices polled from this computer, all on schedule (a poll takes about ${(pc.avgPollMs / 1000).toFixed(1)} s, ${pc.workersNow} at a time).`
          : `${pc.late} of ${pc.local} devices are behind their schedule (the longest by ${pc.maxLateSec} s). Polling cannot keep up: raise "At the same time" in SNMP polling → Settings, use longer intervals or fewer readings, or poll some devices through a probe.`);
    }
    add('lag', 'Processing delay', lagMax > 2000 ? 'bad' : lagMax > 500 ? 'warn' : 'ok', `Longest pause in the last minute: ${lagMax} ms. A long pause means the service was too busy to receive messages.`);
    add('memory', 'Memory use', mem.rss > 2 * GB ? 'bad' : mem.rss > 1 * GB ? 'warn' : 'ok', `${Math.round(mem.rss / MB)} MB in use by the service.`);
    if (smtp.host) add('email', 'Email delivery', email.lastError && email.failed > 0 ? 'warn' : 'ok', email.lastError || `${email.sent || 0} sent, ${email.failed || 0} failed.`);
    for (const f of fw) {
      const k = `${f.protocol}://${f.host}:${f.port}`, before = this.fwErr.get(k) ?? f.errors; this.fwErr.set(k, f.errors);
      add('fwd-' + k, `Forwarding to ${f.name || f.host}`, f.errors > before ? 'warn' : 'ok', `${f.sent} sent, ${f.errors} errors since start.`);
    }
    if (eng.rawlog.enabled) add('rawlog', 'Plain-text log files', eng.rawlog.lastError ? 'warn' : 'ok', eng.rawlog.lastError || 'Writing daily files.');
    const silent = [...eng.devices.values()].filter((d) => d.silent).length;

    const status = checks.reduce((a, c) => worst(a, c.status), 'ok');
    return {
      at: now, status, checks,
      system: { uptimeSec: Math.round((now - eng.totals.since) / 1000), pid: process.pid, node: process.version, platform: process.platform, rssMB: Math.round(mem.rss / MB), heapMB: Math.round(mem.heapUsed / MB), cpuPct: this.cpuPct, loopLagMs: this.lag.length ? this.lag[this.lag.length - 1][1] : 0, loopLagMaxMs: lagMax, cores: os.cpus().length },
      disk,
      db: { rows, fileMB: Math.round(fileMB * 10) / 10, usedMB: Math.round(usedMB * 10) / 10, maxMB: cfg.maxDbMB, retentionDays: cfg.retentionDays, oldest, queue: st.queue.length, overflowDropped: st.droppedOnOverflow, rowsPerDay: rowsPerDay ? Math.round(rowsPerDay) : null, mbPerDay: dayMB ? Math.round(dayMB * 10) / 10 : null, plateauMB: plateauMB ? Math.round(plateauMB) : null },
      ingest: { eps: eng.currentEps(), peak: eng.totals.peakEps, received: eng.totals.received, droppedByRules: eng.totals.dropped, devices: eng.devices.size, silent, udp: ls.udp, tcp: ls.tcp },
      outputs: { email, forwarders: fw, rawLog: { enabled: eng.rawlog.enabled, error: eng.rawlog.lastError } }
    };
  }

  /** runs every 30 s; a change that lasts for two looks in a row becomes a log message (so brief blips stay quiet) */
  async check() {
    const snap = await this.snapshot(true); this.summary = { status: snap.status, warn: snap.checks.filter((c) => c.status === 'warn').length, bad: snap.checks.filter((c) => c.status === 'bad').length };
    if (this.config.get().healthAlerts === false) return;
    for (const c of snap.checks) {
      if (c.alert === false) continue;
      const p = this.prev.get(c.id) || { status: 'ok', pending: null, count: 0 };
      if (c.status === p.status) { p.pending = null; p.count = 0; }
      else if (p.pending === c.status) { p.count++; } else { p.pending = c.status; p.count = 1; }
      if (p.pending && p.count >= 2) {
        const worse = SEV[c.status] > SEV[p.status];
        if (c.status === 'ok') this.engine.internalMessage(5, `Health check recovered: ${c.label}. ${c.detail}`, 'NetEventPro', 'health');
        else this.engine.internalMessage(c.status === 'bad' ? 3 : 4, `Health check ${worse ? 'failed' : 'improved to a warning'}: ${c.label}. ${c.detail}`, 'NetEventPro', 'health');
        p.status = c.status; p.pending = null; p.count = 0;
      }
      this.prev.set(c.id, p);
    }
  }

  close() { for (const t of this.timers) clearInterval(t); }
}

module.exports = { Health };
