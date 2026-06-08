import { Router } from "express";
import multer from "multer";
import { downloadTemplate, importProducts } from "../controllers/import.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authMiddleware);
router.get("/products/template", downloadTemplate);
router.post("/products", upload.single("file"), importProducts);

export default router;
