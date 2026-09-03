/**
 * «إشعارات المندوب» — the fourth notification box.
 *
 * The owner's stated goal is to know everything the rep does as it happens, so
 * every rep event lands in two places: a WhatsApp message to one dedicated
 * number, and an in-app notification under its own `SALES_AGENT` category so the
 * bell can show rep activity on its own without drowning in the rest.
 *
 * Each event type has its own on/off switch. Muting "new customer" must not
 * cost the owner the "new order" alerts — that is the entire point of splitting
 * them rather than shipping one master toggle.
 *
 * Every send here is best-effort. A WhatsApp outage must never be the reason an
 * order fails to reach the approvals screen: the notification is a courtesy on
 * top of a record that is already committed.
 */
import prisma from "../config/database";
import { logger } from "../utils/logger";
import { getSettings } from "./settings.service";
import { sendWhatsAppText } from "./whatsapp.service";
import { createAppNotification } from "./app-notification.service";

export const SALES_AGENT_CATEGORY = "SALES_AGENT";

export type SalesAgentEvent =
  | "newOrder"
  | "newCustomer"
  | "receipt"
  | "priceRequest"
  | "invoiceChanged";

const money = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * Which switch governs which event. Absent (undefined) means ON: a shop that
 * upgrades and never opens the settings screen should start receiving the
 * alerts, not silently receive nothing.
 */
function isEnabled(
  settings: Awaited<ReturnType<typeof getSettings>> | null,
  event: SalesAgentEvent,
): boolean {
  const map: Record<SalesAgentEvent, boolean | undefined> = {
    newOrder: settings?.salesAgentNotifyNewOrder,
    newCustomer: settings?.salesAgentNotifyNewCustomer,
    receipt: settings?.salesAgentNotifyReceipt,
    priceRequest: settings?.salesAgentNotifyPriceRequest,
    invoiceChanged: settings?.salesAgentNotifyInvoiceChanged,
  };
  return map[event] !== false;
}

/**
 * The dedicated rep number, falling back to the general admin numbers.
 *
 * The owner asked for one number they nominate. The fallbacks mean the alerts
 * still arrive on day one, before that field is filled in.
 */
function targetPhone(settings: Awaited<ReturnType<typeof getSettings>> | null) {
  return (
    settings?.salesAgentWhatsappNumber?.trim() ||
    settings?.catalogAdminWhatsappNumber?.trim() ||
    settings?.storePhone?.trim() ||
    ""
  );
}

type EventPayload = {
  agentName: string;
  customerName?: string;
  phone?: string;
  customerId?: string;
  area?: string | null;
  address?: string | null;
  total?: number;
  lineCount?: number;
  items?: Array<{ productName: string; unit: string; quantity: number; totalPrice: number }>;
  // priceRequest
  productName?: string;
  currentPrice?: number;
  requestedPrice?: number;
  reason?: string;
  // invoiceChanged
  invoiceNumber?: string;
  changeKind?: string;
  /** Extra recipient — used when the rep themselves must be told (invoice edits). */
  agentPhone?: string | null;
};

function build(event: SalesAgentEvent, p: EventPayload): { title: string; lines: string[] } {
  switch (event) {
    case "newOrder": {
      const itemLines = (p.items ?? [])
        .slice(0, 15)
        .map((i) => `• ${i.productName} — ${i.quantity} ${unitLabel(i.unit)} = ${money(i.totalPrice)}`);
      const more = (p.items?.length ?? 0) > 15 ? [`… و${(p.items!.length - 15)} صنف إضافي`] : [];
      return {
        title: "فاتورة جديدة من المندوب",
        lines: [
          "طلب فاتورة من المندوب",
          "",
          `المندوب: ${p.agentName}`,
          `الزبون: ${p.customerName ?? ""}`,
          `الهاتف: ${p.phone ?? ""}`,
          `المجموع: ${money(p.total ?? 0)}`,
          "",
          "المواد المطلوبة:",
          ...itemLines,
          ...more,
          "",
          "روح لصفحة الموافقات وراجع الطلب.",
        ],
      };
    }
    case "newCustomer":
      return {
        title: "زبون جديد من المندوب",
        lines: [
          "زبون جديد سجّله المندوب",
          "",
          `المندوب: ${p.agentName}`,
          `الاسم: ${p.customerName ?? ""}`,
          `الهاتف: ${p.phone ?? ""}`,
          ...(p.area ? [`المنطقة: ${p.area}`] : []),
          ...(p.address ? [`العنوان: ${p.address}`] : []),
          "",
          "الحساب شغّال هسه. راجعه بوقتك إذا الاسم أو المنطقة تحتاج تصحيح.",
        ],
      };
    case "receipt":
      return {
        title: "سند قبض من المندوب",
        lines: [
          "سند قبض سجّله المندوب",
          "",
          `المندوب: ${p.agentName}`,
          `الزبون: ${p.customerName ?? ""}`,
          `المبلغ: ${money(p.total ?? 0)}`,
        ],
      };
    case "priceRequest":
      return {
        title: "طلب سعر خاص من المندوب",
        lines: [
          "طلب تغيير سعر",
          "",
          `المندوب: ${p.agentName}`,
          `الزبون: ${p.customerName ?? ""}`,
          `المادة: ${p.productName ?? ""}`,
          `السعر الحالي: ${money(p.currentPrice ?? 0)}`,
          `السعر المطلوب: ${money(p.requestedPrice ?? 0)}`,
          ...(p.reason ? ["", `السبب: ${p.reason}`] : []),
        ],
      };
    case "invoiceChanged":
      return {
        title: "تعديل على فاتورة مندوب",
        lines: [
          `${p.changeKind ?? "تعديل"} على فاتورة تخص المندوب`,
          "",
          `المندوب: ${p.agentName}`,
          `الفاتورة: ${p.invoiceNumber ?? ""}`,
          `الزبون: ${p.customerName ?? ""}`,
          ...(p.total != null ? [`المبلغ: ${money(p.total)}`] : []),
        ],
      };
  }
}

function unitLabel(unit: string) {
  if (unit === "CARTON") return "كارتون";
  if (unit === "BOX") return "علبة";
  if (unit === "DOZEN") return "دزينة";
  return "قطعة";
}

/**
 * Fire one rep event.
 *
 * Never throws — callers treat it as fire-and-forget and a failure here must not
 * roll back the thing that actually happened.
 */
export async function notifySalesAgentEvent(event: SalesAgentEvent, payload: EventPayload) {
  try {
    const settings = await getSettings().catch(() => null);
    if (!isEnabled(settings, event)) return;

    const { title, lines } = build(event, payload);
    const text = lines.join("\n");

    const owner = targetPhone(settings);
    if (owner) {
      await sendWhatsAppText(owner, text).catch((err) =>
        logger.warn(`[SalesAgent] WhatsApp to owner failed: ${String(err)}`),
      );
    }

    // An invoice edit changes what the rep earns, so they are told directly and
    // immediately rather than discovering it at month end.
    if (event === "invoiceChanged" && payload.agentPhone) {
      await sendWhatsAppText(payload.agentPhone, text).catch((err) =>
        logger.warn(`[SalesAgent] WhatsApp to rep failed: ${String(err)}`),
      );
    }

    await createAppNotification({
      type: `SALES_AGENT_${event.toUpperCase()}`,
      category: SALES_AGENT_CATEGORY,
      // The bell only knows IMPORTANT / MEDIUM / NORMAL — anything else lands in
      // no severity panel at all and is invisible. An invoice change costs the
      // rep money, so it is IMPORTANT; the rest are MEDIUM, which is where the
      // owner looks for "what happened today".
      severity: event === "invoiceChanged" ? "IMPORTANT" : "MEDIUM",
      title,
      message: text,
      roleTarget: "ADMIN",
      entityType: payload.customerId ? "Customer" : null,
      entityId: payload.customerId ?? null,
      metadata: { agentName: payload.agentName, event },
    }).catch((err) => logger.warn(`[SalesAgent] in-app notification failed: ${String(err)}`));
  } catch (err) {
    logger.warn(`[SalesAgent] notify failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Look up a rep's WhatsApp number so an invoice-change alert can reach them.
 * Returns null when the account has no phone on file — the owner still gets the
 * alert either way.
 */
export async function salesAgentPhone(agentId: string | null | undefined) {
  if (!agentId) return null;
  const user = await prisma.user.findUnique({ where: { id: agentId }, select: { phone: true } });
  return user?.phone?.trim() || null;
}
