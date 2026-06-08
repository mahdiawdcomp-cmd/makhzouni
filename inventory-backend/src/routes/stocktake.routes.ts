import { Router } from "express";
import {
  closeSession,
  createSession,
  getSession,
  listSessions,
  patchItem,
  submitSession,
} from "../controllers/stocktake.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();
router.use(authMiddleware);

router.get("/", listSessions);
router.post("/", createSession);
router.get("/:id", getSession);
router.patch("/:id/items", patchItem);
router.post("/:id/submit", submitSession);
router.post("/:id/close", closeSession);

export default router;
