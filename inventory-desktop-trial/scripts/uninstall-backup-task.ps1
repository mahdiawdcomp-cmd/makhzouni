<#
  Removes the Windows Scheduled Task created by install-backup-task.ps1.
  Does NOT delete any existing backups — only the schedule.

  Run from an elevated PowerShell (Run as Administrator):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/uninstall-backup-task.ps1
#>

[CmdletBinding()]
param(
  [string]$TaskName = 'MakhzouniLocalBackup'
)

$ErrorActionPreference = 'Stop'

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed scheduled task '$TaskName'. Existing backups were left untouched." -ForegroundColor Green
} else {
  Write-Host "No scheduled task named '$TaskName' found. Nothing to do." -ForegroundColor Yellow
}
