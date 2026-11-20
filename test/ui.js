'use strict';
// 1.99.7 Dashboard browser checks, run before every release:  npm run test:ui   (exit code 1 if anything fails)
// Starts a throw-away NetEventPro (own data folder, ports 5536/8536), sends syslog that raises alarms, then drives the dashboard editor
// in a real browser (Playwright, a build-time tool only: the app itself has no dependencies). It checks what users reported:
//  - every visual with every data source draws in the editor preview (no script error, no "Loading…" that never ends)
//  - switching between all visuals never breaks the tile
//  - a "Number with trend line" and a "Number" with the same Show give the same number, also after switching back and forth
//  - the severity picker opened inside a dialog is drawn above the dialog and inside the window
//  - with the Crimson glass theme the visual gallery cards are rounded rectangles, not circles
let chromium; try { ({ chromium } = require('playwright')); } catch { console.log('SKIP  Playwright is not installed on this computer'); process.exit(0); }
const { spawn } = require('node:child_process');
const dgram = require('node:dgram'); const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');

const ROOT = path.resolve(__dirname, '..'), UDP = 5536, WEB = 8536, SNMP = 5183, B = `http://127.0.0.1:${WEB}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-'));
const results = []; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  setupDone: true, adminPasswordHash: '',
  rules: [{ id: 'uilink', name: 'Link down', enabled: true, source: 'syslog', match: { text: 'LINKDOWN' }, actions: { alarm: true } }]
}));

(async () => {
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--require', './test/license-hook.js', 'src/server.js'], {
    cwd: ROOT, env: { ...process.env, NETEVENTPRO_DATA: dir, NETEVENTPRO_UDP_PORT: UDP, NETEVENTPRO_TCP_PORT: UDP, NETEVENTPRO_WEB_PORT: WEB, NETEVENTPRO_SNMP_PORT: SNMP }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/health')).status) break; } catch { /* not yet */ } await sleep(250); }
  const sock = dgram.createSocket('udp4');
  for (let i = 0; i < 40; i++) await new Promise((r) => sock.send(`<${i % 3 === 0 ? 11 : 14}>Nov 20 09:00:00 sw-${i % 6} app: ${i % 2 ? 'LINKDOWN port ' + i : 'hello ' + i}`, UDP, '127.0.0.1', r));
  sock.close(); await sleep(2500);

  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e.stack || e.message).split('\n').slice(0, 2).join(' / ')));
  const stage = () => p.evaluate(() => document.querySelector('#peStage')?.innerText.replace(/\s+/g, ' ').trim() || '');
  const closeAll = () => p.evaluate(() => document.querySelectorAll('.modal-back,.popover').forEach((x) => x.remove()));
  const addTile = async () => { await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Add tile').click()); await sleep(350); };
  const vis = (v) => p.evaluate((v) => document.querySelector(`button[data-vis="${v}"]`).click(), v);
  try {
    await p.goto(B + '/#dashboard'); await p.evaluate(() => { localStorage.setItem('sp.theme', 'crimson'); localStorage.setItem('sp.glass', '1'); }); await p.reload(); await sleep(2500);
    await p.evaluate(() => document.querySelector('#dEdit').click()); await sleep(300);

    // the gallery cards in Crimson glass
    await addTile(); const rad = await p.$eval('button.vcard', (v) => parseFloat(getComputedStyle(v).borderRadius));
    check('Crimson glass: the visual gallery cards are rounded rectangles, not circles', rad > 0 && rad < 40, rad + 'px');
    const types = await p.$$eval('button.vcard', (bs) => bs.map((x) => x.dataset.type)); await closeAll();

    // every visual with every data source
    const stuck = [], e0 = errs.length;
    for (const ty of types) {
      await addTile(); await p.click(`button.vcard[data-type="${ty}"]`); await sleep(250);
      const dss = await p.$$eval('button.dscard', (bs) => bs.map((x) => x.dataset.ds));
      if (!dss.length) { await sleep(2500); const st = await stage(); if (/Loading…/.test(st)) stuck.push(ty); await closeAll(); continue; }
      await closeAll();
      for (const ds of dss) {
        await addTile(); await p.click(`button.vcard[data-type="${ty}"]`); await sleep(200); await p.click(`button.dscard[data-ds="${ds}"]`); await sleep(2200);
        if (/Loading…/.test(await stage())) stuck.push(`${ty}/${ds}`); await closeAll();
      }
    }
    check('every visual with every data source draws in the preview', !stuck.length && errs.length === e0, [...stuck, ...errs.slice(e0)].join(' | ').slice(0, 300));

    // switching through all visuals
    const e1 = errs.length, bad = [];
    for (const ds of ['alarms', 'syslog', 'devices', 'poll']) {
      await addTile(); await p.click('button.vcard[data-type="bar"]'); await p.click(`button.dscard[data-ds="${ds}"]`); await sleep(800);
      const all = await p.$$eval('button[data-vis]', (bs) => bs.map((x) => x.dataset.vis));
      for (const v of [...all, ...all.slice().reverse()]) { await vis(v); await sleep(600); if (/Loading…/.test(await stage())) { await sleep(1500); if (/Loading…/.test(await stage())) bad.push(`${ds}/${v}`); } }
      await closeAll();
    }
    check('switching between all visuals keeps every tile working', !bad.length && errs.length === e1, [...bad, ...errs.slice(e1)].join(' | ').slice(0, 300));

    // the same Show gives the same number in both number visuals
    await addTile(); await p.click('button.vcard[data-type="statspark"]'); await p.click('button.dscard[data-ds="alarms"]'); await sleep(1500);
    const num = () => p.evaluate(() => document.querySelector('#peStage .num')?.innerText || '');
    const diffs = [];
    for (const m of ['alRaised', 'alActive', 'alOpen', 'alAck', 'alEsc', 'alCleared']) {
      await p.selectOption('select[data-p="cfg.metric"]', m); await sleep(1300); const a = await num();
      await vis('kpi'); await sleep(1300); const km = await p.$eval('select[data-p="cfg.metric"]', (s) => s.value); const k = await num();
      await vis('statspark'); await sleep(1300); const bm = await p.$eval('select[data-p="cfg.metric"]', (s) => s.value); const a2 = await num();
      if (!(a && a === k && k === a2 && km === m && bm === m)) diffs.push(`${m}: trend ${a} / number ${km} ${k} / back ${bm} ${a2}`);
    }
    const whichShown = !!(await p.$('select[data-p="cfg.filter.astate"]'));
    check('Number with trend line and Number show the same alarm number for the same Show', !diffs.length, diffs.join(' | '));
    check('Number with trend line has no second, conflicting "Which alarms" choice', !whichShown);

    // the severity picker inside a dialog
    await vis('top'); await sleep(800);
    await p.evaluate(() => { const b = document.querySelector('.modal [id$="mSevBtn"]'); const det = b?.closest('details'); if (det) det.open = true; b?.scrollIntoView({ block: 'end' }); });
    await sleep(300); await p.evaluate(() => document.querySelector('.modal [id$="mSevBtn"]')?.click()); await sleep(400);
    const pv = await p.evaluate(() => { const pop = document.querySelector('.popover'); if (!pop) return null; const r = pop.getBoundingClientRect(); return { top: pop.contains(document.elementFromPoint(r.left + 30, r.top + 30)), inside: r.top >= 0 && r.bottom <= innerHeight + 1 }; });
    check('the severity picker in a dialog is drawn above the dialog', pv?.top, JSON.stringify(pv));
    check('the severity picker stays inside the window', pv?.inside, JSON.stringify(pv));
    await closeAll();
    check('no script errors in the dashboard', !errs.length, errs.slice(0, 3).join(' | '));
  } catch (e) { check('the browser checks ran to the end', false, e.message.split('\n')[0]); }
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  srv.kill('SIGTERM'); await sleep(500); fs.rmSync(dir, { recursive: true, force: true }); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
