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
  getInactiveCustomers,
  getLastTransaction,
  getTransactions,
  getWalkInCustomer,
  patchCustomerTag,
  postCatalogLinkBroadcast,
  postCustomerBroadcast,
  postCustomerTag,
  postSendCatalogLink,
  recalculateBalance,
} from "../controllers/customers.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { enforcePlanLimit } from "../middleware/tenant.middleware";
import { requirePermission } from "../middleware/permission.middleware";
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
  idParamSchema,
  inactiveCustomersSchema,
  listCustomersSchema,
  updateCustomerSchema,
} from "../utils/schemas";

const router = Router();

router.use(authMiddleware);

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
router.get("/:id", validate(idParamSchema), getCustomerDetails);
router.get("/:id/any", validate(idParamSchema), getCustomerDetailsAny);
router.post("/", enforcePlanLimit("customer"), validate(createCustomerSchema), addCustomer);
router.post("/:id/send-catalog-link", requirePermission("MANAGE_CUSTOMERS"), validate(sendCatalogLinkSchema), postSendCatalogLink);
router.post("/:id/portal-link", validate(createPortalLinkSchema), createPortalLink);
router.patch("/:id/portal-link", validate(idParamSchema), togglePortalLinkController);
router.delete("/:id/portal-link", validate(idParamSchema), revokePortalLinks);
router.put("/:id", validate(updateCustomerSchema), editCustomer);
router.post("/:id/recalculate-balance", validate(idParamSchema), recalculateBalance);
router.delete("/:id", validate(idParamSchema), deleteCustomer);
router.get(
  "/:id/transactions",
  validate(customerTransactionsSchema),
  getTransactions
);
router.get("/:id/last-transaction", validate(idParamSchema), getLastTransaction);
router.get("/:id/balance", validate(idParamSchema), getBalance);

export default router;
