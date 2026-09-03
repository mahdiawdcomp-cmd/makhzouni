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

function requireAgent(reqUser: Express.User | undefined) {
  if (!reqUser) throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  return { id: reqUser.id, name: reqUser.name ?? "المندوب" };
}

/** Whether the signed-in user should see the rep layer at all. */
export const getAgentMe = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  const areas = await listSalesAgentAreas();
  res.json({ success: true, data: { id: agent.id, name: agent.name, areas } });
});

export const getAgentAreas = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await listSalesAgentAreas() });
});

/* ── customers ───────────────────────────────────────────────────────── */

export const getMyCustomers = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  res.json({ success: true, data: await listMyCustomers(agent.id, search) });
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

export const postAgentOrder = asyncHandler(async (req, res) => {
  const agent = requireAgent(req.user);
  const body = (req.body ?? {}) as {
    customerId?: string;
    notes?: string;
    items?: Array<{ productId?: string; unit?: string; quantity?: number }>;
  };

  if (!body.customerId) throw new AppError("لازم تختار الزبون أولاً", 400, "CUSTOMER_REQUIRED");
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) throw new AppError("الطلب فارغ", 400, "ORDER_EMPTY");

  const items = rawItems.map((item) => {
    const unit = String(item.unit ?? "");
    if (!UNITS.has(unit)) throw new AppError("وحدة غير معروفة", 400, "UNIT_INVALID");
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new AppError("الكمية غير صحيحة", 400, "QUANTITY_INVALID");
    }
    if (!item.productId) throw new AppError("منتج غير صحيح", 400, "PRODUCT_REQUIRED");
    return { productId: String(item.productId), unit: unit as Unit, quantity };
  });

  const result = await submitAgentOrder(agent.id, agent.name, {
    customerId: String(body.customerId),
    notes: body.notes,
    items,
  });

  res.status(201).json({ success: true, message: "انرسل الطلب للموافقة", data: result });
});

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
  res.json({ success: true, data: await listMyReceipts(agent.id) });
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
