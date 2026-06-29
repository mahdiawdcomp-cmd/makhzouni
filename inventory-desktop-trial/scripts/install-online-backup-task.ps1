<#
  Installs (or updates) a Windows Scheduled Task that downloads a daily ONLINE
  backup from the live server to this PC — even if the desktop app is closed
  and even if no user is logged on.

  The secret is read at runtime from the MAKHZOUNI_BACKUP_SECRET environment
  variable (User scope). It is NEVER baked into the task. Make sure it is set
  for the user the task runs as:
    setx MAKHZOUNI_BACKUP_SECRET "your-strong-secret"

  Run from an elevated PowerShell (Run as Administrator):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-online-backup-task.ps1

  Parameters:
    -Time        Daily start time, default "03:00".
    -TaskName    Scheduled task name, default "MakhzouniOnlineBackup".
    -AppDataDir  App-data folder. Default %APPDATA%\com.mazbwoni.mahdi.
#>

[CmdletBinding()]
param(
  [string]$Time = '03:00',
  [string]$TaskName = 'MakhzouniOnlineBackup',
  [string]$AppDataDir = (Join-Path $env:APPDATA 'com.mazbwoni.mahdi')
)

$ErrorActionPreference = 'Stop'

$ScriptPath = Join-Path $PSScriptRoot 'backup-online.ps1'
if (-not (Test-Path $ScriptPath)) {
  throw "backup-online.ps1 not found next to this installer: $ScriptPath"
}

Write-Host "Installing scheduled task '$TaskName'..." -ForegroundColor Cyan
Write-Host "  Backup script : $ScriptPath"
Write-Host "  App data dir  : $AppDataDir"
Write-Host "  Daily time    : $Time"
if ([string]::IsNullOrWhiteSpace($env:MAKHZOUNI_BACKUP_SECRET)) {
  Write-Host "  WARNING: MAKHZOUNI_BACKUP_SECRET is not set in this session." -ForegroundColor Yellow
  Write-Host "           Set it (User scope) so the task can authenticate:" -ForegroundColor Yellow
  Write-Host '           setx MAKHZOUNI_BACKUP_SECRET "your-strong-secret"' -ForegroundColor Yellow
}

$arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -AppDataDir "{1}"' -f $ScriptPath, $AppDataDir
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments

$trigger = New-ScheduledTaskTrigger -Daily -At $Time

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -RestartCount 2 `
  -RestartInterval (New-TimeSpan -Minutes 5)

# Run as current user, whether logged on or not (S4U, no stored password).
# NOTE: with S4U, environment variables resolve from the user's profile, so
# MAKHZOUNI_BACKUP_SECRET must be set at User scope (setx ...), not just session.
$currentUser = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType S4U -RunLevel Highest

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Write-Host "  Task already exists -> updating it." -ForegroundColor Yellow
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName `
  -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Daily ONLINE backup download for makhzouni desktop (Phase 2, local storage only).' | Out-Null

Write-Host "Done. Task '$TaskName' will run daily at $Time." -ForegroundColor Green
Write-Host "Test it now with:  Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor Green
