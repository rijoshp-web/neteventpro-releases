'use strict';
// A small PDF writer (no dependencies): A4 landscape pages, built-in Helvetica / Courier fonts, filled rectangles and text.
// Text is converted to Latin-1; characters outside it are shown as "?".
const zlib = require('node:zlib');

const W = 842, H = 595;
const fix = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/[^ -ÿ]/g, '?').replace(/[\\()]/g, '\\$&');
const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); if (!m) return '0 0 0'; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => (x / 255).toFixed(3)).join(' '); };
// approximate Helvetica character widths (1/1000 em) for fitting text; Courier is 600
const HW = (ch) => ('il.,;:\'|!'.includes(ch) ? 270 : 'fjtI()[]- '.includes(ch) ? 300 : 'mwMW%'.includes(ch) ? 830 : /[A-Z0-9]/.test(ch) ? 640 : 520);
const widthOf = (s, size, font) => (font === 'F3' ? s.length * 0.6 * size : [...s].reduce((n, ch) => n + HW(ch), 0) * size / 1000 * (font === 'F2' ? 1.06 : 1));

class Pdf {
  constructor() { this.pages = []; this.cur = null; this.newPage(); }
  newPage() { this.cur = []; this.pages.push(this.cur); return this.pages.length; }
  /** y is measured from the TOP of the page */
  rect(x, y, w, h, color) { this.cur.push(`${hex(color)} rg ${x.toFixed(2)} ${(H - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`); }
  /** filled polygon, points [[x,y],...] in page coordinates (top-left origin) */
  poly(pts, color) { if (pts.length < 3) return; this.cur.push(`${hex(color)} rg ` + pts.map(([x, y], i) => `${x.toFixed(2)} ${(H - y).toFixed(2)} ${i ? 'l' : 'm'}`).join(' ') + ' h f'); }
  /** rounded rectangle; fill colour and/or an outline colour */
  rrect(x, y, w, h, r, fill, stroke) {
    r = Math.min(r, w / 2, h / 2); const k = r * 0.5523, Y = (v) => (H - v).toFixed(2), X = (v) => v.toFixed(2), x2 = x + w, y2 = y + h;
    const path = `${X(x + r)} ${Y(y)} m ${X(x2 - r)} ${Y(y)} l ${X(x2 - r + k)} ${Y(y)} ${X(x2)} ${Y(y + r - k)} ${X(x2)} ${Y(y + r)} c ${X(x2)} ${Y(y2 - r)} l ${X(x2)} ${Y(y2 - r + k)} ${X(x2 - r + k)} ${Y(y2)} ${X(x2 - r)} ${Y(y2)} c ${X(x + r)} ${Y(y2)} l ${X(x + r - k)} ${Y(y2)} ${X(x)} ${Y(y2 - r + k)} ${X(x)} ${Y(y2 - r)} c ${X(x)} ${Y(y + r)} l ${X(x)} ${Y(y + r - k)} ${X(x + r - k)} ${Y(y)} ${X(x + r)} ${Y(y)} c h`;
    this.cur.push(`${fill ? hex(fill) + ' rg ' : ''}${stroke ? hex(stroke) + ' RG 0.7 w ' : ''}${path} ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
  }
  line(x1, y1, x2, y2, color = '#cccccc', wd = 0.5) { this.cur.push(`${hex(color)} RG ${wd} w ${x1.toFixed(2)} ${(H - y1).toFixed(2)} m ${x2.toFixed(2)} ${(H - y2).toFixed(2)} l S`); }
  text(x, y, str, { size = 10, font = 'F1', color = '#111111', max = 0 } = {}) {
    let s = String(str ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ');
    if (max) { while (s.length > 1 && widthOf(s, size, font) > max) s = s.slice(0, -1); if (s.length < String(str ?? '').length) s = s.slice(0, -1) + '…'; }
    this.cur.push(`BT /${font} ${size} Tf ${hex(color)} rg ${x.toFixed(2)} ${(H - y - size * 0.8).toFixed(2)} Td (${fix(s.replace('…', '...'))}) Tj ET`);
  }
  textRight(xr, y, str, o = {}) { this.text(xr - widthOf(String(str), o.size || 10, o.font || 'F1'), y, str, o); }
  build() {
    const objs = []; const add = (body) => { objs.push(body); return objs.length; };
    const catalog = add(null), pagesObj = add(null);
    const fonts = ['Helvetica', 'Helvetica-Bold', 'Courier'].map((f) => add(`<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`));
    const kids = [];
    this.pages.forEach((ops, i) => {
      const body = zlib.deflateSync(Buffer.from(ops.join('\n'), 'latin1'));
      const cs = add({ stream: body, dict: '/Filter /FlateDecode' });
      kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${fonts[0]} 0 R /F2 ${fonts[1]} 0 R /F3 ${fonts[2]} 0 R >> >> /Contents ${cs} 0 R >>`));
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')]; const offs = []; let pos = chunks[0].length;
    objs.forEach((o, i) => {
      offs.push(pos);
      const b = typeof o === 'string' ? Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1')
        : Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< /Length ${o.stream.length} ${o.dict} >>\nstream\n`, 'latin1'), o.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
      chunks.push(b); pos += b.length;
    });
    let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    xref += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
    chunks.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(chunks);
  }
}

module.exports = { Pdf, W, H, widthOf };
