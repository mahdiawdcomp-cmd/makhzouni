import { Prisma } from "@prisma/client";
import prisma from "../config/database";

// Accepts either the base client or an active transaction client, so producers
// can create a notification atomically inside their own $transaction.
type NotificationDb = typeof prisma | Prisma.TransactionClient;

/**
 * In-app notification foundation (batch 23B).
 *
 * IMPORTANT: this service is NOT called by any producer yet (invoice/whatsapp/
 * transfer/stock). Wiring comes in later batches (23D+). It must not run against
 * production before its migration (`app_notifications` table) is applied, otherwise
 * the query would fail on a missing table.
 */

export interface CreateAppNotificationInput {
  type: string;
  category: string;
  severity: string;
  title: string;
  message: string;
  /** "ADMIN" | "STAFF" | "ALL" — role fan-out target. */
  roleTarget?: string | null;
  /** Single-user target; takes precedence over roleTarget when set. */
  recipientUserId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actionUrl?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  /** Dedupe grouping key. When set, repeats bump `count` instead of new rows. */
  dedupeKey?: string | null;
}

/**
 * Builds the canonical dedupe key: `type:entityId:YYYY-MM-DD`. Repeats of the same
 * problem on the same entity within a calendar day collapse into one row + count.
 */
export function buildDedupeKey(
  type: string,
  entityId?: string | null,
  when: Date = new Date(),
): string {
  const dayBucket = when.toISOString().slice(0, 10);
  return `${type}:${entityId ?? "-"}:${dayBucket}`;
}

/**
 * Create a notification, or (when `dedupeKey` is provided and a non-archived row
 * with that key already exists) bump the existing row's `count` and refresh its
 * text/severity instead of inserting a duplicate.
 */
export async function createAppNotification(
  input: CreateAppNotificationInput,
  db: NotificationDb = prisma,
) {
  if (input.dedupeKey) {
    const existing = await db.appNotification.findFirst({
      where: { dedupeKey: input.dedupeKey, archivedAt: null },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      return db.appNotification.update({
        where: { id: existing.id },
        data: {
          count: { increment: 1 },
          // Refresh the surfaced text/severity to the latest occurrence.
          title: input.title,
          message: input.message,
          severity: input.severity,
          ...(input.metadata != null ? { metadata: input.metadata } : {}),
          // A bumped notification is a fresh event again → resurface as unread.
          readAt: null,
        },
      });
    }
  }

  return db.appNotification.create({
    data: {
      type: input.type,
      category: input.category,
      severity: input.severity,
      title: input.title,
      message: input.message,
      roleTarget: input.roleTarget ?? null,
      recipientUserId: input.recipientUserId ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      actionUrl: input.actionUrl ?? null,
      ...(input.metadata != null ? { metadata: input.metadata } : {}),
      dedupeKey: input.dedupeKey ?? null,
    },
  });
}
