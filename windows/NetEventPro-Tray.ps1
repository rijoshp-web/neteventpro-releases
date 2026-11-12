# NetEventPro tray helper: shows service status, opens the dashboard, starts/stops the service.
# Runs hidden in the user's session (started at logon by the installer). Windows PowerShell 5.1 compatible.
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# only one tray per user session
$script:mutex = New-Object System.Threading.Mutex($false, 'Local\NetEventProTray')
if (-not $script:mutex.WaitOne(0)) { exit }

$ServiceName = 'NetEventPro'
if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) -and (Get-Service -Name 'SyslogPro' -ErrorAction SilentlyContinue)) { $ServiceName = 'SyslogPro' }   # an installation not yet re-installed with the new setup program
$AppRoot     = Split-Path -Parent $PSScriptRoot
$SvcExe      = Join-Path $AppRoot 'service\NetEventProService.exe'
$DataDir     = Join-Path $env:ProgramData 'NetEventPro'
if (-not (Test-Path $DataDir) -and (Test-Path (Join-Path $env:ProgramData 'SyslogPro'))) { $DataDir = Join-Path $env:ProgramData 'SyslogPro' }

# The service writes the dashboard address to ui\web.json (readable by every user). config.json is private to
# administrators because it holds the email password and webhook addresses, so it is only a fallback for older installs.
function Get-WebInfo {
    foreach ($name in 'ui\web.json', 'config.json') {
        try {
            $j = Get-Content -Raw -Path (Join-Path $DataDir $name) | ConvertFrom-Json
            $port = 0
            if ($j.port) { $port = [int]$j.port } elseif ($j.webPort) { $port = [int]$j.webPort }
            if ($port -gt 0) { return @{ Scheme = $(if ($j.scheme -eq 'https') { 'https' } else { 'http' }); Port = $port } }
        } catch { }
    }
    return @{ Scheme = 'http'; Port = 8514 }
}
function Get-DashboardUrl { $w = Get-WebInfo; $h = if ($w.Scheme -eq 'http') { '127.0.0.1' } else { 'localhost' }; '{0}://{1}:{2}/' -f $w.Scheme, $h, $w.Port }

function New-TrayIcon([System.Drawing.Color]$accent) {
    $bmp = New-Object System.Drawing.Bitmap 32, 32
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Transparent)
    $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 16, 23, 34))
    $g.FillRectangle($bg, 1, 1, 30, 30)
    $pen = New-Object System.Drawing.Pen $accent, 4
    $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
    $g.DrawLine($pen, 7, 10, 25, 10)
    $g.DrawLine($pen, 7, 16, 19, 16)
    $g.DrawLine($pen, 7, 22, 14, 22)
    $g.Dispose()
    return [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}
$IconOk   = New-TrayIcon ([System.Drawing.Color]::FromArgb(255, 69, 194, 165))
$IconDown = New-TrayIcon ([System.Drawing.Color]::FromArgb(255, 238, 77, 91))

function Invoke-Service([string]$verb) {
    # service control needs administrator rights -> ask Windows for elevation (UAC prompt)
    Start-Process -FilePath $SvcExe -ArgumentList $verb -Verb RunAs -WindowStyle Hidden
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = $IconDown
$notify.Text = 'NetEventPro'
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miOpen = $menu.Items.Add('Open dashboard')
$miOpen.Font = New-Object System.Drawing.Font($miOpen.Font, [System.Drawing.FontStyle]::Bold)
$miData = $menu.Items.Add('Open data folder')
[void]$menu.Items.Add('-')
$miStart   = $menu.Items.Add('Start service')
$miStop    = $menu.Items.Add('Stop service')
$miRestart = $menu.Items.Add('Restart service')
[void]$menu.Items.Add('-')
$miExit = $menu.Items.Add('Close tray icon')
$notify.ContextMenuStrip = $menu

$miOpen.Add_Click({ Start-Process (Get-DashboardUrl) })
$notify.Add_DoubleClick({ Start-Process (Get-DashboardUrl) })
$miData.Add_Click({ if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir | Out-Null }; Start-Process explorer.exe $DataDir })
$miStart.Add_Click({ Invoke-Service 'start' })
$miStop.Add_Click({ Invoke-Service 'stop' })
$miRestart.Add_Click({ Invoke-Service 'restart' })
$miExit.Add_Click({ $timer.Stop(); $notify.Visible = $false; $notify.Dispose(); [System.Windows.Forms.Application]::Exit() })

$script:lastRunning = $null
function Update-Status {
    # uninstalled? then leave quietly
    if (-not (Test-Path $SvcExe)) { $notify.Visible = $false; [System.Windows.Forms.Application]::Exit(); return }
    $svc = Get-Service -Name $ServiceName
    $running = ($svc -and $svc.Status -eq 'Running')
    $miStart.Enabled   = -not $running
    $miStop.Enabled    = $running
    $miRestart.Enabled = $running
    if ($running) {
        $text = 'NetEventPro - running'
        try {
            $w = Get-WebInfo
            if ($w.Scheme -eq 'http') {   # with a dashboard password or HTTPS this call is refused: the icon then just says "running"
                $s = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/api/stats" -f $w.Port) -TimeoutSec 2
                $text = 'NetEventPro - {0} msg/s, {1} devices' -f $s.eps, $s.devices
            }
        } catch { }
        $notify.Icon = $IconOk
    } else {
        $text = 'NetEventPro - service stopped'
        $notify.Icon = $IconDown
    }
    if ($text.Length -gt 63) { $text = $text.Substring(0, 63) }
    $notify.Text = $text
    if ($script:lastRunning -eq $true -and -not $running) {
        $notify.ShowBalloonTip(5000, 'NetEventPro', 'The service has stopped. Syslog messages and SNMP traps are not being received.', 'Warning')
    }
    $script:lastRunning = $running
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({ Update-Status })
$timer.Start()
Update-Status

[System.Windows.Forms.Application]::Run((New-Object System.Windows.Forms.ApplicationContext))
$script:mutex.ReleaseMutex()
