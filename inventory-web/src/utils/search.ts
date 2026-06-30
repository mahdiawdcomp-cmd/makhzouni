// Shared, smart entity matchers used across pages so search behaviour is
// identical everywhere (invoices, POS, inventory, customers) instead of each
// page re-implementing its own filter. Mirrors the backend smart search:
// whitespace-separated tokens are AND-ed, each token matches any field.
import { barcodeMatchCandidates } from "./barcode-scan"

type SearchableProduct = {
  name: string
  itemNumber: string
  qrCode?: string | null
  cartonQrCode?: string | null
  category?: string | null
}

type SearchableCustomer = {
  name: string
  phone?: string | null
  address?: string | null
}

function tokens(q: string): string[] {
  return q.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

/**
 * Smart product match: every token must hit name / itemNumber / qrCode /
 * cartonQrCode / category. Also tolerates an Arabic-keyboard-garbled scan by
 * matching de-arabicized barcode candidates against the codes.
 */
export function matchProduct(product: SearchableProduct, q: string): boolean {
  const ts = tokens(q)
  if (!ts.length) return true
  const fields = [
    product.name,
    product.itemNumber,
    product.qrCode ?? "",
    product.cartonQrCode ?? "",
    product.category ?? "",
  ].map((f) => f.toLowerCase())
  const codes = [product.itemNumber, product.qrCode ?? "", product.cartonQrCode ?? ""].map((c) => c.toLowerCase())

  return ts.every((token) => {
    if (fields.some((f) => f.includes(token))) return true
    // Per-token barcode fallback (de-arabicize a scanned code).
    return barcodeMatchCandidates(token)
      .filter((c) => c !== token)
      .some((c) => codes.some((code) => !!code && (code === c || (c.length >= 8 && code.includes(c)))))
  })
}

/** Smart customer match: tokens AND-ed across name / phone / address. Phone
 *  tokens also match after stripping non-digits ("0770 123" → "07701234567"). */
export function matchCustomer(customer: SearchableCustomer, q: string): boolean {
  const ts = tokens(q)
  if (!ts.length) return true
  const name = customer.name.toLowerCase()
  const phone = (customer.phone ?? "").toLowerCase()
  const address = (customer.address ?? "").toLowerCase()
  const phoneDigits = phone.replace(/\D/g, "")

  return ts.every((token) => {
    if (name.includes(token) || phone.includes(token) || address.includes(token)) return true
    const digits = token.replace(/\D/g, "")
    return !!digits && phoneDigits.includes(digits)
  })
}
