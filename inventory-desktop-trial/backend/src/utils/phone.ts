/**
 * Normalize an Iraqi phone number to canonical international form
 * (964XXXXXXXXXX, digits only, no plus, no leading zero). This MUST match the
 * SQL in the 20260617020000_normalize_customer_phones migration and the
 * frontend normalizePhone() so the WhatsApp integration and catalog phone
 * lookups always compare the same shape.
 */
export function normalizePhone(input: string | null | undefined): string {
  let digits = String(input ?? "").replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("964")) return digits;
  if (digits.startsWith("0")) return `964${digits.slice(1)}`;
  if (digits.startsWith("7")) return `964${digits}`;
  return digits;
}
