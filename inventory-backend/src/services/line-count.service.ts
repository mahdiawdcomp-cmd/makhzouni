// «جرد بالسطور» — invoice-style stocktake. The worker opens a token link,
// downloads the whole catalogue once, writes lines (product + qty + unit,
// duplicates allowed) fully offline, and uploads them in a single submit.
// The admin then accepts/rejects each variance; finalize books ONE cash SALE
// invoice to «الزبون النقدي» for accepted shortages and ONE cash PURCHASE
// invoice to the configured overage supplier for accepted overages, both
// through createInvoice (the same stock + ledger + profit path as any invoice).
import { randomBytes } from "crypto";
import { InvoiceType, PaymentType, Prisma, Unit } from "@prisma/client";
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

/** «يمكن العامل غلط بالوحدة»: tries flipping piece↔carton on all the lines,
 * then on each single line, and suggests a flip only when it explains the
 * variance almost entirely — within 30% of the system figure AND at most a
 * fifth of the current gap. Nothing is changed here; the manager applies it
 * with a click and the item goes back to «بلا قرار». With no system stock
 * there is nothing to compare against, so no guess is made. */
export function unitSuggestion(
  systemQty: number,
  countedQty: number,
  ppc: number,
  live: { id: string; qty: number; unit: string; qtyPieces: number }[],
) {
  const size = Math.max(1, ppc);
  const gap = Math.abs(countedQty - systemQty);
  if (size <= 1 || systemQty <= 0 || live.length === 0 || gap < size) return null;
  const flipped = (l: { qty: number; unit: string }) => (l.unit === "CARTON" ? l.qty : l.qty * size);
  const candidates: string[][] = [live.map((l) => l.id)];
  if (live.length > 1) for (const l of live) candidates.push([l.id]);
  let best: { lineIds: string[]; countedQty: number; delta: number } | null = null;
  for (const ids of candidates) {
    const set = new Set(ids);
    const alt = live.reduce((t, l) => t + (set.has(l.id) ? flipped(l) : l.qtyPieces), 0);
    const altGap = Math.abs(alt - systemQty);
    if (altGap > Math.round(systemQty * 0.3) || altGap * 5 > gap) continue;
    if (!best || altGap < Math.abs(best.delta)) best = { lineIds: ids, countedQty: alt, delta: alt - systemQty };
  }
  return best;
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
      workerCountedQty: r.workerCountedQty,
      unitSuggestion: unitSuggestion(r.systemQty, r.countedQty, p?.pcsPerCarton ?? 1, (linesBy.get(r.productId) ?? []).filter((l) => !l.deletedAt)),
      lines: (linesBy.get(r.productId) ?? []).map((l) => ({
        id: l.id,
        position: l.position,
        qty: l.qty,
        unit: l.unit,
        qtyPieces: l.qtyPieces,
        writtenAt: l.writtenAt,
        source: l.source,
        originalQty: l.originalQty,
        originalUnit: l.originalUnit,
        editedAt: l.editedAt,
        deleted: l.deletedAt !== null,
      })),
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
    lineCount: lines.filter((l) => !l.deletedAt).length,
    items,
    uncounted,
  };
}

export async function setLineCountDecision(id: string, decision: LineCountDecision, productId?: string, productIds?: string[]) {
  await loadSession(id);
  // Locked against finalize/reopen so a decision can't slip in after the
  // invoices were computed.
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM line_count_sessions WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows[0]?.status !== "SUBMITTED") throw new AppError("الجلسة ليست بانتظار المراجعة", 400, "LINE_COUNT_NOT_SUBMITTED");
    // "All" only touches real variances; matched rows need no decision.
    if (productIds && productIds.length > 0) {
      // «اقبل المعروض»: exactly the rows the manager is looking at.
      const r = await tx.lineCountResult.updateMany({
        where: { sessionId: id, productId: { in: productIds } },
        data: { decision },
      });
      return { updated: r.count };
    }
    const res = await tx.$executeRaw`
      UPDATE line_count_results SET decision = ${decision}
      WHERE session_id = ${id}::uuid
        AND counted_qty <> system_qty
        AND (${productId ?? null}::uuid IS NULL OR product_id = ${productId ?? null}::uuid)`;
    return { updated: res };
  });
}

export async function cancelLineCount(id: string) {
  await loadSession(id);
  // Conditional: a session finalized a moment ago keeps its invoices' status.
  const r = await prisma.lineCountSession.updateMany({
    where: { id, status: { in: ["OPEN", "SUBMITTED"] } },
    data: { status: "CANCELLED" },
  });
  if (r.count !== 1) throw new AppError("الجلسة معتمدة أو ملغاة مسبقاً", 400, "LINE_COUNT_FINALIZED");
  return { cancelled: true };
}

/** Sends a submitted count back to the worker (e.g. «أعد العدّ»). Lines stay. */
export async function reopenLineCount(id: string) {
  await loadSession(id);
  await prisma.$transaction(async (tx) => {
    // Claim first — racing a finalize, only one of the two can win.
    const r = await tx.lineCountSession.updateMany({
      where: { id, status: "SUBMITTED" },
      data: { status: "OPEN", submittedAt: null, recountProductIds: [] },
    });
    if (r.count !== 1) throw new AppError("يمكن إعادة فتح جلسة مرفوعة فقط", 400, "LINE_COUNT_NOT_SUBMITTED");
    await tx.lineCountResult.deleteMany({ where: { sessionId: id } });
  });
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
    select: { id: true, name: true, salePrice: true, costPrice: true, purchasePrice: true, deletedAt: true },
  });
  const pmap = new Map(products.map((p) => [p.id, p]));

  // The snapshot delta is the true miscount; sales after submit already moved
  // stock on their own, so we never recompute against live stock here.
  const saleItems: { productId: string; quantity: number; unitPrice: number }[] = [];
  const purchaseItems: { productId: string; quantity: number; unitPrice: number }[] = [];
  const noPrice: string[] = [];
  for (const r of accepted) {
    const p = pmap.get(r.productId);
    if (!p || p.deletedAt) {
      noPrice.push(`${p?.name ?? "مادة"} (محذوفة — ارفضها)`);
      continue;
    }
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
    throw new AppError(`هذه المواد ما تنعتمد — عدّلها أو ارفضها: ${noPrice.slice(0, 8).join("، ")}${noPrice.length > 8 ? "…" : ""}`, 400, "LINE_COUNT_NO_PRICE");

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
      // The invoices were priced from a read taken before the claim — make sure
      // nothing changed in between (a decision, or a reopen + resubmit).
      const now = await tx.lineCountResult.findMany({ where: { sessionId: id } });
      const key = (r: { productId: string; countedQty: number; systemQty: number; decision: string }) =>
        `${r.productId}|${r.countedQty}|${r.systemQty}|${r.decision}`;
      const before = new Set(results.map(key));
      if (now.length !== results.length || now.some((r) => !before.has(key(r))))
        throw new AppError("تغيّرت القرارات أثناء الاعتماد — حدّث الصفحة وأعد المحاولة", 409, "LINE_COUNT_CHANGED");

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
            origin: "STOCK_COUNT",
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
            origin: "STOCK_COUNT",
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

/** Warehouse stock per product as it stood when each product was first
 * written. The shelf was counted at the first line, possibly hours before
 * upload, so the live figure is rolled back by whatever moved since — a sale
 * made after the count must not read as an overage (and become a purchase). */
async function systemSnapshot(tx: Prisma.TransactionClient, warehouseId: string, firstAt: Map<string, Date>, now: Date) {
  const ids = [...firstAt.keys()];
  const stocks = await tx.productWarehouseStock.findMany({
    where: { warehouseId, productId: { in: ids } },
    select: { productId: true, quantityPieces: true },
  });
  const sys = new Map(stocks.map((x) => [x.productId, x.quantityPieces]));
  if (ids.length === 0) return sys;
  const earliest = [...firstAt.values()].reduce((m, v) => (v < m ? v : m), now);
  const moves = await tx.stockMovement.findMany({
    where: { branchId: warehouseId, productId: { in: ids }, createdAt: { gt: earliest, lte: now } },
    select: { productId: true, type: true, quantity: true, createdAt: true },
  });
  for (const m of moves) {
    const first = firstAt.get(m.productId);
    if (!first || m.createdAt <= first) continue;
    const signed = m.type === "IN" ? m.quantity : -m.quantity;
    sys.set(m.productId, (sys.get(m.productId) ?? 0) - signed);
  }
  return sys;
}

// ─── Manager corrections (review page) ──────────────────────────────────────
// Every correction runs under the session row lock, only while the count waits
// for review, and puts the product's decision back to PENDING: a changed
// number is never booked without the manager accepting it again.

async function underReviewLock<T>(id: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  await loadSession(id);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM line_count_sessions WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows[0]?.status !== "SUBMITTED") throw new AppError("الجلسة ليست بانتظار المراجعة", 400, "LINE_COUNT_NOT_SUBMITTED");
    return fn(tx);
  });
}

async function productCartonSize(tx: Prisma.TransactionClient, productId: string) {
  const p = await tx.product.findUnique({ where: { id: productId }, select: { pcsPerCarton: true } });
  return Math.max(1, p?.pcsPerCarton ?? 1);
}

const toPieces = (qty: number, unit: string, ppc: number) => (unit === "CARTON" ? qty * ppc : qty);

/** Re-sums a product's live lines into its result. No live line left means
 * the product counts as never counted — its stock is left untouched. */
async function recomputeResult(tx: Prisma.TransactionClient, sessionId: string, productId: string) {
  const result = await tx.lineCountResult.findUnique({ where: { sessionId_productId: { sessionId, productId } } });
  if (!result) throw new AppError("المادة مو ضمن هذا الجرد", 404, "LINE_COUNT_ITEM_NOT_FOUND");
  const live = await tx.lineCountLine.findMany({ where: { sessionId, productId, deletedAt: null }, select: { qtyPieces: true } });
  if (live.length === 0) {
    await tx.lineCountResult.delete({ where: { id: result.id } });
    return null;
  }
  const counted = live.reduce((t, l) => t + l.qtyPieces, 0);
  return tx.lineCountResult.update({
    where: { id: result.id },
    data: {
      countedQty: counted,
      workerCountedQty: result.workerCountedQty ?? result.countedQty,
      decision: "PENDING",
    },
  });
}

async function liveLine(tx: Prisma.TransactionClient, sessionId: string, lineId: string) {
  const line = await tx.lineCountLine.findFirst({ where: { id: lineId, sessionId, deletedAt: null } });
  if (!line) throw new AppError("السطر غير موجود أو محذوف", 404, "LINE_COUNT_LINE_NOT_FOUND");
  return line;
}

export async function editLineCountLine(id: string, lineId: string, qty: number, unit: LineCountUnit, userId: string) {
  return underReviewLock(id, async (tx) => {
    const line = await liveLine(tx, id, lineId);
    const ppc = await productCartonSize(tx, line.productId);
    const u = ppc > 1 ? unit : "PIECE";
    await tx.lineCountLine.update({
      where: { id: line.id },
      data: {
        qty,
        unit: u,
        qtyPieces: toPieces(qty, u, ppc),
        // Keep what the worker wrote; a second correction doesn't overwrite it.
        originalQty: line.source === "WORKER" ? (line.originalQty ?? line.qty) : line.originalQty,
        originalUnit: line.source === "WORKER" ? (line.originalUnit ?? line.unit) : line.originalUnit,
        editedBy: userId,
        editedAt: new Date(),
      },
    });
    return recomputeResult(tx, id, line.productId);
  });
}

export async function deleteLineCountLine(id: string, lineId: string, userId: string) {
  return underReviewLock(id, async (tx) => {
    const line = await liveLine(tx, id, lineId);
    await tx.lineCountLine.update({ where: { id: line.id }, data: { deletedAt: new Date(), editedBy: userId, editedAt: new Date() } });
    return recomputeResult(tx, id, line.productId);
  });
}

/** «عدّل الكمية»: the manager's own total replaces the worker's lines (kept as a trace). */
export async function setLineCountProductTotal(id: string, productId: string, qty: number, unit: LineCountUnit, userId: string) {
  return underReviewLock(id, async (tx) => {
    const result = await tx.lineCountResult.findUnique({ where: { sessionId_productId: { sessionId: id, productId } } });
    if (!result) throw new AppError("المادة مو ضمن هذا الجرد", 404, "LINE_COUNT_ITEM_NOT_FOUND");
    const ppc = await productCartonSize(tx, productId);
    const u = ppc > 1 ? unit : "PIECE";
    const now = new Date();
    await tx.lineCountLine.updateMany({ where: { sessionId: id, productId, deletedAt: null }, data: { deletedAt: now, editedBy: userId, editedAt: now } });
    const last = await tx.lineCountLine.aggregate({ where: { sessionId: id }, _max: { position: true } });
    await tx.lineCountLine.create({
      data: {
        sessionId: id,
        position: (last._max.position ?? 0) + 1,
        productId,
        qty,
        unit: u,
        qtyPieces: toPieces(qty, u, ppc),
        // The shelf time stays the worker's, so the system snapshot still matches.
        writtenAt: result.firstWrittenAt,
        source: "ADMIN",
        editedBy: userId,
        editedAt: now,
      },
    });
    return recomputeResult(tx, id, productId);
  });
}

/** «صحّح الوحدة»: flips piece↔carton on exactly the lines the manager approved. */
export async function swapLineCountUnits(id: string, productId: string, lineIds: string[], userId: string) {
  return underReviewLock(id, async (tx) => {
    const ppc = await productCartonSize(tx, productId);
    if (ppc <= 1) throw new AppError("هاي المادة ما إلها كارتون", 400, "LINE_COUNT_NO_CARTON");
    const lines = await tx.lineCountLine.findMany({ where: { sessionId: id, productId, deletedAt: null, id: { in: lineIds } } });
    if (lines.length !== new Set(lineIds).size) throw new AppError("السطور تغيّرت — حدّث الصفحة", 409, "LINE_COUNT_CHANGED");
    const now = new Date();
    for (const line of lines) {
      const unit = line.unit === "CARTON" ? "PIECE" : "CARTON";
      await tx.lineCountLine.update({
        where: { id: line.id },
        data: {
          unit,
          qtyPieces: toPieces(line.qty, unit, ppc),
          originalQty: line.source === "WORKER" ? (line.originalQty ?? line.qty) : line.originalQty,
          originalUnit: line.source === "WORKER" ? (line.originalUnit ?? line.unit) : line.originalUnit,
          editedBy: userId,
          editedAt: now,
        },
      });
    }
    return recomputeResult(tx, id, productId);
  });
}

/** «أعد عدّ المختار»: the same link reopens with only these products. */
export async function requestLineCountRecount(id: string, productIds: string[]) {
  return underReviewLock(id, async (tx) => {
    const ids = [...new Set(productIds)];
    const found = await tx.lineCountResult.count({ where: { sessionId: id, productId: { in: ids } } });
    if (ids.length === 0 || found !== ids.length) throw new AppError("اختر مواد من هذا الجرد", 400, "LINE_COUNT_ITEM_NOT_FOUND");
    await tx.lineCountSession.update({
      where: { id },
      data: { status: "OPEN", submittedAt: null, recountProductIds: ids, recountRound: { increment: 1 } },
    });
    return { reopened: true, products: ids.length };
  });
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
  // The whole catalogue is served only while the count is open — a finished
  // link must not keep exposing it to whoever still holds the URL.
  const recount = s.recountProductIds;
  const products = s.status !== "OPEN" ? [] : await prisma.product.findMany({
    where: { deletedAt: null, ...(recount.length > 0 ? { id: { in: recount } } : {}) },
    select: { id: true, name: true, itemNumber: true, qrCode: true, cartonQrCode: true, category: true, pcsPerCarton: true },
    orderBy: { name: "asc" },
  });
  return {
    id: s.id,
    status: s.status,
    notes: s.notes,
    warehouseName: await warehouseName(s.warehouseId),
    createdAt: s.createdAt,
    // Non-empty = only these products are to be recounted; the round keys the
    // phone's local lines so an older round is never re-sent.
    recountProductIds: recount,
    recountRound: recount.length > 0 ? s.recountRound : 0,
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
  const recount = new Set(s.recountProductIds);
  if (recount.size > 0 && ids.some((pid) => !recount.has(pid)))
    throw new AppError("المطلوب إعادة عدّ مواد محددة فقط — حدّث الصفحة", 400, "LINE_COUNT_NOT_IN_RECOUNT");
  const products = await prisma.product.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, pcsPerCarton: true } });
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
        data: { status: "SUBMITTED", submittedAt: now, recountProductIds: [] },
      });
      if (claim.count !== 1) return { alreadySubmitted: true, status: "SUBMITTED" };
      if (recount.size > 0) {
        // Partial recount: only the recounted products are replaced. Their old
        // lines stay as a trace; every other product keeps its result and decision.
        await tx.lineCountLine.updateMany({ where: { sessionId: s.id, productId: { in: ids }, deletedAt: null }, data: { deletedAt: now } });
        await tx.lineCountResult.deleteMany({ where: { sessionId: s.id, productId: { in: ids } } });
        const last = await tx.lineCountLine.aggregate({ where: { sessionId: s.id }, _max: { position: true } });
        const base = last._max.position ?? 0;
        await tx.lineCountLine.createMany({ data: rows.map((r, i) => ({ ...r, position: base + i + 1 })) });
      } else {
        await tx.lineCountLine.deleteMany({ where: { sessionId: s.id } });
        await tx.lineCountResult.deleteMany({ where: { sessionId: s.id } });
        await tx.lineCountLine.createMany({ data: rows });
      }
      const sys = await systemSnapshot(tx, s.warehouseId, new Map([...sums].map(([k, v]) => [k, v.first])), now);
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
