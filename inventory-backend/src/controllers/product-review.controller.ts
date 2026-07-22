import { asyncHandler } from "../utils/async-handler";
import { listProductReviews } from "../services/product-review.service";

export const getProductReviews = asyncHandler(async (req, res) => {
  const data = await listProductReviews(
    req.validatedQuery as Parameters<typeof listProductReviews>[0]
  );
  res.json({ success: true, ...data });
});
