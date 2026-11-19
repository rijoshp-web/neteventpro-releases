'use strict';
// The user guide shown on the Help page. The text is fixed (it contains no data from messages), so it is written as HTML.
// 1.98.0: the guide text itself is in the language file (lang-en.js, window.NEP_HELP), with the other screen text.
const GUIDE = window.NEP_HELP || [];

views.help = (el) => {
  el.innerHTML = `<div class="page-head"><h1>User guide</h1><span class="muted" id="hInfo"></span></div>
    <div class="guide"><nav class="guide-toc" aria-label="Guide contents"><input type="search" id="gSearch" placeholder="Search the guide" aria-label="Search the guide">
      ${GUIDE.map((g) => `<a href="#help" data-g="${g.id}">${esc(g.title)}</a>`).join('')}</nav>
      <div class="guide-body" id="gBody">${GUIDE.map((g) => `<section class="panel guide-sec" id="g-${g.id}" data-g="${g.id}"><h2>${esc(g.title)}</h2>${g.html}</section>`).join('')}<div class="empty" id="gNone" hidden><b>Nothing found</b>Try another word.</div></div></div>`;
  const body = $('#gBody', el);
  const search = () => {
    const q = $('#gSearch', el).value.trim().toLowerCase(); let n = 0;
    for (const s of $$('.guide-sec', el)) { const hit = !q || s.textContent.toLowerCase().includes(q); s.hidden = !hit; if (hit) n++; }
    $('#gNone', el).hidden = n > 0; $('#hInfo', el).textContent = q ? `${n} section${n === 1 ? '' : 's'} match` : '';
  };
  $('#gSearch', el).oninput = search;
  el.querySelector('.guide-toc').addEventListener('click', (e) => { const a = e.target.closest('a[data-g]'); if (!a) return; e.preventDefault(); $('#gSearch', el).value = ''; search(); $('#g-' + a.dataset.g, el)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
  body.addEventListener('click', (e) => { const a = e.target.closest('a[href^="#"]'); if (a && a.getAttribute('href') !== '#help') { e.preventDefault(); location.hash = a.getAttribute('href'); } });
};
