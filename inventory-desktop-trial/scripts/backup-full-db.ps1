<#
.SYNOPSIS
  نسخة شهرية كاملة من قاعدة البيانات نفسها (pg_dump).

.DESCRIPTION
  النسخة اليومية تصدير JSON من السيرفر — ممتازة لاسترجاع بيانات المحل، لكنها
  تمر بالسيرفر وتأخذ ما يصدّره فقط (مثلاً السجلات محدودة بـ٢٠٠، وكلمات المرور
  مستثناة).

  هذي نسخة من القاعدة نفسها: كل جدول وكل عمود، بصيغة pg_dump المضغوطة. هي
  الي تنقذك بالحالة الي ما تكدر توصل فيها حسابك عند المزوّد أصلاً — دفع متوقف،
  أو حساب معلّق — لأنها تُسترجع على أي خادم PostgreSQL ثاني بأمر واحد.

  رابط القاعدة يُقرأ من Railway وقت التشغيل ولا يُكتب على القرص أبداً: سطر
  الاتصال يحمل كلمة سر القاعدة، وملف نصّي فيه هذا السطر أخطر من غياب النسخة.

.PARAMETER OutDir
  مكان النسخ. القرص الثاني افتراضياً.

.PARAMETER KeepCount
  كم نسخة شهرية تبقى. الافتراضي ٣.
#>
[CmdletBinding()]
param(
  [string]$OutDir = 'F:\makhzouni-backups\full',
  # يُحسب بعد الـparam: ‏$PSScriptRoot مو مضمون داخل قيم الافتراض هنا.
  [string]$RepoDir = '',
  [string]$RailwayService = 'Postgres',
  [string]$PgRestore = 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe',
  [int]$KeepCount = 3,
  [int]$MinSizeBytes = 10485760,
  # المهمة المجدولة تشتغل يومياً وتخرج بصمت إلا بهذا اليوم من الشهر — مجدول
  # «شهري» مو مدعوم مباشرة بمجدّول ويندوز من PowerShell 5.1.
  [int]$OnlyOnDayOfMonth = 0,
  [switch]$NoAlert
)

$ErrorActionPreference = 'Stop'

if (-not $RepoDir) { $RepoDir = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent }

$LogDir  = Join-Path $OutDir 'logs'
foreach ($d in @($OutDir, $LogDir)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}
$LogPath = Join-Path $LogDir ("full-db-{0}.log" -f (Get-Date -Format 'yyyy'))

function Write-Log {
  param([string]$Message, [string]$Level = 'INFO')
  $line = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
  Write-Host $line
}

function Send-Alert {
  param([string]$Message)
  if ($NoAlert) { return }
  try {
    & (Join-Path $PSScriptRoot 'notify-alert.ps1') -Key 'full-db' -Title 'النسخة الشهرية الكاملة ما اشتغلت' -Message $Message | Out-Null
  } catch { Write-Log "Alert failed: $($_.Exception.Message)" 'WARN' }
}

if ($OnlyOnDayOfMonth -gt 0 -and (Get-Date).Day -ne $OnlyOnDayOfMonth) { exit 0 }

Write-Log '==== Full DB dump start ===='

# pg_dump ينفّذ داخل حاوية القاعدة، فما نحتاجه محلياً. الي نحتاجه هنا
# pg_restore — للفحص بعد السحب، وهو اختياري.

# ── السحب من داخل حاوية القاعدة عبر Railway ────────────────────────────────
#
# القاعدة ما إلها منفذ عام (الرابط العام عند Railway فارغ — ما أكو TCP proxy)،
# وفتح منفذ عام معناه تعريض قاعدة الإنتاج للإنترنت. بدلها ننفّذ pg_dump جوّا
# الحاوية نفسها — عدها الأداة أصلاً — ونسحب الناتج مرمّزاً base64 عبر نفس
# قناة railway ssh، ونفكّه هنا. ولا كلمة سر تمر بسطر الأوامر ولا منفذ ينفتح.
$stamp    = Get-Date -Format 'yyyy-MM-dd'
$outFile  = Join-Path $OutDir "makhzouni-full-$stamp.dump"
$partFile = "$outFile.part"
$tmpB64   = Join-Path $env:TEMP 'makhzouni-chunk.b64'
$tmpBin   = Join-Path $env:TEMP 'makhzouni-chunk.bin'
$remoteFile = '/tmp/makhzouni-full.dump'
foreach ($f in @($outFile, $partFile)) { if (Test-Path $f) { Remove-Item $f -Force } }

function Invoke-Remote {
  param([string]$Command, [string]$OutFile)
  Push-Location $RepoDir
  try {
    if ($OutFile) {
      & cmd.exe /c "railway ssh --service $RailwayService `"$Command`" > `"$OutFile`" 2>nul"
      return $LASTEXITCODE
    }
    return (& cmd.exe /c "railway ssh --service $RailwayService `"$Command`" 2>nul")
  } finally { Pop-Location }
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()

# ── ١. السحب داخل الحاوية إلى ملف مؤقت ─────────────────────────────────────
# سجلات التدقيق ورسائل الواتساب مستثناة من البيانات (الهيكل يبقى): هما ٩٢٨
# ميغا من أصل ١٫٤ غيغا، وسجل تاريخي لا يقوم عليه استرجاع محل. بدونهما النسخة
# ٣٤٥ ميغا وتوصل كاملة؛ معهما القناة تنقطع بالنص وتطلع نسخة ناقصة — وهذا
# أسوأ من نسخة أصغر، لأنها تبدو موجودة وهي ما تنفع.
Write-Log 'Dumping inside the database container…'
# ‏-h /var/run/postgresql: الاتصال عبر مقبس محلي بلا كلمة سر. الاتصال بالشبكة
# يعتمد على PGPASSWORD المخزونة بالحاوية، وهذي تصير قديمة بلحظة تغيير كلمة
# السر — فالنسخة الشهرية تفشل بصمت لحد أول الشهر الجاي.
$remoteDump = "pg_dump -h /var/run/postgresql -U postgres -d railway -Fc -Z 9 --no-owner --no-acl " +
  "--exclude-table-data='public.audit_logs' --exclude-table-data='public.whatsapp_messages' " +
  "-f $remoteFile && stat -c '%s' $remoteFile && md5sum $remoteFile | cut -d' ' -f1"
$info = Invoke-Remote -Command $remoteDump
$lines = @($info | Where-Object { $_ -match '\S' })
if ($lines.Count -lt 2) {
  Write-Log 'remote pg_dump produced no size/hash' 'ERROR'
  Send-Alert @"
ما كدرت آخذ نسخة كاملة من القاعدة.

جرّب بنافذة أوامر داخل مجلد المشروع:
  railway whoami
  railway ssh --service $RailwayService "echo ok"

إذا طلب تسجيل دخول، سجّل دخول وأعد تشغيل المهمة.
"@
  exit 1
}
$remoteSize = [int64]$lines[-2].Trim()
$remoteMd5  = $lines[-1].Trim()
Write-Log "Remote dump ready: $remoteSize bytes"

# ── ٢. السحب على قطع، وكل قطعة تنعاد لحالها إذا انقطعت ─────────────────────
# جلسة واحدة طويلة انقطعت عند ١٢٤ ميغا بعد سبع دقائق، فالقطعة الواحدة جلسة
# قصيرة مستقلة: انقطاع وحدة يعيدها هي فقط بدل ما يضيّع نصف ساعة.
$chunkMb = 32
$chunkBytes = $chunkMb * 1MB
$chunks = [math]::Ceiling($remoteSize / $chunkBytes)
Write-Log "Transferring $chunks chunk(s) of ${chunkMb}MB"

$out = [System.IO.File]::Open($partFile, [System.IO.FileMode]::Create)
try {
  for ($i = 0; $i -lt $chunks; $i++) {
    $skip = $i * $chunkMb
    $expected = [math]::Min($chunkBytes, $remoteSize - ($i * $chunkBytes))
    $ok = $false
    for ($try = 1; $try -le 3 -and -not $ok; $try++) {
      foreach ($f in @($tmpB64, $tmpBin)) { if (Test-Path $f) { Remove-Item $f -Force } }
      $code = Invoke-Remote -Command "dd if=$remoteFile bs=1M skip=$skip count=$chunkMb 2>/dev/null | base64 -w 76" -OutFile $tmpB64
      if ($code -eq 0 -and (Test-Path $tmpB64)) {
        & certutil.exe -decode $tmpB64 $tmpBin | Out-Null
        if ($LASTEXITCODE -eq 0 -and (Test-Path $tmpBin) -and (Get-Item $tmpBin).Length -eq $expected) {
          $bytes = [System.IO.File]::ReadAllBytes($tmpBin)
          $out.Write($bytes, 0, $bytes.Length)
          $ok = $true
        }
      }
      if (-not $ok) { Write-Log "chunk $($i+1)/$chunks attempt $try failed" 'WARN'; Start-Sleep -Seconds 5 }
    }
    if (-not $ok) {
      $out.Close()
      Remove-Item $partFile -Force -ErrorAction SilentlyContinue
      Write-Log "chunk $($i+1)/$chunks failed after 3 attempts" 'ERROR'
      Invoke-Remote -Command "rm -f $remoteFile" | Out-Null
      Send-Alert "انقطع سحب النسخة الكاملة عند القطعة $($i+1) من $chunks. راجع السجل:`n$LogPath"
      exit 1
    }
    if ((($i + 1) % 4) -eq 0 -or ($i + 1) -eq $chunks) {
      Write-Log ("  {0}/{1} chunks ({2} MB)" -f ($i + 1), $chunks, [math]::Round($out.Length / 1MB))
    }
  }
} finally {
  $out.Close()
  foreach ($f in @($tmpB64, $tmpBin)) { if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue } }
}

Invoke-Remote -Command "rm -f $remoteFile" | Out-Null

# ── ٣. التحقق من أن الي وصل هو نفسه الي طلع ────────────────────────────────
$localSize = (Get-Item $partFile).Length
$localMd5 = (Get-FileHash -Path $partFile -Algorithm MD5).Hash.ToLower()
if ($localSize -ne $remoteSize -or $localMd5 -ne $remoteMd5) {
  Write-Log "checksum mismatch (size $localSize/$remoteSize)" 'ERROR'
  Remove-Item $partFile -Force -ErrorAction SilentlyContinue
  Send-Alert 'النسخة الكاملة وصلت ناقصة أو مشوّهة (البصمة ما تطابق). ما انحفظت.'
  exit 1
}
Move-Item $partFile $outFile -Force

$size = (Get-Item $outFile).Length
if ($size -lt $MinSizeBytes) {
  Write-Log "Dump too small: $size bytes" 'ERROR'
  Send-Alert "النسخة الكاملة طلعت صغيرة بشكل مريب ($size بايت) — يعني ناقصة. الملف:`n$outFile"
  exit 1
}

# ── فحص أن الملف يُقرأ فعلاً، لا أنه موجود فقط ─────────────────────────────
if (Test-Path $PgRestore) {
  $tables = (& $PgRestore --list $outFile 2>$null | Select-String -Pattern 'TABLE DATA' | Measure-Object).Count
  if ($tables -lt 5) {
    Write-Log "pg_restore --list shows only $tables tables" 'ERROR'
    Send-Alert "النسخة الكاملة ما تنقرأ صح — عدد الجداول بيها $tables فقط."
    exit 1
  }
  Write-Log "Verified: $tables tables with data"
}

Write-Log ("Dump OK: {0} bytes in {1} min" -f $size, [math]::Round($sw.Elapsed.TotalMinutes, 1))

# ── إبقاء آخر N نسخ ────────────────────────────────────────────────────────
$all = Get-ChildItem -Path $OutDir -Filter 'makhzouni-full-*.dump' -File | Sort-Object Name -Descending
foreach ($old in ($all | Select-Object -Skip $KeepCount)) {
  try { Remove-Item $old.FullName -Force; Write-Log "Retention: deleted $($old.Name)" }
  catch { Write-Log "Retention: could not delete $($old.Name)" 'WARN' }
}

Write-Log '==== Full DB dump end ===='
exit 0
