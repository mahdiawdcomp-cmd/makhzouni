# makhzouni — Auto Backup Downloader
# ─────────────────────────────────────────────────────────────────
# الإعدادات: عدّل هذا السطر فقط (المسار المحلي لحفظ النسخ)
$SaveFolder = "C:\Backups\makhzouni"
# Secret is read at runtime from the MAKHZOUNI_BACKUP_SECRET environment
# variable (never hardcoded here, never written to disk or logs). Set it once:
#   setx MAKHZOUNI_BACKUP_SECRET "your-strong-secret"   (then reopen the shell)
# ─────────────────────────────────────────────────────────────────

$secret = $env:MAKHZOUNI_BACKUP_SECRET
if ([string]::IsNullOrWhiteSpace($secret)) {
    Write-Host "MAKHZOUNI_BACKUP_SECRET is not set. Refusing to run." -ForegroundColor Red
    exit 1
}

$ApiUrl  = "https://api.mazbwoni.com/api/settings/backup/download"
$Today   = Get-Date -Format "yyyy-MM-dd"
$OutFile = Join-Path $SaveFolder "makhzouni-backup-$Today.json"

# أنشئ المجلد إذا غير موجود
if (-not (Test-Path $SaveFolder)) {
    New-Item -ItemType Directory -Path $SaveFolder -Force | Out-Null
}

Write-Host "جاري تحميل النسخة الاحتياطية..." -ForegroundColor Cyan

try {
    # lean=1: strips old base64 image payloads out of audit-log snapshots only
    # (the actual product/customer/invoice/stock data is unaffected — nothing
    # needed for restore is removed). Cuts daily download size significantly.
    Invoke-WebRequest `
        -Uri "$ApiUrl`?secret=$secret&lean=1" `
        -OutFile $OutFile `
        -UseBasicParsing

    $Size = [math]::Round((Get-Item $OutFile).Length / 1KB, 1)
    Write-Host "تم الحفظ: $OutFile ($Size KB)" -ForegroundColor Green

    # احذف النسخ الأقدم من 14 يوم
    Get-ChildItem $SaveFolder -Filter "makhzouni-backup-*.json" |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
        Remove-Item -Force

} catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode.value__ -eq 401) {
        Write-Host "فشل التحميل: 401 Unauthorized — تحقق من قيمة MAKHZOUNI_BACKUP_SECRET." -ForegroundColor Red
    } else {
        Write-Host "فشل التحميل: $($_.Exception.Message)" -ForegroundColor Red
    }
    exit 1
}
