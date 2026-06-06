import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import {
  listCustomersWithCatalogStatus,
  createCatalogAccessLink,
  updateCatalogAccessLink,
  revokeCatalogAccess,
} from "../services/catalog.service";
import prisma from "../config/database";

export const getCatalogCustomers = asyncHandler(async (_req, res) => {
  const rows = await listCustomersWithCatalogStatus();
  res.json({ success: true, data: rows });
});

export const grantCatalogAccess = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError("Authentication required", 401, "AUTH_REQUIRED");

  const customerId = String(req.params.id);
  const { allowPrices = false, showStock = true } = req.body as {
    allowPrices?: boolean;
    showStock?: boolean;
  };

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true, name: true, phone: true },
  });
  if (!customer) throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");

  const link = await createCatalogAccessLink(customerId, allowPrices, showStock);
  res.status(201).json({
    success: true,
    message: "Catalog access granted",
    data: {
      customerId,
      token: link.token,
      urlPath: link.urlPath,
      allowPrices: link.allowPrices,
      showStock: link.showStock,
    },
  });
});

export const patchCatalogAccess = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError("Authentication required", 401, "AUTH_REQUIRED");

  const customerId = String(req.params.id);
  const patch = req.body as { allowPrices?: boolean; showStock?: boolean };

  const updated = await updateCatalogAccessLink(customerId, patch);
  res.json({ success: true, message: "Catalog access updated", data: updated });
});

export const revokeCatalogAccessCtrl = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError("Authentication required", 401, "AUTH_REQUIRED");

  const customerId = String(req.params.id);
  await revokeCatalogAccess(customerId);
  res.json({ success: true, message: "Catalog access revoked" });
});
