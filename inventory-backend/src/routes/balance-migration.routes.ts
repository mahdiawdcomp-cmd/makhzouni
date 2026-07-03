import { Router } from "express";
// TEMPORARY OLD ACCOUNTING IMPORT TOOL - DISABLED AFTER SUCCESSFUL MIGRATION.
// The apply controller is intentionally left in the codebase but is no longer
// wired up. The endpoint now hard-returns 410 Gone so NO balance can ever be
// applied again — not even by an admin. To re-enable (do not, unless a new
// migration is explicitly needed), restore the auth+adminOnly guard and the
// `router.post("/apply", applyOpeningBalances)` line below.
// import { applyOpeningBalances } from "../controllers/balance-migration.controller";
// import { authMiddleware } from "../middleware/auth.middleware";
// import { adminOnly } from "../middleware/admin-only.middleware";

const router = Router();

// Disabled: reject every method on every path under /balance-migration
// (pathless middleware — matches all sub-paths, can't fail path parsing).
router.use((_req, res) => {
  res.status(410).json({
    error: "BALANCE_MIGRATION_DISABLED",
    message: "تم تعطيل أداة نقل الأرصدة بعد اكتمال العملية.",
  });
});

export default router;
