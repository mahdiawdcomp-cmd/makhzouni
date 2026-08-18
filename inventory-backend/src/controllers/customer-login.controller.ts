import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import {
  customerLogin,
  prepareCustomerCode,
  prepareVisitorCode,
  listStorefrontAccounts,
  setCustomerPricesHidden,
  submitVisitorDetails,
  unlockAccount,
  getAccountForCatalogToken,
} from "../services/customer-login.service";
import { sendStorefrontCredentials, sendStorefrontCredentialsBulk } from "../services/storefront-credentials.service";

/* ── Public ──────────────────────────────────────────────────────── */

export const customerLoginCtrl = asyncHandler(async (req, res) => {
  const { phone, code } = req.body as { phone: string; code: string };
  const result = await customerLogin(phone, code);
  res.json({ success: true, data: result });
});

export const submitVisitorDetailsCtrl = asyncHandler(async (req, res) => {
  const { phone, customerName, address, notes } = req.body as {
    phone: string; customerName: string; address?: string; notes?: string;
  };
  const result = await submitVisitorDetails(phone, { customerName, address, notes });
  res.status(201).json({
    success: true,
    message: "تم إرسال بياناتك — بانتظار موافقة الإدارة",
    data: result,
  });
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
