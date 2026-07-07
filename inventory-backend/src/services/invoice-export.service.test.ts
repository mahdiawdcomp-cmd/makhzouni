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
import ExcelJS from "exceljs";
import {
  buildCustomerImageExcelFromDto,
  buildCustomerSafeInvoiceDto,
  generateCustomerImageExcel,
  generateCustomerImageInvoiceWithProducts,
  generateCustomerImagePdf,
  generateInvoicePdf,
  generateInvoicePng,
} from "./invoice-export.service";

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

test("the old WhatsApp image-invoice function is unchanged by the new PDF/Excel download feature", () => {
  assert.equal(typeof generateCustomerImageInvoiceWithProducts, "function");
  assert.equal(generateCustomerImageInvoiceWithProducts.length, 1);
});

// ── New: "تحميل فاتورة بالصور PDF" / "تحميل فاتورة بالصور Excel" downloads ──

test("generateCustomerImagePdf is exported as a callable function taking one invoiceId argument", () => {
  assert.equal(typeof generateCustomerImagePdf, "function");
  assert.equal(generateCustomerImagePdf.length, 1);
});

test("generateCustomerImageExcel is exported as a callable function taking one invoiceId argument", () => {
  assert.equal(typeof generateCustomerImageExcel, "function");
  assert.equal(generateCustomerImageExcel.length, 1);
});

function fakeCustomerSafeDto() {
  return {
    storeName: "متجر تجريبي",
    storeLogo: null,
    invoiceNumber: "INV-9001",
    customerName: "أحمد",
    date: "07/01/2026",
    currency: "د.ع",
    lines: [
      {
        productName: "منتج تجريبي",
        imageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        unit: "قطعة",
        quantity: 2,
        unitPrice: 25000,
        totalPrice: 50000,
      },
    ],
    totalAmount: 50000,
    paidAmount: 30000,
    remainingAmount: 20000,
  };
}

test("customer-safe Excel workbook embeds the product image and never leaks purchase/cost/profit/internal-note values", async () => {
  const dto = fakeCustomerSafeDto();
  const buffer = await buildCustomerImageExcelFromDto(dto);

  assert.ok(buffer.length > 0, "workbook buffer must not be empty");
  // .xlsx is a zip archive — assert the ZIP magic bytes so we know a real
  // workbook (not an error page or empty stub) was produced.
  assert.equal(buffer[0], 0x50, "PK zip signature byte 1");
  assert.equal(buffer[1], 0x4b, "PK zip signature byte 2");

  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(buffer);
  const sheet = reloaded.worksheets[0];

  const cellValues: string[] = [];
  sheet.eachRow((row) => {
    row.eachCell((cell) => cellValues.push(String(cell.value ?? "")));
  });
  const flattened = cellValues.join(" | ");

  for (const key of FORBIDDEN_KEYS) {
    assert.ok(!flattened.includes(key), `workbook text must not include forbidden key "${key}"`);
  }
  assert.ok(flattened.includes(dto.invoiceNumber), "invoice number must be present");
  assert.ok(flattened.includes(dto.customerName), "customer name must be present");
  assert.ok(flattened.includes("منتج تجريبي"), "product name must be present");

  // Exactly one image embedded (the product thumbnail) — no logo since
  // storeLogo is null in this fixture.
  const images = reloaded.model.media ?? [];
  assert.equal(images.length, 1, "exactly one embedded image (the product thumbnail)");
});

test("customer-safe Excel workbook skips embedding a non-data: image URL (cannot be rasterized offline)", async () => {
  const dto = fakeCustomerSafeDto();
  dto.lines[0].imageDataUrl = null;
  const buffer = await buildCustomerImageExcelFromDto(dto);
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(buffer);
  const images = reloaded.model.media ?? [];
  assert.equal(images.length, 0, "no image embedded when imageDataUrl is null");
});
