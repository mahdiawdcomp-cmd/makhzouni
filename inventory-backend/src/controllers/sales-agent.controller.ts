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
  claimCustomer,
  createAgentCustomer,
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
