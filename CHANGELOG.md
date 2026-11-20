# NetEventPro changelog (called SyslogPro before 1.8.0)

Every delivered build has its own version number (shown bottom-left of the dashboard, in Settings → About, in the installer file name and in backups). The number is kept in `package.json`; `npm run bump` raises it.

## 1.99.7
- Dashboard: "Number with trend line" and "Number" show the same alarm number for the same choice. The trend tile's Show has the same alarm numbers as the Number tile (active, open, acknowledged, escalated now; raised or cleared in the time range), its conflicting "Which alarms" choice is gone, a tile saved with "Which alarms" keeps that state, and switching visuals keeps the chosen numbers.
- Dashboard: the severity picker and other pop-ups opened inside a dialog are drawn above the dialog (they were hidden behind it) and open upwards when there is no room below; messages are shown above dialogs too.
- Dashboard editor: the preview of System health, Silent devices and Device status wall no longer stays on "Loading…"; polling tiles without a reading say "Choose a reading"; switching visuals no longer causes a script error.
- Dashboard polling tiles: an empty tile says why for each chosen device (no reading with that name, not polled yet, no SNMP answer, no value from the OID, no such instance, text value); a reading kept as text whose value is a number is shown as a number.
- Crimson theme with glass: the Add a tile gallery cards are rounded rectangles again instead of circles. Glass themes: group names in drop-down lists no longer show as light striped bars.
- Devices page: the vendor can be typed per device or for many at once (Set vendor…); a device that is also polled gets its vendor from SNMP polling; enterprise 28458 shows as Nokia.
- SNMP polling: a reading set to Text whose value is a number (for example an Eltek status "1") now shows its value meanings ("Normal", "Critical" ...) on the device page and in Test read, raises the state alarms, and can be used on dashboards.
- New browser test (npm run test:ui) checks the dashboard before every release.

## 1.99.6
- Alarm notifications now come from the Alarms section. When a rule or SNMP polling raises an alarm, the e-mail describes the alarm (device, alarm, port/item, severity, source, state, how long it has been open, other open alarms on the device) instead of the internal message ("Source: syslog, Process: snmp-poll" is gone). The same people get a "CLEARED" e-mail when the alarm clears, however it clears (by the device, automatically or by hand).
- SNMP polling alarms show "SNMP polling" as their source on the Alarms page (column, filter, CSV) and in e-mails.
- SNMP polling → Settings → Escalate: a polling alarm nobody acknowledged within the minutes you set is escalated to the chosen profiles, shows as Escalated on the Alarms page, and those people are told when it clears.
- The wait between alarm e-mails (5 minutes by default) is now per device and port: a second device with the same alarm is told at once instead of being held back by the first.

## 1.99.5
- SNMP polling alarms now tell their notification profiles when the alarm clears (an e-mail starting with "CLEARED:"), as the polling page says. Before, only the raise was sent; the clear went out only for escalated alarms. Nothing is sent during a maintenance window.
- The SNMP polling help text no longer mentions built-in profiles.

## 1.99.4
- Audit records of your own changes (for example "admin removed the polled device ...") no longer go through the alarm rules. Before, a broad rule could raise a Critical alarm for every device you removed.
- The error box "Cannot set properties of null (setting 'textContent')" no longer appears. A Logs search, Alarms refresh or Devices refresh that finishes after you have left the page now stops quietly.

## 1.99.3
No vendor profiles, a faster SNMP polling page, sharper probe answer times, glass everywhere, every screen size, and a device simulator.
- **No built-in vendor profiles**: the Cisco and APC sets are removed. Every device starts from the standard set (uptime, interfaces, standard CPU and memory where it has them); equipment-specific values are added as readings from its MIB. Devices that used the removed sets move to the standard set by themselves.
- **SNMP polling page responds at once**:
  - The Reports tab read every stored reading of the period: 270 ms with a week of readings for 20 devices, holding up the server meanwhile. Now one indexed lookup per device: 6 ms (15 ms for 7 days).
  - A device page asks for all its graphs in one request instead of about 30.
  - The timed refresh no longer rebuilds the page while a button is being pressed, just after a click, or while typing in a field (such clicks were lost).
- **Probe answer times**: probes poll on their own thread, as the server does since 1.99.1, and save their queue in the background. Forwarding syslog and saving the queue no longer delay reading the answers, which made a probe's answer times longer than the server's for the same device.
- **Scaled values without noise**: 85.3, not 85.30000000000001.
- **Glass**: role and rule cards, the log table, alarm chips, health cards, progress bars, code, red buttons, the reports list and the Settings header band are see-through too (they stayed solid dark).
- **Every screen size**: checked on every page from 320 × 240 to 7680 × 4320, 4:3, 5:4, 16:9, 16:10 and 21:9.
  - Large screens: everything is scaled to the screen (1.25× at 2560 × 1440 and 3440 × 1440, 2× at 4K, 4× at 8K; 100 % up to 1920 × 1080). Settings → Appearance → Screen size sets it by hand (75 % to 400 %). Charts stay sharp; menus, the colour chooser, dragging and resizing follow the scale.
  - Short screens (up to 620 px high): compact top bar and status bar.
- **Export menu**: no "Drag to move this window" cursor on its items.
- **"Rules & alerts" is now "Alarm configuration"**.
- **Device simulator** (tools/snmpsim): 20 simulated devices (switch, router, firewall, servers, rectifier plant, UPS, multiplexer, PDU, generator, environment sensor, time server, audio processor, microwave link, air conditioner, NAS, Wi-Fi controller, an SNMPv1-only device, a device without standard values, a slow flaky site) with changing values; it can add itself with all readings, alarm limits and value meanings.

## 1.99.2
Faster everywhere, smooth dashboard editing, SNMP polling that copes with any device, polled readings in every visual, a stepped tile editor and tile icons.
- **Much lighter on the computer**: found and fixed what kept the browser busy even when nothing happened.
  - The colour chooser repainted itself endlessly (60 times a second) on every page with a colour box: Settings, Rules and dashboard editing. That made editing feel slow and glitchy.
  - A style rule made the browser re-check every element of the page on every small change (a clock tick, a counter). It is replaced by a simple marker set when a window opens.
  - Measured with the page open and idle: Settings 14 % → 2.5 % busy, Rules 15 % → 3 %, Devices 21 % → 10 %, Dashboard 7 % → 4 %. Logs with messages streaming in: 40 % → 15 %.
- **Logs page**: draws 300 rows and adds more as you scroll (it drew up to 5 000 and reflowed them on every new message); no slide effect on every cell of new rows.
- **Devices page**: a refresh that only moves the "last heard" times updates those cells instead of rebuilding the table.
- **SNMP polling, for any vendor**:
  - Devices that show only their own vendor values (no uptime or system name; many rectifiers, gensets and UPS cards) are polled: the answer time shows and their readings are read. They were reported as "No SNMP answer" before.
  - An answer from another address of the same device (several network ports, a firewall in between) is accepted.
  - Devices without bulk requests (GETBULK) are read with simple requests; remembered per device.
  - One unknown value in a request no longer fails the whole poll: that value counts as missing.
  - A table read stops when a device repeats or goes back, never loops.
  - A counter that drops because the device restarted no longer shows a huge false spike.
  - Decimal values sent as "opaque float/double" are read, numbers inside text ("Temp: 23.5 C") are read, binary values (MAC addresses) show as hex.
  - Test explains a device that answers but shows no standard values.
- **Polled readings in every visual**: number, gauge, number with trend line, line chart, bars, pie, treemap, table, waffle, radial, rose, bubbles, funnel, podium, word cloud, bar gauge. Choose the reading, the devices, the instance (port, sensor, rectifier, or all) and how values combine (average, highest, lowest, sum, latest, number of). Readings with the same name and unit are one choice across devices and vendors. Line charts draw one line per device or instance on their own scale, with gaps where nothing was read.
- **Tile editor in four steps**: 1 Visual (picture gallery), 2 Data (the fields change with the data), 3 Format (calculation, value, colour steps, chart, colours), 4 Tile (title, size, icon, look).
- **Icons on tiles**: 43 built-in icons (thermometer, battery, power, voltage, fan, server, switch, network, clock, bell …), next to the title, as a corner badge or large and faint in the background, in the accent colour or your own.
- **Trend tile for alarms**: shows raised or cleared alarms as chosen (it always showed raised).
- Polled tiles are cached for 8 seconds on the server, like the other tiles, so several open dashboards share one calculation.

## 1.99.1
Fast Devices page for tens of thousands of devices, select and forget many devices, the Operations page removed, a ready-made Aurora dashboard, the cause of long pauses, and SNMP polling on its own thread.
- **Devices page is fast with many devices**: it drew every device every 5 seconds, which froze the browser at about 20 000 devices (it never finished in 2 minutes). Now one page of rows is drawn (50/100/250/500 per page): with 20 000 devices it opens in about 0.4 s, and search, sort and page changes take about 0.2 s. Big lists refresh every 15 s instead of 5 s.
- **Sort by any column** (click the heading), **pages** with first / previous / next / last.
- **Select devices** (tick boxes, all on the page, or all shown): set a group, mute or unmute alerts, or forget them, in one step.
- **Forget all…** button: removes every device from the list in one step (20 000 in under a second); optionally also their display names, groups, notes and muted state. Stored messages, traps and alarms are kept; a device comes back when it sends again. Written to the audit log.
- **Operations page removed**: the Dashboard is one page again (no Operations / My dashboards tabs).
- **Ready-made Aurora dashboard**: Dashboard → ⋮ → New dashboard → Ready-made: Aurora, or import dashboards/NetEventPro-Aurora.json. Gradient numbers and a sheet each for alarms, traffic, SNMP traps and devices; works with every theme; no per-device tiles, so it stays fast with many devices.
- **System health names the cause of a long pause**: the regular jobs (saving messages, rules, alarms, polling, reports, backups, deletes, web pages, memory clean-up) are timed; the "Processing delay" check now says what was running during the longest pause of the last 24 hours, with advice when it was slow database work (antivirus exclusion for the data folder).
- **SNMP polling on its own thread**: asking devices and waiting for their answers no longer waits behind heavy syslog traffic, so polls stop timing out and falling behind under load. If the thread stops, polling continues in the main thread and the thread is restarted.
- **Old Operations links** (#ops) open the Dashboard.
- Donut charts of alarms and devices say "alarms" / "devices" in the centre instead of "messages".
- Load test kit: waits until the server has caught up before measuring, cleans up all test messages and devices, works with https and self-signed certificates (--insecure), clearer error messages.

## 1.99.0
Dashboard tabs, company directory sign-in, fast word search, high availability, installer signing and a load test kit.
- **Dashboard page with two tabs**: Operations (the ready-made sheets) and My dashboards (your own boards, unchanged). The separate Operations menu item is gone; old #ops links still work.
- **Company directory sign-in (Active Directory / LDAP)** under Settings → Users: LDAPS or StartTLS, a read-only service account, user filter, nested groups, directory group → role mapping, a Test button that explains every step. Roles are worked out at every sign-in; directory users change their password the company way. Written without libraries and tested against a simulated directory.
- **Fast word search** (Settings → Storage, off by default): a word index so a search for a rare word answers at once. On 20 million messages: 2.1–2.8 s → under 10 ms; the index roughly doubles the database size (5.3 GB + 5.3 GB) and builds in the background (about 20 minutes). Results are the same as without it.
- **High availability** (Settings → High availability): a primary and a standby. The standby holds back notifications, reports, forwarding and the SQL copy, takes over after 15 s without the primary and hands back when it returns; it can receive a copy of every message and takes the primary's settings and users every minute. Signed and encrypted with a shared key.
- **Code signing** of the installer, its uninstaller and the service program in build.ps1 (USB token by thumbprint, or a .pfx; GitHub Actions secrets NEP_SIGN_PFX / NEP_SIGN_PASSWORD). See docs/CODE-SIGNING.md.
- **Load test kit** for your own server: tools/loadtest (run from a second computer; writes a report).
- Help: new sections for directory sign-in, high availability and the Dashboard tabs.
- Tests: word index, directory sign-in (LDAPS and StartTLS), two-server high availability; 10 more end-to-end checks.

## 1.98.0
A new Operations dashboard, first-run setup, date and time formats, your own severity names and colours, one language file and a neutral Help page.
- New **Operations** page (left menu, under Dashboard): one screen with a sheet for every part — Overview, Syslog, SNMP traps, Alarms, Devices, Polling and System. Time range 15 min / 1 h / 24 h / 7 days, refreshes by itself, and every number, bar, alarm and message opens the page where you can act on it.
  - Overview: a sentence and a coloured band for the open alarms, key numbers with trend lines, messages over time, active alarms, a square per device coloured by its worst alarm (silent devices hollow), busiest devices.
  - Drawn only from the theme's own colours: checked in all 12 themes, with glass, and at phone width.
- **First-run setup** on a new installation without a password: time zone (filled in from this computer), date and clock format, syslog ports, the look, and the administrator password. Every step can be skipped and changed later.
- **Date and time** in Settings → Appearance: year-month-day, day/month/year or month/day/year, and a 24 or 12 hour clock. Used on every screen, the top clock, exports, reports and e-mails.
- **Time zone**: when none is chosen, the zone of the computer NetEventPro runs on is used everywhere (it was each browser's own zone on screen), so everyone sees the same times.
- **Your own severity names and colours** (Settings → Appearance): rename, for example, Error to Major, or give a severity its own colour. Names are used on screens, in e-mails, reports, exports and notifications; colours replace the theme's in every theme and in e-mails. Rules and trap mapping keep working with the standard names.
- **One language file** (public/lang-en.js) for the menu, dialogs, severity names, the Operations page, the setup and the whole Help page. A translation is a copy of this file. The other pages still carry their own text and move over in later versions.
- **Help** rewritten to be neutral: the build-PC release instructions became a short "Updates" section for users, names of other products and of particular sites and equipment were removed, and a section for the Operations page was added.
- Dashboard looks and palettes named after other products now have neutral names (Business, Operations, NOC, Traffic light).
- Tests: 4 new unit tests (language file, severity names) and 13 new end-to-end checks.

## 1.97.6
Faster for big sites (tested with 12,000 devices and 20 million stored messages), plus one export fix.
- Dashboards over long periods are much faster. The app now keeps per-minute and per-hour message counts, so a dashboard adds up summaries instead of reading every message. With 20 million messages, a 24-hour dashboard went from 14 s to 0.07 s, and a 48-hour one from 31 s to 0.12 s. Every number is the same as before.
- No more empty dashboard after a restart: the statistics shown on the dashboard took 25 s the first time on a big database; now 0.2 s.
- After updating, older messages are added to the summaries in the background (about 2 minutes for 20 million messages). Receiving goes on as normal meanwhile, and dashboards count the messages directly until it is done.
- Deleting messages (by hand, by search, by age or by size limit) keeps the summaries right.
- SNMP traps with many devices: each trap no longer checks every known device. With 12,000 devices, 2,000 traps a second used to lose a third of the traps; now none are lost and CPU use dropped from 81% to 23%.
- Up to 50,000 devices are tracked (was 10,000).
- The device list is prepared once every 2 seconds and shared by every screen that shows it, and it is compressed off the main thread.
- Exports: negative numbers in SNMP polling CSV and Excel exports (a temperature of -3, say) now stay numbers instead of turning into text.

## 1.97.5
- **Check for updates says so.** After a manual check you get a clear message: "NetEventPro x.y.z is up to date", "Version x.y.z is available", or a message window when the update server cannot be reached.
- **Faster dashboard editing.** The frosted-glass blur behind tiles is paused while you customise (edit mode, the tile editor, dragging), dragging moves the tile on the graphics card and is limited to one update per screen frame. In tests dragging, resizing and typing in the tile editor became about twice as smooth with glass on.
- **Every theme has its own chart colours.** "Follow the theme" now really follows it: each of the 12 themes has a 10-colour chart palette that starts with its accent and is tuned to read on its tiles (before, all themes shared one default palette). Severity colours stay the same everywhere.
- **More SNMP polling visuals.** The gallery has an SNMP polling section with 9 cards: status summary (big counts), status donut, device board, readings with trend line, reading gauges (one per reading), reading graph, reading bars, polling alarms (count and devices) and the readings table.
- **More polling tile settings:** order (by name, highest / lowest value, problems first, slowest / fastest answer), show at most N, decimals, short names, shaded area under lines, donut legend. Graph and trend lines use the theme colours.
- **Fix:** names on coloured device tiles could be unreadable in themes that recolour links.

## 1.97.4
- **Health-check alarms clear by themselves.** When a health check recovers, the alarms raised by its "Health check failed" messages are cleared, whatever rule raised them; after a restart, alarms for checks that are fine again are cleared at the first check. "Device sending again" clears the "No messages from …" alarm the same way. Only the application's own messages can do this.
- **Messages in a window.** Errors open a message window that stays until OK; confirmations ("Settings saved") show as a small card at the top right and close by themselves. Nothing appears at the bottom of the browser any more.
- **Reports page redesigned:** a logo tile with preview (click to upload or change), company and footer side by side, one compact line per saved report (switch, name, schedule and contents, file types, delivery, last run, run / edit / delete icons), "New report" and a template list in one toolbar.
- **Appearance split into three sections** on one page: Colour theme (smaller cards), Glass and background picture (only for themes that support glass; the sliders show once glass is on), and Animations. Your uploaded background now shows as a thumbnail next to the built-in pictures, and the picture in use is marked.
- **Settings menu:** "Columns" is now "SNMP trap columns".
- **SNMP & MIBs:** Send test trap no longer makes the page jump; the trap catalogue scrolls inside its own box (with Clear results); the two severity boxes are folded into "Severity mapping (advanced)" with plain examples.
- **Rules & alerts:** tabs and every button in one toolbar; compact icon buttons on each rule.
- **Text replacement:** one compact row per entry; regular expression, match case, trap value and SNMP trap columns open on demand (⋯); long help folded away; filter box for long lists; nothing overlaps.
- **Users:** the two password boxes are gone from this page. Change your own password (also the admin's) on My account; give another user a new password by editing that user.
- **Certificate file names:** a certificate or key made by an older version (syslogpro.crt / .key) is copied to neteventpro.crt / .key and used from there; the old files are left untouched.
- **Delete all stored messages** moved to a Danger zone (only with Show advanced settings) and asks twice.
- **Smaller database:** the original packet of each message is stored as its header only when the rest equals the message text (it is put back together exactly when shown or exported). New messages take about 20% less disk; older ones stay as they are until they expire.
- **Fix:** the colour chooser swatches showed as blank circles in the Neumorphism and glass themes.

## 1.97.3
- **Log appearance works in every theme.** On the Logs and SNMP traps pages the text colour chosen per severity was ignored by the light themes; highlight colours also faded on hover and on every second row. Your choices now win over the theme.
- **Font list shows what is installed.** Fonts installed on this computer are listed first; the others are grouped as "not installed here".
- **New colour chooser** everywhere a colour is picked (log appearance, rule highlight, dashboard tiles): theme colours, a balanced palette, a hex box, "Custom…" and, where it makes sense, "Theme default" / "No highlight". It replaces the tick-box-plus-colour pairs.
- **Dashboard tiles follow the theme.** Text on coloured fills (treemap, funnel, bubbles), coloured words (word cloud), values (bar gauge, numbers, gauges), status labels and data labels now pick a readable colour in all 12 themes. Device-wall names stay readable in Crimson glass.
- **Tile settings fixed:** the gauge now uses decimals, compact numbers, prefix, suffix and size in every style (they only worked in the bar and LCD styles); the table uses prefix, suffix and colour steps; the bar gauge respects "colour steps off"; a title bar works without first choosing its colour; choosing a background or title-bar colour switches that style on; the data label shows in the preview.
- **Tidier tile editor:** options that cannot apply are hidden (line options for stacked bars, gradient fill without a fill, whole-tile fill for rankings, palette for the bar gauge, alignment for the gauge, data label for tiles without data).
- **Faster dashboard:** charts are only redrawn when their numbers, size or theme change, so refreshing a dashboard no longer causes short pauses.

## 1.97.2
- **Security fix: probe protections kept.** Saving the main Settings page dropped the probe's own settings (HTTPS required, pinned certificate, rate limit, the probe page's sign-in, its address list and certificate files). They now stay as they were.
- **Extra protection against other websites:** an API call that a browser marks as coming from another web address is refused, also in older browsers.
- **Fix:** on a slow network, opening Settings could fail with "views.snmp is not a function". The app now waits until all its files have loaded.
- **Fix:** a dashboard with an SNMP polling tile no longer keeps asking the server for polling data when the account is not allowed to see it.
- **Fix:** clicking Settings in the side panel while a settings section is open goes back to the list of settings.

## 1.97.1
- **Fix:** choosing a logo in Settings → Reports did nothing, because the page's security rules blocked the way the picture was read. The logo now loads and shows at once; click "Save name and logo" to keep it.

## 1.97.0
- **Reports follow your own set-up.** A report can use one of your saved Logs views (its columns, order and filter); without one it uses the columns you set on the Logs, Traps and Alarms pages. The same columns are used in the CSV, Excel and PDF files and in the JSON log export.
- **Polled devices in reports.** Tick "Polled devices" in a report to add availability, CPU, memory, temperature, answer time and alarms per device (CSV, Excel sheet, PDF table). A column that none of your devices reports is left out.
- **Dashboard figures in reports.** Pick one of your dashboards and the report adds its numbers and rankings for the report's period. Charts over time and live tiles are not part of a report.
- **Excel export on the SNMP polling page** for the summary and for the readings of one device.
- **Your name on reports.** Settings → Reports: company name, footer text and logo appear on the PDF, in the Excel summary and in report e-mails.
- **Your time zone and date format** (Settings → Appearance, time zone) are used in every report, export and report schedule. Report schedules and "yesterday / last week" periods are computed in that time zone.
- **SQL Server copy unchanged on purpose:** it keeps its fixed full table layout, because other programs read it and changing its columns would break them.

## 1.96.0
- **Settings are shorter.** The start page now has nine groups: Receiving, Alerts, Notifications, Reports, Users and security, Storage and backup, Appearance, Updates and licence, Advanced. Related sections share one page: Storage, time, system messages and the data folder; forwarding of syslog and traps; Service and the test message. Trap column views are now called Columns and sit under Appearance.
- **Show advanced settings** switch (top of Settings). Off by default for new installs, it hides Text replacement, SQL Server copy and the expert numbers: UDP receive buffer, secure syslog port, listen address, live view memory, plain-text log files, polling parallel requests and pause. Hidden values keep their current setting. An install that already uses text replacement or the SQL copy starts with the switch on.

## 1.95.0
- **No names from one site.** Removed the built-in templates written for one make of transmission gear (three syslog rules and one trap view) and for one make of power plant (two rules), the Eltek, Spectracom and Eventide vendor tags, and examples that named a city. New neutral starter rules: device restarted, disk/memory/CPU running out, configuration changed.
- **Vendor tags are automatic** for Cisco, Dell, HP and APC. The Vendor recognition section in Settings is gone; saved rules that match these tags keep working.
- **Twelve themes** (was nineteen): Dark, Black, Pine and gold, Twilight amber, Lagoon copper, Crimson glass, Light, Cream, Devias Kit, Minimal Free, Neumorphism and Skeuomorphic. A saved choice moves to the closest remaining theme.
- **New backgrounds** for the glass look: Night room, Crimson silk, Emerald silk, Indigo flow, Violet dusk, Graphite amber, Teal depth, Glass orbs and Pearl (light), at 2560 px. The old pictures are removed; a saved picture moves to the closest new one.
- **Smaller standard MIB set for new installs:** 56 files (the common ones and everything they need) instead of 207. Installs that already have the others keep them; further MIBs can be added in Settings → SNMP & MIBs.
- **Cleaner update package:** only `src`, `public`, `assets` and `starter-mibs` are packed (no tests or developer scripts). A new test checks that no data file, key, equipment name or site name can ship.

## 1.94.0
- **New theme: Crimson glass.** A dark frosted-glass look made for a dark room picture: floating rounded side bar and main pane, tiles a little lighter than the pane with a thin bright edge, a glowing red pill on the active menu item and red pill buttons. Choose it in Settings → Appearance (Dark themes); it turns the glass effect on with the new **Night room** background picture. It is an original design in the style of dark glass dashboards, not a copy of any product.
- **Dark glass is easier to read.** Secondary text (labels, hints, units) is brighter on every dark theme when the glass effect is on.
- Chart bars and gauges still use their severity colours, so they stay red/amber/blue/green rather than all red.

## 1.93.0
- **Automatic updates (Settings → Updates).** New switches: look for new versions automatically (every 6 hours) and install new versions automatically at a chosen hour of the day (server time). Off by default. Only packages signed by the release key are installed, the old files are kept and put back if the new version does not start, and every automatic install or failure is written to the audit log. A given version is tried once a day, so a failing update cannot loop.
- **New background pictures for the glass look:** Aurora, Nebula, Deep sea, Sunset, Forest and Graphite (dark) and Sky, Peach and Pearl (light): soft colour-mesh pictures made to show off frosted glass. A picture chosen before moves to its closest new one (Smoke and Mist → Graphite, Ember → Sunset, Ocean → Deep sea, Sand → Peach). The pictures live in `public/bg`.
- **Fewer look-alike themes.** Removed from the list: Graphite, Amethyst, Harbour ember, Moss stone, Fresh green, Hardware and Claymorphism. A saved choice moves to the closest remaining theme (Graphite → Dark, Amethyst → Twilight amber, Harbour → Lagoon copper, Moss → Pine and gold, Fresh → Light, Hardware → Skeuomorphic, Claymorphism → Neumorphism).
- **Seven new themes in the style of well-known admin templates:** Devias Kit, Berry Free, Mantis Free, Minimal Free, Paperbase, StrikingDash and Skeuomorphic. They use their own palettes and shapes in the general style of those templates (no template code or artwork).

## 1.92.1
- **Speedometer gauge:** the value no longer sits under the hub of the needle, and the needle stops inside the coloured band instead of overlapping it.
- **Narrow screens:** the “Active alarms” card is no longer cut off at the bottom on a phone or a narrow window.
- **Light theme (and Neumorphism, Nord, Solarized, Claymorphism):** the pale grey secondary text (table placeholders such as “Add a name”, units, hints) is darker, so it meets the 4.5:1 readability guideline.
- **The same buttons in the same place on every list page.** Logs, SNMP traps and Alarms now keep Views, Columns, Appearance and Export at the top right, like Devices. The row under the search is only for working with the list: Pause, group repeats, Select (and the Acknowledge / Clear / Delete buttons on Alarms).

## 1.92.0
- **Editions now mean something.** An activation key can switch parts of the program on or off and limit the number of polled devices: SNMP polling, SNMP trap receiver, scheduled reports, alert delivery (email, SMS, webhook), remote probes, and log export / database download. A part that is not in the key is hidden from the menu, refused by the server with a plain message (“… is not part of your licence”), and stops running in the background. A key may also cap the polled devices (adding one over the limit is refused with the reason). Keys made before this version carry no list and keep everything.
- Settings → About shows the included features and the polled-device limit.
- The key maker (private tool, not part of this package) has a features list and a device limit, filled in from the chosen edition.

## 1.91.0
- **Activation key.** A new copy of NetEventPro is locked until an activation key is entered (one page shows this computer's machine code and asks for the key). Until then nothing is collected or shown. The key is a signed certificate tied to the computer, checked offline, kept in the data folder, so **updates never ask for it again**, and a copy of the program or of its data folder on another computer stays locked. An installation that already holds data gets 14 days to enter its key, with a banner showing the days left. The key can be renewed under Settings → About.
- **Settings → About.** Version, licence (customer, edition, number, validity, machine code), who you are, this server (computer, system, ports, data folder, memory, running time) and the copyright statement, with a button that copies the details for a support request.
- **Messages are no longer hidden behind windows.** An error such as “Give the device a name.” raised from inside a window used to appear underneath it and only showed after closing the window. Messages now sit above every window and stay up longer when long.
- **Windows taller than the screen keep their title and their Save / Cancel buttons in view** while the middle scrolls.
- Added LICENCE.txt (software licence agreement) and copyright lines on the sign-in page. A scripted sweep of every page, tab, window and button found no further hidden messages or off-screen buttons.

## 1.90.1
- **Alarm limits, Value meanings and Templates explained side by side.** Each of the three pages now starts with three cards (what it is, an example, where it is used) so you can see which one you need, and an order of work: add the device, add readings, add alarms (inside a reading, or one shared limit for many devices), then save as a template.
- **Alarms in a reading explained.** The reading window now says that its Alarms section is for that reading on that device only, that the state of a value meaning (Warning / Critical) also raises an alarm by itself, and that Alarm limits are for the same limit on many devices.

## 1.90.0
- **SNMP polling tidied up (nothing removed).** Settings now always shows all five parts in plain names: General, Alarm limits, Value meanings, Templates and Device profiles (the old “Advanced…” switch that hid three of them is gone; “Shared sets” is now “Device profiles”). Each has a hover hint saying what it is for.
- **General settings are grouped** under When and how often, Load on the network and on devices, and Storage and logs, instead of one long list.
- **Add / edit device is grouped** under Device (name, address, group, site), SNMP access (version, community or v3 user, probe) and Polling (interval, timeout, retries, interfaces). Text boxes in the device, reading and discovery windows are wide enough to read what you type.
- The “Where do alarms come from?” explanation is shown once, on Alarm limits, instead of again on Value meanings.
- **Fixed:** Esc now closes a window even before you click inside it (this applies to every window in the app). A chart with no data no longer prints the same time five times on its axis, and long ranges show the date too. “Poll all now” refreshes the list a few seconds later instead of waiting for the next automatic refresh.
- Every polling feature was run against a simulated device (add/edit/test connection v1, v2c, v3, readings and test read, table readings, text and counter readings, alarms, value meanings, templates, copy from a device / template / built-in set, profiles, layout, interface selection, discovery, reports, CSV, pause, remove) and all worked.

## 1.89.1
- **Two-factor setup shows a QR code.** Scan it with Microsoft Authenticator, Google Authenticator or Authy. The setup key and link stay underneath for phones that cannot scan. The code is drawn in the browser by a small built-in generator (no outside service, nothing leaves the page).

## 1.89.0
- **Security check.** Settings → Security opens with a plain-language report of what could let a stranger in (sign-in off, plain HTTP, no allow-list, admin accounts without two-factor, short passwords, long sessions, open trap/syslog sources, plain-HTTP probe or webhook), each with the fix.
- **Two-factor setup asks for your current password**, so an unlocked, borrowed browser cannot bind someone else's phone to your account. Stale setup codes are cleaned up.
- **Sign-in endpoint hardened:** the request body is limited to 8 KB and must arrive within 10 seconds; user name, password and code lengths are capped. The web server now limits headers, requests per connection and open connections.
- A full authorisation sweep with a read-only account found no leak: every privileged route refuses it and secrets stay masked. New tests cover the new checks.

## 1.88.0
- **Sign-in page never shows a password.** The password field starts empty, the browser is told not to fill it in, anything a browser still drops in without typing is wiped, and "Show" returns to hidden each time the page is shown (for example after signing out). Nobody can reveal a saved password by pressing Show.
- **My account page for every user.** A new My account link in the side bar (also opened by clicking your name) lets any signed-in user, whatever the role, change their own password, set up or turn off two-factor sign-in, and choose their colour theme and animations. No Settings permission is needed, so Viewers and Operators can set up two-factor sign-in themselves. The built-in administrator has the same page.
- A read-only account no longer sees a "could not save your layout" error when it opens the dashboard.
- The two-factor reminder now points to My account.

## 1.87.0
- **Eight new colour themes**, built from the palettes you sent: Pine and gold, Twilight amber, Lagoon copper, Slate rose, Harbour ember, Moss stone, Amethyst and Mocha. They sit in a new Palette group in Settings > Appearance, use the same floating layout, work with glass and background pictures, and meet contrast targets for text, muted text and the accent colour.
- **Four similar themes removed:** Midnight blue, Forest, Solarized teal and Violet are replaced by Harbour ember, Moss stone, Lagoon copper and Amethyst. A saved choice (and older glass themes) moves to its closest new theme automatically.

## 1.86.0
- **Animations, with a switch for each.** Settings > Appearance > Animations has a master switch and ten separate ones: number count-up, tile entrance, chart draw-in, smooth value changes, page transitions, live rows, windows and menus, hover and press, live pulse, and tile movement. They are movement only, never colours, and are built from plain CSS and a small script, so they apply to every theme and look and to every dashboard, including ones you add later. They start off on devices set to reduce motion. The choice is saved in the browser.
- Numbers on tiles and in the side bar roll up to their value and roll to a new one when data refreshes; tiles rise in one after another; line and bar charts wipe in, round charts sweep clockwise and ranking bars grow; ranking bars glide to their new length; pages fade in; new log rows slide in; dialogs, menus and the detail drawer open softly; tiles lift under the pointer and glide when you rearrange them.

## 1.85.3
- **Windows and menus always fit the screen.** Pop-up panels such as Log appearance, Views, Columns and Export are kept fully on screen: they slide up or sideways when needed and scroll inside on a short window, with their Done button pinned at the bottom. Menus and dialogs are capped to the window height too.

## 1.85.2
- **Logs readable on light themes.** On Light, Cream, Fresh, Neumorphism, Claymorphism and glass over a light picture, the log table is now a solid surface with near-black text, bold severity names, darker links, alternate-row shading, stronger row lines and a solid header.

## 1.85.1
- **Dialogs readable on glass themes.** The Edit rule and Edit report windows were shifted, clipped at the top and slid under the page header because a glass panel held them. They now open centred over the whole page, on a dimmed and blurred backdrop, with a solid enough background to read.

## 1.85.0
- **Same floating layout in every theme.** The rounded side bar, the separate status bar and the rounded panels of Noir orange now apply to all themes; only the colours differ.
- **Dashboard visuals checked option by option.** A generated test board covering every tile type, data source, ranking, metric and chart option showed no errors and no empty tiles.
- **Charts.** Time axes now show the date as well as the time on ranges of a day or more, so the two ends are no longer both "22:50".
- **Radial bars.** The tiny overlapping ring labels are gone; the legend names each ring.
- **Tinted tiles and legends.** Up/down arrows and source chips keep readable contrast on tinted tiles, and long legend names wrap instead of being cut off.

## 1.84.0

- Themes tidied and the theme list redesigned. Settings → Appearance now shows theme cards with a small preview, grouped Dark, Light and Special looks, instead of a plain list. Six themes that looked like another one were removed: Nord and Charcoal become Graphite, Navy control room becomes Midnight blue, Espresso and Copper become Noir orange, Neon pink becomes Violet (a saved choice moves automatically). Dracula is renamed Violet, Solarized dark is Solarized teal and Fresh lime is Fresh green. The top bar on Cream and Fresh is now the same calm panel as every other theme instead of a black or lime pill, and the Settings header follows the glass effect instead of staying a solid band.

## 1.83.0

- Review pass. New: NOC wall sheet (very large Active alarms, Errors and Silent devices numbers, severity bars, active alarm list; added once as a new sheet tab, delete it if you do not want it) and a new sign-in page (brand panel, show-password button, Caps Lock hint, follows the saved theme). Fixes: Help section headings are readable, severity colours (Notice, Info, Critical) are darker on the light themes, the unacknowledged-alarm tint is softer on light themes, and the keyboard focus ring is thicker with a halo so it shows on every theme. Severity is always written as a word next to its colour, so colour-blind users do not depend on colour alone.

## 1.82.0

- UI polish. Devices: names, groups and expect-every boxes look like plain text until you hover or click; Note, Mute and Forget are small icon buttons, so nothing runs off the screen; the help text is shorter. System health: charts use 24-hour time like the rest of the app (with seconds for short ranges), the last time label is no longer cut off, and the responsiveness axis shows decimals. Tile labels on System health and SNMP polling use the same style as the Dashboard. SNMP polling: the empty page shows three steps and an Add device button. Settings: each group has a one-line description and matching icons. Logs: the Date column is no longer shown by default (messages from another day show their date in the Time column); you can turn it back on under Columns.

## 1.81.0

- Design review fixes. Dashboard: Active alarms is now the biggest number with a red top edge; the repeated Alarms/Syslog/Traps tag is gone from tiles under a section heading; small grey text is brighter; empty SNMP polling tiles link to SNMP polling. Alarms: unacknowledged rows are tinted, empty Acknowledged/Escalated cells show a dash instead of No, and row buttons are bigger. Phone: the menu is one scrolling row, the status bar is one line with a smaller clock, and small number tiles sit two per row.

## 1.80.0

- Two new themes. Neumorphism: one soft grey surface where panels, buttons and the active menu item look raised or pressed in. Claymorphism: pastel, puffy, rounded panels and pill buttons with soft coloured shadows. Both are light themes with their own look, so they do not combine with the Glass effect (same as Hardware).

## 1.79.1

- Glass sliders: Tile frost now also applies to dashboard tiles that have a custom look (they used a fixed blur). Settings explains that the Hardware theme has no glass, so the picture and sliders do nothing there.

## 1.79.0

- One glass effect for the whole app, like iOS: tiles, panels, side panel and status bar are frosted over a blurred picture, with thin light edges, on every theme. Turn it on in Settings → Appearance → Glass effect; choosing a picture turns it on by itself and a built-in picture is used until you pick your own. Text colour follows the theme (dark themes get light text, light themes dark). The separate Clear glass, Glassmorphism and iOS Glass themes are removed; saved choices convert to Light, Midnight or Dark with glass on. Hardware keeps its own look.

## 1.78.2

- **Clear glass now reads as real glass.** Added a bright rim light on the top and left edges, a soft diagonal sheen, an inner edge glow and a deeper shadow to every tile and panel. The built-in Sky, Sand and Pearl pictures now have crisp glossy spheres and a sharper ribbon, and the picture between the tiles stays crisp while behind each tile it is frosted, which is what makes glass look like glass.

## 1.78.1

- **Clear glass now looks like glass out of the box.** With no background picture chosen, the Clear glass theme shows a built-in light picture (Sky) behind the transparent panels, so the glass effect is visible straight away. Pick another picture, or None, in Settings → Appearance → Background picture. The Sky and Sand pictures are more vivid, and the panels are a little more transparent with a stronger blur.

## 1.78.0

- **New theme: Hardware (skeuomorphic).** Brushed-metal chassis, raised bevelled plates, tiles set into the panel like instrument windows with a metal bezel and a glass sheen, tactile pressable buttons, recessed input fields, amber LED accents and an engraved look. Pick it in Settings → Appearance → Theme.
- **New theme: Glassmorphism.** Vivid purple, pink and blue gradient background, translucent white frosted panels and tiles with soft white edges and large rounded corners, white text. Add a background picture to replace the gradient.
- Both are normal themes; the Glass effect switch does not apply to them.

## 1.77.0

- **New theme: Clear glass (transparent, dark text).** Panels, tiles, side panel and status bar are fully transparent frosted glass with a thin white edge and no colour scheme of their own, and all text is black or dark grey. It is made for a background picture, so the picture is the only colour. Pick it in Settings → Appearance → Theme, then choose a picture.
- Three light built-in pictures for it: Sky, Sand and Pearl. The Dim slider adds a white veil on this theme (raise it if text is hard to read).

## 1.76.5

- **Clear glass tiles.** Removed the grey wash (gloss gradient and dark fill) from every tile, panel, side panel and status bar in glass mode. Tiles are now clear frosted glass: the background picture shows through the blur, with a thin soft border.

## 1.76.4

- **Full screen is back in the side panel, directly under Settings**, as a normal side-panel button (it was moved into the Settings page in 1.76.1 by mistake). It is no longer on the Appearance page.

## 1.76.3

- **Fixed: uploading a background picture did nothing.** The browser's security policy blocked the temporary image link the upload used; the picture is now read directly. Uploads of PNG, JPG and WebP work.

## 1.76.2

- **Calmer glass edges.** Tiles and panels in glass mode now have a thin soft border, a smaller corner radius and a dark frosted fill, with no bright rim light, like modern dark glass dashboards.

## 1.76.1

- **Side panel bottom tidied.** The user name is now a round badge with initials, name and role. Sign out is a normal side-panel button with an icon. Full screen moved to Settings → Appearance (a normal button), and the version number moved to Settings (Service section, line “Version”). Background picture thumbnails in Settings now show their pictures.

## 1.76.0

- **Glass is now a switch, not ten separate themes.** Settings → Appearance → Glass effect turns frosted glass on over any dark theme, so every theme can be glass. The ten glass themes (Glass smoke, Dark glass, Black glass, Glass ember, aqua, dusk, amber, violet, aurora, deep blue) are removed from the list. A saved glass theme is converted automatically to a matching normal theme with the glass effect on (for example Black glass becomes Black (OLED) with glass). The two iOS Glass themes stay.

## 1.75.0

- **Realistic glass with a background picture.** Settings → Appearance → Background picture: upload your own image (resized to 1920 px, kept in this browser) or pick a built-in one (Smoke, Ember, Ocean, Aurora, Mist). The picture shows behind two glass layers: a blurred frosted pane for the page and sidebar, and frosted glass tiles with light edges and soft shadows on top. Sliders set the dim, the page glass blur and the tile frost. Works with any theme.
- New dashboard file `Real glass (all sheets)` with the compact tile layout, made to sit on a background picture.

## 1.74.2

- **Chart colours now apply to severity, state and status charts too.** Choosing a colour set other than Classic / Follow the theme on a tile now recolours it; before, those charts kept fixed red/green/amber. The Mono set is now pure grey.

## 1.74.1

- **New theme: Black glass** — the darkest glass theme: pure black background with grey glass panels and white/grey accents, no colour tint. Pick it in Settings → Theme.

## 1.74.0
- **Eight new visuals** in Customize → Add tile (new "More visuals" group): **Waffle chart** (100 squares), **Radial bars**, **Rose (polar area) chart**, **Bubbles**, **Word cloud**, **Funnel**, **Leaderboard podium** (top three on a podium) and **Device status wall** (one coloured cell per device, square / round / hexagon). The first seven work on syslog, traps, alarms and devices like the pie and bar charts (by device, process, severity, state ...), with the same filters, palettes and click-to-open-messages. Gauges also have a new **Speedometer (needle)** style.
- **Dashboard visuals checked and fixed:**
  - The **Full ring** gauge drew nothing when the number reached its maximum (and for a ring without colour steps).
  - A **Gauge showing Free disk space** stayed on "Loading…".
  - **Number with trend line** ignored what it should show: Errors, Warnings, Devices and Messages per minute all displayed the total. It now has a **Show** choice and shows the right number.
  - Small **line / trend** tiles lost most of their room to a wrapping legend; the legend is now compact, and hidden on very small tiles.
  - A dashboard with more than 30 tiles on one sheet only filled the first 30; the limit is now 80.
- **Column headings stay visible** while you scroll the Logs, Traps, Alarms and other tables in the glass themes (the heading row is now solid and always above the rows).
- **Settings → Appearance: all themes are visible.** The colour theme list is now an open list you can scroll, instead of a drop-down that was cut off at the bottom of the screen.
- **Wall display title bar** shows "Dashboard · <sheet name>" (for example "Dashboard · Overview"), not the dashboard's own name (this replaces the 1.73.3 behaviour).

## 1.73.3
- **Dashboard changes are saved only when you click Done.** While customizing, your edits (moving, resizing, adding or deleting tiles and sheets, settings) stay in the page; **Done** (⋮ menu → Finish customizing) saves them, the new **Cancel** item next to Add tile throws them away, and leaving the page or reloading without clicking Done discards them. Before, every change was saved at once.
- **Wall display title bar shows the heading "Dashboard · <sheet name>"** (for example "Dashboard · Overview") at its left, as on the page.
- **Wall display scrolls with the keyboard**: Up / Down arrows, PageUp / PageDown, Home and End.
- **Left / Right arrow keys switch sheets** on the dashboard (not while typing, in a dialog or while customizing).
- **Full screen button is back** in the side panel (it was removed by mistake in 1.73.0).
- **New theme: Dark glass** (Settings → Appearance): near-black frosted glass with a cool cyan accent, for the whole app and the dashboard tiles.

## 1.73.2
- **Faster dashboard**: the numbers of every tile are now cached on the server one by one (for a few seconds, shared between sheets, pages and people), so the same number is not counted again; the old whole-page cache never matched because the time range moves on every request. The dashboard also remembers the last numbers of every sheet: reopening the page or switching back to a sheet shows them **at once** and refreshes them in the background, instead of "Loading…".
- Fixed: switching sheets while the previous sheet was still loading could leave the new sheet empty until the next refresh, or show the numbers of the other sheet for a moment.

## 1.73.1
- **Wall display is now an icon button** (a monitor symbol) next to the ⋮ menu on the dashboard, for every dashboard, new ones included. The "Full screen" button of the left panel was removed (the wall display goes full screen as well); "Copy wall link" stays in the ⋮ menu.
- **Sheet icons you can choose**: *Change sheet icon…* in the ⋮ menu (and a picker when you add a sheet) offers 18 icons for the buttons of the sheet bar. The icon is saved with the sheet.
- Fixed: in the Glass and iOS Glass themes the **Add tile** visual cards were drawn as big ovals that covered their pictures; they are rounded cards again. The sheet bar no longer floats above dialogs.

## 1.73.0
- **Dashboard sheets** (like Power BI pages): one dashboard now has several sheets — **Overview** (a mix of alarms, syslog, SNMP traps, SNMP polling and devices), **Alarms**, **Syslog**, **SNMP traps**, **SNMP polling** and **Devices**. Every sheet has its own tiles that you can move, resize, add and remove. The ⋮ menu has *Add sheet…*, *Rename this sheet…* and *Delete this sheet*; *Reset layout* restores the standard tiles of the sheet you are on. Up to 8 sheets per dashboard. Sheets are saved with the dashboard and travel with Export / Import and Save as.
- **Sheet bar**: a small panel at the bottom of the dashboard appears when you move the mouse over the page (and fades away after a moment). One round button per sheet; hover a button to see the sheet name. Works in Wall display mode too; the Wall link opens the sheet you are on.
- Fixed: **tiles that moved or overlapped by themselves**. The old layout engine sorted tiles into hidden "Syslog / SNMP / alarm" zones whenever you moved or removed a tile, which pushed tiles of an imported or custom layout on top of each other. There are no zones now: a saved layout is never rearranged when the dashboard opens (only a layout that already has overlapping tiles is repaired once), and moving or removing a tile only closes the gap in its own column.
- Removed the **Syslog first / SNMP first** switch (the sheets replace it).

## 1.72.0
- Glass looks for the dashboard tiles and their visuals, **only while a glass theme is selected** (the six Glass themes and the two iOS Glass themes; every other theme is unchanged): tiles get a soft corner highlight; bar meters (severity breakdown, busiest devices and processes) become glossy glass tubes; trend bars are glossy with a bright top edge; chart lines glow; the donut chart has a clear hole and glassy slices; heatmap cells, chips and gauges get a glass edge.
- The glass drawing is cheap (no extra blur on the visuals) and is switched off in Wall display mode.

## 1.71.0
- Two new colour themes, **iOS Glass (light)** and **iOS Glass (dark)**: complete liquid-glass look for the whole application. Bright frosted surfaces with strong blur and saturation, a bright specular edge, large rounded corners, a floating rounded side rail and status strip, blue pill buttons, and the system (San Francisco style) font where the computer has it. Wall display mode turns the blur off; so does the operating system's "reduce transparency" setting.
- Dashboards: the "All devices" device filter box was removed from every dashboard. A device filter saved earlier is ignored, so all tiles show all devices.

## 1.70.0
- **Poll all now** button on the SNMP polling Devices page: asks every device now (spread over a few seconds), including devices that were waiting after missed polls. Use it after you bring devices back (for example, after starting the fake devices).
- Why polling did not restart by itself: a device that does not answer is asked less and less often (every 2x, 4x, 8x ... of its interval). The longest wait was 10 minutes, so devices that came back kept looking down, and their "no SNMP answer" alarms stayed open, until the next try. The longest wait is now 5 minutes. A device is back to its normal interval as soon as it answers once.
- Checked: a device that did not answer was marked down; after its agent started it stayed down for a while, and Poll all now brought it up in seconds.

## 1.69.0
- Glass themes now look like real frosted glass: the side rail, status strip and every card blur and brighten what is behind them, with a soft highlight in the corner and a bright top edge, over a more colourful background. (No diagonal lines.) Text contrast was re-checked on all eight glass themes.
- Cards use a live blur. This costs a little more drawing than the flat looks; Wall display mode turns the blur off, and so does the operating system setting "reduce transparency".
- Wall display: the date and time title bar is now a rounded floating bar that matches the theme (glass, soft, flat looks and Fresh lime).

## 1.68.1
- Glass themes: removed the diagonal line that ran corner to corner. The glass surfaces are now flat, clear translucent layers with a bright top edge, and a lighter dark tint so more of the background shows through (text contrast re-checked).
- Dashboard settings: removed every colour option (accent colour, page background and its colours, Quick look, the Glass and Accent edge card styles and the Coloured title bar). Colours now come only from the application colour theme. Colours saved earlier in a dashboard's settings are ignored.
- Dashboard settings: Card style and Tile titles did nothing (their styling was attached to the wrong page element); they work now. Corner radius follows the theme until you move the slider. Checked each remaining setting: card style, titles, corner radius, space between tiles, row height, refresh rate and Reset style.

## 1.68.0
- Eight more colour themes (Settings -> Look and sound -> Colour theme): flat dark looks **Noir orange**, **Charcoal and amber**, **Copper**, **Navy control room**, **Neon pink and violet**, and glass looks **Glass violet**, **Glass aurora (blue to red)** and **Glass deep blue**. The flat looks use no blur at all. The glass looks blur only the side rail, the page frame and the status strip (never every card), so they stay light on the browser.
- The glass themes are glassier: a clear light sheen and bright edge on every surface, with a dark tint underneath so text stays readable.
- Text colours checked on every new theme: light themes now use darker severity colours, chips, pills and warning badges, and the Syslog/SNMP first switch uses the theme's own text colour. All checked text is at least about 4:1 against its background (most 4.5:1 or more).
- Dashboard: the page buttons moved into one three-dot menu in the top right corner (Refresh now, Wall display, Copy wall link, Customize, New dashboard, Rename, Export, Import, Dashboard settings, Reset layout, Delete). **Add tile** and **Save as** are now inside **New dashboard**. While customizing, a **Done** button appears next to the menu.
- Dashboard settings no longer has a Colour theme (the application colour theme now styles the dashboard too). Dashboards that used another dashboard theme go back to the standard one.

## 1.67.0
- Six more looks under Settings → Look and sound → Colour theme: **Fresh lime (light)** and five glass looks, **Glass smoke**, **Glass ember (orange)**, **Glass aqua (teal glow)**, **Glass dusk (brown and blue)** and **Glass amber (warm peach)**. Glass looks use translucent, blurred panels, a rounded side rail, pill status strip and pill buttons. Same layout and pages.
- The separate "Dashboard theme" setting was removed from Settings, since the colour themes now style the whole application. (The Customize window on the Dashboard still has its own dashboard colours; pages are unchanged.)

## 1.66.0
- New soft, embossed look in two variants: **Cream (soft, light)** and **Espresso (soft, dark)**. Choose one under Settings → Look and sound → Colour theme. Same layout and pages as before; only the look changes: raised rounded cards with soft shadows, a dark pill-shaped status strip, a rounded dark side rail with a green highlight, and tactile pill buttons that press in when clicked. Existing themes are unchanged and remain the default.

## 1.65.3
- **Fixed: a change between two alarm states left the old alarm open** for the built-in lookups (interface status, colour, battery, up/down and so on) and for lookups made on the Lookups tab. For example an interface going from *down* (critical) to *testing* (warning) showed both alarms until it came up; the same for warning to critical. The old alarm now ends when the state changes, like it already did for the lookups made on a single reading.
- Found by testing about 275 alarm and lookup cases (all six operators, clear values, hold times, table rows, text alarms, every value of the 7 built-in lookups, own lookup rules with every operator). Everything else behaved correctly.
- Test: critical -> warning -> critical -> up on a built-in lookup.

## 1.65.2
- **SNMP polling input checks** (found by testing on a real laptop):
  - A port outside 1 to 65535 (for example 0) is refused with a clear message. Before, 0 was quietly saved as port 1 and the device never answered. Leaving the port empty still means 161.
  - An alarm limit (Alarm limits tab) on a reading name NetEventPro does not know is refused with a message. Before, it was saved and never fired.
  - More than 200 alarm limits are refused with a message. Before, the extra ones were dropped without telling you.
- **Menu names in messages and the guide match the new Settings menu** (for example "Settings → Syslog inputs (UDP receive buffer)", "Settings → Dashboard access → HTTPS", "Settings → Security", "Settings → Remote probes", "SNMP polling → Settings → Advanced → Templates").
- Test: bad port, unknown reading and too many alarm limits.

## 1.65.1
- **Fixed: removing a reading left its table on the device page.** The table of a removed reading (shown under its internal name, for example "ra295c155 4 rows") stayed until the service was restarted. It is now removed at once, also when the last reading is removed.
- Test: removed table leaves nothing on the device page.

## 1.65.0
- **Settings has a new start page:** a menu in three columns with groups (Receiving, Forwarding and remote, Alerts and notifications, Users and security, Storage and time, Look and sound, Service) and a link for every section. Click a link to open that section; **← All settings** at the top goes back. The old row of tabs is gone; nothing was removed.
- **Search in settings:** type a word (retention, port, email, password...) to list the matching sections, also by words inside the section; Enter opens the first one, Esc clears.
- **Save changes** still saves every option on every section, whichever one is open. Old links (#users, #backup, #rules and so on) open their section directly.

## 1.64.0
- **A polling alarm that is no longer open is raised again while the value is still bad.** Before, the polling engine remembered "already in alarm" and stayed silent after the alarm had been deleted or cleared by hand (or refused because the alarm list was full), until the value had gone back to normal. Now, about 30 seconds after raising it, each poll checks that the alarm is really open (or acknowledged); if not, it is raised again. Applies to alarm limits, readings' own alarms and value-meaning (warning / critical) alarms. Found when two rows of a table stayed silent after their alarms had been deleted.
- Clearing an alarm by hand while the device is still faulty therefore brings it back at the next poll. Acknowledge it instead to keep it quiet.
- Test: re-raise after deletion; checked live against a fake device.

## 1.63.0
- **Simpler SNMP polling → Settings:** only **General** and **Alarm limits** are shown. **Value meanings**, **Templates** and **Shared sets** (the reading profiles) are behind an **Advanced…** link, because most setups rarely need them. Nothing was removed or changed; the choice is remembered in the browser.

## 1.62.0
- **Delete all matching alarms:** the Alarms page shows **Delete all N** when more alarms match the filters than the 300 listed. After a confirmation that shows the count, it deletes every alarm that matches the current filters (state, source, severity, period and search text) in one step, not only the 300 shown. It needs the Delete permission and is written to the audit log. Useful after test floods.
- Test: delete by filter.

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
