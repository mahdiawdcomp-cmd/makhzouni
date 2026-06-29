<#
  makhzouni — Local SQLite Backup (Phase 1, standalone)
  ---------------------------------------------------------------------------
  Creates a daily ZIP backup of the local SQLite database used by the
  desktop app. Runs WITHOUT the app being open and WITHOUT internet.

  - Reads only. NEVER modifies the live database.
  - No Sync, no Google Drive, no Telegram, no Restore, no cloud. Local only.

  Usage (manual):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup-local.ps1
    npm run backup:local

  Parameters:
    -AppDataDir   Override the app-data folder. Defaults to
                  %APPDATA%\com.mazbwoni.mahdi  (resolved at runtime).
    -RetentionCount  How many daily ZIPs to keep. Default 10.
#>

[CmdletBinding()]
param(
  [string]$AppDataDir = (Join-Path $env:APPDATA 'com.mazbwoni.mahdi'),
  [int]$RetentionCount = 10
)

$ErrorActionPreference = 'Stop'
$ScriptVersion = '1.0.0'
$DbFileName    = 'makhzouni.db'

# ── Resolve paths ──────────────────────────────────────────────────────────
$DbPath      = Join-Path $AppDataDir $DbFileName
$BackupDir   = Join-Path $AppDataDir 'backups'
$LogDir      = Join-Path $BackupDir 'logs'
$StatusPath  = Join-Path $BackupDir 'backup-status.json'
$BackupName  = "makhzouni-backup-{0}" -f (Get-Date -Format 'yyyy-MM-dd-HH-mm')
$ZipPath     = Join-Path $BackupDir ("$BackupName.zip")
$StagingDir  = Join-Path $BackupDir (".staging-$BackupName")

# ── Ensure folders exist ───────────────────────────────────────────────────
foreach ($d in @($BackupDir, $LogDir)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

$LogPath = Join-Path $LogDir ("backup-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))

function Write-Log {
  param([string]$Message, [string]$Level = 'INFO')
  $line = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
  Write-Host $line
}

function Save-Status {
  param([hashtable]$Patch)
  $status = [ordered]@{
    lastSuccessAt   = $null
    lastFailureAt   = $null
    lastBackupPath  = $null
    lastBackupSize  = 0
    backupsCount    = 0
    lastError       = $null
    retentionCount  = $RetentionCount
    scriptVersion   = $ScriptVersion
  }
  if (Test-Path $StatusPath) {
    try {
      $existing = Get-Content $StatusPath -Raw -Encoding UTF8 | ConvertFrom-Json
      foreach ($k in @($status.Keys)) {
        if ($null -ne $existing.$k) { $status[$k] = $existing.$k }
      }
    } catch { }
  }
  foreach ($k in $Patch.Keys) { $status[$k] = $Patch[$k] }
  $status['retentionCount'] = $RetentionCount
  $status['scriptVersion']  = $ScriptVersion
  ($status | ConvertTo-Json -Depth 5) | Set-Content -Path $StatusPath -Encoding UTF8
}

function Fail-Backup {
  param([string]$Message)
  Write-Log $Message 'ERROR'
  Save-Status @{ lastFailureAt = (Get-Date).ToString('o'); lastError = $Message }
  # Clean staging if it exists; NEVER touch old backups on failure.
  if (Test-Path $StagingDir) { Remove-Item $StagingDir -Recurse -Force -ErrorAction SilentlyContinue }
  exit 1
}

Write-Log "==== Backup start (v$ScriptVersion) ===="
Write-Log "AppDataDir: $AppDataDir"
Write-Log "Database:   $DbPath"

# ── 1. Validate source database ────────────────────────────────────────────
if (-not (Test-Path $DbPath)) { Fail-Backup "Database file not found: $DbPath" }
$dbInfo = Get-Item $DbPath
if ($dbInfo.Length -le 0) { Fail-Backup "Database file is empty (0 bytes): $DbPath" }
Write-Log ("Database size: {0} bytes" -f $dbInfo.Length)

# ── 2. Safe copy (read-only) into staging ──────────────────────────────────
# SQLite-documented safe copy: copy the -wal and -shm sidecar files too, so
# the snapshot is consistent even if the DB happened to be open. The live DB
# is only READ here — never written, never VACUUMed.
try {
  New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null
  Copy-Item -Path $DbPath -Destination (Join-Path $StagingDir $DbFileName) -Force
  $walIncluded = $false; $shmIncluded = $false
  foreach ($suffix in @('-wal', '-shm')) {
    $side = "$DbPath$suffix"
    if (Test-Path $side) {
      Copy-Item -Path $side -Destination (Join-Path $StagingDir ("$DbFileName$suffix")) -Force
      if ($suffix -eq '-wal') { $walIncluded = $true } else { $shmIncluded = $true }
      Write-Log "Included sidecar file: $DbFileName$suffix"
    }
  }
} catch {
  Fail-Backup "Failed to copy database into staging: $($_.Exception.Message)"
}

# ── 3. Write manifest.json into staging ────────────────────────────────────
$manifest = [ordered]@{
  createdAt      = (Get-Date).ToString('o')
  dbFileName     = $DbFileName
  dbSizeBytes    = $dbInfo.Length
  machineName    = $env:COMPUTERNAME
  scriptVersion  = $ScriptVersion
  walIncluded    = $walIncluded
  shmIncluded    = $shmIncluded
  sourceVerified = $true   # source existed and size > 0 before copy
}
($manifest | ConvertTo-Json -Depth 5) |
  Set-Content -Path (Join-Path $StagingDir 'manifest.json') -Encoding UTF8

# ── 4. Create the ZIP ──────────────────────────────────────────────────────
try {
  if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
  Compress-Archive -Path (Join-Path $StagingDir '*') -DestinationPath $ZipPath -Force
} catch {
  Fail-Backup "Failed to create ZIP: $($_.Exception.Message)"
}
Remove-Item $StagingDir -Recurse -Force -ErrorAction SilentlyContinue

# ── 5. Integrity check of the produced ZIP ─────────────────────────────────
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (-not (Test-Path $ZipPath)) { Fail-Backup "ZIP was not created: $ZipPath" }
$zipInfo = Get-Item $ZipPath
if ($zipInfo.Length -le 0) { Fail-Backup "ZIP is empty (0 bytes): $ZipPath" }

$entryNames = @()
try {
  $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try { $entryNames = $zip.Entries | ForEach-Object { $_.FullName } }
  finally { $zip.Dispose() }
} catch {
  Fail-Backup "ZIP cannot be opened/inspected: $($_.Exception.Message)"
}
if ($entryNames -notcontains $DbFileName) { Fail-Backup "ZIP is missing $DbFileName" }
if ($entryNames -notcontains 'manifest.json') { Fail-Backup "ZIP is missing manifest.json" }
Write-Log ("Integrity OK. ZIP size: {0} bytes, entries: {1}" -f $zipInfo.Length, ($entryNames -join ', '))

# ── 6. Retention: keep newest N, delete older (strict pattern only) ─────────
# Names are zero-padded timestamps, so lexical sort == chronological.
$pattern = '^makhzouni-backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.zip$'
$allBackups = Get-ChildItem -Path $BackupDir -Filter 'makhzouni-backup-*.zip' -File |
  Where-Object { $_.Name -match $pattern } |
  Sort-Object Name -Descending
$kept = $allBackups | Select-Object -First $RetentionCount
$toDelete = $allBackups | Select-Object -Skip $RetentionCount
foreach ($old in $toDelete) {
  try {
    Remove-Item $old.FullName -Force
    Write-Log "Retention: deleted old backup $($old.Name)"
  } catch {
    Write-Log "Retention: FAILED to delete $($old.Name): $($_.Exception.Message)" 'WARN'
  }
}

# ── 7. Update status + finish ──────────────────────────────────────────────
$backupsCount = ($kept | Measure-Object).Count
Save-Status @{
  lastSuccessAt  = (Get-Date).ToString('o')
  lastBackupPath = $ZipPath
  lastBackupSize = $zipInfo.Length
  backupsCount   = $backupsCount
  lastError      = $null
}
Write-Log ("Backup OK -> {0} ({1} bytes). Kept {2} backup(s)." -f $ZipPath, $zipInfo.Length, $backupsCount)
Write-Log "==== Backup end ===="
exit 0
