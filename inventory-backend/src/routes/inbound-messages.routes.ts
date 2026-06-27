import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { requirePermission } from "../middleware/permission.middleware";
import {
  getInboundMessages,
  patchInboundMessageRead,
  postInboundMessageReply,
} from "../controllers/inbound-messages.controller";

const router = Router();

router.use(authMiddleware);
const manage = requirePermission("MANAGE_CUSTOMERS");

router.get("/", getInboundMessages);
router.patch("/:id/read", manage, patchInboundMessageRead);
router.post("/:id/reply", manage, postInboundMessageReply);

export default router;
