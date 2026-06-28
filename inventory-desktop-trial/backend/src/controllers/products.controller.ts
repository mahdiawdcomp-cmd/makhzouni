import { UserRole } from "@prisma/client";
import QRCode from "qrcode";
import PDFDocument from "pdfkit";
import {
  approvalRequestTypes,
  createPendingApproval,
} from "../services/approval.service";
import {
  backfillQrCodes,
  createProduct,
  deleteProduct,
  ensureCartonQrCode,
  getProductById,
  getProductByQrCode,
  listProducts,
  updateProduct,
} from "../services/product.service";
import {
  openPieceLabelInDLabel,
  renderPieceLabelPng,
} from "../services/dlabel.service";
import { renderCartonLabelPng } from "../services/piece-label.service";
import { getSettings } from "../services/settings.service";
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
  const result = await listProducts(
    req.validatedQuery as Parameters<typeof listProducts>[0]
  );

  res.json({
    success: true,
    ...result,
  });
});

export const getProductDetails = asyncHandler(async (req, res) => {
  const product = await getProductById(String(req.params.id));

  res.json({
    success: true,
    data: product,
  });
});

export const getProductByQr = asyncHandler(async (req, res) => {
  const product = await getProductByQrCode(String(req.params.qrCode));

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

export const openPieceLabelInDLabelCtrl = asyncHandler(async (req, res) => {
  const settings = await getSettings().catch(() => null);
  const result = await openPieceLabelInDLabel({
    name: String(req.body.name ?? ""),
    itemNumber: String(req.body.itemNumber ?? ""),
    pcsPerCarton: Number(req.body.pcsPerCarton ?? 1) || 1,
    qrCode: String(req.body.qrCode ?? req.body.itemNumber ?? ""),
  }, settings);

  res.json({
    success: true,
    message: "تم فتح الملصق في DLabel",
    data: result,
  });
});

export const openPieceLabelInDLabelLinkCtrl = asyncHandler(async (req, res) => {
  const settings = await getSettings().catch(() => null);
  await openPieceLabelInDLabel({
    name: String(req.query.name ?? ""),
    itemNumber: String(req.query.itemNumber ?? ""),
    pcsPerCarton: Number(req.query.pcsPerCarton ?? 1) || 1,
    qrCode: String(req.query.qrCode ?? req.query.itemNumber ?? ""),
  }, settings);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="ar" dir="rtl"><body style="font-family:Tahoma,Arial,sans-serif;padding:24px"><h3>تم إرسال الملصق إلى DLabel</h3><p>يمكنك إغلاق هذه النافذة.</p><script>setTimeout(function(){window.close()},1200)</script></body></html>`);
});

// Printable label for a single piece — small ~2×2 cm sticker.
// Output: PDF sized exactly to the sticker (no page margins, scales perfectly when printed).
export const getPieceLabelPdf = asyncHandler(async (req, res) => {
  const product = await getProductById(String(req.params.id));
  const settings = await getSettings().catch(() => null);
  const pngBuffer = await renderPieceLabelPng({
    name: product.name,
    itemNumber: product.itemNumber,
    pcsPerCarton: product.pcsPerCarton,
    qrCode: product.qrCode || product.itemNumber,
  }, settings);

  const mm = 2.83464567;
  const widthPt = (settings?.labelPieceWidthMm || 50) * mm;
  const heightPt = (settings?.labelPieceHeightMm || 25) * mm;

  const doc = new PDFDocument({ size: [widthPt, heightPt], margin: 0 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="piece-${product.itemNumber}.pdf"`,
  );
  doc.pipe(res);
  doc.image(pngBuffer, 0, 0, { width: widthPt, height: heightPt });
  doc.end();
});

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

// Printable carton labels — A4 sheet with a 2×3 grid of large carton QR labels (6 per page).
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

  const mm = 2.83464567;
  const widthPt = (settings?.labelCartonWidthMm || 100) * mm;
  const heightPt = (settings?.labelCartonHeightMm || 100) * mm;

  const doc = new PDFDocument({ size: [widthPt, heightPt], margin: 0 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="carton-${product.itemNumber}.pdf"`,
  );
  doc.pipe(res);
  doc.image(pngBuffer, 0, 0, { width: widthPt, height: heightPt });
  doc.end();
})

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
});

// Admin-only utility: generate missing QR codes for legacy products in one shot.
export const backfillProductQrs = asyncHandler(async (req, res) => {
  requireUser(req.user);
  const result = await backfillQrCodes();
  res.json({ success: true, ...result });
});
