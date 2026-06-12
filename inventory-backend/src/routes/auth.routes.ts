import { Router } from "express";
import {
  changePassword,
  login,
  logout,
} from "../controllers/auth.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { loginLimiter, refreshLimiter } from "../middleware/rate-limit.middleware";
import { validate } from "../middleware/validate";
import { changePasswordSchema, loginSchema } from "../utils/schemas";

const router = Router();

router.post("/login", loginLimiter, validate(loginSchema), login);
router.post("/refresh", refreshLimiter, authMiddleware, (_req, res) => {
  res.json({ success: true, message: "Session is still valid" });
});
router.get("/me", authMiddleware, (req, res) => {
  const u = req.user!;
  res.json({
    success: true,
    data: {
      id: u.id,
      name: u.name,
      username: u.username,
      role: u.role,
      permissions: u.permissions,
      isActive: u.isActive,
    },
  });
});
router.post("/logout", authMiddleware, logout);
router.post(
  "/change-password",
  authMiddleware,
  validate(changePasswordSchema),
  changePassword
);

export default router;
