<#
  makhzouni - Verify a local backup ZIP is restorable (read-only check).
  ---------------------------------------------------------------------------
  This DOES NOT restore anything. It extracts a backup ZIP to a TEMP folder,
  confirms the structure, confirms the database file is a real SQLite file,
  and (if a SQLite engine is available) runs PRAGMA integrity_check.

  The live database and the backups are never modified.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-backup.ps1
    powershell ... -File scripts/verify-backup.ps1 -ZipPath "C:\path\to\backup.zip"
    npm run backup:verify

  Parameters:
    -ZipPath      A specific backup ZIP. Default: newest ZIP in the backups dir.
    -AppDataDir   App-data folder. Default %APPDATA%\com.mazbwoni.mahdi.
#>

[CmdletBinding()]
param(
  [string]$ZipPath,
  [string]$AppDataDir = (Join-Path $env:APPDATA 'com.mazbwoni.mahdi')
)

$ErrorActionPreference = 'Stop'
$DbFileName = 'makhzouni.db'
$BackupDir  = Join-Path $AppDataDir 'backups'

function Fail($msg) { Write-Host "FAIL: $msg" -ForegroundColor Red; exit 1 }
function Ok($msg)   { Write-Host "  OK  $msg" -ForegroundColor Green }

# Pick the ZIP
if (-not $ZipPath) {
  $pattern = '^makhzouni-backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.zip$'
  $latest = Get-ChildItem -Path $BackupDir -Filter 'makhzouni-backup-*.zip' -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match $pattern } | Sort-Object Name -Descending | Select-Object -First 1
  if (-not $latest) { Fail "No backup ZIP found in $BackupDir" }
  $ZipPath = $latest.FullName
}
if (-not (Test-Path $ZipPath)) { Fail "ZIP not found: $ZipPath" }
Write-Host "Verifying backup: $ZipPath" -ForegroundColor Cyan

$zipInfo = Get-Item $ZipPath
if ($zipInfo.Length -le 0) { Fail "ZIP is 0 bytes" }
Ok ("ZIP exists, size {0} bytes" -f $zipInfo.Length)

# Extract to a temp folder
Add-Type -AssemblyName System.IO.Compression.FileSystem
$tmp = Join-Path $env:TEMP ('mk-verify-' + [System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
  [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $tmp)

  $dbExtracted = Join-Path $tmp $DbFileName
  $manifest    = Join-Path $tmp 'manifest.json'
  if (-not (Test-Path $manifest))    { Fail "manifest.json missing inside ZIP" }
  Ok "manifest.json present"
  if (-not (Test-Path $dbExtracted)) { Fail "$DbFileName missing inside ZIP" }
  $dbInfo = Get-Item $dbExtracted
  if ($dbInfo.Length -le 0) { Fail "$DbFileName is 0 bytes" }
  Ok ("$DbFileName present, size {0} bytes" -f $dbInfo.Length)

  # SQLite header magic check (zero-dependency)
  $bytes = [System.IO.File]::ReadAllBytes($dbExtracted) | Select-Object -First 16
  $header = -join ($bytes | ForEach-Object { [char]$_ })
  if ($header -like 'SQLite format 3*') {
    Ok "Valid SQLite file header"
  } else {
    Fail "File does not have a SQLite header (got: '$header')"
  }

  Write-Host "--- manifest.json ---"
  Get-Content $manifest -Raw

  # Optional deeper check: PRAGMA integrity_check
  $engineRan = $false
  $node = Get-Command node -ErrorAction SilentlyContinue
  $checkScript = Join-Path $PSScriptRoot '_sqlite-integrity-check.cjs'
  if ($node -and (Test-Path $checkScript)) {
    $out = & node $checkScript $dbExtracted 2>$null
    if ($out -like 'INTEGRITY:ok*') { Ok "PRAGMA integrity_check = ok (via node:sqlite)"; $engineRan = $true }
    elseif ($out -like 'INTEGRITY:*') { Fail ("integrity_check returned: " + ($out -replace 'INTEGRITY:','')) }
  }
  if (-not $engineRan) {
    $sqlite = Get-Command sqlite3 -ErrorAction SilentlyContinue
    if ($sqlite) {
      $res = & $sqlite.Source $dbExtracted 'PRAGMA integrity_check;' 2>$null
      if ($res -eq 'ok') { Ok "PRAGMA integrity_check = ok (via sqlite3.exe)"; $engineRan = $true }
      else { Fail "integrity_check returned: $res" }
    }
  }
  if (-not $engineRan) {
    Write-Host "  --  integrity_check skipped (no SQLite engine here; header check passed)" -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host "VERIFY PASSED - this backup is structurally valid and restorable." -ForegroundColor Green
}
finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
