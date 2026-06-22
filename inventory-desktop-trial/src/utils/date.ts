/** Returns today's date as "YYYY-MM-DD" in the LOCAL timezone (not UTC). */
export function localDateStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/**
 * Format a BUSINESS date (invoice.date, voucher.date) — shows LOCAL date only, never time.
 * Business dates are stored as midnight UTC; showing time would always be "3:00 AM" in UTC+3.
 */
export function formatDate(value?: string | Date | null): string {
  if (!value) return "-"
  return new Date(value).toLocaleDateString("en-US", { dateStyle: "short" })
}

/**
 * Format a SYSTEM timestamp (createdAt, updatedAt) — shows LOCAL date + time.
 * - Full ISO timestamps: shown with date + time, local timezone.
 * - Date-only strings ("YYYY-MM-DD"): shown as date only (parsed as local midnight).
 */
export function formatDateTime(value?: string | Date | null): string {
  if (!value) return "-"
  const s = typeof value === "string" ? value : value.toISOString()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number)
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { dateStyle: "short" })
  }
  return new Date(s).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })
}
