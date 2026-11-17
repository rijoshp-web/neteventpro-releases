/* Small QR code maker (byte mode, error correction M, versions 1-16), no libraries. window.QR.svg(text) returns an <svg> string; window.QR.matrix(text) the dark/light grid. */
(() => {
  'use strict';
  const ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28], BLK = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10];
  const raw = (v) => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; };
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
  const rs = (data, n) => {
    let g = [1]; for (let i = 0; i < n; i++) { const h = new Array(g.length + 1).fill(0); g.forEach((c, j) => { h[j] ^= c; h[j + 1] ^= mul(c, EXP[i]); }); g = h; }
    const r = new Array(n).fill(0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); for (let i = 0; i < n; i++) r[i] ^= mul(g[i + 1], f); }
    return r;
  };
  function matrix(text) {
    const bytes = [...new TextEncoder().encode(String(text))];
    let ver = 1; for (; ver <= 16; ver++) { const cap = Math.floor(raw(ver) / 8) - ECC[ver] * BLK[ver]; if (bytes.length + (ver < 10 ? 2 : 3) <= cap) break; }
    if (ver > 16) throw new Error('Text too long for the QR code');
    const bits = []; const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach((b) => put(b, 8));
    const total = Math.floor(raw(ver) / 8), dataLen = total - ECC[ver] * BLK[ver];
    for (let i = 0; i < 4 && bits.length < dataLen * 8; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const cw = []; for (let i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let pad = 0xec; cw.length < dataLen; pad ^= 0xec ^ 0x11) cw.push(pad);
    const nb = BLK[ver], short = nb - (total % nb), shortLen = Math.floor(total / nb), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) { const d = cw.slice(k, k + shortLen - ECC[ver] + (i < short ? 0 : 1)); k += d.length; blocks.push({ d, e: rs(d, ECC[ver]) }); }
    const all = []; for (let i = 0; i < blocks[nb - 1].d.length; i++) blocks.forEach((b, j) => { if (i < b.d.length) all.push(b.d[i]); });
    for (let i = 0; i < ECC[ver]; i++) blocks.forEach((b) => all.push(b.e[i]));
    const size = ver * 4 + 17, m = Array.from({ length: size }, () => new Array(size).fill(false)), fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, d) => { if (x >= 0 && y >= 0 && x < size && y < size) { m[y][x] = d; fn[y][x] = true; } };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(cx + dx, cy + dy, d !== 2 && d !== 4); }
    const na = ver === 1 ? 0 : Math.floor(ver / 7) + 2, step = ver === 1 ? 0 : Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2, pos = ver === 1 ? [] : [6]; for (let p = size - 7; pos.length < na; p -= step) pos.splice(1, 0, p);
    for (let a = 0; a < pos.length; a++) for (let b = 0; b < pos.length; b++) { if ((a === 0 && b === 0) || (a === 0 && b === na - 1) || (a === na - 1 && b === 0)) continue; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[a] + dx, pos[b] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
    const fmt = (mask) => {
      let d = (0 << 3) | mask, r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const f = ((d << 10) | r) ^ 0x5412, bit = (i) => ((f >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i)); set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8)); for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i)); for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i)); set(8, size - 8, true);
    };
    fmt(0);
    if (ver >= 7) { let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25); const v = (ver << 12) | r; for (let i = 0; i < 18; i++) { const d = ((v >>> i) & 1) === 1, a = size - 11 + (i % 3), b = Math.floor(i / 3); set(a, b, d); set(b, a, d); } }
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) { if (right === 6) right = 5; for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) { const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v; if (!fn[y][x] && i < all.length * 8) { m[y][x] = ((all[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; } } }
    const MASK = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0, (x, y) => ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0, (x, y) => ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0];
    const apply = (k) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASK[k](x, y)) m[y][x] = !m[y][x]; };
    const penalty = () => {
      let p = 0, dark = 0;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { if (m[y][x]) dark++; if (x < size - 1 && y < size - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3; }
      for (let t = 0; t < 2; t++) for (let a = 0; a < size; a++) { let run = 1; for (let b = 1; b < size; b++) { const c = t ? m[b][a] : m[a][b], q = t ? m[b - 1][a] : m[a][b - 1]; if (c === q) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
      return p + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    };
    let best = 0, bp = Infinity; for (let k = 0; k < 8; k++) { apply(k); const p = penalty(); apply(k); if (p < bp) { bp = p; best = k; } }
    apply(best); fmt(best);
    return m;
  }
  function svg(text, px = 4) {
    const m = matrix(text), n = m.length, q = 4; let d = '';
    for (let y = 0; y < n; y++) { let x = 0; while (x < n) { if (!m[y][x]) { x++; continue; } let e = x; while (e < n && m[y][e]) e++; d += `M${x + q} ${y + q}h${e - x}v1h${-(e - x)}z`; x = e; } }
    const s = (n + q * 2) * px;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + q * 2} ${n + q * 2}" width="${s}" height="${s}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  window.QR = { matrix, svg };
})();
