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
  | "invoiceChanged"
  // Added with «إشعارات المندوبين». The first two are routine and reach the
  // owner's rep page only; the rest change money after the fact or wait on
  // the owner, so they also reach WhatsApp and the bell, unconditionally.
  | "visit"
  | "issue"
  | "areaProposal"
  | "invoiceEditedByAgent"
  | "invoiceCancelledByAgent"
  | "editRequest";

/**
 * Events the REP did, as opposed to things done TO the rep's work.
 *
 * `invoiceChanged` is the owner editing a rep's invoice: the rep is told, but it
 * is not rep activity and does not belong in the owner's feed of what reps did.
 */
const REP_ORIGINATED: ReadonlySet<SalesAgentEvent> = new Set<SalesAgentEvent>([
  "newOrder",
  "newCustomer",
  "receipt",
  "priceRequest",
  "visit",
  "issue",
  "areaProposal",
  "invoiceEditedByAgent",
  "invoiceCancelledByAgent",
  "editRequest",
]);

/**
 * Events that need the owner's eyes: they change money after it was recorded,
 * or they are sitting in the approvals screen. These go to WhatsApp and the
 * bell regardless of the per-event switches — the switches exist to quiet
 * routine traffic, and none of these is routine.
 */
const ALWAYS_LOUD: ReadonlySet<SalesAgentEvent> = new Set<SalesAgentEvent>([
  "areaProposal",
  "invoiceEditedByAgent",
  "invoiceCancelledByAgent",
  "editRequest",
]);

/** Routine events: recorded for the owner's rep page, never pushed anywhere. */
const PAGE_ONLY: ReadonlySet<SalesAgentEvent> = new Set<SalesAgentEvent>(["visit", "issue"]);

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
    visit: undefined,
    issue: undefined,
    areaProposal: undefined,
    invoiceEditedByAgent: undefined,
    invoiceCancelledByAgent: undefined,
    editRequest: undefined,
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
  /**
   * The rep's id. Required for the event to reach the owner's rep feed —
   * a name alone cannot be filtered by, and two reps can share one.
   */
  salesAgentId?: string;
  /** The row the action touched: invoice, voucher, approval or visit. */
  referenceId?: string | null;
  /** Set when the action is waiting in the approvals screen. */
  approvalId?: string | null;
  /** editRequest: what is being asked for, already in Arabic. */
  requestLabel?: string;
  /** editRequest / edits: human-readable changes, one per line. */
  changes?: string[];
  /** visit: the outcome the rep chose, already in Arabic. */
  outcome?: string | null;
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
    case "visit":
      return {
        title: "زيارة",
        lines: [
          `${p.agentName} زار ${p.customerName ?? "زبون"}`,
          ...(p.outcome ? [`النتيجة: ${p.outcome}`] : []),
        ],
      };
    case "issue":
      return {
        title: "مشكلة مسجّلة",
        lines: [
          `${p.agentName} سجّل مشكلة عند ${p.customerName ?? "زبون"}`,
          ...(p.productName ? [`المادة: ${p.productName}`] : []),
          ...(p.reason ? [`السبب: ${p.reason}`] : []),
        ],
      };
    case "areaProposal":
      return {
        title: "اقتراح منطقة جديدة",
        lines: [
          "المندوب يقترح منطقة مو موجودة بالقائمة",
          "",
          `المندوب: ${p.agentName}`,
          `المنطقة: ${p.reason ?? ""}`,
          "",
          "روح لصفحة الموافقات حتى تضيفها أو ترفضها.",
        ],
      };
    case "invoiceEditedByAgent":
      return {
        title: "المندوب عدّل فاتورة",
        lines: [
          "المندوب عدّل فاتورة — التعديل انطبق",
          "",
          `المندوب: ${p.agentName}`,
          `الفاتورة: ${p.invoiceNumber ?? ""}`,
          `الزبون: ${p.customerName ?? ""}`,
          ...(p.total != null ? [`المجموع الجديد: ${money(p.total)}`] : []),
          ...((p.changes ?? []).length > 0 ? ["", "شنو تغيّر:", ...p.changes!.slice(0, 12).map((c) => `• ${c}`)] : []),
        ],
      };
    case "invoiceCancelledByAgent":
      return {
        title: "المندوب ألغى فاتورة",
        lines: [
          "المندوب ألغى فاتورة — البضاعة رجعت لمخزن المحل",
          "",
          `المندوب: ${p.agentName}`,
          `الفاتورة: ${p.invoiceNumber ?? ""}`,
          `الزبون: ${p.customerName ?? ""}`,
          ...(p.total != null ? [`المبلغ: ${money(p.total)}`] : []),
          ...(p.reason ? [`السبب: ${p.reason}`] : []),
        ],
      };
    case "editRequest":
      return {
        title: p.requestLabel ?? "طلب من المندوب",
        lines: [
          `${p.requestLabel ?? "طلب"} — ينتظر موافقتك`,
          "",
          `المندوب: ${p.agentName}`,
          ...(p.invoiceNumber ? [`المستند: ${p.invoiceNumber}`] : []),
          `الزبون: ${p.customerName ?? ""}`,
          ...(p.total != null ? [`المبلغ: ${money(p.total)}`] : []),
          ...((p.changes ?? []).length > 0 ? ["", ...p.changes!.slice(0, 12).map((c) => `• ${c}`)] : []),
          ...(p.reason ? ["", `السبب: ${p.reason}`] : []),
          "",
          "روح لصفحة الموافقات.",
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
    const { title, lines } = build(event, payload);
    const text = lines.join("\n");

    // The owner's feed gets EVERY rep action, first and unconditionally. The
    // per-event switches below were built to quiet WhatsApp and the bell; they
    // used to gate this too, so muting "receipt" alerts also erased receipts
    // from the record of what the rep did.
    if (REP_ORIGINATED.has(event)) {
      await recordAgentActivity(event, payload, title, text);
    }

    if (PAGE_ONLY.has(event)) return;

    const settings = await getSettings().catch(() => null);
    if (!ALWAYS_LOUD.has(event) && !isEnabled(settings, event)) return;

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
      severity: event === "invoiceChanged" || ALWAYS_LOUD.has(event) ? "IMPORTANT" : "MEDIUM",
      title,
      message: text,
      roleTarget: "ADMIN",
      entityType: payload.customerId ? "Customer" : null,
      entityId: payload.customerId ?? null,
      metadata: { agentName: payload.agentName, salesAgentId: payload.salesAgentId ?? null, event },
    }).catch((err) => logger.warn(`[SalesAgent] in-app notification failed: ${String(err)}`));
  } catch (err) {
    logger.warn(`[SalesAgent] notify failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Add a finished visit's result to the row written when it started.
 *
 * One row per stop: a second «زيارة» row for the same visit would count twice
 * in the owner's unread number and read as two stops. Never throws.
 */
export async function annotateVisitOutcome(visitId: string, outcomeLabel: string) {
  try {
    const row = await prisma.salesAgentActivity.findFirst({
      where: { referenceId: visitId, kind: "VISIT" },
      select: { id: true, message: true },
    });
    if (!row || row.message.includes("النتيجة:")) return;
    await prisma.salesAgentActivity.update({
      where: { id: row.id },
      data: { message: `${row.message}\nالنتيجة: ${outcomeLabel}` },
    });
  } catch (err) {
    logger.warn(`[SalesAgent] visit outcome not recorded: ${String(err)}`);
  }
}

/** The feed's own name for each event, so the owner can filter by kind. */
const ACTIVITY_KIND: Record<SalesAgentEvent, string> = {
  newOrder: "ORDER",
  newCustomer: "NEW_CUSTOMER",
  receipt: "RECEIPT",
  priceRequest: "PRICE_REQUEST",
  invoiceChanged: "INVOICE_CHANGED",
  visit: "VISIT",
  issue: "ISSUE",
  areaProposal: "AREA_PROPOSAL",
  invoiceEditedByAgent: "INVOICE_EDIT",
  invoiceCancelledByAgent: "INVOICE_CANCEL",
  editRequest: "EDIT_REQUEST",
};

/**
 * One row in «إشعارات المندوبين».
 *
 * Skipped silently without a rep id: a row nobody can filter by rep is noise,
 * and every caller in this codebase now passes one. Never throws.
 */
async function recordAgentActivity(
  event: SalesAgentEvent,
  payload: EventPayload,
  title: string,
  message: string,
) {
  if (!payload.salesAgentId) return;
  try {
    await prisma.salesAgentActivity.create({
      data: {
        salesAgentId: payload.salesAgentId,
        kind: ACTIVITY_KIND[event],
        customerId: payload.customerId ?? null,
        referenceId: payload.referenceId ?? null,
        approvalId: payload.approvalId ?? null,
        title,
        message,
        important: ALWAYS_LOUD.has(event),
        amount: payload.total != null && Number.isFinite(payload.total) ? payload.total : null,
      },
    });
  } catch (err) {
    logger.warn(`[SalesAgent] activity not recorded: ${String(err)}`);
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
