/* ══════════════════════════════════════════════════════════════════════
   Who gets in, and what they are allowed to see.

   These two questions decide everything else on the storefront, and they used
   to be answered by a chain of early returns buried in a 4,700-line component
   — where the order of the branches WAS the logic. That is how opening the
   shop to strangers came to demote a signed-in visitor to anonymous: the
   guest branch simply sat above the visitor branch, and nothing said it
   shouldn't.

   Pulled out here as plain functions so the rules can be read in one screen
   and tested without rendering anything.
══════════════════════════════════════════════════════════════════════ */

/** What the shop has switched on, as the public design endpoint reports it. */
export interface GuestConfig {
  guestModeEnabled?: boolean
  guestPhoneGate?: boolean
  guestPricesVisible?: boolean
}

/** The parts of a visitor session these decisions depend on. */
export interface VisitorLike {
  detailsSubmitted: boolean
  pricesUnlocked: boolean
}

export type CatalogEntry =
  /** Waiting on the config or the visitor session — show nothing yet. */
  | { screen: "LOADING" }
  /** A customer's own link. The session decides prices and stock filter. */
  | { screen: "CUSTOMER" }
  /** Signed in with a code, but has not said who they are yet. */
  | { screen: "VISITOR_DETAILS" }
  /** Signed in with a code. */
  | { screen: "VISITOR"; allowPrices: boolean }
  /** No account, browsing because the shop left the door open. */
  | { screen: "GUEST"; gated: boolean; allowPrices: boolean }
  /** No account and no open door. */
  | { screen: "LOGIN" }

/**
 * The single decision about which storefront a person gets.
 *
 * Order matters and is deliberate:
 *
 * 1. A customer link outranks everything — it is the most specific identity.
 * 2. A visitor session outranks the guest switch. They proved a code, so they
 *    are a known person with their own price permission and their own name.
 *    Letting «التصفح الحر» outrank them meant the shop opening its door made
 *    its own signed-in visitors anonymous.
 * 3. Only then does open browsing apply.
 * 4. Otherwise, the login.
 */
export function resolveCatalogEntry(input: {
  accessToken: string
  visitorToken: string
  visitor: VisitorLike | null
  visitorLoading: boolean
  guestConfig: GuestConfig | null
  guestConfigLoading: boolean
}): CatalogEntry {
  if (input.accessToken) return { screen: "CUSTOMER" }
  if (input.guestConfigLoading) return { screen: "LOADING" }

  if (input.visitorToken) {
    if (input.visitor) {
      if (!input.visitor.detailsSubmitted) return { screen: "VISITOR_DETAILS" }
      return { screen: "VISITOR", allowPrices: input.visitor.pricesUnlocked }
    }
    // A token that is still resolving must not fall through to the guest or
    // login screens — the shopper would watch themselves get signed out and
    // back in on every refresh.
    if (input.visitorLoading) return { screen: "LOADING" }
  }

  if (input.guestConfig?.guestModeEnabled) {
    return {
      screen: "GUEST",
      gated: input.guestConfig.guestPhoneGate !== false,
      allowPrices: input.guestConfig.guestPricesVisible === true,
    }
  }

  return { screen: "LOGIN" }
}

/* ══════════════════════════════════════════════════════════════════════
   What the grid draws
══════════════════════════════════════════════════════════════════════ */

/** The product fields the display rules read. Anything else is irrelevant here. */
export interface DisplayProduct {
  currentStock: number
  pcsPerCarton: number
  hasImage?: boolean
  thumbnailUrl?: string | null
}

export const hasFullCartonOf = (p: DisplayProduct) =>
  p.pcsPerCarton >= 1 && p.currentStock >= p.pcsPerCarton

export const isPictured = (p: DisplayProduct) => p.hasImage ?? Boolean(p.thumbnailUrl)

/**
 * Whether a product belongs on the grid the shopper is currently looking at.
 *
 * Two independent rules, and keeping them separate is the point:
 *
 * - Stock. Guests only ever see full cartons. A customer sees whatever their
 *   link's filter allows.
 * - Pictures. The pictureless view is the exact complement of the normal one:
 *   every product belongs to one side or the other, never both and never
 *   neither, so nothing can fall out of the catalog entirely.
 */
export function shouldDisplay(
  p: DisplayProduct,
  opts: {
    guestMode: boolean
    stockFilter: "ALL_PRODUCTS" | "FULL_CARTON_ONLY"
    hideNoImage: boolean
    noImageMode: boolean
  },
): boolean {
  const stockOk = opts.guestMode
    ? hasFullCartonOf(p)
    : opts.stockFilter === "ALL_PRODUCTS"
      ? p.currentStock > 0
      : hasFullCartonOf(p)
  if (!stockOk) return false

  const pictured = isPictured(p)
  if (opts.noImageMode) return !pictured
  return pictured || !opts.hideNoImage
}

/* ══════════════════════════════════════════════════════════════════════
   Delivery
══════════════════════════════════════════════════════════════════════ */

/**
 * The delivery sentence, from the same two settings the server uses for a
 * signed-in customer — so the shop cannot promise a guest one thing and a
 * customer another.
 */
export function deliveryLineFor(
  province: string | null | undefined,
  delivery: { northGovernorates?: string[]; freeShippingThreshold?: number } | null | undefined,
): string | null {
  const p = String(province ?? "").trim()
  if (!p || !delivery) return null
  if ((delivery.northGovernorates ?? []).includes(p)) {
    return "التوصيل لمنطقتك حسب البضاعة — نحسبه ونبلغك."
  }
  const threshold = Number(delivery.freeShippingThreshold || 0)
  return `توصيل مجاني للطلبات فوق ${threshold.toLocaleString("en-US")} دينار.`
}
