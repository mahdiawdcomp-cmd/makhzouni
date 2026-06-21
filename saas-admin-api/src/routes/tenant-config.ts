/**
 * Public endpoint — called by the web frontend to resolve
 * a subdomain → backendUrl + features.
 * No auth required.
 */
import { Router, Request, Response } from "express";
import prisma from "../prisma";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  const subdomain = String(req.query.subdomain ?? "").trim().toLowerCase();
  if (!subdomain) {
    res.status(400).json({ error: "subdomain query param required" });
    return;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { subdomain },
    include: { subscriptions: { where: { isActive: true }, take: 1 } },
  });

  if (!tenant) {
    res.status(404).json({ error: "Tenant not found" });
    return;
  }

  const sub = tenant.subscriptions[0];
  const isExpired = sub?.expiresAt ? new Date(sub.expiresAt) < new Date() : false;

  res.json({
    tenantId: tenant.id,
    name: tenant.name,
    subdomain: tenant.subdomain,
    frontendUrl: tenant.frontendUrl,
    backendUrl: tenant.backendUrl,
    status: isExpired ? "EXPIRED" : tenant.status,
    subscription: sub
      ? {
          plan: sub.plan,
          expiresAt: sub.expiresAt,
          maxInvoices: sub.maxInvoices,
          maxCustomers: sub.maxCustomers,
          features: sub.features,
        }
      : null,
  });
});

export default router;
