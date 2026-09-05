// ── Keeping the balance PRINTED on an invoice honest ─────────────────────────
//
// Every invoice stores two display figures: the customer's balance just before
// it (`previousBalance`) and just after it (`finalBalance`). They are printed on
// the paper invoice, drawn by the invoice designer, and sent to the customer in
// the WhatsApp message.
//
// They were written once, at creation, and never touched again. So editing an
// OLD invoice left every LATER invoice quoting a balance that had stopped being
// true — while the account statement, which recomputes its running balance from
// scratch, showed the corrected figure. Two documents, two answers, and the one
// the customer holds was the wrong one.
//
// This module rewrites those two figures by walking the customer's ledger in
// exactly the order the statement walks it, so the printed invoice and the
// statement cannot disagree. It touches NOTHING else: no balance, no total, no
// stock — only the two display columns.

import { InvoiceStatus, InvoiceType, Prisma, VoucherType } from "@prisma/client";

import prisma from "../config/database";
import { roundMoney } from "../utils/financial";
import { assistantTimezone, dayKeyInTz } from "./daily-assistant.service";
import { logger } from "../utils/logger";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * A customer with more live invoices than this is not resynced.
 *
 * The walk-in customer collects every cash sale the till ever rings, and those
 * invoices are settled on the spot — their previous/final balance is zero and
 * stays zero. Walking tens of thousands of them on each sale would tax the busy
 * path to correct figures that were never wrong.
 */
const MAX_INVOICES_TO_RESYNC = 500;

interface Movement {
  /** Sorting only. */
  date: Date;
  sortKey: number;
  /** Signed effect on the running balance (positive = customer owes more). */
  delta: number;
  /** Set on the two movements an invoice contributes. */
  invoiceId?: string;
  /** True for the invoice's own line (as opposed to its upfront payment). */
  isInvoiceLine?: boolean;
}

/**
 * Rewrite `previousBalance`/`finalBalance` on every live invoice of a customer.
 *
 * Mirrors getCustomerTransactions: same movements, same sign conventions, same
 * ordering (business day in the shop's timezone, then creation order), and
 * cancelled records are listed but never move the balance.
 */
export async function resyncInvoiceSnapshots(db: Db, customerId: string): Promise<number> {
  // Some callers hand in a narrowed client (tests, batch tools) that carries
  // only the models it needs. Refreshing a display figure is not worth failing
  // over — a client that cannot answer simply gets no resync.
  if (
    typeof db.customer?.findUnique !== "function" ||
    typeof db.paymentVoucher?.findMany !== "function" ||
    typeof db.invoice?.findMany !== "function"
  ) {
    return 0;
  }

  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { openingBalance: true },
  });
  if (!customer) return 0;

  const [invoices, vouchers] = await Promise.all([
    db.invoice.findMany({
      where: { customerId, status: InvoiceStatus.ACTIVE, archivedAt: null },
      select: {
        id: true, date: true, createdAt: true, type: true,
        totalAmount: true, paidAmount: true,
        previousBalance: true, finalBalance: true,
      },
      orderBy: { date: "asc" },
    }),
    db.paymentVoucher.findMany({
      where: { customerId, archivedAt: null, cancelledAt: null },
      select: { date: true, createdAt: true, type: true, amount: true },
    }),
  ]);

  if (invoices.length === 0) return 0;
  if (invoices.length > MAX_INVOICES_TO_RESYNC) {
    logger.warn(
      `[snapshots] skipped customer ${customerId}: ${invoices.length} live invoices exceeds the resync ceiling`,
    );
    return 0;
  }

  const movements: Movement[] = [];
  for (const invoice of invoices) {
    const total = Number(invoice.totalAmount);
    const paid = Number(invoice.paidAmount);
    // A sale is a debit and its upfront payment a credit; a purchase and a
    // sales return are the mirror of that.
    const sign = invoice.type === InvoiceType.SALE ? 1 : -1;
    movements.push({
      date: invoice.date,
      sortKey: invoice.createdAt.getTime(),
      delta: sign * total,
      invoiceId: invoice.id,
      isInvoiceLine: true,
    });
    if (paid > 0) {
      movements.push({
        date: invoice.date,
        sortKey: invoice.createdAt.getTime() + 1,
        delta: -sign * paid,
        invoiceId: invoice.id,
      });
    }
  }
  for (const voucher of vouchers) {
    // A receipt takes money in and lowers what the customer owes.
    const delta = (voucher.type === VoucherType.RECEIPT ? -1 : 1) * Number(voucher.amount);
    movements.push({ date: voucher.date, sortKey: voucher.createdAt.getTime(), delta });
  }

  const tz = assistantTimezone();
  movements.sort((a, b) => {
    const dayA = dayKeyInTz(a.date, tz);
    const dayB = dayKeyInTz(b.date, tz);
    return dayA < dayB ? -1 : dayA > dayB ? 1 : a.sortKey - b.sortKey;
  });

  const before = new Map<string, number>();
  const after = new Map<string, number>();
  let running = Number(customer.openingBalance);

  for (const movement of movements) {
    if (movement.invoiceId && movement.isInvoiceLine) {
      before.set(movement.invoiceId, roundMoney(running));
    }
    running = roundMoney(running + movement.delta);
    // The invoice's own closing figure is the balance after BOTH of its
    // movements, which is why it is written on every one of them.
    if (movement.invoiceId) after.set(movement.invoiceId, running);
  }

  let updated = 0;
  for (const invoice of invoices) {
    const nextPrevious = before.get(invoice.id) ?? 0;
    const nextFinal = after.get(invoice.id) ?? nextPrevious;
    if (
      Number(invoice.previousBalance) === nextPrevious &&
      Number(invoice.finalBalance) === nextFinal
    ) {
      continue;
    }
    await db.invoice.update({
      where: { id: invoice.id },
      data: { previousBalance: nextPrevious, finalBalance: nextFinal },
    });
    updated += 1;
  }

  return updated;
}
