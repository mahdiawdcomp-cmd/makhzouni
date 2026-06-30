// Shared, Arabic-aware entity matchers + ranking used across pages so search
// behaviour is identical everywhere (invoices, POS, inventory, customers) and
// matches the backend (utils/arabic-search). Normalization folds أ/إ/آ→ا,
// ة/ه, ى/ي, strips tashkeel/tatweel, normalizes digits, collapses whitespace.
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

export function normalizeArabic(input: string): string {
  if (!input) return ""
  return input
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[ً-ْٰ]/g, "")
    .replace(/ـ/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
}

function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) return true
  let i = 0
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++
  }
  return i === needle.length
}

/**
 * Relevance score for a product (0 = no match). Mirrors the backend tiers:
 * 6 exact code · 5 code prefix · 4 whole phrase · 3 all tokens · 2 some · 1 fuzzy.
 * Also keeps the Arabic-keyboard-garbled barcode fallback for raw scans.
 */
export function scoreProduct(product: SearchableProduct, q: string): number {
  const full = normalizeArabic(q)
  if (!full) return 1
  const ts = full.split(" ").filter(Boolean)

  const name = normalizeArabic(product.name)
  const category = normalizeArabic(product.category ?? "")
  const codes = [product.itemNumber, product.qrCode ?? "", product.cartonQrCode ?? ""]
    .map((c) => normalizeArabic(c))
    .filter(Boolean)

  if (codes.some((c) => c === full)) return 6
  if (codes.some((c) => c.startsWith(full) || full.startsWith(c))) return 5
  if (name.includes(full)) return 4

  const haystacks = [name, category, ...codes]
  const hits = ts.filter((t) => haystacks.some((h) => h.includes(t))).length
  if (hits === ts.length) return 3
  if (hits > 0) return 2
  if (ts.every((t) => isSubsequence(t, name))) return 1

  // Last-ditch: an Arabic-keyboard-garbled scan (raw codes only).
  const rawCodes = [product.itemNumber, product.qrCode ?? "", product.cartonQrCode ?? ""].map((c) => c.toLowerCase())
  const matchedScan = barcodeMatchCandidates(q)
    .filter((c) => c !== q.trim().toLowerCase())
    .some((c) => rawCodes.some((code) => !!code && (code === c || (c.length >= 8 && code.includes(c)))))
  return matchedScan ? 5 : 0
}

export function matchProduct(product: SearchableProduct, q: string): boolean {
  if (!q.trim()) return true
  return scoreProduct(product, q) > 0
}

/** Sort a product list by descending relevance to the query (stable on name). */
export function sortProductsByRelevance<T extends SearchableProduct>(products: T[], q: string): T[] {
  if (!q.trim()) return products
  return products
    .map((product) => ({ product, score: scoreProduct(product, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name, "ar"))
    .map((x) => x.product)
}

export function scoreCustomer(customer: SearchableCustomer, q: string): number {
  const full = normalizeArabic(q)
  if (!full) return 1
  const ts = full.split(" ").filter(Boolean)

  const name = normalizeArabic(customer.name)
  const address = normalizeArabic(customer.address ?? "")
  const phone = (customer.phone ?? "").replace(/\D/g, "")
  const queryDigits = full.replace(/\D/g, "")

  if (queryDigits && phone === queryDigits) return 6
  if (queryDigits && phone.startsWith(queryDigits)) return 5
  if (name.includes(full)) return 4

  const hits = ts.filter(
    (t) => name.includes(t) || address.includes(t) || (!!t.replace(/\D/g, "") && phone.includes(t.replace(/\D/g, ""))),
  ).length
  if (hits === ts.length) return 3
  if (hits > 0) return 2
  if (ts.every((t) => isSubsequence(t, name))) return 1
  return 0
}

export function matchCustomer(customer: SearchableCustomer, q: string): boolean {
  if (!q.trim()) return true
  return scoreCustomer(customer, q) > 0
}

/** Sort a customer list by descending relevance to the query. */
export function sortCustomersByRelevance<T extends SearchableCustomer>(customers: T[], q: string): T[] {
  if (!q.trim()) return customers
  return customers
    .map((customer) => ({ customer, score: scoreCustomer(customer, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.customer.name.localeCompare(b.customer.name, "ar"))
    .map((x) => x.customer)
}
