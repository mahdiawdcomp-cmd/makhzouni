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
import { buildCustomerSafeInvoiceDto, generateInvoicePdf, generateInvoicePng, generateCustomerImageInvoiceWithProducts } from "./invoice-export.service";

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

test("generateCustomerImageInvoiceWithProducts is exported as a callable function taking one invoiceId argument", () => {
  // Full rendering isn't independently DB-injectable (it calls
  // buildCustomerSafeInvoiceDto with the default real-prisma db), so the
  // safety-critical part (field allowlisting) is covered directly against
  // buildCustomerSafeInvoiceDto above; this just guards the export shape.
  assert.equal(typeof generateCustomerImageInvoiceWithProducts, "function");
  assert.equal(generateCustomerImageInvoiceWithProducts.length, 1);
});

test("embeddableImage-driven rendering: a data: URL image is embedded, a bare http(s) URL falls back to the placeholder", async () => {
  const dataUrlDb = fakeInvoiceDb({
    items: [{
      productName: "منتج له صورة", unit: "PIECE", quantity: 1, unitPrice: 100, totalPrice: 100,
      product: { thumbnailUrl: "data:image/jpeg;base64,/9j/AAAA", imageUrl: null },
    }],
  });
  const withImage = await buildCustomerSafeInvoiceDto("inv-3", dataUrlDb);
  assert.equal(withImage.lines[0].imageDataUrl, "data:image/jpeg;base64,/9j/AAAA");

  const httpUrlDb = fakeInvoiceDb({
    items: [{
      productName: "منتج رابط خارجي", unit: "PIECE", quantity: 1, unitPrice: 100, totalPrice: 100,
      product: { thumbnailUrl: null, imageUrl: "https://example.com/product.jpg" },
    }],
  });
  const withHttpUrl = await buildCustomerSafeInvoiceDto("inv-4", httpUrlDb);
  assert.equal(withHttpUrl.lines[0].imageDataUrl, null, "bare http(s) URLs cannot be rasterized offline -> must fall back to placeholder, not a broken reference");
});

// ── Old WhatsApp PDF path (feature request: "old option must stay exactly working") ──

test("the old WhatsApp PDF export functions are still exported as callable functions (unchanged by the new image-invoice feature)", () => {
  assert.equal(typeof generateInvoicePng, "function");
  assert.equal(typeof generateInvoicePdf, "function");
  assert.equal(generateInvoicePng.length, 1, "signature unchanged: still takes a single invoiceId argument");
  assert.equal(generateInvoicePdf.length, 1, "signature unchanged: still takes a single invoiceId argument");
});
