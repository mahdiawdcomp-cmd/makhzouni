import { asyncHandler } from "../utils/async-handler";
import { getSystemHealth } from "../services/system-health.service";

export const systemHealth = asyncHandler(async (_req, res) => {
  const data = await getSystemHealth();
  res.json({ success: true, data });
});
