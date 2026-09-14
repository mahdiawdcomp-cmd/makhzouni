/**
 * The ONE place that decides what a rep's line costs.
 *
 * Three things can set a price for the same (customer, product, unit), so the
 * order between them has to be fixed somewhere a reader can find it. This file
 * is that place, and both the review preview and the real submission call it —
 * a preview that priced differently from the submission would make the whole
 * review step a lie.
 *
 * Priority, highest first:
 *
 *  1. `APPROVED_REQUEST` — an approved, unspent `SalesAgentPriceRequest` for
 *     this exact product+unit. A human looked at this specific number and said
 *     yes to it, which outranks any standing rule. Wholesale only: the approval
 *     screen never asked the owner which price basis they were approving, so
 *     applying it to carton distribution would be inventing consent.
 *  2. `OFFER` — a live `SalesAgentCustomerOffer` for this product+unit+price
 *     mode. Standing, time-boxed, and set by the owner in advance.
 *  3. `CATALOG` — the ordinary price: `cartonPiecePrice` in CARTON mode,
 *     `salePrice` in WHOLESALE, converted to the line's unit.
 *
 * An offer that is paused, not started yet, or finished is simply absent — the
 * price returns to normal on its own with no job to run and no row to clean up.
 */
import { Unit } from "@prisma/client";
import { roundMoney } from "./financial";
import { priceForUnit } from "./catalog-units";

export type AgentPriceMode = "WHOLESALE" | "CARTON";

export type AgentOfferRow = {
  id: string;
  productId: string;
  unit: Unit;
  priceMode: string;
  discountType: "PERCENT" | "AMOUNT";
  fixedPrice: number | null;
  discountPercent: number | null;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
  note?: string | null;
};

export type AgentApprovedPriceRow = {
  id: string;
  productId: string;
  unit: Unit;
  price: number;
};

export type AgentPriceSource = "APPROVED_REQUEST" | "OFFER" | "CATALOG";

export type ResolvedAgentPrice = {
  unitPrice: number;
  /** What the same line would cost with no offer and no approved price. */
  catalogPrice: number;
  source: AgentPriceSource;
  approvedPriceId?: string;
  offer?: {
    id: string;
    endsAt: Date;
    discountType: "PERCENT" | "AMOUNT";
    discountPercent: number | null;
    note: string | null;
  };
};

/** `product:unit` — the key both the offer map and the approved-price map use. */
export function priceKey(productId: string, unit: Unit) {
  return `${productId}:${unit}`;
}

/**
 * Is this offer in force right now?
 *
 * `endsAt` is exclusive so an offer and its replacement can meet on the same
 * instant without both being live. The caller passes `now` rather than reading
 * the clock here so a review and its submission can be judged at one moment,
 * and so the shop's timezone is decided by the caller, not by this file.
 */
export function offerIsLive(offer: AgentOfferRow, now: Date): boolean {
  if (!offer.isActive) return false;
  if (offer.startsAt.getTime() > now.getTime()) return false;
  return offer.endsAt.getTime() > now.getTime();
}

/**
 * What one unit costs under this offer, or `null` if the offer cannot produce a
 * usable price.
 *
 * A PERCENT offer is relative, so it works on any base. An AMOUNT offer is the
 * final price outright — the owner typed the number they meant, including the
 * rare case where it is above the shelf price. Zero and negative are refused
 * either way: a free line is a giveaway decision, not a discount.
 */
export function offerUnitPrice(offer: AgentOfferRow, catalogPrice: number): number | null {
  if (offer.discountType === "AMOUNT") {
    const fixed = Number(offer.fixedPrice);
    if (!Number.isFinite(fixed) || fixed <= 0) return null;
    return roundMoney(fixed);
  }
  const percent = Number(offer.discountPercent);
  if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) return null;
  if (!Number.isFinite(catalogPrice) || catalogPrice <= 0) return null;
  const price = roundMoney(catalogPrice * ((100 - percent) / 100));
  return price > 0 ? price : null;
}

export type CatalogPriceInput = {
  salePrice: unknown;
  cartonPiecePrice: unknown;
  pcsPerCarton: number;
  boxPieces?: number | null;
};

/** The ordinary price of one `unit`, before any offer or approved price. */
export function catalogUnitPrice(
  product: CatalogPriceInput,
  unit: Unit,
  priceMode: AgentPriceMode,
): number {
  const perPiece = priceMode === "CARTON" ? product.cartonPiecePrice : product.salePrice;
  return priceForUnit(unit, perPiece, product.pcsPerCarton, product.boxPieces);
}

/**
 * Resolve one line's price. Pure — every input is passed in, so the rule can be
 * tested without a database and cannot drift between preview and submission.
 */
export function resolveAgentUnitPrice(input: {
  product: CatalogPriceInput & { id: string };
  unit: Unit;
  priceMode: AgentPriceMode;
  now: Date;
  /** Approved, unspent price requests keyed by `priceKey`. */
  approvedPrices?: Map<string, AgentApprovedPriceRow>;
  /** Live-or-not offers keyed by `priceKey`; liveness is checked here. */
  offers?: Map<string, AgentOfferRow>;
}): ResolvedAgentPrice {
  const { product, unit, priceMode, now } = input;
  const catalogPrice = catalogUnitPrice(product, unit, priceMode);
  const key = priceKey(product.id, unit);

  // 1. Approved price request — wholesale only, see the file header.
  if (priceMode === "WHOLESALE") {
    const approved = input.approvedPrices?.get(key);
    if (approved && Number.isFinite(approved.price) && approved.price > 0) {
      return {
        unitPrice: roundMoney(approved.price),
        catalogPrice,
        source: "APPROVED_REQUEST",
        approvedPriceId: approved.id,
      };
    }
  }

  // 2. Standing offer for this exact price basis.
  const offer = input.offers?.get(key);
  if (offer && offer.priceMode === priceMode && offerIsLive(offer, now)) {
    const price = offerUnitPrice(offer, catalogPrice);
    if (price !== null) {
      return {
        unitPrice: price,
        catalogPrice,
        source: "OFFER",
        offer: {
          id: offer.id,
          endsAt: offer.endsAt,
          discountType: offer.discountType,
          discountPercent: offer.discountPercent,
          note: offer.note ?? null,
        },
      };
    }
  }

  // 3. The ordinary catalog price.
  return { unitPrice: roundMoney(catalogPrice), catalogPrice, source: "CATALOG" };
}
