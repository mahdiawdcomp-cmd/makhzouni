# مشروع مخزوني - ملف شامل كامل
# للذكاء الاصطناعي: اقرأ هذا كاملاً قبل أي شيء

---

## 1. ما هو المشروع؟

نظام إدارة مخزن ومحاسبة باللغة العربية يعمل على الويب والأندرويد.
يستخدمه أصحاب المحلات التجارية في العراق لإدارة:
- المخزون (المواد/المنتجات)
- الفواتير (بيع وشراء)
- الزبائن والموردين وديونهم
- السندات المالية (قبض / دفع / مصاريف)
- التقارير والإحصائيات
- كشف حساب الزبائن
- إشعارات الديون عبر WhatsApp

---

## 2. التقنيات المستخدمة

### الباكيند (inventory-backend)
- **Node.js + Express 5** - سيرفر الـ API
- **TypeScript** - لغة البرمجة
- **Prisma ORM v6** - التعامل مع قاعدة البيانات
- **PostgreSQL** - قاعدة البيانات
- **JWT** - المصادقة والتوكنات
- **bcrypt** - تشفير كلمات المرور
- **QRCode (npm)** - توليد QR codes
- **PDFKit** - توليد ملفات PDF للفواتير والملصقات
- **Sharp** - معالجة الصور
- **whatsapp-web.js + Puppeteer** - إرسال رسائل WhatsApp (محلي فقط)
- **node-cron** - جدولة إشعارات الديون التلقائية
- **helmet + cors** - أمان السيرفر
- **morgan** - logging

### الفرونتيند (inventory-web)
- **React 19** - واجهة المستخدم
- **Vite 8** - bundler وأداة البناء
- **TypeScript 6** - لغة البرمجة
- **TanStack Query v5** - جلب البيانات وcaching
- **TanStack Table v8** - جداول البيانات المتقدمة
- **React Router v7** - التنقل بين الصفحات
- **Tailwind CSS v4** - التصميم
- **Radix UI** - مكونات UI (Dialog, Select, Toast, إلخ)
- **Recharts** - الرسوم البيانية
- **Zustand** - إدارة حالة المصادقة
- **Axios** - طلبات HTTP
- **lucide-react** - الأيقونات
- **@react-pdf/renderer** - إنشاء PDF في المتصفح
- **date-fns** - معالجة التواريخ

### التطبيق الأندرويد (inventory-android)
- **Kotlin + Jetpack Compose** - واجهة المستخدم
- **Hilt** - حقن التبعيات (Dependency Injection)
- **Retrofit + OkHttp** - طلبات HTTP للـ API
- **Room Database** - قاعدة بيانات محلية للعمل بدون إنترنت
- **Coroutines + Flow** - البرمجة غير المتزامنة
- **Coil** - تحميل الصور (QR codes)
- **ML Kit** - مسح QR codes بالكاميرا
- **CameraX** - استخدام الكاميرا

---

## 3. بنية المشروع

```
D:\fullstak app new\
├── inventory-backend\         ← سيرفر Node.js
│   ├── src\
│   │   ├── server.ts          ← نقطة البداية، Express app
│   │   ├── config\database.ts ← اتصال Prisma
│   │   ├── controllers\       ← منطق معالجة الطلبات (17 controller)
│   │   ├── services\          ← منطق الأعمال (15 service)
│   │   ├── routes\            ← تعريف API routes (index.ts + 17 ملف)
│   │   ├── middleware\        ← auth, errorHandler, auditLog, validate
│   │   └── utils\             ← AppError, asyncHandler, JWT, schemas
│   ├── prisma\
│   │   ├── schema.prisma      ← تعريف جداول قاعدة البيانات
│   │   ├── migrations\        ← 9 migrations
│   │   └── seed.ts            ← بيانات أولية للتجربة
│   ├── Dockerfile             ← للـ deployment
│   ├── railway.json           ← إعدادات Railway
│   └── .env                  ← متغيرات البيئة المحلية
│
├── inventory-web\             ← React app
│   ├── src\
│   │   ├── App.tsx            ← التوجيه الرئيسي
│   │   ├── api\
│   │   │   ├── client.ts      ← Axios instance + interceptors
│   │   │   └── endpoints.ts   ← كل دوال API
│   │   ├── components\
│   │   │   ├── layout\        ← AppLayout, Header, Sidebar
│   │   │   └── ui\            ← مكونات مشتركة
│   │   ├── hooks\             ← useProducts, useCustomers, إلخ
│   │   ├── pages\             ← 20+ صفحة
│   │   ├── store\authStore.ts ← Zustand auth state
│   │   ├── theme\             ← ThemeProvider, themes
│   │   └── types\api.ts       ← TypeScript types
│   ├── vercel.json            ← SPA routing config
│   └── .env.local            ← (محلي) VITE_API_URL
│
└── inventory-android\         ← Android app
    └── app\src\main\java\com\inventory\
        ├── data\
        │   ├── remote\        ← ApiClient, InventoryApi, Interceptors
        │   ├── local\         ← Room Database, DAOs, Entities
        │   └── repository\    ← Repositories, SessionManager
        ├── domain\            ← Models, UseCases
        └── ui\
            ├── navigation\    ← NavHost, Routes
            ├── dashboard\     ← DashboardScreen + ViewModel
            ├── products\      ← ProductListScreen, DetailScreen, FormScreen, MovementScreen
            ├── customers\     ← CustomerListScreen, DetailScreen, StatementScreen, AccountLookupScreen
            ├── invoices\      ← InvoiceListScreen, CreateScreen, DetailScreen
            ├── vouchers\      ← VoucherCreateScreen
            ├── reports\       ← ReportsScreen, DashboardReportScreen
            ├── settings\      ← SettingsScreen
            └── auth\          ← LoginScreen, SplashScreen
```

---

## 4. قاعدة البيانات - الجداول

```
User           ← المستخدمين (ADMIN / STAFF)
Product        ← المنتجات/المواد
Customer       ← الزبائن والموردين (isSupplier flag)
Invoice        ← الفواتير (SALE / PURCHASE)
InvoiceItem    ← بنود الفاتورة
StockMovement  ← حركة المخزون
PaymentVoucher ← السندات (RECEIPT / PAYMENT / EXPENSE)
Branch         ← الفروع
AuditLog       ← سجل العمليات
Notification   ← الإشعارات
PendingApproval← طلبات الموافقة للـ STAFF
AppSettings    ← إعدادات التطبيق
MessageTemplate← قوالب رسائل WhatsApp
```

---

## 5. صفحات الويب

| الصفحة | المسار | الوصف |
|--------|--------|-------|
| تسجيل الدخول | /login | |
| الرئيسية/Dashboard | / | إجراءات سريعة + إحصائيات |
| المخزن | /inventory | قائمة المنتجات + جرد |
| تفاصيل مادة | /inventory/:id | QR codes + حركة المادة + تعديل/حذف |
| مخزون ناقص | /inventory/low-stock | |
| التحويلات | /inventory/transfers | نقل بين الفروع |
| الفواتير | /invoices | قائمة البيع والشراء |
| فاتورة جديدة | /invoices/new | إنشاء فاتورة (tabs متعددة) |
| تفاصيل فاتورة | /invoices/:id | |
| السندات | /vouchers | قبض/دفع/مصاريف |
| تفاصيل سند | /vouchers/:id | |
| الزبائن | /customers | |
| تفاصيل زبون | /customers/:id | |
| كشف الحساب | /account | بحث سريع عن أي زبون |
| التقارير | /reports | |
| الإعدادات | /settings | |
| المستخدمين | /users | (ADMIN فقط) |
| الموافقات | /approvals | (ADMIN فقط) |
| سجل العمليات | /audit-logs | (ADMIN فقط) |
| الفروع | /branches | (ADMIN فقط) |

---

## 6. شاشات الأندرويد

| الشاشة | الوصف |
|--------|-------|
| Splash | تحقق تلقائي من الجلسة |
| Login | تسجيل الدخول |
| Dashboard | إجراءات سريعة + إحصائيات + كشف حساب |
| ProductList | قائمة المنتجات + بحث + فلتر |
| ProductDetail | تفاصيل + QR القطعة والكرتون + حركة + تعديل/حذف |
| ProductForm | إضافة/تعديل مادة |
| ProductMovement | حركة المادة بالتاريخ |
| QrScanner | مسح QR بالكاميرا |
| CustomerList | قائمة الزبائن والموردين |
| CustomerDetail | تفاصيل + آخر معاملة |
| CustomerStatement | كشف حساب تفصيلي |
| AccountLookup | بحث سريع وعرض الحساب من الداشبورد |
| InvoiceList | قائمة الفواتير |
| InvoiceCreate | إنشاء فاتورة |
| InvoiceDetail | تفاصيل الفاتورة |
| VoucherCreate | إنشاء سند |
| Reports | التقارير |
| DashboardReport | تقرير مفصل |
| Settings | إعدادات المتجر + URL الـ API |
| Notifications | الإشعارات |
| PendingApprovals | طلبات الموافقة |
| UserManagement | إدارة المستخدمين |

---

## 7. API Endpoints

```
POST   /api/auth/login
POST   /api/auth/logout

GET    /api/products
POST   /api/products
GET    /api/products/:id
PUT    /api/products/:id
DELETE /api/products/:id
GET    /api/products/:id/qr           ← عام (بدون auth)
GET    /api/products/:id/label/piece.pdf
GET    /api/products/:id/label/carton.pdf

GET    /api/customers
POST   /api/customers
GET    /api/customers/:id
PUT    /api/customers/:id
DELETE /api/customers/:id
GET    /api/customers/:id/transactions
GET    /api/customers/:id/last-transaction

GET    /api/invoices
POST   /api/invoices
GET    /api/invoices/:id
PUT    /api/invoices/:id
DELETE /api/invoices/:id               ← إلغاء الفاتورة
GET    /api/invoices/:id/pdf
GET    /api/invoices/:id/image

GET    /api/vouchers
POST   /api/vouchers
GET    /api/vouchers/:id
PUT    /api/vouchers/:id
DELETE /api/vouchers/:id
GET    /api/vouchers/:id/pdf
GET    /api/vouchers/:id/image

GET    /api/branches
POST   /api/branches
PUT    /api/branches/:id

GET    /api/users
POST   /api/users
PUT    /api/users/:id
DELETE /api/users/:id

GET    /api/approvals
PUT    /api/approvals/:id

GET    /api/audit-logs

GET    /api/reports/dashboard
GET    /api/reports/sales
GET    /api/reports/inventory/valuation
GET    /api/reports/customers/debts
GET    /api/reports/customers/top
GET    /api/reports/end-of-day
GET    /api/reports/products/movement

GET    /api/settings
PUT    /api/settings

GET    /api/notifications
PUT    /api/notifications/:id/read
PUT    /api/notifications/read-all

GET    /api/message-templates
PUT    /api/message-templates/:id

GET    /api/transfers
POST   /api/transfers
GET    /api/transfers/:id

GET    /api/whatsapp/status
POST   /api/whatsapp/send
POST   /api/whatsapp/initialize
POST   /api/whatsapp/logout
```

---

## 8. الاستضافة الحالية

| الخدمة | الرابط | الملاحظة |
|--------|--------|---------|
| الموقع (Vercel) | https://inventory-web-six-kohl.vercel.app | مجاني دائماً |
| الباكيند (Railway) | https://inventory-backend-production-7e85.up.railway.app | $5/شهر مجاني |
| قاعدة البيانات (Neon) | ep-polished-block-aqkeuqy5.c-8.us-east-1.aws.neon.tech | مجاني دائماً |

### بيانات Neon (قاعدة البيانات)
- **Connection String**: postgresql://neondb_owner:npg_ohfviS4DmZ3W@ep-polished-block-aqkeuqy5.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require
- **Dashboard**: https://console.neon.tech

### متغيرات Railway البيئية
```
DATABASE_URL    = postgresql://neondb_owner:...@neon.tech/neondb?sslmode=require
JWT_SECRET      = makhzooni-super-secret-jwt-key-2026
JWT_EXPIRES_IN  = 30d
NODE_ENV        = production
BCRYPT_SALT_ROUNDS = 10
ALLOWED_ORIGIN  = https://inventory-web-six-kohl.vercel.app,...
```

---

## 9. بيانات الدخول للتطبيق

| المستخدم | اسم الدخول | كلمة المرور | الصلاحية |
|---------|-----------|------------|---------|
| المدير | admin | Password123! | ADMIN - كل الصلاحيات |
| المخزن | warehouse | Password123! | STAFF - يحتاج موافقة للتعديل |
| المبيعات | sales | Password123! | STAFF - يحتاج موافقة للتعديل |

---

## 10. ما يشتغل ✅

- تسجيل الدخول والمصادقة بـ JWT
- إدارة المنتجات (إضافة/تعديل/حذف/بحث/فلتر)
- QR codes للقطعة والكرتون (توليد وطباعة PDF)
- الفواتير (بيع وشراء) مع تحديث المخزون تلقائياً
- السندات (قبض/دفع/مصاريف)
- إدارة الزبائن والموردين مع تتبع الأرصدة
- كشف حساب الزبائن مع جميع الحركات
- التقارير (مبيعات/مخزون/ديون/أفضل منتجات)
- نظام الفروع
- سجل العمليات (Audit Log)
- نظام الموافقات للـ STAFF
- الإشعارات
- Dark/Light mode
- RTL (عربي) بالكامل
- الأندرويد: مسح QR بالكاميرا
- الأندرويد: عمل بدون إنترنت (cache محلي)
- الاستضافة على الإنترنت (Vercel + Railway + Neon)

## 11. ما لا يشتغل حالياً ⚠️

- **WhatsApp**: معطّل في السحابة (يحتاج Chrome محلي). يشتغل فقط إذا ENABLE_WHATSAPP=true في البيئة المحلية
- **الطباعة الحرارية للأندرويد**: الكود موجود لكن يحتاج اختبار مع طابعة فعلية
- **الأندرويد - بناء APK**: الكود جاهز لكن يحتاج Android Studio لبناء الـ APK
- **تحديث بيانات المستخدم** (profile/password change): غير مكتمل في الواجهة

---

## 12. نقاط مهمة تقنية

1. **STAFF vs ADMIN**: المستخدمون بدور STAFF لا يستطيعون تعديل/حذف منتجات أو الموافقة على الطلبات - يرسلون طلب للـ ADMIN
2. **الأرصدة**: تحسب تلقائياً عبر triggers في Prisma عند إنشاء فاتورة أو سند
3. **QR endpoints**: عامة (لا تحتاج auth) لتشغيلها في Coil/Android
4. **currentStock**: يُحسب من openingBalancePcs + cartonsAvailable * pcsPerCarton
5. **TanStack Table**: يجب استخدام autoResetPageIndex: false لتجنب تجمّد التنقل
6. **VouchersPage**: الـ useQuery hooks يجب أن تكون قبل استخدام نتائجها (كان هناك bug)

---

## 13. دليل الصيانة والمشاكل الشائعة

### إذا الموقع ما يفتح (Vercel)
1. روح https://vercel.com → تسجيل دخول بـ GitHub
2. تحقق من الـ deployments - هل آخر build نجح؟
3. إذا فشل: اضغط "Redeploy"

### إذا API ما يستجيب (Railway)
1. روح https://railway.com → تسجيل دخول
2. افتح مشروع inventory-backend
3. تحقق من Deployments - هل الـ deployment Active؟
4. إذا Crashed: اضغط "Deploy" من آخر نسخة ناجحة
5. تحقق من المتغيرات: Variables tab → DATABASE_URL موجود؟

### إذا البيانات راحت / قاعدة البيانات
1. روح https://console.neon.tech
2. افتح مشروع inventory-db
3. من SQL Editor: `SELECT COUNT(*) FROM "User";`
4. إذا 0: شغّل الـ seed:
   ```powershell
   cd "D:\fullstak app new\inventory-backend"
   $env:DATABASE_URL="postgresql://neondb_owner:npg_ohfviS4DmZ3W@ep-polished-block-aqkeuqy5.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require"
   npx tsx prisma/seed.ts
   ```

### إذا تريد تضيف ميزة جديدة في الموقع
1. عدّل الملفات في `inventory-web\src\`
2. من PowerShell:
   ```powershell
   cd "D:\fullstak app new\inventory-web"
   vercel deploy --prod --yes
   ```

### إذا تريد تضيف ميزة في الباكيند
1. عدّل الملفات في `inventory-backend\src\`
2. إذا عدّلت schema.prisma: أضف migration محلياً:
   ```powershell
   cd "D:\fullstak app new\inventory-backend"
   npx prisma migrate dev --name "اسم التغيير"
   ```
3. ارفع للـ Railway:
   ```powershell
   railway up --detach
   ```

### إذا تريد تضيف مستخدم جديد
- من الموقع: Settings → Users → New User
- أو من API:
  ```
  POST /api/users
  Authorization: Bearer {admin-token}
  {"name":"اسم","username":"username","password":"Password123!","role":"STAFF"}
  ```

### إذا نسيت كلمة مرور admin
شغّل هذا الكود محلياً:
```powershell
cd "D:\fullstak app new\inventory-backend"
$env:DATABASE_URL="postgresql://neondb_owner:..."
npx tsx -e "
const {PrismaClient} = require('@prisma/client');
const bcrypt = require('bcrypt');
const p = new PrismaClient();
bcrypt.hash('NewPassword123!',10).then(h => p.user.update({where:{username:'admin'},data:{passwordHash:h}})).then(()=>console.log('Done'));
"
```

### إذا Railway استهلك الـ $5 المجانية
- روح https://railway.com/billing
- أضف بطاقة أو ادفع $5 للشهر الجديد
- أو انتقل لـ Render.com (مجاني لكن ينام 15 دقيقة)

---

## 14. كيف تشغّل المشروع محلياً

```powershell
# 1. تشغيل قاعدة البيانات (PostgreSQL يجب أن يكون مثبتاً)
# أو استخدم Neon مباشرة

# 2. الباكيند
cd "D:\fullstak app new\inventory-backend"
npm run dev     # يشتغل على http://localhost:5000

# 3. الفرونتيند (نافذة ثانية)
cd "D:\fullstak app new\inventory-web"
npm run dev     # يشتغل على http://localhost:5173
```

---

## 15. معلومات الحسابات

| الخدمة | الحساب | URL |
|--------|--------|-----|
| Vercel | GitHub: mahdiawdcomp@gmail.com | https://vercel.com |
| Railway | GitHub: mahdiawdcomp@gmail.com | https://railway.com |
| Neon | GitHub: mahdiawdcomp@gmail.com | https://console.neon.tech |
| GitHub | mahdiawdcomp@gmail.com | https://github.com |
