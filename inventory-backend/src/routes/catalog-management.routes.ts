import { requirePermission } from "../middleware/permission.middleware";
import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import {
  getCatalogCustomers,
  grantCatalogAccess,
  patchCatalogAccess,
  revokeCatalogAccessCtrl,
  listPromoCodesCtrl,
  createPromoCodeCtrl,
  deletePromoCodeCtrl,
  togglePromoCodeCtrl,
  getFirstOrderCouponReportCtrl,
  getCatalogDesignCtrl,
  updateCatalogDesignCtrl,
  getCatalogVisitorsCtrl,
  getVisitorProductViewsCtrl,
  convertVisitorCtrl,
  broadcastVisitorsCtrl,
  getCatalogProductStatsCtrl,
} from "../controllers/catalog-management.controller";
import {
  getProductContentCtrl,
  updateProductContentCtrl,
  addProductImageCtrl,
  deleteProductImageCtrl,
  listReviewsCtrl,
  setReviewStatusCtrl,
  deleteReviewCtrl,
} from "../controllers/catalog-product-page.controller";
import {
  listAccountsCtrl,
  sendCredentialsCtrl,
  sendCredentialsBulkCtrl,
  setPricesHiddenCtrl,
  unlockAccountCtrl,
  sendCredentialsToAllCtrl,
  sendInvitesToAllCtrl,
  unifiedAccountsCtrl,
  personProfileCtrl,
  catalogDashboardCtrl,
  grantPricesCtrl,
  revokePricesCtrl,
  promoteVisitorCtrl,
  revealCredentialsCtrl,
  adminIncomingItemsCtrl,
  createIncomingItemCtrl,
  updateIncomingItemCtrl,
  deleteIncomingItemCtrl,
  itemReservationsCtrl,
  allReservationsCtrl,
  markArrivedCtrl,
  reservationStatusCtrl,
  credentialTargetCountsCtrl,
  applyPricesDefaultCtrl,
} from "../controllers/customer-login.controller";
import {
  listOptOutsCtrl,
  addOptOutCtrl,
  resumeMarketingCtrl,
} from "../controllers/marketing-opt-out.controller";
import { validate } from "../middleware/validate";
import {
  catalogProductIdSchema,
  updateProductContentSchema,
  addProductImageSchema,
  deleteProductImageSchema,
  setReviewStatusSchema,
  idParamSchema,
  sendCredentialsSchema,
  sendCredentialsBulkSchema,
  setPricesHiddenSchema,
  unlockAccountSchema,
  sendCredentialsToAllSchema,
  sendInvitesToAllSchema,
  visitorPhoneSchema,
  createIncomingItemSchema,
  updateIncomingItemSchema,
  incomingItemIdSchema,
  reservationStatusSchema,
  optOutPhoneSchema,
} from "../utils/schemas";

const router = Router();

router.use(authMiddleware);
// Every write below is customer-facing: granting wholesale-catalog access,
// broadcasting to the visitor list, minting promo codes, changing the public
// design. authMiddleware alone let any zero-permission staff account do all of
// it, and none of these routes sit behind the approval flow.
router.use((req, res, next) =>
  req.method === "GET" ? next() : requirePermission("MANAGE_CUSTOMERS")(req, res, next),
);

// Guest visitors (phone gate leads)
router.get("/visitors", getCatalogVisitorsCtrl);
router.get("/visitors/:phone/views", getVisitorProductViewsCtrl);
router.post("/visitors/broadcast", broadcastVisitorsCtrl);
router.post("/visitors/:phone/convert", convertVisitorCtrl);

// Catalog product analytics
router.get("/product-stats", getCatalogProductStatsCtrl);

// Customers
router.get("/", getCatalogCustomers);
router.post("/:id/grant", grantCatalogAccess);
router.patch("/:id", patchCatalogAccess);
router.delete("/:id", revokeCatalogAccessCtrl);

// Promo codes
router.get("/promo-codes", listPromoCodesCtrl);
// بند ٧ — يجب أن يسبق أي "/promo-codes/:id" مستقبلي وإلا اكسبرس يقرأ
// "first-order-report" كمعرّف كود خصم.
router.get("/promo-codes/first-order-report", getFirstOrderCouponReportCtrl);
router.post("/promo-codes", createPromoCodeCtrl);
router.delete("/promo-codes/:id", deletePromoCodeCtrl);
router.patch("/promo-codes/:id/toggle", togglePromoCodeCtrl);

// Design settings
router.get("/design", getCatalogDesignCtrl);
router.put("/design", updateCatalogDesignCtrl);

// Storefront content for the product page (description, spec rows, gallery).
// Two-segment paths, so none of these collide with the "/:id" customer routes.
router.get("/products/:id/content", validate(catalogProductIdSchema), getProductContentCtrl);
router.put("/products/:id/content", validate(updateProductContentSchema), updateProductContentCtrl);
router.post("/products/:id/images", validate(addProductImageSchema), addProductImageCtrl);
router.delete("/products/:id/images/:imageId", validate(deleteProductImageSchema), deleteProductImageCtrl);

// Review moderation — nothing a shopper writes reaches the storefront until
// one of these approves it.
router.get("/reviews", listReviewsCtrl);
router.patch("/reviews/:id", validate(setReviewStatusSchema), setReviewStatusCtrl);
router.delete("/reviews/:id", validate(idParamSchema), deleteReviewCtrl);

// Storefront accounts — who can sign in, and sending them their credentials.
router.get("/accounts", listAccountsCtrl);
router.post("/accounts/send-credentials", validate(sendCredentialsSchema), sendCredentialsCtrl);
router.post("/accounts/send-credentials-bulk", validate(sendCredentialsBulkSchema), sendCredentialsBulkCtrl);
router.patch("/accounts/:id/prices-hidden", validate(setPricesHiddenSchema), setPricesHiddenCtrl);
router.post("/accounts/unlock", validate(unlockAccountSchema), unlockAccountCtrl);
router.get("/accounts/target-counts", credentialTargetCountsCtrl);
router.post("/accounts/send-credentials-all", validate(sendCredentialsToAllSchema), sendCredentialsToAllCtrl);
router.post("/accounts/send-invites-all", validate(sendInvitesToAllSchema), sendInvitesToAllCtrl);
// One labelled list of everyone who can sign in, plus the two things the shop
// decides about a visitor: their prices, and whether they go on the books.
router.get("/dashboard", catalogDashboardCtrl);
router.get("/accounts/unified", unifiedAccountsCtrl);
router.get("/accounts/:phone/profile", personProfileCtrl);
router.post("/accounts/grant-prices", validate(visitorPhoneSchema), grantPricesCtrl);
router.post("/accounts/revoke-prices", validate(visitorPhoneSchema), revokePricesCtrl);
router.post("/accounts/promote", validate(visitorPhoneSchema), promoteVisitorCtrl);
router.post("/accounts/reveal", validate(sendCredentialsSchema), revealCredentialsCtrl);

// «البضاعة القادمة الجديدة» — the list the shop curates, and who reserved what.
router.get("/incoming", adminIncomingItemsCtrl);
router.get("/incoming-reservations", allReservationsCtrl);
router.post("/incoming", validate(createIncomingItemSchema), createIncomingItemCtrl);
router.put("/incoming/:id", validate(updateIncomingItemSchema), updateIncomingItemCtrl);
router.delete("/incoming/:id", validate(incomingItemIdSchema), deleteIncomingItemCtrl);
router.post("/incoming/:id/arrived", validate(incomingItemIdSchema), markArrivedCtrl);
router.get("/incoming/:id/reservations", validate(incomingItemIdSchema), itemReservationsCtrl);
router.patch("/incoming/reservations/:id", validate(reservationStatusSchema), reservationStatusCtrl);
router.post("/accounts/apply-prices-default", applyPricesDefaultCtrl);

// «توقف» — numbers that asked to stop receiving marketing.
router.get("/opt-outs", listOptOutsCtrl);
router.post("/opt-outs", validate(optOutPhoneSchema), addOptOutCtrl);
router.post("/opt-outs/resume", validate(optOutPhoneSchema), resumeMarketingCtrl);

export default router;
