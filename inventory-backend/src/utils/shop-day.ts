/**
 * Turning a date the owner picked into an instant, in the SHOP's day.
 *
 * `new Date("2026-09-25")` is parsed as midnight UTC, which in Baghdad is
 * 03:00 on the 25th — so an offer "starting on the 25th" was already running
 * for the last three hours of the 24th, and one "ending on the 25th" died at
 * 03:00 that morning. Every window in this feature is built here instead.
 *
 * The rule, stated once:
 *  - a picked START date means the first instant of that day, shop time;
 *  - a picked END date means the offer is good to the END of that day, stored
 *    as the first instant of the NEXT day — the window is `[start, end)`.
 *
 * The timezone comes from the shop's own setting via `assistantTimezone()`,
 * never from the browser and never from the server's clock.
 */
import { addDaysStr, assistantTimezone, dayKeyInTz, zonedDayRange } from "../services/daily-assistant.service";

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A REAL calendar day, not merely the right shape.
 *
 * The shape check alone accepted `2026-99-99` and `2026-02-30`, which then
 * became a window nobody could ever be inside. The round-trip through UTC
 * parts is what catches an overflowing month or day: JavaScript happily rolls
 * 2026-02-30 forward to March 2nd, so if the parts do not come back
 * unchanged, the date the caller typed does not exist.
 *
 * Deliberately NOT `new Date("2026-02-30")`, which is both lenient and
 * timezone-shifted — the whole reason this module exists.
 */
export function isShopDateKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_KEY.exec(value.trim());
  if (!match) return false;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Year 1000..9999 keeps the key four digits, which every caller assumes.
  if (year < 1000 || year > 9999) return false;
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  );
}

export function shopTimezone(): string {
  return assistantTimezone();
}

/** First instant of `dateKey`, shop time. */
export function shopDayStart(dateKey: string, tz = shopTimezone()): Date {
  return zonedDayRange(dateKey, tz).start;
}

/**
 * First instant of the day AFTER `dateKey`, shop time — the exclusive end of a
 * window that should cover all of `dateKey`.
 */
export function shopDayEndExclusive(dateKey: string, tz = shopTimezone()): Date {
  return zonedDayRange(addDaysStr(dateKey, 1), tz).start;
}

/** The shop-local date an instant falls on. */
export function shopDateKey(instant: Date, tz = shopTimezone()): string {
  return dayKeyInTz(instant, tz);
}

/**
 * The last day an exclusive-end window actually covers, for display: a window
 * ending at the first instant of the 26th is good «لغاية نهاية يوم 25».
 */
export function shopInclusiveEndKey(exclusiveEnd: Date, tz = shopTimezone()): string {
  return dayKeyInTz(new Date(exclusiveEnd.getTime() - 1), tz);
}
