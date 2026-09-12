import { test } from "node:test"
import assert from "node:assert/strict"
import { catalogProductForMode, piecePriceFor } from "./salePricing"

const p = { id: "p", name: "test", itemNumber: "1", pcsPerCarton: 48, currentStock: 50, salePrice: 1000, retailPrice: 2000, cartonPiecePrice: 750 }
test("switching modes repeatedly never compounds the discount", () => {
  const carton = catalogProductForMode(p, "CARTON")
  assert.equal(carton.salePrice, 750)
  assert.equal(catalogProductForMode(carton, "WHOLESALE").salePrice, 1000)
  assert.equal(catalogProductForMode(carton, "CARTON").salePrice, 750)
  assert.equal(piecePriceFor(p, "RETAIL"), 2000)
  assert.equal(piecePriceFor({ ...p, cartonPiecePrice: null }, "CARTON"), 1000)
})
test("locked prices stay hidden in either catalog mode", () => {
  const hidden = { ...p, salePrice: null, cartonPiecePrice: null }
  assert.equal(catalogProductForMode(hidden, "CARTON").salePrice, null)
  assert.equal(catalogProductForMode(catalogProductForMode(hidden, "CARTON"), "WHOLESALE").salePrice, null)
})
