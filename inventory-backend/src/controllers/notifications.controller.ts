import { asyncHandler } from "../utils/async-handler";
import { getRecentNotifications } from "../services/notification.service";
import {
  archiveAppNotification,
  countUnreadBySeverity,
  listAppNotifications,
  markAllAppNotificationsRead,
  markAppNotificationRead,
} from "../services/app-notification.service";

export const getRecent = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  // Pass the viewer so STAFF never receives sensitive (financial / destructive /
  // below-cost / negative-stock) notifications; only ADMIN sees the full feed.
  const data = await getRecentNotifications(limit, { role: req.user?.role });
  res.json({ success: true, data });
});

// ── AppNotification center (batch 23C) ────────────────────────────────────────

function viewerFrom(req: { user?: { id: string; role: string } }) {
  return { id: req.user!.id, role: req.user!.role };
}

export const getAppRecent = asyncHandler(async (req, res) => {
  const category = typeof req.query.category === "string" ? req.query.category : undefined;
  const severity = typeof req.query.severity === "string" ? req.query.severity : undefined;
  const unreadOnly = req.query.unreadOnly === "true";
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const data = await listAppNotifications(viewerFrom(req), { category, severity, unreadOnly, limit });
  res.json({ success: true, ...data });
});

export const markAppRead = asyncHandler(async (req, res) => {
  const data = await markAppNotificationRead(String(req.params.id), viewerFrom(req));
  res.json({ success: true, ...data });
});

export const markAllAppRead = asyncHandler(async (req, res) => {
  const category = typeof req.body?.category === "string" ? req.body.category : undefined;
  const severity = typeof req.body?.severity === "string" ? req.body.severity : undefined;
  const data = await markAllAppNotificationsRead(viewerFrom(req), { category, severity });
  res.json({ success: true, ...data });
});

export const getAppCounts = asyncHandler(async (req, res) => {
  const data = await countUnreadBySeverity(viewerFrom(req));
  res.json({ success: true, ...data });
});

export const archiveApp = asyncHandler(async (req, res) => {
  const data = await archiveAppNotification(String(req.params.id), viewerFrom(req));
  res.json({ success: true, ...data });
});
