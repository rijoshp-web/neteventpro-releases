# Trying SNMP polling without real equipment

`tools/fake-device.js` is a pretend SNMP device. It needs only Node.js 22 (the same Node that runs NetEventPro) and answers SNMP v1 / v2c, community `public`.

## Start it
```
node tools/fake-device.js                 (UDP port 1161, this PC only)
node tools/fake-device.js --port 1162     (a second device: one window per device)
node tools/fake-device.js --host 0.0.0.0  (reachable from other PCs; allow the UDP port in the firewall)
```
Leave the window open. Type a command in it at any time: `hot`, `critical`, `cool`, `down 2`, `up 2`, `status`, `quit`.

## Add it in NetEventPro
SNMP polling -> Add device: host `127.0.0.1`, port `1161`, version v2c, community `public`.

## What it contains
| Item | OID |
|---|---|
| Name, description, uptime | 1.3.6.1.2.1.1.5.0 / .1.0 / .3.0 |
| 4 interfaces (status, names, traffic counters) | 1.3.6.1.2.1.2.2.1.* and 1.3.6.1.2.1.31.1.1.1.* |
| CPU (Cisco style) | 1.3.6.1.4.1.9.9.109.1.1.1.1.8.1 |
| A table of 4 rows, like a room-temperature table | names `1.3.6.1.4.1.99999.1.1.1`, values `...1.1.2`, status code `...1.1.3` (1 normal, 2 high, 3 critical) |

Room A starts at 22, the others at 6; the values drift a little every 5 seconds and the traffic counters grow.

## Things to try
1. **Table, one value per row**: new profile, metric type *walk*, OID `1.3.6.1.4.1.99999.1.1.2`, Combine *each row*, Name column `1.3.6.1.4.1.99999.1.1.1`. You get 4 rows named Room A to D.
2. **Scale**: set Scale 0.5 on that metric and see Room A become 11.
3. **Lookup**: for the status column `...1.1.3` choose a lookup with 1 = OK, 2 = Warning, 3 = Critical, then type `critical` in the device window: an alarm is raised for Room A and clears after `cool`.
4. **Threshold**: on the value column, above 30 for 1 minute, then type `hot`.
5. **Interface down**: watch an interface and type `down 2`.
6. **Device stops answering**: close the fake device window and see the "No SNMP answer" alarm; start it again and it clears.

## Limits
A fake device checks the polling logic, graphs, lookups, thresholds and alarms. It cannot reproduce the slow answers, odd MIB habits or SNMPv3 settings of real equipment, so test the final profile on the real device too.
