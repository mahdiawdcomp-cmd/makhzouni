<#
.SYNOPSIS
  مراقبة سيرفر المحل — ينبّهك إذا وقف، بدل ما تكتشفها من زبون.

.DESCRIPTION
  يسأل نقطة /health كل ما تشتغل المهمة (كل ٥ دقائق افتراضياً). النقطة عامة،
  ما تحتاج تسجيل دخول، وما تمسّ أي بيانات.

  التنبيه يطلع بعد ٣ فشل متتالية لا بعد أول فشل: انقطاع نت للحظة أو إعادة نشر
  عادية تعطي فشلاً واحداً، وتنبيه على كل واحدة منها يعلّمك تتجاهل التنبيهات —
  وقتها ما ينفع بشي.

  ويُنبّه مرة وحدة لكل انقطاع، ومرة ثانية عند الرجوع، حتى تعرف انتهت.

.PARAMETER Url
  عنوان الفحص. افتراضياً سيرفر المحل.

.PARAMETER FailuresBeforeAlert
  كم فشل متتالي قبل التنبيه.
#>
[CmdletBinding()]
param(
  [string]$Url = 'https://api.mazbwoni.com/health',
  [string]$AppDataDir = (Join-Path $env:APPDATA 'com.mazbwoni.mahdi'),
  [int]$FailuresBeforeAlert = 3,
  [int]$TimeoutSec = 15
)

$ErrorActionPreference = 'Stop'

$StateDir  = Join-Path $AppDataDir 'monitor'
$StatePath = Join-Path $StateDir 'server-state.json'
$LogPath   = Join-Path $StateDir ("monitor-{0}.log" -f (Get-Date -Format 'yyyy-MM'))
if (-not (Test-Path $StateDir)) { New-Item -ItemType Directory -Path $StateDir -Force | Out-Null }

function Write-Log {
  param([string]$Message)
  Add-Content -Path $LogPath -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message) -Encoding UTF8
}

$state = [ordered]@{
  consecutiveFailures = 0
  downSince           = $null
  alerted             = $false
  lastOkAt            = $null
  lastCheckAt         = $null
}
if (Test-Path $StatePath) {
  try {
    $existing = Get-Content $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($k in @($state.Keys)) { if ($null -ne $existing.$k) { $state[$k] = $existing.$k } }
  } catch { }
}

$ok = $false
try {
  $response = Invoke-WebRequest -Uri $Url -TimeoutSec $TimeoutSec -UseBasicParsing
  # أي جواب يعني السيرفر واصل وشغّال؛ حتى خطأ ٥٠٠ مو انقطاع.
  $ok = $response.StatusCode -ge 200
} catch {
  # جواب بحالة خطأ ما هو انقطاع — الانقطاع هو ألا يصل جواب أصلاً.
  if ($_.Exception.Response -and $_.Exception.Response.StatusCode) { $ok = $true }
  else { $ok = $false }
}

$state['lastCheckAt'] = (Get-Date).ToString('o')
$notify = Join-Path $PSScriptRoot 'notify-alert.ps1'

if ($ok) {
  $wasAlerted = [bool]$state['alerted']
  $downSince  = $state['downSince']
  $state['consecutiveFailures'] = 0
  $state['downSince'] = $null
  $state['alerted'] = $false
  $state['lastOkAt'] = (Get-Date).ToString('o')
  Write-Log "OK"
  if ($wasAlerted) {
    $minutes = if ($downSince) { [math]::Round(((Get-Date) - [datetime]$downSince).TotalMinutes) } else { 0 }
    Write-Log "RECOVERED after ~$minutes min"
    & $notify -Key 'server' -Title 'السيرفر رجع يشتغل' -Message "السيرفر رجع بعد ما كان واقف حوالي $minutes دقيقة. تأكد إن الشغل ماشي، وإذا بعت على ورق وقت الانقطاع دخّل الفواتير."
  }
} else {
  $state['consecutiveFailures'] = [int]$state['consecutiveFailures'] + 1
  if (-not $state['downSince']) { $state['downSince'] = (Get-Date).ToString('o') }
  Write-Log ("FAIL ({0})" -f $state['consecutiveFailures'])

  if ($state['consecutiveFailures'] -ge $FailuresBeforeAlert -and -not $state['alerted']) {
    $state['alerted'] = $true
    $message = @"
سيرفر المحل ما يرد من $($state['consecutiveFailures']) محاولات متتالية.

افحص بالترتيب:
1) افتح الموقع من موبايلك على بيانات الموبايل — إذا فتح، المشكلة بإنترنت المحل.
2) إذا ما فتح، افحص حساب الاستضافة: يمكن الدفع الشهري ما تم.
3) البرنامج بالكمبيوتر يكدر يشتغل على الرابط البديل من الإعدادات ← ربط السيرفر.
4) إذا طوّلت، كمّل بيعك على ورق ودخّله بعدين — لا تعتمد على الذاكرة.

العنوان المفحوص: $Url
"@
    & $notify -Key 'server' -Title 'السيرفر ما يرد' -Message $message
  }
}

($state | ConvertTo-Json -Depth 4) | Set-Content -Path $StatePath -Encoding UTF8
exit 0
