import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { asyncHandler } from "../utils/async-handler";
import { recalculateCustomerBalance } from "../services/customer.service";
import { normalizePhone } from "../utils/phone";

/**
 * One-off «نقل الأرصدة» migration endpoint. Imports opening balances from the
 * shop's OLD accounting system into `Customer.openingBalance`. The source
 * statement file (PDF/Excel) is parsed entirely in the browser and NEVER
 * uploaded here — only the reviewed, non-skipped rows arrive as JSON.
 *
 * Skipped rows are simply never sent by the client, so there is no code path
 * that could apply them. This endpoint only ever touches customers explicitly
 * listed in `entries`.
 */

type Action = "create" | "link";

interface ApplyEntry {
  tempId: string;
  action: Action;
  name: string;
  phone?: string | null;
  amount: number;
  customerId?: string | null;
  notes?: string | null;
  oldCode?: string | null;
}

interface EntryResult {
  tempId: string;
  status: "created" | "linked" | "failed";
  customerId?: string;
  error?: string;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// POST /api/balance-migration/apply
export const applyOpeningBalances = asyncHandler(async (req, res) => {
  const body = req.body as { entries?: unknown };
  const entries = Array.isArray(body?.entries) ? (body.entries as ApplyEntry[]) : null;

  if (!entries || entries.length === 0) {
    throw new AppError("لا توجد صفوف للتطبيق", 400, "NO_ENTRIES");
  }
  if (entries.length > 5000) {
    throw new AppError("عدد الصفوف أكبر من 5000", 400, "TOO_MANY_ROWS");
  }

  const results: EntryResult[] = [];
  let created = 0;
  let linked = 0;
  let failed = 0;
  let totalApplied = 0;

  for (const entry of entries) {
    const tempId = String(entry?.tempId ?? "");
    try {
      const name = String(entry?.name ?? "").trim();
      const amount = num(entry?.amount);
      const action: Action = entry?.action === "link" ? "link" : "create";

      if (action === "link") {
        const customerId = String(entry?.customerId ?? "");
        if (!customerId) throw new AppError("لا يوجد زبون مرتبط", 400, "NO_CUSTOMER");

        const existing = await prisma.customer.findUnique({ where: { id: customerId } });
        if (!existing || existing.deletedAt) {
          throw new AppError("الزبون غير موجود أو محذوف", 404, "CUSTOMER_NOT_FOUND");
        }

        // Only set the OFFICIAL openingBalance field; currentBalance is then
        // re-derived by the system's own calculator (never written directly).
        await prisma.customer.update({
          where: { id: customerId },
          data: { openingBalance: amount },
        });
        await recalculateCustomerBalance(customerId);

        linked++;
        totalApplied += amount;
        results.push({ tempId, status: "linked", customerId });
        continue;
      }

      // action === "create"
      if (!name) throw new AppError("اسم الزبون فارغ", 400, "NO_NAME");

      let phone = normalizePhone(entry?.phone ?? "");
      if (phone) {
        const clash = await prisma.customer.findUnique({ where: { phone } });
        if (clash) {
          throw new AppError(
            `رقم الهاتف مستخدم من زبون آخر: «${clash.name}» — اربط الصف بدل إنشاء زبون جديد`,
            409,
            "PHONE_IN_USE"
          );
        }
      } else {
        // No phone in the old statement: mint a unique, clearly-migration
        // placeholder so the unique constraint holds. Never reuses "".
        const counter = await prisma.counter.upsert({
          where: { key: "migration-phone" },
          update: { value: { increment: 1 } },
          create: { key: "migration-phone", value: 1 },
        });
        phone = `MIG${String(counter.value).padStart(7, "0")}`;
      }

      // `openingBalance` is the system's OFFICIAL opening-balance field for a
      // customer (Customer.openingBalance, Decimal). There is no separate
      // ledger / voucher / adjustment record for opening balances. The live
      // balance (`currentBalance`) is NEVER meant to be written by hand — it is
      // DERIVED by recalculateCustomerBalance() → calculateCustomerBalance():
      //   currentBalance = openingBalance + sales − purchases − returns
      //                    − receipts + payments
      // So we only set the official openingBalance here, then let the system's
      // own calculator compute currentBalance (for a brand-new customer with no
      // transactions it resolves to openingBalance, but we never assume that —
      // we use the official path so the number is always the system's own).
      // Preserve the old-system code + notes on the new customer's notes field
      // (no schema change / migration). Purely informational.
      const noteParts = [
        String(entry?.notes ?? "").trim(),
        entry?.oldCode ? `كود قديم: ${String(entry.oldCode).trim()}` : "",
      ].filter(Boolean);
      const notes = noteParts.length ? noteParts.join(" — ") : undefined;

      const customer = await prisma.customer.create({
        data: {
          name,
          phone,
          openingBalance: amount,
          notes,
        },
      });
      await recalculateCustomerBalance(customer.id);

      created++;
      totalApplied += amount;
      results.push({ tempId, status: "created", customerId: customer.id });
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ tempId, status: "failed", error: msg });
    }
  }

  res.json({
    success: true,
    data: { created, linked, failed, totalApplied, results },
  });
});
