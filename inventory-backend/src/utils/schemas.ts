import { z } from "zod";

const uuidParam = z.object({
  id: z.string().uuid(),
});

const dateString = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid date",
  });

const userPermissionSchema = z.enum([
  "MANAGE_USERS",
  "MANAGE_APPROVALS",
  "MANAGE_PRODUCTS",
  "MANAGE_CUSTOMERS",
  "MANAGE_INVOICES",
  "MANAGE_VOUCHERS",
  "VIEW_REPORTS",
  "MANAGE_SETTINGS",
  // Granular sell-floor permissions
  "VIEW_WITHOUT_PRICES",
  "SELL_WITH_DISCOUNT",
  "VIEW_PURCHASE_PRICE",
  "ACCESS_POS",
  // Warehouse-transfer permissions
  "REQUEST_TRANSFER",
  "MANAGE_TRANSFERS",
  // Stocktake / inventory-count permissions
  "INVENTORY_MANAGE",
  // Transfer-only staff: restricted to the transfers/variety-convert page, no prices
  "VARIETY_CONVERT",
  // DENY marker: hides profit & financial reports even from a full ADMIN
  // (see canViewProfitReports in permission.middleware.ts).
  "HIDE_PROFIT_REPORTS",
  // Two-way WhatsApp chat screen — send-as-the-shop is more sensitive than
  // MANAGE_CUSTOMERS, so it gets its own permission.
  "ACCESS_WHATSAPP_CHAT",
  "MANAGE_INSTAGRAM",
  "PUBLISH_INSTAGRAM",
]);

const auditEntitySchema = z.enum([
  "invoices",
  "vouchers",
  "products",
  "customers",
  "users",
  "branches",
  "transfers",
  "approvals",
  "settings",
  "coupons",
  "quotations",
  "variety-convert",
]);

const auditActionSchema = z.enum(["CREATE", "UPDATE", "DELETE", "REACTIVATE"]);

const productImageSchema = z
  .string()
  .trim()
  .max(620_000, "Product image is too large")
  .regex(/^data:image\/(jpeg|jpg|png|webp);base64,/i, "Invalid product image")
  .nullable()
  .optional();

export const loginSchema = z.object({
  body: z.object({
    username: z.string().trim().min(1),
    password: z.string().min(1),
  }),
});

// Minimum 8, matching ensureInitialAdmin — the interactive paths used to allow
// 4 characters, a keyspace the login limiter (5 per 15 min) does not meaningfully
// protect. Only applies to NEW passwords: the login schema stays min(1) so
// existing short passwords keep working until they are changed.
export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
  }),
});

export const createUserSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2),
    username: z.string().trim().min(3),
    password: z.string().min(8),
    role: z.enum(["ADMIN", "STAFF"]).default("STAFF"),
    permissions: z.array(userPermissionSchema).default([]),
    phone: z.string().trim().max(20).optional(),
    isActive: z.boolean().optional(),
  }),
});

export const updateUserSchema = z.object({
  params: uuidParam,
  body: z
    .object({
      name: z.string().trim().min(2).optional(),
      username: z.string().trim().min(3).optional(),
      password: z.string().min(8).optional(),
      role: z.enum(["ADMIN", "STAFF"]).optional(),
      permissions: z.array(userPermissionSchema).optional(),
      phone: z.string().trim().max(20).nullable().optional(),
      isActive: z.boolean().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: "At least one field is required",
    }),
});

export const idParamSchema = z.object({
  params: uuidParam,
});

export const portalTokenSchema = z.object({
  params: z.object({
    token: z.string().trim().min(16).max(128),
  }),
});

// Zod strips params not declared in the schema, and validate() overwrites
// req.params with the parsed result — so any route with an EXTRA path param
// beyond :token must declare it here, otherwise it arrives as undefined.
export const portalInvoiceSchema = z.object({
  params: z.object({
    token: z.string().trim().min(16).max(128),
    invoiceId: z.string().uuid(),
  }),
});

export const portalArrivalDeleteSchema = z.object({
  params: z.object({
    token: z.string().trim().min(16).max(128),
    subId: z.string().uuid(),
  }),
});

export const createPortalLinkSchema = z.object({
  params: uuidParam,
  body: z.object({
    expiresInDays: z.coerce.number().int().min(1).max(365).default(30),
  }).partial().default({}),
});

const catalogOrderItemSchema = z.object({
  productId: z.string().uuid(),
  unit: z.enum(["PIECE", "DOZEN", "BOX", "CARTON"]).default("PIECE"),
  quantity: z.coerce.number().int().min(1),
});

export const sendOtpSchema = z.object({
  body: z.object({
    phone: z.string().trim().min(7).max(20),
  }),
});

export const verifyOtpSchema = z.object({
  body: z.object({
    phone: z.string().trim().min(7).max(20),
    code: z.string().trim().min(4).max(8),
  }),
});

export const checkVerifiedSchema = z.object({
  query: z.object({
    phone: z.string().trim().min(7).max(20),
  }),
});

export const catalogAccessRequestSchema = z.object({
  body: z.object({
    customerName: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(5).max(40),
    address: z.string().trim().max(240).optional(),
    notes: z.string().trim().max(500).optional(),
  }),
});

export const catalogAccessStatusSchema = z.object({
  query: z.object({
    phone: z.string().trim().min(5).max(40),
  }),
});

export const catalogAccessQuerySchema = z.object({
  query: z.object({
    access: z.string().trim().min(20),
  }),
});

export const createCatalogOrderSchema = z.object({
  query: z.object({
    access: z.string().trim().min(20),
  }),
  body: z.object({
    customerName: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(5).max(40),
    address: z.string().trim().max(240).optional(),
    notes: z.string().trim().max(500).optional(),
    promoCode: z.string().trim().max(60).optional(),
    items: z.array(catalogOrderItemSchema).min(1).max(200),
  }),
});

export const guestCatalogProductImageSchema = z.object({
  query: z.object({
    id: z.string().uuid(),
  }),
});

export const createGuestCatalogOrderSchema = z.object({
  body: z.object({
    customerName: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(5).max(40),
    address: z.string().trim().max(240).optional(),
    notes: z.string().trim().max(500).optional(),
    items: z.array(catalogOrderItemSchema).min(1).max(200),
  }),
});

export const trackCatalogViewSchema = z.object({
  body: z.object({
    productId: z.string().uuid(),
    // The frontend always sends this key, empty string when there's no
    // visitor phone to attach (e.g. token-mode customers) — don't reject it.
    phone: z.string().trim().max(40).optional(),
  }),
});

/* ── Marketing opt-out («توقف») ───────────────────────────────────── */

export const optOutPhoneSchema = z.object({
  body: z.object({
    phone: z.string().trim().min(5).max(40),
    reason: z.string().trim().max(200).optional(),
  }),
});

/* ── Storefront login ─────────────────────────────────────────────── */

export const customerLoginSchema = z.object({
  body: z.object({
    phone: z.string().trim().min(5).max(40),
    code: z.string().trim().min(4).max(10),
  }),
});

export const visitorDetailsSchema = z.object({
  body: z.object({
    phone: z.string().trim().min(5).max(40),
    customerName: z.string().trim().min(2).max(120),
    address: z.string().trim().max(240).optional(),
    notes: z.string().trim().max(500).optional(),
  }),
});

const credentialTargetSchema = z.object({
  kind: z.enum(["CUSTOMER", "VISITOR"]),
  id: z.string().uuid().optional(),
  phone: z.string().trim().max(40).optional(),
});

export const sendCredentialsSchema = z.object({
  body: credentialTargetSchema.extend({
    channel: z.enum(["official", "personal"]).optional(),
  }),
});

export const sendCredentialsBulkSchema = z.object({
  body: z.object({
    targets: z.array(credentialTargetSchema).min(1).max(2000),
    channel: z.enum(["official", "personal"]).optional(),
  }),
});

export const sendCredentialsToAllSchema = z.object({
  body: z.object({
    group: z.enum(["customers", "visitors", "all"]).optional(),
    channel: z.enum(["official", "personal"]).optional(),
  }),
});

export const setPricesHiddenSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({ hidden: z.boolean() }),
});

export const unlockAccountSchema = z.object({
  body: z.object({
    kind: z.enum(["CUSTOMER", "VISITOR"]),
    idOrPhone: z.string().trim().min(1).max(64),
  }),
});

/* ── Catalog product page ─────────────────────────────────────────── */

export const catalogProductIdSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});

export const catalogGalleryImageSchema = z.object({
  params: z.object({ id: z.string().uuid(), imageId: z.string().uuid() }),
});

export const submitProductReviewSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    rating: z.coerce.number().int().min(1).max(5),
    comment: z.string().trim().max(1000).optional(),
  }),
});

export const updateProductContentSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    description: z.string().trim().max(4000).optional(),
    specs: z
      .array(z.object({ label: z.string().trim().max(60), value: z.string().trim().max(200) }))
      .max(30)
      .optional(),
    // "" clears the offer deadline; otherwise an ISO datetime from the picker.
    offerEndsAt: z.string().trim().max(40).optional(),
  }),
});

export const addProductImageSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    // Data URIs, so no .url() here. Bounded to keep one paste from writing a
    // multi-megabyte row (and dragging every backup down with it).
    url: z.string().min(1).max(4_000_000),
    thumbnailUrl: z.string().max(1_000_000).optional(),
  }),
});

export const deleteProductImageSchema = z.object({
  params: z.object({ id: z.string().uuid(), imageId: z.string().uuid() }),
});

export const setReviewStatusSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({ status: z.enum(["APPROVED", "REJECTED"]) }),
});

export const visitorHeartbeatSchema = z.object({
  body: z.object({
    phone: z.string().trim().min(5).max(40),
    seconds: z.coerce.number().min(0).max(60),
  }),
});

export const invoiceIdParamSchema = z.object({
  params: z.object({
    invoiceId: z.string().uuid(),
  }),
});

export const reviewApprovalSchema = z.object({
  params: uuidParam,
  body: z.object({
    status: z.enum(["APPROVED", "REJECTED"]),
    allowPrices: z.coerce.boolean().optional(),
    showStock: z.coerce.boolean().optional(),
  }),
});

export const listAuditLogsSchema = z.object({
  query: z.object({
    userId: z.string().uuid().optional(),
    entity: auditEntitySchema.optional(),
    action: auditActionSchema.optional(),
    from: dateString.optional(),
    to: dateString.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
});

export const listBranchesSchema = z.object({
  query: z.object({
    search: z.string().trim().optional(),
    isActive: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === "true")),
  }),
});

export const createBranchSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2),
    code: z.string().trim().min(1),
    phone: z.string().trim().optional(),
    address: z.string().trim().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const updateBranchSchema = z.object({
  params: uuidParam,
  body: createBranchSchema.shape.body.partial().refine(
    (body) => Object.keys(body).length > 0,
    { message: "At least one branch field is required" }
  ),
});

export const listCustomersSchema = z.object({
  query: z.object({
    search: z.string().trim().optional(),
    branchId: z.string().uuid().optional(),
    hasDebt: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === "true")),
    isSupplier: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === "true")),
    tags: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((value) => (value === undefined ? undefined : (Array.isArray(value) ? value : [value]))),
    customerIds: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((value) => (value === undefined ? undefined : (Array.isArray(value) ? value : [value]))),
    includeDeleted: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(5000).default(20),
  }),
});

export const createCustomerSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2),
    phone: z.string().trim().min(5),
    address: z.string().trim().optional(),
    notes: z.string().trim().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    openingBalance: z.coerce.number().default(0),
    creditLimit: z.coerce.number().nonnegative().nullable().optional(),
    branchId: z.string().uuid().optional(),
    isSupplier: z.coerce.boolean().optional(),
    isBoth: z.coerce.boolean().optional(),
  }),
});

export const updateCustomerSchema = z.object({
  params: uuidParam,
  body: z
    .object({
      name: z.string().trim().min(2).optional(),
      phone: z.string().trim().min(5).optional(),
      address: z.string().trim().nullable().optional(),
      notes: z.string().trim().nullable().optional(),
      tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
      openingBalance: z.coerce.number().optional(),
      creditLimit: z.coerce.number().nonnegative().nullable().optional(),
      branchId: z.string().uuid().nullable().optional(),
      isSupplier: z.coerce.boolean().optional(),
      isBoth: z.coerce.boolean().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: "At least one field is required",
    }),
});

export const customerBroadcastSchema = z.object({
  body: z
    .object({
      tags: z.array(z.string().trim().min(1)).max(20).default([]),
      customerIds: z.array(z.string().uuid()).max(1000).default([]),
      productIds: z.array(z.string().uuid()).min(1).max(10),
      message: z.string().trim().min(1).max(2000),
    })
    .refine((body) => body.tags.length > 0 || body.customerIds.length > 0, {
      message: "اختر تاك واحد أو زبون واحد على الأقل",
      path: ["tags"],
    }),
});

export const customerTagCreateSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(40),
  }),
});

export const customerTagRenameSchema = z.object({
  body: z.object({
    oldName: z.string().trim().min(1).max(40),
    newName: z.string().trim().min(1).max(40),
  }),
});

export const customerTagDeleteSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(40),
  }),
});

export const sendCatalogLinkSchema = z.object({
  params: uuidParam,
  body: z.object({
    promoCode: z.string().trim().max(60).optional(),
  }),
});

export const catalogLinkBroadcastSchema = z.object({
  body: z.object({
    tags: z.array(z.string().trim().min(1)).min(1).max(20),
    promoCode: z.string().trim().max(60).optional(),
  }),
});

export const createTransferSchema = z.object({
  body: z.object({
    fromBranchId: z.string().uuid(),
    toBranchId: z.string().uuid(),
    notes: z.string().trim().max(500).optional(),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantity: z.coerce.number().int().positive(),
          unit: z.enum(["PIECE", "DOZEN", "BOX", "CARTON"]),
        })
      )
      .min(1),
  }),
});

export const createStockLossSchema = z.object({
  body: z.object({
    date: dateString,
    warehouseId: z.string().uuid(),
    reason: z.enum(["DAMAGE", "EXPIRY", "THEFT", "DEFECT", "OTHER"]).default("DAMAGE"),
    notes: z.string().trim().max(500).optional(),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          unit: z.enum(["PIECE", "DOZEN", "BOX", "CARTON"]),
          // Rejects 0, negatives, NaN and non-integers — a loss only removes stock.
          quantity: z.coerce.number().int().positive(),
        })
      )
      .min(1),
  }),
});

export const cancelStockLossSchema = z.object({
  params: uuidParam,
});

export const sendStatementPdfSchema = z.object({
  params: uuidParam,
  body: z.object({
    date: dateString.optional(),
    // Per-send channel from the UI picker (official = Meta Cloud, personal = Green API)
    channel: z.enum(["official", "personal"]).optional(),
  }),
});

export const customerTransactionsSchema = z.object({
  params: uuidParam,
  query: z.object({
    from: dateString.optional(),
    to: dateString.optional(),
    all: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
  }),
});

export const inactiveCustomersSchema = z.object({
  query: z.object({
    days: z.coerce.number().int().min(1).default(30),
  }),
});

export const listProductsSchema = z.object({
  query: z.object({
    search: z.string().trim().optional(),
    category: z.string().trim().optional(),
    branchId: z.string().uuid().optional(),
    lowStock: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === "true")),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(10000).default(20),
  }),
});

export const createProductSchema = z.object({
  body: z.object({
    // Only `name` is mandatory; everything else has sensible defaults or is auto-generated.
    name: z.string().trim().min(2),
    itemNumber: z.string().trim().optional(),
    qrCode: z.string().trim().optional(),
    cartonQrCode: z.string().trim().optional(),
    imageUrl: productImageSchema,
    category: z.string().trim().optional(),
    categoryTags: z.array(z.string().trim()).optional(),
    typeTags: z.array(z.string().trim()).optional(),
    isNewArrival: z.coerce.boolean().optional(),
    isOffer: z.coerce.boolean().optional(),
    oldPrice: z.coerce.number().nonnegative().nullable().optional(),
    warehouseDistribution: z
      .array(z.object({ warehouseId: z.string().uuid(), pieces: z.coerce.number().int().min(0) }))
      .optional(),
    openingBalancePcs: z.coerce.number().int().min(0).default(0),
    cartonsAvailable: z.coerce.number().int().min(0).default(0),
    pcsPerCarton: z.coerce.number().int().min(1).default(1),
    boxPieces: z.coerce.number().int().min(1).nullable().optional(),
    isBoxPiecesManual: z.coerce.boolean().optional(),
    hiddenUnits: z.array(z.enum(["DOZEN", "BOX", "CARTON"])).optional(),
    purchasePrice: z.coerce.number().nonnegative().default(0),
    salePrice: z.coerce.number().nonnegative().default(0),
    retailPrice: z.coerce.number().nonnegative().default(0),
    costPrice: z.coerce.number().nonnegative().default(0),
    expiryDate: z.string().nullable().optional(),
    minStock: z.coerce.number().int().min(0).default(0),
    storageLocation: z.string().trim().max(120).nullable().optional(),
    branchId: z.string().uuid().optional(),
  }),
});

export const updateProductSchema = z.object({
  params: uuidParam,
  body: createProductSchema.shape.body.partial().refine(
    (body) => Object.keys(body).length > 0,
    { message: "At least one product field is required" }
  ),
});

// Shared across the automatic stock-correction call sites (manual adjust-stock,
// cycle-count approval, stocktake approval) — COUNT_ERROR is valid here (and
// not in createStockLossSchema above) because these flows can also represent a
// surplus/count discrepancy, not only damage-style loss reasons.
const lossReasonSchema = z.enum(["DAMAGE", "EXPIRY", "THEFT", "DEFECT", "COUNT_ERROR", "OTHER"]);

export const adjustProductStockSchema = z.object({
  params: uuidParam,
  body: z.object({
    warehouses: z
      .array(
        z.object({
          warehouseId: z.string().uuid(),
          quantityPieces: z.coerce.number().int().min(0),
        }),
      )
      .min(1),
    note: z.string().trim().max(500).optional(),
    reason: lossReasonSchema,
  }),
});

export const varietyConvertSchema = z.object({
  body: z.object({
    fromWarehouseId: z.string().uuid(),
    targetProductId: z.string().uuid(),
    toWarehouseId: z.string().uuid().optional(),
    allowNegative: z.coerce.boolean().optional(),
    notes: z.string().trim().max(500).optional(),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          unit: z.enum(["PIECE", "DOZEN", "BOX", "CARTON"]),
          quantity: z.coerce.number().int().positive(),
        }),
      )
      .min(1),
  }),
});

export const listInvoicesSchema = z.object({
  query: z.object({
    customerId: z.string().uuid().optional(),
    branchId: z.string().uuid().optional(),
    status: z.enum(["ACTIVE", "CANCELLED"]).optional(),
    type: z.enum(["SALE", "PURCHASE", "SALES_RETURN"]).optional(),
    paymentType: z.enum(["CASH", "CREDIT", "PARTIAL"]).optional(),
    from: dateString.optional(),
    to: dateString.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(1000).default(20),
  }),
});

export const listProductReviewsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(20),
  }),
});

export const lastSoldPriceSchema = z.object({
  query: z.object({
    customerId: z.string().uuid(),
    productId: z.string().uuid(),
  }),
});

export const customerProductHistorySchema = z.object({
  query: z.object({
    customerId: z.string().uuid(),
    productId: z.string().uuid(),
  }),
});

export const lastSoldPriceOverallSchema = z.object({
  query: z.object({
    productId: z.string().uuid(),
  }),
});

const invoiceItemSchema = z.object({
  productId: z.string().uuid(),
  warehouseId: z.string().uuid().optional(),
  unit: z.enum(["PIECE", "DOZEN", "BOX", "CARTON"]),
  quantity: z.coerce.number().int().min(1),
  unitPrice: z.coerce.number().nonnegative().optional(),
  notes: z.string().trim().max(500).optional(),
  // Seller explicitly chose to sell a product that is out of stock — the line is
  // allowed to push warehouse stock negative and is flagged for manager review.
  allowNegativeStock: z.boolean().optional(),
});

const invoiceTypeSchema = z.enum(["SALE", "PURCHASE", "SALES_RETURN"]);

export const createInvoiceSchema = z.object({
  body: z.object({
    customerId: z.string().uuid(),
    branchId: z.string().uuid().optional(),
    type: invoiceTypeSchema.default("SALE"),
    date: dateString.optional(),
    originalInvoiceId: z.string().uuid().optional(),
    couponCode: z.string().trim().max(60).optional(),
    clientRequestId: z.string().min(8).max(100).optional(),
    discount: z.coerce.number().nonnegative().default(0),
    tax: z.coerce.number().nonnegative().default(0),
    paidAmount: z.coerce.number().nonnegative().default(0),
    paymentType: z.enum(["CASH", "CREDIT", "PARTIAL"]).optional(),
    notes: z.string().trim().max(2000).optional(),
    items: z.array(invoiceItemSchema).min(1),
  }),
});

export const updateInvoiceSchema = z.object({
  params: uuidParam,
  body: z.object({
    type: invoiceTypeSchema.optional(),
    // validate() REPLACES req.body with the parsed result, so a field absent
    // here is silently dropped. Both edit UIs send customerId; without this the
    // service always fell back to the existing customer and the entire
    // reassignment branch (including the loyalty transfer) never ran.
    customerId: z.string().uuid().optional(),
    originalInvoiceId: z.string().uuid().optional(),
    couponCode: z.string().trim().max(60).optional(),
    discount: z.coerce.number().nonnegative().default(0),
    tax: z.coerce.number().nonnegative().default(0),
    paidAmount: z.coerce.number().nonnegative().default(0),
    paymentType: z.enum(["CASH", "CREDIT", "PARTIAL"]).optional(),
    notes: z.string().trim().max(2000).optional(),
    items: z.array(invoiceItemSchema).min(1),
  }),
});

export const couponSchema = z.object({
  body: z.object({
    code: z.string().trim().min(2).max(60).transform((value) => value.toUpperCase()),
    name: z.string().trim().min(2).max(120),
    discountType: z.enum(["PERCENT", "AMOUNT"]),
    discountValue: z.coerce.number().positive(),
    startsAt: dateString.optional(),
    endsAt: dateString.optional(),
    maxUses: z.coerce.number().int().positive().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const updateCouponSchema = z.object({
  params: uuidParam,
  body: couponSchema.shape.body.partial().refine((body) => Object.keys(body).length > 0, {
    message: "At least one coupon field is required",
  }),
});

export const applyCouponSchema = z.object({
  body: z.object({
    code: z.string().trim().min(2).max(60),
    subtotal: z.coerce.number().nonnegative(),
  }),
});

export const listQuotationsSchema = z.object({
  query: z.object({
    customerId: z.string().uuid().optional(),
    status: z.enum(["PENDING", "ACCEPTED", "REJECTED", "EXPIRED", "CONVERTED"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(1000).default(20),
  }),
});

export const createQuotationSchema = z.object({
  body: z.object({
    customerId: z.string().uuid(),
    discount: z.coerce.number().nonnegative().default(0),
    expiresAt: dateString.optional(),
    notes: z.string().trim().max(500).optional(),
    items: z.array(invoiceItemSchema).min(1),
  }),
});

export const updateQuotationStatusSchema = z.object({
  params: uuidParam,
  body: z.object({
    status: z.enum(["ACCEPTED", "REJECTED", "EXPIRED"]),
  }),
});

export const listVouchersSchema = z.object({
  query: z.object({
    customerId: z.string().uuid().optional(),
    branchId: z.string().uuid().optional(),
    type: z.enum(["RECEIPT", "PAYMENT", "EXPENSE"]).optional(),
    from: dateString.optional(),
    to: dateString.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(5000).default(20),
    // z.coerce.boolean() runs `Boolean(value)` — on the query STRING "false"
    // that's `Boolean("false") === true` (any non-empty string is truthy), so
    // ?showCancelled=false silently flipped to true and inverted the filter.
    // Since cancelling a voucher also archives it, that inverted filter
    // (archivedAt: null AND cancelledAt: not null) matched zero rows for
    // every tenant — every voucher looked "gone" even though none were.
    showCancelled: z.preprocess((v) => (typeof v === "string" ? v === "true" : v), z.boolean().optional()),
  }),
});

export const createVoucherSchema = z.object({
  body: z
    .object({
      // customerId is required for RECEIPT/PAYMENT and forbidden for EXPENSE (enforced below).
      customerId: z.string().uuid().optional(),
      branchId: z.string().uuid().optional(),
      amount: z.coerce.number().positive(),
      // Both clients have always sent this; without it here validate() deleted
      // the key and the service fell back to new Date() — a raw server-UTC
      // timestamp. A receipt entered at 01:30 Iraq was then stored on the
      // previous day and filed under a different end-of-day than the invoice
      // it settles.
      date: dateString.optional(),
      type: z.enum(["RECEIPT", "PAYMENT", "EXPENSE"]),
      clientRequestId: z.string().min(8).max(100).optional(),
      notes: z.string().trim().optional(),
      // EXPENSE vouchers carry a short label (e.g. "أجور مولّدة"). Optional for the others.
      description: z.string().trim().optional(),
      // EXPENSE-only breakdown category (كهرباء/إيجار/رواتب/أخرى) — free string.
      category: z.string().trim().max(50).optional(),
    })
    .refine((body) => body.type === "EXPENSE" || !!body.customerId, {
      message: "customerId is required for RECEIPT and PAYMENT vouchers",
      path: ["customerId"],
    })
    .refine((body) => body.type !== "EXPENSE" || !!body.description, {
      message: "description is required for EXPENSE vouchers",
      path: ["description"],
    }),
});

export const updateVoucherSchema = z.object({
  params: uuidParam,
  body: z
    .object({
      customerId: z.string().uuid().optional(),
      amount: z.coerce.number().positive().optional(),
      date: dateString.optional(),
      notes: z.string().trim().optional(),
      description: z.string().trim().optional(),
      category: z.string().trim().max(50).optional(),
    })
    .refine((b) => Object.keys(b).length > 0, { message: "At least one field is required" }),
});

export const salesReportSchema = z.object({
  query: z.object({
    from: dateString.optional(),
    to: dateString.optional(),
    groupBy: z.enum(["day", "week", "month"]).default("day"),
    branchId: z.string().uuid().optional(),
  }),
});

export const productMovementReportSchema = z.object({
  query: z.object({
    productId: z.string().uuid(),
    branchId: z.string().uuid().optional(),
    from: dateString.optional(),
    to: dateString.optional(),
  }),
});

export const profitReportSchema = z.object({
  query: z.object({
    from: dateString.optional(),
    to: dateString.optional(),
    groupBy: z.enum(["day", "week", "month"]).optional(),
  }),
});

export const warehouseComparisonReportSchema = z.object({
  query: z.object({
    from: dateString.optional(),
    to: dateString.optional(),
  }),
});

export const crossSellReportSchema = z.object({
  query: z.object({
    from: dateString.optional(),
    to: dateString.optional(),
    productId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
});

export const storeBrainReportSchema = z.object({
  query: z.object({
    from: dateString.optional(),
    to: dateString.optional(),
  }),
});

export const dailyAssistantSchema = z.object({
  query: z.object({
    date: dateString.optional(),
    refresh: z
      .enum(["true", "false", "1", "0"])
      .optional()
      .transform((v) => v === "true" || v === "1"),
  }),
});

export const customerDebtsReportSchema = z.object({
  query: z.object({
    minDays: z.coerce.number().int().min(0).default(0),
    // No default: omitting it must mean "no cap", not "999 days".
    maxDays: z.coerce.number().int().min(0).optional(),
    branchId: z.string().uuid().optional(),
  }),
});

export const customerStatementsExportSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    customerFilter: z.enum(["all", "withBalance", "inactive"]).optional(),
    inactiveDays: z.coerce.number().int().min(1).max(3650).optional(),
    from: dateString.optional(),
    to: dateString.optional(),
    all: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
  }),
});

export const sendWhatsAppSchema = z.object({
  body: z.object({
    phone: z.string().trim().min(5),
    message: z.string().trim().min(1),
  }),
});

export const sendWhatsAppTemplatedSchema = z.object({
  body: z.object({
    phone: z.string().trim().min(5),
    message: z.string().trim().min(1),
    templateKind: z.enum(["voucher", "statement", "portal"]),
    bodyParams: z.array(z.string()).default([]),
  }),
});

// The settings page round-trips the whole settings object, and legacy rows can
// hold JSON null — treat null as "not sent" instead of failing validation.
const nullAsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === null ? undefined : v), schema.optional());

export const updateSettingsSchema = z.object({
  body: z
    .object({
      debtReminderDays: z.coerce.number().int().min(1).optional(),
      inactiveCustomerDays: z.coerce.number().int().min(1).optional(),
      autoSendDebtReminder: z.boolean().optional(),
      autoSendInactiveMessage: z.boolean().optional(),
      storeName: z.string().trim().min(1).optional(),
      storeLogo: z.string().trim().optional(),
      storePhone: z.string().trim().optional(),
      storeAddress: z.string().trim().optional(),
      currency: z.string().trim().min(1).optional(),
      invoiceTemplate: z.string().trim().optional(),
      invoiceDesign: z.string().trim().optional(),
      voucherTemplate: z.string().trim().optional(),
      statementTemplate: z.string().trim().optional(),
      themePreset: z.enum(["classic", "iraqi", "exclusive", "bold", "designer"]).optional(),
      backupWhatsappNumber: z.string().trim().optional(),
      shopWarehouseId: z.string().trim().optional(),
      catalogPublicUrl: z.string().trim().optional(),
      catalogAdminWhatsappNumber: z.string().trim().optional(),
      orderPreparationWhatsappNumbers: z.string().trim().optional(),
      adminApprovalWhatsappNumber: z.string().trim().optional(),
      autoSendDailySummary: z.boolean().optional(),
      dailySummaryWhatsappNumber: z.string().trim().optional(),
      dailySummaryHour: z.coerce.number().int().min(0).max(23).optional(),
      whatsappProvider: z.enum(["manual", "greenapi", "cloud", "web", "disabled"]).optional(),
      whatsappCloudToken: z.string().trim().optional(),
      whatsappCloudPhoneNumberId: z.string().trim().optional(),
      whatsappCloudBusinessAccountId: z.string().trim().optional(),
      whatsappCloudVerifyToken: z.string().trim().optional(),
      whatsappCloudAppSecret: z.string().trim().optional(),
      greenApiInstanceId: z.string().trim().optional(),
      greenApiToken: z.string().trim().optional(),
      greenApiBaseUrl: z.string().trim().optional(),
      preparationWorkers: z
        .array(
          z.object({
            id: z.string(),
            name: z.string().trim(),
            phone: z.string().trim(),
            active: z.boolean(),
            notes: z.string().trim().optional(),
          }),
        )
        .optional(),
      seasonalAlerts: z.string().trim().optional(),
      siteDesignerName: z.string().trim().max(120).optional(),
      siteDesignerPhone: z.string().trim().max(40).optional(),
      prospectGroupInviteLink: z.string().trim().optional(),
      prospectAutoReplyKeywords: z.array(z.string()).optional(),
      prospectAutoReplyMessage: z.string().optional(),
      prospectAutoReplyEnabled: z.boolean().optional(),
      whatsappBotEnabled: z.boolean().optional(),
      botUnknownMessage: z.string().optional(),
      catalogRequireOtp: z.boolean().optional(),
      catalogFullCartonOnly: z.boolean().optional(),
      labelPieceWidthMm: z.coerce.number().min(10).max(300).optional(),
      labelPieceHeightMm: z.coerce.number().min(10).max(300).optional(),
      labelCartonWidthMm: z.coerce.number().min(10).max(300).optional(),
      labelCartonHeightMm: z.coerce.number().min(10).max(300).optional(),
      pieceLabelLayout: z.enum(["side-by-side", "stacked", "qr-only"]).optional(),
      pieceLabelQrPosition: z.enum(["left", "right"]).optional(),
      pieceLabelShowName: z.boolean().optional(),
      pieceLabelShowItemNumber: z.boolean().optional(),
      pieceLabelShowCartonCount: z.boolean().optional(),
      pieceLabelNameFontSize: z.coerce.number().min(8).max(42).optional(),
      pieceLabelMetaFontSize: z.coerce.number().min(7).max(32).optional(),
      pieceLabelPaddingMm: z.coerce.number().min(1).max(10).optional(),
      cartonLabelLayout: z.enum(["side-by-side", "stacked", "qr-only"]).optional(),
      cartonLabelQrPosition: z.enum(["left", "right"]).optional(),
      cartonLabelShowName: z.boolean().optional(),
      cartonLabelShowItemNumber: z.boolean().optional(),
      cartonLabelShowPcsPerCarton: z.boolean().optional(),
      cartonLabelNameFontSize: z.coerce.number().min(8).max(60).optional(),
      cartonLabelMetaFontSize: z.coerce.number().min(7).max(48).optional(),
      cartonLabelPaddingMm: z.coerce.number().min(1).max(15).optional(),
      botRules: z
        .array(
          z.object({
            id: z.string(),
            keywords: z.array(z.string()),
            replyType: z.enum(["STATEMENT", "BALANCE", "CATALOG_LINK", "TEXT"]),
            replyText: z.string().optional(),
            builtin: z.boolean().optional(),
          })
        )
        .optional(),
      // "جدولة الجرد الذكي" (scheduled smart cycle count) settings — independent
      // from the manual stocktake feature.
      cycleCountEnabled: z.boolean().optional(),
      cycleCountWarehouseId: z.string().trim().optional(),
      cycleCountIntervalDays: z.coerce.number().int().min(1).max(365).optional(),
      cycleCountItemLimit: z.coerce.number().int().min(1).max(1000).optional(),
      cycleCountStrategy: z.enum(["RANDOM", "HIGH_VALUE", "FAST_MOVING", "LOW_STOCK", "LEAST_RECENTLY_COUNTED"]).optional(),
      personalDebtReminderWhatsappNumber: z.string().trim().optional(),
      reportsProfitStartDate: z.string().trim().optional(),
      // Telegram backup delivery (fields existed in the UI but were silently
      // stripped here — validate() replaces req.body with the parsed object).
      telegramBotToken: nullAsUndefined(z.string().trim()),
      telegramChatId: nullAsUndefined(z.string().trim()),
      // Meta Cloud API template names (all UI-editable; were silently stripped
      // like the Telegram fields above — same latent bug, fixed 2026-07-20).
      invoiceTemplateName: nullAsUndefined(z.string().trim()),
      voucherTemplateName: nullAsUndefined(z.string().trim()),
      statementTemplateName: nullAsUndefined(z.string().trim()),
      portalLinkTemplateName: nullAsUndefined(z.string().trim()),
      statementPdfTemplateName: nullAsUndefined(z.string().trim()),
      otpTemplateName: nullAsUndefined(z.string().trim()),
      catalogAccessRequestedTemplateName: nullAsUndefined(z.string().trim()),
      catalogAccessApprovedTemplateName: nullAsUndefined(z.string().trim()),
      orderSubmittedTemplateName: nullAsUndefined(z.string().trim()),
      productArrivalTemplateName: nullAsUndefined(z.string().trim()),
      debtReminderTemplateName: nullAsUndefined(z.string().trim()),
      inactiveCustomerTemplateName: nullAsUndefined(z.string().trim()),
      // WhatsApp send channels (per-send picker)
      personalChannelEnabled: nullAsUndefined(z.boolean()),
      personalChannelDailyLimit: nullAsUndefined(z.coerce.number().int().min(1).max(10000)),
      webChannelEnabled: nullAsUndefined(z.boolean()),
      // Wholesale catalog design + shuffle
      catalogDesignPrimaryColor: nullAsUndefined(z.string().trim()),
      catalogDesignBgColor: nullAsUndefined(z.string().trim()),
      catalogDesignDefaultTheme: nullAsUndefined(z.enum(["clean", "warm", "dark", "vibrant"])),
      catalogDesignLogoUrl: nullAsUndefined(z.string().trim()),
      catalogDesignWelcomeMessage: nullAsUndefined(z.string().trim()),
      catalogDesignBannerEnabled: nullAsUndefined(z.boolean()),
      catalogDesignBannerImages: nullAsUndefined(
        z.array(z.object({ url: z.string(), title: z.string(), order: z.coerce.number() })),
      ),
      // Catalog footer — every field must be listed here or validate() strips
      // it out of req.body and the save silently drops it.
      catalogDesignFooterEnabled: nullAsUndefined(z.boolean()),
      catalogDesignFooterAbout: nullAsUndefined(z.string().trim()),
      catalogDesignFooterPhone: nullAsUndefined(z.string().trim()),
      catalogDesignFooterWhatsapp: nullAsUndefined(z.string().trim()),
      catalogDesignFooterAddress: nullAsUndefined(z.string().trim()),
      catalogDesignFooterHours: nullAsUndefined(z.string().trim()),
      catalogDesignFooterInstagram: nullAsUndefined(z.string().trim()),
      catalogDesignFooterFacebook: nullAsUndefined(z.string().trim()),
      catalogDesignFooterTelegram: nullAsUndefined(z.string().trim()),
      catalogDesignFooterTiktok: nullAsUndefined(z.string().trim()),
      catalogDesignFooterDeliveryAreas: nullAsUndefined(z.string().trim()),
      catalogDesignFooterDeliveryTime: nullAsUndefined(z.string().trim()),
      catalogDesignFooterMinOrder: nullAsUndefined(z.string().trim()),
      catalogDesignFooterCashOnDelivery: nullAsUndefined(z.boolean()),
      catalogDesignTrust1Enabled: nullAsUndefined(z.boolean()),
      catalogDesignTrust1Text: nullAsUndefined(z.string().trim().max(60)),
      catalogDesignTrust2Enabled: nullAsUndefined(z.boolean()),
      catalogDesignTrust2Text: nullAsUndefined(z.string().trim().max(60)),
      catalogDesignTrust3Enabled: nullAsUndefined(z.boolean()),
      catalogDesignTrust3Text: nullAsUndefined(z.string().trim().max(60)),
      catalogDesignLowStockCartons: nullAsUndefined(z.coerce.number().int().min(0).max(1000)),
      catalogPricesVisibleByDefault: nullAsUndefined(z.boolean()),
      catalogRequireLogin: nullAsUndefined(z.boolean()),
      storefrontCredentialsTemplate: nullAsUndefined(z.string().max(2000)),
      catalogAccessApprovedTemplate: nullAsUndefined(z.string().max(2000)),
      marketingStopKeywords: nullAsUndefined(z.array(z.string().trim().max(40)).max(20)),
      marketingStopConfirmation: nullAsUndefined(z.string().max(1000)),
      catalogShuffleMode: nullAsUndefined(z.enum(["hourly", "daily", "off"])),
      // «قناة تيليگرام» — wholesale-catalog mirror channel (separate bot).
      telegramChannelEnabled: nullAsUndefined(z.boolean()),
      telegramChannelBotToken: nullAsUndefined(z.string().trim()),
      telegramChannelChatId: nullAsUndefined(z.string().trim()),
      // Freshness rotation count — telegramFeaturedProductId/LastMessageId/
      // LastDate are intentionally NOT exposed here (internal bookkeeping the
      // featured-pin cron manages itself, same reasoning as the digest fields).
      telegramRotationDailyCount: nullAsUndefined(z.coerce.number().int().min(1).max(50)),
      // «بوت الطلبات» — configurable text + anti-spam + digest pin tracking.
      telegramBotWelcomeMessage: nullAsUndefined(z.string().trim()),
      telegramBotStoreAddress: nullAsUndefined(z.string().trim()),
      telegramBotWorkingHours: nullAsUndefined(z.string().trim()),
      telegramBotContactPhone: nullAsUndefined(z.string().trim()),
      telegramBotBannedChatIds: nullAsUndefined(z.array(z.string())),
      // telegramDigestLastMessageId/Date are intentionally NOT exposed here —
      // internal bookkeeping the daily digest cron manages itself via a
      // direct updateSettings() call; admin-editable would risk it unpinning
      // an unrelated message on the next run.
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: "At least one setting is required",
    }),
})

// «الديون الشخصية» — personal debts, unrelated to shop customers.
export const createPersonalDebtSchema = z.object({
  body: z.object({
    personName: z.string().trim().min(1),
    amount: z.coerce.number().positive(),
    dueDate: dateString,
    notes: z.string().trim().max(500).optional(),
  }),
});

export const updatePersonalDebtSchema = z.object({
  params: uuidParam,
  body: z
    .object({
      personName: z.string().trim().min(1).optional(),
      amount: z.coerce.number().positive().optional(),
      dueDate: dateString.optional(),
      notes: z.string().trim().max(500).optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: "At least one field is required",
    }),
});;

export const updateMessageTemplateSchema = z.object({
  params: uuidParam,
  body: z
    .object({
      name: z.string().trim().min(1).optional(),
      body: z.string().trim().min(1).optional(),
      type: z.string().trim().min(1).optional(),
      isActive: z.boolean().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: "At least one template field is required",
    }),
});

// ── Retail catalog (كتلوك المفرد) ──────────────────────────────────────────────

const retailItemFields = {
  title: z.string().trim().max(160).optional(),
  description: z.string().trim().max(1000).optional(),
  oldPrice: z.coerce.number().nonnegative().nullable().optional(),
  category: z.string().trim().max(120).nullable().optional(),
  subCategory: z.string().trim().max(120).nullable().optional(),
  categories: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
  subCategories: z.array(z.string().trim().min(1).max(120)).max(80).optional(),
  images: z.array(z.string()).max(8).optional(),
  sortOrder: z.coerce.number().int().optional(),
  featured: z.boolean().optional(),
  isBestSeller: z.boolean().optional(),
  isNew: z.boolean().optional(),
  isOffer: z.boolean().optional(),
  lowStockBadge: z.boolean().optional(),
  isActive: z.boolean().optional(),
};

export const createRetailItemSchema = z.object({
  body: z.object({
    productId: z.string().uuid(),
    price: z.coerce.number().nonnegative(),
    ...retailItemFields,
  }),
});

export const updateRetailItemSchema = z.object({
  params: uuidParam,
  body: z
    .object({
      price: z.coerce.number().nonnegative().optional(),
      ...retailItemFields,
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: "At least one field is required",
    }),
});

export const retailBroadcastSchema = z.object({
  body: z.object({
    message: z.string().trim().min(1).max(2000),
    images: z.array(z.string()).max(3).optional(),
    category: z.string().trim().max(120).optional(),
    categories: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    subscribersOnly: z.boolean().optional(),
  }),
});

export const createRetailCategorySchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(120),
    subCategories: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    sortOrder: z.coerce.number().int().optional(),
  }),
});

export const updateRetailCategorySchema = z.object({
  params: uuidParam,
  body: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      subCategories: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
      sortOrder: z.coerce.number().int().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: "At least one field is required",
    }),
});

export const createRetailCouponSchema = z.object({
  body: z.object({
    code: z.string().trim().min(2).max(60),
    name: z.string().trim().min(1).max(120),
    discountType: z.enum(["PERCENT", "AMOUNT"]),
    discountValue: z.coerce.number().positive(),
    startsAt: dateString.optional(),
    endsAt: dateString.optional(),
    maxUses: z.coerce.number().int().positive().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const updateRetailCouponSchema = z.object({
  params: uuidParam,
  body: createRetailCouponSchema.shape.body.partial().refine((body) => Object.keys(body).length > 0, {
    message: "At least one coupon field is required",
  }),
});

export const listRetailOrdersSchema = z.object({
  query: z.object({
    status: z.enum(["PENDING", "PREPARED", "CANCELLED"]).optional(),
  }),
});

export const submitRetailOrderSchema = z.object({
  body: z.object({
    customerName: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(5).max(40),
    address: z.string().trim().max(300).optional(),
    notes: z.string().trim().max(500).optional(),
    couponCode: z.string().trim().max(60).optional(),
    // Both were read by submitRetailOrder but absent here, so validate()
    // deleted them: the shop rendered «خصم الإحالة» and a reduced total, then
    // the backend stored the order at full price. Every referred customer was
    // quoted one number and charged another.
    referralCode: z.string().trim().max(60).optional(),
    warehouseId: z.string().uuid().optional(),
    isSubscriber: z.boolean().optional(),
    interests: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    wishNote: z.string().trim().max(500).optional(),
    items: z
      .array(
        z.object({
          retailItemId: z.string().uuid(),
          quantity: z.coerce.number().int().positive(),
        }),
      )
      .min(1)
      // Unauthenticated endpoint. Uncapped, an 8 MB body (the express.json
      // limit) is ~100k line items processed inside one Serializable
      // transaction — a single request that locks the order tables and drains
      // the connection pool. 200 matches the wholesale catalog order cap.
      .max(200),
  }),
});

// ── Unauthenticated public endpoints ────────────────────────────────────────
// Both of these were mounted with a rate limiter but no schema at all.

// `code.trim()` on an absent field threw a TypeError, so a body-less POST
// produced a 500 and an ErrorLog row — a free way to flood the merchant's
// error dashboard and the 90-day-retained error_logs table.
export const validatePromoSchema = z.object({
  body: z.object({
    code: z.string().trim().min(1).max(60),
    customerId: z.string().uuid().optional(),
  }),
});

// Every request here is a paid LLM call on the merchant's account, and the
// prompt was completely unbounded — 60 multi-megabyte prompts per minute per
// IP were accepted.
export const retailAiChatSchema = z.object({
  body: z.object({
    message: z.string().trim().min(1).max(1000),
    history: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().max(2000),
        }),
      )
      .max(20)
      .optional(),
  }),
});

// The only public catalog route that was mounted without a schema, and it
// creates a lead row and fires an admin WhatsApp per unseen phone.
export const guestCatalogEnterSchema = z.object({
  body: z.object({
    phone: z.string().trim().min(10).max(40),
  }),
});

export const cartSessionSchema = z.object({
  body: z.object({
    phone: z.string().trim().min(5).max(40),
    itemCount: z.coerce.number().int().nonnegative(),
    totalValue: z.coerce.number().nonnegative(),
  }),
});

export const searchMissSchema = z.object({
  body: z.object({
    query: z.string().trim().min(1).max(200),
    phone: z.string().trim().max(40).optional(),
  }),
});

export const previewRetailCouponSchema = z.object({
  body: z.object({
    code: z.string().trim().min(2).max(60),
    subtotal: z.coerce.number().nonnegative(),
  }),
});

// ── جدولة الجرد الذكي (cycle count) + الجرد الدوري (stocktake) ────────────────
// Both routers previously had zero request-body validation on these endpoints.
const sessionItemParams = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
});
const publicTokenParams = z.object({
  token: z.string().trim().min(16).max(128),
});

export const cycleCountUpdateItemSchema = z.object({
  params: uuidParam,
  body: z.object({
    productId: z.string().uuid(),
    actualQty: z.coerce.number().int().min(0),
    notes: z.string().trim().max(500).optional(),
  }),
});

export const cycleCountApproveItemSchema = z.object({
  params: sessionItemParams,
  body: z.object({
    reason: lossReasonSchema,
  }),
});

export const cycleCountApproveAllSchema = z.object({
  params: uuidParam,
  body: z.object({
    reason: lossReasonSchema,
  }),
});

export const cycleCountCloseSchema = z.object({
  params: uuidParam,
  body: z.object({
    force: z.coerce.boolean().optional(),
  }).optional(),
});

export const cycleCountPublicSetQtySchema = z.object({
  params: publicTokenParams,
  body: z.object({
    productId: z.string().uuid(),
    // Rejects negative/NaN/Infinity — matches the loss-quantity validation
    // convention used by createStockLossSchema above.
    qty: z.coerce.number().min(0).finite(),
    // Strict: previously unknown unit values silently fell through to being
    // treated as PIECE inside setCycleCountItemQty/setItemQty — reject instead.
    unit: z.enum(["CARTON", "PIECE"]),
  }),
});

export const stocktakeUpdateItemSchema = z.object({
  params: uuidParam,
  body: z.object({
    productId: z.string().uuid(),
    actualQty: z.coerce.number().int().min(0),
    notes: z.string().trim().max(500).optional(),
  }),
});

export const stocktakeApproveItemSchema = z.object({
  params: sessionItemParams,
  body: z.object({
    reason: lossReasonSchema,
  }),
});

export const stocktakeCloseSchema = z.object({
  params: uuidParam,
  body: z.object({
    force: z.coerce.boolean().optional(),
  }).optional(),
});

export const stocktakePublicSetQtySchema = z.object({
  params: publicTokenParams,
  body: z.object({
    productId: z.string().uuid(),
    qty: z.coerce.number().min(0).finite(),
    unit: z.enum(["CARTON", "PIECE"]),
    // Accepted for backward compatibility with the existing frontend payload
    // shape; the service ignores it and reads pcsPerCarton from the DB itself.
    pcsPerCarton: z.coerce.number().optional(),
  }),
});

export const stocktakePublicScanSchema = z.object({
  params: publicTokenParams,
  body: z.object({
    qrCode: z.string().trim().min(1),
  }),
});

export const cycleCountPublicScanSchema = z.object({
  params: publicTokenParams,
  body: z.object({
    qrCode: z.string().trim().min(1),
  }),
});

export const stocktakeArchiveSchema = z.object({
  params: uuidParam,
  body: z.object({
    force: z.coerce.boolean().optional(),
  }).optional(),
});
