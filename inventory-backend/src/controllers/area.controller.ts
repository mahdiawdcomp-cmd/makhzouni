/**
 * «المناطق» endpoints.
 *
 * Split by who may call them:
 *   - the rep reads the active list and asks which area a pin falls in;
 *   - the owner creates, edits, reorders, retires and imports.
 *
 * The split lives in the route file, not here — these handlers assume the guard
 * already ran, exactly like the rest of this codebase.
 */
import { asyncHandler } from "../utils/async-handler";
import {
  createArea,
  importAreas,
  importLegacyAreas,
  linkCustomersToAreas,
  listAreas,
  removeArea,
  suggestArea,
  updateArea,
  validCoords,
} from "../services/area.service";

/**
 * The area list.
 *
 * `?activeOnly=1` is what the rep's picker asks for; the owner's settings
 * screen wants the retired ones too, plus how many customers each holds so
 * nothing is retired blindly.
 */
export const getAreas = asyncHandler(async (req, res) => {
  const activeOnly = String(req.query.activeOnly ?? "") === "1";
  const withCounts = String(req.query.withCounts ?? "") === "1";
  res.json({ success: true, data: await listAreas(activeOnly, withCounts) });
});

/**
 * Which area a dropped pin falls in.
 *
 * Answers `{ area: null }` rather than an error when nothing is near: the
 * caller shows «اختر المنطقة» and the rep carries on. A 400 here would block
 * adding a customer over a neighbourhood the shop simply has not mapped yet.
 */
export const getAreaSuggestion = asyncHandler(async (req, res) => {
  const coords = validCoords(req.query.lat, req.query.lng);
  if (!coords) {
    res.json({ success: true, data: { area: null, distanceM: null } });
    return;
  }
  const match = await suggestArea(coords.lat, coords.lng);
  res.json({
    success: true,
    data: { area: match?.area ?? null, distanceM: match?.distanceM ?? null },
  });
});

export const postArea = asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await createArea(req.body ?? {}) });
});

export const patchArea = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await updateArea(String(req.params.id), req.body ?? {}) });
});

export const deleteArea = asyncHandler(async (req, res) => {
  const result = await removeArea(String(req.params.id));
  res.json({
    success: true,
    data: result,
    message: result.deleted
      ? "انحذفت المنطقة"
      : "المنطقة عليها زبائن — انعطلت بدل ما تنحذف، والزبائن محتفظين بيها",
  });
});

/**
 * Bulk import.
 *
 * The payload is whatever list the owner chose — the Karbala dataset shipped
 * with the app, a pasted list, or the legacy settings strings. No dataset is
 * privileged here; `?legacy=1` is only a shortcut for the one already sitting
 * in this shop's own settings.
 */
export const postAreaImport = asyncHandler(async (req, res) => {
  if (String(req.query.legacy ?? "") === "1") {
    const result = await importLegacyAreas();
    res.json({ success: true, data: { ...result, names: [] } });
    return;
  }
  const body = req.body as { areas?: unknown };
  const rows = Array.isArray(body?.areas) ? body.areas : [];
  res.json({ success: true, data: await importAreas(rows as never[]) });
});

/** Backfill `areaId` on customers whose area is still only text. */
export const postAreaLink = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await linkCustomersToAreas() });
});
