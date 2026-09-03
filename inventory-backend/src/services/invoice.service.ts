import {
  InvoiceStatus,
  InvoiceType,
  PaymentType,
  Prisma,
  StockMovementType,
  TransferStatus,
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
  calculateLoyaltyPoints,
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
  // «تم تجهيز» — picker's tick. Stored as-is; affects nothing but the UI.
  prepared?: boolean;
  // Depot pull: move a WHOLE CARTON to المحل instead of only the pieces sold.
  // A depot is stacked in sealed cartons — taking 12 pieces out of one leaves a
  // broken carton on the shelf that no count sheet can describe.
  transferWholeCarton?: boolean;
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
  /**
   * «نقاط الولاء» — points to spend on this invoice, as a discount. Deducted
   * inside this invoice's own transaction, so a balance cannot be spent twice
   * and a failed save cannot leave points gone with no invoice to show for it.
   * SALE invoices only.
   */
  redeemPoints?: number;
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
  if (!locked) throw new AppError("كود الخصم غير مفعّل", 400, "COUPON_INACTIVE");

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
    throw new AppError("كود الخصم غير مفعّل", 400, "COUPON_INACTIVE");
  }
  if (coupon.startsAt && coupon.startsAt > now) {
    throw new AppError("كود الخصم لم يبدأ بعد", 400, "COUPON_NOT_STARTED");
  }
  if (coupon.endsAt && coupon.endsAt < now) {
    throw new AppError("كود الخصم منتهي الصلاحية", 400, "COUPON_EXPIRED");
  }
  if (coupon.maxUses !== null && coupon._count.redemptions >= coupon.maxUses) {
    throw new AppError("كود الخصم وصل الحد الأقصى للاستعمال", 400, "COUPON_LIMIT_REACHED");
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

  throw new AppError("تعذّر توليد رقم فاتورة فريد — أعد المحاولة", 409, "INVOICE_NUMBER_CONFLICT");
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
    throw new AppError("الزبون غير موجود", 404, "CUSTOMER_NOT_FOUND");
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
    throw new AppError("الزبون غير موجود", 404, "CUSTOMER_NOT_FOUND");
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
    throw new AppError("المادة غير موجودة أو محذوفة", 404, "PRODUCT_NOT_FOUND");
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
      // How much actually moves. By default exactly what is sold; with
      // transferWholeCarton, the whole carton(s) that cover the sale — the
      // surplus stays in المحل rather than leaving a broken carton in the depot.
      const perCarton = Math.max(1, product.pcsPerCarton);
      const wholeCartons = perCarton > 1 && item.transferWholeCarton
        ? Math.ceil(quantityInPieces / perCarton)
        : 0;
      const transferPieces = wholeCartons > 0 ? wholeCartons * perCarton : quantityInPieces;

      if (!allowNegativeSale) {
        const depotStock = await tx.productWarehouseStock.findUnique({
          where: { productId_warehouseId: { productId: product.id, warehouseId: requestedId } },
          select: { quantityPieces: true },
        });
        const available = Number(depotStock?.quantityPieces ?? 0);
        if (transferPieces > available) {
          const wh = await tx.branch.findUnique({ where: { id: requestedId }, select: { name: true } });
          throw new AppError(
            wholeCartons > 0
              ? `${wh?.name ?? "المخزن"} يحتوي على ${available} قطعة فقط من "${product.name}" — لا يكفي لتحويل ${wholeCartons} كرتون (${transferPieces} قطعة). حوّل الكمية المطلوبة فقط.`
              : `${wh?.name ?? "المخزن"} يحتوي فقط على ${available} قطعة من "${product.name}". قلّل الكمية أو أضف مخزون للمادة.`,
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
          items: [
            wholeCartons > 0
              ? { productId: product.id, unit: Unit.CARTON, quantity: wholeCartons }
              : { productId: product.id, unit: item.unit, quantity: item.quantity },
          ],
          notes: wholeCartons > 0 ? "تحويل كرتون كامل للبيع" : "تحويل تلقائي للبيع",
          // Linked so reverseInvoiceItemsStock can undo it — otherwise
          // cancelling the sale leaves the depot short and المحل long forever.
          sourceInvoiceId: invoiceId,
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
      // The shortage is on ONE warehouse row, while the products screen shows
      // the TOTAL across all of them — so "المحل عنده -240" while the product
      // reads healthy is not a contradiction, it just needs a transfer. Say so,
      // or the message reads like a lie.
      const rows = await tx.productWarehouseStock.findMany({
        where: { productId: product.id },
        select: { quantityPieces: true },
      });
      const totalPieces = rows.reduce((sum, r) => sum + Number(r.quantityPieces), 0);
      const elsewhere = totalPieces - available;
      throw new AppError(
        `"${product.name}": ${whName} فيه ${available} قطعة${available < 0 ? " (رصيد سالب)" : ""} والمطلوب ${quantityInPieces}.` +
          (elsewhere > 0
            ? ` يوجد ${elsewhere} قطعة في مخازن أخرى — حوّلها إلى ${whName} أو اختر المخزن من عمود المخزن بسطر الفاتورة.`
            : ` لا يوجد رصيد في أي مخزن آخر — قلّل الكمية أو أضف مخزون.`),
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
    // The blend is only meaningful when there is real stock to blend against.
    // Sales are allowed to go negative, so `currentQty` can be negative and the
    // denominator can land on a tiny positive number: at −59 pieces, cost 1000,
    // buying 60 @ 1200 gives denom = 1 and a cost of 13,000 — a 13× corruption
    // that then feeds inventory valuation, profit reports and frozen loss
    // snapshots. Other inputs produce a negative cost. When there is no
    // positive stock on hand, this purchase simply IS the cost.
    const blended =
      currentQty > 0 && denom > 0
        ? roundMoney((currentQty * currentCost + quantityInPieces * newUnitCostPerPiece) / denom)
        : roundMoney(newUnitCostPerPiece);
    const newCostPrice = blended > 0 ? blended : roundMoney(newUnitCostPerPiece);
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
    throw new AppError("الفاتورة غير موجودة", 404, "INVOICE_NOT_FOUND");
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

  // Undo any automatic depot→المحل transfer this sale generated.
  //
  // A depot sale moves stock out of the depot into المحل and then deducts from
  // المحل. The loop above credits the pieces back to المحل only, so the TOTAL
  // was conserved but the depot stayed permanently short and المحل permanently
  // long, with no invoice or user action explaining the drift — and every
  // depot-level reorder point and cycle count was wrong from then on.
  //
  // Only transfers this invoice created are touched (sourceInvoiceId), so an
  // operator-initiated transfer is never disturbed. When the operator chose an
  // explicit return warehouse we leave the transfer alone: they have already
  // said where the stock should land.
  if (invoice.type === InvoiceType.SALE && !returnWarehouseId) {
    await reverseAutoTransfersForInvoice(tx, invoiceId);
  }
}

/**
 * Moves the pieces of each auto-generated transfer back to their source
 * warehouse and marks the transfer CANCELLED. Idempotent: an already-cancelled
 * transfer is skipped, so a re-run (cancel → hard delete) cannot double-apply.
 */
async function reverseAutoTransfersForInvoice(tx: Db, invoiceId: string) {
  const transfers = await tx.inventoryTransfer.findMany({
    where: { sourceInvoiceId: invoiceId, status: TransferStatus.COMPLETED },
    include: {
      items: {
        include: { product: { select: { pcsPerCarton: true, boxPieces: true } } },
      },
    },
  });

  for (const transfer of transfers) {
    // Claim it first: only the caller that flips COMPLETED → CANCELLED does the
    // stock work, so concurrent cancel/delete cannot both reverse it.
    const claimed = await tx.inventoryTransfer.updateMany({
      where: { id: transfer.id, status: TransferStatus.COMPLETED },
      data: { status: TransferStatus.CANCELLED },
    });
    if (claimed.count === 0) continue;

    for (const item of transfer.items) {
      const pieces = unitToPieces(
        item.unit,
        item.quantity,
        item.product.pcsPerCarton,
        item.product.boxPieces
      );
      if (pieces <= 0) continue;
      // المحل gives the pieces back, the depot receives them — the exact
      // inverse of executeTransferWithin. allowNegative because the sale being
      // reversed already happened and today's shop level may be lower.
      await adjustWarehouseStock(tx, {
        productId: item.productId,
        warehouseId: transfer.toBranchId,
        deltaPieces: -pieces,
        allowNegative: true,
      });
      await adjustWarehouseStock(tx, {
        productId: item.productId,
        warehouseId: transfer.fromBranchId,
        deltaPieces: pieces,
        allowNegative: true,
      });
      await syncProductTotalStock(tx, item.productId);
    }

    // The movement rows carried the original transfer's before/after balances;
    // keeping them would misreport the ledger for a transfer that no longer
    // stands. executeTransferWithin writes them keyed on transferId.
    await tx.stockMovement.deleteMany({ where: { transferId: transfer.id } });
  }
}

async function applyInvoiceItemsStock(tx: Db, invoiceId: string) {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: { items: true },
  });

  if (!invoice) {
    throw new AppError("الفاتورة غير موجودة", 404, "INVOICE_NOT_FOUND");
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
    throw new AppError("الفاتورة غير موجودة", 404, "INVOICE_NOT_FOUND");
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

// A SALES_RETURN that names an original invoice must stay inside what that
// invoice actually sold. Without this, `originalInvoiceId` is a free-text field:
// you can return 10,000 pieces of a product that was sold 2, against another
// customer's invoice, and repeat it indefinitely — inflating stock and crediting
// the customer every time. Returns with no `originalInvoiceId` are unaffected
// (they are the "no reference sale" case and are already priced manually).
async function assertReturnWithinSoldQuantity(
  tx: Db,
  input: CreateInvoiceInput,
  existingInvoiceId?: string
) {
  const originalInvoiceId = input.originalInvoiceId;
  if (!originalInvoiceId) return;

  const original = await tx.invoice.findUnique({
    where: { id: originalInvoiceId },
    select: {
      id: true,
      type: true,
      status: true,
      archivedAt: true,
      customerId: true,
      invoiceNumber: true,
      items: {
        select: {
          productId: true,
          unit: true,
          quantity: true,
          product: { select: { name: true, pcsPerCarton: true, boxPieces: true } },
        },
      },
    },
  });

  if (!original || original.archivedAt || original.type !== InvoiceType.SALE) {
    throw new AppError(
      "الفاتورة الأصلية غير موجودة أو ليست فاتورة بيع",
      400,
      "ORIGINAL_INVOICE_NOT_FOUND"
    );
  }
  if (original.status !== InvoiceStatus.ACTIVE) {
    throw new AppError(
      `الفاتورة الأصلية ${original.invoiceNumber} ملغاة — لا يمكن الإرجاع عليها`,
      400,
      "ORIGINAL_INVOICE_NOT_ACTIVE"
    );
  }
  if (original.customerId !== input.customerId) {
    throw new AppError(
      `الفاتورة الأصلية ${original.invoiceNumber} تخص زبوناً آخر`,
      400,
      "ORIGINAL_INVOICE_CUSTOMER_MISMATCH"
    );
  }

  // Sold pieces per product on the original invoice.
  const soldPieces = new Map<string, number>();
  const productNames = new Map<string, string>();
  for (const item of original.items) {
    const pieces = unitToPieces(
      item.unit,
      item.quantity,
      item.product.pcsPerCarton,
      item.product.boxPieces
    );
    soldPieces.set(item.productId, (soldPieces.get(item.productId) ?? 0) + pieces);
    productNames.set(item.productId, item.product.name);
  }

  // Pieces already returned against this invoice by OTHER returns. The invoice
  // being edited is excluded so an edit measures itself against the same
  // baseline a fresh return would.
  const priorReturns = await tx.invoice.findMany({
    where: {
      type: InvoiceType.SALES_RETURN,
      originalInvoiceId,
      status: InvoiceStatus.ACTIVE,
      archivedAt: null,
      ...(existingInvoiceId ? { id: { not: existingInvoiceId } } : {}),
    },
    select: {
      items: {
        select: {
          productId: true,
          unit: true,
          quantity: true,
          product: { select: { pcsPerCarton: true, boxPieces: true } },
        },
      },
    },
  });

  const returnedPieces = new Map<string, number>();
  for (const invoice of priorReturns) {
    for (const item of invoice.items) {
      const pieces = unitToPieces(
        item.unit,
        item.quantity,
        item.product.pcsPerCarton,
        item.product.boxPieces
      );
      returnedPieces.set(item.productId, (returnedPieces.get(item.productId) ?? 0) + pieces);
    }
  }

  // Requested pieces per product on this return.
  const requestedPieces = new Map<string, number>();
  for (const item of input.items) {
    const product = await tx.product.findUnique({
      where: { id: item.productId },
      select: { name: true, pcsPerCarton: true, boxPieces: true },
    });
    if (!product) continue; // priceInvoiceItem raises the real not-found error
    productNames.set(item.productId, product.name);
    const pieces = unitToPieces(item.unit, item.quantity, product.pcsPerCarton, product.boxPieces);
    requestedPieces.set(item.productId, (requestedPieces.get(item.productId) ?? 0) + pieces);
  }

  for (const [productId, requested] of requestedPieces) {
    const sold = soldPieces.get(productId) ?? 0;
    const name = productNames.get(productId) ?? "المادة";
    if (sold === 0) {
      throw new AppError(
        `«${name}» غير موجودة في الفاتورة الأصلية ${original.invoiceNumber}`,
        400,
        "RETURN_PRODUCT_NOT_IN_ORIGINAL"
      );
    }
    const alreadyReturned = returnedPieces.get(productId) ?? 0;
    const remaining = sold - alreadyReturned;
    if (requested > remaining) {
      throw new AppError(
        `لا يمكن إرجاع أكثر من المباع من «${name}» — المتبقي للإرجاع ${remaining} قطعة من أصل ${sold}`,
        400,
        "RETURN_EXCEEDS_SOLD"
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
  if (invoiceType === InvoiceType.SALES_RETURN) {
    await assertReturnWithinSoldQuantity(tx, input, existingInvoiceId);
  }
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
  // Sum of (line revenue − line cost) across SALE lines with a known cost —
  // feeds the loyalty-points formula below. Lines with no known cost
  // (costSnapshot === 0) contribute 0, same guard belowCostLines uses.
  let invoiceProfit = 0;
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
      invoiceProfit = roundMoney(invoiceProfit + (pricedItem.totalPrice - lineCost));
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
        prepared: Boolean(item.prepared),
      },
    });
  }

  // Points become discount before the coupon is added, and are refused rather
  // than silently trimmed if they would exceed what the invoice is worth —
  // quietly burning a customer's points against nothing is worse than saying
  // no.
  let redeemed = { points: 0, value: 0 };
  const wantsRedeem = Math.floor(Number(input.redeemPoints) || 0);
  if (wantsRedeem > 0 && !existingInvoiceId) {
    if (invoiceType !== InvoiceType.SALE) {
      throw new AppError("النقاط تنصرف بفواتير البيع فقط", 400, "REDEEM_SALE_ONLY");
    }
    const { redeemPointsInTransaction } = await import("./loyalty.service");
    redeemed = await redeemPointsInTransaction(
      tx, { customerId: input.customerId, points: wantsRedeem, invoiceId: invoice.id }, createdBy,
    );
    if (redeemed.value > subtotal) {
      throw new AppError(
        `قيمة النقاط ${redeemed.value} أكبر من قيمة الفاتورة ${subtotal} — قلّل النقاط`,
        400,
        "REDEEM_EXCEEDS_INVOICE",
      );
    }
  }

  const coupon = await couponDiscount(tx, input.couponCode, subtotal);
  // Both discounts apply. A coupon used to REPLACE the invoice discount, which
  // silently threw away whatever else the order had earned — a catalog order
  // that reached a free-delivery/percentage tier and also carried a promo code
  // arrived with only the coupon on it, while the shopper had been shown both.
  // Clamped to the subtotal so the pair can never drive a total negative.
  const discount = roundMoney(
    Math.min(subtotal, Math.max(0, coupon.discount + manualDiscount + redeemed.value)),
  );
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

  // Loyalty points: 10 points per 1,000 IQD of PROFIT (not invoice total), on
  // brand-new ACTIVE sale invoices only — never recomputed on edit (frozen
  // snapshot, so cancel/hardDelete can reverse it exactly and reactivate/
  // restore can re-apply it without re-deriving profit from scratch).
  // `invoiceProfit` is accumulated inside the item loop, BEFORE the
  // invoice-level discount is known — a 200,000 sale costing 150,000 with a
  // 50,000 discount breaks even, yet the raw figure says 50,000 profit and
  // awarded 500 points. Because the value is frozen and reversed verbatim on
  // cancel/delete, that error is permanent for the invoice, so the discount is
  // subtracted here before points are computed.
  const profitAfterDiscount = roundMoney(invoiceProfit - discount);
  const loyaltyPointsEarned =
    invoiceType === InvoiceType.SALE && !existingInvoiceId
      ? calculateLoyaltyPoints(Math.max(0, profitAfterDiscount))
      : 0;

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
      // undefined (edit path) leaves the existing stored value untouched —
      // Prisma skips undefined fields in an update payload.
      loyaltyPointsEarned: existingInvoiceId ? undefined : loyaltyPointsEarned,
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

  if (loyaltyPointsEarned > 0) {
    await tx.customer.update({
      where: { id: input.customerId },
      data: { loyaltyPoints: { increment: loyaltyPointsEarned } },
    });
  }

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
    throw new AppError("الفاتورة غير موجودة", 404, "INVOICE_NOT_FOUND");
  }

  return serializeInvoice(invoice);
}

export async function createInvoice(
  input: CreateInvoiceInput,
  createdBy: string,
  db?: Db,
  // Units the caller vouches for even if the product hides them. A customer
  // who ordered a carton from the catalog must not have their order refused
  // at invoicing time because that unit is switched off on the invoice
  // screen — those are two different questions and only one of them was
  // asked when the order was placed.
  allowedUnitPairs?: Set<string>
) {
  let result: Awaited<ReturnType<typeof createInvoiceInTransaction>>;
  if (db) {
    result = await createInvoiceInTransaction(db, input, createdBy, undefined, undefined, allowedUnitPairs);
  } else {
    result = await prisma.$transaction(
      (tx) => createInvoiceInTransaction(tx, input, createdBy, undefined, undefined, allowedUnitPairs),
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

// Purchase-history summary for one customer + product — how many times it was
// sold to them, total quantity, and the last sale — so the sales-return
// screen can show "sold 3 times to this customer" (or "never bought before")
// the moment a product is added to a return.
export async function getCustomerProductHistory(customerId: string, productId: string) {
  const items = await prisma.invoiceItem.findMany({
    where: {
      productId,
      invoice: { customerId, type: InvoiceType.SALE, status: InvoiceStatus.ACTIVE },
    },
    select: { quantity: true, unit: true },
  });

  if (items.length === 0) {
    return { timesSold: 0, totalQuantityPieces: 0, last: null };
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { pcsPerCarton: true, boxPieces: true },
  });

  const totalQuantityPieces = items.reduce(
    (sum, item) => sum + unitToPieces(item.unit, item.quantity, product?.pcsPerCarton ?? 1, product?.boxPieces ?? null),
    0
  );

  return {
    timesSold: items.length,
    totalQuantityPieces,
    last: await getLastSoldPrice(customerId, productId),
  };
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
        quantity: item.quantity,
      }
    : null;
}

// Same lookup, any customer — the invoice-line context menu's "آخر سعر بيع عام"
// (last sale of this product to anyone), so the seller can sanity-check a price
// even before a customer is picked, or compare it against the per-customer price.
export async function getLastSoldPriceOverall(productId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: {
      type: InvoiceType.SALE,
      status: InvoiceStatus.ACTIVE,
      items: { some: { productId } },
    },
    include: {
      items: { where: { productId }, take: 1 },
      customer: { select: { id: true, name: true } },
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
        quantity: item.quantity,
        customerId: invoice.customerId,
        customerName: invoice.customer?.name ?? null,
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
      throw new AppError("الفاتورة غير موجودة", 404, "INVOICE_NOT_FOUND");
    }

    if (invoice.status !== InvoiceStatus.ACTIVE) {
      throw new AppError("لا يمكن تعديل فاتورة ملغاة أو مؤرشفة", 400, "INVOICE_CLOSED");
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

    // Customer reassignment must also move any already-earned loyalty points —
    // otherwise the old customer keeps points for a sale no longer attributed to
    // them, and a later cancel/hardDelete (which looks up the invoice's CURRENT
    // customerId) would incorrectly deduct those points from the NEW customer.
    if (customerChanged && invoice.type === InvoiceType.SALE && invoice.loyaltyPointsEarned > 0) {
      await tx.customer.update({
        where: { id: invoice.customerId },
        data: { loyaltyPoints: { decrement: invoice.loyaltyPointsEarned } },
      });
      await tx.customer.update({
        where: { id: newCustomerId },
        data: { loyaltyPoints: { increment: invoice.loyaltyPointsEarned } },
      });
    }

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

/**
 * «إشعارات المندوب» — tell the owner and the rep that a rep's invoice changed.
 *
 * Fired AFTER the mutation resolves and outside any transaction: a WhatsApp
 * send has no place inside one, and a rolled-back edit must not announce
 * itself. Fire-and-forget — a notification failure can never be the reason an
 * invoice edit fails.
 *
 * The rep is told directly, not just the owner, because an edit moves their
 * commission and they should know today rather than at month end.
 */
function announceAgentInvoiceChange(invoiceId: string, changeKind: string) {
  setImmediate(() => {
    void import("./sales-agent-admin.service")
      .then((m) => m.notifyInvoiceChangedForAgent(invoiceId, changeKind))
      .catch(() => undefined);
  });
}

export async function updateInvoice(
  id: string,
  input: CreateInvoiceInput,
  updatedBy: string,
  db?: Db
) {
  const result = db
    ? await updateInvoiceInTransaction(db, id, input, updatedBy)
    : await prisma.$transaction(
        (tx) => updateInvoiceInTransaction(tx, id, input, updatedBy),
        INVOICE_TX_OPTIONS
      );

  announceAgentInvoiceChange(id, "تعديل");
  return result;
}

async function cancelInvoiceInTransaction(tx: Db, id: string, returnWarehouseId?: string) {
    const invoice = await tx.invoice.findUnique({ where: { id } });

    if (!invoice) {
      throw new AppError("الفاتورة غير موجودة", 404, "INVOICE_NOT_FOUND");
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new AppError("الفاتورة ملغاة أصلاً", 400, "INVOICE_CANCELLED");
    }

    await lockCustomer(tx, invoice.customerId);
    await reverseInvoiceItemsStock(tx, id, returnWarehouseId);

    // Mirror of the earn step in createInvoiceInTransaction — pull back exactly
    // what this invoice earned (frozen snapshot, no re-derivation needed).
    if (invoice.loyaltyPointsEarned > 0) {
      await tx.customer.update({
        where: { id: invoice.customerId },
        data: { loyaltyPoints: { decrement: invoice.loyaltyPointsEarned } },
      });
    }
    // And the other direction: a cancelled invoice charges the customer
    // nothing, so it must not cost them the points it spent either.
    {
      const { revertRedemptionsForInvoice } = await import("./loyalty.service");
      await revertRedemptionsForInvoice(tx, id);
    }

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
  const result = db
    ? await cancelInvoiceInTransaction(db, id, returnWarehouseId)
    : await prisma.$transaction(
        (tx) => cancelInvoiceInTransaction(tx, id, returnWarehouseId),
        INVOICE_TX_OPTIONS
      );

  announceAgentInvoiceChange(id, "إلغاء");
  return result;
}

async function reactivateInvoiceInTransaction(tx: Db, id: string) {
    const invoice = await tx.invoice.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!invoice) {
      throw new AppError("الفاتورة غير موجودة", 404, "INVOICE_NOT_FOUND");
    }

    if (invoice.status === InvoiceStatus.ACTIVE) {
      throw new AppError("الفاتورة مفعّلة أصلاً", 400, "INVOICE_ACTIVE");
    }

    if (invoice.archivedAt) {
      throw new AppError("لا يمكن استرجاع فاتورة محذوفة", 400, "INVOICE_ARCHIVED");
    }

    await lockCustomer(tx, invoice.customerId);
    await applyInvoiceItemsStock(tx, id);

    // Re-apply the points cancelInvoiceInTransaction pulled back.
    if (invoice.loyaltyPointsEarned > 0) {
      await tx.customer.update({
        where: { id: invoice.customerId },
        data: { loyaltyPoints: { increment: invoice.loyaltyPointsEarned } },
      });
    }

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
    if (!invoice) throw new AppError("الفاتورة غير موجودة", 404, "INVOICE_NOT_FOUND");
    if (!invoice.archivedAt) throw new AppError("الفاتورة غير محذوفة", 400, "INVOICE_NOT_ARCHIVED");

    const cutoff = new Date(Date.now() - RESTORE_WINDOW_MS);
    if (invoice.archivedAt < cutoff) throw new AppError("انتهت مهلة الاسترجاع (48 ساعة)", 400, "RESTORE_WINDOW_EXPIRED");

    await tx.invoice.update({ where: { id }, data: { archivedAt: null, deletedBy: null, deleteReason: null } });
    await applyInvoiceItemsStock(tx, id);
    // Mirrors the unconditional stock re-apply above — restore always brings
    // the invoice fully back regardless of its status right before deletion.
    if (invoice.loyaltyPointsEarned > 0) {
      await tx.customer.update({
        where: { id: invoice.customerId },
        data: { loyaltyPoints: { increment: invoice.loyaltyPointsEarned } },
      });
    }
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
  returnWarehouseId?: string,
  db?: Db
) {
  // When called from the approval flow we're already inside a transaction —
  // opening a second independent one could commit the delete even if the
  // approval-status update rolls back.
  const result = db
    ? await hardDeleteInvoiceInTransaction(db, id, deletedBy, reason, returnWarehouseId)
    : await prisma.$transaction(
        (tx) => hardDeleteInvoiceInTransaction(tx, id, deletedBy, reason, returnWarehouseId),
        INVOICE_TX_OPTIONS
      );

  // Safe to read the invoice afterwards: this "delete" archives the row rather
  // than removing it, so the customer name and total the message needs are
  // still there.
  announceAgentInvoiceChange(id, "حذف");
  return result;
}

async function hardDeleteInvoiceInTransaction(
  tx: Db,
  id: string,
  deletedBy?: string,
  reason?: string,
  returnWarehouseId?: string
) {
  {
    const invoice = await tx.invoice.findUnique({ where: { id } });
    if (!invoice) throw new AppError("الفاتورة غير موجودة", 404, "INVOICE_NOT_FOUND");
    if (invoice.archivedAt) return { id, invoiceNumber: invoice.invoiceNumber }; // idempotent

    const wasActive = invoice.status === InvoiceStatus.ACTIVE;

    // Reverse stock + flip to CANCELLED so the archived invoice has no
    // accounting effect (all accounting queries already exclude non-ACTIVE).
    if (wasActive) {
      await reverseInvoiceItemsStock(tx, id, returnWarehouseId);
      // Only when going straight from ACTIVE→archived (no prior explicit
      // cancel) — an already-CANCELLED invoice already had its points pulled
      // back by cancelInvoiceInTransaction, so subtracting again here would
      // double-reverse.
      if (invoice.loyaltyPointsEarned > 0) {
        await tx.customer.update({
          where: { id: invoice.customerId },
          data: { loyaltyPoints: { decrement: invoice.loyaltyPointsEarned } },
        });
      }
      // Same guard: an already-cancelled invoice gave its spent points back
      // already, and revertRedemptionsForInvoice only touches rows that have
      // not been reverted, so this cannot hand them out twice.
      {
        const { revertRedemptionsForInvoice } = await import("./loyalty.service");
        await revertRedemptionsForInvoice(tx, id);
      }
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
  }
}

