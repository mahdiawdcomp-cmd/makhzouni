import { useEffect, useRef } from "react"

// Read a barcode character from the PHYSICAL key (e.code), not e.key — so a
// hardware scanner works the same whether the OS keyboard is set to Arabic or
// English. Under an Arabic layout e.key returns Arabic letters / Arabic-Indic
// digits, which is exactly the "الاحرف بالعربي" garbling that breaks lookups.
export function scanCharFromCode(e: KeyboardEvent): string | null {
  const code = e.code
  if (code.startsWith("Digit")) return code.slice(5)            // Digit7 → "7"
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6)          // Numpad7 → "7"
  if (code.startsWith("Key")) return code.slice(3).toLowerCase() // KeyA → "a"
  if (code === "Minus" || code === "NumpadSubtract") return "-"
  // Fallback for environments that don't report e.code: accept a clean ASCII char.
  if (e.key.length === 1 && /[a-zA-Z0-9-]/.test(e.key)) return e.key.toLowerCase()
  return null
}

// Arabic (101) keyboard BASE layer → the Latin char on the same physical key.
// On mobile browsers the physical-key trick (e.code) isn't available, so a
// scanner under an Arabic OS layout just dumps these Arabic letters into the
// field. Mapping them back recovers the original ASCII barcode. Product QR codes
// are `PCS-<uuid>` / `CTN-<uuid>` where the uuid is only [0-9a-f-] — all on the
// base layer — so even if the uppercase prefix gets mangled, the uuid survives.
const AR_TO_LATIN: Record<string, string> = {
  "ض": "q", "ص": "w", "ث": "e", "ق": "r", "ف": "t", "غ": "y", "ع": "u", "ه": "i", "خ": "o", "ح": "p", "ج": "[", "د": "]",
  "ش": "a", "س": "s", "ي": "d", "ب": "f", "ل": "g", "ا": "h", "ت": "j", "ن": "k", "م": "l", "ك": ";", "ط": "'",
  "ئ": "z", "ء": "x", "ؤ": "c", "ر": "v", "ى": "n", "ة": "m", "و": ",", "ز": ".", "ظ": "/",
  // Arabic-Indic digits, in case the layout emits them instead of ASCII digits.
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
}

export function deArabicizeLayout(input: string): string {
  // lam-alef (and its ligatures) sits on the "b" key.
  const s = input.replace(/لا|ﻻ|ﻷ|ﻵ|ﻹ/g, "b")
  let out = ""
  for (const ch of s) out += AR_TO_LATIN[ch] ?? ch
  return out
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

// Lowercased candidate strings to try when matching a possibly-Arabic-garbled
// scan against a product barcode: the raw text, its de-arabicized form, and any
// uuid embedded in that form (so a mangled `PCS-`/`CTN-` prefix doesn't matter).
export function barcodeMatchCandidates(raw: string): string[] {
  const out = new Set<string>()
  const base = raw.trim().toLowerCase()
  if (base) out.add(base)
  const latin = deArabicizeLayout(raw).trim().toLowerCase()
  if (latin) out.add(latin)
  const uuid = latin.match(UUID_RE)?.[0]
  if (uuid) out.add(uuid)
  return [...out]
}

type ProductLike = { itemNumber: string; qrCode?: string | null; cartonQrCode?: string | null }

// Find the product a (possibly garbled) scanned code points at, tolerant of an
// Arabic keyboard layout. Returns whether it matched the CARTON code.
export function findProductByScan<T extends ProductLike>(
  products: T[],
  raw: string,
): { product: T; isCarton: boolean } | null {
  const cands = barcodeMatchCandidates(raw)
  if (!cands.length) return null
  const hit = (field?: string | null) => {
    const f = (field ?? "").toLowerCase()
    if (!f) return false
    // Exact match for short numeric item numbers; substring only for long
    // candidates (uuids) so a short query can't accidentally match everything.
    return cands.some((c) => f === c || (c.length >= 8 && f.includes(c)))
  }
  for (const p of products) {
    if (hit(p.cartonQrCode)) return { product: p, isCarton: true }
    if (hit(p.qrCode) || hit(p.itemNumber)) return { product: p, isCarton: false }
  }
  return null
}

type ScanOptions = {
  /** Called with the clean ASCII code once a scan burst completes (on Enter). */
  onScan: (code: string) => void
  /** Disable the listener (e.g. while a modal owns the keyboard). Default true. */
  enabled?: boolean
  /** Minimum burst length to count as a real scan. Default 3. */
  minLength?: number
}

/**
 * Global barcode-gun listener that works even while a text field is focused and
 * regardless of the OS keyboard layout.
 *
 * A scanner types the code very fast and presses Enter. This hook reconstructs
 * the code from the physical keys during that fast burst, wipes any characters
 * the gun leaked into the focused field, then calls `onScan` with the clean
 * ASCII code. Slow human typing (gaps > 100ms) is ignored so the field keeps
 * working normally for manual search/entry.
 */
export function useBarcodeScanner({ onScan, enabled = true, minLength = 3 }: ScanOptions) {
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan
  const bufRef = useRef("")
  const lastRef = useRef(0)
  const snapRef = useRef<{ el: HTMLInputElement | HTMLTextAreaElement; val: string } | null>(null)

  useEffect(() => {
    if (!enabled) return

    // Undo any characters the gun leaked into a focused field during a burst.
    function restoreField(el: HTMLInputElement | HTMLTextAreaElement, val: string) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
      setter?.call(el, val)
      el.dispatchEvent(new Event("input", { bubbles: true }))
    }

    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.altKey || e.metaKey) return

      const now = Date.now()
      const gap = now - lastRef.current
      lastRef.current = now
      // A slow gap means a human typing, not a scanner gun → fresh buffer.
      if (gap > 100) { bufRef.current = ""; snapRef.current = null }

      if (e.key === "Enter") {
        const code = bufRef.current.trim()
        bufRef.current = ""
        // A fast multi-char burst ending in Enter = a real scan.
        if (code.length >= minLength) {
          e.preventDefault()
          e.stopPropagation()
          const snap = snapRef.current
          snapRef.current = null
          if (snap) restoreField(snap.el, snap.val)
          onScanRef.current(code)
        }
        return
      }

      const ch = scanCharFromCode(e)
      if (ch) {
        // At burst start, snapshot the focused field so we can wipe leaked chars.
        if (bufRef.current === "") {
          const el = document.activeElement as HTMLElement | null
          if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
            snapRef.current = { el: el as HTMLInputElement, val: (el as HTMLInputElement).value }
          } else {
            snapRef.current = null
          }
        }
        bufRef.current += ch
      }
    }

    // Capture phase so we see keys before the focused input does.
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [enabled, minLength])
}
