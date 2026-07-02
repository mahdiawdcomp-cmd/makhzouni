/**
 * Public endpoint — called by the Android app on first launch.
 * No auth required (the serial code IS the credential).
 */
import { Router, Request, Response } from "express";
import { z } from "zod";
import prisma from "../prisma";

const router = Router();

const activateSchema = z.object({
  serial: z.string().min(1),
  deviceId: z.string().optional(), // device fingerprint (Android ID)
});

router.post("/", async (req: Request, res: Response) => {
  const body = activateSchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "serial is required" });
    return;
  }

  const { serial, deviceId } = body.data;
  const code = serial.trim().toUpperCase();

  const sn = await prisma.serialNumber.findUnique({
    where: { code },
    include: {
      tenant: {
        include: {
          subscriptions: { where: { isActive: true }, take: 1 },
        },
      },
    },
  });

  if (!sn) {
    res.status(404).json({ error: "Serial number not found" });
    return;
  }

  if (!sn.isActive) {
    res.status(403).json({ error: "This serial has been deactivated" });
    return;
  }

  // If already bound to a device, the same deviceId must match.
  // Missing deviceId is treated as a different device — closes the bypass
  // where omitting deviceId would pass the old `sn.activatedBy && deviceId` check.
  if (sn.activatedBy) {
    if (!deviceId || sn.activatedBy !== deviceId) {
      res.status(403).json({ error: "Serial already activated on another device" });
      return;
    }
  }

  const tenant = sn.tenant;
  if (tenant.status !== "ACTIVE") {
    res.status(403).json({ error: "Subscription is suspended or expired. Please contact support." });
    return;
  }

  const sub = tenant.subscriptions[0];
  if (!sub) {
    res.status(403).json({ error: "No active subscription found for this account" });
    return;
  }

  // Check expiry — prefer tenant-level expiry, fall back to legacy subscription.
  const effectiveExpiry = tenant.expiresAt ?? sub.expiresAt ?? null;
  if (effectiveExpiry && new Date(effectiveExpiry) < new Date()) {
    res.status(403).json({ error: "Subscription has expired. Please renew." });
    return;
  }

  // First activation: stamp the device
  if (!sn.activatedAt) {
    await prisma.serialNumber.update({
      where: { id: sn.id },
      data: { activatedAt: new Date(), activatedBy: deviceId ?? null },
    });
  }

  res.json({
    success: true,
    tenantId: tenant.id,
    tenantName: tenant.name,
    backendUrl: tenant.backendUrl,
    // ── Batch 1: entitlements model (new, clearly-named top-level fields) ──
    licenseType: tenant.licenseType,
    activatedAt: tenant.activatedAt,
    expiresAt: effectiveExpiry,
    trialEndsAt: tenant.trialEndsAt,
    features: tenant.features ?? [],
    limits: tenant.limits ?? null,
    platforms: tenant.platforms ?? null,
    branding: tenant.branding ?? null,
    // ── Legacy compatibility: keep the old `subscription` block untouched ──
    subscription: {
      plan: sub.plan,
      expiresAt: sub.expiresAt,
      maxInvoices: sub.maxInvoices,
      maxCustomers: sub.maxCustomers,
      features: sub.features,
    },
  });
});

export default router;
