import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { adminOnly } from "../middleware/admin-only.middleware";
import {
  getClients,
  postClient,
  patchClient,
  patchRevokeClient,
  deleteClientHandler,
} from "../controllers/clients.controller";

const router = Router();

router.use(authMiddleware, adminOnly);

router.get("/",              getClients);
router.post("/",             postClient);
router.patch("/:id",         patchClient);
router.patch("/:id/revoke",  patchRevokeClient);
router.delete("/:id",        deleteClientHandler);

export default router;
