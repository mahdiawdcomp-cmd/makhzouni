import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAdminAuth } from "../middleware/admin-auth";
import { generateSerialCode } from "../services/serial.service";
import { FEATURE_KEYS } from "../entitlements";
import prisma from "../prisma";

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
  buildStatus: z.string().trim().max(60).nullable().optional(),
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
  backendUrl: z.string().url(),
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

router.get("/summary", async (_req: Request, res: Response) => {
  const [total, active, suspended, tenants, devices] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.count({ where: { status: "ACTIVE" } }),
    prisma.tenant.count({ where: { status: "SUSPENDED" } }),
    prisma.tenant.findMany({
      select: { subscriptions: { where: { isActive: true }, take: 1, select: { expiresAt: true } } },
    }),
    prisma.serialNumber.count({ where: { isActive: true } }),
  ]);
  const now = Date.now();
  const inThirtyDays = now + 30 * 86400000;
  let expired = 0;
  let expiringSoon = 0;
  for (const tenant of tenants) {
    const expiry = tenant.subscriptions[0]?.expiresAt?.getTime();
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
  backendUrl: z.string().url().optional(),
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
  if (subscription) {
    await prisma.subscription.update({ where: { id: subscription.id }, data: normalized });
  } else {
    await prisma.subscription.create({
      data: {
        tenantId: id,
        plan: data.plan ?? "BASIC",
        features: data.features ?? [],
        ...normalized,
      },
    });
  }
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
  const maxDevices = tenant.subscriptions[0]?.maxAndroidDevices;
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

export default router;
