<#
.SYNOPSIS
  فحص أسبوعي: هل النسخ تنزل فعلاً، وهل بيها بيانات المحل كاملة؟

.DESCRIPTION
  وجود ملف نسخة ما يعني إنها تنفع. الفحص هنا ثلاث طبقات:

   ١. النسخة حديثة — لو المهمة وقفت (مثل ما صار من ١٨ أيلول ٢٠٢٦ وما انتبه
      أحد لأسبوع) هذا الفحص يصيح.
   ٢. الملف يُفتح فعلاً وفيه manifest بأعداد السجلات.
   ٣. الأعداد ما نزلت فجأة عن آخر فحص ناجح — تصدير يشتغل ويطلع ناقصاً أخطر
      من تصدير يفشل، لأنه يبدو سليماً.

  وما يفك الـ٢٨٦ ميغا JSON: المانيفست جوّا الزب يحمل الأعداد أصلاً.
#>
[CmdletBinding()]
param(
  [string]$AppDataDir = (Join-Path $env:APPDATA 'com.mazbwoni.mahdi'),
  [string]$MirrorDir = 'F:\makhzouni-backups',
  [int]$MaxAgeDays = 3,
  # نزول بهذي النسبة أو أكثر بأي عدّاد = إنذار. الأعداد تكبر عادة؛ النزول
  # البسيط وارد (أرشفة/حذف)، والنزول الكبير يعني تصديراً ناقصاً.
  [int]$DropPercentAlert = 20,
  [switch]$NoAlert
)

$ErrorActionPreference = 'Stop'

$BackupDir = Join-Path $AppDataDir 'backups-online'
$StateDir  = Join-Path $AppDataDir 'monitor'
$StatePath = Join-Path $StateDir 'backup-health.json'
$LogPath   = Join-Path $StateDir ("backup-health-{0}.log" -f (Get-Date -Format 'yyyy'))
if (-not (Test-Path $StateDir)) { New-Item -ItemType Directory -Path $StateDir -Force | Out-Null }

function Write-Log {
  param([string]$Message)
  Add-Content -Path $LogPath -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message) -Encoding UTF8
  Write-Host $Message
}

function Send-Alert {
  param([string]$Title, [string]$Message)
  if ($NoAlert) { return }
  try { & (Join-Path $PSScriptRoot 'notify-alert.ps1') -Key 'backup-health' -Title $Title -Message $Message | Out-Null }
  catch { Write-Log "alert failed: $($_.Exception.Message)" }
}

# ── ١. أحدث نسخة ───────────────────────────────────────────────────────────
$newest = $null
if (Test-Path $BackupDir) {
  $newest = Get-ChildItem -Path $BackupDir -Filter 'makhzouni-online-*.zip' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if (-not $newest) {
  Write-Log 'NO BACKUP FILES'
  Send-Alert 'ماكو نسخ احتياطية' @"
ما لكيت ولا نسخة احتياطية بالمجلد:
$BackupDir

معناها المهمة اليومية مو شغالة. شغّلها من نافذة أوامر:
  Start-ScheduledTask -TaskName 'MakhzouniOnlineBackup'
"@
  exit 1
}

$ageDays = [math]::Round(((Get-Date) - $newest.LastWriteTime).TotalDays, 1)
if ($ageDays -gt $MaxAgeDays) {
  Write-Log "STALE: newest backup is $ageDays days old"
  Send-Alert 'النسخ الاحتياطية وقفت' @"
آخر نسخة عمرها $ageDays يوم، والمفروض تنزل كل يوم.

الملف: $($newest.Name)
شغّل المهمة وشوف شنو يطلع:
  Start-ScheduledTask -TaskName 'MakhzouniOnlineBackup'
"@
  exit 1
}

# ── ٢. الملف يُفتح وفيه مانيفست ────────────────────────────────────────────
Add-Type -AssemblyName System.IO.Compression.FileSystem
$manifest = $null
try {
  $zip = [System.IO.Compression.ZipFile]::OpenRead($newest.FullName)
  try {
    $entry = $zip.Entries | Where-Object { $_.FullName -eq 'manifest.json' }
    if ($entry) {
      $reader = New-Object System.IO.StreamReader($entry.Open())
      try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    }
  } finally { $zip.Dispose() }
} catch {
  Write-Log "UNREADABLE: $($_.Exception.Message)"
  Send-Alert 'النسخة الاحتياطية ما تنفتح' @"
آخر نسخة ما تنفتح — يعني تالفة وما تنفع للاسترجاع.

الملف: $($newest.FullName)
"@
  exit 1
}

if (-not $manifest -or -not $manifest.counts) {
  Write-Log 'NO MANIFEST COUNTS'
  Send-Alert 'النسخة بلا مانيفست' "آخر نسخة ($($newest.Name)) ما بيها manifest بأعداد السجلات."
  exit 1
}

# ── ٣. المقارنة مع آخر فحص ناجح ────────────────────────────────────────────
$counts = @{}
foreach ($p in $manifest.counts.PSObject.Properties) { $counts[$p.Name] = [int]$p.Value }
$core = @('products', 'customers', 'invoices', 'vouchers')
$empty = $core | Where-Object { -not $counts.ContainsKey($_) -or $counts[$_] -le 0 }
if ($empty.Count -gt 0) {
  Write-Log ("EMPTY CORE: " + ($empty -join ', '))
  Send-Alert 'النسخة طالعة فارغة' @"
آخر نسخة ما بيها بيانات بهذي الأقسام: $($empty -join '، ')

يعني التصدير اشتغل بس طلع ناقص. لا تعتمد عليها.
"@
  exit 1
}

$previous = $null
if (Test-Path $StatePath) {
  try { $previous = Get-Content $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
}

$drops = @()
if ($previous -and $previous.counts) {
  foreach ($p in $previous.counts.PSObject.Properties) {
    $was = [int]$p.Value
    if ($was -le 0 -or -not $counts.ContainsKey($p.Name)) { continue }
    $now = $counts[$p.Name]
    $dropPct = [math]::Round((($was - $now) / $was) * 100)
    if ($dropPct -ge $DropPercentAlert) { $drops += "$($p.Name): $was → $now (نزل $dropPct٪)" }
  }
}

$mirrorNewest = $null
if (Test-Path $MirrorDir) {
  $mirrorNewest = Get-ChildItem -Path $MirrorDir -Filter 'makhzouni-online-*.zip' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

Write-Log ("OK: {0} ({1} MB, {2} days old) invoices={3} products={4} customers={5} mirror={6}" -f `
  $newest.Name, [math]::Round($newest.Length / 1MB), $ageDays, $counts['invoices'], $counts['products'], $counts['customers'],
  $(if ($mirrorNewest) { 'yes' } else { 'no' }))

if ($drops.Count -gt 0) {
  Write-Log ("DROPS: " + ($drops -join ' | '))
  Send-Alert 'أعداد النسخة نزلت فجأة' @"
آخر نسخة أعدادها أقل بكثير من الي قبلها:

$($drops -join "`n")

يمكن تكون أرشفة عادية، ويمكن يكون التصدير ناقص. تأكد قبل ما تعتمد عليها.
"@
}

if (-not $mirrorNewest) {
  Send-Alert 'ماكو نسخة ثانية' @"
النسخة اليومية موجودة على الجهاز، بس ماكو نسخة ثانية بالمجلد:
$MirrorDir

نسخة وحدة على نفس الجهاز ما تحميك من عطل قرص ولا سرقة.
"@
}

$state = [ordered]@{
  checkedAt  = (Get-Date).ToString('o')
  backupFile = $newest.Name
  backupSize = $newest.Length
  ageDays    = $ageDays
  hasMirror  = [bool]$mirrorNewest
  counts     = $counts
}
($state | ConvertTo-Json -Depth 5) | Set-Content -Path $StatePath -Encoding UTF8
exit 0
