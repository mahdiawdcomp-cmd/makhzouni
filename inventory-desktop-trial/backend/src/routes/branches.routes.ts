import { Router } from "express";
import {
  addBranch,
  editBranch,
  getBranchSummaries,
  getBranchDetails,
  getBranches,
} from "../controllers/branches.controller";
import { adminOnly } from "../middleware/admin-only.middleware";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import {
  createBranchSchema,
  idParamSchema,
  listBranchesSchema,
  updateBranchSchema,
} from "../utils/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/", validate(listBranchesSchema), getBranches);
router.get("/summaries", getBranchSummaries);
router.get("/:id", validate(idParamSchema), getBranchDetails);
router.post("/", adminOnly, validate(createBranchSchema), addBranch);
router.put("/:id", adminOnly, validate(updateBranchSchema), editBranch);

export default router;
