<#
.SYNOPSIS
  Builds the NetEventPro Windows installer (dist\NetEventPro-Setup-<version>.exe).

.DESCRIPTION
  1. Downloads the official Node.js 22 LTS Windows binary (checksum verified) and the WinSW service wrapper
  2. Stages the app, node.exe, service wrapper and tray scripts into build\stage
  3. Compiles installer\NetEventPro.iss with Inno Setup (ISCC.exe)

  Requirements on the build PC: Windows 10/11, PowerShell 5.1+, internet access, Inno Setup 6.3+
  (install once with:  winget install JRSoftware.InnoSetup ). Node.js is NOT needed to build.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\build.ps1
#>
param(
  [string]$NodeMajor = '22',
  [string]$NodeMin = '22.23.5',   # 1.99.10 the oldest Node.js the installer may contain (the November 2026 security release); the build stops if nodejs.org offers an older one
  [string]$WinSWVersion = 'v2.12.0',
  [string]$WinSWSha256 = '',   # optional: pin the service wrapper download to this SHA-256 (see the value printed by a first build)
  [string]$IsccPath = '',
  # 1.98.1 code signing (optional). A .pfx code-signing certificate and its password; on GitHub Actions they come from the
  # secrets NEP_SIGN_PFX (the .pfx as base64) and NEP_SIGN_PASSWORD. Without a certificate the installer is built unsigned.
  [string]$CertPath = '',
  [string]$CertPassword = '',
  # or a certificate on a USB token / in the Windows certificate store (most code-signing certificates since 2023): its thumbprint
  [string]$CertThumbprint = '',
  [string]$TimestampUrl = 'http://timestamp.digicert.com'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root   = $PSScriptRoot
$Build  = Join-Path $Root 'build'
$Stage  = Join-Path $Build 'stage'
$Cache  = Join-Path $Build 'cache'
$Dist   = Join-Path $Root 'dist'
$Version = (Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version

Write-Host "== NetEventPro $Version installer build ==" -ForegroundColor Cyan

# ---- locate Inno Setup first so we fail fast -----------------------------------------------
if (-not $IsccPath) {
  $candidates = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
  )
  $IsccPath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $IsccPath) { $cmd = Get-Command ISCC.exe -ErrorAction SilentlyContinue; if ($cmd) { $IsccPath = $cmd.Source } }
}
if (-not $IsccPath) {
  throw "Inno Setup 6 was not found. Install it with:  winget install JRSoftware.InnoSetup   (or from https://jrsoftware.org/isdl.php) and run this script again."
}
Write-Host "Inno Setup: $IsccPath"

New-Item -ItemType Directory -Force -Path $Cache | Out-Null
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force -Path $Stage, $Dist | Out-Null

function Get-File([string]$url, [string]$out) {
  if (Test-Path $out) { Write-Host "  cached: $(Split-Path $out -Leaf)"; return }
  Write-Host "  downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
}

# ---- Node.js (latest LTS in the chosen major line) -------------------------------------------
Write-Host "[1/4] Node.js $NodeMajor.x" -ForegroundColor Cyan
$index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'
$rel = $index | Where-Object { $_.version -like "v$NodeMajor.*" -and $_.lts } | Select-Object -First 1
if (-not $rel) { $rel = $index | Where-Object { $_.version -like "v$NodeMajor.*" } | Select-Object -First 1 }
if (-not $rel) { throw "No Node.js $NodeMajor release found on nodejs.org" }
$nodeVer = $rel.version
if ([version]($nodeVer.TrimStart('v')) -lt [version]$NodeMin) { throw "Node.js $nodeVer is older than the required $NodeMin (security fixes). Try again later or set -NodeMin." }
Write-Host "  Node.js $nodeVer (at least $NodeMin)"
$zipName = "node-$nodeVer-win-x64.zip"
$zipPath = Join-Path $Cache $zipName
Get-File "https://nodejs.org/dist/$nodeVer/$zipName" $zipPath
$sums = (Invoke-WebRequest -Uri "https://nodejs.org/dist/$nodeVer/SHASUMS256.txt" -UseBasicParsing).Content
$expected = ($sums -split "`n" | Where-Object { $_ -match [regex]::Escape($zipName) } | Select-Object -First 1).Split(' ')[0].Trim()
$actual = (Get-FileHash -Algorithm SHA256 $zipPath).Hash.ToLower()
if ($expected -ne $actual) { Remove-Item $zipPath; throw "Checksum mismatch for $zipName (expected $expected, got $actual)" }
Write-Host "  checksum OK ($nodeVer)"
$tmp = Join-Path $Cache "node-extract"
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
Expand-Archive -Path $zipPath -DestinationPath $tmp -Force
$nodeDir = Join-Path $Stage 'node'
New-Item -ItemType Directory -Force -Path $nodeDir | Out-Null
$inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
Copy-Item (Join-Path $inner.FullName 'node.exe') $nodeDir
Copy-Item (Join-Path $inner.FullName 'LICENSE') (Join-Path $nodeDir 'LICENSE-node.txt') -ErrorAction SilentlyContinue

# ---- WinSW service wrapper ----------------------------------------------------------------------
Write-Host "[2/4] WinSW $WinSWVersion" -ForegroundColor Cyan
$svcDir = Join-Path $Stage 'service'
New-Item -ItemType Directory -Force -Path $svcDir | Out-Null
$winsw = Join-Path $Cache "WinSW-$WinSWVersion-x64.exe"
Get-File "https://github.com/winsw/winsw/releases/download/$WinSWVersion/WinSW-x64.exe" $winsw
$winswHash = (Get-FileHash -Algorithm SHA256 $winsw).Hash.ToLower()
Write-Host "  WinSW SHA-256: $winswHash"
if ($WinSWSha256) {
  if ($winswHash -ne $WinSWSha256.ToLower()) { Remove-Item $winsw; throw "WinSW checksum mismatch (expected $WinSWSha256). The download was removed." }
  Write-Host "  checksum OK"
} else {
  Write-Host "  (not pinned: compare this value with the one on the WinSW release page, then pass it with -WinSWSha256 next time)" -ForegroundColor Yellow
}
Copy-Item $winsw (Join-Path $svcDir 'NetEventProService.exe')
Copy-Item (Join-Path $Root 'windows\NetEventProService.xml') $svcDir

# ---- application files ---------------------------------------------------------------------------
Write-Host "[3/4] Staging application" -ForegroundColor Cyan
$appDir = Join-Path $Stage 'app'
New-Item -ItemType Directory -Force -Path $appDir | Out-Null
Copy-Item (Join-Path $Root 'src') $appDir -Recurse
Copy-Item (Join-Path $Root 'public') $appDir -Recurse
Copy-Item (Join-Path $Root 'starter-mibs') $appDir -Recurse
Copy-Item (Join-Path $Root 'package.json') $appDir
$trayDir = Join-Path $Stage 'tray'
New-Item -ItemType Directory -Force -Path $trayDir | Out-Null
'NetEventPro-Tray.ps1', 'launch-tray.vbs', 'open-dashboard.vbs' | ForEach-Object { Copy-Item (Join-Path $Root "windows\$_") $trayDir }
$assets = Join-Path $Stage 'assets'
New-Item -ItemType Directory -Force -Path $assets | Out-Null
Copy-Item (Join-Path $Root 'assets\neteventpro.ico') $assets
Copy-Item (Join-Path $Root 'README.md') $Stage -ErrorAction SilentlyContinue

# ---- compile installer --------------------------------------------------------------------------------
Write-Host "[4/4] Compiling installer" -ForegroundColor Cyan
if (-not $CertPath -and $env:NEP_SIGN_PFX) { $CertPath = Join-Path $Build 'sign.pfx'; [IO.File]::WriteAllBytes($CertPath, [Convert]::FromBase64String($env:NEP_SIGN_PFX)) }
if (-not $CertPassword -and $env:NEP_SIGN_PASSWORD) { $CertPassword = $env:NEP_SIGN_PASSWORD }
$signArgs = @()
if ($CertPath -or $CertThumbprint) {
  $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $signtool) { throw 'signtool.exe not found: install the Windows SDK (winget install Microsoft.WindowsSDK.10.0.22621) or build without -CertPath.' }
  Write-Host "      signing with $($signtool.FullName)" -ForegroundColor DarkGray
  # the service wrapper inside the installer is signed too, so Windows trusts every program NetEventPro starts
  $which = if ($CertThumbprint) { @('/sha1', $CertThumbprint) } else { @('/f', $CertPath, '/p', $CertPassword) }
  & $signtool.FullName sign /fd sha256 /tr $TimestampUrl /td sha256 @which (Join-Path $Stage 'service\NetEventProService.exe')
  if ($LASTEXITCODE -ne 0) { throw "signing the service wrapper failed ($LASTEXITCODE)" }
  $whichText = if ($CertThumbprint) { "/sha1 $CertThumbprint" } else { "/f `"$CertPath`" /p `"$CertPassword`"" }
  $signArgs = @("/Snep=`"$($signtool.FullName)`" sign /fd sha256 /tr $TimestampUrl /td sha256 $whichText `$f", '/DSign')
}
& $IsccPath "/DAppVersion=$Version" "/DStageDir=$Stage" @signArgs (Join-Path $Root 'installer\NetEventPro.iss')
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed with exit code $LASTEXITCODE" }

$out = Join-Path $Dist "NetEventPro-Setup-$Version.exe"
$mb = [math]::Round((Get-Item $out).Length / 1MB, 1)
if ($CertPath -or $CertThumbprint) {
  & $signtool.FullName verify /pa /q $out
  if ($LASTEXITCODE -ne 0) { throw 'The installer signature does not verify.' }
  Write-Host "      signature verified" -ForegroundColor Green
  if ($env:NEP_SIGN_PFX) { Remove-Item (Join-Path $Build 'sign.pfx') -Force -ErrorAction SilentlyContinue }
}
Write-Host ""
Write-Host "Done: $out ($mb MB)" -ForegroundColor Green
