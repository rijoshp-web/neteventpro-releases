# Replacing PRTG with NetEventPro SNMP polling

This is the working guide. Version 1.51. Status of every PRTG feature is listed honestly in section 5.

## 1. The idea in one minute
- **Device** = the thing you poll (IP, SNMP version, community / v3 user, interval). Same as a PRTG device.
- **Profile** = the list of values to read from a kind of device. One profile replaces the *set of sensors* you would add to every device of that kind in PRTG. Built in: Generic, Cisco, APC. Everything else you build yourself from the vendor MIB (Pick from MIB).
- **Metric** = one value in a profile (a PRTG *channel*). It has a data type, a unit, an optional lookup and can be one value, a table combined into one number, or a table row by row.
- **Threshold** = a limit on a metric (PRTG channel limits). It raises a normal alarm (alarm list, e-mail, SMS, Teams, sound ...) and clears it by itself.
- **Lookup** = number -> word + state (PRTG lookup). A Warning/Critical state raises an alarm by itself.
- **Probe** = a small NetEventPro in a remote network that polls devices the main server cannot reach (PRTG remote probe).
Unlimited metrics and devices: there is no sensor limit.

## 2. PRTG sensor -> what you do here
| PRTG sensor | NetEventPro |
|---|---|
| SNMP Custom (one OID) | Profile -> *Add reading*: Kind *one value*, OID ending in `.0`, Data type *Number* |
| SNMP Custom Advanced (several OIDs) | Several readings in one profile |
| SNMP Custom Table | Kind *table: every row separately* (+ name column OID). *Pick from MIB -> Whole table* does it in one click |
| SNMP Custom String | Data type *Text*; alarm with a text threshold (changes / is / contains) |
| SNMP Custom String Lookup / Lookup files | *Lookups* tab; choose it in the profile column *Lookup* |
| SNMP Library (MIB import) | Settings -> SNMP -> MIB files, then *Pick from MIB* (search by file, name, OID) |
| SNMP Traffic / Interface | Automatic: interfaces that are up are watched (64-bit counters, in/out, errors, status). Tick/untick on the device page |
| SNMP CPU / Memory / Disk / Uptime / System health | Built-in profiles (Generic: Host Resources MIB; Cisco; APC). Others: Pick from MIB |
| SNMP Trap Receiver | Already there (Traps page) |
| Syslog Receiver | The main function of the app |
| Ping / Port / HTTP / DNS | **Not yet** (section 5) |
| WMI sensors | **Not yet** (section 5) |

## 3. Data types (column "Data type")
- **Number** - the value as it is (Integer, Gauge, Unsigned). Text that holds a number ("12.4", "12.4 V") is read as a number too.
- **Counter (per second)** - a value that only grows (octets, errors, packets). Shown as a rate; 32- and 64-bit wrap handled. Same as PRTG *Delta (counter)*.
- **Uptime ticks -> seconds** - TimeTicks (hundredths of a second) shown in seconds / days.
- **Text** - a text value (firmware, status text, a name). Shown on the device page; alarm when it changes or contains a word.
- **Multiply by** - scale (PRTG *scaling*): 0.1 for tenths of a volt, 0.001 for milli-units, 8 for bytes to bits.
- **Unit** - free text with suggestions (%, °C, V, A, W, Hz, rpm, dB, s, B, bit/s ...).
- **Kind** - *one value*; *table: combine rows into one* (average, highest, lowest, sum); *table: every row separately*.

## 4. Step by step: a device that is not Cisco/APC (example: a transmission shelter with an analogue input table)
1. Settings -> SNMP -> MIB files: upload the vendor MIB.
2. SNMP polling -> Profiles -> *New profile* (name it after the vendor/model) -> *Pick from MIB*: choose the MIB file, search `analog`, press **Whole table**. Every value column is added, rows are named by the comment column. Values that have named states (green/yellow/red) get a lookup automatically.
3. Remove the columns you do not need, set units and *Multiply by* (a "12.4" text voltage needs nothing). Save profiles.
4. *Add device* (or *Discover devices*): IP, SNMP version and community; **Profile** = the one you just made (or leave on automatic for Cisco/APC). *Test connection* shows what the device answered.
5. Thresholds -> *Add threshold*: choose the metric, *above / below / at least / at most / equals / is not*, how many minutes it must last, the severity, which devices, which notification profiles. For a lookup metric nothing is needed: Warning/Critical states alarm by themselves.
6. Check the device page: graphs, a **Status** panel (lookup words in colour, text values), a table per row-by-row reading with a Graph button.
7. Remote site? Add a probe (Probes page) and set *Polled by* on the device.

## 5. Honest status against PRTG
Available now: custom OID, table, string, lookup, MIB library, traffic (64-bit), counters/rates, thresholds with hysteresis and delay, per-row thresholds, no-answer alarm with ping hint, auto-discovery of SNMP devices, remote probes (with offline queue), maintenance windows, notifications (mail, SMS, Teams, webhook ...), dashboards, availability reports, roles (SNMP polling is Administrator only), SQL copy, API, unlimited sensors, SNMP v1/v2c/v3.
Not available yet (planned, in this order):
1. **Ping / TCP port / HTTP(S) / DNS / certificate-expiry checks** as normal metrics with graphs, thresholds, probes.
2. **Dependencies** (when the parent device or link is down, do not alarm for what is behind it).
3. **Maps / sensor tree overview** with colours (a PRTG map equivalent).
4. **WMI** for Windows (CPU, memory, disk, services, event log). Today: install the Windows SNMP feature on the PC, or use the NetEventPro syslog/event forwarding. Planned: remote CIM/PowerShell with stored credentials.
5. Per-metric polling interval (today per device), SLA report with targets, NetFlow/sFlow.
Not tested with real devices yet: everything here was tested with a fake SNMP agent, pysnmp and the test suites. Test one device of each kind and compare it with PRTG for a week before you switch off PRTG.

## 6. Switching over safely
1. Run both for 1-2 weeks. Start with network devices (SNMP), keep PRTG for WMI/ping/HTTP until those exist here.
2. Per device kind: build one profile, compare values with PRTG.
3. Recreate PRTG limits as thresholds (same value, same delay).
4. Recreate PRTG notifications as notification profiles and attach them to thresholds.
5. Remove the PRTG sensors of a kind only after that kind has been steady here.
