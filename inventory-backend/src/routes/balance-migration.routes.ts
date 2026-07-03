import { Router } from "express";
import { applyOpeningBalances } from "../controllers/balance-migration.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminOnly } from "../middleware/admin-only.middleware";

const router = Router();

// One-off opening-balance migration from the old accounting system. Admin only.
router.use(authMiddleware, adminOnly);
router.post("/apply", applyOpeningBalances);

export default router;
