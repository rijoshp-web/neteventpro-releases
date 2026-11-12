'use strict';
const fs = require('node:fs');
const isUnc = (p) => /^\\\\[^\\]+\\[^\\]+/.test(String(p));

/** Make sure a folder exists. A folder that already exists is never "created" again: Node's mkdir on the root of a network share (\\server\share) fails with
 *  EPERM even when the share is there and writable, so a folder that exists is used as it is. */
function ensureDir(dir) {
  try { if (fs.statSync(dir).isDirectory()) return dir; } catch { /* not there yet */ }
  try { fs.mkdirSync(dir, { recursive: true }); return dir; } catch (e) {
    try { if (fs.statSync(dir).isDirectory()) return dir; } catch { /* really not there */ }
    if (isUnc(dir) && ['EPERM', 'EACCES', 'ENOENT', 'EINVAL', 'EBUSY', 'EHOSTUNREACH', 'ENETUNREACH'].includes(e.code)) {
      e.message += '. The NetEventPro service reaches a network share as the computer account (DOMAIN\\COMPUTERNAME$), not as you: check the name of the share and give that account Change permission on the share and on the folder, or run the NetEventPro service as a user that has access (Services, NetEventPro, Log On)';
    }
    throw e;
  }
}

const { execFile } = require('node:child_process');
const NET_ERR = { 5: 'access is denied (this user has no permission on the share)', 53: 'the network path was not found: check the server name or address and the share name, and that TCP port 445 is open to it', 67: 'the share name was not found on that server', 86: 'the password is wrong', 1326: 'the user name or the password is wrong', 1331: 'the account is disabled', 1909: 'the account is locked out', 1385: 'this user is not allowed to sign in to that computer over the network', 1787: 'the server could not be reached to check the user', 2221: 'the user name was not found' };
const net = (args) => new Promise((resolve) => execFile('net', args, { windowsHide: true, timeout: 25000 }, (err, so, se) => resolve({ err, out: String(so || '') + String(se || '') })));

/** Sign in to a network share with a user name and password (Windows). The service otherwise reaches shares as the computer account.
 *  The connection is not kept after a restart (/persistent:no); it is made again before every use. */
async function connectShare(dir, user, password) {
  if (!user || process.platform !== 'win32' || !isUnc(dir)) return;
  const share = /^(\\\\[^\\]+\\[^\\]+)/.exec(String(dir))[1], args = ['use', share, String(password || ''), '/user:' + user, '/persistent:no'];
  let r = await net(args);
  if (r.err && /\b1219\b|multiple connections/i.test(r.out)) { await net(['use', share, '/delete', '/y']); r = await net(args); }   // the share is already open with another user
  if (r.err) {
    const code = +((/System error (\d+)/i.exec(r.out) || [])[1] || 0), text = NET_ERR[code] || r.out.trim().split(/\r?\n/).filter(Boolean)[0] || 'unknown error';
    throw new Error(`Cannot sign in to ${share} as ${user}: ${text}.`);
  }
}
/** the folder is ready to write to: signed in to its share when a user is given, and created when it is missing */
async function prepareFolder(dir, user, password) { await connectShare(dir, user, password); return ensureDir(dir); }
module.exports = { ensureDir, isUnc, connectShare, prepareFolder };
