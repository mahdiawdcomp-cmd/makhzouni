/**
 * «المناطق» routes.
 *
 * Reads are open to any signed-in user: a rep picking a neighbourhood, the
 * customers screen showing one, and the owner's settings page all want the same
 * list, and a neighbourhood name is not a secret.
 *
 * Every WRITE is `adminOnly`. Letting a rep create areas directly is how a
 * list ends up holding «حي الحسين», «الحسين» and «حي الحسين (ع)» as three
 * different places within a month — the rep proposes through the approvals
 * screen instead, which is the same route every other rep request already
 * takes.
 */
import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminOnly } from "../middleware/admin-only.middleware";
import {
  deleteArea,
  getAreaSuggestion,
  getAreas,
  patchArea,
  postArea,
  postAreaImport,
  postAreaLink,
} from "../controllers/area.controller";

const router = Router();

router.use(authMiddleware);

router.get("/", getAreas);
// Before "/:id" would ever be added — a literal segment must win over a
// parameter, or "suggest" would be read as an id.
router.get("/suggest", getAreaSuggestion);

router.post("/", adminOnly, postArea);
router.post("/import", adminOnly, postAreaImport);
router.post("/link-customers", adminOnly, postAreaLink);
router.patch("/:id", adminOnly, patchArea);
router.delete("/:id", adminOnly, deleteArea);

export default router;
