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
    -Time          Daily start time, default "03:00".
    -TaskName      Scheduled task name, default "MakhzouniOnlineBackup".
    -AppDataDir    App-data folder. Default %APPDATA%\com.mazbwoni.mahdi.
    -ApiUrl        Backup endpoint of the shop to back up. Defaults to the
                   main shop. Each shop is a separate database behind its own
                   backend, so a second shop needs its own task with its own
                   -ApiUrl, -TaskName, -AppDataDir and -SecretEnvVar.
    -SecretEnvVar  Name of the User-scope env var holding that shop's secret.
    -NoElevation   Register a task that runs only while this user is logged on,
                   instead of the S4U "run whether logged on or not" task.
                   Registering the S4U variant requires an elevated shell; this
                   switch lets the backup be scheduled from a normal one. The
                   backup then only runs when the user is signed in, so prefer
                   the elevated install when you can get it.
#>

[CmdletBinding()]
param(
  [string]$Time = '03:00',
  [string]$TaskName = 'MakhzouniOnlineBackup',
  [string]$AppDataDir = (Join-Path $env:APPDATA 'com.mazbwoni.mahdi'),
  [string]$ApiUrl = 'https://api.mazbwoni.com/api/settings/backup/download',
  [string]$SecretEnvVar = 'MAKHZOUNI_BACKUP_SECRET',
  [switch]$NoElevation
)

$ErrorActionPreference = 'Stop'

$ScriptPath = Join-Path $PSScriptRoot 'backup-online.ps1'
if (-not (Test-Path $ScriptPath)) {
  throw "backup-online.ps1 not found next to this installer: $ScriptPath"
}

Write-Host "Installing scheduled task '$TaskName'..." -ForegroundColor Cyan
Write-Host "  Backup script : $ScriptPath"
Write-Host "  App data dir  : $AppDataDir"
Write-Host "  Api url       : $ApiUrl"
Write-Host "  Secret env    : $SecretEnvVar"
Write-Host "  Daily time    : $Time"
if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($SecretEnvVar, 'User'))) {
  Write-Host "  WARNING: $SecretEnvVar is not set at User scope." -ForegroundColor Yellow
  Write-Host "           Set it so the task can authenticate:" -ForegroundColor Yellow
  Write-Host "           setx $SecretEnvVar `"your-strong-secret`"" -ForegroundColor Yellow
}

$arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -AppDataDir "{1}" -ApiUrl "{2}" -SecretEnvVar "{3}"' -f $ScriptPath, $AppDataDir, $ApiUrl, $SecretEnvVar
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
if ($NoElevation) {
  # Interactive + Limited is registrable without administrator rights.
  $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
} else {
  $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType S4U -RunLevel Highest
}

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Write-Host "  Task already exists -> updating it." -ForegroundColor Yellow
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName `
  -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Daily ONLINE backup download for makhzouni desktop (Phase 2, local storage only).' | Out-Null

Write-Host "Done. Task '$TaskName' will run daily at $Time." -ForegroundColor Green
if ($NoElevation) {
  Write-Host "  NOTE: registered WITHOUT elevation - it runs only while $currentUser is logged on." -ForegroundColor Yellow
  Write-Host "        Re-run this script from an elevated shell (without -NoElevation) to upgrade it." -ForegroundColor Yellow
}
Write-Host "Test it now with:  Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor Green
