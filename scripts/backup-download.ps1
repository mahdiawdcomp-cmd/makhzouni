# makhzouni — Auto Backup Downloader
# ─────────────────────────────────────────────────────────────────
# الإعدادات: عدّل هذين السطرين فقط
$BackupSecret = "adminا"
$SaveFolder   = "C:\Backups\makhzouni"
# ─────────────────────────────────────────────────────────────────

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
        -Uri "$ApiUrl`?secret=$BackupSecret&lean=1" `
        -OutFile $OutFile `
        -UseBasicParsing

    $Size = [math]::Round((Get-Item $OutFile).Length / 1KB, 1)
    Write-Host "تم الحفظ: $OutFile ($Size KB)" -ForegroundColor Green

    # احذف النسخ الأقدم من 14 يوم
    Get-ChildItem $SaveFolder -Filter "makhzouni-backup-*.json" |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
        Remove-Item -Force

} catch {
    Write-Host "فشل التحميل: $_" -ForegroundColor Red
    exit 1
}
