import { Router } from "express";
import { getAuditLogs } from "../controllers/audit-logs.controller";
import { adminOnly } from "../middleware/admin-only.middleware";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import { listAuditLogsSchema } from "../utils/schemas";

const router = Router();

router.use(authMiddleware, adminOnly);

router.get("/", validate(listAuditLogsSchema), getAuditLogs);

export default router;
