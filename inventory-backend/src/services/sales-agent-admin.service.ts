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

  return {
    agentId: agent.id,
    agentName: agent.name,
    month,
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
