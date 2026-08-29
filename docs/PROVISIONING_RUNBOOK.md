# Provisioning Runbook — إضافة زبون (Tenant) جديد من الصفر

> آخر تحديث: 2026-07-05 (دفعة 22B).
> المرجع المعماري: كل زبون له **backend خاص + قاعدة بيانات خاصة** على Railway،
> والواجهة مشتركة واحدة على Vercel تحلّ الـ subdomain ديناميكياً عبر
> `admin-api.mazbwoni.com/api/tenant-config`.

**قاعدة ذهبية:** لا تلمس tenant "mahdi" ولا بياناته. كل الخطوات هنا تخص الزبون الجديد فقط.

---

## A) Super Admin — إنشاء سجل الـ Tenant

من لوحة `https://admin.mazbwoni.com` (أو `POST /api/tenants` على admin-api):

1. **Create Tenant** بالحقول:
   - `name`: اسم المحل.
   - `ownerName`, `phone`, `email`.
   - `subdomain`: أحرف صغيرة وأرقام وشرطات فقط (مثال: `alsalem`).
   - `backendUrl`: رابط خدمة Railway التي ستُنشأ في الخطوة B
     (يمكن وضعه لاحقاً بالتعديل إذا لم تُنشأ الخدمة بعد — لكن لا تتركه placeholder عند التسليم).
   - `subscription`: الخطة (BASIC مثلاً) + `expiresAt` + الحدود (`maxUsers`, `maxWarehouses`, ...).
2. **Entitlements (تبويب الترخيص):**
   - `licenseType`: SAAS أو TRIAL (مع `trialEndsAt`).
   - `features`: فعّل فقط الميزات المبنية والمطلوبة، مثلاً:
     `catalogWholesale`, `whatsappInvoices`, `auditLog`, `transfers`, `stocktake`, `dailyClosing`.
     **تحذير:** `features: []` تعني "كل شيء مفتوح" (fail-open) — عبّئها صراحة لكل زبون جديد.
   - `platforms`: `webEnabled: true` والباقي حسب المبيعة.
   - `limits`: `maxAndroidDevices` وحد الواتساب إذا مطلوب.
3. **Serial** (للأندرويد فقط): Generate Serial من صفحة الـ tenant.
4. سجّل الـ `tenantId` (UUID) — تحتاجه في الخطوة B.

## B) Railway — إنشاء backend خاص بالزبون

1. أنشئ **service جديدة** في مشروع Railway من نفس الريبو
   (Root Directory = `inventory-backend`). سمّها `<subdomain>-api`.
2. أنشئ **Postgres جديدة** خاصة بالزبون (لا تشارك قاعدة زبون آخر أبداً).
3. **Variables** على الخدمة الجديدة:

   | المتغير | القيمة |
   |---|---|
   | `DATABASE_URL` | رابط Postgres الجديدة |
   | `JWT_SECRET` | سلسلة عشوائية قوية جديدة (لا تعيد استخدام سر زبون آخر) |
   | `TENANT_ID` | الـ UUID من الخطوة A |
   | `SUPER_ADMIN_API_URL` | `https://admin-api.mazbwoni.com` |
   | `SUPER_ADMIN_API_KEY` | نفس `JWT_SECRET` مال saas-admin-api |
   | `NODE_ENV` | `production` |
   | `BACKUP_SECRET` | سر قوي خاص بالزبون (للنسخ الاحتياطي الخارجي) |
   | `INITIAL_ADMIN_USERNAME` / `INITIAL_ADMIN_PASSWORD` / `INITIAL_ADMIN_NAME` | (اختياري) لإنشاء أول admin تلقائياً عند أول إقلاع |

   ملاحظات:
   - **CORS لا يحتاج إعداد**: الكود يسمح تلقائياً بأي `https://*.mazbwoni.com`.
   - `ENABLE_WHATSAPP` اتركه غير مفعّل حتى يُجهّز الواتساب من صفحة الإعدادات (Cloud API / Green API).
4. **Migrations**: أول deploy شغّل
   `npx prisma migrate deploy`
   (من Railway shell أو كـ release command). **لا تستخدم `migrate dev` ولا `seed` على production.**
5. **أول admin user** — طريقتان (اختر واحدة):
   - **env (الأسهل):** ضع `INITIAL_ADMIN_USERNAME/PASSWORD/NAME` قبل أول إقلاع —
     `ensureInitialAdmin()` ينشئه تلقائياً إذا كانت قاعدة البيانات فارغة من المستخدمين، ثم احذف المتغيرين.
   - **سكربت يدوي:** من جهازك مع `DATABASE_URL` مؤقت يشير لقاعدة الزبون:
     ```
     cd inventory-backend
     set FIRST_ADMIN_PASSWORD=<كلمة مرور قوية>
     npm run create:first-admin -- --username <user> --name "مدير المحل"
     ```
     السكربت **يرفض** العمل إذا يوجد مستخدمون مسبقاً (حماية من تشغيله على قاعدة خاطئة).
   - **ممنوع نهائياً:** `npm run seed` — يمسح كل البيانات وينشئ حسابات تجريبية بكلمة مرور معروفة.
6. حدّث `backendUrl` في Super Admin إلى رابط الخدمة الجديدة إذا لم يكن مضبوطاً.

## C) DNS — Cloudflare

> لا يوجد wildcard حالياً — كل subdomain يُضاف يدوياً.

1. في Cloudflare (zone `mazbwoni.com`): أضف CNAME
   `<subdomain>` → `cname.vercel-dns.com` (DNS only أو Proxied حسب إعداد بقية الـ subdomains — طابق `makhzouni-qa`).
2. **تحسين مستقبلي:** سجل wildcard `*.mazbwoni.com` → Vercel يلغي هذه الخطوة نهائياً لكل زبون قادم.

## D) Vercel — ربط الدومين بالواجهة المشتركة

1. مشروع `inventory-web` على Vercel → Settings → Domains → Add:
   `<subdomain>.mazbwoni.com`.
2. لا تنشئ مشروع Vercel جديد لكل زبون — الواجهة مشتركة، والـ resolver في
   `src/api/client.ts` يقرأ الـ subdomain ويطلب `tenant-config` تلقائياً.
3. (`saas-admin-api/SETUP.md` القديم يذكر مشروعاً منفصلاً لكل زبون — **متجاوز**، هذا الـ runbook هو المرجع.)

## E) Verification / Doctor Checklist

> **بوابتان لا يُسلَّم المحل قبلهما.** كلاهما كان مكتوباً في هذا الدليل ومع ذلك
> سُلِّم محل زبون حقيقي بدونهما وبقي شهوراً هكذا — لأن لا شيء كان يمنع التسليم.
>
> 1. **الارتباط:** بطاقة المحل في لوحة الإدارة تقول «موصول»، وفحص الجاهزية أخضر.
>    إذا قالت «غير موصول» فالمحل خارج سيطرتك تماماً: الإيقاف وتاريخ الانتهاء
>    والمزايا لا تصل إليه إطلاقاً. هذا فشل أحمر في الفحص، وليس تحذيراً.
> 2. **النسخ الاحتياطي:** نسخة واحدة على الأقل نزلت فعلاً ونجحت (القسم F).
>    بدونها، ضياع قاعدة الزبون ضياع نهائي.

نفّذها بالترتيب قبل تسليم الزبون:

- [ ] `https://admin-api.mazbwoni.com/api/tenant-config?subdomain=<sub>` يرجع الـ tenant الصحيح (الاسم، backendUrl، status=ACTIVE).
- [ ] `https://<backend>/health` يرجع `{"status":"ok"}`.
- [ ] `https://<sub>.mazbwoni.com` يفتح صفحة تسجيل الدخول (DNS + Vercel domain شغالين).
- [ ] `https://<sub>.mazbwoni.com/api/tenant-info` — عبر الواجهة أو مباشرة من backend الزبون:
      `mode=saas`، `tenantId` الصحيح، الخطة والميزات مطابقة لما ضبطته.
- [ ] Login بأول admin ينجح، وتغيير كلمة المرور يعمل.
- [ ] Smoke test أساسي: إنشاء منتج → زبون → فاتورة تجريبية واحدة ثم حذفها/إلغاؤها (داخل قاعدة الزبون الجديد فقط).
- [ ] زر Doctor في Super Admin (صفحة الـ tenant) أخضر: يقارن سجل Super Admin مع الواقع الحي.
- [ ] لا رسائل WhatsApp ولا OTP حقيقية أُرسلت أثناء الفحص.
- [ ] تأكد أن `mahdi` و`makhzouni-qa` لم يتأثرا (فتح سريع لكل واحد).
- [ ] احذف/عطّل أي بيانات smoke test قبل التسليم.

## F) النسخ الاحتياطي للزبون — خطوة إلزامية

كل محل قاعدة بيانات منفصلة، فلكل محل سرّه ومهمّته الخاصة.

1. ولّد سراً قوياً وضعه على خدمة الباكند في Railway باسم `BACKUP_SECRET`،
   ثم أعد نشر الخدمة كي تلتقطه.
2. خزّن نفس السر على جهازك بمتغيّر بيئة **خاص بهذا المحل** (لا تعِد استخدام سر محل آخر):

   ```
   setx MAKHZOUNI_BACKUP_SECRET_<SUB> "<السر>"
   ```

3. جرّب سحب نسخة واحدة يدوياً وتأكد أنها نجحت قبل جدولتها:

   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File inventory-desktop-trial/scripts/backup-online.ps1 -ApiUrl "https://<backend>/api/settings/backup/download" -AppDataDir "%APPDATA%\com.mazbwoni.<sub>" -SecretEnvVar "MAKHZOUNI_BACKUP_SECRET_<SUB>"
   ```

4. ثبّت المهمة اليومية (من PowerShell **كمسؤول** ليعمل حتى بدون تسجيل دخول؛
   بدون صلاحية المسؤول أضف `-NoElevation` وستعمل فقط أثناء تسجيل دخولك):

   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File inventory-desktop-trial/scripts/install-online-backup-task.ps1 -Time "03:20" -TaskName "MakhzouniOnlineBackup-<Sub>" -AppDataDir "%APPDATA%\com.mazbwoni.<sub>" -ApiUrl "https://<backend>/api/settings/backup/download" -SecretEnvVar "MAKHZOUNI_BACKUP_SECRET_<SUB>"
   ```

5. شغّل المهمة مرة يدوياً وتأكد من ظهور ملف ZIP جديد قبل أن تعتبرها منجزة.

## ملحق: التسلسل العملي المجرّب (دفعة 22C — نجح فعلياً على makhzouni-dryrun)

كل خطوات Railway تمت عبر CLI بدون Dashboard:

```bash
railway link -p 654a7c3e-a0b1-4cf6-8287-e47da5343921   # مشروع inventory-backend الرئيسي
railway add -d postgres                                  # قاعدة جديدة (اسم عشوائي Postgres-XXXX)
railway add -s <subdomain>-api \
  --variables "TENANT_ID=<uuid>" --variables "NODE_ENV=production" \
  --variables 'DATABASE_URL=${{Postgres-XXXX.DATABASE_URL}}' \
  --variables "JWT_SECRET=<random>" --variables "BACKUP_SECRET=<random>" \
  --variables "SUPER_ADMIN_API_URL=..." --variables "SUPER_ADMIN_API_KEY=..." \
  --variables "INITIAL_ADMIN_USERNAME=..." --variables "INITIAL_ADMIN_PASSWORD=..."
# migrations من جهازك على DATABASE_PUBLIC_URL للقاعدة الجديدة:
#   DATABASE_URL=<public url> npx prisma migrate deploy
cd inventory-backend && railway up --service <subdomain>-api --detach
railway domain --service <subdomain>-api                 # يولّد رابط *.up.railway.app
railway variables --set "BACKEND_PUBLIC_URL=<الرابط>" --service <subdomain>-api
```

ثم Vercel:

```bash
vercel link --yes --project inventory-web --scope <team>
vercel domains add <subdomain>.mazbwoni.com
```

ملاحظات مجرّبة:
- أول admin انخلق تلقائياً عبر `INITIAL_ADMIN_*` عند أول إقلاع — اشتغل من أول مرة، وبعد أول دخول غيّر كلمة المرور واحذف المتغيرين.
- **الدومين يُربط بمشروع `inventory-web` المشترك** — لا تنشئ مشروع Vercel منفصل. (مشروع `makhzouni-qa-web` المنفصل هو legacy خاص بالـ QA فقط، لا تقلده.)
- Cloudflare: CNAME ‏`<subdomain>` → `cname.vercel-dns.com` ‏(DNS only) — تُضاف يدوياً من اللوحة.
- زر Doctor في Super Admin بعد الإعداد: المتوقع PASS على كل الفحوصات، مع WARNING مقبول على السيريالات إذا Android معطّل.

## أخطاء شائعة (Traps)

- **saas-admin-api ما عنده auto-deploy** — أي تغيير عليه يحتاج `railway up --service saas-admin-api` يدوياً. (inventory-backend يعمل auto-deploy طبيعي.)
- `features: []` في الترخيص = كل شيء مفتوح، وليس "لا شيء".
- `npm run build` وليس `vite build` عند فحص الواجهة محلياً.
- السيريل مطلوب فقط للأندرويد؛ الويب لا يحتاج serial.
