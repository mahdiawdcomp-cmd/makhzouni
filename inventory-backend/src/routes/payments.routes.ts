import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminOnly } from "../middleware/admin-only.middleware";
import {
  deletePaymentHandler,
  getPayments,
  getRevenue,
  postPayment,
  postRenew,
} from "../controllers/payments.controller";

const router = Router();

router.use(authMiddleware, adminOnly);

router.get("/",                         getPayments);
router.post("/",                        postPayment);
router.get("/revenue",                  getRevenue);
router.post("/renew/:clientId",         postRenew);
router.delete("/:id",                   deletePaymentHandler);

export default router;
