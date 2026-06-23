import { Router } from "express";
import { asyncHandler } from "../utils/async-handler";
import { verifyLicense } from "../services/license.service";

const router = Router();

// Public endpoint — no auth required (frontend checks on load)
router.get("/status", asyncHandler(async (_req, res) => {
  const info = verifyLicense();
  res.json({ success: true, data: info });
}));

export default router;
