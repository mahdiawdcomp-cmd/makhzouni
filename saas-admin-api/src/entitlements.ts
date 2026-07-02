/**
 * Canonical entitlements model for the SaaS platform (Batch 1).
 *
 * Business rules baked in here:
 *  - There are NO priced plans. Pricing lives outside the system; the super
 *    admin bills manually. The system only records license type, dates,
 *    enabled features, limits and platform flags.
 *  - The BASE version is ALWAYS ON for every tenant and is never gated:
 *    materials, customers, suppliers, sales/purchase invoices, receipt &
 *    payment vouchers, basic + profit reports, simple barcode/QR, a single
 *    warehouse, users & permissions, initial System Health and basic Backup.
 *  - There is NO invoice count limit. Never add maxInvoices / count gating.
 *  - Feature enforcement (read-only on expiry, feature blocking) is NOT
 *    applied yet — Batch 1 only stores state.
 */

export const LICENSE_TYPES = ["SAAS", "DESKTOP_OFFLINE_LIFETIME", "TRIAL"] as const;
export type LicenseType = (typeof LICENSE_TYPES)[number];

export const TENANT_STATUSES = ["ACTIVE", "SUSPENDED", "EXPIRED"] as const;
export type TenantStatusValue = (typeof TENANT_STATUSES)[number];

/**
 * Optional feature keys — everything here is ON TOP of the always-on base
 * version. Grouped only for UI/documentation; the stored value is a flat
 * string[] of these keys.
 */
export const FEATURE_GROUPS = {
  inventory: [
    "multiWarehouse",
    "transfers",
    "stocktake",
    "stockMovementAdvanced",
    "lowStockAlerts",
  ],
  management: [
    "advancedPermissions",
    "auditLog",
    "advancedReports",
    "dailyClosing",
    "profitReports",
  ],
  sales: [
    "pos",
    "salesReturns",
    "quotations",
    "advancedDiscounts",
  ],
  catalogWholesale: [
    "catalogWholesale",
    "catalogOtp",
    "catalogShowHidePrice",
    "catalogShowHideStock",
    "catalogFullCartonFilter",
  ],
  retailShop: [
    "retailShop",
    "onlineOrders",
    "retailCoupons",
    "referral",
    "orderStatus",
  ],
  whatsapp: [
    "whatsappInvoices",
    "whatsappVouchers",
    "whatsappCampaigns",
    "whatsappBot",
    "whatsappInbox",
  ],
  platforms: [
    "androidApp",
    "desktopApp",
    "desktopWhiteLabel",
    "offlineDesktopLifetime",
  ],
  aiMonitoring: [
    "systemHealthAdvanced",
    "aiErrorAnalysis",
    "campaignProblemAnalysis",
    "advancedAlerts",
  ],
  backup: [
    "onlineBackup",
    "incrementalBackup",
    "backupRestore",
  ],
} as const;

export const FEATURE_KEYS = Object.values(FEATURE_GROUPS).flat() as string[];
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export function isFeatureKey(value: string): value is FeatureKey {
  return FEATURE_KEYS.includes(value);
}

/** Default limits shape stored in Tenant.limits (all optional). */
export interface TenantLimits {
  maxAndroidDevices?: number | null;
  whatsappMonthlyLimit?: number | null;
  whatsappLimitEnabled?: boolean;
}

/** Default platform flags stored in Tenant.platforms. */
export interface TenantPlatforms {
  webEnabled?: boolean;
  androidEnabled?: boolean;
  desktopEnabled?: boolean;
  desktopWhiteLabelEnabled?: boolean;
  offlineLifetimeEnabled?: boolean;
}

/** Branding stored in Tenant.branding. */
export interface TenantBranding {
  storeName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  appName?: string | null;
}

/**
 * Installer artifact links + build status. Batch 1 only STORES these — no
 * installer/APK generation happens yet.
 */
export interface InstallerArtifacts {
  androidApkUrl?: string | null;
  desktopInstallerUrl?: string | null;
  desktopVersion?: string | null;
  androidVersion?: string | null;
  buildStatus?: string | null;
  lastBuildAt?: string | null;
}

export const DEFAULT_PLATFORMS: TenantPlatforms = {
  webEnabled: true,
  androidEnabled: false,
  desktopEnabled: false,
  desktopWhiteLabelEnabled: false,
  offlineLifetimeEnabled: false,
};

export const DEFAULT_LIMITS: TenantLimits = {
  maxAndroidDevices: 1,
  whatsappMonthlyLimit: null,
  whatsappLimitEnabled: false,
};
