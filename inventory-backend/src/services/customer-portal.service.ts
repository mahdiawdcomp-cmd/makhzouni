import { createHash, randomBytes } from "crypto";
import prisma from "../config/database";
import { getCustomerTransactions } from "./customer.service";
import { AppError } from "../utils/app-error";

type PortalLinkRow = {
  id: string;
  customer_id: string;
  expires_at: Date | null;
  revoked_at: Date | null;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function makeToken() {
  return `cpl_${randomBytes(32).toString("base64url")}`;
}

export async function createCustomerPortalLink(customerId: string, expiresInDays = 30) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true, name: true, phone: true },
  });

  if (!customer) {
    throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
  }

  const token = makeToken();
  const tokenHash = hashToken(token);
  const expiresAt =
    expiresInDays > 0
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

  const rows = await prisma.$queryRaw<PortalLinkRow[]>`
    INSERT INTO "customer_portal_links" ("token_hash", "customer_id", "expires_at")
    VALUES (${tokenHash}, ${customerId}::uuid, ${expiresAt})
    RETURNING "id", "customer_id", "expires_at", "revoked_at"
  `;

  return {
    token,
    urlPath: `/client/${token}`,
    expiresAt: rows[0]?.expires_at ?? null,
    customer,
  };
}

export async function revokeCustomerPortalLinks(customerId: string) {
  await prisma.$executeRaw`
    UPDATE "customer_portal_links"
    SET "revoked_at" = NOW()
    WHERE "customer_id" = ${customerId}::uuid AND "revoked_at" IS NULL
  `;
}

export async function getCustomerPortalByToken(token: string) {
  const tokenHash = hashToken(token);
  const rows = await prisma.$queryRaw<PortalLinkRow[]>`
    SELECT "id", "customer_id", "expires_at", "revoked_at"
    FROM "customer_portal_links"
    WHERE "token_hash" = ${tokenHash}
    LIMIT 1
  `;
  const link = rows[0];

  if (!link || link.revoked_at || (link.expires_at && link.expires_at.getTime() < Date.now())) {
    throw new AppError("Client link is invalid or expired", 404, "PORTAL_LINK_INVALID");
  }

  await prisma.$executeRaw`
    UPDATE "customer_portal_links"
    SET "last_viewed_at" = NOW()
    WHERE "id" = ${link.id}::uuid
  `;

  const [customer, statement] = await Promise.all([
    prisma.customer.findFirst({
      where: { id: link.customer_id, deletedAt: null },
      select: {
        id: true,
        name: true,
        phone: true,
        openingBalance: true,
        currentBalance: true,
        lastTransactionAt: true,
      },
    }),
    getCustomerTransactions(link.customer_id, { all: true }),
  ]);

  if (!customer) {
    throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");
  }

  return {
    customer: {
      ...customer,
      openingBalance: Number(customer.openingBalance),
      currentBalance: Number(customer.currentBalance),
    },
    transactions: statement.transactions,
    expiresAt: link.expires_at,
  };
}
