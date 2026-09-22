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
import { requireAgentCapability, requireSalesAgent } from "../middleware/permission.middleware";
import {
  getAgentAreas,
  postAreaProposal,
  getAgentImage,
  getAgentProducts,
  getCashOnHand,
  getCustomerDetailCtrl,
  getAgentInvoiceCtrl,
  putAgentInvoiceCtrl,
  postAgentInvoiceCancelCtrl,
  getAgentReceiptCtrl,
  postReceiptEditRequestCtrl,
  postReceiptCancelRequestCtrl,
  postReceiptSendWhatsappCtrl,
  getCustomerOffers,
  getFrequentProducts,
  getIssueReasons,
  getMyVisitPlan,
  getPlanStatuses,
  getTodayVisits,
  getVisitCustomers,
  getVisitOutcomes,
  patchMyVisitPlanEntry,
  postMyVisitPlanEntry,
  postEndVisit,
  postPriceNotes,
  postStartVisit,
  putCustomerLocation,
  getMyIssues,
  getMyPriceRequests,
  getUsablePrices,
  getCustomerHeaderCtrl,
  getMyCustomers,
  getMyHandovers,
  getMyReceipts,
  getToday,
  getMyOrders,
  postAgentCustomer,
  postAgentIssue,
  postAgentOrder,
  previewAgentOrder,
  postAgentReceipt,
  postPriceRequest,
  postAgentThumbnails,
  postClaimCustomer,
  postPhoneLookup,
} from "../controllers/sales-agent.controller";

const router = Router();

router.use(authMiddleware, requireSalesAgent());

router.get("/areas", getAgentAreas);
// The rep proposes; nothing is added until the owner approves it from the
// ordinary approvals screen.
router.post("/areas/propose", postAreaProposal);

router.get("/today", getToday);
router.get("/customers", getMyCustomers);
router.get("/customers/:id/header", getCustomerHeaderCtrl);
router.get("/customers/:id/detail", getCustomerDetailCtrl);
router.post("/customers/lookup", postPhoneLookup);
router.post("/customers/claim", postClaimCustomer);
router.post("/customers", requireAgentCapability("NEW_CUSTOMER"), postAgentCustomer);

router.get("/products", getAgentProducts);
router.post("/products/thumbnails", postAgentThumbnails);
router.get("/products/:id/image", getAgentImage);

router.post("/orders", postAgentOrder);
router.post("/orders/preview", previewAgentOrder);
router.get("/orders", getMyOrders);

router.get("/cash-on-hand", getCashOnHand);
router.post("/receipts", requireAgentCapability("RECEIPT"), postAgentReceipt);
router.get("/receipts", getMyReceipts);
router.get("/handovers", getMyHandovers);

// «فواتيري وسنداتي» — opened from a customer's statement. Every rule about who
// may change what (their own documents only, the rep's edit mode, the 6% floor,
// receipts always through the owner) is enforced in the service, not here.
router.get("/invoices/:id", getAgentInvoiceCtrl);
router.put("/invoices/:id", putAgentInvoiceCtrl);
router.post("/invoices/:id/cancel", postAgentInvoiceCancelCtrl);
router.get("/receipts/:id", getAgentReceiptCtrl);
router.post("/receipts/:id/edit-request", postReceiptEditRequestCtrl);
router.post("/receipts/:id/cancel-request", postReceiptCancelRequestCtrl);
router.post("/receipts/:id/send-whatsapp", postReceiptSendWhatsappCtrl);

router.get("/issue-reasons", getIssueReasons);
router.post("/issues", requireAgentCapability("ISSUE"), postAgentIssue);
router.get("/issues", getMyIssues);

router.post("/price-requests", requireAgentCapability("PRICE_REQUEST"), postPriceRequest);
router.get("/price-requests", getMyPriceRequests);
router.get("/customers/:id/usable-prices", getUsablePrices);

// «يشتريها عادةً» + «تغيّر السعر» + «عروضه» — all reads, all confined to the
// rep's own customers by the service (`assertOwnCustomer`), never by the screen.
router.get("/customers/:id/frequent-products", getFrequentProducts);
router.post("/customers/:id/price-notes", postPriceNotes);
router.get("/customers/:id/offers", getCustomerOffers);

// «خريطة الزيارات». `PUT .../location` writes the CUSTOMER's coordinates; the
// rep's own position is never persisted by any route here.
// «خطة زيارات اليوم» — the intention. `listVisitPlan` is scoped to the caller,
// so a rep can never read or start another rep's round.
router.get("/visits/plan", getMyVisitPlan);
router.get("/visits/plan-statuses", getPlanStatuses);
router.post("/visits/plan", postMyVisitPlanEntry);
router.patch("/visits/plan/:id", patchMyVisitPlanEntry);

router.get("/visits/customers", getVisitCustomers);
router.get("/visits/today", getTodayVisits);
router.get("/visits/outcomes", getVisitOutcomes);
router.post("/visits", postStartVisit);
router.post("/visits/:id/end", postEndVisit);
router.put("/customers/:id/location", putCustomerLocation);

export default router;
