<#
  makhzouni — Daily health check for the EXPERIMENTAL incremental backup.
  ---------------------------------------------------------------------------
  READ-ONLY. Creates no backups, touches no files, contacts no server unless
  -Compare is passed (which only DOWNLOADS a live full to diff — never writes
  to the server). Safe to run any time alongside the official system.

  What it shows at a glance:
    - both scheduled tasks state + last result + next run
    - latest experimental FULL / INC sizes and timestamps
    - chain validity (CHAIN VALID / BROKEN)
    - base64 leak scan inside the newest backup's auditLogs
    - official system: last success + zip count (to confirm it's untouched)

  Usage:
    npm run backup:incremental:health            (fast, local only)
    npm run backup:incremental:health -- -Compare (also runs reconstruct+compare)
#>

[CmdletBinding()]
param(
  [string]$AppDataDir = (Join-Path $env:APPDATA 'com.mazbwoni.mahdi'),
  [switch]$Compare
)

$ErrorActionPreference = 'Continue'
$inc = Join-Path $AppDataDir 'backups-incremental'
$on  = Join-Path $AppDataDir 'backups-online'
$scriptDir = $PSScriptRoot

function Line { Write-Host ('-' * 64) -ForegroundColor DarkGray }
function Head([string]$t) { Write-Host ""; Write-Host $t -ForegroundColor Cyan }

Write-Host ""
Write-Host "  MAKHZOUNI BACKUP HEALTH  —  $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -ForegroundColor White

# ── 1. Scheduled tasks ─────────────────────────────────────────────────────
Head "1) Scheduled tasks"
foreach ($name in @('MakhzouniOnlineBackup','MakhzouniIncrementalBackup','MakhzouniLocalBackup')) {
  $t = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if (-not $t) { Write-Host ("  {0,-28} NOT INSTALLED" -f $name) -ForegroundColor Yellow; continue }
  $info = Get-ScheduledTaskInfo -TaskName $name -ErrorAction SilentlyContinue
  $res = if ($info) { $info.LastTaskResult } else { '?' }
  $resTxt = switch ($res) {
    0       { 'OK(0)' }
    267009  { 'RUNNING' }
    267011  { 'NEVER-RUN' }   # SCHED_S_TASK_HAS_NOT_RUN
    default { "FAIL($res)" }
  }
  $benign = ($res -eq 0 -or $res -eq 267009 -or $res -eq 267011)
  $color = if ($t.State -eq 'Disabled') { 'DarkGray' } elseif ($benign) { 'Green' } else { 'Yellow' }
  Write-Host ("  {0,-28} {1,-9} last={2,-9} next={3}" -f $name, $t.State, $resTxt, $(if($info){$info.NextRunTime}else{'-'})) -ForegroundColor $color
}

# ── 2. Experimental backups ────────────────────────────────────────────────
Head "2) Experimental backups (backups-incremental\)"
if (-not (Test-Path $inc)) { Write-Host "  folder missing" -ForegroundColor Red }
else {
  $fulls = Get-ChildItem $inc -Filter 'makhzouni-inc-FULL-*.zip' -File | Sort-Object Name -Descending
  $incs  = Get-ChildItem $inc -Filter 'makhzouni-inc-INC-*.zip'  -File | Sort-Object Name -Descending
  $store = Join-Path $inc 'image-store'
  $storeMB = if (Test-Path $store) { [math]::Round((Get-ChildItem $store -Filter '*.b64' | Measure-Object Length -Sum).Sum/1MB,1) } else { 0 }
  if ($fulls) { $f = $fulls[0]; Write-Host ("  latest FULL : {0,-42} {1} MB  {2:yyyy-MM-dd HH:mm}" -f $f.Name, [math]::Round($f.Length/1MB,2), $f.LastWriteTime) -ForegroundColor Green }
  else { Write-Host "  latest FULL : none" -ForegroundColor Yellow }
  if ($incs) { $i = $incs[0]; Write-Host ("  latest INC  : {0,-42} {1} MB  {2:yyyy-MM-dd HH:mm}" -f $i.Name, [math]::Round($i.Length/1MB,3), $i.LastWriteTime) -ForegroundColor Green }
  else { Write-Host "  latest INC  : none yet" -ForegroundColor DarkGray }
  Write-Host ("  counts      : {0} full, {1} inc   image-store {2} MB" -f $fulls.Count, $incs.Count, $storeMB)
  $st = Join-Path $inc 'backup-status.json'
  if (Test-Path $st) { $s = Get-Content $st -Raw -Encoding UTF8 | ConvertFrom-Json
    $ok = if ($s.lastError) { 'Red' } else { 'Green' }
    Write-Host ("  status      : lastSuccess={0}  lastError={1}" -f $s.lastSuccessAt, $(if($s.lastError){$s.lastError}else{'none'})) -ForegroundColor $ok }
}

# ── 3. Chain validity ──────────────────────────────────────────────────────
Head "3) Chain integrity"
$chainOut = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptDir 'verify-incremental-chain.ps1') 2>&1
$chainLine = ($chainOut | Select-String 'CHAIN VALID|CHAIN BROKEN' | Select-Object -Last 1)
if ($chainLine -match 'CHAIN VALID') { Write-Host "  CHAIN VALID" -ForegroundColor Green }
else { Write-Host "  CHAIN BROKEN" -ForegroundColor Red; $chainOut | Select-String 'FAIL' | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow } }

# ── 4. base64 leak scan in newest backup's auditLogs ───────────────────────
Head "4) base64 leak scan (newest backup auditLogs)"
# Prefer the newest backup that actually carries auditLogs (a FULL, or an INC
# that captured some). INCs are usually 0-audit, so fall back to latest FULL.
$newest = Get-ChildItem $inc -Filter 'makhzouni-inc-FULL-*.zip' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$newerInc = Get-ChildItem $inc -Filter 'makhzouni-inc-INC-*.zip' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($newerInc -and $newest -and $newerInc.LastWriteTime -gt $newest.LastWriteTime) { $newest = $newerInc }
if ($newest) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $a = [System.IO.Compression.ZipFile]::OpenRead($newest.FullName)
  try { $e = $a.GetEntry('data.json'); $r = New-Object System.IO.StreamReader($e.Open()); try { $raw = $r.ReadToEnd() } finally { $r.Dispose() } } finally { $a.Dispose() }
  $d = $raw | ConvertFrom-Json
  $leak = 0
  if ($d.auditLogs) {
    foreach ($log in $d.auditLogs) {
      foreach ($f in @('before','after','metadata')) {
        $p = $log.PSObject.Properties[$f]; if ($null -eq $p -or $null -eq $p.Value) { continue }
        $blob = $p.Value | ConvertTo-Json -Depth 30 -Compress
        if ($blob -match 'data:image/') { $leak++ }
      }
    }
    if ($leak -eq 0) { Write-Host "  OK: 0 base64 in $($d.auditLogs.Count) auditLog snapshot(s)" -ForegroundColor Green }
    else { Write-Host "  LEAK: $leak auditLog field(s) still contain base64" -ForegroundColor Red }
  } else { Write-Host "  (newest is an incremental with 0 auditLogs)" -ForegroundColor DarkGray }
}

# ── 5. Official system untouched ───────────────────────────────────────────
Head "5) Official system (must stay untouched)"
if (Test-Path $on) {
  $z = Get-ChildItem $on -Filter '*.zip' -File
  $sz = [math]::Round(($z | Measure-Object Length -Sum).Sum/1MB,0)
  $os = Get-Content (Join-Path $on 'backup-status.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  Write-Host ("  online ZIPs={0} ({1} MB)  lastSuccess={2}" -f $z.Count, $sz, $os.lastSuccessAt) -ForegroundColor Green
}

# ── 6. Optional compare ────────────────────────────────────────────────────
if ($Compare) {
  Head "6) Reconstruct + compare vs live full"
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptDir 'reconstruct-backup.ps1') | Out-Null
  $cmp = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptDir 'compare-reconstructed.ps1') 2>&1
  $cmp | Select-String 'MATCH|MISMATCH|preserved|strip confirmed|ROW LOSS|LEAK' | ForEach-Object { Write-Host "  $_" }
}

Line
Write-Host "  Done. (read-only health check)" -ForegroundColor White
Write-Host ""
