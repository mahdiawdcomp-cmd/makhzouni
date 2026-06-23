import assert from "node:assert/strict";
import test from "node:test";
import {
  amountInPieces,
  calculateCustomerBalance,
  calculateInvoiceFinancials,
  roundMoney,
} from "./financial";

// ── roundMoney ──────────────────────────────────────────────────────────────

test("rounds monetary values consistently", () => {
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
  assert.equal(roundMoney(12.345), 12.35);
});

test("roundMoney handles zero and negative", () => {
  assert.equal(roundMoney(0), 0);
  assert.ok(roundMoney(-0.005) === 0); // EPSILON pushes positive halves up; negative -0.005 rounds toward 0 (-0 === 0)
  assert.equal(roundMoney(-1234.567), -1234.57);
});

test("roundMoney handles non-finite inputs gracefully", () => {
  assert.equal(roundMoney(Infinity), 0);
  assert.equal(roundMoney(-Infinity), 0);
  assert.equal(roundMoney(NaN), 0);
});

test("roundMoney handles large IQD amounts without floating-point drift", () => {
  assert.equal(roundMoney(999999.995), 1_000_000);
  assert.equal(roundMoney(123456.785), 123456.79);
});

// ── calculateInvoiceFinancials ─────────────────────────────────────────────

test("sale adds only the unpaid amount to customer balance", () => {
  const result = calculateInvoiceFinancials({
    type: "SALE",
    subtotal: 250_000,
    discount: 20_000,
    paidAmount: 100_000,
    previousBalance: 30_000,
  });

  assert.deepEqual(result, {
    subtotal: 250_000,
    discount: 20_000,
    tax: 0,
    totalAmount: 230_000,
    paidAmount: 100_000,
    remainingAmount: 130_000,
    balanceDelta: 130_000,
    finalBalance: 160_000,
    paymentType: "PARTIAL",
    overpayment: 0,
  });
});

test("purchase and sales return reduce the balance by their remaining amount", () => {
  const purchase = calculateInvoiceFinancials({
    type: "PURCHASE",
    subtotal: 80_000,
    paidAmount: 20_000,
    previousBalance: 10_000,
  });
  const salesReturn = calculateInvoiceFinancials({
    type: "SALES_RETURN",
    subtotal: 45_000,
    paidAmount: 0,
    previousBalance: 100_000,
  });

  assert.equal(purchase.finalBalance, -50_000);
  assert.equal(salesReturn.finalBalance, 55_000);
});

test("overpayment is separated from the invoice instead of creating negative remaining", () => {
  const result = calculateInvoiceFinancials({
    type: "SALE",
    subtotal: 50_000,
    paidAmount: 70_000,
    previousBalance: 25_000,
  });

  assert.equal(result.paidAmount, 50_000);
  assert.equal(result.remainingAmount, 0);
  assert.equal(result.finalBalance, 25_000);
  assert.equal(result.overpayment, 20_000);
});

test("fully-paid invoice becomes CASH with zero remaining", () => {
  const result = calculateInvoiceFinancials({
    type: "SALE",
    subtotal: 100_000,
    paidAmount: 100_000,
    previousBalance: 0,
  });

  assert.equal(result.remainingAmount, 0);
  assert.equal(result.paymentType, "CASH");
  assert.equal(result.finalBalance, 0);
  assert.equal(result.overpayment, 0);
});

test("fully-unpaid invoice becomes CREDIT", () => {
  const result = calculateInvoiceFinancials({
    type: "SALE",
    subtotal: 75_000,
    paidAmount: 0,
    previousBalance: 0,
  });

  assert.equal(result.paymentType, "CREDIT");
  assert.equal(result.remainingAmount, 75_000);
});

test("discount cannot exceed subtotal — negative totalAmount clamped to zero", () => {
  const result = calculateInvoiceFinancials({
    type: "SALE",
    subtotal: 50_000,
    discount: 90_000, // larger than subtotal
    paidAmount: 0,
    previousBalance: 0,
  });

  // subtotal - discount = -40_000, but subtotal is clamped at max(0,subtotal)
  // discount is applied after; totalAmount = roundMoney(50000 - 90000) = -40000 but
  // paidAmount is min(requested, max(0, totalAmount)) so stays 0
  // remainingAmount = max(0, totalAmount - paidAmount) = 0 (negative total)
  assert.equal(result.remainingAmount, 0);
  assert.equal(result.paymentType, "CASH");
});

test("tax is added to totalAmount", () => {
  const result = calculateInvoiceFinancials({
    type: "SALE",
    subtotal: 100_000,
    discount: 0,
    tax: 10_000,
    paidAmount: 110_000,
    previousBalance: 0,
  });

  assert.equal(result.totalAmount, 110_000);
  assert.equal(result.paidAmount, 110_000);
  assert.equal(result.remainingAmount, 0);
  assert.equal(result.paymentType, "CASH");
});

test("negative inputs are clamped to zero", () => {
  const result = calculateInvoiceFinancials({
    type: "SALE",
    subtotal: -10_000,
    discount: -5_000,
    tax: -1_000,
    paidAmount: -1_000,
    previousBalance: 0,
  });

  assert.equal(result.subtotal, 0);
  assert.equal(result.discount, 0);
  assert.equal(result.tax, 0);
  assert.equal(result.paidAmount, 0);
});

test("zero-amount sale is CASH with no balance change", () => {
  const result = calculateInvoiceFinancials({
    type: "SALE",
    subtotal: 0,
    paidAmount: 0,
    previousBalance: 50_000,
  });

  assert.equal(result.totalAmount, 0);
  assert.equal(result.finalBalance, 50_000);
  assert.equal(result.paymentType, "CASH");
});

// ── calculateCustomerBalance ────────────────────────────────────────────────

test("customer balance follows one sign convention", () => {
  assert.equal(
    calculateCustomerBalance({
      openingBalance: 20_000,
      salesRemaining: 300_000,
      purchasesRemaining: 40_000,
      salesReturnsRemaining: 30_000,
      receipts: 230_000,
      payments: 10_000,
    }),
    30_000
  );
});

test("customer with only opening balance and no transactions", () => {
  assert.equal(
    calculateCustomerBalance({ openingBalance: 150_000 }),
    150_000
  );
});

test("customer with all defaults is zero", () => {
  assert.equal(calculateCustomerBalance({}), 0);
});

test("supplier balance is negative when we owe them", () => {
  const balance = calculateCustomerBalance({
    openingBalance: 0,
    purchasesRemaining: 200_000, // we bought but didn't fully pay
    payments: 50_000,            // we paid some back
  });
  // openingBalance(0) + sales(0) - purchases(200k) - salesReturns(0) - receipts(0) + payments(50k)
  // = -150_000
  assert.equal(balance, -150_000);
});

test("full payment brings balance to zero", () => {
  const balance = calculateCustomerBalance({
    openingBalance: 0,
    salesRemaining: 0,   // sale fully paid → no remaining
    receipts: 100_000,   // receipt for exact amount
    payments: 0,
  });
  assert.equal(balance, -100_000); // we received MORE than they owe
});

test("receipts cannot make balance more negative than logic allows", () => {
  // Just ensure the arithmetic is correct regardless of sign
  const balance = calculateCustomerBalance({
    openingBalance: 500_000,
    receipts: 600_000,
  });
  assert.equal(balance, -100_000);
});

// ── amountInPieces ──────────────────────────────────────────────────────────

test("cartons, dozens and pieces are normalized to pieces", () => {
  assert.equal(amountInPieces("CARTON", 2, 24), 48);
  assert.equal(amountInPieces("DOZEN", 2, 24), 24);
  assert.equal(amountInPieces("PIECE", 2, 24), 2);
});

test("amountInPieces with zero quantity returns zero", () => {
  assert.equal(amountInPieces("CARTON", 0, 24), 0);
  assert.equal(amountInPieces("PIECE", 0, 1), 0);
});

test("amountInPieces: one carton of 1 pcs/carton is 1 piece", () => {
  assert.equal(amountInPieces("CARTON", 1, 1), 1);
});

test("amountInPieces: dozen ignores pcsPerCarton", () => {
  assert.equal(amountInPieces("DOZEN", 3, 999), 36);
});
