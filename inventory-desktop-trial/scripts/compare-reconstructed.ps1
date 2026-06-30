<#
  makhzouni — Compare reconstructed chain vs a LIVE full backup (proof)
  ---------------------------------------------------------------------------
  Downloads a fresh live full backup and diffs it against reconstructed.json
  (produced by reconstruct-backup.ps1). This proves the incremental chain
  assembles to the same state as a real full backup.

  Read-only (downloads live full to a temp file). Secret from env.

  Restore-critical tables are compared strictly (id-set + per-record).
  auditLogs is compared loosely (count only) because the live full caps it to
  the most recent 2000 while the chain accumulates more — not restore-critical.

  Usage: npm run backup:incremental:compare
#>

[CmdletBinding()]
param(
  [string]$ApiBase = 'https://api.mazbwoni.com/api/settings/backup',
  [string]$AppDataDir = (Join-Path $env:APPDATA 'com.mazbwoni.mahdi'),
  [int]$MaxDiffShown = 20
)

$ErrorActionPreference = 'Stop'
$BackupDir = Join-Path $AppDataDir 'backups-incremental'
$Reconstructed = Join-Path $BackupDir 'reconstructed.json'

$Strict = @('users','products','customers','invoices','vouchers','quotations',
            'branches','coupons','messageTemplates','settings','stockMovements','transfers')
$Loose  = @('auditLogs')

function Fail([string]$m) { Write-Host "FAIL: $m" -ForegroundColor Red; Write-Host "COMPARE: MISMATCH" -ForegroundColor Red; exit 1 }

if (-not (Test-Path $Reconstructed)) { Fail "reconstructed.json not found — run reconstruct first" }
$secret = $env:MAKHZOUNI_BACKUP_SECRET
if ([string]::IsNullOrWhiteSpace($secret)) { Fail "MAKHZOUNI_BACKUP_SECRET not set" }

# Download live full
$tmp = Join-Path $BackupDir '.live-full-compare.json'
Write-Host "Downloading live full for comparison..." -ForegroundColor Cyan
try {
  $wc = New-Object System.Net.WebClient
  $wc.Headers.Add('User-Agent','MakhzouniCompare/1.0')
  $wc.DownloadFile("$ApiBase/download?secret=$([uri]::EscapeDataString($secret))", $tmp)
} catch { Fail "Live download failed: $($_.Exception.Message)" }

function Load([string]$p) {
  $sr = New-Object System.IO.StreamReader($p, [System.Text.Encoding]::UTF8)
  try { $raw = $sr.ReadToEnd() } finally { $sr.Dispose() }
  return $raw | ConvertFrom-Json
}
$rec = Load $Reconstructed
$live = Load $tmp

# canonical per-record hash (sorted keys, recursive)
$sha = [System.Security.Cryptography.SHA256]::Create()
function Canon([object]$o) {
  if ($null -eq $o) { return 'null' }
  if ($o -is [System.Management.Automation.PSCustomObject]) {
    $parts = @()
    foreach ($p in ($o.PSObject.Properties | Sort-Object Name)) { $parts += '"' + $p.Name + '":' + (Canon $p.Value) }
    return '{' + ($parts -join ',') + '}'
  }
  if ($o -is [System.Collections.IEnumerable] -and $o -isnot [string]) {
    $parts = @(); foreach ($e in $o) { $parts += (Canon $e) }
    return '[' + ($parts -join ',') + ']'
  }
  return ([string]$o)
}
function RecHash([object]$o) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes((Canon $o))
  return ([System.BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-','')
}

$mismatch = $false
$shown = 0

foreach ($t in $Strict) {
  $rArr = @(); if ($null -ne $rec.$t) { $rArr = @($rec.$t) }
  $lArr = @(); if ($null -ne $live.$t) { $lArr = @($live.$t) }
  $rMap = @{}; foreach ($x in $rArr) { if ($x.PSObject.Properties['id']) { $rMap[[string]$x.id] = $x } }
  $lMap = @{}; foreach ($x in $lArr) { if ($x.PSObject.Properties['id']) { $lMap[[string]$x.id] = $x } }

  $onlyLive = $lMap.Keys | Where-Object { -not $rMap.ContainsKey($_) }
  $onlyRec  = $rMap.Keys | Where-Object { -not $lMap.ContainsKey($_) }
  $diffRec  = 0
  foreach ($k in $lMap.Keys) {
    if ($rMap.ContainsKey($k)) {
      if ((RecHash $lMap[$k]) -ne (RecHash $rMap[$k])) { $diffRec++ }
    }
  }

  if ($onlyLive.Count -or $onlyRec.Count -or $diffRec) {
    $mismatch = $true
    Write-Host ("[{0}] MISMATCH  live={1} rec={2}  missingInRec={3} extraInRec={4} differing={5}" -f `
      $t, $lArr.Count, $rArr.Count, $onlyLive.Count, $onlyRec.Count, $diffRec) -ForegroundColor Red
    foreach ($id in ($onlyLive | Select-Object -First 5)) { if ($shown -lt $MaxDiffShown) { Write-Host "    only-in-live id=$id"; $shown++ } }
    foreach ($id in ($onlyRec  | Select-Object -First 5)) { if ($shown -lt $MaxDiffShown) { Write-Host "    only-in-rec  id=$id"; $shown++ } }
  } else {
    Write-Host ("[{0}] MATCH  ({1} records)" -f $t, $lArr.Count) -ForegroundColor Green
  }
}

foreach ($t in $Loose) {
  $rN = if ($null -ne $rec.$t) { @($rec.$t).Count } else { 0 }
  $lN = if ($null -ne $live.$t) { @($live.$t).Count } else { 0 }
  Write-Host ("[{0}] LOOSE (count only)  live={1} rec={2}" -f $t, $lN, $rN) -ForegroundColor DarkGray
}

$sha.Dispose()
Remove-Item $tmp -Force -ErrorAction SilentlyContinue

# ── Lean-specific checks on the reconstructed auditLogs ─────────────────────
$recAudit = @(); if ($null -ne $rec.auditLogs) { $recAudit = @($rec.auditLogs) }
$liveAudit = @(); if ($null -ne $live.auditLogs) { $liveAudit = @($live.auditLogs) }

# (1) rows not lost: reconstructed must not have dropped audit rows vs live.
#     (a few extra in either side is normal drift; a big drop means damage.)
if ($recAudit.Count -lt ($liveAudit.Count * 0.5)) {
  Write-Host "[auditLogs] ROW LOSS: reconstructed=$($recAudit.Count) live=$($liveAudit.Count)" -ForegroundColor Red
  $mismatch = $true
} else {
  Write-Host "[auditLogs] rows preserved (reconstructed=$($recAudit.Count) live=$($liveAudit.Count))" -ForegroundColor Green
}

# (2) no base64 left inside before/after/metadata of reconstructed auditLogs.
$leakFound = 0
foreach ($log in $recAudit) {
  foreach ($f in @('before','after','metadata')) {
    $p = $log.PSObject.Properties[$f]
    if ($null -eq $p -or $null -eq $p.Value) { continue }
    $blob = $p.Value | ConvertTo-Json -Depth 30 -Compress
    if ($blob -match 'data:image/' -or [regex]::IsMatch($blob, '"(imageUrl|thumbnailUrl)"\s*:\s*"[^"]{256,}"')) {
      $leakFound++
      if ($leakFound -le 5) { Write-Host "    base64 leak in audit id=$($log.id) field=$f" -ForegroundColor Yellow }
    }
  }
}
if ($leakFound -gt 0) {
  Write-Host "[auditLogs] BASE64 LEAK: $leakFound record(s) still contain base64 images" -ForegroundColor Red
  $mismatch = $true
} else {
  Write-Host "[auditLogs] no base64 in before/after/metadata (strip confirmed)" -ForegroundColor Green
}

if ($mismatch) { Write-Host "COMPARE: MISMATCH" -ForegroundColor Red; exit 1 }
Write-Host "COMPARE: MATCH" -ForegroundColor Green
exit 0
