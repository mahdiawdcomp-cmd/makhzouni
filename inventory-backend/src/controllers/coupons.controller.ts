import { createCoupon, listCoupons, previewCoupon, updateCoupon } from "../services/coupon.service";
import { AppError } from "../utils/app-error";
import { asyncHandler } from "../utils/async-handler";

function requireUser(user: Express.User | undefined) {
  if (!user) throw new AppError("Authentication is required", 401, "AUTH_REQUIRED");
  return user;
}

export const getCoupons = asyncHandler(async (_req, res) => {
  const data = await listCoupons();
  res.json({ success: true, data });
});

export const addCoupon = asyncHandler(async (req, res) => {
  const user = requireUser(req.user);
  const data = await createCoupon(req.body, user.id);
  res.status(201).json({ success: true, data });
});

export const editCoupon = asyncHandler(async (req, res) => {
  const data = await updateCoupon(String(req.params.id), req.body);
  res.json({ success: true, data });
});

export const applyCoupon = asyncHandler(async (req, res) => {
  const data = await previewCoupon(String(req.body.code), Number(req.body.subtotal));
  res.json({ success: true, data });
});
