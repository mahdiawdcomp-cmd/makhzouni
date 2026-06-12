import { useEffect } from "react"
import { useNavigate } from "react-router-dom"

/**
 * Global keyboard shortcuts registered once at the app level.
 *
 * Ctrl+N  → فاتورة بيع جديدة
 * Ctrl+P  → وضع الكاشير POS
 * Ctrl+M  → المخزون
 * Ctrl+K  → كشف حساب (Account Lookup)
 * Ctrl+R  → التقارير
 * Ctrl+H  → الرئيسية
 * Ctrl+,  → الإعدادات
 *
 * NOT intercepted when focus is inside <input> / <textarea> / [contenteditable]
 * so typing is never broken.
 */
export function useGlobalShortcuts() {
  const navigate = useNavigate()

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Skip if user is typing
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) {
        return
      }

      if (!e.ctrlKey && !e.metaKey) return

      switch (e.key.toLowerCase()) {
        case "n":
          e.preventDefault()
          navigate("/invoices/new")
          break
        case "p":
          // Ctrl+P normally = print — only intercept if Shift is held (Ctrl+Shift+P)
          if (e.shiftKey) {
            e.preventDefault()
            navigate("/pos")
          }
          break
        case "m":
          e.preventDefault()
          navigate("/inventory")
          break
        case "k":
          e.preventDefault()
          navigate("/account")
          break
        case "h":
          e.preventDefault()
          navigate("/")
          break
        case ",":
          e.preventDefault()
          navigate("/settings")
          break
      }
    }

    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [navigate])
}
