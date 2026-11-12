'use strict';
const test = require('node:test'); const assert = require('node:assert');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { Probe, ProbeRegistry } = require('../src/probe');
const mkcfg = (d) => { let data = { mode: 'probe', probe: { server: '', token: '' }, probes: [], ...d }; return { get: () => data, update: (p) => { data = { ...data, ...p }; } }; };

test('registry: token is shown once, only its hash is kept, and it can be found again', () => {
  const cfg = mkcfg({}); const reg = new ProbeRegistry(cfg); const r = reg.create('Site-B');
  assert.match(r.token, /^nep_/); assert.ok(!JSON.stringify(cfg.get().probes).includes(r.token));
  assert.equal(reg.find(r.token).name, 'Site-B'); assert.equal(reg.find(r.token + 'x'), null); assert.equal(reg.find('nep_nothing_at_all'), null);
  reg.remove(r.id); assert.equal(reg.find(r.token), null);
});
test('probe: packets are queued with sender and time, and the queue survives a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-')); const cfg = mkcfg({});
  const p = new Probe(cfg, dir); p.add('s', Buffer.from('<13>hello'), '10.1.1.1'); p.addSyslog(Buffer.from('<13>second'), '10.1.1.2');
  assert.equal(p.q.length, 2); assert.equal(p.q[0].ip, '10.1.1.1'); assert.equal(Buffer.from(p.q[0].b, 'base64').toString(), '<13>hello'); p.shutdown();
  const p2 = new Probe(cfg, dir); assert.equal(p2.q.length, 2); p2.shutdown(); fs.rmSync(dir, { recursive: true, force: true });
});
