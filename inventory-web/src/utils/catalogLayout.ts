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
  emptyResults: "ما في نتائج مطابقة",
}

/** Shop wording for a key, falling back to the built-in Arabic. */
export function catalogText(texts: Record<string, string> | undefined, key: string): string {
  const custom = texts?.[key]?.trim()
  return custom || CATALOG_TEXT_DEFAULTS[key] || ""
}
