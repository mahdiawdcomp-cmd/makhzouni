import { Router } from "express";
import {
  sendInvoice,
  sendInvoiceImage,
  sendInvoiceToWorkersCtrl,
  sendMessage,
  whatsappRestart,
  whatsappStatus,
  testWhatsAppText,
  testWhatsAppImage,
  testWhatsAppPdf,
  checkWhatsAppWebhook,
  regenerateVerifyToken,
  getWhatsappSubscribedApps,
  postWhatsappSubscribeApp,
} from "../controllers/whatsapp.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminOnly } from "../middleware/admin-only.middleware";
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
router.post(
  "/send-invoice-image/:invoiceId",
  validate(invoiceIdParamSchema),
  sendInvoiceImage
);
router.post(
  "/send-invoice-to-workers/:invoiceId",
  validate(invoiceIdParamSchema),
  sendInvoiceToWorkersCtrl
);

// Admin test / diagnostics endpoints (no real Meta account needed for webhook check)
router.post("/test/text", adminOnly, testWhatsAppText);
router.post("/test/image", adminOnly, testWhatsAppImage);
router.post("/test/pdf", adminOnly, testWhatsAppPdf);
router.get("/webhook-check", adminOnly, checkWhatsAppWebhook);
router.post("/verify-token/regenerate", adminOnly, regenerateVerifyToken);
router.get("/waba-subscribed-apps", adminOnly, getWhatsappSubscribedApps);
router.post("/waba-subscribed-apps", adminOnly, postWhatsappSubscribeApp);

export default router;
