<#
  makhzouni — Online Backup Downloader (Phase 2, standalone)
  ---------------------------------------------------------------------------
  Pulls a FULL JSON backup of the LIVE online database (Railway / api domain)
  and stores it locally as a verified ZIP. Runs WITHOUT the desktop app open.

  - Read-only against the server (HTTP GET). Never writes to the server.
  - No Sync, no Google Drive, no Telegram, no Restore. Local storage only.
  - Secret is NEVER stored here. It is read from the environment variable
    MAKHZOUNI_BACKUP_SECRET. The secret is NEVER written to disk or logs.

  Usage (manual):
    setx MAKHZOUNI_BACKUP_SECRET "your-strong-secret"   (once, then reopen shell)
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup-online.ps1
    npm run backup:online

  Parameters:
    -ApiUrl          Backup endpoint. Default https://api.mazbwoni.com/api/settings/backup/download
    -AppDataDir      App-data folder. Default %APPDATA%\com.mazbwoni.mahdi
    -RetentionCount  How many daily ZIPs to keep. Default 10.
    -TimeoutSec      HTTP timeout in seconds. Default 120.
#>

[CmdletBinding()]
param(
  [string]$ApiUrl = 'https://api.mazbwoni.com/api/settings/backup/download',
  [string]$AppDataDir = (Join-Path $env:APPDATA 'com.mazbwoni.mahdi'),
  [int]$RetentionCount = 10,
  [int]$TimeoutSec = 1800
)

$ErrorActionPreference = 'Stop'
$ScriptVersion = '1.0.0'
$JsonFileName  = 'makhzouni-backup.json'

# Required JSON fields for a backup to be considered valid/restorable.
$RequiredFields = @('products', 'customers', 'invoices', 'vouchers', 'settings', 'transfers')

# ── Resolve paths ──────────────────────────────────────────────────────────
$BackupDir   = Join-Path $AppDataDir 'backups-online'
$LogDir      = Join-Path $BackupDir 'logs'
$StatusPath  = Join-Path $BackupDir 'backup-status.json'
$Stamp       = Get-Date -Format 'yyyy-MM-dd-HH-mm'
$BackupName  = "makhzouni-online-$Stamp"
$ZipPath     = Join-Path $BackupDir ("$BackupName.zip")
$StagingDir  = Join-Path $BackupDir (".staging-$BackupName")

# ── Ensure folders exist ───────────────────────────────────────────────────
foreach ($d in @($BackupDir, $LogDir)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

$LogPath = Join-Path $LogDir ("backup-online-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))

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
    source          = $ApiUrl   # WITHOUT secret
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
  $status['source']         = $ApiUrl
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

Write-Log "==== Online backup start (v$ScriptVersion) ===="
Write-Log "Source:     $ApiUrl"
Write-Log "BackupDir:  $BackupDir"

# ── 1. Secret from environment (never from disk/script) ────────────────────
$secret = $env:MAKHZOUNI_BACKUP_SECRET
if ([string]::IsNullOrWhiteSpace($secret)) {
  Fail-Backup "Environment variable MAKHZOUNI_BACKUP_SECRET is not set. Refusing to run."
}

# ── 2. Download to staging (read-only GET, timed out) ──────────────────────
New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null
$jsonStaged = Join-Path $StagingDir $JsonFileName
$requestUri = "$ApiUrl`?secret=$([uri]::EscapeDataString($secret))"
try {
  # WebClient streams directly to disk (no in-memory buffer for the full response),
  # which avoids Railway's HTTP idle/streaming timeout on large responses.
  # First do a HEAD-equivalent probe via a tiny GET to surface 401/404 fast.
  $probe = [System.Net.HttpWebRequest]::Create($requestUri)
  $probe.Method = 'GET'; $probe.Timeout = 30000
  try {
    $probeResp = $probe.GetResponse()
    $probeResp.Close()
  } catch [System.Net.WebException] {
    $code = $null
    try { $code = [int]$_.Exception.Response.StatusCode } catch { }
    if ($code -and $code -ne 200) { Fail-Backup "Download failed (HTTP $code): $($_.Exception.Message)" }
    # If probe itself fails for other reasons fall through to WebClient attempt
  }
  $wc = New-Object System.Net.WebClient
  $wc.Headers.Add('User-Agent', 'MakhzouniBackup/1.0')
  $wc.DownloadFile($requestUri, $jsonStaged)
} catch {
  $code = $null
  try { $code = [int]$_.Exception.InnerException.Response.StatusCode } catch { }
  if ($code) { Fail-Backup "Download failed (HTTP $code): $($_.Exception.Message)" }
  else { Fail-Backup "Download failed (network/timeout): $($_.Exception.Message)" }
}

# ── 3. Validate the downloaded file ────────────────────────────────────────
if (-not (Test-Path $jsonStaged)) { Fail-Backup "No file was downloaded." }
$jsonInfo = Get-Item $jsonStaged
if ($jsonInfo.Length -le 0) { Fail-Backup "Downloaded file is empty (0 bytes)." }
if ($jsonInfo.Length -lt 1024) { Fail-Backup "Downloaded file too small ($($jsonInfo.Length) bytes) — likely an error page, not a backup." }

# Read via StreamReader to avoid loading 380 MB into string twice.
try {
  $sr = New-Object System.IO.StreamReader($jsonStaged, [System.Text.Encoding]::UTF8)
  try { $raw = $sr.ReadToEnd() } finally { $sr.Dispose() }
} catch {
  Fail-Backup "Failed to read downloaded file: $($_.Exception.Message)"
}
try {
  $data = $raw | ConvertFrom-Json
} catch {
  Fail-Backup "Downloaded content is not valid JSON: $($_.Exception.Message)"
}

foreach ($f in $RequiredFields) {
  if ($null -eq $data.$f) { Fail-Backup "Backup JSON missing required field: $f" }
}
Write-Log ("JSON valid. Size: {0} bytes. Fields present: {1}" -f $jsonInfo.Length, ($RequiredFields -join ', '))

# Pull counts/meta if the server provided them (older servers may omit meta).
$countsObj = $null; $metaObj = $null
if ($null -ne $data.counts) { $countsObj = $data.counts }
if ($null -ne $data.meta)   { $metaObj   = $data.meta }

# ── 4. Write manifest.json into staging ────────────────────────────────────
$manifest = [ordered]@{
  createdAt      = (Get-Date).ToString('o')
  source         = $ApiUrl            # secret intentionally NOT included
  jsonFileName   = $JsonFileName
  jsonSizeBytes  = $jsonInfo.Length
  serverVersion  = $data.version
  serverExportedAt = $data.exportedAt
  storeName      = $data.storeName
  counts         = $countsObj
  serverMeta     = $metaObj
  machineName    = $env:COMPUTERNAME
  scriptVersion  = $ScriptVersion
  verify         = 'PENDING'
}
($manifest | ConvertTo-Json -Depth 8) |
  Set-Content -Path (Join-Path $StagingDir 'manifest.json') -Encoding UTF8

# ── 5. Create the ZIP ──────────────────────────────────────────────────────
try {
  if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
  Compress-Archive -Path (Join-Path $StagingDir '*') -DestinationPath $ZipPath -Force
} catch {
  Fail-Backup "Failed to create ZIP: $($_.Exception.Message)"
}
Remove-Item $StagingDir -Recurse -Force -ErrorAction SilentlyContinue

# ── 6. Integrity check of the produced ZIP ─────────────────────────────────
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
if ($entryNames -notcontains $JsonFileName) { Fail-Backup "ZIP is missing $JsonFileName" }
if ($entryNames -notcontains 'manifest.json') { Fail-Backup "ZIP is missing manifest.json" }
Write-Log ("Integrity OK. ZIP size: {0} bytes, entries: {1}" -f $zipInfo.Length, ($entryNames -join ', '))

# ── 7. Retention: keep newest N, delete older (strict pattern only) ─────────
$pattern = '^makhzouni-online-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.zip$'
$allBackups = Get-ChildItem -Path $BackupDir -Filter 'makhzouni-online-*.zip' -File |
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

# ── 8. Update status + finish ──────────────────────────────────────────────
$backupsCount = ($kept | Measure-Object).Count
Save-Status @{
  lastSuccessAt  = (Get-Date).ToString('o')
  lastBackupPath = $ZipPath
  lastBackupSize = $zipInfo.Length
  backupsCount   = $backupsCount
  lastError      = $null
}
Write-Log ("Backup OK -> {0} ({1} bytes). Kept {2} backup(s)." -f $ZipPath, $zipInfo.Length, $backupsCount)
Write-Log "==== Online backup end ===="
exit 0
