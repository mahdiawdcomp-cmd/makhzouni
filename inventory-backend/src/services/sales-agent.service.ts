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
import { piecesForUnit, priceForUnit } from "../utils/catalog-units";
import { normalizePhone, phoneVariants } from "../utils/phone";
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

// Both live in utils/catalog-units.ts now: a rep's carton must mean exactly what
// a shopper's carton means, and two copies of that rule are one edit away from
// it not. Aliased rather than renamed at every call site to keep this change
// behaviour-preserving and reviewable.
const piecesFor = piecesForUnit;
const salePriceFor = priceForUnit;

/**
 * The display tag mirrored onto every customer a rep owns.
 *
 * The authoritative link is `Customer.salesAgentId`; this tag exists only so the
 * owner can see, filter and search the relationship in the ordinary customers
 * screen without a new column being added to every table. Never read it back to
 * make an access decision.
 */
export const SALES_AGENT_TAG = "زبون مندوب";

/**
 * Typo guard on a receipt, not a business rule.
 *
 * A customer paying more than they owe is normal and stays allowed. This only
 * catches the extra zeros — an amount no real shop hands a rep in cash.
 */
const RECEIPT_SANITY_CAP = 100_000_000;

/**
 * Keep the display tag in step with the authoritative column.
 *
 * The tag is free text: a user editing a customer can drop it, and nothing put
 * it back. That left customers linked-but-untagged, so the ordinary customers
 * screen disagreed with the server about who belongs to whom. This is called
 * wherever the link is set, and by the customer-update path, so the two cannot
 * drift apart.
 */
export async function syncAgentTag(customerId: string) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { tags: true, salesAgentId: true },
  });
  if (!customer) return;

  const has = customer.tags.includes(SALES_AGENT_TAG);
  const should = customer.salesAgentId != null;
  if (has === should) return;

  await prisma.customer.update({
    where: { id: customerId },
    data: {
      tags: should
        ? [...customer.tags, SALES_AGENT_TAG]
        : customer.tags.filter((t) => t !== SALES_AGENT_TAG),
    },
  });
}

/**
 * Reject a malformed id BEFORE it reaches Prisma.
 *
 * Ids here arrive as URL segments, so any of them can be any string. A uuid
 * column handed a non-uuid makes Prisma throw a validation error, which reaches
 * the client as a bare 500 — the shape of a broken server rather than of a bad
 * request, and noise in the error log for what is just a bad link.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string | undefined | null, message: string) {
  if (!value || !UUID_RE.test(value)) {
    throw new AppError(message, 400, "ID_INVALID");
  }
  return value;
}

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
  assertUuid(customerId, "الزبون غير صحيح");
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null, salesAgentId: agentId },
  });
  if (!customer) {
    throw new AppError("هذا الزبون مو ضمن زبائنك", 404, "CUSTOMER_NOT_IN_SCOPE");
  }
  return customer;
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

  // Matched on every spelling, not just the canonical one: a row still holding
  // «07…» is the same customer, and answering "not found" for it is how the rep
  // ends up creating a second record for someone they already sell to.
  const existing = await prisma.customer.findFirst({
    where: { phone: { in: phoneVariants(rawPhone) } },
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
  assertUuid(customerId, "الزبون غير صحيح");
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
  const existing = await prisma.customer.findFirst({
    where: { phone: { in: phoneVariants(input.phone) } },
    select: { id: true, name: true },
  });
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
    // Exactly the filter the public catalog uses, and for the same reason: the
    // rep's grid must BE the shop's catalog, not a variant of it. A product the
    // shopkeeper cannot find in the catalog must not appear on the rep's phone
    // either, or the two disagree about what the shop sells.
    //
    // This is NOT the "a shortage never blocks a sale" policy — that rule is
    // about REFUSING an order and still holds: a product with 5 left can be sold
    // in tens, and submitAgentOrder records the shortfall instead of throwing.
    // Hiding a line that is fully out of stock is a display decision, and
    // conflating the two is what put out-of-stock goods in front of the rep.
    .filter((p) => p.currentStock > 0);
}

export async function getAgentProductThumbnails(ids: string[]) {
  // Silently drop malformed ids rather than failing the batch: one bad entry
  // must not blank out a whole screenful of thumbnails.
  const clean = ids.filter((id) => UUID_RE.test(id));
  if (clean.length === 0) return {};
  const rows = await prisma.product.findMany({
    where: { id: { in: clean.slice(0, 80) }, deletedAt: null },
    select: { id: true, thumbnailUrl: true },
  });
  return Object.fromEntries(rows.map((r) => [r.id, r.thumbnailUrl ?? null]));
}

export async function getAgentProductImage(productId: string) {
  assertUuid(productId, "المادة غير صحيحة");
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
  /**
   * Client-generated key for one attempt at sending a cart.
   *
   * A rep taps «أرسل الطلب» on a bad connection, sees nothing happen, and taps
   * again — this shop has already been bitten by duplicate invoices that way.
   * The retry carries the same key and gets the first approval back instead of
   * creating a second one.
   */
  clientRequestId?: string;
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
/**
 * The first request wins and every repeat of it gets the same answer.
 *
 * `client_request_id` is a real unique column, so this read is only the fast
 * path — the guarantee lives in the database. The old code read the table and
 * then inserted, and three taps that arrived together all read "nothing yet"
 * and all inserted: one double tap on «أرسل الطلب» produced three identical
 * orders. The JSON fallback reads orders written before the column existed.
 */
async function findPriorAgentOrder(agentId: string, key: string) {
  const prior = await prisma.pendingApproval.findFirst({
    where: {
      requestedBy: agentId,
      requestType: approvalRequestTypes.CATALOG_ORDER,
      OR: [{ clientRequestId: key }, { requestData: { path: ["clientRequestId"], equals: key } }],
    },
    select: { id: true, requestData: true },
  });
  if (!prior) return null;
  const d = (prior.requestData ?? {}) as { subtotal?: number; displayItems?: unknown[] };
  return {
    approvalId: prior.id,
    subtotal: Number(d.subtotal ?? 0),
    lineCount: Array.isArray(d.displayItems) ? d.displayItems.length : 0,
    shortages: [] as Array<{ productId: string; productName: string; requested: number; available: number; short: number }>,
    duplicate: true,
  };
}

export async function submitAgentOrder(agentId: string, agentName: string, input: AgentOrderInput) {
  const customer = await assertOwnCustomer(agentId, input.customerId);

  // Idempotency first, before any work: a repeat of the same attempt returns the
  // approval the first one created. Matched on the rep too, so one rep's key can
  // never hand back another rep's order.
  const key = input.clientRequestId?.trim();
  if (key) {
    const prior = await findPriorAgentOrder(agentId, key);
    if (prior) return prior;
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new AppError("الطلب فارغ", 400, "ORDER_EMPTY");
  }

  const uniqueProductIds = [...new Set(input.items.map((i) => i.productId))];
  for (const id of uniqueProductIds) assertUuid(id, "مادة غير صحيحة بالطلب");

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

  // The rep's cart is kept in their browser and can outlive a product. Refusing
  // with a bare "منتج غير موجود" left them with a saved cart that would not send
  // and no way to tell which line to drop — the deleted row is gone from their
  // screen too. Name it, reading past the soft-delete so the name still exists.
  const missing = uniqueProductIds.filter((id) => !productById.has(id));
  if (missing.length > 0) {
    const gone = await prisma.product.findMany({
      where: { id: { in: missing } },
      select: { name: true },
    });
    const names = gone.map((g) => `«${g.name}»`).join("، ");
    throw new AppError(
      names
        ? `هذي المواد ما عادت موجودة، شيلها من السلة: ${names}`
        : "بالسلة مادة ما عادت موجودة — شيلها وأعد الإرسال",
      404,
      "PRODUCT_NOT_FOUND",
    );
  }

  // Sum the requested pieces per product FIRST: the same product can appear on
  // two lines in different units, and checking each line on its own would let
  // the pair together exceed stock.
  const requestedPiecesByProduct = new Map<string, number>();
  for (const item of input.items) {
    const product = productById.get(item.productId);
    if (!product) throw new AppError("منتج غير موجود", 404, "PRODUCT_NOT_FOUND");
    // Whole units only, matching every other order path in this system (they all
    // validate `.int().positive()`). This one accepted 0.5, which prices half a
    // piece and then flows into an invoice line nobody can pick or deliver.
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new AppError("الكمية لازم تكون رقم صحيح أكبر من صفر", 400, "QUANTITY_INVALID");
    }
    if (item.quantity > 100_000) {
      throw new AppError("الكمية كبيرة جداً — تأكد منها", 400, "QUANTITY_TOO_LARGE");
    }
    const pieces = piecesFor(item.unit, item.quantity, product.pcsPerCarton, product.boxPieces);
    requestedPiecesByProduct.set(product.id, (requestedPiecesByProduct.get(product.id) ?? 0) + pieces);
  }

  // A shortage NEVER blocks the sale — the shop's standing policy, and the same
  // rule the invoice screen follows. The rep is standing in front of a customer
  // who wants the goods; refusing the order there loses a real sale to fix a
  // number that the shop settles when stock arrives.
  //
  // It is recorded instead of refused: the owner sees the shortfall on the
  // approval, and decides with the full picture rather than the rep being
  // stopped at the door.
  const shortages = products
    .map((product) => {
      const requested = requestedPiecesByProduct.get(product.id) ?? 0;
      const available = totalStock(product);
      return requested > available
        ? { productId: product.id, productName: product.name, requested, available, short: requested - available }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // «اطلب سعراً خاصاً» — approved, unspent prices for THIS customer.
  //
  // Re-read here rather than trusted from the request body: the client shows
  // them on the cart line as a courtesy, but what gets billed is resolved from
  // the database at the moment the order is priced. A price the rep sent could
  // be any number they liked.
  const approvedPrices = await prisma.salesAgentPriceRequest.findMany({
    where: {
      salesAgentId: agentId,
      customerId: customer.id,
      status: "APPROVED",
      consumedAt: null,
      productId: { in: uniqueProductIds },
    },
    select: { id: true, productId: true, unit: true, requestedPrice: true },
  });
  const priceByKey = new Map(
    approvedPrices.map((p) => [`${p.productId}:${p.unit}`, { id: p.id, price: toNumber(p.requestedPrice) }]),
  );
  const spentPriceIds: string[] = [];

  const normalizedItems = input.items.map((item) => {
    const product = productById.get(item.productId)!;
    const catalogPrice = salePriceFor(item.unit, product.salePrice, product.pcsPerCarton, product.boxPieces);
    const special = priceByKey.get(`${product.id}:${item.unit}`);
    if (special) spentPriceIds.push(special.id);
    return {
      productId: product.id,
      productName: product.name,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice: special ? special.price : catalogPrice,
      totalPrice: (special ? special.price : catalogPrice) * item.quantity,
      availableStock: totalStock(product),
      // Surfaced on the approval so the owner sees WHY a line is below the
      // shelf price, instead of wondering whether something is broken.
      specialPrice: special ? { catalogPrice } : undefined,
    };
  });

  const subtotal = normalizedItems.reduce((sum, i) => sum + i.totalPrice, 0);

  const approvalData = {
    source: "SALES_AGENT",
    salesAgentId: agentId,
    salesAgentName: agentName,
    clientRequestId: key,
    customerName: customer.name,
    phone: customer.phone,
    customerId: customer.id,
    address: customer.address ?? undefined,
    area: customer.area ?? undefined,
    notes: input.notes,
    subtotal,
    finalTotal: subtotal,
    // Empty on a normal order; present when the rep sold something the shop is
    // short of, so the approvals row can say so instead of the owner finding
    // out when stock goes negative.
    shortages,
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
  };

  let approval: { id: string };
  try {
    approval = await createPendingApproval(
      approvalRequestTypes.CATALOG_ORDER,
      approvalData,
      // The rep owns the request. This is the field the public catalog wastes
      // on a placeholder user — here it carries the real answer.
      agentId,
      agentName,
      key,
    );
  } catch (err) {
    // Two taps raced past the read above and the unique index caught the second
    // one. The rep gets back the order the first tap created — no twin, and no
    // second notification to the owner.
    if (key && (err as { code?: string })?.code === "P2002") {
      const prior = await findPriorAgentOrder(agentId, key);
      if (prior) return prior;
    }
    throw err;
  }

  // Spend the approved prices now that they are frozen into the approval
  // snapshot. If the owner later rejects the whole order the price is spent and
  // the rep asks again — the honest outcome, rather than a negotiated price
  // quietly held open against a customer indefinitely.
  if (spentPriceIds.length > 0) {
    await prisma.salesAgentPriceRequest
      .updateMany({ where: { id: { in: spentPriceIds } }, data: { consumedAt: new Date() } })
      .catch((err) => logger.warn(`[SalesAgent] price consume failed: ${String(err)}`));
  }

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

  return { approvalId: approval.id, subtotal, lineCount: normalizedItems.length, shortages, duplicate: false };
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
    select: {
      id: true,
      status: true,
      createdAt: true,
      reviewedAt: true,
      reviewNote: true,
      requestData: true,
    },
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
      // Why it was refused, so the rep can fix it instead of telephoning.
      reviewNote: a.reviewNote,
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
  // Overpaying is legitimate (it leaves the customer in credit), so the customer's
  // balance is NOT a ceiling. But an amount this large is always a slipped
  // finger, and an unnoticed one lands straight on the rep's cash liability.
  if (amount > RECEIPT_SANITY_CAP) {
    throw new AppError(
      `المبلغ كبير جداً — تأكد منه. الحد ${RECEIPT_SANITY_CAP.toLocaleString("en-US")}`,
      400,
      "AMOUNT_TOO_LARGE",
    );
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

/* ── «أكو مشكلة» ─────────────────────────────────────────────────────── */

/**
 * The refusal reasons, as the rep taps them.
 *
 * A fixed list, because free text is unreportable: "غالي" typed nine different
 * ways answers no question at all. Held in code rather than the database
 * because these are the reasons a shopkeeper refuses anywhere, not a per-tenant
 * setting — and the `reason` column is a plain string, so adding one later
 * needs no migration.
 */
export const ISSUE_REASONS: Array<{ code: string; label: string; aboutProduct: boolean }> = [
  { code: "PRICE", label: "غالي", aboutProduct: true },
  { code: "HAS_STOCK", label: "عنده كمية", aboutProduct: true },
  { code: "CHEAPER_ELSEWHERE", label: "يشتريه أرخص من غيرنا", aboutProduct: true },
  { code: "NOT_INTERESTED", label: "ما يريد هذا النوع", aboutProduct: true },
  { code: "QUALITY", label: "مشكلة بالجودة أو التلف", aboutProduct: true },
  { code: "PACKAGING", label: "الحجم أو التعبئة ما تناسبه", aboutProduct: true },
  // These three are about the VISIT, not any product — hence productId is
  // nullable and the UI can offer them without one selected.
  { code: "OWNER_ABSENT", label: "صاحب المحل مو موجود", aboutProduct: false },
  { code: "SHOP_CLOSED", label: "المحل مغلق", aboutProduct: false },
  { code: "PAST_ISSUE", label: "مشكلة سابقة", aboutProduct: false },
];

const ISSUE_REASON_CODES = new Set(ISSUE_REASONS.map((r) => r.code));

export function issueReasonLabel(code: string) {
  return ISSUE_REASONS.find((r) => r.code === code)?.label ?? code;
}

/**
 * Record a refusal.
 *
 * No WhatsApp, by explicit decision: these arrive all day, none is urgent, and
 * a message per refusal would train the owner to ignore the channel that also
 * carries orders. They pile up in a screen the owner opens when they want to.
 */
export async function createAgentIssue(
  agentId: string,
  input: {
    customerId: string;
    productId?: string;
    reason: string;
    note?: string;
    competitorInfo?: string;
  },
) {
  await assertOwnCustomer(agentId, input.customerId);

  if (!ISSUE_REASON_CODES.has(input.reason)) {
    throw new AppError("سبب غير معروف", 400, "REASON_INVALID");
  }

  if (input.productId) {
    assertUuid(input.productId, "المادة غير صحيحة");
    const product = await prisma.product.findFirst({
      where: { id: input.productId, deletedAt: null },
      select: { id: true },
    });
    if (!product) throw new AppError("منتج غير موجود", 404, "PRODUCT_NOT_FOUND");
  }

  // A double tap on «احفظ» wrote the same refusal twice, three milliseconds
  // apart, and the owner's report counted it twice. Nobody records the same
  // problem for the same customer, product and reason inside ten seconds on
  // purpose, so the second one is the tap, not a second visit.
  const justNow = await prisma.salesAgentIssue.findFirst({
    where: {
      salesAgentId: agentId,
      customerId: input.customerId,
      productId: input.productId ?? null,
      reason: input.reason,
      createdAt: { gte: new Date(Date.now() - 10_000) },
    },
    select: { id: true, createdAt: true },
  });
  if (justNow) return { id: justNow.id, createdAt: justNow.createdAt };

  const issue = await prisma.salesAgentIssue.create({
    data: {
      salesAgentId: agentId,
      customerId: input.customerId,
      productId: input.productId ?? null,
      reason: input.reason,
      note: input.note?.trim() || null,
      competitorInfo: input.competitorInfo?.trim() || null,
    },
    select: { id: true, createdAt: true },
  });

  return { id: issue.id, createdAt: issue.createdAt };
}

/** The rep's own refusals — scoped to them, so no extra ownership check needed. */
export async function listMyIssues(agentId: string, limit = 50) {
  const rows = await prisma.salesAgentIssue.findMany({
    where: { salesAgentId: agentId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
    select: {
      id: true,
      reason: true,
      note: true,
      competitorInfo: true,
      createdAt: true,
      customer: { select: { name: true } },
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
    customerName: r.customer.name,
    productName: r.product?.name ?? null,
  }));
}

/* ── «اطلب سعراً خاصاً» ──────────────────────────────────────────────── */

/**
 * Ask for a one-off price on a product for one customer.
 *
 * The rep cannot discount at all, so this is the only route to a different
 * price, and it goes through the SAME approvals screen as everything else. The
 * catalog price is frozen onto the request so the owner can still see the gap
 * they approved months later, after the shelf price has moved.
 */
function priceRequestExists(status: string) {
  return new AppError(
    status === "PENDING"
      ? "اكو طلب سعر لهذي المادة بانتظار الموافقة"
      : "اكو سعر موافق عليه لهذي المادة، استعمله بالطلب",
    409,
    "PRICE_REQUEST_EXISTS",
  );
}

export async function requestSpecialPrice(
  agentId: string,
  agentName: string,
  input: { customerId: string; productId: string; unit: Unit; requestedPrice: number; reason?: string },
) {
  const customer = await assertOwnCustomer(agentId, input.customerId);
  assertUuid(input.productId, "المادة غير صحيحة");

  const product = await prisma.product.findFirst({
    where: { id: input.productId, deletedAt: null },
    select: { id: true, name: true, salePrice: true, pcsPerCarton: true, boxPieces: true },
  });
  if (!product) throw new AppError("منتج غير موجود", 404, "PRODUCT_NOT_FOUND");

  const requestedPrice = Number(input.requestedPrice);
  if (!Number.isFinite(requestedPrice) || requestedPrice <= 0) {
    throw new AppError("السعر لازم يكون أكبر من صفر", 400, "PRICE_INVALID");
  }

  const currentPrice = salePriceFor(input.unit, product.salePrice, product.pcsPerCarton, product.boxPieces);

  // One live request per customer+product+unit. Without this a rep could queue
  // five requests for the same line and the owner would approve the same
  // negotiation repeatedly without realising.
  const existing = await prisma.salesAgentPriceRequest.findFirst({
    where: {
      customerId: customer.id,
      productId: product.id,
      unit: input.unit,
      status: { in: ["PENDING", "APPROVED"] },
      consumedAt: null,
    },
    select: { id: true, status: true },
  });
  if (existing) throw priceRequestExists(existing.status);

  // The request is written BEFORE the approval, and a partial unique index
  // decides who wins. The read above is only the fast path: two taps that
  // arrived together both passed it, and the owner got two approvals for one
  // negotiation. Writing the request first also means a loser never leaves an
  // approval behind with nothing attached to it.
  let request: { id: string; status: string };
  try {
    request = await prisma.salesAgentPriceRequest.create({
      data: {
        salesAgentId: agentId,
        customerId: customer.id,
        productId: product.id,
        unit: input.unit,
        currentPrice,
        requestedPrice,
        reason: input.reason?.trim() || null,
      },
      select: { id: true, status: true },
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") {
      const live = await prisma.salesAgentPriceRequest.findFirst({
        where: {
          customerId: customer.id,
          productId: product.id,
          unit: input.unit,
          status: { in: ["PENDING", "APPROVED"] },
          consumedAt: null,
        },
        select: { status: true },
      });
      throw priceRequestExists(live?.status ?? "PENDING");
    }
    throw err;
  }

  const approval = await createPendingApproval(
    approvalRequestTypes.AGENT_PRICE_REQUEST,
    {
      source: "SALES_AGENT",
      salesAgentId: agentId,
      salesAgentName: agentName,
      customerId: customer.id,
      customerName: customer.name,
      phone: customer.phone,
      productId: product.id,
      productName: product.name,
      unit: input.unit,
      currentPrice,
      requestedPrice,
      reason: input.reason,
    },
    agentId,
  );

  await prisma.salesAgentPriceRequest.update({
    where: { id: request.id },
    data: { approvalId: approval.id },
  });

  notifySalesAgentEvent("priceRequest", {
    agentName,
    customerName: customer.name,
    customerId: customer.id,
    productName: product.name,
    currentPrice,
    requestedPrice,
    reason: input.reason,
  }).catch((err) => logger.warn(`[SalesAgent] price-request notify failed: ${String(err)}`));

  return { id: request.id, approvalId: approval.id, status: request.status, currentPrice, requestedPrice };
}

/** The rep's price requests and where each one stands. */
export async function listMyPriceRequests(agentId: string, limit = 50) {
  const rows = await prisma.salesAgentPriceRequest.findMany({
    where: { salesAgentId: agentId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
    select: {
      id: true,
      unit: true,
      currentPrice: true,
      requestedPrice: true,
      reason: true,
      status: true,
      consumedAt: true,
      createdAt: true,
      customer: { select: { id: true, name: true } },
      product: { select: { id: true, name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    unit: r.unit,
    currentPrice: toNumber(r.currentPrice),
    requestedPrice: toNumber(r.requestedPrice),
    reason: r.reason,
    status: r.status,
    used: r.consumedAt != null,
    createdAt: r.createdAt,
    customerId: r.customer.id,
    customerName: r.customer.name,
    productId: r.product.id,
    productName: r.product.name,
  }));
}

/**
 * Approved, unspent prices this rep can use for one customer right now.
 *
 * The rep's cart reads this to show "سعر خاص موافق عليه" on the affected line.
 * It is advisory in the UI — `submitAgentOrder` re-resolves the same rows when
 * the order is actually priced, so what the client shows can never become what
 * gets billed.
 */
export async function listUsablePrices(agentId: string, customerId: string) {
  await assertOwnCustomer(agentId, customerId);
  const rows = await prisma.salesAgentPriceRequest.findMany({
    where: {
      salesAgentId: agentId,
      customerId,
      status: "APPROVED",
      consumedAt: null,
      // A price for a product that has since been deleted is unusable: the order
      // would be refused at submit with "منتج غير موجود". Offering it puts a
      // number in front of the rep that they cannot actually sell at.
      product: { deletedAt: null },
    },
    select: { id: true, productId: true, unit: true, requestedPrice: true },
  });
  return rows.map((r) => ({
    id: r.id,
    productId: r.productId,
    unit: r.unit,
    price: toNumber(r.requestedPrice),
  }));
}

/* ── «يومي» — the rep's own day, in three numbers ────────────────────── */

/**
 * What the rep did today.
 *
 * Deliberately three counts and two sums, and NOT a word about commission: the
 * point is a rep who can see their own day going well without any figure the
 * owner keeps private ever appearing on their phone.
 *
 * "Today" is local midnight to now, matching how the shop thinks about a day
 * rather than UTC.
 */
export async function getAgentToday(agentId: string) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  const [orders, receipts, collected, issues, newCustomers] = await Promise.all([
    prisma.pendingApproval.findMany({
      where: {
        requestedBy: agentId,
        requestType: approvalRequestTypes.CATALOG_ORDER,
        createdAt: { gte: start },
      },
      // Status included so a REJECTED order can be excluded from the money
      // figure below. Without it a refused order still counted as a sale, which
      // is the number the owner sees when checking what the rep did today.
      select: { requestData: true, status: true },
    }),
    prisma.paymentVoucher.count({
      where: {
        salesAgentId: agentId,
        type: "RECEIPT",
        cancelledAt: null,
        archivedAt: null,
        date: { gte: start },
      },
    }),
    prisma.paymentVoucher.aggregate({
      where: {
        salesAgentId: agentId,
        type: "RECEIPT",
        cancelledAt: null,
        archivedAt: null,
        date: { gte: start },
      },
      _sum: { amount: true },
    }),
    prisma.salesAgentIssue.count({ where: { salesAgentId: agentId, createdAt: { gte: start } } }),
    // `deletedAt: null` matters: a customer entered by mistake and removed the
    // same day kept counting toward the rep's day, which is the one number on
    // that screen nobody would think to double-check.
    prisma.customer.count({
      where: { salesAgentId: agentId, deletedAt: null, createdAt: { gte: start } },
    }),
  ]);

  // Sales value comes off the approval snapshots, not invoices: an order sent an
  // hour ago may not be approved yet, and the rep's day should count what they
  // SOLD, not what the owner has got round to billing.
  //
  // A REJECTED order is not a sale by anyone's reckoning, so it is excluded — it
  // used to be counted, which left a refused order still showing as money in the
  // rep's day. PENDING still counts: the rep did make the sale, and the owner
  // simply has not reviewed it yet.
  const rejected = orders.filter((a) => a.status === "REJECTED");
  const counted = orders.filter((a) => a.status !== "REJECTED");

  const orderValue = counted.reduce((sum, a) => {
    const d = (a.requestData ?? {}) as { subtotal?: number };
    return sum + Number(d.subtotal ?? 0);
  }, 0);

  // Distinct customers visited: an order, a receipt or a logged refusal all
  // count as a visit, because all three mean the rep stood in that shop.
  const [receiptCustomers, issueCustomers] = await Promise.all([
    prisma.paymentVoucher.findMany({
      where: { salesAgentId: agentId, type: "RECEIPT", date: { gte: start } },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
    prisma.salesAgentIssue.findMany({
      where: { salesAgentId: agentId, createdAt: { gte: start } },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
  ]);

  const visited = new Set<string>();
  for (const a of orders) {
    const d = (a.requestData ?? {}) as { customerId?: string };
    if (d.customerId) visited.add(d.customerId);
  }
  for (const r of receiptCustomers) if (r.customerId) visited.add(r.customerId);
  for (const i of issueCustomers) visited.add(i.customerId);

  return {
    orders: counted.length,
    // Surfaced rather than silently dropped: the rep should see that something
    // they sent came back refused, not just a number that quietly shrank.
    rejectedOrders: rejected.length,
    rejectedValue: rejected.reduce((sum, a) => {
      const d = (a.requestData ?? {}) as { subtotal?: number };
      return sum + Number(d.subtotal ?? 0);
    }, 0),
    orderValue,
    receipts,
    collected: toNumber(collected._sum.amount),
    issues,
    newCustomers,
    customersVisited: visited.size,
  };
}

/* ── «ما اشترى من زمان» — the customers going quiet ──────────────────── */

/**
 * Days since a customer last bought, for the rep's own list.
 *
 * The shop already tracks this for itself; the rep needs it more, because they
 * are the one who can walk back in. Computed from the customer's last ACTIVE
 * sale rather than `lastTransactionAt`, which also moves on a payment — a
 * customer who pays an old debt has not bought anything.
 */
export async function listMyCustomers(
  agentId: string,
  search?: string,
  opts?: { page?: number; limit?: number },
) {
  const term = search?.trim();
  const page = Math.max(1, opts?.page ?? 1);
  const limit = Math.min(Math.max(1, opts?.limit ?? 200), 500);

  const where = {
    deletedAt: null,
    salesAgentId: agentId,
    ...(term
      ? { OR: [{ name: { contains: term, mode: "insensitive" as const } }, { phone: { contains: term } }] }
      : {}),
  };

  const [total, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
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
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  // One grouped query for the whole page, not one per customer.
  const ids = customers.map((c) => c.id);
  const lastSales = ids.length
    ? await prisma.invoice.groupBy({
        by: ["customerId"],
        where: { customerId: { in: ids }, type: "SALE", status: "ACTIVE", archivedAt: null },
        _max: { date: true },
      })
    : [];
  const lastSaleBy = new Map(lastSales.map((r) => [r.customerId, r._max.date]));

  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();

  return {
    total,
    page,
    limit,
    hasMore: page * limit < total,
    customers: customers.map((c) => {
      const last = lastSaleBy.get(c.id) ?? null;
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        address: c.address,
        area: c.area,
        province: c.province,
        currentBalance: toNumber(c.currentBalance),
        lastTransactionAt: c.lastTransactionAt,
        lastSaleAt: last,
        // null = never bought anything, which reads differently from "quiet for
        // 40 days" and the screen says so.
        daysSinceLastSale: last ? Math.floor((now - last.getTime()) / day) : null,
      };
    }),
  };
}
