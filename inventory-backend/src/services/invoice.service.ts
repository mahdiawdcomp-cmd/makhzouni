import {
  InvoiceStatus,
  InvoiceType,
  PaymentType,
  Prisma,
  StockMovementType,
  Unit,
  VoucherType,
} from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import {
  amountInPieces,
  effectiveBoxPieces,
  calculateCustomerBalance,
  calculateInvoiceFinancials,
  invoiceBalanceSign,
  roundMoney,
} from "../utils/financial";
import {
  adjustWarehouseStock,
  ensureLegacyWarehouseStock,
  resolveShopWarehouseId,
  resolveWarehouseId,
  syncProductTotalStock,
} from "./warehouse-stock.service";
import { executeTransferWithin } from "./transfer.service";
import { createAppNotification, buildDedupeKey, notifyAdmin } from "./app-notification.service";
import {
  NotificationType,
  NotificationCategory,
  NotificationSeverity,
  NotificationRoleTarget,
} from "../constants/notifications";

type Db = Prisma.TransactionClient | typeof prisma;
type DecimalLike = Prisma.Decimal | number | string | null | undefined;

// Invoice write paths (create/update/cancel/reactivate/restore/delete) do a lot
// of per-item work (stock checks, warehouse upserts, movements, WAC) inside one
// transaction. Over a remote Postgres connection (Railway) a multi-item invoice
// routinely exceeds Prisma's 5s default interactive-transaction timeout and
// dies with P2028 — so every invoice transaction must use these options.
const INVOICE_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

// Fields actually needed for stock/cost math on the invoice write path.
// Deliberately excludes imageUrl/thumbnailUrl (base64 text, often 100s of KB):
// this runs once PER LINE ITEM on every invoice create/edit/cancel/reactivate,
// so a full `product: true` include there multiplies image payload by item count.
const STOCK_PRODUCT_SELECT = {
  id: true,
  name: true,
  itemNumber: true,
  deletedAt: true,
  branchId: true,
  pcsPerCarton: true,
  boxPieces: true,
  purchasePrice: true,
  salePrice: true,
  costPrice: true,
  openingBalancePcs: true,
  cartonsAvailable: true,
  storageLocation: true,
  minStock: true,
} satisfies Prisma.ProductSelect;

export interface ListInvoicesQuery {
  customerId?: string;
  status?: InvoiceStatus;
  type?: InvoiceType;
  paymentType?: PaymentType;
  branchId?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
}

export interface InvoiceItemInput {
  productId: string;
  warehouseId?: string;
  unit: Unit;
  quantity: number;
  unitPrice?: number;
  notes?: string;
  // Seller opted to sell while out of stock — allow the line to go negative and
  // flag it for manager review instead of blocking the sale.
  allowNegativeStock?: boolean;
}

export interface CreateInvoiceInput {
  customerId: string;
  type?: InvoiceType;
  date?: string;
  clientRequestId?: string;
  couponCode?: string;
  originalInvoiceId?: string;
  discount: number;
  tax: number;
  paidAmount: number;
  paymentType?: PaymentType;
  branchId?: string;
  notes?: string;
  items: InvoiceItemInput[];
}

function toNumber(value: DecimalLike) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function serializeInvoice(invoice: any) {
  return {
    ...invoice,
    subtotal: toNumber(invoice.subtotal),
    discount: toNumber(invoice.discount),
    tax: toNumber(invoice.tax),
    totalAmount: toNumber(invoice.totalAmount),
    paidAmount: toNumber(invoice.paidAmount),
    remainingAmount: toNumber(invoice.remainingAmount),
    previousBalance: toNumber(invoice.previousBalance),
    finalBalance: toNumber(invoice.finalBalance),
    items: invoice.items?.map((item: any) => ({
      ...item,
      unitPrice: toNumber(item.unitPrice),
      totalPrice: toNumber(item.totalPrice),
      warehouseName: item.warehouse?.name ?? null,
    })),
  };
}

function unitToPieces(unit: Unit, quantity: number, pcsPerCarton: number, boxPieces?: number | null) {
  return amountInPieces(unit, quantity, pcsPerCarton, boxPieces);
}

function defaultUnitPrice(unit: Unit, salePrice: DecimalLike, pcsPerCarton: number, boxPieces?: number | null) {
  const price = toNumber(salePrice);
  const n = Math.max(1, pcsPerCarton);
  if (unit === Unit.CARTON) return roundMoney(price * n);
  if (unit === Unit.BOX) return roundMoney(price * effectiveBoxPieces(n, boxPieces));
  if (unit === Unit.DOZEN) return roundMoney(price * 12);
  return roundMoney(price);
}

function isStockInflow(type: InvoiceType) {
  return type === InvoiceType.PURCHASE || type === InvoiceType.SALES_RETURN;
}

function productStock(product: {
  openingBalancePcs: number;
  cartonsAvailable: number;
  pcsPerCarton: number;
}) {
  return product.openingBalancePcs + product.cartonsAvailable * product.pcsPerCarton;
}

function normalizeStock(balanceInPieces: number, pcsPerCarton: number) {
  if (balanceInPieces < 0) {
    return { openingBalancePcs: balanceInPieces, cartonsAvailable: 0 };
  }

  if (pcsPerCarton <= 0) {
    return { openingBalancePcs: balanceInPieces, cartonsAvailable: 0 };
  }

  const cartonsAvailable = Math.floor(balanceInPieces / pcsPerCarton);
  return {
    openingBalancePcs: balanceInPieces - cartonsAvailable * pcsPerCarton,
    cartonsAvailable,
  };
}

function openingBalanceForStock(
  desiredStock: number,
  product: { cartonsAvailable: number; pcsPerCarton: number }
) {
  return desiredStock - product.cartonsAvailable * product.pcsPerCarton;
}

async function couponDiscount(
  tx: Db,
  code: string | undefined,
  subtotal: number
) {
  const normalizedCode = code?.trim().toUpperCase();
  if (!normalizedCode) return { couponId: null as string | null, discount: 0 };

  // Lock the coupon row so concurrent invoice creation cannot both pass the maxUses check.
  const [locked] = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "coupons" WHERE "code" = ${normalizedCode} FOR UPDATE
  `;
  if (!locked) throw new AppError("Coupon is not active", 400, "COUPON_INACTIVE");

  const coupon = await tx.coupon.findUnique({
    where: { id: locked.id },
    include: {
      // Only count redemptions still tied to a live invoice. Cancelled or
      // archived invoices free up their coupon use instead of consuming it.
      _count: {
        select: {
          redemptions: { where: { invoice: { status: InvoiceStatus.ACTIVE, archivedAt: null } } },
        },
      },
    },
  });

  const now = new Date();
  if (!coupon || !coupon.isActive) {
    throw new AppError("Coupon is not active", 400, "COUPON_INACTIVE");
  }
  if (coupon.startsAt && coupon.startsAt > now) {
    throw new AppError("Coupon has not started yet", 400, "COUPON_NOT_STARTED");
  }
  if (coupon.endsAt && coupon.endsAt < now) {
    throw new AppError("Coupon has expired", 400, "COUPON_EXPIRED");
  }
  if (coupon.maxUses !== null && coupon._count.redemptions >= coupon.maxUses) {
    throw new AppError("Coupon usage limit reached", 400, "COUPON_LIMIT_REACHED");
  }

  const raw =
    coupon.discountType === "PERCENT"
      ? subtotal * (toNumber(coupon.discountValue) / 100)
      : toNumber(coupon.discountValue);

  return {
    couponId: coupon.id,
    discount: roundMoney(Math.min(subtotal, Math.max(0, raw))),
  };
}

async function generateInvoiceNumber(tx: Db, date: Date) {
  const year = date.getFullYear();
  const counterKey = `invoice-${year}`;

  // Atomic increment using the Counter table — avoids text-sort race condition
  // that would fail after 9999 invoices/year.
  for (let attempt = 0; attempt < 50; attempt++) {
    const counter = await tx.counter.upsert({
      where: { key: counterKey },
      update: { value: { increment: 1 } },
      create: { key: counterKey, value: 1 },
    });
    const candidate = `INV-${year}-${String(counter.value).padStart(4, "0")}`;
    const exists = await tx.invoice.findUnique({
      where: { invoiceNumber: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }

  throw new AppError("Could not generate a unique invoice number", 409, "INVOICE_NUMBER_CONFLICT");
}

function getDateFilter(from?: string, to?: string) {
  const date: Prisma.DateTimeFilter = {};
  if (from) date.gte = new Date(from);
  if (to) {
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);
    date.lte = toDate;
  }
  return Object.keys(date).length ? date : undefined;
}

async function lockCustomer(tx: Db, customerId: string) {
  await tx.$queryRaw`SELECT "id" FROM "customers" WHERE "id" = ${customerId}::uuid FOR UPDATE`;
}

async function getCustomerBalance(tx: Db, customerId: string) {
  await lockCustomer(tx, customerId);

  const customer = await tx.customer.findFirst({
    where: { id: customerId, deletedAt: null },
  });

  if (!customer) {
    throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
  }

  return {
    customer,
    previousBalance: toNumber(customer.currentBalance),
  };
}

async function recalculateCustomerBalanceInTransaction(tx: Db, customerId: string) {
  await lockCustomer(tx, customerId);

  const customer = await tx.customer.findFirst({
    where: { id: customerId },
  });

  if (!customer) {
    throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
  }

  const [saleTotals, creditInvoiceTotals, receiptTotals, paymentTotals, lastInvoice, lastVoucher] = await Promise.all([
    tx.invoice.aggregate({
      where: { customerId, status: InvoiceStatus.ACTIVE, type: InvoiceType.SALE },
      _sum: { remainingAmount: true },
    }),
    tx.invoice.aggregate({
      where: { customerId, status: InvoiceStatus.ACTIVE, type: { in: [InvoiceType.PURCHASE, InvoiceType.SALES_RETURN] } },
      _sum: { remainingAmount: true },
    }),
    tx.paymentVoucher.aggregate({
      where: { customerId, type: VoucherType.RECEIPT, archivedAt: null, cancelledAt: null },
      _sum: { amount: true },
    }),
    tx.paymentVoucher.aggregate({
      where: { customerId, type: VoucherType.PAYMENT, archivedAt: null, cancelledAt: null },
      _sum: { amount: true },
    }),
    tx.invoice.findFirst({
      where: { customerId, status: InvoiceStatus.ACTIVE, archivedAt: null },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    tx.paymentVoucher.findFirst({
      where: { customerId, archivedAt: null, cancelledAt: null },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  // Sign convention: positive = the customer owes US, negative = WE owe the customer (supplier).
  //   SALE invoice remaining → +ve (customer owes us)
  //   PURCHASE invoice remaining → -ve (we owe supplier)
  //   RECEIPT voucher → -ve (we received money from customer, reduces their debt)
  //   PAYMENT voucher → +ve (we paid customer, increases what they owe… or reduces our debt to supplier)
  const currentBalance = calculateCustomerBalance({
    openingBalance: toNumber(customer.openingBalance),
    salesRemaining: toNumber(saleTotals._sum.remainingAmount),
    purchasesRemaining: toNumber(creditInvoiceTotals._sum.remainingAmount),
    receipts: toNumber(receiptTotals._sum.amount),
    payments: toNumber(paymentTotals._sum.amount),
  });

  const lastTransactionAt =
    lastInvoice && lastVoucher
      ? lastInvoice.date > lastVoucher.date
        ? lastInvoice.date
        : lastVoucher.date
      : lastInvoice?.date ?? lastVoucher?.date ?? null;

  await tx.customer.update({
    where: { id: customerId },
    data: { currentBalance, lastTransactionAt },
  });

  return currentBalance;
}

async function applyStockMovement(
  tx: Db,
  invoiceId: string,
  item: InvoiceItemInput,
  invoiceType: InvoiceType,
  branchId?: string | null,
  createdBy = "system",
  isEdit = false
) {
  const product = await tx.product.findUnique({
    where: { id: item.productId },
    select: STOCK_PRODUCT_SELECT,
  });

  if (!product || product.deletedAt) {
    throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
  }

  await ensureLegacyWarehouseStock(tx, product);
  const isSale = invoiceType === InvoiceType.SALE;
  const quantityInPieces = unitToPieces(item.unit, item.quantity, product.pcsPerCarton, product.boxPieces);
  const addsStock = isStockInflow(invoiceType);
  // When the seller explicitly opted in (allowNegativeStock) on a NEW sale, or this
  // is an EDIT to an existing sale (by product decision edits never require the
  // opt-in — see the audit-log/notification block below), skip the block and let
  // the line go negative — the deficit is settled automatically when stock next arrives.
  const allowNegativeSale = isSale && (Boolean(item.allowNegativeStock) || isEdit);

  // Sales always come out of المحل. If the line names a different warehouse (the
  // seller pulled from a depot), AUTO-TRANSFER that quantity من المخزن → المحل
  // first — recorded as a real transfer — then deduct the sale from المحل. So a
  // depot pull leaves a proper transfer trail instead of a silent depot sale.
  let warehouseId: string;
  // A depot pull whose source warehouse fully covered the quantity: the sale is
  // funded by the auto-transfer, so the shop pre-check below must NOT re-block it
  // (an OLD shop deficit would swallow part of the transferred pieces and make the
  // shop ledger look short even though the chosen depot had the full amount).
  let depotCoveredSale = false;
  if (isSale) {
    const shopId = await resolveShopWarehouseId(tx);
    const requestedId = item.warehouseId ? await resolveWarehouseId(tx, item.warehouseId) : shopId;
    if (requestedId !== shopId) {
      if (!allowNegativeSale) {
        const depotStock = await tx.productWarehouseStock.findUnique({
          where: { productId_warehouseId: { productId: product.id, warehouseId: requestedId } },
          select: { quantityPieces: true },
        });
        const available = Number(depotStock?.quantityPieces ?? 0);
        if (quantityInPieces > available) {
          const wh = await tx.branch.findUnique({ where: { id: requestedId }, select: { name: true } });
          throw new AppError(
            `${wh?.name ?? "المخزن"} يحتوي فقط على ${available} قطعة من "${product.name}". قلّل الكمية أو أضف مخزون للمادة.`,
            409,
            "INSUFFICIENT_SHOP_STOCK"
          );
        }
        depotCoveredSale = true;
      }
      await executeTransferWithin(
        tx,
        {
          fromBranchId: requestedId,
          toBranchId: shopId,
          items: [{ productId: product.id, unit: item.unit, quantity: item.quantity }],
          notes: "تحويل تلقائي للبيع",
        },
        createdBy,
        allowNegativeSale
      );
    }
    warehouseId = shopId;
  } else if (invoiceType === InvoiceType.SALES_RETURN && !item.warehouseId) {
    // A return with no explicit warehouse restocks المحل (the mirror of "sales
    // always come out of المحل") — never the legacy branch chain, whose final
    // fallback is the OLDEST warehouse and may be a depot like شارع العباس.
    warehouseId = await resolveShopWarehouseId(tx);
  } else {
    warehouseId = await resolveWarehouseId(tx, item.warehouseId ?? branchId ?? product.branchId);
  }

  // Pre-check المحل stock so the user gets a clear Arabic message instead of a generic DB error.
  if (isSale && !allowNegativeSale && !depotCoveredSale) {
    const whStock = await tx.productWarehouseStock.findUnique({
      where: { productId_warehouseId: { productId: product.id, warehouseId } },
      select: { quantityPieces: true },
    });
    const available = Number(whStock?.quantityPieces ?? 0);
    if (quantityInPieces > available) {
      const wh = await tx.branch.findUnique({ where: { id: warehouseId }, select: { name: true } });
      const whName = wh?.name ?? "المخزن";
      throw new AppError(
        `${whName} يحتوي فقط على ${available} قطعة من "${product.name}". قلّل الكمية أو أضف مخزون للمادة.`,
        409,
        "INSUFFICIENT_SHOP_STOCK"
      );
    }
  }

  // PURCHASE only: snapshot the product's TOTAL pieces across all warehouses
  // BEFORE this purchase line lands, so the weighted-average cost blends the old
  // stock (at old cost) with the newly-purchased stock (at the new unit cost).
  let purchaseQtyBefore = 0;
  if (invoiceType === InvoiceType.PURCHASE) {
    const agg = await tx.productWarehouseStock.aggregate({
      where: { productId: product.id },
      _sum: { quantityPieces: true },
    });
    purchaseQtyBefore = Number(agg._sum.quantityPieces ?? 0);
  }

  const movement = await adjustWarehouseStock(tx, {
    productId: product.id,
    warehouseId,
    // depotCoveredSale: the ledger may still dip below zero here when an OLD shop
    // deficit swallows part of the just-transferred pieces — that deficit belongs
    // to its original invoice, not this one, so the deduction must not be blocked.
    allowNegative: isSale ? allowNegativeSale || depotCoveredSale : !addsStock,
    deltaPieces: addsStock ? quantityInPieces : -quantityInPieces,
  });
  await syncProductTotalStock(tx, product.id);
  // A SALE line that ended below zero is a recorded shortage to surface for review.
  // Only count the deficit this line CREATED (balance drop below the pre-line
  // level), not an old deficit that was already pending — otherwise a fully-funded
  // depot pull on a shop with an old shortage would re-flag the same deficit.
  const deficitPieces =
    movement.balanceAfter < 0 ? Math.min(-movement.balanceAfter, quantityInPieces) : 0;
  const wentNegative = isSale && deficitPieces > 0 && !depotCoveredSale;

  // Normalize carton / piece split so the display always reflects reality.
  // If stock is negative we keep cartonsAvailable = 0 and openingBalancePcs carries the deficit.
  await tx.stockMovement.create({
    data: {
      productId: product.id,
      branchId: warehouseId,
      invoiceId,
      type: addsStock ? StockMovementType.IN : StockMovementType.OUT,
      quantity: quantityInPieces,
      balanceBefore: movement.balanceBefore,
      balanceAfter: movement.balanceAfter,
    },
  });

  // Default unit price: SALE/SALES_RETURN use sale price; PURCHASE uses purchase price.
  const defaultPriceSource = invoiceType === InvoiceType.PURCHASE ? product.purchasePrice : product.salePrice;
  // For PURCHASE, treat an explicit 0 / negative the SAME as "missing" and fall back to the
  // product's purchase price. A real purchase line is never priced at 0; a stray 0 (e.g. a new
  // product whose purchasePrice still defaults to 0, pre-filled into the edit form) would flow
  // into the WAC formula below and SILENTLY zero out costPrice/purchasePrice. `??` alone does not
  // catch 0. SALE keeps an explicit 0 as-is (a deliberately free/gift line is valid).
  const rawUnitPrice = item.unitPrice;
  const effectiveRawUnitPrice =
    invoiceType === InvoiceType.PURCHASE && (rawUnitPrice == null || rawUnitPrice <= 0)
      ? undefined
      : rawUnitPrice;
  const unitPrice =
    effectiveRawUnitPrice ?? defaultUnitPrice(item.unit, defaultPriceSource, product.pcsPerCarton, product.boxPieces);

  // Hard guard: a PURCHASE line must carry a positive price. If neither the request nor the
  // product's own purchase price yields one, reject the save with a clear message instead of
  // letting the WAC recompute corrupt the product cost to zero.
  if (invoiceType === InvoiceType.PURCHASE && !(unitPrice > 0)) {
    throw new AppError(
      `سعر الشراء مطلوب للمادة "${product.name}" — لا يمكن حفظ سطر فاتورة شراء بسعر صفر أو سالب.`,
      400,
      "PURCHASE_PRICE_REQUIRED"
    );
  }

  // PURCHASE only: roll the product cost forward by Weighted-Average Cost (WAC),
  // and record the latest purchase unit cost into purchasePrice. The SALE path is
  // untouched: sale profit reads costPrice through the report layer (current value),
  // while OLD sale invoices keep their own frozen invoiceItem.costPrice snapshot.
  // Variety products have no special handling here — their cost is only ever
  // re-averaged by convertToVariety, a path that never runs through purchases.
  // Cost to freeze onto the invoice line. For SALE/others this is the product's
  // current cost (unchanged). For PURCHASE it is updated below to the POST-WAC
  // blended cost so the line reflects the cost as-of after this purchase, not the
  // stale pre-purchase value.
  let costSnapshot =
    toNumber(product.costPrice) > 0 ? toNumber(product.costPrice) : toNumber(product.purchasePrice);

  if (invoiceType === InvoiceType.PURCHASE && quantityInPieces > 0) {
    const currentCost =
      toNumber(product.costPrice) > 0
        ? toNumber(product.costPrice)
        : toNumber(product.purchasePrice);
    // Per-piece cost of this purchase line, unit-agnostic (carton/dozen/piece).
    const newUnitCostPerPiece = (unitPrice * item.quantity) / quantityInPieces;
    const currentQty = purchaseQtyBefore;
    const denom = currentQty + quantityInPieces;
    const newCostPrice =
      denom > 0
        ? roundMoney((currentQty * currentCost + quantityInPieces * newUnitCostPerPiece) / denom)
        : currentCost;
    await tx.product.update({
      where: { id: product.id },
      data: {
        costPrice: newCostPrice,
        purchasePrice: roundMoney(newUnitCostPerPiece),
      },
    });
    costSnapshot = newCostPrice;
  }

  return {
    product,
    warehouseId,
    quantityInPieces,
    unitPrice,
    totalPrice: roundMoney(unitPrice * item.quantity),
    wentNegative,
    deficitPieces,
    costSnapshot,
  };
}

async function adjustProductStock(
  tx: Db,
  productId: string,
  quantityInPieces: number,
  direction: "IN" | "OUT",
  warehouseId?: string | null
) {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: STOCK_PRODUCT_SELECT,
  });

  if (!product) return;

  await ensureLegacyWarehouseStock(tx, product);
  const resolvedWarehouseId = await resolveWarehouseId(tx, warehouseId ?? product.branchId);
  await adjustWarehouseStock(tx, {
    productId,
    warehouseId: resolvedWarehouseId,
    deltaPieces: direction === "IN" ? quantityInPieces : -quantityInPieces,
    allowNegative: true,
  });
  await syncProductTotalStock(tx, productId);
}

// Inverse of the WAC blend in applyStockMovement. Removing a purchase of `q`
// pieces whose total cost was `lineTotalCost` (so per-piece cost c = lineTotalCost/q)
// restores the pre-purchase average from the current state:
//   costBefore = (Qnow*costNow − q*c) / (Qnow − q)
// which is exactly the algebraic reverse of
//   costNow = (Qbefore*costBefore + q*c) / (Qbefore + q).
// If the remaining stock no longer covers this purchase (Qnow ≤ q, e.g. the goods
// were already sold/lost/transferred out) an exact restore is impossible, so we
// leave costPrice untouched rather than corrupt it further. purchasePrice ("last
// purchase price" metadata) is not restored — it does not feed valuation.
async function reversePurchaseWacCost(
  tx: Db,
  productId: string,
  quantityInPieces: number,
  lineTotalCost: number
) {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { costPrice: true, purchasePrice: true },
  });
  if (!product) return;
  const agg = await tx.productWarehouseStock.aggregate({
    where: { productId },
    _sum: { quantityPieces: true },
  });
  const qNow = Number(agg._sum.quantityPieces ?? 0);
  const qBefore = qNow - quantityInPieces;
  if (qBefore <= 0) return;
  const costNow =
    toNumber(product.costPrice) > 0 ? toNumber(product.costPrice) : toNumber(product.purchasePrice);
  const c = lineTotalCost / quantityInPieces;
  const costBefore = roundMoney((qNow * costNow - quantityInPieces * c) / qBefore);
  if (!(costBefore > 0)) return;
  await tx.product.update({
    where: { id: productId },
    data: { costPrice: costBefore },
  });
}

async function reverseInvoiceItemsStock(tx: Db, invoiceId: string, returnWarehouseId?: string) {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      items: {
        include: { product: { select: { pcsPerCarton: true, boxPieces: true } } },
      },
    },
  });

  if (!invoice) {
    throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
  }

  // Sales always come out of المحل, so reverse them straight back INTO المحل —
  // even for legacy invoices whose stored line warehouse points at a depot or is
  // null. Crediting that stale warehouse instead would restock the wrong place
  // and then trigger a false "نقص مخزون" (409) when the invoice is re-applied.
  let saleWarehouseId: string | null = null;
  if (invoice.type === InvoiceType.SALE) {
    if (returnWarehouseId) {
      const warehouse = await tx.branch.findUnique({ where: { id: returnWarehouseId } });
      if (!warehouse) {
        throw new AppError("المخزن المحدد غير موجود", 400, "WAREHOUSE_NOT_FOUND");
      }
      saleWarehouseId = warehouse.id;
    } else {
      saleWarehouseId = await resolveShopWarehouseId(tx);
    }
  }

  for (const item of invoice.items) {
    const quantityInPieces = unitToPieces(item.unit, item.quantity, item.product.pcsPerCarton, item.product.boxPieces);
    // PURCHASE reversal: back this line's pieces out of the product's
    // Weighted-Average Cost BEFORE we remove the stock, otherwise a mistaken
    // purchase (e.g. a typo'd unit cost) would permanently inflate costPrice —
    // which feeds inventory valuation and frozen loss snapshots. Done per-item
    // and pre-adjustment so it uses the qty that still includes this purchase.
    if (invoice.type === InvoiceType.PURCHASE && quantityInPieces > 0) {
      await reversePurchaseWacCost(tx, item.productId, quantityInPieces, Number(item.unitPrice) * item.quantity);
    }
    await adjustProductStock(
      tx,
      item.productId,
      quantityInPieces,
      isStockInflow(invoice.type) ? "OUT" : "IN",
      invoice.type === InvoiceType.SALE ? saleWarehouseId : item.warehouseId
    );
  }

  await tx.stockMovement.deleteMany({ where: { invoiceId } });
}

async function applyInvoiceItemsStock(tx: Db, invoiceId: string) {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: { items: true },
  });

  if (!invoice) {
    throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
  }

  await tx.stockMovement.deleteMany({ where: { invoiceId } });

  for (const item of invoice.items) {
    await applyStockMovement(
      tx,
      invoice.id,
      {
        productId: item.productId,
        // Re-applying a SALE always deducts from المحل — drop any stale line
        // warehouse so it never re-triggers an auto-transfer from an empty depot
        // (the mirror of the shop-based reversal above). Purchases/returns keep
        // their own stored warehouse.
        warehouseId:
          invoice.type === InvoiceType.SALE ? undefined : (item.warehouseId ?? undefined),
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: toNumber(item.unitPrice),
      },
      invoice.type,
      invoice.branchId,
      invoice.createdBy ?? "system",
      // Trusted re-apply (reactivate / restore-from-archive): the sale already
      // happened once, so re-applying must never 409 on today's shop level —
      // like edits, it may dip negative and the deficit settles on next arrival.
      true
    );
  }
}

async function recalculateInvoiceBalances(tx: Db, invoiceId: string) {
  const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });

  if (!invoice) {
    throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
  }

  const { previousBalance } = await getCustomerBalance(tx, invoice.customerId);
  const balanceDelta = roundMoney(
    invoiceBalanceSign(invoice.type) * toNumber(invoice.remainingAmount)
  );

  const updated = await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      previousBalance,
      finalBalance: roundMoney(previousBalance + balanceDelta),
    },
    include: {
      customer: true,
      items: true,
      creator: {
        select: { id: true, name: true, username: true, role: true },
      },
    },
  });

  await recalculateCustomerBalanceInTransaction(tx, invoice.customerId);

  return serializeInvoice(updated);
}

const UNIT_LABELS_AR: Record<Unit, string> = {
  [Unit.PIECE]: "قطعة",
  [Unit.DOZEN]: "درزن",
  [Unit.BOX]: "علبة",
  [Unit.CARTON]: "كرتون",
};

// Soft-deleted units are blocked on NEW invoice lines only. Lines that already
// existed on the invoice (edit flow) keep working via allowedUnitPairs, and
// reactivate/restore never pass through here at all.
async function assertUnitsNotHidden(
  tx: Db,
  items: InvoiceItemInput[],
  allowedUnitPairs?: Set<string>
) {
  for (const item of items) {
    const unit = item.unit as Unit;
    if (unit === Unit.PIECE) continue;
    if (allowedUnitPairs?.has(`${item.productId}:${unit}`)) continue;
    const product = await tx.product.findUnique({
      where: { id: item.productId },
      select: { name: true, hiddenUnits: true },
    });
    if (product?.hiddenUnits?.includes(unit)) {
      throw new AppError(
        `وحدة «${UNIT_LABELS_AR[unit]}» معطلة للمادة «${product.name}» — اختر وحدة أخرى`,
        400,
        "UNIT_HIDDEN"
      );
    }
  }
}

async function createInvoiceInTransaction(
  tx: Db,
  input: CreateInvoiceInput,
  createdBy: string,
  existingInvoiceId?: string,
  existingInvoiceNumber?: string,
  allowedUnitPairs?: Set<string>
) {
  const invoiceType = input.type ?? InvoiceType.SALE;
  await assertUnitsNotHidden(tx, input.items, allowedUnitPairs);
  const existingInvoice = existingInvoiceId
    ? await tx.invoice.findUnique({
        where: { id: existingInvoiceId },
        // date drives the invoice date; createdAt/paidAmount/customerId let the
        // update notification flag an old-invoice edit, a paid-amount change, or a
        // customer swap (read-only enrichment — no calculation is affected).
        select: { date: true, createdAt: true, paidAmount: true, customerId: true },
      })
    : null;
  const date = existingInvoice?.date ?? (input.date ? new Date(input.date) : new Date());
  const manualDiscount = input.discount ?? 0;
  const tax = input.tax ?? 0;

  if (!existingInvoiceId && input.clientRequestId) {
    const existing = await tx.invoice.findUnique({
      where: { clientRequestId: input.clientRequestId },
      include: {
        customer: true,
        items: true,
        creator: {
          select: { id: true, name: true, username: true, role: true },
        },
      },
    });

    if (existing) {
      return serializeInvoice(existing);
    }
  }

  const { customer, previousBalance } = await getCustomerBalance(tx, input.customerId);
  const branchId = input.branchId ?? customer.branchId;
  const invoiceNumber =
    existingInvoiceNumber ?? (await generateInvoiceNumber(tx, date));

  const invoice = existingInvoiceId
    ? await tx.invoice.update({
        where: { id: existingInvoiceId },
        data: {
          type: invoiceType,
          customerId: input.customerId,
          branchId,
          date,
          subtotal: 0,
          discount: manualDiscount,
          tax,
          totalAmount: 0,
          paidAmount: input.paidAmount,
          remainingAmount: 0,
          previousBalance,
          finalBalance: previousBalance,
          paymentType: input.paymentType ?? PaymentType.CREDIT,
          couponId: null,
          originalInvoiceId: input.originalInvoiceId,
          notes: input.notes?.trim() || null,
        },
      })
    : await tx.invoice.create({
        data: {
          invoiceNumber,
          type: invoiceType,
          customerId: input.customerId,
          branchId,
          date,
          subtotal: 0,
          discount: manualDiscount,
          tax,
          totalAmount: 0,
          paidAmount: input.paidAmount,
          remainingAmount: 0,
          previousBalance,
          finalBalance: previousBalance,
          paymentType: input.paymentType ?? PaymentType.CREDIT,
          clientRequestId: input.clientRequestId,
          originalInvoiceId: input.originalInvoiceId,
          notes: input.notes?.trim() || null,
          createdBy,
        },
      });

  let subtotal = 0;
  const negativeLines: Array<{
    productId: string;
    productName: string;
    warehouseId: string;
    quantityPieces: number;
    deficitPieces: number;
  }> = [];
  // SALE lines priced below their (frozen) cost — collected for a manager audit
  // log. WARNING/LOG ONLY: it never blocks the save and never queues an approval.
  const belowCostLines: Array<{
    productId: string;
    productName: string;
    unitPrice: number;
    lineCost: number;
    totalPrice: number;
    costPerPiece: number;
    quantityPieces: number;
  }> = [];

  for (const item of input.items) {
    const pricedItem = await applyStockMovement(tx, invoice.id, item, invoiceType, branchId, createdBy, Boolean(existingInvoiceId));
    subtotal = roundMoney(subtotal + pricedItem.totalPrice);

    if (pricedItem.wentNegative) {
      negativeLines.push({
        productId: pricedItem.product.id,
        productName: pricedItem.product.name,
        warehouseId: pricedItem.warehouseId,
        quantityPieces: pricedItem.quantityInPieces,
        deficitPieces: pricedItem.deficitPieces,
      });
    }

    // Below-cost detection: compare line revenue against line cost (per-piece
    // frozen cost × pieces). Only meaningful for SALE and when a cost is known.
    if (invoiceType === InvoiceType.SALE && pricedItem.costSnapshot > 0) {
      const lineCost = roundMoney(pricedItem.costSnapshot * pricedItem.quantityInPieces);
      if (pricedItem.totalPrice < lineCost) {
        belowCostLines.push({
          productId: pricedItem.product.id,
          productName: pricedItem.product.name,
          unitPrice: pricedItem.unitPrice,
          lineCost,
          totalPrice: pricedItem.totalPrice,
          costPerPiece: pricedItem.costSnapshot,
          quantityPieces: pricedItem.quantityInPieces,
        });
      }
    }

    await tx.invoiceItem.create({
      data: {
        invoiceId: invoice.id,
        productId: pricedItem.product.id,
        warehouseId: pricedItem.warehouseId,
        productName: pricedItem.product.name,
        itemNumber: pricedItem.product.itemNumber,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: pricedItem.unitPrice,
        // Post-WAC cost for PURCHASE lines; current product cost for SALE lines.
        costPrice: pricedItem.costSnapshot,
        totalPrice: pricedItem.totalPrice,
        notes: item.notes?.trim() || null,
      },
    });
  }

  const coupon = await couponDiscount(tx, input.couponCode, subtotal);
  const discount = roundMoney(coupon.couponId ? coupon.discount : manualDiscount);
  const financials = calculateInvoiceFinancials({
    type: invoiceType,
    subtotal,
    discount,
    tax,
    paidAmount: input.paidAmount,
    previousBalance,
  });
  if (financials.totalAmount < 0) {
    throw new AppError(
      "Invoice discount cannot be greater than subtotal plus tax",
      400,
      "INVALID_INVOICE_TOTAL"
    );
  }
  if (financials.overpayment > 0) {
    throw new AppError(
      "Paid amount cannot exceed invoice total; record any extra amount as a separate receipt",
      400,
      "PAID_AMOUNT_EXCEEDS_TOTAL"
    );
  }

  const { totalAmount, paidAmount, remainingAmount, finalBalance } = financials;
  const paymentType = financials.paymentType as PaymentType;

  // Credit limit check — only for SALE invoices with outstanding balance
  if (invoiceType === InvoiceType.SALE && remainingAmount > 0) {
    const creditLimit = customer.creditLimit ? toNumber(customer.creditLimit) : null;
    if (creditLimit !== null) {
      const newBalance = previousBalance + remainingAmount;
      if (newBalance > creditLimit) {
        throw new AppError(
          `تجاوز حد الائتمان للزبون. الحد المسموح: ${creditLimit.toLocaleString("en-US")}, الرصيد الجديد سيكون: ${newBalance.toLocaleString("en-US")}`,
          400,
          "CREDIT_LIMIT_EXCEEDED"
        );
      }
    }
  }

  const updatedInvoice = await tx.invoice.update({
    where: { id: invoice.id },
    data: {
      subtotal,
      discount,
      tax: financials.tax,
      totalAmount,
      paidAmount,
      remainingAmount,
      previousBalance,
      finalBalance,
      paymentType,
      branchId,
      couponId: coupon.couponId,
      ...(existingInvoiceId ? {} : { createdBy }),
    },
    include: {
      customer: true,
      items: true,
      creator: {
        select: { id: true, name: true, username: true, role: true },
      },
    },
  });

  await tx.couponRedemption.deleteMany({ where: { invoiceId: invoice.id } });
  if (coupon.couponId && discount > 0) {
    await tx.couponRedemption.create({
      data: {
        couponId: coupon.couponId,
        invoiceId: invoice.id,
        customerId: input.customerId,
        amount: discount,
      },
    });
  }

  await recalculateCustomerBalanceInTransaction(tx, input.customerId);

  // Negative-stock review: a new SALE that pushed any product below zero is logged
  // as a pending approval so the manager sees exactly which goods are short and on
  // which invoice. The deficit itself is settled automatically when stock arrives.
  if (invoiceType === InvoiceType.SALE && !existingInvoiceId && negativeLines.length > 0) {
    const whNames = await tx.branch.findMany({
      where: { id: { in: [...new Set(negativeLines.map((l) => l.warehouseId))] } },
      select: { id: true, name: true },
    });
    const nameById = new Map(whNames.map((w) => [w.id, w.name]));
    await tx.pendingApproval.create({
      data: {
        requestType: "NEGATIVE_STOCK_SALE",
        requestData: {
          invoiceId: updatedInvoice.id,
          invoiceNumber: updatedInvoice.invoiceNumber,
          customerName: updatedInvoice.customer?.name ?? null,
          lines: negativeLines.map((l) => ({
            ...l,
            warehouseName: nameById.get(l.warehouseId) ?? "",
          })),
        } as Prisma.InputJsonValue,
        requestedBy: createdBy,
      },
    });

    // Manager-only IMPORTANT notification per shorted line (does NOT block the
    // sale — the approval above is acknowledge-only). Deduped per invoice+product+
    // warehouse+day so re-saves don't spam.
    for (const l of negativeLines) {
      const warehouseName = nameById.get(l.warehouseId) ?? "";
      const availableQuantity = l.quantityPieces - l.deficitPieces;
      await createAppNotification(
        {
          type: NotificationType.NEGATIVE_STOCK_SALE,
          category: NotificationCategory.NEGATIVE_SALE,
          severity: NotificationSeverity.IMPORTANT,
          roleTarget: NotificationRoleTarget.ADMIN,
          title: "بيع يسبب مخزون سالب",
          message:
            `فاتورة ${updatedInvoice.invoiceNumber} — ${l.productName} في ${warehouseName}: ` +
            `طُلب ${l.quantityPieces} قطعة والمتوفر ${availableQuantity}، عجز ${l.deficitPieces}`,
          entityType: "INVOICE",
          entityId: updatedInvoice.id,
          actionUrl: `/invoices/${updatedInvoice.id}`,
          metadata: {
            invoiceId: updatedInvoice.id,
            invoiceNumber: updatedInvoice.invoiceNumber,
            productId: l.productId,
            productName: l.productName,
            warehouseId: l.warehouseId,
            warehouseName,
            requestedQuantity: l.quantityPieces,
            availableQuantity,
            deficitPieces: l.deficitPieces,
            userId: createdBy,
            customerId: input.customerId,
          },
          dedupeKey: buildDedupeKey(
            NotificationType.NEGATIVE_STOCK_SALE,
            `${updatedInvoice.id}:${l.productId}:${l.warehouseId}`,
          ),
        },
        tx,
      );
    }
  }

  // EDIT that drives stock negative: by product decision this does NOT require an
  // approval (unlike a brand-new negative sale above). Instead we LOG it to the
  // audit trail so the manager still has visibility, without gating the edit.
  if (invoiceType === InvoiceType.SALE && existingInvoiceId && negativeLines.length > 0) {
    const whNames = await tx.branch.findMany({
      where: { id: { in: [...new Set(negativeLines.map((l) => l.warehouseId))] } },
      select: { id: true, name: true },
    });
    const nameById = new Map(whNames.map((w) => [w.id, w.name]));
    await tx.auditLog.create({
      data: {
        userId: createdBy,
        action: "NEGATIVE_STOCK_ON_EDIT",
        entity: "Invoice",
        recordId: updatedInvoice.id,
        metadata: {
          invoiceNumber: updatedInvoice.invoiceNumber,
          customerName: updatedInvoice.customer?.name ?? null,
          lines: negativeLines.map((l) => ({ ...l, warehouseName: nameById.get(l.warehouseId) ?? "" })),
        } as Prisma.InputJsonValue,
      },
    });

    // Manager-only IMPORTANT notification for an edit that drove stock negative.
    // Does NOT block the edit (matches the audit-log-only decision above).
    for (const l of negativeLines) {
      const warehouseName = nameById.get(l.warehouseId) ?? "";
      const availableQuantity = l.quantityPieces - l.deficitPieces;
      await createAppNotification(
        {
          type: NotificationType.NEGATIVE_STOCK_ON_EDIT,
          category: NotificationCategory.NEGATIVE_SALE,
          severity: NotificationSeverity.IMPORTANT,
          roleTarget: NotificationRoleTarget.ADMIN,
          title: "تعديل فاتورة سبب مخزون سالب",
          message:
            `تعديل فاتورة ${updatedInvoice.invoiceNumber} — ${l.productName} في ${warehouseName}: ` +
            `طُلب ${l.quantityPieces} قطعة والمتوفر ${availableQuantity}، عجز ${l.deficitPieces}`,
          entityType: "INVOICE",
          entityId: updatedInvoice.id,
          actionUrl: `/invoices/${updatedInvoice.id}`,
          metadata: {
            invoiceId: updatedInvoice.id,
            invoiceNumber: updatedInvoice.invoiceNumber,
            productId: l.productId,
            productName: l.productName,
            warehouseId: l.warehouseId,
            warehouseName,
            requestedQuantity: l.quantityPieces,
            availableQuantity,
            deficitPieces: l.deficitPieces,
            userId: createdBy,
            customerId: input.customerId,
          },
          dedupeKey: buildDedupeKey(
            NotificationType.NEGATIVE_STOCK_ON_EDIT,
            `${updatedInvoice.id}:${l.productId}:${l.warehouseId}`,
          ),
        },
        tx,
      );
    }
  }

  // Below-cost SALE lines: log for manager review (warning only — never blocks the
  // save and never queues an approval). Applies to both new invoices and edits.
  if (invoiceType === InvoiceType.SALE && belowCostLines.length > 0) {
    await tx.auditLog.create({
      data: {
        userId: createdBy,
        action: "BELOW_COST_SALE",
        entity: "Invoice",
        recordId: updatedInvoice.id,
        metadata: {
          invoiceNumber: updatedInvoice.invoiceNumber,
          customerName: updatedInvoice.customer?.name ?? null,
          isEdit: Boolean(existingInvoiceId),
          lines: belowCostLines,
        } as Prisma.InputJsonValue,
      },
    });

    // Manager-only IMPORTANT notification per below-cost line (never blocks the
    // save). Deduped per invoice+product+day.
    for (const l of belowCostLines) {
      const totalLoss = roundMoney(l.lineCost - l.totalPrice);
      await createAppNotification(
        {
          type: NotificationType.BELOW_COST_SALE,
          category: NotificationCategory.NEGATIVE_SALE,
          severity: NotificationSeverity.IMPORTANT,
          roleTarget: NotificationRoleTarget.ADMIN,
          title: "بيع بسعر أقل من التكلفة",
          message:
            `فاتورة ${updatedInvoice.invoiceNumber} — ${l.productName}: ` +
            `سعر البيع ${l.unitPrice} وسعر الكلفة ${l.costPerPiece} للقطعة، ` +
            `خسارة تقديرية ${totalLoss}`,
          entityType: "INVOICE",
          entityId: updatedInvoice.id,
          actionUrl: `/invoices/${updatedInvoice.id}`,
          metadata: {
            invoiceId: updatedInvoice.id,
            invoiceNumber: updatedInvoice.invoiceNumber,
            productId: l.productId,
            productName: l.productName,
            unitPrice: l.unitPrice,
            purchasePrice: l.costPerPiece,
            quantity: l.quantityPieces,
            lineCost: l.lineCost,
            totalPrice: l.totalPrice,
            totalLoss,
            userId: createdBy,
            customerId: input.customerId,
          },
          dedupeKey: buildDedupeKey(
            NotificationType.BELOW_COST_SALE,
            `${updatedInvoice.id}:${l.productId}`,
          ),
        },
        tx,
      );
    }
  }

  // General invoice-lifecycle notification (ADMIN only). NORMAL for a brand-new
  // invoice, MEDIUM for an edit. Deduped per invoice+day. Never blocks anything.
  {
    const custName = updatedInvoice.customer?.name ?? "زبون";
    if (existingInvoiceId) {
      // Enrich the edit notification: an edit to an invoice older than a day is
      // escalated to IMPORTANT ("تعديل فاتورة قديمة"), and paid-amount / customer
      // changes are called out in the message. Pure read-side comparison — no
      // calculation or behaviour changes.
      const OLD_INVOICE_HOURS = 24;
      const oldCreatedAt = existingInvoice?.createdAt;
      const isOld = oldCreatedAt
        ? Date.now() - oldCreatedAt.getTime() > OLD_INVOICE_HOURS * 3600 * 1000
        : false;

      const oldPaid = toNumber(existingInvoice?.paidAmount);
      const newPaid = paidAmount;
      const paidChanged = Math.abs(oldPaid - newPaid) > 0.001;

      const customerChanged = Boolean(
        existingInvoice?.customerId && existingInvoice.customerId !== input.customerId,
      );

      const extras: string[] = [];
      if (paidChanged) {
        extras.push(`الواصل تغيّر من ${oldPaid.toLocaleString()} إلى ${newPaid.toLocaleString()}`);
      }
      if (customerChanged) extras.push("تغيّر الزبون");
      const suffix = extras.length ? ` — ${extras.join(" — ")}` : "";

      await notifyAdmin(
        {
          type: NotificationType.INVOICE_UPDATED,
          category: NotificationCategory.INVOICES,
          severity: isOld ? NotificationSeverity.IMPORTANT : NotificationSeverity.MEDIUM,
          title: isOld ? "تعديل فاتورة قديمة" : "تم تعديل فاتورة",
          message: `${isOld ? "تعديل فاتورة قديمة" : "تم تعديل الفاتورة"} ${updatedInvoice.invoiceNumber} — ${custName}${suffix}`,
          entityType: "INVOICE",
          entityId: updatedInvoice.id,
          actionUrl: `/invoices/${updatedInvoice.id}`,
          metadata: {
            invoiceId: updatedInvoice.id,
            invoiceNumber: updatedInvoice.invoiceNumber,
            userId: createdBy,
            customerId: input.customerId,
            isOldInvoice: isOld,
            paidChanged,
            oldPaidAmount: oldPaid,
            newPaidAmount: newPaid,
            customerChanged,
            previousCustomerId: existingInvoice?.customerId ?? null,
          },
          dedupeKey: buildDedupeKey(NotificationType.INVOICE_UPDATED, updatedInvoice.id),
        },
        tx,
      );
    } else {
      await notifyAdmin(
        {
          type: NotificationType.INVOICE_CREATED,
          category: NotificationCategory.INVOICES,
          severity: NotificationSeverity.NORMAL,
          title: "فاتورة جديدة",
          message: `فاتورة جديدة ${updatedInvoice.invoiceNumber} — ${custName} بقيمة ${financials.totalAmount.toLocaleString()}`,
          entityType: "INVOICE",
          entityId: updatedInvoice.id,
          actionUrl: `/invoices/${updatedInvoice.id}`,
          metadata: {
            invoiceId: updatedInvoice.id,
            invoiceNumber: updatedInvoice.invoiceNumber,
            userId: createdBy,
            customerId: input.customerId,
          },
          dedupeKey: buildDedupeKey(NotificationType.INVOICE_CREATED, updatedInvoice.id),
        },
        tx,
      );
    }
  }

  return serializeInvoice(updatedInvoice);
}

export async function listInvoices(query: ListInvoicesQuery) {
  const dateFilter = getDateFilter(query.from, query.to);
  const where: Prisma.InvoiceWhereInput = {
    archivedAt: null, // hide accounting-safe-deleted invoices from lists
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.branchId ? { branchId: query.branchId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.paymentType ? { paymentType: query.paymentType } : {}),
    ...(dateFilter ? { date: dateFilter } : {}),
  };
  const skip = (query.page - 1) * query.limit;

  const [total, invoices] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      include: {
        customer: true,
        creator: {
          select: { id: true, name: true, username: true, role: true },
        },
      },
      orderBy: { date: "desc" },
      skip,
      take: query.limit,
    }),
  ]);

  return {
    data: invoices.map(serializeInvoice),
    pagination: {
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.ceil(total / query.limit),
    },
  };
}

export async function getInvoiceById(id: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      customer: true,
      items: {
        include: {
          // Frontend only reads itemNumber/pcsPerCarton (legacy fallback for
          // rows predating the itemNumber snapshot column) — never the full
          // product, and never its image fields. A full `product: true` here
          // pulled base64 imageUrl/thumbnailUrl per line item on every invoice
          // open, which is what made opening an invoice slow.
          product: { select: { id: true, name: true, itemNumber: true, pcsPerCarton: true, boxPieces: true } },
          warehouse: { select: { id: true, name: true } },
        },
      },
      stockMovements: true,
      creator: {
        select: { id: true, name: true, username: true, role: true },
      },
    },
  });

  if (!invoice) {
    throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
  }

  return serializeInvoice(invoice);
}

export async function createInvoice(
  input: CreateInvoiceInput,
  createdBy: string,
  db?: Db
) {
  let result: Awaited<ReturnType<typeof createInvoiceInTransaction>>;
  if (db) {
    result = await createInvoiceInTransaction(db, input, createdBy);
  } else {
    result = await prisma.$transaction(
      (tx) => createInvoiceInTransaction(tx, input, createdBy),
      INVOICE_TX_OPTIONS
    );
  }

  // Fire-and-forget: notify customers subscribed to arriving products
  if (input.type === InvoiceType.PURCHASE) {
    const productIds = input.items.map((i) => i.productId).filter(Boolean);
    if (productIds.length > 0) {
      import("./customer-portal.service").then(async ({ notifyProductArrival }) => {
        const products = await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, name: true },
        });
        await Promise.all(
          products.map((p) => notifyProductArrival(p.id, p.name).catch(() => null))
        );
      }).catch(() => null);
    }
  }

  return result;
}

export async function getLastSoldPrice(customerId: string, productId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: {
      customerId,
      type: InvoiceType.SALE,
      status: InvoiceStatus.ACTIVE,
      items: { some: { productId } },
    },
    include: {
      items: { where: { productId }, take: 1 },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  const item = invoice?.items[0];

  return invoice && item
    ? {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        date: invoice.date,
        unit: item.unit,
        warehouseId: item.warehouseId,
        unitPrice: toNumber(item.unitPrice),
      }
    : null;
}

async function updateInvoiceInTransaction(
  tx: Db,
  id: string,
  input: CreateInvoiceInput,
  updatedBy: string
) {
    const invoice = await tx.invoice.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!invoice) {
      throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
    }

    if (invoice.status !== InvoiceStatus.ACTIVE) {
      throw new AppError("Only active invoices can be updated", 400, "INVOICE_CLOSED");
    }

    await lockCustomer(tx, invoice.customerId);

    // Save original previousBalance so the invoice always shows the balance at creation time,
    // not the balance that includes later invoices.
    const originalPreviousBalance = toNumber(invoice.previousBalance);

    await tx.invoice.update({
      where: { id },
      data: {
        subtotal: 0,
        totalAmount: 0,
        paidAmount: 0,
        remainingAmount: 0,
        finalBalance: invoice.previousBalance,
      },
    });
    await recalculateCustomerBalanceInTransaction(tx, invoice.customerId);
    await reverseInvoiceItemsStock(tx, id);
    await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });

    // Preserve the original invoice type if the caller didn't explicitly set one.
    const effectiveType = input.type ?? invoice.type;
    // A SALE always deducts from المحل. On edit we already reversed the original
    // shop deduction, so re-deduct straight from المحل and ignore any stale/legacy
    // line warehouse the frontend echoed back — otherwise recreating the lines
    // would auto-transfer from an empty depot and raise a false 409.
    const rebuildItems =
      effectiveType === InvoiceType.SALE
        ? input.items.map((it) => ({ ...it, warehouseId: undefined }))
        : input.items;
    // Units already on the invoice stay editable even if hidden since then.
    const preexistingUnitPairs = new Set(
      invoice.items.map((it) => `${it.productId}:${it.unit}`)
    );
    // The edit UI may reassign the invoice to a different customer/supplier.
    // recalculateCustomerBalanceInTransaction above already zeroed this invoice's
    // effect out of the OLD customer's balance; createInvoiceInTransaction below
    // recalculates whichever customerId we pass it, so simply passing the new one
    // through (instead of always forcing the original) is enough to move the
    // invoice's balance impact onto the new customer.
    const newCustomerId = input.customerId || invoice.customerId;
    const customerChanged = newCustomerId !== invoice.customerId;
    const result = await createInvoiceInTransaction(
      tx,
      { ...input, items: rebuildItems, type: effectiveType, customerId: newCustomerId },
      updatedBy,
      id,
      invoice.invoiceNumber,
      preexistingUnitPairs
    );

    // If the customer changed, "originalPreviousBalance" was the OLD customer's
    // pre-invoice balance — meaningless for the new one, so keep the fresh
    // previousBalance/finalBalance createInvoiceInTransaction just computed.
    if (customerChanged) {
      return result;
    }

    // Restore the display-only previousBalance/finalBalance so the invoice shows the
    // balance at the time it was originally created (not the balance including later invoices).
    const delta = result.finalBalance - result.previousBalance;
    await tx.invoice.update({
      where: { id },
      data: {
        previousBalance: originalPreviousBalance,
        finalBalance: originalPreviousBalance + delta,
      },
    });

    return { ...result, previousBalance: originalPreviousBalance, finalBalance: originalPreviousBalance + delta };
}

export async function updateInvoice(
  id: string,
  input: CreateInvoiceInput,
  updatedBy: string,
  db?: Db
) {
  if (db) {
    return updateInvoiceInTransaction(db, id, input, updatedBy);
  }

  return prisma.$transaction(
    (tx) => updateInvoiceInTransaction(tx, id, input, updatedBy),
    INVOICE_TX_OPTIONS
  );
}

async function cancelInvoiceInTransaction(tx: Db, id: string, returnWarehouseId?: string) {
    const invoice = await tx.invoice.findUnique({ where: { id } });

    if (!invoice) {
      throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new AppError("Invoice is already cancelled", 400, "INVOICE_CANCELLED");
    }

    await lockCustomer(tx, invoice.customerId);
    await reverseInvoiceItemsStock(tx, id, returnWarehouseId);

    const cancelled = await tx.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.CANCELLED },
      include: {
        customer: true,
        items: true,
      },
    });

    await recalculateCustomerBalanceInTransaction(tx, invoice.customerId); // FIXED

    return serializeInvoice(cancelled);
}

export async function cancelInvoice(id: string, db?: Db, returnWarehouseId?: string) {
  if (db) {
    return cancelInvoiceInTransaction(db, id, returnWarehouseId);
  }

  return prisma.$transaction(
    (tx) => cancelInvoiceInTransaction(tx, id, returnWarehouseId),
    INVOICE_TX_OPTIONS
  );
}

async function reactivateInvoiceInTransaction(tx: Db, id: string) {
    const invoice = await tx.invoice.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!invoice) {
      throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
    }

    if (invoice.status === InvoiceStatus.ACTIVE) {
      throw new AppError("Invoice is already active", 400, "INVOICE_ACTIVE");
    }

    if (invoice.archivedAt) {
      throw new AppError("لا يمكن استرجاع فاتورة محذوفة", 400, "INVOICE_ARCHIVED");
    }

    await lockCustomer(tx, invoice.customerId);
    await applyInvoiceItemsStock(tx, id);

    await tx.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.ACTIVE },
    });

    return recalculateInvoiceBalances(tx, id);
}

export async function reactivateInvoice(id: string, db?: Db) {
  if (db) {
    return reactivateInvoiceInTransaction(db, id);
  }

  return prisma.$transaction(
    (tx) => reactivateInvoiceInTransaction(tx, id),
    INVOICE_TX_OPTIONS
  );
}


const RESTORE_WINDOW_MS = 48 * 60 * 60 * 1000;

export async function listRecentlyDeletedInvoices() {
  const cutoff = new Date(Date.now() - RESTORE_WINDOW_MS);
  return prisma.invoice.findMany({
    where: { archivedAt: { not: null, gte: cutoff } },
    orderBy: { archivedAt: "desc" },
    include: { customer: { select: { id: true, name: true } } },
  });
}

export async function restoreArchivedInvoice(id: string) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id }, include: { items: true } });
    if (!invoice) throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
    if (!invoice.archivedAt) throw new AppError("الفاتورة غير محذوفة", 400, "INVOICE_NOT_ARCHIVED");

    const cutoff = new Date(Date.now() - RESTORE_WINDOW_MS);
    if (invoice.archivedAt < cutoff) throw new AppError("انتهت مهلة الاسترجاع (48 ساعة)", 400, "RESTORE_WINDOW_EXPIRED");

    await tx.invoice.update({ where: { id }, data: { archivedAt: null, deletedBy: null, deleteReason: null } });
    await applyInvoiceItemsStock(tx, id);
    await tx.invoice.update({ where: { id }, data: { status: InvoiceStatus.ACTIVE } });
    await recalculateCustomerBalanceInTransaction(tx, invoice.customerId);
    return recalculateInvoiceBalances(tx, id);
  }, INVOICE_TX_OPTIONS);
}
// Accounting-safe "delete": the invoice row and all its related records
// (items, stock movements, coupon redemptions) are RETAINED for audit. The
// invoice is reversed (stock + balance) and marked archived so it disappears
// from lists/reports but can never silently vanish from the books.
export async function hardDeleteInvoice(
  id: string,
  deletedBy?: string,
  reason?: string,
  returnWarehouseId?: string
) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { id } });
    if (!invoice) throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
    if (invoice.archivedAt) return { id, invoiceNumber: invoice.invoiceNumber }; // idempotent

    const wasActive = invoice.status === InvoiceStatus.ACTIVE;

    // Reverse stock + flip to CANCELLED so the archived invoice has no
    // accounting effect (all accounting queries already exclude non-ACTIVE).
    if (wasActive) {
      await reverseInvoiceItemsStock(tx, id, returnWarehouseId);
      await tx.invoice.update({ where: { id }, data: { status: InvoiceStatus.CANCELLED } });
    }

    await tx.invoice.update({
      where: { id },
      data: { archivedAt: new Date(), deletedBy: deletedBy ?? null, deleteReason: reason ?? null },
    });

    if (wasActive) {
      await recalculateCustomerBalanceInTransaction(tx, invoice.customerId);
    }

    return { id, invoiceNumber: invoice.invoiceNumber };
  }, INVOICE_TX_OPTIONS);
}

