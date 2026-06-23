import { Router } from "express";
import {
  editMessageTemplate,
  getMessageTemplates,
} from "../controllers/message-templates.controller";
import { adminOnly } from "../middleware/admin-only.middleware";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate";
import { updateMessageTemplateSchema } from "../utils/schemas";

const router = Router();

router.use(authMiddleware);

router.get("/", getMessageTemplates);
router.put(
  "/:id",
  adminOnly,
  validate(updateMessageTemplateSchema),
  editMessageTemplate
);

export default router;
