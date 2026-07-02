import { Router } from "express";
import { systemHealth } from "../controllers/health.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

// Any logged-in user can read the health bar (it shows no sensitive data).
router.get("/system", authMiddleware, systemHealth);

export default router;
