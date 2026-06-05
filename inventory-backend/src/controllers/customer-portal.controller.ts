import { asyncHandler } from "../utils/async-handler";
import {
  createCustomerPortalLink,
  getCustomerPortalByToken,
  revokeCustomerPortalLinks,
} from "../services/customer-portal.service";

export const createPortalLink = asyncHandler(async (req, res) => {
  const result = await createCustomerPortalLink(
    String(req.params.id),
    Number(req.body?.expiresInDays ?? 30)
  );

  res.status(201).json({
    success: true,
    data: result,
  });
});

export const revokePortalLinks = asyncHandler(async (req, res) => {
  await revokeCustomerPortalLinks(String(req.params.id));
  res.json({ success: true });
});

export const getClientPortal = asyncHandler(async (req, res) => {
  const data = await getCustomerPortalByToken(String(req.params.token));
  res.json({ success: true, data });
});
