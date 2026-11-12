'use strict';
// Makes a self-signed HTTPS certificate with Node's own crypto: no OpenSSL needed. The certificate is ECDSA P-256 / SHA-256, valid for
// every name and address you list (a browser rejects a certificate that does not list the address you typed), and is marked
// "server authentication" only. X.509 is plain DER, so it is assembled by hand here and then signed with the new key.
const crypto = require('node:crypto');
const net = require('node:net');
const os = require('node:os');

const len = (n) => (n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]));
const tlv = (tag, ...parts) => { const body = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p)))); return Buffer.concat([Buffer.from([tag]), len(body.length), body]); };
const seq = (...p) => tlv(0x30, ...p);
const oid = (hex) => tlv(0x06, Buffer.from(hex, 'hex'));
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const utc = (d) => tlv(0x17, d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z');
const OID = { ecdsaSha256: '2a8648ce3d040302', cn: '550403', o: '55040a', san: '551d11', eku: '551d25', ku: '551d0f', bc: '551d13', serverAuth: '2b06010505070301' };
const name = (cn, org) => seq(tlv(0x31, seq(oid(OID.o), utf8(org))), tlv(0x31, seq(oid(OID.cn), utf8(cn))));
const ext = (o, critical, value) => seq(oid(o), ...(critical ? [tlv(0x01, Buffer.from([0xff]))] : []), tlv(0x04, value));

function ipBytes(ip) {
  if (net.isIPv4(ip)) return Buffer.from(ip.split('.').map(Number));
  const [a, b] = ip.split('::'); const left = a ? a.split(':') : [], right = b ? b.split(':') : [];
  const groups = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return Buffer.concat(groups.map((g) => { const x = Buffer.alloc(2); x.writeUInt16BE(parseInt(g || '0', 16)); return x; }));
}

/** "name, 10.0.0.5 ..." -> { dns: [...], ips: [...] }, cleaned and de-duplicated. Throws a readable message for nonsense. */
function parseHosts(text) {
  const dns = [], ips = [];
  for (let h of String(text || '').split(/[\s,;]+/).filter(Boolean)) {
    h = h.toLowerCase().replace(/^\[|\]$/g, '');
    if (net.isIP(h)) { if (!ips.includes(h)) ips.push(h); continue; }
    if (!/^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(h) || h.length > 253) throw new Error(`"${h}" is not a valid computer name or IP address.`);
    if (!dns.includes(h)) dns.push(h);
  }
  if (dns.length + ips.length === 0) throw new Error('Enter at least one computer name or IP address.');
  if (dns.length + ips.length > 30) throw new Error('At most 30 names and addresses.');
  return { dns, ips };
}

/** the names this computer is normally reached by: its name, localhost, and its own addresses */
function defaultHosts() {
  const out = [os.hostname().toLowerCase(), 'localhost', '127.0.0.1'];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (!a.internal && a.family === 'IPv4') out.push(a.address);
  return [...new Set(out)];
}

function generate({ hosts, days = 825, org = 'NetEventPro' } = {}) {
  const { dns, ips } = parseHosts(hosts);
  days = Math.min(3650, Math.max(30, Math.round(+days || 825)));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const serial = crypto.randomBytes(16); serial[0] = (serial[0] & 0x7f) | 0x40;
  const notBefore = new Date(Date.now() - 24 * 3600 * 1000), notAfter = new Date(Date.now() + days * 86400 * 1000);
  const cn = dns[0] || ips[0], alg = seq(oid(OID.ecdsaSha256));
  const sanList = seq(...dns.map((d) => tlv(0x82, Buffer.from(d))), ...ips.map((i) => tlv(0x87, ipBytes(i))));
  const tbs = seq(
    tlv(0xa0, tlv(0x02, Buffer.from([2]))), tlv(0x02, serial), alg, name(cn, org), seq(utc(notBefore), utc(notAfter)), name(cn, org),
    publicKey.export({ type: 'spki', format: 'der' }),
    tlv(0xa3, seq(ext(OID.bc, true, seq()), ext(OID.ku, true, Buffer.from([0x03, 0x02, 0x07, 0x80])), ext(OID.eku, false, seq(oid(OID.serverAuth))), ext(OID.san, false, sanList))));
  const sig = crypto.sign('sha256', tbs, { key: privateKey, dsaEncoding: 'der' });
  const der = seq(tbs, alg, tlv(0x03, Buffer.from([0]), sig));
  const pem = '-----BEGIN CERTIFICATE-----\n' + der.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '') + '\n-----END CERTIFICATE-----\n';
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const x = new crypto.X509Certificate(pem);   // proves the bytes above form a certificate Node accepts, and that it matches the key
  if (!x.verify(publicKey) || !x.checkPrivateKey(privateKey)) throw new Error('Internal error: the new certificate did not verify.');
  return { cert: pem, key: keyPem, names: [...dns, ...ips], notBefore, notAfter, fingerprint: x.fingerprint256 };
}

module.exports = { generate, parseHosts, defaultHosts };
