import { Router } from "express";
import {
  addUser,
  deleteUser,
  editUser,
  getUsers,
} from "../controllers/users.controller";
import { adminOnly } from "../middleware/admin-only.middleware";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import {
  createUserSchema,
  idParamSchema,
  updateUserSchema,
} from "../utils/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/", adminOnly, getUsers);
router.post("/", adminOnly, validate(createUserSchema), addUser);
router.put("/:id", adminOnly, validate(updateUserSchema), editUser);
router.delete("/:id", adminOnly, validate(idParamSchema), deleteUser);

export default router;
