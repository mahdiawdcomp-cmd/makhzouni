import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { listTransfers, getTransfer, createTransfer } from "../controllers/transfers.controller";

const router = Router();

router.use(authMiddleware);

router.get("/", listTransfers);
router.get("/:id", getTransfer);
router.post("/", createTransfer);

export default router;
