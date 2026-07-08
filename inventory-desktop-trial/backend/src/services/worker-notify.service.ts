import { getInvoiceById } from "./invoice.service";
import { generateInvoicePdf } from "./invoice-export.service";
import { getSettings } from "./settings.service";
import { sendWhatsAppPdf } from "./whatsapp.service";
import { normalizePhone } from "../utils/phone";
import { logger } from "../utils/logger";

export interface PreparationWorker {
  id: string;
  name: string;
  phone: string;
  active: boolean;
  notes?: string;
}

export interface WorkerSendResult {
  sent: { phone: string; name: string }[];
  failed: { phone: string; name: string; error: string }[];
  skipped: { phone: string; reason: string }[];
}

function money(v: number | string | null | undefined) {
  return new Intl.NumberFormat("en-US").format(Math.round(Number(v ?? 0)));
}

/**
 * Sends the (customer-safe) invoice PDF to selected preparation workers with a
 * "قم بتجهيز هذه الفاتورة" message. Only ACTIVE workers stored in settings may
 * receive it. A WhatsApp failure for one worker never throws.
 */
export async function sendInvoiceToWorkers(
  invoiceId: string,
  requestedPhones: string[],
): Promise<WorkerSendResult> {
  const result: WorkerSendResult = { sent: [], failed: [], skipped: [] };

  const settings = await getSettings();
  const workers = ((settings as { preparationWorkers?: PreparationWorker[] }).preparationWorkers ?? []);
  const activeByPhone = new Map<string, PreparationWorker>();
  for (const w of workers) {
    if (w.active && w.phone?.trim()) activeByPhone.set(normalizePhone(w.phone), w);
  }

  const targets: PreparationWorker[] = [];
  const seen = new Set<string>();
  for (const raw of requestedPhones) {
    const norm = normalizePhone(raw);
    if (!norm) {
      result.skipped.push({ phone: raw, reason: "رقم غير صالح" });
      continue;
    }
    if (seen.has(norm)) continue;
    seen.add(norm);
    const worker = activeByPhone.get(norm);
    if (!worker) {
      result.skipped.push({ phone: raw, reason: "ليس عاملاً مفعّلاً" });
      continue;
    }
    targets.push(worker);
  }

  if (targets.length === 0) return result;

  const invoice = await getInvoiceById(invoiceId);
  const pdf = await generateInvoicePdf(invoiceId);
  const itemCount = Array.isArray(invoice.items) ? invoice.items.length : 0;
  const message =
    `قم بتجهيز هذه الفاتورة\n` +
    `رقم الفاتورة: ${invoice.invoiceNumber}\n` +
    `الزبون: ${invoice.customer?.name ?? "-"}\n` +
    `المجموع: ${money(invoice.totalAmount)}\n` +
    `عدد الأصناف: ${itemCount}\n` +
    `📎 الفاتورة مرفقة كملف PDF`;
  const filename = `${invoice.invoiceNumber}.pdf`;

  for (const worker of targets) {
    try {
      await sendWhatsAppPdf(worker.phone, message, pdf, filename);
      result.sent.push({ phone: worker.phone, name: worker.name });
      logger.info(`[WorkerNotify] invoice ${invoice.invoiceNumber} → ${worker.name} (${worker.phone})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.failed.push({ phone: worker.phone, name: worker.name, error: msg });
      logger.warn(`[WorkerNotify] send failed to ${worker.name} (${worker.phone}): ${msg}`);
    }
  }

  return result;
}
