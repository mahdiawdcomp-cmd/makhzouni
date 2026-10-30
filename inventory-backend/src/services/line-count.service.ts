// «جرد بالسطور» — invoice-style stocktake. The worker opens a token link,
// downloads the whole catalogue once, writes lines (product + qty + unit,
// duplicates allowed) fully offline, and uploads them in a single submit.
// The admin then accepts/rejects each variance; finalize books ONE cash SALE
// invoice to «الزبون النقدي» for accepted shortages and ONE cash PURCHASE
// invoice to the configured overage supplier for accepted overages, both
// through createInvoice (the same stock + ledger + profit path as any invoice).
import { randomBytes } from "crypto";
import { InvoiceType, PaymentType, Unit } from "@prisma/client";
import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { resolveShopWarehouseId, resolveWarehouseId } from "./warehouse-stock.service";
import { createInvoice } from "./invoice.service";
import { getOrCreateWalkInCustomer } from "./customer.service";
import { getSettings } from "./settings.service";

export type LineCountUnit = "PIECE" | "CARTON";
export type LineCountDecision = "PENDING" | "ACCEPTED" | "REJECTED";

export interface SubmittedLine {
  productId: string;
  qty: number;
  unit: LineCountUnit;
  writtenAt: string;
}

function makeToken() {
  return `lct_${randomBytes(24).toString("base64url")}`;
}

async function warehouseName(id: string) {
  const b = await prisma.branch.findUnique({ where: { id }, select: { name: true } });
  return b?.name ?? "";
}

// ─── Admin ──────────────────────────────────────────────────────────────────

export async function createLineCount(createdBy: string, warehouseId?: string, notes?: string) {
  const wid = warehouseId ? await resolveWarehouseId(prisma, warehouseId) : await resolveShopWarehouseId(prisma);
  // One live count per warehouse — two would race to book the same variances.
  const live = await prisma.lineCountSession.findFirst({
    where: { warehouseId: wid, status: { in: ["OPEN", "SUBMITTED"] } },
    select: { id: true },
  });
  if (live) throw new AppError("يوجد جرد بالسطور مفتوح لهذا المخزن — كمّله أو ألغِه أولاً", 409, "LINE_COUNT_EXISTS");
  return prisma.lineCountSession.create({
    data: { publicToken: makeToken(), warehouseId: wid, createdBy, notes: notes?.trim() || null },
  });
}

export async function listLineCounts(warehouseId?: string) {
  const rows = await prisma.lineCountSession.findMany({
    where: warehouseId ? { warehouseId } : {},
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { _count: { select: { lines: true, results: true } } },
  });
  const names = new Map(
    (await prisma.branch.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.warehouseId))] } }, select: { id: true, name: true } }))
      .map((b) => [b.id, b.name]),
  );
  return rows.map((r) => ({
    id: r.id,
    publicToken: r.publicToken,
    warehouseId: r.warehouseId,
    warehouseName: names.get(r.warehouseId) ?? "",
    status: r.status,
    notes: r.notes,
    createdAt: r.createdAt,
    submittedAt: r.submittedAt,
    finalizedAt: r.finalizedAt,
    lineCount: r._count.lines,
    productCount: r._count.results,
  }));
}

async function loadSession(id: string) {
  const s = await prisma.lineCountSession.findUnique({ where: { id } });
  if (!s) throw new AppError("جلسة الجرد غير موجودة", 404, "LINE_COUNT_NOT_FOUND");
  return s;
}

/** Everything the review page needs: per-product variance, the lines that
 * made it up, a warning when stock moved after the first line was written,
 * and the warehouse products nobody counted. */
export async function getLineCountReview(id: string) {
  const s = await loadSession(id);
  const [results, lines] = await Promise.all([
    prisma.lineCountResult.findMany({ where: { sessionId: id } }),
    prisma.lineCountLine.findMany({ where: { sessionId: id }, orderBy: { position: "asc" } }),
  ]);
  const productIds = results.map((r) => r.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, itemNumber: true, category: true, pcsPerCarton: true, salePrice: true, costPrice: true, purchasePrice: true },
  });
  const pmap = new Map(products.map((p) => [p.id, p]));

  // Movements on this warehouse after the product's first line: a sale or
  // transfer in that window means the snapshot no longer matches the shelf.
  const moved = new Set<string>();
  if (results.length > 0) {
    const earliest = results.reduce((m, r) => (r.firstWrittenAt < m ? r.firstWrittenAt : m), results[0].firstWrittenAt);
    const until = s.submittedAt ?? new Date();
    const movements = await prisma.stockMovement.findMany({
      where: { branchId: s.warehouseId, productId: { in: productIds }, createdAt: { gt: earliest, lte: until } },
      select: { productId: true, createdAt: true },
    });
    const first = new Map(results.map((r) => [r.productId, r.firstWrittenAt]));
    for (const m of movements) {
      const f = first.get(m.productId);
      if (f && m.createdAt > f) moved.add(m.productId);
    }
  }

  const linesBy = new Map<string, typeof lines>();
  for (const l of lines) {
    const arr = linesBy.get(l.productId) ?? [];
    arr.push(l);
    linesBy.set(l.productId, arr);
  }

  const items = results.map((r) => {
    const p = pmap.get(r.productId);
    const delta = r.countedQty - r.systemQty;
    const salePrice = Math.round(Number(p?.salePrice ?? 0));
    const cost = Math.round(Number(p?.costPrice ?? 0) || Number(p?.purchasePrice ?? 0));
    return {
      productId: r.productId,
      productName: p?.name ?? "(مادة محذوفة)",
      itemNumber: p?.itemNumber ?? null,
      category: p?.category ?? null,
      pcsPerCarton: p?.pcsPerCarton ?? 1,
      systemQty: r.systemQty,
      countedQty: r.countedQty,
      delta,
      decision: r.decision as LineCountDecision,
      // Shortage valued at sale price (it becomes a sale), overage at cost.
      unitPrice: delta < 0 ? salePrice : cost,
      value: Math.abs(delta) * (delta < 0 ? salePrice : cost),
      movedAfterWriting: moved.has(r.productId),
      lines: (linesBy.get(r.productId) ?? []).map((l) => ({ position: l.position, qty: l.qty, unit: l.unit, qtyPieces: l.qtyPieces, writtenAt: l.writtenAt })),
    };
  });
  items.sort((a, b) => (a.delta === 0 ? 1 : 0) - (b.delta === 0 ? 1 : 0) || b.value - a.value || Math.abs(b.delta) - Math.abs(a.delta));

  // Products holding stock in this warehouse that no line touched — left as-is.
  const counted = new Set(productIds);
  const stocks = await prisma.productWarehouseStock.findMany({
    where: { warehouseId: s.warehouseId, quantityPieces: { not: 0 }, product: { deletedAt: null } },
    select: { productId: true, quantityPieces: true, product: { select: { name: true, itemNumber: true, pcsPerCarton: true } } },
    orderBy: { product: { name: "asc" } },
  });
  const uncounted = stocks
    .filter((x) => !counted.has(x.productId))
    .map((x) => ({ productId: x.productId, productName: x.product.name, itemNumber: x.product.itemNumber, pcsPerCarton: x.product.pcsPerCarton, systemQty: x.quantityPieces }));

  const invoiceNumbers = async (invId: string | null) => {
    if (!invId) return null;
    const inv = await prisma.invoice.findUnique({ where: { id: invId }, select: { id: true, invoiceNumber: true } });
    return inv ? { id: inv.id, invoiceNumber: String(inv.invoiceNumber ?? inv.id) } : null;
  };

  return {
    id: s.id,
    publicToken: s.publicToken,
    warehouseId: s.warehouseId,
    warehouseName: await warehouseName(s.warehouseId),
    status: s.status,
    notes: s.notes,
    createdAt: s.createdAt,
    submittedAt: s.submittedAt,
    finalizedAt: s.finalizedAt,
    saleInvoice: await invoiceNumbers(s.saleInvoiceId),
    purchaseInvoice: await invoiceNumbers(s.purchaseInvoiceId),
    lineCount: lines.length,
    items,
    uncounted,
  };
}

export async function setLineCountDecision(id: string, decision: LineCountDecision, productId?: string) {
  const s = await loadSession(id);
  if (s.status !== "SUBMITTED") throw new AppError("الجلسة ليست بانتظار المراجعة", 400, "LINE_COUNT_NOT_SUBMITTED");
  // "All" only touches real variances; matched rows need no decision.
  const res = await prisma.$executeRaw`
    UPDATE line_count_results SET decision = ${decision}
    WHERE session_id = ${id}::uuid
      AND counted_qty <> system_qty
      AND (${productId ?? null}::uuid IS NULL OR product_id = ${productId ?? null}::uuid)`;
  return { updated: res };
}

export async function cancelLineCount(id: string) {
  const s = await loadSession(id);
  if (s.status === "FINALIZED") throw new AppError("الجلسة معتمدة ولا يمكن إلغاؤها", 400, "LINE_COUNT_FINALIZED");
  await prisma.lineCountSession.update({ where: { id }, data: { status: "CANCELLED" } });
  return { cancelled: true };
}

/** Sends a submitted count back to the worker (e.g. «أعد العدّ»). Lines stay. */
export async function reopenLineCount(id: string) {
  const s = await loadSession(id);
  if (s.status !== "SUBMITTED") throw new AppError("يمكن إعادة فتح جلسة مرفوعة فقط", 400, "LINE_COUNT_NOT_SUBMITTED");
  await prisma.$transaction([
    prisma.lineCountResult.deleteMany({ where: { sessionId: id } }),
    prisma.lineCountSession.update({ where: { id }, data: { status: "OPEN", submittedAt: null } }),
  ]);
  return { reopened: true };
}

export async function finalizeLineCount(id: string, userId: string) {
  const s = await loadSession(id);
  if (s.status !== "SUBMITTED") throw new AppError("الجلسة ليست بانتظار المراجعة", 400, "LINE_COUNT_NOT_SUBMITTED");
  const results = await prisma.lineCountResult.findMany({ where: { sessionId: id } });
  const variances = results.filter((r) => r.countedQty !== r.systemQty);
  if (variances.some((r) => r.decision === "PENDING"))
    throw new AppError("باقي فروقات بلا قرار — اقبل أو ارفض كل مادة أولاً", 400, "LINE_COUNT_PENDING");

  const accepted = variances.filter((r) => r.decision === "ACCEPTED");
  const products = await prisma.product.findMany({
    where: { id: { in: accepted.map((r) => r.productId) } },
    select: { id: true, name: true, salePrice: true, costPrice: true, purchasePrice: true },
  });
  const pmap = new Map(products.map((p) => [p.id, p]));

  // The snapshot delta is the true miscount; sales after submit already moved
  // stock on their own, so we never recompute against live stock here.
  const saleItems: { productId: string; quantity: number; unitPrice: number }[] = [];
  const purchaseItems: { productId: string; quantity: number; unitPrice: number }[] = [];
  const noPrice: string[] = [];
  for (const r of accepted) {
    const p = pmap.get(r.productId);
    if (!p) continue;
    const delta = r.countedQty - r.systemQty;
    if (delta < 0) {
      const price = Math.round(Number(p.salePrice ?? 0));
      if (!(price > 0)) noPrice.push(`${p.name} (سعر البيع)`);
      else saleItems.push({ productId: p.id, quantity: -delta, unitPrice: price });
    } else {
      const cost = Math.round(Number(p.costPrice ?? 0) || Number(p.purchasePrice ?? 0));
      if (!(cost > 0)) noPrice.push(`${p.name} (الكلفة)`);
      else purchaseItems.push({ productId: p.id, quantity: delta, unitPrice: cost });
    }
  }
  if (noPrice.length > 0)
    throw new AppError(`هذه المواد بلا سعر — عدّلها أو ارفضها: ${noPrice.slice(0, 8).join("، ")}${noPrice.length > 8 ? "…" : ""}`, 400, "LINE_COUNT_NO_PRICE");

  let supplierId = "";
  if (purchaseItems.length > 0) {
    const settings = await getSettings();
    supplierId = settings.stocktakeOverageSupplierId?.trim() ?? "";
    if (!supplierId) throw new AppError("حدّد حساب فاتورة الزيادة من إعدادات الجرد أولاً", 400, "NO_OVERAGE_SUPPLIER");
  }
  const walkIn = saleItems.length > 0 ? await getOrCreateWalkInCustomer() : null;
  const label = `جرد بالسطور — ${await warehouseName(s.warehouseId)}`;

  return prisma.$transaction(
    async (tx) => {
      // Claim the session first so a double click can't book twice.
      const claim = await tx.lineCountSession.updateMany({
        where: { id, status: "SUBMITTED" },
        data: { status: "FINALIZED", finalizedAt: new Date(), finalizedBy: userId },
      });
      if (claim.count !== 1) throw new AppError("الجلسة اعتُمدت مسبقاً", 409, "LINE_COUNT_FINALIZED");

      let saleInvoiceId: string | null = null;
      let purchaseInvoiceId: string | null = null;
      if (walkIn && saleItems.length > 0) {
        const inv = await createInvoice(
          {
            customerId: walkIn.id,
            type: InvoiceType.SALE,
            discount: 0,
            tax: 0,
            paidAmount: saleItems.reduce((t, i) => t + i.quantity * i.unitPrice, 0),
            paymentType: PaymentType.CASH,
            branchId: s.warehouseId,
            notes: `${label} — نقص`,
            items: saleItems.map((i) => ({ ...i, warehouseId: s.warehouseId, unit: Unit.PIECE, allowNegativeStock: true })),
          },
          userId,
          tx,
        );
        saleInvoiceId = inv.id;
      }
      if (purchaseItems.length > 0) {
        const inv = await createInvoice(
          {
            customerId: supplierId,
            type: InvoiceType.PURCHASE,
            discount: 0,
            tax: 0,
            paidAmount: purchaseItems.reduce((t, i) => t + i.quantity * i.unitPrice, 0),
            paymentType: PaymentType.CASH,
            branchId: s.warehouseId,
            notes: `${label} — زيادة`,
            items: purchaseItems.map((i) => ({ ...i, warehouseId: s.warehouseId, unit: Unit.PIECE })),
          },
          userId,
          tx,
        );
        purchaseInvoiceId = inv.id;
      }
      await tx.lineCountSession.update({ where: { id }, data: { saleInvoiceId, purchaseInvoiceId } });
      return { saleInvoiceId, purchaseInvoiceId, saleLines: saleItems.length, purchaseLines: purchaseItems.length };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

// ─── Public (worker link) ───────────────────────────────────────────────────

async function sessionByToken(token: string) {
  const s = await prisma.lineCountSession.findUnique({ where: { publicToken: token } });
  if (!s) throw new AppError("رابط الجرد غير صالح", 404, "LINE_COUNT_NOT_FOUND");
  return s;
}

/** Session header + the whole catalogue (no images, no stock numbers). */
export async function publicGetLineCount(token: string) {
  const s = await sessionByToken(token);
  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, itemNumber: true, qrCode: true, cartonQrCode: true, category: true, pcsPerCarton: true },
    orderBy: { name: "asc" },
  });
  return {
    id: s.id,
    status: s.status,
    notes: s.notes,
    warehouseName: await warehouseName(s.warehouseId),
    createdAt: s.createdAt,
    products,
  };
}

export async function publicSubmitLineCount(token: string, lines: SubmittedLine[]) {
  const s = await sessionByToken(token);
  // A retry after a dropped response lands here with the work already saved.
  if (s.status === "SUBMITTED" || s.status === "FINALIZED") return { alreadySubmitted: true, status: s.status };
  if (s.status !== "OPEN") throw new AppError("هذه الجلسة ملغاة", 400, "LINE_COUNT_CANCELLED");
  if (lines.length === 0) throw new AppError("ما مكتوب ولا سطر", 400, "LINE_COUNT_EMPTY");

  const ids = [...new Set(lines.map((l) => l.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, pcsPerCarton: true } });
  const ppc = new Map(products.map((p) => [p.id, Math.max(1, p.pcsPerCarton)]));
  const missing = ids.filter((pid) => !ppc.has(pid));
  if (missing.length > 0) throw new AppError("بعض المواد انحذفت من النظام — حدّث الصفحة", 400, "LINE_COUNT_UNKNOWN_PRODUCT");

  const now = new Date();
  const rows = lines.map((l, i) => {
    const writtenAt = new Date(l.writtenAt);
    return {
      sessionId: s.id,
      position: i + 1,
      productId: l.productId,
      qty: l.qty,
      unit: l.unit,
      // Carton size is read from the DB, never trusted from the phone.
      qtyPieces: l.unit === "CARTON" ? l.qty * (ppc.get(l.productId) ?? 1) : l.qty,
      writtenAt: Number.isNaN(writtenAt.getTime()) || writtenAt > now ? now : writtenAt,
    };
  });

  const sums = new Map<string, { qty: number; first: Date }>();
  for (const r of rows) {
    const cur = sums.get(r.productId);
    if (cur) {
      cur.qty += r.qtyPieces;
      if (r.writtenAt < cur.first) cur.first = r.writtenAt;
    } else sums.set(r.productId, { qty: r.qtyPieces, first: r.writtenAt });
  }

  return prisma.$transaction(
    async (tx) => {
      const claim = await tx.lineCountSession.updateMany({
        where: { id: s.id, status: "OPEN" },
        data: { status: "SUBMITTED", submittedAt: now },
      });
      if (claim.count !== 1) return { alreadySubmitted: true, status: "SUBMITTED" };
      await tx.lineCountLine.deleteMany({ where: { sessionId: s.id } });
      await tx.lineCountResult.deleteMany({ where: { sessionId: s.id } });
      await tx.lineCountLine.createMany({ data: rows });
      // System quantity snapshot at the moment of upload.
      const stocks = await tx.productWarehouseStock.findMany({
        where: { warehouseId: s.warehouseId, productId: { in: ids } },
        select: { productId: true, quantityPieces: true },
      });
      const sys = new Map(stocks.map((x) => [x.productId, x.quantityPieces]));
      await tx.lineCountResult.createMany({
        data: [...sums.entries()].map(([productId, v]) => ({
          sessionId: s.id,
          productId,
          systemQty: sys.get(productId) ?? 0,
          countedQty: v.qty,
          firstWrittenAt: v.first,
        })),
      });
      return { alreadySubmitted: false, status: "SUBMITTED", lines: rows.length, products: sums.size };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
