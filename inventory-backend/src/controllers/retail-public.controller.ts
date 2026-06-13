import { asyncHandler } from "../utils/async-handler";
import prisma from "../config/database";
import {
  getActiveRetailCoupon,
  getRetailOrderPublic,
  listPublicRetailItems,
  previewRetailCoupon,
  submitRetailOrder,
} from "../services/retail-catalog.service";

export const getPublicStoreInfo = asyncHandler(async (_req, res) => {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ["storeName", "storeLogo", "currency"] } },
  });
  const kv: Record<string, string> = {};
  for (const s of rows) kv[s.key] = String(s.value ?? "");
  res.json({
    success: true,
    data: {
      storeName: kv.storeName || "متجرنا",
      storeLogo: kv.storeLogo || "",
      currency: kv.currency || "د.ع",
    },
  });
});

export const getPublicRetailCatalog = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await listPublicRetailItems() });
});

export const getPublicActiveCoupon = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await getActiveRetailCoupon() });
});

export const previewPublicCoupon = asyncHandler(async (req, res) => {
  const code = String(req.body.code ?? "");
  const subtotal = Number(req.body.subtotal ?? 0);
  res.json({ success: true, data: await previewRetailCoupon(code, subtotal) });
});

export const postPublicRetailOrder = asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await submitRetailOrder(req.body) });
});

export const getPublicRetailOrder = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getRetailOrderPublic(String(req.params.id)) });
});
