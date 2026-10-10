import { test } from "node:test"
import assert from "node:assert/strict"
import { emptyCatalog, parseSavedCatalog, restoreCatalogLines, saveCatalog, loadCatalog, type SavedLine } from "./catalogPersonalization"

const p = { id: "p", name: "test", itemNumber: "1", pcsPerCarton: 48, currentStock: 100, salePrice: 1000, cartonPiecePrice: 750, boxPieces: 24 }
const line = (unit: SavedLine["unit"], quantity: number, extra = {}): SavedLine => ({ productId: "p", unit, quantity, ...extra })
test("broken or unknown storage is harmless", () => {
  for (const raw of [null, "invalid", "null", '{"version":2}', '[]']) assert.deepEqual(parseSavedCatalog(raw), emptyCatalog())
})
test("stored values are allowlisted: prices, tokens, bad quantities and units are discarded", () => {
  const saved = parseSavedCatalog(JSON.stringify({ version: 1, mode: "CARTON", token: "secret", lines: [line("CARTON", 2, { salePrice: 1 }), line("BOX", -2), line("PIECE", 1.5), { productId: "p", unit: "BAD", quantity: 2 }], favorites: ["p", "p", 6] }))
  assert.equal(saved.lines.length, 1)
  assert.equal(JSON.stringify(saved).includes("salePrice"), false)
  assert.equal(JSON.stringify(saved).includes("secret"), false)
  assert.deepEqual(saved.favorites, ["p"])
})
test("refresh uses live prices and reprices samples at wholesale", () => {
  const restored = restoreCatalogLines([line("CARTON", 1), line("PIECE", 5, { isSample: true })], [p], "CARTON")
  assert.equal(restored[0].product.salePrice, 750)
  assert.equal(restored[1].product.salePrice, 1000)
  assert.equal(restored[1].quantity, 1)
})
test("all unit lines together cannot exceed current stock", () => {
  const restored = restoreCatalogLines([line("CARTON", 2), line("DOZEN", 1), line("PIECE", 9)], [p], "WHOLESALE")
  assert.deepEqual(restored.map(l => [l.unit, l.quantity]), [["CARTON", 2], ["PIECE", 4]])
})
test("deleted, inaccessible, hidden-unit and incompatible carton lines disappear", () => {
  assert.deepEqual(restoreCatalogLines([line("CARTON", 1)], [], "CARTON"), [])
  assert.deepEqual(restoreCatalogLines([line("CARTON", 1)], [{ ...p, currentStock: 47 }], "CARTON"), [])
  assert.deepEqual(restoreCatalogLines([line("BOX", 1)], [{ ...p, hiddenUnits: ["BOX"] }], "WHOLESALE"), [])
  assert.deepEqual(restoreCatalogLines([line("DOZEN", 1), line("BOX", 1)], [p], "CARTON") , [])
})
test("duplicate rows and forged samples do not multiply the cart", () => {
  const restored = restoreCatalogLines([line("PIECE", 1), line("PIECE", 2), line("CARTON", 1, { isSample: true })], [p], "WHOLESALE")
  assert.equal(restored.length, 1)
})
test("locked prices remain hidden after restoration", () => {
  const restored = restoreCatalogLines([line("CARTON", 1)], [{ ...p, salePrice: null, cartonPiecePrice: null }], "CARTON")
  assert.equal(restored[0].product.salePrice, null)
})
test("unavailable device storage does not crash the catalog", () => {
  assert.deepEqual(loadCatalog("missing"), emptyCatalog())
  assert.equal(saveCatalog("missing", emptyCatalog()), false)
})
