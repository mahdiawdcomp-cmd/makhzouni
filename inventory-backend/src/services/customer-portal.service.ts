import { createHash, randomBytes } from "crypto";
import prisma from "../config/database";
import { getCustomerTransactions } from "./customer.service";
import { getSettings } from "./settings.service";
import { sendWhatsAppText } from "./whatsapp.service";
import { sendPushNotification } from "../utils/push-notify";
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

// Enable/disable the customer's portal access. Disabling revokes any active
// link. Enabling, when no active link exists (never created, or previously
// revoked — the plain token of a revoked link can never be recovered since
// only its hash is stored), mints a fresh one so the caller can immediately
// offer it for sending.
export async function togglePortalLink(customerId: string, enabled: boolean) {
  if (!enabled) {
    await revokeCustomerPortalLinks(customerId);
    return { enabled: false, revokedAt: new Date(), urlPath: undefined, token: undefined };
  }

  const active = await prisma.customerPortalLink.findFirst({
    where: { customerId, revokedAt: null },
    select: { id: true },
  });
  if (active) {
    return { enabled: true, revokedAt: null, urlPath: undefined, token: undefined };
  }

  const created = await createCustomerPortalLink(customerId);
  return { enabled: true, revokedAt: null, urlPath: created.urlPath, token: created.token };
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

  const [customer, statement, settings] = await Promise.all([
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
    getSettings(),
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
    storeName: settings.storeName,
    storePhone: settings.storePhone || null,
    currency: settings.currency,
  };
}

export async function getPortalOrders(token: string) {
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
  const customer = await prisma.customer.findFirst({
    where: { id: link.customer_id, deletedAt: null },
    select: { phone: true },
  });
  if (!customer?.phone) return [];

  const orders = await prisma.retailOrder.findMany({
    where: { phone: customer.phone },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    total: Number(o.total),
    subtotal: Number(o.subtotal),
    discount: Number(o.discount),
    items: o.items as { name: string; quantity: number; unitPrice: number }[],
    createdAt: o.createdAt,
  }));
}

export async function subscribeToArrival(
  token: string,
  productId: string | null,
  productName: string,
  pushSubscription: object | null
) {
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
  const customer = await prisma.customer.findFirst({
    where: { id: link.customer_id, deletedAt: null },
    select: { id: true, phone: true },
  });
  if (!customer) throw new AppError("Customer not found", 404, "CUSTOMER_NOT_FOUND");

  // Upsert: one subscription per customer+product combo
  const existing = await prisma.productArrivalSubscription.findFirst({
    where: { customerId: customer.id, productId: productId ?? undefined, notifiedAt: null },
  });
  if (existing) return existing;

  return prisma.productArrivalSubscription.create({
    data: {
      customerId: customer.id,
      productId: productId ?? null,
      productName,
      phone: customer.phone,
      pushSubscription: pushSubscription ?? undefined,
    },
  });
}

export async function getMyArrivalSubscriptions(token: string) {
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
  return prisma.productArrivalSubscription.findMany({
    where: { customerId: link.customer_id, notifiedAt: null },
    select: { id: true, productId: true, productName: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function cancelArrivalSubscription(token: string, subscriptionId: string) {
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
  await prisma.productArrivalSubscription.deleteMany({
    where: { id: subscriptionId, customerId: link.customer_id },
  });
}

// Called from invoice service when a PURCHASE invoice is confirmed
export async function notifyProductArrival(productId: string, productName: string) {
  const subs = await prisma.productArrivalSubscription.findMany({
    where: { productId, notifiedAt: null },
  });
  if (subs.length === 0) return;

  const settings = await getSettings();
  const storeName = settings.storeName || "المتجر";

  await Promise.all(
    subs.map(async (sub) => {
      const msg = `مرحباً، المنتج "${productName}" أصبح متوفراً الآن في ${storeName}. تفضل بزيارتنا!`;
      // WhatsApp notification
      if (sub.phone) {
        sendWhatsAppText(sub.phone, msg).catch(() => null);
      }
      // Browser push notification
      if (sub.pushSubscription) {
        sendPushNotification(sub.pushSubscription as any, {
          title: `${productName} — متوفر الآن`,
          body: `المنتج أصبح متاحاً في ${storeName}`,
        }).catch(() => null);
      }
      // Mark notified
      await prisma.productArrivalSubscription.update({
        where: { id: sub.id },
        data: { notifiedAt: new Date() },
      });
    })
  );
}

export async function getPublicInvoiceByToken(token: string, invoiceId: string) {
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

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, customerId: link.customer_id },
    include: {
      items: { include: { product: { select: { id: true, name: true, itemNumber: true } } } },
    },
  });

  if (!invoice) {
    throw new AppError("Invoice not found", 404, "INVOICE_NOT_FOUND");
  }

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    date: invoice.date,
    type: invoice.type,
    status: invoice.status,
    paymentType: invoice.paymentType,
    totalAmount: Number(invoice.totalAmount),
    paidAmount: Number(invoice.paidAmount),
    remainingAmount: Number(invoice.remainingAmount),
    discount: Number(invoice.discount),
    items: invoice.items.map((item) => ({
      id: item.id,
      productName: item.product?.name ?? item.productId,
      itemNumber: item.product?.itemNumber ?? null,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      totalPrice: Number(item.totalPrice),
      unit: item.unit,
    })),
  };
}
