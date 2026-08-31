import PDFDocument from "pdfkit";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import { contentDisposition } from "../utils/content-disposition";
import { getSettings } from "../services/settings.service";
import { getInvoiceById } from "../services/invoice.service";
import { ensureCartonQrCode, getProductById } from "../services/product.service";
import { renderPieceLabelPng, renderCartonLabelPng } from "../services/piece-label.service";

const MM = 2.834645669;

// Printing a sticker per carton for a whole container is legitimate, but an
// unbounded count would let one request render tens of thousands of PNGs.
const MAX_LABELS = 500;

type LabelRequest = { productId: string; unit: "PIECE" | "CARTON"; count: number };

/**
 * POST /api/invoices/:id/labels.pdf
 *
 * One PDF holding every label the user asked for, each on its own page at the
 * exact sticker size from settings — so it feeds a label printer directly and
 * downloads cleanly in the browser. The invoice is the source of truth for
 * WHICH products may appear; counts come from the request.
 */
export const getInvoiceLabelsPdf = asyncHandler(async (req, res) => {
  const invoice = await getInvoiceById(String(req.params.id));
  const body = req.body as { items?: LabelRequest[] };
  const requested = Array.isArray(body.items) ? body.items : [];
  if (requested.length === 0) throw new AppError("اختر مادة واحدة على الأقل", 400, "NO_LABELS");

  // Only products actually on this invoice — the id list is client-supplied.
  const onInvoice = new Set((invoice.items ?? []).map((it: { productId: string }) => it.productId));
  const items = requested
    .filter((r) => onInvoice.has(r.productId))
    .map((r) => ({ ...r, count: Math.max(0, Math.floor(Number(r.count) || 0)) }))
    .filter((r) => r.count > 0);
  if (items.length === 0) throw new AppError("لا يوجد ملصقات مطلوبة لهذه الفاتورة", 400, "NO_LABELS");

  const total = items.reduce((sum, r) => sum + r.count, 0);
  if (total > MAX_LABELS) {
    throw new AppError(`العدد المطلوب ${total} ملصق — الحد ${MAX_LABELS} بالمرة الواحدة. قلّل الأعداد أو حمّلها على دفعات`, 400, "TOO_MANY_LABELS");
  }

  const settings = await getSettings().catch(() => null);

  // Every label is rendered ONCE and its PNG reused for each copy, so asking
  // for 50 stickers of one carton costs one render, not fifty.
  const rendered: { png: Buffer; widthPt: number; heightPt: number; count: number }[] = [];
  for (const r of items) {
    const product = await getProductById(r.productId);
    if (r.unit === "CARTON") {
      const cartonCode = await ensureCartonQrCode(product.id);
      rendered.push({
        png: await renderCartonLabelPng(
          { name: product.name, itemNumber: product.itemNumber, pcsPerCarton: product.pcsPerCarton, qrCode: cartonCode },
          settings
        ),
        widthPt: (settings?.labelCartonWidthMm || 100) * MM,
        heightPt: (settings?.labelCartonHeightMm || 100) * MM,
        count: r.count,
      });
    } else {
      rendered.push({
        png: await renderPieceLabelPng(
          { name: product.name, itemNumber: product.itemNumber, pcsPerCarton: product.pcsPerCarton, qrCode: product.qrCode || product.itemNumber },
          settings
        ),
        widthPt: (settings?.labelPieceWidthMm || 50) * MM,
        heightPt: (settings?.labelPieceHeightMm || 25) * MM,
        count: r.count,
      });
    }
  }

  const first = rendered[0];
  const doc = new PDFDocument({ size: [first.widthPt, first.heightPt], margin: 0, autoFirstPage: false });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Cache-Control", "no-store");
  // attachment, not inline: this is a download, never a print dialog.
  res.setHeader("Content-Disposition", contentDisposition("attachment", `labels-${invoice.invoiceNumber}.pdf`));
  doc.pipe(res);
  for (const r of rendered) {
    for (let i = 0; i < r.count; i++) {
      // Page size follows each label's own sticker size, so piece and carton
      // labels can live in the same file without either being stretched.
      doc.addPage({ size: [r.widthPt, r.heightPt], margin: 0 });
      doc.image(r.png, 0, 0, { width: r.widthPt, height: r.heightPt });
    }
  }
  doc.end();
});
