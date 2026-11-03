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

/** The phone's upload envelope. `submitId` is made once per round on the phone:
 * a retry with the same id is "already done", a different id is another phone.
 * `sentAt` is the phone's clock at send time, used to correct its drift. */
export interface SubmitOptions {
  submitId?: string;
  sentAt?: string;
}

// A line's quantity in pieces can't sensibly exceed this — a bigger figure is a
// barcode scanned into the quantity box.
const MAX_LINE_PIECES = 10_000_000;

type Db = Prisma.TransactionClient | typeof prisma;

/** «السجل»: who did what to the count, shown on the review page. */
async function logEvent(
  db: Db,
  sessionId: string,
  action: string,
  userId?: string | null,
  userName?: string | null,
  detail?: Prisma.InputJsonValue,
) {
  await db.lineCountEvent.create({ data: { sessionId, action, userId: userId ?? null, userName: userName ?? null, detail } });
}

// ─── Worker drafts ──────────────────────────────────────────────────────────
// The phone keeps every line locally and also sends them here while it is
// online, so a dead battery or another phone doesn't lose the count and the
// manager sees progress before the upload.
type DraftEntry = { round: number; at: string; lines: SubmittedLine[] };

function draftEntries(draft: Prisma.JsonValue | null): Record<string, DraftEntry> {
  return draft && typeof draft === "object" && !Array.isArray(draft) ? (draft as unknown as Record<string, DraftEntry>) : {};
}

const currentRound = (s: { recountProductIds: string[]; recountRound: number }) => (s.recountProductIds.length > 0 ? s.recountRound : 0);

/** The newest phone's draft for this round, plus how many phones sent one. */
function latestDraft(draft: Prisma.JsonValue | null, round: number) {
  const entries = Object.values(draftEntries(draft)).filter((e) => e.round === round && Array.isArray(e.lines));
  if (entries.length === 0) return null;
  const latest = entries.reduce((a, b) => (a.at > b.at ? a : b));
  return { lines: latest.lines, at: latest.at, devices: entries.length };
}

function makeToken() {
  return `lct_${randomBytes(24).toString("base64url")}`;
}

async function warehouseName(id: string) {
  const b = await prisma.branch.findUnique({ where: { id }, select: { name: true } });
  return b?.name ?? "";
}

// ─── Admin ──────────────────────────────────────────────────────────────────

export async function createLineCount(createdBy: string, warehouseId?: string, notes?: string, createdByName?: string) {
  const wid = warehouseId ? await resolveWarehouseId(prisma, warehouseId) : await resolveShopWarehouseId(prisma);
  // One live count per warehouse — two would race to book the same variances.
  const live = await prisma.lineCountSession.findFirst({
    where: { warehouseId: wid, status: { in: ["OPEN", "SUBMITTED"] } },
    select: { id: true },
  });
  const exists = () => new AppError("يوجد جرد بالسطور مفتوح لهذا المخزن — كمّله أو ألغِه أولاً", 409, "LINE_COUNT_EXISTS");
  if (live) throw exists();
  try {
    const created = await prisma.lineCountSession.create({
      data: { publicToken: makeToken(), warehouseId: wid, createdBy, notes: notes?.trim() || null },
    });
    await logEvent(prisma, created.id, "CREATE", createdBy, createdByName);
    return created;
  } catch (e) {
    // Two clicks at once: the partial unique index lets only one through.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw exists();
    throw e;
  }
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
    // Sent back for recount: the count is OPEN but still reviewable.
    recountCount: r.recountProductIds.length,
    // What the worker's phone has sent so far (before the upload).
    progress: r.status === "OPEN" ? draftProgress(r) : null,
  }));
}

function draftProgress(r: { draft: Prisma.JsonValue | null; recountProductIds: string[]; recountRound: number }) {
  const d = latestDraft(r.draft, currentRound(r));
  return d ? { lines: d.lines.length, products: new Set(d.lines.map((l) => l.productId)).size, at: d.at, devices: d.devices } : null;
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
    select: { id: true, name: true, itemNumber: true, category: true, pcsPerCarton: true, salePrice: true, costPrice: true, purchasePrice: true, deletedAt: true },
  });
  const pmap = new Map(products.map((p) => [p.id, p]));
  const current = new Map(
    (await prisma.productWarehouseStock.findMany({
      where: { warehouseId: s.warehouseId, productId: { in: productIds } },
      select: { productId: true, quantityPieces: true },
    })).map((x) => [x.productId, x.quantityPieces]),
  );
  const events = await prisma.lineCountEvent.findMany({ where: { sessionId: id }, orderBy: { createdAt: "desc" }, take: 300 });
  const userIds = [...new Set([
    ...results.map((r) => r.decidedBy),
    ...lines.map((l) => l.editedBy),
    s.createdBy,
    s.finalizedBy,
  ].filter((x): x is string => !!x))];
  const userName = new Map(
    (await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );

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
    const first = r.systemQtyFirst ?? r.systemQty;
    const ambiguous = r.systemQtyLast !== null && r.systemQtyLast !== first;
    return {
      productId: r.productId,
      productName: p?.name ?? "(مادة محذوفة)",
      itemNumber: p?.itemNumber ?? null,
      category: p?.category ?? null,
      pcsPerCarton: p?.pcsPerCarton ?? 1,
      systemQty: r.systemQty,
      countedQty: r.countedQty,
      // Warehouse stock right now, next to the at-count figure.
      currentQty: current.get(r.productId) ?? 0,
      delta,
      decision: r.decision as LineCountDecision,
      decidedBy: r.decidedBy ? (userName.get(r.decidedBy) ?? null) : null,
      decidedAt: r.decidedAt,
      // Both sides valued at cost — the real loss or gain. The shortage sale
      // invoice is priced at sale price; that figure is `saleValue`.
      unitPrice: cost,
      value: Math.abs(delta) * cost,
      saleValue: delta < 0 ? -delta * salePrice : 0,
      // Finalize refuses these; the page filters them and quick-accept skips them.
      noPrice: delta !== 0 && !(delta < 0 ? salePrice > 0 : cost > 0),
      deleted: !p || p.deletedAt !== null,
      firstWrittenAt: r.firstWrittenAt,
      lastWrittenAt: r.lastWrittenAt,
      // Stock moved between the product's first and last line: the system
      // figure depends on which moment is the real count. The manager picks.
      ambiguous,
      systemQtyFirst: first,
      systemQtyLast: r.systemQtyLast,
      basis: ambiguous && r.systemQty === r.systemQtyLast ? "LAST" : "FIRST",
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
        editedBy: l.editedBy ? (userName.get(l.editedBy) ?? null) : null,
        deleted: l.deletedAt !== null,
      })),
    };
  });
  items.sort((a, b) => (a.delta === 0 ? 1 : 0) - (b.delta === 0 ? 1 : 0) || b.value - a.value || Math.abs(b.delta) - Math.abs(a.delta));

  // Products holding stock in this warehouse that no line touched — left as-is.
  // A finalized count shows exactly what went into the watch list then, not a
  // list rebuilt from today's stock.
  const counted = new Set(productIds);
  let uncounted: { productId: string; productName: string; itemNumber: string | null; pcsPerCarton: number; systemQty: number }[];
  if (s.status === "FINALIZED") {
    const watched = await prisma.lineCountWatch.findMany({ where: { sessionId: id }, select: { productId: true, systemQty: true } });
    const wp = new Map(
      (await prisma.product.findMany({ where: { id: { in: watched.map((w) => w.productId) } }, select: { id: true, name: true, itemNumber: true, pcsPerCarton: true } }))
        .map((p) => [p.id, p]),
    );
    uncounted = watched
      .map((w) => {
        const p = wp.get(w.productId);
        return { productId: w.productId, productName: p?.name ?? "(مادة محذوفة)", itemNumber: p?.itemNumber ?? null, pcsPerCarton: p?.pcsPerCarton ?? 1, systemQty: w.systemQty };
      })
      .sort((a, b) => a.productName.localeCompare(b.productName, "ar"));
  } else {
    const stocks = await prisma.productWarehouseStock.findMany({
      where: { warehouseId: s.warehouseId, quantityPieces: { not: 0 }, product: { deletedAt: null } },
      select: { productId: true, quantityPieces: true, product: { select: { name: true, itemNumber: true, pcsPerCarton: true } } },
      orderBy: { product: { name: "asc" } },
    });
    uncounted = stocks
      .filter((x) => !counted.has(x.productId))
      .map((x) => ({ productId: x.productId, productName: x.product.name, itemNumber: x.product.itemNumber, pcsPerCarton: x.product.pcsPerCarton, systemQty: x.quantityPieces }));
  }

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
    recountProductIds: s.recountProductIds,
    keptProductIds: s.keptProductIds,
    recountRequestedAt: s.recountRequestedAt,
    progress: s.status === "OPEN" ? draftProgress(s) : null,
    createdByName: userName.get(s.createdBy) ?? null,
    finalizedByName: s.finalizedBy ? (userName.get(s.finalizedBy) ?? null) : null,
    items,
    uncounted,
    events: events.map((e) => ({ id: e.id, action: e.action, userName: e.userName, detail: e.detail, createdAt: e.createdAt })),
  };
}

export async function setLineCountDecision(
  id: string,
  decision: LineCountDecision,
  productId?: string,
  productIds?: string[],
  userId?: string,
  userName?: string,
  // «اقبل» on a product with no price: the manager types it right there —
  // cost for an overage, sale price for a shortage — and it is saved on the product.
  price?: number,
) {
  await loadSession(id);
  // Locked against finalize/reopen so a decision can't slip in after the
  // invoices were computed.
  return prisma.$transaction(async (tx) => {
    await lockReviewable(tx, id);
    const decidedBy = decision === "PENDING" ? null : (userId ?? null);
    const decided = decision !== "PENDING";
    // Bulk accept/reject («اقبل الكل»، «اقبل المعروض»، the quick groups) only
    // decides rows still undecided — an earlier decision is never flipped by a
    // bulk click. Only a single row, or a bulk reset to PENDING, changes a
    // decided one. Matched rows never need a decision.
    const list = productIds && productIds.length > 0 ? productIds : null;
    const single = !list && productId ? productId : null;
    const bulkOnlyPending = !single && decision !== "PENDING";
    const res = await tx.$executeRaw`
      UPDATE line_count_results SET decision = ${decision}, decided_by = ${decidedBy}::uuid,
        decided_at = CASE WHEN ${decided} THEN (now() AT TIME ZONE 'UTC') ELSE NULL END
      WHERE session_id = ${id}::uuid
        AND counted_qty <> system_qty
        AND (${list}::uuid[] IS NULL OR product_id = ANY(${list}::uuid[]))
        AND (${single}::uuid IS NULL OR product_id = ${single}::uuid)
        AND (${bulkOnlyPending} = false OR decision = 'PENDING')
        -- A bulk click never touches products that are back with the worker.
        AND (${single}::uuid IS NOT NULL OR NOT EXISTS (
          SELECT 1 FROM line_count_sessions ss
          WHERE ss.id = ${id}::uuid AND line_count_results.product_id::text = ANY(ss.recount_product_ids)))`;
    if (single) {
      if (price !== undefined && decision === "ACCEPTED") {
        const r = await tx.lineCountResult.findUnique({ where: { sessionId_productId: { sessionId: id, productId: single } } });
        if (r) {
          const value = Math.round(price);
          await tx.product.update({
            where: { id: single },
            data: r.countedQty < r.systemQty ? { salePrice: value } : { costPrice: value, purchasePrice: value },
          });
        }
      }
      await dropFromRecount(tx, id, [single]);
    }
    await logEvent(tx, id, "DECISION", userId, userName, {
      decision,
      updated: res,
      ...(price !== undefined ? { price: Math.round(price) } : {}),
      ...(single ? { productId: single } : { bulk: list ? list.length : "ALL" }),
    });
    return { updated: res };
  });
}

/** «احسب على وقت آخر سطر»: a product written at two moments with stock moving
 * in between — the manager says which moment the shelf really stood at. */
export async function setLineCountBasis(id: string, productId: string, basis: "FIRST" | "LAST", userId?: string, userName?: string) {
  return underReviewLock(id, async (tx) => {
    const r = await tx.lineCountResult.findUnique({ where: { sessionId_productId: { sessionId: id, productId } } });
    if (!r) throw new AppError("المادة مو ضمن هذا الجرد", 404, "LINE_COUNT_ITEM_NOT_FOUND");
    const first = r.systemQtyFirst ?? r.systemQty;
    if (r.systemQtyLast === null || r.systemQtyLast === first)
      throw new AppError("هاي المادة ما تحتاج اختيار وقت", 400, "LINE_COUNT_NOT_AMBIGUOUS");
    const systemQty = basis === "LAST" ? r.systemQtyLast : first;
    await tx.lineCountResult.update({
      where: { id: r.id },
      data: { systemQty, systemQtyFirst: first, decision: "PENDING", decidedBy: null, decidedAt: null },
    });
    await logEvent(tx, id, "BASIS", userId, userName, { productId, basis, systemQty });
    return { systemQty };
  });
}

export async function cancelLineCount(id: string, userId?: string, userName?: string) {
  await loadSession(id);
  // Conditional: a session finalized a moment ago keeps its invoices' status.
  const r = await prisma.lineCountSession.updateMany({
    where: { id, status: { in: ["OPEN", "SUBMITTED"] } },
    data: { status: "CANCELLED", draft: Prisma.DbNull },
  });
  if (r.count !== 1) throw new AppError("الجلسة معتمدة أو ملغاة مسبقاً", 400, "LINE_COUNT_FINALIZED");
  await logEvent(prisma, id, "CANCEL", userId, userName);
  return { cancelled: true };
}

/** Sends a submitted count back to the worker (e.g. «أعد العدّ»). Lines stay. */
export async function reopenLineCount(id: string, userId?: string, userName?: string) {
  await loadSession(id);
  await prisma.$transaction(async (tx) => {
    // Claim first — racing a finalize, only one of the two can win.
    const r = await tx.lineCountSession.updateMany({
      where: { id, status: "SUBMITTED" },
      data: { status: "OPEN", submittedAt: null, recountProductIds: [] },
    });
    if (r.count !== 1) throw new AppError("يمكن إعادة فتح جلسة مرفوعة فقط", 400, "LINE_COUNT_NOT_SUBMITTED");
    await tx.lineCountResult.deleteMany({ where: { sessionId: id } });
    await logEvent(tx, id, "REOPEN", userId, userName);
  });
  return { reopened: true };
}

export async function finalizeLineCount(id: string, userId: string, userName?: string) {
  const s = await loadSession(id);
  if (s.status === "OPEN" && s.recountProductIds.length > 0)
    throw new AppError(`باقي ${s.recountProductIds.length} مادة عند العامل — قرر عليها أو انتظر رفعه`, 400, "LINE_COUNT_RECOUNT_OPEN");
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
    throw new AppError(
      `${noPrice.length} مادة ما تنعتمد — عدّلها أو ارفضها (فلتر «بلا سعر أو محذوفة» يجمعها): ${noPrice.slice(0, 8).join("، ")}${noPrice.length > 8 ? "…" : ""}`,
      400,
      "LINE_COUNT_NO_PRICE",
    );

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
      // Products with stock that nobody counted are left untouched but watched:
      // no sale and no later count within two months → «المواد الراكدة».
      const counted = new Set(now.map((r) => r.productId));
      const left = await tx.productWarehouseStock.findMany({
        where: { warehouseId: s.warehouseId, quantityPieces: { not: 0 }, product: { deletedAt: null } },
        select: { productId: true, quantityPieces: true },
      });
      const watched = left.filter((x) => !counted.has(x.productId));
      if (watched.length > 0)
        await tx.lineCountWatch.createMany({
          data: watched.map((x) => ({
            sessionId: id,
            warehouseId: s.warehouseId,
            productId: x.productId,
            countedAt: s.submittedAt ?? new Date(),
            systemQty: x.quantityPieces,
          })),
          skipDuplicates: true,
        });
      await logEvent(tx, id, "FINALIZE", userId, userName, { saleLines: saleItems.length, purchaseLines: purchaseItems.length, watched: watched.length });
      return { saleInvoiceId, purchaseInvoiceId, saleLines: saleItems.length, purchaseLines: purchaseItems.length, watched: watched.length };
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
  // Lock the stock rows first: a sale committing between the stock read and
  // the movements read would be undone without ever having been counted.
  if (ids.length > 0)
    await tx.$queryRaw`SELECT 1 FROM product_warehouse_stocks WHERE warehouse_id = ${warehouseId}::uuid AND product_id = ANY(${ids}::uuid[]) FOR UPDATE`;
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
    await lockReviewable(tx, id);
    return fn(tx);
  });
}

/** The count can be worked on while it waits for review — and also while some
 * products are back with the worker: a recount never locks the rest. */
async function lockReviewable(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<{ status: string; recount: number }[]>`
    SELECT status, cardinality(recount_product_ids)::int AS recount FROM line_count_sessions WHERE id = ${id}::uuid FOR UPDATE`;
  const r = rows[0];
  if (!(r?.status === "SUBMITTED" || (r?.status === "OPEN" && r.recount > 0)))
    throw new AppError("الجلسة ليست بانتظار المراجعة", 400, "LINE_COUNT_NOT_SUBMITTED");
  return r;
}

/** The manager settled these products himself — they leave the worker's
 * recount list (his lines for them are dropped on upload). With nothing left
 * at the worker, the count is back in review. */
async function dropFromRecount(tx: Prisma.TransactionClient, id: string, productIds: string[]) {
  if (productIds.length === 0) return;
  await tx.$executeRaw`
    UPDATE line_count_sessions
    SET recount_product_ids = ARRAY(SELECT x FROM unnest(recount_product_ids) x WHERE NOT (x = ANY(${productIds}::text[])))
    WHERE id = ${id}::uuid`;
  await tx.$executeRaw`
    UPDATE line_count_sessions SET status = 'SUBMITTED', draft = NULL
    WHERE id = ${id}::uuid AND status = 'OPEN' AND cardinality(recount_product_ids) = 0`;
}

async function unkeep(tx: Prisma.TransactionClient, id: string, productIds: string[]) {
  if (productIds.length === 0) return;
  await tx.$executeRaw`
    UPDATE line_count_sessions
    SET kept_product_ids = ARRAY(SELECT x FROM unnest(kept_product_ids) x WHERE NOT (x = ANY(${productIds}::text[])))
    WHERE id = ${id}::uuid`;
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
      decidedBy: null,
      decidedAt: null,
    },
  });
}

async function liveLine(tx: Prisma.TransactionClient, sessionId: string, lineId: string) {
  const line = await tx.lineCountLine.findFirst({ where: { id: lineId, sessionId, deletedAt: null } });
  if (!line) throw new AppError("السطر غير موجود أو محذوف", 404, "LINE_COUNT_LINE_NOT_FOUND");
  return line;
}

export async function editLineCountLine(id: string, lineId: string, qty: number, unit: LineCountUnit, userId: string, userName?: string) {
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
    await logEvent(tx, id, "EDIT_LINE", userId, userName, { productId: line.productId, from: { qty: line.qty, unit: line.unit }, to: { qty, unit: u } });
    await dropFromRecount(tx, id, [line.productId]);
    return recomputeResult(tx, id, line.productId);
  });
}

export async function deleteLineCountLine(id: string, lineId: string, userId: string, userName?: string) {
  return underReviewLock(id, async (tx) => {
    const line = await liveLine(tx, id, lineId);
    await tx.lineCountLine.update({ where: { id: line.id }, data: { deletedAt: new Date(), editedBy: userId, editedAt: new Date() } });
    await logEvent(tx, id, "DELETE_LINE", userId, userName, { productId: line.productId, qty: line.qty, unit: line.unit });
    await dropFromRecount(tx, id, [line.productId]);
    return recomputeResult(tx, id, line.productId);
  });
}

/** «عدّل الكمية»: the manager's own total replaces the worker's lines (kept as a trace). */
export async function setLineCountProductTotal(id: string, productId: string, qty: number, unit: LineCountUnit, userId: string, userName?: string) {
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
    await logEvent(tx, id, "SET_TOTAL", userId, userName, { productId, from: result.countedQty, qty, unit: u });
    await dropFromRecount(tx, id, [productId]);
    return recomputeResult(tx, id, productId);
  });
}

/** «صحّح الوحدة»: flips piece↔carton on exactly the lines the manager approved. */
export async function swapLineCountUnits(id: string, productId: string, lineIds: string[], userId: string, userName?: string) {
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
    await logEvent(tx, id, "SWAP_UNIT", userId, userName, { productId, lines: lines.length });
    await dropFromRecount(tx, id, [productId]);
    return recomputeResult(tx, id, productId);
  });
}

/** «أعد عدّ المختار»: the same link reopens with only these products. */
export async function requestLineCountRecount(id: string, productIds: string[], userId?: string, userName?: string) {
  return underReviewLock(id, async (tx) => {
    const ids = [...new Set(productIds)];
    const session = await tx.lineCountSession.findUniqueOrThrow({ where: { id }, select: { warehouseId: true } });
    const results = await tx.lineCountResult.findMany({ where: { sessionId: id, productId: { in: ids } }, select: { productId: true } });
    const have = new Set(results.map((r) => r.productId));
    // An uncounted product («أعد عدّها») qualifies if it holds stock here.
    const rest = ids.filter((pid) => !have.has(pid));
    const stocked = rest.length === 0 ? 0 : await tx.productWarehouseStock.count({
      where: { warehouseId: session.warehouseId, productId: { in: rest }, quantityPieces: { not: 0 }, product: { deletedAt: null } },
    });
    if (ids.length === 0 || stocked !== rest.length) throw new AppError("اختر مواد من هذا الجرد", 400, "LINE_COUNT_ITEM_NOT_FOUND");
    const cur = await tx.lineCountSession.findUniqueOrThrow({ where: { id }, select: { status: true, recountProductIds: true } });
    const adding = cur.status === "OPEN" && cur.recountProductIds.length > 0;
    await tx.lineCountSession.update({
      where: { id },
      // submittedAt stays: «إلغاء إعادة العدّ» returns to review with the same
      // upload time, so the snapshot and the moved-after-writing check hold.
      // Adding to a recount already at the worker keeps its round, so what he
      // has typed for it on the phone is still uploaded.
      data: adding
        ? { recountProductIds: [...new Set([...cur.recountProductIds, ...ids])] }
        : { status: "OPEN", recountProductIds: ids, recountRound: { increment: 1 }, recountRequestedAt: new Date(), draft: Prisma.DbNull },
    });
    await unkeep(tx, id, ids);
    await logEvent(tx, id, "RECOUNT", userId, userName, { products: ids.length, productIds: ids.slice(0, 200) });
    return { reopened: true, products: ids.length };
  });
}

/** «إلغاء إعادة العدّ»: the worker can't or won't recount — back to review with
 * every earlier line, result and decision as it was. Without it the only way out
 * of a stalled recount was cancelling the whole count. */
export async function cancelLineCountRecount(id: string, userId?: string, userName?: string) {
  await loadSession(id);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: string; recount: number; submitted_at: Date | null }[]>`
      SELECT status, cardinality(recount_product_ids)::int AS recount, submitted_at FROM line_count_sessions WHERE id = ${id}::uuid FOR UPDATE`;
    const r = rows[0];
    if (r?.status !== "OPEN" || !(r.recount > 0)) throw new AppError("ماكو إعادة عدّ مفتوحة لهذا الجرد", 400, "LINE_COUNT_NO_RECOUNT");
    await tx.lineCountSession.update({
      where: { id },
      data: { status: "SUBMITTED", recountProductIds: [], submittedAt: r.submitted_at ?? new Date(), draft: Prisma.DbNull },
    });
    await logEvent(tx, id, "CANCEL_RECOUNT", userId, userName);
    return { cancelled: true };
  });
}

/** «خلصانة» / «صفّرها»: the product is entered as counted at zero and accepted
 * in the same click — the click is the manager's decision. A counted product
 * keeps its worker lines as a trace; an uncounted one is snapshotted at the
 * upload time like the rest of the count. */
export async function markLineCountGone(id: string, productIds: string[], userId: string, userName?: string) {
  return underReviewLock(id, async (tx) => {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) throw new AppError("اختر مواد", 400, "LINE_COUNT_ITEM_NOT_FOUND");
    const session = await tx.lineCountSession.findUniqueOrThrow({ where: { id }, select: { warehouseId: true, submittedAt: true } });
    if ((await tx.product.count({ where: { id: { in: ids }, deletedAt: null } })) !== ids.length)
      throw new AppError("بعض المواد انحذفت من النظام — حدّث الصفحة", 400, "LINE_COUNT_UNKNOWN_PRODUCT");
    const existing = await tx.lineCountResult.findMany({ where: { sessionId: id, productId: { in: ids } } });
    const have = new Set(existing.map((r) => r.productId));
    const fresh = ids.filter((pid) => !have.has(pid));
    const now = new Date();
    const last = await tx.lineCountLine.aggregate({ where: { sessionId: id }, _max: { position: true } });
    let pos = last._max.position ?? 0;
    const zeroLine = (productId: string, writtenAt: Date) => ({
      sessionId: id, position: ++pos, productId, qty: 0, unit: "PIECE", qtyPieces: 0, writtenAt, source: "ADMIN", editedBy: userId, editedAt: now,
    });
    for (const r of existing) {
      await tx.lineCountLine.updateMany({ where: { sessionId: id, productId: r.productId, deletedAt: null }, data: { deletedAt: now, editedBy: userId, editedAt: now } });
      await tx.lineCountLine.create({ data: zeroLine(r.productId, r.firstWrittenAt) });
      await tx.lineCountResult.update({ where: { id: r.id }, data: { countedQty: 0, workerCountedQty: r.workerCountedQty ?? r.countedQty } });
    }
    if (fresh.length > 0) {
      // Same moment as the worker's upload, so the snapshot is the stock the
      // shelf was compared against — later sales already moved stock themselves.
      const at = session.submittedAt ?? now;
      const sys = await systemSnapshot(tx, session.warehouseId, new Map(fresh.map((pid) => [pid, at])), now);
      await tx.lineCountLine.createMany({ data: fresh.map((pid) => zeroLine(pid, at)) });
      await tx.lineCountResult.createMany({
        data: fresh.map((productId) => ({ sessionId: id, productId, systemQty: sys.get(productId) ?? 0, countedQty: 0, firstWrittenAt: at })),
      });
    }
    await tx.lineCountResult.updateMany({
      where: { sessionId: id, productId: { in: ids } },
      data: { decision: "ACCEPTED", decidedBy: userId, decidedAt: now },
    });
    await dropFromRecount(tx, id, ids);
    await unkeep(tx, id, ids);
    await logEvent(tx, id, "GONE", userId, userName, { products: ids.length, productIds: ids.slice(0, 200) });
    return { marked: ids.length };
  });
}

/** «خلّيها»: an uncounted product stays as the system has it (and goes to the
 * two-month watch at finalize) — recorded so the review shows it as decided. */
export async function setLineCountKeep(id: string, productIds: string[], keep: boolean, userId?: string, userName?: string) {
  return underReviewLock(id, async (tx) => {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) throw new AppError("اختر مواد", 400, "LINE_COUNT_ITEM_NOT_FOUND");
    if ((await tx.lineCountResult.count({ where: { sessionId: id, productId: { in: ids } } })) > 0)
      throw new AppError("بعض المواد صارت محسوبة — حدّث الصفحة", 409, "LINE_COUNT_CHANGED");
    if (keep) {
      await tx.$executeRaw`
        UPDATE line_count_sessions
        SET kept_product_ids = ARRAY(SELECT DISTINCT x FROM unnest(kept_product_ids || ${ids}::text[]) x)
        WHERE id = ${id}::uuid`;
      await dropFromRecount(tx, id, ids);
    } else {
      await unkeep(tx, id, ids);
    }
    await logEvent(tx, id, keep ? "KEEP" : "UNKEEP", userId, userName, { products: ids.length, productIds: ids.slice(0, 200) });
    return { updated: ids.length };
  });
}

/** Watched products still unexplained `days` after the count that missed them:
 * no sale from that warehouse and no later count of them there. */
export async function listLineCountWatch(days = 60) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<Array<{
    product_id: string; warehouse_id: string; first_missed: Date; last_missed: Date; times: number;
    name: string; item_number: string; pcs_per_carton: number; warehouse_name: string | null; stock: number;
  }>>`
    SELECT w.product_id, w.warehouse_id, MIN(w.counted_at) AS first_missed, MAX(w.counted_at) AS last_missed,
           COUNT(*)::int AS times, p.name, p.item_number, p.pcs_per_carton, b.name AS warehouse_name,
           COALESCE(MAX(pws.quantity_pieces), 0)::int AS stock
    FROM line_count_watches w
    JOIN products p ON p.id = w.product_id AND p.deleted_at IS NULL
    LEFT JOIN branches b ON b.id = w.warehouse_id
    LEFT JOIN product_warehouse_stocks pws ON pws.product_id = w.product_id AND pws.warehouse_id = w.warehouse_id
    WHERE NOT EXISTS (
        SELECT 1 FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
        WHERE ii.product_id = w.product_id
          AND (ii.warehouse_id = w.warehouse_id OR ii.source_warehouse_id = w.warehouse_id)
          AND i.type = 'SALE' AND i.status = 'ACTIVE' AND COALESCE(i.origin, '') <> 'STOCK_COUNT'
          AND i.created_at > w.counted_at)
      AND NOT EXISTS (
        SELECT 1 FROM line_count_results r JOIN line_count_sessions s ON s.id = r.session_id
        WHERE r.product_id = w.product_id AND s.warehouse_id = w.warehouse_id
          AND s.status IN ('SUBMITTED', 'FINALIZED') AND s.submitted_at > w.counted_at)
      AND NOT EXISTS (
        SELECT 1 FROM stocktake_items si JOIN stocktake_sessions ss ON ss.id = si.session_id
        WHERE si.product_id = w.product_id AND ss.branch_id = w.warehouse_id
          AND si.actual_qty IS NOT NULL AND ss.created_at > w.counted_at
          AND ss.status IN ('SUBMITTED', 'CLOSED'))
      AND NOT EXISTS (
        SELECT 1 FROM cycle_count_items ci JOIN cycle_count_sessions cs ON cs.id = ci.session_id
        WHERE ci.product_id = w.product_id AND cs.warehouse_id = w.warehouse_id
          AND ci.actual_qty IS NOT NULL AND cs.submitted_at > w.counted_at
          AND cs.status IN ('SUBMITTED', 'CLOSED'))
      -- Moved out to another warehouse: someone found it on the shelf.
      AND NOT EXISTS (
        SELECT 1 FROM transfer_items ti JOIN inventory_transfers t ON t.id = ti.transfer_id
        WHERE ti.product_id = w.product_id AND t.from_branch_id = w.warehouse_id
          AND t.status = 'COMPLETED' AND t.created_at > w.counted_at)
    GROUP BY w.product_id, w.warehouse_id, p.name, p.item_number, p.pcs_per_carton, b.name
    -- Nothing left in that warehouse: nothing left to look for.
    HAVING MIN(w.counted_at) <= ${cutoff} AND COALESCE(MAX(pws.quantity_pieces), 0) <> 0
    ORDER BY MIN(w.counted_at) ASC, p.name ASC`;
  return {
    days,
    count: rows.length,
    data: rows.map((r) => ({
      productId: r.product_id,
      productName: r.name,
      itemNumber: r.item_number,
      pcsPerCarton: r.pcs_per_carton,
      warehouseId: r.warehouse_id,
      warehouseName: r.warehouse_name,
      stock: r.stock,
      firstMissedAt: r.first_missed,
      lastMissedAt: r.last_missed,
      times: r.times,
    })),
  };
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
  // Which products have a picture — the pictures themselves come separately,
  // a batch at a time, so the catalogue download stays light.
  const withImage = products.length === 0 ? new Set<string>() : new Set(
    (await prisma.product.findMany({
      where: { id: { in: products.map((p) => p.id) }, thumbnailUrl: { not: null } },
      select: { id: true },
    })).map((p) => p.id),
  );
  // A whole count sent back («أعد للعامل») carries its lines — the worker's plus
  // any manager correction — so a different phone, or the office PC entering the
  // paper sheets, starts from them instead of uploading an empty list over them.
  const lines = s.status === "OPEN" && recount.length === 0
    ? await prisma.lineCountLine.findMany({
        where: { sessionId: s.id, deletedAt: null },
        orderBy: { position: "asc" },
        select: { productId: true, qty: true, unit: true, writtenAt: true },
      })
    : [];
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
    products: products.map((p) => ({ ...p, hasImage: withImage.has(p.id) })),
    lines,
    // What a phone already sent for this round — another phone continues from it.
    draft: s.status === "OPEN" ? (() => {
      const d = latestDraft(s.draft, currentRound(s));
      return d ? { lines: d.lines, at: d.at } : null;
    })() : null,
  };
}

export async function publicSubmitLineCount(token: string, lines: SubmittedLine[], opts: SubmitOptions = {}) {
  const s = await sessionByToken(token);
  const submitId = opts.submitId?.trim() || null;
  // A retry after a dropped response lands here with the work already saved —
  // that is the same phone (same submit id). Any other phone, or a phone whose
  // recount the manager cancelled meanwhile, is told plainly instead of seeing
  // «انرفع» for lines that were never stored.
  const refuseOrDone = (status: string) => {
    if (!submitId || submitId === s.submitId) return { alreadySubmitted: true, status };
    throw new AppError(
      "الجرد انرفع أو انقفل قبل رفعك — سطورك باقية بموبايلك ولا تمسحها. كلّم المدير حتى يرجّعلك الجرد.",
      409,
      "LINE_COUNT_ALREADY_SUBMITTED",
    );
  };
  if (s.status === "SUBMITTED" || s.status === "FINALIZED") return refuseOrDone(s.status);
  if (s.status !== "OPEN") throw new AppError("هذه الجلسة ملغاة", 400, "LINE_COUNT_CANCELLED");
  if (lines.length === 0) throw new AppError("ما مكتوب ولا سطر", 400, "LINE_COUNT_EMPTY");

  // During a recount the manager may have settled some products himself after
  // the worker wrote them — those lines are dropped, the rest go through.
  const recount = new Set(s.recountProductIds);
  if (recount.size > 0) {
    lines = lines.filter((l) => recount.has(l.productId));
    if (lines.length === 0)
      throw new AppError("المدير قرر على المواد اللي كتبتها — ماكو شي ينرفع. حدّث الصفحة.", 400, "LINE_COUNT_NOT_IN_RECOUNT");
  }
  const ids = [...new Set(lines.map((l) => l.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, name: true, pcsPerCarton: true } });
  const ppc = new Map(products.map((p) => [p.id, Math.max(1, p.pcsPerCarton)]));
  const pname = new Map(products.map((p) => [p.id, p.name]));
  const missing = ids.filter((pid) => !ppc.has(pid));
  if (missing.length > 0) throw new AppError("بعض المواد انحذفت من النظام — حدّث الصفحة", 400, "LINE_COUNT_UNKNOWN_PRODUCT");

  const now = new Date();
  // The phone's clock may be off by hours. Its own send time tells by how much;
  // small gaps are just network delay and are left alone.
  const sent = opts.sentAt ? new Date(opts.sentAt) : null;
  const skew = sent && !Number.isNaN(sent.getTime()) ? now.getTime() - sent.getTime() : 0;
  const shift = Math.abs(skew) > 2 * 60_000 ? skew : 0;
  // No line can predate the count (or the recount) it belongs to.
  const floor = (recount.size > 0 ? s.recountRequestedAt : null) ?? s.createdAt;
  const rows = lines.map((l, i) => {
    const raw = new Date(l.writtenAt);
    const t = Number.isNaN(raw.getTime()) ? now.getTime() : raw.getTime() + shift;
    const writtenAt = new Date(Math.min(now.getTime(), Math.max(floor.getTime(), t)));
    // Carton size is read from the DB, never trusted from the phone.
    const qtyPieces = l.unit === "CARTON" ? l.qty * (ppc.get(l.productId) ?? 1) : l.qty;
    if (qtyPieces > MAX_LINE_PIECES)
      throw new AppError(
        `السطر ${i + 1} («${pname.get(l.productId) ?? "مادة"}»): العدد ${l.qty} كبير جداً — يمكن انقرأ باركود بخانة العدد. صحّحه وارفع مرة ثانية.`,
        400,
        "LINE_COUNT_QTY_TOO_BIG",
      );
    return { sessionId: s.id, position: i + 1, productId: l.productId, qty: l.qty, unit: l.unit, qtyPieces, writtenAt };
  });

  const sums = new Map<string, { qty: number; first: Date; last: Date }>();
  for (const r of rows) {
    const cur = sums.get(r.productId);
    if (cur) {
      cur.qty += r.qtyPieces;
      if (r.writtenAt < cur.first) cur.first = r.writtenAt;
      if (r.writtenAt > cur.last) cur.last = r.writtenAt;
    } else sums.set(r.productId, { qty: r.qtyPieces, first: r.writtenAt, last: r.writtenAt });
  }

  return prisma.$transaction(
    async (tx) => {
      const claim = await tx.lineCountSession.updateMany({
        where: { id: s.id, status: "OPEN" },
        data: { status: "SUBMITTED", submittedAt: now, recountProductIds: [], submitId, draft: Prisma.DbNull },
      });
      if (claim.count !== 1) {
        // Lost the race to another upload a moment ago.
        const fresh = await tx.lineCountSession.findUnique({ where: { id: s.id }, select: { submitId: true, status: true } });
        if (!submitId || submitId === fresh?.submitId) return { alreadySubmitted: true, status: fresh?.status ?? "SUBMITTED" };
        throw new AppError(
          "الجرد انرفع أو انقفل قبل رفعك — سطورك باقية بموبايلك ولا تمسحها. كلّم المدير حتى يرجّعلك الجرد.",
          409,
          "LINE_COUNT_ALREADY_SUBMITTED",
        );
      }
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
      // Stock as it stood at the product's first line — and, when it was also
      // written later, at its last line. If stock moved in between the two
      // differ and the review asks the manager which moment is the real one;
      // by default the first, as before.
      const sysFirst = await systemSnapshot(tx, s.warehouseId, new Map([...sums].map(([k, v]) => [k, v.first])), now);
      const spread = [...sums].filter(([, v]) => v.last > v.first);
      const sysLast = spread.length > 0 ? await systemSnapshot(tx, s.warehouseId, new Map(spread.map(([k, v]) => [k, v.last])), now) : new Map<string, number>();
      await tx.lineCountResult.createMany({
        data: [...sums.entries()].map(([productId, v]) => {
          const first = sysFirst.get(productId) ?? 0;
          return {
            sessionId: s.id,
            productId,
            systemQty: first,
            systemQtyFirst: first,
            systemQtyLast: v.last > v.first ? (sysLast.get(productId) ?? 0) : null,
            countedQty: v.qty,
            firstWrittenAt: v.first,
            lastWrittenAt: v.last,
          };
        }),
      });
      await logEvent(tx, s.id, "SUBMIT", null, null, {
        lines: rows.length,
        products: sums.size,
        recount: recount.size > 0,
        ...(shift !== 0 ? { clockShiftMinutes: Math.round(shift / 60_000) } : {}),
      });
      return { alreadySubmitted: false, status: "SUBMITTED", lines: rows.length, products: sums.size };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

/** The phone's lines while it counts. Stored per phone and per round; ignored
 * once the count is no longer open or the round moved on. */
export async function publicSaveLineCountDraft(token: string, deviceId: string, round: number, lines: SubmittedLine[]) {
  const s = await sessionByToken(token);
  if (s.status !== "OPEN") return { saved: false, status: s.status };
  if (round !== currentRound(s)) return { saved: false, status: s.status, stale: true };
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: string; draft: Prisma.JsonValue | null; recount_round: number; recount: number }[]>`
      SELECT status, draft, recount_round, cardinality(recount_product_ids)::int AS recount
      FROM line_count_sessions WHERE id = ${s.id}::uuid FOR UPDATE`;
    const r = rows[0];
    if (!r || r.status !== "OPEN") return { saved: false, status: r?.status ?? s.status };
    if (round !== (r.recount > 0 ? r.recount_round : 0)) return { saved: false, status: r.status, stale: true };
    const entries = draftEntries(r.draft);
    // Older rounds are over; keep the ten most recent phones at most.
    const keep = Object.entries(entries)
      .filter(([k, e]) => k !== deviceId && e.round === round)
      .sort((a, b) => (a[1].at < b[1].at ? 1 : -1))
      .slice(0, 9);
    const next: Record<string, DraftEntry> = Object.fromEntries(keep);
    next[deviceId] = { round, at: new Date().toISOString(), lines };
    await tx.lineCountSession.update({ where: { id: s.id }, data: { draft: next as unknown as Prisma.InputJsonValue } });
    return { saved: true, status: r.status };
  });
}

/** Products the worker link may show: the recount list while one is open,
 * otherwise the whole catalogue — and nothing once the count is closed. */
async function openLinkScope(token: string) {
  const s = await sessionByToken(token);
  if (s.status !== "OPEN") return null;
  return s.recountProductIds.length > 0 ? new Set(s.recountProductIds) : "ALL";
}

/** Small pictures for the worker link, a batch at a time; the phone keeps them
 * so they still show with no signal. */
export async function publicLineCountThumbnails(token: string, productIds: string[]) {
  const scope = await openLinkScope(token);
  if (!scope) return {};
  const ids = [...new Set(productIds)].filter((id) => scope === "ALL" || scope.has(id)).slice(0, 120);
  if (ids.length === 0) return {};
  const rows = await prisma.product.findMany({
    where: { id: { in: ids }, deletedAt: null, thumbnailUrl: { not: null } },
    select: { id: true, thumbnailUrl: true },
  });
  return Object.fromEntries(rows.map((r) => [r.id, r.thumbnailUrl as string]));
}

/** The full-size picture of one product, opened on tap while online. */
export async function publicLineCountImage(token: string, productId: string) {
  const scope = await openLinkScope(token);
  if (!scope || (scope !== "ALL" && !scope.has(productId))) throw new AppError("الصورة غير متاحة", 404, "LINE_COUNT_IMAGE_NOT_FOUND");
  const p = await prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { imageUrl: true, thumbnailUrl: true } });
  const image = p?.imageUrl ?? p?.thumbnailUrl ?? null;
  if (!image) throw new AppError("ما إلها صورة", 404, "LINE_COUNT_IMAGE_NOT_FOUND");
  return { image };
}
