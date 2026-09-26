import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";
import { requireAnyPermission, requirePermission } from "../middleware/permission.middleware";
import { asyncHandler } from "../utils/async-handler";
import { getVapidPublicKey } from "../utils/push-notify";
import {
  PREP_NOTIFY,
  getPrepLive,
  removeStaffSubscription,
  saveStaffSubscription,
  setPrepLive,
} from "../services/prep-screen.service";

// «شاشة التجهيز» — live sale-invoice mirror for the prep workers' phones.
const router = Router();
router.use(authMiddleware);

const snapshotSchema = z.object({
  draftId: z.string().min(1).max(200),
  customerName: z.string().max(200).nullable(),
  updatedAt: z.number(),
  lines: z.array(z.object({
    key: z.string().max(300),
    name: z.string().max(500),
    imageUrl: z.string().max(2000).nullable(),
    quantity: z.number(),
    unit: z.enum(["PIECE", "DOZEN", "BOX", "CARTON"]),
    notes: z.string().max(500).optional(),
  })).max(300),
});

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
}).passthrough();

router.get("/live", requireAnyPermission(PREP_NOTIFY, "MANAGE_INVOICES", "ACCESS_POS"), (_req, res) => {
  res.json({ success: true, data: getPrepLive() });
});

// Same bar as creating an invoice (POST /invoices needs only a signed-in user),
// or a cashier without MANAGE_INVOICES would silently never reach the phones.
router.put("/live", (req, res) => {
  const data = setPrepLive(snapshotSchema.parse(req.body));
  res.json({ success: true, data });
});

router.get("/vapid-key", (_req, res) => {
  res.json({ success: true, data: { publicKey: getVapidPublicKey() } });
});

router.post("/subscribe", requirePermission(PREP_NOTIFY), asyncHandler(async (req, res) => {
  const sub = subscriptionSchema.parse(req.body);
  await saveStaffSubscription(req.user!.id, sub);
  res.json({ success: true });
}));

router.post("/unsubscribe", asyncHandler(async (req, res) => {
  const { endpoint } = z.object({ endpoint: z.string().max(2000) }).parse(req.body);
  await removeStaffSubscription(req.user!.id, endpoint);
  res.json({ success: true });
}));

export default router;
