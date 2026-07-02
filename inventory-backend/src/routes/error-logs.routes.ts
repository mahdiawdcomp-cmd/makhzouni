import { Router } from "express";
import {
  getErrorLogs,
  patchResolveErrorLog,
  postAnalyzeErrorLog,
} from "../controllers/error-logs.controller";
import { adminOnly } from "../middleware/admin-only.middleware";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.use(authMiddleware, adminOnly);

router.get("/", getErrorLogs);
router.patch("/:id/resolve", patchResolveErrorLog);
router.post("/:id/analyze", postAnalyzeErrorLog);

export default router;
