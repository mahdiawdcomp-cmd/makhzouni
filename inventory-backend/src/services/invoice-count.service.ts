// ── «جرد الفاتورة» — counting a written invoice against what actually arrived ─
//
// Two audiences, deliberately NOT symmetric:
//
//   WORKER   counts inside the shop before the goods leave. The shop trusts its
//            own staff, so the counted quantities are applied to the invoice the
//            moment they are submitted. The owner reads what happened afterwards
//            on the invoice itself and in the notification bell.
//
//   CUSTOMER counts on arrival. Nothing is touched: an approval is raised and
//            the change lands only if the owner approves it.
//
// Everything below is shared by both; the split lives in `submitCount`.

import crypto from "node:crypto";
import { InvoiceCountAudience, InvoiceCountLinkStatus, InvoiceStatus, Prisma, Unit } from "@prisma/client";

import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { amountInPieces, effectiveBoxPieces, roundMoney } from "../utils/financial";
import { getInvoiceById, updateInvoice, type CreateInvoiceInput } from "./invoice.service";
import { getSettings } from "./settings.service";

export const COUNT_LINK_TTL_HOURS: Record<InvoiceCountAudience, number> = {
  // A worker counts before the load leaves the shop — same day's work.
  WORKER: 24,
  // A customer counts when the goods reach them, which can be a couple of days.
  CUSTOMER: 72,
};

/** A lock older than this is treated as abandoned (a closed browser tab). */
export const EDIT_LOCK_STALE_MS = 60_000;

/**
 * Either the base client or an open transaction. Applying a count from the
 * approvals screen happens INSIDE that screen's transaction, and opening a
 * second one from within it is how you deadlock an invoice edit.
 */
type Db = Prisma.TransactionClient | typeof prisma;

// ── Line shapes ──────────────────────────────────────────────────────────────

/** One invoice line as the counter sees it. No cost/profit fields, ever. */
export interface CountLineView {
  itemId: string;
  productId: string;
  productName: string;
  itemNumber: string | null;
  unit: Unit;
  unitLabel: string;
  quantity: number;
  /** Pieces the invoice says were sent — what "كامل" fills in. */
  expectedPieces: number;
  pcsPerCarton: number;
  boxPieces: number | null;
  unitPrice: number;
  totalPrice: number;
  notes: string | null;
}

/** One line as it comes back from the counting page. */
export interface CountSubmissionLine {
  itemId: string;
  /** Pieces actually received. 0 means "nothing arrived" — a real answer. */
  receivedPieces: number;
}

/** The frozen record stored on the link and shown forever after. */
export interface CountResultLine {
  itemId: string;
  productId: string;
  productName: string;
  itemNumber: string | null;
  unit: Unit;
  quantity: number;
  expectedPieces: number;
  receivedPieces: number;
  differencePieces: number;
}

export interface CountResult {
  countedAt: string;
  lines: CountResultLine[];
  differenceCount: number;
  /** Invoice total before the count — so the record still reads true later. */
  totalBefore: number;
}

/** ISO date (YYYY-MM-DD) from whatever shape the invoice's date arrives in. */
function isoDate(value: unknown): string {
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) : d.toISOString().slice(0, 10);
}

function unitLabelAr(unit: Unit): string {
  if (unit === Unit.CARTON) return "كرتونة";
  if (unit === Unit.BOX) return "علبة";
  if (unit === Unit.DOZEN) return "درزن";
  return "قطعة";
}

// ── Link creation ────────────────────────────────────────────────────────────

export interface CreateCountLinkInput {
  invoiceId: string;
  audience: InvoiceCountAudience;
  /** WORKER only: the id of an active worker in settings.preparationWorkers. */
  workerId?: string;
  createdBy: string;
}

/**
 * Mint a counting link. Any still-live link for the same audience is revoked
 * first: two people counting the same invoice at once would each overwrite the
 * other's answer.
 */
export async function createCountLink(input: CreateCountLinkInput) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    select: {
      id: true,
      status: true,
      archivedAt: true,
      type: true,
      customer: { select: { name: true, phone: true } },
    },
  });

  if (!invoice) throw new AppError("الفاتورة غير موجودة", 404, "INVOICE_NOT_FOUND");
  if (invoice.archivedAt || invoice.status !== InvoiceStatus.ACTIVE) {
    throw new AppError("لا يمكن إرسال رابط جرد لفاتورة ملغاة أو محذوفة", 400, "INVOICE_CLOSED");
  }

  let recipientId: string | null = null;
  let recipientName: string;
  let recipientPhone: string | null;

  if (input.audience === InvoiceCountAudience.WORKER) {
    const settings = await getSettings();
    const workers = (settings.preparationWorkers ?? []) as Array<{
      id: string; name: string; phone: string; active: boolean;
    }>;
    const worker = workers.find((w) => w.id === input.workerId && w.active);
    if (!worker) {
      throw new AppError("اختر عاملاً مفعّلاً من عمال التجهيز", 400, "WORKER_NOT_FOUND");
    }
    recipientId = worker.id;
    recipientName = worker.name;
    recipientPhone = worker.phone?.trim() || null;
  } else {
    if (!invoice.customer?.phone?.trim()) {
      throw new AppError("هذا الزبون ما عنده رقم هاتف — أضف الرقم أولاً", 400, "CUSTOMER_HAS_NO_PHONE");
    }
    recipientName = invoice.customer.name;
    recipientPhone = invoice.customer.phone.trim();
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + COUNT_LINK_TTL_HOURS[input.audience] * 3600_000);

  return prisma.$transaction(async (tx) => {
    await tx.invoiceCountLink.updateMany({
      where: {
        invoiceId: input.invoiceId,
        audience: input.audience,
        status: { in: [InvoiceCountLinkStatus.OPEN, InvoiceCountLinkStatus.VIEWED] },
      },
      data: { status: InvoiceCountLinkStatus.REVOKED, revokedAt: now },
    });

    return tx.invoiceCountLink.create({
      data: {
        invoiceId: input.invoiceId,
        audience: input.audience,
        token: crypto.randomBytes(24).toString("base64url"),
        recipientId,
        recipientName,
        recipientPhone,
        expiresAt,
        createdBy: input.createdBy,
      },
    });
  });
}

/** Revoke a link the shop no longer wants used. */
export async function revokeCountLink(id: string) {
  const link = await prisma.invoiceCountLink.findUnique({ where: { id } });
  if (!link) throw new AppError("الرابط غير موجود", 404, "COUNT_LINK_NOT_FOUND");
  if (link.status === InvoiceCountLinkStatus.SUBMITTED) {
    throw new AppError("هذا الرابط تم الجرد عليه ولا يمكن إلغاؤه", 400, "COUNT_LINK_SUBMITTED");
  }
  return prisma.invoiceCountLink.update({
    where: { id },
    data: { status: InvoiceCountLinkStatus.REVOKED, revokedAt: new Date() },
  });
}

// ── Reading a link ───────────────────────────────────────────────────────────

/** Why a link cannot be counted on right now, in the counter's own words. */
export type CountLinkBlockReason = "EXPIRED" | "SUBMITTED" | "REVOKED" | "INVOICE_CLOSED";

const BLOCK_MESSAGES: Record<CountLinkBlockReason, string> = {
  EXPIRED: "انتهت مدة هذا الرابط. اطلب من المحل رابطاً جديداً.",
  SUBMITTED: "تم إرسال الجرد على هذا الرابط مسبقاً. شكراً لك.",
  REVOKED: "هذا الرابط لم يعد صالحاً. اطلب من المحل رابطاً جديداً.",
  INVOICE_CLOSED: "هذه الفاتورة لم تعد فعّالة. راجع المحل.",
};

export interface CountLinkView {
  token: string;
  audience: InvoiceCountAudience;
  recipientName: string;
  expiresAt: string;
  /** Set when counting is not possible; the page shows the message instead. */
  blocked: { reason: CountLinkBlockReason; message: string } | null;
  /** Set while someone in the shop has the invoice open for editing. */
  editingBy: string | null;
  invoice: {
    id: string;
    invoiceNumber: string;
    date: string;
    type: string;
    customerName: string;
    customerPhone: string | null;
    paymentType: string;
    notes: string | null;
    subtotal: number;
    discount: number;
    tax: number;
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
    previousBalance: number;
    finalBalance: number;
    lines: CountLineView[];
  };
  store: {
    storeName: string;
    storeLogo: string | null;
    storePhone: string | null;
    storeAddress: string | null;
    currency: string;
    invoiceDesign: string | null;
  };
}

/**
 * Everything the public counting page needs. `markViewed` records the open —
 * "never opened the link" is one of the states the shop is shown afterwards, so
 * it has to be a fact and not a guess.
 */
export async function getCountLinkByToken(token: string, markViewed = false): Promise<CountLinkView> {
  const link = await prisma.invoiceCountLink.findUnique({ where: { token } });
  if (!link) throw new AppError("رابط غير صالح", 404, "COUNT_LINK_NOT_FOUND");

  const [invoice, settings] = await Promise.all([
    getInvoiceById(link.invoiceId),
    getSettings().catch(() => null),
  ]);

  const blockReason = resolveBlockReason(link, invoice.status, invoice.archivedAt);

  if (markViewed && !blockReason) {
    const now = new Date();
    await prisma.invoiceCountLink.update({
      where: { id: link.id },
      data: {
        status: InvoiceCountLinkStatus.VIEWED,
        firstViewedAt: link.firstViewedAt ?? now,
        lastViewedAt: now,
        viewCount: { increment: 1 },
      },
    });
  }

  const editLock = await getActiveEditLock(link.invoiceId);

  return {
    token: link.token,
    audience: link.audience,
    recipientName: link.recipientName,
    expiresAt: link.expiresAt.toISOString(),
    blocked: blockReason ? { reason: blockReason, message: BLOCK_MESSAGES[blockReason] } : null,
    editingBy: editLock?.userName ?? null,
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      date: isoDate(invoice.date),
      type: invoice.type,
      customerName: invoice.customer?.name ?? "",
      customerPhone: invoice.customer?.phone ?? null,
      paymentType: invoice.paymentType,
      notes: invoice.notes ?? null,
      subtotal: Number(invoice.subtotal),
      discount: Number(invoice.discount),
      tax: Number(invoice.tax),
      totalAmount: Number(invoice.totalAmount),
      paidAmount: Number(invoice.paidAmount),
      remainingAmount: Number(invoice.remainingAmount),
      previousBalance: Number(invoice.previousBalance ?? 0),
      finalBalance: Number(invoice.finalBalance ?? 0),
      lines: (invoice.items ?? []).map((item: any) => toCountLine(item)),
    },
    store: {
      storeName: settings?.storeName ?? "",
      storeLogo: settings?.storeLogo ?? null,
      storePhone: settings?.storePhone ?? null,
      storeAddress: settings?.storeAddress ?? null,
      currency: settings?.currency ?? "د.ع",
      invoiceDesign: settings?.invoiceDesign ?? null,
    },
  };
}

function toCountLine(item: any): CountLineView {
  const pcsPerCarton = Math.max(1, item.product?.pcsPerCarton ?? 1);
  const boxPieces = item.product?.boxPieces ?? null;
  return {
    itemId: item.id,
    productId: item.productId,
    productName: item.productName ?? "",
    itemNumber: item.itemNumber ?? item.product?.itemNumber ?? null,
    unit: item.unit,
    unitLabel: unitLabelAr(item.unit),
    quantity: Number(item.quantity),
    expectedPieces: amountInPieces(item.unit, Number(item.quantity), pcsPerCarton, boxPieces),
    pcsPerCarton,
    boxPieces,
    unitPrice: Number(item.unitPrice),
    totalPrice: Number(item.totalPrice),
    notes: item.notes ?? null,
  };
}

function resolveBlockReason(
  link: { status: InvoiceCountLinkStatus; expiresAt: Date },
  invoiceStatus: string,
  archivedAt: unknown,
): CountLinkBlockReason | null {
  if (link.status === InvoiceCountLinkStatus.SUBMITTED) return "SUBMITTED";
  if (link.status === InvoiceCountLinkStatus.REVOKED) return "REVOKED";
  if (link.expiresAt.getTime() <= Date.now()) return "EXPIRED";
  if (archivedAt || invoiceStatus !== InvoiceStatus.ACTIVE) return "INVOICE_CLOSED";
  return null;
}

// ── Applying a count to the invoice ──────────────────────────────────────────

export interface ApplyCountOutcome {
  totalBefore: number;
  totalAfter: number;
  /** Cash the shop must hand back because a paid invoice shrank below what was paid. */
  refundDue: number;
  removedLines: number;
  changedLines: number;
}

/**
 * Rewrite the invoice's lines to the counted quantities.
 *
 * Rules the owner set, in order:
 *  - the unit PRICE never moves. A carton of 240 counted at 210 keeps the same
 *    price per piece; only the quantity (and therefore the total) changes.
 *  - a line counted at zero is removed outright — a zero line means nothing on
 *    an invoice and only confuses the totals.
 *  - a count that still divides into whole cartons stays in cartons; one that
 *    does not becomes loose pieces at the same per-piece price, so no rounding
 *    can leak into the money.
 *  - a paid invoice that shrinks below what was paid has its paidAmount lowered
 *    to the new total, and the difference is recorded as cash owed back. It is
 *    NOT left sitting as a credit: the owner wants to be told to hand it over.
 */
export async function applyCountToInvoice(
  invoiceId: string,
  countedByPieces: Map<string, number>,
  updatedBy: string,
  db: Db = prisma,
): Promise<ApplyCountOutcome> {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      items: { include: { product: { select: { pcsPerCarton: true, boxPieces: true } } } },
      coupon: { select: { code: true } },
    },
  });
  if (!invoice) throw new AppError("الفاتورة غير موجودة", 404, "INVOICE_NOT_FOUND");
  if (invoice.archivedAt || invoice.status !== InvoiceStatus.ACTIVE) {
    throw new AppError("لا يمكن تعديل فاتورة ملغاة أو محذوفة", 400, "INVOICE_CLOSED");
  }

  const totalBefore = Number(invoice.totalAmount);
  const paidBefore = Number(invoice.paidAmount);

  let removedLines = 0;
  let changedLines = 0;
  const items: CreateInvoiceInput["items"] = [];

  for (const item of invoice.items) {
    const pcsPerCarton = Math.max(1, item.product?.pcsPerCarton ?? 1);
    const boxPieces = item.product?.boxPieces ?? null;
    const expected = amountInPieces(item.unit, Number(item.quantity), pcsPerCarton, boxPieces);
    const counted = countedByPieces.has(item.id) ? countedByPieces.get(item.id)! : expected;

    if (counted !== expected) changedLines += 1;
    if (counted <= 0) {
      removedLines += 1;
      continue;
    }

    const rebuilt = rebuildLine(item.unit, Number(item.unitPrice), counted, pcsPerCarton, boxPieces);
    items.push({
      productId: item.productId,
      warehouseId: item.warehouseId ?? undefined,
      unit: rebuilt.unit,
      quantity: rebuilt.quantity,
      unitPrice: rebuilt.unitPrice,
      notes: item.notes ?? undefined,
      // Counting corrects a document, never blocks on stock: the goods have
      // already physically moved by the time anyone counts them.
      allowNegativeStock: true,
    });
  }

  if (items.length === 0) {
    throw new AppError(
      "لا يمكن تصفير كل أصناف الفاتورة من الجرد — ألغِ الفاتورة بدل ذلك",
      400,
      "COUNT_EMPTIES_INVOICE",
    );
  }

  // A fixed discount larger than what is left would drive the invoice negative.
  const newSubtotal = roundMoney(items.reduce((sum, i) => sum + (i.unitPrice ?? 0) * i.quantity, 0));
  const discount = Math.min(Number(invoice.discount), newSubtotal);
  const tax = Number(invoice.tax);
  const projectedTotal = roundMoney(newSubtotal - discount + tax);

  // Option (ب): the money is handed back, not parked as a credit.
  const refundDue = Math.max(0, roundMoney(paidBefore - projectedTotal));
  const paidAmount = refundDue > 0 ? projectedTotal : paidBefore;

  const updated = await updateInvoice(
    invoiceId,
    {
      customerId: invoice.customerId,
      type: invoice.type,
      date: invoice.date.toISOString(),
      discount,
      tax,
      paidAmount,
      paymentType: invoice.paymentType,
      branchId: invoice.branchId ?? undefined,
      notes: invoice.notes ?? undefined,
      // Mirrors the invoice edit screen: a coupon is re-applied, redeemed
      // loyalty points are not re-spent.
      couponCode: invoice.coupon?.code,
      items,
    },
    updatedBy,
    // Joins the caller's transaction when there is one.
    db === prisma ? undefined : (db as Prisma.TransactionClient),
  );

  return {
    totalBefore,
    totalAfter: Number(updated.totalAmount),
    refundDue,
    removedLines,
    changedLines,
  };
}

/**
 * Express `pieces` in the friendliest unit that divides it exactly, keeping the
 * price per piece identical to what the line already charged.
 */
export function rebuildLine(
  unit: Unit,
  unitPrice: number,
  pieces: number,
  pcsPerCarton: number,
  boxPieces?: number | null,
): { unit: Unit; quantity: number; unitPrice: number } {
  const perUnit = amountInPieces(unit, 1, pcsPerCarton, boxPieces);
  if (perUnit > 0 && pieces % perUnit === 0) {
    return { unit, quantity: pieces / perUnit, unitPrice };
  }

  // Does not divide into the original unit — fall back to a unit that fits,
  // preferring the largest one that divides exactly so the line stays readable.
  const piecePrice = perUnit > 0 ? unitPrice / perUnit : unitPrice;
  const candidates: Array<{ unit: Unit; per: number }> = [
    { unit: Unit.CARTON, per: pcsPerCarton },
    { unit: Unit.BOX, per: effectiveBoxPieces(pcsPerCarton, boxPieces) },
    { unit: Unit.DOZEN, per: 12 },
  ];
  for (const candidate of candidates) {
    if (candidate.per > 1 && pieces % candidate.per === 0) {
      return {
        unit: candidate.unit,
        quantity: pieces / candidate.per,
        unitPrice: roundMoney(piecePrice * candidate.per),
      };
    }
  }
  return { unit: Unit.PIECE, quantity: pieces, unitPrice: roundMoney(piecePrice) };
}

// ── Submission ───────────────────────────────────────────────────────────────

export interface SubmitCountResult {
  applied: boolean;
  hasDifference: boolean;
  outcome: ApplyCountOutcome | null;
  result: CountResult;
  linkId: string;
  audience: InvoiceCountAudience;
}

/**
 * Record a submitted count. A WORKER submission is applied here and now; a
 * CUSTOMER submission is only recorded — phase 3 raises the approval that
 * eventually applies it.
 *
 * Every line must be answered. A missing line is refused rather than assumed
 * complete: "I forgot this one" and "all of it arrived" must never look alike.
 */
export async function submitCount(
  token: string,
  lines: CountSubmissionLine[],
): Promise<SubmitCountResult> {
  const link = await prisma.invoiceCountLink.findUnique({ where: { token } });
  if (!link) throw new AppError("رابط غير صالح", 404, "COUNT_LINK_NOT_FOUND");

  const invoice = await prisma.invoice.findUnique({
    where: { id: link.invoiceId },
    select: {
      status: true,
      archivedAt: true,
      invoiceNumber: true,
      totalAmount: true,
      createdBy: true,
      items: {
        select: {
          id: true, productId: true, productName: true, itemNumber: true,
          unit: true, quantity: true,
          product: { select: { itemNumber: true, pcsPerCarton: true, boxPieces: true } },
        },
      },
    },
  });
  if (!invoice) throw new AppError("الفاتورة غير موجودة", 404, "INVOICE_NOT_FOUND");

  const blockReason = resolveBlockReason(link, invoice.status, invoice.archivedAt);
  if (blockReason) throw new AppError(BLOCK_MESSAGES[blockReason], 400, `COUNT_LINK_${blockReason}`);

  const editLock = await getActiveEditLock(link.invoiceId);
  if (editLock) {
    throw new AppError(
      `${editLock.userName} يعدّل على الفاتورة الآن — انتظر لحظة ثم أعد الإرسال`,
      409,
      "INVOICE_BEING_EDITED",
    );
  }

  const submitted = new Map<string, number>();
  for (const line of lines) {
    const pieces = Number(line.receivedPieces);
    if (!Number.isFinite(pieces) || pieces < 0) {
      throw new AppError("الكمية الواصلة غير صحيحة", 400, "INVALID_RECEIVED_QUANTITY");
    }
    submitted.set(line.itemId, Math.round(pieces));
  }

  const missing = invoice.items.filter((item) => !submitted.has(item.id));
  if (missing.length > 0) {
    throw new AppError(
      `بقيت ${missing.length} مادة بدون جرد. اكتب الواصل لكل مادة — والصفر جواب أيضاً.`,
      400,
      "COUNT_INCOMPLETE",
    );
  }

  const resultLines: CountResultLine[] = invoice.items.map((item) => {
    const pcsPerCarton = Math.max(1, item.product?.pcsPerCarton ?? 1);
    const expectedPieces = amountInPieces(
      item.unit, Number(item.quantity), pcsPerCarton, item.product?.boxPieces ?? null,
    );
    const receivedPieces = submitted.get(item.id) ?? expectedPieces;
    return {
      itemId: item.id,
      productId: item.productId,
      productName: item.productName ?? "",
      itemNumber: item.itemNumber ?? item.product?.itemNumber ?? null,
      unit: item.unit,
      quantity: Number(item.quantity),
      expectedPieces,
      receivedPieces,
      differencePieces: receivedPieces - expectedPieces,
    };
  });

  const differenceCount = resultLines.filter((l) => l.differencePieces !== 0).length;
  const result: CountResult = {
    countedAt: new Date().toISOString(),
    lines: resultLines,
    differenceCount,
    totalBefore: Number(invoice.totalAmount),
  };

  const invoiceNumber = invoice.invoiceNumber;
  const isWorker = link.audience === InvoiceCountAudience.WORKER;
  let outcome: ApplyCountOutcome | null = null;

  // The worker's count is the shop's own correction — it lands immediately.
  if (isWorker && differenceCount > 0) {
    outcome = await applyCountToInvoice(link.invoiceId, submitted, invoice.createdBy);
  }

  const now = new Date();
  await prisma.invoiceCountLink.update({
    where: { id: link.id },
    data: {
      status: InvoiceCountLinkStatus.SUBMITTED,
      submittedAt: now,
      lastViewedAt: now,
      result: result as unknown as object,
      hasDifference: differenceCount > 0,
      appliedAt: isWorker ? now : null,
      refundDue: outcome && outcome.refundDue > 0 ? outcome.refundDue : null,
    },
  });

  // A customer's count only becomes an approval when something actually differs.
  // A matching count has nothing for the owner to decide, so it is reported and
  // left alone rather than added to a queue he has to clear.
  let approvalId: string | null = null;
  if (!isWorker && differenceCount > 0) {
    approvalId = await raiseCountApproval(
      link.id, invoice.createdBy, link.recipientName, invoiceNumber, differenceCount,
    );
  }

  await announceCount({
    linkId: link.id,
    invoiceId: link.invoiceId,
    invoiceNumber,
    audience: link.audience,
    recipientName: link.recipientName,
    differenceCount,
    outcome,
    approvalId,
  });

  return {
    applied: isWorker,
    hasDifference: differenceCount > 0,
    outcome,
    result,
    linkId: link.id,
    audience: link.audience,
  };
}

/**
 * Raise the owner's decision on a customer's count. Attributed to whoever wrote
 * the invoice: the approvals table requires a staff member and a customer is not
 * one — the wording makes plain who actually counted.
 */
async function raiseCountApproval(
  linkId: string,
  invoiceCreatedBy: string,
  recipientName: string,
  invoiceNumber: string,
  differenceCount: number,
): Promise<string | null> {
  try {
    const { approvalRequestTypes, createPendingApproval } = await import("./approval.service");
    const approval = await createPendingApproval(
      approvalRequestTypes.INVOICE_COUNT_ADJUSTMENT,
      {
        linkId,
        invoiceNumber,
        countedBy: recipientName,
        differenceCount,
        reason: `جرد الزبون «${recipientName}» لفاتورة ${invoiceNumber}`,
      },
      invoiceCreatedBy,
      recipientName,
    );
    await prisma.invoiceCountLink.update({ where: { id: linkId }, data: { approvalId: approval.id } });
    return approval.id;
  } catch {
    // The count is already stored; failing to queue it must not lose it.
    return null;
  }
}

/**
 * Tell the shop what happened. The owner asked for exactly this split: a
 * worker's count is a log entry he reads when he opens the invoice, while
 * anything a customer writes reaches his phone.
 */
async function announceCount(input: {
  linkId: string;
  invoiceId: string;
  invoiceNumber: string;
  audience: InvoiceCountAudience;
  recipientName: string;
  differenceCount: number;
  outcome: ApplyCountOutcome | null;
  approvalId: string | null;
}) {
  const isWorker = input.audience === InvoiceCountAudience.WORKER;
  const who = isWorker ? `العامل ${input.recipientName}` : `الزبون ${input.recipientName}`;
  const body = input.differenceCount > 0
    ? `${who} جرد فاتورة ${input.invoiceNumber} — فرق في ${input.differenceCount} مادة`
    : `${who} جرد فاتورة ${input.invoiceNumber} — كل شيء مطابق`;
  const tail = isWorker
    ? input.differenceCount > 0 ? " وتعدّلت الفاتورة." : ""
    : input.differenceCount > 0 ? " بانتظار موافقتك." : "";
  const money = (n: unknown) => Math.round(Number(n ?? 0)).toLocaleString("en-US");

  try {
    const { notifyAdmin, buildDedupeKey } = await import("./app-notification.service");
    const { NotificationCategory, NotificationSeverity, NotificationType } = await import("../constants/notifications");
    await notifyAdmin({
      type: NotificationType.INVOICE_COUNT_SUBMITTED,
      category: NotificationCategory.INVOICE_COUNT,
      severity: NotificationSeverity.COUNT,
      title: input.differenceCount > 0 ? "جرد فيه فرق" : "جرد مطابق",
      message: `${body}${tail}`,
      entityType: "INVOICE",
      entityId: input.invoiceId,
      actionUrl: `/invoices/${input.invoiceId}`,
      metadata: { linkId: input.linkId, audience: input.audience, approvalId: input.approvalId },
      dedupeKey: buildDedupeKey(NotificationType.INVOICE_COUNT_SUBMITTED, input.linkId),
    });

  } catch { /* a notification failure must never lose a count */ }

  if (input.outcome && input.outcome.refundDue > 0) {
    await notifyRefundDue(input.linkId, input.invoiceId, input.invoiceNumber, input.outcome.refundDue);
  }

  // Only the customer's word travels to the owner's phone — a worker's count is
  // in-house and would only add noise.
  if (isWorker) return;
  try {
    const { sendWhatsAppText } = await import("./whatsapp.service");
    const settings = await getSettings().catch(() => null);
    const target = settings?.adminApprovalWhatsappNumber?.trim() || settings?.storePhone?.trim();
    if (!target) return;
    const refundNote = input.outcome && input.outcome.refundDue > 0
      ? `\n⚠️ لازم ترجع ${money(input.outcome.refundDue)} للزبون نقداً.`
      : "";
    const action = input.differenceCount > 0
      ? "\nراجعه وأقرّه من صفحة (الطلبات المعلّقة) — الفاتورة لم تتغيّر بعد."
      : "";
    await sendWhatsAppText(target, `📋 جرد فاتورة\n${body}${action}${refundNote}`);
  } catch { /* ignore */ }
}

/**
 * "You are holding this customer's money." Raised whenever a paid invoice
 * shrinks below what was paid — by a worker's count on submit, or by a
 * customer's once it is approved. It stays until someone marks the cash
 * returned; the owner asked to be reminded, not to be given a cash book.
 */
async function notifyRefundDue(linkId: string, invoiceId: string, invoiceNumber: string, amount: number) {
  try {
    const { notifyAdmin, buildDedupeKey } = await import("./app-notification.service");
    const { NotificationCategory, NotificationSeverity, NotificationType } = await import("../constants/notifications");
    await notifyAdmin({
      type: NotificationType.INVOICE_COUNT_REFUND_DUE,
      category: NotificationCategory.INVOICE_COUNT,
      severity: NotificationSeverity.COUNT,
      title: "فلوس لازم ترجع للزبون",
      message:
        `فاتورة ${invoiceNumber} كانت مدفوعة وصار مجموعها أقل بعد الجرد — ` +
        `لازم ترجع ${Math.round(amount).toLocaleString("en-US")} للزبون نقداً.`,
      entityType: "INVOICE",
      entityId: invoiceId,
      actionUrl: `/invoices/${invoiceId}`,
      metadata: { linkId, refundDue: amount },
      dedupeKey: buildDedupeKey(NotificationType.INVOICE_COUNT_REFUND_DUE, linkId),
    });
  } catch { /* the amount is stored on the link either way */ }
}

/**
 * Apply a customer's frozen count once the owner approves it, and tell the
 * customer what their account looks like now — the balance moved because of
 * something they reported, so they are owed the answer.
 *
 * The count comes from the record stored at submit time, never from a re-read of
 * the page: approving three days later must apply exactly what the customer
 * said, not whatever the invoice has become since.
 */
export async function applyCustomerCount(linkId: string, reviewerId: string, db: Db = prisma) {
  const link = await db.invoiceCountLink.findUnique({
    where: { id: linkId },
    include: { invoice: { select: { invoiceNumber: true } } },
  });
  if (!link) throw new AppError("سجل الجرد غير موجود", 404, "COUNT_LINK_NOT_FOUND");
  if (link.appliedAt) return { alreadyApplied: true };

  const result = link.result as unknown as CountResult | null;
  if (!result?.lines?.length) throw new AppError("سجل الجرد فارغ", 400, "COUNT_RESULT_EMPTY");

  const counted = new Map<string, number>();
  for (const line of result.lines) counted.set(line.itemId, line.receivedPieces);

  const outcome = await applyCountToInvoice(link.invoiceId, counted, reviewerId, db);

  await db.invoiceCountLink.update({
    where: { id: linkId },
    data: {
      appliedAt: new Date(),
      refundDue: outcome.refundDue > 0 ? outcome.refundDue : null,
    },
  });

  // Deferred past the caller's transaction: these quote the customer's new
  // balance, which does not exist for anyone else until the commit lands.
  const invoiceNumber = link.invoice?.invoiceNumber ?? "";
  setImmediate(() => {
    void notifyCustomerOfCountResult(link.invoiceId, invoiceNumber, outcome);
    // The refund reminder is raised HERE for a customer's count, not at submit
    // time: until the owner approved it, no money had moved and there was
    // nothing to hand back.
    if (outcome.refundDue > 0) {
      void notifyRefundDue(linkId, link.invoiceId, invoiceNumber, outcome.refundDue);
    }
  });
  return outcome;
}

/** Tell the customer their invoice and balance changed after their own count. */
async function notifyCustomerOfCountResult(
  invoiceId: string,
  invoiceNumber: string,
  outcome: ApplyCountOutcome,
) {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        totalAmount: true, paidAmount: true, remainingAmount: true, finalBalance: true,
        customer: { select: { name: true, phone: true } },
      },
    });
    const phone = invoice?.customer?.phone?.trim();
    if (!phone) return;

    const settings = await getSettings().catch(() => null);
    const currency = settings?.currency ?? "د.ع";
    const money = (n: unknown) => Math.round(Number(n ?? 0)).toLocaleString("en-US");
    const refundNote = outcome.refundDue > 0
      ? `\nلك مبلغ ${money(outcome.refundDue)} ${currency} يُعاد إليك نقداً.`
      : "";

    const { sendWhatsAppText } = await import("./whatsapp.service");
    await sendWhatsAppText(
      phone,
      `مرحبا ${invoice?.customer?.name ?? ""}\n` +
        `تمت الموافقة على جردك لفاتورة ${invoiceNumber} وعُدّلت الفاتورة.\n` +
        `مجموع الفاتورة: ${money(invoice?.totalAmount)} ${currency}\n` +
        `المتبقي من الفاتورة: ${money(invoice?.remainingAmount)} ${currency}\n` +
        `رصيد حسابك: ${money(invoice?.finalBalance)} ${currency}${refundNote}\n` +
        `شكراً لك — ${settings?.storeName ?? ""}`,
    );
  } catch { /* the invoice is already corrected; a message failure is not fatal */ }
}

// ── Status for the shop ──────────────────────────────────────────────────────

/**
 * Every counting link ever minted for an invoice, newest first — this is what
 * the invoice screen turns into "the worker never opened it" / "the customer
 * counted and two lines differed".
 */
export async function listCountLinks(invoiceId: string) {
  const links = await prisma.invoiceCountLink.findMany({
    where: { invoiceId },
    orderBy: { createdAt: "desc" },
    include: {
      creator: { select: { id: true, name: true } },
      refundAcknowledger: { select: { id: true, name: true } },
    },
  });

  // The owner has to be able to tell "waiting on me" from "I already said no",
  // and the link alone cannot say which — a rejected count leaves appliedAt null
  // exactly like a pending one.
  const approvalIds = links.map((l) => l.approvalId).filter((id): id is string => !!id);
  const approvals = approvalIds.length
    ? await prisma.pendingApproval.findMany({
        where: { id: { in: approvalIds } },
        select: { id: true, status: true, reviewedAt: true, reviewNote: true },
      })
    : [];
  const approvalById = new Map(approvals.map((a) => [a.id, a]));

  const now = Date.now();
  return links.map((link) => ({
    ...link,
    approval: link.approvalId ? approvalById.get(link.approvalId) ?? null : null,
    refundDue: link.refundDue == null ? null : Number(link.refundDue),
    // Expiry is a fact about time, not a stored state — a link that ran out
    // while nobody was looking must still read as expired.
    status:
      link.status === InvoiceCountLinkStatus.OPEN || link.status === InvoiceCountLinkStatus.VIEWED
        ? link.expiresAt.getTime() <= now
          ? InvoiceCountLinkStatus.EXPIRED
          : link.status
        : link.status,
  }));
}

/** Mark the cash as physically handed back. */
export async function acknowledgeRefund(linkId: string, userId: string) {
  const link = await prisma.invoiceCountLink.findUnique({ where: { id: linkId } });
  if (!link) throw new AppError("السجل غير موجود", 404, "COUNT_LINK_NOT_FOUND");
  if (link.refundDue == null) {
    throw new AppError("لا يوجد مبلغ واجب الإرجاع على هذا الجرد", 400, "NO_REFUND_DUE");
  }
  if (link.refundAckAt) return link;
  return prisma.invoiceCountLink.update({
    where: { id: linkId },
    data: { refundAckAt: new Date(), refundAckBy: userId },
  });
}

// ── Edit lock ────────────────────────────────────────────────────────────────

/**
 * "Someone in the shop is editing this invoice right now."
 *
 * Heartbeat-based rather than a real lock: it only ever holds the PUBLIC
 * counting page back, never the shop, so a stale row can cost a counter a
 * minute of waiting but can never wedge the till.
 */
export async function touchEditLock(invoiceId: string, userId: string, userName: string) {
  const heartbeatAt = new Date();
  return prisma.invoiceEditLock.upsert({
    where: { invoiceId },
    create: { invoiceId, userId, userName, heartbeatAt },
    update: { userId, userName, heartbeatAt },
  });
}

export async function releaseEditLock(invoiceId: string, userId: string) {
  await prisma.invoiceEditLock.deleteMany({ where: { invoiceId, userId } });
}

/** The lock, but only if it is still being refreshed by a live editor. */
export async function getActiveEditLock(invoiceId: string) {
  const lock = await prisma.invoiceEditLock.findUnique({ where: { invoiceId } });
  if (!lock) return null;
  if (Date.now() - lock.heartbeatAt.getTime() > EDIT_LOCK_STALE_MS) return null;
  return lock;
}
