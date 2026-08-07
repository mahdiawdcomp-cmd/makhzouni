import { toast } from "../components/ui/use-toast"

export function fillTemplate(template: string, values: Record<string, string | number | undefined | null>): string {
  return template.replace(/\{\{\s*([\w\d_]+)\s*\}\}/g, (_, key) => {
    const value = values[key]
    return value === undefined || value === null ? "" : String(value)
  })
}

function toEnglishDigits(input: string) {
  const arabic = "٠١٢٣٤٥٦٧٨٩"
  const persian = "۰۱۲۳۴۵۶۷۸۹"
  return input.replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabicIndex = arabic.indexOf(digit)
    if (arabicIndex >= 0) return String(arabicIndex)
    return String(persian.indexOf(digit))
  })
}

export function normalizePhone(input: string | undefined | null, defaultCountry = "964"): string {
  if (!input) return ""
  let digits = toEnglishDigits(String(input)).replace(/[^\d]/g, "")
  if (digits.startsWith("00")) digits = digits.slice(2)
  if (digits.startsWith(defaultCountry)) return digits
  if (digits.startsWith("0")) return defaultCountry + digits.slice(1)
  if (digits.startsWith("7")) return defaultCountry + digits
  return digits
}

export function whatsappUrl(phone: string | undefined | null, message = "") {
  const number = normalizePhone(phone)
  if (!number) return null
  const text = message ? `?text=${encodeURIComponent(message)}` : ""
  return `https://wa.me/${number}${text}`
}

export function openWhatsApp(phone: string | undefined | null, message: string) {
  const url = whatsappUrl(phone, message)
  if (!url) {
    toast({ title: "رقم الهاتف غير متوفر للزبون.", variant: "destructive" })
    return
  }
  window.open(url, "_blank", "noopener,noreferrer")
}

export function sendWhatsAppWeb(phone: string, message: string) {
  openWhatsApp(phone, message)
}

/**
 * A balance rendered for a CUSTOMER to read.
 *
 * The stored sign is an internal convention (positive = the customer owes us,
 * negative = we owe them). Sending it raw meant a supplier or a customer in
 * credit received a bare "-500,000" with nothing saying which direction it
 * ran. The word goes BEFORE the number so the template's own {{currency}},
 * which follows the placeholder, still reads correctly:
 *
 *   "حسابكم السابق: عليك 500,000 د.ع"
 */
export function balanceForCustomer(value: number | string | undefined | null): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n) || n === 0) return "0"
  const amount = Math.abs(n).toLocaleString("en-US")
  return n > 0 ? `عليك ${amount}` : `لك ${amount}`
}
