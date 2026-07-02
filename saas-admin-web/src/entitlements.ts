/**
 * Canonical entitlements model for the Super Admin UI (Batch 1).
 * Mirrors saas-admin-api/src/entitlements.ts.
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
      { key: "multiWarehouse", label: "تعدد المخازن" },
      { key: "transfers", label: "التحويلات بين المخازن" },
      { key: "stocktake", label: "الجرد" },
      { key: "stockMovementAdvanced", label: "حركة مخزون متقدمة" },
      { key: "lowStockAlerts", label: "تنبيهات نقص المخزون" },
    ],
  },
  {
    key: "management",
    title: "الإدارة",
    items: [
      { key: "advancedPermissions", label: "صلاحيات متقدمة" },
      { key: "auditLog", label: "سجل التدقيق" },
      { key: "advancedReports", label: "تقارير متقدمة" },
      { key: "dailyClosing", label: "الإغلاق اليومي" },
      { key: "profitReports", label: "تقارير الأرباح" },
    ],
  },
  {
    key: "sales",
    title: "البيع",
    items: [
      { key: "pos", label: "نقطة البيع" },
      { key: "salesReturns", label: "مرتجعات البيع" },
      { key: "quotations", label: "عروض الأسعار" },
      { key: "advancedDiscounts", label: "خصومات متقدمة" },
    ],
  },
  {
    key: "catalogWholesale",
    title: "كتلوگ الجملة",
    items: [
      { key: "catalogWholesale", label: "كتلوگ الجملة" },
      { key: "catalogOtp", label: "تحقق OTP" },
      { key: "catalogShowHidePrice", label: "إظهار/إخفاء السعر" },
      { key: "catalogShowHideStock", label: "إظهار/إخفاء المخزون" },
      { key: "catalogFullCartonFilter", label: "فلتر الكرتون الكامل" },
    ],
  },
  {
    key: "retailShop",
    title: "متجر المفرد",
    items: [
      { key: "retailShop", label: "متجر المفرد" },
      { key: "onlineOrders", label: "الطلبات الأونلاين" },
      { key: "retailCoupons", label: "كوبونات الخصم" },
      { key: "referral", label: "الإحالات" },
      { key: "orderStatus", label: "حالة الطلب" },
    ],
  },
  {
    key: "whatsapp",
    title: "واتساب",
    items: [
      { key: "whatsappInvoices", label: "إرسال الفواتير" },
      { key: "whatsappVouchers", label: "إرسال السندات" },
      { key: "whatsappCampaigns", label: "الحملات" },
      { key: "whatsappBot", label: "البوت" },
      { key: "whatsappInbox", label: "صندوق الوارد" },
    ],
  },
  {
    key: "platforms",
    title: "المنصّات",
    items: [
      { key: "androidApp", label: "تطبيق أندرويد" },
      { key: "desktopApp", label: "تطبيق ديسكتوب" },
      { key: "desktopWhiteLabel", label: "ديسكتوب باسم المحل" },
      { key: "offlineDesktopLifetime", label: "ديسكتوب أوفلاين مدى الحياة" },
    ],
  },
  {
    key: "aiMonitoring",
    title: "الذكاء والمراقبة",
    items: [
      { key: "systemHealthAdvanced", label: "صحة النظام المتقدمة" },
      { key: "aiErrorAnalysis", label: "تحليل الأخطاء بالذكاء" },
      { key: "campaignProblemAnalysis", label: "تحليل مشاكل الحملات" },
      { key: "advancedAlerts", label: "تنبيهات متقدمة" },
    ],
  },
  {
    key: "backup",
    title: "النسخ الاحتياطي",
    items: [
      { key: "onlineBackup", label: "نسخ أونلاين" },
      { key: "incrementalBackup", label: "نسخ تزايدي" },
      { key: "backupRestore", label: "الاستعادة" },
    ],
  },
];

export const FEATURE_KEYS: string[] = FEATURE_GROUPS.flatMap((g) => g.items.map((i) => i.key));

export const PLATFORM_TOGGLES: FeatureItem[] = [
  { key: "webEnabled", label: "تفعيل الويب" },
  { key: "androidEnabled", label: "تفعيل أندرويد" },
  { key: "desktopEnabled", label: "تفعيل الديسكتوب" },
  { key: "desktopWhiteLabelEnabled", label: "ديسكتوب باسم المحل" },
  { key: "offlineLifetimeEnabled", label: "أوفلاين مدى الحياة" },
];
