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
  // Availability — optional so callers that only match text still typecheck.
  currentStock?: number | null
  openingBalancePcs?: number | null
  cartonsAvailable?: number | null
  pcsPerCarton?: number | null
  warehouseStocks?: { quantityPieces: number }[] | null
  /** Pieces in المحل specifically — sales are served from here. */
  shopStock?: number | null
}

/**
 * Total pieces on hand, from whichever shape the caller's product object has.
 * Used ONLY for ordering search results — never for stock math.
 */
export function totalPiecesOf(product: SearchableProduct): number {
  if (typeof product.currentStock === "number") return product.currentStock
  if (product.warehouseStocks?.length) {
    return product.warehouseStocks.reduce((sum, ws) => sum + (ws.quantityPieces || 0), 0)
  }
  return (product.openingBalancePcs ?? 0) + (product.cartonsAvailable ?? 0) * (product.pcsPerCarton ?? 0)
}

/** True when the product has any pieces left — anywhere. */
export function isInStock(product: SearchableProduct): boolean {
  return totalPiecesOf(product) > 0
}

/**
 * The three states a seller actually cares about while picking a product:
 *  IN_SHOP    — pieces in المحل, sell it now
 *  DEPOT_ONLY — المحل is empty but a depot still holds pieces (transfer needed)
 *  OUT        — nothing anywhere
 * `shopStock` is optional: when the caller doesn't know it, we can't tell
 * IN_SHOP from DEPOT_ONLY, so anything with stock counts as IN_SHOP.
 */
export type StockState = "IN_SHOP" | "DEPOT_ONLY" | "OUT"

export function stockState(product: SearchableProduct): StockState {
  if (totalPiecesOf(product) <= 0) return "OUT"
  if (typeof product.shopStock === "number" && product.shopStock <= 0) return "DEPOT_ONLY"
  return "IN_SHOP"
}

/** Sort weight: sellable now → needs a transfer → gone. */
export function stockRank(product: SearchableProduct): number {
  const state = stockState(product)
  return state === "IN_SHOP" ? 2 : state === "DEPOT_ONLY" ? 1 : 0
}

/** Pieces sitting in depots (everything outside المحل). */
export function depotPiecesOf(product: SearchableProduct): number {
  const total = totalPiecesOf(product)
  if (typeof product.shopStock !== "number") return total
  return Math.max(0, total - product.shopStock)
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
 * Relevance score for a product (0 = no match). Precision over recall — tiers:
 * 8 exact code · 7 code prefix / garbled scan · 6 exact name · 5 name prefix ·
 * 4 name contains phrase · 3 every query word appears (name/category/code).
 *
 * The old loose "some tokens" and "fuzzy subsequence" tiers were removed on
 * purpose: subsequence matching (letters in order, anywhere) turned a short
 * query into dozens of barely-related hits, and "some tokens" let one shared
 * word ("قلم ازرق" → "قلم احمر") match. Substring matching within a word still
 * works via the phrase/all-words tiers, so partial typing is unaffected.
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

  // Codes first (barcode / item number): exact, then prefix.
  if (codes.some((c) => c === full)) return 8
  if (codes.some((c) => c.startsWith(full) || full.startsWith(c))) return 7

  // Name: exact → starts-with → contains the whole phrase.
  if (name === full) return 6
  if (name.startsWith(full)) return 5
  if (name.includes(full)) return 4

  // Every query word appears somewhere (name/category/code) — "clear words".
  const haystacks = [name, category, ...codes]
  if (ts.every((t) => haystacks.some((h) => h.includes(t)))) return 3

  // Last-ditch: an Arabic-keyboard-garbled scan (raw codes only).
  const rawCodes = [product.itemNumber, product.qrCode ?? "", product.cartonQrCode ?? ""].map((c) => c.toLowerCase())
  const matchedScan = barcodeMatchCandidates(q)
    .filter((c) => c !== q.trim().toLowerCase())
    .some((c) => rawCodes.some((code) => !!code && (code === c || (c.length >= 8 && code.includes(c)))))
  return matchedScan ? 7 : 0
}

export function matchProduct(product: SearchableProduct, q: string): boolean {
  if (!q.trim()) return true
  return scoreProduct(product, q) > 0
}

/** Sort a product list by descending relevance to the query (stable on name). */
export function sortProductsByRelevance<T extends SearchableProduct>(products: T[], q: string): T[] {
  if (!q.trim()) return products
  return products
    .map((product) => ({ product, score: scoreProduct(product, q), rank: stockRank(product) }))
    .filter((x) => x.score > 0)
    // Availability comes FIRST: a seller typing "لول لعابة" wants what he can
    // sell right now at the top, then what's only in a depot (a transfer away),
    // then the sold-out ones. Nothing is hidden — only re-ordered.
    .sort(
      (a, b) =>
        b.rank - a.rank ||
        b.score - a.score ||
        a.product.name.localeCompare(b.product.name, "ar"),
    )
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
