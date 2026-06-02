import { asyncHandler } from "../utils/async-handler";
import { getSettings, updateSettings } from "../services/settings.service";

export const getAllSettings = asyncHandler(async (_req, res) => {
  const settings = await getSettings();

  res.json({
    success: true,
    data: settings,
  });
});

export const updateAppSettings = asyncHandler(async (req, res) => {
  const settings = await updateSettings(req.body);

  res.json({
    success: true,
    message: "Settings updated successfully",
    data: settings,
  });
});
