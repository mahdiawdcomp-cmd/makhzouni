<#
  makhzouni — Daily «الكشف العام» export (standalone)
  ---------------------------------------------------------------------------
  Downloads the master customer statement as one self-contained HTML file,
  once a day, and keeps the last N days. Runs WITHOUT the app being open.

  The server renders the file — this script only fetches and files it. That is
  deliberate: an installed machine has no Node and no node_modules, so nothing
  here could build the report itself, and a second implementation in PowerShell
  is how the statement export grew three diverging versions before.

  - Read only. Touches nothing but its own output folder.
  - The secret is read from the environment, never from disk or this file.

  Usage (manual):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/statement-export-online.ps1
    npm run statement:daily

  Parameters:
    -ApiUrl          Report endpoint. Defaults to the production API.
    -AppDataDir      App-data folder. Defaults to %APPDATA%\com.mazbwoni.mahdi.
    -RetentionCount  How many daily files to keep. Default 30.
    -CustomerFilter  all | withBalance | inactive. Default all.
    -TimeZone        IANA zone the dates are printed in. Empty = derive from
                     this machine's current UTC offset.
    -TimeoutSec      Whole-request timeout. The report walks every customer's
                     full history, so this is generous by design.
    -SecretEnvVar    Environment variable holding the API secret.
#>

[CmdletBinding()]
param(
  [string]$ApiUrl = 'https://api.mazbwoni.com/api/reports/customers/statements-export.html',
  [string]$AppDataDir = (Join-Path $env:APPDATA 'com.mazbwoni.mahdi'),
  [int]$RetentionCount = 30,
  [ValidateSet('all', 'withBalance', 'inactive')]
  [string]$CustomerFilter = 'all',
  [string]$TimeZone = '',
  [int]$TimeoutSec = 900,
  [string]$SecretEnvVar = 'MAKHZOUNI_BACKUP_SECRET'
)

$ErrorActionPreference = 'Stop'
$ScriptVersion = '1.0.0'

# ── Resolve paths ──────────────────────────────────────────────────────────
$OutDir      = Join-Path $AppDataDir 'statements'
$LogDir      = Join-Path $OutDir 'logs'
$StatusPath  = Join-Path $OutDir 'statement-status.json'
$DateStamp   = Get-Date -Format 'yyyy-MM-dd'
$FileName    = "الكشف-العام-$DateStamp.html"
$OutPath     = Join-Path $OutDir $FileName
$StagingPath = Join-Path $OutDir ".staging-$DateStamp.html"

foreach ($d in @($OutDir, $LogDir)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

$LogPath = Join-Path $LogDir ("statement-{0}.log" -f $DateStamp)

function Write-Log {
  param([string]$Message, [string]$Level = 'INFO')
  $line = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
  Write-Host $line
}

function Save-Status {
  param([hashtable]$Patch)
  $status = [ordered]@{
    lastSuccessAt  = $null
    lastFailureAt  = $null
    lastFilePath   = $null
    lastFileSize   = 0
    filesCount     = 0
    lastError      = $null
    retentionCount = $RetentionCount
    scriptVersion  = $ScriptVersion
    source         = $ApiUrl   # WITHOUT secret
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

function Fail-Export {
  param([string]$Message)
  Write-Log $Message 'ERROR'
  Save-Status @{ lastFailureAt = (Get-Date).ToString('o'); lastError = $Message }
  # Clean staging only. NEVER touch yesterday's file on failure — a stale
  # statement beats no statement, and retention must not run on a bad day.
  if (Test-Path $StagingPath) { Remove-Item $StagingPath -Force -ErrorAction SilentlyContinue }
  exit 1
}

Write-Log "==== Daily statement export start (v$ScriptVersion) ===="
Write-Log "Source:  $ApiUrl"
Write-Log "OutDir:  $OutDir"

# ── 1. Secret from environment (never from disk/script) ────────────────────
$secret = [Environment]::GetEnvironmentVariable($SecretEnvVar)
if ([string]::IsNullOrWhiteSpace($secret)) {
  Fail-Export "Environment variable $SecretEnvVar is not set. Refusing to run."
}

# ── 2. Timezone the dates are printed in ───────────────────────────────────
# The server runs in UTC. Without a zone an evening invoice prints under the
# next day's date. Windows PowerShell 5.1 only knows Windows zone ids ("Arab
# Standard Time"), which Intl does not accept, so fall back to the current
# offset as a fixed Etc/GMT zone. Exact for zones without DST (Iraq among
# them); pass -TimeZone explicitly on a machine that observes DST.
if ([string]::IsNullOrWhiteSpace($TimeZone)) {
  $offsetHours = [int][Math]::Round(([TimeZoneInfo]::Local.GetUtcOffset((Get-Date))).TotalHours)
  # Etc/GMT signs are inverted by POSIX convention: UTC+3 is "Etc/GMT-3".
  $TimeZone = if ($offsetHours -eq 0) { 'UTC' } elseif ($offsetHours -gt 0) { "Etc/GMT-$offsetHours" } else { "Etc/GMT+$([Math]::Abs($offsetHours))" }
  Write-Log "TimeZone: $TimeZone (derived from this machine's UTC offset)"
} else {
  Write-Log "TimeZone: $TimeZone (explicit)"
}

# ── 3. Download to staging ─────────────────────────────────────────────────
# The secret goes in a header, not the query string: the URL lands in every
# access log on the way, and this one opens the whole database.
$requestUri = "$ApiUrl`?customerFilter=$([uri]::EscapeDataString($CustomerFilter))&tz=$([uri]::EscapeDataString($TimeZone))"

$maxAttempts = 3
$retryDelaysSec = @(15, 45)
$lastErrorMessage = $null
for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
  $lastErrorMessage = $null
  try {
    Write-Log "Downloading (attempt $attempt/$maxAttempts)..."
    Invoke-WebRequest -Uri $requestUri `
      -Headers @{ 'X-Backup-Secret' = $secret; 'User-Agent' = 'MakhzouniStatement/1.0' } `
      -TimeoutSec $TimeoutSec `
      -OutFile $StagingPath `
      -UseBasicParsing
    break
  } catch {
    $code = $null
    try { $code = [int]$_.Exception.Response.StatusCode } catch { }
    # 401/403 are real, not transient. Retrying only delays the alarm.
    if ($code -eq 401 -or $code -eq 403) {
      Fail-Export "Download refused (HTTP $code). Is $SecretEnvVar the same value as the server's BACKUP_SECRET?"
    }
    $lastErrorMessage = "HTTP $code $($_.Exception.Message)".Trim()
    Write-Log "Attempt $attempt failed: $lastErrorMessage" 'WARN'
    if ($attempt -lt $maxAttempts) { Start-Sleep -Seconds $retryDelaysSec[$attempt - 1] }
  }
}
if ($lastErrorMessage) { Fail-Export "Download failed after $maxAttempts attempts: $lastErrorMessage" }
if (-not (Test-Path $StagingPath)) { Fail-Export "Download reported success but produced no file." }

# ── 4. Sanity check before it replaces anything ────────────────────────────
# A proxy error page or a truncated stream is still a file. Check it is the
# report — an empty shop legitimately has no customer sections, so the marker
# is the report's own title, not any row.
$info = Get-Item $StagingPath
if ($info.Length -lt 200) { Fail-Export "Downloaded file is only $($info.Length) bytes — not a report." }
$head = Get-Content $StagingPath -TotalCount 40 -Encoding UTF8 | Out-String
if ($head -notmatch '<title>الكشف العام</title>') {
  Fail-Export "Downloaded file is not the statement report (title marker missing)."
}
Write-Log ("Downloaded OK: {0} bytes" -f $info.Length)

# ── 5. Move into place (same-day rerun replaces the day's file) ────────────
Move-Item -Path $StagingPath -Destination $OutPath -Force
Write-Log "Saved: $OutPath"

# ── 6. Retention: keep newest N, delete older (strict pattern only) ────────
$pattern = '^الكشف-العام-\d{4}-\d{2}-\d{2}\.html$'
$allFiles = Get-ChildItem -Path $OutDir -Filter '*.html' -File |
  Where-Object { $_.Name -match $pattern } |
  Sort-Object Name -Descending
$kept = $allFiles | Select-Object -First $RetentionCount
$toDelete = $allFiles | Select-Object -Skip $RetentionCount
foreach ($old in $toDelete) {
  try {
    Remove-Item $old.FullName -Force
    Write-Log "Retention: deleted old statement $($old.Name)"
  } catch {
    Write-Log "Retention: FAILED to delete $($old.Name): $($_.Exception.Message)" 'WARN'
  }
}

# ── 7. Prune old logs on the same schedule as the reports ──────────────────
Get-ChildItem -Path $LogDir -Filter 'statement-*.log' -File |
  Sort-Object Name -Descending |
  Select-Object -Skip $RetentionCount |
  ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }

# ── 8. Update status + finish ──────────────────────────────────────────────
$filesCount = ($kept | Measure-Object).Count
Save-Status @{
  lastSuccessAt = (Get-Date).ToString('o')
  lastFilePath  = $OutPath
  lastFileSize  = (Get-Item $OutPath).Length
  filesCount    = $filesCount
  lastError     = $null
}
Write-Log "==== Done. $filesCount statement(s) kept. ===="
exit 0
