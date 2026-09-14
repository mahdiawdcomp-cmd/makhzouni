/**
 * The price priority rule, tested as a rule.
 *
 * These are pure: no database, no clock of their own. If this file passes and
 * the order path still misprices, the bug is in what the order path FEEDS the
 * resolver, not in the rule itself — which is the point of splitting them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Unit } from "@prisma/client";
import {
  AgentApprovedPriceRow,
  AgentOfferRow,
  catalogUnitPrice,
  offerIsLive,
  offerUnitPrice,
  priceKey,
  resolveAgentUnitPrice,
} from "./sales-agent-pricing";
import { priceChangeFor } from "../services/sales-agent-history.service";

const productId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-09-14T10:00:00.000Z");

const product = {
  id: productId,
  salePrice: 1000,
  cartonPiecePrice: 750,
  pcsPerCarton: 48,
  boxPieces: 24,
};

function offer(patch: Partial<AgentOfferRow> = {}): AgentOfferRow {
  return {
    id: "offer-1",
    productId,
    unit: Unit.CARTON,
    priceMode: "WHOLESALE",
    discountType: "PERCENT",
    fixedPrice: null,
    discountPercent: 10,
    startsAt: new Date("2026-09-01T00:00:00.000Z"),
    endsAt: new Date("2026-09-30T00:00:00.000Z"),
    isActive: true,
    note: null,
    ...patch,
  };
}

function offers(row: AgentOfferRow) {
  return new Map([[priceKey(row.productId, row.unit), row]]);
}

function approved(price: number, unit: Unit = Unit.CARTON) {
  const row: AgentApprovedPriceRow = { id: "approved-1", productId, unit, price };
  return new Map([[priceKey(productId, unit), row]]);
}

test("carton mode prices from the carton piece price, wholesale from the sale price", () => {
  assert.equal(catalogUnitPrice(product, Unit.CARTON, "CARTON"), 36000);
  assert.equal(catalogUnitPrice(product, Unit.CARTON, "WHOLESALE"), 48000);
  assert.equal(catalogUnitPrice(product, Unit.DOZEN, "WHOLESALE"), 12000);
  assert.equal(catalogUnitPrice(product, Unit.BOX, "WHOLESALE"), 24000);
  assert.equal(catalogUnitPrice(product, Unit.PIECE, "WHOLESALE"), 1000);
});

test("an approved price request outranks a live offer", () => {
  const resolved = resolveAgentUnitPrice({
    product,
    unit: Unit.CARTON,
    priceMode: "WHOLESALE",
    now,
    approvedPrices: approved(40000),
    offers: offers(offer()),
  });
  assert.equal(resolved.source, "APPROVED_REQUEST");
  assert.equal(resolved.unitPrice, 40000);
  assert.equal(resolved.catalogPrice, 48000);
  assert.equal(resolved.approvedPriceId, "approved-1");
});

test("a live offer outranks the catalog price", () => {
  const resolved = resolveAgentUnitPrice({
    product,
    unit: Unit.CARTON,
    priceMode: "WHOLESALE",
    now,
    offers: offers(offer()),
  });
  assert.equal(resolved.source, "OFFER");
  assert.equal(resolved.unitPrice, 43200); // 48000 − 10%
  assert.equal(resolved.offer?.id, "offer-1");
});

test("an approved price request is NOT applied to carton distribution", () => {
  const resolved = resolveAgentUnitPrice({
    product,
    unit: Unit.CARTON,
    priceMode: "CARTON",
    now,
    approvedPrices: approved(40000),
  });
  assert.equal(resolved.source, "CATALOG");
  assert.equal(resolved.unitPrice, 36000);
});

test("an offer for the other price basis is ignored, not converted", () => {
  const resolved = resolveAgentUnitPrice({
    product,
    unit: Unit.CARTON,
    priceMode: "CARTON",
    now,
    offers: offers(offer({ priceMode: "WHOLESALE", discountType: "AMOUNT", fixedPrice: 30000 })),
  });
  assert.equal(resolved.source, "CATALOG");
  assert.equal(resolved.unitPrice, 36000);
});

test("an offer applies to carton distribution when it was made for that basis", () => {
  const resolved = resolveAgentUnitPrice({
    product,
    unit: Unit.CARTON,
    priceMode: "CARTON",
    now,
    offers: offers(offer({ priceMode: "CARTON", discountType: "AMOUNT", fixedPrice: 30000 })),
  });
  assert.equal(resolved.source, "OFFER");
  assert.equal(resolved.unitPrice, 30000);
});

test("paused, unstarted and finished offers all fall back to the catalog price", () => {
  for (const patch of [
    { isActive: false },
    { startsAt: new Date("2026-09-20T00:00:00.000Z") },
    { endsAt: new Date("2026-09-10T00:00:00.000Z") },
  ]) {
    const resolved = resolveAgentUnitPrice({
      product,
      unit: Unit.CARTON,
      priceMode: "WHOLESALE",
      now,
      offers: offers(offer(patch)),
    });
    assert.equal(resolved.source, "CATALOG", JSON.stringify(patch));
    assert.equal(resolved.unitPrice, 48000);
  }
});

test("endsAt is exclusive, so an offer is over at the instant it ends", () => {
  const ending = offer({ endsAt: now });
  assert.equal(offerIsLive(ending, now), false);
  assert.equal(offerIsLive(offer({ endsAt: new Date(now.getTime() + 1) }), now), true);
});

test("unusable offer numbers are refused instead of pricing a line at zero", () => {
  const base = 48000;
  assert.equal(offerUnitPrice(offer({ discountType: "AMOUNT", fixedPrice: 0 }), base), null);
  assert.equal(offerUnitPrice(offer({ discountType: "AMOUNT", fixedPrice: -5 }), base), null);
  assert.equal(offerUnitPrice(offer({ discountPercent: 0 }), base), null);
  assert.equal(offerUnitPrice(offer({ discountPercent: 100 }), base), null);
  assert.equal(offerUnitPrice(offer({ discountPercent: 25 }), base), 36000);
  // A broken offer must not swallow the sale: the resolver falls back.
  const resolved = resolveAgentUnitPrice({
    product,
    unit: Unit.CARTON,
    priceMode: "WHOLESALE",
    now,
    offers: offers(offer({ discountType: "AMOUNT", fixedPrice: 0 })),
  });
  assert.equal(resolved.source, "CATALOG");
  assert.equal(resolved.unitPrice, 48000);
});

/* ── the price-change note ───────────────────────────────────────────── */

const lastPaid = (patch: Partial<{ unitPrice: number; priceMode: string; date: Date }> = {}) => ({
  productId,
  unit: Unit.CARTON,
  unitPrice: 40000,
  quantity: 2,
  date: new Date("2026-08-01T00:00:00.000Z"),
  priceMode: "WHOLESALE",
  ...patch,
});

test("a price rise and a price drop are both reported with the difference and percent", () => {
  const up = priceChangeFor(lastPaid(), 48000, "WHOLESALE");
  assert.equal(up?.direction, "UP");
  assert.equal(up?.previousPrice, 40000);
  assert.equal(up?.difference, 8000);
  assert.equal(up?.percent, 20);

  const down = priceChangeFor(lastPaid(), 36000, "WHOLESALE");
  assert.equal(down?.direction, "DOWN");
  assert.equal(down?.difference, -4000);
  assert.equal(down?.percent, -10);
});

test("no previous purchase, an unchanged price, or a different price basis say nothing", () => {
  assert.equal(priceChangeFor(undefined, 48000, "WHOLESALE"), null);
  assert.equal(priceChangeFor(lastPaid(), 40000, "WHOLESALE"), null);
  // History written before the carton split carries WHOLESALE; comparing it
  // against a distribution price would invent a difference.
  assert.equal(priceChangeFor(lastPaid(), 36000, "CARTON"), null);
  assert.equal(priceChangeFor(lastPaid({ unitPrice: 0 }), 36000, "WHOLESALE"), null);
});
