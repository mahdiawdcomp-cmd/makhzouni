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
  getAgentProducts,
  getCashOnHand,
  getCustomerDetailCtrl,
  getIssueReasons,
  getMyIssues,
  getMyPriceRequests,
  getUsablePrices,
  getCustomerHeaderCtrl,
  getMyCustomers,
  getMyHandovers,
  getMyReceipts,
  getMyOrders,
  postAgentCustomer,
  postAgentIssue,
  postAgentOrder,
  postAgentReceipt,
  postPriceRequest,
  postAgentThumbnails,
  postClaimCustomer,
  postPhoneLookup,
} from "../controllers/sales-agent.controller";

const router = Router();

router.use(authMiddleware, requireSalesAgent());

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

router.get("/issue-reasons", getIssueReasons);
router.post("/issues", postAgentIssue);
router.get("/issues", getMyIssues);

router.post("/price-requests", postPriceRequest);
router.get("/price-requests", getMyPriceRequests);
router.get("/customers/:id/usable-prices", getUsablePrices);

export default router;
