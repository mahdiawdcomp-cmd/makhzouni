import { CatalogStockFilter, PromoCodeType } from "@prisma/client";
import { asyncHandler } from "../utils/async-handler";
import { AppError } from "../utils/app-error";
import {
  listCustomersWithCatalogStatus,
  createCatalogAccessLink,
  updateCatalogAccessLink,
  revokeCatalogAccess,
  listPromoCodes,
  createPromoCode,
  deletePromoCode,
  togglePromoCode,
} from "../services/catalog.service";
import { getSettings, updateSettings } from "../services/settings.service";
import prisma from "../config/database";

export const getCatalogCustomers = asyncHandler(async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const limit = req.query.limit ? Math.min(200, Math.max(1, Number(req.query.limit))) : 100;
  const offset = req.query.offset ? Math.max(0, Number(req.query.offset)) : 0;
  const result = await listCustomersWithCatalogStatus({ search, limit, offset });
  res.json({ success: true, data: result.rows, total: result.total, limit, offset });
});

export const grantCatalogAccess = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError("Authentication required", 401, "AUTH_REQUIRED");

  const customerId = String(req.params.id);
  const { allowPrices = false, showStock = true, stockFilter } = req.body as {
    allowPrices?: boolean;
    showStock?: boolean;
    stockFilter?: CatalogStockFilter;
  };
  const resolvedStockFilter = parseStockFilter(stockFilter) ?? CatalogStockFilter.FULL_CARTON_ONLY;

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true, name: true, phone: true },
  });
  if (!customer) throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");

  const link = await createCatalogAccessLink(customerId, allowPrices, showStock, resolvedStockFilter);
  res.status(201).json({
    success: true,
    message: "Catalog access granted",
    data: {
      customerId,
      token: link.token,
      urlPath: link.urlPath,
      allowPrices: link.allowPrices,
      showStock: link.showStock,
      stockFilter: link.stockFilter,
    },
  });
});

function parseStockFilter(value: unknown): CatalogStockFilter | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === CatalogStockFilter.ALL_PRODUCTS || value === CatalogStockFilter.FULL_CARTON_ONLY) {
    return value;
  }
  throw new AppError("Invalid stockFilter value", 400, "INVALID_STOCK_FILTER");
}

export const patchCatalogAccess = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError("Authentication required", 401, "AUTH_REQUIRED");

  const customerId = String(req.params.id);
  const body = req.body as { allowPrices?: boolean; showStock?: boolean; stockFilter?: CatalogStockFilter };

  const updated = await updateCatalogAccessLink(customerId, {
    allowPrices: body.allowPrices,
    showStock: body.showStock,
    stockFilter: parseStockFilter(body.stockFilter),
  });
  res.json({ success: true, message: "Catalog access updated", data: updated });
});

export const revokeCatalogAccessCtrl = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError("Authentication required", 401, "AUTH_REQUIRED");

  const customerId = String(req.params.id);
  await revokeCatalogAccess(customerId);
  res.json({ success: true, message: "Catalog access revoked" });
});

/* ── Promo Codes ─────────────────────────────────────────────────── */

export const listPromoCodesCtrl = asyncHandler(async (_req, res) => {
  const codes = await listPromoCodes();
  res.json({ success: true, data: codes });
});

export const createPromoCodeCtrl = asyncHandler(async (req, res) => {
  const { code, type, value, customerId, expiresAt, usageLimit, description } = req.body as {
    code: string;
    type: PromoCodeType;
    value?: number;
    customerId?: string;
    expiresAt?: string;
    usageLimit?: number;
    description?: string;
  };

  const promo = await createPromoCode({
    code,
    type,
    value,
    customerId: customerId || undefined,
    expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    usageLimit,
    description,
  });
  res.status(201).json({ success: true, data: promo });
});

export const deletePromoCodeCtrl = asyncHandler(async (req, res) => {
  await deletePromoCode(String(req.params.id));
  res.json({ success: true, message: "Promo code deleted" });
});

export const togglePromoCodeCtrl = asyncHandler(async (req, res) => {
  const { active } = req.body as { active: boolean };
  const promo = await togglePromoCode(String(req.params.id), active);
  res.json({ success: true, data: promo });
});

/* ── Catalog Design Settings ─────────────────────────────────────── */

export const getCatalogDesignCtrl = asyncHandler(async (_req, res) => {
  const settings = await getSettings();
  res.json({
    success: true,
    data: {
      primaryColor: settings.catalogDesignPrimaryColor ?? null,
      bgColor: settings.catalogDesignBgColor ?? null,
      defaultTheme: settings.catalogDesignDefaultTheme ?? "clean",
      logoUrl: settings.catalogDesignLogoUrl ?? null,
      welcomeMessage: settings.catalogDesignWelcomeMessage ?? null,
      bannerEnabled: settings.catalogDesignBannerEnabled ?? true,
      bannerImages: settings.catalogDesignBannerImages ?? [],
    },
  });
});

export const updateCatalogDesignCtrl = asyncHandler(async (req, res) => {
  const {
    primaryColor, bgColor, defaultTheme, logoUrl, welcomeMessage, bannerEnabled, bannerImages,
  } = req.body as {
    primaryColor?: string;
    bgColor?: string;
    defaultTheme?: "clean" | "warm" | "dark" | "vibrant";
    logoUrl?: string;
    welcomeMessage?: string;
    bannerEnabled?: boolean;
    bannerImages?: Array<{ url: string; title: string; order: number }>;
  };

  await updateSettings({
    catalogDesignPrimaryColor: primaryColor,
    catalogDesignBgColor: bgColor,
    catalogDesignDefaultTheme: defaultTheme,
    catalogDesignLogoUrl: logoUrl,
    catalogDesignWelcomeMessage: welcomeMessage,
    catalogDesignBannerEnabled: bannerEnabled,
    catalogDesignBannerImages: bannerImages,
  });

  res.json({ success: true, message: "Catalog design updated" });
});
