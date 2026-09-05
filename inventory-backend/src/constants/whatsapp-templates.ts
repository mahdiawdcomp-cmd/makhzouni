// ── Meta template kinds, in ONE place ────────────────────────────────────────
//
// The request validator and the send controller each used to keep their own
// list, and they drifted: the validator still allowed only voucher/statement/
// portal long after debtReminder and inactiveCustomer had been wired up, so
// those two sends were rejected at the door with "Invalid enum value" and never
// reached the code that would have handled them.
//
// Both sides now read this map, so adding a kind is one edit and cannot be
// half-done. The values are the AppSettings keys holding each approved Meta
// template name.

export const TEMPLATE_KIND_SETTING = {
  voucher: "voucherTemplateName",
  statement: "statementTemplateName",
  portal: "portalLinkTemplateName",
  debtReminder: "debtReminderTemplateName",
  inactiveCustomer: "inactiveCustomerTemplateName",
  countLink: "countLinkTemplateName",
} as const;

export type TemplateKind = keyof typeof TEMPLATE_KIND_SETTING;

export const TEMPLATE_KINDS = Object.keys(TEMPLATE_KIND_SETTING) as [TemplateKind, ...TemplateKind[]];
