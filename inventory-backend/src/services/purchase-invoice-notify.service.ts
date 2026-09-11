import { Unit } from "@prisma/client";
import prisma from "../config/database";
import { getSettings } from "./settings.service";
import { sendWhatsAppText, sendWhatsAppImage } from "./whatsapp.service";
import { logger } from "../utils/logger";

const UNIT_LABELS_AR: Record<Unit, string> = {
  PIECE: "قطعة",
  DOZEN: "درزن",
  BOX: "علبة",
  CARTON: "كرتون",
};

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { buffer: Buffer.from(match[2], "base64"), mime: match[1] };
}

/**
 * «إشعار فواتير الشراء» — the owner's personal copy of every regular purchase
 * invoice: a photo of each product with its item number, its price, and how
 * many pieces per carton, so the owner can eyeball what actually came in
 * without opening the app.
 *
 * Fire-and-forget by design: called AFTER the invoice's own transaction has
 * committed, and every failure inside here is swallowed — a WhatsApp hiccup
 * must never be the reason a purchase invoice appears to fail.
 *
 * Deliberately narrow in scope (see settings.service.ts's comment on
 * purchaseInvoiceNotifyWhatsappNumber): only the direct invoices-screen
 * purchase path calls this. The China/landed-cost import (hundreds to
 * thousands of lines per batch) and the staff-approval queue (runs inside an
 * outer transaction that can still roll back) are excluded on purpose.
 */
export async function notifyPurchaseInvoiceCreated(invoiceId: string) {
  try {
    const settings = await getSettings().catch(() => null);
    const phone = settings?.purchaseInvoiceNotifyWhatsappNumber?.trim();
    if (!phone) return;

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        invoiceNumber: true,
        customer: { select: { name: true } },
        items: {
          select: {
            productId: true,
            productName: true,
            itemNumber: true,
            unit: true,
            quantity: true,
            unitPrice: true,
          },
        },
      },
    });
    if (!invoice || invoice.items.length === 0) return;

    const productIds = [...new Set(invoice.items.map((it) => it.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, imageUrl: true, pcsPerCarton: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    await sendWhatsAppText(
      phone,
      `🧾 فاتورة شراء جديدة ${invoice.invoiceNumber}${invoice.customer ? ` — ${invoice.customer.name}` : ""}\n${invoice.items.length} صنف`
    ).catch(() => null);
    await new Promise((r) => setTimeout(r, 400));

    for (const item of invoice.items) {
      const product = productById.get(item.productId);
      const codeLine = item.itemNumber ? `\nكود: ${item.itemNumber}` : "";
      const cartonLine = product && product.pcsPerCarton > 1 ? `\n${product.pcsPerCarton} قطعة/كرتون` : "";
      const priceLine = `\n${Number(item.unitPrice)} د.ع`;
      const qtyLine = `\n${item.quantity} ${UNIT_LABELS_AR[item.unit]}`;
      const caption = `📦 ${item.productName}${codeLine}${cartonLine}${priceLine}${qtyLine}`;

      const image = product?.imageUrl ? dataUrlToBuffer(product.imageUrl) : null;
      try {
        if (image) {
          await sendWhatsAppImage(phone, caption, image.buffer, image.mime);
        } else {
          // No photo on file — a text line so the product is never silently
          // missing from the notification (rather than skipping it, which is
          // what the wholesale broadcast does for lack of a better option).
          await sendWhatsAppText(phone, `${caption}\n(بدون صورة)`);
        }
      } catch (err) {
        logger.warn(`[PurchaseInvoiceNotify] failed to send item ${item.productId}: ${err instanceof Error ? err.message : String(err)}`);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  } catch (err) {
    logger.warn(`[PurchaseInvoiceNotify] failed for invoice ${invoiceId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
