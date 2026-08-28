import { Prisma, Tenant, SerialNumber } from "@prisma/client";
import type { TenantPlatforms } from "../entitlements";

/**
 * Batch 9: SaaS Tenant Doctor / Readiness Check.
 *
 * Pure, read-only diagnostic report builder. This module NEVER writes to the
 * database and NEVER performs anything other than GET requests to a tenant's
 * own backendUrl (specifically /health and /api/tenant-info). It must be
 * safe to call repeatedly against a live production tenant with zero side
 * effects on either the Super Admin DB or the tenant's own system.
 */

export type DoctorCheckStatus = "PASS" | "WARNING" | "FAIL";

export interface DoctorCheck {
  key: string;
  label: string;
  status: DoctorCheckStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface DoctorResult {
  tenantId: string;
  tenantName: string;
  overallStatus: "READY" | "WARNING" | "FAIL";
  score: number;
  summary: string;
  checks: DoctorCheck[];
  recommendedActions: string[];
}

type TenantWithSerials = Tenant & { serialNumbers: SerialNumber[] };

/** Shape we defensively expect back from a tenant's own /api/tenant-info. */
interface LiveTenantInfo {
  mode?: string;
  readOnly?: boolean;
  features?: string[];
  platforms?: TenantPlatforms | null;
  licenseType?: string;
  status?: string;
  entitlementExpiresAt?: string | null;
}

/**
 * Mirrors Batch-5's own read-only computation, but recomputed independently
 * here from Super Admin's tenant row so the doctor can compare "what Super
 * Admin thinks should be true" against "what the tenant backend reports".
 */
function computeExpectedReadOnly(tenant: Tenant): boolean {
  if (tenant.status === "SUSPENDED") return true;
  if (tenant.status === "EXPIRED") return true;
  if (tenant.expiresAt && new Date(tenant.expiresAt) < new Date()) return true;
  if (tenant.licenseType === "TRIAL" && tenant.trialEndsAt && new Date(tenant.trialEndsAt) < new Date()) return true;
  return false;
}

function setsEqualCaseInsensitive(a: string[], b: string[]): { equal: boolean; onlyInA: string[]; onlyInB: string[] } {
  const normA = new Set(a.map((v) => v.toLowerCase()));
  const normB = new Set(b.map((v) => v.toLowerCase()));
  const onlyInA = a.filter((v) => !normB.has(v.toLowerCase()));
  const onlyInB = b.filter((v) => !normA.has(v.toLowerCase()));
  return { equal: onlyInA.length === 0 && onlyInB.length === 0, onlyInA, onlyInB };
}

async function checkTenantConfig(tenant: Tenant): Promise<DoctorCheck> {
  const details = {
    name: tenant.name,
    subdomain: tenant.subdomain,
    backendUrl: tenant.backendUrl,
    status: tenant.status,
    licenseType: tenant.licenseType,
    activatedAt: tenant.activatedAt,
    expiresAt: tenant.expiresAt,
    trialEndsAt: tenant.trialEndsAt,
    featuresCount: tenant.features.length,
  };
  if (!tenant.backendUrl || !tenant.backendUrl.trim()) {
    return { key: "tenant_config", label: "إعدادات المحل الأساسية", status: "FAIL", message: "رابط الباكند (backendUrl) غير موجود — لا يمكن فحص أي شيء آخر بدونه", details };
  }
  if (!tenant.name || !tenant.subdomain) {
    return { key: "tenant_config", label: "إعدادات المحل الأساسية", status: "WARNING", message: "بعض الحقول الأساسية (الاسم أو subdomain) غير موجودة", details };
  }
  return { key: "tenant_config", label: "إعدادات المحل الأساسية", status: "PASS", message: "بيانات المحل الأساسية موجودة (الاسم، subdomain، backendUrl)", details };
}

async function checkBackendHealth(tenant: Tenant): Promise<DoctorCheck> {
  if (!tenant.backendUrl || !tenant.backendUrl.trim()) {
    return { key: "backend_health", label: "صحة الخادم", status: "FAIL", message: "لا يمكن فحص الخادم — backendUrl غير موجود" };
  }
  const startedAt = Date.now();
  try {
    const response = await fetch(`${tenant.backendUrl}/health`, { signal: AbortSignal.timeout(5000) });
    const latencyMs = Date.now() - startedAt;
    if (response.ok) {
      return { key: "backend_health", label: "صحة الخادم", status: "PASS", message: `الخادم يستجيب بشكل طبيعي (${latencyMs}ms)`, details: { latencyMs, httpStatus: response.status } };
    }
    return { key: "backend_health", label: "صحة الخادم", status: "FAIL", message: `الخادم استجاب برمز غير سليم: HTTP ${response.status}`, details: { latencyMs, httpStatus: response.status } };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const isTimeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    const message = isTimeout
      ? "انتهت مهلة الاتصال بالخادم (5 ثوانٍ) — قد يكون الخادم متوقفاً أو بطيئاً جداً"
      : `تعذر الاتصال بالخادم: ${error instanceof Error ? error.message : "خطأ غير معروف"}`;
    return { key: "backend_health", label: "صحة الخادم", status: "FAIL", message, details: { latencyMs, error: error instanceof Error ? error.message : String(error) } };
  }
}

async function checkTenantInfo(tenant: Tenant): Promise<{ check: DoctorCheck; liveTenantInfo: LiveTenantInfo | null }> {
  if (!tenant.backendUrl || !tenant.backendUrl.trim()) {
    return {
      check: { key: "tenant_info", label: "معلومات المحل الحية", status: "FAIL", message: "لا يمكن فحص tenant-info — backendUrl غير موجود" },
      liveTenantInfo: null,
    };
  }
  const startedAt = Date.now();
  try {
    const response = await fetch(`${tenant.backendUrl}/api/tenant-info`, { signal: AbortSignal.timeout(5000) });
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return {
        check: { key: "tenant_info", label: "معلومات المحل الحية", status: "FAIL", message: `استجابة غير سليمة من tenant-info: HTTP ${response.status}`, details: { latencyMs, httpStatus: response.status } },
        liveTenantInfo: null,
      };
    }
    let body: LiveTenantInfo;
    try {
      body = (await response.json()) as LiveTenantInfo;
    } catch {
      return {
        check: { key: "tenant_info", label: "معلومات المحل الحية", status: "FAIL", message: "الاستجابة غير صالحة (تعذر تحليل JSON)", details: { latencyMs, httpStatus: response.status } },
        liveTenantInfo: null,
      };
    }
    return {
      check: {
        key: "tenant_info", label: "معلومات المحل الحية", status: "PASS", message: `تم جلب tenant-info بنجاح (${latencyMs}ms)`,
        details: {
          latencyMs, httpStatus: response.status,
          mode: body?.mode, readOnly: body?.readOnly, licenseType: body?.licenseType, status: body?.status,
        },
      },
      liveTenantInfo: body ?? null,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const isTimeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    const message = isTimeout
      ? "انتهت مهلة الاتصال بـ tenant-info (5 ثوانٍ)"
      : `تعذر الاتصال بـ tenant-info: ${error instanceof Error ? error.message : "خطأ غير معروف"}`;
    return {
      check: { key: "tenant_info", label: "معلومات المحل الحية", status: "FAIL", message, details: { latencyMs, error: error instanceof Error ? error.message : String(error) } },
      liveTenantInfo: null,
    };
  }
}

function checkMode(tenant: Tenant, liveTenantInfo: LiveTenantInfo | null): DoctorCheck {
  if (!liveTenantInfo) {
    return { key: "mode_check", label: "تطابق وضع التشغيل (mode)", status: "WARNING", message: "تعذر التحقق — لم يتم جلب tenant-info" };
  }
  if (tenant.licenseType === "DESKTOP_OFFLINE_LIFETIME") {
    const ok = !liveTenantInfo.mode || liveTenantInfo.mode === "standalone";
    return {
      key: "mode_check", label: "تطابق وضع التشغيل (mode)",
      status: ok ? "PASS" : "WARNING",
      message: ok ? "وضع standalone متوقع وصحيح لنسخة أوفلاين مدى الحياة" : `وضع غير متوقع للنسخة الأوفلاين: mode=${liveTenantInfo.mode}`,
      details: { expected: "standalone (or absent)", actual: liveTenantInfo.mode ?? null },
    };
  }
  // A standalone shop is not a yellow "worth reviewing" note — it means this
  // shop's backend has no TENANT_ID and therefore never asks Super Admin
  // anything. Suspending it, expiring it, or toggling its features changes
  // nothing at all. Reported as a WARNING it sat among ordinary warnings and
  // was read past; a real customer ran that way for months. It is the single
  // most consequential misconfiguration this report can find, so it fails.
  const isStandalone = liveTenantInfo.mode === "standalone";
  return {
    key: "mode_check", label: "تطابق وضع التشغيل (mode)",
    status: isStandalone ? "FAIL" : "PASS",
    message: isStandalone
      ? "الخادم يعمل مستقلاً تماماً عن لوحة الإدارة — الإيقاف وتاريخ الانتهاء والمزايا لا تصل إليه إطلاقاً"
      : "وضع التشغيل مطابق للمتوقع (SaaS)",
    details: { expected: "saas/multi-tenant (not standalone)", actual: liveTenantInfo.mode ?? null },
  };
}

function checkReadOnly(tenant: Tenant, liveTenantInfo: LiveTenantInfo | null): DoctorCheck {
  if (!liveTenantInfo || liveTenantInfo.readOnly === undefined) {
    return { key: "readonly_check", label: "تطابق حالة القراءة فقط (readOnly)", status: "WARNING", message: "تعذر التحقق — لم يتم جلب tenant-info" };
  }
  const expected = computeExpectedReadOnly(tenant);
  const actual = !!liveTenantInfo.readOnly;
  if (expected === actual) {
    return { key: "readonly_check", label: "تطابق حالة القراءة فقط (readOnly)", status: "PASS", message: `القيمة مطابقة (readOnly=${actual})`, details: { expected, actual } };
  }
  return {
    key: "readonly_check", label: "تطابق حالة القراءة فقط (readOnly)", status: "WARNING",
    message: `متوقع readOnly=${expected} لكن الخادم يرجّع readOnly=${actual}`,
    details: { expected, actual },
  };
}

function checkFeatures(tenant: Tenant, liveTenantInfo: LiveTenantInfo | null): DoctorCheck {
  if (!liveTenantInfo || !liveTenantInfo.features) {
    return { key: "features_check", label: "تطابق الميزات (features)", status: "WARNING", message: "تعذر التحقق — لم يتم جلب tenant-info" };
  }
  const { equal, onlyInA, onlyInB } = setsEqualCaseInsensitive(tenant.features, liveTenantInfo.features);
  if (equal) {
    return { key: "features_check", label: "تطابق الميزات (features)", status: "PASS", message: "الميزات مطابقة بين Super Admin والخادم الحي" };
  }
  return {
    key: "features_check", label: "تطابق الميزات (features)", status: "WARNING",
    message: "توجد اختلافات في الميزات بين Super Admin والخادم الحي",
    details: { onlyInSuperAdmin: onlyInA, onlyInTenant: onlyInB },
  };
}

function checkPlatforms(tenant: Tenant, liveTenantInfo: LiveTenantInfo | null): DoctorCheck {
  if (!liveTenantInfo) {
    return { key: "platforms_check", label: "تطابق إعدادات المنصّات", status: "WARNING", message: "تعذر التحقق — لم يتم جلب tenant-info" };
  }
  const superAdminPlatforms = (tenant.platforms as TenantPlatforms | null) ?? null;
  const livePlatforms = liveTenantInfo.platforms ?? null;
  if (!superAdminPlatforms && !livePlatforms) {
    return { key: "platforms_check", label: "تطابق إعدادات المنصّات", status: "PASS", message: "لا توجد إعدادات منصّات في أي من الطرفين" };
  }
  const a = superAdminPlatforms ?? {};
  const b = livePlatforms ?? {};
  const diffs: string[] = [];
  (["webEnabled", "androidEnabled", "desktopEnabled"] as const).forEach((key) => {
    const av = a[key];
    const bv = b[key];
    if (!!av !== !!bv) diffs.push(`${key}: SuperAdmin=${!!av} / الخادم=${!!bv}`);
  });
  if (diffs.length === 0) {
    return { key: "platforms_check", label: "تطابق إعدادات المنصّات", status: "PASS", message: "إعدادات المنصّات مطابقة" };
  }
  return {
    key: "platforms_check", label: "تطابق إعدادات المنصّات", status: "WARNING",
    message: `توجد اختلافات في إعدادات المنصّات: ${diffs.join("، ")}`,
    details: { superAdmin: a, tenant: b },
  };
}

function checkLicense(tenant: Tenant, liveTenantInfo: LiveTenantInfo | null): DoctorCheck {
  if (!liveTenantInfo) {
    return { key: "license_check", label: "تطابق نوع النسخة (licenseType)", status: "WARNING", message: "تعذر التحقق — لم يتم جلب tenant-info" };
  }
  if (!liveTenantInfo.licenseType) {
    return { key: "license_check", label: "تطابق نوع النسخة (licenseType)", status: "PASS", message: "الخادم لا يعرض licenseType — تم تجاوز الفحص", details: { superAdmin: tenant.licenseType } };
  }
  if (liveTenantInfo.licenseType === tenant.licenseType) {
    return { key: "license_check", label: "تطابق نوع النسخة (licenseType)", status: "PASS", message: "نوع النسخة مطابق", details: { superAdmin: tenant.licenseType, tenantServer: liveTenantInfo.licenseType } };
  }
  return {
    key: "license_check", label: "تطابق نوع النسخة (licenseType)", status: "WARNING",
    message: `نوع النسخة مختلف: Super Admin=${tenant.licenseType} / الخادم=${liveTenantInfo.licenseType}`,
    details: { superAdmin: tenant.licenseType, tenantServer: liveTenantInfo.licenseType },
  };
}

function checkSerialReadiness(tenant: TenantWithSerials): DoctorCheck {
  const total = tenant.serialNumbers.length;
  const activated = tenant.serialNumbers.filter((s) => s.activatedAt !== null).length;
  const readyForActivation = tenant.serialNumbers.filter((s) => s.isActive && s.activatedAt === null).length;
  const details = { total, activated, readyForActivation };
  if (total === 0) {
    return { key: "serial_readiness", label: "جاهزية السيريالات", status: "WARNING", message: "لا توجد أي سيريالات لهذا المتجر", details };
  }
  if (readyForActivation === 0 && activated === 0) {
    return { key: "serial_readiness", label: "جاهزية السيريالات", status: "WARNING", message: "توجد سيريالات لكن جميعها معطّلة أو غير قابلة للاستخدام ولم يتم تفعيل أي منها من قبل", details };
  }
  return { key: "serial_readiness", label: "جاهزية السيريالات", status: "PASS", message: `يوجد ${total} سيريال (${activated} مفعّل، ${readyForActivation} جاهز للتفعيل)`, details };
}

function checkPlatformFlags(tenant: Tenant): DoctorCheck {
  const platforms = (tenant.platforms as TenantPlatforms | null) ?? null;
  if (!platforms) {
    return { key: "platform_flags", label: "إعدادات المنصّات المفعّلة", status: "WARNING", message: "لم يتم تحديد إعدادات المنصات — الافتراضي غير معروف" };
  }
  const web = !!platforms.webEnabled;
  const android = !!platforms.androidEnabled;
  const desktop = !!platforms.desktopEnabled;
  const message = `Android: ${android ? "مفعّل" : "معطّل"} — Web: ${web ? "مفعّل" : "معطّل"} — Desktop: ${desktop ? "مفعّل" : "معطّل"}`;
  const allDisabled = !web && !android && !desktop;
  return {
    key: "platform_flags", label: "إعدادات المنصّات المفعّلة",
    status: allDisabled ? "WARNING" : "PASS",
    message: allDisabled ? `${message} — لا يمكن استخدام المتجر على أي منصّة` : message,
    details: { webEnabled: web, androidEnabled: android, desktopEnabled: desktop },
  };
}

function scoreFor(status: DoctorCheckStatus): number {
  if (status === "PASS") return 1;
  if (status === "WARNING") return 0.5;
  return 0;
}

function buildRecommendedActions(checks: DoctorCheck[]): string[] {
  const actions: string[] = [];
  for (const check of checks) {
    if (check.status === "PASS") continue;
    switch (check.key) {
      case "tenant_config":
        actions.push("تحقق من رابط الباكند (backendUrl) وبيانات المحل الأساسية في تبويب بيانات المحل");
        break;
      case "backend_health":
        actions.push("تحقق من أن الخادم يعمل ورابط backendUrl صحيح");
        break;
      case "tenant_info":
        actions.push("تأكد من أن نقطة /api/tenant-info متاحة وتعمل على خادم المحل");
        break;
      case "mode_check":
        // Name the actual fix. "راجع إعداد وضع التشغيل" told an admin to go
        // look at something without saying what to set or where.
        actions.push(
          check.status === "FAIL"
            ? "أضف المتغيّرات TENANT_ID و SUPER_ADMIN_API_URL و SUPER_ADMIN_API_KEY إلى خدمة خادم المحل ثم أعد نشرها — بدونها لا يصل أي إعداد من هذه اللوحة. اضبط تاريخ انتهاء صحيحاً قبل الربط وإلا انقفل المحل فور اتصاله."
            : "راجع إعداد وضع التشغيل (standalone/SaaS) على خادم المحل مقارنة بنوع النسخة",
        );
        break;
      case "readonly_check":
        actions.push("راجع حالة الاشتراك وتاريخ الانتهاء");
        break;
      case "features_check":
        actions.push("زامن قائمة الميزات بين Super Admin وخادم المحل من تبويب النسخة والميزات");
        break;
      case "platforms_check":
        actions.push("راجع إعدادات المنصّات (ويب/أندرويد/ديسكتوب) وزامنها مع الخادم");
        break;
      case "license_check":
        actions.push("راجع نوع النسخة المحفوظ في Super Admin مقابل ما يرجعه الخادم");
        break;
      case "serial_readiness":
        actions.push("أنشئ سيريال جديد لهذا المتجر من تبويب الأجهزة والسيريالات");
        break;
      case "platform_flags":
        actions.push("فعّل منصّة واحدة على الأقل لهذا المتجر من تبويب النسخة والميزات");
        break;
      default:
        break;
    }
  }
  return Array.from(new Set(actions));
}

export async function buildDoctorReport(tenant: TenantWithSerials): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];

  checks.push(await checkTenantConfig(tenant));
  checks.push(await checkBackendHealth(tenant));

  const { check: tenantInfoCheck, liveTenantInfo } = await checkTenantInfo(tenant);
  checks.push(tenantInfoCheck);

  checks.push(checkMode(tenant, liveTenantInfo));
  checks.push(checkReadOnly(tenant, liveTenantInfo));
  checks.push(checkFeatures(tenant, liveTenantInfo));
  checks.push(checkPlatforms(tenant, liveTenantInfo));
  checks.push(checkLicense(tenant, liveTenantInfo));

  checks.push(checkSerialReadiness(tenant));
  checks.push(checkPlatformFlags(tenant));

  const hasFail = checks.some((c) => c.status === "FAIL");
  const hasWarning = checks.some((c) => c.status === "WARNING");
  const overallStatus: DoctorResult["overallStatus"] = hasFail ? "FAIL" : hasWarning ? "WARNING" : "READY";

  const totalScore = checks.reduce((sum, c) => sum + scoreFor(c.status), 0);
  const score = Math.round((totalScore / checks.length) * 100);

  // The disconnection outranks every other failure in the summary line: any
  // other FAIL still leaves the panel in charge, this one does not.
  const isDisconnected = checks.some((c) => c.key === "mode_check" && c.status === "FAIL");
  const summary = isDisconnected
    ? "هذا المحل غير موصول بلوحة الإدارة — لا شيء تضغطه هنا يصل إليه"
    : overallStatus === "READY"
      ? "المتجر جاهز ويعمل بشكل طبيعي"
      : overallStatus === "WARNING"
        ? "توجد بعض التنبيهات تحتاج مراجعة"
        : "توجد مشاكل حرجة تمنع عمل المتجر بشكل صحيح";

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    overallStatus,
    score,
    summary,
    checks,
    recommendedActions: buildRecommendedActions(checks),
  };
}
