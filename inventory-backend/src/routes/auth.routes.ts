import { Router } from "express";
import {
  changePassword,
  login,
  logout,
} from "../controllers/auth.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import { changePasswordSchema, loginSchema } from "../utils/schemas";

const router = Router();

router.post("/login", validate(loginSchema), login);
router.post("/logout", authMiddleware, logout);
router.post(
  "/change-password",
  authMiddleware,
  validate(changePasswordSchema),
  changePassword
);

export default router;
