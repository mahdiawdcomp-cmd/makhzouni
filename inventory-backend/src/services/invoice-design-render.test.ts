// The shop's own invoice design is now what every send path rasterises, so the
// renderer has to survive the shapes a real invoice throws at it: long product
// names, a narrow thermal receipt, purchase invoices with cartons, and a design
// JSON that is missing or corrupt.

import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultDesign,
  parseDesigns,
  renderDesignSvg,
  renderDesignPng,
  resolveField,
  wrapText,
  type PrintInvoice,
  type PrintStore,
} from "./invoice-design-render";

const store: PrintStore = {
  storeName: "مخزوني للتجارة",
  storePhone: "0770 000 1111",
  storeAddress: "بغداد - الشورجة",
  currency: "د.ع",
};

function sampleInvoice(overrides: Partial<PrintInvoice> = {}): PrintInvoice {
  return {
    number: "INV-1042",
    date: "2026-09-05",
    customerName: "محل الرافدين",
    customerPhone: "0770 123 4567",
    lines: [
      { name: "شاحن سريع نوع C", unit: "قطعة", qty: 3, price: 7500, itemNumber: "A-1042", notes: "لون أسود" },
      { name: "حافظة موبايل", unit: "كرتونة", qty: 10, price: 2000, itemNumber: "C-9", pcsPerCarton: 24 },
    ],
    notes: "لا تُرد بعد 3 أيام",
    subtotal: 42500, discount: 2500, tax: 0, total: 40000,
    paid: 15000, remaining: 25000, previousBalance: 5000, finalBalance: 30000,
    paymentType: "جزئي",
    invoiceType: "SALE",
    ...overrides,
  };
}

test("a missing or corrupt design falls back to the built-in layouts instead of throwing", () => {
  for (const json of [undefined, null, "", "not json", "{}", '{"v":1}']) {
    const designs = parseDesigns(json as string | null | undefined);
    assert.equal(designs.a4.paper, "a4");
    assert.equal(designs["80mm"].paper, "80mm");
    assert.ok(designs.a4.elements.length > 0);
  }
});

test("a saved design is used verbatim — the renderer never substitutes its own layout", () => {
  const custom = {
    designs: {
      a4: {
        v: 2, paper: "a4", width: 794, height: 1123,
        elements: [
          { id: "t1", type: "text", x: 40, y: 40, w: 300, h: 30, fontSize: 20, text: "علامة مميزة جداً" },
          { id: "i1", type: "items", x: 40, y: 100, w: 714, h: 300, fontSize: 12, showQty: true, showPrice: true },
        ],
      },
    },
  };
  const design = parseDesigns(JSON.stringify(custom)).a4;
  const { svg } = renderDesignSvg(design, sampleInvoice(), store);
  assert.match(svg, /علامة مميزة جداً/);
  // The default layout's store-name field is not part of this design.
  assert.doesNotMatch(svg, /مخزوني للتجارة/);
});

test("the rendered invoice carries the figures a customer needs, item number included", () => {
  const { svg } = renderDesignSvg(defaultDesign("a4"), sampleInvoice(), store);
  for (const expected of [
    "INV-1042",          // invoice number
    "A-1042",            // item number column
    "شاحن سريع نوع C",   // product name
    "40,000",            // invoice total
    "15,000",            // paid
    "25,000",            // remaining
    "5,000",             // previous balance
    "30,000",            // grand total owed
    "محل الرافدين",      // customer
  ]) {
    assert.ok(svg.includes(expected), `rendered invoice must show "${expected}"`);
  }
});

test("purchase invoices show cartons and negate the stored balance sign", () => {
  const purchase = sampleInvoice({ invoiceType: "PURCHASE", previousBalance: -5000, finalBalance: -30000 });
  const { svg } = renderDesignSvg(defaultDesign("a4"), purchase, store);
  assert.match(svg, /الكراتين/, "a purchase with a carton size gets the carton column");
  assert.match(svg, /مجموع الكراتين/);
  // 10 cartons of 24 => the carton column counts cartons, not loose pieces.
  assert.match(svg, /مجموع الكراتين: 10/);
  assert.ok(svg.includes("5,000") && !svg.includes("-5,000"), "supplier balance is displayed positive");
});

test("a sale never gets the carton column — a sale is counted in pieces", () => {
  const { svg } = renderDesignSvg(defaultDesign("a4"), sampleInvoice(), store);
  assert.doesNotMatch(svg, /مجموع الكراتين/);
});

test("the page grows to fit a long invoice instead of clipping its rows", () => {
  const short = renderDesignSvg(defaultDesign("a4"), sampleInvoice(), store);
  const many = sampleInvoice({
    lines: Array.from({ length: 40 }, (_, i) => ({
      name: `صنف رقم ${i + 1} باسم طويل جداً يحتاج أكثر من سطر واحد داخل العمود`,
      unit: "قطعة", qty: i + 1, price: 1000 * (i + 1), itemNumber: `X-${i}`,
    })),
  });
  const long = renderDesignSvg(defaultDesign("a4"), many, store);
  assert.ok(long.height > short.height, "40 lines must produce a taller page than 2");
  assert.match(long.svg, /صنف رقم 40/, "the last line is still drawn");
});

test("text is right-to-left anchored so it cannot drift off the paper", () => {
  const { svg } = renderDesignSvg(defaultDesign("a4"), sampleInvoice(), store);
  assert.match(svg, /direction:rtl/);
  assert.doesNotMatch(svg, /x="-/, "no element is positioned off the left edge");
});

test("empty and absent values are skipped rather than printed as blanks", () => {
  const bare = sampleInvoice({ customerPhone: "", notes: "", lines: [] });
  const { svg } = renderDesignSvg(defaultDesign("a4"), bare, { storeName: "محل", currency: "د.ع" });
  assert.doesNotMatch(svg, /الهاتف: <\/text>/);
  assert.doesNotMatch(svg, /ملاحظات: <\/text>/);
});

test("previousBalance renders as a dash when there is no prior balance", () => {
  assert.equal(resolveField("previousBalance", sampleInvoice({ previousBalance: 0 }), store), "—");
});

test("wrapText never loses a word and never returns more lines than allowed", () => {
  const text = "سماعة بلوتوث رياضية مقاومة للماء مع علبة شحن سريعة";
  const lines = wrapText(text, 120, 13);
  assert.ok(lines.length > 1, "a long name wraps");
  assert.equal(lines.join(" ").replace(/\s+/g, " "), text);
  assert.ok(wrapText(text, 40, 13, false, 2).length <= 2, "maxLines is respected");
  assert.deepEqual(wrapText("", 100, 13), []);
  // A single word wider than the column is broken rather than overflowing.
  assert.ok(wrapText("ABCDEFGHIJKLMNOPQRSTUVWXYZ", 30, 13).length > 1);
});

test("both papers rasterise to a real PNG at the requested scale", async () => {
  for (const paper of ["a4", "80mm"] as const) {
    const { png, pageWidth, pageHeight } = await renderDesignPng(defaultDesign(paper), sampleInvoice(), store, 2);
    assert.ok(png.length > 0);
    // PNG magic bytes — proof it is an image, not an HTML page with a .png name.
    assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    assert.equal(pageWidth, paper === "a4" ? 794 : 302, "the PDF page keeps the real paper width");
    assert.ok(pageHeight > 0);
  }
});
