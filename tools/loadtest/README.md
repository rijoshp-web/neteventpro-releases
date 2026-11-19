# Load test for your own NetEventPro server

Measures how much your real server can take: syslog over UDP and TCP and SNMP traps from thousands of simulated devices,
step by step, while it checks how fast the dashboard, searches and the Devices page answer. At the end it writes a report.

## What you need

- The NetEventPro server you want to test, running as usual (best: a test copy, or a quiet hour).
- A **second computer** on the same network with **Node.js 22** (https://nodejs.org). Testing from the server itself also
  works, but then the test sender takes CPU away from NetEventPro and the numbers come out lower.
- The firewall on the server must let the syslog and trap ports in from the second computer (it does for devices already).

## Run

```
node loadtest.js --url http://NEP-SERVER:8514 --user admin --pass "your password" --target NEP-SERVER --cleanup
```

It takes about 10 minutes with the standard steps (UDP 1 000 / 5 000 / 10 000 / 20 000 messages a second, TCP 5 000 / 20 000,
traps 500 / 2 000). Change them with `--steps`, `--tcp-steps`, `--traps`, the time per step with `--secs`, the number of
simulated devices with `--devices`. `--cleanup` deletes the test messages at the end (they all carry the process name
`neploadtest`); without it they stay and can be deleted later with a search for `neploadtest`.

## Results

`loadtest-results-<date>.md` (a readable table) and `loadtest-results.json` are written to the folder you ran it from.
Send both back for advice on the server size, retention and settings. Alarms raised by your rules for the test messages
can be cleared on the Alarms page; the device names all start with `lt-`.
