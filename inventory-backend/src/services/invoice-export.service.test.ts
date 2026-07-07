/**
 * Regression guard for the customer-safe WhatsApp image invoice (feature 2).
 * Feeds a fake `db.invoice.findUnique` that deliberately carries forbidden
 * fields (purchasePrice/costPrice/margin/notes) attached to the mock invoice
 * and its product rows, then asserts the built DTO — and its JSON form —
 * never contains them. This is the safety net for "never leak cost/profit
 * to a customer-facing invoice".
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildCustomerSafeInvoiceDto } from "./invoice-export.service";

const FORBIDDEN_KEYS = ["purchasePrice", "costPrice", "profit", "margin", "internalNotes", "notes"];

function fakeInvoiceDb(overrides: Record<string, unknown> = {}) {
  const invoice = {
    invoiceNumber: "INV-9001",
    date: new Date("2026-07-01"),
    type: "SALE",
    totalAmount: 50000,
    paidAmount: 30000,
    remainingAmount: 20000,
    // Forbidden fields deliberately present on the raw row, simulating what
    // would happen if a future edit widened the Prisma `select`. The mapping
    // code in buildCustomerSafeInvoiceDto must not carry these through.
    purchasePrice: 999,
    costPrice: 888,
    profitMargin: 0.4,
    internalNotes: "سري - لا يُرسل للزبون",
    customer: { name: "أحمد" },
    items: [
      {
        productName: "منتج تجريبي",
        unit: "PIECE",
        quantity: 2,
        unitPrice: 25000,
        totalPrice: 50000,
        // Forbidden per-line fields that must never reach the output.
        costPrice: 15000,
        purchasePrice: 14000,
        profit: 10000,
        notes: "ملاحظة داخلية للمحاسب فقط",
        product: {
          thumbnailUrl: null,
          imageUrl: null,
          purchasePrice: 14000,
          costPrice: 15000,
        },
      },
    ],
    ...overrides,
  };
  return {
    invoice: { findUnique: async () => invoice },
  } as unknown as Pick<typeof import("../config/database").default, "invoice">;
}

test("customer-safe invoice DTO never includes purchase price, cost price, profit, margin, or internal notes", async () => {
  const dto = await buildCustomerSafeInvoiceDto("inv-1", fakeInvoiceDb());
  const json = JSON.stringify(dto);

  for (const key of FORBIDDEN_KEYS) {
    assert.ok(!(key in dto), `top-level DTO must not have key "${key}"`);
    for (const line of dto.lines) {
      assert.ok(!(key in line), `line DTO must not have key "${key}"`);
    }
  }
  // Also assert the forbidden VALUES never leak through under a different key.
  assert.ok(!json.includes("999"), "raw purchasePrice value must not appear anywhere in the DTO");
  assert.ok(!json.includes("888"), "raw costPrice value must not appear anywhere in the DTO");
  assert.ok(!json.includes("سري - لا يُرسل للزبون"), "internal notes text must not appear in the DTO");
  assert.ok(!json.includes("ملاحظة داخلية للمحاسب فقط"), "internal line notes text must not appear in the DTO");
});

test("customer-safe invoice DTO only exposes the explicit customer-facing allowlist", async () => {
  const dto = await buildCustomerSafeInvoiceDto("inv-1", fakeInvoiceDb());
  assert.deepEqual(Object.keys(dto).sort(), [
    "currency", "customerName", "date", "invoiceNumber", "lines",
    "paidAmount", "remainingAmount", "storeLogo", "storeName", "totalAmount",
  ].sort());
  assert.deepEqual(Object.keys(dto.lines[0]).sort(), [
    "imageDataUrl", "productName", "quantity", "totalPrice", "unit", "unitPrice",
  ].sort());
});

test("rejects PURCHASE invoices — this feature is customer-facing SALE invoices only", async () => {
  await assert.rejects(
    () => buildCustomerSafeInvoiceDto("inv-2", fakeInvoiceDb({ type: "PURCHASE" })),
    /فواتير البيع فقط|NOT_A_SALE_INVOICE/,
  );
});
