// بند ٩ من خطة قمع الواتساب — حماية جودة الرقم. وقائي بالكامل: أي هبوط
// بالتقييم أو حالة سلبية جديدة يوقف كل الحملات الجارية تلقائياً + تنبيه فوري،
// وتبقى متوقفة حتى المستخدم يفتحها يدوياً بنفسه (بقرار صريح — ما نعيد
// التشغيل تلقائياً حتى لو رجعت الجودة، تجنباً لتشغيل قبل التأكد الفعلي).
//
// مسارَي اكتشاف مستقلَّين يلتقيان بنفس نقطة الفعل (pauseCampaignsAndAlert):
// - webhook فوري (phone_number_quality_update / account_update) — يحمل
//   حدث صريح من Meta (event: "FLAGGED"، أو أي account_update أصلاً)، ما
//   يحتاج مقارنة بحالة سابقة.
// - استعلام يومي احتياطي (Graph API quality_rating GREEN/YELLOW/RED) —
//   يحتاج مقارنة بآخر حالة معروفة لاكتشاف هبوط تدريجي الـwebhook فاته.
import { CampaignStatus } from "@prisma/client";
import prisma from "../config/database";
import { logger } from "../utils/logger";
import { AppError } from "../utils/app-error";
import { getSettings, updateSettings } from "./settings.service";
import { fetchPhoneNumberQualityStatus, sendWhatsAppText } from "./whatsapp.service";
import { notifyAdmin, buildDedupeKey } from "./app-notification.service";
import { NotificationType, NotificationCategory, NotificationSeverity } from "../constants/notifications";

// أعلى = أفضل. تقييم غير معروف (undefined أو قيمة ما نعرفها) يُستبعد من
// المقارنة بدل ما يُعامل كهبوط وهمي.
const QUALITY_RANK: Record<string, number> = { GREEN: 3, YELLOW: 2, RED: 1 };

// أي حالة غير CONNECTED تقريباً تستاهل وقف وقائي — القائمة الموجبة (CONNECTED)
// أوضح وأقصر من قائمة كل الحالات السلبية الممكنة (وMeta تزيد حالات أحياناً).
const HEALTHY_STATUSES = new Set(["CONNECTED"]);

/** يوقف كل الحملات الجارية + تنبيه فوري (تطبيق + واتساب أفضل-جهد). */
async function pauseCampaignsAndAlert(reason: string) {
  const settings = await getSettings().catch(() => null);

  const paused = await prisma.campaign.updateMany({
    where: { status: CampaignStatus.RUNNING },
    data: { status: CampaignStatus.PAUSED },
  });

  const summary = `🚨 ${reason} أُوقفت ${paused.count} حملة تلقائياً وتبقى متوقفة لحد ما تفتحها يدوياً بعد التأكد.`;

  await notifyAdmin({
    type: NotificationType.SYSTEM_ERROR,
    category: NotificationCategory.SYSTEM,
    severity: NotificationSeverity.IMPORTANT,
    title: "🚨 مشكلة برقم الواتساب — الحملات أُوقفت",
    message: summary,
    entityType: "WHATSAPP_QUALITY",
    entityId: "quality",
    actionUrl: "/campaigns",
    // مبني على تاريخ اليوم فقط (بلا سبب بالمفتاح) — عمداً: أول اكتشاف بأي
    // يوم يكفي للتنبيه، والحملات أصلاً متوقفة فما فيه داعٍ لتنبيهات متكررة
    // نفس اليوم حتى لو الهبوط استمر أو تكرر بسبب مختلف.
    dedupeKey: buildDedupeKey("WHATSAPP_QUALITY_DEGRADED", "quality"),
  }).catch(() => {});

  // محاولة أفضل-جهد عبر واتساب نفسه — ممكن يضل يشتغل لحالات أقل حدّة
  // (YELLOW مثلاً)، وإن فشل فالتنبيه بالتطبيق أعلاه هو المصدر الموثوق دايماً.
  const adminPhone = settings?.adminApprovalWhatsappNumber?.trim() || settings?.storePhone?.trim();
  if (adminPhone) {
    await sendWhatsAppText(adminPhone, summary).catch(() => {});
  }

  logger.warn(`[WhatsAppQuality] ${summary}`);
  return { degraded: true as const, pausedCount: paused.count };
}

async function persistLastKnownState(nextRating: string | undefined, nextStatus: string | undefined) {
  const settings = await getSettings().catch(() => null);
  await updateSettings({
    whatsappLastQualityRating: nextRating ?? settings?.whatsappLastQualityRating,
    whatsappLastPhoneStatus: nextStatus ?? settings?.whatsappLastPhoneStatus,
    whatsappQualityCheckedAt: new Date().toISOString(),
  }).catch((err) =>
    logger.warn(`[WhatsAppQuality] failed to persist state: ${err instanceof Error ? err.message : String(err)}`),
  );
  return { prevRating: settings?.whatsappLastQualityRating, prevStatus: settings?.whatsappLastPhoneStatus };
}

/**
 * مسار الاستعلام اليومي — تقييم GREEN/YELLOW/RED + حالة الرقم، تُقارَن بآخر
 * حالة معروفة. أي هبوط بالترتيب أو انتقال لحالة غير سليمة يوقف الحملات.
 */
export async function handlePossibleQualityChange(
  nextRating: string | undefined,
  nextStatus: string | undefined,
) {
  const { prevRating, prevStatus } = await persistLastKnownState(nextRating, nextStatus);

  const ratingDropped =
    !!prevRating && !!nextRating &&
    QUALITY_RANK[prevRating] !== undefined && QUALITY_RANK[nextRating] !== undefined &&
    QUALITY_RANK[nextRating] < QUALITY_RANK[prevRating];
  // !!prevStatus بنفس منطق ratingDropped أعلاه — أول فحص بحياة المستأجر ما
  // عنده حالة سابقة، فحالة سلبية بأول فحص (مثلاً PENDING أثناء ربط الرقم
  // الجديد) لازم ما تُعامل كهبوط وهمي.
  const statusTurnedBad = !!prevStatus && !!nextStatus && !HEALTHY_STATUSES.has(nextStatus) && nextStatus !== prevStatus;

  if (!ratingDropped && !statusTurnedBad) return { degraded: false as const };

  return pauseCampaignsAndAlert(
    `هبوط بجودة رقم الواتساب: ${prevRating ?? "غير معروف"} ← ${nextRating ?? "غير معروف"}` +
      (nextStatus && nextStatus !== "CONNECTED" ? ` (الحالة: ${nextStatus})` : "") + ".",
  );
}

/**
 * مسار الـwebhook الفوري لـ`phone_number_quality_update`. الحمولة تحمل
 * `event` صريح من Meta (FLAGGED = هبوط، ONBOARDING/THROUGHPUT_UPGRADE =
 * طبيعي) — لا حاجة لمقارنة رتب هنا، Meta تخبرنا مباشرة.
 */
export async function handleQualityWebhookEvent(event: string | undefined, currentLimit: string | undefined) {
  const flagged = event === "FLAGGED";
  // نسجّل "FLAGGED" كحالة صريحة عند الهبوط، مو undefined — حتى بانر الواجهة
  // ما يضل عارض آخر حالة سليمة معروفة بعد حادثة حقيقية أوقفت الحملات فعلاً.
  await persistLastKnownState(undefined, flagged ? "FLAGGED" : undefined);
  if (!flagged) return { degraded: false as const };
  return pauseCampaignsAndAlert(`Meta أبلغت عن مشكلة برقم الواتساب (${event}${currentLimit ? `، الحد الحالي: ${currentLimit}` : ""}).`);
}

/**
 * مسار الـwebhook الفوري لـ`account_update` — أي حدث هنا أصلاً تحذير أو
 * تقييد من Meta (per توثيقهم)، فلا حاجة لتصنيف إضافي.
 */
export async function handleAccountRestrictionEvent(violationType: string | undefined) {
  await persistLastKnownState(undefined, "RESTRICTED");
  return pauseCampaignsAndAlert(`Meta وضعت تقييداً/تحذيراً على حساب الواتساب${violationType ? ` (${violationType})` : ""}.`);
}

export async function runWhatsAppQualityCheckJob() {
  let result: { quality_rating?: string; status?: string };
  try {
    result = await fetchPhoneNumberQualityStatus();
  } catch (err) {
    // غير مهيّأ أصلاً (مزوّد غير Cloud API، أو ما ضُبط بعد) — ليس خطأ يستاهل
    // تسجيل بصفحة الأخطاء، بس best-effort صامت. أي خطأ ثاني (توكن منتهي،
    // Graph API نازل، rate limit) لازم يوصل للـcaller (reportCronFailure)
    // بدل ما ينبلع بصمت — والا الشبكة الوقائية كلها تنعطل بلا أي تنبيه.
    if (err instanceof AppError && err.code === "WHATSAPP_CLOUD_NOT_CONFIGURED") {
      logger.info(`[WhatsAppQuality] skipped daily check: ${err.message}`);
      return { skipped: true };
    }
    throw err;
  }
  return handlePossibleQualityChange(result.quality_rating, result.status);
}
