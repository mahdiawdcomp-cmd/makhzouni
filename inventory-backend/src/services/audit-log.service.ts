import { Prisma } from "@prisma/client";
import prisma from "../config/database";

export interface CreateAuditLogInput {
  userId?: string;
  action: string;
  entity: string;
  recordId?: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

export interface ListAuditLogsQuery {
  userId?: string;
  entity?: string;
  action?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
}

export function asAuditJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  const json = JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") return item.toString();
    if (typeof item === "function" || typeof item === "symbol") return undefined;
    return item;
  });
  if (json === undefined) return undefined;
  return JSON.parse(json) as Prisma.InputJsonValue;
}

export async function createAuditLog(input: CreateAuditLogInput) {
  return prisma.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entity: input.entity,
      recordId: input.recordId,
      before: asAuditJson(input.before),
      after: asAuditJson(input.after),
      metadata: asAuditJson(input.metadata),
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    },
  });
}

export async function listAuditLogs(query: ListAuditLogsQuery) {
  const createdAt: Prisma.DateTimeFilter = {};
  if (query.from) createdAt.gte = new Date(query.from);
  if (query.to) {
    const toDate = new Date(query.to);
    toDate.setHours(23, 59, 59, 999);
    createdAt.lte = toDate;
  }

  const where: Prisma.AuditLogWhereInput = {
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.entity ? { entity: query.entity } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(Object.keys(createdAt).length ? { createdAt } : {}),
  };
  const skip = (query.page - 1) * query.limit;

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: { id: true, name: true, username: true, role: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: query.limit,
    }),
  ]);

  return {
    data: logs,
    pagination: {
      total,
      page: query.page,
      limit: query.limit,
      pages: Math.ceil(total / query.limit),
    },
  };
}
