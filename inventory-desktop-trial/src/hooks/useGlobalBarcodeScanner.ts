import { useEffect, useRef } from "react"
import { useLocation, useNavigate } from "react-router-dom"

/**
 * Global USB/Bluetooth barcode-gun listener.
 *
 * A barcode scanner acts like a keyboard that types the code very fast and
 * presses Enter at the end. This hook listens at the document level so the gun
 * works from ANY page: when a scan completes it opens a new sales invoice with
 * the scanned code in the URL (`/invoices/new?scan=<code>`), and the invoice
 * page auto-adds the matching product (carton barcode → CARTON, otherwise PIECE).
 *
 * It deliberately does nothing when:
 *  - the user is typing in a field (INPUT/TEXTAREA/SELECT or contentEditable),
 *  - we're already on /invoices/new or /pos (those pages have their own scanner),
 *  - the keystrokes are too slow to be a scanner (a human typing).
 */
// Read the barcode char from the PHYSICAL key (e.code) so the gun works the
// same under an Arabic keyboard layout (where e.key would be Arabic garbage).
function charFromCode(e: KeyboardEvent): string | null {
  const code = e.code
  if (code.startsWith("Digit")) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6)
  if (code.startsWith("Key")) return code.slice(3).toLowerCase()
  if (code === "Minus" || code === "NumpadSubtract") return "-"
  if (e.key.length === 1 && /[a-zA-Z0-9-]/.test(e.key)) return e.key.toLowerCase()
  return null
}

export function useGlobalBarcodeScanner() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const bufferRef = useRef("")
  const lastTimeRef = useRef(0)

  useEffect(() => {
    function isEditable(el: EventTarget | null): boolean {
      const node = el as HTMLElement | null
      if (!node) return false
      const tag = node.tagName
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        node.isContentEditable
      )
    }

    function onKey(e: KeyboardEvent) {
      // Pages with their own dedicated scanner handle scans themselves.
      if (pathname === "/invoices/new" || pathname === "/pos") return
      if (isEditable(e.target)) return
      if (e.ctrlKey || e.altKey || e.metaKey) return

      const now = Date.now()
      // Gap > 100ms between keys → not a scanner burst; restart the buffer.
      if (now - lastTimeRef.current > 100) bufferRef.current = ""
      lastTimeRef.current = now

      if (e.key === "Enter") {
        const code = bufferRef.current.trim()
        bufferRef.current = ""
        if (code.length >= 3) {
          e.preventDefault()
          navigate(`/invoices/new?scan=${encodeURIComponent(code)}`)
        }
        return
      }

      const ch = charFromCode(e)
      if (ch) bufferRef.current += ch
    }

    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [navigate, pathname])
}
