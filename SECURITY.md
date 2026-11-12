# NetEventPro security review

Reviewed by reading all server code and attacking a running copy (`npm run test:e2e`, 57 checks; `npm test`, 23 tests; a Playwright pass over the interface). Windows-only parts (installer, service, `icacls`, tray scripts) could **not** be run in the build environment: test them on a first install.

## Fixed during this review
| Problem | Fix |
|---|---|
| Another website or local web app could trigger heavy `GET` calls (`/api/db/download`, `/api/export`) | `/api/*` refuses `Sec-Fetch-Site` values other than same-origin / none |
| A regex like `.*foo` passed the safety check but took ~200 ms on a 16 KB message, so one sender could slow the receiver | Regex replacements and rule regexes read only the first 2000 characters (about 4 ms) |
| `config.json` (SMTP password, webhook URLs, password hash) was readable by every local user | Service restricts it to SYSTEM and Administrators with `icacls` on every save; tray and dashboard shortcut now read a separate non-secret `ui\web.json` |
| Installer started the service before writing the chosen ports | Ports are written at `ssInstall` |
| WinSW download was not pinned | `-WinSWSha256` parameter; build prints the hash |

## Already in place and verified
Scrypt password hashing, per-IP login lockout, CSRF header, Host-header check, CSP and security headers, path-traversal-safe static files, CSV formula neutralisation, header-injection-safe email, webhook URL limited to http(s) without redirects, source ACL, message size and connection caps, SSE client cap, dashboard refuses a network bind without a password, XSS payloads in message, host, process, tag and alias render as text.

## Added with dashboard, health, vendor tags and saved views
New endpoints `/api/dash` (POST) and `/api/health` sit behind the same password, CSRF header and cross-site checks as the rest. Dashboard requests are validated server side: tile types, metrics and group-by columns come from fixed lists, ids and numbers are clamped, at most 30 tiles, and filters reach SQLite only as bound parameters (tested with injection strings). Saved views, tile layouts and colours are sanitised before storage. Health messages use host `SyslogPro` and bypass the vendor tagger. Vendor recognisers are best-effort pattern matching, not authentication: a spoofed syslog sender can produce any tag.

## Remaining risks (accepted or yours to decide)
1. **Plain HTTP**: with network access on, the password and logs cross the network unencrypted. Configure HTTPS (Settings) or use a VPN.
2. **Data folder readable by local users** unless you tick the installer option or run `icacls "C:\ProgramData\NetEventPro" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F`.
3. **UDP syslog can be spoofed** by anyone who can reach the port. Use "Accept syslog only from".
4. **SMTP password is stored in clear text** in `config.json`, protected only by file permissions.
5. **An administrator can make the service call any http(s) URL** (webhooks). Keep the dashboard password strong.
6. **Service runs as Local System.** A low-privilege account is better but untested.
7. **Firewall rule is program-based on all profiles.** Use the source list to limit senders.
8. **Scrypt cost (N=65536 since 1.43)** is still below the highest OWASP setting (2^17); old hashes are upgraded at the next sign-in.
9. **Bundled Node.js and WinSW need updating** when new releases fix vulnerabilities. Node's checksum is verified, not its signature.
10. Old databases without incremental vacuum keep their file size after pruning.
11. **Report folders accept UNC paths.** A person who holds the "Reports" permission could point a report at a share on a hostile server, and Windows may then offer the service account's network credentials to it (NTLM). Give that permission only to administrators and block outbound SMB (TCP 445) at the firewall.
12. **Lockout** is per source address and (since 1.43) per account. Per-account lockout lets an attacker lock a known account for the lock time (the server's own console is exempt). Many people behind one NAT address share the address counter. Use a strong password and keep the dashboard on an internal network.
13. **Backup upload size limit is very high** (200 GB). Only people with the Backup permission can upload; make sure the data drive has headroom.
14. **Two-factor (TOTP) and an audit log exist since 1.43.** Not yet: password expiry/history, QR enrolment, and blocking sign-in until two-factor is set up (it is a reminder). Recovery codes and the TOTP secret are stored in `twofactor.json` (owner-only file, secret not encrypted).
15. **SNMP trap receiver (UDP 162) accepts unauthenticated v1/v2c traps.** Anyone who can reach the port can send traps that look like they come from a device (the source address can be spoofed over UDP). The community name travels in clear text and is only a weak filter. Use "Accept syslog only from" (it also applies to traps), a firewall rule for UDP 162, and treat trap-driven alarms like syslog-driven ones. SNMP v3 (authentication and encryption) is not supported: v3 messages are counted and one notice per device every 10 minutes is logged.
16. **MIB files are parsed, never run.** Uploading needs the "settings" permission; names are restricted to letters, digits, dot, dash and underscore, files are limited to 8 MB (500 files), binary files are refused, and the parser is a plain tokenizer with bounded loops (fuzzed with random and truncated input). MIB files are stored in the `mibs` folder of the data directory and are not part of the app backup: copy that folder with your backups.


## Users, reports and backups (added)
- Permissions are checked per route on the server; hiding menu items is only cosmetic. Viewers never receive SMTP logins, webhook URLs or relay targets.
- Passwords are stored as scrypt hashes in `users.json`; the hash is never sent to the browser. "Manage users" is equivalent to administrator.
- Report folders are written by the service account: only absolute paths are accepted, `..` is refused, and "Test folder" writes and removes a probe file.
- Backups contain settings including SMTP/webhook secrets. Set a passphrase (AES-256-GCM, scrypt) for any copy that leaves this machine. Backup names are validated; uploads are checked before they are kept.
- A restore is staged first and applied at the next start, with a `before-restore-*` safety copy.
- The request timeout was raised to allow large backup uploads.
- The certificate generator writes `tls\neteventpro.crt` and `.key` in the data folder (key readable only by Administrators and SYSTEM: `icacls` on Windows, mode 0600 elsewhere). Earlier files are renamed `.old-…`, not deleted. Back up or protect the `tls` folder; it is not part of the app backup.
- Browsers sign in through `/api/login` and hold a random session cookie (HttpOnly, SameSite=Strict, Secure on HTTPS; only its SHA-256 is kept, in memory). Sessions end after 12 h idle / 7 days, on sign-out, on restart, and whenever a password, user or role changes. HTTP Basic is accepted only from non-browser clients (requests without Sec-Fetch headers).
- SNMP traps: decoded by a bounds-checked BER reader (every length is checked against the packet; at most 100 variables per trap and 128 numbers per OID; packets that are not valid SNMP are counted and dropped, never stored). The community name is checked but never written to the log, message or raw text. At most 5,000 traps per second are accepted. Informs are answered only after the sender passed the source and community checks.
- Alarms and maintenance windows: reading needs "View"; acknowledging, clearing and notes need "Alarms"; editing windows needs "Rules". Alarm text comes from device messages and is escaped on screen; searches use bound parameters with LIKE wildcards escaped. At most 5,000 active alarms are kept (the rest are counted, not stored), so a flood from many devices cannot grow the table without limit. A maintenance window silences alerts for the devices it names: anyone with the Rules permission can therefore hide a device's alerts, so give it only to trusted roles.


## Probe (since 1.44)
- The probe page has its own password (scrypt), sessions (30 min idle), lockout (5 wrong tries, 10 minutes per address), audit log and optional HTTPS. Without a password it listens on this computer only; network access requires a password.
- The queue file and the probe token are encrypted with AES-256-GCM; the key (`secret.key`) is in the same data folder, so this protects copies of the files, not someone who can read the whole folder. The service account should be the only reader (the installer restricts the folder).
- The link to the main server can be pinned to one certificate (SHA-256) and can refuse plain http. Without a pin, a normal certificate check applies (or the self-signed option, which trusts any certificate: avoid it, pin instead).
- Per probe on the server: a token rotation with 24 hours overlap and an allowed-address list. Tokens are still stored hashed on the server.
- Not done: the probe still runs as Local System like the main service; SNMP v1/v2c traps stay unauthenticated.

## Secrets at rest (since 1.45)
- Passwords and secret addresses in `config.json`, and the TOTP secrets in `twofactor.json`, are AES-256-GCM encrypted with `secret.key` (data folder, owner-only). A copied config or backup of the folder without the key does not reveal them.
- It does not protect against anyone who can read the data folder as the service account (key and data are together). Windows DPAPI or a key held outside the folder would be the next step.
- Backups contain readable settings by design (restore on another computer). Use the backup passphrase for copies that leave the server.
