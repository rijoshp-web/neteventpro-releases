# Simulated devices and their readings

Community: `public`, version v2c (the legacy device: v1). Host: the computer running snmpsim.js. Values change over time.

## SIM Core switch  (UDP port 16101)



| Reading | Unit | OID | How | Notes |
|---|---|---|---|---|
| CPU load | % | `1.3.6.1.4.1.32473.2.1.1.0` | single value | alarm > 85 |
| Memory used | % | `1.3.6.1.4.1.32473.2.1.2.0` | single value |  |
| Temperature | °C | `1.3.6.1.4.1.32473.2.1.3.0` | single value | alarm > 55 |
| Power supply |  | `1.3.6.1.4.1.32473.2.1.4` | table, one value each | 1=OK, 2=Alarm |
| Traffic in | B | `1.3.6.1.2.1.31.1.1.1.6` | table, one value each, names `1.3.6.1.2.1.31.1.1.1.1` | counter |
| Port status |  | `1.3.6.1.2.1.2.2.1.8` | table, one value each, names `1.3.6.1.2.1.31.1.1.1.1` | 1=Up, 2=Down |

## SIM Edge router  (UDP port 16102)



| Reading | Unit | OID | How | Notes |
|---|---|---|---|---|
| CPU load | % | `1.3.6.1.4.1.32473.2.2.1.0` | single value |  |
| Memory used | % | `1.3.6.1.4.1.32473.2.2.2.0` | single value |  |
| BGP routes |  | `1.3.6.1.4.1.32473.2.2.3.0` | single value |  |
| BGP session |  | `1.3.6.1.4.1.32473.2.2.4` | table, one value each | 6=Established, 3=Active (down) |
| Traffic in | B | `1.3.6.1.2.1.31.1.1.1.6` | table, one value each, names `1.3.6.1.2.1.31.1.1.1.1` | counter |
| Port status |  | `1.3.6.1.2.1.2.2.1.8` | table, one value each, names `1.3.6.1.2.1.31.1.1.1.1` | 1=Up, 2=Down |

## SIM Firewall  (UDP port 16103)



| Reading | Unit | OID | How | Notes |
|---|---|---|---|---|
| Sessions |  | `1.3.6.1.4.1.32473.2.3.1.0` | single value |  |
| CPU load | % | `1.3.6.1.4.1.32473.2.3.2.0` | single value |  |
| Cluster role |  | `1.3.6.1.4.1.32473.2.3.3.0` | single value | text |
| Blocked connections | /s | `1.3.6.1.4.1.32473.2.3.4.0` | single value | counter |
| Traffic in | B | `1.3.6.1.2.1.31.1.1.1.6` | table, one value each, names `1.3.6.1.2.1.31.1.1.1.1` | counter |
| Port status |  | `1.3.6.1.2.1.2.2.1.8` | table, one value each, names `1.3.6.1.2.1.31.1.1.1.1` | 1=Up, 2=Down |

## SIM Windows server  (UDP port 16104)



| Reading | Unit | OID | How | Notes |
|---|---|---|---|---|
| CPU load | % | `1.3.6.1.2.1.25.3.3.1.2` | table, avg |  |
| Processes |  | `1.3.6.1.2.1.25.1.6.0` | single value |  |
| Disk used (blocks) |  | `1.3.6.1.2.1.25.2.3.1.6` | table, one value each, names `1.3.6.1.2.1.25.2.3.1.3` |  |

## SIM Linux server  (UDP port 16105)



| Reading | Unit | OID | How | Notes |
|---|---|---|---|---|
| CPU load | % | `1.3.6.1.2.1.25.3.3.1.2` | table, max |  |
| Load average 1 min |  | `1.3.6.1.4.1.2021.10.1.3.1` | single value |  |
| Processes |  | `1.3.6.1.2.1.25.1.6.0` | single value |  |

## SIM Rectifier plant  (UDP port 16106)



| Reading | Unit | OID | How | Notes |
|---|---|---|---|---|
| Battery voltage | V | `1.3.6.1.4.1.32473.3.1.1.0` | single value | × 0.01; alarm < 50, alarm > 57.5 |
| Load current | A | `1.3.6.1.4.1.32473.3.1.2.0` | single value | × 0.1 |
| Battery current | A | `1.3.6.1.4.1.32473.3.1.3.0` | single value | × 0.1 |
| Battery temperature | °C | `1.3.6.1.4.1.32473.3.1.4.0` | single value | × 0.1; alarm > 35 |
| Battery capacity | % | `1.3.6.1.4.1.32473.3.1.5.0` | single value |  |
| Mains |  | `1.3.6.1.4.1.32473.3.1.6.0` | single value | 1=On, 2=Mains failure |
| Rectifier status |  | `1.3.6.1.4.1.32473.3.1.10.1.3` | table, one value each, names `1.3.6.1.4.1.32473.3.1.10.1.2` | 1=OK, 2=Failed |
| Rectifier current | A | `1.3.6.1.4.1.32473.3.1.10.1.4` | table, one value each, names `1.3.6.1.4.1.32473.3.1.10.1.2` | × 0.1 |
| Rectifier temperature | °C | `1.3.6.1.4.1.32473.3.1.10.1.5` | table, one value each, names `1.3.6.1.4.1.32473.3.1.10.1.2` |  |

## SIM UPS  (UDP port 16107)



| Reading | Unit | OID | How | Notes |
|---|---|---|---|---|
| Battery status |  | `1.3.6.1.2.1.33.1.2.1.0` | single value | 2=Normal, 3=Low, 4=Depleted |
| Runtime left | min | `1.3.6.1.2.1.33.1.2.3.0` | single value | alarm < 15 |
| Battery charge | % | `1.3.6.1.2.1.33.1.2.4.0` | single value |  |
| Battery voltage | V | `1.3.6.1.2.1.33.1.2.5.0` | single value | × 0.1 |
| Battery temperature | °C | `1.3.6.1.2.1.33.1.2.7.0` | single value |  |
| Input voltage | V | `1.3.6.1.2.1.33.1.3.3.1.3.1` | single value |  |
| Output source |  | `1.3.6.1.2.1.33.1.4.1.0` | single value | 3=Normal, 4=Bypass, 5=On battery |
| Output load | % | `1.3.6.1.2.1.33.1.4.4.1.5.1` | single value | alarm > 80 |

## SIM Multiplexer  (UDP port 16108)



| Reading | Unit | OID | How | Notes |
|---|---|---|---|---|
| Optical receive power | dBm | `1.3.6.1.4.1.32473.4.1.1.1.3` | table, one value each, names `1.3.6.1.4.1.32473.4.1.1.1.2` | × 0.1; alarm < -25 |
| Optical transmit power | dBm | `1.3.6.1.4.1.32473.4.1.1.1.4` | table, one value each, names `1.3.6.1.4.1.32473.4.1.1.1.2` | × 0.1 |
| Line status |  | `1.3.6.1.4.1.32473.4.1.1.1.5` | table, one value each, names `1.3.6.1.4.1.32473.4.1.1.1.2` | 1=OK, 2=LOS |
| E1 status |  | `1.3.6.1.4.1.32473.4.1.2.1.3` | table, one value each, names `1.3.6.1.4.1.32473.4.1.2.1.2` | 1=OK, 2=AIS, 3=Not in use |
| E1 errored seconds |  | `1.3.6.1.4.1.32473.4.1.2.1.4` | table, one value each, names `1.3.6.1.4.1.32473.4.1.2.1.2` | counter |
| Active alarms |  | `1.3.6.1.4.1.32473.4.1.3.0` | single value |  |
| Clock source |  | `1.3.6.1.4.1.32473.4.1.4.0` | single value | text |

## SIM PDU  (UDP port 16109)



| Reading | Unit | OID | How | Notes |
|---|---|---|---|---|
| Total current | A | `1.3.6.1.4.1.32473.3.3.1.0` | single value | × 0.1; alarm > 25 |
| Power | W | `1.3.6.1.4.1.32473.3.3.2.0` | single value |  |
| Voltage | V | `1.3.6.1.4.1.32473.3.3.3.0` | single value |  |
| Energy | kWh | `1.3.6.1.4.1.32473.3.3.4.0` | single value | × 0.001 |
| Outlet current | A | `1.3.6.1.4.1.32473.3.3.10.1.3` | table, one value each, names `1.3.6.1.4.1.32473.3.3.10.1.2` | × 0.1 |

## SIM Generator  (UDP port 16110)



| Reading | Unit | OID | How | Notes |
|---|---|---|---|---|
| Engine state |  | `1.3.6.1.4.1.32473.3.4.1.0` | single value | 1=Stopped (ready), 2=Running, 3=Fault |
| Fuel level | % | `1.3.6.1.4.1.32473.3.4.2.0` | single value | alarm < 30 |
| Coolant temperature | °C | `1.3.6.1.4.1.32473.3.4.3.0` | single value |  |
| Starter battery | V | `1.3.6.1.4.1.32473.3.4.4.0` | single value | × 0.1 |
| Run hours | h | `1.3.6.1.4.1.32473.3.4.5.0` | single value |  |
| Engine speed | rpm | `1.3.6.1.4.1.32473.3.4.6.0` | single value |  |
| Mode |  | `1.3.6.1.4.1.32473.3.4.7.0` | single value | text |

## SIM Environment sensor  (UDP port 16111)



| Reading | Unit | OID | How | Notes |
|---|---|---|---|---|
| Temperature | °C | `1.3.6.1.4.1.32473.5.1.1.1.3` | table, one value each, names `1.3.6.1.4.1.32473.5.1.1.1.2` | × 0.1; alarm > 35 |
| Humidity | % | `1.3.6.1.4.1.32473.5.1.1.1.4` | table, one value each, names `1.3.6.1.4.1.32473.5.1.1.1.2` |  |
| Door |  | `1.3.6.1.4.1.32473.5.1.2.0` | single value | 1=Closed, 2=Open |
| Water leak |  | `1.3.6.1.4.1.32473.5.1.3.0` | single value | 1=Dry, 2=Water detected |
| CO2 | ppm | `1.3.6.1.4.1.32473.5.1.4.0` | single value |  |

## SIM Time server  (UDP port 16112)



| Reading | Unit | OID | How | Notes |
|---|---|---|---|---|
| GPS lock |  | `1.3.6.1.4.1.32473.6.1.1.0` | single value | 1=Locked, 2=Holdover |
| Satellites |  | `1.3.6.1.4.1.32473.6.1.2.0` | single value | alarm < 4 |
| Time offset | ns | `1.3.6.1.4.1.32473.6.1.3.0` | single value |  |
| Stratum |  | `1.3.6.1.4.1.32473.6.1.4.0` | single value |  |
| NTP requests | /s | `1.3.6.1.4.1.32473.6.1.5.0` | single value |  |

## SIM Audio processor  (UDP port 16113)



| Reading | Unit | OID | How | Notes |
|---|---|---|---|---|
| Input level | dBFS | `1.3.6.1.4.1.32473.7.1.1.1.3` | table, one value each, names `1.3.6.1.4.1.32473.7.1.1.1.2` | × 0.1; alarm < -60 |
| Silence |  | `1.3.6.1.4.1.32473.7.1.1.1.4` | table, one value each, names `1.3.6.1.4.1.32473.7.1.1.1.2` | 1=Audio present, 2=Silence |
| Delay | ms | `1.3.6.1.4.1.32473.7.1.2.0` | single value |  |
| Preset |  | `1.3.6.1.4.1.32473.7.1.3.0` | single value | text |
| Temperature | °C | `1.3.6.1.4.1.32473.7.1.4.0` | single value |  |

## SIM Microwave link  (UDP port 16114)



| Reading | Unit | OID | How | Notes |
|---|---|---|---|---|
| Receive level | dBm | `1.3.6.1.4.1.32473.8.1.1.0` | single value | × 0.1; alarm < -60 |
| Signal to noise | dB | `1.3.6.1.4.1.32473.8.1.2.0` | single value | × 0.1 |
| Modulation |  | `1.3.6.1.4.1.32473.8.1.3.0` | single value | text |
| Temperature | °C | `1.3.6.1.4.1.32473.8.1.4.0` | single value |  |
| Traffic in | B | `1.3.6.1.2.1.31.1.1.1.6` | table, one value each, names `1.3.6.1.2.1.31.1.1.1.1` | counter |
| Port status |  | `1.3.6.1.2.1.2.2.1.8` | table, one value each, names `1.3.6.1.2.1.31.1.1.1.1` | 1=Up, 2=Down |

## SIM Air conditioner  (UDP port 16115)



| Reading | Unit | OID | How | Notes |
|---|---|---|---|---|
| Supply air | °C | `1.3.6.1.4.1.32473.5.2.1.0` | single value | × 0.1 |
| Return air | °C | `1.3.6.1.4.1.32473.5.2.2.0` | single value | × 0.1; alarm > 28 |
| Set point | °C | `1.3.6.1.4.1.32473.5.2.3.0` | single value | × 0.1 |
| Compressor |  | `1.3.6.1.4.1.32473.5.2.4.0` | single value | 0=Off, 1=Running |
| Fan speed | % | `1.3.6.1.4.1.32473.5.2.5.0` | single value |  |

## SIM Storage NAS  (UDP port 16116)



| Reading | Unit | OID | How | Notes |
|---|---|---|---|---|
| Disk temperature | °C | `1.3.6.1.4.1.32473.1.6.1.1.3` | table, one value each, names `1.3.6.1.4.1.32473.1.6.1.1.2` |  |
| Disk status |  | `1.3.6.1.4.1.32473.1.6.1.1.4` | table, one value each, names `1.3.6.1.4.1.32473.1.6.1.1.2` | 1=Normal, 3=Failing |
| CPU load | % | `1.3.6.1.2.1.25.3.3.1.2` | table, avg |  |

## SIM Wi-Fi controller  (UDP port 16117)



| Reading | Unit | OID | How | Notes |
|---|---|---|---|---|
| Access points online |  | `1.3.6.1.4.1.32473.8.2.1.0` | single value | alarm < 115 |
| Access points total |  | `1.3.6.1.4.1.32473.8.2.2.0` | single value |  |
| Wireless clients |  | `1.3.6.1.4.1.32473.8.2.3.0` | single value |  |
| Traffic in | B | `1.3.6.1.2.1.31.1.1.1.6` | table, one value each, names `1.3.6.1.2.1.31.1.1.1.1` | counter |
| Port status |  | `1.3.6.1.2.1.2.2.1.8` | table, one value each, names `1.3.6.1.2.1.31.1.1.1.1` | 1=Up, 2=Down |

## SIM Legacy SNMPv1 device  (UDP port 16118)

*answers SNMPv1 only (set the version to v1)*

| Reading | Unit | OID | How | Notes |
|---|---|---|---|---|
| Supply voltage | V | `1.3.6.1.4.1.32473.9.1.1.0` | single value |  |
| Alarm input |  | `1.3.6.1.4.1.32473.9.1.2.0` | single value | 0=Normal, 1=Alarm |

## SIM Vendor-only controller  (UDP port 16119)

*shows no standard values (no uptime, no system name), like some power controllers*

| Reading | Unit | OID | How | Notes |
|---|---|---|---|---|
| Bus voltage | V | `1.3.6.1.4.1.32473.9.2.1.0` | single value | × 0.1 |
| Cabinet temperature | °C | `1.3.6.1.4.1.32473.9.2.2.0` | single value |  |

## SIM Flaky remote site  (UDP port 16120)

*answers slowly (about 350 ms) and loses about 15 % of requests*

| Reading | Unit | OID | How | Notes |
|---|---|---|---|---|
| CPU load | % | `1.3.6.1.4.1.32473.9.3.1.0` | single value |  |
| Traffic in | B | `1.3.6.1.2.1.31.1.1.1.6` | table, one value each, names `1.3.6.1.2.1.31.1.1.1.1` | counter |
| Port status |  | `1.3.6.1.2.1.2.2.1.8` | table, one value each, names `1.3.6.1.2.1.31.1.1.1.1` | 1=Up, 2=Down |
