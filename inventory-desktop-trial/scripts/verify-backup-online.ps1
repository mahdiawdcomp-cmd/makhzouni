<#
  makhzouni — Verify latest ONLINE backup ZIP (read-only)
  ---------------------------------------------------------------------------
  Inspects the most recent online backup ZIP and confirms it is restorable.
  Read-only: never modifies any backup, never contacts the server.

  Checks:
    - A ZIP exists
    - ZIP opens
    - makhzouni-backup.json present
    - manifest.json present
    - JSON is valid and contains required fields
    - JSON size > 0
    - prints counts + VERIFY PASSED/FAILED

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-backup-online.ps1
    npm run backup:online:verify
#>

[CmdletBinding()]
param(
  [string]$AppDataDir = (Join-Path $env:APPDATA 'com.mazbwoni.mahdi')
)

$ErrorActionPreference = 'Stop'
$JsonFileName = 'makhzouni-backup.json'
$RequiredFields = @('products', 'customers', 'invoices', 'vouchers', 'settings', 'transfers')
$BackupDir = Join-Path $AppDataDir 'backups-online'

function Fail([string]$m) { Write-Host "FAIL: $m" -ForegroundColor Red; Write-Host "VERIFY FAILED" -ForegroundColor Red; exit 1 }

if (-not (Test-Path $BackupDir)) { Fail "Backup folder not found: $BackupDir" }

$pattern = '^makhzouni-online-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.zip$'
$zip = Get-ChildItem -Path $BackupDir -Filter 'makhzouni-online-*.zip' -File |
  Where-Object { $_.Name -match $pattern } |
  Sort-Object Name -Descending | Select-Object -First 1
if (-not $zip) { Fail "No online backup ZIP found in $BackupDir" }

Write-Host "ZIP exists: $($zip.Name) ($($zip.Length) bytes)" -ForegroundColor Green
if ($zip.Length -le 0) { Fail "ZIP is empty (0 bytes)" }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = $null
try { $archive = [System.IO.Compression.ZipFile]::OpenRead($zip.FullName) }
catch { Fail "ZIP cannot be opened: $($_.Exception.Message)" }

try {
  $entries = $archive.Entries | ForEach-Object { $_.FullName }
  if ($entries -contains $JsonFileName) { Write-Host "$JsonFileName present" -ForegroundColor Green }
  else { Fail "$JsonFileName missing from ZIP" }
  if ($entries -contains 'manifest.json') { Write-Host "manifest.json present" -ForegroundColor Green }
  else { Fail "manifest.json missing from ZIP" }

  $jsonEntry = $archive.GetEntry($JsonFileName)
  $reader = New-Object System.IO.StreamReader($jsonEntry.Open())
  try { $raw = $reader.ReadToEnd() } finally { $reader.Dispose() }
} finally {
  $archive.Dispose()
}

if ([string]::IsNullOrWhiteSpace($raw)) { Fail "JSON entry is empty" }
Write-Host "JSON size: $($raw.Length) chars" -ForegroundColor Green

try { $data = $raw | ConvertFrom-Json }
catch { Fail "JSON is not valid: $($_.Exception.Message)" }

foreach ($f in $RequiredFields) {
  if ($null -eq $data.$f) { Fail "JSON missing required field: $f" }
}
Write-Host "Required fields present: $($RequiredFields -join ', ')" -ForegroundColor Green

if ($null -ne $data.counts) {
  Write-Host "--- counts ---" -ForegroundColor Cyan
  $data.counts.PSObject.Properties | ForEach-Object { Write-Host ("  {0}: {1}" -f $_.Name, $_.Value) }
}
if ($null -ne $data.meta) {
  Write-Host "--- server meta ---" -ForegroundColor Cyan
  $data.meta.PSObject.Properties | ForEach-Object { Write-Host ("  {0}: {1}" -f $_.Name, $_.Value) }
}

Write-Host "VERIFY PASSED" -ForegroundColor Green
exit 0
