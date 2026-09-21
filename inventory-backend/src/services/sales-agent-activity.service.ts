/**
 * «إشعارات المندوبين» — reading the feed, for the owner.
 *
 * The counter is the whole reason this exists as its own thing. The rules that
 * keep it honest:
 *
 *   - ONE number, counted by the database over ONE table. Nothing is added to
 *     it from the browser, so the iPad, the desktop and the phone all show the
 *     same count.
 *   - Read state lives on the row. Marking read on one device is marking read.
 *   - The count is never capped by how many rows the screen fetched: it is a
 *     COUNT, not the length of a page.
 */
import { Prisma } from "@prisma/client";
import prisma from "../config/database";

const toNumber = (v: unknown): number | null => (v == null ? null : Number(v));

export type ActivityFilter = {
  agentId?: string;
  kind?: string;
  importantOnly?: boolean;
  unreadOnly?: boolean;
  /** Shop-local date keys, inclusive. */
  from?: Date;
  to?: Date;
  /** Cursor: rows strictly older than this id's row. */
  before?: string;
  limit?: number;
};

function whereFor(filter: ActivityFilter): Prisma.SalesAgentActivityWhereInput {
  return {
    ...(filter.agentId ? { salesAgentId: filter.agentId } : {}),
    ...(filter.kind ? { kind: filter.kind } : {}),
    ...(filter.importantOnly ? { important: true } : {}),
    ...(filter.unreadOnly ? { readAt: null } : {}),
    ...(filter.from || filter.to
      ? { createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } }
      : {}),
  };
}

export async function listAgentActivity(filter: ActivityFilter) {
  const limit = Math.min(Math.max(1, filter.limit ?? 50), 200);
  const base = whereFor(filter);

  // Keyset paging on (createdAt, id): offset paging over a feed that grows at
  // the top would shift every page by the rows written since the last one.
  let cursor: Prisma.SalesAgentActivityWhereInput = {};
  if (filter.before) {
    const anchor = await prisma.salesAgentActivity.findUnique({
      where: { id: filter.before },
      select: { createdAt: true, id: true },
    });
    if (anchor) {
      cursor = {
        OR: [
          { createdAt: { lt: anchor.createdAt } },
          { createdAt: anchor.createdAt, id: { lt: anchor.id } },
        ],
      };
    }
  }

  const [rows, counts] = await Promise.all([
    prisma.salesAgentActivity.findMany({
      where: { AND: [base, cursor] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        salesAgentId: true,
        salesAgent: { select: { name: true } },
        kind: true,
        customerId: true,
        referenceId: true,
        approvalId: true,
        title: true,
        message: true,
        important: true,
        amount: true,
        readAt: true,
        createdAt: true,
      },
    }),
    agentActivityCounts(),
  ]);

  const page = rows.slice(0, limit);
  return {
    items: page.map((r) => ({
      id: r.id,
      salesAgentId: r.salesAgentId,
      agentName: r.salesAgent?.name ?? "المندوب",
      kind: r.kind,
      customerId: r.customerId,
      referenceId: r.referenceId,
      approvalId: r.approvalId,
      title: r.title,
      message: r.message,
      important: r.important,
      amount: toNumber(r.amount),
      read: r.readAt != null,
      createdAt: r.createdAt,
    })),
    nextBefore: rows.length > limit ? page[page.length - 1]?.id ?? null : null,
    ...counts,
  };
}

/**
 * The two numbers the badge shows. Both are plain COUNTs.
 *
 * `pendingApprovals` is how many of the unread rows are STILL waiting on a
 * decision — an approval the owner already acted on from the approvals screen
 * no longer needs attention even if its row here was never opened.
 */
export async function agentActivityCounts() {
  const [unread, importantUnread] = await Promise.all([
    prisma.salesAgentActivity.count({ where: { readAt: null } }),
    prisma.salesAgentActivity.count({ where: { readAt: null, important: true } }),
  ]);
  return { unread, importantUnread };
}

/**
 * Mark rows read. With ids: those rows. Without: everything matching the
 * filter the owner is looking at — «علّم الكل مقروء» on a filtered view must
 * not silently clear rows the owner never saw.
 */
export async function markAgentActivityRead(input: { ids?: unknown; filter?: ActivityFilter }) {
  const ids = Array.isArray(input.ids) ? input.ids.map(String).filter(Boolean).slice(0, 500) : null;
  const where: Prisma.SalesAgentActivityWhereInput = ids
    ? { id: { in: ids }, readAt: null }
    : { ...whereFor(input.filter ?? {}), readAt: null };
  const result = await prisma.salesAgentActivity.updateMany({ where, data: { readAt: new Date() } });
  return { marked: result.count, ...(await agentActivityCounts()) };
}
