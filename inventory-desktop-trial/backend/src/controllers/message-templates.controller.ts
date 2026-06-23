import {
  listMessageTemplates,
  updateMessageTemplate,
} from "../services/message-template.service";
import { asyncHandler } from "../utils/async-handler";

export const getMessageTemplates = asyncHandler(async (_req, res) => {
  const templates = await listMessageTemplates();

  res.json({
    success: true,
    data: templates,
  });
});

export const editMessageTemplate = asyncHandler(async (req, res) => {
  const template = await updateMessageTemplate(String(req.params.id), req.body);

  res.json({
    success: true,
    message: "Message template updated successfully",
    data: template,
  });
});
