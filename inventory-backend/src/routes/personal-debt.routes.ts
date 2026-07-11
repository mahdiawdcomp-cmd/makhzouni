import { Router } from "express";
import {
  deletePersonalDebtHandler,
  getPersonalDebts,
  postPersonalDebt,
  putPersonalDebt,
  putPersonalDebtPaid,
} from "../controllers/personal-debt.controller";
import { adminOnly } from "../middleware/admin-only.middleware";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import { createPersonalDebtSchema, idParamSchema, updatePersonalDebtSchema } from "../utils/schemas";

const router = Router();

router.use(authMiddleware);
router.use(adminOnly);

router.get("/", getPersonalDebts);
router.post("/", validate(createPersonalDebtSchema), postPersonalDebt);
router.put("/:id", validate(updatePersonalDebtSchema), putPersonalDebt);
router.put("/:id/paid", validate(idParamSchema), putPersonalDebtPaid);
router.delete("/:id", validate(idParamSchema), deletePersonalDebtHandler);

export default router;
