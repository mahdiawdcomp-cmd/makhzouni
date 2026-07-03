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
