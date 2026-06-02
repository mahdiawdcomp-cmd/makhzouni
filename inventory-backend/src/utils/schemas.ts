import { z } from "zod";

const uuidParam = z.object({
  id: z.string().uuid(),
});

const dateString = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid date",
  });

export const loginSchema = z.object({
  body: z.object({
    username: z.string().trim().min(1),
    password: z.string().min(1),
  }),
});

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
      isActive: z.boolean().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: "At least one field is required",
    }),
});

export const idParamSchema = z.object({
  params: uuidParam,
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
  }),
});

export const listAuditLogsSchema = z.object({
  query: z.object({
    userId: z.string().uuid().optional(),
    entity: z.string().trim().optional(),
    action: z.string().trim().optional(),
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
    openingBalance: z.coerce.number().default(0),
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
      openingBalance: z.coerce.number().optional(),
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
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
});

export const createProductSchema = z.object({
  body: z.object({
    // Only `name` is mandatory; everything else has sensible defaults or is auto-generated.
    name: z.string().trim().min(2),
    itemNumber: z.string().trim().optional(),
    qrCode: z.string().trim().optional(),
    cartonQrCode: z.string().trim().optional(),
    category: z.string().trim().optional(),
    openingBalancePcs: z.coerce.number().int().min(0).default(0),
    cartonsAvailable: z.coerce.number().int().min(0).default(0),
    pcsPerCarton: z.coerce.number().int().min(1).default(1),
    purchasePrice: z.coerce.number().nonnegative().default(0),
    salePrice: z.coerce.number().nonnegative().default(0),
    minStock: z.coerce.number().int().min(0).default(0),
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
    type: z.enum(["SALE", "PURCHASE"]).optional(),
    paymentType: z.enum(["CASH", "CREDIT", "PARTIAL"]).optional(),
    from: dateString.optional(),
    to: dateString.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
});

const invoiceItemSchema = z.object({
  productId: z.string().uuid(),
  unit: z.enum(["PIECE", "DOZEN", "CARTON"]),
  quantity: z.coerce.number().int().min(1),
  unitPrice: z.coerce.number().nonnegative().optional(),
});

export const createInvoiceSchema = z.object({
  body: z.object({
    customerId: z.string().uuid(),
    branchId: z.string().uuid().optional(),
    type: z.enum(["SALE", "PURCHASE"]).default("SALE"),
    date: dateString.optional(),
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
    type: z.enum(["SALE", "PURCHASE"]).optional(),
    date: dateString.optional(),
    discount: z.coerce.number().nonnegative().default(0),
    tax: z.coerce.number().nonnegative().default(0),
    paidAmount: z.coerce.number().nonnegative().default(0),
    paymentType: z.enum(["CASH", "CREDIT", "PARTIAL"]).optional(),
    items: z.array(invoiceItemSchema).min(1),
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
      date: dateString.optional(),
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
      date: dateString.optional(),
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
