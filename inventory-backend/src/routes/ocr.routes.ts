import { requirePermission } from "../middleware/permission.middleware";
import { Router } from "express";
import { scanInvoiceImage } from "../controllers/ocr.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

// POST /api/ocr/invoice
// الموظف يرسل صورة فاتورة → النظام يقرأها ويرجع المنتجات
// Paid LLM call — gate it behind the capability it feeds.
router.post("/invoice", authMiddleware, requirePermission("MANAGE_INVOICES"), scanInvoiceImage);

export default router;
