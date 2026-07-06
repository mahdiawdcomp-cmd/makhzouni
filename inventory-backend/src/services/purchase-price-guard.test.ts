/**
 * Regression tests for the PURCHASE-price zeroing bug.
 *
 * Bug: editing a PURCHASE invoice and adding a new line for a product whose
 * `purchasePrice` still sat at its DB default (0) sent `unitPrice: 0` to the
 * backend. In applyStockMovement the fallback `item.unitPrice ?? defaultUnitPrice(...)`
 * did NOT catch an explicit 0 (nullish-coalescing only rescues null/undefined), so
 * the 0 flowed into the Weighted-Average-Cost formula and silently overwrote the
 * product's `costPrice`/`purchasePrice` with 0.
 *
 * These tests mirror the pricing-resolution + WAC logic in invoice.service.ts
 * (applyStockMovement) and lock in the two-part fix:
 *   1. For PURCHASE, an explicit 0/negative is treated the SAME as "missing" and
 *      falls back to the product's purchase price.
 *   2. If no positive price can be resolved, the line is rejected (guard) instead
 *      of corrupting the product cost.
 *
 * Pure-logic; does not touch the database.
 */

import assert from "node:assert/strict";
import test from "node:test";

const InvoiceType = { SALE: "SALE", PURCHASE: "PURCHASE" } as const;
type InvoiceType = (typeof InvoiceType)[keyof typeof InvoiceType];

const roundMoney = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Mirror of the unit-price resolution in applyStockMovement.
 * `defaultPriceSource` is product.purchasePrice (PURCHASE) or product.salePrice (SALE).
 * Returns the resolved unit price, or throws PURCHASE_PRICE_REQUIRED when a PURCHASE
 * line cannot resolve a positive price.
 */
function resolveUnitPrice(
  invoiceType: InvoiceType,
  rawUnitPrice: number | null | undefined,
  defaultPriceSource: number,
): number {
  const effectiveRawUnitPrice =
    invoiceType === InvoiceType.PURCHASE && (rawUnitPrice == null || rawUnitPrice <= 0)
      ? undefined
      : rawUnitPrice;
  const unitPrice = effectiveRawUnitPrice ?? defaultPriceSource;

  if (invoiceType === InvoiceType.PURCHASE && !(unitPrice > 0)) {
    throw Object.assign(new Error("PURCHASE_PRICE_REQUIRED"), { code: "PURCHASE_PRICE_REQUIRED" });
  }
  return unitPrice;
}

/** Mirror of the WAC blend in applyStockMovement (piece units for simplicity). */
function blendWac(currentQty: number, currentCost: number, addQty: number, addUnitCost: number): number {
  const denom = currentQty + addQty;
  return denom > 0
    ? roundMoney((currentQty * currentCost + addQty * addUnitCost) / denom)
    : currentCost;
}

// ── Pricing resolution ────────────────────────────────────────────────────────

test("PURCHASE line with explicit 0 falls back to the product's purchase price", () => {
  const price = resolveUnitPrice(InvoiceType.PURCHASE, 0, 1500);
  assert.equal(price, 1500);
});

test("PURCHASE line with negative price falls back to the product's purchase price", () => {
  const price = resolveUnitPrice(InvoiceType.PURCHASE, -5, 1500);
  assert.equal(price, 1500);
});

test("PURCHASE line with a real price uses it as-is", () => {
  const price = resolveUnitPrice(InvoiceType.PURCHASE, 2000, 1500);
  assert.equal(price, 2000);
});

test("PURCHASE line with 0 price AND no product purchase price is rejected", () => {
  assert.throws(
    () => resolveUnitPrice(InvoiceType.PURCHASE, 0, 0),
    (err: any) => err.code === "PURCHASE_PRICE_REQUIRED",
  );
});

test("SALE line keeps an explicit 0 (free/gift line stays valid)", () => {
  const price = resolveUnitPrice(InvoiceType.SALE, 0, 3000);
  assert.equal(price, 0);
});

// ── Cost never zeroes ──────────────────────────────────────────────────────────

test("editing a purchase and adding a 0-priced new line does NOT zero an existing cost", () => {
  // Existing product previously purchased at cost 1500, 10 pieces in stock.
  const existingCost = 1500;
  // The new line arrives with unitPrice 0 (frontend pre-fill bug) but the product
  // has a known purchase price of 1500 → resolves to 1500, not 0.
  const resolved = resolveUnitPrice(InvoiceType.PURCHASE, 0, existingCost);
  const newCost = blendWac(10, existingCost, 5, resolved);
  assert.equal(newCost, 1500);
  assert.ok(newCost > 0, "cost must never be dragged to zero");
});

test("guard prevents the corrupting path entirely for a never-priced product", () => {
  // Brand-new product, never purchased (purchasePrice default 0), 0 entered.
  // Old behaviour: WAC would blend toward 0. New behaviour: rejected before any write.
  assert.throws(
    () => resolveUnitPrice(InvoiceType.PURCHASE, 0, 0),
    (err: any) => err.code === "PURCHASE_PRICE_REQUIRED",
  );
});
