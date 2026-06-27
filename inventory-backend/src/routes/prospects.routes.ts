import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { requirePermission } from "../middleware/permission.middleware";
import {
  clearConverted,
  getProspects,
  postConvertProspect,
  postProspects,
  postProspectsFromImages,
  removeProspect,
} from "../controllers/prospects.controller";

const router = Router();

router.use(authMiddleware);
const manage = requirePermission("MANAGE_CUSTOMERS");

router.get("/", getProspects);
router.post("/", manage, postProspects);
router.post("/from-images", manage, postProspectsFromImages);
router.post("/:id/convert", manage, postConvertProspect);
router.delete("/converted", manage, clearConverted);
router.delete("/:id", manage, removeProspect);

export default router;
