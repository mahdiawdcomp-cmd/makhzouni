import { ErrorLogLevel, ErrorLogSource, Prisma } from "@prisma/client";
import prisma from "../config/database";
import { logger } from "../utils/logger";

export type RecordErrorInput = {
  source: ErrorLogSource;
  level?: ErrorLogLevel;
  code?: string | null;
  message: string;
  context?: Prisma.InputJsonValue;
};

// Group unresolved errors by (source, code, message): if a matching open row
// exists, bump its count + lastSeenAt instead of inserting a new row. Keeps the
// table bounded and makes repeated failures obvious. Never throws — logging an
// error must not create a second error.
export async function recordError(input: RecordErrorInput): Promise<void> {
  try {
    const message = input.message.slice(0, 1000);
    const code = input.code?.slice(0, 120) ?? null;
    const level = input.level ?? ErrorLogLevel.ERROR;

    const existing = await prisma.errorLog.findFirst({
      where: { source: input.source, code, message, resolvedAt: null },
      select: { id: true },
      orderBy: { lastSeenAt: "desc" },
    });

    if (existing) {
      await prisma.errorLog.update({
        where: { id: existing.id },
        data: {
          count: { increment: 1 },
          lastSeenAt: new Date(),
          ...(input.context !== undefined ? { context: input.context } : {}),
          level,
        },
      });
      return;
    }

    await prisma.errorLog.create({
      data: {
        source: input.source,
        level,
        code,
        message,
        ...(input.context !== undefined ? { context: input.context } : {}),
      },
    });
  } catch (err) {
    logger.warn(`[ErrorLog] failed to record error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export type ListErrorLogsFilter = {
  source?: ErrorLogSource;
  includeResolved?: boolean;
  limit?: number;
};

export async function listErrorLogs(filter: ListErrorLogsFilter = {}) {
  const limit = Math.min(200, Math.max(1, filter.limit ?? 100));
  return prisma.errorLog.findMany({
    where: {
      ...(filter.source ? { source: filter.source } : {}),
      ...(filter.includeResolved ? {} : { resolvedAt: null }),
    },
    orderBy: [{ resolvedAt: "asc" }, { lastSeenAt: "desc" }],
    take: limit,
  });
}

export async function resolveErrorLog(id: string) {
  return prisma.errorLog.update({
    where: { id },
    data: { resolvedAt: new Date() },
  });
}

// Retention: delete resolved rows and anything older than 90 days. Called by a
// daily cron. Bounded delete, safe to run repeatedly.
export async function cleanupOldErrorLogs(): Promise<number> {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const res = await prisma.errorLog.deleteMany({
    where: {
      OR: [
        { createdAt: { lt: cutoff } },
        { resolvedAt: { not: null, lt: cutoff } },
      ],
    },
  });
  return res.count;
}
