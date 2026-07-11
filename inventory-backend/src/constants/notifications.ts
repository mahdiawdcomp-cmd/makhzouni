// Notification taxonomy (batch 23B foundation).
// These are the vocabulary for the new AppNotification model. They are NOT yet
// wired to any event producer (invoice/whatsapp/transfer/stock) — that happens in
// later batches (23D+). Stored as plain strings in the DB (not PG enums) so new
// types/categories can be added without a migration.

export const NotificationSeverity = {
  IMPORTANT: "IMPORTANT",
  MEDIUM: "MEDIUM",
  NORMAL: "NORMAL",
} as const;
export type NotificationSeverity =
  (typeof NotificationSeverity)[keyof typeof NotificationSeverity];

export const NotificationCategory = {
  IMPORTANT: "IMPORTANT",
  NEGATIVE_SALE: "NEGATIVE_SALE",
  INVOICES: "INVOICES",
  APPROVALS: "APPROVALS",
  STOCK: "STOCK",
  CUSTOMERS_DEBT: "CUSTOMERS_DEBT",
  WHATSAPP: "WHATSAPP",
  SYSTEM: "SYSTEM",
  // «الديون الشخصية» — unrelated to shop customers, see PersonalDebt model.
  PERSONAL_DEBTS: "PERSONAL_DEBTS",
} as const;
export type NotificationCategory =
  (typeof NotificationCategory)[keyof typeof NotificationCategory];

export const NotificationType = {
  NEGATIVE_STOCK_SALE: "NEGATIVE_STOCK_SALE",
  BELOW_COST_SALE: "BELOW_COST_SALE",
  NEGATIVE_STOCK_ON_EDIT: "NEGATIVE_STOCK_ON_EDIT",
  INVOICE_CREATED: "INVOICE_CREATED",
  INVOICE_UPDATED: "INVOICE_UPDATED",
  APPROVAL_PENDING: "APPROVAL_PENDING",
  TRANSFER_APPROVED: "TRANSFER_APPROVED",
  TRANSFER_REJECTED: "TRANSFER_REJECTED",
  WHATSAPP_SEND_FAILED: "WHATSAPP_SEND_FAILED",
  SYSTEM_ERROR: "SYSTEM_ERROR",
  BACKUP_FAILED: "BACKUP_FAILED",
  CYCLE_COUNT_SUBMITTED: "CYCLE_COUNT_SUBMITTED",
  PERSONAL_DEBT_DUE: "PERSONAL_DEBT_DUE",
} as const;
export type NotificationType =
  (typeof NotificationType)[keyof typeof NotificationType];

// Role fan-out targets for a notification. "ALL" = every authenticated user.
export const NotificationRoleTarget = {
  ADMIN: "ADMIN",
  STAFF: "STAFF",
  ALL: "ALL",
} as const;
export type NotificationRoleTarget =
  (typeof NotificationRoleTarget)[keyof typeof NotificationRoleTarget];
