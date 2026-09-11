import prisma from "../config/database";
import { getSettings } from "./settings.service";
import { sendWhatsAppText, sendWhatsAppImage } from "./whatsapp.service";
import { logger } from "../utils/logger";

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { buffer: Buffer.from(match[2], "base64"), mime: match[1] };
}

/**
 * «إشعار فواتير الشراء» — fires on every regular purchase invoice: a photo of
 * each product with its item number, its SALE price (not what was paid on the
 * purchase line), and how many pieces per carton — written to be forwarded
 * straight into a customer group, not as an internal receiving log. No arrived
 * quantity, no cost price.
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
          },
        },
      },
    });
    if (!invoice || invoice.items.length === 0) return;

    const productIds = [...new Set(invoice.items.map((it) => it.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, imageUrl: true, pcsPerCarton: true, salePrice: true },
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
      // Sale price, not what was paid on this purchase line — this message is
      // meant to be forwarded straight into a customer group, and the cost
      // price has no business leaving the shop.
      const priceLine = product?.salePrice ? `\n${Number(product.salePrice)} د.ع` : "";
      const caption = `📦 ${item.productName}${codeLine}${cartonLine}${priceLine}`;

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
