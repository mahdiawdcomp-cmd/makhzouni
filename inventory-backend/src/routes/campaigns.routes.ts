import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { requirePermission } from "../middleware/permission.middleware";
import {
  deleteCampaignRecipient,
  getCampaignById,
  getCampaigns,
  patchCampaignStatus,
  postCampaign,
  postCampaignRecipients,
  putCampaign,
  removeCampaign,
} from "../controllers/campaigns.controller";

const router = Router();

router.use(authMiddleware);

const manage = requirePermission("MANAGE_CUSTOMERS");

router.get("/", getCampaigns);
router.get("/:id", getCampaignById);
router.post("/", manage, postCampaign);
router.put("/:id", manage, putCampaign);
router.delete("/:id", manage, removeCampaign);
router.patch("/:id/status", manage, patchCampaignStatus);
router.post("/:id/recipients", manage, postCampaignRecipients);
router.delete("/:id/recipients/:recipientId", manage, deleteCampaignRecipient);

export default router;
