import { Router } from "express";
import {
  addCustomer,
  deleteCustomer,
  deleteCustomerTagController,
  editCustomer,
  getBalance,
  getCustomerDetails,
  getCustomerDetailsAny,
  getCustomers,
  getCustomerTags,
  getDebts,
  getDeletedCustomersList,
  getInactiveCustomers,
  getLastTransaction,
  getTransactions,
  getWalkInCustomer,
  sendStatementPdfWhatsapp,
  patchCustomerTag,
  postCatalogLinkBroadcast,
  postCustomerBroadcast,
  postCustomerTag,
  postSendCatalogLink,
  recalculateBalance,
  restoreCustomerCtrl,
} from "../controllers/customers.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { enforcePlanLimit } from "../middleware/tenant.middleware";
import { requirePermission, scopeCustomerParamToSalesAgent } from "../middleware/permission.middleware";
import { validate } from "../middleware/validate";
import {
  createPortalLink,
  revokePortalLinks,
  togglePortalLinkController,
} from "../controllers/customer-portal.controller";
import {
  createCustomerSchema,
  createPortalLinkSchema,
  catalogLinkBroadcastSchema,
  customerBroadcastSchema,
  sendCatalogLinkSchema,
  customerTagCreateSchema,
  customerTagDeleteSchema,
  customerTagRenameSchema,
  customerTransactionsSchema,
  sendStatementPdfSchema,
  idParamSchema,
  inactiveCustomersSchema,
  listCustomersSchema,
  updateCustomerSchema,
} from "../utils/schemas";

const router = Router();

router.use(authMiddleware);

// «المندوب» — every `:id` route below is confined to the rep's own customers.
// Registered as a param handler rather than per-route so a new endpoint added
// later is covered without anyone having to remember to add the check.
router.param("id", scopeCustomerParamToSalesAgent());

router.get("/", validate(listCustomersSchema), getCustomers);
router.get("/debts", getDebts);
router.get("/walk-in", getWalkInCustomer);
router.get("/tags", getCustomerTags);
router.post("/tags", requirePermission("MANAGE_CUSTOMERS"), validate(customerTagCreateSchema), postCustomerTag);
router.patch("/tags", requirePermission("MANAGE_CUSTOMERS"), validate(customerTagRenameSchema), patchCustomerTag);
router.delete("/tags", requirePermission("MANAGE_CUSTOMERS"), validate(customerTagDeleteSchema), deleteCustomerTagController);
router.post("/broadcast", requirePermission("MANAGE_CUSTOMERS"), validate(customerBroadcastSchema), postCustomerBroadcast);
router.post("/broadcast-catalog-link", requirePermission("MANAGE_CUSTOMERS"), validate(catalogLinkBroadcastSchema), postCatalogLinkBroadcast);
router.get("/inactive", validate(inactiveCustomersSchema), getInactiveCustomers);
router.get("/deleted", requirePermission("MANAGE_CUSTOMERS"), getDeletedCustomersList);
router.post("/:id/restore", requirePermission("MANAGE_CUSTOMERS"), validate(idParamSchema), restoreCustomerCtrl);
router.get("/:id", validate(idParamSchema), getCustomerDetails);
router.get("/:id/any", validate(idParamSchema), getCustomerDetailsAny);
router.post("/", enforcePlanLimit("customer"), validate(createCustomerSchema), addCustomer);
router.post("/:id/send-catalog-link", requirePermission("MANAGE_CUSTOMERS"), validate(sendCatalogLinkSchema), postSendCatalogLink);
// A portal link is a public, unauthenticated token exposing that customer's
// invoices and balance — minting or revoking one is a customer-management act.
router.post("/:id/portal-link", requirePermission("MANAGE_CUSTOMERS"), validate(createPortalLinkSchema), createPortalLink);
router.patch("/:id/portal-link", requirePermission("MANAGE_CUSTOMERS"), validate(idParamSchema), togglePortalLinkController);
router.delete("/:id/portal-link", requirePermission("MANAGE_CUSTOMERS"), validate(idParamSchema), revokePortalLinks);
router.put("/:id", validate(updateCustomerSchema), editCustomer);
router.post("/:id/recalculate-balance", validate(idParamSchema), recalculateBalance);
router.delete("/:id", validate(idParamSchema), deleteCustomer);
router.get(
  "/:id/transactions",
  validate(customerTransactionsSchema),
  getTransactions
);
router.post("/:id/statement-pdf-whatsapp", validate(sendStatementPdfSchema), sendStatementPdfWhatsapp);
router.get("/:id/last-transaction", validate(idParamSchema), getLastTransaction);
router.get("/:id/balance", validate(idParamSchema), getBalance);

export default router;
