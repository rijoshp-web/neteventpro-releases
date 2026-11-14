# NetEventPro changelog (called SyslogPro before 1.8.0)

Every delivered build has its own version number (shown bottom-left of the dashboard, in Settings → About, in the installer file name and in backups). The number is kept in `package.json`; `npm run bump` raises it.

## 1.61.0
- **A flood no longer freezes the browser:** when more than about 60 messages per second arrive, the Logs page and the dashboard redraw at most twice a second and show the newest ones. A "Very busy" note shows the rate and how many were not drawn, with a **Pause the feed** link. Nothing is lost: every message is still stored, searchable and processed by the rules. At normal rates there is no throttling and no delay.
- In a flood the new-row flash is switched off, the page keeps at most 600 rows, and only 2 desktop notifications per batch are raised.
- Load test tool: `--severity 0-7` to choose the severity of the test messages.
- Tested in headless Chromium: 500/s and 3,000/s floods, longest page stall 70 to 260 ms; the live feed is immediate again right after a flood.

## 1.60.0
- **Polling keeps up (new System health check):** devices that are behind their schedule are counted; the check warns, and turns to Problem (with the usual health alert) when more than 20% are behind, and says what to do.
- **Polls are no longer limited to "workers per second" and no device is starved:** the scheduler runs four times a second and always starts the device that has waited longest first. Before, a long list at a low "At the same time" setting left the devices at the end of the list unpolled (seen in a test: 121 of 200 devices answered, the rest never).
- **Automatic workers:** *At the same time* is raised by itself (up to 50) when the measured poll time and the number of devices need it; it can be switched off. Settings shows what is running now. In the 200-device test (20 readings each) it settled at 3 and every device answered on time.
- **Write queue peak:** System health → Database writer also shows the longest the queue got in the last hour or two, and warns above 50,000 before any message is dropped.
- **Where polling runs:** SNMP polling → Settings lists this computer and every probe with their device counts, answering / no answer, and the load of this computer (requests per second, poll time, workers).
- **Guide:** new topic *Capacity and growing the system* with the measured numbers, rules of thumb, when to add probes or another server, and the test tools.
- Tests: behind-schedule counting, automatic workers.

## 1.59.0
- **Fewer packets to every polled device:** the first source of each single-value reading is now asked in batches of up to 8 objects per SNMP request. 20 readings need about 3 packets instead of 20 (measured: 200 devices × 20 readings all answered within 20 seconds). A device that cannot answer a batch (too big, unknown object) is handled automatically and anything not in a batch is asked alone as before.
- **Read-only reminder:** the device dialog warns when the community looks like a read-write one (private, write, rw ...). NetEventPro itself only sends read requests (GET, GETNEXT, GETBULK); it has no way to change a device.
- **UDP receive buffer:** new setting *UDP receive buffer* (Settings → Network, default 16 MB, 1 to 256). System health now shows what the operating system really granted and warns when it is less than asked for.
- **Suspended service:** a gap of 15 seconds or more (computer asleep or hibernating, paused virtual machine, frozen process) is now reported as *Service was suspended* with its length and time, for 15 minutes, instead of a "Processing delay" problem.
- **Capacity estimator** (SNMP polling → Settings): enter devices, readings per device, interval, syslog messages per second and days kept, and it shows requests per second, stored rows, the suggested number of workers and a rough database size, with warnings.
- **Test tools:** `tools/loadtest.js` sends syslog at a chosen rate (optionally stepped up) to see what a server takes; `tools/fake-device.js --addresses 200` answers as 200 devices on 127.0.1.1 upwards, each from its own address.
- Tests: batching (packets used, values, missing object), suspended-service detection.

## 1.58.1
- **Fixed:** the "Polled devices and readings" dialog was taller than small windows and hid the Add tile / Save buttons. The fields now scroll and the buttons stay in view.
- **Heatmap hexagons are a honeycomb:** the Hexagon and Hexagon outline shapes now touch each other and every second row is shifted by half a cell.

## 1.58.0
- **SNMP polling on the dashboard:** new tile *Polled devices and readings* (Add tile → SNMP polling). It shows device status by group, open polling alarms, or any readings you choose: one reading of one device, one table row, or **the same reading on many devices in one tile** (for example the temperature of every site). Look: table, tile grid coloured by what the value means, bar list, one big number or gauge (highest / lowest / average / total), or a graph with one line per reading. "Add all, including future devices" makes a tile follow a reading name (optionally one group), so new devices join by themselves.
- **Tile shapes:** the tile grid and the device-status grid can be square, rounded, circle, hexagon or hexagon outline.
- **Heatmap:** *Busiest devices over time* gets a cell shape (square, rounded, circle, hexagon, hexagon outline) and colour themes (blue as before, traffic light, heat, cool, greys) with a colour scale under the map.
- Tests: tile data across devices, groups and rows; dashboard saving of the new settings.

## 1.57.0
- **Move and resize tiles and graphs:** on a device page choose *Edit layout*. Drag a tile or graph onto another to change places, pull the corner handle to change width (12 columns) and height, then *Save layout*. The arrangement is kept on the server per device and is the same for every user. *Reset layout* returns to the standard arrangement; on a phone everything stacks full width.
- **Groups of polled devices:** new *Group* field on a device (with suggestions from existing groups). The device list has a chip per group showing devices up / total and open alarms, a "Show group headings" switch with up / no-answer / alarm counts per group, and the search also finds a group name.
- Tests: group cleaning, layout widths and order.

## 1.56.0
- **Fixed:** a removed reading left its values (for example the "4 rows" table) on the device page until the service restarted. A device page now shows only the values of readings that still exist, and removing a reading forgets its values.
- **Edit from the visuals:** every gauge, bar, tile grid and card has a ✎ button that opens the reading's editor.
- **Every graph is customizable**, including *Answer time*: the ⚙ button of a graph sets style (line / area), width (1 to 4 columns), height, time range, line colour and top of the axis, or hides the graph (a "Hidden graphs" line brings it back). Saved per device on the server.
- **Resizable table columns:** drag the right edge of a column header in the polling tables; double-click resets. Widths are remembered in the browser.
- **Polling alarms in the syslog list:** one switch in SNMP polling → Settings, "Also write polling alarms to the syslog list". Off: alarms, notifications and the Alarms page work as before, the lines are just not added to Logs.
- Tests: removed values, layout save and cleaning, the syslog switch.

## 1.55.0
- **No more double notifications.** SNMP polling alarms are told only by their own rules (the Tell boxes on the reading, the shared Alarm limits and the no-answer rule). Your general syslog rules no longer match them, so a rule such as "warning and worse → e-mail" does not fire a second time for the same event. The alarm lines still appear in Logs (tag *poll*) for history.
- **See what an alarm is.** In the readings table the alarm badge is now clickable: "2 rules · 1 open" opens the list of that reading's alarm rules (condition, severity, who is told, value meanings that raise alarms) and the alarms open right now. The count now means *rules*, the open count is shown next to it, which explains the different numbers on the device list (open alarms of all readings and rows) and on the reading (rules).
- **More ways to show a reading.** Per reading, *Show on the page as*: card, big number with min / max and trend arrow, gauge (dial; its zones follow the value meanings), bar with zones, status light, or a tile grid for table readings (one coloured tile per row, for example 4 rooms). Plus a small trend line in the readings table. Scale from / to and decimals per reading. The old Card and Bar tick-boxes are converted automatically.
- **Compact and clearer readings table.** Shorter rows, a colour dot for the state of each reading, name with unit chip and a small line for OID and calculation, smaller Edit / Remove buttons, tighter reading editor.
- Tests: duplicate-notification rule test and view migration test.

## 1.54.1
- **Pick from MIB** in the reading editor now has the full search: a **MIB file** drop-down, a search box (name, module, file name or OID; several words must all match), paging through all results with the total shown, and the syntax column. Before, it listed only the first 40 matches.

## 1.54.0
**Value meanings are now rules, so levels work for every reading** (temperature, voltage, battery, humidity, signal, load… from any vendor), not only fixed status codes.
- A reading's meanings are an ordered list of rules: *equal to*, *below*, *at or below*, *above*, *at or above*, *between*. The first rule that fits wins (move rules with the arrows). Example: at or above 25 = Critical, at or above 22 = Warning, below 22 = Normal.
- **Keep until:** a rule can hold its state until the value is back past a second value (Warning from 22, kept until below 20), so alarms do not flap around the limit.
- The word and colour show on the device page (cards, readings table, row tables); Warning and Critical raise an alarm by themselves and clear when the value is OK. Going from Warning to Critical clears the warning and raises the critical.
- **Who is told, per state:** Warning and Critical each have their own notification boxes per reading (for example Critical e-mails, Warning only logs). Alarm rules are named after the reading ("Room A temperature (Fake-1) warning").
- Table readings apply the rules to each row. Existing fixed meanings (1 = up, 2 = down) and the ready-made sets work as before. Rules are copied with the reading to other devices and templates.
- Tests: new unit test (limits, between, hold, state change, recipients) and one e2e check.

## 1.53.0
SNMP polling redesigned around the device: **Step 1** add the device with its SNMP settings, **Step 2** add its readings, each with everything that belongs to it.
- **Readings on the device page.** Every reading has its own name, unit, OID (with a MIB picker and a **Test read** button that shows the raw and the calculated value), type (number, counter rate, uptime ticks, text), calculation (**raw × scale + offset**, new), value meanings (words and states for status numbers), any number of alarms (limit, clear value, duration, severity, who is told) and display options (graph on/off, line or filled area, card at the top, bar, top of the axis, decimals). Nothing is shared between readings, so changing one cannot affect another.
- **Copy readings** from another device (with calculation, meanings, alarms, display), or **Use a template**, or start from a **built-in set** (Cisco, APC, …) and edit it. Copies are independent of their source.
- **Templates:** *Save as template* on a device; apply it to any device; rename and delete under Settings → Templates.
- **Fewer tabs:** Devices, Reports, Settings. Settings has General, Alarm limits, Value meanings, Templates and Shared sets (advanced); the old shared profiles, thresholds and lookups keep working and are still there.
- Add device is now Step 1 only (no "What to read" box): after Add device the page opens at Step 2.
- Per-reading alarms and meanings are kept out of the shared Alarm limits / Value meanings lists (they are edited on the device) and are removed with the device or the reading.
- Table readings, text readings and decimals are passed to the device page correctly; a text reading is no longer drawn as a graph.
- Tests: new `test/readings.test.js` and five e2e checks; manually tried against the fake device (add device → add readings → test read → card, alarm, copy, template).

## 1.52.6
- **Table metrics no longer show an average.** The summary card of a metric with several rows (one value per row) showed the average of the rows (for example 10 for 22, 6, 6, 6). It now shows a summary of the rows: with a lookup "All 4 OK" or "1 Critical, 3 OK" (coloured by the worst row); without one the lowest and highest value.
- **Fake SNMP device for trying things on one PC:** `node tools/fake-device.js` (UDP 1161, v2c, community `public`) with interfaces, CPU, uptime and a 4-row table; commands `hot`, `critical`, `cool`, `down n`, `up n`. Guide: `docs/FAKE-DEVICE.md`.
- Tests: the probe polling test uses its own ports (it collided with another test on slow machines and made the GitHub publish fail); the publish workflow retries the tests once.

## 1.52.5
Fix: a device whose profile has no Uptime value showed "–" for uptime, and a table metric with a lookup (for example "Temperature Normal (22)") lost its graph.
- Uptime is always read, whatever the profile.
- Metrics that use a lookup are graphed again (numeric value; one line per row for tables).
- **Lookups vs thresholds made clear.** Both SNMP tabs and the polling Settings now start with a short explanation: a *lookup* turns status codes into OK/Warning/Critical, a *threshold* watches a measurement against a limit, both raise the same normal alarm (Alarms page + a syslog line).
- **Notify choice you can change.** The "Tell" multi-select boxes (which could not be cleared) are replaced by tick-boxes named **Notify** for thresholds, lookups and "No SNMP answer". Nothing ticked = alarm only (no e-mail/message). Lookups now have their own Notify list on the Lookups tab; until you save it, it keeps using the No-answer list as before.

## 1.52.4
Fix: the device graph for a table metric (one reading per row, e.g. alarm voltages/temperatures) stayed on "Collecting data…" although the row values were shown. The graph now draws one line per row (up to 8; the Graph button on a row still shows a single row).
- Lookup (status) metrics no longer get an empty numeric graph.
- **Nothing is polled unless you choose it.** New devices use the new profile **Uptime only (add your own values)** and have interface polling **off**; no interface status, traffic, CPU or memory is added by itself. The device dialog has a new **Interfaces** option (Do not poll / Poll the ones that are up / Poll all) and the device page hides the Interfaces panel when it is off. Existing devices keep what they had; set **Interfaces: Do not poll** and pick a custom profile to get rid of the automatic values. ("Detect from the device" and the built-in profiles are still available if you want them.)

## 1.52.3
Final test release of the one-click update path (no program changes).
- GitHub workflows use Node 24 based actions (no deprecation notice).

## 1.52.2
Fix: an update address or public key saved by an older version no longer overrides the built-in source (the old key made "The signature is not valid for your public key" appear on servers that had used the old Updates boxes).
- Stored address/key are ignored unless `"custom": true` is set beside them in the update settings (private mirrors only).
- To repair a server that is still on 1.52.0/1.52.1 without the installer, see the note in the release message.

## 1.52.1
Test release for the one-click update path.
- Settings → Updates also shows the release date of the newest version.

## 1.52.0
One-click updates, and a compact Settings page with one clear Save.
- **Update = one button.** Settings → Updates now shows only the version and a button (**Check for updates**, then **Update to x.y.z**). The release address (GitHub `rijoshp-web/neteventpro-releases`) and the signing public key are built into the program, so a copy installed on another computer updates with no setup. The address, key and Node.js-address boxes are gone from the screen (a `config.json` override still exists for private mirrors). Checks run by themselves every 6 hours. After the click the page waits for the service to come back and reloads.
- Safety is unchanged: Ed25519 signature, SHA-256, only program files replaced, automatic roll back. A server with no internet says so and is updated with the installer; its probes still follow it.
- **Automatic publishing**: `.github/workflows/release.yml` tests, signs (secret `NEP_RELEASE_KEY`) and publishes a GitHub release whenever a `v*` tag is pushed. Steps: `docs/RELEASING.md`. `scripts/release.js build` works without arguments on GitHub.
- **Settings page**: compact spacing; long notes are folded behind a small (i) button (tick **Show notes** to open them all). There is now **one Save changes** button at the top with a live "● Unsaved changes / ✓ All changes saved" indicator, Ctrl+S, and a warning if you close the page with unsaved changes. Sections that hold their own list (Users, Rules, Backup, …) are marked "has its own Save button inside".
- Not tested here: a real GitHub release and download (the signing key is yours; the update flow is tested against a local fake release server), the Windows installer.

## 1.51.0
SNMP polling: more data types, lookups and operators, as steps towards replacing PRTG (guide: `docs/PRTG-to-NetEventPro.md`).
- **Data types** per reading: Number, Counter (per second), Uptime ticks (to seconds), **Text** (firmware, status text; one value or one per table row). Unit suggestions (%, °C, V, A, W, Hz, rpm, dB ...).
- **Lookups** (new tab): a number becomes a word and a state (OK, Warning, Critical, no alarm). Seven ready-made lookups (interface status, colour status, up/down, ok/fail, on/off, true/false, UPS battery) and your own. Warning and Critical values raise an alarm by themselves, **per table row**, and clear when the value is OK again. **Pick from MIB** creates a lookup automatically from a MIB type with named values (e.g. `AlarmColor`).
- **Thresholds**: operators above, below, at least, at most, **equals**, **is not**; for text values **changes**, is, is not, contains, does not contain.
- The device page shows a **Status** panel (lookup words in colour, text values), and rows of text tables.
- New guide for people coming from PRTG: sensor-by-sensor mapping, step-by-step setup, honest list of what is not there yet (ping/port/HTTP checks, dependencies, maps, WMI) and a safe switch-over plan.
- Not tested here: real devices (fake SNMP agent and the test suites only).

## 1.50.1
- **Fixed: a MIB table showed only some of its columns in Pick from MIB.** Example: the CM-MIB `almAnalogInterfaceTable` has 10 columns but only 3 were offered. Two causes: (1) columns whose type is a *named value list* (`AlarmColor ::= INTEGER { green(1) ... }`) were not recognised as numbers; (2) columns that the device sends **as text** (`DisplayString`, e.g. a voltage "12.4") were left out. Both are offered now: the table is complete (the comment/name column is used to name the rows instead of being a value), and text values show a "text number" tag.
- **Polling reads numbers from text** ("12.4", "12.4 V", "-3,5"); a value that is not a number ("n/a") is skipped.
- Whole table now names the rows by the table's comment/name column (for example `almAnalogChComment`).

## 1.50.0
Fixes after the first tests of 1.49.
- **Probe auto-update without internet**: when the main server was updated from the installer (or by copying files) instead of online, it now offers *its own installed program files* to its probes. The probe checks the SHA-256, installs them and restarts. Online-updated servers still offer the signed package (signature checked by the probe). On the probe page (Install update from the main server / Trust the main server) the status of the last check is shown. The "Trust the main server" option (default on) is what allows the unsigned, installer-based update; switch it off to allow signed packages only.
- **Wall display clock for every dashboard**: the date-and-time bar now follows the page's wall-display state, so it appears for every dashboard, existing or new, however wall mode was started (button, *Wall link*, or a dashboard switch). It shows the computer's clock until the server time arrives.
- **SNMP polling, tables**: a table column can be read **row by row** (*table: every row separately*): one value per row, named by the row number or by a **name column** (for example the sensor name), with its own graph and its own thresholds per row. The device page lists the rows with a Graph button. In **Pick from MIB**, columns are added row by row by default and a new **Whole table** button adds every numeric column of that table with its name column at once. (Before, a table was always combined into one number: average, highest, lowest or sum.)
- **Fixed: Latest messages tile showed only errors**: a tile made from "Latest errors and worse" kept an old *severity limit* even after all severities were ticked in the severity filter. Changing the severity filter now clears it. Tiles that were already saved: open the tile, tick the severities you want once more.
- Not tested here: real probes and installer updates on Windows, real devices with tables.

## 1.49.0
Fixes and additions for several people using one server, probes, the wall display and SNMP polling.
- **Fixed: signing in on a second PC signed the first one out.** A sign-in with an older password hash silently upgrades that hash; this ended every other session. Sessions that were valid stay valid now (a real password change, role change or user change still ends sessions). Test: `session-keep.test.js`.
- **Roles are enforced everywhere**: the **Rules & alerts** page and its link are only shown to people with the Rules permission (Viewer: no; Operator: yes), and a typed address cannot open a page the account has no right to. A Viewer sees dashboards, logs, traps, alarms, devices and health, and nothing that configures. In the Devices list the group, expected-interval, note, mute and forget controls are disabled for accounts without the Settings permission.
- **SNMP polling is for the Administrator**: new permission **SNMP polling** (Users → Roles). Only the Administrator role has it by default. The link, the page and every `/api/poll/*` call need it (checked on the server).
- **Probes update with the main server**: Settings → Updates → *Update my remote probes automatically*. After this server installs a signed update it keeps that package; each probe asks every 5 minutes, downloads it, checks the SHA-256 and the Ed25519 signature, installs it and restarts. The probe uses its own release public key (Settings → Updates on the probe); without one it trusts the key the server sends only when the server certificate is pinned. A probe can switch this off (*On a probe: install the update that the main server offers*). A probe older than 1.49 needs one manual update first.
- **Wall display: top title bar** with the date and the time only (large, server time / NTP zone).
- **SNMP polling, MIB picker**: choose a **MIB file** from a list or search by name, module, **file name** or OID (several words must all match); results are paged (100 per page, Previous/Next, "101–200 of 7159") instead of stopping at 100. Numbers that a MIB defines through a textual convention (for example a vendor "Gauge" type) are now offered too.
- **SNMP polling is gentler on devices**: one request at a time per device with a pause after each (Settings → Pause between requests, default 30 ms), at most 64 requests in flight over all devices, table reads ask for 10 rows at a time (was 20; halving on "too big" stays), and a device that does not answer is asked less and less often (2x, 4x, ... up to every 10 minutes) until it answers again. Existing limits stay: interval at least 10 s, devices at once (default 5), polls spread out, bounded table sizes, discovery with a small limit.
- Not tested here: real Windows machines and real probes on a network, real SNMP equipment (a fake device, a real central process and the test suites were used).

## 1.48.0
SNMP polling, step 3: polling through a probe.
- **Poll from**: every device (and every discovery) can be polled by **this server** or by a **probe**, for devices this server cannot reach. The probe asks the server every 10 seconds for its devices (with their SNMP credentials, over its authenticated HTTPS link; kept encrypted on the probe PC), polls on each device's own schedule with the same code the server uses (new shared module `pollcore.js`), and sends the results back. The server stores the readings and evaluates thresholds and the No SNMP answer alarm exactly as for its own polls.
- **Link down**: results wait on the probe (encrypted file, up to 10 000 results) and are sent in order when the link is back, with the time of each poll. A probe that stays silent shows its devices as **Probe not reporting** (no alarm for the devices meanwhile).
- **Test connection and Discover devices run on the probe** (they start within 10 seconds, when the probe next asks).
- The probe page shows how many devices it polls, polls made, results waiting and when it last got its device list. The server refuses results for devices that are not the probe's. Ping check (optional) runs on the probe.
- Internals: SNMP collection moved to `pollcore.js` (shared); `Probe.post` can use other API paths.
- Not tested here: real devices behind a real firewall (a real probe program and a fake device were used on one computer).

## 1.47.0
SNMP polling, step 2.
- **Discover devices**: scan addresses (`10.1.2.0/24`, `10.1.3.10-50`; at most 1024 per scan) with up to 5 community strings or one SNMPv3 user; the ones that answer are listed with name, vendor and matching profile, and the chosen ones are added with the credentials that worked (the credentials never go to the browser). Only one scan at a time, can be stopped.
- **Pick from MIB** in custom profiles: search the numbers defined by the MIB files you have loaded and add them as readings (table values are combined by average, highest, lowest or sum; counters become rates). This is how Eltek, Spectracom, Eventide, DNWP and other vendors without a built-in profile are read; no vendor OIDs were guessed.
- **Reports tab**: availability, CPU, memory and temperature (average and highest), answer time and polling alarms per device for 24 hours to a year; CSV of the summary or of every reading of one device (needs the Export permission; formula characters are neutralised).
- **SQL Server copy**: the 5-minute averages are copied to table `ne_poll` (device name, reading, item, average, min, max; switch in SQL Server page, schema version 3). History is copied on the first run.
- **Test connection** and discovery show the vendor of the device.
- Not in this step: polling through a probe (step 3), vendor-specific built-in profiles. Not tested here: SQL Server (a stand-in worker is used) and real devices.

## 1.46.0
SNMP polling, step 1 (polling from the main server).
- **New page SNMP polling**: Overview (status cards, device table), device page (graphs from 6 hours to a year, interface table with status, traffic and errors), Add/Edit device with **Test connection**, Profiles, Thresholds, Settings.
- **SNMP v1, v2c and v3** (MD5/SHA/SHA-2 authentication, DES/AES privacy) over UDP with timeouts, retries, "too big" and v1 "no such name" handling, SNMPv3 engine discovery and time re-sync. Checked against an independent SNMP agent (pysnmp) for v1, v2c and v3 SHA/AES, including a wrong-password report.
- **Readings**: CPU, memory, temperature, uptime; per interface status, in/out traffic (64-bit counters when the device has them, wrap handled) and errors. Built-in profiles **Generic**, **Cisco switch/router** and **APC UPS** (read-only, each reading can be switched off), picked from the device's vendor number; your own profiles with your own OIDs (duplicate a built-in one to start).
- **Thresholds** (reading, above/below, for how long, clears when, severity, devices, notification profiles) raise normal alarms that clear by themselves; interface thresholds work per interface. **No SNMP answer** alarm after a set number of missed polls (default 3), optionally with a ping check in the text; it clears when the device answers again. Alarm state survives a restart. Devices in a maintenance window raise nothing.
- **Scheduling**: polls are spread out, at most a set number at the same time (default 5). Readings are kept in full for 7 days, then as 5-minute averages for a year.
- **Secrets**: communities and SNMPv3 passwords are encrypted in `config.json` like the other secrets, and shown as `********` to the browser. Audit-log entries for adding, changing and removing devices, profiles, thresholds and settings.
- Not in this step: polling through a probe, discovery of subnets, MIB-based profile builder, vendor profiles (Eltek, Spectracom, Eventide, DNWP, Dell), reports and the SQL copy of readings. Not tested here: real devices (only a fake device and pysnmp).

## 1.45.1
- **Help**: new topics for Notifications (profiles, e-mail, SMPP SMS, Teams), SQL Server copy and Security (two-factor, policy, lockout, allowed addresses, audit log, secrets at rest); a Probe security section in Remote probes; flap detection in Rules; the one-day view in Logs; dashboard sharing and the wall display in Dashboard. Earlier releases had only a "What's new" line for these.

## 1.45.0
Secrets at rest.
- **Encrypted in `config.json`** (AES-256-GCM, key in `secret.key` in the data folder): SMTP password, SMS (SMPP) password, SQL Server password, webhook and Teams addresses (they contain a secret), report-folder passwords, SNMPv3 passwords (users and trap forwarding), backup passphrase and folder password. In memory and on screen nothing changes. Plain values from older versions are converted at the first start.
- **Two-factor secrets** in `twofactor.json` are encrypted the same way (a 1.43 plain file is converted).
- **Backups keep readable settings** (the passphrase option encrypts the whole backup), so a backup can still be restored on another computer, where `secret.key` does not exist. Use a passphrase for any backup that leaves the server.
- If `secret.key` is lost (for example, only `config.json` is copied to a new PC), the encrypted values read as empty: enter the passwords again. Keep `secret.key` with the data folder.
- The key sits next to the data: this protects copies of the files (e-mailed config, file shares, antivirus uploads), not a person who can read the whole data folder as the service account.

## 1.44.0
Security release for the probe (and for the probe's link to the main server).
- **Sign-in for the probe page**: set a password (10+ characters) on the probe page; every API call then needs the sign-in (session cookie, 30 minutes idle, HttpOnly, SameSite=Strict, CSRF header as before). Five wrong passwords lock the address for 10 minutes. Without a password the page stays as before: this computer only.
- **Network access (optional)**: "Open from other computers" needs a password first, with an **allowed addresses** list. A change applies after a service restart.
- **HTTPS for the probe page**: "Create a certificate" makes a self-signed one (TLS 1.2+, HSTS). Plain http is flagged when the page is opened from the network.
- **Encrypted at rest**: the waiting-packet queue (`probe-queue.json`, AES-256-GCM, key in `secret.key`) and the probe token in `config.json` (`enc1:`). Older plain files are converted at the first start.
- **Certificate pinning** for the link to the main server: "Pin the server's certificate…" shows subject, issuer, expiry and SHA-256, and from then on the probe only talks to a server presenting exactly that certificate; nothing (not even the token) is sent to anything else. Also **Refuse plain http://** and a warning when the server address is http.
- **Receive limit** per sending device (packets per second) so one noisy device cannot fill the queue.
- **Probe audit log** (`probe-audit.log`, shown on the page): sign-ins, failures, password, setting, certificate and pin changes.
- **On the main server** (Settings → Remote probes): **New token** per probe (the old token keeps working for 24 hours, so the probe PC can be updated without a gap) and **Addresses**: a per-probe list of addresses its token may come from. Both are audited.
- New `src/secretbox.js` (also used for secrets at rest in 1.45). The key sits next to the data, so this protects copied files and backups, not a person who can read the whole data folder.

## 1.43.0
Security release for the dashboard (the probe follows in 1.44).
- **Two-factor sign-in (authenticator app)**: Settings → Access & updates → Security → "My two-factor sign-in". Works with Microsoft/Google Authenticator, Authy and others (type the setup key; time based, 6 digits). 10 one-time **recovery codes** are shown once. Each code works once. An administrator can reset another account. Accounts with two-factor sign in on the web page only (Basic-auth scripts are refused for them).
- **Audit log** (same place): every sign-in, failed sign-in, failed code, password change, user change, probe change and security change, with a filter and **Download CSV**. New entries are tagged so they can be filtered (older "who changed what" lines stay in the normal log).
- **Password policy**: minimum length 8 to 64, optional complexity (3 of 4 character kinds, not containing the user name), very common passwords refused. Applies to every new password.
- **Account lockout** by user name (default 5 wrong tries, 15 minutes; settings and unlock button), on top of the existing per-address lock. The server's own console is never locked out.
- **Allowed addresses** for the dashboard (IPs or ranges). This computer is always allowed, and saving a list that would lock you out is refused. Remote probes are not affected.
- **HSTS** option (when the dashboard runs on HTTPS) and a reminder switch for two-factor.
- **Stronger password hashing**: scrypt cost raised from 2^14 to 2^16 (about 0.2 s per sign-in). Older hashes keep working and are replaced at the next successful sign-in.
- Not included: password expiry/history, a QR code for the authenticator (the setup key is typed), and enforcing two-factor by blocking sign-in (a block could lock everyone out, so it is a reminder).

## 1.42.1
- **New dashboard** (Customize → New dashboard) creates an **empty** dashboard instead of one with the standard tiles. It stays empty until tiles are added (flag `blank`, kept by the server); **Reset layout** brings back the standard tiles. **Save as…** still copies the current dashboard.

## 1.42.0
- **Export / import dashboards** (Customize → Export… / Import…): a dashboard is saved as a `neteventpro-dashboard-<name>.json` file and can be imported on another NetEventPro as a new named dashboard (max 20; file checked: size under 2 MB, type, up to 300 tiles; the device filter is not imported; the settings are checked by the server again when saved).
- **Wall display**: button on the Dashboard page (full screen, no menus; Esc or "Exit wall display" leaves) and **Wall link**, which copies `#dashboard?board=<id>&kiosk=1`. The wall computer signs in once; there is no link that works without signing in (on purpose: nothing is exposed to the network without a login).
- The address bar now understands `#page?name=value` (used by the wall link).

## 1.41.0
- **One-day view** (new first choice in the time range of Logs, SNMP traps and Alarm history, and the default whenever these pages open): a calendar day from 00:00 to 23:59 (browser time) with **◀ previous day / next day ▶**, a date box and a Today button. Today's view keeps receiving live messages; a past day is fixed. Alarm history shows the alarms that existed during that day. The existing ranges (last 15 minutes ... custom) are unchanged. Active alarms are still shown whatever their age.
- **Retention**: the default is now 2 years (730 days) and no size limit. Once, at the first start of this version, an install that keeps messages for less than 2 years is raised to 2 years and the old 2048 MB size cap is switched off (0 = keep everything stays as it is). Change it in Settings → Storage & time. Plan for disk space: 2 years of heavy syslog traffic can be tens of GB; the System health page warns about the disk.

## 1.40.0
- **Flap detection** (per rule, syslog and SNMP trap rules alike): in Rules → Alarm set *flapping: after N changes within M min = one flapping alarm; ends after K quiet min*. Every raise and every clear (link up) of the same rule, device and port counts as a change. At N changes one alarm named "<rule> (flapping)" is raised and told once; further changes only update it and send no alerts (webhook, e-mail, SMS, profiles); a link-up does not clear it; after K quiet minutes it clears itself. Counting is per device and port, so other devices are not affected. State survives a restart (open flapping alarms are recognised again).
- Tests: flap unit test and an end-to-end check (326 checks).

## 1.39.0
- **SQL Server views** `ne_syslog` and `ne_traps` (filtered views of `ne_logs`); schema version 2. An existing database gets them automatically after the update (the layout step runs again once).

## 1.38.2
- **Settings tabs**: Rules & alerts, Notifications, SQL Server and Reports moved into the Settings page as tabs (replacing the side-panel group of 1.38.1). Old links (`#rules`, `#notifications`, `#sqlcopy`, `#reports`) open the right tab for users who may change settings; users with only the rules or reports permission still see those pages in the side panel.
- **Rule window** arranged in four labelled sections (Which messages / What happens to the message / Who is told when it matches / Alarm), aligned labels, and the alarm options split over three lines.

## 1.38.1
- **Side panel**: Rules & alerts, Notifications, SQL Server and Reports are grouped under **Settings**; every icon has its own colour from the active theme.
- **Rule editor**: the notification profiles are picked from a compact multi-choice drop-down instead of a row of tick boxes. The two pickers are different on purpose: *Notify* = told when the rule matches, *Alarm → tell* = told when the alarm is escalated or clears.

## 1.38.0
- **Copy to SQL Server** (new **SQL Server** page): logs and traps (`ne_logs`), alarms (`ne_alarms`, updated on every acknowledge / clear / escalation) and devices (`ne_devices`) are copied to a Microsoft SQL Server database. The local database stays the main store.
- **Catch-up**: a "copied up to here" mark per table; when the SQL Server or this service is down nothing is lost while the rows are still stored locally. Retries with growing pauses (5 s to 5 min). Batches are merged by number, so repeating a batch never duplicates rows.
- **Login**: Windows (the account the service runs as) or SQL Server login; encrypt / trust-certificate options; optional **Create the database if it does not exist** (needs dbcreator / sysadmin, otherwise an empty database with db_owner); tables and a schema-version table (`ne_schema`) are created automatically.
- **Test connection** (uses the form, not the saved settings; reports server version, login and whether the database exists / can be created), status with pending and copied counts, last error with next retry, **Copy everything again**.
- Worker: `src/sqlcopy.ps1` (Windows PowerShell 5.1, System.Data.SqlClient, SqlBulkCopy into a temporary table, then MERGE). Nothing to install. The password is sent on stdin only and masked in the settings answers.
- Alarms table: new column `upd` (last change). Tests: 143 unit, 324 end-to-end. Tested against a simulated worker only, not a real SQL Server.

## 1.37.0
- **Notifications page** (new, under Rules & alerts): **Profiles**, **E-mail server**, **SMS gateway (SMPP)** and **Delivery log**. A profile holds only the delivery details: e-mail addresses (To / Cc), SMS numbers and a webhook address with a format (generic, Slack, Microsoft Teams Adaptive Card). Each profile has Test, Edit, Copy and Delete.
- **Rules pick profiles** (one or more, like PRTG) for the alert and, separately, for escalation and clear messages. Message text, severity and cooldown stay in the rule (default cooldown 300 s when a profile sends e-mail or SMS, else 60 s). Deleting a profile removes it from the rules.
- **SMPP 3.4 client** with no extra software: plain or TLS, transceiver or transmitter bind, numeric or alphanumeric sender, ASCII (160 characters) or UCS-2 (70) text, readable gateway error codes, an hourly SMS limit (default 30). No multipart messages: longer text is cut with "...".
- **Delivery log** (last 300) with channel, profile, rule, device, result and error. Webhook addresses are logged by host only.
- The E-mail and Webhook sections moved from Settings to Notifications. Old per-rule e-mail / webhook / escalation-recipient settings are converted to profiles once, when the service starts; the SMTP default recipients stay for reports.
- Tests: 139 unit, 319 end-to-end checks. Tested against a simulated SMSC, not a real operator.

## 1.36.0
- **Any visual on any data.** **Add tile** is now three steps: pick a visual from a gallery with pictures (like Power BI), pick the **data** (Syslog messages, SNMP traps, both, Alarms, Devices, System), then colours and options in the live-preview editor. Number, gauge, number-with-trend, line, trend, severity, bar, pie, treemap, table, bar gauge, top list and latest list work on alarms; the ones that make sense also work on devices.
- **The data is named on every tile**: a small label (Syslog, SNMP traps, Alarms, Devices, System) in the tile header (switch off per tile). The editor's new **Data** group changes the visual or the data of an existing tile and keeps colours and looks.
- **Alarm cards are ordinary tiles**: saved alarm cards are converted to Number tiles on the Alarms data (same titles, colours, look and click-through). New alarm numbers: active, open, acknowledged, escalated, raised, cleared, average time to clear. New device numbers: all, reporting, silent, muted, overdue, with open alarms, sending syslog, sending traps.
- **Calculations**: percent / ratio / difference / sum with another number, average per minute / hour / day, change and percent change since the period before, multiply and add; chart calculations: running total, moving average, rise per step, per-minute rate.
- **Device filter** for a whole dashboard, and **named dashboards** (Save as, New, Rename, Delete; up to 20, each with its own tiles, look, range and filter). Click-through: alarm tiles open the Alarms page, device tiles the Devices page.
- Server: `/api/dash` accepts `ds` (alarms, devices), alarm filters (`astate`, rule) and device filters (`dstate`, vendor, group), all validated and bound as SQL values. Tests: 312 end-to-end checks, 135 unit tests.

## 1.35.1
- **Recovery e-mail for escalated alarms**: when an alarm that was escalated by e-mail clears (by hand, by a "clear the alarms of ..." rule, or by auto-clear), a green **CLEARED** e-mail goes to the same recipients (rule recipients or the default list), with how long the alarm was open, the alarm details and the other open alarms of the device; no report attached. Alarms that never escalated send nothing. Per-rule switch **e-mail when it clears** (Rules → Alarm, on by default). Tests added.

## 1.35.0
- **Tile editor with live preview** (Edit on any tile): grouped options like the Grafana / Power BI panel editors. The same options apply to **every** tile type, alarm cards and section headings included.
- **Tile look**: transparent / solid / gradient background (angle, opacity), border, accent edge, corner radius, shadow or glow, inner space, text colour; ready-made looks (Grafana panel, Power BI card, Glass, four gradients, Title bar, Neon glow). **Title**: show/hide, align, size, colour, capitals, solid or gradient title bar.
- **Value options** for numbers, gauges and alarm cards: size, alignment, decimals, short form, unit before/after, trend line behind the number (area or line); gauge styles half dial, full ring, LCD segmented bar, flat bar; bar gauge styles gradient, LCD, solid.
- **Colour steps (thresholds)**: any number of steps colour the number, dial, bars or the whole tile (solid or gradient); replaces the old warning / critical fields (old values are converted when a tile is opened).
- **Chart options**: line width, fill %, gradient fill, smooth lines, points, stacked lines, stacked bars / areas / lines for "Messages over time", grid and axis switches, legend below / right / hidden; per-tile chart palettes (Power BI, Grafana, Warm, Cool, Neon, Pastel, Greys).
- **Alarm cards are now tiles** (type "Alarm card") placed above the Syslog section; the old "Alarm banner" dialog is gone. Titles, colours, order and visibility of an existing banner are converted once.
- **Dashboard settings** (inside Customize): **Quick look** (Power BI, Grafana, Neon NOC, Executive, Plain) and page background (solid / gradient). The Style and Full screen buttons were removed (the app already has full screen); **Syslog first / SNMP first** is now a switch.
- Panel options are validated on the server (`uiPrefs.dash`); tests added.

## 1.34.0
- **Dashboard studio** (Power BI / Grafana style): new tiles **Bar chart** (horizontal or vertical), **Treemap**, **Table**, **Bar gauge**, **Number with trend line** and **Text note**; bars, rectangles and table rows open the matching messages on the Logs page.
- **Style** dialog: eleven colour themes (Classic, NOC, Power BI light/dark, Midnight violet, Aurora, Sunset, Deep ocean, Neon night, Forest, Slate) with their own chart palettes, card style (solid, raised, glass, outline, accent edge), title style, corner radius, tile spacing, row height, accent colour, refresh interval (5 s to 5 min or manual). Changes preview live; Cancel undoes them. Look settings are saved with the dashboard (`uiPrefs.dash.style`, validated server side); the colour theme stays per browser.
- **Number** tiles get amber/red levels; **Full screen** mode hides the menu for wall displays.
- Tests: tile types and style settings validation (e2e).

## 1.33.0
- **Network share sign-in for report and backup folders**: new "network share sign-in" user and password next to the report folder (each scheduled report) and "Also copy to a folder" on the backup page. When a user is given and the folder is a Windows share (`\\server\share`), NetEventPro signs in to that share with it (`net use ... /persistent:no`, repeated before every use) and then creates/writes the folder. Without it the service keeps using its own account. Error texts say what is wrong (wrong password, no permission, path or share not found, port 445).
- The passwords are stored in `config.json` (owner-only file), shown as `********` on screen and kept when saved unchanged, like the e-mail password.
- Test folder uses the user and password typed on the page.

## 1.32.1
- **Report and backup folders on a network share** (`\\server\share`): "Test folder" and the delivery failed with `EPERM: operation not permitted, mkdir '\\server\share\'` even when the share existed, because Node's recursive mkdir fails on the root of a share. An existing folder is now used as it is (`src/fsutil.js`). If the share really cannot be written, the message explains that the service reaches shares as the computer account and what permission to give.
- Help: steps for using a network share as report folder.

## 1.32.0
- **Text replacement now works on the trap columns, for old and new traps**: replacements for SNMP traps are applied when a trap is shown or exported (new `src/trapreplace.js`, mirrored in the browser) instead of when it arrives, so traps already stored change as well and a change of a rule shows at once. Before, the trap columns were built from the stored values and the replacement did not reach them.
- **Choose the columns**: every replacement has a "Trap columns" choice (the columns of the trap column views; none ticked = all). Also available in exports, PDF/Excel and e-mail reports.
- "Only in this trap value" rules (for example `alertCurrentStatus`, 5 -> Critical) work the same way. The stored trap, the severity taken from a trap column and alarms are not changed by replacements.
- Message text and device name are still changed as messages arrive (not when columns were chosen for the rule). A trap column made of `{message}` is left alone.

## 1.31.5
- **Trap column lookup tables accept several values in one entry**: `@ 1.3.6.1.4.1.12148: 0,2,3,8=Critical; 1=Cleared` (values separated by a comma or `|`; number ranges as `2-5=Critical`). An entry written on its own still wins over a list. Works on screen, in exports/reports and for the trap severity (same rule in the browser and on the server). The older one-value-per-entry form keeps working.

## 1.31.4
- The https dashboard no longer sends the HSTS header when it is opened through `localhost` / `127.0.0.1`. Chrome applies HSTS to the whole host name regardless of port, so an earlier https dashboard made Chrome force https for every `http://localhost:<port>` address (a probe status page then did not open in Chrome, while 127.0.0.1 and other browsers did). The dashboard shortcut and status icon now open `http://127.0.0.1:<port>/` for http dashboards. Help explains how to clear the saved setting in Chrome (`chrome://net-internals/#hsts`, delete `localhost`).

## 1.31.3
- Probe status page: it now listens on IPv6 (`::1`) as well as `127.0.0.1`. On many Windows PCs `localhost` is tried as IPv6 first, so `http://localhost:8514/` and the dashboard shortcut did not connect while `http://127.0.0.1:8514/` did.

## 1.31.2
- Installer: the "Type of installation" page is now shown also on a PC that already has NetEventPro (before, an existing data folder made the setup skip it, so a probe could not be chosen). On an update the default is "Keep this computer as it is now"; choosing Full or Probe there changes the type (the program applies the choice at its next start). Only a fresh installation asks for the ports.

## 1.31.1
- Installer: fixed a compile error in `NetEventPro.iss` introduced in 1.31.0 (a comment on the same line as the `UsePreviousAppDir` setting). No change to the program itself.

## 1.31.0
- **Lean probe**: when `mode` is `probe` the service starts a small program (`src/probe-main.js`) instead of the full application. It loads only the syslog (UDP/TCP) and SNMP trap listeners, the on-disk queue and sender, and a status/settings page on `127.0.0.1` (this computer only). No database, rules, alarms, reports, MIB files, e-mail, users, backups or dashboard API are loaded or served. Memory use and attack surface are much smaller.
- The probe page shows connection state, counters and errors, and edits server address, token (never shown again), name, self-signed option, ports, allowed sources and the update address/key; it can test the connection, check/install signed updates, restart, and switch back to a full NetEventPro.
- **Installer**: new page "Type of installation": Full or **Probe only** (asks for server address, token and name). Silent installs: `/VERYSILENT /PROBE=1 /SERVER=... /TOKEN=... /NAME=...`. Upgrades keep their existing mode.
- Choosing "A probe" in Settings -> Remote probes of a full installation now restarts the service as a lean probe.
- Help: the Remote probes topic is rewritten.

## 1.30.2
- **Program folder renamed too**: running the new setup over an installation in `...\SyslogPro` (normally `C:\Program Files\SyslogPro`) installs into `...\NetEventPro` next to it, moves the service, firewall rule, shortcuts and autostart entry there, and then deletes the old `SyslogPro` program folder (only the program files; your data is in `ProgramData\NetEventPro`). An installation in a folder with any other name, chosen by hand, stays where it is. Close the status icon (tray) before upgrading if you want the old folder removed completely; otherwise a locked file may leave an empty old folder that you can delete by hand.

## 1.30.1
- **Every internal name is now NetEventPro**: Windows service id and wrapper (`NetEventProService.exe`), firewall rule, tray program and its autostart entry, data folder `C:\ProgramData\NetEventPro`, icon, certificate files (`neteventpro.crt/.key`), backup and database download file names, environment variables (`NETEVENTPRO_*`; the old `SYSLOGPRO_*` names are still read), request header, internal log lines and the zip layout of release packages.
- **Upgrading an existing installation**: run the new setup program over it once. It stops and removes the old `SyslogPro` service and firewall rule, renames `ProgramData\SyslogPro` to `ProgramData\NetEventPro` (all messages, settings, users, backups kept), installs the new service and starts it. HTTPS certificate paths inside the old folder are found in the new one.
- An installation that is only updated online keeps working unchanged: if only the old data folder exists it is used as it is, old backups (`auto-syslogpro-*`) are still listed and restorable, and the old request header is still accepted.

## 1.30.0
- **Same columns everywhere**: CSV, Excel and PDF exports and the scheduled/e-mailed reports use the columns, order and names of the Logs, Traps (including trap column views) and Alarms windows.
- **E-mail reports**: new aligned layout (summary tiles, tables, alarm cards) that also fits phone screens.
- **Devices**: duplicate rows (one per IP address plus one per name) are merged into the named device; the vendor of SNMP trap devices is filled from the enterprise number (Dell, Eltek, APC, Cisco ...) and kept.
- **Text replacement** now works for SNMP traps: new scope "SNMP trap name and values" and an optional "Only in trap value" column. Plain numbers never change OIDs or longer numbers.
- **Installer**: new installs go to `NetEventPro` (existing installs keep their folder and update normally).
- **Help**: obsolete "New in 1.x" pages removed; new pages for the SNMP version column, HTTPS certificates, e-mail ports and port forwarding, and creating/hosting updates.

## 1.29.1
- The MIB assistant no longer has its own "Upload MIB files..." button (it did the same as the one in the MIB files panel). Nothing changes in how MIBs are read or named.

## 1.29.0
- **MIB assistant** (Settings -> SNMP & MIBs): every trap whose own OID no loaded MIB defines is listed with the sender, how often it came, the reason and what to do:
  - *No MIB for this vendor* -> download and upload the MIB of that device;
  - *MIB loaded, different OID* -> a MIB of that vendor is loaded but the device sends the trap under another tree (other firmware or the other SMI version); the likely definition (same trap number) is named;
  - *Trap not in the loaded MIBs* -> get the MIB for that model / firmware;
  - *Standard MIB missing* -> add the standard MIB it belongs to.
  After you upload a MIB the entry changes to "Named now" by itself. The panel also lists loaded MIB files that import MIBs that are not loaded (which module to get), has a "Look up" button for each trap, and "Copy report" to share the list.

## 1.28.1
- **Fix: traps shown as "alertGroup.2.1.0.2185" (Dell iDRAC) and other traps left unnamed although their MIB was loaded.** Names in MIB files were kept in one global list, so when two MIBs used the same name for different things (Dell: `alertGroup` is 10892.1.5000 in MIB-Dell-10892 but 10892.5.3 in IDRAC-MIB) the file loaded first won and the other MIB's traps got the wrong OID. Names are now resolved inside their own module first, then the module named in the file's IMPORTS, and only then anywhere. The result no longer depends on file order.
- "Look up an OID or name": a name that exists in several MIBs picks the one whose full OID is known, and `Module::name` is understood.

## 1.28.0
- **Standard MIB files come with the app**: 206 standard MIBs (SNMPv2 framework, IF, IP, TCP, UDP, ENTITY, ENTITY-SENSOR, HOST-RESOURCES, BRIDGE / Q-BRIDGE, LLDP, OSPF, BGP, VRRP, UPS, POWER-ETHERNET, RMON, DISMAN, IANA tables, NET-SNMP / UCD and more) are in the new `starter-mibs` folder, in the installer and in update packages. Every file was checked: it loads and all the MIBs it imports are in the set.
- On the first start after installing or updating, files that are not yet in the MIB folder are copied there (Settings -> SNMP & MIBs -> MIB files). Nothing is overwritten, a module you already have under another file name is skipped, and a MIB you remove stays removed.
- Update packages are about 3 MB larger because of the MIB files.

## 1.27.1
- **Eltek SP2 power system traps** (powerSystemTraps.16): new ready-made SNMP alarm rule "Eltek SP2: power system alarm (on = raise, off = clear)" in Rules & alerts -> SNMP -> Templates. `alarmSubsysStatusOnOff = on(1)` raises an alarm, `off(0)` clears the same alarm (matched by the alarm OID in `alarmSubsysStatusOid`, so different Eltek alarms stay separate). Severity comes from `alarmSubsysStatusValue` (minorAlarm = Minor, majorAlarm = Major).

## 1.27.0
- **New dashboard theme "NOC panels"** (Settings -> Appearance -> Dashboard theme): flat dark panels, square bar gauges, striped tables and tinted alarm tiles in the style of operations-centre boards. Only the Dashboard page changes; the layout is the same and **Classic stays the default**. Saved per browser.

## 1.26.0
- **Test SNMPv3 without any device or tool**: Settings -> SNMP & MIBs -> Check the receiver now has a version choice next to "Send a test trap". With "SNMP v3" the app sends a signed (and encrypted, if the user is set so) linkDown trap to itself using the first SNMPv3 user. Without a saved user it asks you to add one.

## 1.25.0
- **Report PDF is shorter**: the old second and third pages (alarm / syslog and SNMP dashboards) are gone. The PDF is the summary page followed by the alarm, syslog and trap lists.
- Summary page cards are in the order Active alarms, Cleared alarms, Syslog count, Trap count, then Average to clear and Devices.
- **Faint row and column lines** in every list of the PDF (active alarms, alarm history, syslog messages, SNMP traps).

## 1.24.0
- **New first page for report PDFs** (soft cards design, dark): title with a "needs attention" tag, six number cards (active alarms, syslog, traps, cleared, average time to clear, devices), a short written summary, a messages-over-time chart, the active alarms with age and escalated / acknowledged state, and the busiest devices and most frequent traps. The detailed pages after it are unchanged.

## 1.23.0
- **Report e-mails have a new design** (the "Minimal" layout): large light numbers for active alarms, syslog, traps, raised and cleared alarms, average time to clear, errors, warnings and devices; then the active alarms (device, alarm, port, age, escalated or acknowledged by) and the busiest devices and processes. Dark only, plain tables so Outlook, Gmail and phones show it the same way. The PDF is unchanged.

## 1.22.0
- **New Alarms window.** Two tabs, *Active alarms* (open and acknowledged) and *Alarm history* (cleared alarms, with a period selector). No alarm counts on the buttons.
- **Every alarm is its own line**, even when it is the same alarm again: nothing is merged and there is no repeat counter. A "link up" / clear message clears every line of that alarm on the device (and port).
- **Acknowledged** and **Escalated** are separate columns (who and when). History adds Cleared, Cleared by and Duration. Columns can still be shown, hidden, moved and sorted; the list of columns was reset to the new default.
- Escalation e-mails: a burst of identical alarms sends one e-mail per rule, device and port (at most 10 per 30 seconds), so a flood cannot fill the mailbox.
- Active alarm limit raised from 5,000 to 20,000.

## 1.21.0
- **SNMPv3 users are kept while you type.** The 5-second auto-refresh no longer redraws the list; users are also saved by the main Save button.
- **MIB manager**: "Upload MIB files" opens a separate window with its own scrolling, search, a **Vendor** column (detected from the MIB itself: enterprise number or ORGANIZATION line) and a much higher MIB limit.
- **Separate filters** for Syslog and SNMP traps (each window remembers its own filter and time range).
- **SNMP version** (v1 / v2c / v3) is shown on every trap.
- **Secure syslog (TLS)**: Settings -> Syslog -> "Secure syslog (TLS)", default port 6514 (RFC 5425). Uses the HTTPS certificate; status bar shows TLS, failed handshakes are counted.
- **Login sessions** (Settings -> Access & updates): user, PC address, browser, sign-in time, last activity, and a Sign out button for any other session; sign-ins and sign-outs are audited.
- Syslog / trap **test senders moved** to the Syslog tab.
- Faint **column lines** on all tables.
- **Performance**: ingest flush every 40 ms, cached alarm SQL statements, faster MIB listing.

## 1.20.0
- **SNMPv3 traps and informs are received.** Settings -> SNMP & MIBs -> SNMPv3 users: name, security level (none / authentication / authentication + encryption), authentication MD5, SHA, SHA-224/256/384/512 and encryption AES-128/192/256 or DES. The digest is checked (tampered packets are refused), replayed old messages are ignored, encrypted data is decrypted. Informs are acknowledged and engine discovery is answered; the engine ID of this computer is shown on the screen.
- Refused v3 messages are explained in plain words (wrong password, wrong protocol, unknown user, wrong security level) in the receiver status and as one notice per device every 10 minutes. The old "SNMPv3 is not supported" notice is gone.
- **Trap forwarder can send SNMPv3**: choose SNMPv3 for a manager, enter the user, protocols and passwords. This computer is the sending engine; the manager needs the engine ID shown under the forwarder list.
- v3 passwords are stored in config.json like the e-mail password, shown masked, and kept when you save with the mask.
- Tests: key localization against the RFC 3414 test vectors, every authentication and encryption combination, tamper, replay and wrong-password cases, and an inform with discovery.

## 1.19.0
- **Remote probe.** Run NetEventPro on a PC in another network and set it to "A probe" (Settings -> Remote probes). Devices there send syslog and SNMP traps to the probe; the probe sends every packet unchanged over HTTPS to the main NetEventPro, which treats it as if it had received it itself (parsing, MIB names, rules, alarms, reports, forwarding). The probe answers SNMP informs locally.
- Store and forward: if the link is down the probe keeps up to 300,000 packets on disk and sends them when it is back, with their original receive time.
- Each probe has its own token (shown once, stored only as a hash on the server); probes can be switched off or removed. Messages carry the tag `probe:<name>`.
- Wrong tokens are refused and counted like failed sign-ins.

## 1.18.1
- **Reports are dark only**: every PDF page and the whole e-mail body use the dark dashboard look; the light version is gone.
- **Alarms page**: the column headings now really stay fixed while the list scrolls (the column-resize code had overridden the sticky heading).
- **Removed the alarm notice from the title bar** (the menu badge on Alarms stays).
- **"Forward syslog to another collector"** no longer shows on every Settings tab; it is on the Syslog tab.

## 1.18.0
- **Reports**: the e-mail body is a designed HTML page with alarm, syslog and SNMP trap counts and a dark "live dashboard" block (plain-text twin included). Every PDF starts with a dark live-dashboard page; long text in PDF tables wraps onto several lines instead of being cut.
- **Alarms page**: headings stay fixed while scrolling; Raised, Last repeat and Cleared are one date+time column each. 
- Much bigger clock in the top bar.
- **Users, Backup and Maintenance moved into Settings** (tabs; the old #users, #backup, #maintenance links still open them).
- **Devices**: compact one-line rows, working column resize and a Columns button.
- **System messages** setting: write all / health only / silent-device only / audit only / no NetEventPro messages to the log.
- Removed the always-on health error "devices are not sending traps".
- **Export / Import** of rules (Rules page) and trap column views (Settings -> Trap columns) as JSON files.
- Help topics updated.

## 1.17.1
- **The Severity column of a trap view can be the severity of the trap.** In Settings → Trap columns, tick "This column is the severity" on your Severity column. The trap then takes its severity from that column after its lookup (critical, major, minor, warning, cleared, notice, info …): alarms, rules, email, the severity filter, the severity column and the row colours (Appearance) all follow it, including the per-vendor lookup lines. Traps already stored keep their old stored severity, but the Traps page shows them with the colour of the column.
- The "Standard trap table" example has the Severity column ticked.

## 1.17.0
- **Two new severities, Minor and Cleared**, everywhere: severity filters, rules (match and "set severity"), alarms, trap severity rules and "Severity from a value", forwarding limits, dashboards and charts, email, reports (PDF, Excel, CSV), exports and the Appearance colours. Order, most serious first: Emergency, Alert, Critical, Error, **Minor**, Warning, Notice, **Cleared**, Info, Debug. "This severity or worse" follows that order (for example "Warning or worse" includes Minor). Traps whose own severity says minor or cleared (alarmSeverity, status, ...) now get these levels automatically. Existing data and rules are unchanged.
- Appearance: the "colour trap rows by a column" section is removed; the colours follow the real severity of each trap, which now includes your own trap severities. Ten fonts more (monospace and sans-serif; they show when installed on this PC).
- Trap column views: the value box is resizable (drag the corner) like the lookup box.
- Text replacement now also changes the values inside SNMP traps, so trap columns show the replaced words. It has its own tab in Settings ("SNMP traps only" or "Syslog and traps" per entry).
- A rule that changes the severity now also updates the severity name used in emails and webhooks.

## 1.16.9
- Settings has tabs (Syslog, SNMP & MIBs, Trap columns, Storage & time, Access & updates, Look & sound, Email & webhooks) instead of one long page; Save settings still saves every tab. The "Trap columns" button on the Traps page opens the Trap columns tab.
- MIB files: compact list with a filter box and a scrolling table (file, module, objects, traps, status, download / remove), moved to the top of the SNMP tab.
- Appearance on the Traps page: "Colour trap rows by a column" lets you give colours to the values of any column of the view, such as your own lookup words (Critical, Major, Cleared). The list follows the column's lookup, and you can add other values.

## 1.16.8
- Traps page with a trap view: the **Columns** button lists the view's own columns to show, hide and re-order (and the full-message column). Hidden columns stay in the view and in the detail window.
- **Export** (CSV and JSON) from the Traps page uses the columns, recipes and lookups of the view, with the column names as headings.
- The detail window of a trap (double-click) lists every column of the view by its name with its value; Message and Original packet are unchanged.
- Appearance and the severity filter keep working with any view. They use the trap's real severity (set under "Severity from a value"); a lookup only changes the text of its column.

## 1.16.7
- A column lookup can hold up to 6000 characters (was 1200), enough for a full alarm-code list such as the Connection Master alarm numbers.

## 1.16.6
- One trap view for every vendor: a column's lookup can now hold one line per vendor, each starting with `@ vendor OID, trap name or /regex/:`, for example `@ 1.3.6.1.4.1.674: 5=Critical; 4=Major` and `@ 1.3.6.1.4.1.12148: 5=Clear`. A line without `@` is used for all other traps. Combine with `{alertGroup.1.3.0|alarmSeverity|severity}` (first value that exists) to get one Severity column that reads each vendor's own value.
- With a single trap view saved, the Traps page uses it for all traps and the "View: all traps" box is gone (the button is called "Trap columns").
- The lookup box is a multi-line field.

## 1.16.5
- Trap column views are now fully yours: untick "standard Date, Time, Device and Severity" and the view shows only the columns you list, in your order (up to 24). Every column can be a trap value or a message field: `{number}` `{date}` `{time}` `{devtime}` `{source}` `{agent}` `{host}` `{severity}` `{message}` `{app}` `{pid}` `{mib}`. New example "Standard trap table" and a button "Start from the standard table" give the layout of message number, date, time, device, agent IP, host, severity, message, PID, group, category and MIB.
- Lookup per column (`5=Critical; 4=Major; *=Unknown`): turns a number or word of a trap value into the words you want, for that view only, so the same number can mean something else in another vendor's view. Works for any value, not only severity. Columns sort by number, date or text as fits.
- "Severity from a value" lines accept `@ trap name, vendor OID or /regex/` (`status @ 1.3.6.1.4.1.674: 5=critical`) so 5 can be critical for one vendor and notice for another.

## 1.16.4
- `test/send-trap-test.js` scenario 7 sends Dell iDRAC style traps (`alertGroup.1.3.0` = 5, 4, 3) so trap columns and the Severity column can be checked without a real device.

## 1.16.3
- Automatic severity also reads status values whose name says status, state or condition (Dell iDRAC `alertCurrentStatus = critical(5)`), but only when the word says something is wrong (nonCritical, critical, nonRecoverable, major, minor, warning ...). An "ok" or "normal" status never sets a severity, so it cannot hide a failure. The word appears when the MIB that defines the value list is loaded (for iDRAC: IDRAC-MIB-SMIv2).

## 1.16.2
- Severity words are now understood in every trap without any setting: a value whose name contains "severity" (alarmSeverity, perceivedSeverity, alertSeverity ...) and whose value is a known word (critical, major, minor, warning, cleared, normal ...) sets the Severity column by itself. "Severity from a value" lines are only needed for numbers (5 = critical differs between vendors) or to override; your lines always win.

## 1.16.1
- **Severity from a value inside the trap** (Settings -> SNMP & MIBs -> "Severity from a value"). Traps that carry their own severity (Dell iDRAC `alertGroup.1.3.0 = 5`, Connection Master `alarmSeverity = major(3)`) now fill the normal Severity column, so every vendor shows in one common column, with the same colours, rules, alarms and sorting. One line per value name: `alarmSeverity: critical=critical, major=error, minor=warning, cleared=notice` and `alertGroup.1.3: 5=critical, 4=warning, 3=notice`. The value can be the word or the number; a value nobody mapped keeps the old behaviour. New traps only. Trap column recipes can also name an indexed value such as `{alertGroup.1.2}`.

## 1.16.0
- **SNMP trap columns**: the Traps page now keeps the columns you choose (the server used to throw the saved Traps and Alarms column choices away, so a new column vanished). A trap-view column can **join several values** into one: `{alarmSource} - {alarmText} {alarmAdditionalText}` gives one alarm-text column for any vendor. `{a|b}` takes the first value that is not empty, `{alarmSeverity:name}` turns `major(3)` into `major`, and `{agent}`, `{source}`, `{trap}`, `{oid}`, `{host}`, `{values}` are always available. The view window shows a live preview from the latest trap, clicking a value name inserts it, a view can open first on the Traps page, and saving a view shows it at once. Two example views are included (DNWP Connection Master alarms; any vendor).
- **Alarms window**: separate Date and Time columns with seconds (raised, last repeat, cleared), a **Columns** button (show, hide, reorder; also Port/item, Repeats, Source, IP address, Acknowledged/cleared by) and **click a column heading to sort** (click again to reverse; sorting happens in the database, so it covers all alarms, not only the 300 shown).
- **Keep everything**: Settings → Storage has a retention list (30 days … 5 years, or *Keep everything*), a separate retention for cleared alarms, and "Maximum database size 0 = no limit". The hidden 90-day clean-up of cleared alarms is gone: they are kept until the retention you chose. Searches now read the newest rows first in growing windows, so "All time" with an error level, a device or a common word answers in a fraction of a second whatever the size (tested with 3.3 million rows: 1.3 s -> 0.1 s); the number of stored messages is no longer counted on the receiving thread.
- **Session time-out**: Settings → Dashboard access: sign out after 1 hour … 1 week without use, or **Never**, and an overall limit (default 7 days, or none). Sign-ins survive a service restart and an update (stored as hashes in `sessions.json`). The cookie no longer expires 12 hours after sign-in whatever you do.
- **Escalation e-mail**: a designed HTML e-mail (with a plain-text copy): coloured header by severity, device, alarm, port, raised time with seconds and how long it has been open, repeats, the message, notes, other open alarms of the device, the last 24 hours at a glance (raised, cleared, open, escalated, busiest devices and alarms) and a button to open the alarm. Each escalation e-mail carries a **PDF report of the last 24 hours** (alarms, messages, traps). In every rule: "attach the 24-hour report" on the escalation (on by default) and "with 24-hour report" on the rule's own e-mails (off by default). Ordinary alert e-mails use the same look.

## 1.15.0
- Rules: **"Or any of"** (a list, one per line, text or /regex/): one rule can cover many different messages. **"Clear when"** (list): a message that matches clears the rule's own alarm (the same port with "Alarm per port"), so one rule can raise and clear. **"Severity from message"** (`text => number`): for example `/Status:\s*Major/ => 3`.
- Three ready-made templates for the DNWP Connection Master: port and card alarms (E1, E+M, ETH, SDH LP/SFP/MS/RS, FXS units, power), path protection and clock switches, unit removed / inserted. They were tested by replaying 154 real Connection Master messages.
- "Alarm per port" recognises "card/port type" names (5/8 E1, 13/1 E+M, 3/1 SDH LP[1-1-1-1]), "slot N" and "Alarm: 1 POWER (BITS):". The port type is part of the key, so the E1, SFP and LP of one card are separate alarms. Replaces the card/port-only key of 1.14.3.

## 1.14.3
- Card/port detection uses only the card and port number (5/8, 13/1, 7/3), so every port type works (E1, ETH, E+M, E&M, V.35 …) and a clear message without the type still matches its alarm.

## 1.14.2
- "Alarm per port" now understands card/port names such as "5/8 E1:" and "13/1 E+M:" (DNWP Connection Master and similar multiplexers), so each card and port is its own alarm and a clear message clears only its own port. Before, such messages had no recognised port, so repeats were counted as one alarm (x2) and one clear removed both.

## 1.14.1
- Fixed the side-menu counters counting every new message twice or three times (1 syslog showed 2, 1 trap showed 3). Cause: since 1.12.0 the live-feed reconnect could open a second connection at page load or on window focus. There is now only ever one connection, and the old one is closed first.

## 1.14.0
- Update test release: no program changes. Installing it from Settings -> Updates proves the GitHub update works end to end (1.13.9 -> 1.14.0).

## 1.13.3
- Release build: the package now contains only the program folders (src, public, scripts, assets, test and the text files). Before, an installer build folder (with node.exe) lying in the source folder was packed too and the update was refused as "larger than allowed". The size is printed after the build and the error names the size.

## 1.13.2
- Settings -> Updates shows the Node.js result even when no program release address is set (that is optional), and says why the Node.js check failed (for example no internet).

## 1.13.1
- Update check: "fetch failed" now says why (server not running, name not found, firewall, certificate).

## 1.13.0
- Settings -> Updates: "Update Node.js now". Checks the newest patch of your Node.js major version (nodejs.org, or your own internal copy), downloads it, verifies the published SHA-256, test-runs the new node.exe (including the database module), renames the old node.exe to node.exe.old, puts the new one in place and restarts the service. If the program then keeps failing to start, the old node.exe is put back automatically.
- Windows service only; the server needs permission to write to its node folder.

## 1.12.2
- `scripts/release.js build` makes the release zip itself (no zip program needed), so it works on Windows.

## 1.12.1
- Sound did not play in Chrome: after a page reload the sound setting stayed on but Chrome had not yet allowed audio, and the test button did nothing. The audio engine is now started on the first click or key press and the test buttons start it themselves.

## 1.12.0
- Theme picker moved from the side menu to Settings -> Appearance. Scrollbars follow the theme (dark scrollbars on dark themes).
- Alarms: time range like Logs (15 min to All time, custom range); an alarm is listed if it existed during the range, open alarms always. Filter changes apply at once (a refresh in progress or a held mouse button no longer delays them).
- Live feed: server ping every 10 s, client watchdog and automatic reconnect with back-off, reconnect on wake-up/network return. Cap raised to 200 dashboards.
- Sounds: 13 built-in sounds, separate choice for critical severities, volume, test buttons.
- Large databases: result counts stop at 100,000+, big JSON answers are gzip-compressed, alarm indexes added, cleared alarms older than the retention period (min 30 days) are removed. Measured with 3 million stored messages: pages 0.1-1 s.
- Online updates (Settings -> Updates): signed releases (Ed25519 + SHA-256), program files only, automatic rollback, Node.js patch check. `node scripts/release.js` makes keys and releases.

## 1.11.0
- Alarm per port: rule option "Alarm per port" (or your own /pattern/) raises one alarm per port; a link-up clears only that port. Without it the old per-device behaviour is kept.
- SNMP traps have their own message number, separate from syslog. Severity picker has Deselect all.
- Delete single/multiple logs, traps and alarms (also everything matching a search, after typing DELETE). New "delete" permission; deletions are written to the log.
- Alarms: tick boxes and bulk Acknowledge/Clear/Delete work; compact one-line rows with port, state and icon actions; escalated state filter.
- Rules & alerts and Reports: compact one-line lists with Edit/Copy/Delete; new/edit in a window. Reports and alert mails have Cc, subject and message.
- Devices: resizable columns (saved), filters apply immediately. Alarms table columns resizable.
- PDF reports: pages 1-2 are the dashboard, then all alarms, syslog list, SNMP trap list.
- Settings: Log appearance removed; text replacement scoped to syslog / SNMP / both; mail Cc; SNMP trap forwarder (northbound, v2c/v1); extra dark themes (midnight, graphite, black, nord, dracula, solarized, forest).

## 1.10.1
- Total alarms now counts every alarm raised, cleared or still open in the period (it was only the newly raised ones, so it could show 0 beside Cleared 1). The card also shows how many were newly raised.
- Alarm banner size: Customize -> Alarm banner has Compact / Large cards and a cards-per-row choice.

## 1.10.0
- Dashboard alarm banner: "Raised" is now **Total alarms**; new **Escalated alarms** card (open alarms nobody acknowledged in time; click it to list them). Customize -> Alarm banner lets you show/hide cards, rename them, change colours, reorder, choose large or compact cards or hide the banner.
- Dashboard: **SNMP first / Syslog first** button puts the SNMP traps section on top. Every tile has an accent colour and background colour; section bars can be renamed and coloured (Customize -> Edit on the bar). Section settings are now saved with the layout.
- System health removed from the dashboard and back in the left menu as its own page: CPU, memory, disk and network dials and graphs (15 min / 1 h / 24 h), messages per second, service responsiveness, machine details, plus the existing checks and panels. History is kept in memory (empty after a restart).
- New API: GET /api/health/history. Alarm list accepts state=escalated.

## 1.9.0
- Top bar shows UDP, TCP and SNMP trap ports, health and live feed (rate and received removed); clock shows only a status dot for NTP.
- Dashboard: alarm banner, Syslog section, SNMP traps section, System health section (moved to its own page in 1.10).
- SNMP setup and MIB files moved into Settings; new: devices sending traps, trap catalogue from MIBs, send a test trap, MIB download. Trap values are stored as data; **Trap column views** show your own columns per trap type.
- Alarms: Raised, Cleared and Duration columns, period and sort filters, summary, CSV export, auto-clear rule option.
- Devices page rebuilt (state, vendor, group, syslog/trap counts, open alarms, per-device expected interval, notes, filters, export).
- Rules: Add blank rule scrolls to and focuses the new rule; notes, copy, test; new conditions (not-contains, sender range, schedule, repeat count) and actions (set severity, stop, alarm auto-clear).
- Reports: SNMP traps, active alarms and alarm history sections in PDF, Excel and CSV; two new templates.
- Settings and Rules tab bars stay in view while scrolling.
- Tests: 62 unit, 226 end to end.

## 1.8.0
- **Renamed to NetEventPro** (syslog and SNMP traps). Installer is `NetEventPro-Setup-<version>.exe`. The install folder, `C:\ProgramData\SyslogPro` data folder, service id and backups keep their old names so an upgrade finds the existing installation; old shortcuts are replaced. Alert e-mail subjects now start with `[NetEventPro]`, and the application's own messages use the device name `NetEventPro` (existing rules that matched `SyslogPro` are converted).
- **Syslog and SNMP traps are separate**: new **Traps** window; **Logs** shows syslog only. Rules have two tabs (Syslog rules, SNMP trap rules) and a rule only runs on its own kind of message. Existing rules became Syslog rules. SNMP rules can match a trap by name or OID prefix. One **Alarms** page for both, with a Source column and filter.
- **Dashboard SNMP section** (trap counts, severity, top traps, top senders, receiver status); other dashboard tiles count syslog only unless set otherwise.
- Tests: 62 unit, 203 end to end.

## 1.7.0
- **SNMP trap receiver**: SNMP v1 and v2c traps and v2c informs on UDP 162, stored as normal log messages (application `snmptrap`, tags `snmp`, `trap:<name>`), so rules, alarms, reports and forwarding work on them. Standard linkDown/linkUp traps carry the tags `link-down`/`link-up`, so the existing link rule pairs raise and clear alarms from traps.
- **MIB files**: upload vendor MIBs (SMIv1 and SMIv2) on the new SNMP page; trap names, object names and named integer values are resolved. SNMPv2-MIB and IF-MIB are built in. Uploads can arrive in any order. "MIBs still needed" lists unresolved numbers by vendor; OID lookup box.
- Severity from the trap (standard traps, wording of the name) or your own rules; community filter; reply to informs; health check for the trap port.
- Added test/send-trap-test.js (trap generator, 6 scenarios), test/SYSLOGPRO-TEST-MIB.mib (sample MIB), test/Send-AlarmTest.ps1 (PowerShell alarm generator).
- Known limits: no SNMP v3, MIB files are not part of the app backup, traps identify a device by its source address.

## 1.6.1
- Added test/send-alarm-test.js: syslog generator with 7 scenarios to test alarm raise, auto-clear, per-device clearing and open alarms.

## 1.6.0
- **Alarms** page: rules can raise one alarm per rule and device (repeats counted), acknowledge with your name and notes, clear by hand or automatically when a recovery message arrives (link down / link up, mains failure / restored …), escalation e-mail when nobody acknowledges in time, menu badge with open alarms, new "Alarms" permission (Operator role has it)
- **Maintenance windows**: one-off or weekly schedules per device (wildcards): messages are kept and tagged but raise no alarms or alerts and cannot make a device Silent
- Rule templates for the common down/up pairs; guide updated

## 1.5.0
- Date and time in the top bar (larger), taken from your NTP server when set up (Settings → Time (NTP)), with a Test button, check interval and time zone; shows a status dot and tooltip. The PC's own clock is never changed

## 1.4.1
- Logs page: tidier toolbar with icons on the buttons, two clear rows, Export menu (CSV / JSON), labels shrink to icons on narrow windows

## 1.4.0
- Sign-in page inside the app (no browser login box), Sign out, session cookies
- Create an HTTPS certificate and key from Settings; download the certificate to trust it on other PCs
- Devices: new **Idle** status for devices that are quiet but have too few messages to raise a silent alert
- Security: certificate key file locked to Administrators on Windows; security assessment document

## 1.3.0
- In-app confirmation boxes (no browser pop-ups); each page gets its own area so a late redraw cannot appear on another page
- Severity "All" fixed; severity list opens above dialogs; every pop-up window can be dragged by its title
- Appearance colours now win over the default rule colour for the same severity

## 1.2.0
- Sign-out link, security review fixes

## 1.1.0
- New dashboard tiles: pie, line, gauge, heatmaps
- Logs always live inside the chosen time range; several severities at once (also in rules, reports, tiles)
- Devices identified by the host name in the message
- Users, custom roles, groups, admin password reset
- Scheduled reports (PDF, Excel, CSV) by e-mail and to a folder or network share
- Backup and restore of settings and database, optional encryption
- Built-in user guide

## 1.0.0
- First release: UDP/TCP syslog receiver, dashboard, rules, e-mail alerts, text replacement, installer
