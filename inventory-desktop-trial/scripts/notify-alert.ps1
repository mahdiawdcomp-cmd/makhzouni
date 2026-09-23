<#
.SYNOPSIS
  تنبيه محلي لصاحب المحل — إشعار ويندوز + ملف على سطح المكتب.

.DESCRIPTION
  يُستدعى من مهام الخلفية (النسخ الاحتياطية، مراقبة السيرفر، انتهاء الدومين).

  لماذا ملف على سطح المكتب وليس إشعاراً فقط: الإشعار يختفي خلال ثوانٍ، وقد
  يكون الجهاز مقفلاً أو المستخدم غير موجود وقت ظهوره. الملف يبقى حتى يُقرأ
  ويُحذف، وهو المكان الوحيد الذي لا يمكن تفويته.

  ولماذا لا نرسل عبر السيرفر: أكثر ما تُستعمل هذه التنبيهات حين يكون السيرفر
  نفسه هو المتوقف — تنبيه يمر بالشيء المعطّل لا يصل أبداً.

.PARAMETER Title
  عنوان قصير بالعربية.

.PARAMETER Message
  نص التنبيه بالعربية.

.PARAMETER Key
  اسم قصير بالإنجليزية يميّز نوع التنبيه (backup / server / domain)، يُستخدم
  لاسم الملف حتى لا تتراكم عشرات الملفات لنفس المشكلة.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][string]$Message,
  [Parameter(Mandatory = $true)][string]$Key
)

$ErrorActionPreference = 'Continue'

# ── 1. ملف على سطح المكتب (الطريق المضمون) ────────────────────────────────
try {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $file = Join-Path $desktop ("تنبيه-مخزوني-{0}.txt" -f $Key)
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
  $body = @"
$Title
$( '=' * 40 )
الوقت: $stamp

$Message

--------------------------------------------------
هذا الملف يكتبه البرنامج لحاله. بعد ما تعالج المشكلة احذفه.
"@
  Set-Content -Path $file -Value $body -Encoding UTF8
} catch {
  Write-Host "notify-alert: could not write desktop file: $($_.Exception.Message)"
}

# ── 2. إشعار ويندوز (إضافي، وقد لا يعمل على كل جهاز) ──────────────────────
try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
    [Windows.UI.Notifications.ToastTemplateType]::ToastText02
  )
  $texts = $template.GetElementsByTagName('text')
  $texts.Item(0).AppendChild($template.CreateTextNode($Title)) | Out-Null
  $texts.Item(1).AppendChild($template.CreateTextNode($Message)) | Out-Null
  $toast = [Windows.UI.Notifications.ToastNotification]::new($template)
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('مخزوني').Show($toast)
} catch {
  # الإشعار كماليّ — الملف أعلاه هو التنبيه الحقيقي.
  Write-Host "notify-alert: toast unavailable ($($_.Exception.Message))"
}

exit 0
