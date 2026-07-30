import { requirePermission } from "../middleware/permission.middleware";
import { Router } from "express";
import {
  sendInvoice,
  sendInvoiceImage,
  sendInvoiceToWorkersCtrl,
  sendMessage,
  sendTemplatedMessage,
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
import { invoiceIdParamSchema, sendWhatsAppSchema, sendWhatsAppTemplatedSchema } from "../utils/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/status", whatsappStatus);
// /send takes an arbitrary recipient and body on the merchant's billed
// account, and /restart bounces the provider connection for everyone.
router.post("/restart", requirePermission("MANAGE_SETTINGS"), whatsappRestart);
router.post("/send", requirePermission("MANAGE_CUSTOMERS"), validate(sendWhatsAppSchema), sendMessage);
router.post("/send-templated", requirePermission("MANAGE_CUSTOMERS"), validate(sendWhatsAppTemplatedSchema), sendTemplatedMessage);
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
