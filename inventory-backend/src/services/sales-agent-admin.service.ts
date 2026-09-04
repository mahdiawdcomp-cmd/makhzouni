/**
 * «المندوب» — the OWNER's side: cash handovers and the commission calculator.
 *
 * Split from `sales-agent.service.ts` deliberately. That file is reached by a
 * router guarded with `requireSalesAgent()`; this one is reached by an
 * admin-only router. Keeping them in separate files means a careless import
 * cannot accidentally expose an owner-only number — commission, total sales,
 * another rep's liability — through the rep's surface.
 */
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { logger } from "../utils/logger";
import { notifySalesAgentEvent, salesAgentPhone } from "./sales-agent-notify.service";
import { sendWhatsAppText } from "./whatsapp.service";
import { issueReasonLabel } from "./sales-agent.service";

function toNumber(value: unknown) {
  return value == null ? 0 : Number(value);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Reject a malformed id BEFORE it reaches Prisma.
 *
 * A uuid column handed a non-uuid string makes Prisma throw a validation error,
 * which surfaces as a bare 500 "Internal server error" — the shape of a broken
 * server rather than of a bad request. Every id here arrives from a query string
 * or a request body, so any of them can be anything.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string | undefined | null, message: string) {
  if (!value || !UUID_RE.test(value)) {
    throw new AppError(message, 400, "ID_INVALID");
  }
  return value;
}
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** Typo guard, used when the liability figure is too broken to be a ceiling. */
const HANDOVER_SANITY_CAP = 100_000_000;

/* ── who the reps are ────────────────────────────────────────────────── */

async function activeAgents() {
  return prisma.user.findMany({
    where: { isActive: true, permissions: { has: "SALES_AGENT" } },
    select: { id: true, name: true, username: true, phone: true, isActive: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Reps to show on the liability screen: the active ones, PLUS any deactivated
 * account that still holds shop money.
 *
 * Filtering on `isActive` alone made a rep's outstanding cash vanish from the
 * owner's screen the moment the account was switched off — which is exactly
 * when the owner most needs to see it. Money owed does not stop being owed
 * because a login was disabled.
 */
async function agentsForLiability() {
  const active = await activeAgents();
  const activeIds = new Set(active.map((a) => a.id));

  const [collectors, handers] = await Promise.all([
    prisma.paymentVoucher.findMany({
      where: { salesAgentId: { not: null }, type: "RECEIPT", cancelledAt: null, archivedAt: null },
      select: { salesAgentId: true },
      distinct: ["salesAgentId"],
    }),
    prisma.salesAgentHandover.findMany({
      select: { salesAgentId: true },
      distinct: ["salesAgentId"],
    }),
  ]);

  const seen = new Set<string>([
    ...collectors.map((c) => c.salesAgentId as string),
    ...handers.map((h) => h.salesAgentId),
  ]);
  const missing = [...seen].filter((id) => !activeIds.has(id));
  if (missing.length === 0) return active;

  const inactive = await prisma.user.findMany({
    where: { id: { in: missing } },
    select: { id: true, name: true, username: true, phone: true, isActive: true },
  });
  return [...active, ...inactive];
}

/**
 * Every rep with what they have collected, handed over, and still hold.
 *
 * Two grouped queries rather than a query per rep: with one rep today that is
 * the same thing, but it is the shape that survives the fifth rep without
 * anyone having to come back and fix an N+1.
 */
export async function listAgentLiability() {
  const agents = await agentsForLiability();
  if (agents.length === 0) return [];

  const ids = agents.map((a) => a.id);

  const [collected, handed] = await Promise.all([
    prisma.paymentVoucher.groupBy({
      by: ["salesAgentId"],
      where: {
        salesAgentId: { in: ids },
        type: "RECEIPT",
        cancelledAt: null,
        archivedAt: null,
      },
      _sum: { amount: true },
    }),
    prisma.salesAgentHandover.groupBy({
      by: ["salesAgentId"],
      where: { salesAgentId: { in: ids } },
      _sum: { amount: true },
    }),
  ]);

  const collectedBy = new Map(collected.map((c) => [c.salesAgentId, toNumber(c._sum.amount)]));
  const handedBy = new Map(handed.map((h) => [h.salesAgentId, toNumber(h._sum.amount)]));

  return agents.map((a) => {
    const c = collectedBy.get(a.id) ?? 0;
    const h = handedBy.get(a.id) ?? 0;
    const onHand = round2(c - h);
    return {
      agentId: a.id,
      name: a.name,
      username: a.username,
      phone: a.phone,
      isActive: a.isActive,
      collected: c,
      handedOver: h,
      onHand,
      // A rep cannot hand over more than they hold, so the only way this goes
      // negative is a receipt CANCELLED after its cash was already handed over.
      // That is a real bookkeeping problem, not a display quirk, so it is
      // flagged rather than clamped to zero and hidden.
      overHanded: onHand < 0,
    };
  });
}

/**
 * Record cash taken off a rep.
 *
 * The owner alone writes this. A rep marking their own handover would need the
 * owner to confirm it back — a two-party protocol for a problem that has none,
 * since the owner knows when the money is in their hand.
 *
 * Over-handing is refused rather than silently allowed: an amount larger than
 * what the rep is holding means somebody mistyped, and a negative "on hand"
 * would quietly corrupt every later reading of that number.
 */
export async function recordHandover(
  input: { agentId: string; amount: number; notes?: string; date?: string; clientRequestId?: string },
  receivedBy: string,
) {
  assertUuid(input.agentId, "المندوب غير صحيح");

  // A double tap used to book the cash twice. The retry returns the handover the
  // first press created rather than taking the money off the rep again.
  const key = input.clientRequestId?.trim();
  if (key) {
    const prior = await prisma.salesAgentHandover.findFirst({
      where: { clientRequestId: key },
      include: { receiver: { select: { name: true } } },
    });
    if (prior) {
      return {
        id: prior.id,
        amount: toNumber(prior.amount),
        date: prior.date,
        notes: prior.notes,
        receivedBy: prior.receiver.name,
        remaining: (await listAgentLiability()).find((l) => l.agentId === prior.salesAgentId)?.onHand ?? 0,
        duplicate: true,
      };
    }
  }

  const agent = await prisma.user.findFirst({
    where: { id: input.agentId, permissions: { has: "SALES_AGENT" } },
    select: { id: true, name: true },
  });
  if (!agent) throw new AppError("المندوب غير موجود", 404, "AGENT_NOT_FOUND");

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError("المبلغ لازم يكون أكبر من صفر", 400, "AMOUNT_INVALID");
  }

  const liability = (await listAgentLiability()).find((l) => l.agentId === agent.id);
  const onHand = liability?.onHand ?? 0;

  // The ceiling only applies while the liability is sane.
  //
  // A receipt cancelled after its cash was already handed over drives the
  // derived figure below zero. Comparing against a negative ceiling then refused
  // EVERY later handover — the rep kept collecting real cash and the owner was
  // locked out of recording money they were physically holding. A bookkeeping
  // anomaly must not become a deadlock: when the figure is already negative the
  // amount is accepted (the screen flags the anomaly in red), and the typo guard
  // is the sanity cap below instead.
  if (onHand > 0 && amount > onHand + 0.001) {
    throw new AppError(
      `المبلغ أكبر من الي بذمة المندوب. الي معاه هسه: ${fmt(onHand)}`,
      400,
      "HANDOVER_EXCEEDS_LIABILITY",
    );
  }
  if (amount > HANDOVER_SANITY_CAP) {
    throw new AppError(
      `المبلغ كبير جداً — تأكد منه. الحد ${fmt(HANDOVER_SANITY_CAP)}`,
      400,
      "AMOUNT_TOO_LARGE",
    );
  }

  const handover = await prisma.salesAgentHandover.create({
    data: {
      salesAgentId: agent.id,
      amount,
      notes: input.notes?.trim() || null,
      date: input.date ? new Date(input.date) : new Date(),
      receivedBy,
      clientRequestId: key ?? null,
    },
    include: { receiver: { select: { name: true } } },
  });

  await prisma.auditLog.create({
    data: {
      userId: receivedBy,
      action: "SALES_AGENT_HANDOVER_RECEIVED",
      entity: "SalesAgentHandover",
      recordId: handover.id,
      metadata: { agentId: agent.id, agentName: agent.name, amount, remaining: round2(onHand - amount) },
    },
  });

  // The rep is told their liability dropped. This is the one rep-facing message
  // the owner's own action produces, and it closes the loop on money the rep is
  // personally answerable for.
  void (async () => {
    try {
      const phone = await salesAgentPhone(agent.id);
      if (!phone) return;
      await sendWhatsAppText(
        phone,
        [
          "تم استلام المبلغ منك",
          "",
          `المبلغ: ${fmt(amount)}`,
          `الباقي بذمتك: ${fmt(onHand - amount)}`,
        ].join("\n"),
      );
    } catch (err) {
      logger.warn(`[SalesAgent] handover notify failed: ${String(err)}`);
    }
  })();

  return {
    id: handover.id,
    amount: toNumber(handover.amount),
    date: handover.date,
    notes: handover.notes,
    receivedBy: handover.receiver.name,
    remaining: round2(onHand - amount),
    duplicate: false,
  };
}

export async function listHandovers(agentId?: string, limit = 60) {
  if (agentId) assertUuid(agentId, "المندوب غير صحيح");
  const rows = await prisma.salesAgentHandover.findMany({
    where: agentId ? { salesAgentId: agentId } : {},
    orderBy: { date: "desc" },
    take: Math.min(limit, 200),
    include: {
      salesAgent: { select: { id: true, name: true } },
      receiver: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    agentId: r.salesAgent.id,
    agentName: r.salesAgent.name,
    amount: toNumber(r.amount),
    date: r.date,
    notes: r.notes,
    receivedBy: r.receiver.name,
  }));
}

/* ── commission ──────────────────────────────────────────────────────── */

/**
 * Month bounds in LOCAL time, from a "YYYY-MM" string.
 *
 * `new Date("2026-09")` parses as midnight UTC, which in Baghdad is 03:00 on
 * the 1st — so a sale made at 01:00 local on the 1st would fall outside its own
 * month. Building the dates component-wise keeps the boundary where the shop
 * thinks it is.
 */
function monthRange(month: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month ?? "").trim());
  if (!m) throw new AppError("الشهر لازم يكون بصيغة YYYY-MM", 400, "MONTH_INVALID");
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) {
    throw new AppError("الشهر غير صحيح", 400, "MONTH_INVALID");
  }
  return {
    from: new Date(year, monthIndex, 1, 0, 0, 0, 0),
    to: new Date(year, monthIndex + 1, 1, 0, 0, 0, 0),
  };
}

/**
 * The commission calculator: a READER, not a ledger.
 *
 * It stores nothing — no accrual, no pending balance, no automatic deduction.
 * The owner types the rate each time, because the rate is whatever they agreed
 * that month.
 *
 * THREE figures, deliberately, because "how much did he collect" has three
 * different honest answers and paying a person on the wrong one is a dispute:
 *
 *   sold                — ACTIVE sale invoices credited to this rep, by INVOICE
 *                         DATE (the day it was billed, i.e. the day you approved
 *                         it — not the day the rep sent the order). Same basis
 *                         every other report in this system uses.
 *   collectedInHand     — receipts this rep physically took. Includes money paid
 *                         against OLD debt that predates the rep, and against
 *                         invoices the shop sold directly. This is the number
 *                         that drives his cash liability, NOT a measure of his
 *                         selling.
 *   collectedFromOwn    — receipts from customers assigned to this rep, whoever
 *                         collected them. The closest honest answer to "collected
 *                         against what he sold" that exists without inventing a
 *                         payment-allocation engine.
 *
 * There is deliberately no fourth figure "payments matched to his invoices":
 * this system does not allocate vouchers onto invoices at all — a receipt moves
 * the customer's balance and nothing else — so any such number would be invented
 * here rather than read, and inventing it was explicitly ruled out.
 *
 * Commission is computed on SALE VALUE, never on profit. The usual objection to
 * paying on sales — that a rep discounts to sell more — cannot happen here: the
 * price is fixed and the rep has no discount at all. And it means no cost or
 * margin figure has to exist anywhere near this screen.
 */
export async function getCommission(agentId: string, month: string, ratePercent?: number) {
  assertUuid(agentId, "المندوب غير صحيح");

  const agent = await prisma.user.findFirst({
    where: { id: agentId, permissions: { has: "SALES_AGENT" } },
    select: { id: true, name: true },
  });
  if (!agent) throw new AppError("المندوب غير موجود", 404, "AGENT_NOT_FOUND");

  const { from, to } = monthRange(month);

  const soldWhere = {
    salesAgentId: agentId,
    type: "SALE" as const,
    status: "ACTIVE" as const,
    archivedAt: null,
    date: { gte: from, lt: to },
  };

  const receiptWindow = {
    type: "RECEIPT" as const,
    cancelledAt: null,
    archivedAt: null,
    date: { gte: from, lt: to },
  };

  const [sold, inHand, fromOwn, invoiceCount, oldDebtShare] = await Promise.all([
    prisma.invoice.aggregate({ where: soldWhere, _sum: { totalAmount: true } }),
    prisma.paymentVoucher.aggregate({
      where: { ...receiptWindow, salesAgentId: agentId },
      _sum: { amount: true },
    }),
    prisma.paymentVoucher.aggregate({
      where: { ...receiptWindow, customer: { salesAgentId: agentId } },
      _sum: { amount: true },
    }),
    prisma.invoice.count({ where: soldWhere }),
    // How much of what he collected came from customers who are NOT his — money
    // that has nothing to do with his selling. Shown so the owner can see the
    // gap rather than having to trust that there isn't one.
    prisma.paymentVoucher.aggregate({
      where: {
        ...receiptWindow,
        salesAgentId: agentId,
        // Spelled as an explicit OR, not `NOT { salesAgentId: agentId }`.
        // In SQL, `sales_agent_id <> '<id>'` is NULL — not true — for a customer
        // with no rep, so a negated filter drops those rows from BOTH buckets
        // and this warning read zero in exactly the case it exists to catch:
        // money collected from a customer who belongs to nobody.
        OR: [
          { customer: { salesAgentId: null } },
          { customer: { salesAgentId: { not: agentId } } },
        ],
      },
      _sum: { amount: true },
    }),
  ]);

  const soldTotal = toNumber(sold._sum.totalAmount);
  const inHandTotal = toNumber(inHand._sum.amount);
  const fromOwnTotal = toNumber(fromOwn._sum.amount);
  const rate = Number.isFinite(Number(ratePercent)) ? Number(ratePercent) : null;
  const pct = (base: number) => (rate == null ? null : round2((base * rate) / 100));

  // A settled month keeps what was agreed. The live figures are still returned
  // beside it so the owner can SEE that the books have moved since — which is
  // the whole reason freezing exists — without the agreed payout changing.
  const settlement = await prisma.salesAgentSettlement.findUnique({
    where: { salesAgentId_month: { salesAgentId: agentId, month } },
    include: { settler: { select: { name: true } } },
  });

  return {
    agentId: agent.id,
    agentName: agent.name,
    month,
    settled: settlement
      ? {
          sold: toNumber(settlement.sold),
          collectedInHand: toNumber(settlement.collectedInHand),
          collectedFromOwnCustomers: toNumber(settlement.collectedFromOwnCustomers),
          basis: settlement.basis,
          basisLabel: settlementBasisLabel(settlement.basis),
          ratePercent: toNumber(settlement.ratePercent),
          amount: toNumber(settlement.amount),
          notes: settlement.notes,
          settledAt: settlement.createdAt,
          settledBy: settlement.settler.name,
        }
      : null,
    // Names the basis on the screen, so nobody has to guess which date a month
    // boundary follows when an order is sent on the 30th and approved on the 1st.
    dateBasis: "INVOICE_DATE" as const,
    invoiceCount,
    sold: soldTotal,
    collectedInHand: inHandTotal,
    collectedFromOwnCustomers: fromOwnTotal,
    collectedFromOtherCustomers: toNumber(oldDebtShare._sum.amount),
    ratePercent: rate,
    onSold: pct(soldTotal),
    onCollectedInHand: pct(inHandTotal),
    onCollectedFromOwn: pct(fromOwnTotal),
  };
}

/**
 * Tell the owner (and the rep) that an invoice belonging to a rep changed.
 *
 * Exported for the invoice edit/cancel/delete paths to call. Kept here rather
 * than inline in those paths so the rule "the rep hears about it immediately,
 * because their commission moved" lives in one place.
 */
export async function notifyInvoiceChangedForAgent(invoiceId: string, changeKind: string) {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        invoiceNumber: true,
        totalAmount: true,
        salesAgentId: true,
        salesAgent: { select: { name: true } },
        customer: { select: { name: true } },
      },
    });
    if (!invoice?.salesAgentId) return; // not a rep's invoice — nothing to say

    await notifySalesAgentEvent("invoiceChanged", {
      agentName: invoice.salesAgent?.name ?? "المندوب",
      customerName: invoice.customer.name,
      invoiceNumber: invoice.invoiceNumber,
      total: toNumber(invoice.totalAmount),
      changeKind,
      agentPhone: await salesAgentPhone(invoice.salesAgentId),
    });
  } catch (err) {
    logger.warn(`[SalesAgent] invoice-change notify failed: ${String(err)}`);
  }
}

/* ── «المشاكل المسجّلة» — the owner's reports ────────────────────────── */

function issueWindow(from?: string, to?: string) {
  const where: { gte?: Date; lt?: Date } = {};
  if (from) where.gte = new Date(from);
  if (to) {
    // `to` is an inclusive day from a date picker, so push to the start of the
    // next day — otherwise everything logged after midnight on the last day is
    // silently dropped from the report.
    const end = new Date(to);
    end.setDate(end.getDate() + 1);
    where.lt = end;
  }
  return Object.keys(where).length > 0 ? where : undefined;
}

/**
 * The four reports the owner asked for, from one pass over the issues.
 *
 * Built as four groupBy queries rather than four screens' worth of round trips:
 * they share a date window and are always read together, and the whole point of
 * the screen is comparing them.
 *
 *   byReason      — أكثر أسباب الرفض تكراراً
 *   priceRefusals — المنتجات المرفوضة بسبب السعر
 *   byCustomer    — الزبائن الرافضون لكل شيء
 *   competitors   — أسعار المنافسين المجمّعة
 */
export async function getIssueReports(opts: { from?: string; to?: string; agentId?: string } = {}) {
  if (opts.agentId) assertUuid(opts.agentId, "المندوب غير صحيح");
  const createdAt = issueWindow(opts.from, opts.to);
  const base = {
    ...(createdAt ? { createdAt } : {}),
    ...(opts.agentId ? { salesAgentId: opts.agentId } : {}),
  };

  const [byReasonRaw, priceRaw, byCustomerRaw, competitorRows, total] = await Promise.all([
    prisma.salesAgentIssue.groupBy({
      by: ["reason"],
      where: base,
      _count: { reason: true },
    }),
    // "Refused on price" is both the plain price complaint and the sharper
    // version of it — the shopkeeper already buys it cheaper elsewhere. Counting
    // only the first would understate the problem the report exists to find.
    prisma.salesAgentIssue.groupBy({
      by: ["productId"],
      where: { ...base, reason: { in: ["PRICE", "CHEAPER_ELSEWHERE"] }, productId: { not: null } },
      _count: { productId: true },
    }),
    prisma.salesAgentIssue.groupBy({
      by: ["customerId"],
      where: base,
      _count: { customerId: true },
    }),
    prisma.salesAgentIssue.findMany({
      where: { ...base, competitorInfo: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        competitorInfo: true,
        createdAt: true,
        reason: true,
        product: { select: { name: true, salePrice: true } },
        customer: { select: { name: true, area: true } },
      },
    }),
    prisma.salesAgentIssue.count({ where: base }),
  ]);

  // Resolve names in two batched lookups rather than per row.
  const productIds = priceRaw.map((r) => r.productId).filter(Boolean) as string[];
  const customerIds = byCustomerRaw.map((r) => r.customerId);

  const [products, customers] = await Promise.all([
    productIds.length
      ? prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true, salePrice: true },
        })
      : [],
    customerIds.length
      ? prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, name: true, area: true },
        })
      : [],
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const customerById = new Map(customers.map((c) => [c.id, c]));

  return {
    total,
    byReason: byReasonRaw
      .map((r) => ({ reason: r.reason, label: issueReasonLabel(r.reason), count: r._count.reason }))
      .sort((a, b) => b.count - a.count),
    priceRefusals: priceRaw
      .map((r) => {
        const p = productById.get(r.productId as string);
        return {
          productId: r.productId as string,
          productName: p?.name ?? "—",
          salePrice: p ? Number(p.salePrice) : null,
          count: r._count.productId,
        };
      })
      .sort((a, b) => b.count - a.count),
    byCustomer: byCustomerRaw
      .map((r) => {
        const c = customerById.get(r.customerId);
        return {
          customerId: r.customerId,
          customerName: c?.name ?? "—",
          area: c?.area ?? null,
          count: r._count.customerId,
        };
      })
      .sort((a, b) => b.count - a.count),
    competitors: competitorRows.map((r) => ({
      id: r.id,
      info: r.competitorInfo as string,
      reason: r.reason,
      reasonLabel: issueReasonLabel(r.reason),
      productName: r.product?.name ?? null,
      ourPrice: r.product ? Number(r.product.salePrice) : null,
      customerName: r.customer.name,
      area: r.customer.area,
      createdAt: r.createdAt,
    })),
  };
}

/**
 * The raw refusal log behind the aggregated reports.
 *
 * The four reports answer "what is going wrong overall"; this answers "what
 * exactly did he hear in that shop". Both are needed — a single competitor quote
 * is often worth more than the count it disappears into.
 */
export async function listIssues(
  opts: { from?: string; to?: string; agentId?: string; reason?: string } = {},
) {
  if (opts.agentId) assertUuid(opts.agentId, "المندوب غير صحيح");
  const createdAt = issueWindow(opts.from, opts.to);
  const rows = await prisma.salesAgentIssue.findMany({
    where: {
      ...(createdAt ? { createdAt } : {}),
      ...(opts.agentId ? { salesAgentId: opts.agentId } : {}),
      ...(opts.reason ? { reason: opts.reason } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: {
      id: true,
      reason: true,
      note: true,
      competitorInfo: true,
      createdAt: true,
      salesAgent: { select: { name: true } },
      customer: { select: { name: true, area: true } },
      product: { select: { name: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    reason: r.reason,
    reasonLabel: issueReasonLabel(r.reason),
    note: r.note,
    competitorInfo: r.competitorInfo,
    createdAt: r.createdAt,
    agentName: r.salesAgent.name,
    customerName: r.customer.name,
    area: r.customer.area,
    productName: r.product?.name ?? null,
  }));
}

/* ── «تثبيت الشهر» — freezing a month's settlement ───────────────────── */

/** Which of the three figures the owner chose to pay on. */
export const SETTLEMENT_BASES = ["SOLD", "COLLECTED_IN_HAND", "COLLECTED_FROM_OWN"] as const;
export type SettlementBasis = (typeof SETTLEMENT_BASES)[number];

const BASIS_LABEL: Record<SettlementBasis, string> = {
  SOLD: "قيمة مبيعاته",
  COLLECTED_IN_HAND: "الي قبضه بيده",
  COLLECTED_FROM_OWN: "تحصيل من زبائنه",
};

export function settlementBasisLabel(basis: string) {
  return BASIS_LABEL[basis as SettlementBasis] ?? basis;
}

/**
 * Freeze what was agreed with a rep for one month.
 *
 * The calculator reads live rows, which is correct right up to the moment a
 * number is agreed with a person. After that, anything touching the past — a
 * cancelled invoice, a customer moved to another rep — silently rewrites the
 * basis of a payment already made. This row is the agreement itself.
 *
 * The payout is STORED, not recomputed from the rate: the rate and the basis
 * could both be edited later, and the number actually agreed has to survive
 * that. Settling twice is impossible — reopening is a separate, deliberate act.
 */
export async function settleMonth(
  input: { agentId: string; month: string; basis: string; ratePercent: number; notes?: string },
  settledBy: string,
) {
  assertUuid(input.agentId, "المندوب غير صحيح");

  if (!SETTLEMENT_BASES.includes(input.basis as SettlementBasis)) {
    throw new AppError("أساس المحاسبة غير معروف", 400, "BASIS_INVALID");
  }
  const rate = Number(input.ratePercent);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw new AppError("النسبة لازم تكون بين صفر ومئة", 400, "RATE_INVALID");
  }

  const existing = await prisma.salesAgentSettlement.findUnique({
    where: { salesAgentId_month: { salesAgentId: input.agentId, month: input.month } },
    select: { id: true },
  });
  if (existing) {
    throw new AppError("هذا الشهر مثبّت أصلاً. افتحه أولاً إذا تريد تعيد الحساب.", 409, "ALREADY_SETTLED");
  }

  // Read the figures fresh at the moment of settling, rather than trusting
  // numbers the client posts back: what gets frozen must be what the books say
  // now, not what a stale screen was showing.
  const live = await getCommission(input.agentId, input.month, rate);

  const base =
    input.basis === "SOLD"
      ? live.sold
      : input.basis === "COLLECTED_IN_HAND"
        ? live.collectedInHand
        : live.collectedFromOwnCustomers;

  const amount = round2((base * rate) / 100);

  const row = await prisma.salesAgentSettlement.create({
    data: {
      salesAgentId: input.agentId,
      month: input.month,
      sold: live.sold,
      collectedInHand: live.collectedInHand,
      collectedFromOwnCustomers: live.collectedFromOwnCustomers,
      basis: input.basis,
      ratePercent: rate,
      amount,
      notes: input.notes?.trim() || null,
      settledBy,
    },
    include: { settler: { select: { name: true } } },
  });

  await prisma.auditLog.create({
    data: {
      userId: settledBy,
      action: "SALES_AGENT_MONTH_SETTLED",
      entity: "SalesAgentSettlement",
      recordId: row.id,
      metadata: {
        agentId: input.agentId,
        month: input.month,
        basis: input.basis,
        ratePercent: rate,
        amount,
      },
    },
  });

  return serializeSettlement(row);
}

/**
 * Reopen a settled month.
 *
 * Deleting the row rather than flagging it: a reopened month means "we are
 * negotiating again", and a half-settled state that still looks agreed is worse
 * than none. The audit log keeps what the agreement was.
 */
export async function reopenMonth(agentId: string, month: string, userId: string) {
  assertUuid(agentId, "المندوب غير صحيح");

  const row = await prisma.salesAgentSettlement.findUnique({
    where: { salesAgentId_month: { salesAgentId: agentId, month } },
  });
  if (!row) throw new AppError("هذا الشهر مو مثبّت", 404, "NOT_SETTLED");

  await prisma.auditLog.create({
    data: {
      userId,
      action: "SALES_AGENT_MONTH_REOPENED",
      entity: "SalesAgentSettlement",
      recordId: row.id,
      metadata: {
        agentId,
        month,
        basis: row.basis,
        ratePercent: toNumber(row.ratePercent),
        amount: toNumber(row.amount),
      },
    },
  });

  await prisma.salesAgentSettlement.delete({ where: { id: row.id } });
  return { reopened: true, month };
}

export async function listSettlements(agentId?: string, limit = 36) {
  if (agentId) assertUuid(agentId, "المندوب غير صحيح");
  const rows = await prisma.salesAgentSettlement.findMany({
    where: agentId ? { salesAgentId: agentId } : {},
    orderBy: [{ month: "desc" }],
    take: Math.min(limit, 120),
    include: {
      settler: { select: { name: true } },
      salesAgent: { select: { name: true } },
    },
  });
  return rows.map(serializeSettlement);
}

function serializeSettlement(row: {
  id: string;
  month: string;
  sold: unknown;
  collectedInHand: unknown;
  collectedFromOwnCustomers: unknown;
  basis: string;
  ratePercent: unknown;
  amount: unknown;
  notes: string | null;
  createdAt: Date;
  settler: { name: string };
  salesAgent?: { name: string };
}) {
  return {
    id: row.id,
    month: row.month,
    sold: toNumber(row.sold),
    collectedInHand: toNumber(row.collectedInHand),
    collectedFromOwnCustomers: toNumber(row.collectedFromOwnCustomers),
    basis: row.basis,
    basisLabel: settlementBasisLabel(row.basis),
    ratePercent: toNumber(row.ratePercent),
    amount: toNumber(row.amount),
    notes: row.notes,
    settledAt: row.createdAt,
    settledBy: row.settler.name,
    agentName: row.salesAgent?.name,
  };
}

/* ── «صحة الذمة» — the anomaly screen ────────────────────────────────── */

/**
 * Everything wrong with the rep money picture, in one list.
 *
 * These states are all individually recoverable and all individually invisible:
 * nothing surfaces them unless someone happens to look at the right screen on
 * the right day. Collected here so a weekly glance is enough.
 */
export async function getLiabilityHealth() {
  const liability = await listAgentLiability();
  const agentIds = liability.map((a) => a.agentId);

  const [cancelledAfterHandover, staleRequests, unlinkedCollections] = await Promise.all([
    // A receipt cancelled while its cash had already been handed over — the one
    // way the derived liability goes negative.
    prisma.paymentVoucher.findMany({
      where: { salesAgentId: { in: agentIds }, type: "RECEIPT", cancelledAt: { not: null } },
      select: {
        id: true,
        voucherNumber: true,
        amount: true,
        cancelledAt: true,
        salesAgent: { select: { id: true, name: true } },
        customer: { select: { name: true } },
      },
      orderBy: { cancelledAt: "desc" },
      take: 50,
    }),
    // Price requests approved long ago and never used: either the rep forgot, or
    // the customer walked. Either way the owner agreed a price that is still
    // live and nobody is watching it.
    prisma.salesAgentPriceRequest.findMany({
      where: {
        status: "APPROVED",
        consumedAt: null,
        createdAt: { lt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
      },
      select: {
        id: true,
        requestedPrice: true,
        currentPrice: true,
        createdAt: true,
        product: { select: { name: true } },
        customer: { select: { name: true } },
        salesAgent: { select: { name: true } },
      },
      take: 50,
    }),
    // Money a rep collected from a customer who is not theirs — usually the sign
    // that a customer was reassigned after the fact. Filtered in memory below
    // rather than in SQL: comparing two columns of the same row across a
    // relation is exactly where the NULL-semantics trap lives, and the row count
    // here is small enough that reading and filtering is the safer shape.
    prisma.paymentVoucher.findMany({
      where: {
        salesAgentId: { in: agentIds },
        type: "RECEIPT",
        cancelledAt: null,
        archivedAt: null,
      },
      select: {
        id: true,
        voucherNumber: true,
        amount: true,
        date: true,
        salesAgentId: true,
        salesAgent: { select: { name: true } },
        customer: { select: { name: true, salesAgentId: true } },
      },
      orderBy: { date: "desc" },
      take: 200,
    }),
  ]);

  const mismatched = unlinkedCollections.filter(
    (v) => v.customer?.salesAgentId !== v.salesAgentId,
  );

  return {
    negativeLiability: liability
      .filter((a) => a.overHanded)
      .map((a) => ({ agentId: a.agentId, name: a.name, onHand: a.onHand })),
    inactiveWithMoney: liability
      .filter((a) => !a.isActive && a.onHand !== 0)
      .map((a) => ({ agentId: a.agentId, name: a.name, onHand: a.onHand })),
    cancelledReceipts: cancelledAfterHandover.map((v) => ({
      id: v.id,
      voucherNumber: v.voucherNumber,
      amount: toNumber(v.amount),
      cancelledAt: v.cancelledAt,
      agentName: v.salesAgent?.name ?? "—",
      customerName: v.customer?.name ?? "—",
    })),
    staleApprovedPrices: staleRequests.map((r) => ({
      id: r.id,
      productName: r.product.name,
      customerName: r.customer.name,
      agentName: r.salesAgent.name,
      currentPrice: toNumber(r.currentPrice),
      requestedPrice: toNumber(r.requestedPrice),
      approvedAt: r.createdAt,
    })),
    collectionsFromOthersCustomers: mismatched.map((v) => ({
      id: v.id,
      voucherNumber: v.voucherNumber,
      amount: toNumber(v.amount),
      date: v.date,
      agentName: v.salesAgent?.name ?? "—",
      customerName: v.customer?.name ?? "—",
    })),
  };
}
