export type FinancialInvoiceType = "SALE" | "PURCHASE" | "SALES_RETURN";
export type FinancialPaymentType = "CASH" | "CREDIT" | "PARTIAL";

const MONEY_SCALE = 100;

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * MONEY_SCALE) / MONEY_SCALE;
}

export function invoiceBalanceSign(type: FinancialInvoiceType): 1 | -1 {
  return type === "SALE" ? 1 : -1;
}

export function amountInPieces(unit: "PIECE" | "DOZEN" | "CARTON", quantity: number, pcsPerCarton: number): number {
  if (unit === "CARTON") return quantity * pcsPerCarton;
  if (unit === "DOZEN") return quantity * 12;
  return quantity;
}

export interface InvoiceFinancialInput {
  type: FinancialInvoiceType;
  subtotal: number;
  discount?: number;
  tax?: number;
  paidAmount?: number;
  previousBalance?: number;
}

export interface InvoiceFinancialResult {
  subtotal: number;
  discount: number;
  tax: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  balanceDelta: number;
  finalBalance: number;
  paymentType: FinancialPaymentType;
  overpayment: number;
}

export function calculateInvoiceFinancials(input: InvoiceFinancialInput): InvoiceFinancialResult {
  const subtotal = roundMoney(Math.max(0, input.subtotal));
  const discount = roundMoney(Math.max(0, input.discount ?? 0));
  const tax = roundMoney(Math.max(0, input.tax ?? 0));
  const requestedPaid = roundMoney(Math.max(0, input.paidAmount ?? 0));
  const previousBalance = roundMoney(input.previousBalance ?? 0);
  const totalAmount = roundMoney(subtotal - discount + tax);
  const paidAmount = roundMoney(Math.min(requestedPaid, Math.max(0, totalAmount)));
  const overpayment = roundMoney(Math.max(0, requestedPaid - Math.max(0, totalAmount)));
  const remainingAmount = roundMoney(Math.max(0, totalAmount - paidAmount));
  const balanceDelta = roundMoney(invoiceBalanceSign(input.type) * remainingAmount);

  return {
    subtotal,
    discount,
    tax,
    totalAmount,
    paidAmount,
    remainingAmount,
    balanceDelta,
    finalBalance: roundMoney(previousBalance + balanceDelta),
    paymentType:
      remainingAmount <= 0
        ? "CASH"
        : paidAmount > 0
          ? "PARTIAL"
          : "CREDIT",
    overpayment,
  };
}

export interface CustomerBalanceInput {
  openingBalance?: number;
  salesRemaining?: number;
  purchasesRemaining?: number;
  salesReturnsRemaining?: number;
  receipts?: number;
  payments?: number;
}

export function calculateCustomerBalance(input: CustomerBalanceInput): number {
  return roundMoney(
    (input.openingBalance ?? 0) +
      (input.salesRemaining ?? 0) -
      (input.purchasesRemaining ?? 0) -
      (input.salesReturnsRemaining ?? 0) -
      (input.receipts ?? 0) +
      (input.payments ?? 0)
  );
}
