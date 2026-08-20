// بند ٥ من خطة قمع الواتساب — محادثة تسجيل زبون جديد عبر الواتساب: الاسم ثم
// المحافظة ثم نوع المحل (اختياري)، تنتهي بطلب موافقة CATALOG_ACCESS (نفس
// المسار اللي يستخدمه طلب الدخول من الكتلوك العام). نمط آلة الحالة (state
// JSON + حقل mode على صف بالقاعدة) مقلّد من TelegramBotChat، لكن الخطوات
// نفسها جديدة كلياً — بوت التيليگرام ما عنده محادثة تسجيل بهذا الشكل.
import { ApprovalStatus, Prisma } from "@prisma/client";
import prisma from "../config/database";
import { logger } from "../utils/logger";
import { sendWhatsAppText } from "./whatsapp.service";
import { normalizeArabic } from "../utils/arabic-search";
import {
  BUSINESS_TYPE_LABELS,
  CUSTOMER_BUSINESS_TYPES,
  CustomerBusinessType,
  IRAQI_GOVERNORATES,
} from "../utils/deliveryRegion";
import { approvalRequestTypes, createPendingApproval } from "./approval.service";
import { notifyCatalogAccessRequested } from "./order-preparation.service";
import { findApprovalRequester } from "./catalog.service";

// "مثلاً ساعة" بالخطة — محادثة معلّقة أكثر من هذا تُعتبر متروكة وتُمسح، حتى
// رسالة لاحقة غير مرتبطة (بعد أيام) ما تُقرأ كأنها رد على سؤال قديم.
const REGISTRATION_TIMEOUT_MS = 60 * 60 * 1000;

type RegistrationMode = "await_name" | "await_province" | "await_business_type";

type RegistrationState = {
  mode: RegistrationMode;
  name?: string;
  province?: string;
  startedAt: string; // ISO — عمر المحادثة يُحسب من هذا، مو من آخر رد
};

const SKIP_KEYWORDS = ["تخطي", "تخطى", "skip", "بدون", "لا"].map(normalizeArabic);

const BUSINESS_TYPE_KEYWORDS: Record<CustomerBusinessType, string[]> = {
  STATIONERY: ["قرطاسية", "قرطاسيه"].map(normalizeArabic),
  TOYS: ["العاب", "لعب"].map(normalizeArabic),
  MIXED: ["مختلط", "مختلطه", "الاثنين", "الكل"].map(normalizeArabic),
};

const GOVERNORATE_LIST_TEXT = IRAQI_GOVERNORATES.join("، ");
const BUSINESS_TYPE_PROMPT = `شنو نوع محلك؟ (${CUSTOMER_BUSINESS_TYPES.map((t) => BUSINESS_TYPE_LABELS[t]).join(" / ")})\n\nأو اكتب «تخطي» إذا ما تريد تحدد.`;

// Exported for tests: these two decide what a shopper's free-text reply means,
// and a silent regression here mis-files customers or stalls the conversation.
export function matchGovernorate(text: string): string | null {
  const normalized = normalizeArabic(text);
  if (!normalized) return null;
  for (const g of IRAQI_GOVERNORATES) {
    if (normalizeArabic(g) === normalized) return g;
  }
  // Tolerates extra words ("بغداد الكرخ") in either direction without
  // matching an unrelated short governorate name by accident.
  for (const g of IRAQI_GOVERNORATES) {
    const ng = normalizeArabic(g);
    if (ng.length >= 3 && (normalized.includes(ng) || ng.includes(normalized))) return g;
  }
  return null;
}

export function matchBusinessType(text: string): CustomerBusinessType | null {
  const normalized = normalizeArabic(text);
  if (!normalized) return null;
  for (const type of CUSTOMER_BUSINESS_TYPES) {
    if (BUSINESS_TYPE_KEYWORDS[type].some((k) => normalized.includes(k))) return type;
  }
  return null;
}

function isSkip(text: string): boolean {
  const normalized = normalizeArabic(text);
  return SKIP_KEYWORDS.includes(normalized);
}

function isExpired(state: RegistrationState): boolean {
  const startedAt = Date.parse(state.startedAt);
  if (Number.isNaN(startedAt)) return true;
  return Date.now() - startedAt > REGISTRATION_TIMEOUT_MS;
}

async function saveState(phone: string, state: RegistrationState | null) {
  if (state === null) {
    await prisma.whatsappBotChat.deleteMany({ where: { phone } });
    return;
  }
  await prisma.whatsappBotChat.upsert({
    where: { phone },
    update: { state: state as unknown as Prisma.InputJsonValue },
    create: { phone, state: state as unknown as Prisma.InputJsonValue },
  });
}

/** True when this number has an unexpired conversation waiting on a reply. */
export async function isRegistrationInProgress(phone: string): Promise<boolean> {
  const chat = await prisma.whatsappBotChat.findUnique({ where: { phone } });
  if (!chat) return false;
  const state = chat.state as unknown as Partial<RegistrationState>;
  if (!state?.mode) return false;
  if (isExpired(state as RegistrationState)) {
    await saveState(phone, null);
    return false;
  }
  return true;
}

export async function startRegistration(phone: string) {
  await saveState(phone, { mode: "await_name", startedAt: new Date().toISOString() });
  await sendWhatsAppText(phone, "أهلاً 👋 خلي نسجّلك زبون جملة عندنا.\n\nشنو اسمك الكامل؟").catch((err) =>
    logger.warn(`[WhatsAppRegistration] start failed for ${phone}: ${err instanceof Error ? err.message : String(err)}`),
  );
}

/**
 * Returns true if the message was consumed as a registration-conversation
 * reply (caller must stop routing it any further). Returns false when there
 * is no in-progress conversation for this phone, OR the conversation just
 * expired — in the expired case the state is cleared so the SAME message
 * falls through to normal routing instead of being silently swallowed.
 */
export async function handleRegistrationReply(phone: string, text: string): Promise<boolean> {
  const chat = await prisma.whatsappBotChat.findUnique({ where: { phone } });
  if (!chat) return false;

  const state = chat.state as unknown as RegistrationState;
  if (!state?.mode) return false;

  if (isExpired(state)) {
    await saveState(phone, null);
    return false;
  }

  const trimmed = text.trim();

  if (state.mode === "await_name") {
    if (trimmed.length < 2) {
      await sendWhatsAppText(phone, "اكتب اسمك الكامل من فضلك 🙏").catch(() => {});
      return true;
    }
    await saveState(phone, { ...state, mode: "await_province", name: trimmed });
    await sendWhatsAppText(phone, `تمام يا ${trimmed} 🌹\n\nشنو محافظتك؟\n\n${GOVERNORATE_LIST_TEXT}`).catch(() => {});
    return true;
  }

  if (state.mode === "await_province") {
    const matched = matchGovernorate(trimmed);
    if (!matched) {
      await sendWhatsAppText(phone, `ما عرفت هذي المحافظة 🤔 اكتبها بالضبط من القائمة:\n\n${GOVERNORATE_LIST_TEXT}`).catch(() => {});
      return true;
    }
    await saveState(phone, { ...state, mode: "await_business_type", province: matched });
    await sendWhatsAppText(phone, BUSINESS_TYPE_PROMPT).catch(() => {});
    return true;
  }

  // await_business_type
  const skip = isSkip(trimmed);
  const businessType = skip ? undefined : matchBusinessType(trimmed);
  if (!skip && !businessType) {
    await sendWhatsAppText(phone, `ما فهمت 🤔 ${BUSINESS_TYPE_PROMPT}`).catch(() => {});
    return true;
  }

  // Compare-and-swap: claim the conversation (mode still exactly what we just
  // read) before the slower, side-effecting approval-creation step. Meta
  // retries webhook deliveries on any delay, so two near-simultaneous calls
  // for the same phone are a real possibility, not a theoretical one — the
  // loser here sees count === 0 and backs off instead of creating a second
  // pending approval for the same number.
  const claimed = await prisma.whatsappBotChat.updateMany({
    where: { phone, state: { path: ["mode"], equals: "await_business_type" } },
    data: { state: { ...state, mode: "finishing" } as unknown as Prisma.InputJsonValue },
  });
  if (claimed.count === 0) return true;

  try {
    await finishRegistration(phone, state.name ?? "", state.province ?? "", businessType ?? undefined);
  } catch (err) {
    // The collected answers are logged here because this is the only place
    // they still exist — state is cleared right after regardless, since
    // there's no further customer input that could usefully resume a
    // half-finished registration. "رد 1" starts a clean redo.
    logger.warn(
      `[WhatsAppRegistration] finishRegistration failed for ${phone} ` +
        `(name=${state.name}, province=${state.province}, businessType=${businessType ?? "-"}): ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    await sendWhatsAppText(phone, "صار خطأ بسيط 🙏 جرب ترسل «1» بعد شوي حتى نعيد تسجيلك.").catch(() => {});
  }

  await saveState(phone, null);
  return true;
}

async function finishRegistration(
  phone: string,
  customerName: string,
  province: string,
  businessType: CustomerBusinessType | undefined,
) {
  if (!customerName || !province) {
    // Defensive only — the state machine never reaches here without both.
    logger.warn(`[WhatsAppRegistration] incomplete state for ${phone}, dropping`);
    return;
  }

  // A prior registration (or a storefront request) for the same number may
  // already be sitting in the approvals queue — avoid a second one piling
  // up every time an impatient customer re-sends "1".
  const alreadyPending = await prisma.pendingApproval.findFirst({
    where: {
      requestType: approvalRequestTypes.CATALOG_ACCESS,
      status: ApprovalStatus.PENDING,
      requestData: { path: ["phone"], equals: phone },
    },
  });
  if (alreadyPending) {
    await sendWhatsAppText(phone, "طلبك موجود عندنا وينتظر الموافقة، تراسلك أول ما توافق عليه 🙏").catch(() => {});
    return;
  }

  const requester = await findApprovalRequester();
  await createPendingApproval(
    approvalRequestTypes.CATALOG_ACCESS,
    {
      source: "WHATSAPP_REGISTRATION",
      customerName,
      phone,
      allowPrices: false,
      body: { customerName, phone, province, businessType },
    },
    requester.id,
  );

  // Sends both the customer confirmation and the admin's WhatsApp ping —
  // same helper the storefront's own access request uses.
  await notifyCatalogAccessRequested(customerName, phone).catch((err) =>
    logger.warn(`[WhatsAppRegistration] notify failed for ${phone}: ${err instanceof Error ? err.message : String(err)}`),
  );
}
