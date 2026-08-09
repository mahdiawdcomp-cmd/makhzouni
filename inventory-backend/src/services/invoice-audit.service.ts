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

const unitLabels: Record<string, string> = {
  PIECE: "قطعة",
  CARTON: "كارتون",
  BOX: "علبة",
  DOZEN: "دزينة",
};

function itemLineText(item: unknown) {
  if (!item || typeof item !== "object") return "-";
  const record = item as Record<string, unknown>;
  const name = String(record.productName ?? "-");
  const unit = unitLabels[String(record.unit ?? "")] ?? String(record.unit ?? "");
  const warehouse = record.warehouseName ? ` — ${record.warehouseName}` : "";
  return `${name}: ${valueText(record.quantity)} ${unit} × ${valueText(record.unitPrice)} = ${valueText(record.totalPrice)}${warehouse}`;
}

type ItemsDiff = {
  added: unknown[];
  removed: unknown[];
  changed: Array<{ productName?: unknown; before?: unknown; after?: unknown }>;
};

// Old vs new product list for an invoice edit, instead of collapsing the
// whole "items" field down to a bare count (which told the reader nothing).
function formatItemsDiff(diff: ItemsDiff) {
  return {
    added: diff.added.map(itemLineText),
    removed: diff.removed.map(itemLineText),
    changed: diff.changed.map((entry) => ({
      productName: String(entry.productName ?? "-"),
      before: itemLineText(entry.before),
      after: itemLineText(entry.after),
    })),
  };
}

function summarizeChanges(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || !("changes" in metadata)) return [];
  const changes = (metadata as { changes?: unknown }).changes;
  if (!changes || typeof changes !== "object") return [];

  return Object.entries(changes as Record<string, { before?: unknown; after?: unknown; itemsDiff?: ItemsDiff }>)
    .filter(([key]) => key !== "updatedAt")
    .map(([key, change]) => {
      if (key === "items" && change?.itemsDiff) {
        return {
          field: key,
          label: fieldLabels[key] ?? key,
          before: undefined as string | undefined,
          after: undefined as string | undefined,
          itemsDiff: formatItemsDiff(change.itemsDiff),
        };
      }
      return {
        field: key,
        label: fieldLabels[key] ?? key,
        before: valueText(change?.before),
        after: valueText(change?.after),
        itemsDiff: undefined as ReturnType<typeof formatItemsDiff> | undefined,
      };
    });
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
