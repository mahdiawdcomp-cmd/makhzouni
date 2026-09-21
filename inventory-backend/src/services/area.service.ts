/**
 * «المناطق» — the neighbourhoods a shop sells in.
 *
 * This replaces the old `settings.salesAgentAreas` list of bare strings. The
 * old list is still read once, by `importLegacyAreas`, so a shop that already
 * typed its areas does not lose them; after that the table is the only source.
 *
 * Nothing here is specific to one city. The Karbala dataset a shop can import
 * is data the OWNER chooses to load, never a list this file knows about — the
 * same code serves a shop in Basra that imports nothing and types four names.
 */
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { getSettings } from "./settings.service";

export type AreaRow = {
  id: string;
  name: string;
  city: string | null;
  centerLat: number | null;
  centerLng: number | null;
  sortOrder: number;
  isActive: boolean;
  customerCount?: number;
};

const toNum = (v: unknown): number | null => (v == null ? null : Number(v));

/** Metres between two WGS84 points. Haversine; good to a few metres at city scale. */
export function distanceMetres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * A coordinate pair that is actually on Earth.
 *
 * Rejecting (0,0) matters: it is what a broken sensor and an uninitialised
 * variable both produce, and it sits in the Atlantic. A shop whose customer
 * landed there would read «على بعد 4000 كم» and distrust the whole feature.
 */
export function validCoords(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a < -90 || a > 90 || b < -180 || b > 180) return null;
  if (Math.abs(a) < 0.0001 && Math.abs(b) < 0.0001) return null;
  return { lat: a, lng: b };
}

type RawArea = {
  id: string;
  name: string;
  city: string | null;
  centerLat: unknown;
  centerLng: unknown;
  sortOrder: number;
  isActive: boolean;
  _count?: { customers: number };
};

function mapRow(r: RawArea): AreaRow {
  return {
    id: r.id,
    name: r.name,
    city: r.city,
    centerLat: toNum(r.centerLat),
    centerLng: toNum(r.centerLng),
    sortOrder: r.sortOrder,
    isActive: r.isActive,
    ...(r._count ? { customerCount: r._count.customers } : {}),
  };
}

/**
 * Every area, ordered the way the owner arranged them.
 *
 * `activeOnly` is what the rep's screens pass: a retired area must not appear
 * in the picker, but the customers already filed under it keep their link and
 * keep showing its name.
 */
export async function listAreas(activeOnly = false, withCounts = false): Promise<AreaRow[]> {
  const rows = await prisma.area.findMany({
    where: activeOnly ? { isActive: true } : undefined,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    ...(withCounts ? { include: { _count: { select: { customers: true } } } } : {}),
  });
  return rows.map((r) => mapRow(r as RawArea));
}

/**
 * The nearest area to a dropped pin, and how far it is.
 *
 * Returns null rather than a guess when every area lacks a centre — a shop that
 * has not placed its areas on the map yet must be told «اختر المنطقة», not
 * handed whichever row happened to sort first.
 *
 * `maxMetres` keeps a pin dropped in another city from being labelled with the
 * only area that exists. 6 km is wide enough to cover a large neighbourhood
 * measured from its centre, and narrow enough to refuse a different town.
 */
export async function suggestArea(
  lat: number,
  lng: number,
  maxMetres = 6_000,
): Promise<{ area: AreaRow; distanceM: number } | null> {
  const areas = await prisma.area.findMany({
    where: { isActive: true, NOT: { centerLat: null } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  let best: { area: AreaRow; distanceM: number } | null = null;
  for (const row of areas) {
    const centre = validCoords(row.centerLat, row.centerLng);
    if (!centre) continue;
    const d = distanceMetres(lat, lng, centre.lat, centre.lng);
    if (!best || d < best.distanceM) best = { area: mapRow(row as RawArea), distanceM: d };
  }
  if (!best || best.distanceM > maxMetres) return null;
  return best;
}

export type AreaInput = {
  name?: unknown;
  city?: unknown;
  centerLat?: unknown;
  centerLng?: unknown;
  sortOrder?: unknown;
  isActive?: unknown;
};

function cleanName(value: unknown): string {
  // Collapsing runs of whitespace is what stops «حي  الحسين» and «حي الحسين»
  // from becoming two areas that look identical in every list.
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw new AppError("اسم المنطقة مطلوب", 400, "AREA_NAME_REQUIRED");
  if (name.length > 120) throw new AppError("اسم المنطقة طويل", 400, "AREA_NAME_TOO_LONG");
  return name;
}

export async function createArea(input: AreaInput): Promise<AreaRow> {
  const name = cleanName(input.name);
  const existing = await prisma.area.findFirst({ where: { name } });
  if (existing) throw new AppError(`«${name}» موجودة مسبقاً`, 409, "AREA_EXISTS");

  const centre = validCoords(input.centerLat, input.centerLng);
  const row = await prisma.area.create({
    data: {
      name,
      city: String(input.city ?? "").trim() || null,
      centerLat: centre?.lat ?? null,
      centerLng: centre?.lng ?? null,
      sortOrder: Number.isFinite(Number(input.sortOrder)) ? Math.trunc(Number(input.sortOrder)) : 0,
      isActive: input.isActive !== false,
    },
  });
  return mapRow(row as RawArea);
}

export async function updateArea(id: string, input: AreaInput): Promise<AreaRow> {
  const current = await prisma.area.findUnique({ where: { id } });
  if (!current) throw new AppError("المنطقة غير موجودة", 404, "AREA_NOT_FOUND");

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    const clash = await prisma.area.findFirst({ where: { name, NOT: { id } } });
    if (clash) throw new AppError(`«${name}» موجودة مسبقاً`, 409, "AREA_EXISTS");
    data.name = name;
  }
  if (input.city !== undefined) data.city = String(input.city ?? "").trim() || null;
  if (input.centerLat !== undefined || input.centerLng !== undefined) {
    const centre = validCoords(input.centerLat, input.centerLng);
    data.centerLat = centre?.lat ?? null;
    data.centerLng = centre?.lng ?? null;
  }
  if (input.sortOrder !== undefined && Number.isFinite(Number(input.sortOrder))) {
    data.sortOrder = Math.trunc(Number(input.sortOrder));
  }
  if (input.isActive !== undefined) data.isActive = input.isActive !== false;

  const row = await prisma.area.update({ where: { id }, data });

  // The customer's own `area` text is a display copy of the link. Renaming the
  // area has to carry it along, or the customers list would keep printing the
  // old spelling beside the new one and look like two different places.
  if (typeof data.name === "string") {
    await prisma.customer.updateMany({ where: { areaId: id }, data: { area: data.name } });
  }
  return mapRow(row as RawArea);
}

/**
 * Retire or delete an area.
 *
 * An area with customers is never deleted, only deactivated: deleting it would
 * strip the neighbourhood off shops that are genuinely there, and no owner
 * pressing «حذف» on a list means "and forget where those shops are".
 */
export async function removeArea(id: string): Promise<{ deleted: boolean }> {
  const count = await prisma.customer.count({ where: { areaId: id } });
  if (count > 0) {
    await prisma.area.update({ where: { id }, data: { isActive: false } });
    return { deleted: false };
  }
  await prisma.area.delete({ where: { id } });
  return { deleted: true };
}

/**
 * Bulk import, used by the «استورد أحياء كربلاء» button and by any other
 * dataset a shop pastes in.
 *
 * Skips a name that already exists rather than failing the batch or
 * overwriting: the owner may have corrected a centre by hand, and re-running an
 * import must not undo that.
 */
export async function importAreas(
  rows: Array<{ name?: unknown; city?: unknown; centerLat?: unknown; centerLng?: unknown }>,
): Promise<{ added: number; skipped: number; names: string[] }> {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new AppError("ما اكو مناطق للاستيراد", 400, "AREAS_EMPTY");
  }
  if (rows.length > 500) {
    throw new AppError("الاستيراد محدود بـ 500 منطقة", 400, "AREAS_TOO_MANY");
  }

  const existing = new Set(
    (await prisma.area.findMany({ select: { name: true } })).map((r) => r.name),
  );
  const names: string[] = [];
  let skipped = 0;
  // Deduplicated inside the batch too: the source data itself can repeat a name
  // (OpenStreetMap carries two «حي المهندسين» in Karbala), and the unique index
  // would otherwise abort the whole import on the second one.
  const seen = new Set<string>();
  const toCreate: Array<{
    name: string;
    city: string | null;
    centerLat: number | null;
    centerLng: number | null;
    sortOrder: number;
  }> = [];

  for (const raw of rows) {
    let name: string;
    try {
      name = cleanName(raw.name);
    } catch {
      skipped += 1;
      continue;
    }
    if (existing.has(name) || seen.has(name)) {
      skipped += 1;
      continue;
    }
    seen.add(name);
    const centre = validCoords(raw.centerLat, raw.centerLng);
    toCreate.push({
      name,
      city: String(raw.city ?? "").trim() || null,
      centerLat: centre?.lat ?? null,
      centerLng: centre?.lng ?? null,
      sortOrder: 0,
    });
    names.push(name);
  }

  if (toCreate.length > 0) {
    await prisma.area.createMany({ data: toCreate, skipDuplicates: true });
  }
  return { added: toCreate.length, skipped, names };
}

/**
 * One-time lift of the old settings list into the table.
 *
 * Runs on demand, not at boot: a shop that never used the old list should not
 * have this touch its database at all. Idempotent — a name already in the table
 * is skipped, so pressing the button twice changes nothing.
 */
export async function importLegacyAreas(): Promise<{ added: number; skipped: number }> {
  const settings = await getSettings().catch(() => null);
  const raw = settings?.salesAgentAreas;
  if (!Array.isArray(raw) || raw.length === 0) return { added: 0, skipped: 0 };
  const result = await importAreas(raw.map((name) => ({ name })));
  return { added: result.added, skipped: result.skipped };
}

/**
 * Backfill `areaId` from the legacy `area` text.
 *
 * Matches by exact name only. A customer whose text matches no area row is left
 * alone rather than guessed at — a wrong neighbourhood is worse than a blank
 * one, because nobody goes looking for a shop in the wrong place.
 */
export async function linkCustomersToAreas(): Promise<{ linked: number }> {
  const areas = await prisma.area.findMany({ select: { id: true, name: true } });
  let linked = 0;
  for (const area of areas) {
    const result = await prisma.customer.updateMany({
      where: { areaId: null, area: area.name, deletedAt: null },
      data: { areaId: area.id },
    });
    linked += result.count;
  }
  return { linked };
}
