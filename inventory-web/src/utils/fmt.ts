/**
 * Format a number with English digits (0-9) and comma thousand separators.
 * e.g.  1234567 → "1,234,567"
 */
export function fmt(value: number | string | undefined | null, decimals?: number): string {
  const n = Number(value ?? 0)
  if (Number.isNaN(n)) return "0"
  return n.toLocaleString("en-US", decimals !== undefined ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals } : {})
}

/** Same as fmt() but always shows 2 decimal places. */
export function fmtD(value: number | string | undefined | null): string {
  return fmt(value, 2)
}
