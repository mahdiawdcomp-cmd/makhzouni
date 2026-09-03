/**
 * «المندوب» — the travelling sales rep.
 *
 * The rep is an ordinary STAFF user carrying the SALES_AGENT capability. There
 * is no parallel identity system and no parallel order pipeline: an order the
 * rep takes is the SAME `CATALOG_ORDER` approval a shopper's order creates, so
 * it lands in the same approvals screen, becomes an invoice through the same
 * `markPrepared` path, and moves stock at the same moment (on approval, never
 * on submission). The one real difference is whose name is on it.
 *
 * Two rules this file exists to enforce, both server-side:
 *
 *  1. A rep sees ONLY the customers stamped with their id. Filtering in the UI
 *     would be theatre — anyone can open devtools and call the API directly.
 *  2. Cost, profit and margin never leave the server for a rep. Every read here
 *     uses an explicit `select`, so a new column on Product cannot silently
 *     start shipping to a rep's phone the day someone adds it.
 */
import { Unit } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { logger } from "../utils/logger";
import { approvalRequestTypes, createPendingApproval } from "./approval.service";
import { totalStock } from "../utils/product-stock";
import { effectiveBoxPieces } from "../utils/financial";
import { normalizePhone } from "../utils/phone";
import { getSettings } from "./settings.service";
import { createCustomer } from "./customer.service";
import { notifySalesAgentEvent } from "./sales-agent-notify.service";

/* ── unit maths ──────────────────────────────────────────────────────────
 * Deliberately identical to the catalog's own conversion. A rep's carton must
 * mean exactly what a shopper's carton means, or the same order would price
 * differently depending on who typed it.
 */
function toNumber(value: unknown) {
  return value == null ? 0 : Number(value);
}

function piecesFor(unit: Unit, quantity: number, pcsPerCarton: number, boxPieces?: number | null) {
  const n = Math.max(1, pcsPerCarton);
  if (unit === Unit.CARTON) return quantity * n;
  if (unit === Unit.BOX) return quantity * effectiveBoxPieces(n, boxPieces);
  if (unit === Unit.DOZEN) return quantity * 12;
  return quantity; // PIECE
}

function salePriceFor(unit: Unit, salePrice: unknown, pcsPerCarton: number, boxPieces?: number | null) {
  const price = toNumber(salePrice);
  const n = Math.max(1, pcsPerCarton);
  if (unit === Unit.CARTON) return price * n;
  if (unit === Unit.BOX) return price * effectiveBoxPieces(n, boxPieces);
  if (unit === Unit.DOZEN) return price * 12;
  return price; // PIECE
}

/**
 * The display tag mirrored onto every customer a rep owns.
 *
 * The authoritative link is `Customer.salesAgentId`; this tag exists only so the
 * owner can see, filter and search the relationship in the ordinary customers
 * screen without a new column being added to every table. Never read it back to
 * make an access decision.
 */
export const SALES_AGENT_TAG = "زبون مندوب";

/* ── areas («المنطقة») ───────────────────────────────────────────────────
 * Areas are neighbourhoods inside one city, so they are per-tenant data, not a
 * constant: the shop types its own list once in Settings. Shipping a hardcoded
 * list would bake one tenant's city into shared code.
 */
export async function listSalesAgentAreas(): Promise<string[]> {
  const settings = await getSettings().catch(() => null);
  const raw = settings?.salesAgentAreas;
  if (!Array.isArray(raw)) return [];
  return raw.map((a) => String(a).trim()).filter(Boolean);
}

/* ── who is a rep ────────────────────────────────────────────────────── */

export async function listSalesAgents() {
  const users = await prisma.user.findMany({
    where: { isActive: true, permissions: { has: "SALES_AGENT" } },
    select: { id: true, name: true, username: true, phone: true },
    orderBy: { name: "asc" },
  });
  return users;
}

/* ── customers ───────────────────────────────────────────────────────── */

/**
 * Assert the customer belongs to this rep, and hand back the row.
 *
 * Every rep-facing read and write funnels through here. A customer that exists
 * but belongs to someone else answers 404, not 403: a 403 would confirm the
 * phone/id is a real customer of the shop, which is itself information a rep
 * should not be able to harvest.
 */
export async function assertOwnCustomer(agentId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null, salesAgentId: agentId },
  });
  if (!customer) {
    throw new AppError("هذا الزبون مو ضمن زبائنك", 404, "CUSTOMER_NOT_IN_SCOPE");
  }
  return customer;
}

export async function listMyCustomers(agentId: string, search?: string) {
  const term = search?.trim();
  const customers = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      salesAgentId: agentId,
      ...(term
        ? { OR: [{ name: { contains: term, mode: "insensitive" as const } }, { phone: { contains: term } }] }
        : {}),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      address: true,
      area: true,
      province: true,
      currentBalance: true,
      lastTransactionAt: true,
    },
    orderBy: [{ name: "asc" }],
    take: 500,
  });

  return customers.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    address: c.address,
    area: c.area,
    province: c.province,
    currentBalance: toNumber(c.currentBalance),
    lastTransactionAt: c.lastTransactionAt,
  }));
}

/**
 * The header strip: who the rep is selling to, what they owe, and when they
 * last paid. One call, because it is re-read on every customer switch while the
 * rep stands in a shop on mobile data.
 */
export async function getCustomerHeader(agentId: string, customerId: string) {
  const customer = await assertOwnCustomer(agentId, customerId);

  const lastPayment = await prisma.paymentVoucher.findFirst({
    where: { customerId, type: "RECEIPT", cancelledAt: null, archivedAt: null },
    select: { amount: true, date: true },
    orderBy: { date: "desc" },
  });

  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    address: customer.address,
    area: customer.area,
    province: customer.province,
    currentBalance: toNumber(customer.currentBalance),
    lastPayment: lastPayment
      ? { amount: toNumber(lastPayment.amount), date: lastPayment.date }
      : null,
  };
}

/**
 * Phone lookup run BEFORE a rep creates a customer.
 *
 * The single biggest source of mess in systems like this is the same shop
 * entered three times under three spellings, so the duplicate check is not
 * optional politeness — the rep is shown the match and has to choose.
 *
 * What comes back is deliberately thin. If the number belongs to a customer of
 * a different rep (or of no rep), the rep learns the name and that they cannot
 * take it — not the balance, not the history.
 */
export async function lookupPhone(agentId: string, rawPhone: string) {
  const phone = normalizePhone(String(rawPhone ?? "").trim());
  if (!phone) throw new AppError("رقم الهاتف مطلوب", 400, "PHONE_REQUIRED");

  const existing = await prisma.customer.findFirst({
    where: { phone },
    select: { id: true, name: true, salesAgentId: true, deletedAt: true },
  });

  if (!existing) return { found: false as const, phone };

  if (existing.deletedAt) {
    return {
      found: true as const,
      phone,
      name: existing.name,
      mine: false,
      claimable: false,
      reason: "DELETED" as const,
      message: `هذا الرقم يخص زبون محذوف باسم «${existing.name}» — راجع صاحب المحل.`,
    };
  }

  if (existing.salesAgentId === agentId) {
    return {
      found: true as const,
      phone,
      id: existing.id,
      name: existing.name,
      mine: true,
      claimable: false,
      reason: "MINE" as const,
      message: `هذا الزبون موجود عندك باسم «${existing.name}».`,
    };
  }

  if (existing.salesAgentId == null) {
    return {
      found: true as const,
      phone,
      id: existing.id,
      name: existing.name,
      mine: false,
      claimable: true,
      reason: "UNASSIGNED" as const,
      message: `هذا الزبون موجود باسم «${existing.name}» وما عليه مندوب — تكدر تضيفه لزبائنك.`,
    };
  }

  return {
    found: true as const,
    phone,
    name: existing.name,
    mine: false,
    claimable: false,
    reason: "OTHER_AGENT" as const,
    message: `هذا الرقم يخص زبون «${existing.name}» ومربوط بمندوب ثاني — راجع صاحب المحل.`,
  };
}

/**
 * «يكمل على نفس الزبون» — attach an existing, unassigned customer to this rep.
 *
 * Only customers with no rep can be claimed. Taking a customer off another rep
 * would hand over their whole account statement silently, so that stays an
 * owner decision. Every claim is written to the audit log: the rep gains sight
 * of a full financial history, which is exactly the kind of event that should
 * still be visible to the owner a month later.
 */
export async function claimCustomer(agentId: string, agentName: string, customerId: string) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true, name: true, phone: true, salesAgentId: true, tags: true },
  });
  if (!customer) throw new AppError("الزبون غير موجود", 404, "CUSTOMER_NOT_FOUND");

  if (customer.salesAgentId === agentId) return { customerId: customer.id, name: customer.name, claimed: false };
  if (customer.salesAgentId != null) {
    throw new AppError("هذا الزبون مربوط بمندوب ثاني", 409, "CUSTOMER_HAS_AGENT");
  }

  await prisma.customer.update({
    where: { id: customer.id },
    data: {
      salesAgentId: agentId,
      tags: customer.tags.includes(SALES_AGENT_TAG) ? customer.tags : [...customer.tags, SALES_AGENT_TAG],
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: agentId,
      action: "SALES_AGENT_CLAIMED_CUSTOMER",
      entity: "Customer",
      recordId: customer.id,
      metadata: { agentName, phone: customer.phone, customerName: customer.name },
    },
  });

  return { customerId: customer.id, name: customer.name, claimed: true };
}

export type AgentCustomerInput = {
  name: string;
  phone: string;
  address?: string;
  area?: string;
};

/**
 * A customer the rep creates works IMMEDIATELY — they can sell to them in the
 * same minute. The owner gets a notification and reviews it later to fix a
 * spelling or merge a duplicate. Making the rep wait for approval while standing
 * in front of the shopkeeper is the one thing that would kill the workflow.
 */
export async function createAgentCustomer(
  agentId: string,
  agentName: string,
  input: AgentCustomerInput,
) {
  const name = String(input.name ?? "").trim();
  if (!name) throw new AppError("اسم الزبون مطلوب", 400, "NAME_REQUIRED");

  const phone = normalizePhone(String(input.phone ?? "").trim());
  if (!phone) throw new AppError("رقم الهاتف مطلوب", 400, "PHONE_REQUIRED");

  // The duplicate check the client already ran is advisory — it can be skipped
  // by calling the API directly, and a customer can be created by someone else
  // between the check and the save. Re-run it here where it is binding.
  const existing = await prisma.customer.findFirst({ where: { phone }, select: { id: true, name: true } });
  if (existing) {
    throw new AppError(`هذا الرقم موجود مسبقاً باسم «${existing.name}»`, 409, "PHONE_IN_USE");
  }

  const area = input.area?.trim() || undefined;
  if (area) {
    const allowed = await listSalesAgentAreas();
    // An empty list means the shop has not filled its areas yet — accept what
    // the rep sends rather than blocking the sale over a settings gap.
    if (allowed.length > 0 && !allowed.includes(area)) {
      throw new AppError("المنطقة غير موجودة بالقائمة", 400, "AREA_NOT_ALLOWED");
    }
  }

  const created = await createCustomer({
    name,
    phone,
    address: input.address?.trim() || undefined,
    openingBalance: 0,
    tags: [SALES_AGENT_TAG],
  });

  // Stamp the rep and area after creation: createCustomer owns the duplicate
  // rules and auto-tagging, and reproducing them here would mean two copies of
  // the same logic drifting apart.
  await prisma.customer.update({
    where: { id: created.id },
    data: { salesAgentId: agentId, area: area ?? null },
  });

  await prisma.auditLog.create({
    data: {
      userId: agentId,
      action: "SALES_AGENT_CREATED_CUSTOMER",
      entity: "Customer",
      recordId: created.id,
      metadata: { agentName, phone, name, area: area ?? null },
    },
  });

  notifySalesAgentEvent("newCustomer", {
    agentName,
    customerName: name,
    phone,
    area: area ?? null,
    address: input.address?.trim() || null,
    customerId: created.id,
  }).catch((err) => logger.warn(`[SalesAgent] new-customer notify failed: ${String(err)}`));

  return { id: created.id, name, phone, area: area ?? null };
}

/* ── catalog ─────────────────────────────────────────────────────────── */

/**
 * The rep's product grid.
 *
 * Real stock numbers, real prices, and NOTHING about cost. The `select` is
 * exhaustive on purpose: `omit`-style filtering leaks any column added later,
 * and "the rep can't see it in the UI" is not a control — devtools shows the
 * raw response.
 */
export async function listAgentCatalogProducts() {
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      itemNumber: true,
      name: true,
      category: true,
      categoryTags: true,
      typeTags: true,
      salePrice: true,
      oldPrice: true,
      isOffer: true,
      isNewArrival: true,
      pcsPerCarton: true,
      boxPieces: true,
      hiddenUnits: true,
      thumbnailUrl: true,
      // totalStock() falls back to these two when a product has no per-warehouse
      // rows, so leaving them out of the select would read every such product as
      // zero stock and hide it from the rep entirely.
      openingBalancePcs: true,
      cartonsAvailable: true,
      warehouseStocks: { select: { quantityPieces: true } },
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  return products
    .map((product) => ({
      id: product.id,
      itemNumber: product.itemNumber,
      name: product.name,
      category: product.category,
      categoryTags: product.categoryTags,
      typeTags: product.typeTags,
      salePrice: toNumber(product.salePrice),
      oldPrice: product.oldPrice != null ? toNumber(product.oldPrice) : null,
      isOffer: product.isOffer,
      isNewArrival: product.isNewArrival,
      pcsPerCarton: product.pcsPerCarton,
      boxPieces: product.boxPieces,
      hiddenUnits: product.hiddenUnits,
      // Thumbnails are fetched separately, a screenful at a time. Inlining a few
      // hundred base64 images would be megabytes on the first open — on mobile
      // data, in the street, that is the whole experience.
      hasImage: Boolean(product.thumbnailUrl),
      currentStock: totalStock(product),
    }))
    .filter((p) => p.currentStock > 0);
}

export async function getAgentProductThumbnails(ids: string[]) {
  if (ids.length === 0) return {};
  const rows = await prisma.product.findMany({
    where: { id: { in: ids.slice(0, 80) }, deletedAt: null },
    select: { id: true, thumbnailUrl: true },
  });
  return Object.fromEntries(rows.map((r) => [r.id, r.thumbnailUrl ?? null]));
}

export async function getAgentProductImage(productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { imageUrl: true, thumbnailUrl: true },
  });
  return product?.imageUrl ?? product?.thumbnailUrl ?? null;
}

/* ── orders ──────────────────────────────────────────────────────────── */

export type AgentOrderInput = {
  customerId: string;
  notes?: string;
  items: Array<{ productId: string; unit: Unit; quantity: number }>;
};

/**
 * Submit an order in the rep's name.
 *
 * Builds exactly the `CATALOG_ORDER` approval payload the storefront builds —
 * same shape, same downstream handler — with two differences:
 *
 *   - `requestedBy` is the REP, not the placeholder "first active user" the
 *     public catalog falls back to. The column was always there; the storefront
 *     simply has no user to put in it. That is the whole mechanism behind "the
 *     one real difference is whose name is on it".
 *   - `salesAgentId` rides along in the payload so the invoice created on
 *     approval carries the rep's stamp.
 *
 * Prices come from the database, never from the request body. A rep cannot
 * discount, and the surest way to guarantee that is to never read a price they
 * sent.
 */
export async function submitAgentOrder(agentId: string, agentName: string, input: AgentOrderInput) {
  const customer = await assertOwnCustomer(agentId, input.customerId);

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new AppError("الطلب فارغ", 400, "ORDER_EMPTY");
  }

  const uniqueProductIds = [...new Set(input.items.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: uniqueProductIds }, deletedAt: null },
    select: {
      id: true,
      name: true,
      salePrice: true,
      pcsPerCarton: true,
      boxPieces: true,
      openingBalancePcs: true,
      cartonsAvailable: true,
      warehouseStocks: { select: { quantityPieces: true } },
    },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  // Sum the requested pieces per product FIRST: the same product can appear on
  // two lines in different units, and checking each line on its own would let
  // the pair together exceed stock.
  const requestedPiecesByProduct = new Map<string, number>();
  for (const item of input.items) {
    const product = productById.get(item.productId);
    if (!product) throw new AppError("منتج غير موجود", 404, "PRODUCT_NOT_FOUND");
    if (!(item.quantity > 0)) throw new AppError("الكمية لازم تكون أكبر من صفر", 400, "QUANTITY_INVALID");
    const pieces = piecesFor(item.unit, item.quantity, product.pcsPerCarton, product.boxPieces);
    requestedPiecesByProduct.set(product.id, (requestedPiecesByProduct.get(product.id) ?? 0) + pieces);
  }

  for (const product of products) {
    if ((requestedPiecesByProduct.get(product.id) ?? 0) > totalStock(product)) {
      throw new AppError(`الكمية المتوفرة ما تكفي: «${product.name}»`, 400, "STOCK_NOT_ENOUGH");
    }
  }

  const normalizedItems = input.items.map((item) => {
    const product = productById.get(item.productId)!;
    const unitPrice = salePriceFor(item.unit, product.salePrice, product.pcsPerCarton, product.boxPieces);
    return {
      productId: product.id,
      productName: product.name,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice,
      totalPrice: unitPrice * item.quantity,
      availableStock: totalStock(product),
    };
  });

  const subtotal = normalizedItems.reduce((sum, i) => sum + i.totalPrice, 0);

  const approval = await createPendingApproval(
    approvalRequestTypes.CATALOG_ORDER,
    {
      source: "SALES_AGENT",
      salesAgentId: agentId,
      salesAgentName: agentName,
      customerName: customer.name,
      phone: customer.phone,
      customerId: customer.id,
      address: customer.address ?? undefined,
      area: customer.area ?? undefined,
      notes: input.notes,
      subtotal,
      finalTotal: subtotal,
      body: {
        customerName: customer.name,
        phone: customer.phone,
        address: customer.address ?? undefined,
        notes: input.notes,
        salesAgentId: agentId,
        items: normalizedItems.map((i) => ({
          productId: i.productId,
          unit: i.unit,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        })),
      },
      displayItems: normalizedItems,
    },
    // The rep owns the request. This is the field the public catalog wastes on
    // a placeholder user — here it carries the real answer.
    agentId,
  );

  notifySalesAgentEvent("newOrder", {
    agentName,
    customerName: customer.name,
    phone: customer.phone,
    total: subtotal,
    lineCount: normalizedItems.length,
    items: normalizedItems.map((i) => ({
      productName: i.productName,
      unit: i.unit,
      quantity: i.quantity,
      totalPrice: i.totalPrice,
    })),
  }).catch((err) => logger.warn(`[SalesAgent] order notify failed: ${String(err)}`));

  return { approvalId: approval.id, subtotal, lineCount: normalizedItems.length };
}

/**
 * The rep's own order history — what they sent and what became of it.
 *
 * Scoped by `requestedBy`, which is the rep themselves, so this needs no extra
 * ownership check: a rep cannot see a request they did not make.
 */
export async function listMyOrders(agentId: string, limit = 40) {
  const approvals = await prisma.pendingApproval.findMany({
    where: { requestedBy: agentId, requestType: approvalRequestTypes.CATALOG_ORDER },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
    select: { id: true, status: true, createdAt: true, reviewedAt: true, requestData: true },
  });

  return approvals.map((a) => {
    const data = (a.requestData ?? {}) as {
      customerName?: string;
      finalTotal?: number;
      subtotal?: number;
      displayItems?: unknown[];
    };
    return {
      id: a.id,
      status: a.status,
      createdAt: a.createdAt,
      reviewedAt: a.reviewedAt,
      customerName: data.customerName ?? "",
      total: Number(data.finalTotal ?? data.subtotal ?? 0),
      lineCount: Array.isArray(data.displayItems) ? data.displayItems.length : 0,
    };
  });
}

/* ── receipts and the rep's cash ─────────────────────────────────────── */

/**
 * «سند قبض» recorded by the rep.
 *
 * Goes through `createVoucher` unchanged — the same transaction, the same
 * balance freeze, the same allocation the shop has always used. The ONLY
 * difference is the `salesAgentId` stamp saying who physically holds the money.
 * Nothing new was written for how a payment lands on a customer's account, on
 * purpose: that logic is correct and load-bearing, and a second copy of it would
 * be a second thing to keep right.
 */
export async function createAgentReceipt(
  agentId: string,
  agentName: string,
  input: { customerId: string; amount: number; notes?: string; clientRequestId?: string },
) {
  const customer = await assertOwnCustomer(agentId, input.customerId);

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError("المبلغ لازم يكون أكبر من صفر", 400, "AMOUNT_INVALID");
  }

  const { createVoucher } = await import("./voucher.service");
  const voucher = await createVoucher(
    {
      customerId: customer.id,
      amount,
      type: "RECEIPT",
      notes: input.notes,
      clientRequestId: input.clientRequestId,
      salesAgentId: agentId,
    },
    // createdBy is the rep: they are the one who took the money and typed it.
    agentId,
  );

  notifySalesAgentEvent("receipt", {
    agentName,
    customerName: customer.name,
    phone: customer.phone,
    customerId: customer.id,
    total: amount,
  }).catch((err) => logger.warn(`[SalesAgent] receipt notify failed: ${String(err)}`));

  return voucher;
}

/**
 * «معي الآن» — cash the rep has collected and not yet handed over.
 *
 * DERIVED, never stored: receipts stamped with this rep, minus their handovers.
 * A stored running total would be one more number that can drift away from the
 * vouchers it is supposed to summarise; this one cannot, because it is the
 * vouchers.
 *
 * Cancelled and archived vouchers are excluded for the same reason they are
 * excluded from the customer's balance — they are audit artefacts, not money.
 */
export async function getAgentCashOnHand(agentId: string) {
  const [collected, handed] = await Promise.all([
    prisma.paymentVoucher.aggregate({
      where: {
        salesAgentId: agentId,
        type: "RECEIPT",
        cancelledAt: null,
        archivedAt: null,
      },
      _sum: { amount: true },
    }),
    prisma.salesAgentHandover.aggregate({
      where: { salesAgentId: agentId },
      _sum: { amount: true },
    }),
  ]);

  const collectedTotal = toNumber(collected._sum.amount);
  const handedTotal = toNumber(handed._sum.amount);

  return {
    collected: collectedTotal,
    handedOver: handedTotal,
    onHand: Math.round((collectedTotal - handedTotal) * 100) / 100,
  };
}

/**
 * The full picture of one of the rep's customers.
 *
 * Reuses `getCustomerTransactions` — the shop's real statement builder — rather
 * than assembling a rep-flavoured imitation, so what the rep reads is the same
 * statement the owner reads. Safe to hand over: that builder maps invoice lines
 * into an explicit shape carrying no cost field, unlike the raw rows it reads.
 */
export async function getAgentCustomerDetail(agentId: string, customerId: string) {
  await assertOwnCustomer(agentId, customerId);
  const { getCustomerTransactions } = await import("./customer.service");
  return getCustomerTransactions(customerId, { all: true } as Parameters<typeof getCustomerTransactions>[1]);
}

/** The rep's own receipts, newest first — what they collected and when. */
export async function listMyReceipts(agentId: string, limit = 40) {
  const rows = await prisma.paymentVoucher.findMany({
    where: { salesAgentId: agentId, type: "RECEIPT", archivedAt: null },
    orderBy: { date: "desc" },
    take: Math.min(limit, 100),
    select: {
      id: true,
      voucherNumber: true,
      amount: true,
      date: true,
      cancelledAt: true,
      customer: { select: { id: true, name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    voucherNumber: r.voucherNumber,
    amount: toNumber(r.amount),
    date: r.date,
    cancelled: Boolean(r.cancelledAt),
    customerId: r.customer?.id ?? null,
    customerName: r.customer?.name ?? "",
  }));
}

/** The rep's handover history — what the owner has taken off their hands. */
export async function listMyHandovers(agentId: string, limit = 40) {
  const rows = await prisma.salesAgentHandover.findMany({
    where: { salesAgentId: agentId },
    orderBy: { date: "desc" },
    take: Math.min(limit, 100),
    select: { id: true, amount: true, date: true, notes: true, receiver: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    amount: toNumber(r.amount),
    date: r.date,
    notes: r.notes,
    receivedBy: r.receiver.name,
  }));
}
