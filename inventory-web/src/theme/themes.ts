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
  fontFamily: string
}

export interface ThemeDef {
  id: ThemeId
  label: string
  description: string
  vars: ThemeVars
}

const INTER = '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif'
const CAIRO = '"Cairo", "Segoe UI", system-ui, -apple-system, sans-serif'

export const themes: ThemeDef[] = [
  {
    id: "zoho",
    label: "احترافي (Zoho)",
    description: "ألوان مريحة للعين، واجهة بيضاء نقية مع شريط جانبي داكن.",
    vars: {
      accent: "#006EEA",
      accentSoft: "rgba(0, 110, 234, 0.10)",
      receipt: "#2ecc71",
      payment: "#f39c12",
      expense: "#ef4444",
      sale: "#2ecc71",
      purchase: "#006EEA",
      pageBg: "#F4F5F8",
      cardBg: "#ffffff",
      cardBorder: "#E5E7EB",
      headerBg: "#ffffff",
      sidebar: "#1E222D",
      sidebarText: "#D1D5DB",
      primaryBtn: "#006EEA",
      primaryBtnHover: "#005bb5",
      textPrimary: "#111827",
      fontFamily: INTER,
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
      fontFamily: INTER,
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
      fontFamily: CAIRO,
    },
  },
  {
    id: "bold",
    label: "بولد 🔥",
    description: "ألوان جريئة — برتقالي حارق على خلفية فحمية داكنة.",
    vars: {
      accent: "#f97316",
      accentSoft: "rgba(249, 115, 22, 0.12)",
      receipt: "#22c55e",
      payment: "#facc15",
      expense: "#ef4444",
      sale: "#22c55e",
      purchase: "#f97316",
      pageBg: "#111418",
      cardBg: "#1c2128",
      cardBorder: "#2d3748",
      headerBg: "#0d1117",
      sidebar: "#0d1117",
      sidebarText: "#f97316",
      primaryBtn: "#f97316",
      primaryBtnHover: "#ea6c00",
      textPrimary: "#f0f4f8",
      fontFamily: CAIRO,
    },
  },
  {
    id: "designer",
    label: "ديزاينر 🎨",
    description: "مينيمال أنيق — كريمي دافئ مع لمسة فيروزية.",
    vars: {
      accent: "#0d9488",
      accentSoft: "rgba(13, 148, 136, 0.10)",
      receipt: "#0d9488",
      payment: "#d97706",
      expense: "#e11d48",
      sale: "#0d9488",
      purchase: "#6366f1",
      pageBg: "#f7f5f2",
      cardBg: "#fffdf9",
      cardBorder: "#e8e2da",
      headerBg: "#fffdf9",
      sidebar: "#1a2937",
      sidebarText: "#94a3b8",
      primaryBtn: "#0d9488",
      primaryBtnHover: "#0f766e",
      textPrimary: "#1a2937",
      fontFamily: CAIRO,
    },
  },
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
    if (k === "fontFamily") {
      root.style.setProperty("--theme-fontFamily", v)
    } else {
      root.style.setProperty(`--theme-${k}`, v)
    }
  }
  root.dataset.theme = def.id
  setStoredThemeId(def.id)
}
