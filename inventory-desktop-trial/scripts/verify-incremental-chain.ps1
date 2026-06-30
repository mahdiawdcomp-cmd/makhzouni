<#
  makhzouni — Verify EXPERIMENTAL incremental backup chain (read-only)
  ---------------------------------------------------------------------------
  Confirms the Full + incrementals form a complete, assemblable chain.
  Read-only: never modifies backups, never contacts the server.

  Checks:
    - At least one FULL exists
    - Every INC's baseId points to a FULL present on disk
    - Every INC's prevId points to the immediately preceding backup (no gap)
    - changesSince chain is contiguous (changesSince[n] == generatedAt[n-1])
    - schemaVersion uniform across the chain
    - Every $img reference in every data.json exists in image-store
    - Every ZIP opens and contains data.json + manifest.json
  Prints CHAIN VALID / CHAIN BROKEN.

  Usage: npm run backup:incremental:verify
#>

[CmdletBinding()]
param([string]$AppDataDir = (Join-Path $env:APPDATA 'com.mazbwoni.mahdi'))

$ErrorActionPreference = 'Stop'
$BackupDir  = Join-Path $AppDataDir 'backups-incremental'
$ImageStore = Join-Path $BackupDir 'image-store'

function Fail([string]$m) { Write-Host "FAIL: $m" -ForegroundColor Red; Write-Host "CHAIN BROKEN" -ForegroundColor Red; exit 1 }
function Ok([string]$m)   { Write-Host "  OK: $m" -ForegroundColor Green }

if (-not (Test-Path $BackupDir)) { Fail "Backup folder not found: $BackupDir" }
Add-Type -AssemblyName System.IO.Compression.FileSystem

# ── Load all manifests ─────────────────────────────────────────────────────
$zips = Get-ChildItem $BackupDir -Filter 'makhzouni-inc-*.zip' -File | Sort-Object Name
if (-not $zips) { Fail "No incremental backup ZIPs found" }

$items = @()
foreach ($z in $zips) {
  $archive = $null
  try { $archive = [System.IO.Compression.ZipFile]::OpenRead($z.FullName) }
  catch { Fail "ZIP cannot be opened: $($z.Name)" }
  try {
    $names = $archive.Entries | ForEach-Object { $_.FullName }
    if ($names -notcontains 'data.json')     { Fail "$($z.Name) missing data.json" }
    if ($names -notcontains 'manifest.json') { Fail "$($z.Name) missing manifest.json" }
    $me = $archive.GetEntry('manifest.json')
    $r = New-Object System.IO.StreamReader($me.Open())
    try { $mraw = $r.ReadToEnd() } finally { $r.Dispose() }
    $de = $archive.GetEntry('data.json')
    $r2 = New-Object System.IO.StreamReader($de.Open())
    try { $draw = $r2.ReadToEnd() } finally { $r2.Dispose() }
  } finally { $archive.Dispose() }
  $items += [PSCustomObject]@{
    Name = $z.Name; Manifest = ($mraw | ConvertFrom-Json); DataRaw = $draw
  }
}
Write-Host "Found $($items.Count) backup(s)." -ForegroundColor Cyan

# ── 1. At least one FULL ───────────────────────────────────────────────────
$fulls = $items | Where-Object { $_.Manifest.type -eq 'full' }
if (-not $fulls) { Fail "No FULL backup in the set — chain cannot be assembled" }
Ok "$($fulls.Count) full backup(s) present"

# ── 2. schemaVersion uniform ───────────────────────────────────────────────
$schemas = $items | ForEach-Object { $_.Manifest.schemaVersion } | Sort-Object -Unique
if ($schemas.Count -gt 1) { Fail "Mixed schemaVersions across chain: $($schemas -join ', ')" }
Ok "schemaVersion uniform: $($schemas)"

# ── 3. Per-FULL chain continuity ───────────────────────────────────────────
# Group incrementals by baseId; within each base, prevId + changesSince contiguous.
$byId = @{}
foreach ($it in $items) { $byId[$it.Manifest.id] = $it }

$incs = $items | Where-Object { $_.Manifest.type -eq 'incremental' }
foreach ($inc in $incs) {
  $m = $inc.Manifest
  if (-not $byId.ContainsKey($m.baseId)) { Fail "$($inc.Name): baseId '$($m.baseId)' not present on disk" }
  if ($byId[$m.baseId].Manifest.type -ne 'full') { Fail "$($inc.Name): baseId points to a non-full backup" }
  if (-not $byId.ContainsKey($m.prevId)) { Fail "$($inc.Name): prevId '$($m.prevId)' not present on disk" }
  $prev = $byId[$m.prevId].Manifest
  # changesSince must equal prev.generatedAt (contiguous, no gap/overlap)
  $a = [datetime]::Parse($m.changesSince); $b = [datetime]::Parse($prev.generatedAt)
  if ([math]::Abs(($a - $b).TotalSeconds) -gt 2) {
    Fail "$($inc.Name): changesSince ($($m.changesSince)) != prev.generatedAt ($($prev.generatedAt)) — chain gap"
  }
}
Ok "$($incs.Count) incremental(s): baseId/prevId/changesSince all contiguous"

# ── 4. Every $img reference exists in image-store ──────────────────────────
$missing = 0; $checked = 0
foreach ($it in $items) {
  # find all "$img":"hash" occurrences via regex (fast, avoids deep parse)
  $matches = [regex]::Matches($it.DataRaw, '"\$img"\s*:\s*"([a-f0-9]{24})"')
  foreach ($mm in $matches) {
    $checked++
    $h = $mm.Groups[1].Value
    if (-not (Test-Path (Join-Path $ImageStore "$h.b64"))) { $missing++; Write-Host "    MISSING image: $h (in $($it.Name))" -ForegroundColor Yellow }
  }
}
if ($missing -gt 0) { Fail "$missing image reference(s) missing from image-store (of $checked checked)" }
Ok "$checked image reference(s) all resolve in image-store"

Write-Host "CHAIN VALID" -ForegroundColor Green
exit 0
