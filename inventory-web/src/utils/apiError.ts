export function apiErrorMessage(error: unknown, fallback = "تعذر تنفيذ العملية") {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { data?: { message?: unknown } } }).response
    const message = response?.data?.message
    if (typeof message === "string" && message.trim()) return message
  }
  if (error instanceof Error && error.message) return error.message
  return fallback
}
