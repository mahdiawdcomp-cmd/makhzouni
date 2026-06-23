import { AppError } from "../utils/app-error";
import { asyncHandler } from "../utils/async-handler";
import { canSendOtp, generateOtp, isVerified, markVerified, verifyOtp } from "../services/otp.service";
import { sendWhatsAppText } from "../services/whatsapp.service";

function normalizePhone(input: string) {
  let digits = input.replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("964")) return digits;
  if (digits.startsWith("0")) return `964${digits.slice(1)}`;
  if (digits.startsWith("7")) return `964${digits}`;
  return digits;
}

export const sendOtp = asyncHandler(async (req, res) => {
  const { phone } = req.body as { phone: string };
  if (!phone) throw new AppError("رقم الهاتف مطلوب", 400, "PHONE_REQUIRED");

  const normalized = normalizePhone(String(phone));
  if (normalized.length < 10) throw new AppError("رقم الهاتف غير صحيح", 400, "INVALID_PHONE");

  if (!canSendOtp(normalized)) {
    throw new AppError("تجاوزت الحد المسموح. حاول بعد ساعة.", 429, "OTP_RATE_LIMITED");
  }

  const code = generateOtp(normalized);

  try {
    await sendWhatsAppText(
      normalized,
      `مرحباً 👋\nرمز التحقق لدخول كتالوج المتجر:\n\n*${code}*\n\nصالح لمدة 5 دقائق فقط.\nلا تشاركه مع أحد.`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError(`فشل إرسال الرمز: ${msg}`, 503, "OTP_SEND_FAILED");
  }

  res.json({ success: true, message: "تم إرسال رمز التحقق عبر الواتساب" });
});

export const confirmOtp = asyncHandler(async (req, res) => {
  const { phone, code } = req.body as { phone: string; code: string };
  if (!phone || !code) throw new AppError("الهاتف والرمز مطلوبان", 400, "MISSING_FIELDS");

  const normalized = normalizePhone(String(phone));
  const ok = verifyOtp(normalized, String(code).trim());
  if (!ok) throw new AppError("الرمز غير صحيح أو انتهت صلاحيته", 400, "OTP_INVALID");

  markVerified(normalized);
  res.json({ success: true, message: "تم التحقق من رقم الهاتف" });
});

export const checkVerified = asyncHandler(async (req, res) => {
  const phone = String(req.query.phone ?? "");
  const normalized = normalizePhone(phone);
  res.json({ success: true, verified: isVerified(normalized) });
});
