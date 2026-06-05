import { listCatalogProducts, submitCatalogOrder } from "../services/catalog.service";
import { asyncHandler } from "../utils/async-handler";

export const getCatalogProducts = asyncHandler(async (_req, res) => {
  const products = await listCatalogProducts();
  res.json({ success: true, data: products });
});

export const createCatalogOrder = asyncHandler(async (req, res) => {
  const result = await submitCatalogOrder(req.body);
  res.status(201).json({
    success: true,
    message: "Catalog order submitted for approval",
    data: result,
  });
});
