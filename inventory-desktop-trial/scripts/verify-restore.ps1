<#
.SYNOPSIS
  تجربة استرجاع فعلية على قاعدة تجريبية — شهرياً.

.DESCRIPTION
  الفحص الأسبوعي يتأكد إن النسخة تنفتح وأعدادها معقولة. هذا أبعد: يبني قاعدة
  فاضية، يسترجع عليها النسخة الأخيرة فعلاً، ويعدّ الصفوف بعدها.

  السبب إنه لازم: أول استرجاع حقيقي (١٣ أيلول ٢٠٢٦) كشف ثلاث مشاكل ما ظهرت
  بأي فحص نظري. نسخة ما انجرّبت مو نسخة، ملف بس.

  يشتغل على PostgreSQL محلي على هذا الجهاز، وينشئ قاعدة باسم مؤقت ويحذفها
  بالنهاية. ما يلمس قاعدة الإنتاج ولا قاعدة التطوير.
#>
[CmdletBinding()]
param(
  [string]$AppDataDir = (Join-Path $env:APPDATA 'com.mazbwoni.mahdi'),
  [string]$RepoDir = '',
  [string]$ScratchDb = 'makhzouni_restore_test',
  [string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin',
  [int]$BootPort = 5099,
  [int]$OnlyOnDayOfMonth = 0,
  [string]$BackupFile = '',
  [switch]$NoAlert
)

$ErrorActionPreference = 'Stop'
if (-not $RepoDir) { $RepoDir = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent }
$BackendDir = Join-Path $RepoDir 'inventory-backend'

$StateDir = Join-Path $AppDataDir 'monitor'
$LogPath  = Join-Path $StateDir ("restore-test-{0}.log" -f (Get-Date -Format 'yyyy'))
$StatePath = Join-Path $StateDir 'restore-test.json'
if (-not (Test-Path $StateDir)) { New-Item -ItemType Directory -Path $StateDir -Force | Out-Null }

function Write-Log {
  param([string]$Message)
  Add-Content -Path $LogPath -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message) -Encoding UTF8
  Write-Host $Message
}

function Send-Alert {
  param([string]$Title, [string]$Message)
  if ($NoAlert) { return }
  try { & (Join-Path $PSScriptRoot 'notify-alert.ps1') -Key 'restore-test' -Title $Title -Message $Message | Out-Null }
  catch { Write-Log "alert failed: $($_.Exception.Message)" }
}

if ($OnlyOnDayOfMonth -gt 0 -and (Get-Date).Day -ne $OnlyOnDayOfMonth) { exit 0 }

Write-Log '==== Restore test start ===='

# ── القاعدة المحلية: بياناتها من ملف بيئة التطوير، ما تنكتب بأي مكان ثاني ──
$envFile = Join-Path $BackendDir '.env'
if (-not (Test-Path $envFile)) {
  Write-Log 'no local .env'
  Send-Alert 'تجربة الاسترجاع ما اشتغلت' "ما لكيت ملف الإعدادات المحلي:`n$envFile"
  exit 1
}
$devUrl = (Get-Content $envFile -Encoding UTF8 |
  Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } |
  Select-Object -First 1) -replace '^\s*DATABASE_URL\s*=\s*', '' -replace '^"|"$', ''
if ($devUrl -notmatch '^postgres(ql)?://([^:]+):([^@]*)@([^:/]+):(\d+)/') {
  Write-Log 'local DATABASE_URL unparsable'
  Send-Alert 'تجربة الاسترجاع ما اشتغلت' 'رابط القاعدة المحلية بملف الإعدادات مو بالشكل المتوقع.'
  exit 1
}
$pgUser = $Matches[2]; $pgPass = $Matches[3]; $pgHost = $Matches[4]; $pgPort = $Matches[5]
$scratchUrl = "postgresql://${pgUser}:${pgPass}@${pgHost}:${pgPort}/${ScratchDb}"
$env:PGPASSWORD = $pgPass

$psql = Join-Path $PgBin 'psql.exe'
if (-not (Test-Path $psql)) {
  Write-Log "psql not found at $psql"
  Send-Alert 'تجربة الاسترجاع ما اشتغلت' "أداة psql مو موجودة بالمسار:`n$psql"
  exit 1
}

function Invoke-Psql {
  param([string]$Database, [string]$Sql)
  # ‏stderr ما يُدمج عمداً: psql يكتب NOTICE هناك (مثل «القاعدة مو موجودة،
  # تخطّيت»)، ومع ErrorActionPreference=Stop كان الدمج يحوّل ملاحظة عادية إلى
  # فشل يوقف التجربة كلها.
  # التحويل يتم داخل cmd لا داخل PowerShell: ‏PowerShell 5.1 يلفّ كل سطر stderr
  # من برنامج خارجي بسجل خطأ، فحتى NOTICE عادية كانت تصير فشلاً.
  $cmd = '"{0}" -h {1} -p {2} -U {3} -d {4} -t -A -v ON_ERROR_STOP=1 -c "{5}" 2>nul' -f `
    $psql, $pgHost, $pgPort, $pgUser, $Database, ($Sql -replace '"', '""')
  $result = & cmd.exe /c $cmd
  if ($LASTEXITCODE -ne 0) { throw "psql failed on: $Sql" }
  return $result
}

# ── النسخة الي راح تتجرب ───────────────────────────────────────────────────
if (-not $BackupFile) {
  $newest = Get-ChildItem -Path (Join-Path $AppDataDir 'backups-online') -Filter 'makhzouni-online-*.zip' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $newest) {
    Write-Log 'no backup to test'
    Send-Alert 'ماكو نسخة لتجربتها' 'ما لكيت أي نسخة احتياطية لتجربة الاسترجاع عليها.'
    exit 1
  }
  $BackupFile = $newest.FullName
}
Write-Log "Testing $BackupFile"

$expected = @{}
Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
  $zip = [System.IO.Compression.ZipFile]::OpenRead($BackupFile)
  try {
    $entry = $zip.Entries | Where-Object { $_.FullName -eq 'manifest.json' }
    $reader = New-Object System.IO.StreamReader($entry.Open())
    try { $m = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    foreach ($p in $m.counts.PSObject.Properties) { $expected[$p.Name] = [int]$p.Value }
  } finally { $zip.Dispose() }
} catch {
  Write-Log "manifest unreadable: $($_.Exception.Message)"
  Send-Alert 'النسخة ما تنقرأ' "ما كدرت أقرأ المانيفست من:`n$BackupFile"
  exit 1
}

$ok = $false
try {
  # ── ١. قاعدة فاضية ───────────────────────────────────────────────────────
  Write-Log "Recreating $ScratchDb"
  Invoke-Psql -Database 'postgres' -Sql "DROP DATABASE IF EXISTS $ScratchDb WITH (FORCE)" | Out-Null
  Invoke-Psql -Database 'postgres' -Sql "CREATE DATABASE $ScratchDb" | Out-Null

  Push-Location $BackendDir
  try {
    # ── ٢. الترحيلات ───────────────────────────────────────────────────────
    $env:DATABASE_URL = $scratchUrl
    Write-Log 'prisma migrate deploy…'
    # داخل cmd للسبب نفسه أعلاه: prisma يكتب أسطراً عادية على stderr.
    $migrateOut = & cmd.exe /c 'npx prisma migrate deploy 2>&1'
    $migrateExit = $LASTEXITCODE
    $migrateOut | Select-Object -Last 3 | ForEach-Object { Write-Log "  $_" }
    if ($migrateExit -ne 0) { throw 'prisma migrate deploy failed' }

    # ── ٣. إقلاع الخادم مرة وحدة ───────────────────────────────────────────
    # الترحيلات وحدها ما تكمّل الهيكل: أعمدة تُضاف عند الإقلاع. بدون هالخطوة
    # الاسترجاع يوقف بنص الطريق بعمود مفقود.
    Write-Log 'booting server once to apply boot-time columns…'
    $env:PORT = "$BootPort"
    # عبر cmd: ‏npx ملف أوامر لا برنامج تنفيذي، وStart-Process عليه مباشرة
    # يفشل بـ«ليس تطبيق Win32 صالح».
    $boot = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npx tsx src/server.ts' -PassThru -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $env:TEMP 'restore-boot.log') -RedirectStandardError (Join-Path $env:TEMP 'restore-boot.err')
    $ready = $false
    for ($i = 0; $i -lt 60 -and -not $ready; $i++) {
      Start-Sleep -Seconds 2
      $ready = (Invoke-Psql -Database $ScratchDb -Sql "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='is_both')") -match 't'
    }
    # ‏/T حتى ينقتل node الي تحت cmd: قتل الأب وحده يخلي الخادم شغالاً وماسكاً
    # القاعدة التجريبية، فما تنحذف بالنهاية.
    & cmd.exe /c "taskkill /PID $($boot.Id) /T /F >nul 2>nul"
    if (-not $ready) { throw 'boot-time columns never appeared' }

    # ── ٤. الاسترجاع ───────────────────────────────────────────────────────
    Write-Log 'restoring…'
    $out = & cmd.exe /c "npx tsx src/scripts/restore-from-backup.ts --file `"$BackupFile`" --target `"$scratchUrl`" --wipe 2>&1"
    $restoreExit = $LASTEXITCODE
    $out | Select-Object -Last 6 | ForEach-Object { Write-Log "  $_" }
    if ($restoreExit -ne 0) { throw "restore exited $restoreExit" }
  } finally {
    Pop-Location
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:PORT -ErrorAction SilentlyContinue
  }

  # ── ٥. العدّ بعد الاسترجاع ───────────────────────────────────────────────
  # أسماء الجداول الفعلية بالقاعدة، لا أسماء النماذج: «السندات» جدولها
  # payment_vouchers، وتسميته vouchers كانت تفشل الفحص بعد استرجاع ناجح.
  $checks = @{ invoices = 'invoices'; products = 'products'; customers = 'customers'; vouchers = 'payment_vouchers' }
  $problems = @()
  foreach ($key in $checks.Keys) {
    $want = $expected[$key]
    if (-not $want) { continue }
    $got = [int](Invoke-Psql -Database $ScratchDb -Sql "SELECT count(*) FROM $($checks[$key])")
    Write-Log ("  {0}: backup {1} -> restored {2}" -f $key, $want, $got)
    # النقص يعني استرجاعاً ناقصاً. الزيادة مستحيلة على قاعدة انمسحت قبلها.
    if ($got -lt $want) { $problems += "$key`: بالنسخة $want، انسترجع $got" }
  }

  if ($problems.Count -gt 0) {
    Send-Alert 'الاسترجاع طلع ناقص' @"
جرّبت استرجاع آخر نسخة على قاعدة تجريبية، وطلع ناقص:

$($problems -join "`n")

يعني النسخة موجودة بس ما تسترجع كاملة. لا تعتمد عليها قبل ما تنحل.
"@
  } else {
    $ok = $true
    Write-Log 'RESTORE TEST PASSED'
  }
} catch {
  Write-Log "FAILED: $($_.Exception.Message)"
  Send-Alert 'تجربة الاسترجاع فشلت' @"
ما كدرت أسترجع آخر نسخة على قاعدة تجريبية.

السبب: $($_.Exception.Message)

راجع السجل:
$LogPath
"@
} finally {
  # القاعدة التجريبية تنحذف دائماً — نجحت أو فشلت.
  try { Invoke-Psql -Database 'postgres' -Sql "DROP DATABASE IF EXISTS $ScratchDb WITH (FORCE)" | Out-Null } catch { }
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

$state = [ordered]@{
  checkedAt = (Get-Date).ToString('o')
  backupFile = Split-Path $BackupFile -Leaf
  passed = $ok
}
($state | ConvertTo-Json -Depth 3) | Set-Content -Path $StatePath -Encoding UTF8
Write-Log '==== Restore test end ===='
if ($ok) { exit 0 } else { exit 1 }
