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
  getProductById,
  getProductByQrCode,
  listProducts,
  updateProduct,
} from "../services/product.service";
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

// Printable label for a single piece — small ~2×2 cm sticker.
// Output: PDF sized exactly to the sticker (no page margins, scales perfectly when printed).
export const getPieceLabelPdf = asyncHandler(async (req, res) => {
  const product = await getProductById(String(req.params.id));
  const payload = product.qrCode || product.itemNumber;
  const pngBuffer = await QRCode.toBuffer(payload, { type: "png", margin: 0, width: 400 });

  // 1 cm = 28.3464567 PDF points. Card: 2 cm QR + small caption lines underneath
  // (item name + item number + pieces-per-carton). Slightly taller to fit them.
  const cm = 28.3464567;
  const widthPt = 2 * cm;
  const heightPt = 3.1 * cm;
  const qrSize = 1.7 * cm;

  const doc = new PDFDocument({ size: [widthPt, heightPt], margin: 0 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="piece-${product.itemNumber}.pdf"`,
  );
  doc.pipe(res);
  // QR centred horizontally
  doc.image(pngBuffer, (widthPt - qrSize) / 2, 0.05 * cm, { width: qrSize, height: qrSize });
  // Small caption: product name (truncated), item number, and pcs-per-carton.
  let captionY = qrSize + 0.12 * cm;
  doc.fontSize(5).fillColor("#111").text(product.name, 1, captionY, {
    width: widthPt - 2,
    align: "center",
    height: 0.5 * cm,
    ellipsis: true,
  });
  captionY += 0.5 * cm;
  doc.fontSize(4.5).fillColor("#475569").text(`${product.itemNumber} · ${product.pcsPerCarton} ق/كرتون`, 0, captionY, {
    width: widthPt,
    align: "center",
  });
  doc.end();
});

// Printable carton labels — A4 sheet with a 2×3 grid of large carton QR labels (6 per page).
export const getCartonSheetPdf = asyncHandler(async (req, res) => {
  const product = await getProductById(String(req.params.id));
  const payload = product.cartonQrCode || product.qrCode || product.itemNumber;
  const pngBuffer = await QRCode.toBuffer(payload, { type: "png", margin: 1, width: 600 });

  // A4 = 595 × 842 pt. 2 cols × 3 rows = 6 labels.
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 28; // ~1 cm
  const gap = 16;
  const cols = 2;
  const rows = 3;
  const cellW = (pageWidth - margin * 2 - gap * (cols - 1)) / cols;
  const cellH = (pageHeight - margin * 2 - gap * (rows - 1)) / rows;

  const doc = new PDFDocument({ size: "A4", margin: 0 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="carton-${product.itemNumber}.pdf"`,
  );
  doc.pipe(res);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = margin + c * (cellW + gap);
      const y = margin + r * (cellH + gap);
      // Card border
      doc.lineWidth(0.5).strokeColor("#cbd5e1").rect(x, y, cellW, cellH).stroke();
      // QR (square, fill most of the cell height)
      const qrSize = Math.min(cellW, cellH) - 60;
      const qrX = x + (cellW - qrSize) / 2;
      const qrY = y + 16;
      doc.image(pngBuffer, qrX, qrY, { width: qrSize, height: qrSize });
      // Captions
      doc
        .fontSize(11)
        .fillColor("#0f172a")
        .text(product.name, x + 8, qrY + qrSize + 6, { width: cellW - 16, align: "center" });
      doc
        .fontSize(9)
        .fillColor("#475569")
        .text(`${product.itemNumber} · كرتون · ${product.pcsPerCarton} قطعة`, x + 8, qrY + qrSize + 22, {
          width: cellW - 16,
          align: "center",
        });
    }
  }
  doc.end();
});

// Admin-only utility: generate missing QR codes for legacy products in one shot.
export const backfillProductQrs = asyncHandler(async (req, res) => {
  requireUser(req.user);
  const result = await backfillQrCodes();
  res.json({ success: true, ...result });
});
