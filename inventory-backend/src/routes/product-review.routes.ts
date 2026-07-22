import { Router } from "express";
import { getProductReviews } from "../controllers/product-review.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import { listProductReviewsSchema } from "../utils/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/", validate(listProductReviewsSchema), getProductReviews);

export default router;
