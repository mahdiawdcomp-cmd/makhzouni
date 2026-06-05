import prisma from "../config/database";

const fieldLabels: Record<string, string> = {
  date: "التاريخ",
  discount: "الخصم",
  tax: "الضريبة",
  paidAmount: "المبلغ المدفوع",
  paymentType: "نوع الدفع",
  totalAmount: "الإجمالي",
  remainingAmount: "الباقي",
  status: "الحالة",
  items: "المواد",
};

function actionLabel(action: string) {
  if (action === "CREATE") return "إنشاء";
  if (action === "UPDATE") return "تعديل";
  if (action === "DELETE") return "إلغاء";
  if (action === "REACTIVATE") return "إرجاع نشطة";
  return action;
}

function valueText(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") {
    if (Array.isArray(value)) return `${value.length} مادة`;
    return JSON.stringify(value);
  }
  return String(value);
}

function summarizeChanges(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || !("changes" in metadata)) return [];
  const changes = (metadata as { changes?: unknown }).changes;
  if (!changes || typeof changes !== "object") return [];

  return Object.entries(changes as Record<string, { before?: unknown; after?: unknown }>)
    .filter(([key]) => key !== "updatedAt")
    .map(([key, change]) => ({
      field: key,
      label: fieldLabels[key] ?? key,
      before: valueText(change?.before),
      after: valueText(change?.after),
    }));
}

export async function getInvoiceAuditTrail(invoiceId: string) {
  const logs = await prisma.auditLog.findMany({
    where: {
      entity: "invoices",
      OR: [
        { recordId: invoiceId },
        { metadata: { path: ["path"], string_contains: `/invoices/${invoiceId}` } },
      ],
    },
    include: {
      user: { select: { id: true, name: true, username: true, role: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return logs.map((log) => ({
    id: log.id,
    action: log.action,
    actionLabel: actionLabel(log.action),
    createdAt: log.createdAt,
    user: log.user,
    changes: summarizeChanges(log.metadata),
  }));
}
