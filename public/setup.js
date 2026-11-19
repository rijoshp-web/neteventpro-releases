'use strict';
/* 1.98.0 First-run setup. Shown once on a new installation that has no password yet: time zone and formats, where devices send to,
   the look, and the administrator password. Every step can be skipped and everything can be changed later in Settings. */
(function () {
  const L = (k, v) => (window.T ? window.T(k, v) : k);
  const STEPS = ['welcome', 'time', 'ports', 'look', 'password'];
  function open() {
    if (document.getElementById('setupWin')) return;
    const c = (S.info && S.info.config) || {}, zone0 = (c.ntp && c.ntp.zone) || S.info.serverZone || '';
    const st = { step: 0, zone: zone0, date: c.format?.date || 'ymd', clock: c.format?.clock === '12' ? '12' : '24', udp: c.udpPort || 514, tcp: c.tcpPort || 514, theme: document.documentElement.dataset.theme || 'dark' };
    const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [];
    const w = document.createElement('div'); w.id = 'setupWin'; w.className = 'modal-back setupback';
    w.innerHTML = `<div class="modal setupwin" role="dialog" aria-modal="true" aria-labelledby="setupT"><div class="setup-steps" aria-hidden="true">${STEPS.map((s, i) => `<i data-i="${i}"></i>`).join('')}</div><div class="setup-body"></div><div class="setup-foot"><button type="button" data-a="later" class="linkish">${esc(L('setup.later'))}</button><span class="spacer"></span><button type="button" data-a="back">${esc(L('common.back'))}</button><button type="button" data-a="next" class="primary">${esc(L('common.next'))}</button></div></div>`;
    const body = () => w.querySelector('.setup-body');
    const themes = (window.NEP?.THEMES || []).slice(0, 12);
    const pages = {
      welcome: () => `<h2 id="setupT">${esc(L('setup.welcome.t'))}</h2><p>${esc(L('setup.welcome.p1'))}</p><p class="muted">${esc(L('setup.welcome.p2'))}</p>`,
      time: () => `<h2 id="setupT">${esc(L('setup.time.t'))}</h2><p class="muted">${esc(L('setup.time.p'))}</p>
        <div class="form"><div class="field"><label for="suZone">${esc(L('setup.time.zone'))}</label><div><input id="suZone" list="suZones" value="${esc(st.zone)}" class="w-md" autocomplete="off"><datalist id="suZones">${zones.map((z) => `<option value="${esc(z)}">`).join('')}</datalist>
          <div class="hint">${esc(L('setup.time.zoneHint', { z: S.info.serverZone || '–' }))}</div></div></div>
        <div class="field"><label for="suDate">${esc(L('setup.time.date'))}</label><div><select id="suDate">${[['ymd', '2026-11-19'], ['dmy', '19/11/2026'], ['mdy', '11/19/2026']].map(([k, x]) => `<option value="${k}" ${st.date === k ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
        <div class="field"><label for="suClock">${esc(L('setup.time.clock'))}</label><div><select id="suClock"><option value="24" ${st.clock === '24' ? 'selected' : ''}>14:05</option><option value="12" ${st.clock === '12' ? 'selected' : ''}>2:05 PM</option></select></div></div></div>`,
      ports: () => `<h2 id="setupT">${esc(L('setup.ports.t'))}</h2><p class="muted">${esc(L('setup.ports.p'))}</p>
        <div class="form"><div class="field"><label for="suUdp">${esc(L('setup.ports.udp'))}</label><div><input id="suUdp" type="number" min="1" max="65535" value="${st.udp}" class="w-sm"></div></div>
        <div class="field"><label for="suTcp">${esc(L('setup.ports.tcp'))}</label><div><input id="suTcp" type="number" min="1" max="65535" value="${st.tcp}" class="w-sm"></div></div>
        <div class="field"><label>${esc(L('setup.ports.snmp'))}</label><div><b>${esc(String(c.snmp?.port || 162))}</b> <span class="muted">${esc(L('setup.ports.snmpHint'))}</span></div></div></div>
        <p class="hint">${esc(L('setup.ports.hint'))}</p>`,
      look: () => `<h2 id="setupT">${esc(L('setup.look.t'))}</h2><p class="muted">${esc(L('setup.look.p'))}</p><div class="setup-themes" role="radiogroup" aria-label="${esc(L('setup.look.t'))}">${themes.map(([k, n]) => `<button type="button" role="radio" aria-checked="${k === st.theme}" data-theme-pick="${k}"><span class="sw" data-sw="${k}"></span>${esc(n)}</button>`).join('')}</div>`,
      password: () => `<h2 id="setupT">${esc(L('setup.pw.t'))}</h2><p>${esc(L('setup.pw.p'))}</p>
        <div class="form"><div class="field"><label>${esc(L('setup.pw.user'))}</label><div><b>admin</b></div></div>
        <div class="field"><label for="suPw">${esc(L('setup.pw.new'))}</label><div><input id="suPw" type="password" autocomplete="new-password" class="w-md" minlength="8"></div></div>
        <div class="field"><label for="suPw2">${esc(L('setup.pw.again'))}</label><div><input id="suPw2" type="password" autocomplete="new-password" class="w-md"></div></div></div>
        <p class="hint">${esc(L('setup.pw.hint'))}</p><p class="setup-err" role="alert"></p>`
    };
    const draw = () => {
      body().innerHTML = pages[STEPS[st.step]]();
      w.querySelectorAll('.setup-steps i').forEach((x, i) => x.classList.toggle('on', i <= st.step));
      w.querySelector('[data-a="back"]').hidden = st.step === 0;
      w.querySelector('[data-a="next"]').textContent = st.step === STEPS.length - 1 ? L('setup.finish') : st.step === 0 ? L('setup.start') : L('common.next');
      if (STEPS[st.step] === 'look') w.querySelectorAll('[data-sw]').forEach((s) => { const m = (window.NEP?.THEME_META || {})[s.dataset.sw]; if (m) s.style.background = `linear-gradient(135deg, ${m[0]} 0 45%, ${m[1]} 45% 70%, ${m[2]} 70%)`; });
      w.querySelector('[data-a="later"]').textContent = st.step === STEPS.length - 1 ? L('setup.nopw') : L('setup.later');
      const f = body().querySelector('input, select, [aria-checked="true"]'); (f || w.querySelector('[data-a="next"]')).focus();
    };
    const keep = () => {
      const v = (id) => body().querySelector('#' + id)?.value;
      if (STEPS[st.step] === 'time') { st.zone = (v('suZone') || '').trim(); st.date = v('suDate'); st.clock = v('suClock'); }
      if (STEPS[st.step] === 'ports') { st.udp = +v('suUdp') || 514; st.tcp = +v('suTcp') || 514; }
    };
    const err = (m) => { const e = body().querySelector('.setup-err'); if (e) e.textContent = m; else toast(m, true); };
    const finish = async (withPw) => {
      if (st.zone) { try { new Intl.DateTimeFormat('en', { timeZone: st.zone }); } catch { st.step = 1; draw(); return toast(L('setup.time.bad', { z: st.zone }), true); } }
      const pw = withPw ? body().querySelector('#suPw').value : '', pw2 = withPw ? body().querySelector('#suPw2').value : '';
      if (withPw) { if (pw.length < 8) return err(L('setup.pw.short')); if (pw !== pw2) return err(L('setup.pw.diff')); }
      const ntp = { ...(c.ntp || {}), zone: st.zone === (S.info.serverZone || '') ? '' : st.zone };
      try {
        const r = await api('/api/config', { method: 'PUT', body: { setupDone: true, ntp, format: { date: st.date, clock: st.clock }, udpPort: st.udp, tcpPort: st.tcp } });
        if (withPw) { await api('/api/config', { method: 'PUT', body: { adminPassword: pw } }); }
        w.remove();
        if (withPw) { toast(L('setup.done.pw')); setTimeout(() => location.reload(), 900); return; }
        S.info.config = r.config || S.info.config; S.info.firstRun = false; applyLocale(S.info); toast(L(r.restartRequired ? 'setup.done.restart' : 'setup.done'));
      } catch (e) { err(e.message); }
    };
    w.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-theme-pick]'); if (t) { st.theme = t.dataset.themePick; window.NEP?.setTheme(st.theme); w.querySelectorAll('[data-theme-pick]').forEach((b) => b.setAttribute('aria-checked', String(b === t))); return; }
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      if (a === 'later' && st.step === STEPS.length - 1) { if (await askConfirm(L('setup.nopw.q'), L('setup.nopw.ok'))) finish(false); return; }
      if (a === 'later') { if (await askConfirm(L('setup.later.q'), L('setup.later.ok'))) { try { await api('/api/config', { method: 'PUT', body: { setupDone: true } }); } catch { /* shown again next time */ } w.remove(); } return; }
      keep();
      if (a === 'back') { st.step = Math.max(0, st.step - 1); draw(); return; }
      if (a === 'next') { if (st.step < STEPS.length - 1) { st.step++; draw(); } else finish(true); }
    });
    w.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); w.querySelector('[data-a="next"]').click(); } });
    document.body.appendChild(w); draw();
  }
  window.NEPSetup = { open };
})();
