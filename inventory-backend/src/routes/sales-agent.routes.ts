/**
 * «المندوب» routes.
 *
 * NOTE: unrelated to `agent.routes.ts`, which is the AI chat assistant. Same
 * English word, entirely different feature — hence the explicit `sales-` prefix
 * on every file in this feature.
 *
 * `requireSalesAgent()` guards the whole router rather than each handler: a new
 * endpoint added below is protected by default, which is the safe direction for
 * a surface whose entire purpose is to confine what one user can reach.
 */
import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { requireSalesAgent } from "../middleware/permission.middleware";
import {
  getAgentAreas,
  getAgentImage,
  getAgentMe,
  getAgentProducts,
  getCashOnHand,
  getCustomerDetailCtrl,
  getCustomerHeaderCtrl,
  getMyCustomers,
  getMyHandovers,
  getMyReceipts,
  getMyOrders,
  postAgentCustomer,
  postAgentOrder,
  postAgentReceipt,
  postAgentThumbnails,
  postClaimCustomer,
  postPhoneLookup,
} from "../controllers/sales-agent.controller";

const router = Router();

router.use(authMiddleware, requireSalesAgent());

router.get("/me", getAgentMe);
router.get("/areas", getAgentAreas);

router.get("/customers", getMyCustomers);
router.get("/customers/:id/header", getCustomerHeaderCtrl);
router.get("/customers/:id/detail", getCustomerDetailCtrl);
router.post("/customers/lookup", postPhoneLookup);
router.post("/customers/claim", postClaimCustomer);
router.post("/customers", postAgentCustomer);

router.get("/products", getAgentProducts);
router.post("/products/thumbnails", postAgentThumbnails);
router.get("/products/:id/image", getAgentImage);

router.post("/orders", postAgentOrder);
router.get("/orders", getMyOrders);

router.get("/cash-on-hand", getCashOnHand);
router.post("/receipts", postAgentReceipt);
router.get("/receipts", getMyReceipts);
router.get("/handovers", getMyHandovers);

export default router;
