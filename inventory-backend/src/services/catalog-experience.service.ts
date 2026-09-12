import prisma from "../config/database";
import { getCatalogAccess } from "./catalog.service";
import { requireVisitorSession } from "./catalog-visitor.service";
import { logger } from "../utils/logger";

export const isSessionId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export async function recordFunnelStage(sessionId: string, stage: number) {
  if (!isSessionId(sessionId) || !Number.isInteger(stage) || stage < 0 || stage > 4) return;
  await prisma.$executeRaw`INSERT INTO catalog_funnel_events (session_id, stage) VALUES (${sessionId}::uuid, ${stage}::smallint) ON CONFLICT DO NOTHING`;
}

/** Called only AFTER the order service has persisted a real approval. */
export async function recordOrderSuccess(sessionId: unknown) {
  if (!isSessionId(sessionId)) return;
  try { await recordFunnelStage(sessionId, 4); }
  catch { logger.warn("Catalog order saved but funnel recording failed"); }
}

export async function catalogFunnelReport(days: number) {
  const since = new Date(Date.now() - days * 86400000);
  // Cohort by session's first observed event, so a later milestone does not
  // acquire a different denominator just because it crossed midnight.
  const rows = await prisma.$queryRaw<Array<{ opened: bigint; viewed: bigint; added: bigint; checkout: bigint; completed: bigint; successful: bigint }>>`
    WITH cohort AS (
      SELECT session_id, BOOL_OR(stage = 0) AS opened, BOOL_OR(stage = 1) AS viewed,
        BOOL_OR(stage = 2) AS added, BOOL_OR(stage = 3) AS checkout, BOOL_OR(stage = 4) AS completed
      FROM catalog_funnel_events GROUP BY session_id HAVING MIN(created_at) >= ${since}
    )
    SELECT COUNT(*) FILTER (WHERE opened) AS opened,
      COUNT(*) FILTER (WHERE opened AND viewed) AS viewed,
      COUNT(*) FILTER (WHERE opened AND viewed AND added) AS added,
      COUNT(*) FILTER (WHERE opened AND viewed AND added AND checkout) AS checkout,
      COUNT(*) FILTER (WHERE opened AND viewed AND added AND checkout AND completed) AS completed,
      COUNT(*) FILTER (WHERE completed) AS successful FROM cohort`;
  const row = rows[0];
  const stages = [row?.opened, row?.viewed, row?.added, row?.checkout, row?.completed].map(n => Number(n ?? 0));
  const successfulSessions = Number(row?.successful ?? 0);
  return { days, stages, sessions: stages[0], successfulSessions, incompletePathOrders: Math.max(0, successfulSessions - stages[4]) };
}

export async function catalogPurchaseHistory(access: string, visitor: string) {
  // Never accept a customerId or an unverified phone from the browser.
  const customerId = access
    ? (await getCatalogAccess(access)).customer.id
    : (await requireVisitorSession(visitor)).customerId;
  if (!customerId) return { productIds: [] };
  const rows = await prisma.invoiceItem.groupBy({
    by: ["productId"],
    where: { invoice: { customerId, type: "SALE", status: "ACTIVE", archivedAt: null }, product: { deletedAt: null } },
    orderBy: { productId: "asc" },
    take: 5000,
  });
  return { productIds: rows.map(row => row.productId) };
}
