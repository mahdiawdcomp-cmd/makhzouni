import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"

export interface ShortcutDef {
  id: string
  label: string
  defaultKey: string
  defaultMod: "ctrl" | "ctrl+shift"
  action: "navigate"
  target: string
}

export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  { id: "new-invoice", label: "فاتورة جديدة",    defaultKey: "n", defaultMod: "ctrl",       action: "navigate", target: "/invoices/new" },
  { id: "pos",         label: "كاشير POS",        defaultKey: "p", defaultMod: "ctrl+shift", action: "navigate", target: "/pos" },
  { id: "inventory",   label: "المخزون",          defaultKey: "m", defaultMod: "ctrl",       action: "navigate", target: "/inventory" },
  { id: "customers",   label: "الزبائن",          defaultKey: "b", defaultMod: "ctrl",       action: "navigate", target: "/customers" },
  { id: "account",     label: "كشف حساب",         defaultKey: "k", defaultMod: "ctrl",       action: "navigate", target: "/account" },
  { id: "reports",     label: "التقارير",         defaultKey: "r", defaultMod: "ctrl",       action: "navigate", target: "/reports" },
  { id: "vouchers",    label: "السندات",          defaultKey: "v", defaultMod: "ctrl",       action: "navigate", target: "/vouchers" },
  { id: "transfers",   label: "التحويلات",        defaultKey: "t", defaultMod: "ctrl",       action: "navigate", target: "/transfers" },
  { id: "home",        label: "الرئيسية",         defaultKey: "h", defaultMod: "ctrl",       action: "navigate", target: "/" },
  { id: "settings",    label: "الإعدادات",        defaultKey: ",", defaultMod: "ctrl",       action: "navigate", target: "/settings" },
]

const STORAGE_KEY = "makhzouni_shortcuts"

export interface ShortcutOverride {
  id: string
  key: string
  mod: "ctrl" | "ctrl+shift"
  disabled?: boolean
}

export function loadShortcutOverrides(): ShortcutOverride[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveShortcutOverrides(overrides: ShortcutOverride[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
}

export function resolveShortcuts(overrides: ShortcutOverride[]): (ShortcutDef & { key: string; mod: string; disabled: boolean })[] {
  return DEFAULT_SHORTCUTS.map((def) => {
    const ov = overrides.find((o) => o.id === def.id)
    return {
      ...def,
      key: ov?.key ?? def.defaultKey,
      mod: ov?.mod ?? def.defaultMod,
      disabled: ov?.disabled ?? false,
    }
  })
}

export function useGlobalShortcuts() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return
      if (!e.ctrlKey && !e.metaKey) return

      const overrides = loadShortcutOverrides()
      const shortcuts = resolveShortcuts(overrides)

      for (const sc of shortcuts) {
        if (sc.disabled) continue
        const keyMatch = e.key.toLowerCase() === sc.key.toLowerCase()
        const modMatch =
          sc.mod === "ctrl+shift"
            ? (e.ctrlKey || e.metaKey) && e.shiftKey
            : (e.ctrlKey || e.metaKey) && !e.shiftKey
        if (!keyMatch || !modMatch) continue

        e.preventDefault()
        if (location.pathname !== sc.target) {
          // In browser: open new tab if already on invoices/new to preserve work
          if (location.pathname === "/invoices/new") {
            window.open(sc.target, "_blank", "noopener,noreferrer")
          } else {
            navigate(sc.target)
          }
        }
        break
      }
    }

    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [location.pathname, navigate])
}
