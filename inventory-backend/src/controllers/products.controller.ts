import { UserRole } from "@prisma/client";
import QRCode from "qrcode";
import PDFDocument from "pdfkit";
import path from "path";

const ARABIC_FONT = path.join(__dirname, "../assets/Cairo.ttf");
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
} from "../services/product.service";
import { convertToVariety } from "../services/variety.service";
import { AppError } from "../utils/app-error";
import { asyncHandler } from "../utils/async-handler";
import { hasPermission } from "../middleware/permission.middleware";

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
  const payload = product.qrCode || product.itemNumber;
  const pngBuffer = await QRCode.toBuffer(payload, { type: "png", margin: 0, width: 400 });

  const widthPt = 50 * MM;
  const heightPt = 25 * MM;
  const pad = 1.5 * MM;
  const qrSize = heightPt - pad * 2; // square, full height minus padding

  const doc = new PDFDocument({ size: [widthPt, heightPt], margin: 0 });
  doc.registerFont("Arabic", ARABIC_FONT);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="piece-${product.itemNumber}.pdf"`);
  doc.pipe(res);

  // QR on the right edge
  const qrX = widthPt - pad - qrSize;
  doc.image(pngBuffer, qrX, pad, { width: qrSize, height: qrSize });

  // Text column fills the rest (right-aligned, RTL)
  const textX = pad;
  const textW = qrX - pad * 2;
  doc.font("Arabic").fontSize(7).fillColor("#0f172a").text(product.name, textX, pad + 0.5 * MM, {
    width: textW, align: "right", height: 9 * MM, ellipsis: true, features: ["rtla"],
  });
  doc.font("Arabic").fontSize(6.5).fillColor("#0f172a").text(product.itemNumber, textX, heightPt - pad - 7 * MM, {
    width: textW, align: "right", features: ["rtla"],
  });
  doc.font("Arabic").fontSize(5.5).fillColor("#475569").text(`${product.pcsPerCarton} ق/كرتون`, textX, heightPt - pad - 3.5 * MM, {
    width: textW, align: "right", features: ["rtla"],
  });
  doc.end();
});

// Printable carton label — one sticker sized EXACTLY 100 × 100 mm, for direct
// printing on a label/thermal printer (print at 100%, no scaling).
export const getCartonSheetPdf = asyncHandler(async (req, res) => {
  const product = await getProductById(String(req.params.id));
  const payload = product.cartonQrCode || product.qrCode || product.itemNumber;
  const pngBuffer = await QRCode.toBuffer(payload, { type: "png", margin: 1, width: 600 });

  const sizePt = 100 * MM;
  const pad = 5 * MM;
  const qrSize = 62 * MM;
  const qrX = (sizePt - qrSize) / 2;
  const qrY = pad;

  const doc = new PDFDocument({ size: [sizePt, sizePt], margin: 0 });
  doc.registerFont("Arabic", ARABIC_FONT);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="carton-${product.itemNumber}.pdf"`);
  doc.pipe(res);

  doc.image(pngBuffer, qrX, qrY, { width: qrSize, height: qrSize });
  let y = qrY + qrSize + 4 * MM;
  doc.font("Arabic").fontSize(18).fillColor("#0f172a").text(product.name, pad, y, {
    width: sizePt - pad * 2, align: "center", height: 14 * MM, ellipsis: true, features: ["rtla"],
  });
  y += 14 * MM;
  doc.font("Arabic").fontSize(13).fillColor("#0f172a").text(product.itemNumber, pad, y, {
    width: sizePt - pad * 2, align: "center", features: ["rtla"],
  });
  y += 6 * MM;
  doc.font("Arabic").fontSize(11).fillColor("#475569").text(`كرتون · ${product.pcsPerCarton} قطعة`, pad, y, {
    width: sizePt - pad * 2, align: "center", features: ["rtla"],
  });
  doc.end();
});

// Admin-only utility: generate missing QR codes for legacy products in one shot.
export const backfillProductQrs = asyncHandler(async (req, res) => {
  requireUser(req.user);
  const result = await backfillQrCodes();
  res.json({ success: true, ...result });
});
