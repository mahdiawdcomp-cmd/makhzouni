# إعداد منظومة SaaS

## البنية العامة

```
Super Admin API    → https://saas-admin-api.up.railway.app
Super Admin Web   → https://saas-admin.yourdomain.com
كل زبون (backend) → https://alsalem-api.up.railway.app
كل زبون (frontend)→ https://alsalem.yourdomain.com
APK واحد          → يطلب السيريل عند أول تشغيل
```

## خطوات إعداد Super Admin API

### 1. Deploy على Railway
```bash
# من مجلد saas-admin-api/
npm install
npx prisma generate
```

Variables على Railway:
```
DATABASE_URL = postgresql://...   ← قاعدة بيانات جديدة خاصة بالسوبر أدمن
JWT_SECRET   = <سلسلة عشوائية طويلة>
ADMIN_PASSWORD = <كلمة مرور قوية>
PORT = 4000
ALLOWED_ORIGINS = https://saas-admin.yourdomain.com
```

### 2. إنشاء حساب السوبر أدمن
```bash
npm run seed:admin
```

## خطوات إضافة زبون جديد

### 1. على Railway — أنشئ خدمة جديدة (نسخة من inventory-backend)
- Variables:
  ```
  DATABASE_URL = postgresql://...  ← قاعدة بيانات جديدة خاصة بالزبون
  TENANT_ID    = <UUID من لوحة السوبر أدمن>
  SUPER_ADMIN_API_URL = https://saas-admin-api.up.railway.app
  SUPER_ADMIN_API_KEY = <نفس JWT_SECRET>
  ```

### 2. على Vercel — أنشئ مشروع جديد (نسخة من inventory-web)
- Variables:
  ```
  VITE_API_URL = https://alsalem-api.up.railway.app
  ```
- Domain: `alsalem.yourdomain.com`

### 3. في لوحة Super Admin
- أنشئ Tenant جديد مع backendUrl = Railway URL
- حدد الباقة والمدة والميزات
- ولّد سيريل نمبر للأندرويد

### 4. APK الأندرويد
- `SUPER_ADMIN_API_URL` مضمن في الـ APK عند البناء
- الزبون يفتح التطبيق → يدخل السيريل → يتصل بـ backend الخاص به

## local.properties (للتطوير)
```
API_BASE_URL=http://10.0.2.2:5000/api/
SUPER_ADMIN_API_URL=http://10.0.2.2:4000
```
