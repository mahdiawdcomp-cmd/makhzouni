import { Router } from "express";
import {
  sendInvoice,
  sendMessage,
  whatsappRestart,
  whatsappStatus,
} from "../controllers/whatsapp.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import { invoiceIdParamSchema, sendWhatsAppSchema } from "../utils/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/status", whatsappStatus);
router.post("/restart", whatsappRestart);
router.post("/send", validate(sendWhatsAppSchema), sendMessage);
router.post(
  "/send-invoice/:invoiceId",
  validate(invoiceIdParamSchema),
  sendInvoice
);

export default router;
