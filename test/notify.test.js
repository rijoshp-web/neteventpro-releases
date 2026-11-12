'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sendSms, encodeText, cleanNumber, pdu, RESP } = require('../src/smpp');
const { Notifier } = require('../src/notify');
const { migrateNotifications } = require('../src/config');

function fakeSmsc(onPdu) {
  const got = [];
  const srv = net.createServer((s) => {
    let buf = Buffer.alloc(0);
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 16 && buf.length >= buf.readUInt32BE(0)) {
        const len = buf.readUInt32BE(0), id = buf.readUInt32BE(4), seq = buf.readUInt32BE(12), body = buf.subarray(16, len); buf = buf.subarray(len); got.push({ id, body });
        if (id === 0x09 || id === 0x02) s.write(pdu(id | RESP, seq, Buffer.from('SMSC\0'), body.subarray(0, body.indexOf(0)).toString() === 'bad' ? 0x0f : 0));
        else if (id === 0x04) s.write(pdu(id | RESP, seq, Buffer.from('m' + seq + '\0'), body.toString('latin1').includes('666') ? 0x0b : 0));
        else if (id === 0x06) { s.write(pdu(id | RESP, seq)); s.end(); }
      }
    });
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, got, port: srv.address().port })));
}

test('cleanNumber and encodeText', () => {
  assert.equal(cleanNumber('+971 50-123 4567'), '971501234567');
  assert.equal(cleanNumber('00971501234567'), '971501234567');
  assert.equal(cleanNumber('12'), null);
  assert.equal(encodeText('ALARM core-sw1').coding, 0);
  assert.equal(encodeText('تنبيه').coding, 8);
  assert.equal(encodeText('x'.repeat(300)).data.length, 160);
  assert.equal(encodeText('ع'.repeat(300)).data.length, 140);
});

test('SMPP: sends, reports a rejected number, bad login and refused connection', async () => {
  const { srv, got, port } = await fakeSmsc();
  try {
    const c = { host: '127.0.0.1', port, systemId: 'user', password: 'pw', sourceAddr: 'NetEventPro' };
    const r = await sendSms(c, ['971501234567', '971666'], 'ALARM core-sw1: link down');
    assert.equal(r.sent, 1); assert.equal(r.failed.length, 1); assert.equal(r.failed[0].to, '971666');
    assert.ok(got.find((g) => g.id === 4).body.toString('latin1').includes('ALARM core-sw1: link down'));
    await assert.rejects(sendSms({ ...c, systemId: 'bad' }, [], ''), /refused the login/);
    await assert.rejects(sendSms({ ...c, port: 1 }, [], ''));
    await assert.rejects(sendSms({}, [], ''), /not set up/);
    assert.deepEqual((await sendSms({ ...c, bind: 'transmitter' }, [], '')).sent, 0);
  } finally { srv.close(); }
});

test('Notifier: webhook formats and delivery log', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-'));
  const cfg = { dir, get: () => ({ notifProfiles: [], smpp: {} }) };
  const n = new Notifier(cfg, null);
  const f = n.facts('alert', { rule: { name: 'R "q"' }, suppressed: 2, msg: { host: 'sw1', srcIp: '10.0.0.1', severity: 3, message: 'link "down"', ts: 1700000000000 } });
  assert.equal(n.webhookBody('slack', f).text, f.head);
  assert.equal(n.webhookBody('generic', f).message.host, 'sw1');
  const t = n.webhookBody('teams', f);
  assert.equal(t.type, 'message'); assert.equal(t.attachments[0].content.type, 'AdaptiveCard');
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(t)));
  assert.ok(f.head.includes('2 similar'));
  n.record({ channel: 'sms', ok: true }); n.record({ channel: 'email', ok: false, error: 'x' });
  assert.equal(n.entries(10)[0].channel, 'email');
  assert.equal(new Notifier(cfg, null).entries().length, 2);   // reloaded from the file
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migrateNotifications turns old rule settings into profiles', () => {
  const c = { smtp: { to: 'a@x.com', cc: '' }, webhooks: [{ name: 'chat', url: 'https://h.example/x', enabled: true }],
    rules: [{ actions: { email: true, webhook: 'chat', alarm: true, alarmEscMin: 5 } }, { actions: { email: true, emailTo: 'b@x.com' } }] };
  migrateNotifications(c);
  assert.equal(c.notifProfiles.length, 3);
  const r0 = c.rules[0].actions;
  assert.equal(r0.profiles.length, 2); assert.ok(!('email' in r0) && !('webhook' in r0));
  assert.equal(r0.alarmEscProfiles.length, 1);
  assert.equal(r0.alarmEscProfiles[0], r0.profiles[0]);   // same default e-mail profile is reused
  assert.ok(c.notifProfiles.some((p) => p.webhook.on && p.webhook.url === 'https://h.example/x'));
  assert.ok(c.notifProfiles.some((p) => p.email.to === 'b@x.com'));
});
