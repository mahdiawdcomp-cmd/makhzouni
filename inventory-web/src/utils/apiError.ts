export interface EntitlementErrorInfo {
  code: "READ_ONLY_MODE" | "FEATURE_NOT_ENABLED"
  message: string
  feature?: string
}

function responseData(error: unknown): { error?: unknown; message?: unknown; feature?: unknown } | undefined {
  if (typeof error === "object" && error !== null && "response" in error) {
    return (error as { response?: { data?: { error?: unknown; message?: unknown; feature?: unknown } } }).response?.data
  }
  return undefined
}

/**
 * Batch 7 — recognizes the Batch 5/6 backend error shapes (423 READ_ONLY_MODE,
 * 403 FEATURE_NOT_ENABLED) and returns a clear Arabic message for them.
 * Returns null for any other error so callers fall back to normal handling.
 */
export function getEntitlementError(error: unknown): EntitlementErrorInfo | null {
  const data = responseData(error)
  if (!data || typeof data.error !== "string") return null

  if (data.error === "READ_ONLY_MODE") {
    return {
      code: "READ_ONLY_MODE",
      message: "النظام بوضع المشاهدة فقط. لا يمكن الإضافة أو التعديل أو الحذف حالياً.",
    }
  }

  if (data.error === "FEATURE_NOT_ENABLED") {
    const backendMessage = typeof data.message === "string" && data.message.trim()
      ? data.message.trim()
      : "هذه الميزة غير مفعلة في نسختك."
    return {
      code: "FEATURE_NOT_ENABLED",
      message: `${backendMessage} تواصل مع الدعم لتفعيلها.`,
      feature: typeof data.feature === "string" ? data.feature : undefined,
    }
  }

  return null
}

export function apiErrorMessage(error: unknown, fallback = "تعذر تنفيذ العملية") {
  const entitlementError = getEntitlementError(error)
  if (entitlementError) return entitlementError.message

  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { data?: { message?: unknown } } }).response
    const message = response?.data?.message
    if (typeof message === "string" && message.trim()) return message
  }
  if (error instanceof Error && error.message) return error.message
  return fallback
}

/* ─── Explained errors (كود + سبب + حل) ────────────────────────────────────
 * The employee-facing error surface. Every failure the staff sees should tell
 * them: what happened (message), the technical code (HTTP status + app code so
 * they can quote it to support), WHY it happened (سبب), and HOW to fix it (حل).
 * Keyed by the backend AppError `code`; unknown codes fall back to a generic
 * explanation that still shows the code so nothing is a silent mystery.
 */
export interface ExplainedError {
  message: string
  httpStatus: number | null
  code: string | null
  cause: string
  solution: string
}

const ERROR_EXPLANATIONS: Record<string, { cause: string; solution: string }> = {
  INSUFFICIENT_SHOP_STOCK: {
    cause: "الكمية المطلوبة أكبر من الرصيد المتوفر للمادة في المخزن (غالباً بيعت المادة في فواتير أخرى بعد إنشاء هذه الفاتورة).",
    solution: "قلّل الكمية، أو أضف مخزون للمادة، أو اختر مخزناً فيه رصيد كافٍ ثم أعد الحفظ.",
  },
  INVOICE_NUMBER_CONFLICT: {
    cause: "تعذّر توليد رقم فاتورة فريد بسبب تزامن عمليات أو تكرار الرقم.",
    solution: "أعد المحاولة بعد لحظات، وإذا تكرر الخطأ راجع الدعم الفني.",
  },
  INVOICE_CLOSED: {
    cause: "لا يمكن تعديل فاتورة غير نشطة (معطّلة أو محذوفة).",
    solution: "أعد تفعيل الفاتورة أولاً من زر «إرجاع/تفعيل» ثم عدّلها.",
  },
  INVOICE_CANCELLED: {
    cause: "الفاتورة معطّلة بالفعل.",
    solution: "لا حاجة لإجراء — إذا أردت تعديلها فعّلها أولاً.",
  },
  INVOICE_ACTIVE: {
    cause: "الفاتورة نشطة بالفعل ولا يمكن إعادة تفعيلها.",
    solution: "لا حاجة لإجراء.",
  },
  INVOICE_ARCHIVED: {
    cause: "الفاتورة محذوفة (مؤرشفة) ولا يمكن استرجاعها بهذه الطريقة.",
    solution: "استخدم صفحة «المحذوفات» لاسترجاعها خلال مهلة الاسترجاع.",
  },
  INVOICE_NOT_ARCHIVED: {
    cause: "الفاتورة غير محذوفة أصلاً.",
    solution: "لا حاجة للاسترجاع.",
  },
  RESTORE_WINDOW_EXPIRED: {
    cause: "انتهت مهلة استرجاع الفاتورة (48 ساعة من الحذف).",
    solution: "لا يمكن استرجاعها تلقائياً — راجع الدعم الفني إذا كانت مهمة.",
  },
  INVOICE_NOT_FOUND: {
    cause: "الفاتورة غير موجودة أو حُذفت.",
    solution: "حدّث الصفحة وتأكد من رقم الفاتورة.",
  },
  PRODUCT_NOT_FOUND: {
    cause: "المادة غير موجودة أو حُذفت.",
    solution: "حدّث قائمة المواد واختر مادة موجودة.",
  },
  CUSTOMER_NOT_FOUND: {
    cause: "الزبون غير موجود أو حُذف.",
    solution: "اختر زبوناً موجوداً أو أنشئ زبوناً جديداً.",
  },
  PAID_AMOUNT_EXCEEDS_TOTAL: {
    cause: "المبلغ المدفوع أكبر من إجمالي الفاتورة.",
    solution: "اجعل المدفوع مساوياً للإجمالي أو أقل، وسجّل الزيادة كسند قبض منفصل.",
  },
  INVALID_INVOICE_TOTAL: {
    cause: "الخصم أكبر من مجموع الفاتورة، فالإجمالي أصبح سالباً.",
    solution: "قلّل قيمة الخصم حتى لا يتجاوز مجموع الأصناف.",
  },
  WAREHOUSE_REQUIRED_FOR_QUANTITY: {
    cause: "المتجر متعدد المخازن، ويجب تحديد المخزن عند تعديل كمية المادة.",
    solution: "حدّد المخزن (أو توزيع الكميات على المخازن) ثم أعد الحفظ.",
  },
  COUPON_INACTIVE: { cause: "الكوبون غير مفعّل.", solution: "استخدم كوبوناً مفعّلاً أو أزل الكوبون." },
  COUPON_NOT_STARTED: { cause: "الكوبون لم يبدأ بعد.", solution: "انتظر تاريخ بدء الكوبون أو أزله." },
  COUPON_EXPIRED: { cause: "انتهت صلاحية الكوبون.", solution: "استخدم كوبوناً ساري المفعول أو أزله." },
  COUPON_LIMIT_REACHED: { cause: "بلغ الكوبون حد الاستخدام المسموح.", solution: "استخدم كوبوناً آخر أو أزله." },
  READ_ONLY_MODE: {
    cause: "النظام بوضع المشاهدة فقط (اشتراك منتهٍ أو موقوف).",
    solution: "جدّد الاشتراك أو تواصل مع الدعم لتفعيل الكتابة.",
  },
  FEATURE_NOT_ENABLED: {
    cause: "هذه الميزة غير مفعّلة في نسختك.",
    solution: "تواصل مع الدعم لتفعيلها.",
  },
}

function httpStatusOf(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "response" in error) {
    const status = (error as { response?: { status?: unknown } }).response?.status
    if (typeof status === "number") return status
  }
  return null
}

function errorCodeOf(error: unknown): string | null {
  const data = responseData(error) as { code?: unknown; error?: unknown } | undefined
  if (data) {
    if (typeof data.code === "string" && data.code.trim()) return data.code.trim()
    if (typeof data.error === "string" && data.error.trim()) return data.error.trim()
  }
  return null
}

/**
 * Turns any error into a staff-friendly explanation: message + رمز الخطأ +
 * السبب + الحل. Always returns something useful, even for unknown codes.
 */
export function explainError(error: unknown, fallback = "تعذر تنفيذ العملية"): ExplainedError {
  const httpStatus = httpStatusOf(error)
  const code = errorCodeOf(error)
  const message = apiErrorMessage(error, fallback)
  const known = code ? ERROR_EXPLANATIONS[code] : undefined

  return {
    message,
    httpStatus,
    code,
    cause: known?.cause ?? "حدث خطأ غير متوقع أثناء تنفيذ العملية.",
    solution: known?.solution ?? "أعد المحاولة، وإذا تكرر الخطأ صوّر هذه الرسالة وراجع الدعم الفني.",
  }
}

/** رمز الخطأ للعرض، مثل: «خطأ 409 · INSUFFICIENT_SHOP_STOCK» */
export function errorRefLabel(e: ExplainedError): string {
  const parts: string[] = []
  if (e.httpStatus != null) parts.push(`خطأ ${e.httpStatus}`)
  if (e.code) parts.push(e.code)
  return parts.join(" · ")
}
