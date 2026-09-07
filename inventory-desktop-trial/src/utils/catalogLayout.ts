/* Storefront layout the merchant controls — shared by the public catalog
   and the admin editors, so the two can never disagree about what a key
   means or what the built-in wording is. */

/**
 * The shape the shop arranged its storefront into. Every field falls back to
 * what shipped, so a shop that never opened the layout editor sees no change.
 */
export interface CatalogLayout {
  announcement: string | null
  sections: Array<{ key: string; enabled: boolean }>
  texts: Record<string, string>
  hiddenCategories: string[]
  categoryOrder: string[]
  featuredProductIds: string[]
  defaultView: "grid" | "list"
  defaultPerRow: number
  defaultSort: string
  reviewsEnabled: boolean
  suggestionsEnabled: boolean
  tutorialEnabled: boolean
  /** The shop's default for pictureless products. The shopper may override it. */
  hideNoImage: boolean
  /** How recently a product must have been added to count as «وصلت هسه». 0 = off. */
  newArrivalDays: number
  /** Whether someone with no account at all sees prices. */
  guestPricesVisible: boolean
  /** Tag names the shop wants as one-tap chips beside «وصلت هسه». */
  quickTags: string[]
  /** «المعرض» — the gallery view and how the shop set it up. */
  studio: {
    enabled: boolean
    defaultView: "store" | "studio"
    perRow: number
    shape: "square" | "natural"
    offerAlbum: boolean
    newAlbum: boolean
    offerDot: boolean
  }
  /** «عروض القائمة» — thresholds that grant free delivery and/or a discount. */
  orderTiers: Array<{ minTotal: number; freeDelivery: boolean; discountPercent: number }>
}

/**
 * What this cart has earned and what one more carton would earn.
 *
 * Mirrors resolveOrderTier on the backend, which is the authority — this copy
 * exists so the cart can show progress live without a round trip. The server
 * recomputes from its own prices when the order is placed, so a stale or
 * tampered client can never award itself a discount.
 */
export function resolveCartTier(
  subtotal: number,
  tiers: Array<{ minTotal: number; freeDelivery: boolean; discountPercent: number }> | undefined,
) {
  const total = Math.max(0, Number(subtotal) || 0)
  const ladder = [...(tiers ?? [])]
    .filter((t) => t && t.minTotal > 0 && (t.freeDelivery || t.discountPercent > 0))
    .sort((a, b) => a.minTotal - b.minTotal)

  let reached: (typeof ladder)[number] | null = null
  let next: (typeof ladder)[number] | null = null
  for (const tier of ladder) {
    if (total >= tier.minTotal) reached = tier
    else { next = tier; break }
  }

  const discountPercent = reached?.discountPercent ?? 0
  return {
    reached,
    next,
    remaining: next ? Math.max(0, next.minTotal - total) : 0,
    freeDelivery: reached?.freeDelivery ?? false,
    discountPercent,
    discountAmount: Math.round(total * (discountPercent / 100)),
    /** 0..1 progress toward the next rung, for the bar. */
    progress: next ? Math.min(1, total / next.minTotal) : 1,
  }
}

/** Built-in wording, overridden per key from «نصوص الكتلوك». */
export const CATALOG_TEXT_DEFAULTS: Record<string, string> = {
  storeTitle: "متجر الجملة",
  loginSubtitle: "سجّل الدخول لتتصفح وتطلب",
  loginHeading: "تسجيل الدخول",
  loginHint: "استخدم رقم هاتفك والرمز المرسل لك بالواتساب",
  loginButton: "دخول",
  noCodeLabel: "ما عندك رمز؟",
  requestCodeButton: "اطلب رمزي على الواتساب",
  requestCodeHint: "راح تنفتح دردشة المحل والرسالة مكتوبة — بس اضغط إرسال ويوصلك رمزك فوراً.",
  detailsTitle: "خطوة وحدة وتفوت",
  detailsSubtitle: "عرّفنا بنفسك ونفتحلك المتجر",
  detailsButton: "ادخل المتجر",
  pricesLockedBar: "🔒 الأسعار مخفية — اضغط لطلب عرض الأسعار",
  pricesPendingBar: "⏳ طلبك وصل للمحل — راح تنفتحلك الأسعار بعد الموافقة",
  requestPriceButton: "اطلب عرض سعر",
  featuredTitle: "مختاراتنا",
  offersTitle: "العروض",
  newArrivalsTitle: "وصل حديثاً",
  emptyResults: "لا توجد منتجات مطابقة",
}

/** Shop wording for a key, falling back to the built-in Arabic. */
export function catalogText(texts: Record<string, string> | undefined, key: string): string {
  const custom = texts?.[key]?.trim()
  return custom || CATALOG_TEXT_DEFAULTS[key] || ""
}
