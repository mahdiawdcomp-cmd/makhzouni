import { Router } from "express";
import {
  addUser,
  deleteUser,
  editUser,
  getUsers,
  permanentlyDeleteUser,
} from "../controllers/users.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import {
  createUserSchema,
  idParamSchema,
  updateUserSchema,
} from "../utils/schemas";
import { requirePermission } from "../middleware/permission.middleware";

const router = Router();

router.use(authMiddleware);

router.get("/", requirePermission("MANAGE_USERS"), getUsers);
router.post("/", requirePermission("MANAGE_USERS"), validate(createUserSchema), addUser);
router.put("/:id", requirePermission("MANAGE_USERS"), validate(updateUserSchema), editUser);
router.delete("/:id/permanent", requirePermission("MANAGE_USERS"), validate(idParamSchema), permanentlyDeleteUser);
router.delete("/:id", requirePermission("MANAGE_USERS"), validate(idParamSchema), deleteUser);

export default router;
