<#
.SYNOPSIS
  إنذار انتهاء الدومين — قبل ما ينطفي الموقع، لا بعده.

.DESCRIPTION
  يقرأ تاريخ انتهاء الدومين من سجل النطاقات العام (RDAP). ما يحتاج أي حساب
  ولا كلمة سر ولا مفتاح — معلومة عامة لأي نطاق.

  ينبّه على مرحلتين (٩٠ يوم و٣٠ يوم) ومرة واحدة لكل مرحلة، لأن تنبيهاً
  أسبوعياً لثلاثة أشهر يتحوّل إلى ضوضاء تُتجاهَل بالضبط في الشهر الأخير.

  الدومين خطر خاص بالعراق: التجديد يحتاج كارت يشتغل بالوقت المطلوب، وإذا
  انتهى، الموقع والسيرفر يصيران غير قابلين للوصول بالاسم رغم أنهما شغالان.
#>
[CmdletBinding()]
param(
  [string]$Domain = 'mazbwoni.com',
  [string]$AppDataDir = (Join-Path $env:APPDATA 'com.mazbwoni.mahdi'),
  [int[]]$WarnDays = @(90, 30),
  [int]$TimeoutSec = 30
)

$ErrorActionPreference = 'Stop'

$StateDir  = Join-Path $AppDataDir 'monitor'
$StatePath = Join-Path $StateDir 'domain-state.json'
$LogPath   = Join-Path $StateDir ("domain-{0}.log" -f (Get-Date -Format 'yyyy'))
if (-not (Test-Path $StateDir)) { New-Item -ItemType Directory -Path $StateDir -Force | Out-Null }

function Write-Log {
  param([string]$Message)
  Add-Content -Path $LogPath -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message) -Encoding UTF8
}

$tld = ($Domain -split '\.')[-1]
$rdap = "https://rdap.verisign.com/$tld/v1/domain/$Domain"

try {
  $data = Invoke-RestMethod -Uri $rdap -TimeoutSec $TimeoutSec
} catch {
  # تعذّر الفحص ليس خبراً سيئاً بحد ذاته — يُسجَّل ولا يُنبَّه، حتى لا يصير
  # انقطاع نت سبباً لإنذار عن الدومين.
  Write-Log "LOOKUP FAILED: $($_.Exception.Message)"
  exit 0
}

$expiryEvent = $data.events | Where-Object { $_.eventAction -eq 'expiration' } | Select-Object -First 1
if (-not $expiryEvent) {
  Write-Log 'LOOKUP OK but no expiration event found'
  exit 0
}

$expiry = [datetime]$expiryEvent.eventDate
$daysLeft = [math]::Floor(($expiry - (Get-Date)).TotalDays)
Write-Log ("expires {0} ({1} days left)" -f $expiry.ToString('yyyy-MM-dd'), $daysLeft)

$state = [ordered]@{ notifiedThresholds = @(); lastCheckAt = $null; expiresAt = $null }
if (Test-Path $StatePath) {
  try {
    $existing = Get-Content $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($k in @($state.Keys)) { if ($null -ne $existing.$k) { $state[$k] = $existing.$k } }
  } catch { }
}
# تاريخ انتهاء جديد يعني أنه جُدِّد — تُصفّر التنبيهات للسنة الجاية.
if ($state['expiresAt'] -and ([datetime]$state['expiresAt']) -lt $expiry) {
  $state['notifiedThresholds'] = @()
  Write-Log 'renewal detected — thresholds reset'
}
$state['expiresAt'] = $expiry.ToString('o')
$state['lastCheckAt'] = (Get-Date).ToString('o')

$notify = Join-Path $PSScriptRoot 'notify-alert.ps1'
foreach ($threshold in ($WarnDays | Sort-Object)) {
  if ($daysLeft -le $threshold -and ($state['notifiedThresholds'] -notcontains $threshold)) {
    $state['notifiedThresholds'] = @($state['notifiedThresholds']) + $threshold
    $message = @"
دومين المحل ($Domain) ينتهي بتاريخ $($expiry.ToString('yyyy-MM-dd')) — باقي $daysLeft يوم.

إذا انتهى: الموقع ما يفتح، والبرنامج ما يلگى السيرفر بالاسم، رغم إن كلشي شغال.

سوّي هسه:
1) جدّده وإنت مرتاح، ويفضّل عدة سنين مرة وحدة بينما الكارت يشتغل.
2) تأكد إن التجديد التلقائي مفعّل وإن الكارت المربوط صالح.
"@
    & $notify -Key 'domain' -Title 'الدومين قرب ينتهي' -Message $message
    break
  }
}

($state | ConvertTo-Json -Depth 4) | Set-Content -Path $StatePath -Encoding UTF8
exit 0
