# NetEventPro: SQL Server copy worker. Reads one JSON request on stdin, writes one JSON line on stdout.
# Needs Windows PowerShell 5.1 (System.Data.SqlClient is part of Windows). Nothing to install.
$ErrorActionPreference = 'Stop'
function Say($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 5)); [Console]::Out.Flush() }
function Connect($c, $db) {
  Add-Type -AssemblyName System.Data
  $b = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
  $b['Data Source'] = [string]$c['server']
  $b['Initial Catalog'] = $db
  if ($c['auth'] -eq 'sql') { $b['User ID'] = [string]$c['user']; $b['Password'] = [string]$c['password'] } else { $b['Integrated Security'] = $true }
  $b['Encrypt'] = [bool]$c['encrypt']
  $b['TrustServerCertificate'] = [bool]$c['trust']
  $b['Connect Timeout'] = 15
  $b['Application Name'] = 'NetEventPro'
  $cn = New-Object System.Data.SqlClient.SqlConnection($b.ConnectionString)
  $cn.Open()
  return $cn
}
function Exec($cn, $sql, $timeout) {
  $cmd = $cn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = $timeout
  [void]$cmd.ExecuteNonQuery()
}
function Row($cn, $sql) {
  $cmd = $cn.CreateCommand(); $cmd.CommandText = $sql; $cmd.CommandTimeout = 30
  $r = $cmd.ExecuteReader(); $o = @{}
  if ($r.Read()) { for ($i = 0; $i -lt $r.FieldCount; $i++) { $v = $r.GetValue($i); if ($v -is [DBNull]) { $v = $null }; $o[$r.GetName($i)] = $v } }
  $r.Close(); return $o
}
function Ensure-Db($c, $name) {
  $master = Connect $c 'master'
  try {
    $q = $master.CreateCommand(); $q.CommandText = 'IF DB_ID(@n) IS NULL BEGIN DECLARE @s nvarchar(400) = N''CREATE DATABASE '' + QUOTENAME(@n); EXEC(@s) END'
    [void]$q.Parameters.AddWithValue('@n', $name); $q.CommandTimeout = 120; [void]$q.ExecuteNonQuery()
  } finally { $master.Close() }
}
try {
  Add-Type -AssemblyName System.Web.Extensions
  $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer; $ser.MaxJsonLength = [int]::MaxValue; $ser.RecursionLimit = 20
  $p = $ser.DeserializeObject([Console]::In.ReadToEnd())
  $c = $p['conn']; $db = [string]$c['database']
  if ($p['op'] -eq 'probe') {
    $cn = $null; $exists = $true
    try { $cn = Connect $c $db } catch {
      if ($_.Exception.Message -match 'Cannot open database') { $exists = $false; $cn = Connect $c 'master' } else { throw }
    }
    try {
      $row = Row $cn "SELECT @@VERSION AS version, SUSER_SNAME() AS who, ISNULL(IS_SRVROLEMEMBER('dbcreator'),0) AS dbcreator, ISNULL(IS_SRVROLEMEMBER('sysadmin'),0) AS sysadmin"
      $row['dbExists'] = $exists
      Say @{ ok = $true; row = $row }
    } finally { $cn.Close() }
    exit 0
  }
  if ($p['createDb']) { Ensure-Db $c $db }
  $cn = Connect $c $db
  try {
    foreach ($s in $p['before']) { Exec $cn ([string]$s) 120 }
    $n = 0
    $bulk = $p['bulk']
    if ($bulk -ne $null) {
      $dt = New-Object System.Data.DataTable
      foreach ($col in $bulk['cols']) {
        $t = switch ($col['t']) { 'bigint' { [int64] } 'int' { [int32] } 'datetime' { [datetime] } 'float' { [double] } default { [string] } }
        [void]$dt.Columns.Add([string]$col['n'], $t)
      }
      $inv = [System.Globalization.CultureInfo]::InvariantCulture
      $styles = [System.Globalization.DateTimeStyles]::AssumeUniversal -bor [System.Globalization.DateTimeStyles]::AdjustToUniversal
      $types = @($bulk['cols'] | ForEach-Object { $_['t'] })
      foreach ($r in $bulk['rows']) {
        $row = $dt.NewRow()
        for ($i = 0; $i -lt $types.Count; $i++) {
          $v = $r[$i]
          if ($v -eq $null) { $row[$i] = [DBNull]::Value }
          elseif ($types[$i] -eq 'datetime') { $row[$i] = [datetime]::Parse([string]$v, $inv, $styles) }
          elseif ($types[$i] -eq 'bigint') { $row[$i] = [int64]$v }
          elseif ($types[$i] -eq 'int') { $row[$i] = [int32]$v }
          elseif ($types[$i] -eq 'float') { $row[$i] = [double]$v }
          else { $row[$i] = [string]$v }
        }
        $dt.Rows.Add($row)
      }
      $bc = New-Object System.Data.SqlClient.SqlBulkCopy($cn)
      $bc.DestinationTableName = '#stg'; $bc.BulkCopyTimeout = 120; $bc.BatchSize = 5000
      foreach ($col in $dt.Columns) { [void]$bc.ColumnMappings.Add($col.ColumnName, $col.ColumnName) }
      $bc.WriteToServer($dt); $bc.Close(); $n = $dt.Rows.Count
    }
    foreach ($s in $p['after']) { Exec $cn ([string]$s) 120 }
    $out = @{ ok = $true; rows = $n }
    if ($p['query']) { $out['row'] = Row $cn ([string]$p['query']) }
    Say $out
  } finally { $cn.Close() }
} catch {
  $m = $_.Exception.Message; if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
  Say @{ ok = $false; error = $m }
}
