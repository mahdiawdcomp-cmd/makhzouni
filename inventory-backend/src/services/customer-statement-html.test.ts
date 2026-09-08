import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildStatementsHtmlReport, type StatementExportEntry } from "./customer-statement-html.service";

function entry(over: Partial<StatementExportEntry> = {}): StatementExportEntry {
  return {
    customer: { name: "زبون", phone: "07700000000", openingBalance: 0, currentBalance: 0 },
    transactions: [],
    ...over,
  };
}

const NO_STORE = { storeName: null, storeLogo: null };
const AT = new Date("2026-09-09T12:00:00.000Z");

describe("the file the merchant opens", () => {
  test("is a standalone document that needs no JavaScript", () => {
    const html = buildStatementsHtmlReport([entry()], NO_STORE, AT);
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<html dir="rtl" lang="ar">/);
    // <details> does the collapsing. A <script> here would be dead in a file
    // opened from disk years later, which is the whole point of this export.
    assert.equal(/<script/i.test(html), false);
  });

  test("says something coherent for a shop with no customers", () => {
    const html = buildStatementsHtmlReport([], NO_STORE, AT);
    assert.match(html, /لا يوجد زبائن لديهم حركات/);
  });

  test("a customer with no rows is listed, not dropped", () => {
    const html = buildStatementsHtmlReport([entry({ customer: { name: "فاضي" } })], NO_STORE, AT);
    assert.match(html, /فاضي/);
    assert.match(html, /لا توجد حركات/);
  });
});

describe("what the rows say", () => {
  test("a paid invoice is one line, not an invoice plus a mystery payment", () => {
    // Both rows share the invoice's id — that is what marks the payment as
    // belonging to it. Printed separately the invoice line also shows a
    // running balance the payment has already moved past.
    const html = buildStatementsHtmlReport(
      [
        entry({
          transactions: [
            { id: "inv-1", date: "2026-09-01", type: "INVOICE", invoiceType: "SALE", referenceNumber: "S-1", debit: 1000, credit: 0, runningBalance: 1000 },
            { id: "inv-1", date: "2026-09-01", type: "INVOICE_PAYMENT", referenceNumber: "S-1", debit: 0, credit: 400, runningBalance: 600 },
          ],
        }),
      ],
      NO_STORE,
      AT,
    );
    assert.equal((html.match(/S-1/g) ?? []).length, 1, "the payment row should have been folded in");
    assert.match(html, /600/, "the line must carry the balance AFTER the payment");
    assert.equal(/دفعة/.test(html), false, "a folded payment must not also print as its own row");
  });

  test("a cancelled invoice is labelled cancelled, whatever its type", () => {
    const html = buildStatementsHtmlReport(
      [entry({ transactions: [{ id: "x", date: "2026-09-01", type: "INVOICE", invoiceType: "SALE", status: "CANCELLED" }] })],
      NO_STORE,
      AT,
    );
    assert.match(html, /فاتورة ملغاة/);
  });

  test("a paid purchase is not mislabelled a sale", () => {
    // It legitimately carries BOTH a debit and a credit, so any guess made
    // from which side is non-zero gets this one wrong.
    const html = buildStatementsHtmlReport(
      [entry({ transactions: [{ id: "p", date: "2026-09-01", type: "INVOICE", invoiceType: "PURCHASE", debit: 500, credit: 500 }] })],
      NO_STORE,
      AT,
    );
    assert.match(html, /فاتورة شراء/);
    assert.equal(/فاتورة بيع/.test(html), false);
  });

  test("a zero side is blank, not a printed 0", () => {
    const html = buildStatementsHtmlReport(
      [entry({ transactions: [{ id: "z", date: "2026-09-01", type: "RECEIPT", debit: 0, credit: 250, runningBalance: 0 }] })],
      NO_STORE,
      AT,
    );
    assert.match(html, /<span class="tx-debit"><\/span>/);
    assert.match(html, /<span class="tx-credit">250<\/span>/);
  });
});

describe("dates are printed where they are read, not where the server runs", () => {
  test("an evening instant keeps its own day in the merchant's zone", () => {
    // 21:00 in Baghdad is 18:00 UTC — same day either way is not the trap.
    // 2026-09-01T22:30+03:00 is 19:30Z, but 2026-09-01T00:30+03:00 is the
    // PREVIOUS day in UTC, which is what used to shift a row backwards.
    const row = { id: "d", date: "2026-08-31T22:30:00.000Z", type: "RECEIPT", credit: 1 };
    const baghdad = buildStatementsHtmlReport([entry({ transactions: [row] })], NO_STORE, AT, "Etc/GMT-3");
    const utc = buildStatementsHtmlReport([entry({ transactions: [row] })], NO_STORE, AT, "UTC");
    assert.match(baghdad, /9\/1\/26/, "01:30 Baghdad belongs to September 1st");
    assert.match(utc, /8\/31\/26/, "the same instant is still August 31st in UTC");
  });

  test("a date-only value is a calendar date and never shifts", () => {
    const row = { id: "c", date: "2026-09-01", type: "RECEIPT", credit: 1 };
    for (const tz of ["UTC", "Etc/GMT-3", "Etc/GMT+10"]) {
      const html = buildStatementsHtmlReport([entry({ transactions: [row] })], NO_STORE, AT, tz);
      assert.match(html, /9\/1\/26/, `a plain date must not move in ${tz}`);
    }
  });
});

describe("untrusted text cannot break out of the document", () => {
  test("a customer name is escaped, not injected", () => {
    const html = buildStatementsHtmlReport(
      [entry({ customer: { name: '<script>alert(1)</script>', phone: '" onload="x' } })],
      NO_STORE,
      AT,
    );
    assert.equal(/<script>alert/.test(html), false);
    assert.match(html, /&lt;script&gt;/);
    assert.equal(/ onload="x/.test(html), false);
  });

  test("a product name inside an invoice's items is escaped too", () => {
    const html = buildStatementsHtmlReport(
      [
        entry({
          transactions: [
            { id: "i", date: "2026-09-01", type: "INVOICE", invoiceType: "SALE", items: [{ productName: "<b>x</b>", quantity: 2, unit: "CARTON", unitPrice: 5, totalPrice: 10 }] },
          ],
        }),
      ],
      NO_STORE,
      AT,
    );
    assert.equal(/<b>x<\/b>/.test(html), false);
    assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
    assert.match(html, /كرتون/, "the unit should print as its Arabic label");
  });
});
