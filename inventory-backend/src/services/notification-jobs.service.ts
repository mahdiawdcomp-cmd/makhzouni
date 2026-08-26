import cron from "node-cron";
import fs from "node:fs";
import path from "node:path";
import prisma from "../config/database";
import { getSettings } from "./settings.service";
import { renderTemplateByType } from "./message-template.service";
import { sendWhatsAppText } from "./whatsapp.service";
import { getDailySummaryData } from "./report.service";
import {
  buildHeavySnapshot,
  buildBasketSnapshot,
  assistantTimezone,
} from "./daily-assistant.service";
import { processCampaignsTick } from "./campaign.service";
import { cleanupOldErrorLogs, recordError } from "./error-log.service";
import { runScheduledCycleCountJob } from "./cycle-count.service";
import { runPersonalDebtReminderJob } from "./personal-debt.service";
import { runRatingRequestJob } from "./product-review.service";
import { runCouponExpiryReminderJob } from "./first-order-coupon.service";
import { runWhatsAppQualityCheckJob } from "./whatsapp-quality.service";
import { runNoReplyFollowUpJob, runRegisteredNoOrderFollowUpJob, runInactiveFollowUpJob, runTierNudgeJob } from "./follow-up.service";
import { runAbandonedCartCheckJob } from "./catalog-tracking.service";
import { runInstagramQueueTick } from "./instagram-queue.service";
import {
  runTelegramChannelSyncTick,
  runDailyChannelRotationJob,
  runFeaturedProductRotationJob,
} from "./telegram-channel.service";
import { runTelegramBroadcastTick } from "./telegram-broadcast.service";
import { runDailyDigestJob } from "./telegram-digest.service";
import { notifyAdmin, buildDedupeKey } from "./app-notification.service";
import {
  NotificationType,
  NotificationCategory,
  NotificationSeverity,
} from "../constants/notifications";
import { backendPublicUrl } from "../utils/public-urls";
import { balanceForCustomer } from "./whatsapp.service";

// node-cron evaluates every expression in UTC unless told otherwise, and the
// container sets no TZ. So "0 10 * * *" — the debt reminder — was firing at
// 13:00 in Baghdad, the 09:00 digest at noon, and a late-evening summary would
// land after midnight and be filed under the wrong day. Every schedule below is
// meant as SHOP local time, which is the same clock the reports now bucket by.
const CRON_OPTIONS = { timezone: assistantTimezone() } as const;

/** Cron catch helper: keep the console.error AND surface the failure on /error-logs. */
function reportCronFailure(job: string, error: unknown) {
  console.error(`${job} failed`, error);
  const errMessage = error instanceof Error ? error.message : String(error);
  void recordError({
    source: "CRON",
    code: job,
    message: errMessage,
  });

  // Also surface as an IMPORTANT in-app notification for the manager. Backup jobs
  // get their own type. Deduped per job+day so a repeatedly-failing minute cron
  // (e.g. campaign tick) becomes one notification with a count, not hundreds.
  const isBackup = job.toUpperCase().includes("BACKUP");
  void notifyAdmin({
    type: isBackup ? NotificationType.BACKUP_FAILED : NotificationType.SYSTEM_ERROR,
    category: NotificationCategory.SYSTEM,
    severity: NotificationSeverity.IMPORTANT,
    title: isBackup ? "فشل النسخ الاحتياطي" : "خطأ في النظام",
    message: `فشلت المهمة «${job}»: ${errMessage}`.slice(0, 300),
    entityType: "CRON",
    entityId: job,
    actionUrl: "/error-logs",
    metadata: { job },
    dedupeKey: buildDedupeKey(isBackup ? NotificationType.BACKUP_FAILED : NotificationType.SYSTEM_ERROR, job),
  }).catch(() => {});
}

let jobsStarted = false;

function daysBetween(date: Date, now = new Date()) {
  return Math.floor((now.getTime() - date.getTime()) / 86400000);
}

function cutoffDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

// Alert-only — never sends WhatsApp automatically. Overdue debts are
// surfaced here as an in-app notification only; the actual send happens on
// demand from the "لوحة الديون" tab (فردي button or bulk select), which the
// shop owner triggers themselves so it never turns into an unbounded daily
// re-send to the same non-paying customer.
export async function runDebtReminderJob() {
  const settings = await getSettings();
  const cutoff = cutoffDate(settings.debtReminderDays);
  const customers = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      currentBalance: { gt: 0 },
      OR: [{ lastTransactionAt: null }, { lastTransactionAt: { lte: cutoff } }],
    },
  });

  for (const customer of customers) {
    const daysLate = daysBetween(customer.lastTransactionAt ?? customer.createdAt);
    const message = await renderTemplateByType("DEBT_REMINDER", {
      customerName: customer.name,
      // Formatted + direction word, matching the manual send from the debts /
      // inactive tabs. A raw Number produced "1250000" in the message body.
      amount: balanceForCustomer(customer.currentBalance),
      daysLate,
      storeName: settings.storeName,
      date: new Date().toLocaleDateString(),
    });

    await prisma.notification.create({
      data: {
        customerId: customer.id,
        type: "DEBT_REMINDER",
        message,
        sentAt: null,
      },
    });
  }

  return {
    checked: customers.length,
  };
}

// Alert-only, same reasoning as runDebtReminderJob above — the send happens
// on demand from the "الزبائن غير النشطين" tab, never automatically.
export async function runInactiveCustomerJob() {
  const settings = await getSettings();
  const cutoff = cutoffDate(settings.inactiveCustomerDays);
  const customers = await prisma.customer.findMany({
    where: {
      deletedAt: null,
      OR: [{ lastTransactionAt: null }, { lastTransactionAt: { lte: cutoff } }],
    },
  });

  for (const customer of customers) {
    const inactiveDays = daysBetween(customer.lastTransactionAt ?? customer.createdAt);
    const message = await renderTemplateByType("INACTIVE_CUSTOMER", {
      customerName: customer.name,
      // Formatted + direction word, matching the manual send from the debts /
      // inactive tabs. A raw Number produced "1250000" in the message body.
      amount: balanceForCustomer(customer.currentBalance),
      invoiceNumber: "",
      daysLate: inactiveDays,
      storeName: settings.storeName,
      date: new Date().toLocaleDateString(),
    });

    await prisma.notification.create({
      data: {
        customerId: customer.id,
        type: "INACTIVE_CUSTOMER",
        message,
        sentAt: null,
      },
    });
  }

  return {
    checked: customers.length,
  };
}

/** ----------------------------------------------------------------
 *  Weekly backup job
 *  - Runs every Sunday at 02:00 AM
 *  - Dumps products, customers, invoices, vouchers to JSON
 *  - Saves to BACKUP_DIR (env var, defaults to ./backups/)
 *  - If ENABLE_WHATSAPP=true AND backupWhatsappNumber is set in settings,
 *    sends a summary message to that number.
 * ----------------------------------------------------------------*/
export async function runWeeklyBackup() {
  const settings = await getSettings();
  const now = new Date();
  const tag = now.toISOString().slice(0, 10);

  const [products, customers, invoices, vouchers] = await Promise.all([
    prisma.product.findMany({ where: { deletedAt: null } }),
    prisma.customer.findMany({ where: { deletedAt: null } }),
    prisma.invoice.findMany({
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
    prisma.paymentVoucher.findMany({ orderBy: { createdAt: "desc" }, take: 5000 }),
  ]);

  const backup = {
    exportedAt: now.toISOString(),
    storeName: settings.storeName,
    counts: {
      products: products.length,
      customers: customers.length,
      invoices: invoices.length,
      vouchers: vouchers.length,
    },
    products,
    customers,
    invoices,
    vouchers,
  };

  // ── Save to folder ──────────────────────────────────────────
  const backupDir = process.env.BACKUP_DIR
    ? path.resolve(process.env.BACKUP_DIR)
    : path.join(process.cwd(), "backups");

  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const filename = path.join(backupDir, `backup-${tag}.json`);
    fs.writeFileSync(filename, JSON.stringify(backup, null, 2), "utf-8");
    console.log(`[backup] Saved: ${filename}`);

    // Keep only the last 8 weekly backups to avoid disk bloat
    const files = fs.readdirSync(backupDir)
      .filter((f) => f.startsWith("backup-") && f.endsWith(".json"))
      .sort();
    while (files.length > 8) {
      const old = files.shift()!;
      fs.unlinkSync(path.join(backupDir, old));
    }
  } catch (err) {
    console.error("[backup] Failed to write file:", err);
  }

  // ── WhatsApp summary (optional) ─────────────────────────────
  if (process.env.ENABLE_WHATSAPP === "true") {
    const ownerPhone = settings.backupWhatsappNumber;
    if (ownerPhone) {
      const backendUrl = backendPublicUrl();
      const secret = process.env.BACKUP_SECRET ?? "";
      const downloadUrl = `${backendUrl}/api/settings/backup/download?secret=${encodeURIComponent(secret)}`;
      const msg =
        `نسخة احتياطية يومية — ${settings.storeName}\n` +
        `التاريخ: ${tag}\n` +
        `منتجات: ${products.length} — زبائن: ${customers.length}\n` +
        `فواتير: ${invoices.length} — سندات: ${vouchers.length}\n` +
        (secret ? `رابط التحميل:\n${downloadUrl}` : `تم الحفظ على السيرفر`);
      await sendWhatsAppText(ownerPhone, msg).catch((e) =>
        console.warn("[backup] WhatsApp send failed:", e)
      );
    }
  }

  return backup.counts;
}

export async function runDailySummaryJob(force = false) {
  const settings = await getSettings();
  const data = await getDailySummaryData();
  const currency = settings.currency || "IQD";

  function fmt(n: number) {
    return n.toLocaleString("ar-IQ");
  }

  const changeStr =
    data.salesChangePercent !== null
      ? ` (${data.salesChangePercent >= 0 ? "+" : ""}${data.salesChangePercent}% عن أمس)`
      : "";

  const lines: string[] = [
    `📊 *ملخص اليوم — ${data.date}*\n`,
    `✅ المبيعات: ${fmt(data.todaySales)} ${currency}${changeStr}`,
  ];

  if (data.topProduct) {
    lines.push(`📦 أكثر منتج باع: ${data.topProduct.name} (${data.topProduct.quantity} وحدة)`);
  }

  if (data.lowStockCount > 0) {
    const extra = data.lowStockNames.length > 0 ? `: ${data.lowStockNames.join("، ")}` : "";
    lines.push(`⚠️ ${data.lowStockCount} منتج على وشك النفاد${extra}`);
  }

  lines.push(`💰 تحصيلات اليوم: ${fmt(data.collectionsToday)} ${currency}`);

  if (data.mostOverdueCustomer) {
    lines.push(
      `🔴 ديون متأخرة: ${data.mostOverdueCustomer.name} (${data.mostOverdueCustomer.daysLate} يوم)`
    );
  }

  if (data.smartTip) {
    lines.push(`💡 ${data.smartTip}`);
  }

  const message = lines.join("\n");

  let sentAt: Date | null = null;
  let whatsappResult = "لم يُرسل";

  const phone = settings.dailySummaryWhatsappNumber;
  const waEnabled = process.env.ENABLE_WHATSAPP === "true";
  const shouldSend = (force || settings.autoSendDailySummary) && !!phone;

  if (!waEnabled) {
    whatsappResult = "ENABLE_WHATSAPP غير مفعّل على السيرفر";
  } else if (!phone) {
    whatsappResult = "رقم الواتساب غير محفوظ في الإعدادات";
  } else if (shouldSend) {
    try {
      await sendWhatsAppText(phone, message);
      sentAt = new Date();
      whatsappResult = `✓ أُرسل إلى ${phone}`;
    } catch (e) {
      whatsappResult = `فشل الإرسال: ${e instanceof Error ? e.message : String(e)}`;
      console.warn("[daily-summary] WhatsApp send failed:", e);
    }
  }

  await prisma.notification.create({
    data: { type: "DAILY_SUMMARY", message, sentAt },
  });

  return { message, whatsappResult };
}

/** Current hour (0-23) + weekday (0=Sun) in the shop timezone. */
function nowInAssistantTz(): { hour: number; weekday: number } {
  const tz = assistantTimezone();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const wdName = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wdName);
  return { hour, weekday };
}

/**
 * Daily Smart Assistant heavy snapshot — rebuilds the sleeping/frozen-capital/
 * reorder/spike indicators for TODAY (shop timezone). Idempotent (upsert on
 * kind+periodKey) so a re-run never duplicates rows. Failure is swallowed by the
 * caller's reportCronFailure; the assistant falls back to the last valid snapshot.
 */
export async function runDailyAssistantSnapshotJob() {
  return buildHeavySnapshot();
}

/** Weekly bought-together basket analysis — low-usage, idempotent per ISO week. */
export async function runWeeklyBasketJob() {
  return buildBasketSnapshot();
}

export function startNotificationJobs() {
  if (jobsStarted) return;
  jobsStarted = true;

  // Daily Smart Assistant heavy snapshot — hourly check, fires once at 06:00
  // local shop time. Timezone-aware so it doesn't drift with the UTC server.
  cron.schedule("0 * * * *", () => {
    if (nowInAssistantTz().hour !== 6) return;
    runDailyAssistantSnapshotJob().catch((error) => {
      reportCronFailure("DAILY_ASSISTANT_SNAPSHOT", error);
    });
  }, CRON_OPTIONS);

  // Weekly basket analysis — Friday 04:00 local (low usage). Idempotent per week.
  cron.schedule("0 * * * *", () => {
    const { hour, weekday } = nowInAssistantTz();
    if (weekday !== 5 || hour !== 4) return;
    runWeeklyBasketJob().catch((error) => {
      reportCronFailure("WEEKLY_BASKET_ANALYSIS", error);
    });
  }, CRON_OPTIONS);

  cron.schedule("0 10 * * *", () => {
    runDebtReminderJob().catch((error) => {
      reportCronFailure("DEBT_REMINDER", error);
    });
  }, CRON_OPTIONS);

  cron.schedule("0 9 * * *", () => {
    runInactiveCustomerJob().catch((error) => {
      reportCronFailure("INACTIVE_CUSTOMER", error);
    });
  }, CRON_OPTIONS);

  // «الديون الشخصية» — daily at 09:30, independent of the customer debt
  // reminder above (unrelated feature, see personal-debt.service.ts).
  cron.schedule("30 9 * * *", () => {
    runPersonalDebtReminderJob().catch((error) => {
      reportCronFailure("PERSONAL_DEBT_REMINDER", error);
    });
  }, CRON_OPTIONS);

  // «قيّم مشترياتك» — daily at 11:00, independent of the other jobs.
  cron.schedule("0 11 * * *", () => {
    runRatingRequestJob().catch((error) => {
      reportCronFailure("PRODUCT_RATING_REQUEST", error);
    });
  }, CRON_OPTIONS);

  // بند ٩ — استعلام احتياطي لجودة رقم الواتساب كل ساعة.
  //
  // كان يومياً 07:00، والمشكلة إن عامل الحملات يشتغل كل دقيقة: لو هبط التقييم
  // الساعة 10 صباحاً وما وصل webhook من Meta، تضل الحملات ترسل على رقم متضرر
  // لحد صباح اليوم التالي. كل ساعة تنزّل أسوأ حالة من يوم كامل إلى ساعة،
  // بكلفة 24 استدعاء Graph API باليوم — لا شيء يُذكر مقابل حماية الرقم.
  //
  // الـwebhook يبقى المسار الأساسي والأسرع؛ هذا شبكة أمان تحته.
  cron.schedule("0 * * * *", () => {
    runWhatsAppQualityCheckJob().catch((error) => {
      reportCronFailure("WHATSAPP_QUALITY_CHECK", error);
    });
  }, CRON_OPTIONS);

  // بند ٧ — "تذكير قبل الانتهاء بيوم" لكوبون أول طلب. 13:00 يومياً، خارج
  // أوقات المهام الثقيلة الأخرى (11/12 مشغولتين بمهام التيليگرام).
  cron.schedule("0 13 * * *", () => {
    runCouponExpiryReminderJob().catch((error) => {
      reportCronFailure("FIRST_ORDER_COUPON_REMINDER", error);
    });
  }, CRON_OPTIONS);

  // بند ٨ — ثلاث متابعات تلقائية مستقلة، كل وحدة مطفّاة افتراضياً بمفتاحها
  // الخاص (followUp*Enabled) — الكرون يشتغل دايماً لكن الدالة نفسها ترجع فوراً
  // إذا المفتاح مطفي. مبعثرة زمنياً حتى ما تصير دفعة إرسال وحدة كبيرة.
  cron.schedule("30 13 * * *", () => {
    runNoReplyFollowUpJob().catch((error) => {
      reportCronFailure("FOLLOW_UP_NO_REPLY", error);
    });
  }, CRON_OPTIONS);

  cron.schedule("0 14 * * *", () => {
    runRegisteredNoOrderFollowUpJob().catch((error) => {
      reportCronFailure("FOLLOW_UP_REGISTERED_NO_ORDER", error);
    });
  }, CRON_OPTIONS);

  cron.schedule("30 14 * * *", () => {
    runInactiveFollowUpJob().catch((error) => {
      reportCronFailure("FOLLOW_UP_INACTIVE", error);
    });
  }, CRON_OPTIONS);

  // «كنت قريب» — after the other follow-ups, so a customer who is due several
  // messages does not get them in the same minute. No-op unless the shop
  // turned it on.
  cron.schedule("0 15 * * *", () => {
    runTierNudgeJob().catch((error) => {
      reportCronFailure("FOLLOW_UP_TIER_NUDGE", error);
    });
  }, CRON_OPTIONS);

  // Abandoned catalog checkout — every 15 minutes; no-op unless a session has
  // gone quiet past the timeout in catalog-tracking.service.
  cron.schedule("*/15 * * * *", () => {
    runAbandonedCartCheckJob().catch((error) => {
      reportCronFailure("ABANDONED_CART_CHECK", error);
    });
  }, CRON_OPTIONS);

  // Daily backup — every day at 02:00
  cron.schedule("0 2 * * *", () => {
    runWeeklyBackup().catch((error) => {
      reportCronFailure("DAILY_BACKUP", error);
    });
  }, CRON_OPTIONS);

  // Daily summary — runs every hour, fires only when current hour matches setting (default 21:00)
  cron.schedule("0 * * * *", async () => {
    const settings = await getSettings().catch(() => null);
    const targetHour = settings?.dailySummaryHour ?? 21;
    if (new Date().getHours() === targetHour) {
      runDailySummaryJob().catch((error) => {
        reportCronFailure("DAILY_SUMMARY", error);
      });
    }
  }, CRON_OPTIONS);

  // Drip marketing campaigns — tick every minute. Each running campaign sends
  // at most one message per tick, gated by randomized delay / daily cap / active
  // hours inside the worker (avoids WhatsApp bans).
  cron.schedule("* * * * *", () => {
    processCampaignsTick().catch((error) => {
      reportCronFailure("CAMPAIGN_TICK", error);
    });
  }, CRON_OPTIONS);

  // Instagram scheduled queues («كتلوك المفرد» auto-publish) — tick every
  // minute; cheap when no ACTIVE queue exists. Baghdad-time schedule logic
  // lives in instagram-queue.service.
  cron.schedule("* * * * *", () => {
    runInstagramQueueTick().catch((error) => {
      reportCronFailure("INSTAGRAM_QUEUE_TICK", error);
    });
  }, CRON_OPTIONS);

  // «قناة تيليگرام» — reconcile the public channel with the wholesale catalog
  // every minute; no-op unless enabled + configured in settings. Rate caps and
  // overlap guard live in telegram-channel.service.
  cron.schedule("* * * * *", () => {
    runTelegramChannelSyncTick().catch((error) => {
      reportCronFailure("TELEGRAM_CHANNEL_SYNC", error);
    });
  }, CRON_OPTIONS);

  // Admin broadcast DM blast — small batch per minute, no-op unless a
  // broadcast is SENDING. Rate cap lives in telegram-broadcast.service.
  cron.schedule("* * * * *", () => {
    runTelegramBroadcastTick().catch((error) => {
      reportCronFailure("TELEGRAM_BROADCAST_TICK", error);
    });
  }, CRON_OPTIONS);

  // «وصل حديثاً» daily pinned digest — 09:00 server time, no-op if disabled/
  // unconfigured or nothing new to show. Rate-limit-free (one post/day).
  cron.schedule("0 9 * * *", () => {
    runDailyDigestJob().catch((error) => {
      reportCronFailure("TELEGRAM_DAILY_DIGEST", error);
    });
  }, CRON_OPTIONS);

  // Freshness rotation — republishes the oldest N channel posts daily (11:00)
  // so long-standing in-stock products cycle back to "new" on their own.
  cron.schedule("0 11 * * *", () => {
    runDailyChannelRotationJob().catch((error) => {
      reportCronFailure("TELEGRAM_CHANNEL_ROTATION", error);
    });
  }, CRON_OPTIONS);

  // Featured-product daily pin (12:00, after the rotation job above).
  cron.schedule("0 12 * * *", () => {
    runFeaturedProductRotationJob().catch((error) => {
      reportCronFailure("TELEGRAM_FEATURED_ROTATION", error);
    });
  }, CRON_OPTIONS);

  // ErrorLog retention — daily at 03:15, delete rows older than 90 days.
  cron.schedule("15 3 * * *", () => {
    cleanupOldErrorLogs()
      .then((n) => { if (n > 0) console.log(`[ErrorLog] cleaned ${n} old rows`); })
      .catch((error) => reportCronFailure("ERRORLOG_CLEANUP", error));
  }, CRON_OPTIONS);

  // "جدولة الجرد الذكي" — hourly check. Independent from every job above and
  // from the manual stocktake feature; see cycle-count.service.ts for the
  // interval/duplicate-session guards.
  cron.schedule("0 * * * *", () => {
    runScheduledCycleCountJob().catch((error) => {
      reportCronFailure("SCHEDULED_CYCLE_COUNT", error);
    });
  }, CRON_OPTIONS);

  // Neon DB keep-alive REMOVED (2026-07-01): the database has been migrated to
  // Railway Postgres, which has no Neon-style auto-suspend to work around. This
  // cron was pinging every 4 minutes for nothing — pure wasted CPU/memory churn.
  // Do not re-add unless the DB provider changes back to something with auto-suspend.

  // Keep Railway container alive — HTTP self-ping, but only during configured
  // active hours. Outside that window we let Railway sleep the container, which
  // is the single biggest lever on the Memory usage bill (a sleeping container
  // isn't billed for RAM). This only stops the self-ping cron — it never blocks
  // real incoming requests, which still wake Railway's container normally.
  // Configurable via env so ops can tune it without a redeploy of code:
  //   KEEP_ALIVE_ENABLED     "true"/"false"   default: true
  //   KEEP_ALIVE_START_TIME  "HH:MM"          default: 07:30
  //   KEEP_ALIVE_END_TIME    "HH:MM"          default: 01:00 (wraps past midnight)
  //   KEEP_ALIVE_TIMEZONE    IANA tz name     default: Asia/Baghdad
  //   KEEP_ALIVE_START_HOUR / KEEP_ALIVE_END_HOUR — legacy whole-hour form, still
  //   honored as a fallback when the *_TIME vars above aren't set.
  cron.schedule("*/3 * * * *", () => {
    if (!isKeepAliveWindowActive()) return;
    const base = backendPublicUrl();
    if (!base) return; // no own origin configured — nothing safe to ping
    fetch(`${base}/health`, { signal: AbortSignal.timeout(10_000) })
      .catch(() => {/* silent — just keeping the process warm */});
  }, CRON_OPTIONS);
}

/** Parses "HH:MM" (0-23 : 0-59) into minutes-since-midnight, or undefined if malformed. */
function parseTimeToMinutes(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

/**
 * Resolves the configured keep-alive window as minutes-since-midnight.
 * Prefers KEEP_ALIVE_START_TIME/END_TIME ("HH:MM"); falls back to the legacy
 * KEEP_ALIVE_START_HOUR/END_HOUR (whole hours) so existing Railway configs
 * keep working; otherwise defaults to 07:30–01:00. Returns null on malformed
 * env input so the caller can fail open (stay awake) rather than go dark.
 */
function resolveKeepAliveWindowMinutes(): { startMin: number; endMin: number } | null {
  const startTimeRaw = process.env.KEEP_ALIVE_START_TIME?.trim();
  const endTimeRaw = process.env.KEEP_ALIVE_END_TIME?.trim();
  if (startTimeRaw || endTimeRaw) {
    const startMin = parseTimeToMinutes(startTimeRaw ?? "07:30");
    const endMin = parseTimeToMinutes(endTimeRaw ?? "01:00");
    if (startMin === undefined || endMin === undefined) return null; // malformed → fail open
    return { startMin, endMin };
  }

  const startHourRaw = process.env.KEEP_ALIVE_START_HOUR;
  const endHourRaw = process.env.KEEP_ALIVE_END_HOUR;
  if (startHourRaw !== undefined || endHourRaw !== undefined) {
    const startHour = Number(startHourRaw ?? 8);
    const endHour = Number(endHourRaw ?? 24);
    if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) return null; // malformed → fail open
    return { startMin: startHour * 60, endMin: endHour * 60 };
  }

  return { startMin: 7 * 60 + 30, endMin: 1 * 60 }; // default: 07:30–01:00
}

/** Whether the Railway self-ping should fire right now, per KEEP_ALIVE_* env config. */
function isKeepAliveWindowActive(): boolean {
  const enabled = (process.env.KEEP_ALIVE_ENABLED ?? "true").trim().toLowerCase() !== "false";
  if (!enabled) return false;

  const window = resolveKeepAliveWindowMinutes();
  if (!window) return true; // malformed env → don't silently go dark

  const timezone = process.env.KEEP_ALIVE_TIMEZONE?.trim() || "Asia/Baghdad";
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone }).formatToParts(new Date());
  const hourPart = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minutePart = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const currentMin = (hourPart % 24) * 60 + minutePart; // Intl can return "24" for midnight depending on locale

  const { startMin, endMin } = window;
  if (startMin <= endMin) {
    return currentMin >= startMin && currentMin < endMin;
  }
  // Window wraps past midnight (e.g. 07:30 → 01:00)
  return currentMin >= startMin || currentMin < endMin;
}
