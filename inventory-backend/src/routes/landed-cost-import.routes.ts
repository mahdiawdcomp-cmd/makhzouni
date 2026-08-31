import { Router } from "express";
import multer from "multer";
import { AppError } from "../utils/app-error";
import {
  cancelBatchCtrl,
  batchArrivedCtrl,
  confirmBatchCtrl,
  createBatch,
  holdBatchCtrl,
  incomingArrivedCtrl,
  downloadLandedCostTemplate,
  getBatchCtrl,
  listBatchesCtrl,
  previewLandedCost,
  setItemDecisionCtrl,
} from "../controllers/landed-cost-import.controller";
import {
  createChinaBatchCtrl,
  downloadChinaTemplate,
  previewChinaOrder,
} from "../controllers/china-order-pricing.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middleware/permission.middleware";

const router = Router();
// 60MB: real China-order sheets carry one embedded product photo PER ROW, so a
// 300-row order routinely lands between 25 and 50 MB. The parser reads cell
// VALUES only and never touches xl/media, so the extra size costs upload time
// rather than parsing work.
// The parser (SheetJS) carries unpatched prototype-pollution and ReDoS
// advisories with no npm fix available, so the boundary is kept as narrow as
// possible: one file, a hard size cap, and an extension/MIME allowlist so
// arbitrary binaries never reach it. See SECURITY-NOTES.md.
const SPREADSHEET_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel",                                          // .xls
  "text/csv",
  "application/csv",
  "application/octet-stream", // some browsers send this for .xlsx
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const name = (file.originalname ?? "").toLowerCase();
    const extOk = /\.(xlsx|xlsm|xls|csv)$/.test(name);
    if (!extOk || !SPREADSHEET_MIMES.has(file.mimetype)) {
      // A bare Error here reached the generic handler as a 500 "Internal
      // server error"; AppError carries the Arabic reason and a 400.
      cb(new AppError("صيغة الملف غير مدعومة — ارفع ملف Excel أو CSV فقط", 400, "UNSUPPORTED_FILE_TYPE"));
      return;
    }
    cb(null, true);
  },
});

router.use(authMiddleware);
// Deals with purchase cost + creates real purchase invoices — gate behind the
// same capability used elsewhere to view/manage purchase pricing.
router.use(requireAnyPermission("MANAGE_PRODUCTS", "VIEW_PURCHASE_PRICE"));

// China fixed-template flow (the ONLY flow exposed in the UI). Review /
// decisions / cancel / confirm are shared with the batch endpoints below.
router.get("/china/template", downloadChinaTemplate);
router.post("/china/preview", upload.single("file"), previewChinaOrder);
router.post("/china/batches", createChinaBatchCtrl);

// Legacy generic flexible-column flow — kept API-compatible but no longer
// reachable from the UI (replaced by the China fixed template above).
router.get("/template", downloadLandedCostTemplate);
router.post("/preview", upload.single("file"), previewLandedCost);
router.post("/batches", createBatch);
router.get("/batches", listBatchesCtrl);
router.get("/batches/:id", getBatchCtrl);
router.patch("/batches/:id/items/:itemId", setItemDecisionCtrl);
// Cancel and confirm are WRITES, not reads: confirm creates a purchase invoice,
// adds stock in every warehouse and overwrites costPrice/purchasePrice. The
// blanket OR-gate above let an account holding only the read-only
// VIEW_PURCHASE_PRICE inject stock and rewrite product costs.
router.post("/batches/:id/cancel", requirePermission("MANAGE_PRODUCTS"), cancelBatchCtrl);
router.post("/batches/:id/confirm", requirePermission("MANAGE_PRODUCTS"), confirmBatchCtrl);
// Holding a batch for arrival writes nothing to the books, but arriving one
// creates a purchase invoice and injects stock — so both live behind the same
// gate as confirm, and NOT behind the catalog screen's MANAGE_CUSTOMERS.
router.post("/batches/:id/hold", requirePermission("MANAGE_PRODUCTS"), holdBatchCtrl);
router.post("/batches/:id/arrived", requirePermission("MANAGE_PRODUCTS"), batchArrivedCtrl);
router.post("/incoming/:id/arrived", requirePermission("MANAGE_PRODUCTS"), incomingArrivedCtrl);

export default router;
