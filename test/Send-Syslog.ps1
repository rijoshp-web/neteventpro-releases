<#
.SYNOPSIS
  Syslog test generator. Every second it sends one UDP and one TCP syslog message
  with a random facility and severity, until you press Ctrl+C.

.EXAMPLE
  .\Send-Syslog.ps1
  .\Send-Syslog.ps1 -Target 192.168.1.50 -UdpPort 514 -TcpPort 514
  .\Send-Syslog.ps1 -IntervalSeconds 2
#>
param(
    [string]$Target = '127.0.0.1',
    [int]$UdpPort = 514,
    [int]$TcpPort = 514,
    [double]$IntervalSeconds = 1
)

$hosts = 'core-sw1', 'core-sw2', 'edge-fw1', 'ups-rack3', 'srv-dc01', 'srv-app02', 'wlc-01', 'router-hq'
$apps  = 'sshd', 'kernel', 'ospfd', 'snmpd', 'nginx', 'cron', 'dhcpd', 'vpnd'

# sample text per severity (0 = emergency ... 7 = debug)
$texts = @{
    0 = 'System is unusable: kernel panic, rebooting'
    1 = 'Immediate action needed: power supply failure on module 2'
    2 = 'Critical: temperature above threshold on slot 1'
    3 = 'Error: interface GigabitEthernet0/{0} changed state to down'
    4 = 'Warning: CPU usage at {0}% for 5 minutes'
    5 = 'Notice: configuration changed by admin from console'
    6 = 'Info: user admin logged in from 10.0.0.{0}'
    7 = 'Debug: keepalive received from neighbor 10.1.1.{0}'
}
$sevNames = 'emergency', 'alert', 'critical', 'error', 'warning', 'notice', 'info', 'debug'

$rand   = New-Object System.Random
$udp    = New-Object System.Net.Sockets.UdpClient
$tcp    = $null
$stream = $null
$sent   = 0

function Connect-Tcp {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $c.Connect($Target, $TcpPort)
        $script:tcp = $c
        $script:stream = $c.GetStream()
        Write-Host "TCP connected to ${Target}:${TcpPort}" -ForegroundColor DarkGray
    } catch {
        $script:tcp = $null
        $script:stream = $null
        Write-Host "TCP connect to ${Target}:${TcpPort} failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

function New-SyslogMessage([int]$facility, [int]$severity) {
    $pri  = $facility * 8 + $severity
    $ts   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
    $hostName = $hosts[$rand.Next($hosts.Count)]
    $app  = $apps[$rand.Next($apps.Count)]
    $pid_ = $rand.Next(100, 99999)
    $text = [string]::Format($texts[$severity], $rand.Next(1, 100))
    # RFC 5424: <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID STRUCTURED-DATA MSG
    return "<$pri>1 $ts $hostName $app $pid_ - - $text"
}

Write-Host "Sending 1 UDP (port $UdpPort) and 1 TCP (port $TcpPort) message every $IntervalSeconds s to $Target. Press Ctrl+C to stop." -ForegroundColor Cyan
Connect-Tcp

try {
    while ($true) {
        foreach ($proto in 'UDP', 'TCP') {
            $facility = $rand.Next(0, 24)
            $severity = $rand.Next(0, 8)
            $msg = New-SyslogMessage $facility $severity

            try {
                if ($proto -eq 'UDP') {
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($msg)
                    [void]$udp.Send($bytes, $bytes.Length, $Target, $UdpPort)
                } else {
                    if (-not $stream) { Connect-Tcp }
                    if ($stream) {
                        $bytes = [System.Text.Encoding]::UTF8.GetBytes($msg + "`n")
                        $stream.Write($bytes, 0, $bytes.Length)
                        $stream.Flush()
                    } else { continue }
                }
                $sent++
                Write-Host ("{0:HH:mm:ss}  {1}  fac={2,-2} sev={3} ({4})  {5}" -f (Get-Date), $proto, $facility, $severity, $sevNames[$severity], $msg)
            } catch {
                Write-Host "$proto send failed: $($_.Exception.Message)" -ForegroundColor Yellow
                if ($proto -eq 'TCP') {
                    # connection dropped: close it so the next round reconnects
                    if ($tcp) { $tcp.Close() }
                    $tcp = $null; $stream = $null
                }
            }
        }
        Start-Sleep -Milliseconds ([int]($IntervalSeconds * 1000))
    }
}
finally {
    $udp.Close()
    if ($tcp) { $tcp.Close() }
    Write-Host "`nStopped. $sent messages sent." -ForegroundColor Cyan
}
