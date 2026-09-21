/**
 * «وين كان المندوب» — one position per action the rep files.
 *
 * WHAT THIS IS NOT: a movement trace. The browser is never asked to watch the
 * position, nothing is recorded while the rep walks or drives, and a phone
 * sitting in a pocket produces no rows at all. A row exists because the rep
 * DID something — sent an order, wrote a receipt, opened a visit, added a
 * customer — and it answers one question: were they at that shop when they did
 * it, or somewhere else entirely.
 *
 * The honesty rules this file enforces, because getting them wrong accuses a
 * rep who did nothing wrong:
 *
 *   - A refusal is recorded, not dropped. `status: "DENIED"` is a fact the
 *     owner should see; silently writing no row would read as "no data yet".
 *   - The reading's own error radius travels with it. A 400 m fix cannot prove
 *     a 300 m gap, and the report must be able to throw such a reading away.
 *   - `capturedAt` is when the POSITION was read, which on a bad connection is
 *     an hour before the row is written. Stamping the send time instead would
 *     put an honest rep at home, where they finally found signal.
 *   - A stamp NEVER fails the action it belongs to. An order that reached the
 *     shop must not be rolled back because a location row would not insert.
 */
import prisma from "../config/database";
import { logger } from "../utils/logger";
import { distanceMetres, validCoords } from "./area.service";

/** What the rep was doing when the position was read. */
export type StampAction = "ORDER" | "RECEIPT" | "VISIT" | "NEW_CUSTOMER";

const ACTIONS: readonly StampAction[] = ["ORDER", "RECEIPT", "VISIT", "NEW_CUSTOMER"];

/**
 * Why there are no coordinates, when there are none.
 *
 * `DENIED` is the rep refusing the browser prompt; `UNAVAILABLE` is the device
 * having no fix (indoors, no GPS, wifi-only tablet); `TIMEOUT` is the reading
 * taking longer than the app was willing to block the sale for. They are kept
 * apart because they mean different things about the rep: only the first is a
 * choice they made.
 */
export type StampStatus = "OK" | "DENIED" | "UNAVAILABLE" | "TIMEOUT";

const STATUSES: readonly StampStatus[] = ["OK", "DENIED", "UNAVAILABLE", "TIMEOUT"];

/**
 * What the client sends alongside an action. Every field is optional and every
 * shape is tolerated: this payload comes off a phone that may have been offline
 * for an hour, and a malformed reading must never cost the shop an order.
 */
export type StampInput = {
  latitude?: unknown;
  longitude?: unknown;
  accuracyM?: unknown;
  status?: unknown;
  capturedAt?: unknown;
};

/**
 * How old a reading may be before it is treated as merely "the last known
 * position" rather than where the rep is now.
 *
 * Twelve hours, not minutes: the whole point of carrying `capturedAt` is that
 * an offline draft is sent late. The report shows the gap and lets the owner
 * judge; this constant only guards against a clock so wrong that the reading is
 * meaningless.
 */
const MAX_READING_AGE_MS = 12 * 60 * 60 * 1000;

function cleanCapturedAt(value: unknown): Date {
  const now = Date.now();
  const raw = typeof value === "number" ? value : Date.parse(String(value ?? ""));
  if (!Number.isFinite(raw)) return new Date(now);
  // A phone with a badly wrong clock would otherwise file today's visit under
  // next year, where no report would ever find it.
  if (raw > now + 60_000) return new Date(now);
  if (raw < now - MAX_READING_AGE_MS) return new Date(now - MAX_READING_AGE_MS);
  return new Date(raw);
}

function cleanAccuracy(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  // Anything past 20 km is not a position, it is the device saying "somewhere
  // in this country". Capped rather than dropped so the report can still say
  // the reading was useless.
  return Math.min(20_000, Math.round(n));
}

function cleanStatus(value: unknown, hasCoords: boolean): StampStatus {
  const raw = String(value ?? "").toUpperCase();
  if ((STATUSES as readonly string[]).includes(raw)) {
    // A client claiming OK without sending coordinates is not OK. Trusting the
    // label over the payload would let a rep's device report success forever.
    if (raw === "OK" && !hasCoords) return "UNAVAILABLE";
    return raw as StampStatus;
  }
  return hasCoords ? "OK" : "UNAVAILABLE";
}

/**
 * Record where the rep was, and how far that is from the shop.
 *
 * Returns the distance in metres when both sides have coordinates, so the
 * caller can show the rep their own number. Never throws: every failure is
 * logged and swallowed, because this is a witness to the action, not part of
 * it.
 */
export async function recordStamp(args: {
  salesAgentId: string;
  action: StampAction;
  customerId?: string | null;
  referenceId?: string | null;
  input?: StampInput | null;
  /** Skips the customer read when the caller already has the coordinates. */
  customerCoords?: { latitude: unknown; longitude: unknown } | null;
}): Promise<{ distanceM: number | null; status: StampStatus } | null> {
  try {
    if (!(ACTIONS as readonly string[]).includes(args.action)) return null;
    const input = args.input ?? {};
    const coords = validCoords(input.latitude, input.longitude);
    const status = cleanStatus(input.status, Boolean(coords));

    let distanceM: number | null = null;
    if (coords) {
      let shop = args.customerCoords ?? null;
      if (!shop && args.customerId) {
        shop = await prisma.customer.findUnique({
          where: { id: args.customerId },
          select: { latitude: true, longitude: true },
        });
      }
      const shopCoords = shop ? validCoords(shop.latitude, shop.longitude) : null;
      if (shopCoords) {
        distanceM = distanceMetres(coords.lat, coords.lng, shopCoords.lat, shopCoords.lng);
      }
    }

    await prisma.salesAgentStamp.create({
      data: {
        salesAgentId: args.salesAgentId,
        customerId: args.customerId ?? null,
        action: args.action,
        referenceId: args.referenceId ?? null,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        accuracyM: cleanAccuracy(input.accuracyM),
        status,
        distanceM,
        capturedAt: cleanCapturedAt(input.capturedAt),
      },
    });

    return { distanceM, status };
  } catch (err) {
    // Deliberately swallowed. The order, receipt or visit this belongs to has
    // already happened; losing its location is a gap in a report, while
    // failing the action would be a gap in the shop's books.
    logger.warn(`[SalesAgent] stamp not recorded: ${String(err)}`);
    return null;
  }
}

/**
 * Save the shop's own position the first time anyone stands in it.
 *
 * Only fills a blank. A customer whose coordinates are already known keeps
 * them: the rep may be phoning from the next street, and one stray reading must
 * not move a shop that was placed correctly.
 *
 * `maxAccuracyM` refuses a reading too vague to be worth storing — a 500 m fix
 * would put the shop anywhere in the neighbourhood and then every later
 * distance check would measure against that error.
 */
export async function fillCustomerLocationIfBlank(
  customerId: string,
  input: StampInput | null | undefined,
  maxAccuracyM = 150,
): Promise<boolean> {
  try {
    const coords = validCoords(input?.latitude, input?.longitude);
    if (!coords) return false;
    const accuracy = cleanAccuracy(input?.accuracyM);
    if (accuracy != null && accuracy > maxAccuracyM) return false;

    const result = await prisma.customer.updateMany({
      where: { id: customerId, latitude: null, longitude: null },
      data: { latitude: coords.lat, longitude: coords.lng },
    });
    return result.count > 0;
  } catch (err) {
    logger.warn(`[SalesAgent] customer location not filled: ${String(err)}`);
    return false;
  }
}
