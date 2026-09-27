import { Router } from "express";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";
import { requireAnyPermission, requirePermission } from "../middleware/permission.middleware";
import { asyncHandler } from "../utils/async-handler";
import prisma from "../config/database";
import { getVapidPublicKey } from "../utils/push-notify";
import {
  PREP_NOTIFY,
  ackPrepOrder,
  cancelPrepOrder,
  ensurePrepLoaded,
  getPrepState,
  listPrepWorkers,
  sendPrepOrder,
  markPrepLine,
  markPrepReady,
  removeStaffSubscription,
  saveStaffSubscription,
  setPrepLive,
} from "../services/prep-screen.service";

// «شاشة التجهيز» — live sale-invoice mirror for the prep workers' phones.
const router = Router();
router.use(authMiddleware);
// After a restart, reload the open orders from prep_orders before answering.
router.use((_req, _res, next) => { ensurePrepLoaded().then(() => next(), () => next()); });

const snapshotSchema = z.object({
  draftId: z.string().min(1).max(200),
  customerName: z.string().max(200).nullable(),
  updatedAt: z.number(),
  lines: z.array(z.object({
    key: z.string().max(300),
    name: z.string().max(500),
    // Pictures are data URLs here; a stale client may still send them. Accept
    // and drop them — screens load pictures via /thumbs, pushes need http URLs.
    imageUrl: z.string().max(500_000).nullable().transform((v) => (v && v.startsWith("data:") ? null : v)),
    quantity: z.number(),
    unit: z.enum(["PIECE", "DOZEN", "BOX", "CARTON"]),
    notes: z.string().max(500).optional(),
  })).max(300),
});

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
}).passthrough();

// Same bar as creating an invoice (POST /invoices needs only a signed-in user):
// the cashier polls this for the workers' ready/short marks, so a cashier
// without MANAGE_INVOICES must not be locked out.
router.get("/live", (_req, res) => {
  res.json({ success: true, data: getPrepState() });
});

router.put("/live", (req, res) => {
  const data = setPrepLive(snapshotSchema.parse(req.body));
  res.json({ success: true, data });
});

const markSchema = z.object({
  orderId: z.string().min(1).max(200),
  key: z.string().min(1).max(300),
  status: z.object({ state: z.enum(["done", "short"]), found: z.number().int().min(0).optional() }).nullable(),
});

router.post("/mark", (req, res) => {
  const { orderId, key, status } = markSchema.parse(req.body);
  const ok = markPrepLine(orderId, key, status, req.user!.name);
  res.status(ok ? 200 : 404).json({ success: ok, data: getPrepState() });
});

router.post("/ready", (req, res) => {
  const { orderId, ready } = z.object({ orderId: z.string().min(1).max(200), ready: z.boolean() }).parse(req.body);
  const ok = markPrepReady(orderId, ready, req.user!.name);
  res.status(ok ? 200 : 404).json({ success: ok, data: getPrepState() });
});

// ── «أرسل للتجهيز» — the cashier decides which invoices reach the phones ──
const deskOnly = requireAnyPermission("MANAGE_INVOICES", "ACCESS_POS");

router.post("/send", deskOnly, asyncHandler(async (req, res) => {
  const body = z.object({
    snapshot: snapshotSchema,
    urgent: z.boolean().default(false),
    note: z.string().max(300).nullable().optional(),
    targetUserId: z.string().uuid().nullable().optional(),
  }).parse(req.body);
  const data = await sendPrepOrder(body.snapshot, {
    urgent: body.urgent,
    note: body.note ?? null,
    targetUserId: body.targetUserId ?? null,
  }, req.user!.name);
  res.json({ success: true, data });
}));

router.post("/cancel", deskOnly, (req, res) => {
  const { orderId } = z.object({ orderId: z.string().min(1).max(200) }).parse(req.body);
  const ok = cancelPrepOrder(orderId, req.user!.name);
  res.status(ok ? 200 : 404).json({ success: ok, data: getPrepState() });
});

// «استلمت» — the worker confirms he saw the order (stops the reminders).
router.post("/ack", (req, res) => {
  const { orderId } = z.object({ orderId: z.string().min(1).max(200) }).parse(req.body);
  const ok = ackPrepOrder(orderId, req.user!.name);
  res.status(ok ? 200 : 404).json({ success: ok, data: getPrepState() });
});

router.get("/workers", deskOnly, asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await listPrepWorkers() });
}));

// Product thumbnails for the prep screen. Pictures are stored as data URLs
// (~10 KB each), so snapshots travel WITHOUT them — polled every 1.5 s they
// would be megabytes — and each screen fetches a product's picture once.
router.get("/thumbs", asyncHandler(async (req, res) => {
  const ids = String(req.query.ids ?? "")
    .split(",")
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
    .slice(0, 60);
  if (ids.length === 0) { res.json({ success: true, data: {} }); return; }
  const rows = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, thumbnailUrl: true, imageUrl: true } });
  const data: Record<string, string | null> = {};
  for (const id of ids) data[id] = null;
  for (const r of rows) data[r.id] = r.thumbnailUrl || r.imageUrl || null;
  res.setHeader("Cache-Control", "private, max-age=600");
  res.json({ success: true, data });
}));

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
