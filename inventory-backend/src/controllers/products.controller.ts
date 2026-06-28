import { UserRole } from "@prisma/client";
import QRCode from "qrcode";
import PDFDocument from "pdfkit";
import {
  approvalRequestTypes,
  createPendingApproval,
} from "../services/approval.service";
import {
  backfillQrCodes,
  backfillThumbnails,
  bulkDeleteProducts,
  createProduct,
  deleteProduct,
  getDeletedProducts,
  getProductById,
  getProductByQrCode,
  getStaleProducts,
  listProducts,
  restoreProduct,
  updateProduct,
  adjustProductStockManual,
  listManualStockAdjustments,
  ensureCartonQrCode,
} from "../services/product.service";
import { renderPieceLabelPng, renderCartonLabelPng } from "../services/piece-label.service";
import { convertToVariety } from "../services/variety.service";
import { AppError } from "../utils/app-error";
import { asyncHandler } from "../utils/async-handler";
import { hasPermission } from "../middleware/permission.middleware";
import { getSettings } from "../services/settings.service";

function requireUser(reqUser: Express.User | undefined) {
  if (!reqUser) {
    throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  }

  return reqUser;
}

export const getProducts = asyncHandler(async (req, res) => {
  const result = await listProducts({
    ...(req.validatedQuery as Parameters<typeof listProducts>[0]),
    hidePurchasePrice: !hasPermission(req.user, "VIEW_PURCHASE_PRICE"),
  });

  res.json({
    success: true,
    ...result,
  });
});

export const getStale = asyncHandler(async (req, res) => {
  const days = req.query.days ? Math.max(7, Math.min(365, Number(req.query.days))) : 60;
  const result = await getStaleProducts(days);
  res.json({ success: true, ...result });
});

export const bulkDelete = asyncHandler(async (req, res) => {
  requireUser(req.user);
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : [];
  const result = await bulkDeleteProducts(ids);
  res.json({ success: true, message: `تم حذف ${result.deleted} مادة`, ...result });
});

export const backfillThumbs = asyncHandler(async (_req, res) => {
  const result = await backfillThumbnails();
  res.json({ success: true, message: `تم توليد ${result.updated} صورة مصغّرة`, ...result });
});

export const getProductDetails = asyncHandler(async (req, res) => {
  const product = await getProductById(
    String(req.params.id),
    undefined,
    !hasPermission(req.user, "VIEW_PURCHASE_PRICE")
  );

  res.json({
    success: true,
    data: product,
  });
});

export const adjustStock = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  const body = req.body as { warehouses?: Array<{ warehouseId: string; quantityPieces: number }>; note?: string };
  const product = await adjustProductStockManual(String(req.params.id), {
    warehouses: body.warehouses ?? [],
    note: body.note,
    user: { id: user.id, name: user.name },
  });
  res.json({ success: true, message: "تم تعديل الكمية", data: product });
});

export const getManualAdjustments = asyncHandler(async (req, res) => {
  const data = await listManualStockAdjustments(String(req.params.id));
  res.json({ success: true, data });
});

export const getProductByQr = asyncHandler(async (req, res) => {
  const product = await getProductByQrCode(
    String(req.params.qrCode),
    undefined,
    !hasPermission(req.user, "VIEW_PURCHASE_PRICE")
  );

  res.json({
    success: true,
    data: product,
  });
});

export const addProduct = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);

  if (user.role === UserRole.STAFF && !hasPermission(user, "MANAGE_PRODUCTS")) {
    const approval = await createPendingApproval(
      approvalRequestTypes.CREATE_PRODUCT,
      { body: req.body },
      user.id
    );
    res.status(202).json({
      success: true,
      message: "طلبك قيد المراجعة",
      approvalId: approval.id,
    });
    return;
  }

  const product = await createProduct(req.body, user.id);

  res.status(201).json({
    success: true,
    message: "Product created successfully",
    data: product,
  });
});

export const convertVariety = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  const result = await convertToVariety(req.body, user.id);
  res.status(201).json({
    success: true,
    message: "تم تحويل المواد إلى المتنوع",
    data: result,
  });
});

export const editProduct = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  const id = String(req.params.id);

  if (user.role === UserRole.STAFF && !hasPermission(user, "MANAGE_PRODUCTS")) {
    const approval = await createPendingApproval(
      approvalRequestTypes.UPDATE_PRODUCT,
      { params: { id }, body: req.body },
      user.id
    );
    res.status(202).json({
      success: true,
      message: "طلبك قيد المراجعة",
      approvalId: approval.id,
    });
    return;
  }

  const product = await updateProduct(id, req.body);

  res.json({
    success: true,
    message: "Product updated successfully",
    data: product,
  });
});

export const removeProduct = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  const id = String(req.params.id);

  if (user.role === UserRole.STAFF && !hasPermission(user, "MANAGE_PRODUCTS")) {
    const approval = await createPendingApproval(
      approvalRequestTypes.DELETE_PRODUCT,
      { params: { id } },
      user.id
    );
    res.status(202).json({
      success: true,
      message: "طلبك قيد المراجعة",
      approvalId: approval.id,
    });
    return;
  }

  const product = await deleteProduct(id);

  res.json({
    success: true,
    message: "Product deleted successfully",
    data: product,
  });
});

export const getDeletedProductsList = asyncHandler(async (_req, res) => {
  const products = await getDeletedProducts();
  res.json({ success: true, data: products });
});

export const restoreProductCtrl = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const product = await restoreProduct(id);
  res.json({ success: true, message: "تم استرجاع المادة", data: product });
});

export const getProductQr = asyncHandler(async (req, res) => {
  const product = await getProductById(String(req.params.id));
  const type = String(req.query.type ?? "piece").toLowerCase();
  const payload =
    type === "carton"
      ? product.cartonQrCode || product.qrCode || product.itemNumber
      : product.qrCode || product.itemNumber;
  const image = await QRCode.toBuffer(payload, {
    type: "png",
    margin: 1,
    width: 320,
  });

  res.setHeader("Content-Type", "image/png");
  res.send(image);
});

// 1 mm in PDF points.
const MM = 2.834645669;

// Printable label for a single piece — one sticker sized EXACTLY 50 × 25 mm,
// for direct printing on a label/thermal printer (print at 100%, no scaling).
// Layout: QR square on the right (RTL), product name + item number on the left.
export const getPieceLabelPdf = asyncHandler(async (req, res) => {
  const product = await getProductById(String(req.params.id));
  const settings = await getSettings().catch(() => null);
  const pngBuffer = await renderPieceLabelPng({
    name: product.name,
    itemNumber: product.itemNumber,
    pcsPerCarton: product.pcsPerCarton,
    qrCode: product.qrCode || product.itemNumber,
  }, settings);

  const widthPt = (settings?.labelPieceWidthMm || 50) * MM;
  const heightPt = (settings?.labelPieceHeightMm || 25) * MM;
  const doc = new PDFDocument({ size: [widthPt, heightPt], margin: 0 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="piece-${product.itemNumber}.pdf"`);
  doc.pipe(res);

  // The rendered PNG already contains the QR + all label text (per the
  // settings-driven design), so the PDF is just that image at full bleed.
  doc.image(pngBuffer, 0, 0, { width: widthPt, height: heightPt });
  doc.end();
});

// Printable carton label — one sticker sized EXACTLY 100 × 100 mm, for direct
// printing on a label/thermal printer (print at 100%, no scaling).
export const getPieceLabelPng = asyncHandler(async (req, res) => {
  const product = await getProductById(String(req.params.id));
  const settings = await getSettings().catch(() => null);
  const pngBuffer = await renderPieceLabelPng({
    name: product.name,
    itemNumber: product.itemNumber,
    pcsPerCarton: product.pcsPerCarton,
    qrCode: product.qrCode || product.itemNumber,
  }, settings);

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Disposition", `inline; filename="piece-${product.itemNumber}.png"`);
  res.send(pngBuffer);
});

export const getCartonSheetPdf = asyncHandler(async (req, res) => {
  const product = await getProductById(String(req.params.id));
  const settings = await getSettings().catch(() => null);
  // Always encode a dedicated carton code (generate+persist if missing) so a
  // carton scan is never mistaken for a single piece.
  const cartonCode = await ensureCartonQrCode(product.id);
  const pngBuffer = await renderCartonLabelPng({
    name: product.name,
    itemNumber: product.itemNumber,
    pcsPerCarton: product.pcsPerCarton,
    qrCode: cartonCode,
  }, settings);

  const widthPt = (settings?.labelCartonWidthMm || 100) * MM;
  const heightPt = (settings?.labelCartonHeightMm || 100) * MM;

  const doc = new PDFDocument({ size: [widthPt, heightPt], margin: 0 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="carton-${product.itemNumber}.pdf"`);
  doc.pipe(res);
  doc.image(pngBuffer, 0, 0, { width: widthPt, height: heightPt });
  doc.end();
});


export const getCartonLabelPng = asyncHandler(async (req, res) => {
  const product = await getProductById(String(req.params.id));
  const settings = await getSettings().catch(() => null);
  const cartonCode = await ensureCartonQrCode(product.id);
  const pngBuffer = await renderCartonLabelPng({
    name: product.name,
    itemNumber: product.itemNumber,
    pcsPerCarton: product.pcsPerCarton,
    qrCode: cartonCode,
  }, settings);

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Disposition", `inline; filename="carton-${product.itemNumber}.png"`);
  res.send(pngBuffer);
})

// Admin-only utility: generate missing QR codes for legacy products in one shot.
export const backfillProductQrs = asyncHandler(async (req, res) => {
  requireUser(req.user);
  const result = await backfillQrCodes();
  res.json({ success: true, ...result });
});
