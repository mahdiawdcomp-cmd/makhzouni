import { asyncHandler } from "../utils/async-handler";
import { getRecentNotifications } from "../services/notification.service";

export const getRecent = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const data = await getRecentNotifications(limit);
  res.json({ success: true, data });
});
