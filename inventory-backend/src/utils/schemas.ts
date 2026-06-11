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

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(4),
  }),
});

export const createUserSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2),
    username: z.string().trim().min(3),
    password: z.string().min(4),
    role: z.enum(["ADMIN", "STAFF"]).default("STAFF"),
    permissions: z.array(userPermissionSchema).default([]),
    isActive: z.boolean().optional(),
  }),
});

export const updateUserSchema = z.object({
  params: uuidParam,
  body: z
    .object({
      name: z.string().trim().min(2).optional(),
      username: z.string().trim().min(3).optional(),
      password: z.string().min(4).optional(),
      role: z.enum(["ADMIN", "STAFF"]).optional(),
      permissions: z.array(userPermissionSchema).optional(),
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

export const createPortalLinkSchema = z.object({
  params: uuidParam,
  body: z.object({
    expiresInDays: z.coerce.number().int().min(1).max(365).default(30),
  }).partial().default({}),
});

const catalogOrderItemSchema = z.object({
  productId: z.string().uuid(),
  unit: z.enum(["PIECE", "DOZEN", "CARTON"]).default("PIECE"),
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
    items: z.array(catalogOrderItemSchema).min(1),
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
    includeDeleted: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
});

export const createCustomerSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2),
    phone: z.string().trim().min(5),
    address: z.string().trim().optional(),
    notes: z.string().trim().optional(),
    openingBalance: z.coerce.number().nonnegative().default(0),
    creditLimit: z.coerce.number().nonnegative().nullable().optional(),
    branchId: z.string().uuid().optional(),
    isSupplier: z.coerce.boolean().optional(),
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
      openingBalance: z.coerce.number().nonnegative().optional(),
      creditLimit: z.coerce.number().nonnegative().nullable().optional(),
      branchId: z.string().uuid().nullable().optional(),
      isSupplier: z.coerce.boolean().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: "At least one field is required",
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
    limit: z.coerce.number().int().min(1).max(2000).default(20),
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
    openingBalancePcs: z.coerce.number().int().min(0).default(0),
    cartonsAvailable: z.coerce.number().int().min(0).default(0),
    pcsPerCarton: z.coerce.number().int().min(1).default(1),
    purchasePrice: z.coerce.number().nonnegative().default(0),
    salePrice: z.coerce.number().nonnegative().default(0),
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
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
});

export const lastSoldPriceSchema = z.object({
  query: z.object({
    customerId: z.string().uuid(),
    productId: z.string().uuid(),
  }),
});

const invoiceItemSchema = z.object({
  productId: z.string().uuid(),
  unit: z.enum(["PIECE", "DOZEN", "CARTON"]),
  quantity: z.coerce.number().int().min(1),
  unitPrice: z.coerce.number().nonnegative().optional(),
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
    items: z.array(invoiceItemSchema).min(1),
  }),
});

export const updateInvoiceSchema = z.object({
  params: uuidParam,
  body: z.object({
    type: invoiceTypeSchema.optional(),
    originalInvoiceId: z.string().uuid().optional(),
    couponCode: z.string().trim().max(60).optional(),
    discount: z.coerce.number().nonnegative().default(0),
    tax: z.coerce.number().nonnegative().default(0),
    paidAmount: z.coerce.number().nonnegative().default(0),
    paymentType: z.enum(["CASH", "CREDIT", "PARTIAL"]).optional(),
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
    limit: z.coerce.number().int().min(1).max(100).default(20),
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
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
});

export const createVoucherSchema = z.object({
  body: z
    .object({
      // customerId is required for RECEIPT/PAYMENT and forbidden for EXPENSE (enforced below).
      customerId: z.string().uuid().optional(),
      branchId: z.string().uuid().optional(),
      amount: z.coerce.number().positive(),
      type: z.enum(["RECEIPT", "PAYMENT", "EXPENSE"]),
      notes: z.string().trim().optional(),
      // EXPENSE vouchers carry a short label (e.g. "أجور مولّدة"). Optional for the others.
      description: z.string().trim().optional(),
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
      notes: z.string().trim().optional(),
      description: z.string().trim().optional(),
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

export const customerDebtsReportSchema = z.object({
  query: z.object({
    minDays: z.coerce.number().int().min(0).default(0),
    maxDays: z.coerce.number().int().min(0).default(999),
    branchId: z.string().uuid().optional(),
  }),
});

export const sendWhatsAppSchema = z.object({
  body: z.object({
    phone: z.string().trim().min(5),
    message: z.string().trim().min(1),
  }),
});

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
      voucherTemplate: z.string().trim().optional(),
      statementTemplate: z.string().trim().optional(),
      themePreset: z.enum(["classic", "iraqi", "exclusive", "bold", "designer"]).optional(),
      backupWhatsappNumber: z.string().trim().optional(),
      catalogPublicUrl: z.string().trim().optional(),
      catalogAdminWhatsappNumber: z.string().trim().optional(),
      orderPreparationWhatsappNumbers: z.string().trim().optional(),
      autoSendDailySummary: z.boolean().optional(),
      dailySummaryWhatsappNumber: z.string().trim().optional(),
      dailySummaryHour: z.coerce.number().int().min(0).max(23).optional(),
      whatsappProvider: z.enum(["web", "cloud"]).optional(),
      whatsappCloudToken: z.string().trim().optional(),
      whatsappCloudPhoneNumberId: z.string().trim().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: "At least one setting is required",
    }),
});

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
