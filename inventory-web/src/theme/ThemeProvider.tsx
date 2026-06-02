import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { applyTheme, getStoredThemeId, themes, type ThemeId } from "./themes"

interface ThemeContextValue {
  themeId: ThemeId
  setThemeId: (id: ThemeId) => void
  presets: typeof themes
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(() => getStoredThemeId())

  useEffect(() => {
    applyTheme(themeId)
  }, [themeId])

  const value = useMemo<ThemeContextValue>(() => ({ themeId, setThemeId, presets: themes }), [themeId])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider")
  return ctx
}
