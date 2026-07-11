import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { sendWhatsAppText } from "./whatsapp.service";
import { buildDedupeKey, notifyAdmin } from "./app-notification.service";
import { NotificationCategory, NotificationSeverity, NotificationType } from "../constants/notifications";
import { getSettings } from "./settings.service";

// «الديون الشخصية» — cash lent to people unrelated to the shop (friends,
// acquaintances...). Completely separate from Customer/accounting. One debt =
// one lump sum, no partial settlement (see PersonalDebt model comment).

export type PersonalDebtComputedStatus = "PENDING" | "OVERDUE" | "PAID";

function computeStatus(status: string, dueDate: Date): PersonalDebtComputedStatus {
  if (status === "PAID") return "PAID";
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return dueDate < startOfToday ? "OVERDUE" : "PENDING";
}

function withComputedStatus<T extends { status: string; dueDate: Date }>(debt: T) {
  return { ...debt, computedStatus: computeStatus(debt.status, debt.dueDate) };
}

export async function listPersonalDebts() {
  const debts = await prisma.personalDebt.findMany({
    orderBy: { dueDate: "asc" },
    include: { creator: { select: { id: true, name: true } } },
  });
  return debts.map(withComputedStatus);
}

export async function createPersonalDebt(
  input: { personName: string; amount: number; dueDate: string; notes?: string },
  createdById?: string,
) {
  const debt = await prisma.personalDebt.create({
    data: {
      personName: input.personName,
      amount: input.amount,
      dueDate: new Date(input.dueDate),
      notes: input.notes,
      createdById,
    },
  });
  return withComputedStatus(debt);
}

export async function updatePersonalDebt(
  id: string,
  input: { personName?: string; amount?: number; dueDate?: string; notes?: string },
) {
  const existing = await prisma.personalDebt.findUnique({ where: { id } });
  if (!existing) throw new AppError("الدين غير موجود", 404, "PERSONAL_DEBT_NOT_FOUND");

  const debt = await prisma.personalDebt.update({
    where: { id },
    data: {
      personName: input.personName,
      amount: input.amount,
      dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      notes: input.notes,
    },
  });
  return withComputedStatus(debt);
}

export async function markPersonalDebtPaid(id: string) {
  const existing = await prisma.personalDebt.findUnique({ where: { id } });
  if (!existing) throw new AppError("الدين غير موجود", 404, "PERSONAL_DEBT_NOT_FOUND");

  const debt = await prisma.personalDebt.update({
    where: { id },
    data: { status: "PAID", paidAt: new Date() },
  });
  return withComputedStatus(debt);
}

export async function deletePersonalDebt(id: string) {
  const existing = await prisma.personalDebt.findUnique({ where: { id } });
  if (!existing) throw new AppError("الدين غير موجود", 404, "PERSONAL_DEBT_NOT_FOUND");
  await prisma.personalDebt.delete({ where: { id } });
}

// Daily cron: every non-PAID debt whose due date has arrived gets an in-app
// notification (bell icon) + a WhatsApp text to the configured personal
// number. dedupeKey buckets by day, so this naturally repeats once per day
// until the debt is marked PAID — no separate "last reminded" bookkeeping.
export async function runPersonalDebtReminderJob() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const dueDebts = await prisma.personalDebt.findMany({
    where: { status: "PENDING", dueDate: { lte: startOfToday } },
  });

  if (dueDebts.length === 0) return { checked: 0 };

  const settings = await getSettings();
  const reminderPhone = settings.personalDebtReminderWhatsappNumber?.trim();

  for (const debt of dueDebts) {
    const amountText = Number(debt.amount).toLocaleString();
    const dueDateText = debt.dueDate.toLocaleDateString();
    const message = `تذكير: ${debt.personName} يستحق منك استلام ${amountText} — كان موعد الاستلام ${dueDateText}.`;

    await notifyAdmin({
      type: NotificationType.PERSONAL_DEBT_DUE,
      category: NotificationCategory.PERSONAL_DEBTS,
      severity: NotificationSeverity.IMPORTANT,
      title: "دين شخصي مستحق",
      message,
      entityType: "PERSONAL_DEBT",
      entityId: debt.id,
      actionUrl: "/personal-debts",
      metadata: { personalDebtId: debt.id },
      dedupeKey: buildDedupeKey(NotificationType.PERSONAL_DEBT_DUE, debt.id),
    });

    if (reminderPhone) {
      await sendWhatsAppText(reminderPhone, message).catch(() => {
        // WhatsApp being unconfigured/down must never block the in-app reminder above.
      });
    }
  }

  return { checked: dueDebts.length };
}
