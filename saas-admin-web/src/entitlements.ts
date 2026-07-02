/**
 * Canonical entitlements model for the Super Admin UI (Batch 1 + Batch 2 UI).
 * Mirrors saas-admin-api/src/entitlements.ts. Grouping/labels/descriptions here
 * are UI-only — the underlying feature key strings are unchanged, so this stays
 * additive and does not touch the API contract.
 *
 * No priced plans. The BASE version is always on and never listed here — the
 * keys below are OPTIONAL features enabled on top of it. No invoice-count limit.
 */

export const LICENSE_TYPES = ["SAAS", "DESKTOP_OFFLINE_LIFETIME", "TRIAL"] as const;
export type LicenseType = (typeof LICENSE_TYPES)[number];

export const LICENSE_TYPE_LABELS: Record<LicenseType, string> = {
  SAAS: "اشتراك SaaS",
  DESKTOP_OFFLINE_LIFETIME: "ديسكتوب أوفلاين مدى الحياة",
  TRIAL: "تجريبية",
};

export interface FeatureItem {
  key: string;
  label: string;
  description?: string;
}
export interface FeatureGroup {
  key: string;
  title: string;
  items: FeatureItem[];
}

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    key: "inventory",
    title: "المخزون",
    items: [
      { key: "multiWarehouse", label: "تعدد المخازن", description: "إدارة أكثر من مخزن للمحل الواحد" },
      { key: "transfers", label: "التحويلات بين المخازن", description: "نقل المواد بين المخازن مع سجل حركة" },
      { key: "stocktake", label: "الجرد", description: "جرد دوري للمخزون مع فروقات وأرشفة" },
      { key: "stockMovementAdvanced", label: "حركة مخزون متقدمة", description: "سجل حركة موحّد بكل مصادر الحركة" },
      { key: "lowStockAlerts", label: "تنبيهات نقص المخزون", description: "تنبيه تلقائي عند اقتراب النفاد" },
    ],
  },
  {
    key: "management",
    title: "الإدارة",
    items: [
      { key: "advancedPermissions", label: "صلاحيات متقدمة", description: "صلاحيات دقيقة لكل مستخدم وشاشة" },
      { key: "auditLog", label: "سجل التدقيق", description: "سجل كامل لكل عمليات التعديل والحذف" },
      { key: "advancedReports", label: "تقارير متقدمة", description: "تقارير تحليلية إضافية فوق الأساسية" },
      { key: "dailyClosing", label: "الإغلاق اليومي", description: "إقفال الصندوق اليومي بتقرير مطابقة" },
      { key: "profitReports", label: "تقارير الأرباح", description: "تقارير الربح التفصيلية حسب المنتج/الفترة" },
    ],
  },
  {
    key: "sales",
    title: "البيع",
    items: [
      { key: "pos", label: "نقطة البيع", description: "واجهة بيع سريعة بشاشة لمس" },
      { key: "salesReturns", label: "مرتجعات البيع", description: "إرجاع فواتير البيع مع تحديث المخزون" },
      { key: "quotations", label: "عروض الأسعار", description: "إصدار عروض أسعار قابلة لتحويلها لفاتورة" },
      { key: "advancedDiscounts", label: "خصومات متقدمة", description: "خصومات متعددة المستويات على الفاتورة" },
    ],
  },
  {
    key: "catalogWholesale",
    title: "كتلوگ الجملة",
    items: [
      { key: "catalogWholesale", label: "كتلوگ الجملة", description: "كتالوج للزبائن يعرض الأسعار والمخزون" },
      { key: "catalogOtp", label: "تحقق OTP", description: "تحقق برمز مرسل واتساب قبل دخول الكتالوج" },
      { key: "catalogShowHidePrice", label: "إظهار/إخفاء السعر", description: "التحكم بظهور السعر لكل زبون" },
      { key: "catalogShowHideStock", label: "إظهار/إخفاء المخزون", description: "التحكم بظهور الكمية المتوفرة" },
      { key: "catalogFullCartonFilter", label: "فلتر الكرتون الكامل", description: "عرض المواد المتوفرة بكرتون كامل فقط" },
    ],
  },
  {
    key: "retailShop",
    title: "متجر المفرد",
    items: [
      { key: "retailShop", label: "متجر المفرد", description: "متجر عام لبيع المفرد عبر رابط عام" },
      { key: "onlineOrders", label: "الطلبات الأونلاين", description: "استقبال ومتابعة الطلبات من المتجر" },
      { key: "retailCoupons", label: "كوبونات الخصم", description: "أكواد خصم للزبائن على المتجر" },
      { key: "referral", label: "الإحالات", description: "نظام إحالة زبون لزبون" },
      { key: "orderStatus", label: "حالة الطلب", description: "تتبع حالة الطلب من الاستلام للتسليم" },
    ],
  },
  {
    key: "whatsapp",
    title: "واتساب",
    items: [
      { key: "whatsappInvoices", label: "إرسال الفواتير", description: "إرسال نسخة الفاتورة واتساب للزبون" },
      { key: "whatsappVouchers", label: "إرسال السندات", description: "إرسال سندات القبض/الدفع واتساب" },
      { key: "whatsappCampaigns", label: "الحملات", description: "حملات تسويقية جماعية عبر واتساب" },
      { key: "whatsappBot", label: "البوت", description: "ردود آلية عبر واتساب بزن API" },
      { key: "whatsappInbox", label: "صندوق الوارد", description: "استقبال ومتابعة رسائل الزبائن الواردة" },
    ],
  },
  {
    key: "android",
    title: "Android",
    items: [
      { key: "androidApp", label: "تطبيق أندرويد", description: "APK عام واحد لكل الزبائن بسيريال خاص لكل محل" },
    ],
  },
  {
    key: "desktop",
    title: "Desktop",
    items: [
      { key: "desktopApp", label: "تطبيق ديسكتوب", description: "نسخة ويندوز من نفس النظام" },
      { key: "desktopWhiteLabel", label: "ديسكتوب باسم المحل", description: "installer خاص باسم وشعار المحل — يحتاج بناء لاحق" },
      { key: "offlineDesktopLifetime", label: "أوفلاين مدى الحياة", description: "يعمل بدون إنترنت مدى الحياة بعد تفعيل سيريال مرة واحدة" },
    ],
  },
  {
    key: "aiMonitoring",
    title: "الذكاء والمراقبة",
    items: [
      { key: "systemHealthAdvanced", label: "صحة النظام المتقدمة", description: "مؤشرات صحة تفصيلية للنظام والنسخ الاحتياطي" },
      { key: "aiErrorAnalysis", label: "تحليل الأخطاء بالذكاء", description: "تحليل تلقائي لسجل الأخطاء بالذكاء الاصطناعي" },
      { key: "campaignProblemAnalysis", label: "تحليل مشاكل الحملات", description: "تشخيص أسباب فشل تسليم رسائل الحملات" },
      { key: "advancedAlerts", label: "تنبيهات متقدمة", description: "تنبيهات إضافية موسمية وذكية" },
    ],
  },
  {
    key: "backup",
    title: "النسخ الاحتياطي",
    items: [
      { key: "onlineBackup", label: "نسخ أونلاين", description: "نسخة احتياطية يومية على السيرفر" },
      { key: "incrementalBackup", label: "نسخ تزايدي", description: "نسخ تزايدي أخف وأسرع من النسخ الكامل" },
      { key: "backupRestore", label: "الاستعادة", description: "استعادة نسخة احتياطية سابقة عند الحاجة" },
    ],
  },
];

export const FEATURE_KEYS: string[] = FEATURE_GROUPS.flatMap((g) => g.items.map((i) => i.key));

export const PLATFORM_TOGGLES: Array<FeatureItem & { note?: string }> = [
  { key: "webEnabled", label: "تفعيل الويب", description: "الوصول عبر رابط المحل على الويب" },
  { key: "androidEnabled", label: "تفعيل أندرويد", description: "السماح بتفعيل سيريالات أندرويد لهذا المحل", note: "APK عام واحد بالسيريال" },
  { key: "desktopEnabled", label: "تفعيل الديسكتوب", description: "السماح بتشغيل نسخة الديسكتوب لهذا المحل", note: "يحتاج installer خاص لاحقاً" },
  { key: "desktopWhiteLabelEnabled", label: "ديسكتوب باسم المحل", description: "تفعيل نسخة ديسكتوب بشعار واسم المحل" },
  { key: "offlineLifetimeEnabled", label: "أوفلاين مدى الحياة", description: "تفعيل العمل دون إنترنت مدى الحياة", note: "يعمل بعد تفعيل السيريال مرة واحدة" },
];

/** Static, always-on base features. Display-only — never checkboxes, never removable. */
export const BASE_VERSION_ITEMS: string[] = [
  "مواد", "زبائن", "موردين", "فواتير بيع", "فواتير شراء", "سند قبض", "سند دفع",
  "تقارير أساسية", "تقارير أرباح", "باركود/QR بسيط", "مخزن واحد",
  "مستخدمين وصلاحيات حسب الحاجة", "System Health مبدئي", "Backup أساسي",
];
