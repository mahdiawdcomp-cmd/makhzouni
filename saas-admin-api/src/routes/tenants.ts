import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAdminAuth } from "../middleware/admin-auth";
import { generateSerialCode } from "../services/serial.service";
import { FEATURE_KEYS } from "../entitlements";
import { buildDoctorReport } from "../services/tenant-doctor";
import prisma from "../prisma";
import { getFleetSnapshot, sweepFleet } from "../services/fleet-watch.service";

const router = Router();
router.use(requireAdminAuth);

// ── Batch 1: license / entitlements field schemas (additive) ──
const featureKeySchema = z.enum(FEATURE_KEYS as [string, ...string[]]);

const limitsSchema = z.object({
  maxAndroidDevices: z.number().int().nonnegative().nullable().optional(),
  whatsappMonthlyLimit: z.number().int().nonnegative().nullable().optional(),
  whatsappLimitEnabled: z.boolean().optional(),
}).strip();

const platformsSchema = z.object({
  webEnabled: z.boolean().optional(),
  androidEnabled: z.boolean().optional(),
  desktopEnabled: z.boolean().optional(),
  desktopWhiteLabelEnabled: z.boolean().optional(),
  offlineLifetimeEnabled: z.boolean().optional(),
}).strip();

const brandingSchema = z.object({
  storeName: z.string().trim().max(120).nullable().optional(),
  logoUrl: z.string().trim().max(500).nullable().optional(),
  primaryColor: z.string().trim().max(32).nullable().optional(),
  appName: z.string().trim().max(120).nullable().optional(),
}).strip();

const installerArtifactsSchema = z.object({
  androidApkUrl: z.string().trim().max(500).nullable().optional(),
  desktopInstallerUrl: z.string().trim().max(500).nullable().optional(),
  desktopVersion: z.string().trim().max(60).nullable().optional(),
  androidVersion: z.string().trim().max(60).nullable().optional(),
  // Legacy shared field, kept for back-compat with already-stored data (some
  // existing tenants only have this one set). New writes should use
  // androidBuildStatus/desktopBuildStatus instead — Android and Desktop are
  // separate build pipelines and previously shared one status, so their UI
  // pills always showed identical status even when only one was actually built.
  buildStatus: z.string().trim().max(60).nullable().optional(),
  androidBuildStatus: z.string().trim().max(60).nullable().optional(),
  desktopBuildStatus: z.string().trim().max(60).nullable().optional(),
  lastBuildAt: z.string().trim().max(60).nullable().optional(),
}).strip();

const licenseFieldsSchema = z.object({
  licenseType: z.enum(["SAAS", "DESKTOP_OFFLINE_LIFETIME", "TRIAL"]).optional(),
  activatedAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  trialEndsAt: z.string().datetime().nullable().optional(),
  features: z.array(featureKeySchema).optional(),
  limits: limitsSchema.nullable().optional(),
  platforms: platformsSchema.nullable().optional(),
  branding: brandingSchema.nullable().optional(),
  internalNotes: z.string().trim().max(5000).nullable().optional(),
  installerArtifacts: installerArtifactsSchema.nullable().optional(),
});

/** Convert the license zod payload into a Prisma-ready data object. */
function licenseToPrisma(data: z.infer<typeof licenseFieldsSchema>) {
  const out: Record<string, unknown> = {};
  if (data.licenseType !== undefined) out.licenseType = data.licenseType;
  if (data.activatedAt !== undefined) out.activatedAt = data.activatedAt ? new Date(data.activatedAt) : null;
  if (data.expiresAt !== undefined) out.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
  if (data.trialEndsAt !== undefined) out.trialEndsAt = data.trialEndsAt ? new Date(data.trialEndsAt) : null;
  if (data.features !== undefined) out.features = data.features;
  if (data.limits !== undefined) out.limits = data.limits ?? Prisma.JsonNull;
  if (data.platforms !== undefined) out.platforms = data.platforms ?? Prisma.JsonNull;
  if (data.branding !== undefined) out.branding = data.branding ?? Prisma.JsonNull;
  if (data.internalNotes !== undefined) out.internalNotes = data.internalNotes || null;
  if (data.installerArtifacts !== undefined) out.installerArtifacts = data.installerArtifacts ?? Prisma.JsonNull;
  return out;
}

const featureSchema = z.enum([
  "ANDROID",
  "CATALOG",
  "AI",
  "WHATSAPP",
  "MULTI_WAREHOUSE",
  "POS",
  "QUOTATIONS",
  "RETURNS",
  "OFFLINE",
  "AUDIT_LOG",
]);

const subscriptionSchema = z.object({
  plan: z.enum(["TRIAL", "BASIC", "PRO", "FULL"]),
  expiresAt: z.string().datetime().nullable().optional(),
  maxInvoices: z.number().int().positive().nullable().optional(),
  maxCustomers: z.number().int().positive().nullable().optional(),
  maxUsers: z.number().int().positive().nullable().optional(),
  maxWarehouses: z.number().int().positive().nullable().optional(),
  maxAndroidDevices: z.number().int().positive().nullable().optional(),
  features: z.array(featureSchema).default([]),
  price: z.number().nonnegative().nullable().optional(),
  currency: z.enum(["IQD", "USD"]).default("IQD"),
  billingCycle: z.enum(["MONTHLY", "YEARLY", "CUSTOM"]).default("MONTHLY"),
});

const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(100),
  ownerName: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  subdomain: z.string().trim().min(2).max(40)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Invalid subdomain"),
  frontendUrl: z.string().url().optional(),
  backendUrl: z.string().url().refine(isSafeOutboundUrl, {
    message: "backendUrl must be a public https address",
  }),
  customDomain: z.string().trim().max(253).optional(),
  notes: z.string().trim().max(2000).optional(),
  subscription: subscriptionSchema,
}).merge(licenseFieldsSchema);

const tenantInclude = {
  subscriptions: { orderBy: { createdAt: "desc" as const } },
  serialNumbers: { orderBy: { createdAt: "desc" as const } },
} satisfies Prisma.TenantInclude;

function param(req: Request, key: string): string {
  const value = req.params[key];
  return Array.isArray(value) ? value[0] : value;
}

async function audit(req: Request, tenantId: string | null, action: string, details?: Prisma.InputJsonValue) {
  await prisma.adminAuditLog.create({
    data: { tenantId, adminId: (req as any).adminId ?? null, action, details },
  });
}

/**
 * `backendUrl` is admin-controlled and `z.string().url()` happily accepts
 * http://localhost, http://169.254.169.254/ (cloud metadata) and any private
 * range. check-backend and the doctor both fetch it, which turns this service
 * into an SSRF probe against its own network — including the Railway metadata
 * endpoint. Only public https origins are callable.
 */
export function isSafeOutboundUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  // IPv6 loopback / link-local / unique-local.
  if (host === "::1" || host.startsWith("[") || host.startsWith("fe80") || host.startsWith("fc") || host.startsWith("fd")) {
    return false;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false; // cloud metadata
    if (a >= 224) return false;
  }
  return true;
}

/**
 * Which shops is this panel actually in control of?
 *
 * A shop backend only obeys Super Admin when it is started with TENANT_ID; the
 * ones without it run standalone and ignore every suspend, expiry and feature
 * flag stored here. Nothing in the panel used to show that, so a shop could sit
 * outside the control plane indefinitely and still look green in the list — one
 * real customer did, for months.
 *
 * Read-only: a single GET to each shop's own /api/tenant-info, in parallel, no
 * database writes. Unreachable or slow shops come back as "unknown" rather than
 * failing the whole response, because a console that shows nothing when one shop
 * is down is worse than one that shows the rest.
 */
// Serves the background sweep's last result rather than probing on every page
// load: opening the list should not fan out to every shop and wait on the
// slowest one. `?refresh=1` forces a fresh sweep for when an admin has just
// changed something and wants to see it now. `checkedAt` is null until the
// first sweep lands after a restart, which the UI reports as such rather than
// pretending it knows.
router.get("/connectivity", async (req: Request, res: Response) => {
  const snapshot = String(req.query.refresh ?? "") === "1"
    ? await sweepFleet()
    : getFleetSnapshot();
  res.json(snapshot);
});

router.get("/summary", async (_req: Request, res: Response) => {
  const [total, active, suspended, tenants, devices] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.count({ where: { status: "ACTIVE" } }),
    prisma.tenant.count({ where: { status: "SUSPENDED" } }),
    prisma.tenant.findMany({
      // tenant.expiresAt is the authoritative field everywhere else (see
      // tenant-config and activate); counting only the legacy subscription
      // expiry made the dashboard under-report expired tenants.
      select: {
        expiresAt: true,
        subscriptions: { where: { isActive: true }, take: 1, select: { expiresAt: true } },
      },
    }),
    prisma.serialNumber.count({ where: { isActive: true } }),
  ]);
  const now = Date.now();
  const inThirtyDays = now + 30 * 86400000;
  let expired = 0;
  let expiringSoon = 0;
  for (const tenant of tenants) {
    const expiry = (tenant.expiresAt ?? tenant.subscriptions[0]?.expiresAt)?.getTime();
    if (!expiry) continue;
    if (expiry < now) expired++;
    else if (expiry <= inThirtyDays) expiringSoon++;
  }
  res.json({ total, active, suspended, expired, expiringSoon, activeDevices: devices });
});

router.post("/", async (req: Request, res: Response) => {
  const parsed = createTenantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const existing = await prisma.tenant.findFirst({
    where: {
      OR: [
        { subdomain: data.subdomain },
        ...(data.customDomain ? [{ customDomain: data.customDomain }] : []),
      ],
    },
  });
  if (existing) {
    res.status(409).json({ error: "DOMAIN_ALREADY_USED" });
    return;
  }

  try {
    const tenant = await prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          name: data.name,
          ownerName: data.ownerName || null,
          phone: data.phone || null,
          email: data.email || null,
          subdomain: data.subdomain,
          frontendUrl: data.frontendUrl || `https://${data.subdomain}.mazbwoni.com`,
          backendUrl: data.backendUrl.replace(/\/+$/, ""),
          customDomain: data.customDomain || null,
          notes: data.notes || null,
          ...licenseToPrisma(data),
          subscriptions: {
            create: {
              ...data.subscription,
              expiresAt: data.subscription.expiresAt ? new Date(data.subscription.expiresAt) : null,
            },
          },
        },
        include: tenantInclude,
      });
      await tx.adminAuditLog.create({
        data: {
          tenantId: created.id,
          adminId: (req as any).adminId ?? null,
          action: "TENANT_CREATED",
          details: { name: created.name, subdomain: created.subdomain, plan: data.subscription.plan },
        },
      });
      return created;
    });
    res.status(201).json(tenant);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      res.status(409).json({ error: "DOMAIN_ALREADY_USED" });
      return;
    }
    throw error;
  }
});

router.get("/", async (req: Request, res: Response) => {
  const query = String(req.query.q ?? "").trim();
  const status = String(req.query.status ?? "");
  const tenants = await prisma.tenant.findMany({
    where: {
      ...(status && ["ACTIVE", "SUSPENDED", "EXPIRED"].includes(status)
        ? { status: status as "ACTIVE" | "SUSPENDED" | "EXPIRED" }
        : {}),
      ...(query ? {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { ownerName: { contains: query, mode: "insensitive" } },
          { phone: { contains: query } },
          { subdomain: { contains: query, mode: "insensitive" } },
        ],
      } : {}),
    },
    include: tenantInclude,
    orderBy: { createdAt: "desc" },
  });
  res.json(tenants);
});

router.get("/:id", async (req: Request, res: Response) => {
  const id = param(req, "id");
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: {
      ...tenantInclude,
      auditLogs: { orderBy: { createdAt: "desc" }, take: 100 },
    },
  });
  if (!tenant) {
    res.status(404).json({ error: "TENANT_NOT_FOUND" });
    return;
  }
  res.json(tenant);
});

const updateTenantSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  ownerName: z.string().trim().max(100).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().email().nullable().optional().or(z.literal("")),
  subdomain: z.string().trim().min(2).max(40)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/).optional(),
  frontendUrl: z.string().url().nullable().optional(),
  backendUrl: z.string().url().refine(isSafeOutboundUrl, {
    message: "backendUrl must be a public https address",
  }).optional(),
  customDomain: z.string().trim().max(253).nullable().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "EXPIRED"]).optional(),
  provisioningStatus: z.enum(["PENDING", "READY", "ERROR"]).optional(),
  provisioningError: z.string().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).merge(licenseFieldsSchema);

router.patch("/:id", async (req: Request, res: Response) => {
  const id = param(req, "id");
  const parsed = updateTenantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() });
    return;
  }
  try {
    // Separate license/entitlement fields — they need Date/JsonNull conversion
    // and must not be spread raw into the Prisma update.
    const {
      licenseType, activatedAt, expiresAt, trialEndsAt, features,
      limits, platforms, branding, internalNotes, installerArtifacts,
      ...plain
    } = parsed.data;
    const tenant = await prisma.tenant.update({
      where: { id },
      data: {
        ...plain,
        email: plain.email === undefined ? undefined : (plain.email || null),
        backendUrl: plain.backendUrl?.replace(/\/+$/, ""),
        ...licenseToPrisma({
          licenseType, activatedAt, expiresAt, trialEndsAt, features,
          limits, platforms, branding, internalNotes, installerArtifacts,
        }),
      },
      include: tenantInclude,
    });
    await audit(req, tenant.id, "TENANT_UPDATED", parsed.data as Prisma.InputJsonValue);
    res.json(tenant);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      res.status(409).json({ error: "DOMAIN_ALREADY_USED" });
      return;
    }
    throw error;
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  const id = param(req, "id");
  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (!tenant) {
    res.status(404).json({ error: "TENANT_NOT_FOUND" });
    return;
  }
  // Require SUSPENDED first as a safety rail against deleting a live tenant
  // by mistake — an admin must make a deliberate two-step decision.
  if (tenant.status !== "SUSPENDED") {
    res.status(409).json({
      error: "TENANT_MUST_BE_SUSPENDED",
      message: "Suspend the tenant before deleting it.",
    });
    return;
  }
  // Log identifying details into an orphaned audit row BEFORE deleting —
  // subscriptions and serials cascade-delete with the tenant (see
  // schema.prisma onDelete: Cascade), so this is the only record left.
  await prisma.adminAuditLog.create({
    data: {
      tenantId: null,
      adminId: (req as any).adminId ?? null,
      action: "TENANT_DELETED",
      details: { id: tenant.id, name: tenant.name, subdomain: tenant.subdomain, backendUrl: tenant.backendUrl },
    },
  });
  await prisma.tenant.delete({ where: { id } });
  res.status(204).send();
});

const updateSubscriptionSchema = subscriptionSchema.partial().extend({
  isActive: z.boolean().optional(),
});

router.patch("/:id/subscription", async (req: Request, res: Response) => {
  const id = param(req, "id");
  const parsed = updateSubscriptionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  const subscription = await prisma.subscription.findFirst({
    where: { tenantId: id, isActive: true },
  });
  const normalized = {
    ...data,
    expiresAt: data.expiresAt === undefined
      ? undefined
      : data.expiresAt ? new Date(data.expiresAt) : null,
  };
  await prisma.$transaction(async (tx) => {
    if (subscription) {
      await tx.subscription.update({ where: { id: subscription.id }, data: normalized });
    } else {
      // Defense-in-depth: explicitly deactivate any other active subscription
      // for this tenant before creating a new one, so "at most one active
      // subscription per tenant" holds even without a DB-level constraint.
      await tx.subscription.updateMany({
        where: { tenantId: id, isActive: true },
        data: { isActive: false },
      });
      await tx.subscription.create({
        data: {
          tenantId: id,
          plan: data.plan ?? "BASIC",
          features: data.features ?? [],
          ...normalized,
        },
      });
    }
  });
  await audit(req, id, "SUBSCRIPTION_UPDATED", data as Prisma.InputJsonValue);
  const tenant = await prisma.tenant.findUnique({ where: { id }, include: tenantInclude });
  res.json(tenant);
});

const serialSchema = z.object({
  type: z.enum(["ANDROID", "WEB"]).default("ANDROID"),
  label: z.string().trim().max(100).optional(),
});

router.post("/:id/serials", async (req: Request, res: Response) => {
  const id = param(req, "id");
  const parsed = serialSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() });
    return;
  }
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: { subscriptions: { where: { isActive: true }, take: 1 } },
  });
  if (!tenant) {
    res.status(404).json({ error: "TENANT_NOT_FOUND" });
    return;
  }
  const limits = (tenant.limits as { maxAndroidDevices?: number | null } | null) ?? null;
  const maxDevices = limits?.maxAndroidDevices ?? tenant.subscriptions[0]?.maxAndroidDevices;
  if (parsed.data.type === "ANDROID" && maxDevices) {
    const count = await prisma.serialNumber.count({
      where: { tenantId: tenant.id, type: "ANDROID", isActive: true },
    });
    if (count >= maxDevices) {
      res.status(409).json({ error: "ANDROID_DEVICE_LIMIT_REACHED" });
      return;
    }
  }
  let code = generateSerialCode();
  for (let i = 0; i < 5; i++) {
    const exists = await prisma.serialNumber.findUnique({ where: { code } });
    if (!exists) break;
    code = generateSerialCode();
  }
  const serial = await prisma.serialNumber.create({
    data: { code, tenantId: tenant.id, type: parsed.data.type, label: parsed.data.label },
  });
  await audit(req, tenant.id, "SERIAL_CREATED", { serialId: serial.id, type: serial.type, label: serial.label });
  res.status(201).json(serial);
});

router.patch("/:tenantId/serials/:serialId", async (req: Request, res: Response) => {
  const tenantId = param(req, "tenantId");
  const serialId = param(req, "serialId");
  const parsed = z.object({ isActive: z.boolean() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "VALIDATION_ERROR" });
    return;
  }
  const serial = await prisma.serialNumber.findFirst({
    where: { id: serialId, tenantId },
  });
  if (!serial) {
    res.status(404).json({ error: "SERIAL_NOT_FOUND" });
    return;
  }
  const updated = await prisma.serialNumber.update({
    where: { id: serial.id },
    data: { isActive: parsed.data.isActive },
  });
  await audit(req, tenantId, parsed.data.isActive ? "SERIAL_ENABLED" : "SERIAL_DISABLED", {
    serialId: serial.id,
    label: serial.label,
  });
  res.json(updated);
});

router.post("/:id/check-backend", async (req: Request, res: Response) => {
  const id = param(req, "id");
  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (!tenant) {
    res.status(404).json({ error: "TENANT_NOT_FOUND" });
    return;
  }
  if (!isSafeOutboundUrl(tenant.backendUrl)) {
    res.status(400).json({ ok: false, error: "backendUrl must be a public https address" });
    return;
  }
  const startedAt = Date.now();
  try {
    const response = await fetch(`${tenant.backendUrl}/health`, { signal: AbortSignal.timeout(7000) });
    const latencyMs = Date.now() - startedAt;
    const ok = response.ok;
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        provisioningStatus: ok ? "READY" : "ERROR",
        provisioningError: ok ? null : `HTTP ${response.status}`,
      },
    });
    await audit(req, tenant.id, "BACKEND_CHECKED", { ok, latencyMs, status: response.status });
    res.status(ok ? 200 : 502).json({ ok, latencyMs, status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection failed";
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { provisioningStatus: "ERROR", provisioningError: message },
    });
    await audit(req, tenant.id, "BACKEND_CHECK_FAILED", { message });
    res.status(502).json({ ok: false, error: message });
  }
});

// ── Batch 9: SaaS Tenant Doctor / Readiness Check ──
// Pure read-only diagnostic: fetches the tenant + its serials from our own DB
// (no writes), then makes GET-only calls to the tenant's own backendUrl
// (/health, /api/tenant-info) to compare live state against Super Admin's
// records. Never writes to the DB, never calls audit(), never calls
// /api/activate, never sends anything other than GET to the tenant backend.
router.get("/:id/doctor", async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: { serialNumbers: true },
    });
    if (!tenant) {
      res.status(404).json({ error: "TENANT_NOT_FOUND" });
      return;
    }
    // The doctor also fetches the tenant's backendUrl (/health and
    // /api/tenant-info), so it needs the same outbound restriction.
    if (!isSafeOutboundUrl(tenant.backendUrl)) {
      res.status(400).json({ error: "UNSAFE_BACKEND_URL", message: "backendUrl must be a public https address" });
      return;
    }
    const report = await buildDoctorReport(tenant);
    res.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: "DOCTOR_CHECK_FAILED", message });
  }
});

export default router;
