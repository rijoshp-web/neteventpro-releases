<#
 Alarm test generator for NetEventPro (PowerShell, no Node needed).
 Prepare once: Rules & alerts -> "Add from template": link down/up, mains failure/restored,
 routing neighbour down/up, communication lost/restored -> Save rules.
 Run:  powershell -ExecutionPolicy Bypass -File .\Send-AlarmTest.ps1 -Target 127.0.0.1 -Port 514 -DelaySec 6
       add  -Scenario 1,2   to run only some scenarios (default: all)
#>
param(
  [string]$Target = '127.0.0.1',
  [int]$Port = 514,
  [int]$DelaySec = 6,
  [int[]]$Scenario = @(1,2,3,4,5,6,7)
)
$ErrorActionPreference = 'Stop'
$udp = New-Object System.Net.Sockets.UdpClient
$inv = [System.Globalization.CultureInfo]::InvariantCulture

function Msg([int]$sev, [string]$hostName, [string]$text) {
  $d = Get-Date
  $stamp = $d.ToString('MMM', $inv) + ' ' + $d.Day.ToString().PadLeft(2) + ' ' + $d.ToString('HH:mm:ss', $inv)
  return ('<{0}>{1} {2} {3}' -f (23*8+$sev), $stamp, $hostName, $text)
}
function Link([string]$h, [string]$ifn, [string]$state) {
  $sev = if ($state -eq 'down') { 3 } else { 5 }
  return Msg $sev $h ("%LINK-3-UPDOWN: Interface $ifn, changed state to $state")
}
function Step([string]$expect, [string]$m) {
  $b = [Text.Encoding]::ASCII.GetBytes($m)
  [void]$udp.Send($b, $b.Length, $Target, $Port)
  Write-Host "  sent  : $m"
  Write-Host "  expect: $expect" -ForegroundColor Cyan
  Start-Sleep -Seconds $DelaySec
}
function Title([int]$n, [string]$t) { Write-Host "`n=== Scenario ${n}: $t" -ForegroundColor Yellow }

Write-Host "Sending to ${Target}:${Port} over UDP, $DelaySec s between messages. Keep the Alarms page open."

if ($Scenario -contains 1) {
  Title 1 'Link down x3 then link up, same device -> ONE alarm (count 3), then auto-cleared'
  Step 'Alarm "Link down (alarm)" on SW-TEST-01 appears (Open, count 1)' (Link 'SW-TEST-01' 'GigabitEthernet0/1' 'down')
  Step 'Count goes to 2' (Link 'SW-TEST-01' 'GigabitEthernet0/1' 'down')
  Step 'Count goes to 3 (still one line)' (Link 'SW-TEST-01' 'GigabitEthernet0/1' 'down')
  Step 'Alarm CLEARED automatically' (Link 'SW-TEST-01' 'GigabitEthernet0/1' 'up')
}
if ($Scenario -contains 2) {
  Title 2 'Eltek mains failure then restored -> raised, then auto-cleared'
  Step 'Alarm "Mains failure (alarm)" on ELTEK-RECT-01' (Msg 2 'ELTEK-RECT-01' 'SmartPack: Mains failure')
  Step 'Alarm cleared automatically' (Msg 5 'ELTEK-RECT-01' 'SmartPack: Mains OK')
}
if ($Scenario -contains 3) {
  Title 3 'OSPF neighbour down then up -> raised, then auto-cleared'
  Step 'Alarm "Routing neighbour down (alarm)" on RTR-TEST-01' (Msg 5 'RTR-TEST-01' '%OSPF-5-ADJCHG: Process 1, Nbr 10.1.1.2 on GigabitEthernet0/0 from FULL to DOWN, Neighbor Down: Dead timer expired')
  Step 'Alarm cleared automatically' (Msg 5 'RTR-TEST-01' '%OSPF-5-ADJCHG: Process 1, Nbr 10.1.1.2 on GigabitEthernet0/0 from LOADING to FULL, Loading Done')
}
if ($Scenario -contains 4) {
  Title 4 'APC UPS communication lost then restored -> raised, then auto-cleared'
  Step 'Alarm "Communication lost (alarm)" on APC-UPS-01' (Msg 4 'APC-UPS-01' 'apc: Communication lost with the UPS')
  Step 'Alarm cleared automatically' (Msg 5 'APC-UPS-01' 'apc: Communication established with the UPS')
}
if ($Scenario -contains 5) {
  Title 5 'Recovery from a DIFFERENT device -> alarm must STAY open'
  Step 'Alarm on SW-TEST-02 appears' (Link 'SW-TEST-02' 'GigabitEthernet0/5' 'down')
  Step 'SW-TEST-02 alarm is NOT cleared (the up came from SW-TEST-03)' (Link 'SW-TEST-03' 'GigabitEthernet0/5' 'up')
}
if ($Scenario -contains 6) {
  Title 6 'KNOWN LIMIT: two ports down, one comes back -> alarm clears although Gi0/2 is still down'
  Step 'One alarm on SW-TEST-04 (Gi0/1)' (Link 'SW-TEST-04' 'GigabitEthernet0/1' 'down')
  Step 'Same alarm, count 2 (Gi0/2 also down)' (Link 'SW-TEST-04' 'GigabitEthernet0/2' 'down')
  Step 'Alarm clears (alarms are per rule and device, not per port)' (Link 'SW-TEST-04' 'GigabitEthernet0/1' 'up')
}
if ($Scenario -contains 7) {
  Title 7 'Problem that never recovers -> stays Open (test Acknowledge, notes, manual Clear, escalation)'
  Step 'Alarm on SW-OPEN-01 stays Open until you act' (Link 'SW-OPEN-01' 'GigabitEthernet0/9' 'down')
}
$udp.Close()
Write-Host "`nDone. Alarms still Open after a full run: SW-TEST-02 and SW-OPEN-01." -ForegroundColor Green
