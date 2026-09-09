import prisma from "../config/database";
import { runWholesalePublish, checkPublishedStockAlerts } from "./wholesale-instagram.service";

// «إنستغرام الجملة» — per-minute tick. Runs as its OWN cron.schedule entry
// (see notification-jobs.service.ts), completely separate from the retail
// Instagram queue's tick (runInstagramQueueTick in instagram-queue.service.ts,
// which this file never imports or calls).
//
// Each due post is claimed with an atomic conditional UPDATE before anything
// else happens — see claimPost() in wholesale-instagram.service.ts. That is
// what makes this tick safe to run from more than one server instance, or to
// have this exact function invoked twice in the same minute by mistake: only
// one claim can ever succeed for a given post.

async function claimDuePost(id: string): Promise<boolean> {
  const res = await prisma.wholesaleInstagramPost.updateMany({
    where: { id, status: "SCHEDULED" },
    data: { status: "PUBLISHING", attemptCount: { increment: 1 } },
  });
  return res.count === 1;
}

export async function runWholesaleInstagramQueueTick() {
  const due = await prisma.wholesaleInstagramPost.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
    select: { id: true },
    orderBy: { scheduledAt: "asc" },
    take: 50, // safety cap — a normal shop schedules a handful of posts a day
  });

  for (const { id } of due) {
    try {
      const claimed = await claimDuePost(id);
      if (!claimed) continue; // another worker/tick already took it
      await runWholesalePublish(id);
    } catch (error) {
      console.error("[wholesale-instagram-queue] tick failed for post", id, error);
    }
  }

  // Same minute, same tick: flag any already-PUBLISHED post whose product
  // just ran out, so it surfaces on the page instead of silently staying
  // live forever. Runs regardless of whether anything was due above.
  try {
    await checkPublishedStockAlerts();
  } catch (error) {
    console.error("[wholesale-instagram-queue] stock-alert check failed", error);
  }
}
