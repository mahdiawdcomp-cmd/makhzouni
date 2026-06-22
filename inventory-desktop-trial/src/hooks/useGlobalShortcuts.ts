import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"

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
  const location = useLocation()

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Skip if user is typing
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) {
        return
      }

      if (!e.ctrlKey && !e.metaKey) return

      const open = (path: string) => {
        if (location.pathname === "/invoices/new") window.open(path, "_blank", "noopener,noreferrer")
        else navigate(path)
      }

      switch (e.key.toLowerCase()) {
        case "n":
          e.preventDefault()
          open("/invoices/new")
          break
        case "p":
          // Ctrl+P normally = print — only intercept if Shift is held (Ctrl+Shift+P)
          if (e.shiftKey) {
            e.preventDefault()
            open("/pos")
          }
          break
        case "m":
          e.preventDefault()
          open("/inventory")
          break
        case "k":
          e.preventDefault()
          open("/account")
          break
        case "h":
          e.preventDefault()
          open("/")
          break
        case ",":
          e.preventDefault()
          open("/settings")
          break
      }
    }

    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [location.pathname, navigate])
}
