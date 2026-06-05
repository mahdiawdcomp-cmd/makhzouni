import { Router } from "express";
import { scanInvoiceImage } from "../controllers/ocr.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

// POST /api/ocr/invoice
// الموظف يرسل صورة فاتورة → النظام يقرأها ويرجع المنتجات
router.post("/invoice", authMiddleware, scanInvoiceImage);

export default router;
