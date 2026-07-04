// Shared Arabic-aware search helpers used by product & customer search so the
// behaviour is identical and Android (which hits the backend search) benefits
// too. Normalization folds the common Arabic letter variants and diacritics,
// then results are ranked by relevance (exact code → prefix → phrase → tokens).

/**
 * Fold Arabic letter variants + diacritics + digits so "أحمد" matches "احمد",
 * "مجنونه" matches "مجنونة", "كبرى" matches "كبري". Also lowercases, strips
 * tatweel/tashkeel, normalizes Arabic-Indic digits, and collapses whitespace.
 */
export function normalizeArabic(input: string): string {
  if (!input) return "";
  return input
    .toLowerCase()
    // Arabic-Indic + Eastern Arabic-Indic digits → ASCII
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    // strip tashkeel (harakat) + superscript alef
    .replace(/[ً-ْٰ]/g, "")
    // strip tatweel (ـ)
    .replace(/ـ/g, "")
    // alef variants → ا
    .replace(/[آأإٱ]/g, "ا")
    // alef maqsura ى → ي
    .replace(/ى/g, "ي")
    // teh marbuta ة → ه
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchTokens(query: string): string[] {
  return normalizeArabic(query).split(" ").filter(Boolean);
}

/** Characters of `needle` appear in order within `haystack` (loose fuzzy). */
function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) return true;
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
}

export interface RankableProduct {
  name: string;
  itemNumber: string;
  qrCode?: string | null;
  cartonQrCode?: string | null;
  category?: string | null;
}

/**
 * Relevance score for a product against a (raw) query. 0 = no match.
 * Precision over recall — tiers: 8 exact code · 7 code prefix · 6 exact name ·
 * 5 name prefix · 4 name contains phrase · 3 every query word appears.
 *
 * The old loose "some tokens" and "fuzzy subsequence" tiers were removed on
 * purpose (they produced dozens of barely-related matches). Substring matching
 * within a word still works via the phrase / all-words tiers.
 */
export function scoreProduct(product: RankableProduct, query: string): number {
  const full = normalizeArabic(query);
  if (!full) return 1;
  const tokens = full.split(" ").filter(Boolean);

  const name = normalizeArabic(product.name);
  const category = normalizeArabic(product.category ?? "");
  const codes = [product.itemNumber, product.qrCode ?? "", product.cartonQrCode ?? ""]
    .map((c) => normalizeArabic(c))
    .filter(Boolean);

  if (codes.some((c) => c === full)) return 8;
  if (codes.some((c) => c.startsWith(full) || full.startsWith(c))) return 7;

  if (name === full) return 6;
  if (name.startsWith(full)) return 5;
  if (name.includes(full)) return 4;

  const haystacks = [name, category, ...codes];
  if (tokens.every((t) => haystacks.some((h) => h.includes(t)))) return 3;

  return 0;
}

export interface RankableCustomer {
  name: string;
  phone?: string | null;
  address?: string | null;
}

/** Relevance score for a customer. Phone is matched on digits only. */
export function scoreCustomer(customer: RankableCustomer, query: string): number {
  const full = normalizeArabic(query);
  if (!full) return 1;
  const tokens = full.split(" ").filter(Boolean);

  const name = normalizeArabic(customer.name);
  const address = normalizeArabic(customer.address ?? "");
  const phone = (customer.phone ?? "").replace(/\D/g, "");
  const queryDigits = full.replace(/\D/g, "");

  if (queryDigits && phone === queryDigits) return 6;
  if (queryDigits && phone.startsWith(queryDigits)) return 5;
  if (name.includes(full)) return 4;

  const tokenHits = tokens.filter(
    (t) => name.includes(t) || address.includes(t) || (!!t.replace(/\D/g, "") && phone.includes(t.replace(/\D/g, ""))),
  ).length;
  if (tokenHits === tokens.length) return 3;
  if (tokenHits > 0) return 2;

  if (tokens.every((t) => isSubsequence(t, name))) return 1;
  return 0;
}
