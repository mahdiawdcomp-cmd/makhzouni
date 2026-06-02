import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { getRecent } from "../controllers/notifications.controller";

const router = Router();

router.use(authMiddleware);

router.get("/recent", getRecent);

export default router;
