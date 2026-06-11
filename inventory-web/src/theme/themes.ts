// 10 theme presets + custom. Each defines accent colors + sidebar/header tones.
// Applied as CSS variables on <html> so any consumer that reads them updates.

export type ThemeId =
  | "zoho" | "classic" | "exclusive" | "bold" | "designer"
  | "midnight" | "rosegold" | "forest" | "coral" | "mono"
  | "custom"

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
  preview?: { bg: string; accent: string }
}

export type FontId = "inter" | "cairo" | "tajawal" | "noto_kufi" | "ibm_plex"

export interface FontDef {
  id: FontId
  label: string
  stack: string
  sample: string
}

export const fonts: FontDef[] = [
  { id: "inter",    label: "Inter (Latin)",         stack: '"Inter", "Segoe UI", system-ui, sans-serif',                         sample: "Inventory Pro" },
  { id: "cairo",    label: "Cairo (كايرو)",          stack: '"Cairo", "Segoe UI", system-ui, sans-serif',                         sample: "مخزوني برو" },
  { id: "tajawal",  label: "Tajawal (تجوال)",        stack: '"Tajawal", "Segoe UI", system-ui, sans-serif',                       sample: "مخزوني برو" },
  { id: "noto_kufi",label: "Noto Kufi (نوتو كوفي)",  stack: '"Noto Kufi Arabic", "Segoe UI", system-ui, sans-serif',              sample: "مخزوني برو" },
  { id: "ibm_plex", label: "IBM Plex Arabic (آي بي إم)", stack: '"IBM Plex Sans Arabic", "Segoe UI", system-ui, sans-serif',    sample: "مخزوني برو" },
]

export const FONT_STORAGE_KEY = "inventory_font"

export function getStoredFontStack(): string {
  try {
    const id = localStorage.getItem(FONT_STORAGE_KEY) as FontId | null
    if (id) {
      const f = fonts.find((x) => x.id === id)
      if (f) return f.stack
    }
  } catch {}
  return fonts[0].stack
}

export function setStoredFont(id: FontId) {
  try { localStorage.setItem(FONT_STORAGE_KEY, id) } catch {}
}

const INTER = '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif'
const CAIRO = '"Cairo", "Segoe UI", system-ui, -apple-system, sans-serif'
const TAJAWAL = '"Tajawal", "Segoe UI", system-ui, -apple-system, sans-serif'
const NOTO_KUFI = '"Noto Kufi Arabic", "Segoe UI", system-ui, -apple-system, sans-serif'

export const themes: ThemeDef[] = [
  // ── Original 5 ──────────────────────────────────────────────────────────────
  {
    id: "zoho",
    label: "احترافي",
    description: "واجهة بيضاء نقية مع شريط جانبي داكن — مريحة للعمل اليومي.",
    preview: { bg: "#F4F5F8", accent: "#006EEA" },
    vars: {
      accent: "#006EEA", accentSoft: "rgba(0,110,234,0.10)",
      receipt: "#2ecc71", payment: "#f39c12", expense: "#ef4444",
      sale: "#2ecc71", purchase: "#006EEA",
      pageBg: "#F4F5F8", cardBg: "#ffffff", cardBorder: "#E5E7EB",
      headerBg: "#ffffff", sidebar: "#1E222D", sidebarText: "#D1D5DB",
      primaryBtn: "#006EEA", primaryBtnHover: "#005bb5",
      textPrimary: "#111827", fontFamily: INTER,
    },
  },
  {
    id: "classic",
    label: "كلاسيكي",
    description: "أبيض نظيف مع لمسة ذهبية — أناقة لا تقاوم.",
    preview: { bg: "#f1f5f9", accent: "#f59e0b" },
    vars: {
      accent: "#f59e0b", accentSoft: "rgba(245,158,11,0.10)",
      receipt: "#10b981", payment: "#f97316", expense: "#ef4444",
      sale: "#10b981", purchase: "#f59e0b",
      pageBg: "#f1f5f9", cardBg: "#ffffff", cardBorder: "#e2e8f0",
      headerBg: "#ffffff", sidebar: "#0f172a", sidebarText: "#e2e8f0",
      primaryBtn: "#0f172a", primaryBtnHover: "#1e293b",
      textPrimary: "#0f172a", fontFamily: INTER,
    },
  },
  {
    id: "exclusive",
    label: "داكن ✨",
    description: "داكن كامل — ذهبي على أسود.",
    preview: { bg: "#09090b", accent: "#facc15" },
    vars: {
      accent: "#facc15", accentSoft: "rgba(250,204,21,0.15)",
      receipt: "#22d3ee", payment: "#f472b6", expense: "#fb7185",
      sale: "#34d399", purchase: "#facc15",
      pageBg: "#09090b", cardBg: "#18181b", cardBorder: "#3f3f46",
      headerBg: "#000000", sidebar: "#000000", sidebarText: "#facc15",
      primaryBtn: "#facc15", primaryBtnHover: "#eab308",
      textPrimary: "#fafafa", fontFamily: CAIRO,
    },
  },
  {
    id: "bold",
    label: "بولد 🔥",
    description: "برتقالي حارق على فحمي داكن — جريء ومختلف.",
    preview: { bg: "#111418", accent: "#f97316" },
    vars: {
      accent: "#f97316", accentSoft: "rgba(249,115,22,0.12)",
      receipt: "#22c55e", payment: "#facc15", expense: "#ef4444",
      sale: "#22c55e", purchase: "#f97316",
      pageBg: "#111418", cardBg: "#1c2128", cardBorder: "#2d3748",
      headerBg: "#0d1117", sidebar: "#0d1117", sidebarText: "#f97316",
      primaryBtn: "#f97316", primaryBtnHover: "#ea6c00",
      textPrimary: "#f0f4f8", fontFamily: CAIRO,
    },
  },
  {
    id: "designer",
    label: "ديزاينر 🎨",
    description: "كريمي دافئ مع فيروزي — مينيمال أنيق.",
    preview: { bg: "#f7f5f2", accent: "#0d9488" },
    vars: {
      accent: "#0d9488", accentSoft: "rgba(13,148,136,0.10)",
      receipt: "#0d9488", payment: "#d97706", expense: "#e11d48",
      sale: "#0d9488", purchase: "#6366f1",
      pageBg: "#f7f5f2", cardBg: "#fffdf9", cardBorder: "#e8e2da",
      headerBg: "#fffdf9", sidebar: "#1a2937", sidebarText: "#94a3b8",
      primaryBtn: "#0d9488", primaryBtnHover: "#0f766e",
      textPrimary: "#1a2937", fontFamily: CAIRO,
    },
  },

  // ── 5 New Premium Themes ─────────────────────────────────────────────────────
  {
    id: "midnight",
    label: "ليلي 🌙",
    description: "أزرق ملكي عميق مع سيان ساطع — شعور ليلي فاخر.",
    preview: { bg: "#0a0f1e", accent: "#06b6d4" },
    vars: {
      accent: "#06b6d4", accentSoft: "rgba(6,182,212,0.12)",
      receipt: "#06b6d4", payment: "#a78bfa", expense: "#fb7185",
      sale: "#34d399", purchase: "#06b6d4",
      pageBg: "#0a0f1e", cardBg: "#0f172a", cardBorder: "#1e3a5f",
      headerBg: "#070c18", sidebar: "#050a14", sidebarText: "#7dd3fc",
      primaryBtn: "#06b6d4", primaryBtnHover: "#0891b2",
      textPrimary: "#e2f4ff", fontFamily: TAJAWAL,
    },
  },
  {
    id: "rosegold",
    label: "وردي ذهبي 🌸",
    description: "دفء ذهبي مع وردي ناعم — أنثوي وراقي.",
    preview: { bg: "#fdf2f4", accent: "#e11d48" },
    vars: {
      accent: "#e11d48", accentSoft: "rgba(225,29,72,0.10)",
      receipt: "#be185d", payment: "#d97706", expense: "#dc2626",
      sale: "#be185d", purchase: "#d97706",
      pageBg: "#fdf2f4", cardBg: "#fff5f7", cardBorder: "#fce7eb",
      headerBg: "#fff5f7", sidebar: "#1c0a12", sidebarText: "#f9a8c9",
      primaryBtn: "#e11d48", primaryBtnHover: "#be123c",
      textPrimary: "#1c0a12", fontFamily: CAIRO,
    },
  },
  {
    id: "forest",
    label: "غابات 🌿",
    description: "أخضر داكن عميق مع إضاءة زمردية — هادئ وطبيعي.",
    preview: { bg: "#0a1a0e", accent: "#22c55e" },
    vars: {
      accent: "#22c55e", accentSoft: "rgba(34,197,94,0.12)",
      receipt: "#22c55e", payment: "#84cc16", expense: "#f87171",
      sale: "#22c55e", purchase: "#86efac",
      pageBg: "#0a1a0e", cardBg: "#0f2312", cardBorder: "#1a3d20",
      headerBg: "#071209", sidebar: "#060f08", sidebarText: "#86efac",
      primaryBtn: "#22c55e", primaryBtnHover: "#16a34a",
      textPrimary: "#dcfce7", fontFamily: TAJAWAL,
    },
  },
  {
    id: "coral",
    label: "مرجاني 🪸",
    description: "برتقالي مرجاني دافئ على أبيض مائل — حيوي ومبهج.",
    preview: { bg: "#fff8f5", accent: "#f97316" },
    vars: {
      accent: "#f97316", accentSoft: "rgba(249,115,22,0.10)",
      receipt: "#10b981", payment: "#f97316", expense: "#ef4444",
      sale: "#10b981", purchase: "#f97316",
      pageBg: "#fff8f5", cardBg: "#ffffff", cardBorder: "#ffe8d9",
      headerBg: "#ffffff", sidebar: "#1a0d07", sidebarText: "#fdba74",
      primaryBtn: "#f97316", primaryBtnHover: "#ea6c00",
      textPrimary: "#1a0d07", fontFamily: NOTO_KUFI,
    },
  },
  {
    id: "mono",
    label: "أحادي ⬛",
    description: "أبيض نقي وأسود خالص — بساطة مطلقة بلا تشتيت.",
    preview: { bg: "#ffffff", accent: "#18181b" },
    vars: {
      accent: "#18181b", accentSoft: "rgba(24,24,27,0.08)",
      receipt: "#16a34a", payment: "#d97706", expense: "#dc2626",
      sale: "#16a34a", purchase: "#18181b",
      pageBg: "#f9fafb", cardBg: "#ffffff", cardBorder: "#e4e4e7",
      headerBg: "#ffffff", sidebar: "#09090b", sidebarText: "#a1a1aa",
      primaryBtn: "#18181b", primaryBtnHover: "#27272a",
      textPrimary: "#09090b", fontFamily: INTER,
    },
  },

  // ── Custom (user-defined colors) ─────────────────────────────────────────────
  {
    id: "custom",
    label: "مخصص 🎛️",
    description: "اختر ألوانك الخاصة — لون الشركة أو ما يناسبك.",
    preview: { bg: "#f0f0ff", accent: "#7c3aed" },
    vars: {
      accent: "#7c3aed", accentSoft: "rgba(124,58,237,0.10)",
      receipt: "#22c55e", payment: "#f97316", expense: "#ef4444",
      sale: "#22c55e", purchase: "#7c3aed",
      pageBg: "#f5f3ff", cardBg: "#ffffff", cardBorder: "#ede9fe",
      headerBg: "#ffffff", sidebar: "#1e1b4b", sidebarText: "#c4b5fd",
      primaryBtn: "#7c3aed", primaryBtnHover: "#6d28d9",
      textPrimary: "#1e1b4b", fontFamily: CAIRO,
    },
  },
]

// ── Custom theme storage ─────────────────────────────────────────────────────

export interface CustomThemeOverrides {
  accent?: string
  sidebar?: string
  pageBg?: string
  fontFamily?: string
}

const CUSTOM_OVERRIDES_KEY = "inventory_custom_theme"

export function getCustomOverrides(): CustomThemeOverrides {
  try {
    const raw = localStorage.getItem(CUSTOM_OVERRIDES_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

export function saveCustomOverrides(o: CustomThemeOverrides) {
  try { localStorage.setItem(CUSTOM_OVERRIDES_KEY, JSON.stringify(o)) } catch {}
}

function hexToRgb(hex: string): string {
  const h = hex.replace("#", "")
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},0.10)`
}

function darken(hex: string): string {
  const h = hex.replace("#", "")
  const r = Math.max(0, parseInt(h.slice(0, 2), 16) - 20)
  const g = Math.max(0, parseInt(h.slice(2, 4), 16) - 20)
  const b = Math.max(0, parseInt(h.slice(4, 6), 16) - 20)
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
}

// ── Storage ──────────────────────────────────────────────────────────────────

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

// ── Apply ─────────────────────────────────────────────────────────────────────

export function applyTheme(id: ThemeId, overrides?: CustomThemeOverrides) {
  const def = themes.find((t) => t.id === id) ?? themes[0]
  const root = document.documentElement

  let vars = { ...def.vars }

  if (id === "custom") {
    const o = overrides ?? getCustomOverrides()
    if (o.accent) {
      vars.accent = o.accent
      vars.accentSoft = hexToRgb(o.accent)
      vars.primaryBtn = o.accent
      vars.primaryBtnHover = darken(o.accent)
      vars.sale = o.accent
    }
    if (o.sidebar) vars.sidebar = o.sidebar
    if (o.pageBg)  vars.pageBg = o.pageBg
    if (o.fontFamily) vars.fontFamily = o.fontFamily
  }

  for (const [k, v] of Object.entries(vars)) {
    if (k === "fontFamily") {
      root.style.setProperty("--theme-fontFamily", v)
    } else {
      root.style.setProperty(`--theme-${k}`, v)
    }
  }
  root.dataset.theme = def.id
  setStoredThemeId(id)
}
