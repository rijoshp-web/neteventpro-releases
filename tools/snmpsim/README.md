# SNMP device simulator

Twenty simulated devices on one computer, so SNMP polling can be tried and shown without touching real equipment. Each
device answers SNMP v1/v2c on its own UDP port, with values that change over time (loads go up and down, counters grow,
a rectifier fails now and then, a door opens, a link drops). Only Node.js 22 is needed.

| Port  | Device | What it shows |
|-------|--------|---------------|
| 16101 | Core switch | 50 ports with traffic and errors, CPU, memory, temperature, power supplies |
| 16102 | Edge router | 8 interfaces, CPU, memory, BGP routes and sessions |
| 16103 | Firewall | sessions, CPU, cluster role (text), blocked connections |
| 16104 | Windows server | 8 CPU cores, disks and memory (standard HOST-RESOURCES-MIB) |
| 16105 | Linux server | 16 cores, disks, load average |
| 16106 | Rectifier plant | battery voltage, load and battery current, temperatures, mains, 4 rectifier modules |
| 16107 | UPS | the standard UPS-MIB: battery status, runtime, charge, voltages, output source and load |
| 16108 | Multiplexer | 2 optical lines (receive/transmit power in dBm), 16 E1 ports with status and errored seconds |
| 16109 | PDU | total current, power, voltage, energy, current per outlet |
| 16110 | Generator | engine state, fuel, coolant temperature, starter battery, run hours, speed |
| 16111 | Environment sensor | temperature and humidity of 4 probes, door, water leak, CO2 |
| 16112 | Time server | GPS lock, satellites, time offset, stratum, NTP requests |
| 16113 | Audio processor | input level of 8 channels in dBFS, silence detection, delay, preset |
| 16114 | Microwave link | receive level, signal to noise, modulation |
| 16115 | Air conditioner | supply and return air, set point, compressor, fan |
| 16116 | Storage NAS | volumes, disk temperatures and status |
| 16117 | Wi-Fi controller | access points online, clients |
| 16118 | Legacy SNMPv1 device | answers SNMPv1 only |
| 16119 | Vendor-only controller | no standard values at all (no uptime, no name), like some power controllers |
| 16120 | Flaky remote site | slow (about 350 ms) and loses about 15 % of requests |

Equipment-specific values use enterprise number 32473 (reserved by IANA for examples), standard values use the standard MIBs.

## Run

```
node snmpsim.js
```

Then add the devices in NetEventPro by hand (address of this computer, the port above, community `public`, v2c; v1 for
the legacy device) with the readings listed in `readings.md`. Or let the simulator add them, with all their readings,
alarm limits and value meanings:

```
node snmpsim.js --add http://NEP-SERVER:8514 --user admin --pass "your password"
```

`--insecure` for https with a self-signed certificate, `--host 127.0.0.1` to listen only on this computer (default: all
addresses, so another computer can poll it; allow UDP 16101-16120 in the firewall), `--base 17101` for other ports,
`--community something` for another community. Remove the devices it added (their names start with "SIM "):

```
node snmpsim.js --remove http://NEP-SERVER:8514 --user admin --pass "your password"
```

The simulator uses very little processor time. Stop it with Ctrl+C.
