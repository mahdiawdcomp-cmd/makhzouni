import { Router } from "express";
import prisma from "../config/database";
import { authMiddleware } from "../middleware/auth.middleware";
import { requirePermission } from "../middleware/permission.middleware";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";

// «المنتجات المطلوبة» — demand collected by the WhatsApp AI agent for things
// the shop does not carry. Same permission as the inbound-messages inbox:
// this is customer-facing demand, not inventory administration.

const router = Router();
router.use(authMiddleware);
const manage = requirePermission("MANAGE_CUSTOMERS");

router.get("/", manage, asyncHandler(async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "OPEN";
  const rows = await prisma.requestedProduct.findMany({
    where: status === "ALL" ? {} : { status },
    orderBy: [{ requestCount: "desc" }, { updatedAt: "desc" }],
    take: 200,
  });
  res.json({ success: true, data: rows });
}));

router.get("/open-count", manage, asyncHandler(async (_req, res) => {
  const count = await prisma.requestedProduct.count({ where: { status: "OPEN" } });
  res.json({ success: true, data: { count } });
}));

router.post("/:id/handled", manage, asyncHandler(async (req, res) => {
  const updated = await prisma.requestedProduct.updateMany({
    where: { id: String(req.params.id), status: "OPEN" },
    data: { status: "HANDLED", handledAt: new Date() },
  });
  if (updated.count !== 1) throw new AppError("الطلب غير موجود أو معالج مسبقاً", 400, "REQUESTED_PRODUCT_NOT_OPEN");
  res.json({ success: true, data: { ok: true } });
}));

router.post("/:id/reopen", manage, asyncHandler(async (req, res) => {
  const updated = await prisma.requestedProduct.updateMany({
    where: { id: String(req.params.id), status: "HANDLED" },
    data: { status: "OPEN", handledAt: null },
  });
  if (updated.count !== 1) throw new AppError("الطلب مفتوح أصلاً", 400, "REQUESTED_PRODUCT_NOT_HANDLED");
  res.json({ success: true, data: { ok: true } });
}));

router.delete("/:id", manage, asyncHandler(async (req, res) => {
  await prisma.requestedProduct.delete({ where: { id: String(req.params.id) } });
  res.json({ success: true, data: { ok: true } });
}));

export default router;
