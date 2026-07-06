import { asyncHandler } from "../utils/async-handler";
import { getRecentNotifications } from "../services/notification.service";

export const getRecent = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  // Pass the viewer so STAFF never receives sensitive (financial / destructive /
  // below-cost / negative-stock) notifications; only ADMIN sees the full feed.
  const data = await getRecentNotifications(limit, { role: req.user?.role });
  res.json({ success: true, data });
});
