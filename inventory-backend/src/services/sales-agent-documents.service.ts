/**
 * «فواتير وسندات المندوب» — the rep opening, editing and cancelling their own
 * documents from a customer's statement.
 *
 * The rules, exactly as the owner set them:
 *
 *   - The rep reads the full statement of THEIR customers, shop-made invoices
 *     included. Another rep's customer does not exist for them.
 *   - The rep may change only invoices written under their own account
 *     (`invoice.salesAgentId`). An invoice the shop wrote at the counter is
 *     read-only for the rep, even for their own customer.
 *   - Invoice edits and cancellations follow the rep's setting: forbidden,
 *     through the owner's approval, or straight through with a notification.
 *     The default is straight through.
 *   - A receipt is money the rep holds. Editing or cancelling one ALWAYS goes
 *     through the owner, whatever the setting says — otherwise a rep could take
 *     cash, cancel the receipt, and leave nothing on the statement.
 *   - A price may come down up to 6% off the catalog on the rep's own say-so.
 *     Past that, or below cost, the whole edit waits for the owner.
 *   - Raising a price is not limited.
 *
 * Every write here goes through the SAME services the owner's own screens use
 * (`updateInvoice`, `cancelInvoice`, the approvals executor). Stock movements,
 * balances, printed snapshots and period locks are therefore exactly what they
 * would be had the owner made the change — there is no second implementation
 * of an invoice edit to drift out of step.
 */
import { Unit } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { logger } from "../utils/logger";
import { approvalRequestTypes, createPendingApproval } from "./approval.service";
import { assertOwnCustomer } from "./sales-agent.service";
import { notifySalesAgentEvent } from "./sales-agent-notify.service";
import { checkRepPriceFloors, REP_MAX_DISCOUNT } from "./rep-price-floor";
import { resolveShopWarehouseId } from "./warehouse-stock.service";

const toNumber = (v: unknown): number => (v == null ? 0 : Number(v));
const money = (n: number) => Math.round(n).toLocaleString("en-US");
const UNITS: ReadonlySet<string> = new Set(["PIECE", "DOZEN", "BOX", "CARTON"]);
const UNIT_LABEL: Record<string, string> = { PIECE: "قطعة", DOZEN: "درزن", BOX: "علبة", CARTON: "كارتون" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ── settings ────────────────────────────────────────────────────────── */

/**
 * What the rep may do with their own invoices without asking.
 *
 * Stored as markers on the user's `permissions`, like the rep's other switches
 * (`AGENT_NO_RECEIPT` and friends), and for the same reason: permissions are
 * read fresh from the database on every request, so a change takes effect on
 * the rep's next tap with no logout.
 *
 * ABSENT means DIRECT — the owner's chosen default. A shop that never opens the
 * settings screen gets the behaviour the owner asked for.
 */
export type RepEditMode = "OFF" | "APPROVAL" | "DIRECT";
export type RepEditAction = "INVOICE_EDIT" | "INVOICE_CANCEL";

export const REP_MODE_MARKERS: Record<RepEditAction, { OFF: string; APPROVAL: string }> = {
  INVOICE_EDIT: { OFF: "AGENT_INVOICE_EDIT_OFF", APPROVAL: "AGENT_INVOICE_EDIT_APPROVAL" },
  INVOICE_CANCEL: { OFF: "AGENT_INVOICE_CANCEL_OFF", APPROVAL: "AGENT_INVOICE_CANCEL_APPROVAL" },
};

export function repEditMode(permissions: readonly string[] | undefined, action: RepEditAction): RepEditMode {
  const markers = REP_MODE_MARKERS[action];
  const list = permissions ?? [];
  // OFF wins over APPROVAL if both were somehow written: the stricter reading
  // is the safe one when the stored state is contradictory.
  if (list.includes(markers.OFF)) return "OFF";
  if (list.includes(markers.APPROVAL)) return "APPROVAL";
  return "DIRECT";
}

/* ── reading ─────────────────────────────────────────────────────────── */

type RepAgent = { id: string; name: string; permissions: readonly string[] };

/** The approval currently waiting on this document, if any. */
async function pendingFor(documentId: string, types: string[]) {
  return prisma.pendingApproval.findFirst({
    where: {
      status: "PENDING",
      requestType: { in: types },
      requestData: { path: ["params", "id"], equals: documentId },
    },
    select: { id: true, requestType: true, createdAt: true },
  });
}

const INVOICE_REQUEST_TYPES = [approvalRequestTypes.UPDATE_INVOICE, approvalRequestTypes.CANCEL_INVOICE];
const VOUCHER_REQUEST_TYPES = [approvalRequestTypes.UPDATE_VOUCHER, approvalRequestTypes.CANCEL_VOUCHER];

/**
 * One invoice, as the rep may see it.
 *
 * The select is exhaustive on purpose. An invoice line carries what the shop
 * paid for the product; a `select` that named the whole line, or an `include`,
 * would put that cost on the rep's screen the day someone adds a column.
 */
export async function getAgentInvoice(agent: RepAgent, invoiceId: string) {
  if (!UUID_RE.test(invoiceId)) throw new AppError("الفاتورة غير صحيحة", 400, "INVOICE_ID_INVALID");
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, archivedAt: null },
    select: {
      id: true,
      invoiceNumber: true,
      type: true,
      status: true,
      date: true,
      priceMode: true,
      customerId: true,
      salesAgentId: true,
      subtotal: true,
      discount: true,
      tax: true,
      totalAmount: true,
      paidAmount: true,
      remainingAmount: true,
      notes: true,
      items: {
        select: {
          id: true,
          productId: true,
          productName: true,
          itemNumber: true,
          unit: true,
          quantity: true,
          unitPrice: true,
          totalPrice: true,
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!invoice) throw new AppError("الفاتورة غير موجودة", 404, "INVOICE_NOT_FOUND");

  // Scoped through the customer, which is the rule the owner stated: the rep
  // sees everything about their own customers and nothing about anyone else's.
  // A 404, not a 403, so the id cannot be used to probe for other invoices.
  await assertOwnCustomer(agent.id, invoice.customerId);

  const mine = invoice.salesAgentId === agent.id;
  const pending = await pendingFor(invoice.id, INVOICE_REQUEST_TYPES);
  const editable = mine && invoice.status === "ACTIVE" && invoice.type === "SALE";

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    type: invoice.type,
    status: invoice.status,
    date: invoice.date,
    priceMode: invoice.priceMode,
    customerId: invoice.customerId,
    subtotal: toNumber(invoice.subtotal),
    discount: toNumber(invoice.discount),
    tax: toNumber(invoice.tax),
    totalAmount: toNumber(invoice.totalAmount),
    paidAmount: toNumber(invoice.paidAmount),
    remainingAmount: toNumber(invoice.remainingAmount),
    notes: invoice.notes,
    items: invoice.items.map((line) => ({
      id: line.id,
      productId: line.productId,
      productName: line.productName,
      itemNumber: line.itemNumber,
      unit: line.unit,
      quantity: line.quantity,
      unitPrice: toNumber(line.unitPrice),
      totalPrice: toNumber(line.totalPrice),
    })),
    /** Written under this rep's account — the only kind they may change. */
    mine,
    pending: pending ? { id: pending.id, kind: pending.requestType === approvalRequestTypes.CANCEL_INVOICE ? "CANCEL" : "EDIT", since: pending.createdAt } : null,
    // What the buttons should offer. The server re-checks all of it on submit;
    // this only spares the rep a button that will refuse.
    can: {
      edit: editable && !pending ? repEditMode(agent.permissions, "INVOICE_EDIT") : "OFF",
      cancel: editable && !pending ? repEditMode(agent.permissions, "INVOICE_CANCEL") : "OFF",
    },
    maxDiscount: REP_MAX_DISCOUNT,
  };
}

/** One receipt, as the rep may see it. */
export async function getAgentReceipt(agent: RepAgent, voucherId: string) {
  if (!UUID_RE.test(voucherId)) throw new AppError("السند غير صحيح", 400, "VOUCHER_ID_INVALID");
  const voucher = await prisma.paymentVoucher.findFirst({
    where: { id: voucherId, archivedAt: null },
    select: {
      id: true,
      voucherNumber: true,
      type: true,
      amount: true,
      date: true,
      notes: true,
      cancelledAt: true,
      customerId: true,
      salesAgentId: true,
    },
  });
  if (!voucher || !voucher.customerId) throw new AppError("السند غير موجود", 404, "VOUCHER_NOT_FOUND");
  await assertOwnCustomer(agent.id, voucher.customerId);

  const mine = voucher.salesAgentId === agent.id && voucher.type === "RECEIPT";
  const pending = await pendingFor(voucher.id, VOUCHER_REQUEST_TYPES);
  const open = mine && !voucher.cancelledAt && !pending;

  return {
    id: voucher.id,
    voucherNumber: voucher.voucherNumber,
    type: voucher.type,
    amount: toNumber(voucher.amount),
    date: voucher.date,
    notes: voucher.notes,
    cancelled: Boolean(voucher.cancelledAt),
    customerId: voucher.customerId,
    mine,
    pending: pending ? { id: pending.id, kind: pending.requestType === approvalRequestTypes.CANCEL_VOUCHER ? "CANCEL" : "EDIT", since: pending.createdAt } : null,
    // Always APPROVAL when allowed at all: a receipt is cash in the rep's hand.
    can: { edit: open ? "APPROVAL" : "OFF", cancel: open ? "APPROVAL" : "OFF" },
  };
}

/**
 * For the statement: which rows the rep may open for changes, and which are
 * already waiting on the owner. One read per kind, whatever the row count.
 */
export async function statementFlags(agentId: string, invoiceIds: string[], voucherIds: string[]) {
  const [mineInvoices, mineVouchers, pending] = await Promise.all([
    invoiceIds.length
      ? prisma.invoice.findMany({ where: { id: { in: invoiceIds }, salesAgentId: agentId }, select: { id: true } })
      : [],
    voucherIds.length
      ? prisma.paymentVoucher.findMany({ where: { id: { in: voucherIds }, salesAgentId: agentId }, select: { id: true } })
      : [],
    prisma.pendingApproval.findMany({
      where: { status: "PENDING", requestType: { in: [...INVOICE_REQUEST_TYPES, ...VOUCHER_REQUEST_TYPES] } },
      select: { requestData: true, requestType: true },
    }),
  ]);
  const waiting = new Map<string, "EDIT" | "CANCEL">();
  for (const p of pending) {
    const id = ((p.requestData ?? {}) as { params?: { id?: string } }).params?.id;
    if (!id) continue;
    const cancel = p.requestType === approvalRequestTypes.CANCEL_INVOICE || p.requestType === approvalRequestTypes.CANCEL_VOUCHER;
    waiting.set(id, cancel ? "CANCEL" : "EDIT");
  }
  return {
    mine: new Set([...mineInvoices.map((r) => r.id), ...mineVouchers.map((r) => r.id)]),
    waiting,
  };
}

/* ── invoice edit ────────────────────────────────────────────────────── */

export type RepInvoiceLine = { itemId?: string; productId: string; unit: string; quantity: number; unitPrice: number };

/**
 * Load an invoice for a write, and refuse anything the rep may not change.
 *
 * Everything that makes an edit illegitimate is checked HERE, before any
 * decision about approval vs direct: an approval must never be queued for an
 * invoice the rep had no business touching.
 */
async function loadForWrite(agent: RepAgent, invoiceId: string) {
  if (!UUID_RE.test(invoiceId)) throw new AppError("الفاتورة غير صحيحة", 400, "INVOICE_ID_INVALID");
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, archivedAt: null },
    select: {
      id: true,
      invoiceNumber: true,
      type: true,
      status: true,
      date: true,
      priceMode: true,
      customerId: true,
      salesAgentId: true,
      branchId: true,
      discount: true,
      tax: true,
      paidAmount: true,
      paymentType: true,
      totalAmount: true,
      notes: true,
      customer: { select: { name: true } },
      items: {
        select: { id: true, productId: true, productName: true, warehouseId: true, unit: true, quantity: true, unitPrice: true, notes: true, prepared: true },
      },
    },
  });
  if (!invoice) throw new AppError("الفاتورة غير موجودة", 404, "INVOICE_NOT_FOUND");
  await assertOwnCustomer(agent.id, invoice.customerId);

  if (invoice.salesAgentId !== agent.id) {
    throw new AppError("هذي الفاتورة مو من حسابك — تنعدّل من المحل بس", 403, "INVOICE_NOT_YOURS");
  }
  if (invoice.status !== "ACTIVE") throw new AppError("الفاتورة ملغاة", 409, "INVOICE_CANCELLED");
  if (invoice.type !== "SALE") throw new AppError("تنعدّل فواتير البيع بس", 409, "INVOICE_NOT_SALE");

  const pending = await pendingFor(invoice.id, INVOICE_REQUEST_TYPES);
  if (pending) {
    throw new AppError("أكو طلب على هذي الفاتورة ينتظر موافقة صاحب المحل", 409, "INVOICE_PENDING");
  }

  // The owner may have this very invoice open in the editor right now. Writing
  // under them would be overwritten, or overwrite them, when they save.
  const { getActiveEditLock } = await import("./invoice-count.service");
  const lock = await getActiveEditLock(invoice.id);
  if (lock && lock.userId !== agent.id) {
    throw new AppError(`${lock.userName} يعدّل هذي الفاتورة هسه — جرّب بعد شوية`, 409, "INVOICE_LOCKED");
  }
  return invoice;
}

/**
 * The owner-readable list of what changed, line by line.
 *
 * Built once, here, and carried on both the notification and the approval so
 * the owner never has to open two invoices side by side to see what the rep did.
 */
function describeChanges(
  before: Array<{ id: string; productId: string; productName: string; unit: string; quantity: number; unitPrice: number }>,
  after: RepInvoiceLine[],
): string[] {
  const out: string[] = [];
  const kept = new Set<string>();
  for (const line of after) {
    const old = line.itemId ? before.find((b) => b.id === line.itemId) : undefined;
    if (!old) continue;
    kept.add(old.id);
    const parts: string[] = [];
    if (old.quantity !== line.quantity || old.unit !== line.unit) {
      parts.push(`${old.quantity} ${UNIT_LABEL[old.unit] ?? old.unit} ← ${line.quantity} ${UNIT_LABEL[line.unit] ?? line.unit}`);
    }
    if (Math.round(old.unitPrice) !== Math.round(line.unitPrice)) {
      parts.push(`السعر ${money(old.unitPrice)} ← ${money(line.unitPrice)}`);
    }
    if (parts.length) out.push(`${old.productName}: ${parts.join(" · ")}`);
  }
  for (const old of before) {
    if (!kept.has(old.id)) out.push(`انحذفت: ${old.productName} (${old.quantity} ${UNIT_LABEL[old.unit] ?? old.unit})`);
  }
  return out;
}

export async function editAgentInvoice(
  agent: RepAgent,
  invoiceId: string,
  input: { items?: unknown; notes?: unknown; reason?: unknown },
) {
  const mode = repEditMode(agent.permissions, "INVOICE_EDIT");
  if (mode === "OFF") throw new AppError("تعديل الفواتير مو مسموح إلك", 403, "AGENT_EDIT_OFF");

  const invoice = await loadForWrite(agent, invoiceId);

  const raw = Array.isArray(input.items) ? input.items : [];
  if (raw.length === 0) {
    throw new AppError("ما يصير تشيل كل المواد — إذا الفاتورة كلها غلط، ألغيها", 400, "INVOICE_EMPTY");
  }

  // The rep edits existing lines only — quantity, unit price, or removing one.
  // Adding a product is a new order, which goes through the approvals like any
  // other; letting an edit smuggle in new goods would bypass that.
  const byItemId = new Map(invoice.items.map((line) => [line.id, line]));
  const lines: RepInvoiceLine[] = raw.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    const itemId = String(row.itemId ?? "");
    const original = byItemId.get(itemId);
    if (!original) throw new AppError("ما تكدر تضيف مادة جديدة بالتعديل — سوّيها بطلب جديد", 400, "EDIT_NEW_LINE");
    const quantity = Number(row.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 100000) {
      throw new AppError("الكمية لازم تكون رقم صحيح أكبر من صفر", 400, "QUANTITY_INVALID");
    }
    const unitPrice = Number(row.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new AppError("السعر غير صحيح", 400, "PRICE_INVALID");
    const unit = String(row.unit ?? original.unit);
    if (!UNITS.has(unit)) throw new AppError("وحدة غير معروفة", 400, "UNIT_INVALID");
    // Changing a line's unit re-prices it from a different base; that is a new
    // line in all but name, and gets the same answer as adding one.
    if (unit !== original.unit) throw new AppError("ما تكدر تغيّر الوحدة — احذف السطر واطلب من جديد", 400, "EDIT_UNIT_CHANGE");
    return { itemId, productId: original.productId, unit, quantity, unitPrice };
  });

  const before = invoice.items.map((l) => ({
    id: l.id,
    productId: l.productId,
    productName: l.productName,
    unit: l.unit,
    quantity: l.quantity,
    unitPrice: toNumber(l.unitPrice),
  }));
  const changes = describeChanges(before, lines);
  if (changes.length === 0) throw new AppError("ما غيّرت شي", 400, "EDIT_NO_CHANGE");

  // Only lines whose price CHANGED are held to the floors. A line the rep left
  // alone at a price the owner once approved must not suddenly need approval.
  const repriced = lines.filter((line) => {
    const old = line.itemId ? byItemId.get(line.itemId) : undefined;
    return old && Math.round(toNumber(old.unitPrice)) !== Math.round(line.unitPrice);
  });
  const floors = await checkRepPriceFloors(
    repriced.map((l) => ({ productId: l.productId, unit: l.unit as Unit, unitPrice: l.unitPrice })),
    invoice.priceMode,
  );
  const priceReasons: string[] = [];
  if (floors.overDiscount.length) priceReasons.push(`خصم أكثر من ${Math.round(REP_MAX_DISCOUNT * 100)}٪`);
  if (floors.belowCost.length) priceReasons.push("سعر تحت الكلفة");
  if (floors.unknown.length) priceReasons.push("مادة ما عادت موجودة");

  const newSubtotal = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
  const discount = toNumber(invoice.discount);
  const tax = toNumber(invoice.tax);
  const newTotal = newSubtotal - discount + tax;
  // Money already taken against this invoice cannot be edited from here. An
  // edit that took the total under it would leave a refund nobody recorded.
  if (newTotal < toNumber(invoice.paidAmount) - 0.5) {
    throw new AppError(
      `المدفوع (${money(toNumber(invoice.paidAmount))}) أكثر من المجموع الجديد — راجع صاحب المحل`,
      409,
      "EDIT_BELOW_PAID",
    );
  }

  // Rebuilt from the stored invoice, NOT from anything the client sent besides
  // the lines: customer, date, discount, payment and warehouse are the owner's
  // record and the rep's edit screen does not offer them.
  const body = {
    priceMode: invoice.priceMode,
    customerId: invoice.customerId,
    type: invoice.type,
    date: invoice.date.toISOString(),
    discount,
    tax,
    paidAmount: toNumber(invoice.paidAmount),
    paymentType: invoice.paymentType,
    branchId: invoice.branchId ?? undefined,
    notes: typeof input.notes === "string" ? input.notes.slice(0, 4000) : invoice.notes ?? undefined,
    items: lines.map((line) => {
      const original = byItemId.get(line.itemId!)!;
      return {
        productId: line.productId,
        warehouseId: original.warehouseId ?? undefined,
        unit: line.unit as Unit,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        notes: original.notes ?? undefined,
        prepared: original.prepared,
      };
    }),
  };

  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 500) : "";
  const needsApproval = mode === "APPROVAL" || priceReasons.length > 0;

  if (needsApproval) {
    const approval = await createPendingApproval(
      approvalRequestTypes.UPDATE_INVOICE,
      {
        params: { id: invoice.id },
        body,
        source: "SALES_AGENT",
        salesAgentId: agent.id,
        salesAgentName: agent.name,
        reason: [reason, ...priceReasons].filter(Boolean).join(" · ") || undefined,
        changes,
      },
      agent.id,
      agent.name,
    );
    void notifySalesAgentEvent("editRequest", {
      agentName: agent.name,
      salesAgentId: agent.id,
      customerId: invoice.customerId,
      customerName: invoice.customer.name,
      referenceId: invoice.id,
      approvalId: approval.id,
      requestLabel: priceReasons.length ? "تعديل فاتورة يحتاج موافقة (السعر)" : "طلب تعديل فاتورة",
      invoiceNumber: invoice.invoiceNumber,
      total: newTotal,
      changes,
      reason: [reason, ...priceReasons].filter(Boolean).join(" · ") || undefined,
    });
    return { status: "PENDING" as const, approvalId: approval.id, reasons: priceReasons };
  }

  const { updateInvoice } = await import("./invoice.service");
  await updateInvoice(invoice.id, body as Parameters<typeof updateInvoice>[1], agent.id);

  void notifySalesAgentEvent("invoiceEditedByAgent", {
    agentName: agent.name,
    salesAgentId: agent.id,
    customerId: invoice.customerId,
    customerName: invoice.customer.name,
    referenceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    total: newTotal,
    changes,
    reason: reason || undefined,
  });
  return { status: "APPLIED" as const, reasons: [] as string[] };
}

/* ── invoice cancel ──────────────────────────────────────────────────── */

export async function cancelAgentInvoice(agent: RepAgent, invoiceId: string, input: { reason?: unknown }) {
  const mode = repEditMode(agent.permissions, "INVOICE_CANCEL");
  if (mode === "OFF") throw new AppError("إلغاء الفواتير مو مسموح إلك", 403, "AGENT_CANCEL_OFF");

  const invoice = await loadForWrite(agent, invoiceId);
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 500) : "";
  if (!reason) throw new AppError("اكتب سبب الإلغاء", 400, "CANCEL_REASON_REQUIRED");

  // Goods come back to the shop floor. The rep knows no warehouses and should
  // not have to; المحل is where a rep's goods are served from in the first place.
  const returnWarehouseId = await resolveShopWarehouseId(prisma);

  if (mode === "APPROVAL") {
    const approval = await createPendingApproval(
      approvalRequestTypes.CANCEL_INVOICE,
      {
        params: { id: invoice.id },
        returnWarehouseId,
        source: "SALES_AGENT",
        salesAgentId: agent.id,
        salesAgentName: agent.name,
        reason,
      },
      agent.id,
      agent.name,
    );
    void notifySalesAgentEvent("editRequest", {
      agentName: agent.name,
      salesAgentId: agent.id,
      customerId: invoice.customerId,
      customerName: invoice.customer.name,
      referenceId: invoice.id,
      approvalId: approval.id,
      requestLabel: "طلب إلغاء فاتورة",
      invoiceNumber: invoice.invoiceNumber,
      total: toNumber(invoice.totalAmount),
      reason,
    });
    return { status: "PENDING" as const, approvalId: approval.id };
  }

  const { cancelInvoice } = await import("./invoice.service");
  await cancelInvoice(invoice.id, undefined, returnWarehouseId, agent.id);

  void notifySalesAgentEvent("invoiceCancelledByAgent", {
    agentName: agent.name,
    salesAgentId: agent.id,
    customerId: invoice.customerId,
    customerName: invoice.customer.name,
    referenceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    total: toNumber(invoice.totalAmount),
    reason,
  });
  return { status: "APPLIED" as const };
}

/* ── receipts: always through the owner ──────────────────────────────── */

async function loadReceiptForWrite(agent: RepAgent, voucherId: string) {
  if (!UUID_RE.test(voucherId)) throw new AppError("السند غير صحيح", 400, "VOUCHER_ID_INVALID");
  const voucher = await prisma.paymentVoucher.findFirst({
    where: { id: voucherId, archivedAt: null },
    select: {
      id: true,
      voucherNumber: true,
      type: true,
      amount: true,
      cancelledAt: true,
      customerId: true,
      salesAgentId: true,
      customer: { select: { name: true } },
    },
  });
  if (!voucher || !voucher.customerId) throw new AppError("السند غير موجود", 404, "VOUCHER_NOT_FOUND");
  await assertOwnCustomer(agent.id, voucher.customerId);
  if (voucher.type !== "RECEIPT" || voucher.salesAgentId !== agent.id) {
    throw new AppError("هذا السند مو من حسابك", 403, "VOUCHER_NOT_YOURS");
  }
  if (voucher.cancelledAt) throw new AppError("السند ملغي", 409, "VOUCHER_CANCELLED");
  const pending = await pendingFor(voucher.id, VOUCHER_REQUEST_TYPES);
  if (pending) throw new AppError("أكو طلب على هذا السند ينتظر موافقة صاحب المحل", 409, "VOUCHER_PENDING");
  return voucher;
}

/**
 * Ask the owner to change a receipt's amount or note.
 *
 * Never applied directly, and there is no setting that makes it so. The cash
 * the rep is answerable for («معي الآن») is the sum of their receipts; a rep
 * who could lower one on their own could quietly keep the difference.
 */
export async function requestReceiptEdit(
  agent: RepAgent,
  voucherId: string,
  input: { amount?: unknown; notes?: unknown; reason?: unknown },
) {
  const voucher = await loadReceiptForWrite(agent, voucherId);
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError("المبلغ غير صحيح", 400, "AMOUNT_INVALID");
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 500) : "";
  if (!reason) throw new AppError("اكتب سبب التعديل", 400, "EDIT_REASON_REQUIRED");
  const old = toNumber(voucher.amount);
  if (Math.round(old) === Math.round(amount) && typeof input.notes !== "string") {
    throw new AppError("ما غيّرت شي", 400, "EDIT_NO_CHANGE");
  }

  const approval = await createPendingApproval(
    approvalRequestTypes.UPDATE_VOUCHER,
    {
      params: { id: voucher.id },
      body: { amount, ...(typeof input.notes === "string" ? { notes: input.notes.slice(0, 1000) } : {}) },
      source: "SALES_AGENT",
      salesAgentId: agent.id,
      salesAgentName: agent.name,
      reason,
      changes: [`المبلغ ${money(old)} ← ${money(amount)}`],
    },
    agent.id,
    agent.name,
  );
  void notifySalesAgentEvent("editRequest", {
    agentName: agent.name,
    salesAgentId: agent.id,
    customerId: voucher.customerId!,
    customerName: voucher.customer?.name ?? "",
    referenceId: voucher.id,
    approvalId: approval.id,
    requestLabel: "طلب تعديل سند قبض",
    invoiceNumber: voucher.voucherNumber,
    total: amount,
    changes: [`المبلغ ${money(old)} ← ${money(amount)}`],
    reason,
  });
  return { status: "PENDING" as const, approvalId: approval.id };
}

export async function requestReceiptCancel(agent: RepAgent, voucherId: string, input: { reason?: unknown }) {
  const voucher = await loadReceiptForWrite(agent, voucherId);
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 500) : "";
  if (!reason) throw new AppError("اكتب سبب الإلغاء", 400, "CANCEL_REASON_REQUIRED");

  const approval = await createPendingApproval(
    approvalRequestTypes.CANCEL_VOUCHER,
    {
      params: { id: voucher.id },
      source: "SALES_AGENT",
      salesAgentId: agent.id,
      salesAgentName: agent.name,
      reason,
    },
    agent.id,
    agent.name,
  );
  void notifySalesAgentEvent("editRequest", {
    agentName: agent.name,
    salesAgentId: agent.id,
    customerId: voucher.customerId!,
    customerName: voucher.customer?.name ?? "",
    referenceId: voucher.id,
    approvalId: approval.id,
    requestLabel: "طلب إلغاء سند قبض",
    invoiceNumber: voucher.voucherNumber,
    total: toNumber(voucher.amount),
    reason,
  });
  return { status: "PENDING" as const, approvalId: approval.id };
}

/* ── «أرسل السند للزبون» ─────────────────────────────────────────────── */

/**
 * One send per receipt per minute.
 *
 * Stops the double tap that sends the customer the same receipt twice, and a
 * rep leaning on the button from messaging a shopkeeper ten times from the
 * shop's own number. Per process, which is per shop.
 */
const RECEIPT_SEND_COOLDOWN_MS = 60_000;
const lastReceiptSend = new Map<string, number>();

function fillTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
}

/**
 * Send the customer their receipt on WhatsApp, as the shop.
 *
 * The TEXT is built here, from the shop's own receipt template — never taken
 * from the rep's device. This goes out from the shop's official number, and a
 * rep who could put any words in it could say anything to any customer in the
 * shop's name.
 *
 * Reuses exactly what the owner's «أرسل السند» button uses: the same PDF, the
 * same balance snapshot, and the same approved-template-or-free-text fallback,
 * so a customer cannot receive two different-looking receipts for one payment.
 */
export async function sendAgentReceiptWhatsapp(agent: RepAgent, voucherId: string) {
  if (!UUID_RE.test(voucherId)) throw new AppError("السند غير صحيح", 400, "VOUCHER_ID_INVALID");
  const voucher = await prisma.paymentVoucher.findFirst({
    where: { id: voucherId, archivedAt: null },
    select: { id: true, type: true, salesAgentId: true, cancelledAt: true, customerId: true },
  });
  if (!voucher || !voucher.customerId) throw new AppError("السند غير موجود", 404, "VOUCHER_NOT_FOUND");
  await assertOwnCustomer(agent.id, voucher.customerId);
  if (voucher.type !== "RECEIPT" || voucher.salesAgentId !== agent.id) {
    throw new AppError("ترسل بس السندات الي انت قبضتها", 403, "VOUCHER_NOT_YOURS");
  }
  if (voucher.cancelledAt) throw new AppError("السند ملغي — ما ينرسل", 409, "VOUCHER_CANCELLED");

  const last = lastReceiptSend.get(voucher.id) ?? 0;
  if (Date.now() - last < RECEIPT_SEND_COOLDOWN_MS) {
    throw new AppError("انرسل هذا السند قبل شوية", 429, "RECEIPT_SEND_TOO_SOON");
  }

  const { voucherContext, generateVoucherPdf, money: fmt } = await import("./voucher-export.service");
  const { sendPdfWithTemplateFallback } = await import("./whatsapp.service");
  const { getSettings } = await import("./settings.service");

  const context = await voucherContext(voucher.id);
  const phone = context.voucher.customer?.phone;
  if (!phone) throw new AppError("الزبون ما عنده رقم هاتف", 400, "VOUCHER_PHONE_MISSING");

  const settings = await getSettings();
  const hasSnapshot = context.previous != null && context.final != null;
  const UNKNOWN = "__UNKNOWN_BALANCE__";
  const template =
    (typeof settings.voucherTemplate === "string" && settings.voucherTemplate.trim()) ||
    "مرحباً {{customerName}}،\nاستلمنا منكم {{amount}} {{currency}} بسند رقم {{voucherNumber}} بتاريخ {{date}}.\nالحساب الحالي: {{currentBalance}} {{currency}}.\nشكراً، {{storeName}}.";
  const filled = fillTemplate(template, {
    customerName: context.voucher.customer?.name ?? "",
    voucherNumber: context.voucher.voucherNumber,
    amount: fmt(context.voucher.amount),
    date: String(context.voucher.date instanceof Date ? context.voucher.date.toISOString() : context.voucher.date).slice(0, 10),
    actionVerb: "استلمنا منكم",
    previousBalance: hasSnapshot ? fmt(context.previous ?? 0) : UNKNOWN,
    currentBalance: fmt(hasSnapshot ? context.final ?? 0 : context.voucher.customer?.currentBalance ?? 0),
    currency: context.currency,
    storeName: context.storeName,
  });
  // A receipt from before balance snapshots existed has no honest «before»
  // figure; its line is dropped rather than printed as a guess — the same rule
  // the owner's send follows.
  const message = hasSnapshot
    ? filled
    : filled.split(/\r?\n/).filter((line) => !line.includes(UNKNOWN)).join("\n").trim();

  // Marked before the send, not after: two taps arriving together must not
  // both get past the check while the first is still talking to WhatsApp.
  lastReceiptSend.set(voucher.id, Date.now());
  try {
    const pdf = await generateVoucherPdf(voucher.id);
    await sendPdfWithTemplateFallback(
      phone,
      settings.voucherTemplateName,
      "ar",
      message,
      pdf,
      `voucher-${context.voucher.voucherNumber}.pdf`,
      [
        context.voucher.customer?.name ?? "",
        fmt(context.voucher.amount),
        context.voucher.voucherNumber,
        String(context.voucher.date instanceof Date ? context.voucher.date.toISOString() : context.voucher.date).slice(0, 10),
        fmt(context.previous ?? 0),
        fmt(context.final ?? context.voucher.customer?.currentBalance ?? 0),
        context.storeName,
      ],
      undefined,
    );
  } catch (err) {
    // A failed send may be retried straight away — the cooldown is for sends
    // that went out, not for ones that did not.
    lastReceiptSend.delete(voucher.id);
    throw err;
  }
  return { sent: true, voucherNumber: context.voucher.voucherNumber };
}

/* ── owner: the rep's settings ───────────────────────────────────────── */

/**
 * Set one rep's invoice switches. Touches ONLY these markers, never the rest of
 * the user's permissions — the owner is changing two settings, not the account.
 */
export async function setRepEditModes(
  agentId: string,
  input: Partial<Record<RepEditAction, unknown>>,
) {
  if (!UUID_RE.test(agentId)) throw new AppError("المندوب غير صحيح", 400, "AGENT_ID_INVALID");
  const user = await prisma.user.findUnique({ where: { id: agentId }, select: { id: true, permissions: true } });
  if (!user || !user.permissions.includes("SALES_AGENT")) {
    throw new AppError("هذا المستخدم مو مندوب", 404, "NOT_A_SALES_AGENT");
  }
  let next = [...user.permissions];
  for (const action of Object.keys(REP_MODE_MARKERS) as RepEditAction[]) {
    const value = input[action];
    if (value === undefined) continue;
    if (value !== "OFF" && value !== "APPROVAL" && value !== "DIRECT") {
      throw new AppError("قيمة غير معروفة", 400, "MODE_INVALID");
    }
    const markers = REP_MODE_MARKERS[action];
    next = next.filter((p) => p !== markers.OFF && p !== markers.APPROVAL);
    if (value === "OFF") next.push(markers.OFF);
    if (value === "APPROVAL") next.push(markers.APPROVAL);
  }
  await prisma.user.update({ where: { id: agentId }, data: { permissions: { set: next } } });
  logger.info(`[SalesAgent] edit modes changed for ${agentId}`);
  return {
    INVOICE_EDIT: repEditMode(next, "INVOICE_EDIT"),
    INVOICE_CANCEL: repEditMode(next, "INVOICE_CANCEL"),
  };
}

/** Every rep with their current switches, for the owner's settings panel. */
export async function listRepEditModes() {
  const reps = await prisma.user.findMany({
    where: { permissions: { has: "SALES_AGENT" } },
    select: { id: true, name: true, isActive: true, permissions: true },
    orderBy: { name: "asc" },
  });
  return reps.map((r) => ({
    agentId: r.id,
    name: r.name,
    isActive: r.isActive,
    INVOICE_EDIT: repEditMode(r.permissions, "INVOICE_EDIT"),
    INVOICE_CANCEL: repEditMode(r.permissions, "INVOICE_CANCEL"),
  }));
}
