'use strict';
// Company name, footer text and logo that customers put on reports and e-mails (Settings → Reports → Branding).
// The logo is a JPEG (the dashboard converts what the person picks), so the PDF can embed it as it is.
const MAX_LOGO = 150 * 1024;

/** width, height and colour components of a JPEG, or null when it is not a usable JPEG */
function parseJpeg(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1]; if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const h = buf.readUInt16BE(i + 5), w = buf.readUInt16BE(i + 7), comps = buf[i + 9];
      if (!w || !h || w > 4000 || h > 4000 || (comps !== 1 && comps !== 3)) return null;
      return { w, h, comps };
    }
    i += 2 + len;
  }
  return null;
}
/** "data:image/jpeg;base64,..." -> Buffer, or null */
function logoBuffer(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || '')); if (!m) return null;
  const b = Buffer.from(m[1], 'base64'); return b.length && b.length <= MAX_LOGO && parseJpeg(b) ? b : null;
}
/** what the templates need: { name, footer, logo: { buf, w, h, comps } | null } */
function brand(cfg) {
  const b = (cfg && cfg.branding) || {}; const buf = logoBuffer(b.logo), info = buf && parseJpeg(buf);
  return { name: String(b.company || '').trim() || 'NetEventPro', custom: !!String(b.company || '').trim(), footer: String(b.footer || '').trim(), logo: info ? { buf, ...info } : null };
}
/** cleans the branding settings sent by the dashboard */
function clean(b, bad) {
  b = b && typeof b === 'object' ? b : {};
  const company = String(b.company ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80), footer = String(b.footer ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim().slice(0, 200);
  let logo = String(b.logo ?? '');
  if (logo && !logoBuffer(logo)) bad('The logo must be a JPEG picture of at most 150 KB. The dashboard makes one for you when you choose a picture: try a smaller picture.');
  return { company, footer, logo };
}
module.exports = { brand, clean, parseJpeg, logoBuffer, MAX_LOGO };
