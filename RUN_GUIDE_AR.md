# دليل تشغيل نظام المخزن والحسابات

هذا الدليل يشرح التشغيل على الكمبيوتر والموبايل داخل نفس شبكة الواي فاي.

## 1. المتطلبات على الكمبيوتر

ثبت هذه البرامج:

- Node.js LTS
- PostgreSQL
- Android Studio إذا تريد تشغيل تطبيق Android
- Docker Desktop اختياري للتشغيل الكامل بأمر واحد

تأكد من الأوامر:

```powershell
node -v
npm -v
psql --version
```

## 2. تشغيل قاعدة البيانات PostgreSQL

افتح pgAdmin أو Services في Windows وتأكد أن خدمة PostgreSQL شغالة.

أنشئ قاعدة بيانات باسم:

```text
inventory_backend
```

إذا تستخدم psql:

```powershell
psql -U postgres
CREATE DATABASE inventory_backend;
\q
```

## 3. تشغيل Backend

افتح PowerShell:

```powershell
cd "D:\fullstak app new\inventory-backend"
Copy-Item .env.example .env
npm install
npx prisma generate
npx prisma migrate dev
npm run seed
npm run dev
```

اختبر السيرفر:

```powershell
Invoke-WebRequest http://localhost:5000/health
```

إذا رجع `200` أو JSON فيه `status: ok` فالسيرفر شغال.

## 4. تشغيل Web Dashboard على الكمبيوتر

افتح PowerShell ثاني:

```powershell
cd "D:\fullstak app new\inventory-web"
npm install
npm run dev -- --host 0.0.0.0 --port 5175
```

افتح:

```text
http://127.0.0.1:5175/login
```

## 5. الدخول للنظام

بعد `seed` جرّب:

```text
username: admin
password: Password123!
```

## 6. فتح النظام من الموبايل

لازم الكمبيوتر والموبايل على نفس شبكة Wi-Fi.

اعرف IP الكمبيوتر:

```powershell
ipconfig
```

ابحث عن IPv4 مثل:

```text
192.168.1.25
```

على الموبايل افتح:

```text
http://192.168.1.25:5175/login
```

مهم: إذا صار CORS error، عدل ملف:

```text
D:\fullstak app new\inventory-backend\.env
```

وخلي:

```env
ALLOWED_ORIGIN="http://localhost:5173,http://127.0.0.1:5175,http://192.168.1.25:5175,http://localhost:8080"
```

بدّل `192.168.1.25` بعنوان جهازك الحقيقي، ثم أعد تشغيل الباكند.

## 7. تشغيل Android App

افتح Android Studio ثم افتح المشروع:

```text
D:\fullstak app new\inventory-android
```

من شاشة الإعدادات داخل التطبيق، اجعل رابط السيرفر:

إذا على Emulator:

```text
http://10.0.2.2:5000/api
```

إذا على موبايل حقيقي بنفس الشبكة:

```text
http://192.168.1.25:5000/api
```

ثم شغل التطبيق من زر Run في Android Studio.

## 8. تشغيل كامل عبر Docker

إذا مثبت Docker Desktop:

```powershell
cd "D:\fullstak app new"
docker compose up --build
```

ثم افتح:

```text
http://localhost:8080
```

إذا ظهر أن `docker` غير معروف، ثبت Docker Desktop ثم أعد تشغيل الكمبيوتر.

## 9. مشاكل شائعة

إذا ظهر `DATABASE_URL missing`:

- تأكد أن ملف `.env` موجود داخل `inventory-backend`.
- تأكد أن `DATABASE_URL` صحيح.

إذا ظهر `Can't reach database server`:

- PostgreSQL غير شغال.
- أو المنفذ ليس `5432`.
- أو قاعدة `inventory_backend` غير موجودة.

إذا صفحة الويب تفتح لكن الطلبات تفشل:

- تأكد أن Backend شغال على `5000`.
- تأكد من `ALLOWED_ORIGIN` في `.env`.
- أعد تشغيل Backend بعد تعديل `.env`.

إذا الموبايل لا يفتح الرابط:

- تأكد أن الموبايل والكمبيوتر على نفس الشبكة.
- افتح Windows Firewall واسمح لـ Node.js أو افتح المنافذ `5000` و`5175`.
