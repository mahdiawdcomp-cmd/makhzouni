/** «الكشك» — HTTP surface for the in-shop screen. See kiosk.service. */

import { asyncHandler } from "../utils/async-handler";
import {
  kioskProductImage,
  kioskThumbnails,
  listKioskProducts,
  requireKiosk,
  rotateKioskToken,
  submitKioskOrder,
} from "../services/kiosk.service";

export const getKioskConfigCtrl = asyncHandler(async (req, res) => {
  const kiosk = await requireKiosk(String(req.params.token ?? ""));
  res.json({ success: true, data: kiosk });
});

export const getKioskProductsCtrl = asyncHandler(async (req, res) => {
  const products = await listKioskProducts(String(req.params.token ?? ""));
  res.json({ success: true, data: products });
});

export const getKioskProductImageCtrl = asyncHandler(async (req, res) => {
  const imageUrl = await kioskProductImage(
    String(req.params.token ?? ""),
    String(req.query.id ?? ""),
  );
  res.json({ success: true, data: { imageUrl } });
});

export const postKioskThumbnailsCtrl = asyncHandler(async (req, res) => {
  const { ids } = req.body as { ids?: string[] };
  const data = await kioskThumbnails(String(req.params.token ?? ""), ids ?? []);
  res.json({ success: true, data });
});

export const postKioskOrderCtrl = asyncHandler(async (req, res) => {
  const body = req.body as {
    customerName: string;
    phone: string;
    notes?: string;
    items: Array<{ productId: string; unit: never; quantity: number }>;
  };
  const result = await submitKioskOrder(String(req.params.token ?? ""), body);
  res.status(201).json({
    success: true,
    message: "تم إرسال الطلب",
    data: result,
  });
});

/** Admin side: generate a fresh link (and switch the kiosk on). */
export const postKioskRotateCtrl = asyncHandler(async (_req, res) => {
  const token = await rotateKioskToken();
  res.json({ success: true, data: { token } });
});
