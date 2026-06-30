<#
  makhzouni — EXPERIMENTAL Incremental Backup (Phase 3, standalone, PARALLEL)
  ---------------------------------------------------------------------------
  Runs ALONGSIDE the official backup-online.ps1. Does NOT touch it.
  - Weekly FULL (Sunday or if >7 days since last full) via /backup/download
  - Daily INCREMENTAL via /backup/changes?since=<last successful backup>
  - Local image deduplication: base64 images extracted into image-store\,
    replaced in JSON with { "$img": "<hash>" }. No backend change for images.

  Storage (separate from official system):
    %APPDATA%\com.mazbwoni.mahdi\backups-incremental\
      image-store\<hash>.b64
      image-index.json
      state.json
      backup-status.json
      logs\backup-incremental-YYYY-MM-DD.log
      makhzouni-inc-FULL-YYYY-MM-DD-HH-mm.zip
      makhzouni-inc-INC-YYYY-MM-DD-HH-mm.zip

  Secret from env MAKHZOUNI_BACKUP_SECRET (never on disk/git).

  Usage:
    npm run backup:incremental
    npm run backup:incremental -- -ForceFull   (force a full this run)
#>

[CmdletBinding()]
param(
  [string]$ApiBase = 'https://api.mazbwoni.com/api/settings/backup',
  [string]$AppDataDir = (Join-Path $env:APPDATA 'com.mazbwoni.mahdi'),
  [int]$RetentionFull = 4,        # keep last 4 weekly fulls
  [int]$RetentionInc  = 30,       # keep last 30 incrementals
  [int]$FullEveryDays = 7,        # force a full at least every N days
  [int]$TimeoutSec = 1800,
  [switch]$ForceFull
)

$ErrorActionPreference = 'Stop'
$ScriptVersion = '1.0.0'
$SchemaVersion = '2.1'

# Image-bearing string fields to deduplicate. Top-level arrays in the JSON map
# to these per-record fields.
$ImageFields = @('imageUrl', 'thumbnailUrl')

# ── Paths ──────────────────────────────────────────────────────────────────
$BackupDir   = Join-Path $AppDataDir 'backups-incremental'
$ImageStore  = Join-Path $BackupDir 'image-store'
$ImageIndex  = Join-Path $BackupDir 'image-index.json'
$StatePath   = Join-Path $BackupDir 'state.json'
$StatusPath  = Join-Path $BackupDir 'backup-status.json'
$LogDir      = Join-Path $BackupDir 'logs'
$Stamp       = Get-Date -Format 'yyyy-MM-dd-HH-mm'

foreach ($d in @($BackupDir, $ImageStore, $LogDir)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}
$LogPath = Join-Path $LogDir ("backup-incremental-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))

function Write-Log {
  param([string]$Message, [string]$Level = 'INFO')
  $line = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
  Write-Host $line
}

function Save-Status {
  param([hashtable]$Patch)
  $status = [ordered]@{
    lastSuccessAt = $null; lastFailureAt = $null; lastBackupPath = $null
    lastBackupSize = 0; lastBackupType = $null; backupsCount = 0
    lastError = $null; scriptVersion = $ScriptVersion
  }
  if (Test-Path $StatusPath) {
    try { $e = Get-Content $StatusPath -Raw -Encoding UTF8 | ConvertFrom-Json
      foreach ($k in @($status.Keys)) { if ($null -ne $e.$k) { $status[$k] = $e.$k } } } catch {}
  }
  foreach ($k in $Patch.Keys) { $status[$k] = $Patch[$k] }
  $status['scriptVersion'] = $ScriptVersion
  ($status | ConvertTo-Json -Depth 5) | Set-Content -Path $StatusPath -Encoding UTF8
}

function Get-State {
  if (Test-Path $StatePath) {
    try { return Get-Content $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
  }
  return $null
}

function Save-State {
  param([hashtable]$NewState)
  ($NewState | ConvertTo-Json -Depth 6) | Set-Content -Path $StatePath -Encoding UTF8
}

$script:StagingDir = $null
function Fail-Backup {
  param([string]$Message)
  Write-Log $Message 'ERROR'
  Save-Status @{ lastFailureAt = (Get-Date).ToString('o'); lastError = $Message }
  if ($script:StagingDir -and (Test-Path $script:StagingDir)) {
    Remove-Item $script:StagingDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  exit 1
}

# ── Download helper (streams to disk; avoids Railway timeout) ───────────────
function Invoke-Download {
  param([string]$Uri, [string]$OutFile)
  try {
    $wc = New-Object System.Net.WebClient
    $wc.Headers.Add('User-Agent', 'MakhzouniIncBackup/1.0')
    $wc.DownloadFile($Uri, $OutFile)
  } catch {
    $code = $null
    try { $code = [int]$_.Exception.InnerException.Response.StatusCode } catch {}
    if ($code) { Fail-Backup "Download failed (HTTP $code): $($_.Exception.Message)" }
    else { Fail-Backup "Download failed (network/timeout): $($_.Exception.Message)" }
  }
}

# ── Image dedup: walk top-level arrays, hash base64 image fields, store once,
#    replace with { '$img': hash }. Returns count of refs written. ───────────
function Invoke-ImageDedup {
  param([object]$Data)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $refCount = 0
  $storedNow = 0
  foreach ($prop in $Data.PSObject.Properties) {
    $val = $prop.Value
    if ($val -isnot [System.Collections.IEnumerable] -or $val -is [string]) { continue }
    foreach ($rec in $val) {
      if ($rec -isnot [System.Management.Automation.PSCustomObject]) { continue }
      foreach ($field in $ImageFields) {
        $p = $rec.PSObject.Properties[$field]
        if ($null -eq $p) { continue }
        $s = $p.Value
        if ([string]::IsNullOrEmpty($s) -or $s -isnot [string]) { continue }
        # only dedup actual base64/data-uri payloads, not short plain URLs
        if ($s.Length -lt 256) { continue }
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($s)
        $hash = ([System.BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', '').Substring(0, 24).ToLower()
        $storePath = Join-Path $ImageStore "$hash.b64"
        if (-not (Test-Path $storePath)) {
          [System.IO.File]::WriteAllText($storePath, $s, [System.Text.Encoding]::UTF8)
          $storedNow++
        }
        # replace field value with a ref marker object
        $p.Value = [PSCustomObject]@{ '$img' = $hash }
        $refCount++
      }
    }
  }
  $sha.Dispose()
  Write-Log "Image dedup: $refCount refs ($storedNow new images stored)"
  return $refCount
}

# ── Update image-index.json (hash -> firstSeen) ────────────────────────────
function Update-ImageIndex {
  $idx = @{}
  if (Test-Path $ImageIndex) {
    try { $existing = Get-Content $ImageIndex -Raw -Encoding UTF8 | ConvertFrom-Json
      foreach ($p in $existing.PSObject.Properties) { $idx[$p.Name] = $p.Value } } catch {}
  }
  $now = (Get-Date).ToString('o')
  Get-ChildItem $ImageStore -Filter '*.b64' -File | ForEach-Object {
    $h = $_.BaseName
    if (-not $idx.ContainsKey($h)) { $idx[$h] = $now }
  }
  ($idx | ConvertTo-Json -Depth 3) | Set-Content -Path $ImageIndex -Encoding UTF8
}

Write-Log "==== Incremental backup start (v$ScriptVersion) ===="
Write-Log "ApiBase:    $ApiBase"
Write-Log "BackupDir:  $BackupDir"

# ── 1. Secret ──────────────────────────────────────────────────────────────
$secret = $env:MAKHZOUNI_BACKUP_SECRET
if ([string]::IsNullOrWhiteSpace($secret)) {
  Fail-Backup "Environment variable MAKHZOUNI_BACKUP_SECRET is not set. Refusing to run."
}
$escSecret = [uri]::EscapeDataString($secret)

# ── 2. Decide full vs incremental ──────────────────────────────────────────
$state = Get-State
$doFull = $false
$reason = ''
if ($ForceFull) { $doFull = $true; $reason = 'ForceFull flag' }
elseif ($null -eq $state -or [string]::IsNullOrWhiteSpace($state.lastFullId)) { $doFull = $true; $reason = 'no prior full' }
elseif ((Get-Date).DayOfWeek -eq 'Sunday') { $doFull = $true; $reason = 'Sunday' }
else {
  try {
    $lastFullTime = [datetime]::Parse($state.lastFullAt)
    if ((New-TimeSpan -Start $lastFullTime -End (Get-Date)).TotalDays -ge $FullEveryDays) { $doFull = $true; $reason = ">$FullEveryDays days since full" }
  } catch { $doFull = $true; $reason = 'unreadable lastFullAt' }
}
$backupType = if ($doFull) { 'FULL' } else { 'INC' }
Write-Log "Decision: $backupType ($(if($doFull){$reason}else{'incremental'}))"

# ── 3. Staging + download ──────────────────────────────────────────────────
$BackupId    = "$backupType-$Stamp"
$ZipPath     = Join-Path $BackupDir ("makhzouni-inc-$BackupId.zip")
$script:StagingDir = Join-Path $BackupDir (".staging-$BackupId")
New-Item -ItemType Directory -Path $script:StagingDir -Force | Out-Null
$jsonStaged  = Join-Path $script:StagingDir 'data.json'

if ($doFull) {
  $uri = "$ApiBase/download?secret=$escSecret"
} else {
  $sinceIso = $state.lastSuccessfulBackupTime
  if ([string]::IsNullOrWhiteSpace($sinceIso)) { Fail-Backup "No 'since' cursor in state for incremental." }
  $uri = "$ApiBase/changes?since=$([uri]::EscapeDataString($sinceIso))&secret=$escSecret"
  Write-Log "Incremental since: $sinceIso"
}
Invoke-Download -Uri $uri -OutFile $jsonStaged

# ── 4. Validate + parse ────────────────────────────────────────────────────
if (-not (Test-Path $jsonStaged)) { Fail-Backup "No file downloaded." }
$jsonInfo = Get-Item $jsonStaged
if ($jsonInfo.Length -lt 50) { Fail-Backup "Downloaded file too small ($($jsonInfo.Length) bytes)." }
try {
  $sr = New-Object System.IO.StreamReader($jsonStaged, [System.Text.Encoding]::UTF8)
  try { $raw = $sr.ReadToEnd() } finally { $sr.Dispose() }
  $data = $raw | ConvertFrom-Json
} catch { Fail-Backup "Downloaded content is not valid JSON: $($_.Exception.Message)" }

# required fields differ by type
if ($doFull) {
  foreach ($f in @('products','customers','invoices','settings','transfers')) {
    if ($null -eq $data.$f) { Fail-Backup "Full JSON missing field: $f" }
  }
} else {
  foreach ($f in @('since','generatedAt','counts','deletedIds')) {
    if ($null -eq $data.$f) { Fail-Backup "Changes JSON missing field: $f" }
  }
}

# ── 5. Image dedup (rewrite JSON without base64) ───────────────────────────
$refCount = Invoke-ImageDedup -Data $data
Update-ImageIndex
($data | ConvertTo-Json -Depth 30 -Compress) | Set-Content -Path $jsonStaged -Encoding UTF8

# ── 6. Manifest ────────────────────────────────────────────────────────────
$generatedAt = if ($doFull) { (Get-Date).ToString('o') } else { $data.generatedAt }
$baseId = if ($doFull) { $BackupId } else { $state.lastFullId }
$prevId = if ($doFull) { $null } else { $state.lastBackupId }
$manifest = [ordered]@{
  type           = $(if ($doFull) { 'full' } else { 'incremental' })
  id             = $BackupId
  baseId         = $baseId
  prevId         = $prevId
  changesSince   = $(if ($doFull) { $null } else { $data.since })
  generatedAt    = $generatedAt
  schemaVersion  = $SchemaVersion
  serverVersion  = $data.version
  storeName      = $data.storeName
  counts         = $data.counts
  deletedIds     = $(if ($doFull) { $null } else { $data.deletedIds })
  imageRefs      = $refCount
  imageStore     = 'image-store'
  machineName    = $env:COMPUTERNAME
  scriptVersion  = $ScriptVersion
}
($manifest | ConvertTo-Json -Depth 8) | Set-Content -Path (Join-Path $script:StagingDir 'manifest.json') -Encoding UTF8

# ── 7. ZIP (json + manifest only; images live in shared image-store) ───────
try {
  if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
  Compress-Archive -Path (Join-Path $script:StagingDir '*') -DestinationPath $ZipPath -Force
} catch { Fail-Backup "Failed to create ZIP: $($_.Exception.Message)" }
Remove-Item $script:StagingDir -Recurse -Force -ErrorAction SilentlyContinue
$script:StagingDir = $null

# ── 8. Integrity ───────────────────────────────────────────────────────────
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipInfo = Get-Item $ZipPath
$entryNames = @()
try {
  $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try { $entryNames = $zip.Entries | ForEach-Object { $_.FullName } } finally { $zip.Dispose() }
} catch { Fail-Backup "ZIP cannot be opened: $($_.Exception.Message)" }
if ($entryNames -notcontains 'data.json') { Fail-Backup "ZIP missing data.json" }
if ($entryNames -notcontains 'manifest.json') { Fail-Backup "ZIP missing manifest.json" }
Write-Log ("Integrity OK. ZIP: {0} bytes, type {1}" -f $zipInfo.Length, $backupType)

# ── 9. Retention (separate patterns for FULL / INC) ────────────────────────
function Invoke-Retention {
  param([string]$Pat, [int]$Keep)
  $all = Get-ChildItem $BackupDir -Filter 'makhzouni-inc-*.zip' -File |
    Where-Object { $_.Name -match $Pat } | Sort-Object Name -Descending
  $all | Select-Object -Skip $Keep | ForEach-Object {
    try { Remove-Item $_.FullName -Force; Write-Log "Retention: deleted $($_.Name)" }
    catch { Write-Log "Retention: FAILED $($_.Name): $($_.Exception.Message)" 'WARN' }
  }
}
Invoke-Retention '^makhzouni-inc-FULL-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.zip$' $RetentionFull
Invoke-Retention '^makhzouni-inc-INC-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.zip$' $RetentionInc

# ── 10. State + status ─────────────────────────────────────────────────────
$newState = @{
  lastBackupId             = $BackupId
  lastBackupType           = $backupType
  lastSuccessfulBackupTime = $generatedAt
  lastFullId               = $(if ($doFull) { $BackupId } else { $state.lastFullId })
  lastFullAt               = $(if ($doFull) { $generatedAt } else { $state.lastFullAt })
  updatedAt                = (Get-Date).ToString('o')
}
Save-State $newState

$incCount = (Get-ChildItem $BackupDir -Filter 'makhzouni-inc-*.zip' -File | Measure-Object).Count
Save-Status @{
  lastSuccessAt = (Get-Date).ToString('o'); lastBackupPath = $ZipPath
  lastBackupSize = $zipInfo.Length; lastBackupType = $backupType
  backupsCount = $incCount; lastError = $null
}
Write-Log ("Backup OK -> {0} ({1} bytes, {2}). since-cursor now {3}" -f $ZipPath, $zipInfo.Length, $backupType, $generatedAt)
Write-Log "==== Incremental backup end ===="
exit 0
