import { asyncHandler } from "../utils/async-handler";
import prisma from "../config/database";
import {
  getActiveRetailCoupon,
  getRetailCustomerReferral,
  getRetailOrderPublic,
  getRetailOrdersByPhone,
  getRetailOrdersByToken,
  getReferralInfo,
  listPublicRetailCategories,
  listPublicRetailItems,
  previewRetailCoupon,
  submitRetailOrder,
} from "../services/retail-catalog.service";
import { retailAiChat } from "../services/retail-ai.service";
import { totalStock } from "../utils/product-stock";

export const getPublicRetailCategories = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await listPublicRetailCategories() });
});

export const getPublicRetailOrdersByPhone = asyncHandler(async (req, res) => {
  const phone = String(req.query.phone ?? "");
  if (phone.replace(/\D/g, "").length < 6) {
    res.json({ success: true, data: [] });
    return;
  }
  res.json({ success: true, data: await getRetailOrdersByPhone(phone) });
});

export const getPublicRetailOrdersByToken = asyncHandler(async (req, res) => {
  const token = String(req.params.token ?? "");
  const result = await getRetailOrdersByToken(token);
  if (!result) {
    res.status(404).json({ success: false, message: "رابط غير صالح" });
    return;
  }
  res.json({ success: true, data: result });
});

export const getPublicStoreInfo = asyncHandler(async (_req, res) => {
  const rows = await prisma.setting.findMany({
    where: { key: { in: ["storeName", "storeLogo", "currency", "siteDesignerName", "siteDesignerPhone"] } },
  });
  const kv: Record<string, string> = {};
  for (const s of rows) kv[s.key] = String(s.value ?? "");
  res.json({
    success: true,
    data: {
      storeName: kv.storeName || "متجرنا",
      storeLogo: kv.storeLogo || "",
      currency: kv.currency || "د.ع",
      designerName: kv.siteDesignerName || "",
      designerPhone: kv.siteDesignerPhone || "",
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

export const getPublicReferralInfo = asyncHandler(async (req, res) => {
  const code = String(req.params.code ?? "").trim().toUpperCase();
  if (!code) { res.status(400).json({ success: false, error: "كود الإحالة مطلوب" }); return; }
  res.json({ success: true, data: await getReferralInfo(code) });
});

export const getPublicCustomerReferral = asyncHandler(async (req, res) => {
  const phone = String(req.query.phone ?? "");
  res.json({ success: true, data: await getRetailCustomerReferral(phone) });
});

export const postPublicRetailAiChat = asyncHandler(async (req, res) => {
  const { message, history = [] } = req.body as { message?: string; history?: Array<{ role: "user" | "assistant"; content: string }> };
  if (!message?.trim()) { res.status(400).json({ success: false, error: "الرسالة مطلوبة" }); return; }

  // Get store name for personalised prompt
  const storeRow = await prisma.setting.findUnique({ where: { key: "storeName" } });
  const storeName = String(storeRow?.value ?? "متجرنا");

  const result = await retailAiChat(message.trim(), history, storeName);

  // Resolve full item data for returned productIds
  const items = result.productIds.length
    ? await prisma.retailCatalogItem.findMany({
        where: { id: { in: result.productIds }, isActive: true },
        include: { product: { select: { name: true, openingBalancePcs: true, cartonsAvailable: true, pcsPerCarton: true, warehouseStocks: { select: { quantityPieces: true } } } } },
      })
    : [];

  const products = result.productIds
    .map((id) => items.find((i) => i.id === id))
    .filter(Boolean)
    .map((item) => {
      const stock = item!.product ? totalStock(item!.product) : 0;
      return {
        id: item!.id,
        title: item!.title || item!.product?.name || "",
        price: Number(item!.price),
        oldPrice: item!.oldPrice != null ? Number(item!.oldPrice) : null,
        images: Array.isArray(item!.images) ? (item!.images as string[]) : [],
        currentStock: stock,
      };
    });

  res.json({ success: true, data: { message: result.message, products } });
});
