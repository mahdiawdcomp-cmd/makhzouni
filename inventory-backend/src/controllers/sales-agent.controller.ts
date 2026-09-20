/**
 * «المندوب» — HTTP surface for the rep.
 *
 * Every handler derives the rep's identity from the authenticated token, never
 * from the request body. An `agentId` sent by the client would be the whole
 * access model handed to whoever wants to type a different uuid.
 */
import { Unit } from "@prisma/client";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import {
  ISSUE_REASONS,
  claimCustomer,
  createAgentCustomer,
  createAgentIssue,
  getAgentToday,
  listMyIssues,
  listMyPriceRequests,
  listUsablePrices,
  requestSpecialPrice,
  createAgentReceipt,
  getAgentCashOnHand,
  getAgentCustomerDetail,
  listMyHandovers,
  listMyReceipts,
  getAgentProductImage,
  getAgentProductThumbnails,
  getCustomerHeader,
  listAgentCatalogProducts,
  listMyCustomers,
  listMyOrders,
  listSalesAgentAreas,
  lookupPhone,
  submitAgentOrder,
} from "../services/sales-agent.service";
import {
  followUpReasonsFor,
  frequentProductsForCustomer,
  priceNotesForCustomer,
} from "../services/sales-agent-insights.service";
import {
  PLAN_STATUSES,
  VISIT_OUTCOMES,
  addToVisitPlan,
  endVisit,
  listTodayVisits,
  listVisitCustomers,
  listVisitPlan,
  setCustomerLocation,
  startVisit,
  updateVisitPlanEntry,
} from "../services/sales-agent-visits.service";
import { listCustomerOffers } from "../services/sales-agent-offers.service";

function requireAgent(reqUser: Express.User | undefined) {
  if (!reqUser) throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  return { id: reqUser.id, name: reqUser.name ?? "المندوب" };
}

export const getAgentAreas = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await listSalesAgentAreas() });
});

/* ── customers ───────────────────────────────────────────────────────── */

export const getMyCustomers = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const page = Number(req.query.page);
  const limit = Number(req.query.limit);
  const result = await listMyCustomers(agent.id, search, {
    page: Number.isFinite(page) ? page : undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
    followUp: ["quiet", "balance", "never"].includes(String(req.query.followUp))
      ? req.query.followUp as "quiet" | "balance" | "never" : undefined,
    // «يحتاجون متابعة» — applied in the database before pagination, so `total`
    // and `hasMore` describe the filtered list and nothing is hidden on a page
    // the screen never fetched.
    needsFollowUp: String(req.query.needsFollowUp) === "true",
    area: typeof req.query.area === "string" && req.query.area.trim() ? req.query.area.trim() : undefined,
  });

  // «يحتاجون متابعة» — WHY each customer needs a call, not just a list of
  // names. Computed for this page only, with a fixed number of extra reads
  // regardless of page size, and only when the screen asks for it.
  if (String(req.query.withReasons) === "true") {
    const reasons = await followUpReasonsFor({
      agentId: agent.id,
      customers: result.customers.map((c) => ({
        id: c.id,
        currentBalance: c.currentBalance,
        lastSaleAt: c.lastSaleAt,
        daysSinceLastSale: c.daysSinceLastSale,
      })),
      quietDays: result.quietDays,
    });
    res.json({
      success: true,
      data: {
        ...result,
        customers: result.customers.map((c) => ({ ...c, followUpReasons: reasons.get(c.id) ?? [] })),
      },
    });
    return;
  }

  res.json({ success: true, data: result });
});

/** «يشتريها عادةً» — read-only, from real invoices, priced by the server. */
export const getFrequentProducts = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  const limit = Number(req.query.limit);
  res.json({
    success: true,
    data: await frequentProductsForCustomer(agent.id, String(req.params.id), {
      priceMode: req.query.priceMode,
      limit: Number.isFinite(limit) ? limit : undefined,
    }),
  });
});

/**
 * Today's price and the change against what this customer last paid, for the
 * lines already in the cart. Information only — it never blocks a sale.
 */
export const postPriceNotes = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  const body = (req.body ?? {}) as { priceMode?: unknown; lines?: unknown };
  const lines = Array.isArray(body.lines)
    ? body.lines.map((line) => {
        const row = (line ?? {}) as { productId?: unknown; unit?: unknown };
        return { productId: String(row.productId ?? ""), unit: row.unit as Unit };
      })
    : [];
  res.json({
    success: true,
    data: await priceNotesForCustomer(agent.id, String(req.params.id), { priceMode: body.priceMode, lines }),
  });
});

/* ── visits ──────────────────────────────────────────────────────────── */

export const getVisitCustomers = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  const page = Number(req.query.page);
  const limit = Number(req.query.limit);
  res.json({
    success: true,
    data: await listVisitCustomers(agent.id, {
      area: typeof req.query.area === "string" && req.query.area.trim() ? req.query.area.trim() : undefined,
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      // The rep's position, used to sort this one response and never stored.
      fromLat: req.query.lat,
      fromLng: req.query.lng,
      withCoordinatesOnly: String(req.query.withCoordinatesOnly) === "true",
      page: Number.isFinite(page) ? page : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    }),
  });
});

export const getTodayVisits = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  res.json({ success: true, data: await listTodayVisits(agent.id, date) });
});

export const getVisitOutcomes = asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    data: Object.entries(VISIT_OUTCOMES).map(([code, label]) => ({ code, label })),
  });
});

export const postStartVisit = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  const body = (req.body ?? {}) as { customerId?: unknown; clientRequestId?: unknown; planId?: unknown };
  const customerId = String(body.customerId ?? "");
  if (!customerId) throw new AppError("الزبون مطلوب", 400, "CUSTOMER_REQUIRED");
  const visit = await startVisit(agent.id, {
    customerId,
    clientRequestId: body.clientRequestId == null ? undefined : String(body.clientRequestId),
    // Optional: starting from today's plan links the visit to that entry.
    planId: body.planId == null ? undefined : String(body.planId),
  });
  res.status(visit.duplicate ? 200 : 201).json({ success: true, data: visit });
});

export const postEndVisit = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  const body = (req.body ?? {}) as { outcome?: unknown; note?: unknown };
  res.json({
    success: true,
    data: await endVisit(agent.id, String(req.params.id), {
      outcome: body.outcome,
      note: body.note == null ? undefined : String(body.note),
    }),
  });
});

/** Pin the CUSTOMER's shop. The only location this feature ever writes. */
export const putCustomerLocation = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  const body = (req.body ?? {}) as { latitude?: unknown; longitude?: unknown };
  res.json({
    success: true,
    // The rep is scoped to their own customers; the change is written to the
    // audit log with the previous and the new point.
    data: await setCustomerLocation(agent, agent.id, String(req.params.id), {
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
    }),
  });
});

/* ── «خطة زيارات اليوم» ──────────────────────────────────────────────── */

export const getMyVisitPlan = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  res.json({ success: true, data: await listVisitPlan(agent.id, date) });
});

export const getPlanStatuses = asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    data: Object.entries(PLAN_STATUSES).map(([code, label]) => ({ code, label })),
  });
});

/** A rep adding one of THEIR OWN customers to their own plan. */
export const postMyVisitPlanEntry = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const customerId = String(body.customerId ?? "");
  if (!customerId) throw new AppError("الزبون مطلوب", 400, "CUSTOMER_REQUIRED");
  const created = await addToVisitPlan({ id: agent.id }, agent.id, {
    customerId,
    planDate: body.planDate == null ? undefined : String(body.planDate),
    note: body.note == null ? undefined : String(body.note),
    sortOrder: body.sortOrder == null ? undefined : Number(body.sortOrder),
  });
  res.status(201).json({ success: true, message: "انضاف للخطة", data: created });
});

export const patchMyVisitPlanEntry = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  const body = (req.body ?? {}) as Record<string, unknown>;
  res.json({
    success: true,
    data: await updateVisitPlanEntry(agent.id, String(req.params.id), {
      status: body.status,
      note: body.note == null ? undefined : String(body.note),
      sortOrder: body.sortOrder == null ? undefined : Number(body.sortOrder),
    }),
  });
});

/** The rep's read-only view of their own customer's standing offers. */
export const getCustomerOffers = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  res.json({
    success: true,
    data: await listCustomerOffers({
      agentScope: agent.id,
      customerId: String(req.params.id),
      liveOnly: String(req.query.liveOnly ?? "true") === "true",
    }),
  });
});

/** «يومي» — three numbers the rep can read without any figure the owner keeps private. */
export const getToday = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  res.json({ success: true, data: await getAgentToday(agent.id) });
});

export const getCustomerHeaderCtrl = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  res.json({ success: true, data: await getCustomerHeader(agent.id, String(req.params.id)) });
});

export const postPhoneLookup = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  const phone = String((req.body as { phone?: string })?.phone ?? "");
  res.json({ success: true, data: await lookupPhone(agent.id, phone) });
});

export const postClaimCustomer = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  const customerId = String((req.body as { customerId?: string })?.customerId ?? "");
  if (!customerId) throw new AppError("الزبون مطلوب", 400, "CUSTOMER_REQUIRED");
  res.json({ success: true, data: await claimCustomer(agent.id, agent.name, customerId) });
});

export const postAgentCustomer = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  const body = (req.body ?? {}) as { name?: string; phone?: string; address?: string; area?: string };
  const created = await createAgentCustomer(agent.id, agent.name, {
    name: String(body.name ?? ""),
    phone: String(body.phone ?? ""),
    address: body.address,
    area: body.area,
  });
  res.status(201).json({ success: true, message: "تم إنشاء الزبون", data: created });
});

/* ── catalog ─────────────────────────────────────────────────────────── */

export const getAgentProducts = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await listAgentCatalogProducts() });
});

export const postAgentThumbnails = asyncHandler(async (req, res) => {
  const ids = (req.body as { ids?: unknown })?.ids;
  const list = Array.isArray(ids) ? ids.map((i) => String(i)) : [];
  res.json({ success: true, data: await getAgentProductThumbnails(list) });
});

export const getAgentImage = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { imageUrl: await getAgentProductImage(String(req.params.id)) } });
});

/* ── orders ──────────────────────────────────────────────────────────── */

const UNITS = new Set<string>([Unit.PIECE, Unit.CARTON, Unit.BOX, Unit.DOZEN]);

function agentOrderHandler(preview: boolean) { return asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  const body = (req.body ?? {}) as {
    customerId?: string;
    notes?: string;
    clientRequestId?: string;
    priceMode?: "WHOLESALE" | "CARTON";
    reviewToken?: string;
    items?: Array<{ productId?: string; unit?: string; quantity?: number }>;
  };

  if (!body.customerId) throw new AppError("لازم تختار الزبون أولاً", 400, "CUSTOMER_REQUIRED");
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) throw new AppError("الطلب فارغ", 400, "ORDER_EMPTY");

  const items = rawItems.map((item) => {
    const unit = String(item.unit ?? "");
    if (!UNITS.has(unit)) throw new AppError("وحدة غير معروفة", 400, "UNIT_INVALID");
    const quantity = Number(item.quantity);
    // Whole units only — the service enforces this too, but rejecting it here
    // keeps a fractional quantity from ever reaching the pricing maths.
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new AppError("الكمية لازم تكون رقم صحيح أكبر من صفر", 400, "QUANTITY_INVALID");
    }
    if (!item.productId) throw new AppError("منتج غير صحيح", 400, "PRODUCT_REQUIRED");
    return { productId: String(item.productId), unit: unit as Unit, quantity };
  });

  const result = await submitAgentOrder(agent.id, agent.name, {
    customerId: String(body.customerId),
    notes: body.notes,
    clientRequestId: body.clientRequestId,
    priceMode: body.priceMode,
    reviewToken: body.reviewToken,
    items,
  }, preview);

  res.status(preview ? 200 : 201).json({ success: true, message: preview ? "مراجعة الطلب بدون إرسال" : "انرسل الطلب للموافقة", data: result });
}); }

export const postAgentOrder = agentOrderHandler(false);
export const previewAgentOrder = agentOrderHandler(true);

export const getMyOrders = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  res.json({ success: true, data: await listMyOrders(agent.id) });
});

/* ── money ───────────────────────────────────────────────────────────── */

export const getCashOnHand = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  res.json({ success: true, data: await getAgentCashOnHand(agent.id) });
});

export const postAgentReceipt = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  const body = (req.body ?? {}) as {
    customerId?: string;
    amount?: number;
    notes?: string;
    clientRequestId?: string;
  };
  if (!body.customerId) throw new AppError("الزبون مطلوب", 400, "CUSTOMER_REQUIRED");

  const voucher = await createAgentReceipt(agent.id, agent.name, {
    customerId: String(body.customerId),
    amount: Number(body.amount),
    notes: body.notes,
    // Carried straight through to the voucher service, which already treats it
    // as an idempotency key — a double-tap on a bad connection returns the
    // voucher that was created rather than creating a second one.
    clientRequestId: body.clientRequestId,
  });

  res.status(201).json({ success: true, message: "انحفظ السند", data: voucher });
});

export const getMyReceipts = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  const limit = Number(req.query.limit);
  const offset = Number(req.query.offset);
  res.json({
    success: true,
    data: await listMyReceipts(agent.id, Number.isFinite(limit) ? limit : undefined, Number.isFinite(offset) ? offset : undefined),
  });
});

export const getMyHandovers = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  res.json({ success: true, data: await listMyHandovers(agent.id) });
});

/** The full account of one of the rep's customers — the same statement the owner reads. */
export const getCustomerDetailCtrl = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  res.json({ success: true, data: await getAgentCustomerDetail(agent.id, String(req.params.id)) });
});

/* ── «أكو مشكلة» ─────────────────────────────────────────────────────── */

export const getIssueReasons = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: ISSUE_REASONS });
});

export const postAgentIssue = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  const body = (req.body ?? {}) as {
    customerId?: string;
    productId?: string;
    reason?: string;
    note?: string;
    competitorInfo?: string;
  };
  if (!body.customerId) throw new AppError("الزبون مطلوب", 400, "CUSTOMER_REQUIRED");
  if (!body.reason) throw new AppError("السبب مطلوب", 400, "REASON_REQUIRED");

  const issue = await createAgentIssue(agent.id, {
    customerId: String(body.customerId),
    productId: body.productId ? String(body.productId) : undefined,
    reason: String(body.reason),
    note: body.note,
    competitorInfo: body.competitorInfo,
  });

  res.status(201).json({ success: true, message: "انسجلت المشكلة", data: issue });
});

export const getMyIssues = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  res.json({ success: true, data: await listMyIssues(agent.id) });
});

/* ── «اطلب سعراً خاصاً» ──────────────────────────────────────────────── */

export const postPriceRequest = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  const body = (req.body ?? {}) as {
    customerId?: string;
    productId?: string;
    unit?: string;
    requestedPrice?: number;
    reason?: string;
  };
  if (!body.customerId) throw new AppError("الزبون مطلوب", 400, "CUSTOMER_REQUIRED");
  if (!body.productId) throw new AppError("المادة مطلوبة", 400, "PRODUCT_REQUIRED");
  const unit = String(body.unit ?? "");
  if (!UNITS.has(unit)) throw new AppError("وحدة غير معروفة", 400, "UNIT_INVALID");

  const result = await requestSpecialPrice(agent.id, agent.name, {
    customerId: String(body.customerId),
    productId: String(body.productId),
    unit: unit as Unit,
    requestedPrice: Number(body.requestedPrice),
    reason: body.reason,
  });

  res.status(201).json({ success: true, message: "انرسل طلب السعر", data: result });
});

export const getMyPriceRequests = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  res.json({ success: true, data: await listMyPriceRequests(agent.id) });
});

/** Approved, unspent prices the rep can use for one customer right now. */
export const getUsablePrices = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  res.json({ success: true, data: await listUsablePrices(agent.id, String(req.params.id)) });
});
