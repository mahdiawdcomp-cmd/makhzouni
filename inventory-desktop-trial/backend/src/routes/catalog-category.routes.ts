import { Router } from "express";
import { asyncHandler } from "../utils/async-handler";
import { authMiddleware } from "../middleware/auth.middleware";
import {
  listCatalogCategories,
  upsertCatalogCategory,
  deleteCatalogCategory,
} from "../services/catalog-category.service";

const router = Router();

// Public — catalog page needs to load categories without auth
router.get("/", asyncHandler(async (_req, res) => {
  const data = await listCatalogCategories();
  res.json({ success: true, data });
}));

// Admin — manage categories
router.post("/", authMiddleware, asyncHandler(async (req, res) => {
  const { name, types, sortOrder } = req.body as { name: string; types?: string[]; sortOrder?: number };
  const data = await upsertCatalogCategory(String(name), Array.isArray(types) ? types : [], sortOrder);
  res.json({ success: true, data });
}));

router.delete("/:id", authMiddleware, asyncHandler(async (req, res) => {
  await deleteCatalogCategory(String(req.params["id"]));
  res.json({ success: true });
}));

export default router;
