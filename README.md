# NetEventPro

A real-time syslog and SNMP trap receiver for Windows with a live dashboard (formerly SyslogPro). Syslog (Logs page) and SNMP traps (Traps page) are kept in separate windows with separate rule sets; alarms from both share one Alarms page. It installs from one `Setup.exe`, runs as a Windows service (starts at boot, restarts itself if it fails), and needs no Docker.

## Features

| Area | What you get |
|---|---|
| Receiving | UDP and TCP syslog, RFC 5424 and RFC 3164, newline and octet-counted TCP framing, Cisco-style and header-less messages, several messages per datagram |
| Logs | One page for both the real-time stream and stored history (pick "Live" or a time range). Filters by severity / device / process / text (`-word` excludes, `"exact phrase"`), pause, click a device to filter, message detail panel, CSV / JSON export. Click a column heading to sort, drag its edge to resize (double-click resets). **Appearance**: font, size, and text / highlight colour and bold per severity |
| Dashboard | Pick a time range (15 min to 30 days, or custom from/to) and every tile follows it. Drag a tile by its header, resize by its edge or corner (or arrow keys), **Add tile** from a catalog (counts, distinct devices, trend charts, top-N lists, latest-messages lists) with your own filter, edit or remove any tile, reset layout. Click a tile to open the matching Logs view |
| Dashboard tiles (new) | Pie / donut, line, heatmap (device x hour, weekday x hour), gauge and bar-style tiles in addition to counts, trends and lists. "Reset layout" adds the new default tiles |
| Users and roles | Several users, fully custom roles (permission checklist), groups that add roles, admin password reset, change-own-password. The first-run administrator stays the built-in `admin` |
| Reports | Scheduled (daily / weekly / monthly) reports as PDF, Excel and CSV, sent by e-mail attachment and/or saved to a folder or network share (UNC path), with retention and "Run now" |
| Backup and restore | Manual or scheduled backups of settings and database, optional passphrase encryption, optional copy to a second folder, download / upload, restore applied at next service restart (a safety copy is kept) |
| User guide | Built-in Help page |
| Health | Disk space, database size and speed, listeners, ingest rate, event-loop lag, email and forwarding status. Failures are also written as syslog messages from host `NetEventPro`, so rules and email can alert on them (template: "SyslogPro health alerts") |
| Vendor tags | Best-effort recognisers tag Cisco, Dell, HP, APC and Eltek messages (e.g. `link-down`, `power-fail`, `battery`). Search with `tag:name`, use "Has tag" in rules; switch each family off in Settings. Wording differs between firmware, so check against your own devices |
| Saved views | In Logs: save the current range, filter, columns, sort and grouping under a name and re-apply it later. "Group repeats" folds identical consecutive messages into one row with a ×N badge |
| Devices | Identified by the host name inside the message (falls back to source IP); lists every address a device sent from. Automatic discovery, display names, "silent device" alerts when a known device stops sending, mute per device |
| Alarms | One alarm per rule and device with a counter; click a heading to sort, choose and reorder columns, date and time with seconds; acknowledge (with name and time), notes, manual or automatic clearing by recovery rules, escalation e-mail if unacknowledged, menu badge, "Alarms" permission |
| SNMP trap columns | Settings → Trap column views: a column is one value or a recipe that joins several, e.g. `{alarmSource} - {alarmText} {alarmAdditionalText}`; `{a|b}` first non-empty, `{alarmSeverity:name}`, `{agent}` `{source}` `{trap}` `{oid}` `{host}` `{values}` |
| SNMP traps and MIBs | Receives SNMP v1 and v2c traps and v2c informs (UDP 162) and stores each as a log message, so rules, alarms, search, reports and forwarding work on traps. Upload vendor MIB files (SMIv1 / SMIv2 text) and trap names, object names and named values (`down(2)`) are resolved; numbers that no MIB explains are listed by vendor as "MIBs still needed". Severity from the trap name or your own rules, community filter, OID lookup. SNMP v3 is not supported yet |
| Maintenance windows | One-off or weekly windows per device (wildcards): messages are stored and tagged `maintenance` but raise no alarms or alerts and cannot make a device Silent |
| Rules | Match on severity, device, process, text or `/regex/i`. Highlight, tag, sound, desktop notification, webhook (Slack / Teams / n8n / any URL), **email**, or discard noise before storage |
| Text replacement (Settings) | Show names instead of IP addresses (or any text) as messages arrive. Whole-word matching, optional regex, bulk paste, "Try it" tester. The original packet stays in the message details |
| Email alerts | Your own SMTP server: none / STARTTLS / SSL, login, per-rule recipients, 5-minute default cooldown, hourly cap, test button. HTML e-mails (with a plain-text copy); the escalation e-mail shows all alarm details and the last 24 hours at a glance and carries a PDF report of the last 24 hours (switch off per rule) |
| Customize | Dashboard tiles: free layout (above). Logs: choose, reorder, wrap, sort and resize columns. Side panel collapses to icons; full-screen button. Saved on the server (side panel state and sound per browser) |
| Storage | SQLite (built in), retention from 30 days to 5 years or **keep everything** (separate setting for cleared alarms), optional size limit (0 = none), oldest data pruned first. Searches read newest-first in growing windows, so "All time" stays fast with millions of rows |
| Forwarding | Relay messages (UDP or TCP, optional minimum severity) to a SIEM or second collector |
| HTTPS certificate | Settings → Dashboard access → "Create a certificate here": makes a self-signed certificate and key for the names / IPs you list (no OpenSSL needed), switches HTTPS on after a restart, and lets you download the certificate to install as trusted on other PCs |
| Clock / NTP | Large date and time in the top bar from your own NTP server (SNTP over UDP 123, shortest-delay sample, answer checked against the request). Display only: the PC clock and stored message times are unchanged |
| Sign-in page | Built-in sign-in form and Sign out (no browser login box); session cookie (HttpOnly, SameSite=Strict, Secure on HTTPS), idle and overall time-out you set (default 12 h / 7 days, or never; sign-ins survive a restart), five wrong passwords lock that computer out for 5 minutes. Scripts can still use HTTP Basic |
| Security | Dashboard listens on this computer only by default; optional password; CSRF and DNS-rebinding protection |

## Install (end users)

Run `NetEventPro-Setup-<version>.exe` as administrator. The wizard asks for the syslog port (default 514) and dashboard port (default 8514), installs the service, adds a Windows Firewall rule, and puts a status icon in the notification area. Open the dashboard at **http://localhost:8514/**.

Point your devices at this PC's IP address on port 514 (UDP or TCP).

### Where the data is

Everything is in `C:\ProgramData\NetEventPro`. This is a hidden folder: paste the path into the File Explorer address bar, or use the Start menu entry **NetEventPro Data Folder**. Settings → "Where your data is stored" lists every path with a Copy button.

| Item | Path |
|---|---|
| Message database (SQLite, table `logs`) | `syslog.db` (+ `syslog.db-wal`, `syslog.db-shm` while running) |
| Settings, including the SMTP password | `config.json` |
| Plain-text logs (optional, Settings → Storage) | `raw\syslog-YYYY-MM-DD.log` |
| Service logs | `logs\` |

Open `syslog.db` with a free viewer such as DB Browser for SQLite. Don't open the live file: use Settings → Tools or `/api/db/download` for a consistent copy, or copy all `syslog.db*` files together. Uninstalling asks whether to delete the folder.

## Build the installer

On a Windows 10/11 PC with internet access:

1. Install Inno Setup 6.3+ once: `winget install JRSoftware.InnoSetup`
2. Double-click `build.bat` (or run `powershell -ExecutionPolicy Bypass -File build.ps1`)
3. The installer appears in `dist\`

The build downloads Node.js 22 LTS (checksum verified) and the WinSW service wrapper, bundles them with the app, and compiles `installer\NetEventPro.iss`. You do **not** need Node.js installed to build.

No Windows PC handy? Push this folder to GitHub and run the **Build Windows installer** workflow (`.github/workflows/build.yml`); it uploads the Setup.exe as a build artifact.

## Run from source (development)

Requires Node.js 22.13+.

```
npm run dev                          # UDP/TCP on 5514, dashboard on http://127.0.0.1:8514/
node test/send-test.js --port 5514   # generate sample traffic (add --tcp, --rate 500)
npm test                             # unit tests
npm run test:e2e                     # starts a throw-away server and a fake mail server, sends traffic, attacks the web interface
```

## Notes

- **Ports**: the dashboard keeps working if port 514 is taken; the banner at the top shows which listener failed and why.
- **Letting other PCs open the dashboard**: Settings → Dashboard access → "Other computers on the network", and set a password first. Sign in as user `admin`. The dashboard uses plain HTTP; put it behind a VPN or a reverse proxy with TLS if it crosses untrusted networks.
- **Device names**: devices are identified by source IP. A display name applies to new messages only; stored messages keep the name they arrived with.
- **Service account**: the service runs as Local System (WinSW default). To use a lower-privileged account, edit `<serviceaccount>` in `service\NetEventProService.xml`, give the account write access to `C:\ProgramData\NetEventPro`, then reinstall the service.
- **UDP loss**: UDP syslog has no delivery guarantee. NetEventPro requests a 16 MB receive buffer; very bursty senders should use TCP.
- **Security**: see `SECURITY.md` for what was tested, what was fixed and what remains.
- **Pinning the service wrapper**: `build.ps1 -WinSWSha256 <hash>` fails the build if the downloaded WinSW differs; the build prints the hash it saw.
- **Locking the data folder**: tick "Only allow administrators to open the data folder" in the installer.


## Online updates

Settings -> Updates is one button. The release address and the signing public key are built into the program (`src/update-defaults.js`), so a copy installed on any other computer updates the same way with no setup: **Check for updates**, then **Update to x.y.z**. The package is signed, its SHA-256 is checked, only program files are replaced, and a version that fails to start is rolled back. Probes follow their main server by themselves. A server without internet is updated with the installer; probes still follow it.

Publishing a release (GitHub Actions signs and publishes it when you push a tag) is described in `docs/RELEASING.md`. Advanced: `update.url` / `update.publicKey` in `config.json` override the built-in source (for a private mirror).
