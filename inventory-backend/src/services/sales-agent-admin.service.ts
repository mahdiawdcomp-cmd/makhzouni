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
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/* ── who the reps are ────────────────────────────────────────────────── */

async function activeAgents() {
  return prisma.user.findMany({
    where: { isActive: true, permissions: { has: "SALES_AGENT" } },
    select: { id: true, name: true, username: true, phone: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Every rep with what they have collected, handed over, and still hold.
 *
 * Two grouped queries rather than a query per rep: with one rep today that is
 * the same thing, but it is the shape that survives the fifth rep without
 * anyone having to come back and fix an N+1.
 */
export async function listAgentLiability() {
  const agents = await activeAgents();
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
    return {
      agentId: a.id,
      name: a.name,
      username: a.username,
      phone: a.phone,
      collected: c,
      handedOver: h,
      onHand: round2(c - h),
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
  input: { agentId: string; amount: number; notes?: string; date?: string },
  receivedBy: string,
) {
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
  if (amount > onHand + 0.001) {
    throw new AppError(
      `المبلغ أكبر من الي بذمة المندوب. الي معاه هسه: ${fmt(onHand)}`,
      400,
      "HANDOVER_EXCEEDS_LIABILITY",
    );
  }

  const handover = await prisma.salesAgentHandover.create({
    data: {
      salesAgentId: agent.id,
      amount,
      notes: input.notes?.trim() || null,
      date: input.date ? new Date(input.date) : new Date(),
      receivedBy,
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
  };
}

export async function listHandovers(agentId?: string, limit = 60) {
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
 * It answers two questions from rows that already exist, and the owner types the
 * rate each time because the rate is whatever they agreed that month.
 *
 *   sold      — ACTIVE sale invoices credited to this rep in the month
 *   collected — receipts this rep collected in the month
 *
 * Commission is computed on SALE VALUE, never on profit. The usual objection to
 * paying on sales — that a rep discounts to sell more — cannot happen here: the
 * price is fixed and the rep has no discount at all. And it means no cost or
 * margin figure has to exist anywhere near this screen.
 */
export async function getCommission(agentId: string, month: string, ratePercent?: number) {
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

  const [sold, collected, invoiceCount] = await Promise.all([
    prisma.invoice.aggregate({ where: soldWhere, _sum: { totalAmount: true } }),
    prisma.paymentVoucher.aggregate({
      where: {
        salesAgentId: agentId,
        type: "RECEIPT",
        cancelledAt: null,
        archivedAt: null,
        date: { gte: from, lt: to },
      },
      _sum: { amount: true },
    }),
    prisma.invoice.count({ where: soldWhere }),
  ]);

  const soldTotal = toNumber(sold._sum.totalAmount);
  const collectedTotal = toNumber(collected._sum.amount);
  const rate = Number.isFinite(Number(ratePercent)) ? Number(ratePercent) : null;

  return {
    agentId: agent.id,
    agentName: agent.name,
    month,
    invoiceCount,
    sold: soldTotal,
    collected: collectedTotal,
    ratePercent: rate,
    // Both are shown side by side: the owner decides which one to pay on, and
    // that decision is theirs to make each month rather than the software's.
    onSold: rate == null ? null : round2((soldTotal * rate) / 100),
    onCollected: rate == null ? null : round2((collectedTotal * rate) / 100),
  };
}

/** The rep list for the owner's dropdowns. */
export async function listAgentsForAdmin() {
  return activeAgents();
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

/** The raw log behind the reports, for when the owner wants to read them one by one. */
export async function listIssues(opts: { from?: string; to?: string; agentId?: string; reason?: string } = {}) {
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
