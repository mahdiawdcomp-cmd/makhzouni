// 5 theme presets. Each defines accent colors + sidebar/header tones.
// Applied as CSS variables on <html> so any consumer that reads them updates.

export type ThemeId = "zoho" | "classic" | "exclusive" | "bold" | "designer"

export interface ThemeVars {
  accent: string
  accentSoft: string
  receipt: string
  payment: string
  expense: string
  sale: string
  purchase: string
  pageBg: string
  cardBg: string
  cardBorder: string
  headerBg: string
  sidebar: string
  sidebarText: string
  primaryBtn: string
  primaryBtnHover: string
  textPrimary: string
}

export interface ThemeDef {
  id: ThemeId
  label: string
  description: string
  vars: ThemeVars
}

export const themes: ThemeDef[] = [
  {
    id: "zoho",
    label: "احترافي (Zoho)",
    description: "ألوان مريحة للعين، واجهة بيضاء نقية مع شريط جانبي داكن.",
    vars: {
      accent: "#006EEA", // Zoho Blue
      accentSoft: "rgba(0, 110, 234, 0.10)",
      receipt: "#2ecc71", // Soft Green
      payment: "#f39c12", // Soft Orange
      expense: "#ef4444", // Red
      sale: "#2ecc71",
      purchase: "#006EEA",
      pageBg: "#F4F5F8", // Zoho Light Gray Background
      cardBg: "#ffffff",
      cardBorder: "#E5E7EB", // Very light gray border
      headerBg: "#ffffff",
      sidebar: "#1E222D", // Zoho Dark Sidebar
      sidebarText: "#D1D5DB", // Light text for sidebar
      primaryBtn: "#006EEA",
      primaryBtnHover: "#005bb5",
      textPrimary: "#111827", // Dark Gray Text
    },
  },
  {
    id: "classic",
    label: "كلاسيكي",
    description: "أبيض نظيف مع شريط جانبي داكن ولمسة ذهبية.",
    vars: {
      accent: "#f59e0b",
      accentSoft: "rgba(245, 158, 11, 0.10)",
      receipt: "#10b981",
      payment: "#f97316",
      expense: "#ef4444",
      sale: "#10b981",
      purchase: "#f59e0b",
      pageBg: "#f1f5f9",
      cardBg: "#ffffff",
      cardBorder: "#e2e8f0",
      headerBg: "#ffffff",
      sidebar: "#0f172a",
      sidebarText: "#e2e8f0",
      primaryBtn: "#0f172a",
      primaryBtnHover: "#1e293b",
      textPrimary: "#0f172a",
    },
  },
  {
    id: "exclusive",
    label: "داكن ✨",
    description: "داكن كامل — ذهبي على أسود.",
    vars: {
      accent: "#facc15",
      accentSoft: "rgba(250, 204, 21, 0.15)",
      receipt: "#22d3ee",
      payment: "#f472b6",
      expense: "#fb7185",
      sale: "#34d399",
      purchase: "#facc15",
      pageBg: "#09090b",
      cardBg: "#18181b",
      cardBorder: "#3f3f46",
      headerBg: "#000000",
      sidebar: "#000000",
      sidebarText: "#facc15",
      primaryBtn: "#facc15",
      primaryBtnHover: "#eab308",
      textPrimary: "#fafafa",
    },
  }
]

const THEME_STORAGE_KEY = "inventory_theme_preset"

export function getStoredThemeId(): ThemeId {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    if (raw && themes.some((t) => t.id === raw)) return raw as ThemeId
  } catch {}
  return "zoho"
}

export function setStoredThemeId(id: ThemeId) {
  try { localStorage.setItem(THEME_STORAGE_KEY, id) } catch {}
}

export function applyTheme(id: ThemeId) {
  const def = themes.find((t) => t.id === id) ?? themes[0]
  const root = document.documentElement
  for (const [k, v] of Object.entries(def.vars)) {
    root.style.setProperty(`--theme-${k}`, v)
  }
  root.dataset.theme = def.id
  setStoredThemeId(def.id)
}
