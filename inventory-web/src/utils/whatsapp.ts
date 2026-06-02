// Renders a WhatsApp template by replacing {{placeholder}} tokens with values,
// then opens https://wa.me/<phone>?text=<encoded>.

export function fillTemplate(template: string, values: Record<string, string | number | undefined | null>): string {
  return template.replace(/\{\{\s*([\w\d_]+)\s*\}\}/g, (_, key) => {
    const v = values[key]
    return v === undefined || v === null ? "" : String(v)
  })
}

// Normalize a phone number to international digits-only form (Iraq country code default).
export function normalizePhone(input: string | undefined | null, defaultCountry = "964"): string {
  if (!input) return ""
  let digits = String(input).replace(/[^\d]/g, "")
  if (digits.startsWith("00")) digits = digits.slice(2)
  if (digits.startsWith("0")) digits = defaultCountry + digits.slice(1)
  return digits
}

export function openWhatsApp(phone: string | undefined | null, message: string) {
  const num = normalizePhone(phone)
  if (!num) {
    window.alert("رقم الهاتف غير متوفر للزبون.")
    return
  }
  const url = `https://wa.me/${num}?text=${encodeURIComponent(message)}`
  window.open(url, "_blank", "noopener,noreferrer")
}

// Back-compat with existing call sites
export function sendWhatsAppWeb(phone: string, message: string) {
  openWhatsApp(phone, message)
}
