<#
  Installs (or updates) a Windows Scheduled Task that downloads the daily
  «الكشف العام» every day — even if the desktop app is closed and even if
  nobody is logged on.

  Run from an elevated PowerShell (Run as Administrator):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-statement-task.ps1

  Parameters:
    -Time            Daily start time, default "03:30" — after the 03:00 online
                     backup, so the two never contend for the same API.
    -TaskName        Scheduled task name, default "MakhzouniDailyStatement".
    -AppDataDir      App-data folder. Default %APPDATA%\com.mazbwoni.mahdi for
                     the CURRENT user. Baked into the task so it works no
                     matter which account the task later runs under.
    -ApiUrl          Report endpoint.
    -CustomerFilter  all | withBalance | inactive. Default all.
    -RetentionCount  How many daily files to keep. Default 30.
    -SecretEnvVar    Environment variable holding the API secret.
#>

[CmdletBinding()]
param(
  [string]$Time = '03:30',
  [string]$TaskName = 'MakhzouniDailyStatement',
  [string]$AppDataDir = (Join-Path $env:APPDATA 'com.mazbwoni.mahdi'),
  [string]$ApiUrl = 'https://api.mazbwoni.com/api/reports/customers/statements-export.html',
  [ValidateSet('all', 'withBalance', 'inactive')]
  [string]$CustomerFilter = 'all',
  [int]$RetentionCount = 30,
  [string]$SecretEnvVar = 'MAKHZOUNI_BACKUP_SECRET'
)

$ErrorActionPreference = 'Stop'

$ScriptPath = Join-Path $PSScriptRoot 'statement-export-online.ps1'
if (-not (Test-Path $ScriptPath)) {
  throw "statement-export-online.ps1 not found next to this installer: $ScriptPath"
}

Write-Host "Installing scheduled task '$TaskName'..." -ForegroundColor Cyan
Write-Host "  Export script  : $ScriptPath"
Write-Host "  App data dir   : $AppDataDir"
Write-Host "  Api url        : $ApiUrl"
Write-Host "  Customers      : $CustomerFilter"
Write-Host "  Keep files     : $RetentionCount"
Write-Host "  Secret env     : $SecretEnvVar"
Write-Host "  Daily time     : $Time"
if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($SecretEnvVar, 'User'))) {
  Write-Host "  WARNING: $SecretEnvVar is not set at User scope." -ForegroundColor Yellow
  Write-Host "           Set it so the task can authenticate:" -ForegroundColor Yellow
  Write-Host "           setx $SecretEnvVar `"your-strong-secret`"" -ForegroundColor Yellow
}

$arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -AppDataDir "{1}" -ApiUrl "{2}" -CustomerFilter "{3}" -RetentionCount {4} -SecretEnvVar "{5}"' -f `
  $ScriptPath, $AppDataDir, $ApiUrl, $CustomerFilter, $RetentionCount, $SecretEnvVar
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments

# Daily; -StartWhenAvailable catches up if the PC was off at that hour.
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
# the secret must be set at User scope (setx ...), not just this session.
$currentUser = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType S4U -RunLevel Highest

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Write-Host "Existing task found — replacing it." -ForegroundColor Yellow
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName `
  -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Downloads the daily «الكشف العام» customer statement report. Local only, read-only.' | Out-Null

Write-Host "Done. Task '$TaskName' will run daily at $Time." -ForegroundColor Green
Write-Host "Test it now with:  Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor Green
Write-Host "Files land in:     $(Join-Path $AppDataDir 'statements')" -ForegroundColor Green
