'use strict';
// Minimal SMPP 3.4 client (no dependencies) to send text messages through an SMS gateway (SMSC).
// One short session per send: connect (plain or TLS) -> bind -> submit_sm for every number -> unbind -> close.
// Text that is plain ASCII goes out in the SMSC default alphabet (data_coding 0, up to 160 characters);
// anything else goes out as UCS-2 (data_coding 8, up to 70 characters). Longer text is cut with "...".
const net = require('node:net');
const tls = require('node:tls');

const CMD = { generic_nack: 0x80000000, bind_receiver: 0x01, bind_transmitter: 0x02, submit_sm: 0x04, unbind: 0x06, bind_transceiver: 0x09, enquire_link: 0x15 };
const RESP = 0x80000000;
const STATUS = { 0: 'OK', 1: 'message length is invalid', 2: 'command length is invalid', 3: 'invalid command id', 4: 'incorrect bind status', 5: 'already bound', 6: 'invalid priority flag', 7: 'invalid registered delivery flag',
  8: 'system error', 10: 'invalid source address', 11: 'invalid destination address', 12: 'invalid message id', 13: 'bind failed', 14: 'invalid password', 15: 'invalid system id', 20: 'message queue full', 21: 'invalid service type',
  51: 'invalid number of destinations', 69: 'submit failed', 72: 'invalid source address TON', 73: 'invalid source address NPI', 80: 'invalid destination address TON', 81: 'invalid destination address NPI', 88: 'throttled (too many messages)',
  97: 'invalid scheduled delivery time', 98: 'invalid validity period', 255: 'unknown error' };
const statusText = (s) => `${STATUS[s] || 'error'} (0x${s.toString(16).padStart(8, '0')})`;
const TIMEOUT_MS = 15000;

const cstr = (s, max) => Buffer.concat([Buffer.from(String(s ?? '').slice(0, max), 'latin1'), Buffer.from([0])]);
function pdu(id, seq, body = Buffer.alloc(0), status = 0) {
  const b = Buffer.alloc(16 + body.length); b.writeUInt32BE(b.length, 0); b.writeUInt32BE(id >>> 0, 4); b.writeUInt32BE(status >>> 0, 8); b.writeUInt32BE(seq >>> 0, 12); body.copy(b, 16); return b;
}

/** "+971 50-123 4567" -> "971501234567"; null when it does not look like a phone number */
function cleanNumber(s) { const d = String(s || '').replace(/[\s\-().]/g, '').replace(/^\+/, '').replace(/^00(?=[1-9])/, ''); return /^\d{6,16}$/.test(d) ? d : null; }

/** the text as it goes on the wire */
function encodeText(text) {
  const t = String(text ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (/^[\x20-\x7e]*$/.test(t)) { const s = t.length > 160 ? t.slice(0, 157) + '...' : t; return { coding: 0, data: Buffer.from(s, 'latin1') }; }
  const s = [...t].length > 70 ? [...t].slice(0, 67).join('') + '...' : t;
  return { coding: 8, data: Buffer.from(s, 'utf16le').swap16() };
}

function bindBody(c) {
  return Buffer.concat([cstr(c.systemId, 15), cstr(c.password, 15), cstr(c.systemType, 12), Buffer.from([0x34, 0, 0]), cstr('', 40)]);
}
function submitBody(c, to, enc) {
  const src = String(c.sourceAddr || ''), numeric = /^\+?\d+$/.test(src), tonOf = (v, d) => (Number.isInteger(+v) && v !== '' && v !== null && v !== undefined ? +v : d);
  const sTon = tonOf(c.sourceTon, numeric ? 1 : 5), sNpi = tonOf(c.sourceNpi, numeric ? 1 : 0), dTon = tonOf(c.destTon, 1), dNpi = tonOf(c.destNpi, 1);
  return Buffer.concat([cstr('', 5), Buffer.from([sTon, sNpi]), cstr(numeric ? src.replace(/^\+/, '') : src, 20), Buffer.from([dTon, dNpi]), cstr(to, 20),
    Buffer.from([0, 0, 0]), cstr('', 16), cstr('', 16), Buffer.from([0, 0, enc.coding, 0, enc.data.length]), enc.data]);
}

/** one open connection: send a PDU, wait for its answer */
class Session {
  constructor(sock) {
    this.sock = sock; this.buf = Buffer.alloc(0); this.waiters = new Map(); this.seq = 1; this.err = null;
    sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.parse(); });
    sock.on('close', () => this.fail(new Error('the SMS gateway closed the connection')));
    sock.on('error', (e) => this.fail(e));
    sock.setTimeout(TIMEOUT_MS, () => this.fail(new Error('the SMS gateway did not answer in time')));
  }
  parse() {
    while (this.buf.length >= 16) {
      const len = this.buf.readUInt32BE(0);
      if (len < 16 || len > 70000) return this.fail(new Error('the SMS gateway sent data that is not SMPP'));
      if (this.buf.length < len) return;
      const p = { id: this.buf.readUInt32BE(4), status: this.buf.readUInt32BE(8), seq: this.buf.readUInt32BE(12), body: this.buf.subarray(16, len) };
      this.buf = this.buf.subarray(len);
      if (p.id === CMD.enquire_link) { this.sock.write(pdu(CMD.enquire_link | RESP, p.seq)); continue; }       // keep-alive from the gateway
      const w = this.waiters.get(p.seq); if (w) { this.waiters.delete(p.seq); w.resolve(p); }
    }
  }
  fail(e) { this.err = this.err || e; for (const w of this.waiters.values()) w.reject(this.err); this.waiters.clear(); }
  request(id, body) {
    if (this.err) return Promise.reject(this.err);
    const seq = this.seq++;
    return new Promise((resolve, reject) => { this.waiters.set(seq, { resolve, reject }); this.sock.write(pdu(id, seq, body)); });
  }
}

function openSocket(c) {
  return new Promise((resolve, reject) => {
    const host = c.host, port = +c.port || 2775; let sock;
    const done = () => { sock.off('error', reject); sock.setTimeout(0); resolve(sock); };
    if (c.tls) sock = tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: !c.allowSelfSigned }, done);
    else sock = net.connect({ host, port }, done);
    sock.once('error', reject);
    sock.setTimeout(TIMEOUT_MS, () => sock.destroy(new Error(`could not connect to ${host}:${port} (timed out)`)));
  });
}

/**
 * c: { host, port, tls, allowSelfSigned, systemId, password, systemType, bind:'transceiver'|'transmitter', sourceAddr, sourceTon, sourceNpi, destTon, destNpi }
 * numbers: ['9715...']; text: string. With no numbers it only connects and binds (a connection test).
 * Returns { sent: n, failed: [{ to, error }], ids: [...] }; throws when the gateway cannot be reached or refuses the login.
 */
async function sendSms(c, numbers, text) {
  if (!c || !c.host) throw new Error('SMS is not set up yet (Notifications → SMS)');
  let sock;
  try { sock = await openSocket(c); } catch (e) { throw new Error(/self.signed|unable to verify|certificate|CERT_/i.test(e.message) ? `${e.message} — tick "Accept self-signed certificate" if the gateway uses an internal certificate.` : e.message); }
  const s = new Session(sock); const out = { sent: 0, failed: [], ids: [] };
  try {
    const bind = await s.request(c.bind === 'transmitter' ? CMD.bind_transmitter : CMD.bind_transceiver, bindBody(c));
    if (bind.status !== 0) throw new Error(`the SMS gateway refused the login: ${statusText(bind.status)}`);
    const enc = encodeText(text);
    for (const to of numbers) {
      const r = await s.request(CMD.submit_sm, submitBody(c, to, enc));
      if (r.status === 0) { out.sent++; const z = r.body.indexOf(0); out.ids.push(r.body.subarray(0, z < 0 ? r.body.length : z).toString('latin1')); } else out.failed.push({ to, error: statusText(r.status) });
    }
    try { await s.request(CMD.unbind, Buffer.alloc(0)); } catch { /* the gateway may just close */ }
    return out;
  } finally { try { sock.destroy(); } catch { /* ignore */ } }
}

module.exports = { sendSms, cleanNumber, encodeText, pdu, CMD, RESP };
