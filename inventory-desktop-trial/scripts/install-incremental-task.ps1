<#
  Installs the EXPERIMENTAL incremental backup Scheduled Task.
  Runs ALONGSIDE MakhzouniOnlineBackup (does NOT replace it).
  Daily at 03:30 (30 min after the official task at 03:00).

  Secret read at runtime from MAKHZOUNI_BACKUP_SECRET (User scope). Set it with:
    setx MAKHZOUNI_BACKUP_SECRET "your-strong-secret"

  Run elevated:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-incremental-task.ps1
#>

[CmdletBinding()]
param(
  [string]$Time = '03:30',
  [string]$TaskName = 'MakhzouniIncrementalBackup',
  [string]$AppDataDir = (Join-Path $env:APPDATA 'com.mazbwoni.mahdi')
)

$ErrorActionPreference = 'Stop'
$ScriptPath = Join-Path $PSScriptRoot 'backup-incremental.ps1'
if (-not (Test-Path $ScriptPath)) { throw "backup-incremental.ps1 not found: $ScriptPath" }

Write-Host "Installing EXPERIMENTAL task '$TaskName'..." -ForegroundColor Cyan
Write-Host "  Backup script : $ScriptPath"
Write-Host "  Daily time    : $Time (official MakhzouniOnlineBackup stays at 03:00)"
if ([string]::IsNullOrWhiteSpace($env:MAKHZOUNI_BACKUP_SECRET)) {
  Write-Host "  WARNING: MAKHZOUNI_BACKUP_SECRET not set in this session." -ForegroundColor Yellow
}

$arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -AppDataDir "{1}"' -f $ScriptPath, $AppDataDir
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)
$currentUser = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType S4U -RunLevel Highest

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Write-Host "  Task exists -> updating." -ForegroundColor Yellow
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName `
  -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'EXPERIMENTAL daily incremental backup (parallel trial; not the official backup).' | Out-Null

Write-Host "Done. '$TaskName' runs daily at $Time. EXPERIMENTAL — official task untouched." -ForegroundColor Green
