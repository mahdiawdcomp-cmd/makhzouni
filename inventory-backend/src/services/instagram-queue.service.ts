import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { publishPost } from "./instagram.service";

// Scheduled Instagram queues (Phase 7, locked decisions):
// - one account per queue, up to 50 products, sequential order
// - schedule fully admin-configurable: fixed Baghdad clock times OR interval
// - queue stops (DONE) when exhausted — never loops, never re-posts.
// Tick runs every minute from notification-jobs (same infra as campaigns).

const BAGHDAD_TZ = "Asia/Baghdad";
export const MAX_QUEUE_ITEMS = 50;

function baghdadNow(): { dayKey: string; hhmm: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BAGHDAD_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { dayKey: `${get("year")}-${get("month")}-${get("day")}`, hhmm: `${get("hour")}:${get("minute")}` };
}

export type QueueScheduleInput = {
  scheduleType: "FIXED_TIMES" | "INTERVAL";
  times?: string[];
  intervalMinutes?: number;
  postsPerDay: number;
};

function validateSchedule(input: QueueScheduleInput) {
  if (input.postsPerDay < 1 || input.postsPerDay > 100) {
    throw new AppError("عدد المنشورات باليوم يجب أن يكون بين 1 و 100", 400, "INVALID_POSTS_PER_DAY");
  }
  if (input.scheduleType === "FIXED_TIMES") {
    const times = input.times ?? [];
    if (!times.length) throw new AppError("حدد وقت نشر واحد على الأقل", 400, "TIMES_REQUIRED");
    for (const t of times) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new AppError(`صيغة وقت غير صالحة: ${t}`, 400, "INVALID_TIME");
    }
  } else if (!input.intervalMinutes || input.intervalMinutes < 15) {
    throw new AppError("أقل فاصل زمني مسموح 15 دقيقة", 400, "INVALID_INTERVAL");
  }
}

export async function createQueue(input: QueueScheduleInput & { accountId: string; name?: string; createdById?: string }) {
  validateSchedule(input);
  const account = await prisma.instagramAccount.findUnique({ where: { id: input.accountId } });
  if (!account || account.status !== "connected") {
    throw new AppError("اختر حساب انستغرام مربوط وفعال", 400, "IG_ACCOUNT_NOT_CONNECTED");
  }
  return prisma.instagramQueue.create({
    data: {
      accountId: input.accountId,
      name: input.name,
      scheduleType: input.scheduleType,
      times: input.times ?? [],
      intervalMinutes: input.intervalMinutes,
      postsPerDay: input.postsPerDay,
      createdById: input.createdById,
    },
  });
}

export async function updateQueue(id: string, patch: Partial<QueueScheduleInput> & { status?: "ACTIVE" | "PAUSED"; name?: string }) {
  const queue = await prisma.instagramQueue.findUnique({ where: { id } });
  if (!queue) throw new AppError("الطابور غير موجود", 404, "QUEUE_NOT_FOUND");
  if (patch.scheduleType || patch.times || patch.intervalMinutes || patch.postsPerDay) {
    validateSchedule({
      scheduleType: (patch.scheduleType ?? queue.scheduleType) as "FIXED_TIMES" | "INTERVAL",
      times: patch.times ?? queue.times,
      intervalMinutes: patch.intervalMinutes ?? queue.intervalMinutes ?? undefined,
      postsPerDay: patch.postsPerDay ?? queue.postsPerDay,
    });
  }
  return prisma.instagramQueue.update({
    where: { id },
    data: {
      name: patch.name,
      status: patch.status,
      scheduleType: patch.scheduleType,
      times: patch.times,
      intervalMinutes: patch.intervalMinutes,
      postsPerDay: patch.postsPerDay,
    },
  });
}

export async function deleteQueue(id: string) {
  // Keep post history: queued (unpublished) items go back to DRAFT.
  await prisma.instagramPost.updateMany({ where: { queueId: id, status: "QUEUED" }, data: { status: "DRAFT" } });
  await prisma.instagramQueue.delete({ where: { id } });
}

export async function listQueues() {
  const queues = await prisma.instagramQueue.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      account: { select: { username: true, profilePictureUrl: true, status: true } },
      _count: { select: { posts: true } },
    },
  });
  const pendingCounts = await prisma.instagramPost.groupBy({
    by: ["queueId"],
    where: { queueId: { in: queues.map((q) => q.id) }, status: "QUEUED" },
    _count: true,
  });
  const pendingMap = new Map(pendingCounts.map((p) => [p.queueId, p._count]));
  return queues.map((q) => ({ ...q, pendingCount: pendingMap.get(q.id) ?? 0 }));
}

export async function addPostToQueueGuard(queueId: string, accountId: string) {
  const queue = await prisma.instagramQueue.findUnique({
    where: { id: queueId },
    include: { _count: { select: { posts: { where: { status: "QUEUED" } } } } },
  });
  if (!queue) throw new AppError("الطابور غير موجود", 404, "QUEUE_NOT_FOUND");
  if (queue.accountId !== accountId) {
    // Locked decision: one account per queue, never mixed.
    throw new AppError("هذا الطابور مرتبط بحساب انستغرام آخر — لا يمكن خلط الحسابات بطابور واحد", 400, "QUEUE_ACCOUNT_MISMATCH");
  }
  if (queue._count.posts >= MAX_QUEUE_ITEMS) {
    throw new AppError(`الحد الأقصى ${MAX_QUEUE_ITEMS} منتج بالطابور الواحد`, 400, "QUEUE_FULL");
  }
  if (queue.status === "DONE") {
    await prisma.instagramQueue.update({ where: { id: queueId }, data: { status: "ACTIVE" } });
  }
  return queue;
}

/** Per-minute cron tick. Cheap when idle (single indexed count). */
export async function runInstagramQueueTick() {
  const queues = await prisma.instagramQueue.findMany({
    where: { status: "ACTIVE" },
    include: { account: { select: { status: true } } },
  });
  if (!queues.length) return;
  const now = baghdadNow();

  for (const queue of queues) {
    try {
      // Daily counter reset on Baghdad-day change.
      if (queue.todayKey !== now.dayKey) {
        await prisma.instagramQueue.update({
          where: { id: queue.id },
          data: { todayKey: now.dayKey, publishedToday: 0 },
        });
        queue.publishedToday = 0;
      }
      if (queue.publishedToday >= queue.postsPerDay) continue;
      if (queue.account.status !== "connected") continue;

      let due = false;
      if (queue.scheduleType === "FIXED_TIMES") {
        due = queue.times.includes(now.hhmm);
      } else if (queue.intervalMinutes) {
        due =
          !queue.lastPublishedAt ||
          Date.now() - queue.lastPublishedAt.getTime() >= queue.intervalMinutes * 60 * 1000;
      }
      if (!due) continue;

      const next = await prisma.instagramPost.findFirst({
        where: { queueId: queue.id, status: "QUEUED" },
        orderBy: { position: "asc" },
      });
      if (!next) {
        // Exhausted → DONE and wait for an explicit new batch (locked: no looping).
        await prisma.instagramQueue.update({ where: { id: queue.id }, data: { status: "DONE" } });
        continue;
      }

      await prisma.instagramQueue.update({
        where: { id: queue.id },
        data: { publishedToday: { increment: 1 }, lastPublishedAt: new Date(), todayKey: now.dayKey },
      });
      await publishPost(next.id);
    } catch (error) {
      console.error("[instagram-queue] tick failed for queue", queue.id, error);
    }
  }
}
