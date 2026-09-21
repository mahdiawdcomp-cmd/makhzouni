import prisma from "../config/database";
import { asyncHandler } from "../utils/async-handler";
import { getRecentNotifications } from "../services/notification.service";
import {
  archiveAppNotification,
  countUnreadBySeverity,
  listAppNotifications,
  markAllAppNotificationsRead,
  markAppNotificationRead,
} from "../services/app-notification.service";

/**
 * How far back the unread count looks. The badge prints «99+» past 99, so
 * counting further than this would be work nobody sees.
 */
const UNREAD_WINDOW = 100;

export const getRecent = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  // Pass the viewer so STAFF never receives sensitive (financial / destructive /
  // below-cost / negative-stock) notifications; only ADMIN sees the full feed.
  const window = await getRecentNotifications(Math.max(limit, UNREAD_WINDOW), { role: req.user?.role });

  // «Seen» is the SERVER's, per user. The bell used to count against a
  // timestamp in each browser's localStorage — every device had its own, so
  // each showed a different number and none of them was right. And it counted
  // only the 30 rows it had fetched, so it could never pass 30.
  let seenAt: Date | null = null;
  if (req.user?.id) {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { notificationsSeenAt: true } });
    seenAt = user?.notificationsSeenAt ?? null;
    if (!seenAt) {
      // First visit after this shipped: start from now, rather than greeting
      // the owner with «99+» for everything that ever happened.
      seenAt = new Date();
      await prisma.user.update({ where: { id: req.user.id }, data: { notificationsSeenAt: seenAt } }).catch(() => undefined);
    }
  }
  const unreadCount = seenAt
    ? window.filter((n) => new Date(n.createdAt).getTime() > seenAt!.getTime()).length
    : 0;

  // `data` stays the plain array it always was: the desktop and Android
  // clients read it as-is. The count and the marker travel beside it.
  res.json({ success: true, data: window.slice(0, limit), unreadCount, seenAt });
});

/** Clear the «عادي» panel for this user — on every device at once. */
export const markRecentSeen = asyncHandler(async (req, res) => {
  const seenAt = new Date();
  if (req.user?.id) {
    await prisma.user.update({ where: { id: req.user.id }, data: { notificationsSeenAt: seenAt } });
  }
  res.json({ success: true, data: { seenAt } });
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
