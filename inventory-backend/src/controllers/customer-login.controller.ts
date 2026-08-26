import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import {
  customerLogin,
  prepareCustomerCode,
  prepareVisitorCode,
  listStorefrontAccounts,
  setCustomerPricesHidden,
  unlockAccount,
  getAccountForCatalogToken,
} from "../services/customer-login.service";
import {
  sendStorefrontCredentials,
  revealStorefrontCredentials,
  sendStorefrontCredentialsBulk,
  sendCredentialsToGroup,
  countCredentialTargets,
  type TargetGroup,
} from "../services/storefront-credentials.service";
import { sendInvitesToGroup } from "../services/storefront-invite.service";
import {
  listPublicIncomingItems,
  reserveIncomingItem,
  listMyReservations,
  listIncomingItems,
  createIncomingItem,
  updateIncomingItem,
  deleteIncomingItem,
  listItemReservations,
  setReservationStatus,
} from "../services/catalog-incoming.service";
import {
  saveVisitorDetails,
  resolveVisitorSession,
  requestPriceAccess,
  grantPriceAccess,
  revokePriceAccess,
  promoteVisitorToCustomer,
  listStorefrontAccountsUnified,
} from "../services/catalog-visitor.service";

/* ── Public ──────────────────────────────────────────────────────── */

export const customerLoginCtrl = asyncHandler(async (req, res) => {
  const { phone, code } = req.body as { phone: string; code: string };
  const result = await customerLogin(phone, code);
  res.json({ success: true, data: result });
});

// Details are saved straight onto the visitor, no approval queue: the shop
// approves prices now, not people, so there is nothing here to wait on.
export const submitVisitorDetailsCtrl = asyncHandler(async (req, res) => {
  const { token, customerName, address, notes, province, businessType } = req.body as {
    token: string; customerName: string; address?: string; notes?: string;
    province?: string; businessType?: string;
  };
  const result = await saveVisitorDetails(token, {
    name: customerName, address, notes, province, businessType,
  });
  res.status(201).json({ success: true, message: "تم حفظ بياناتك", data: result });
});

export const visitorSessionCtrl = asyncHandler(async (req, res) => {
  const session = await resolveVisitorSession(String(req.query.token ?? ""));
  if (!session) throw new AppError("سجّل الدخول أولاً", 401, "VISITOR_SESSION_INVALID");
  res.json({ success: true, data: session });
});

export const requestPriceAccessCtrl = asyncHandler(async (req, res) => {
  const data = await requestPriceAccess(String((req.body as { token: string }).token));
  res.json({ success: true, data });
});

/* ── «احجز البضاعة القادمة الجديدة» ───────────────────────────────── */

export const publicIncomingItemsCtrl = asyncHandler(async (req, res) => {
  const [items, mine] = await Promise.all([
    listPublicIncomingItems(),
    listMyReservations(String(req.query.phone ?? "")),
  ]);
  res.json({ success: true, data: { items, mine } });
});

export const reserveIncomingCtrl = asyncHandler(async (req, res) => {
  const data = await reserveIncomingItem(req.body);
  res.status(201).json({ success: true, data });
});

export const adminIncomingItemsCtrl = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await listIncomingItems() });
});

export const createIncomingItemCtrl = asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await createIncomingItem(req.body) });
});

export const updateIncomingItemCtrl = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await updateIncomingItem(String(req.params.id), req.body) });
});

export const deleteIncomingItemCtrl = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await deleteIncomingItem(String(req.params.id)) });
});

export const itemReservationsCtrl = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await listItemReservations(String(req.params.id)) });
});

export const reservationStatusCtrl = asyncHandler(async (req, res) => {
  const { status } = req.body as { status: "PENDING" | "CONFIRMED" | "CANCELLED" };
  res.json({ success: true, data: await setReservationStatus(String(req.params.id), status) });
});

/* ── Admin side of the storefront accounts screen ─────────────────── */

export const unifiedAccountsCtrl = asyncHandler(async (req, res) => {
  const data = await listStorefrontAccountsUnified(
    typeof req.query.search === "string" ? req.query.search : undefined,
  );
  res.json({ success: true, data });
});

export const grantPricesCtrl = asyncHandler(async (req, res) => {
  const data = await grantPriceAccess(String((req.body as { phone: string }).phone));
  res.json({ success: true, data });
});

export const revokePricesCtrl = asyncHandler(async (req, res) => {
  const data = await revokePriceAccess(String((req.body as { phone: string }).phone));
  res.json({ success: true, data });
});

export const promoteVisitorCtrl = asyncHandler(async (req, res) => {
  const data = await promoteVisitorToCustomer(String((req.body as { phone: string }).phone));
  res.json({ success: true, data });
});

export const customerAccountCtrl = asyncHandler(async (req, res) => {
  const token = String(req.query.access ?? "");
  if (!token) throw new AppError("سجّل الدخول أولاً", 401, "LOGIN_REQUIRED");
  const data = await getAccountForCatalogToken(token);
  res.json({ success: true, data });
});

/* ── Admin ───────────────────────────────────────────────────────── */

export const listAccountsCtrl = asyncHandler(async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const data = await listStorefrontAccounts(search);
  res.json({ success: true, data });
});

/**
 * Issue a fresh code and send it. The plaintext is deliberately NOT returned
 * to the browser: it goes straight out over WhatsApp, so it never sits in a
 * response body, a log, or the admin's screen history.
 */
export const sendCredentialsCtrl = asyncHandler(async (req, res) => {
  const { kind, id, phone, channel } = req.body as {
    kind: "CUSTOMER" | "VISITOR"; id?: string; phone?: string; channel?: string;
  };
  const issued = kind === "CUSTOMER"
    ? await prepareCustomerCode(String(id))
    : await prepareVisitorCode(String(phone));

  const result = await sendStorefrontCredentials(issued, channel);
  res.json({ success: true, message: "تم إرسال بيانات الدخول", data: result });
});

export const sendCredentialsBulkCtrl = asyncHandler(async (req, res) => {
  const { targets, channel } = req.body as {
    targets?: Array<{ kind: "CUSTOMER" | "VISITOR"; id?: string; phone?: string }>;
    channel?: string;
  };
  if (!targets?.length) throw new AppError("لا يوجد مستلمون", 400, "NO_TARGETS");
  const data = await sendStorefrontCredentialsBulk(targets, channel);
  res.json({ success: true, data });
});

/** Send to EVERY recipient in the group — resolved on the server, so a paged
 *  admin list can never cause part of the customer base to be skipped. */
export const sendCredentialsToAllCtrl = asyncHandler(async (req, res) => {
  const { group, channel } = req.body as { group?: TargetGroup; channel?: string };
  const data = await sendCredentialsToGroup(group ?? "all", channel);
  res.json({ success: true, data });
});

// «دعوة الحساب» — the cold half of the flow. Sends the invite template; the
// credentials follow only when the shopper replies (see storefront-invite).
export const sendInvitesToAllCtrl = asyncHandler(async (req, res) => {
  const { group, channel } = req.body as { group?: TargetGroup; channel?: string };
  const data = await sendInvitesToGroup(group ?? "all", channel);
  res.json({ success: true, data });
});

// «أظهر الرمز» — the admin takes the credentials and passes them on from
// their own WhatsApp instead of the shop number. Mints a fresh code, since a
// stored one is a hash nobody can read back.
export const revealCredentialsCtrl = asyncHandler(async (req, res) => {
  const { kind, id, phone } = req.body as { kind: "CUSTOMER" | "VISITOR"; id?: string; phone?: string };
  const data = await revealStorefrontCredentials({ kind, id, phone });
  res.json({ success: true, data });
});

export const credentialTargetCountsCtrl = asyncHandler(async (_req, res) => {
  const data = await countCredentialTargets();
  res.json({ success: true, data });
});

export const applyPricesDefaultCtrl = asyncHandler(async (_req, res) => {
  const { applyPricesDefaultToAllLinks } = await import("../services/customer-login.service");
  const data = await applyPricesDefaultToAllLinks();
  res.json({ success: true, data });
});

export const setPricesHiddenCtrl = asyncHandler(async (req, res) => {
  const { hidden } = req.body as { hidden: boolean };
  const data = await setCustomerPricesHidden(String(req.params.id), Boolean(hidden));
  res.json({ success: true, data });
});

export const unlockAccountCtrl = asyncHandler(async (req, res) => {
  const { kind, idOrPhone } = req.body as { kind: "CUSTOMER" | "VISITOR"; idOrPhone: string };
  const data = await unlockAccount(kind, idOrPhone);
  res.json({ success: true, data });
});
