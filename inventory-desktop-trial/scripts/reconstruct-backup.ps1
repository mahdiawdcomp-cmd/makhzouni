<#
  makhzouni — Reconstruct a full state from the EXPERIMENTAL chain (read-only)
  ---------------------------------------------------------------------------
  Takes the latest FULL + all incrementals based on it, rehydrates images from
  image-store, applies upserts/deletes in order, and writes a single
  reconstructed.json equivalent to a live full backup.

  Read-only on backups. Output goes to backups-incremental\reconstructed.json.

  Usage: npm run backup:incremental:reconstruct
#>

[CmdletBinding()]
param(
  [string]$AppDataDir = (Join-Path $env:APPDATA 'com.mazbwoni.mahdi'),
  [string]$OutFile = $null
)

$ErrorActionPreference = 'Stop'
$BackupDir  = Join-Path $AppDataDir 'backups-incremental'
$ImageStore = Join-Path $BackupDir 'image-store'
if (-not $OutFile) { $OutFile = Join-Path $BackupDir 'reconstructed.json' }

# Tables to reconstruct, keyed by 'id'.
$Tables = @('users','products','customers','invoices','vouchers','quotations',
            'branches','coupons','messageTemplates','settings','stockMovements',
            'transfers','auditLogs')
$ImageFields = @('imageUrl','thumbnailUrl')

Add-Type -AssemblyName System.IO.Compression.FileSystem
function Die([string]$m) { Write-Host "RECONSTRUCT FAIL: $m" -ForegroundColor Red; exit 1 }

function Read-Zip([string]$path) {
  $a = [System.IO.Compression.ZipFile]::OpenRead($path)
  try {
    $me = $a.GetEntry('manifest.json'); $r = New-Object System.IO.StreamReader($me.Open())
    try { $mraw = $r.ReadToEnd() } finally { $r.Dispose() }
    $de = $a.GetEntry('data.json'); $r2 = New-Object System.IO.StreamReader($de.Open())
    try { $draw = $r2.ReadToEnd() } finally { $r2.Dispose() }
  } finally { $a.Dispose() }
  return [PSCustomObject]@{ Manifest = ($mraw | ConvertFrom-Json); Data = ($draw | ConvertFrom-Json) }
}

# Rehydrate { '$img': hash } back into the original base64 string.
function Restore-Images([object]$Data) {
  foreach ($prop in $Data.PSObject.Properties) {
    $val = $prop.Value
    if ($val -isnot [System.Collections.IEnumerable] -or $val -is [string]) { continue }
    foreach ($rec in $val) {
      if ($rec -isnot [System.Management.Automation.PSCustomObject]) { continue }
      foreach ($field in $ImageFields) {
        $p = $rec.PSObject.Properties[$field]
        if ($null -eq $p) { continue }
        $v = $p.Value
        if ($v -is [System.Management.Automation.PSCustomObject] -and $v.PSObject.Properties['$img']) {
          $h = $v.'$img'
          $sp = Join-Path $ImageStore "$h.b64"
          if (-not (Test-Path $sp)) { Die "image $h missing from image-store" }
          $p.Value = [System.IO.File]::ReadAllText($sp, [System.Text.Encoding]::UTF8)
        }
      }
    }
  }
}

if (-not (Test-Path $BackupDir)) { Die "Backup folder not found" }
$zips = Get-ChildItem $BackupDir -Filter 'makhzouni-inc-*.zip' -File | Sort-Object Name
if (-not $zips) { Die "No backups found" }

# Latest FULL
$loaded = $zips | ForEach-Object { $z = $_; $o = Read-Zip $z.FullName; [PSCustomObject]@{ Name=$z.Name; M=$o.Manifest; D=$o.Data } }
$latestFull = $loaded | Where-Object { $_.M.type -eq 'full' } | Sort-Object Name -Descending | Select-Object -First 1
if (-not $latestFull) { Die "No full backup to base on" }
Write-Host "Base full: $($latestFull.Name)" -ForegroundColor Cyan

# incrementals for this full, in order
$chain = $loaded | Where-Object { $_.M.type -eq 'incremental' -and $_.M.baseId -eq $latestFull.M.id } | Sort-Object Name
Write-Host "Applying $($chain.Count) incremental(s)" -ForegroundColor Cyan

# Seed maps from full (rehydrate images first)
Restore-Images $latestFull.D
$maps = @{}
foreach ($t in $Tables) {
  $maps[$t] = [ordered]@{}
  if ($null -ne $latestFull.D.$t) {
    foreach ($rec in $latestFull.D.$t) {
      if ($rec.PSObject.Properties['id']) { $maps[$t][[string]$rec.id] = $rec }
    }
  }
}

# Apply each incremental: upsert by id, then delete ids
foreach ($inc in $chain) {
  Restore-Images $inc.D
  foreach ($t in $Tables) {
    if ($null -ne $inc.D.$t) {
      foreach ($rec in $inc.D.$t) {
        if ($rec.PSObject.Properties['id']) { $maps[$t][[string]$rec.id] = $rec }
      }
    }
  }
  if ($inc.M.deletedIds) {
    foreach ($dp in $inc.M.deletedIds.PSObject.Properties) {
      $tname = $dp.Name
      if ($maps.ContainsKey($tname)) {
        foreach ($delId in $dp.Value) { $maps[$tname].Remove([string]$delId) | Out-Null }
      }
    }
  }
}

# Emit reconstructed object
$out = [ordered]@{
  reconstructedAt = (Get-Date).ToString('o')
  baseFull = $latestFull.M.id
  incrementalsApplied = $chain.Count
  counts = [ordered]@{}
}
foreach ($t in $Tables) {
  $arr = @($maps[$t].Values)
  $out[$t] = $arr
  $out.counts[$t] = $arr.Count
}
($out | ConvertTo-Json -Depth 30) | Set-Content -Path $OutFile -Encoding UTF8
Write-Host "Reconstructed -> $OutFile" -ForegroundColor Green
$out.counts.GetEnumerator() | ForEach-Object { Write-Host ("  {0}: {1}" -f $_.Key, $_.Value) }
exit 0
