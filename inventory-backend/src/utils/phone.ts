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

/**
 * Every spelling the same Iraqi number can be stored as.
 *
 * The app normalises on write, but rows predating the normalisation migration —
 * or imported, or edited straight in SQL — still hold «07…». A duplicate check
 * that searched only the canonical form answered "not found" for a customer
 * sitting right there, which is the one answer it must never get wrong.
 */
export function phoneVariants(input: string | null | undefined): string[] {
  const digits = String(input ?? "").replace(/[^\d]/g, "");
  if (!digits) return [];
  const intl = normalizePhone(digits);
  const national = intl.startsWith("964") ? intl.slice(3) : intl;
  return [...new Set([digits, intl, national, `0${national}`])].filter(Boolean);
}
