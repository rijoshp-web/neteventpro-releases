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
    // 1.99.10 Device view: a view with devices that send syslog draws, shows names and states, opens a device panel, and can be edited
    {
      const H = { 'content-type': 'application/json', 'X-Requested-With': 'NetEventPro' };
      const ch = (await (await fetch(B + '/api/views/choices', { headers: H })).json()).devices.filter((d) => d.src === 'dev').slice(0, 4);
      const v = await (await fetch(B + '/api/views', { method: 'POST', headers: H, body: JSON.stringify({ name: 'UI test', bg: { mode: 'grid' }, items: ch.map((c, i) => ({ kind: 'device', src: 'dev', ref: c.ref, x: 300 + i * 300, y: 400, pic: 'icon:switch' })), links: [] }) })).json();
      const e2 = errs.length; await p.goto(B + '/#devview?v=' + v.id); await sleep(3000);
      const names = await p.$$eval('.dvi .dvname', (n) => n.map((x) => x.textContent));
      check('Device view shows the placed devices with their names', names.length === ch.length && names.every((x) => x && x !== 'Device'), names.join(', '));
      const cls = await p.$$eval('.dvi', (n) => n.map((x) => [...x.classList].find((c) => c.startsWith('st-'))));
      check('Device view colours every device by its state', cls.length && cls.every(Boolean), cls.join(','));
      await p.click('.dvi .dvpic'); await sleep(1500);
      const pan = await p.evaluate(() => { const i = document.querySelector('#dvInfo'); if (!i || i.hidden) return null; const r = i.getBoundingClientRect(), c = document.querySelector('.dvwrap')?.getBoundingClientRect(); return { right: !c || r.left >= c.right - 2, text: /Open alarms/.test(i.innerText) && !/Loading/.test(i.innerText) }; });
      check('1.99.11 clicking a device opens its details panel on the right', pan?.right && pan?.text, JSON.stringify(pan));
      if (await p.evaluate(() => { const b = document.querySelector('.dvi button.dvbadge'); if (b) b.click(); return !!b; })) { await sleep(1200); const aw = await p.evaluate(() => { const m = document.querySelector('.modal'); return m ? { alarms: /Open alarms/.test(m.innerText), noReadings: !m.querySelector('.dvr, .dvrlist') } : null; });
        check('1.99.11 the alarm count opens a window with alarms only, no readings', aw?.alarms && aw?.noReadings, JSON.stringify(aw)); await closeAll(); }
      await p.click('#dvEdit'); await sleep(800); const box = await (await p.$('.dvi')).boundingBox();
      await p.mouse.move(box.x + box.width / 2, box.y + 20); await p.mouse.down(); await p.mouse.move(box.x + box.width / 2 + 100, box.y + 80, { steps: 6 }); await p.mouse.up(); await p.click('#dvSave'); await sleep(1200);
      const moved = (await (await fetch(B + '/api/views', { headers: H })).json()).views.find((x) => x.id === v.id).items[0];
      check('a device dragged in edit mode keeps its new place after Save', Math.abs(moved.x - 300) > 40 && Math.abs(moved.y - 400) > 20, `${moved.x},${moved.y}`);
      // 1.99.17 hover window, shapes, resize with the mouse, keyboard shortcuts, line types
      { const pb = await (await p.$('.dvi .dvpic')).boundingBox(); await p.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2); await sleep(1500);
        check('1.99.17 resting the mouse on a device shows a small window with its details', await p.evaluate(() => { const t = document.querySelector('#dvTip'); return !!t && !t.hidden && t.innerText.length > 5; })); await p.mouse.move(5, 5); }
      check('1.99.17 the details panel is not left on "Loading…" when nothing is selected', await p.evaluate(() => !document.querySelector('#dvInfo')));
      await p.click('#dvEdit'); await sleep(800);
      const n0 = await p.$$eval('.dvi', (x) => x.length); await p.keyboard.press('r'); await sleep(500);
      const sh = await p.evaluate(() => ({ n: document.querySelectorAll('.dvi').length, shape: !!document.querySelector('.dvi.dvshape.sel .dvsvg'), handle: !!document.querySelector('.dvi.dvshape.sel .dvrz'), side: /Shape/.test(document.querySelector('#dvSide')?.innerText || '') }));
      check('1.99.17 R adds a rectangle, selected, with its settings and a resize handle', sh.n === n0 + 1 && sh.shape && sh.handle && sh.side, JSON.stringify(sh));
      { const hb = await (await p.$('.dvi.dvshape.sel .dvrz')).boundingBox(); const w0 = await p.$eval('.dvi.dvshape.sel', (x) => x.offsetWidth); await p.mouse.move(hb.x + 6, hb.y + 6); await p.mouse.down(); await p.mouse.move(hb.x + 90, hb.y + 60, { steps: 6 }); await p.mouse.up(); await sleep(300);
        const w1 = await p.$eval('.dvi.dvshape.sel', (x) => x.offsetWidth); check('1.99.17 dragging the corner handle resizes the shape', w1 > w0 + 40, `${w0} → ${w1}`); }
      await p.keyboard.press('Control+z'); await sleep(300); await p.keyboard.press('Control+z'); await sleep(400);
      check('1.99.17 Ctrl+Z undoes the resize and the new shape', (await p.$$eval('.dvi', (x) => x.length)) === n0);
      await p.keyboard.press('Control+y'); await sleep(400); check('1.99.17 Ctrl+Y brings it back', (await p.$$eval('.dvi', (x) => x.length)) === n0 + 1);
      await p.click('#dvAddS'); await sleep(400); check('1.99.17 this server can be added to a view', await p.evaluate(() => /NetEventPro server/.test(document.querySelector('#dvSide')?.innerText || '')));
      await p.click('.dvroute[data-route="elbow"]'); await sleep(300); const ids = await p.$$eval('.dvi:not(.dvshape):not(.dvlabel)', (x) => x.slice(0, 2).map((n) => n.dataset.id));
      for (const id of ids) { await p.click(`.dvi[data-id="${id}"] .dvpic`); await sleep(300); }
      check('1.99.17 an elbow line is drawn with right angles', await p.evaluate(() => [...document.querySelectorAll('.dvlinks path.ln')].some((x) => /H[\d.]+V[\d.]+H/.test(x.getAttribute('d')) || /V[\d.]+H[\d.]+V/.test(x.getAttribute('d')))));
      await p.keyboard.press('Escape'); await p.click('#dvCancel'); await sleep(300); if (await p.$('.modal-back [data-a="yes"]')) { await p.click('.modal-back [data-a="yes"]'); await sleep(400); }
      await p.click('#dvEdit'); await sleep(800);
      check('no script errors on the Device view', errs.length === e2, errs.slice(e2, e2 + 3).join(' | '));
    }
    check('no script errors in the dashboard', !errs.length, errs.slice(0, 3).join(' | '));
  } catch (e) { check('the browser checks ran to the end', false, e.message.split('\n')[0]); }
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  srv.kill('SIGTERM'); await sleep(500); fs.rmSync(dir, { recursive: true, force: true }); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
