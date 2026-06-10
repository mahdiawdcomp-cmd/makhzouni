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
  contactPhone?: string | null;
  contactEmail?: string | null;
  backendUrl?: string | null;
  frontendUrl?: string | null;
  isRevoked: boolean;
  createdAt: string;
  daysLeft?: number;
  status?: "valid" | "expiring" | "expired" | "revoked";
}

export interface CreateClientInput {
  name: string;
  months: number;
  notes?: string;
  contactPhone?: string;
  contactEmail?: string;
}

export interface UpdateClientInput {
  backendUrl?: string;
  frontendUrl?: string;
  contactPhone?: string;
  contactEmail?: string;
  notes?: string;
}

function computeStatus(expiresAt: string, isRevoked: boolean): { daysLeft: number; status: ClientRecord["status"] } {
  if (isRevoked) return { daysLeft: 0, status: "revoked" };
  const daysLeft = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
  const status: ClientRecord["status"] = daysLeft > 30 ? "valid" : daysLeft > 0 ? "expiring" : "expired";
  return { daysLeft, status };
}

function toRecord(r: {
  id: string; name: string; licenseKey: string; expiresAt: Date;
  months: number; notes: string | null; contactPhone: string | null;
  contactEmail: string | null; backendUrl: string | null; frontendUrl: string | null;
  isRevoked: boolean; createdAt: Date;
}): ClientRecord {
  const { daysLeft, status } = computeStatus(r.expiresAt.toISOString(), r.isRevoked);
  return {
    id: r.id,
    name: r.name,
    licenseKey: r.licenseKey,
    expiresAt: r.expiresAt.toISOString(),
    months: r.months,
    notes: r.notes,
    contactPhone: r.contactPhone,
    contactEmail: r.contactEmail,
    backendUrl: r.backendUrl,
    frontendUrl: r.frontendUrl,
    isRevoked: r.isRevoked,
    createdAt: r.createdAt.toISOString(),
    daysLeft,
    status,
  };
}

export async function listClients(): Promise<ClientRecord[]> {
  const rows = await prisma.licensedClient.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map(toRecord);
}

export async function createClient(input: CreateClientInput): Promise<ClientRecord> {
  const privateKey = process.env.LICENSE_PRIVATE_KEY?.trim();
  if (!privateKey) throw new Error("LICENSE_PRIVATE_KEY env var not set — cannot generate license");

  const clientId = randomUUID();
  const expiresInDays = input.months * 30;
  const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000);

  const token = jwt.sign(
    { sub: clientId, name: input.name },
    privateKey,
    { algorithm: "RS256", expiresIn: `${expiresInDays}d`, issuer: "makhzouni" }
  );

  const row = await prisma.licensedClient.create({
    data: {
      id: clientId,
      name: input.name,
      licenseKey: token,
      expiresAt,
      months: input.months,
      notes: input.notes ?? null,
      contactPhone: input.contactPhone ?? null,
      contactEmail: input.contactEmail ?? null,
    },
  });

  logger.info(`[clients] Created license for "${input.name}" — expires ${expiresAt.toISOString().slice(0, 10)}`);
  return toRecord(row);
}

export async function updateClient(id: string, input: UpdateClientInput): Promise<ClientRecord> {
  const row = await prisma.licensedClient.update({
    where: { id },
    data: {
      ...(input.backendUrl !== undefined  && { backendUrl: input.backendUrl }),
      ...(input.frontendUrl !== undefined && { frontendUrl: input.frontendUrl }),
      ...(input.contactPhone !== undefined && { contactPhone: input.contactPhone }),
      ...(input.contactEmail !== undefined && { contactEmail: input.contactEmail }),
      ...(input.notes !== undefined && { notes: input.notes }),
    },
  });
  return toRecord(row);
}

export async function revokeClient(id: string): Promise<void> {
  await prisma.licensedClient.update({ where: { id }, data: { isRevoked: true } });
  logger.info(`[clients] Revoked client ${id}`);
}

export async function deleteClient(id: string): Promise<void> {
  await prisma.licensedClient.delete({ where: { id } });
  logger.info(`[clients] Deleted client ${id}`);
}
