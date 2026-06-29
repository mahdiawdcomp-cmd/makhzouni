# النسخ الاحتياطي المحلي (Phase 1 — محلي فقط)

نسخة احتياطية يومية آمنة لقاعدة بيانات SQLite الخاصة بتطبيق الديسكتوب،
تعمل **حتى لو البرنامج مغلق** و**بدون إنترنت**.

> هذه المرحلة محلية فقط: لا Sync، لا Google Drive، لا Telegram، لا Restore،
> لا Local Failover. ولا تمسّ نظام البيع أو الفواتير أو المخزون إطلاقاً.

## أين تُحفظ الأشياء

```
%APPDATA%\com.mazbwoni.mahdi\makhzouni.db                  ← قاعدة البيانات الحية (تُقرأ فقط)
%APPDATA%\com.mazbwoni.mahdi\backups\                       ← ملفات النسخ ZIP
%APPDATA%\com.mazbwoni.mahdi\backups\backup-status.json     ← حالة آخر نسخة
%APPDATA%\com.mazbwoni.mahdi\backups\logs\backup-YYYY-MM-DD.log
```

كل نسخة هي ملف:
```
makhzouni-backup-YYYY-MM-DD-HH-mm.zip
```
يحتوي على `makhzouni.db` (والصور بداخلها base64) + `manifest.json`.

## التشغيل اليدوي

من مجلد `inventory-desktop-trial`:
```
npm run backup:local
```
أو مباشرة:
```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup-local.ps1
```

لتجربة على قاعدة في مكان آخر (مثلاً اختبار):
```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup-local.ps1 -AppDataDir "C:\path\to\folder"
```

## التشغيل التلقائي اليومي (Windows Scheduled Task)

افتح PowerShell **كمسؤول (Run as Administrator)** ثم:
```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-backup-task.ps1
```
- يُنشئ مهمة باسم `MakhzouniLocalBackup` تعمل يومياً 02:30 صباحاً.
- تعمل حتى لو التطبيق مغلق وحتى لو المستخدم غير مسجّل دخول (S4U).
- لو الجهاز كان مطفأ وقت الموعد، تُشغَّل لاحقاً عند توفّره (`StartWhenAvailable`).
- لو المهمة موجودة مسبقاً، **تُحدَّث** بدل أن تتكرّر.

لتغيير الوقت أو الاسم:
```
... install-backup-task.ps1 -Time "03:00" -TaskName "MakhzouniLocalBackup"
```

تجربة المهمة فوراً:
```
Start-ScheduledTask -TaskName "MakhzouniLocalBackup"
```

حذف المهمة (لا يحذف النسخ الموجودة):
```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/uninstall-backup-task.ps1
```

## طريقة النسخ الآمنة لـ SQLite

- القاعدة الحية **تُقرأ فقط** — لا كتابة، لا `VACUUM`، لا تعديل.
- يُنسخ `makhzouni.db` مع ملفّي `‎-wal` و`‎-shm` إن وُجدا (الطريقة الموثّقة من
  SQLite لنسخة متّسقة بدون استخدام واجهة الـ backup).
- الموعد الافتراضي 02:30 (المحل مغلق، الباكند المدمج غير شغّال) يجعل النسخة
  باردة ومتّسقة تماماً.

## الفحص والاحتفاظ

- بعد إنشاء الـ ZIP: يُتحقَّق من وجوده، حجمه > صفر، إمكانية فتحه، ووجود
  `makhzouni.db` و`manifest.json` بداخله. أي فشل = النسخة فاشلة **ولا تُحذف
  النسخ القديمة**.
- يُحتفظ بآخر 10 نسخ فقط؛ الأقدم يُحذف تلقائياً (فقط ما يطابق نمط أسمائنا).
