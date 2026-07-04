# makhzouni - Auto Backup Downloader
# -------------------------------------------------------------------
# Settings: edit only this line (local folder to save backups to)
$SaveFolder = "C:\Backups\makhzouni"
# Secret is read at runtime from the MAKHZOUNI_BACKUP_SECRET environment
# variable (never hardcoded here, never written to disk or logs). Set it once:
#   setx MAKHZOUNI_BACKUP_SECRET "your-strong-secret"   (then reopen the shell)
# -------------------------------------------------------------------

$secret = $env:MAKHZOUNI_BACKUP_SECRET
if ([string]::IsNullOrWhiteSpace($secret)) {
    Write-Error "MAKHZOUNI_BACKUP_SECRET is not set. Refusing to run."
    exit 1
}

$ApiUrl  = "https://api.mazbwoni.com/api/settings/backup/download"
$Today   = Get-Date -Format "yyyy-MM-dd"
$OutFile = Join-Path $SaveFolder "makhzouni-backup-$Today.json"

# Create the folder if it does not exist
if (-not (Test-Path $SaveFolder)) {
    New-Item -ItemType Directory -Path $SaveFolder -Force | Out-Null
}

Write-Host "Downloading backup..." -ForegroundColor Cyan

try {
    # lean=1: strips old base64 image payloads out of audit-log snapshots only
    # (the actual product/customer/invoice/stock data is unaffected - nothing
    # needed for restore is removed). Cuts daily download size significantly.
    $escSecret = [uri]::EscapeDataString($secret)
    Invoke-WebRequest `
        -Uri "$ApiUrl`?secret=$escSecret&lean=1" `
        -OutFile $OutFile `
        -UseBasicParsing

    $Size = [math]::Round((Get-Item $OutFile).Length / 1KB, 1)
    Write-Host "Saved: $OutFile ($Size KB)" -ForegroundColor Green

    # Delete backups older than 14 days
    Get-ChildItem $SaveFolder -Filter "makhzouni-backup-*.json" |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
        Remove-Item -Force

} catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode.value__ -eq 401) {
        Write-Error "Download failed: 401 Unauthorized - check the MAKHZOUNI_BACKUP_SECRET value."
    } else {
        Write-Error "Download failed: $($_.Exception.Message)"
    }
    exit 1
}
