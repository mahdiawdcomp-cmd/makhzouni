import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  applyFontSize,
  applyTheme,
  fonts,
  fontSizes,
  getCustomOverrides,
  getStoredFontSizeId,
  getStoredThemeId,
  saveCustomOverrides,
  setStoredFont,
  setStoredFontSizeId,
  themes,
  type CustomThemeOverrides,
  type FontDef,
  type FontId,
  type FontSizeDef,
  type FontSizeId,
  type ThemeId,
} from "./themes"

interface ThemeContextValue {
  themeId: ThemeId
  setThemeId: (id: ThemeId) => void
  presets: typeof themes
  fontId: FontId
  setFontId: (id: FontId) => void
  fontDefs: FontDef[]
  fontSizeId: FontSizeId
  setFontSizeId: (id: FontSizeId) => void
  fontSizeDefs: FontSizeDef[]
  customOverrides: CustomThemeOverrides
  setCustomOverrides: (o: CustomThemeOverrides) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdRaw] = useState<ThemeId>(() => getStoredThemeId())
  const [fontId, setFontIdRaw] = useState<FontId>(() => {
    try {
      const id = localStorage.getItem("inventory_font") as FontId | null
      if (id && fonts.some((f) => f.id === id)) return id
    } catch {}
    return "inter"
  })
  const [customOverrides, setCustomOverridesRaw] = useState<CustomThemeOverrides>(() => getCustomOverrides())
  const [fontSizeId, setFontSizeIdRaw] = useState<FontSizeId>(() => getStoredFontSizeId())

  const applyFont = useCallback((id: FontId) => {
    const f = fonts.find((x) => x.id === id)
    if (f) document.documentElement.style.setProperty("--theme-fontFamily", f.stack)
  }, [])

  useEffect(() => {
    applyTheme(themeId, themeId === "custom" ? customOverrides : undefined)
  }, [themeId, customOverrides])

  useEffect(() => {
    if (themeId !== "custom") applyFont(fontId)
  }, [fontId, themeId, applyFont])

  useEffect(() => {
    applyFontSize(fontSizeId)
  }, [fontSizeId])

  const setThemeId = useCallback((id: ThemeId) => {
    setThemeIdRaw(id)
  }, [])

  const setFontId = useCallback((id: FontId) => {
    setFontIdRaw(id)
    setStoredFont(id)
  }, [])

  const setFontSizeId = useCallback((id: FontSizeId) => {
    setFontSizeIdRaw(id)
    setStoredFontSizeId(id)
  }, [])

  const setCustomOverrides = useCallback((o: CustomThemeOverrides) => {
    setCustomOverridesRaw(o)
    saveCustomOverrides(o)
    if (themeId === "custom") applyTheme("custom", o)
  }, [themeId])

  const value = useMemo<ThemeContextValue>(() => ({
    themeId, setThemeId,
    presets: themes,
    fontId, setFontId,
    fontDefs: fonts,
    fontSizeId, setFontSizeId,
    fontSizeDefs: fontSizes,
    customOverrides, setCustomOverrides,
  }), [themeId, setThemeId, fontId, setFontId, fontSizeId, setFontSizeId, customOverrides, setCustomOverrides])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider")
  return ctx
}
