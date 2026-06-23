import prisma from "../config/database";

type Severity = "info" | "success" | "warning" | "error";

interface FriendlyNotification {
  id: string;
  createdAt: Date;
  severity: Severity;
  icon: string;          // a lucide icon name the frontend can render
  title: string;         // short Arabic title (e.g. "فاتورة جديدة")
  message: string;       // longer Arabic message (e.g. "موظف بيع 5 قطع من …")
  link?: string;         // optional in-app link (e.g. /invoices/<id>)
  actor?: { id: string; name: string; role: string };
}

function safeJson(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function pickString(obj: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const v = obj?.[key];
  return typeof v === "string" ? v : undefined;
}

function pickNumber(obj: Record<string, unknown> | null | undefined, key: string): number | undefined {
  const v = obj?.[key];
  return typeof v === "number" ? v : undefined;
}

// Map an AuditLog row → human-readable notification.
function describe(log: {
  id: string;
  createdAt: Date;
  action: string;
  entity: string;
  recordId: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  user: { id: string; name: string; role: string } | null;
}): FriendlyNotification | null {
  const after = safeJson(log.after);
  const meta = safeJson(log.metadata);
  const actorName = log.user?.name ?? "موظف";

  // Invoices
  if (log.entity === "invoices") {
    const invoiceNumber = pickString(after, "invoiceNumber");
    const customerName = pickString(safeJson(after?.customer ?? {}), "name") ?? "زبون";
    const isPurchase = pickString(after, "type") === "PURCHASE";
    const total = pickNumber(after, "totalAmount") ?? 0;

    if (log.action === "CREATE") {
      return {
        id: log.id,
        createdAt: log.createdAt,
        severity: isPurchase ? "warning" : "success",
        icon: isPurchase ? "ShoppingCart" : "Receipt",
        title: isPurchase ? "فاتورة شراء جديدة" : "فاتورة بيع جديدة",
        message: `${actorName} أنشأ ${isPurchase ? "فاتورة شراء" : "فاتورة بيع"} ${invoiceNumber ?? ""} لـ ${customerName} بقيمة ${total.toLocaleString()}`,
        link: log.recordId ? `/invoices/${log.recordId}` : undefined,
        actor: log.user ?? undefined,
      };
    }
    if (log.action === "DELETE") {
      return {
        id: log.id,
        createdAt: log.createdAt,
        severity: "error",
        icon: "Trash2",
        title: "إلغاء فاتورة",
        message: `${actorName} ألغى الفاتورة ${invoiceNumber ?? log.recordId ?? ""}`,
        link: log.recordId ? `/invoices/${log.recordId}` : undefined,
        actor: log.user ?? undefined,
      };
    }
    if (log.action === "UPDATE") {
      return {
        id: log.id,
        createdAt: log.createdAt,
        severity: "info",
        icon: "Pencil",
        title: "تعديل فاتورة",
        message: `${actorName} عدّل الفاتورة ${invoiceNumber ?? log.recordId ?? ""}`,
        link: log.recordId ? `/invoices/${log.recordId}` : undefined,
        actor: log.user ?? undefined,
      };
    }
  }

  // Vouchers
  if (log.entity === "vouchers") {
    const type = pickString(after, "type") ?? "RECEIPT";
    const voucherNumber = pickString(after, "voucherNumber");
    const amount = pickNumber(after, "amount") ?? 0;
    const customerName = pickString(safeJson(after?.customer ?? {}), "name");
    const description = pickString(after, "description");

    const typeLabel = type === "RECEIPT" ? "قبض" : type === "PAYMENT" ? "دفع" : "مصاريف";
    const sev: Severity = type === "RECEIPT" ? "success" : type === "PAYMENT" ? "warning" : "error";

    if (log.action === "CREATE") {
      return {
        id: log.id,
        createdAt: log.createdAt,
        severity: sev,
        icon: type === "EXPENSE" ? "Wallet" : "ReceiptText",
        title: `سند ${typeLabel}`,
        message:
          type === "EXPENSE"
            ? `${actorName} سجّل مصروف "${description ?? ""}" بقيمة ${amount.toLocaleString()}`
            : `${actorName} أنشأ سند ${typeLabel} ${voucherNumber ?? ""} ${customerName ? `من ${customerName}` : ""} بقيمة ${amount.toLocaleString()}`,
        link: log.recordId ? `/vouchers/${log.recordId}` : undefined,
        actor: log.user ?? undefined,
      };
    }
    if (log.action === "DELETE") {
      return {
        id: log.id,
        createdAt: log.createdAt,
        severity: "error",
        icon: "Trash2",
        title: `حذف سند ${typeLabel}`,
        message: `${actorName} حذف سند ${voucherNumber ?? log.recordId ?? ""}`,
        actor: log.user ?? undefined,
      };
    }
    if (log.action === "UPDATE") {
      return {
        id: log.id,
        createdAt: log.createdAt,
        severity: "info",
        icon: "Pencil",
        title: `تعديل سند ${typeLabel}`,
        message: `${actorName} عدّل سند ${voucherNumber ?? log.recordId ?? ""}`,
        link: log.recordId ? `/vouchers/${log.recordId}` : undefined,
        actor: log.user ?? undefined,
      };
    }
  }

  // Products
  if (log.entity === "products") {
    const name = pickString(after, "name") ?? log.recordId ?? "";
    if (log.action === "CREATE") {
      return {
        id: log.id,
        createdAt: log.createdAt,
        severity: "success",
        icon: "Package",
        title: "منتج جديد",
        message: `${actorName} أضاف منتج "${name}"`,
        link: log.recordId ? `/inventory/${log.recordId}` : undefined,
        actor: log.user ?? undefined,
      };
    }
    if (log.action === "DELETE") {
      return {
        id: log.id,
        createdAt: log.createdAt,
        severity: "warning",
        icon: "PackageMinus",
        title: "حذف منتج",
        message: `${actorName} حذف المنتج "${name}"`,
        actor: log.user ?? undefined,
      };
    }
    if (log.action === "UPDATE") {
      return {
        id: log.id,
        createdAt: log.createdAt,
        severity: "info",
        icon: "Pencil",
        title: "تعديل منتج",
        message: `${actorName} عدّل المنتج "${name}"`,
        link: log.recordId ? `/inventory/${log.recordId}` : undefined,
        actor: log.user ?? undefined,
      };
    }
  }

  // Customers
  if (log.entity === "customers") {
    const name = pickString(after, "name") ?? log.recordId ?? "";
    if (log.action === "CREATE") {
      return {
        id: log.id,
        createdAt: log.createdAt,
        severity: "success",
        icon: "UserPlus",
        title: "زبون جديد",
        message: `${actorName} أضاف الزبون "${name}"`,
        link: log.recordId ? `/customers/${log.recordId}` : undefined,
        actor: log.user ?? undefined,
      };
    }
  }

  return null;
}

export async function getRecentNotifications(limit = 30) {
  const [logs, catalogOrders] = await Promise.all([
    prisma.auditLog.findMany({
      where: { entity: { in: ["invoices", "vouchers", "products", "customers"] } },
      include: { user: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: "desc" },
      take: limit * 2,
    }),
    // Pending catalog order approvals — always shown until approved/rejected
    prisma.pendingApproval.findMany({
      where: { requestType: "CATALOG_ORDER", status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const auditNotifs = logs
    .map((row) =>
      describe({
        id: row.id,
        createdAt: row.createdAt,
        action: row.action,
        entity: row.entity,
        recordId: row.recordId,
        before: row.before,
        after: row.after,
        metadata: row.metadata,
        user: row.user,
      }),
    )
    .filter((n): n is FriendlyNotification => n !== null);

  const catalogNotifs: FriendlyNotification[] = catalogOrders.map((a) => {
    const d = (a.requestData && typeof a.requestData === "object" ? a.requestData : {}) as Record<string, unknown>;
    const customerName = typeof d.customerName === "string" ? d.customerName : "زبون";
    const itemCount = Array.isArray(d.displayItems) ? d.displayItems.length : "?";
    return {
      id: a.id,
      createdAt: a.createdAt,
      severity: "warning" as const,
      icon: "ShoppingBag",
      title: "طلب كاتلوك جديد ينتظر موافقتك",
      message: `${customerName} — ${itemCount} صنف — يحتاج موافقة`,
      link: "/approvals",
    };
  });

  // Merge and sort by date desc
  return [...auditNotifs, ...catalogNotifs]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}
