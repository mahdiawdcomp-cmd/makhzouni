import { AppError } from "./app-error";
import prisma from "../config/database";

/**
 * «إقفال الفترة المحاسبية».
 *
 * A closed period freezes the money documents dated inside it: once the owner
 * sets a close date, no invoice or voucher dated on or before that day can be
 * created, edited, cancelled, deleted or restored — by anyone, including the
 * admin. The admin's power is to MOVE the date (a settings change, audit-logged
 * like any other), not to slip an edit past it. That is the whole point: a
 * month whose profit was already read and acted on stops changing behind you.
 *
 * Nothing is hidden or deleted — closed documents stay fully readable, and every
 * report still covers them.
 */

/** Baghdad is UTC+3 all year (no DST since 2015), so the close day ends at 21:00Z. */
const BAGHDAD_UTC_OFFSET_HOURS = 3;

/** Exported for testing: the first instant that is NOT closed. */
export function periodOpensAt(closeDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(closeDate)) return null;
  const midnightUtc = Date.parse(`${closeDate}T00:00:00.000Z`);
  if (Number.isNaN(midnightUtc)) return null;
  // End of the close day in local time = next local midnight.
  return new Date(midnightUtc + (24 - BAGHDAD_UTC_OFFSET_HOURS) * 60 * 60 * 1000);
}

export function isWithinClosedPeriod(documentDate: Date | string | null | undefined, closeDate: string): boolean {
  const opensAt = periodOpensAt(closeDate);
  if (!opensAt) return false;
  const date = documentDate ? new Date(documentDate) : new Date();
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < opensAt.getTime();
}

/**
 * Reads the single setting row rather than the whole settings object: this runs
 * on every invoice and voucher write, and `getSettings()` loads the full table
 * and can perform writes of its own.
 *
 * A failure to READ the setting never blocks the shop from selling — an
 * infrastructure hiccup must not stop the till. The close date only ever comes
 * from an admin-only settings write, so failing open here cannot be triggered
 * by anyone trying to slip an edit past the lock.
 */
async function readCloseDate(): Promise<string> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: "accountingCloseDate" } });
    const value = row?.value;
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

/**
 * Throws when `documentDate` falls inside the closed period. Callers pass the
 * document's OWN date (not "now"), so back-dating into a closed month is
 * blocked exactly like editing something already in it.
 */
export async function assertPeriodOpen(documentDate: Date | string | null | undefined): Promise<void> {
  const closeDate = await readCloseDate();
  if (!closeDate) return;
  if (isWithinClosedPeriod(documentDate, closeDate)) {
    throw new AppError(
      `الفترة المحاسبية مقفلة حتى ${closeDate} — لا يمكن إضافة أو تعديل أو حذف مستند بتاريخ ضمنها. لتعديلها، غيّر تاريخ الإقفال من الإعدادات.`,
      423,
      "ACCOUNTING_PERIOD_CLOSED"
    );
  }
}
