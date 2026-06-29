<#
  Installs (or updates) a Windows Scheduled Task that runs the local SQLite
  backup every day at 02:30 AM — even if the desktop app is closed and even
  if no user is logged on. Local only. No internet required.

  Run from an elevated PowerShell (Run as Administrator):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-backup-task.ps1

  Parameters:
    -Time           Daily start time, default "02:30".
    -TaskName       Scheduled task name, default "MakhzouniLocalBackup".
    -AppDataDir     App-data folder. Default %APPDATA%\com.mazbwoni.mahdi for
                    the CURRENT user. Baked into the task so it works no matter
                    which account the task later runs under.
#>

[CmdletBinding()]
param(
  [string]$Time = '02:30',
  [string]$TaskName = 'MakhzouniLocalBackup',
  [string]$AppDataDir = (Join-Path $env:APPDATA 'com.mazbwoni.mahdi')
)

$ErrorActionPreference = 'Stop'

$ScriptPath = Join-Path $PSScriptRoot 'backup-local.ps1'
if (-not (Test-Path $ScriptPath)) {
  throw "backup-local.ps1 not found next to this installer: $ScriptPath"
}

Write-Host "Installing scheduled task '$TaskName'..." -ForegroundColor Cyan
Write-Host "  Backup script : $ScriptPath"
Write-Host "  App data dir  : $AppDataDir"
Write-Host "  Daily time    : $Time"

# Action: run the backup script with the resolved app-data dir baked in.
$arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -AppDataDir "{1}"' -f $ScriptPath, $AppDataDir
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments

# Trigger: daily at the chosen time; catch up if the PC was off at that time.
$trigger = New-ScheduledTaskTrigger -Daily -At $Time

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -RestartCount 2 `
  -RestartInterval (New-TimeSpan -Minutes 5)

# Principal: current user, run whether logged on or not (S4U, no password),
# highest privileges. Local-only work, so no network logon is needed.
$currentUser = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType S4U -RunLevel Highest

# Update if it already exists (don't duplicate).
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Write-Host "  Task already exists -> updating it." -ForegroundColor Yellow
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName `
  -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Daily local SQLite backup for makhzouni desktop (Phase 1, local only).' | Out-Null

Write-Host "Done. Task '$TaskName' will run daily at $Time." -ForegroundColor Green
Write-Host "Test it now with:  Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor Green
