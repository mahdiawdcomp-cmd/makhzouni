/**
 * «عروض خاصة بالزبون».
 *
 * Reads are open to any authenticated user and scoped: a rep sees only offers
 * for their own customers. Writes need `MANAGE_CUSTOMER_OFFERS` explicitly —
 * ADMIN passes by role, and a rep cannot create or edit an offer unless the
 * owner granted them that permission, which is exactly the requirement.
 */
import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { MANAGE_CUSTOMER_OFFERS, requirePermission } from "../middleware/permission.middleware";
import {
  getCustomerOffersList,
  patchCustomerOfferActive,
  postCustomerOffer,
  putCustomerOffer,
} from "../controllers/customer-offers.controller";

const router = Router();

router.use(authMiddleware);

router.get("/", getCustomerOffersList);
router.post("/", requirePermission(MANAGE_CUSTOMER_OFFERS), postCustomerOffer);
router.put("/:id", requirePermission(MANAGE_CUSTOMER_OFFERS), putCustomerOffer);
router.patch("/:id/active", requirePermission(MANAGE_CUSTOMER_OFFERS), patchCustomerOfferActive);

export default router;
