<#
.SYNOPSIS
  تثبيت مهمتي الإنذار: مراقبة السيرفر، وانتهاء الدومين.

.DESCRIPTION
  مهمتان خفيفتان تشتغلان بالخلفية:

    • مراقبة السيرفر  — كل ٥ دقائق، وتنبّه بعد ٣ فشل متتالية.
    • انتهاء الدومين — أسبوعياً، وتنبّه قبل ٩٠ و٣٠ يوماً.

  الاثنتان تكتبان تنبيهاً على سطح المكتب وإشعار ويندوز (notify-alert.ps1)،
  وما تمرّان بالسيرفر عمداً — التنبيه الي يمر بالشي المعطّل ما يوصل.

  تُسجَّل بنفس نمط مهمة النسخ الاحتياطية الموجودة: بحساب المستخدم الحالي،
  وبدون تخزين كلمة سر.

.PARAMETER NoElevation
  للتسجيل بدون صلاحيات مدير (تشتغل فقط وأنت داخل على الجهاز).
#>
[CmdletBinding()]
param(
  [string]$HealthUrl = 'https://api.mazbwoni.com/health',
  [string]$Domain = 'mazbwoni.com',
  [string]$AppDataDir = (Join-Path $env:APPDATA 'com.mazbwoni.mahdi'),
  [int]$EveryMinutes = 5,
  [string]$WeeklyAt = '09:00',
  [switch]$NoElevation
)

$ErrorActionPreference = 'Stop'

$monitorScript = Join-Path $PSScriptRoot 'monitor-server.ps1'
$domainScript  = Join-Path $PSScriptRoot 'check-domain-expiry.ps1'
foreach ($s in @($monitorScript, $domainScript)) {
  if (-not (Test-Path $s)) { throw "Script not found: $s" }
}

$currentUser = "$env:USERDOMAIN\$env:USERNAME"
$principal = if ($NoElevation) {
  New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
} else {
  New-ScheduledTaskPrincipal -UserId $currentUser -LogonType S4U -RunLevel Highest
}

function Register-WatchdogTask {
  param(
    [string]$TaskName,
    [string]$Arguments,
    $Trigger,
    [string]$Description,
    [int]$LimitMinutes = 10
  )
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $Arguments
  $settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes $LimitMinutes) `
    -MultipleInstances IgnoreNew
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "  Task exists -> updating: $TaskName" -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  Register-ScheduledTask -TaskName $TaskName `
    -Action $action -Trigger $Trigger -Settings $settings -Principal $principal `
    -Description $Description -ErrorAction SilentlyContinue | Out-Null
  # يُفحص بعد التسجيل لا قبله: Register-ScheduledTask يرجّع خطأ غير موقف،
  # فطباعة «تم» بلا فحص كانت تكذب عند رفض الصلاحية.
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "  Registered: $TaskName" -ForegroundColor Green
  } else {
    Write-Host "  FAILED to register: $TaskName" -ForegroundColor Red
    Write-Host "  جرّب تشغيل السكربت من PowerShell بصلاحية مدير." -ForegroundColor Yellow
  }
}

# ── 1. مراقبة السيرفر ──────────────────────────────────────────────────────
# محفّز يومي عند منتصف الليل، ويتكرر كل N دقيقة على مدى اليوم.
#
# جُرّب شكلان قبله ورفضهما ويندوز بلا صلاحية مدير: «عند الدخول» مع تكرار
# مركّب، و«مرة واحدة» بمدة تكرار لا نهائية. هذا الشكل يُسجَّل بحساب المستخدم
# العادي، وهو نفس النمط الي تستعمله مهمة النسخ الاحتياطية.
$monitorTrigger = New-ScheduledTaskTrigger -Daily -At '00:02'
$monitorTrigger.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes) `
  -RepetitionDuration (New-TimeSpan -Hours 24)).Repetition

Register-WatchdogTask `
  -TaskName 'Makhzouni Server Monitor' `
  -Arguments ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Url "{1}" -AppDataDir "{2}"' -f $monitorScript, $HealthUrl, $AppDataDir) `
  -Trigger $monitorTrigger `
  -Description 'Checks the shop server every few minutes and alerts after repeated failures.' `
  -LimitMinutes 5

# ── 2. انتهاء الدومين ──────────────────────────────────────────────────────
$domainTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At $WeeklyAt
Register-WatchdogTask `
  -TaskName 'Makhzouni Domain Expiry' `
  -Arguments ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Domain "{1}" -AppDataDir "{2}"' -f $domainScript, $Domain, $AppDataDir) `
  -Trigger $domainTrigger `
  -Description 'Weekly domain expiry check; warns 90 and 30 days out.' `
  -LimitMinutes 5

# ── ٣. فحص صحة النسخ الاحتياطية (أسبوعي) ──────────────────────────────────
$healthScript = Join-Path $PSScriptRoot 'verify-backup-health.ps1'
if (Test-Path $healthScript) {
  Register-WatchdogTask `
    -TaskName 'Makhzouni Backup Health' `
    -Arguments ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -AppDataDir "{1}"' -f $healthScript, $AppDataDir) `
    -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday -At '10:00') `
    -Description 'Weekly check that backups are recent, readable and complete.' `
    -LimitMinutes 10
}

# ── ٤. النسخة الكاملة من القاعدة (شهرياً) ─────────────────────────────────
# محفّز يومي والسكربت يخرج بصمت إلا بأول الشهر: المجدّول ما يدعم «شهري»
# مباشرة من PowerShell 5.1.
$fullScript = Join-Path $PSScriptRoot 'backup-full-db.ps1'
if (Test-Path $fullScript) {
  Register-WatchdogTask `
    -TaskName 'Makhzouni Full DB Backup' `
    -Arguments ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -OnlyOnDayOfMonth 1' -f $fullScript) `
    -Trigger (New-ScheduledTaskTrigger -Daily -At '04:00') `
    -Description 'Monthly full pg_dump of the production database (runs on the 1st).' `
    -LimitMinutes 120
}

Write-Host ""
Write-Host "خلصت. جرّبهن هسه:" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName 'Makhzouni Server Monitor'"
Write-Host "  Start-ScheduledTask -TaskName 'Makhzouni Domain Expiry'"
