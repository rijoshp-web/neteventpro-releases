'use strict';
// a small LDAP server for tests (plain with StartTLS, or LDAPS), with three directory users
const net = require('node:net');
const tls = require('node:tls');
const { read, children, seq, str, int, toInt } = require('../src/ldap')._ber;
const BASE = 'DC=corp,DC=local';
const USERS = {
  'CN=Jane Doe,OU=People,DC=corp,DC=local': { sam: 'jane', pw: 'Jane-Pass-1', display: 'Jane Doe', memberOf: ['CN=NOC Operators,OU=Groups,DC=corp,DC=local'], nested: ['CN=All Staff,OU=Groups,DC=corp,DC=local'] },
  'CN=Bob Roe,OU=People,DC=corp,DC=local': { sam: 'bob', pw: 'Bob-Pass-1', display: 'Bob Roe', memberOf: ['CN=Finance,OU=Groups,DC=corp,DC=local'] },
  'CN=svc,OU=Service,DC=corp,DC=local': { sam: 'svc', pw: 'svc-pass' }
};
/** every value of an equality item (attr=value) anywhere in a filter */
function eqValues(f) { if (f.tag === 0xa3) return [children(f.body)[1].body.toString()]; if (f.tag === 0xa0 || f.tag === 0xa1 || f.tag === 0xa2) return children(f.body).flatMap(eqValues); return []; }
function fakeServer({ secure, cert }) {
  const seen = [];
  const handle = (sock) => {
    let buf = Buffer.alloc(0), bound = null;
    const reply = (id, op) => sock.write(seq(0x30, int(id), op));
    const result = (tag, code) => seq(tag, int(code, 0x0a), str(''), str(''));
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const t = read(buf); if (!t) return; buf = buf.subarray(t.next);
        const [idT, op] = children(t.body); const id = toInt(idT.body);
        if (op.tag === 0x60) { const [, name, auth] = children(op.body); const dn = name.body.toString(), pw = auth.body.toString(); const u = USERS[dn]; const ok = u && u.pw === pw && pw !== ''; bound = ok ? dn : null; seen.push('bind ' + dn + ' ' + (ok ? 'ok' : 'bad')); reply(id, result(0x61, ok ? 0 : 49)); }
        else if (op.tag === 0x63) {
          const parts = children(op.body); const filter = parts[6]; const raw = filter.body.toString('latin1'); seen.push('search ' + (bound || 'anon'));
          if (!bound) { reply(id, result(0x65, 1)); continue; }
          if (filter.tag === 0xa9) {        // nested groups for a DN
            for (const [dn, u] of Object.entries(USERS)) if (raw.includes(dn) && u.nested) for (const g of u.nested) reply(id, seq(0x64, str(g), seq(0x30)));
          } else for (const [dn, u] of Object.entries(USERS)) if (u.display && eqValues(filter).includes(u.sam)) reply(id, seq(0x64, str(dn), seq(0x30, seq(0x30, str('displayName'), seq(0x31, str(u.display))), seq(0x30, str('memberOf'), seq(0x31, ...u.memberOf.map((g) => str(g)))))));
          reply(id, result(0x65, 0));
        } else if (op.tag === 0x77) {        // StartTLS
          reply(id, seq(0x78, int(0, 0x0a), str(''), str('')));
          sock.removeAllListeners('data');
          const ts = new tls.TLSSocket(sock, { isServer: true, key: cert.key, cert: cert.cert }); handle(ts); return;
        } else if (op.tag === 0x42) sock.end();
      }
    });
    sock.on('error', () => {});
  };
  const srv = secure ? tls.createServer({ key: cert.key, cert: cert.cert }, handle) : net.createServer(handle);
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port, seen })));
}

const makeCert = () => { const g = require('../src/certgen').generate({ hosts: 'localhost,127.0.0.1' }); return { key: g.key || g.keyPem, cert: g.cert || g.certPem }; };
module.exports = { fakeServer, makeCert, BASE, USERS };
