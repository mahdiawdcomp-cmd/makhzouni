// بند ٧ من خطة قمع الواتساب — كوبون ترحيبي أول طلب، يُصدر تلقائياً عند
// الموافقة على زبون جديد ويُرسل ضمن رسالة رمز الدخول نفسها (بدون رسالة
// إضافية). يستخدم موديل PromoCode الموجود أصلاً (مو Coupon — ذاك نظام خصم
// POS منفصل كلياً يديره الموظف، لا علاقة له بهذا).
import { randomBytes } from "crypto";
import { PromoCodeType } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { logger } from "../utils/logger";
import { getSettings } from "./settings.service";
import { sendWhatsAppText } from "./whatsapp.service";
import { isOptedOut } from "./marketing-opt-out.service";
import { createPromoCode } from "./catalog.service";

const FIRST_ORDER_SOURCE = "FIRST_ORDER_WELCOME";

function generateCouponCode(): string {
  return `WELCOME${randomBytes(3).toString("hex").toUpperCase()}`;
}

/**
 * يُستدعى من approval.service.ts فور الموافقة على CATALOG_ACCESS. يرجّع null
 * (بدون رمي استثناء) لو تعذّر إصدار الكوبون — موافقة الزبون لازم تنجح حتى لو
 * فشل الكوبون تحديداً، مو العكس.
 */
export async function issueFirstOrderCoupon(customerId: string, customerName: string) {
  const settings = await getSettings().catch(() => null);
  const percent = settings?.firstOrderCouponPercent ?? 5;
  const durationDays = settings?.firstOrderCouponDurationDays ?? 7;
  const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await createPromoCode({
        code: generateCouponCode(),
        type: PromoCodeType.PERCENT,
        value: percent,
        customerId,
        expiresAt,
        usageLimit: 1,
        description: `كوبون ترحيبي أول طلب — ${customerName}`,
        source: FIRST_ORDER_SOURCE,
      });
    } catch (err) {
      if (err instanceof AppError && err.code === "PROMO_DUPLICATE") continue; // رمز عشوائي تصادم نادراً — أعد المحاولة
      logger.warn(`[FirstOrderCoupon] issue failed for ${customerId}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
  logger.warn(`[FirstOrderCoupon] could not generate a unique code for ${customerId} after 5 attempts`);
  return null;
}

// "تذكير قبل الانتهاء بيوم" — الكرون يشتغل مرة باليوم بنفس وقت الحائط، فأي
// نافذة أضيق من 24 ساعة تفحص **نفس** شريحة الوقت من كل يوم للأبد وتفوّت أي
// كوبون تنتهي صلاحيته خارج تلك الشريحة الثابتة — بق حقيقي انصلح هنا (كانت
// نافذة 20-28 ساعة، أضيق من دورة الكرون 24 ساعة، فتفوّت ثلثي الكوبونات
// بصمت للأبد). النافذة هنا أعرض من 24 ساعة فتضمن كل كوبون يُلتقط بتشغيلة
// وحدة على الأقل قبل ما ينتهي، بلا فجوة — "قبل الانتهاء بيوم" هنا تعني
// تقريبياً (خلال آخر يوم من عمره)، مو 24.000 ساعة بالضبط، وهذا طبيعي لكرون
// يشتغل مرة باليوم فقط. reminderSentAt يمنع التكرار لو التُقط بتشغيلتين.
const REMINDER_WINDOW_MS = 26 * 60 * 60 * 1000;

export async function runCouponExpiryReminderJob() {
  const now = new Date();
  const candidates = await prisma.promoCode.findMany({
    where: {
      source: FIRST_ORDER_SOURCE,
      active: true,
      usedCount: 0,
      reminderSentAt: null,
      customerId: { not: null },
      expiresAt: {
        gte: now,
        lte: new Date(now.getTime() + REMINDER_WINDOW_MS),
      },
    },
    include: { customer: { select: { phone: true } } },
    take: 200,
  });
  if (candidates.length === 0) return { checked: 0, sent: 0 };

  const settings = await getSettings().catch(() => null);
  const link = settings?.catalogPublicUrl?.trim();
  let sent = 0;

  for (const promo of candidates) {
    const phone = promo.customer?.phone;
    // بلا هاتف حقيقي أو موقوف عن التسويق: علّمه كأنه أُرسل حتى ما يُعاد فحصه
    // كل يوم للأبد — احترام «توقف» هنا إلزامي، هذا تسويق مو فاتورة.
    if (!phone || (await isOptedOut(phone))) {
      await prisma.promoCode.update({ where: { id: promo.id }, data: { reminderSentAt: new Date() } });
      continue;
    }

    const message =
      `⏰ تذكير: كوبونك ${promo.code} (خصم ${Number(promo.value)}%) ينتهي بعد يوم واحد وما استخدمته لسه!\n\n` +
      `استخدمه قبل لا يفوتك` + (link ? `:\n${link}` : ".");

    try {
      await sendWhatsAppText(phone, message);
      sent++;
    } catch (err) {
      logger.warn(`[FirstOrderCoupon] reminder failed to ${phone}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await prisma.promoCode.update({ where: { id: promo.id }, data: { reminderSentAt: new Date() } });
  }

  return { checked: candidates.length, sent };
}

export async function getFirstOrderCouponReport() {
  const coupons = await prisma.promoCode.findMany({ where: { source: FIRST_ORDER_SOURCE } });
  const issued = coupons.length;
  const used = coupons.filter((c) => c.usedCount > 0).length;

  // The wholesale catalog order flow never links a redeemed PromoCode to the
  // eventual Invoice (Invoice.couponId only points at the unrelated staff/POS
  // Coupon model — checked while building this). The promo code IS preserved
  // on the CATALOG_ORDER approval itself (requestData.body.promoCode), along
  // with the order's finalTotal at submission time, so that's the source of
  // truth here — "orders approved through this coupon", not a re-derivation
  // from Invoice rows that were never tagged with it in the first place.
  const codeSet = new Set(coupons.map((c) => c.code));
  let salesCount = 0;
  let salesTotal = 0;
  if (codeSet.size > 0) {
    const approvals = await prisma.pendingApproval.findMany({
      where: { requestType: "CATALOG_ORDER", status: "APPROVED" },
      select: { requestData: true },
    });
    for (const a of approvals) {
      const data = a.requestData as { promoCode?: string; finalTotal?: number } | null;
      const code = data?.promoCode?.trim().toUpperCase();
      if (!code || !codeSet.has(code)) continue;
      salesCount++;
      salesTotal += Number(data?.finalTotal ?? 0);
    }
  }

  return { issued, used, salesCount, salesTotal };
}
