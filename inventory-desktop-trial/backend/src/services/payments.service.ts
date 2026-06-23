import jwt from "jsonwebtoken";
import prisma from "../config/database";
import { logger } from "../utils/logger";

export interface PaymentRecord {
  id: string;
  clientId: string;
  clientName: string;
  amount: number;
  currency: string;
  paidAt: string;
  method?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface RevenueSummary {
  totalAllTime: number;
  totalThisMonth: number;
  totalThisYear: number;
  currency: string;
  renewalsDueSoon: {
    id: string; name: string; expiresAt: string; daysLeft: number;
    contactPhone: string | null; frontendUrl: string | null;
  }[];
  monthlyChart: { month: string; amount: number }[];
}

export async function listPayments(clientId?: string): Promise<PaymentRecord[]> {
  const rows = await prisma.clientPayment.findMany({
    where: clientId ? { clientId } : undefined,
    include: { client: { select: { name: true } } },
    orderBy: { paidAt: "desc" },
  });
  return rows.map(r => ({
    id: r.id,
    clientId: r.clientId,
    clientName: r.client.name,
    amount: r.amount,
    currency: r.currency,
    paidAt: r.paidAt.toISOString(),
    method: r.method,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function recordPayment(input: {
  clientId: string; amount: number; currency?: string;
  paidAt?: string; method?: string; notes?: string;
}): Promise<PaymentRecord> {
  const row = await prisma.clientPayment.create({
    data: {
      clientId: input.clientId,
      amount: input.amount,
      currency: input.currency ?? "USD",
      paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
      method: input.method ?? null,
      notes: input.notes ?? null,
    },
    include: { client: { select: { name: true } } },
  });
  logger.info(`[payments] Recorded $${input.amount} from client ${row.client.name}`);
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.client.name,
    amount: row.amount,
    currency: row.currency,
    paidAt: row.paidAt.toISOString(),
    method: row.method,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function renewClient(input: {
  clientId: string; months: number; amount: number;
  currency?: string; method?: string; notes?: string;
}): Promise<{ newExpiresAt: string; licenseKey: string; payment: PaymentRecord }> {
  const privateKey = process.env.LICENSE_PRIVATE_KEY?.trim();
  if (!privateKey) throw new Error("LICENSE_PRIVATE_KEY not set");

  const client = await prisma.licensedClient.findUniqueOrThrow({ where: { id: input.clientId } });

  // Extend from current expiry (or now if already expired)
  const base = client.expiresAt > new Date() ? client.expiresAt : new Date();
  const newExpiry = new Date(base.getTime() + input.months * 30 * 86_400_000);

  const token = jwt.sign(
    { sub: client.id, name: client.name },
    privateKey,
    { algorithm: "RS256", expiresIn: `${input.months * 30}d`, issuer: "makhzouni" }
  );

  const updated = await prisma.licensedClient.update({
    where: { id: input.clientId },
    data: { expiresAt: newExpiry, licenseKey: token, isRevoked: false },
  });

  const payment = await recordPayment({
    clientId: input.clientId,
    amount: input.amount,
    currency: input.currency,
    method: input.method,
    notes: input.notes ?? `تجديد ${input.months} شهر`,
  });

  logger.info(`[payments] Renewed "${client.name}" → ${newExpiry.toISOString().slice(0, 10)}`);
  return { newExpiresAt: updated.expiresAt.toISOString(), licenseKey: token, payment };
}

export async function deletePayment(id: string): Promise<void> {
  await prisma.clientPayment.delete({ where: { id } });
}

export async function getRevenueSummary(): Promise<RevenueSummary> {
  const payments = await prisma.clientPayment.findMany({
    include: { client: { select: { name: true } } },
    orderBy: { paidAt: "desc" },
  });

  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear  = now.getFullYear();

  const totalAllTime    = payments.reduce((s, p) => s + p.amount, 0);
  const totalThisMonth  = payments.filter(p => {
    const d = new Date(p.paidAt);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  }).reduce((s, p) => s + p.amount, 0);
  const totalThisYear = payments.filter(p => new Date(p.paidAt).getFullYear() === thisYear)
    .reduce((s, p) => s + p.amount, 0);

  // Renewals due in next 45 days
  const in45 = new Date(now.getTime() + 45 * 86_400_000);
  const renewalsDueSoon = (await prisma.licensedClient.findMany({
    where: { isRevoked: false, expiresAt: { lte: in45, gte: new Date(now.getTime() - 30 * 86_400_000) } },
    orderBy: { expiresAt: "asc" },
  })).map(c => ({
    id: c.id,
    name: c.name,
    expiresAt: c.expiresAt.toISOString(),
    daysLeft: Math.floor((c.expiresAt.getTime() - now.getTime()) / 86_400_000),
    contactPhone: c.contactPhone,
    frontendUrl: c.frontendUrl,
  }));

  // Monthly chart — last 12 months
  const monthlyMap = new Map<string, number>();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(thisYear, thisMonth - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthlyMap.set(key, 0);
  }
  payments.forEach(p => {
    const d = new Date(p.paidAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (monthlyMap.has(key)) monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + p.amount);
  });
  const monthlyChart = Array.from(monthlyMap.entries()).map(([month, amount]) => ({ month, amount }));

  return { totalAllTime, totalThisMonth, totalThisYear, currency: "USD", renewalsDueSoon, monthlyChart };
}
