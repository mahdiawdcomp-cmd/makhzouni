import { Router } from "express";
import {
  addCustomer,
  deleteCustomer,
  editCustomer,
  getBalance,
  getCustomerDetails,
  getCustomerDetailsAny,
  getCustomers,
  getDebts,
  getInactiveCustomers,
  getLastTransaction,
  getTransactions,
} from "../controllers/customers.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import {
  createPortalLink,
  revokePortalLinks,
} from "../controllers/customer-portal.controller";
import {
  createCustomerSchema,
  createPortalLinkSchema,
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
router.get("/inactive", validate(inactiveCustomersSchema), getInactiveCustomers);
router.get("/:id", validate(idParamSchema), getCustomerDetails);
router.get("/:id/any", validate(idParamSchema), getCustomerDetailsAny);
router.post("/", validate(createCustomerSchema), addCustomer);
router.post("/:id/portal-link", validate(createPortalLinkSchema), createPortalLink);
router.delete("/:id/portal-link", validate(idParamSchema), revokePortalLinks);
router.put("/:id", validate(updateCustomerSchema), editCustomer);
router.delete("/:id", validate(idParamSchema), deleteCustomer);
router.get(
  "/:id/transactions",
  validate(customerTransactionsSchema),
  getTransactions
);
router.get("/:id/last-transaction", validate(idParamSchema), getLastTransaction);
router.get("/:id/balance", validate(idParamSchema), getBalance);

export default router;
