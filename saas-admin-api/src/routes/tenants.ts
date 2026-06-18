import { Router, Request, Response } from "express";
import { z } from "zod";
import { requireAdminAuth } from "../middleware/admin-auth";
import { generateSerialCode } from "../services/serial.service";
import prisma from "../prisma";

const router = Router();
router.use(requireAdminAuth);

// ── Create tenant ────────────────────────────────────────────────────────────
const createTenantSchema = z.object({
  name: z.string().min(1),
  subdomain: z.string().min(1).regex(/^[a-z0-9-]+$/, "subdomain: lowercase letters, digits, hyphens only"),
  backendUrl: z.string().url(),
  notes: z.string().optional(),
  subscription: z.object({
    plan: z.enum(["TRIAL", "BASIC", "FULL"]),
    expiresAt: z.string().datetime().nullable().optional(),
    maxInvoices: z.number().int().positive().nullable().optional(),
    maxCustomers: z.number().int().positive().nullable().optional(),
    features: z.array(z.string()).default([]),
  }),
});

router.post("/", async (req: Request, res: Response) => {
  const body = createTenantSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ errors: body.error.flatten() });
    return;
  }
  const { name, subdomain, backendUrl, notes, subscription } = body.data;

  const existing = await prisma.tenant.findUnique({ where: { subdomain } });
  if (existing) {
    res.status(409).json({ error: "Subdomain already taken" });
    return;
  }

  const tenant = await prisma.tenant.create({
    data: {
      name, subdomain, backendUrl, notes,
      subscriptions: {
        create: {
          plan: subscription.plan,
          expiresAt: subscription.expiresAt ? new Date(subscription.expiresAt) : null,
          maxInvoices: subscription.maxInvoices ?? null,
          maxCustomers: subscription.maxCustomers ?? null,
          features: subscription.features,
          isActive: true,
        },
      },
    },
    include: { subscriptions: true, serialNumbers: true },
  });

  res.status(201).json(tenant);
});

// ── List tenants ─────────────────────────────────────────────────────────────
router.get("/", async (_req: Request, res: Response) => {
  const tenants = await prisma.tenant.findMany({
    include: {
      subscriptions: { where: { isActive: true }, take: 1 },
      serialNumbers: true,
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(tenants);
});

// ── Get single tenant ────────────────────────────────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params.id },
    include: { subscriptions: true, serialNumbers: true },
  });
  if (!tenant) { res.status(404).json({ error: "Not found" }); return; }
  res.json(tenant);
});

// ── Update tenant (status, backendUrl, notes) ────────────────────────────────
const updateTenantSchema = z.object({
  name: z.string().min(1).optional(),
  backendUrl: z.string().url().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "EXPIRED"]).optional(),
  notes: z.string().optional(),
});

router.patch("/:id", async (req: Request, res: Response) => {
  const body = updateTenantSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ errors: body.error.flatten() }); return; }

  const tenant = await prisma.tenant.update({
    where: { id: req.params.id },
    data: body.data,
    include: { subscriptions: { where: { isActive: true }, take: 1 }, serialNumbers: true },
  });
  res.json(tenant);
});

// ── Update subscription ──────────────────────────────────────────────────────
const updateSubSchema = z.object({
  plan: z.enum(["TRIAL", "BASIC", "FULL"]).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  maxInvoices: z.number().int().positive().nullable().optional(),
  maxCustomers: z.number().int().positive().nullable().optional(),
  features: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

router.patch("/:id/subscription", async (req: Request, res: Response) => {
  const body = updateSubSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ errors: body.error.flatten() }); return; }

  // Deactivate all existing, then upsert active one
  const activeSub = await prisma.subscription.findFirst({
    where: { tenantId: req.params.id, isActive: true },
  });

  if (activeSub) {
    await prisma.subscription.update({
      where: { id: activeSub.id },
      data: {
        ...body.data,
        expiresAt: body.data.expiresAt !== undefined
          ? (body.data.expiresAt ? new Date(body.data.expiresAt) : null)
          : undefined,
      },
    });
  } else {
    await prisma.subscription.create({
      data: {
        tenantId: req.params.id,
        plan: body.data.plan ?? "BASIC",
        expiresAt: body.data.expiresAt ? new Date(body.data.expiresAt) : null,
        maxInvoices: body.data.maxInvoices ?? null,
        maxCustomers: body.data.maxCustomers ?? null,
        features: body.data.features ?? [],
        isActive: body.data.isActive ?? true,
      },
    });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params.id },
    include: { subscriptions: { where: { isActive: true }, take: 1 }, serialNumbers: true },
  });
  res.json(tenant);
});

// ── Generate serial number ───────────────────────────────────────────────────
const genSerialSchema = z.object({
  type: z.enum(["ANDROID", "WEB"]).default("ANDROID"),
  label: z.string().optional(),
});

router.post("/:id/serials", async (req: Request, res: Response) => {
  const body = genSerialSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ errors: body.error.flatten() }); return; }

  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!tenant) { res.status(404).json({ error: "Tenant not found" }); return; }

  // Generate unique code
  let code: string;
  let attempts = 0;
  do {
    code = generateSerialCode();
    const exists = await prisma.serialNumber.findUnique({ where: { code } });
    if (!exists) break;
    attempts++;
  } while (attempts < 5);

  const serial = await prisma.serialNumber.create({
    data: { code, tenantId: req.params.id, type: body.data.type, label: body.data.label },
  });
  res.status(201).json(serial);
});

// ── Revoke / toggle serial ───────────────────────────────────────────────────
router.patch("/:tenantId/serials/:serialId", async (req: Request, res: Response) => {
  const { isActive } = req.body;
  if (typeof isActive !== "boolean") {
    res.status(400).json({ error: "isActive (boolean) required" });
    return;
  }
  const serial = await prisma.serialNumber.update({
    where: { id: req.params.serialId },
    data: { isActive },
  });
  res.json(serial);
});

export default router;
