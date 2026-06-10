import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import prisma from "../config/database";
import { logger } from "../utils/logger";

export interface ClientRecord {
  id: string;
  name: string;
  licenseKey: string;
  expiresAt: string;
  months: number;
  notes?: string | null;
  isRevoked: boolean;
  createdAt: string;
  // Computed from JWT
  daysLeft?: number;
  status?: "valid" | "expiring" | "expired" | "revoked";
}

function computeStatus(expiresAt: string, isRevoked: boolean): { daysLeft: number; status: ClientRecord["status"] } {
  if (isRevoked) return { daysLeft: 0, status: "revoked" };
  const daysLeft = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
  const status = daysLeft > 30 ? "valid" : daysLeft > 0 ? "expiring" : "expired";
  return { daysLeft, status };
}

export async function listClients(): Promise<ClientRecord[]> {
  const rows = await prisma.licensedClient.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((r) => {
    const { daysLeft, status } = computeStatus(r.expiresAt.toISOString(), r.isRevoked);
    return {
      id: r.id,
      name: r.name,
      licenseKey: r.licenseKey,
      expiresAt: r.expiresAt.toISOString(),
      months: r.months,
      notes: r.notes,
      isRevoked: r.isRevoked,
      createdAt: r.createdAt.toISOString(),
      daysLeft,
      status,
    };
  });
}

export async function createClient(
  name: string,
  months: number,
  notes?: string
): Promise<ClientRecord> {
  const privateKey = process.env.LICENSE_PRIVATE_KEY?.trim();
  if (!privateKey) throw new Error("LICENSE_PRIVATE_KEY env var not set");

  const clientId = randomUUID();
  const expiresInDays = months * 30;
  const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000);

  const token = jwt.sign(
    { sub: clientId, name },
    privateKey,
    { algorithm: "RS256", expiresIn: `${expiresInDays}d`, issuer: "makhzouni" }
  );

  const row = await prisma.licensedClient.create({
    data: {
      id: clientId,
      name,
      licenseKey: token,
      expiresAt,
      months,
      notes: notes ?? null,
    },
  });

  logger.info(`[clients] Created license for "${name}" — expires ${expiresAt.toISOString().slice(0, 10)}`);

  const { daysLeft, status } = computeStatus(row.expiresAt.toISOString(), false);
  return {
    id: row.id,
    name: row.name,
    licenseKey: row.licenseKey,
    expiresAt: row.expiresAt.toISOString(),
    months: row.months,
    notes: row.notes,
    isRevoked: row.isRevoked,
    createdAt: row.createdAt.toISOString(),
    daysLeft,
    status,
  };
}

export async function revokeClient(id: string): Promise<void> {
  await prisma.licensedClient.update({ where: { id }, data: { isRevoked: true } });
  logger.info(`[clients] Revoked client ${id}`);
}

export async function deleteClient(id: string): Promise<void> {
  await prisma.licensedClient.delete({ where: { id } });
  logger.info(`[clients] Deleted client ${id}`);
}
