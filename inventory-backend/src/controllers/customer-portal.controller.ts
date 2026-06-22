import { asyncHandler } from "../utils/async-handler";
import {
  createCustomerPortalLink,
  getCustomerPortalByToken,
  getPublicInvoiceByToken,
  revokeCustomerPortalLinks,
  getPortalOrders,
  subscribeToArrival,
  getMyArrivalSubscriptions,
  cancelArrivalSubscription,
} from "../services/customer-portal.service";
import { getVapidPublicKey } from "../utils/push-notify";

export const createPortalLink = asyncHandler(async (req, res) => {
  const result = await createCustomerPortalLink(
    String(req.params.id),
    Number(req.body?.expiresInDays ?? 30)
  );
  res.status(201).json({ success: true, data: result });
});

export const revokePortalLinks = asyncHandler(async (req, res) => {
  await revokeCustomerPortalLinks(String(req.params.id));
  res.json({ success: true });
});

export const getClientPortal = asyncHandler(async (req, res) => {
  const data = await getCustomerPortalByToken(String(req.params.token));
  res.json({ success: true, data });
});

export const getClientPortalInvoice = asyncHandler(async (req, res) => {
  const data = await getPublicInvoiceByToken(String(req.params.token), String(req.params.invoiceId));
  res.json({ success: true, data });
});

export const getClientPortalOrders = asyncHandler(async (req, res) => {
  const data = await getPortalOrders(String(req.params.token));
  res.json({ success: true, data });
});

export const postArrivalSubscribe = asyncHandler(async (req, res) => {
  const { productId, productName, pushSubscription } = req.body;
  const data = await subscribeToArrival(
    String(req.params.token),
    productId ?? null,
    String(productName),
    pushSubscription ?? null
  );
  res.status(201).json({ success: true, data });
});

export const getArrivalSubscriptions = asyncHandler(async (req, res) => {
  const data = await getMyArrivalSubscriptions(String(req.params.token));
  res.json({ success: true, data });
});

export const deleteArrivalSubscription = asyncHandler(async (req, res) => {
  await cancelArrivalSubscription(String(req.params.token), String(req.params.subId));
  res.json({ success: true });
});

export const getVapidKey = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { publicKey: getVapidPublicKey() } });
});
