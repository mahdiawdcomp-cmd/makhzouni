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
  ensureCartonQrCode,
} from "../services/product.service";
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

// Faux-bold: overstrike the same text with a tiny x offset (no bold font file).
function boldText(
  doc: PDFKit.PDFDocument,
  str: string,
  x: number,
  y: number,
  opts: PDFKit.Mixins.TextOptions,
) {
  doc.text(str, x, y, opts);
  doc.text(str, x + 0.4, y, { ...opts });
}

// Render a "<number> <arabic>" line WITHOUT digit reversal. pdfkit has no bidi
// engine, so a mixed Arabic+digit run with the rtla feature flips the digits
// (96 -> 69). We draw the Arabic word (rtla) and the number (LTR) as two
// separate, absolutely-positioned tokens so the number is always correct.
function drawNumberArabicLine(
  doc: PDFKit.PDFDocument,
  font: string,
  fontSize: number,
  number: number | string,
  arabic: string,
  x: number,
  y: number,
  width: number,
  align: "right" | "center",
  color: string,
  bold = false,
) {
  const numStr = String(number);
  doc.font(font).fontSize(fontSize).fillColor(color);
  const numW = doc.widthOfString(numStr);
  const arW = doc.widthOfString(arabic);
  const gap = fontSize * 0.35;
  const total = numW + gap + arW;
  const startX = align === "center" ? x + (width - total) / 2 : x + width - total;
  // RTL reading: Arabic on the left, number on the right.
  const draw = bold ? boldText : (d: PDFKit.PDFDocument, s: string, px: number, py: number, o: PDFKit.Mixins.TextOptions) => d.text(s, px, py, o);
  draw(doc, arabic, startX, y, { lineBreak: false, features: ["rtla"] });
  draw(doc, numStr, startX + arW + gap, y, { lineBreak: false });
}

// Printable label for a single piece — one sticker sized EXACTLY 50 × 25 mm,
// for direct printing on a label/thermal printer (print at 100%, no scaling).
// Layout: QR square on the right (RTL), product name + item number on the left.
export const getPieceLabelPdf = asyncHandler(async (req, res) => {
  const product = await getProductById(String(req.params.id));
  const settings = await getSettings().catch(() => null);
  const payload = product.qrCode || product.itemNumber;
  const pngBuffer = await QRCode.toBuffer(payload, { type: "png", margin: 0, width: 400 });

  const widthPt = (settings?.labelPieceWidthMm || 50) * MM;
  const heightPt = (settings?.labelPieceHeightMm || 25) * MM;
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

  // Text column fills the rest (right-aligned, RTL). Pure black + bold + larger
  // so it stays sharp on a thermal printer.
  const textX = pad;
  const textW = qrX - pad * 2;
  doc.font("Arabic").fontSize(9).fillColor("#000000");
  boldText(doc, product.name, textX, pad + 0.5 * MM, {
    width: textW, align: "right", height: 9 * MM, ellipsis: true, features: ["rtla"],
  });
  // Item number is Latin/digits — render LTR (no rtla) so it never reverses.
  doc.font("Arabic").fontSize(8).fillColor("#000000");
  boldText(doc, product.itemNumber, textX, heightPt - pad - 7 * MM, {
    width: textW, align: "right",
  });
  drawNumberArabicLine(
    doc, "Arabic", 7.5, product.pcsPerCarton, "ق/كرتون",
    textX, heightPt - pad - 3.6 * MM, textW, "right", "#000000", true,
  );
  doc.end();
});

// Printable carton label — one sticker sized EXACTLY 100 × 100 mm, for direct
// printing on a label/thermal printer (print at 100%, no scaling).
export const getCartonSheetPdf = asyncHandler(async (req, res) => {
  const product = await getProductById(String(req.params.id));
  const settings = await getSettings().catch(() => null);
  // Always encode a dedicated carton code (generate+persist if missing) so a
  // carton scan is never mistaken for a single piece.
  const payload = await ensureCartonQrCode(product.id);
  const pngBuffer = await QRCode.toBuffer(payload, { type: "png", margin: 1, width: 600 });

  const widthPt = (settings?.labelCartonWidthMm || 100) * MM;
  const heightPt = (settings?.labelCartonHeightMm || 100) * MM;
  const pad = 5 * MM;
  // QR fills most of the width but leaves room for the 3 caption lines (~26mm).
  const qrSize = Math.min(widthPt - pad * 2, heightPt - pad * 2 - 26 * MM);
  const qrX = (widthPt - qrSize) / 2;
  const qrY = pad;

  const doc = new PDFDocument({ size: [widthPt, heightPt], margin: 0 });
  doc.registerFont("Arabic", ARABIC_FONT);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="carton-${product.itemNumber}.pdf"`);
  doc.pipe(res);

  doc.image(pngBuffer, qrX, qrY, { width: qrSize, height: qrSize });
  const innerW = widthPt - pad * 2;
  let y = qrY + qrSize + 3 * MM;
  // Name — big, black, bold.
  doc.font("Arabic").fontSize(20).fillColor("#000000");
  boldText(doc, product.name, pad, y, {
    width: innerW, align: "center", height: 12 * MM, ellipsis: true, features: ["rtla"],
  });
  y += 13 * MM;
  // Item number — Latin/digits → LTR (no rtla), black, bold.
  doc.font("Arabic").fontSize(15).fillColor("#000000");
  boldText(doc, product.itemNumber, pad, y, { width: innerW, align: "center" });
  y += 6.5 * MM;
  // Carton piece count — number drawn LTR so it never reverses.
  drawNumberArabicLine(
    doc, "Arabic", 13, product.pcsPerCarton, "قطعة بالكرتون",
    pad, y, innerW, "center", "#000000", true,
  );
  doc.end();
});

// Admin-only utility: generate missing QR codes for legacy products in one shot.
export const backfillProductQrs = asyncHandler(async (req, res) => {
  requireUser(req.user);
  const result = await backfillQrCodes();
  res.json({ success: true, ...result });
});
