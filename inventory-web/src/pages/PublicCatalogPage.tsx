import { catalogText, resolveCartTier, type CatalogLayout } from "../utils/catalogLayout"
import { IRAQI_GOVERNORATES } from "../utils/governorates"
import { StudioGallery, StudioViewer, type StudioAlbum } from "../components/catalog/StudioGallery"
import { useBackGuard } from "../hooks/useBackClose"
import {
  deliveryLineFor,
  hasFullCartonOf,
  resolveCatalogEntry,
  shouldDisplay,
} from "../utils/catalogAccess"
import React, { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"
import { api, API_BASE_URL } from "../api/client"
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  Clock,
  ChevronRight,
  Grid,
  HelpCircle,
  ImageIcon,
  LayoutList,
  Minus,
  MoreHorizontal,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
  ShieldCheck,
  MessageCircle,
  ShoppingBag,
  ImageOff,
  Sparkles,
  Store,
  LayoutGrid,
  SlidersHorizontal,
  ShoppingCart,
  LogOut,
  UserRound,
  Trash2,
  Type,
  X,
} from "lucide-react"
import {
  getCatalogAccessStatus,
  getCatalogSession,
  getPublicCatalogProducts,
  getPublicCatalogProductImage,
  getGuestCatalogProducts,
  getVisitorCatalogProducts,
  getPublicIncomingItems,
  reserveIncomingItem,
  type IncomingItem,
  getGuestCatalogProductImage,
  guestCatalogEnter,
  trackCatalogProductView,
  postVisitorHeartbeat,
  submitGuestCatalogOrder,
  requestCatalogAccess,
  sendCatalogOtp,
  verifyCatalogOtp,
  verifyCatalogAccess,
  submitPublicCatalogOrder,
  validatePublicPromoCode,
  customerLogin,
  submitStorefrontSignupDetails,
  getVisitorSession,
  requestCatalogPrices,
  getCustomerAccount,
  EMPTY_CATALOG_FOOTER,
  EMPTY_CATALOG_TRUST,
  getCatalogProductDetail,
  getCatalogGalleryImage,
  getCatalogThumbnails,
  getMyCatalogReview,
  submitCatalogProductReview,
  type CatalogFooter,
  type CatalogTrust,
} from "../api/endpoints"
import type { CatalogStockFilter, PublicCatalogProduct } from "../types/api"
import { cn } from "../utils/cn"

/* ─── Types ─────────────────────────────────────────────────────────── */
type CatalogUnit = "PIECE" | "DOZEN" | "BOX" | "CARTON"
type CartLine = {
  id: string; product: PublicCatalogProduct; unit: CatalogUnit; quantity: number
  /** «عيّنة» — one piece to try before committing to a carton. */
  isSample?: boolean
}
type Theme = "clean" | "warm" | "dark" | "vibrant"
type SortKey = "default" | "best" | "rated" | "cheap" | "expensive" | "new"
type ViewMode = "grid" | "list"
type FontScale = "sm" | "md" | "lg" | "xl"
type FsKey = "xs" | "sm" | "md" | "lg" | "xl" | "xxl"
type AccentKey =
  | "emerald" | "teal" | "blue" | "indigo" | "violet"
  | "rose" | "red" | "orange" | "amber" | "slate"

/** Products shown per page. The catalog used to render every product at once,
 *  which on a phone with a few hundred products is a very long scroll. */
const PAGE_SIZE = 40

const storageKey = "inventory_catalog_access"
// A signed-in visitor's browsing session. Deliberately a different key from
// the customer token above: the two resolve to different things server-side.
const VISITOR_TOKEN_KEY = "catalog_visitor_token"
const themeKey = "catalog_theme"
const accentKey = "catalog_accent"
const fontScaleKey = "catalog_font_scale"
const UNIT_LABELS: Record<CatalogUnit, string> = { PIECE: "قطعة", DOZEN: "درزن", BOX: "علبة", CARTON: "كارتون" }
const UNIT_DESC: Record<CatalogUnit, (pcsInUnit: number) => string> = {
  PIECE: () => "قطعة واحدة",
  DOZEN: () => "12 قطعة",
  BOX: (n) => `${n} قطعة`,
  CARTON: (n) => `${n} قطعة`,
}
const UNITS: CatalogUnit[] = ["PIECE", "DOZEN", "BOX", "CARTON"]
/**
 * Every unit, always. Availability is what greys one out, not a setting.
 *
 * This used to obey the product's «الوحدات المخفية» list — a field whose own
 * description promises it only affects invoices. Hiding a unit to keep it off
 * the invoice screen silently emptied it out of the catalog too, which is how
 * 104 products ended up offering the shopper one unit or two instead of four.
 * The shopper sees all four and the stock decides which are clickable.
 */
const unitsFor = (): CatalogUnit[] => UNITS
// UNITS is ascending PIECE→CARTON, so the last entry is the largest bulk unit
// — the carton, which is what a wholesale shopper means by "one".
const defaultUnitFor = (): CatalogUnit => UNITS[UNITS.length - 1] ?? "PIECE"

/* ─── Theme system ───────────────────────────────────────────────────── */
/* ─── Design system ──────────────────────────────────────────────────
   The shopper picks three things independently — a surface mood
   (SURFACES), an accent colour (ACCENTS) and a text size (FONT_SCALES)
   — and buildTokens() combines them into the single token object every
   component in this page reads. Radii, shadows and the type scale live
   in there too, so the whole catalog stays visually consistent instead
   of each card inventing its own px values.
──────────────────────────────────────────────────────────────────── */

/** Colours that describe a surface mood only — no accent, no sizing. */
interface SurfaceTokens {
  isDark: boolean
  bg: string
  cardBg: string
  cardBorder: string
  text: string
  subtext: string
  catIdle: string
  catIdleText: string
  divider: string
  skeletonBg: string
  icon: string
  name: string
  desc: string
}

interface ThemeTokens extends SurfaceTokens {
  headerBg: string
  headerShadow: string
  accent: string
  accentText: string
  accentLight: string
  accentSoft: string
  catActive: string
  catActiveText: string
  inputBg: string
  inputText: string
  pillBg: string
  /* Shape + depth — one ladder, used everywhere */
  radiusSm: string
  radiusMd: string
  radiusLg: string
  radiusXl: string
  shadowSm: string
  shadowMd: string
  shadowLg: string
  /* Type scale, already multiplied by the shopper's font-size choice */
  fs: Record<FsKey, string>
}

const SURFACES: Record<Theme, SurfaceTokens> = {
  clean: {
    isDark: false,
    bg: "#f5f7fa", cardBg: "#ffffff", cardBorder: "rgba(15,23,42,0.07)",
    text: "#0f172a", subtext: "#64748b",
    catIdle: "#eef2f7", catIdleText: "#475569",
    divider: "#e4e9f0", skeletonBg: "#e8edf3",
    icon: "☀️", name: "نهاري", desc: "أبيض هادئ ومريح",
  },
  warm: {
    isDark: false,
    bg: "#fdf9f3", cardBg: "#fffefb", cardBorder: "rgba(120,53,15,0.09)",
    text: "#3f2d16", subtext: "#8a6a44",
    catIdle: "#f6eddf", catIdleText: "#7c5c34",
    divider: "#eee0cc", skeletonBg: "#f0e4d3",
    icon: "🏺", name: "دافئ", desc: "كريمي ناعم للعين",
  },
  dark: {
    isDark: true,
    bg: "#0b1120", cardBg: "#161f33", cardBorder: "rgba(255,255,255,0.08)",
    text: "#f1f5f9", subtext: "#94a3b8",
    catIdle: "#25314a", catIdleText: "#b6c2d4",
    divider: "#25314a", skeletonBg: "#1f2a40",
    icon: "🌙", name: "ليلي", desc: "مريح بالإضاءة الواطية",
  },
  vibrant: {
    isDark: false,
    bg: "#ffffff", cardBg: "#ffffff", cardBorder: "rgba(15,23,42,0.16)",
    text: "#000000", subtext: "#3f4a5a",
    catIdle: "#eceff3", catIdleText: "#1e293b",
    divider: "#cfd6e0", skeletonBg: "#e3e8ee",
    icon: "🔳", name: "تباين عالي", desc: "أوضح قراءة للنصوص",
  },
}

/** Curated accents — each has a lighter twin so it stays readable on the night surface. */
const ACCENTS: Array<{ key: AccentKey; name: string; hex: string; darkHex: string }> = [
  { key: "emerald", name: "أخضر", hex: "#047857", darkHex: "#10b981" },
  { key: "teal", name: "تركوازي", hex: "#0f766e", darkHex: "#2dd4bf" },
  { key: "blue", name: "أزرق", hex: "#1d4ed8", darkHex: "#60a5fa" },
  { key: "indigo", name: "نيلي", hex: "#4338ca", darkHex: "#818cf8" },
  { key: "violet", name: "بنفسجي", hex: "#6d28d9", darkHex: "#a78bfa" },
  { key: "rose", name: "وردي", hex: "#be123c", darkHex: "#fb7185" },
  { key: "red", name: "أحمر", hex: "#b91c1c", darkHex: "#f87171" },
  { key: "orange", name: "برتقالي", hex: "#c2410c", darkHex: "#fb923c" },
  { key: "amber", name: "عسلي", hex: "#a16207", darkHex: "#fbbf24" },
  { key: "slate", name: "رمادي", hex: "#334155", darkHex: "#94a3b8" },
]
const DEFAULT_ACCENT: AccentKey = "emerald"

const FONT_SCALES: Record<FontScale, { label: string; mult: number }> = {
  sm: { label: "صغير", mult: 0.9 },
  md: { label: "متوسط", mult: 1 },
  lg: { label: "كبير", mult: 1.16 },
  xl: { label: "أكبر", mult: 1.34 },
}

/* Base type scale in px at the "متوسط" setting. Deliberately larger than a
   phone-app scale — this is a storefront, product names and prices have to
   read at arm's length. */
const FS_BASE: Record<FsKey, number> = { xs: 11, sm: 12.5, md: 14, lg: 16, xl: 19, xxl: 23 }

/** Appends an alpha channel, but only to a real 6-digit hex (admin colours are free text). */
const withAlpha = (hex: string, alpha: string) =>
  /^#[0-9a-fA-F]{6}$/.test(hex) ? hex + alpha : hex

function buildTokens(
  theme: Theme, accentHex: string, scale: FontScale, bgOverride?: string | null,
): ThemeTokens {
  const s = SURFACES[theme]
  const mult = FONT_SCALES[scale].mult
  const fs = {} as Record<FsKey, string>
  for (const k of Object.keys(FS_BASE) as FsKey[]) {
    fs[k] = `${Math.round(FS_BASE[k] * mult * 10) / 10}px`
  }
  // Shadows are tinted by the surface so they read as depth, not as grey smudge.
  const tint = s.isDark ? "0,0,0" : "15,23,42"
  return {
    ...s,
    bg: bgOverride || s.bg,
    headerBg: s.cardBg,
    headerShadow: s.isDark ? "0 2px 18px rgba(0,0,0,0.5)" : "0 2px 18px rgba(15,23,42,0.10)",
    accent: accentHex,
    accentText: "#ffffff",
    accentLight: withAlpha(accentHex, s.isDark ? "2e" : "1f"),
    accentSoft: withAlpha(accentHex, s.isDark ? "17" : "10"),
    catActive: accentHex,
    catActiveText: "#ffffff",
    inputBg: s.catIdle,
    inputText: s.text,
    pillBg: s.isDark ? "rgba(255,255,255,0.035)" : "rgba(15,23,42,0.025)",
    radiusSm: "10px",
    radiusMd: "16px",
    radiusLg: "22px",
    radiusXl: "28px",
    shadowSm: `0 1px 2px rgba(${tint},0.05), 0 1px 3px rgba(${tint},0.04)`,
    shadowMd: `0 4px 14px rgba(${tint},0.08), 0 2px 5px rgba(${tint},0.04)`,
    shadowLg: `0 14px 36px rgba(${tint},0.16), 0 5px 10px rgba(${tint},0.07)`,
    fs,
  }
}

const SORT_LABELS: Record<SortKey, string> = {
  default: "الافتراضي", best: "الأكثر مبيعاً", rated: "الأعلى تقييماً",
  cheap: "الأرخص", expensive: "الأغلى", new: "الجديد أولاً",
}

/** Shopper-set filters that live alongside the category/type tabs. */
type Filters = { minPrice: string; maxPrice: string; inStockOnly: boolean; offersOnly: boolean }
const EMPTY_FILTERS: Filters = { minPrice: "", maxPrice: "", inStockOnly: false, offersOnly: false }
const countActiveFilters = (f: Filters) =>
  (f.minPrice.trim() ? 1 : 0) + (f.maxPrice.trim() ? 1 : 0) + (f.inStockOnly ? 1 : 0) + (f.offersOnly ? 1 : 0)

/* ─── Helpers ────────────────────────────────────────────────────────── */
const money = (v: number | null | undefined) =>
  new Intl.NumberFormat("en-US").format(Math.round(Number(v ?? 0)))

const pcs = (product: PublicCatalogProduct, unit: CatalogUnit): number => {
  const n = Math.max(1, product.pcsPerCarton)
  if (unit === "CARTON") return n
  if (unit === "BOX") return product.boxPieces != null && product.boxPieces > 0 ? product.boxPieces : Math.ceil(n / 2)
  if (unit === "DOZEN") return 12
  return 1 // PIECE
}

const linePrice = (product: PublicCatalogProduct, unit: CatalogUnit) =>
  Number(product.salePrice ?? 0) * pcs(product, unit)

const maxQty = (product: PublicCatalogProduct, unit: CatalogUnit) =>
  Math.floor(product.currentStock / pcs(product, unit))

// Carton-only catalog: a product is sellable only if it has at least one full
// carton. Lives in utils/catalogAccess so the rule can be tested on its own.
const hasFullCarton = hasFullCartonOf

// Samples key separately from a normal piece of the same product, so asking
// for a sample never merges into — or silently inflates — a real order line.
const key = (productId: string, unit: CatalogUnit, isSample = false) =>
  `${productId}:${unit}${isSample ? ":sample" : ""}`

/* ══════════════════════════════════════════════════════════════════════
   ROOT
══════════════════════════════════════════════════════════════════════ */
export function PublicCatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [accessToken, setAccessToken] = useState<string>(
    () => searchParams.get("access") || localStorage.getItem(storageKey) || "",
  )

  function handleAccess(token: string) {
    localStorage.setItem(storageKey, token)
    setAccessToken(token)
    setSearchParams({ access: token }, { replace: true })
  }
  function clearAccess() {
    localStorage.removeItem(storageKey)
    setAccessToken("")
    setSearchParams({}, { replace: true })
  }

  // A signed-in visitor: browsing without being on the shop's books. Kept
  // separate from the customer token because the two resolve to different
  // things server-side and must never be confused for one another.
  const [visitorToken, setVisitorToken] = useState<string>(
    () => localStorage.getItem(VISITOR_TOKEN_KEY) || "",
  )
  function handleVisitor(token: string) {
    localStorage.setItem(VISITOR_TOKEN_KEY, token)
    setVisitorToken(token)
  }
  const visitorQuery = useQuery({
    queryKey: ["visitor-session", visitorToken],
    queryFn: () => getVisitorSession(visitorToken),
    enabled: Boolean(visitorToken) && !accessToken,
    retry: false,
    staleTime: 60_000,
  })

  const sessionQuery = useQuery({
    queryKey: ["catalog-session", accessToken],
    queryFn: () => getCatalogSession(accessToken),
    enabled: Boolean(accessToken),
    retry: false,
    staleTime: 5 * 60_000,
  })

  // Fetched before any token exists so we know whether the merchant allows
  // anonymous browsing (catalogRequireOtp off) or requires the phone/OTP gate.
  const guestConfigQuery = useQuery({
    queryKey: ["catalog-design-public"],
    queryFn: () => api.get("/public/catalog/design").then(r => (r.data as { data?: { guestModeEnabled?: boolean; guestPhoneGate?: boolean; guestPricesVisible?: boolean } }).data ?? {}),
    enabled: !accessToken,
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (sessionQuery.isError) clearAccess()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionQuery.isError])

  // One decision, made in one place and tested on its own: which storefront
  // this person gets. The branches used to be an ordered chain of early
  // returns here, where the order WAS the rule — which is how opening the
  // shop to strangers came to outrank a signed-in visitor.
  const entry = resolveCatalogEntry({
    accessToken,
    visitorToken,
    visitor: visitorQuery.data ?? null,
    visitorLoading: visitorQuery.isLoading,
    guestConfig: guestConfigQuery.data ?? null,
    guestConfigLoading: guestConfigQuery.isLoading,
    // «سجّل دخول» has to lead somewhere even while the shop is open to
    // everyone — otherwise every route in ends at guest browsing and a
    // customer holding a code has no door to knock on.
    wantsLogin: searchParams.get("login") === "1",
  })

  const opening = (
    <div className="flex min-h-screen items-center justify-center bg-gray-50" dir="rtl">
      <div className="flex flex-col items-center gap-3 text-gray-400">
        <ShoppingBag className="h-10 w-10 animate-pulse" />
        <p className="text-sm font-medium">جاري فتح المتجر...</p>
      </div>
    </div>
  )

  if (entry.screen === "LOADING") return opening
  if (entry.screen === "LOGIN") return <LoginGate onAccess={handleAccess} onVisitor={handleVisitor} />

  if (entry.screen === "VISITOR_DETAILS") {
    return (
      <VisitorDetailsGate
        token={visitorToken}
        phone={visitorQuery.data?.phone ?? ""}
        onDone={() => visitorQuery.refetch()}
      />
    )
  }

  if (entry.screen === "VISITOR") {
    const visitor = visitorQuery.data!
    return (
      <CatalogShop
        accessToken="" visitorToken={visitorToken}
        allowPrices={entry.allowPrices} showStock stockFilter="FULL_CARTON_ONLY"
        customerId="" customerName={visitor.name ?? ""} customerPhone={visitor.phone}
        visitorProvince={visitor.province ?? ""}
        guestMode
        priceRequestPending={visitor.priceRequestPending}
        onPricesRequested={() => visitorQuery.refetch()}
      />
    )
  }

  if (entry.screen === "GUEST") {
    const shop = (
      <CatalogShop
        accessToken="" allowPrices={entry.allowPrices} showStock stockFilter="FULL_CARTON_ONLY"
        customerId="" customerName="" customerPhone="" guestMode
      />
    )
    // With the gate off, people look first and identify at checkout — the shop
    // trades on impulse, and asking for details before showing a single
    // product turns browsers away at the door.
    return entry.gated ? <GuestPhoneGate>{shop}</GuestPhoneGate> : shop
  }

  if (sessionQuery.isPending || sessionQuery.isLoading)
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50" dir="rtl">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <ShoppingBag className="h-10 w-10 animate-pulse" />
          <p className="text-sm font-medium">جاري فتح المتجر...</p>
        </div>
      </div>
    )

  if (!sessionQuery.data) return <LoginGate onAccess={handleAccess} onVisitor={handleVisitor} />

  const { customer, allowPrices, showStock, stockFilter, needsOtp, deliveryLine, firstOrderCoupon } = sessionQuery.data

  // 6-month re-verification: the link is still valid, we just need a fresh OTP.
  // No new admin approval and no new link — same token continues afterwards.
  if (needsOtp)
    return (
      <ReVerifyGate
        accessToken={accessToken}
        phone={customer.phone}
        onVerified={() => sessionQuery.refetch()}
      />
    )

  return (
    <CatalogShop
      accessToken={accessToken}
      allowPrices={allowPrices}
      showStock={showStock ?? true}
      stockFilter={stockFilter ?? "FULL_CARTON_ONLY"}
      customerId={customer.id}
      customerName={customer.name}
      customerPhone={customer.phone}
      deliveryLine={deliveryLine ?? null}
      firstOrderCoupon={firstOrderCoupon ?? null}
    />
  )
}

/* ══════════════════════════════════════════════════════════════════════
   RE-VERIFY GATE (existing link, OTP older than ~6 months)
══════════════════════════════════════════════════════════════════════ */
function ReVerifyGate({
  accessToken, phone, onVerified,
}: {
  accessToken: string; phone: string; onVerified: () => void
}) {
  const [otp, setOtp] = useState("")
  const [sent, setSent] = useState(false)
  const [msg, setMsg] = useState("")

  const sendMut = useMutation({
    mutationFn: () => sendCatalogOtp(phone),
    onSuccess: () => { setMsg(""); setSent(true) },
    onError: () => setMsg("تعذر إرسال الرمز. حاول مرة ثانية."),
  })

  const verifyMut = useMutation({
    mutationFn: async () => {
      await verifyCatalogOtp(phone, otp.trim())
      await verifyCatalogAccess(accessToken)
    },
    onSuccess: () => onVerified(),
    onError: () => setMsg("الرمز غير صحيح أو انتهت صلاحيته."),
  })

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50 px-4 py-8" dir="rtl">
      <div className="mb-6 flex flex-col items-center gap-2">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 shadow-lg shadow-emerald-200">
          <ShoppingBag className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-xl font-extrabold text-gray-900">تأكيد رقم الهاتف</h1>
        <p className="text-sm text-gray-500">مرّت فترة طويلة — نحتاج تأكيد سريع عبر الواتساب</p>
      </div>

      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl shadow-gray-100 ring-1 ring-gray-100 space-y-4">
        {!sent ? (
          <>
            <p className="text-center text-sm text-gray-600">
              سنرسل رمز تحقق إلى <span className="font-bold" dir="ltr">{phone}</span>
            </p>
            <button
              disabled={sendMut.isPending}
              onClick={() => sendMut.mutate()}
              className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white shadow-md shadow-emerald-100 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sendMut.isPending ? "جاري الإرسال..." : "إرسال رمز التحقق"}
            </button>
          </>
        ) : (
          <>
            <p className="text-center text-sm text-gray-600">أُرسل الرمز إلى {phone} عبر الواتساب</p>
            <input
              type="text" inputMode="numeric" maxLength={6}
              value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-center text-2xl font-bold tracking-widest outline-none focus:border-emerald-400 focus:bg-white"
              dir="ltr"
            />
            <button
              disabled={otp.length < 4 || verifyMut.isPending}
              onClick={() => verifyMut.mutate()}
              className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white shadow-md transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {verifyMut.isPending ? "جاري التحقق..." : "تحقق ودخول"}
            </button>
            <button onClick={() => sendMut.mutate()} disabled={sendMut.isPending} className="w-full text-center text-xs text-emerald-600 hover:underline">
              إعادة إرسال الرمز
            </button>
          </>
        )}

        {msg && (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{msg}</div>
        )}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   GATE
══════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════
   LOGIN GATE — phone number + the 6-digit code the shop sent
   Two kinds of account come through here: a real customer (straight into
   their catalog) and a phone the shop knows but hasn't made a customer yet
   (fills in their details, which go to the approvals queue).
══════════════════════════════════════════════════════════════════════ */
const SIGNUP_PHONE_KEY = "catalog_signup_phone"

type CodeRequest = { whatsapp: string; keyword: string }

/**
 * Who the visitor is — asked once, before any browsing.
 *
 * Nothing is queued for approval here. The shop decides about prices and
 * about putting someone on its books; it does not decide whether a person is
 * allowed to look at the catalog, so there is nothing to wait for.
 */
function VisitorDetailsGate({
  token, phone, onDone,
}: { token: string; phone: string; onDone: () => void }) {
  const textsQuery = useQuery({
    queryKey: ["catalog-design-public"],
    queryFn: () => api.get("/public/catalog/design").then(r => (r.data as { data?: { texts?: Record<string, string> } }).data ?? {}),
    staleTime: 5 * 60_000,
  })
  const texts = textsQuery.data?.texts
  const [name, setName] = useState("")
  const [address, setAddress] = useState("")
  const [province, setProvince] = useState("")
  const [notes, setNotes] = useState("")
  const [msg, setMsg] = useState("")

  const saveMut = useMutation({
    mutationFn: () => submitStorefrontSignupDetails({
      token,
      customerName: name.trim(),
      address: address.trim() || undefined,
      province: province || undefined,
      notes: notes.trim() || undefined,
    }),
    onSuccess: () => { setMsg(""); onDone() },
    onError: (e) => setMsg(e instanceof Error ? e.message : "تعذر حفظ بياناتك"),
  })

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50 px-4 py-8" dir="rtl">
      <div className="mb-6 flex flex-col items-center gap-2">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 shadow-lg shadow-emerald-200">
          <ShoppingBag className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-xl font-extrabold text-gray-900">{catalogText(texts, "detailsTitle")}</h1>
        <p className="text-sm text-gray-500">{catalogText(texts, "detailsSubtitle")}</p>
      </div>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl shadow-gray-100 ring-1 ring-gray-100">
        <p className="mb-3 text-center text-xs text-emerald-600">✓ تم الدخول برقم {phone}</p>
        <div className="space-y-3">
          <Field icon="👤" placeholder="الاسم الكامل" value={name} onChange={setName} />
          <ProvinceField value={province} onChange={setProvince} required />
          <Field icon="📍" placeholder="العنوان" value={address} onChange={setAddress} />
          <Field icon="📝" placeholder="نوع عملك أو ملاحظات (اختياري)" value={notes} onChange={setNotes} />
          <button
            disabled={name.trim().length < 2 || province === "" || saveMut.isPending}
            onClick={() => saveMut.mutate()}
            className="mt-1 w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white shadow-md transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saveMut.isPending ? "جاري الحفظ..." : catalogText(texts, "detailsButton")}
          </button>
        </div>
        {msg && (
          <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{msg}</div>
        )}
      </div>
    </div>
  )
}

function LoginGate({
  onAccess, onVisitor,
}: { onAccess: (token: string) => void; onVisitor: (token: string) => void }) {
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [msg, setMsg] = useState("")

  // The shop's WhatsApp number plus the exact word the inbound handler
  // matches. Resolved server-side so the button cannot drift out of sync with
  // the keyword the bot actually answers to.
  const codeRequestQuery = useQuery({
    queryKey: ["catalog-design-public"],
    queryFn: () => api.get("/public/catalog/design").then(r => (r.data as { data?: { codeRequest?: CodeRequest | null; texts?: Record<string, string> } }).data ?? {}),
    staleTime: 5 * 60_000,
  })
  const codeRequest = codeRequestQuery.data?.codeRequest ?? null
  const texts = codeRequestQuery.data?.texts

  const loginMut = useMutation({
    mutationFn: () => customerLogin(phone.trim(), code.trim()),
    onSuccess: (result) => {
      setMsg("")
      // A visitor now walks straight in — no approval to wait on. Whether
      // they ever become a shop customer is the merchant's decision, taken
      // later from the storefront accounts screen.
      if (result.kind === "CUSTOMER") { onAccess(result.token); return }
      localStorage.setItem(SIGNUP_PHONE_KEY, result.phone)
      onVisitor(result.token)
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : "تعذر تسجيل الدخول"),
  })

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50 px-4 py-8" dir="rtl">
      <div className="mb-6 flex flex-col items-center gap-2">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 shadow-lg shadow-emerald-200">
          <ShoppingBag className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-xl font-extrabold text-gray-900">{catalogText(texts, "storeTitle")}</h1>
        <p className="text-sm text-gray-500">{catalogText(texts, "loginSubtitle")}</p>
      </div>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl shadow-gray-100 ring-1 ring-gray-100">
        {children}
        {msg && (
          <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {msg}
          </div>
        )}
      </div>
    </div>
  )

  return shell(
    <div className="space-y-4">
      <div className="text-center">
        <p className="font-semibold text-gray-800">{catalogText(texts, "loginHeading")}</p>
        <p className="mt-1 text-xs text-gray-500">{catalogText(texts, "loginHint")}</p>
      </div>
      <Field icon="📱" placeholder="رقم الهاتف" value={phone} onChange={setPhone} type="tel" />
      <input
        type="text" inputMode="numeric" maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => { if (e.key === "Enter" && phone.trim() && code.length >= 4) loginMut.mutate() }}
        placeholder="••••••"
        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-center text-2xl font-bold tracking-[0.4em] outline-none focus:border-emerald-400 focus:bg-white"
        dir="ltr"
      />
      <button
        disabled={phone.trim().length < 9 || code.length < 4 || loginMut.isPending}
        onClick={() => loginMut.mutate()}
        className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white shadow-md shadow-emerald-100 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loginMut.isPending ? "جاري الدخول..." : catalogText(texts, "loginButton")}
      </button>
      {codeRequest ? (
        <>
          <div className="flex items-center gap-3 pt-1">
            <span className="h-px flex-1 bg-gray-100" />
            <span className="text-[11px] text-gray-400">{catalogText(texts, "noCodeLabel")}</span>
            <span className="h-px flex-1 bg-gray-100" />
          </div>
          <a
            href={`https://wa.me/${codeRequest.whatsapp}?text=${encodeURIComponent(codeRequest.keyword)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-emerald-500 py-3 text-sm font-bold text-emerald-700 transition active:scale-95"
          >
            <MessageCircle className="h-4 w-4" />
            {catalogText(texts, "requestCodeButton")}
          </a>
          <p className="text-center text-[11px] leading-relaxed text-gray-400">
            {catalogText(texts, "requestCodeHint")}
          </p>
        </>
      ) : (
        <p className="text-center text-xs text-gray-400">
          ما عندك رمز؟ تواصل مع المحل وراح يرسله لك على الواتساب.
        </p>
      )}
    </div>,
  )
}
function Field({ icon, placeholder, value, onChange, type = "text" }: { icon: string; placeholder: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 focus-within:border-emerald-400 focus-within:bg-white transition">
      <span className="text-base">{icon}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400" dir="rtl" />
    </div>
  )
}

/**
 * A shared province picker.
 *
 * Typed provinces never matched: «كربلاء» and «كربلاء المقدسة» are the same
 * place to a person and two different strings to the delivery rules, which
 * decide free shipping by exact name. A closed list is the only version of
 * this field that the rest of the system can actually read.
 */
function ProvinceField({ value, onChange, required }: {
  value: string; onChange: (v: string) => void; required?: boolean
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 focus-within:border-emerald-400 focus-within:bg-white transition">
      <span className="text-base">🏙️</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-transparent text-sm outline-none" dir="rtl"
        style={{ color: value ? undefined : "#9ca3af" }}>
        <option value="">{required ? "اختر المحافظة" : "المحافظة (اختياري)"}</option>
        {IRAQI_GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
      </select>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   GUEST DETAILS GATE (free browsing only — asked once per device)

   Free browsing means anyone may look without a code, so the shop learns
   nothing about who is looking unless it asks. A phone alone gave the
   merchant a list of bare numbers to follow up — this asks for the name and
   the province too, which is the difference between a lead and a digit
   string. Answered once and remembered on the device.
══════════════════════════════════════════════════════════════════════ */
const GUEST_PHONE_KEY = "catalog_guest_phone"
const GUEST_NAME_KEY = "catalog_guest_name"
const GUEST_PROVINCE_KEY = "catalog_guest_province"
/* ── Depth, in one place ──────────────────────────────────────────────
   The storefront grew its z-indexes one overlay at a time and they stopped
   agreeing: the cart sat at 50 and the gallery's opened picture at 190, so
   from inside a photo the cart, the unit picker and the details sheet all
   opened BEHIND it and read as dead buttons.

     30   the header
     120  a full page surface (the product page)
     130  the gallery's opened picture — also a page, not a dialog
     140  the cart
     150  sheets: units, appearance, account
     180  the access request
     200  the checkout details step
     210  full-screen zoom, above everything

   Anything new picks a tier here rather than a number that happens to work.
─────────────────────────────────────────────────────────────────────── */
const STUDIO_MODE_KEY = "catalog_view_mode"
const STUDIO_COLS_KEY = "catalog_studio_cols"
const STUDIO_SHAPE_KEY = "catalog_studio_shape"

function GuestPhoneGate({ children }: { children: React.ReactNode }) {
  const [entered, setEntered] = useState<boolean>(() => Boolean(localStorage.getItem(GUEST_PHONE_KEY)))
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [province, setProvince] = useState("")
  const [err, setErr] = useState("")
  // Set when the number they typed already has an account. Browsing on as a
  // guest works, but their own prices only come with their code — so they are
  // offered the login rather than left wondering why prices are hidden.
  const [hasAccount, setHasAccount] = useState(false)

  const textsQuery = useQuery({
    queryKey: ["catalog-design-public"],
    queryFn: () => api.get("/public/catalog/design").then(r => (r.data as { data?: { texts?: Record<string, string> } }).data ?? {}),
    staleTime: 5 * 60_000,
  })
  const texts = textsQuery.data?.texts

  const enterMut = useMutation({
    mutationFn: () => guestCatalogEnter(phone.trim(), { name: name.trim(), province }),
    onSuccess: (result) => {
      localStorage.setItem(GUEST_PHONE_KEY, phone.trim())
      // The name is kept too, so checkout does not ask for it a second time.
      if (name.trim()) localStorage.setItem(GUEST_NAME_KEY, name.trim())
      if (province) localStorage.setItem(GUEST_PROVINCE_KEY, province)
      setErr("")
      if (result?.hasAccount) { setHasAccount(true); return }
      setEntered(true)
    },
    onError: () => setErr("تعذر الحفظ. تأكد من الرقم وحاول مرة ثانية."),
  })

  if (entered) return <>{children}</>

  if (hasAccount) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50 px-4 py-8" dir="rtl">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-xl ring-1 ring-gray-100">
          <p className="text-lg font-extrabold text-gray-900">عندك حساب بالمحل</p>
          <p className="mt-2 text-sm text-gray-500">
            سجّل دخولك برمزك حتى تشوف أسعارك وحسابك وفواتيرك. أو كمّل تصفّح بدون حساب.
          </p>
          <button
            onClick={() => { localStorage.removeItem(GUEST_PHONE_KEY); window.location.href = "/catalog?login=1" }}
            className="mt-4 w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white shadow-md transition active:scale-95"
          >
            سجّل دخول
          </button>
          <button
            onClick={() => setEntered(true)}
            className="mt-2 w-full rounded-xl bg-gray-100 py-3 text-sm font-bold text-gray-600 transition active:scale-95"
          >
            كمّل بدون حساب
          </button>
        </div>
      </div>
    )
  }

  const digits = phone.replace(/\D/g, "")
  const valid = digits.length >= 10 && name.trim().length >= 2 && province !== ""

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50 px-4 py-8" dir="rtl">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 shadow-lg shadow-emerald-200">
          <ShoppingBag className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-xl font-extrabold text-gray-900">{catalogText(texts, "detailsTitle")}</h1>
        <p className="text-sm text-gray-500">{catalogText(texts, "detailsSubtitle")}</p>
      </div>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl shadow-gray-100 ring-1 ring-gray-100">
        <div className="space-y-3">
          <Field icon="👤" placeholder="الاسم الكامل" value={name} onChange={setName} />
          <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 focus-within:border-emerald-400 focus-within:bg-white transition">
            <span className="text-base">📱</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && valid && !enterMut.isPending) enterMut.mutate() }}
              inputMode="tel"
              placeholder="07XXXXXXXXX"
              className="flex-1 bg-transparent text-sm tracking-wide outline-none placeholder:text-gray-400"
              dir="ltr"
            />
          </div>
          <ProvinceField value={province} onChange={setProvince} required />
          <button
            disabled={!valid || enterMut.isPending}
            onClick={() => enterMut.mutate()}
            className="mt-1 w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white shadow-md transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enterMut.isPending ? "جاري الدخول..." : "ادخل وتصفح"}
          </button>
        </div>
        {err && <p className="mt-3 text-center text-xs text-red-600">{err}</p>}
        <p className="mt-3 text-center text-[11px] text-gray-400">
          بياناتك تبقى عند المحل حتى نتواصل وياك بطلبك — ما ننشرها ولا نرسلها لأحد.
        </p>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   GUEST PRICE-ACCESS REQUEST (no OTP — guest mode only)
══════════════════════════════════════════════════════════════════════ */
function GuestAccessRequestModal({ tk, onClose }: { tk: ThemeTokens; onClose: () => void }) {
  const [step, setStep] = useState<"form" | "sent">("form")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [address, setAddress] = useState("")
  const [notes, setNotes] = useState("")
  const [msg, setMsg] = useState("")

  const requestMut = useMutation({
    mutationFn: () => requestCatalogAccess({ customerName: name.trim(), phone: phone.trim(), address: address.trim() || undefined, notes: notes.trim() || undefined }),
    onSuccess: () => { setMsg(""); setStep("sent") },
    onError: () => setMsg("تعذر إرسال الطلب. حاول مرة ثانية."),
  })

  const checkMut = useMutation({
    mutationFn: () => getCatalogAccessStatus(phone.trim()),
    onSuccess: (s) => {
      if (s?.approved && s.token) {
        localStorage.setItem(storageKey, s.token)
        window.location.href = `/catalog?access=${s.token}`
      } else {
        setMsg("طلبك لم يُوافق عليه بعد، حاول لاحقاً.")
      }
    },
  })

  return (
    <>
      <div className="fixed inset-0 z-[180] bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-[190] max-h-[90vh] overflow-y-auto rounded-t-3xl p-5 shadow-2xl lg:inset-y-0 lg:right-0 lg:left-auto lg:w-[420px] lg:rounded-none"
        style={{ background: tk.cardBg }} dir="rtl">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-base font-extrabold" style={{ color: tk.text }}>طلب عرض الأسعار</p>
          <button onClick={onClose} className="rounded-xl p-2" style={{ background: tk.catIdle }}>
            <X className="h-5 w-5" style={{ color: tk.subtext }} />
          </button>
        </div>

        {step === "form" ? (
          <div className="space-y-3">
            <p className="text-xs" style={{ color: tk.subtext }}>
              أدخل بياناتك وسيقوم المتجر بمراجعة طلبك وتفعيل الأسعار لك — لا حاجة لرمز تحقق.
            </p>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="الاسم الكامل"
              className="w-full rounded-xl px-4 py-3 text-sm outline-none" style={{ background: tk.bg, color: tk.text, border: `1px solid ${tk.divider}` }} dir="rtl" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="رقم الهاتف" type="tel"
              className="w-full rounded-xl px-4 py-3 text-sm outline-none" style={{ background: tk.bg, color: tk.text, border: `1px solid ${tk.divider}` }} dir="ltr" />
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="العنوان (اختياري)"
              className="w-full rounded-xl px-4 py-3 text-sm outline-none" style={{ background: tk.bg, color: tk.text, border: `1px solid ${tk.divider}` }} dir="rtl" />
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات (اختياري)"
              className="w-full rounded-xl px-4 py-3 text-sm outline-none" style={{ background: tk.bg, color: tk.text, border: `1px solid ${tk.divider}` }} dir="rtl" />
            <button
              disabled={name.trim().length < 2 || phone.trim().length < 7 || requestMut.isPending}
              onClick={() => requestMut.mutate()}
              className="w-full rounded-xl py-3 text-sm font-bold text-white shadow-md transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: tk.accent }}
            >
              {requestMut.isPending ? "جاري الإرسال..." : "إرسال الطلب"}
            </button>
            <button onClick={() => checkMut.mutate()} disabled={phone.trim().length < 7 || checkMut.isPending}
              className="w-full text-center text-xs font-semibold underline disabled:opacity-40" style={{ color: tk.accent }}>
              لدي طلب سابق — فحص الموافقة
            </button>
          </div>
        ) : (
          <div className="space-y-3 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full" style={{ background: tk.accentLight }}>
              <CheckCircle2 className="h-7 w-7" style={{ color: tk.accent }} />
            </div>
            <p className="text-sm font-bold" style={{ color: tk.text }}>تم إرسال طلبك!</p>
            <p className="text-xs" style={{ color: tk.subtext }}>سيقوم المتجر بمراجعته، ثم اضغط الزر أدناه لتفعيل الأسعار.</p>
            <button onClick={() => checkMut.mutate()} disabled={checkMut.isPending}
              className="w-full rounded-xl py-3 text-sm font-bold text-white shadow-md transition active:scale-95 disabled:opacity-50"
              style={{ background: tk.accent }}>
              {checkMut.isPending ? "جاري الفحص..." : "فحص الموافقة"}
            </button>
          </div>
        )}

        {msg && (
          <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{msg}</div>
        )}
      </div>
    </>
  )
}

const TUTORIAL_SEEN_KEY = "catalog_tutorial_seen_v1"

/* ══════════════════════════════════════════════════════════════════════
   SHOP
══════════════════════════════════════════════════════════════════════ */
function CatalogShop({
  accessToken, allowPrices, showStock, stockFilter, customerId, customerName, customerPhone, visitorProvince,
  guestMode = false, deliveryLine = null, firstOrderCoupon = null,
  visitorToken = "", priceRequestPending = false, onPricesRequested,
}: {
  accessToken: string; allowPrices: boolean; showStock: boolean; stockFilter: CatalogStockFilter
  customerId: string; customerName: string; customerPhone: string
  guestMode?: boolean; deliveryLine?: string | null
  firstOrderCoupon?: { code: string; percent: number; expiresAt: string } | null
  /** Set for a signed-in visitor: same layout as guest browsing, own grid. */
  visitorToken?: string
  /** A signed-in visitor's governorate, so checkout does not ask again. */
  visitorProvince?: string
  priceRequestPending?: boolean
  onPricesRequested?: () => void
}) {
  // Three different doors lead into the storefront — a customer link, a visitor
  // code, and the guest phone gate. Whichever they came through, they are
  // signed in as somebody, and signing out has to clear all three or the next
  // visit silently walks back in as the previous person.
  const signedInName = customerName.trim()
  const signedInPhone = customerPhone.trim()
  // An account is a customer link or a visitor code. The guest gate is not one
  // — the phone was left at the door, not signed in with — but it is still
  // something to walk back out of, so it earns the sign-out and not the name.
  const hasAccount = Boolean(accessToken || visitorToken)
  const isSignedIn = hasAccount || Boolean(localStorage.getItem(GUEST_PHONE_KEY))
  function goToLogin() {
    localStorage.removeItem(storageKey)
    localStorage.removeItem(VISITOR_TOKEN_KEY)
    localStorage.removeItem(GUEST_PHONE_KEY)
    localStorage.removeItem(GUEST_NAME_KEY)
    localStorage.removeItem(GUEST_PROVINCE_KEY)
    localStorage.removeItem(SIGNUP_PHONE_KEY)
    window.location.href = "/catalog?login=1"
  }
  function signOut() {
    localStorage.removeItem(storageKey)
    localStorage.removeItem(VISITOR_TOKEN_KEY)
    localStorage.removeItem(GUEST_PHONE_KEY)
    localStorage.removeItem(GUEST_NAME_KEY)
    localStorage.removeItem(GUEST_PROVINCE_KEY)
    localStorage.removeItem(SIGNUP_PHONE_KEY)
    window.location.href = "/catalog"
  }

  // Per-customer display filter: FULL_CARTON_ONLY hides sub-carton products
  // (historical behavior); ALL_PRODUCTS shows everything the backend sent.
  // Ordering is still carton-only either way. Guests are always carton-only.
  const inStock = (p: PublicCatalogProduct) =>
    guestMode ? hasFullCarton(p) : stockFilter === "ALL_PRODUCTS" ? p.currentStock > 0 : hasFullCarton(p)
  // The rule itself lives in utils/catalogAccess, where it is tested — this
  // only supplies the four switches it reads.
  const canDisplay = (p: PublicCatalogProduct) =>
    shouldDisplay(p, { guestMode, stockFilter, hideNoImage, noImageMode })
  const productsQuery = useQuery({
    queryKey: visitorToken
      ? ["visitor-catalog-products", visitorToken]
      : guestMode ? ["guest-catalog-products"] : ["public-catalog-products", accessToken],
    queryFn: () => visitorToken
      ? getVisitorCatalogProducts(visitorToken)
      : guestMode ? getGuestCatalogProducts() : getPublicCatalogProducts(accessToken),
    refetchOnMount: "always",
    staleTime: 0,
  })

  useEffect(() => {
    document.title = "كتالوج المنتجات"
    return () => { document.title = "مخزوني" }
  }, [])

  // Browsing-time + product-view tracking only applies to the guest funnel
  // (catalog_visitors is how anonymous phone numbers get surfaced to admins
  // for conversion) — token-mode customers are already real customers, and
  // nothing in the admin UI reads this data for them, so skip it entirely.
  const priceMut = useMutation({
    mutationFn: () => requestCatalogPrices(visitorToken),
    onSuccess: () => onPricesRequested?.(),
  })

  // A signed-in visitor's own number, falling back to the anonymous guest
  // gate's. Without the first case their browsing counted for nothing: the
  // «الزوار» screen showed no time and no product views for exactly the people
  // the shop just invited.
  const visitorPhone = customerPhone || (guestMode ? (localStorage.getItem(GUEST_PHONE_KEY) || "") : "")

  // Browsing-time heartbeat: accumulate ~20s chunks while the tab is visible
  // and flush to the server, so admins can see how long a visitor stayed.
  useEffect(() => {
    if (!visitorPhone) return
    let seconds = 0
    // A regular fetch/axios call queued right as the tab closes is routinely
    // cancelled before it reaches the network — sendBeacon is designed to
    // survive that, so the trailing (sub-20s) chunk isn't silently dropped
    // every time a visitor just closes the tab instead of navigating away.
    const flushBeacon = (n: number) => {
      if (n <= 0) return
      try {
        navigator.sendBeacon(
          `${API_BASE_URL}/public/catalog/visitor-heartbeat`,
          new Blob([JSON.stringify({ phone: visitorPhone, seconds: n })], { type: "application/json" }),
        )
      } catch { /* best-effort */ }
    }
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      seconds += 5
      if (seconds >= 20) {
        const toSend = seconds
        seconds = 0
        void postVisitorHeartbeat(visitorPhone, toSend)
      }
    }, 5000)
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        flushBeacon(seconds)
        seconds = 0
      }
    }
    document.addEventListener("visibilitychange", onHide)
    window.addEventListener("pagehide", onHide)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", onHide)
      window.removeEventListener("pagehide", onHide)
      if (seconds > 0) void postVisitorHeartbeat(visitorPhone, seconds)
    }
  }, [visitorPhone])

  /* ── State ── */
  // Appearance is the shopper's call. Each preference stays null until they
  // actually pick one — while null the shop's own admin design wins, and the
  // moment they choose, their choice sticks (and beats the admin default).
  const [themePref, setThemePref] = useState<Theme | null>(() => {
    const v = localStorage.getItem(themeKey)
    return v && v in SURFACES ? (v as Theme) : null
  })
  const [accentPref, setAccentPref] = useState<AccentKey | null>(() => {
    const v = localStorage.getItem(accentKey)
    return v && ACCENTS.some(a => a.key === v) ? (v as AccentKey) : null
  })
  const [fontScale, setFontScale] = useState<FontScale>(() => {
    const v = localStorage.getItem(fontScaleKey)
    return v && v in FONT_SCALES ? (v as FontScale) : "md"
  })
  // «مواد بدون صور» is a place you go, not a switch you leave on. Mixing the
  // pictureless back into the grid put one with a photo next to one without,
  // which is exactly the mess this replaced — so they get their own view and
  // the shopper always knows which of the two they are looking at.
  const [noImageMode, setNoImageMode] = useState(false)
  // «وصلت هسه» — the newest goods, by when they were added to the shop. A
  // filter and not a page: it is a slice of the same grid, so the sort, the
  // category tabs and the search all keep meaning what they mean.
  const [justArrivedOnly, setJustArrivedOnly] = useState(false)
  // One-tap shortcut to a tag the shop picked — «القرطاسية» and the like.
  // Null means no shortcut is on; the category tabs and filters are untouched
  // by it, so it narrows whatever the shopper is already looking at.
  const [quickTag, setQuickTag] = useState<string | null>(null)
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  // A shared link (/catalog?product=<id>) opens straight onto that product —
  // but only once the shopper is past the gate, since this component only
  // mounts after it. The id stays in the URL so a refresh keeps the product.
  const [openProductId, setOpenProductId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("product"),
  )

  function openProduct(id: string) {
    setOpenProductId(id)
    const url = new URL(window.location.href)
    url.searchParams.set("product", id)
    window.history.pushState({}, "", url)
  }
  function closeProduct() {
    setOpenProductId(null)
    const url = new URL(window.location.href)
    url.searchParams.delete("product")
    window.history.replaceState({}, "", url)
  }

  // Back button should close the product page, not leave the catalog.
  useEffect(() => {
    function onPop() {
      setOpenProductId(new URLSearchParams(window.location.search).get("product"))
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])
  // Seeded from the shop's defaults on first paint only — this is where the
  // storefront starts, not a lock. Anything the shopper changes afterwards is
  // theirs, and a later settings change must not yank the grid out from under
  // someone mid-browse.
  const [sortKey, setSortKey] = useState<SortKey>("default")
  const [viewMode, setViewMode] = useState<ViewMode>("grid")
  // «متجر» or «معرض». The URL wins so a link can open straight into the
  // gallery; otherwise this device's own last choice; otherwise the shop's
  // default. Same three-step shape as the appearance preferences.
  const [studioPref, setStudioPref] = useState<"store" | "studio" | null>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("view")
    if (fromUrl === "studio" || fromUrl === "store") return fromUrl
    const saved = localStorage.getItem(STUDIO_MODE_KEY)
    return saved === "studio" || saved === "store" ? saved : null
  })
  const [studioIndex, setStudioIndex] = useState<number | null>(null)
  const [studioAlbum, setStudioAlbum] = useState("all")
  const [studioPerRowPref, setStudioPerRowPref] = useState<number | null>(() => {
    const v = Number(localStorage.getItem(STUDIO_COLS_KEY))
    return v >= 1 && v <= 5 ? v : null
  })
  const [studioShapePref, setStudioShapePref] = useState<"square" | "natural" | null>(() => {
    const v = localStorage.getItem(STUDIO_SHAPE_KEY)
    return v === "square" || v === "natural" ? v : null
  })
  const [perRow, setPerRow] = useState(2)
  const [seededDefaults, setSeededDefaults] = useState(false)
  const [search, setSearch] = useState("")
  const [activeSugg, setActiveSugg] = useState(0)
  const suggItemRefs = useRef<Record<number, HTMLButtonElement | null>>({})
  const [category, setCategory] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [page, setPage] = useState(0)
  const activeFilterCount = countActiveFilters(filters)
  const [cart, setCart] = useState<CartLine[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [notes, setNotes] = useState("")
  const [submitted, setSubmitted] = useState<string | null>(null)
  const [bannerIndex, setBannerIndex] = useState(0)
  const [pickerProduct, setPickerProduct] = useState<PublicCatalogProduct | null>(null)
  const [promoCode, setPromoCode] = useState("")
  const [promoResult, setPromoResult] = useState<{ code: string; type: string; value: number | null; description: string | null } | null>(null)
  const [promoError, setPromoError] = useState("")
  const [promoLoading, setPromoLoading] = useState(false)
  // Prefilled from whoever we already know this person to be: a signed-in
  // visitor carries their own name, and the guest gate stored the one they
  // typed at the door. Asking again for something we just collected reads as
  // the shop not having listened.
  const [guestName, setGuestName] = useState(
    () => customerName || (guestMode ? localStorage.getItem(GUEST_NAME_KEY) ?? "" : ""),
  )
  // Prefilled from the number the shopper already gave GuestPhoneGate — still
  // editable, but they shouldn't have to retype it from scratch (retyping
  // invites a typo/different number, which desyncs the order from the phone
  // all their browsing time/views were tracked under).
  const [guestPhone, setGuestPhone] = useState(
    () => customerPhone || (guestMode ? localStorage.getItem(GUEST_PHONE_KEY) ?? "" : ""),
  )
  const [guestAddress, setGuestAddress] = useState("")
  // The governorate decides the delivery promise, so it is asked for here as
  // well as at the door — a shop that leaves the door gate off would otherwise
  // never learn where the order is going.
  const [guestProvince, setGuestProvince] = useState(
    () => visitorProvince || (guestMode ? localStorage.getItem(GUEST_PROVINCE_KEY) ?? "" : ""),
  )
  const [accessRequestOpen, setAccessRequestOpen] = useState(false)
  const [showTutorial, setShowTutorial] = useState<boolean>(() => !localStorage.getItem(TUTORIAL_SEEN_KEY))

  const searchRef = useRef<HTMLInputElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const bannerTouchX = useRef<number | null>(null)

  const designQuery = useQuery({
    queryKey: ["catalog-design-public"],
    queryFn: () => api.get("/public/catalog/design").then(r => (r.data as { data?: { primaryColor?: string | null; bgColor?: string | null; defaultTheme?: Theme; logoUrl?: string | null; welcomeMessage?: string | null; bannerEnabled?: boolean; bannerImages?: Array<{ url: string; title: string; order: number }>; footer?: Partial<CatalogFooter>; trust?: Partial<CatalogTrust>; delivery?: { northGovernorates: string[]; freeShippingThreshold: number } } & Partial<CatalogLayout> }).data ?? {}),
    staleTime: 5 * 60_000,
  })
  const design = designQuery.data

  // Until the design loads nothing is hidden, so a slow network can never make
  // the grid look emptier than it really is.
  const hideNoImage = design?.hideNoImage === true

  // The admin's design is the *default* look, not a lock: it only applies to
  // preferences the shopper hasn't set for themselves.
  const theme: Theme = themePref ?? (design?.defaultTheme && design.defaultTheme in SURFACES ? design.defaultTheme : "clean")
  const isDark = SURFACES[theme].isDark
  const accentHex = accentPref
    ? (isDark ? ACCENTS.find(a => a.key === accentPref)!.darkHex : ACCENTS.find(a => a.key === accentPref)!.hex)
    : design?.primaryColor
      ? design.primaryColor
      : (isDark ? ACCENTS.find(a => a.key === DEFAULT_ACCENT)!.darkHex : ACCENTS.find(a => a.key === DEFAULT_ACCENT)!.hex)
  // A custom background from the admin only makes sense against the surface
  // they picked — once the shopper chooses their own mood, drop it.
  const bgOverride = themePref === null ? design?.bgColor ?? null : null
  const tk = useMemo(
    () => buildTokens(theme, accentHex, fontScale, bgOverride),
    [theme, accentHex, fontScale, bgOverride],
  )

  function applyTheme(t: Theme) {
    setThemePref(t)
    localStorage.setItem(themeKey, t)
  }
  function applyAccent(a: AccentKey) {
    setAccentPref(a)
    localStorage.setItem(accentKey, a)
  }
  function applyFontScale(f: FontScale) {
    setFontScale(f)
    localStorage.setItem(fontScaleKey, f)
  }
  function openNoImageMode() {
    setNoImageMode(true)
    setPage(0)
    window.scrollTo({ top: 0 })
  }
  function closeNoImageMode() {
    setNoImageMode(false)
    setPage(0)
    window.scrollTo({ top: 0 })
  }
  function resetAppearance() {
    setThemePref(null); localStorage.removeItem(themeKey)
    setAccentPref(null); localStorage.removeItem(accentKey)
    setFontScale("md"); localStorage.removeItem(fontScaleKey)
    setStudioPerRowPref(null); localStorage.removeItem(STUDIO_COLS_KEY)
    setStudioShapePref(null); localStorage.removeItem(STUDIO_SHAPE_KEY)
  }

  // Close the "more" menu on outside click
  useEffect(() => {
    if (!moreOpen) return
    function handler(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [moreOpen])

  // Banner auto-advance
  useEffect(() => {
    const t = window.setInterval(() => setBannerIndex((i) => i + 1), 3500)
    return () => window.clearInterval(t)
  }, [])

  // Categories
  const catsQuery = useQuery({
    queryKey: ["catalog-categories-public"],
    queryFn: () => api.get("/catalog-categories").then(r => (r.data as { data?: Array<{ name: string; types: string[] }> }).data ?? []).catch(() => []),
    staleTime: 10 * 60_000,
  })
  const catalogCatsList = useMemo(() => (catsQuery.data ?? []) as Array<{ name: string; types: string[] }>, [catsQuery.data])

  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data])

  // The shop's arrangement, already merged with the built-in order by the
  // backend — an unknown key here simply renders nothing.
  // Seed the grid from the shop's defaults exactly once, when the design
  // actually arrives. Derived-during-render rather than an effect, so the
  // first paint is already correct and nothing flashes.
  if (!seededDefaults && design) {
    setSeededDefaults(true)
    if (design.defaultView === "list") setViewMode("list")
    if (design.defaultPerRow && design.defaultPerRow !== perRow) setPerRow(design.defaultPerRow)
    if (design.defaultSort) setSortKey(design.defaultSort as SortKey)
  }

  const [imageProduct, setImageProduct] = useState<PublicCatalogProduct | null>(null)

  const layoutSections = design?.sections ?? []

  // «مختاراتنا» resolved against the products actually on the grid, so a
  // featured item that sold out or got hidden drops out quietly instead of
  // rendering a dead card.
  const featuredProducts = useMemo(() => {
    const ids = design?.featuredProductIds ?? []
    if (ids.length === 0) return []
    const byId = new Map(products.map((p) => [p.id, p]))
    return ids.map((id) => byId.get(id)).filter(Boolean) as PublicCatalogProduct[]
  }, [design?.featuredProductIds, products])

  const categories = useMemo(() => {
    const catSet = new Set<string>()
    products.forEach(p => {
      if (p.categoryTags && p.categoryTags.length > 0) p.categoryTags.forEach(t => catSet.add(t))
      else if (p.category) catSet.add(p.category)
    })
    const sorted = [...catSet].sort((a, b) => {
      const ai = catalogCatsList.findIndex(c => c.name === a)
      const bi = catalogCatsList.findIndex(c => c.name === b)
      if (ai !== -1 && bi !== -1) return ai - bi
      if (ai !== -1) return -1
      if (bi !== -1) return 1
      return a.localeCompare(b)
    })
    // The shop's own arrangement wins over the alphabetical fallback, and a
    // hidden category disappears from the storefront without touching a
    // single product's data.
    const hidden = new Set(design?.hiddenCategories ?? [])
    const order = design?.categoryOrder ?? []
    const shown = sorted.filter((c) => !hidden.has(c))
    if (order.length === 0) return shown
    return [...shown].sort((a, b) => {
      const ai = order.indexOf(a)
      const bi = order.indexOf(b)
      if (ai !== -1 && bi !== -1) return ai - bi
      if (ai !== -1) return -1
      if (bi !== -1) return 1
      return 0
    })
  }, [products, catalogCatsList, design?.hiddenCategories, design?.categoryOrder])

  const availableTypes = useMemo(() => {
    if (category === "all") return []
    const catDef = catalogCatsList.find(c => c.name === category)
    if (catDef?.types.length) return catDef.types
    const typeSet = new Set<string>()
    products.forEach(p => {
      const tags = p.categoryTags ?? []
      const inCat = tags.length > 0 ? tags.includes(category) : p.category === category
      if (inCat) (p.typeTags ?? []).forEach(t => typeSet.add(t))
    })
    return [...typeSet].sort()
  }, [category, catalogCatsList, products])

  // «آخر ١٠ أيام» counts back from when this product list was fetched, not from
  // a clock read mid-render. Reading the clock during render is impure — the
  // same render would answer differently each time — and the fetch timestamp is
  // the more honest anchor anyway: the window moves when the data does, not
  // under a shopper who is still looking at the page.
  const arrivalCutoff = useMemo(() => {
    const days = design?.newArrivalDays ?? 10
    if (!days || days <= 0 || !productsQuery.dataUpdatedAt) return null
    return productsQuery.dataUpdatedAt - days * 86_400_000
  }, [design?.newArrivalDays, productsQuery.dataUpdatedAt])
  // A tag matches whichever field the shop actually put it in — its category
  // tags, its type tags, or its plain category. A shop that tags one way and
  // types the chip the other way would otherwise get a button that finds
  // nothing, with no way to tell why.
  const hasTag = (p: PublicCatalogProduct, tag: string) => {
    const t = tag.trim()
    if (!t) return false
    return (p.categoryTags ?? []).some((x) => x.trim() === t)
      || (p.typeTags ?? []).some((x) => x.trim() === t)
      || (p.category ?? "").trim() === t
  }
  const isJustArrived = (p: PublicCatalogProduct) =>
    arrivalCutoff != null && p.createdAt != null && new Date(p.createdAt).getTime() >= arrivalCutoff
  const justArrivedCount = useMemo(() => {
    if (arrivalCutoff == null) return 0
    return products.filter((p) => isJustArrived(p) && canDisplay(p)).length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, arrivalCutoff, hideNoImage, noImageMode, guestMode, stockFilter])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const min = Number(filters.minPrice.replace(/[^\d.]/g, ""))
    const max = Number(filters.maxPrice.replace(/[^\d.]/g, ""))
    const hasMin = filters.minPrice.trim() !== "" && Number.isFinite(min)
    const hasMax = filters.maxPrice.trim() !== "" && Number.isFinite(max)

    let result = products.filter((p) => {
      if (!canDisplay(p)) return false
      if (justArrivedOnly && !isJustArrived(p)) return false
      if (quickTag && !hasTag(p, quickTag)) return false
      if (category !== "all") {
        const tags = p.categoryTags ?? []
        const inCat = tags.length > 0 ? tags.includes(category) : p.category === category
        if (!inCat) return false
      }
      if (typeFilter !== "all") {
        const tTags = (p.typeTags ?? []).map(t => t.trim())
        if (tTags.length > 0 && !tTags.includes(typeFilter.trim())) return false
      }
      if (filters.offersOnly && !p.isOffer) return false
      // "In stock" means orderable, i.e. at least one full carton — the same
      // rule the grid already uses to decide what can be added to the cart.
      if (filters.inStockOnly && !(p.pcsPerCarton >= 1 && p.currentStock >= p.pcsPerCarton)) return false
      // Price filters only mean something when prices are visible at all.
      if (allowPrices && (hasMin || hasMax)) {
        const price = Number(p.salePrice ?? 0)
        if (hasMin && price < min) return false
        if (hasMax && price > max) return false
      }
      if (!q) return true
      return [p.name, p.itemNumber, p.category ?? ""].some((s) => s.toLowerCase().includes(q))
    })

    if (sortKey === "cheap") result = [...result].sort((a, b) => Number(a.salePrice ?? 0) - Number(b.salePrice ?? 0))
    else if (sortKey === "expensive") result = [...result].sort((a, b) => Number(b.salePrice ?? 0) - Number(a.salePrice ?? 0))
    else if (sortKey === "new") result = [...result].sort((a, b) => (a.isNewArrival === b.isNewArrival ? 0 : a.isNewArrival ? -1 : 1))
    else if (sortKey === "best") result = [...result].sort((a, b) => (b.soldCount ?? 0) - (a.soldCount ?? 0))
    else if (sortKey === "rated") {
      // Unrated products sink below rated ones instead of tying at zero, and
      // ties on the same average go to whichever has more reviews behind it.
      result = [...result].sort((a, b) => {
        const ar = a.ratingAvg ?? -1, br = b.ratingAvg ?? -1
        return br === ar ? (b.ratingCount ?? 0) - (a.ratingCount ?? 0) : br - ar
      })
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, search, category, typeFilter, sortKey, stockFilter, filters, allowPrices, hideNoImage, noImageMode, justArrivedOnly, arrivalCutoff, quickTag])

  // ── Paging ──
  // `visible` above is the WHOLE catalog after search, filters and sorting —
  // paging only decides how much of that result is on screen. Filtering a
  // page instead of the catalog would make search useless past product 40.
  // How many products the picture rule is holding back right now. Shown to the
  // shopper so a shorter grid is never a mystery — and so the way back is one
  // tap, not a support call.
  // A chip that would answer with an empty grid is not shown at all — same
  // rule «وصلت هسه» follows, and it quietly absorbs a mistyped tag name.
  const quickTagCounts = useMemo(() => {
    const tags = design?.quickTags ?? []
    const out: Array<{ tag: string; count: number }> = []
    for (const tag of tags) {
      const count = products.filter((p) => hasTag(p, tag) && canDisplay(p)).length
      if (count > 0) out.push({ tag, count })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, design?.quickTags, hideNoImage, noImageMode, guestMode, stockFilter])

  const hiddenNoImageCount = useMemo(() => {
    if (!hideNoImage || noImageMode) return 0
    return products.filter((p) => !(p.hasImage ?? Boolean(p.thumbnailUrl)) && inStock(p)).length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, hideNoImage, noImageMode, guestMode, stockFilter])

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageItems = useMemo(
    () => visible.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [visible, safePage],
  )

  // Any change to what is being shown starts again from the first page —
  // otherwise a shopper on page 5 filters down to 12 results and sees nothing.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets paging when the result set changes
    setPage(0)
  }, [search, category, typeFilter, sortKey, filters])

  function goToPage(next: number) {
    setPage(Math.max(0, Math.min(next, pageCount - 1)))
    // Land at the top of the grid, not wherever the previous page was scrolled.
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  // ── Thumbnails ──
  // The grid arrives without pictures (see catalog.service: a few hundred
  // base64 thumbnails is megabytes on a phone). Fetch only what is about to be
  // drawn, and keep what we already fetched so paging back is instant.
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({})
  const withThumb = useCallback(
    (p: PublicCatalogProduct): PublicCatalogProduct =>
      thumbs[p.id] ? { ...p, thumbnailUrl: thumbs[p.id] } : p,
    [thumbs],
  )

  const suggestions = visible.slice(0, 6)

  // Ask for the page on screen, the search suggestions and the banner picks.
  // Anything already fetched is skipped, so paging back costs nothing.
  const bannerIds = useMemo(
    () => products.filter(p => (p.hasImage ?? Boolean(p.thumbnailUrl)) && canDisplay(p)).slice(0, 8).map(p => p.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, stockFilter],
  )
  const neededThumbIds = useMemo(() => {
    // «مختاراتنا» belongs here too. Its cards are drawn above the grid, so a
    // featured product that happens to sit on a later page was never in the
    // batch — the row rendered with placeholders no matter how many pictures
    // the shop had uploaded.
    const ids = [
      ...pageItems.map(p => p.id),
      ...featuredProducts.map(p => p.id),
      ...suggestions.map(p => p.id),
      ...bannerIds,
    ]
    return [...new Set(ids)].filter(id => !(id in thumbs))
  }, [pageItems, featuredProducts, suggestions, bannerIds, thumbs])

  // Ids already given their one retry, so a persistent failure settles instead
  // of cycling.
  const retriedRef = useRef<Set<string>>(new Set())
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (neededThumbIds.length === 0) return
    let cancelled = false
    const batch = neededThumbIds.slice(0, 120)
    getCatalogThumbnails(batch, guestMode ? "" : accessToken, visitorToken)
      .then((loaded) => {
        if (cancelled) return
        // Record every id we asked for, including ones that came back empty —
        // otherwise a product with no picture is re-requested on every render
        // for as long as it stays on screen.
        const merged: Record<string, string | null> = {}
        for (const id of batch) merged[id] = loaded[id] ?? null
        setThumbs(prev => ({ ...prev, ...merged }))
      })
      .catch(() => {
        if (cancelled) return
        // Mark as attempted so a failure cannot become a retry loop.
        const failed: Record<string, string | null> = {}
        for (const id of batch) failed[id] = null
        setThumbs(prev => ({ ...prev, ...failed }))

        // One retry, once. A dropped connection on a phone used to leave those
        // cards pictureless for the whole session — which is what «بعض الصور
        // ما تفتح» looked like. Forgetting the batch lets the effect ask again;
        // a second failure sticks, so this can never become a loop.
        retryTimer.current = setTimeout(() => {
          if (cancelled || retriedRef.current.size > 400) return
          setThumbs(prev => {
            const next = { ...prev }
            let retried = false
            for (const id of batch) {
              if (retriedRef.current.has(id)) continue
              retriedRef.current.add(id)
              delete next[id]
              retried = true
            }
            return retried ? next : prev
          })
        }, 4000)
      })
    return () => {
      cancelled = true
      if (retryTimer.current) clearTimeout(retryTimer.current)
    }
  }, [neededThumbIds, accessToken, guestMode, visitorToken])
  // The "عروض"/"وصل حديثاً" rows ignore the filters by design, so hide them
  // once any filter is on — otherwise they'd show products the shopper just
  // filtered out, right above the filtered grid.
  const showSections = !noImageMode && category === "all" && typeFilter === "all" && !search.trim() && activeFilterCount === 0
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const newArrivals = useMemo(() => products.filter(p => p.isNewArrival && canDisplay(p)).slice(0, 12), [products, stockFilter, hideNoImage, noImageMode])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const offers = useMemo(() => products.filter(p => p.isOffer && canDisplay(p)).slice(0, 12), [products, stockFilter, hideNoImage, noImageMode])
  // Same sentence the server builds for a signed-in customer, from the same
  // two settings — so the shop cannot promise a guest one thing and a
  // customer another. Declared here, after `design` exists: reading it from
  // above would be a closure over a value that has not been created yet.
  const guestDeliveryLine = guestMode ? deliveryLineFor(guestProvince, design?.delivery) : null

  /* ── «المعرض» ─────────────────────────────────────────────────────── */
  const studioCfg = design?.studio
  const studioOn = studioCfg?.enabled === true
  const isStudio = studioOn && (studioPref ?? studioCfg?.defaultView ?? "store") === "studio"
  function switchMode(next: "store" | "studio") {
    setStudioPref(next)
    localStorage.setItem(STUDIO_MODE_KEY, next)
    setStudioIndex(null)
    // Kept in the URL so the shopper can send the link they are looking at.
    const params = new URLSearchParams(window.location.search)
    params.set("view", next)
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`)
    window.scrollTo({ top: 0 })
  }

  // A gallery of blank squares is not a gallery, so a product with no picture
  // is not in it at all — it keeps its own page in the store.
  const studioPool = useMemo(
    () => products.filter((p) => canDisplay(p) && (p.hasImage ?? Boolean(p.thumbnailUrl))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, guestMode, stockFilter, hideNoImage, noImageMode],
  )

  const studioAlbums = useMemo<StudioAlbum[]>(() => {
    if (!studioOn) return []
    const out: StudioAlbum[] = [{ key: "all", label: "الكل", count: studioPool.length }]
    if (studioCfg?.offerAlbum) {
      const n = studioPool.filter((p) => p.isOffer).length
      if (n > 0) out.push({ key: "__offers", label: "العروض", count: n })
    }
    if (studioCfg?.newAlbum) {
      const n = studioPool.filter((p) => p.isNewArrival).length
      if (n > 0) out.push({ key: "__new", label: "وصل حديثاً", count: n })
    }
    for (const cat of categories) {
      const n = studioPool.filter((p) => {
        const tags = p.categoryTags ?? []
        return tags.length > 0 ? tags.includes(cat) : p.category === cat
      }).length
      if (n > 0) out.push({ key: cat, label: cat, count: n })
    }
    return out
  }, [studioOn, studioCfg?.offerAlbum, studioCfg?.newAlbum, studioPool, categories])

  const studioProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return studioPool.filter((p) => {
      if (studioAlbum === "__offers" && !p.isOffer) return false
      if (studioAlbum === "__new" && !p.isNewArrival) return false
      if (studioAlbum !== "all" && !studioAlbum.startsWith("__")) {
        const tags = p.categoryTags ?? []
        const inCat = tags.length > 0 ? tags.includes(studioAlbum) : p.category === studioAlbum
        if (!inCat) return false
      }
      if (!q) return true
      return [p.name, p.itemNumber, p.category ?? ""].some((x) => x.toLowerCase().includes(q))
    })
  }, [studioPool, studioAlbum, search])

  const studioProduct = studioIndex != null ? studioProducts[studioIndex] ?? null : null
  // The shopper's own gallery preferences, on top of the shop's defaults —
  // same three-state shape as the theme: null means "follow the shop".
  // The full-resolution picture for whatever is open, reusing the cache the
  // store's own viewer fills — reopening one costs nothing.
  //
  // Both values are DERIVED during render rather than pushed into state by the
  // effect: the effect only records what it fetched, after the await. Setting
  // state synchronously on open would re-render the viewer twice for every
  // swipe.
  const [studioFullById, setStudioFullById] = useState<Record<string, string>>({})
  const studioFull = studioProduct
    ? fullImageCache.get(studioProduct.id) ?? studioFullById[studioProduct.id] ?? null
    : null
  const studioFullLoading = studioProduct != null && studioFull == null

  useEffect(() => {
    if (!studioProduct || fullImageCache.has(studioProduct.id)) return
    const id = studioProduct.id
    let cancelled = false
    void (async () => {
      try {
        const full = visitorToken || guestMode
          ? await getGuestCatalogProductImage(id, visitorToken)
          : await getPublicCatalogProductImage(accessToken, id)
        if (!full) return
        fullImageCache.set(id, full)
        if (!cancelled) setStudioFullById((prev) => ({ ...prev, [id]: full }))
      } catch {
        // The medium stays on screen; a failed full-size fetch is not a
        // reason to show the shopper an empty frame.
      }
    })()
    return () => { cancelled = true }
  }, [studioProduct, accessToken, visitorToken, guestMode])

  // On a phone, back IS the close button. One guard for the page, closing
  // whatever is on TOP — listed innermost first, because a unit picker opened
  // from inside a photo has to close before the photo does.
  useBackGuard(
    pickerProduct != null ? () => setPickerProduct(null)
      : imageProduct != null ? () => setImageProduct(null)
        : studioIndex != null ? () => setStudioIndex(null)
          : appearanceOpen ? () => setAppearanceOpen(false)
            : accountOpen ? () => setAccountOpen(false)
              : cartOpen ? () => setCartOpen(false)
                : null,
  )

  const studioPerRow = studioPerRowPref ?? studioCfg?.perRow ?? 3
  const studioShape = studioShapePref ?? studioCfg?.shape ?? "square"
  const cartQty = cart.reduce((s, l) => s + l.quantity, 0)
  const subtotal = cart.reduce((s, l) => s + l.quantity * linePrice(l.product, l.unit), 0)
  const promoDiscount = useMemo(() => {
    if (!promoResult) return 0
    if (promoResult.type === "PERCENT") return Math.round(subtotal * (promoResult.value ?? 0) / 100)
    if (promoResult.type === "AMOUNT") return Math.min(promoResult.value ?? 0, subtotal)
    return 0
  }, [promoResult, subtotal])
  const finalTotal = Math.max(0, subtotal - promoDiscount)
  const hasFreeDelivery = promoResult?.type === "FREE_DELIVERY"

  async function applyPromo() {
    if (!promoCode.trim()) return
    setPromoError(""); setPromoLoading(true)
    try {
      const r = await validatePublicPromoCode(promoCode.trim().toUpperCase(), customerId)
      setPromoResult(r); setPromoError("")
    } catch (e) {
      setPromoError(e instanceof Error ? e.message : "كود الخصم غير صحيح")
      setPromoResult(null)
    } finally {
      setPromoLoading(false)
    }
  }

  const orderMut = useMutation({
    mutationFn: () =>
      guestMode
        ? submitGuestCatalogOrder({
            customerName: guestName.trim(), phone: guestPhone.trim(), address: guestAddress.trim() || undefined,
            province: guestProvince || undefined,
            notes: notes.trim() || undefined,
            // A signed-in visitor orders through the same endpoint; the token
            // is what tells the server they are not an anonymous guest.
            ...(visitorToken ? { visitorToken } : {}),
            items: cart.map(l => ({ productId: l.product.id, unit: l.unit, quantity: l.quantity, isSample: l.isSample })),
          })
        : submitPublicCatalogOrder(
            {
              customerName, phone: customerPhone, notes: notes.trim() || undefined,
              items: cart.map(l => ({ productId: l.product.id, unit: l.unit, quantity: l.quantity, isSample: l.isSample })),
              promoCode: promoResult?.code,
            },
            accessToken,
          ),
    onSuccess: (r) => { setSubmitted(r.data?.approvalId ?? "ok"); setCart([]); setNotes(""); setPromoResult(null); setPromoCode("") },
  })

  function add(product: PublicCatalogProduct, unit: CatalogUnit = defaultUnitFor()) {
    const max = maxQty(product, unit)
    if (max < 1) return
    setSubmitted(null)
    setCart((prev) => {
      const id = key(product.id, unit)
      const cur = prev.find(l => l.id === id)
      if (cur) return prev.map(l => l.id === id ? { ...l, quantity: Math.min(l.quantity + 1, max) } : l)
      return [...prev, { id, product, unit, quantity: 1 }]
    })
  }

  /**
   * Everything the picker chose, in one go.
   *
   * Adding unit by unit meant a shopper wanting three cartons made three round
   * trips through the sheet. The stock ceiling is re-checked here rather than
   * trusted from the sheet: the grid can refresh underneath an open sheet, and
   * the cart must never hold more than the warehouse has.
   */
  function addMany(product: PublicCatalogProduct, lines: Array<{ unit: CatalogUnit; quantity: number }>) {
    if (lines.length === 0) return
    setSubmitted(null)
    setCart((prev) => {
      let next = prev
      for (const { unit, quantity } of lines) {
        const max = maxQty(product, unit)
        if (max < 1 || quantity < 1) continue
        const id = key(product.id, unit)
        const cur = next.find((l) => l.id === id)
        next = cur
          ? next.map((l) => (l.id === id ? { ...l, quantity: Math.min(l.quantity + quantity, max) } : l))
          : [...next, { id, product, unit, quantity: Math.min(quantity, max) }]
      }
      return next
    })
  }

  /**
   * «طلب عيّنة» — one piece, on its own line.
   *
   * Deliberately capped at one and never merged with an existing line: a
   * sample is a question ("is this what I think it is?"), and letting it
   * accumulate would turn it into an order nobody meant to place.
   */
  function addSample(product: PublicCatalogProduct) {
    if (maxQty(product, "PIECE") < 1) return
    setSubmitted(null)
    setCart((prev) => {
      const id = key(product.id, "PIECE", true)
      if (prev.some((l) => l.id === id)) return prev
      return [...prev, { id, product, unit: "PIECE", quantity: 1, isSample: true }]
    })
    setCartOpen(true)
  }

  function changeQty(lineId: string, delta: number) {
    setCart((prev) =>
      prev.flatMap((l) => {
        if (l.id !== lineId) return [l]
        const q = l.quantity + delta
        if (q < 1) return []
        return [{ ...l, quantity: Math.min(q, maxQty(l.product, l.unit)) }]
      }),
    )
  }

  function changeUnit(lineId: string, unit: CatalogUnit) {
    setCart((prev) => {
      const target = prev.find(l => l.id === lineId)
      if (!target) return prev
      const max = maxQty(target.product, unit)
      if (max < 1) return prev.filter(l => l.id !== lineId)
      const newId = key(target.product.id, unit)
      const rest = prev.filter(l => l.id !== lineId)
      const existing = rest.find(l => l.id === newId)
      if (existing) return rest.map(l => l.id === newId ? { ...l, quantity: Math.min(l.quantity + target.quantity, max) } : l)
      return [...rest, { ...target, id: newId, unit, quantity: Math.min(target.quantity, max) }]
    })
  }

  // Keep the keyboard-highlighted suggestion scrolled into view (arrow keys past the visible area)
  useEffect(() => {
    suggItemRefs.current[activeSugg]?.scrollIntoView({ block: "nearest" })
  }, [activeSugg])

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!suggestions.length) return
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveSugg(v => Math.min(v + 1, suggestions.length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveSugg(v => Math.max(v - 1, 0)) }
    else if (e.key === "Enter") { e.preventDefault(); add(suggestions[activeSugg] ?? suggestions[0]); setSearch("") }
    else if (e.key === "Escape") { setSearch(""); setActiveSugg(0) }
  }

  function renderCard(rawProduct: PublicCatalogProduct) {
    const product = withThumb(rawProduct)
    const productLines = cart.filter(l => l.product.id === product.id)
    const qtyInCart = productLines.reduce((s, l) => s + l.quantity, 0)
    // Total pieces already in cart for this product (for stock-ceiling check)
    const pcsInCart = productLines.reduce((s, l) => s + l.quantity * pcs(product, l.unit), 0)
    // If exactly one unit type in cart → reuse it on "+" without reopening picker
    const cartUnit = productLines.length === 1 ? productLines[0].unit : null
    const firstLine = productLines[0] ?? null
    return (
      <ProductCard
        key={product.id}
        product={product}
        allowPrices={allowPrices}
        showStock={showStock}
        qtyInCart={qtyInCart}
        pcsInCart={pcsInCart}
        cartUnit={cartUnit}
        tk={tk}
        viewMode={viewMode}
        perRow={viewMode === "grid" ? perRow : 1}
        lowStockCartons={design?.trust?.lowStockCartons ?? 0}
        onAdd={(unit) => add(product, unit)}
        onRemoveOne={() => firstLine && changeQty(firstLine.id, -1)}
        onOpenPicker={() => setPickerProduct(product)}
        onOpen={() => { void trackCatalogProductView(product.id, visitorPhone); openProduct(product.id) }}
        onOpenImage={() => { void trackCatalogProductView(product.id, visitorPhone); setImageProduct(product) }}
      />
    )
  }

  /* ── The blocks the shop arranges for itself ────────────────────────
     Built here and drawn in the merchant's saved order, so moving a block is
     a setting rather than a deploy. The switch decides whether a block is
     offered at all; its own content still decides whether it appears. */
  const sectionNodes: Record<string, React.ReactNode> = {
    announcement: (
      <>
        {/* ── Shop announcement — one line the merchant writes for everyone ── */}
        {design?.announcement ? (
          <div className="px-4 py-2 text-center font-bold"
            style={{ background: tk.accent, color: "#fff", fontSize: tk.fs.sm }}>
            📣 {design.announcement}
          </div>
        ) : null}
      </>
    ),
    priceBar: (
      <>
        {/* ── Signed-in visitor: prices are the thing that needs approval, not
               the door. They browse everything; the price is what they ask for. ── */}
        {visitorToken && !allowPrices && (
          <button
            onClick={() => { if (!priceRequestPending) priceMut.mutate() }}
            disabled={priceRequestPending || priceMut.isPending}
            className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-right transition active:opacity-80 disabled:opacity-100"
            style={{ background: tk.accentLight }}
          >
            <span className="font-bold" style={{ color: tk.accent, fontSize: tk.fs.sm }}>
              {priceRequestPending
                ? catalogText(design?.texts, "pricesPendingBar")
                : catalogText(design?.texts, "pricesLockedBar")}
            </span>
            {!priceRequestPending && (
              <span className="shrink-0 rounded-full px-2.5 py-1 font-bold text-white"
                style={{ background: tk.accent, fontSize: tk.fs.xs }}>
                {priceMut.isPending ? "..." : catalogText(design?.texts, "requestPriceButton")}
              </span>
            )}
          </button>
        )}

        {/* ── Guest banner: prices hidden until admin grants access ── */}
        {!visitorToken && guestMode && !allowPrices && (
          <button
            onClick={() => setAccessRequestOpen(true)}
            className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-right transition active:opacity-80"
            style={{ background: tk.accentLight }}
          >
            <span className="font-bold" style={{ color: tk.accent, fontSize: tk.fs.sm }}>
              🔒 الأسعار غير ظاهرة لك بعد — اضغط لطلب تفعيلها
            </span>
            <span className="shrink-0 rounded-full px-2.5 py-1 font-bold text-white" style={{ background: tk.accent, fontSize: tk.fs.xs }}>
              طلب الأسعار
            </span>
          </button>
        )}
      </>
    ),
    badges: (
      <>
        {/* ── Trust badges — only the ones this shop actually turned on ── */}
        {(() => {
          const badges = (design?.trust?.badges ?? EMPTY_CATALOG_TRUST.badges)
            .filter((b) => b?.enabled && String(b.text ?? "").trim())
          if (badges.length === 0) return null
          return (
            <div className="flex gap-1.5 overflow-x-auto scrollbar-hide px-3 py-2" style={{ background: tk.accentSoft }}>
              {badges.map((b, i) => (
                <span key={i}
                  className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 font-bold"
                  style={{ background: tk.cardBg, color: tk.accent, fontSize: tk.fs.xs, boxShadow: tk.shadowSm }}>
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {String(b.text).trim()}
                </span>
              ))}
            </div>
          )
        })()}
      </>
    ),
    banner: (
      <>
        {/* ── Hero banner (slideshow) ── */}
        {(() => {
          const bannerEnabled = design?.bannerEnabled !== false
          if (!bannerEnabled) return null
          // Admin banner images take priority over product images
          const adminImgs = [...(design?.bannerImages ?? [])].sort((a, b) => a.order - b.order)
          const slides: Array<{ src: string; title: string; subtitle?: string }> =
            adminImgs.length >= 2
              ? adminImgs.map(img => ({ src: img.url, title: img.title || "" }))
              : products.filter(p => (p.hasImage ?? Boolean(p.thumbnailUrl)) && canDisplay(p)).slice(0, 8)
                  .map(withThumb)
                  .filter(p => p.thumbnailUrl || p.imageUrl)
                  .map(p => ({
                  src: (p.thumbnailUrl || p.imageUrl)!, title: p.name,
                  subtitle: allowPrices ? `${money(p.salePrice)} د.ع` : undefined,
                }))
          if (slides.length < 2) return null
          const total = slides.length
          const idx = ((bannerIndex % total) + total) % total
          const welcomeMsg = design?.welcomeMessage || (customerName ? `مرحباً ${customerName} 👋` : "مرحباً بك 👋")
          return (
            /* A fixed 190px box cropped every banner into a thin strip, which is
               what made the uploaded pictures look mangled. A 16:9 box matches
               the shape a phone photo actually has, and object-contain over a
               blurred copy of the same image fills the sides without cutting
               anything out of the picture the shop chose. */
            <div
              className="relative overflow-hidden select-none"
              style={{ aspectRatio: "16 / 9", maxHeight: "260px", background: tk.catIdle }}
              onTouchStart={(e) => { bannerTouchX.current = e.touches[0].clientX }}
              onTouchEnd={(e) => {
                if (bannerTouchX.current === null) return
                const delta = bannerTouchX.current - e.changedTouches[0].clientX
                bannerTouchX.current = null
                if (delta > 40) setBannerIndex(i => i + 1)
                else if (delta < -40) setBannerIndex(i => i - 1)
              }}
            >
              {slides.map((s, i) => (
                <div key={i} className="absolute inset-0 transition-opacity duration-700" style={{ opacity: i === idx ? 1 : 0 }}>
                  <img src={s.src} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl opacity-60" />
                  <img src={s.src} alt={s.title} className="relative h-full w-full object-contain" />
                  {(s.title || s.subtitle) && (
                    <>
                      <div className="absolute inset-x-0 bottom-0 h-1/2" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)" }} />
                      <div className="absolute bottom-7 right-4 left-4">
                        {s.title && <p className="font-extrabold text-white drop-shadow-md leading-snug" style={{ fontSize: tk.fs.md }}>{s.title}</p>}
                        {s.subtitle && <p className="mt-0.5 font-bold" style={{ color: "#6ee7b7", fontSize: tk.fs.sm }}>{s.subtitle}</p>}
                      </div>
                    </>
                  )}
                </div>
              ))}
              {/* welcome pill */}
              <div className="absolute right-3 top-3 rounded-full px-3 py-1 text-right" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }}>
                <p className="font-semibold text-white" style={{ fontSize: tk.fs.xs }}>{welcomeMsg}</p>
              </div>
              {/* swipe hint arrows */}
              <button type="button" onClick={() => setBannerIndex(i => i - 1)}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full opacity-60 active:opacity-100"
                style={{ background: "rgba(255,255,255,0.2)", backdropFilter: "blur(4px)" }}>
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-white stroke-2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </button>
              <button type="button" onClick={() => setBannerIndex(i => i + 1)}
                className="absolute left-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full opacity-60 active:opacity-100"
                style={{ background: "rgba(255,255,255,0.2)", backdropFilter: "blur(4px)" }}>
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-white stroke-2"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
              </button>
              {/* dots */}
              <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 gap-1.5">
                {slides.map((_, i) => (
                  <button key={i} type="button" onClick={() => setBannerIndex(i)}
                    className="rounded-full transition-all duration-300"
                    style={{ height: "5px", width: i === idx ? "18px" : "5px", background: i === idx ? "#fff" : "rgba(255,255,255,0.45)" }} />
                ))}
              </div>
            </div>
          )
        })()}
      </>
    ),
    incoming: <IncomingRow tk={tk} phone={visitorPhone || customerPhone} customerName={customerName} allowPrices={allowPrices} />,
    // Both rows deliberately ignore the filters — they are the shop's picks,
    // not a slice of the current search — so they stand down entirely the
    // moment the shopper narrows anything.
    offers: showSections && offers.length > 0 ? (
      <section className="px-3 pt-3">
        <h2 className="mb-2 flex items-center gap-1.5 font-extrabold" style={{ color: "#e11d48", fontSize: tk.fs.lg }}>
          🏷️ {catalogText(design?.texts, "offersTitle")}
        </h2>
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {offers.map(p => (
            <div key={p.id} style={{ width: "140px", flexShrink: 0 }}>{renderCard(p)}</div>
          ))}
        </div>
      </section>
    ) : null,
    newArrivals: showSections && newArrivals.length > 0 ? (
      <section className="px-3 pt-3">
        <h2 className="mb-2 flex items-center gap-1.5 font-extrabold" style={{ color: tk.accent, fontSize: tk.fs.lg }}>
          ✨ {catalogText(design?.texts, "newArrivalsTitle")}
        </h2>
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {newArrivals.map(p => (
            <div key={p.id} style={{ width: "140px", flexShrink: 0 }}>{renderCard(p)}</div>
          ))}
        </div>
      </section>
    ) : null,
    featured: featuredProducts.length > 0 ? (
      <div className="px-3 pt-3">
        <p className="mb-2 font-extrabold" style={{ color: tk.text, fontSize: tk.fs.md }}>
          {catalogText(design?.texts, "featuredTitle")}
        </p>
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
          {featuredProducts.map((fp) => (
            <button key={fp.id} onClick={() => setImageProduct(fp)}
              className="flex w-[128px] shrink-0 flex-col gap-1.5 rounded-2xl p-2 text-right transition active:scale-95"
              style={{ background: tk.cardBg, border: `1px solid ${tk.cardBorder}` }}>
              {(() => {
                // A real square picture, not the 36px MiniThumb used in lists —
                // inside a 128px card that read as an empty box even when the
                // product had a photo. Same skeleton/placeholder rule as the
                // grid so a pending thumbnail never flashes the "no picture"
                // icon.
                const fpThumb = withThumb(fp).thumbnailUrl || fp.imageUrl
                if (fpThumb) {
                  return (
                    <span className="block aspect-square w-full overflow-hidden rounded-xl" style={{ background: tk.catIdle }}>
                      <img src={fpThumb} alt={fp.name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                    </span>
                  )
                }
                return (
                  <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl"
                    style={{ background: fp.hasImage ? tk.skeletonBg : tk.catIdle }}>
                    {!fp.hasImage && <ImageIcon className="h-6 w-6" style={{ color: tk.subtext, opacity: 0.3 }} />}
                  </span>
                )
              })()}
              <span className="truncate font-semibold" style={{ color: tk.text, fontSize: tk.fs.xs }}>{fp.name}</span>
              {allowPrices && (
                <span className="font-extrabold" style={{ color: tk.accent, fontSize: tk.fs.xs }}>{money(fp.salePrice)} د.ع</span>
              )}
            </button>
          ))}
        </div>
      </div>
    ) : null,
  }

  /* ── Render ── */
  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: `radial-gradient(circle at top right, ${tk.accent}35 0%, ${tk.accent}55 28%, ${tk.bg} 65%)`, transition: "background 0.3s" }}>
      <div className="mx-auto flex min-h-screen max-w-[600px] flex-col shadow-2xl shadow-slate-950/15" style={{ background: tk.bg }}>

      {/* ── Sticky Header ── */}
      {/* No overflow-hidden here: it clipped the "more" dropdown, which is why
          its last item was invisible. Only the decorations are clipped now. */}
      <header className="sticky top-0 z-30" style={{ background: `linear-gradient(135deg, ${tk.accent} 0%, ${tk.accent}cc 100%)`, boxShadow: "0 4px 24px rgba(0,0,0,0.22)" }}>
        {/* Decorative circles */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-sm" />
          <div className="absolute -bottom-14 left-6 h-28 w-28 rounded-full bg-white/10 blur-md" />
        </div>

        {/* Row 1: logo + search + actions */}
        <div className="relative px-3 py-2.5">
          <div className="flex items-center gap-2">
            {/* Logo */}
            {design?.logoUrl ? (
              <img src={design.logoUrl} alt="شعار" className="h-9 w-9 shrink-0 rounded-xl object-contain border border-white/30 bg-white/20 p-0.5" onError={(e) => e.currentTarget.style.display = "none"} />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/20 ring-1 ring-white/30">
                <ShoppingBag className="h-5 w-5 text-white" />
              </div>
            )}

            {/* Search */}
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setActiveSugg(0) }}
                onKeyDown={handleKey}
                placeholder="ابحث عن منتج..."
                className="h-10 w-full border-0 pr-9 pl-3 text-white outline-none transition placeholder:text-white/60"
                style={{ background: "rgba(255,255,255,0.2)", borderRadius: tk.radiusSm, fontSize: tk.fs.md }}
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100">
                  <X className="h-4 w-4" style={{ color: tk.text }} />
                </button>
              )}
              {/* Autocomplete */}
              {search.trim() && suggestions.length > 0 && (
                <div className="absolute top-full right-0 z-50 mt-1.5 w-full overflow-hidden border"
                  style={{ background: tk.cardBg, borderColor: tk.divider, borderRadius: tk.radiusMd, boxShadow: tk.shadowLg }}>
                  {suggestions.map((p, i) => (
                    <button key={p.id} type="button"
                      ref={(el) => { suggItemRefs.current[i] = el }}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-right transition"
                      style={{ background: i === activeSugg ? tk.accentLight : "transparent" }}
                      onMouseEnter={() => setActiveSugg(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { add(p); setSearch("") }}
                    >
                      <MiniThumb product={withThumb(p)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold" style={{ color: tk.text, fontSize: tk.fs.md }}>{p.name}</span>
                        <span style={{ color: tk.subtext, fontSize: tk.fs.xs }}>{p.itemNumber}{showStock ? ` · ${money(Math.floor(p.currentStock / Math.max(1, p.pcsPerCarton)))} كارتون` : ""}</span>
                      </span>
                      {allowPrices && <span className="shrink-0 font-extrabold" style={{ color: tk.accent, fontSize: tk.fs.sm }}>{money(p.salePrice)} د.ع</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── متجر ⇄ معرض ── */}
            {studioOn && (
              <button
                onClick={() => switchMode(isStudio ? "store" : "studio")}
                className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl transition-colors duration-200 active:scale-95"
                style={{ background: isStudio ? "rgba(255,255,255,0.36)" : "rgba(255,255,255,0.2)" }}
                title={isStudio ? "ارجع للمتجر" : "شوفه كمعرض صور"}
                aria-label={isStudio ? "ارجع للمتجر" : "شوفه كمعرض صور"}
                aria-pressed={isStudio}
              >
                {isStudio
                  ? <Store className="h-5 w-5 text-white" />
                  : <LayoutGrid className="h-5 w-5 text-white" />}
              </button>
            )}

            {/* "More" menu — the secondary actions (appearance, help, refresh)
                live here so the header keeps only search + cart in reach. */}
            <div className="relative shrink-0" ref={moreRef}>
              <button
                onClick={() => setMoreOpen(v => !v)}
                className="flex h-10 w-10 items-center justify-center rounded-xl transition active:scale-95"
                style={{ background: moreOpen ? "rgba(255,255,255,0.36)" : "rgba(255,255,255,0.2)" }}
                title="المزيد"
                aria-label="المزيد"
              >
                <MoreHorizontal className="h-5 w-5 text-white" />
              </button>
              {moreOpen && (
                <div className="absolute top-full left-0 z-50 mt-2 overflow-hidden"
                  style={{
                    background: tk.cardBg, border: `1px solid ${tk.divider}`,
                    borderRadius: tk.radiusMd, boxShadow: tk.shadowLg, minWidth: "196px",
                  }}>
                  {[
                    { icon: <Palette className="h-4 w-4" style={{ color: tk.accent }} />, label: "تخصيص المظهر", onClick: () => { setMoreOpen(false); setAppearanceOpen(true) } },
                    { icon: <HelpCircle className="h-4 w-4" style={{ color: tk.accent }} />, label: "شلون أشتري؟", onClick: () => { setMoreOpen(false); setShowTutorial(true) } },
                    {
                      icon: <RefreshCw className={cn("h-4 w-4", productsQuery.isFetching && "animate-spin")} style={{ color: tk.accent }} />,
                      label: productsQuery.isFetching ? "جاري التحديث..." : "تحديث المنتجات",
                      onClick: () => { setMoreOpen(false); void productsQuery.refetch() },
                    },
                    ...(hiddenNoImageCount > 0 ? [{
                      icon: <ImageOff className="h-4 w-4" style={{ color: tk.accent }} />,
                      label: `مواد بدون صور (${money(hiddenNoImageCount)})`,
                      onClick: () => { setMoreOpen(false); openNoImageMode() },
                    }] : []),
                    // Invoices belong to a customer on the shop's books; a
                    // visitor has an account but nothing filed under it yet.
                    ...(guestMode ? [] : [{
                      icon: <UserRound className="h-4 w-4" style={{ color: tk.accent }} />,
                      label: "حسابي وفواتيري",
                      onClick: () => { setMoreOpen(false); setAccountOpen(true) },
                    }]),
                    ...(isSignedIn ? [{
                      icon: <LogOut className="h-4 w-4" style={{ color: tk.accent }} />,
                      label: "تسجيل الخروج",
                      onClick: signOut,
                    }] : []),
                  ].map((item, i) => (
                    <button key={i} onClick={item.onClick}
                      className="flex w-full items-center gap-2.5 px-3.5 py-3 text-right transition active:opacity-70"
                      style={{ borderTop: i === 0 ? "none" : `1px solid ${tk.divider}`, fontSize: tk.fs.sm, color: tk.text }}>
                      {item.icon}
                      <span className="font-bold">{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Cart */}
            <button onClick={() => setCartOpen(true)}
              className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition active:scale-95"
              style={{ background: "rgba(255,255,255,0.3)" }}
              aria-label="السلة">
              <ShoppingCart className="h-5 w-5 text-white" />
              {cartQty > 0 && (
                <span className="absolute -left-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 font-bold leading-none text-white"
                  style={{ fontSize: tk.fs.xs }}>
                  {cartQty}
                </span>
              )}
            </button>
          </div>

          {/* Whose account this is. A shopper who cannot see their own name has
              no way to tell a signed-in catalog from a public one. */}
          {hasAccount && (
            <div className="mt-2 flex items-center gap-1.5 px-0.5">
              <UserRound className="h-3.5 w-3.5 shrink-0 text-white/70" />
              <p className="min-w-0 truncate font-bold text-white/90" style={{ fontSize: tk.fs.xs }}>
                {signedInName ? `أهلاً ${signedInName}` : "داخل بحسابك"}
              </p>
              {signedInPhone && (
                <span className="shrink-0 text-white/60" style={{ fontSize: tk.fs.xs }} dir="ltr">{signedInPhone}</span>
              )}
            </div>
          )}
        </div>

        {/* Rows 2–4 belong to the store. The gallery brings its own albums
            and search, and nothing else — that spareness is the feature. */}
        {!isStudio && categories.length > 0 && (
          <div className="overflow-x-auto scrollbar-hide border-t border-white/20">
            <div className="flex gap-2 px-3 py-2">
              {["all", ...categories].map((cat) => (
                <button key={cat} onClick={() => { setCategory(cat); setTypeFilter("all") }}
                  className="shrink-0 rounded-full px-3.5 py-1.5 font-bold transition-all active:scale-95"
                  style={category === cat
                    ? { background: "#ffffff", color: tk.accent, fontSize: tk.fs.sm, boxShadow: "0 2px 8px rgba(0,0,0,0.14)" }
                    : { background: "rgba(255,255,255,0.2)", color: "#ffffff", fontSize: tk.fs.sm }
                  }>
                  {cat === "all" ? "الكل" : cat}
                </button>
              ))}
            </div>
          </div>
        )}

        {!isStudio && availableTypes.length > 0 && (
          <div className="overflow-x-auto scrollbar-hide border-t border-white/15">
            <div className="flex gap-1.5 px-3 py-1.5">
              {["all", ...availableTypes].map((t) => (
                <button key={t} onClick={() => setTypeFilter(t)}
                  className="shrink-0 rounded-full px-3 py-1 font-semibold transition-all"
                  style={typeFilter === t
                    ? { background: "rgba(255,255,255,0.92)", color: tk.accent, fontSize: tk.fs.xs }
                    : { background: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.9)", border: "1px solid rgba(255,255,255,0.28)", fontSize: tk.fs.xs }
                  }>
                  {t === "all" ? "كل الأنواع" : t}
                </button>
              ))}
            </div>
          </div>
        )}

        {!isStudio && (
        <div className="relative flex items-center gap-2 px-3 py-2 border-t border-white/15">
          {/* Filters — opens the sheet; badge shows how many are on */}
          <button onClick={() => setFiltersOpen(true)}
            className="relative flex shrink-0 items-center gap-1 rounded-full px-3 py-1 font-semibold transition active:scale-95"
            style={activeFilterCount > 0
              ? { background: "#ffffff", color: tk.accent, fontSize: tk.fs.xs }
              : { background: "rgba(255,255,255,0.2)", color: "#ffffff", fontSize: tk.fs.xs }}>
            <SlidersHorizontal className="h-3 w-3" />
            فلترة
            {activeFilterCount > 0 && (
              <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 font-extrabold text-white"
                style={{ background: tk.accent, fontSize: "9px" }}>{activeFilterCount}</span>
            )}
          </button>

          {/* «وصلت هسه» — hidden outright when nothing is new, so it is never a
              button that answers with an empty grid. */}
          {justArrivedCount > 0 && (
            <button onClick={() => { setJustArrivedOnly(v => !v); setPage(0) }}
              className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1 font-semibold transition active:scale-95"
              style={justArrivedOnly
                ? { background: "#ffffff", color: tk.accent, fontSize: tk.fs.xs }
                : { background: "rgba(255,255,255,0.2)", color: "#ffffff", fontSize: tk.fs.xs }}>
              <Sparkles className="h-3 w-3" />
              وصلت هسه
              <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 font-extrabold"
                style={justArrivedOnly
                  ? { background: tk.accent, color: "#fff", fontSize: "9px" }
                  : { background: "rgba(255,255,255,0.28)", color: "#fff", fontSize: "9px" }}>
                {justArrivedCount}
              </span>
            </button>
          )}

          {quickTagCounts.map(({ tag, count }) => {
            const on = quickTag === tag
            return (
              <button key={tag}
                onClick={() => { setQuickTag(on ? null : tag); setPage(0) }}
                className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1 font-semibold transition active:scale-95"
                style={on
                  ? { background: "#ffffff", color: tk.accent, fontSize: tk.fs.xs }
                  : { background: "rgba(255,255,255,0.2)", color: "#ffffff", fontSize: tk.fs.xs }}>
                {tag}
                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 font-extrabold"
                  style={on
                    ? { background: tk.accent, color: "#fff", fontSize: "9px" }
                    : { background: "rgba(255,255,255,0.28)", color: "#fff", fontSize: "9px" }}>
                  {count}
                </span>
              </button>
            )
          })}

          {/* Sort */}
          <div className="flex flex-1 gap-1 overflow-x-auto scrollbar-hide">
            {(Object.keys(SORT_LABELS) as SortKey[]).map(sk => (
              <button key={sk} onClick={() => setSortKey(sk)}
                className="shrink-0 rounded-full px-3 py-1 font-semibold transition-all"
                style={sortKey === sk
                  ? { background: "rgba(255,255,255,0.92)", color: tk.accent, fontSize: tk.fs.xs }
                  : { background: "rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.9)", fontSize: tk.fs.xs }
                }>
                {SORT_LABELS[sk]}
              </button>
            ))}
          </div>

          {/* View mode toggle */}
          <div className="flex shrink-0 rounded-xl overflow-hidden" style={{ border: "1.5px solid rgba(255,255,255,0.35)" }}>
            <button onClick={() => setViewMode("grid")} className="flex h-7 w-8 items-center justify-center transition"
              style={{ background: viewMode === "grid" ? "rgba(255,255,255,0.9)" : "transparent" }}>
              <Grid className="h-3.5 w-3.5" style={{ color: viewMode === "grid" ? tk.accent : "rgba(255,255,255,0.8)" }} />
            </button>
            <button onClick={() => setViewMode("list")} className="flex h-7 w-8 items-center justify-center transition"
              style={{ background: viewMode === "list" ? "rgba(255,255,255,0.9)" : "transparent", borderRight: "1px solid rgba(255,255,255,0.25)" }}>
              <LayoutList className="h-3.5 w-3.5" style={{ color: viewMode === "list" ? tk.accent : "rgba(255,255,255,0.8)" }} />
            </button>
          </div>

          {/* Per-row (only in grid mode) */}
          {viewMode === "grid" && (
            <div className="flex shrink-0 items-center gap-0.5 rounded-xl overflow-hidden" style={{ border: "1.5px solid rgba(255,255,255,0.35)" }}>
              {[2, 3, 4].map(n => (
                <button key={n} onClick={() => setPerRow(n)}
                  className="flex h-7 w-6 items-center justify-center font-bold transition"
                  style={{ background: perRow === n ? "rgba(255,255,255,0.92)" : "transparent", color: perRow === n ? tk.accent : "rgba(255,255,255,0.85)", fontSize: tk.fs.xs }}>
                  {n}
                </button>
              ))}
            </div>
          )}
        </div>
        )}
      </header>

      {/* ── «المعرض»: pictures, and the picture opened over them ── */}
      {isStudio && (
        <StudioGallery
          products={studioProducts}
          albums={studioAlbums}
          album={studioAlbum}
          onAlbum={(k) => { setStudioAlbum(k); window.scrollTo({ top: 0 }) }}
          search={search}
          onSearch={setSearch}
          perRow={studioPerRow}
          shape={studioShape}
          offerDot={studioCfg?.offerDot !== false}
          accessToken={accessToken}
          visitorToken={visitorToken ?? ""}
          tk={tk}
          onOpen={setStudioIndex}
        />
      )}

      {/* ── Arranged blocks, in the shop's own order ── */}
      {!isStudio && !noImageMode && layoutSections.map(({ key, enabled }) => (
        enabled ? <React.Fragment key={key}>{sectionNodes[key]}</React.Fragment> : null
      ))}

      {/* ── Main content ── */}
      {!isStudio && (
      <main className="-mt-3 flex-1 rounded-t-[28px] px-3 pb-6 pt-4 overflow-hidden" style={{ background: tk.bg }}>

        {quickTag && (
          <div className="mb-3 flex items-center gap-2 p-3" style={{ background: tk.accentLight, borderRadius: tk.radiusMd }}>
            <p className="min-w-0 flex-1 font-bold" style={{ color: tk.accent, fontSize: tk.fs.xs }}>
              تعرض بس «{quickTag}»
            </p>
            <button onClick={() => { setQuickTag(null); setPage(0) }}
              className="shrink-0 px-3 py-1.5 font-bold text-white transition active:scale-95"
              style={{ background: tk.accent, borderRadius: tk.radiusSm, fontSize: tk.fs.xs }}>
              اعرض الكل
            </button>
          </div>
        )}

        {justArrivedOnly && (
          <div className="mb-3 flex items-center gap-2 p-3" style={{ background: tk.accentLight, borderRadius: tk.radiusMd }}>
            <Sparkles className="h-4 w-4 shrink-0" style={{ color: tk.accent }} />
            <p className="min-w-0 flex-1 font-bold" style={{ color: tk.accent, fontSize: tk.fs.xs }}>
              تعرض بس البضاعة الي وصلت بآخر {design?.newArrivalDays ?? 10} يوم
            </p>
            <button onClick={() => { setJustArrivedOnly(false); setPage(0) }}
              className="shrink-0 px-3 py-1.5 font-bold text-white transition active:scale-95"
              style={{ background: tk.accent, borderRadius: tk.radiusSm, fontSize: tk.fs.xs }}>
              اعرض الكل
            </button>
          </div>
        )}

        {/* ── «مواد بدون صور» — its own page, never mixed into the grid ── */}
        {noImageMode && (
          <div className="mb-3 flex items-center gap-2 p-3" style={{ background: tk.catIdle, borderRadius: tk.radiusMd }}>
            <ImageOff className="h-4 w-4 shrink-0" style={{ color: tk.accent }} />
            <div className="min-w-0 flex-1">
              <p className="font-extrabold" style={{ color: tk.text, fontSize: tk.fs.sm }}>مواد بدون صور</p>
              <p className="truncate" style={{ color: tk.subtext, fontSize: tk.fs.xs }}>
                هذي كل البضاعة الي ما عدنا إلها صورة. تنطلب مثل الباقي.
              </p>
            </div>
            <button onClick={closeNoImageMode}
              className="shrink-0 px-3 py-2 font-bold text-white transition active:scale-95"
              style={{ background: tk.accent, borderRadius: tk.radiusSm, fontSize: tk.fs.xs }}>
              رجوع للمعروض
            </button>
          </div>
        )}

        {/* Loading skeleton */}
        {productsQuery.isLoading && viewMode === "grid" && (
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-2xl" style={{ background: tk.cardBg, border: `1px solid ${tk.cardBorder}` }}>
                <div className="aspect-square" style={{ background: tk.skeletonBg, opacity: 0.6 }} />
                <div className="p-3 space-y-2">
                  <div className="h-3 rounded-full" style={{ background: tk.skeletonBg, width: "70%" }} />
                  <div className="h-3 rounded-full" style={{ background: tk.skeletonBg, width: "45%" }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty */}
        {/* The shop can switch off open browsing while someone is mid-visit.
            The grid then answers 403 and used to render «لا توجد منتجات» — a
            shopper being told the shop is empty when it has simply closed its
            door to strangers. */}
        {productsQuery.isError && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="font-extrabold" style={{ color: tk.text, fontSize: tk.fs.lg }}>المتجر صار يحتاج تسجيل دخول</p>
            <p className="mt-1" style={{ color: tk.subtext, fontSize: tk.fs.md }}>
              سجّل دخولك برمزك حتى تكمل، أو تواصل وينا نرسلك رمز.
            </p>
            <button onClick={signOut}
              className="mt-3 px-5 py-2.5 font-bold text-white transition active:scale-95"
              style={{ background: tk.accent, borderRadius: tk.radiusMd, fontSize: tk.fs.sm }}>
              سجّل دخول
            </button>
          </div>
        )}

        {!productsQuery.isError && !productsQuery.isLoading && visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 rounded-full p-5" style={{ background: tk.catIdle }}>
              <Search className="h-8 w-8" style={{ color: tk.subtext }} />
            </div>
            <p className="font-extrabold" style={{ color: tk.text, fontSize: tk.fs.lg }}>{catalogText(design?.texts, "emptyResults")}</p>
            <p className="mt-1" style={{ color: tk.subtext, fontSize: tk.fs.md }}>
              {activeFilterCount > 0 ? "الفلاتر الحالية ما طلّعت أي منتج" : "جرب كلمة بحث مختلفة أو فئة أخرى"}
            </p>
            {activeFilterCount > 0 && (
              <button onClick={() => setFilters(EMPTY_FILTERS)}
                className="mt-3 px-5 py-2.5 font-bold text-white transition active:scale-95"
                style={{ background: tk.accent, borderRadius: tk.radiusMd, fontSize: tk.fs.sm }}>
                مسح الفلاتر
              </button>
            )}
          </div>
        )}

        {hiddenNoImageCount > 0 && (
          <button onClick={openNoImageMode}
            className="mt-2 flex w-full items-center justify-center gap-1.5 py-2.5 font-bold transition active:scale-95"
            style={{ background: tk.catIdle, color: tk.catIdleText, borderRadius: tk.radiusMd, fontSize: tk.fs.xs }}>
            <ImageOff className="h-3.5 w-3.5" />
            عدنا {money(hiddenNoImageCount)} مادة بدون صورة — افتح صفحتها
          </button>
        )}

        {/* Products: grid or list */}
        {!productsQuery.isLoading && visible.length > 0 && (
          viewMode === "list" ? (
            <div className="flex flex-col gap-2.5">
              {pageItems.map(p => renderCard(p))}
            </div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}>
              {pageItems.map(p => renderCard(p))}
            </div>
          )
        )}

        {/* ── Paging ── */}
        {!productsQuery.isLoading && pageCount > 1 && (
          <div className="mt-5 flex flex-col items-center gap-2">
            <div className="flex w-full items-center gap-2">
              <button
                onClick={() => goToPage(safePage - 1)}
                disabled={safePage === 0}
                className="flex flex-1 items-center justify-center gap-1 py-3 font-bold transition active:scale-95 disabled:opacity-35"
                style={{ background: tk.catIdle, color: tk.catIdleText, borderRadius: tk.radiusMd, fontSize: tk.fs.sm }}>
                <ChevronRight className="h-4 w-4" />
                السابق
              </button>

              <span className="shrink-0 px-3 py-3 font-extrabold"
                style={{ color: tk.text, fontSize: tk.fs.sm }}>
                {safePage + 1} / {pageCount}
              </span>

              <button
                onClick={() => goToPage(safePage + 1)}
                disabled={safePage >= pageCount - 1}
                className="flex flex-1 items-center justify-center gap-1 py-3 font-bold text-white transition active:scale-95 disabled:opacity-35"
                style={{ background: tk.accent, borderRadius: tk.radiusMd, fontSize: tk.fs.sm }}>
                التالي
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
            <p style={{ color: tk.subtext, fontSize: tk.fs.xs }}>
              عرض {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, visible.length)} من {money(visible.length)} منتج
            </p>
          </div>
        )}

        {hiddenNoImageCount > 0 && (
          <button onClick={openNoImageMode}
            className="mt-2 flex w-full items-center justify-center gap-1.5 py-2.5 font-bold transition active:scale-95"
            style={{ background: tk.catIdle, color: tk.catIdleText, borderRadius: tk.radiusMd, fontSize: tk.fs.xs }}>
            <ImageOff className="h-3.5 w-3.5" />
            عدنا {money(hiddenNoImageCount)} مادة بدون صورة — افتح صفحتها
          </button>
        )}
      </main>
      )}

      {/* ── Storefront footer (hidden until an admin fills it in) ── */}
      <CatalogFooterBlock
        footer={{ ...EMPTY_CATALOG_FOOTER, ...(design?.footer ?? {}) }}
        tk={tk}
        shopName={design?.welcomeMessage?.trim() || "متجرنا"}
      />

      {/* Clearance for the floating cart button — kept here rather than on
          <main> so it still applies when the footer renders nothing. */}
      <div className="shrink-0" style={{ height: "88px" }} />
      </div>{/* end card container */}

      {/* ── Floating cart button ── */}
      {cartQty > 0 && !cartOpen && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed bottom-5 left-1/2 z-40 -translate-x-1/2 flex items-center gap-3 px-5 py-3.5 text-white transition active:scale-95"
          style={{ background: tk.accent, borderRadius: tk.radiusLg, boxShadow: tk.shadowLg }}>
          <ShoppingCart className="h-5 w-5" />
          <span className="font-extrabold" style={{ fontSize: tk.fs.md }}>السلة — {cartQty} مادة</span>
          {allowPrices && <span className="rounded-full bg-white/20 px-2 py-0.5 font-bold" style={{ fontSize: tk.fs.sm }}>{money(finalTotal)} د.ع{promoResult && <span className="mr-1 opacity-80 line-through" style={{ fontSize: tk.fs.xs }}>{money(subtotal)}</span>}</span>}
          <ChevronLeft className="h-4 w-4 opacity-70" />
        </button>
      )}

      {/* ── Cart overlay ── */}
      {cartOpen && (
        <CartOverlay
          cart={cart} allowPrices={allowPrices} subtotal={subtotal}
          orderTiers={design?.orderTiers}
          notes={notes} onNotes={setNotes}
          onChangeQty={changeQty} onChangeUnit={changeUnit}
          onRemove={(id) => setCart(prev => prev.filter(l => l.id !== id))}
          onClose={() => setCartOpen(false)}
          onSubmit={() => orderMut.mutate()}
          isPending={orderMut.isPending} submitted={submitted} isError={orderMut.isError}
          tk={tk}
          promoCode={promoCode} onPromoCode={setPromoCode}
          promoResult={promoResult} promoError={promoError}
          promoLoading={promoLoading} onApplyPromo={applyPromo}
          promoDiscount={promoDiscount} finalTotal={finalTotal} hasFreeDelivery={hasFreeDelivery}
          onClearPromo={() => { setPromoResult(null); setPromoCode(""); setPromoError("") }}
          deliveryLine={deliveryLine ?? guestDeliveryLine}
          firstOrderCoupon={firstOrderCoupon}
          guestMode={guestMode}
          guestName={guestName} guestPhone={guestPhone} guestAddress={guestAddress}
          guestProvince={guestProvince} onGuestProvince={setGuestProvince}
          onSignIn={goToLogin}
          onGuestName={setGuestName} onGuestPhone={setGuestPhone} onGuestAddress={setGuestAddress}
        />
      )}

      {/* ── Guest price-access request modal ── */}
      {guestMode && accessRequestOpen && (
        <GuestAccessRequestModal tk={tk} onClose={() => setAccessRequestOpen(false)} />
      )}

      {/* ── Unit picker sheet ── */}
      {pickerProduct && (
        <UnitPickerSheet
          product={withThumb(pickerProduct)}
          allowPrices={allowPrices}
          showStock={showStock}
          tk={tk}
          onAdd={(lines) => { addMany(pickerProduct, lines); setPickerProduct(null) }}
          onClose={() => setPickerProduct(null)}
        />
      )}

      {/* ── My account ── */}
      {accountOpen && !guestMode && (
        <AccountSheet accessToken={accessToken} tk={tk} onClose={() => setAccountOpen(false)} />
      )}

      {/* ── Filters ── */}
      {filtersOpen && (
        <FilterSheet
          tk={tk}
          filters={filters}
          allowPrices={allowPrices}
          resultCount={visible.length}
          onChange={setFilters}
          onClear={() => setFilters(EMPTY_FILTERS)}
          onClose={() => setFiltersOpen(false)}
        />
      )}

      {/* ── Product page ── */}
      {openProductId && (
        <ProductDetailSheet
          visitorToken={visitorToken}
          reviewsEnabled={design?.reviewsEnabled !== false}
          suggestionsEnabled={design?.suggestionsEnabled !== false}
          productId={openProductId}
          accessToken={accessToken}
          guestMode={guestMode}
          tk={tk}
          allowPrices={allowPrices}
          lowStockCartons={design?.trust?.lowStockCartons ?? 0}
          onClose={closeProduct}
          onAdd={(p, unit) => { add(p, unit); closeProduct() }}
          onSample={(p) => { addSample(p); closeProduct() }}
          onOpenProduct={openProduct}
        />
      )}

      {/* ── Appearance: theme + accent colour + text size ── */}
      {appearanceOpen && (
        <AppearanceSheet
          tk={tk}
          theme={theme} accent={accentPref} fontScale={fontScale}
          studio={studioOn ? { perRow: studioPerRow, shape: studioShape } : null}
          onStudioPerRow={(n) => { setStudioPerRowPref(n); localStorage.setItem(STUDIO_COLS_KEY, String(n)) }}
          onStudioShape={(v) => { setStudioShapePref(v); localStorage.setItem(STUDIO_SHAPE_KEY, v) }}
          onTheme={applyTheme} onAccent={applyAccent} onFontScale={applyFontScale}
          onReset={resetAppearance}
          onClose={() => setAppearanceOpen(false)}
        />
      )}

      {/* ── The opened picture, and everything the tile withheld ── */}
      {isStudio && studioProduct && studioIndex != null && (
        <StudioViewer
          products={studioProducts}
          index={studioIndex}
          fullSrc={studioFull}
          fallbackSrc={withThumb(studioProduct).thumbnailUrl ?? null}
          loading={studioFullLoading}
          tk={tk}
          onIndex={setStudioIndex}
          onClose={() => setStudioIndex(null)}
        >
          <div className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-extrabold" style={{ color: tk.text, fontSize: tk.fs.lg }}>
                  {studioProduct.name}
                </p>
                <p style={{ color: tk.subtext, fontSize: tk.fs.xs }}>
                  {studioProduct.itemNumber}
                  {studioProduct.category ? ` · ${studioProduct.category}` : ""}
                </p>
              </div>
              {allowPrices && (
                <div className="shrink-0 text-left">
                  {studioProduct.oldPrice != null && studioProduct.oldPrice > (studioProduct.salePrice ?? 0) && (
                    <p className="line-through" style={{ color: tk.subtext, fontSize: tk.fs.xs }}>
                      {money(studioProduct.oldPrice)}
                    </p>
                  )}
                  <p className="font-extrabold" style={{ color: tk.accent, fontSize: tk.fs.xl }}>
                    {money(studioProduct.salePrice)}
                    <span className="font-normal" style={{ color: tk.subtext, fontSize: tk.fs.xs }}> د.ع/قطعة</span>
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {studioProduct.isOffer && (
                <span className="rounded-full px-2.5 py-1 font-bold text-white"
                  style={{ background: "#e11d48", fontSize: tk.fs.xs }}>عرض</span>
              )}
              {studioProduct.isNewArrival && (
                <span className="rounded-full px-2.5 py-1 font-bold"
                  style={{ background: tk.accentLight, color: tk.accent, fontSize: tk.fs.xs }}>جديد</span>
              )}
              {showStock && (
                <span className="rounded-full px-2.5 py-1 font-bold"
                  style={{ background: tk.catIdle, color: tk.catIdleText, fontSize: tk.fs.xs }}>
                  {money(Math.floor(studioProduct.currentStock / Math.max(1, studioProduct.pcsPerCarton)))} كارتون
                </span>
              )}
              {studioProduct.pcsPerCarton > 1 && (
                <span className="rounded-full px-2.5 py-1 font-bold"
                  style={{ background: tk.catIdle, color: tk.catIdleText, fontSize: tk.fs.xs }}>
                  الكارتون {money(studioProduct.pcsPerCarton)} قطعة
                </span>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setPickerProduct(studioProduct)}
                className="flex flex-1 cursor-pointer items-center justify-center gap-2 py-3.5 font-extrabold text-white transition-transform duration-200 active:scale-[0.98]"
                style={{ background: tk.accent, borderRadius: tk.radiusMd, fontSize: tk.fs.md }}>
                <Plus className="h-5 w-5" />
                أضف للسلة
              </button>
              <button
                onClick={() => { setStudioIndex(null); openProduct(studioProduct.id) }}
                className="shrink-0 cursor-pointer px-4 py-3.5 font-bold transition-colors duration-200"
                style={{ background: tk.catIdle, color: tk.catIdleText, borderRadius: tk.radiusMd, fontSize: tk.fs.sm }}>
                التفاصيل
              </button>
            </div>
          </div>
        </StudioViewer>
      )}

      {/* ── Full-resolution picture ── */}
      {imageProduct && (
        <ProductImageViewer
          product={imageProduct}
          thumb={withThumb(imageProduct).thumbnailUrl ?? null}
          accessToken={accessToken}
          guestMode={guestMode}
          visitorToken={visitorToken}
          tk={tk}
          onClose={() => setImageProduct(null)}
          onOpenProduct={() => openProduct(imageProduct.id)}
        />
      )}

      {/* ── First-visit onboarding tutorial ── */}
      {showTutorial && design?.tutorialEnabled !== false && (
        <CatalogOnboardingTutorial
          tk={tk}
          onClose={() => { localStorage.setItem(TUTORIAL_SEEN_KEY, "1"); setShowTutorial(false) }}
        />
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   ONBOARDING TUTORIAL — first-visit walkthrough (browse → cart → order → delivery)
══════════════════════════════════════════════════════════════════════ */
function CatalogOnboardingTutorial({ tk, onClose }: { tk: ThemeTokens; onClose: () => void }) {
  const steps = [
    { icon: Search, title: "دور على الماده", text: "استخدم البحث بالأعلى أو تصفح التصنيفات لين تلقى المواد الي تريدها." },
    { icon: ShoppingCart, title: "ضيفها للسلة", text: "اضغط على المادة، اختار الوحدة (كارتون أو حبة) والكمية، وتنضاف لسلتك تلقائياً." },
    { icon: CheckCircle2, title: "أرسل طلبك", text: "افتح السلة بالأسفل، راجع مشترياتك، وأدخل رقمك واضغط «إرسال الطلب للمراجعة»." },
    { icon: ShoppingBag, title: "طلبك بالطريق", text: "بعد ما نراجع الطلب راح نتواصل معك على رقمك ونجهزلك المواد ونوصلك إياها." },
  ] as const
  const [step, setStep] = useState(0)
  const isLast = step === steps.length - 1
  const S = steps[step]

  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center bg-black/60 sm:items-center sm:p-4" dir="rtl">
      <div className="w-full max-w-sm rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-400">{step + 1} / {steps.length}</span>
          <button onClick={onClose} className="text-slate-400 transition hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: tk.accentLight }}>
          <S.icon className="h-8 w-8" style={{ color: tk.accent }} />
        </div>
        <h3 className="mb-1.5 text-center text-lg font-extrabold text-slate-900">{S.title}</h3>
        <p className="mb-5 text-center text-sm leading-relaxed text-slate-500">{S.text}</p>

        <div className="mb-4 flex justify-center gap-1.5">
          {steps.map((_, i) => (
            <span key={i} className="h-1.5 rounded-full transition-all"
              style={{ width: i === step ? "20px" : "6px", background: i === step ? tk.accent : "#e2e8f0" }} />
          ))}
        </div>

        <div className="flex gap-2">
          {step > 0 && (
            <button onClick={() => setStep((s) => s - 1)}
              className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-600">
              السابق
            </button>
          )}
          <button
            onClick={() => (isLast ? onClose() : setStep((s) => s + 1))}
            className="flex-[2] rounded-xl py-2.5 text-sm font-bold text-white"
            style={{ background: tk.accent }}
          >
            {isLast ? "يلا نبدأ 🛍️" : "التالي"}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   URGENCY — offer countdown + shop-set scarcity threshold
══════════════════════════════════════════════════════════════════════ */
/** Remaining time as {d,h,m,s}, or null once the deadline has passed. */
function remainingParts(endsAt: string | null | undefined) {
  if (!endsAt) return null
  const ms = new Date(endsAt).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return null
  const s = Math.floor(ms / 1000)
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 }
}

function OfferCountdown({ endsAt, tk, size }: { endsAt: string; tk: ThemeTokens; size: "sm" | "lg" }) {
  const [, tick] = useState(0)
  // Re-render once a second so the countdown actually counts.
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [])
  const left = remainingParts(endsAt)
  if (!left) return null
  const pad = (n: number) => String(n).padStart(2, "0")
  const label = left.d > 0
    ? `${left.d} يوم ${pad(left.h)}:${pad(left.m)}:${pad(left.s)}`
    : `${pad(left.h)}:${pad(left.m)}:${pad(left.s)}`
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 font-extrabold text-white"
      style={{ background: "#e11d48", fontSize: size === "lg" ? tk.fs.sm : tk.fs.xs }}>
      <Clock className="h-3.5 w-3.5" />
      <span dir="ltr">{label}</span>
    </span>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   FILTER SHEET — price range, in-stock only, offers only
══════════════════════════════════════════════════════════════════════ */
type FilterToggleProps = {
  tk: ThemeTokens
  label: string
  hint: string
  on: boolean
  onToggle: () => void
}

/** Defined at module level, not inside FilterSheet: a component created during
 *  render is a brand-new type every pass, so React unmounts and remounts it —
 *  losing focus and animation state on each keystroke in the sheet. */
function FilterToggle({ tk, label, hint, on, onToggle }: FilterToggleProps) {
  return (
    <button onClick={onToggle}
      className="flex w-full items-center justify-between gap-3 p-3.5 text-right transition active:scale-[0.99]"
      style={{
        background: on ? tk.accentSoft : tk.bg,
        border: `2px solid ${on ? tk.accent : tk.divider}`,
        borderRadius: tk.radiusMd,
      }}>
      <span className="min-w-0">
        <span className="block font-extrabold" style={{ color: tk.text, fontSize: tk.fs.sm }}>{label}</span>
        <span className="block" style={{ color: tk.subtext, fontSize: tk.fs.xs }}>{hint}</span>
      </span>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
        style={{ background: on ? tk.accent : "transparent", border: `2px solid ${on ? tk.accent : tk.divider}` }}>
        {on && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
      </span>
    </button>
  )
}

function FilterSheet({
  tk, filters, allowPrices, resultCount, onChange, onClear, onClose,
}: {
  tk: ThemeTokens
  filters: Filters
  allowPrices: boolean
  resultCount: number
  onChange: (next: Filters) => void
  onClear: () => void
  onClose: () => void
}) {

  return (
    <>
      <div className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-[160] mx-auto max-w-[600px] max-h-[85vh] overflow-y-auto"
        style={{ background: tk.cardBg, borderTopLeftRadius: tk.radiusXl, borderTopRightRadius: tk.radiusXl, boxShadow: tk.shadowLg }}
        dir="rtl">
        <div className="sticky top-0 z-10 flex justify-center pt-3 pb-1" style={{ background: tk.cardBg }}>
          <div className="h-1 w-10 rounded-full" style={{ background: tk.divider }} />
        </div>

        <div className="flex items-center justify-between px-4 pb-3 pt-1" style={{ borderBottom: `1px solid ${tk.divider}` }}>
          <h2 className="flex items-center gap-2 font-extrabold" style={{ color: tk.text, fontSize: tk.fs.lg }}>
            <SlidersHorizontal className="h-5 w-5" style={{ color: tk.accent }} />
            فلترة المنتجات
          </h2>
          <button onClick={onClose} className="p-2" style={{ background: tk.catIdle, borderRadius: tk.radiusSm }} aria-label="إغلاق">
            <X className="h-5 w-5" style={{ color: tk.subtext }} />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4 pb-8">
          {/* Price range — pointless when prices are hidden from this shopper */}
          {allowPrices && (
            <section>
              <p className="mb-2 font-extrabold" style={{ color: tk.text, fontSize: tk.fs.md }}>نطاق السعر (د.ع للقطعة)</p>
              <div className="flex items-center gap-2">
                <input
                  value={filters.minPrice}
                  onChange={(e) => onChange({ ...filters, minPrice: e.target.value.replace(/[^\d]/g, "") })}
                  inputMode="numeric" placeholder="من" dir="ltr"
                  className="w-full px-3 py-3 text-center outline-none"
                  style={{ background: tk.bg, color: tk.text, border: `1px solid ${tk.divider}`, borderRadius: tk.radiusSm, fontSize: tk.fs.md }}
                />
                <span className="shrink-0" style={{ color: tk.subtext, fontSize: tk.fs.sm }}>—</span>
                <input
                  value={filters.maxPrice}
                  onChange={(e) => onChange({ ...filters, maxPrice: e.target.value.replace(/[^\d]/g, "") })}
                  inputMode="numeric" placeholder="إلى" dir="ltr"
                  className="w-full px-3 py-3 text-center outline-none"
                  style={{ background: tk.bg, color: tk.text, border: `1px solid ${tk.divider}`, borderRadius: tk.radiusSm, fontSize: tk.fs.md }}
                />
              </div>
            </section>
          )}

          <FilterToggle
            tk={tk}
            label="المتوفر فقط"
            hint="اخفِ المنتجات اللي ما عندها كارتون كامل"
            on={filters.inStockOnly}
            onToggle={() => onChange({ ...filters, inStockOnly: !filters.inStockOnly })}
          />
          <FilterToggle
            tk={tk}
            label="العروض فقط"
            hint="اعرض المنتجات اللي عليها عرض"
            on={filters.offersOnly}
            onToggle={() => onChange({ ...filters, offersOnly: !filters.offersOnly })}
          />

          <div className="flex gap-2 pt-1">
            <button onClick={onClear}
              className="flex-1 py-3.5 font-bold transition active:scale-95"
              style={{ background: tk.catIdle, color: tk.catIdleText, borderRadius: tk.radiusMd, fontSize: tk.fs.sm }}>
              مسح الفلاتر
            </button>
            <button onClick={onClose}
              className="flex-[2] py-3.5 font-extrabold text-white transition active:scale-95"
              style={{ background: tk.accent, borderRadius: tk.radiusMd, boxShadow: tk.shadowMd, fontSize: tk.fs.md }}>
              عرض {resultCount} منتج
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   PRODUCT PAGE — gallery, description, specs, reviews, related
══════════════════════════════════════════════════════════════════════ */
function Stars({ value, size, onPick }: { value: number; size: string; onPick?: (n: number) => void }) {
  return (
    <span className="inline-flex items-center gap-0.5" dir="ltr">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onPick}
          onClick={() => onPick?.(n)}
          className={cn("leading-none transition", onPick && "active:scale-90 cursor-pointer")}
          style={{ fontSize: size, opacity: n <= value ? 1 : 0.28 }}
          aria-label={`${n}`}
        >
          ⭐
        </button>
      ))}
    </span>
  )
}

function ProductDetailSheet({
  productId, accessToken, guestMode, tk, allowPrices, lowStockCartons, onClose, onAdd, onSample, onOpenProduct,
  reviewsEnabled = true, suggestionsEnabled = true, visitorToken = "",
}: {
  productId: string
  accessToken: string
  guestMode: boolean
  /** A signed-in visitor's session — without it the page falls to the guest
   *  branch, which is refused whenever the shop requires a login. */
  visitorToken?: string
  tk: ThemeTokens
  allowPrices: boolean
  lowStockCartons: number
  /** Shop-wide switches — a shop that does not want reviews gets no reviews. */
  reviewsEnabled?: boolean
  suggestionsEnabled?: boolean
  onClose: () => void
  onAdd: (product: PublicCatalogProduct, unit: CatalogUnit) => void
  /** «طلب عيّنة» — undefined hides the button entirely. */
  onSample?: (product: PublicCatalogProduct) => void
  onOpenProduct: (id: string) => void
}) {
  const access = guestMode ? "" : accessToken
  // Keyed by product rather than reset in an effect: opening a related product
  // re-renders with the gallery already back at the first slide, instead of
  // painting the previous product's slide and then correcting it.
  const [heroState, setHeroState] = useState({ id: productId, idx: 0 })
  const heroIdx = heroState.id === productId ? heroState.idx : 0
  const setHeroIdx = (idx: number) => setHeroState({ id: productId, idx })
  const [zoom, setZoom] = useState<string | null>(null)
  // The form is seeded from the review they already sent so revising means
  // editing, not retyping. `seededFrom` records which review it was filled
  // from, so a later load re-seeds while their in-progress typing survives.
  const [draft, setDraft] = useState<{ seededFrom: string | null; rating: number; comment: string }>({
    seededFrom: null, rating: 0, comment: "",
  })
  const setRating = (rating: number) => setDraft((d) => ({ ...d, rating }))
  const setComment = (comment: string) => setDraft((d) => ({ ...d, comment }))
  const [copied, setCopied] = useState(false)
  const qc = useQueryClient()

  const detailQuery = useQuery({
    queryKey: ["catalog-product", productId, access, visitorToken],
    queryFn: () => getCatalogProductDetail(productId, access, visitorToken),
    staleTime: 30_000,
  })
  const myReviewQuery = useQuery({
    queryKey: ["catalog-my-review", productId, access],
    queryFn: () => getMyCatalogReview(productId, access),
    enabled: Boolean(access),
  })
  const product = detailQuery.data

  const myReview = myReviewQuery.data
  const seedId = myReview?.id ?? null
  if (draft.seededFrom !== seedId) {
    // Adjusting state during render (the documented React escape hatch for
    // derived state) — no second render pass and nothing to clobber typing.
    setDraft({ seededFrom: seedId, rating: myReview?.rating ?? 0, comment: myReview?.comment ?? "" })
  }
  const rating = draft.rating
  const comment = draft.comment

  const reviewMut = useMutation({
    mutationFn: () => submitCatalogProductReview(productId, access, { rating, comment: comment.trim() || undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["catalog-my-review", productId, access] })
      void qc.invalidateQueries({ queryKey: ["catalog-product", productId, access] })
    },
  })

  // Slides: the product's own thumbnail first, then the gallery.
  const slides: Array<{ key: string; thumb: string | null; imageId?: string }> = product
    ? [
        { key: "main", thumb: product.thumbnailUrl },
        ...product.gallery.map((g) => ({ key: g.id, thumb: g.thumbnailUrl, imageId: g.id })),
      ].filter((s) => s.thumb)
    : []
  const hero = slides[Math.min(heroIdx, Math.max(0, slides.length - 1))]

  async function openZoom() {
    if (!hero?.thumb) return
    setZoom(hero.thumb)
    try {
      const full = hero.imageId
        ? await getCatalogGalleryImage(productId, hero.imageId, access, visitorToken)
        : guestMode
          ? await getGuestCatalogProductImage(productId, visitorToken)
          : await getPublicCatalogProductImage(accessToken, productId)
      if (full) setZoom(full)
    } catch { /* thumbnail already shown */ }
  }

  async function share() {
    // Deep link back into the catalog — the phone gate still applies, so a
    // forwarded link never leaks the shop to someone who hasn't identified.
    const url = `${window.location.origin}/catalog?product=${productId}`
    const text = product ? `${product.name}\n${url}` : url
    try {
      if (navigator.share) { await navigator.share({ title: product?.name, url }); return }
      await navigator.clipboard.writeText(text)
      setCopied(true); window.setTimeout(() => setCopied(false), 2000)
    } catch { /* user dismissed the share sheet */ }
  }

  const outOfStock = (product?.currentStock ?? 0) <= 0
  const cartons = product ? Math.floor(product.currentStock / Math.max(1, product.pcsPerCarton)) : 0
  const lowStock = !outOfStock && lowStockCartons > 0 && cartons <= lowStockCartons

  return (
    <div className="fixed inset-0 z-[120] mx-auto max-w-[600px] overflow-y-auto" style={{ background: tk.bg }} dir="rtl">
      {/* Sticky bar */}
      <div className="sticky top-0 z-20 flex items-center justify-between gap-2 px-3 py-2"
        style={{ background: tk.accent, boxShadow: tk.shadowMd }}>
        <button onClick={onClose} className="flex items-center gap-1 rounded-lg px-2 py-1.5 font-bold text-white transition active:scale-95"
          style={{ background: "rgba(255,255,255,0.2)", fontSize: tk.fs.xs }}>
          <ChevronRight className="h-3.5 w-3.5" />
          رجوع
        </button>
        <button onClick={share} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-bold text-white transition active:scale-95"
          style={{ background: "rgba(255,255,255,0.2)", fontSize: tk.fs.xs }}>
          <Share2 className="h-3.5 w-3.5" />
          {copied ? "تم النسخ" : "مشاركة"}
        </button>
      </div>

      <div className="mx-auto max-w-[600px] pb-24">
        {detailQuery.isLoading && (
          <div className="space-y-3 p-3">
            <div className="aspect-square w-full" style={{ background: tk.skeletonBg, borderRadius: tk.radiusLg }} />
            <div className="h-4 w-2/3 rounded-full" style={{ background: tk.skeletonBg }} />
            <div className="h-4 w-1/3 rounded-full" style={{ background: tk.skeletonBg }} />
          </div>
        )}

        {detailQuery.isError && (
          <div className="p-8 text-center">
            <p className="font-bold" style={{ color: tk.text, fontSize: tk.fs.lg }}>تعذر فتح المنتج</p>
            <button onClick={() => void detailQuery.refetch()} className="mt-3 rounded-xl px-5 py-2.5 font-bold text-white"
              style={{ background: tk.accent, fontSize: tk.fs.sm }}>إعادة المحاولة</button>
          </div>
        )}

        {product && (
          <>
            {/* ── Gallery ── */}
            <div className="p-3">
              <div className="relative aspect-square w-full overflow-hidden"
                style={{ background: tk.catIdle, borderRadius: tk.radiusLg, boxShadow: tk.shadowSm }}>
                {hero?.thumb ? (
                  <img src={hero.thumb} alt={product.name} onClick={openZoom}
                    className="h-full w-full cursor-pointer object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <ImageIcon className="h-14 w-14" style={{ color: tk.subtext, opacity: 0.25 }} />
                  </div>
                )}
                <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
                  {product.isNewArrival && <span className="rounded-full px-2.5 py-1 font-bold text-white" style={{ background: tk.accent, fontSize: tk.fs.xs }}>جديد</span>}
                  {product.isOffer && <span className="rounded-full bg-rose-500 px-2.5 py-1 font-bold text-white" style={{ fontSize: tk.fs.xs }}>عرض</span>}
                </div>
                {outOfStock && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/60">
                    <span className="rounded-full bg-red-500 px-4 py-1.5 font-extrabold text-white" style={{ fontSize: tk.fs.md }}>نفد المخزون</span>
                  </div>
                )}
              </div>

              {slides.length > 1 && (
                <div className="mt-2 flex gap-2 overflow-x-auto scrollbar-hide">
                  {slides.map((s, i) => (
                    <button key={s.key} onClick={() => setHeroIdx(i)}
                      className="h-16 w-16 shrink-0 overflow-hidden transition"
                      style={{
                        borderRadius: tk.radiusSm,
                        border: `2px solid ${i === heroIdx ? tk.accent : "transparent"}`,
                        opacity: i === heroIdx ? 1 : 0.6,
                      }}>
                      <img src={s.thumb!} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── Title + price ── */}
            <div className="px-3">
              <h1 className="font-extrabold leading-snug" style={{ color: tk.text, fontSize: tk.fs.xl }}>{product.name}</h1>
              <p className="mt-1" style={{ color: tk.subtext, fontSize: tk.fs.xs }}>
                {product.itemNumber}{product.category ? ` · ${product.category}` : ""}
              </p>

              {product.reviews.count > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <Stars value={Math.round(product.reviews.average ?? 0)} size={tk.fs.md} />
                  <span className="font-bold" style={{ color: tk.text, fontSize: tk.fs.sm }}>{product.reviews.average}</span>
                  <span style={{ color: tk.subtext, fontSize: tk.fs.xs }}>({product.reviews.count} تقييم)</span>
                </div>
              )}

              {allowPrices && !outOfStock && (
                <div className="mt-3 flex items-end gap-2">
                  <span className="font-extrabold leading-none" style={{ color: tk.accent, fontSize: tk.fs.xxl }}>
                    {money(product.salePrice)}
                    <span className="font-normal mr-1" style={{ color: tk.subtext, fontSize: tk.fs.sm }}>د.ع / قطعة</span>
                  </span>
                  {product.isOffer && product.oldPrice ? (
                    <span className="line-through" style={{ color: tk.subtext, fontSize: tk.fs.md }}>{money(product.oldPrice)}</span>
                  ) : null}
                </div>
              )}
              {product.isOffer && product.offerEndsAt && (
                <div className="mt-2.5 flex items-center gap-2">
                  <span className="font-bold" style={{ color: tk.subtext, fontSize: tk.fs.sm }}>ينتهي العرض خلال</span>
                  <OfferCountdown endsAt={product.offerEndsAt} tk={tk} size="lg" />
                </div>
              )}
              {product.showStock && !outOfStock && (
                lowStock ? (
                  <span className="mt-2 inline-block rounded-full px-3 py-1.5 font-extrabold text-white"
                    style={{ background: "#dc2626", fontSize: tk.fs.sm }}>
                    ⚠ تبقى {cartons} كارتون فقط
                  </span>
                ) : (
                  <p className="mt-1.5 font-semibold" style={{ color: tk.subtext, fontSize: tk.fs.sm }}>
                    {money(cartons)} كارتون متوفر
                  </p>
                )
              )}
            </div>

            {/* ── Description ── */}
            {product.description && (
              <section className="mx-3 mt-4 p-3.5" style={{ background: tk.cardBg, borderRadius: tk.radiusLg, border: `1px solid ${tk.divider}` }}>
                <h2 className="mb-2 font-extrabold" style={{ color: tk.text, fontSize: tk.fs.md }}>الوصف</h2>
                <p className="whitespace-pre-line leading-relaxed" style={{ color: tk.subtext, fontSize: tk.fs.sm }}>{product.description}</p>
              </section>
            )}

            {/* ── Specs ── */}
            {product.specs.length > 0 && (
              <section className="mx-3 mt-3 overflow-hidden" style={{ background: tk.cardBg, borderRadius: tk.radiusLg, border: `1px solid ${tk.divider}` }}>
                <h2 className="px-3.5 pt-3.5 pb-2 font-extrabold" style={{ color: tk.text, fontSize: tk.fs.md }}>المواصفات</h2>
                {product.specs.map((s, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 px-3.5 py-2.5"
                    style={{ borderTop: `1px solid ${tk.divider}`, background: i % 2 ? tk.pillBg : "transparent" }}>
                    <span className="font-bold" style={{ color: tk.subtext, fontSize: tk.fs.sm }}>{s.label}</span>
                    <span className="text-left font-semibold" style={{ color: tk.text, fontSize: tk.fs.sm }}>{s.value}</span>
                  </div>
                ))}
              </section>
            )}

            {/* ── Reviews ── */}
            {reviewsEnabled && (
            <section className="mx-3 mt-3 p-3.5" style={{ background: tk.cardBg, borderRadius: tk.radiusLg, border: `1px solid ${tk.divider}` }}>
              <h2 className="mb-3 font-extrabold" style={{ color: tk.text, fontSize: tk.fs.md }}>
                آراء الزبائن {product.reviews.count > 0 ? `(${product.reviews.count})` : ""}
              </h2>

              {product.reviews.items.length === 0 && (
                <p style={{ color: tk.subtext, fontSize: tk.fs.sm }}>لا توجد تقييمات بعد — كن أول من يقيّم.</p>
              )}

              <div className="space-y-3">
                {product.reviews.items.map((r) => (
                  <div key={r.id} className="pb-3" style={{ borderBottom: `1px solid ${tk.divider}` }}>
                    <div className="flex items-center gap-2">
                      <Stars value={r.rating} size={tk.fs.sm} />
                      <span className="font-bold" style={{ color: tk.text, fontSize: tk.fs.sm }}>{r.authorName}</span>
                    </div>
                    {r.comment && <p className="mt-1 leading-relaxed" style={{ color: tk.subtext, fontSize: tk.fs.sm }}>{r.comment}</p>}
                  </div>
                ))}
              </div>

              {/* Write / revise — customers only */}
              {access ? (
                <div className="mt-4 p-3" style={{ background: tk.bg, borderRadius: tk.radiusMd, border: `1px solid ${tk.divider}` }}>
                  <p className="mb-2 font-extrabold" style={{ color: tk.text, fontSize: tk.fs.sm }}>
                    {myReviewQuery.data ? "عدّل تقييمك" : "اكتب تقييمك"}
                  </p>
                  {myReviewQuery.data?.status === "PENDING" && (
                    <p className="mb-2 rounded-lg px-2.5 py-1.5 font-semibold"
                      style={{ background: tk.accentSoft, color: tk.accent, fontSize: tk.fs.xs }}>
                      تقييمك قيد المراجعة — يظهر بعد موافقة الإدارة
                    </p>
                  )}
                  <Stars value={rating} size={tk.fs.xl} onPick={setRating} />
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    placeholder="شنو رأيك بالمنتج؟ (اختياري)"
                    className="mt-2 w-full px-3 py-2 outline-none"
                    style={{ background: tk.cardBg, color: tk.text, border: `1px solid ${tk.divider}`, borderRadius: tk.radiusSm, fontSize: tk.fs.sm }}
                  />
                  {reviewMut.isSuccess && (
                    <p className="mt-2 font-bold" style={{ color: tk.accent, fontSize: tk.fs.xs }}>
                      ✓ تم الإرسال — يظهر بعد موافقة الإدارة
                    </p>
                  )}
                  {reviewMut.isError && (
                    <p className="mt-2 font-bold text-red-500" style={{ fontSize: tk.fs.xs }}>تعذر إرسال التقييم، حاول مرة أخرى</p>
                  )}
                  <button
                    disabled={rating < 1 || reviewMut.isPending}
                    onClick={() => reviewMut.mutate()}
                    className="mt-2.5 w-full py-3 font-extrabold text-white transition active:scale-95 disabled:opacity-40"
                    style={{ background: tk.accent, borderRadius: tk.radiusMd, fontSize: tk.fs.sm }}>
                    {reviewMut.isPending ? "جاري الإرسال..." : myReviewQuery.data ? "تحديث التقييم" : "إرسال التقييم"}
                  </button>
                </div>
              ) : (
                <p className="mt-3 rounded-xl px-3 py-2.5 font-semibold"
                  style={{ background: tk.accentSoft, color: tk.accent, fontSize: tk.fs.xs }}>
                  التقييم متاح لزبائن الجملة — اطلب تفعيل حسابك للمشاركة
                </p>
              )}
            </section>

            )}

            {/* ── Related ── */}
            {suggestionsEnabled && product.related.length > 0 && (
              <section className="mt-4 px-3">
                <h2 className="mb-2 font-extrabold" style={{ color: tk.text, fontSize: tk.fs.md }}>منتجات مشابهة</h2>
                <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-hide">
                  {product.related.map((r) => (
                    <button key={r.id} onClick={() => onOpenProduct(r.id)}
                      className="w-[124px] shrink-0 overflow-hidden text-right transition active:scale-95"
                      style={{ background: tk.cardBg, borderRadius: tk.radiusMd, border: `1px solid ${tk.divider}`, boxShadow: tk.shadowSm }}>
                      <div className="aspect-square w-full" style={{ background: tk.catIdle }}>
                        {r.thumbnailUrl
                          ? <img src={r.thumbnailUrl} alt={r.name} className="h-full w-full object-cover" loading="lazy" />
                          : <div className="flex h-full items-center justify-center"><ImageIcon className="h-6 w-6" style={{ color: tk.subtext, opacity: 0.3 }} /></div>}
                      </div>
                      <div className="p-2">
                        <p className="line-clamp-2 font-bold leading-snug" style={{ color: tk.text, fontSize: tk.fs.xs }}>{r.name}</p>
                        {allowPrices && r.salePrice != null && (
                          <p className="mt-0.5 font-extrabold" style={{ color: tk.accent, fontSize: tk.fs.sm }}>{money(r.salePrice)} د.ع</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* ── Sticky add-to-cart ── */}
      {product && !outOfStock && (
        <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[600px] px-3 pb-3 pt-2"
          style={{ background: tk.bg, borderTop: `1px solid ${tk.divider}` }}>
          <div className="flex gap-2">
            <button
              onClick={() => {
                // The detail payload is a superset of the grid's product shape —
                // reuse the same add() so unit logic stays in one place.
                onAdd(product as unknown as PublicCatalogProduct, defaultUnitFor())
              }}
              className="flex flex-1 items-center justify-center gap-2 py-4 font-extrabold text-white transition active:scale-95"
              style={{ background: tk.accent, borderRadius: tk.radiusLg, boxShadow: tk.shadowMd, fontSize: tk.fs.lg }}>
              <Plus className="h-5 w-5" />
              أضف للسلة
            </button>
            {onSample && (
              <button
                onClick={() => onSample(product as unknown as PublicCatalogProduct)}
                className="flex shrink-0 items-center justify-center gap-1.5 px-4 py-4 font-bold transition active:scale-95"
                style={{
                  background: tk.cardBg,
                  color: tk.accent,
                  border: `2px solid ${tk.accent}`,
                  borderRadius: tk.radiusLg,
                  fontSize: tk.fs.sm,
                }}>
                🔍 عيّنة
              </button>
            )}
          </div>
        </div>
      )}

      {/* Zoom */}
      {zoom && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/95" onClick={() => setZoom(null)}>
          <button className="absolute right-4 top-4 rounded-full bg-white/10 p-2.5" onClick={() => setZoom(null)}>
            <X className="h-6 w-6 text-white" />
          </button>
          <img src={zoom} alt="" className="max-h-[85vh] max-w-[92vw] rounded-2xl object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   MY ACCOUNT — balance, invoices, vouchers and the full statement,
   for the customer who is signed in. Same data the /client/:token portal
   serves, reached with the catalog token they already hold.
══════════════════════════════════════════════════════════════════════ */
type AccountTab = "statement" | "invoices" | "vouchers"

const ACCOUNT_TABS: Array<{ key: AccountTab; label: string }> = [
  { key: "statement", label: "كشف الحساب" },
  { key: "invoices", label: "فواتيري" },
  { key: "vouchers", label: "سنداتي" },
]

function AccountSheet({
  accessToken, tk, onClose,
}: {
  accessToken: string
  tk: ThemeTokens
  onClose: () => void
}) {
  const [tab, setTab] = useState<AccountTab>("statement")
  const accountQuery = useQuery({
    queryKey: ["customer-account", accessToken],
    queryFn: () => getCustomerAccount(accessToken),
    staleTime: 30_000,
  })
  const data = accountQuery.data

  const rows = useMemo(() => {
    const all = data?.transactions ?? []
    if (tab === "invoices") return all.filter(t => t.type === "INVOICE")
    if (tab === "vouchers") return all.filter(t => t.type !== "INVOICE")
    return all
  }, [data, tab])

  // A positive balance is money the customer owes; show which way it runs
  // instead of a bare signed number the shopper has to interpret.
  const balance = data?.customer.currentBalance ?? 0

  return (
    <div className="fixed inset-0 z-[130] mx-auto max-w-[600px] overflow-y-auto" style={{ background: tk.bg }} dir="rtl">
      <div className="sticky top-0 z-20 flex items-center justify-between gap-2 px-3 py-2"
        style={{ background: tk.accent, boxShadow: tk.shadowMd }}>
        <button onClick={onClose} className="flex items-center gap-1 rounded-lg px-2 py-1.5 font-bold text-white transition active:scale-95"
          style={{ background: "rgba(255,255,255,0.2)", fontSize: tk.fs.xs }}>
          <ChevronRight className="h-3.5 w-3.5" />
          رجوع
        </button>
        <span className="font-extrabold text-white" style={{ fontSize: tk.fs.md }}>حسابي</span>
        <span className="w-14" />
      </div>

      <div className="px-3 pb-24 pt-3">
        {accountQuery.isLoading && (
          <p className="py-10 text-center" style={{ color: tk.subtext, fontSize: tk.fs.md }}>جاري التحميل...</p>
        )}

        {accountQuery.isError && (
          <div className="py-10 text-center">
            <p className="font-bold" style={{ color: tk.text, fontSize: tk.fs.md }}>تعذر تحميل حسابك</p>
            <button onClick={() => void accountQuery.refetch()}
              className="mt-3 px-5 py-2.5 font-bold text-white"
              style={{ background: tk.accent, borderRadius: tk.radiusMd, fontSize: tk.fs.sm }}>
              إعادة المحاولة
            </button>
          </div>
        )}

        {data && (
          <>
            {/* Identity + balance */}
            <div className="p-4" style={{ background: tk.cardBg, borderRadius: tk.radiusLg, border: `1px solid ${tk.divider}`, boxShadow: tk.shadowSm }}>
              <p className="font-extrabold" style={{ color: tk.text, fontSize: tk.fs.lg }}>{data.customer.name}</p>
              <p style={{ color: tk.subtext, fontSize: tk.fs.sm }} dir="ltr">{data.customer.phone}</p>
              {data.customer.address && (
                <p className="mt-0.5" style={{ color: tk.subtext, fontSize: tk.fs.xs }}>📍 {data.customer.address}</p>
              )}

              <div className="mt-3 flex items-center justify-between p-3"
                style={{ background: tk.accentSoft, borderRadius: tk.radiusMd }}>
                <span className="font-bold" style={{ color: tk.subtext, fontSize: tk.fs.sm }}>
                  {balance > 0 ? "المبلغ المستحق عليك" : balance < 0 ? "رصيد لك" : "الحساب"}
                </span>
                <span className="font-extrabold" style={{ color: balance > 0 ? "#dc2626" : tk.accent, fontSize: tk.fs.xl }}>
                  {money(Math.abs(balance))} <span style={{ fontSize: tk.fs.xs }}>{data.currency}</span>
                </span>
              </div>

              {data.customer.loyaltyPoints > 0 && (
                <p className="mt-2 font-bold" style={{ color: tk.accent, fontSize: tk.fs.sm }}>
                  ⭐ نقاطك: {money(data.customer.loyaltyPoints)}
                </p>
              )}
            </div>

            {/* Tabs */}
            <div className="mt-3 flex gap-1.5">
              {ACCOUNT_TABS.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className="flex-1 py-2 font-bold transition active:scale-95"
                  style={tab === t.key
                    ? { background: tk.accent, color: "#fff", borderRadius: tk.radiusSm, fontSize: tk.fs.sm }
                    : { background: tk.catIdle, color: tk.catIdleText, borderRadius: tk.radiusSm, fontSize: tk.fs.sm }}>
                  {t.label}
                </button>
              ))}
            </div>

            {rows.length === 0 && (
              <p className="py-10 text-center" style={{ color: tk.subtext, fontSize: tk.fs.md }}>
                ما في حركات بهذا القسم
              </p>
            )}

            <div className="mt-3 space-y-2">
              {rows.map((t) => (
                <div key={t.id} className="p-3"
                  style={{ background: tk.cardBg, borderRadius: tk.radiusMd, border: `1px solid ${tk.divider}` }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold" style={{ color: tk.text, fontSize: tk.fs.sm }}>{t.description}</p>
                      <p style={{ color: tk.subtext, fontSize: tk.fs.xs }}>
                        {new Date(t.date).toLocaleDateString("ar-IQ")}
                        {t.referenceNumber ? ` · ${t.referenceNumber}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-left">
                      {t.debit > 0 && (
                        <p className="font-extrabold" style={{ color: "#dc2626", fontSize: tk.fs.md }}>
                          {money(t.debit)}
                        </p>
                      )}
                      {t.credit > 0 && (
                        <p className="font-extrabold" style={{ color: tk.accent, fontSize: tk.fs.md }}>
                          {money(t.credit)}
                        </p>
                      )}
                      <p style={{ color: tk.subtext, fontSize: tk.fs.xs }}>
                        الرصيد: {money(t.runningBalance)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   STOREFRONT FOOTER — trust block, filled in from catalog management
══════════════════════════════════════════════════════════════════════ */
const SOCIALS: Array<{ key: keyof CatalogFooter; label: string; icon: string; href: (v: string) => string }> = [
  { key: "instagram", label: "انستغرام", icon: "📷", href: (v) => v.startsWith("http") ? v : `https://instagram.com/${v.replace(/^@/, "")}` },
  { key: "facebook", label: "فيسبوك", icon: "👥", href: (v) => v.startsWith("http") ? v : `https://facebook.com/${v}` },
  { key: "telegram", label: "تيليگرام", icon: "✈️", href: (v) => v.startsWith("http") ? v : `https://t.me/${v.replace(/^@/, "")}` },
  { key: "tiktok", label: "تيك توك", icon: "🎵", href: (v) => v.startsWith("http") ? v : `https://tiktok.com/@${v.replace(/^@/, "")}` },
]

/** Module level, not inside CatalogFooterBlock — a component defined during
 *  render is a new type on every pass, so React throws the old one away and
 *  mounts a fresh one each time the footer re-renders. */
function FooterRow({ tk, icon, label, value }: { tk: ThemeTokens; icon: string; label: string; value: string }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-2">
      <span className="shrink-0 leading-none" style={{ fontSize: tk.fs.md }}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold" style={{ color: tk.subtext, fontSize: tk.fs.xs }}>{label}</span>
        <span className="block font-semibold" style={{ color: tk.text, fontSize: tk.fs.sm }}>{value}</span>
      </span>
    </div>
  )
}

function CatalogFooterBlock({ footer: raw, tk, shopName }: { footer: CatalogFooter; tk: ThemeTokens; shopName: string }) {
  const [openAbout, setOpenAbout] = useState(false)
  // Settings rows are free-form JSON, so a value can arrive as a number (an
  // all-digits phone) or null from older/hand-edited data. Coerce once here
  // rather than defending at every .trim() call site.
  const s = (v: unknown) => (v == null ? "" : String(v)).trim()
  const footer = {
    ...raw,
    about: s(raw.about), phone: s(raw.phone), whatsapp: s(raw.whatsapp),
    address: s(raw.address), hours: s(raw.hours),
    instagram: s(raw.instagram), facebook: s(raw.facebook),
    telegram: s(raw.telegram), tiktok: s(raw.tiktok),
    deliveryAreas: s(raw.deliveryAreas), deliveryTime: s(raw.deliveryTime),
    minOrder: s(raw.minOrder),
  }
  const socials = SOCIALS.filter(x => s(footer[x.key]))
  const hasContact = Boolean(footer.phone || footer.whatsapp || footer.address || footer.hours || socials.length)
  const hasDelivery = Boolean(footer.deliveryAreas || footer.deliveryTime || footer.minOrder || footer.cashOnDelivery)
  // Nothing filled in yet → render nothing at all rather than an empty shell.
  if (!footer.enabled || (!footer.about && !hasContact && !hasDelivery)) return null

  const digits = (v: string) => v.replace(/\D/g, "")

  return (
    <footer className="px-3 pb-2 pt-1">
      <div className="overflow-hidden" style={{ background: tk.cardBg, borderRadius: tk.radiusLg, border: `1px solid ${tk.divider}`, boxShadow: tk.shadowSm }}>

        {/* ── About (collapsible) ── */}
        {footer.about && (
          <div style={{ borderBottom: (hasContact || hasDelivery) ? `1px solid ${tk.divider}` : "none" }}>
            <button onClick={() => setOpenAbout(v => !v)}
              className="flex w-full items-center justify-between gap-2 px-4 py-3.5 text-right transition active:opacity-70">
              <span className="flex items-center gap-2 font-extrabold" style={{ color: tk.text, fontSize: tk.fs.md }}>
                <span style={{ fontSize: tk.fs.lg }}>🏬</span>
                من نحن
              </span>
              <ChevronLeft className="h-4 w-4 shrink-0 transition-transform"
                style={{ color: tk.subtext, transform: openAbout ? "rotate(-90deg)" : "none" }} />
            </button>
            {openAbout && (
              <p className="whitespace-pre-line px-4 pb-4 leading-relaxed"
                style={{ color: tk.subtext, fontSize: tk.fs.sm }}>
                {footer.about}
              </p>
            )}
          </div>
        )}

        {/* ── Contact ── */}
        {hasContact && (
          <div className="px-4 py-4" style={{ borderBottom: hasDelivery ? `1px solid ${tk.divider}` : "none" }}>
            <p className="mb-3 flex items-center gap-2 font-extrabold" style={{ color: tk.text, fontSize: tk.fs.md }}>
              <span style={{ fontSize: tk.fs.lg }}>📞</span>
              تواصل معنا
            </p>
            <div className="space-y-2.5">
              {footer.phone && (
                <a href={`tel:${digits(footer.phone)}`} className="block transition active:opacity-70">
                  <FooterRow tk={tk} icon="☎️" label="الهاتف" value={footer.phone} />
                </a>
              )}
              {footer.whatsapp && (
                <a href={`https://wa.me/${digits(footer.whatsapp)}`} target="_blank" rel="noreferrer noopener"
                  className="block transition active:opacity-70">
                  <FooterRow tk={tk} icon="💬" label="واتساب" value={footer.whatsapp} />
                </a>
              )}
              <FooterRow tk={tk} icon="📍" label="العنوان" value={footer.address} />
              <FooterRow tk={tk} icon="🕐" label="أوقات الدوام" value={footer.hours} />
            </div>

            {socials.length > 0 && (
              <div className="mt-3.5 flex flex-wrap gap-2">
                {socials.map((soc) => (
                  <a key={soc.key} href={soc.href(s(footer[soc.key]))} target="_blank" rel="noreferrer noopener"
                    className="flex items-center gap-1.5 px-3 py-2 font-bold transition active:scale-95"
                    style={{ background: tk.accentSoft, color: tk.accent, borderRadius: tk.radiusSm, fontSize: tk.fs.xs }}>
                    <span style={{ fontSize: tk.fs.md }}>{soc.icon}</span>
                    {soc.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Delivery ── */}
        {hasDelivery && (
          <div className="px-4 py-4">
            <p className="mb-3 flex items-center gap-2 font-extrabold" style={{ color: tk.text, fontSize: tk.fs.md }}>
              <span style={{ fontSize: tk.fs.lg }}>🚚</span>
              التوصيل
            </p>
            <div className="space-y-2.5">
              <FooterRow tk={tk} icon="🗺️" label="مناطق التوصيل" value={footer.deliveryAreas} />
              <FooterRow tk={tk} icon="⏱️" label="مدة التوصيل" value={footer.deliveryTime} />
              <FooterRow tk={tk} icon="🧾" label="أقل مبلغ للطلب" value={footer.minOrder} />
            </div>
            {footer.cashOnDelivery && (
              <span className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 font-extrabold"
                style={{ background: tk.accentSoft, color: tk.accent, borderRadius: tk.radiusSm, fontSize: tk.fs.xs }}>
                💵 الدفع عند الاستلام
              </span>
            )}
          </div>
        )}
      </div>

      <p className="mt-3 text-center" style={{ color: tk.subtext, fontSize: tk.fs.xs }}>
        © {new Date().getFullYear()} {shopName}
      </p>
    </footer>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   APPEARANCE SHEET — the shopper's own control over how the shop looks
══════════════════════════════════════════════════════════════════════ */
function AppearanceSheet({
  tk, theme, accent, fontScale, studio,
  onTheme, onAccent, onFontScale, onStudioPerRow, onStudioShape, onReset, onClose,
}: {
  tk: ThemeTokens
  theme: Theme
  accent: AccentKey | null
  fontScale: FontScale
  /** Null when the shop has no gallery — then this section is not drawn. */
  studio: { perRow: number; shape: "square" | "natural" } | null
  onTheme: (t: Theme) => void
  onAccent: (a: AccentKey) => void
  onFontScale: (f: FontScale) => void
  onStudioPerRow: (n: number) => void
  onStudioShape: (v: "square" | "natural") => void
  onReset: () => void
  onClose: () => void
}) {
  const isDark = SURFACES[theme].isDark
  return (
    <>
      <div className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-[160] mx-auto max-w-[600px] max-h-[88vh] overflow-y-auto"
        style={{ background: tk.cardBg, borderTopLeftRadius: tk.radiusXl, borderTopRightRadius: tk.radiusXl, boxShadow: tk.shadowLg }}
        dir="rtl">
        {/* Handle */}
        <div className="sticky top-0 z-10 flex justify-center pt-3 pb-1" style={{ background: tk.cardBg }}>
          <div className="h-1 w-10 rounded-full" style={{ background: tk.divider }} />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3 pt-1" style={{ borderBottom: `1px solid ${tk.divider}` }}>
          <h2 className="flex items-center gap-2 font-extrabold" style={{ color: tk.text, fontSize: tk.fs.lg }}>
            <Palette className="h-5 w-5" style={{ color: tk.accent }} />
            تخصيص المظهر
          </h2>
          <button onClick={onClose} className="p-2" style={{ background: tk.catIdle, borderRadius: tk.radiusSm }} aria-label="إغلاق">
            <X className="h-5 w-5" style={{ color: tk.subtext }} />
          </button>
        </div>

        <div className="space-y-6 px-4 py-5 pb-9">
          {/* ── Live preview ── */}
          <div className="overflow-hidden" style={{ background: tk.bg, borderRadius: tk.radiusLg, border: `1px solid ${tk.divider}` }}>
            <div className="px-3.5 py-2.5 font-extrabold text-white" style={{ background: tk.accent, fontSize: tk.fs.sm }}>
              معاينة مباشرة
            </div>
            <div className="flex items-center gap-3 p-3.5">
              <div className="h-14 w-14 shrink-0" style={{ background: tk.catIdle, borderRadius: tk.radiusMd }} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold" style={{ color: tk.text, fontSize: tk.fs.md }}>اسم منتج للتجربة</p>
                <p className="font-extrabold" style={{ color: tk.accent, fontSize: tk.fs.xl }}>
                  12,500 <span className="font-normal" style={{ color: tk.subtext, fontSize: tk.fs.xs }}>د.ع</span>
                </p>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{ background: tk.accent, boxShadow: tk.shadowMd }}>
                <Plus className="h-5 w-5 text-white" />
              </div>
            </div>
          </div>

          {/* ── Text size ── */}
          <section>
            <p className="mb-2.5 flex items-center gap-1.5 font-extrabold" style={{ color: tk.text, fontSize: tk.fs.md }}>
              <Type className="h-4 w-4" style={{ color: tk.accent }} />
              حجم الخط
            </p>
            <div className="grid grid-cols-4 gap-2">
              {(Object.keys(FONT_SCALES) as FontScale[]).map((f) => {
                const active = fontScale === f
                return (
                  <button key={f} onClick={() => onFontScale(f)}
                    className="flex flex-col items-center justify-center gap-1 py-3 transition active:scale-95"
                    style={{
                      background: active ? tk.accentLight : tk.catIdle,
                      border: `2px solid ${active ? tk.accent : "transparent"}`,
                      borderRadius: tk.radiusMd,
                      color: active ? tk.accent : tk.catIdleText,
                    }}>
                    <span className="font-extrabold leading-none" style={{ fontSize: `${Math.round(FS_BASE.lg * FONT_SCALES[f].mult)}px` }}>أ</span>
                    <span className="font-bold" style={{ fontSize: tk.fs.xs }}>{FONT_SCALES[f].label}</span>
                  </button>
                )
              })}
            </div>
          </section>

          {/* ── Accent colour ── */}
          <section>
            <p className="mb-2.5 font-extrabold" style={{ color: tk.text, fontSize: tk.fs.md }}>لون المتجر</p>
            <div className="grid grid-cols-5 gap-2.5">
              {ACCENTS.map((a) => {
                const hex = isDark ? a.darkHex : a.hex
                const active = accent === a.key
                return (
                  <button key={a.key} onClick={() => onAccent(a.key)} title={a.name}
                    className="flex flex-col items-center gap-1.5 transition active:scale-90">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full"
                      style={{ background: hex, boxShadow: active ? `0 0 0 3px ${tk.cardBg}, 0 0 0 5px ${hex}` : tk.shadowSm }}>
                      {active && <Check className="h-5 w-5 text-white" strokeWidth={3} />}
                    </span>
                    <span className="font-semibold" style={{ color: active ? tk.text : tk.subtext, fontSize: tk.fs.xs }}>{a.name}</span>
                  </button>
                )
              })}
            </div>
          </section>

          {/* ── Surface mood ── */}
          <section>
            <p className="mb-2.5 font-extrabold" style={{ color: tk.text, fontSize: tk.fs.md }}>الخلفية</p>
            <div className="grid grid-cols-2 gap-2.5">
              {(Object.keys(SURFACES) as Theme[]).map((t) => {
                const s = SURFACES[t]
                const active = theme === t
                return (
                  <button key={t} onClick={() => onTheme(t)}
                    className="flex items-center gap-2.5 p-3 text-right transition active:scale-95"
                    style={{
                      background: s.bg,
                      border: `2px solid ${active ? tk.accent : s.divider}`,
                      borderRadius: tk.radiusMd,
                      boxShadow: active ? tk.shadowMd : "none",
                    }}>
                    <span className="leading-none" style={{ fontSize: tk.fs.xl }}>{s.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 font-extrabold" style={{ color: s.text, fontSize: tk.fs.sm }}>
                        {s.name}
                        {active && <Check className="h-3.5 w-3.5" style={{ color: tk.accent }} strokeWidth={3} />}
                      </span>
                      <span className="block truncate" style={{ color: s.subtext, fontSize: tk.fs.xs }}>{s.desc}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          {/* ── «المعرض» — its own controls, nothing to do with the store grid ── */}
          {studio && (
            <section>
              <p className="mb-2.5 font-extrabold" style={{ color: tk.text, fontSize: tk.fs.md }}>المعرض</p>

              <p className="mb-1.5" style={{ color: tk.subtext, fontSize: tk.fs.xs }}>حجم الصور</p>
              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 3, 4].map((n) => {
                  const active = studio.perRow === n
                  return (
                    <button key={n} onClick={() => onStudioPerRow(n)}
                      className="flex min-h-[44px] cursor-pointer flex-col items-center justify-center gap-1 transition-colors duration-200 active:scale-95"
                      style={{
                        background: active ? tk.accentLight : tk.catIdle,
                        border: `2px solid ${active ? tk.accent : "transparent"}`,
                        borderRadius: tk.radiusMd,
                        color: active ? tk.accent : tk.catIdleText,
                      }}>
                      <span className="font-extrabold leading-none" style={{ fontSize: tk.fs.md }}>{n}</span>
                      <span className="font-bold" style={{ fontSize: tk.fs.xs }}>
                        {n === 1 ? "كبيرة" : n === 4 ? "صغيرة" : "بالصف"}
                      </span>
                    </button>
                  )
                })}
              </div>

              <p className="mb-1.5 mt-3" style={{ color: tk.subtext, fontSize: tk.fs.xs }}>شكل الصورة</p>
              <div className="grid grid-cols-2 gap-2.5">
                {([
                  { v: "square" as const, title: "مربعة", desc: "مرتبة ومتساوية" },
                  { v: "natural" as const, title: "بطولها", desc: "شكل مجلة" },
                ]).map((o) => {
                  const active = studio.shape === o.v
                  return (
                    <button key={o.v} onClick={() => onStudioShape(o.v)}
                      className="min-h-[44px] cursor-pointer p-3 text-right transition-colors duration-200 active:scale-95"
                      style={{
                        background: active ? tk.accentLight : tk.catIdle,
                        border: `2px solid ${active ? tk.accent : "transparent"}`,
                        borderRadius: tk.radiusMd,
                      }}>
                      <span className="flex items-center gap-1 font-extrabold"
                        style={{ color: active ? tk.accent : tk.catIdleText, fontSize: tk.fs.sm }}>
                        {o.title}
                        {active && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                      </span>
                      <span className="block truncate" style={{ color: tk.subtext, fontSize: tk.fs.xs }}>{o.desc}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {/* ── Reset ── */}
          <button onClick={onReset}
            className="flex w-full items-center justify-center gap-2 py-3 font-bold transition active:scale-95"
            style={{ background: tk.catIdle, color: tk.catIdleText, borderRadius: tk.radiusMd, fontSize: tk.fs.sm }}>
            <RotateCcw className="h-4 w-4" />
            رجّع المظهر الافتراضي للمتجر
          </button>
        </div>
      </div>
    </>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   UNIT PICKER SHEET
══════════════════════════════════════════════════════════════════════ */
function UnitPickerSheet({
  product, allowPrices, showStock, tk, onAdd, onClose,
}: {
  product: PublicCatalogProduct; allowPrices: boolean; showStock: boolean
  tk: ThemeTokens
  onAdd: (lines: Array<{ unit: CatalogUnit; quantity: number }>) => void
  onClose: () => void
}) {
  const units = unitsFor()

  // Every unit starts at zero. Opening the sheet pre-loaded with one carton
  // meant a shopper who only wanted to look at a product had already been
  // handed one, and the ones who noticed had to take it back out. The shopper
  // says what they want; nothing is chosen on their behalf.
  const [qty, setQty] = useState<Record<string, number>>({})

  // Pieces are the shared budget: 2 cartons and 5 dozens of the same product
  // draw on one pile of stock. Checking each unit against the total on its own
  // let a shopper build a basket the warehouse could not fill.
  const piecesChosen = units.reduce((sum, u) => sum + (qty[u] ?? 0) * pcs(product, u), 0)
  const piecesLeft = Math.max(0, product.currentStock - piecesChosen)

  const totalPrice = units.reduce((sum, u) => sum + (qty[u] ?? 0) * linePrice(product, u), 0)
  const anyChosen = units.some((u) => (qty[u] ?? 0) > 0)

  function setUnitQty(u: CatalogUnit, next: number) {
    const perUnit = Math.max(1, pcs(product, u))
    const current = qty[u] ?? 0
    // How many more of THIS unit fit in what is left, plus what it already holds.
    const ceiling = current + Math.floor(piecesLeft / perUnit)
    setQty((prev) => ({ ...prev, [u]: Math.max(0, Math.min(next, ceiling)) }))
  }

  return (
    <>
      <div className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-[160] mx-auto flex max-h-[92vh] max-w-[600px] flex-col rounded-t-3xl shadow-2xl" style={{ background: tk.cardBg }} dir="rtl">
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full" style={{ background: tk.divider }} />
        </div>

        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${tk.divider}` }}>
          {(product.thumbnailUrl || product.imageUrl) ? (
            <img src={product.thumbnailUrl || product.imageUrl!} alt={product.name} className="h-14 w-14 rounded-xl object-cover border" style={{ borderColor: tk.divider }} loading="lazy" decoding="async" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-xl" style={{ background: tk.catIdle }}>
              <ImageIcon className="h-6 w-6" style={{ color: tk.subtext, opacity: 0.4 }} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 font-bold" style={{ color: tk.text, fontSize: tk.fs.md }}>{product.name}</p>
            <p style={{ color: tk.subtext, fontSize: tk.fs.xs }}>{product.itemNumber}</p>
            {showStock && (
              <p className="font-semibold" style={{ color: piecesLeft === 0 ? "#ef4444" : tk.subtext, fontSize: tk.fs.xs }}>
                {piecesLeft === 0 ? "وصلت لكل المتوفر" : `متبقي ${money(piecesLeft)} قطعة`}
              </p>
            )}
          </div>
          <button onClick={onClose} className="shrink-0 rounded-xl p-2" style={{ background: tk.catIdle }}>
            <X className="h-5 w-5" style={{ color: tk.subtext }} />
          </button>
        </div>

        <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
          {units.map((u) => {
            const perUnit = Math.max(1, pcs(product, u))
            const available = maxQty(product, u)
            const chosen = qty[u] ?? 0
            const disabled = available < 1
            const canAddMore = piecesLeft >= perUnit

            return (
              <div key={u}
                className="rounded-2xl p-3.5 transition"
                style={{
                  background: disabled ? tk.catIdle : tk.cardBg,
                  border: `2px solid ${chosen > 0 ? tk.accent : tk.divider}`,
                  opacity: disabled ? 0.4 : 1,
                }}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">
                    {u === "PIECE" ? "1️⃣" : u === "DOZEN" ? "📦" : u === "BOX" ? "🗂️" : "📫"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold" style={{ color: tk.text, fontSize: tk.fs.lg }}>
                        {UNIT_LABELS[u]}
                      </span>
                      {u === "BOX" && (
                        <span className="rounded-full px-2 py-0.5 font-bold" style={{ background: tk.accentLight, color: tk.accent, fontSize: tk.fs.xs }}>
                          نصف كارتون
                        </span>
                      )}
                    </div>
                    <p style={{ color: tk.subtext, fontSize: tk.fs.xs }}>
                      {UNIT_DESC[u](perUnit)}
                      {showStock && !disabled ? ` · متوفر ${money(available)}` : ""}
                      {disabled ? " · غير متوفر" : ""}
                    </p>
                  </div>
                  {allowPrices && !disabled && (
                    <div className="text-left">
                      <p className="font-extrabold" style={{ color: tk.accent, fontSize: tk.fs.md }}>{money(linePrice(product, u))}</p>
                      {perUnit > 1 && (
                        <p style={{ color: tk.subtext, fontSize: tk.fs.xs }}>
                          {money(Math.round(linePrice(product, u) / perUnit))} للقطعة
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {!disabled && (
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => setUnitQty(u, chosen - 1)}
                      disabled={chosen === 0}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg font-extrabold disabled:opacity-30"
                      style={{ background: tk.catIdle, color: tk.text }}>
                      −
                    </button>
                    <span className="w-12 text-center font-extrabold" style={{ color: tk.text, fontSize: tk.fs.lg }}>
                      {chosen}
                    </span>
                    <button
                      onClick={() => setUnitQty(u, chosen + 1)}
                      disabled={!canAddMore}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white disabled:opacity-30"
                      style={{ background: tk.accent }}>
                      <Plus className="h-4 w-4" />
                    </button>

                    <div className="mr-auto flex gap-1.5">
                      {[5, 10].map((n) => (
                        <button key={n}
                          onClick={() => setUnitQty(u, n)}
                          disabled={available < n}
                          className="rounded-lg px-2.5 py-1.5 font-bold disabled:opacity-30"
                          style={{ background: tk.accentLight, color: tk.accent, fontSize: tk.fs.xs }}>
                          {n}
                        </button>
                      ))}
                    </div>

                    {allowPrices && chosen > 0 && (
                      <span className="shrink-0 font-extrabold" style={{ color: tk.accent, fontSize: tk.fs.sm }}>
                        {money(chosen * linePrice(product, u))}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="px-4 pb-6 pt-2" style={{ borderTop: `1px solid ${tk.divider}` }}>
          <button
            disabled={!anyChosen}
            onClick={() => onAdd(units.filter((u) => (qty[u] ?? 0) > 0).map((u) => ({ unit: u, quantity: qty[u] })))}
            className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 font-extrabold text-white transition active:scale-[0.98] disabled:opacity-40"
            style={{ background: tk.accent, fontSize: tk.fs.md }}>
            <Plus className="h-5 w-5" />
            أضف للسلة
            {allowPrices && anyChosen ? <span>· {money(totalPrice)} د.ع</span> : null}
          </button>
        </div>
      </div>
    </>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   PRODUCT CARD
══════════════════════════════════════════════════════════════════════ */
/**
 * Full-resolution picture, opened straight from the grid.
 *
 * The card shows a 200px thumbnail, which is all the grid needs and all it
 * should download. Tapping it used to open the product sheet, so seeing the
 * actual picture took a second tap and a scroll. Now the thumbnail is painted
 * immediately as a placeholder and the full image swaps in behind it, so the
 * viewer never opens empty even on a slow connection.
 */
/**
 * Full-size images already fetched this session, keyed by product.
 *
 * They average ~286KB and run to ~440KB, and the viewer used to re-download
 * one on every open — reopening twenty products cost the shopper about six
 * megabytes of mobile data for pictures they had already seen. Module scope so
 * it survives the viewer unmounting, and dropped on reload like any other page
 * state, which is the right lifetime for a picture the shop can replace.
 */
const fullImageCache = new Map<string, string>()

/**
 * «احجز البضاعة القادمة الجديدة» — goods bought but not yet received.
 *
 * Reserving is a promise, not an order: nothing enters the cart and no stock
 * moves, because the goods do not exist in the system yet. Pressing it again
 * changes the quantity rather than queueing a second promise, which is what
 * the server's one-per-person rule enforces.
 */
function IncomingRow({ tk, phone, customerName, allowPrices }: {
  tk: ThemeTokens; phone: string; customerName: string; allowPrices: boolean
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState<IncomingItem | null>(null)
  const [qty, setQty] = useState(1)

  // What is actually on the way, in the unit a wholesaler thinks in. A shopper
  // who cannot see this has no way to know whether the shipment even covers
  // what they are about to reserve.
  const cartonsOf = (it: IncomingItem) =>
    it.quantityPieces && it.pcsPerCarton && it.pcsPerCarton > 0
      ? Math.floor(it.quantityPieces / it.pcsPerCarton)
      : null
  const incomingLabel = (it: IncomingItem) => {
    const cartons = cartonsOf(it)
    if (cartons && cartons > 0) return `جاي ${money(cartons)} كارتون`
    if (it.quantityPieces) return `جاي ${money(it.quantityPieces)} قطعة`
    return null
  }
  // Reserving more than is coming is a promise the shop cannot keep, so the
  // counter stops at the shipment. Unknown quantity keeps the old open ceiling.
  const maxReserve = (it: IncomingItem) => cartonsOf(it) || it.quantityPieces || 9999

  const query = useQuery({
    queryKey: ["catalog-incoming", phone],
    queryFn: () => getPublicIncomingItems(phone),
    staleTime: 60_000,
  })
  const items = query.data?.items ?? []
  const mine = query.data?.mine ?? {}

  const reserveMut = useMutation({
    mutationFn: () => reserveIncomingItem({
      itemId: open!.id, phone, name: customerName || undefined, quantity: qty,
    }),
    onSuccess: () => {
      setOpen(null)
      void qc.invalidateQueries({ queryKey: ["catalog-incoming"] })
    },
  })

  // An anonymous guest has no phone on file, and reserving without one fails
  // server-side — so the row simply does not appear rather than offering a
  // button that answers «تعذر الحجز» whatever they do.
  if (items.length === 0 || !phone) return null

  return (
    <div className="px-3 pt-3">
      <p className="mb-2 font-extrabold" style={{ color: tk.text, fontSize: tk.fs.md }}>
        🚢 البضاعة القادمة الجديدة
      </p>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {items.map((it) => {
          const reserved = mine[it.id]
          return (
            <button key={it.id}
              onClick={() => { setQty(reserved ?? 1); setOpen(it) }}
              className="flex w-[150px] shrink-0 flex-col gap-1.5 rounded-2xl p-2 text-right transition active:scale-95"
              style={{ background: tk.cardBg, border: `2px solid ${reserved ? tk.accent : tk.cardBorder}` }}>
              {it.imageUrl ? (
                <span className="block aspect-square w-full overflow-hidden rounded-xl" style={{ background: tk.catIdle }}>
                  <img src={it.imageUrl} alt={it.name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                </span>
              ) : (
                <span className="flex aspect-square w-full items-center justify-center rounded-xl" style={{ background: tk.catIdle }}>
                  <ImageIcon className="h-6 w-6" style={{ color: tk.subtext, opacity: 0.3 }} />
                </span>
              )}
              <span className="truncate font-bold" style={{ color: tk.text, fontSize: tk.fs.xs }}>{it.name}</span>
              {it.category && (
                <span className="truncate" style={{ color: tk.subtext, fontSize: tk.fs.xs }}>{it.category}</span>
              )}
              {allowPrices && it.price != null && (
                <span className="font-extrabold" style={{ color: tk.accent, fontSize: tk.fs.xs }}>
                  {money(it.price)} د.ع
                </span>
              )}
              {incomingLabel(it) && (
                <span style={{ color: tk.subtext, fontSize: tk.fs.xs }}>{incomingLabel(it)}</span>
              )}
              {it.expectedAt && (
                <span style={{ color: tk.subtext, fontSize: tk.fs.xs }}>
                  يوصل {new Date(it.expectedAt).toLocaleDateString("ar-IQ", { month: "short", day: "numeric" })}
                </span>
              )}
              <span className="rounded-lg px-2 py-1 text-center font-bold"
                style={{ background: reserved ? tk.accent : tk.accentLight, color: reserved ? "#fff" : tk.accent, fontSize: tk.fs.xs }}>
                {reserved ? `محجوز ${reserved}` : "احجز"}
              </span>
            </button>
          )
        })}
      </div>

      {open && (
        <div className="fixed inset-0 z-[170] flex items-end justify-center bg-black/50 backdrop-blur-sm"
          dir="rtl" onClick={() => setOpen(null)}>
          <div className="w-full max-w-[600px] rounded-t-3xl p-5" style={{ background: tk.cardBg }}
            onClick={(e) => e.stopPropagation()}>
            <p className="font-extrabold" style={{ color: tk.text, fontSize: tk.fs.lg }}>{open.name}</p>
            {open.description && (
              <p className="mt-1" style={{ color: tk.subtext, fontSize: tk.fs.sm }}>{open.description}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {open.category && (
                <span className="rounded-full px-2 py-0.5 font-bold" style={{ background: tk.catIdle, color: tk.catIdleText, fontSize: tk.fs.xs }}>
                  {open.category}
                </span>
              )}
              {allowPrices && open.price != null && (
                <span className="rounded-full px-2 py-0.5 font-bold" style={{ background: tk.accentLight, color: tk.accent, fontSize: tk.fs.xs }}>
                  {money(open.price)} د.ع
                </span>
              )}
              {incomingLabel(open) && (
                <span className="rounded-full px-2 py-0.5 font-bold" style={{ background: tk.catIdle, color: tk.catIdleText, fontSize: tk.fs.xs }}>
                  {incomingLabel(open)}
                </span>
              )}
              {open.expectedAt && (
                <span className="rounded-full px-2 py-0.5 font-bold" style={{ background: tk.catIdle, color: tk.catIdleText, fontSize: tk.fs.xs }}>
                  متوقع {new Date(open.expectedAt).toLocaleDateString("ar-IQ", { month: "short", day: "numeric" })}
                </span>
              )}
            </div>
            <p className="mt-2" style={{ color: tk.subtext, fontSize: tk.fs.xs }}>
              الحجز يثبّت لك كمية من البضاعة قبل ما توصل. ما ينحسب طلب ولا فاتورة — نتواصل وياك أول ما تنزل.
            </p>

            <div className="mt-4 flex items-center justify-center gap-3">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="flex h-11 w-11 items-center justify-center rounded-xl text-lg font-extrabold"
                style={{ background: tk.catIdle, color: tk.text }}>−</button>
              <span className="w-16 text-center font-extrabold" style={{ color: tk.text, fontSize: tk.fs.xl }}>{qty}</span>
              <button onClick={() => setQty((q) => Math.min(maxReserve(open), q + 1))}
                className="flex h-11 w-11 items-center justify-center rounded-xl text-white disabled:opacity-40"
                disabled={qty >= maxReserve(open)}
                style={{ background: tk.accent }}><Plus className="h-4 w-4" /></button>
            </div>
            {qty >= maxReserve(open) && incomingLabel(open) && (
              <p className="mt-1.5 text-center" style={{ color: tk.subtext, fontSize: tk.fs.xs }}>
                هذي كل الكمية القادمة
              </p>
            )}

            <button
              disabled={reserveMut.isPending}
              onClick={() => reserveMut.mutate()}
              className="mt-4 w-full rounded-2xl py-3.5 font-extrabold text-white transition active:scale-95 disabled:opacity-50"
              style={{ background: tk.accent, fontSize: tk.fs.md }}>
              {reserveMut.isPending ? "جاري الحجز..." : mine[open.id] ? "عدّل الحجز" : "أكّد الحجز"}
            </button>
            {reserveMut.isError && (
              <p className="mt-2 text-center" style={{ color: "#dc2626", fontSize: tk.fs.xs }}>تعذر الحجز — حاول مرة ثانية</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ProductImageViewer({
  product, thumb, accessToken, guestMode, visitorToken, tk, onClose, onOpenProduct,
}: {
  product: PublicCatalogProduct
  thumb: string | null
  accessToken: string
  guestMode: boolean
  visitorToken: string
  tk: ThemeTokens
  onClose: () => void
  onOpenProduct: () => void
}) {
  // Seeded from the cache during render, so a picture opened before appears
  // instantly instead of flashing its thumbnail again.
  const [full, setFull] = useState<string | null>(() => fullImageCache.get(product.id) ?? null)
  const [loading, setLoading] = useState(() => !fullImageCache.has(product.id))
  const src = full ?? thumb

  useEffect(() => {
    const cached = fullImageCache.get(product.id)
    if (cached) return

    let cancelled = false
    const load = guestMode || visitorToken
      ? getGuestCatalogProductImage(product.id, visitorToken)
      : getPublicCatalogProductImage(accessToken, product.id)
    load
      .then((image) => {
        if (!image) return
        fullImageCache.set(product.id, image)
        if (!cancelled) setFull(image)
      })
      // The thumbnail stays on screen — a failed full-size fetch must not
      // leave the shopper looking at a black rectangle.
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [product.id, accessToken, guestMode, visitorToken])

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/95" dir="rtl" onClick={onClose}>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <span className="min-w-0 flex-1 truncate font-bold text-white" style={{ fontSize: tk.fs.md }}>
          {product.name}
        </span>
        <button onClick={onClose} className="shrink-0 rounded-full bg-white/15 p-2 text-white" aria-label="إغلاق">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-auto px-2">
        {src ? (
          <img
            src={src}
            alt={product.name}
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <ImageIcon className="h-16 w-16 text-white/30" />
        )}
      </div>

      <div className="flex items-center justify-between gap-2 px-4 py-4">
        <span className="text-white/60" style={{ fontSize: tk.fs.xs }}>
          {loading ? "جاري تحميل الصورة بالدقة الكاملة..." : "اضغط برة الصورة للإغلاق"}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); onOpenProduct() }}
          className="shrink-0 rounded-xl px-4 py-2 font-bold text-white"
          style={{ background: tk.accent, fontSize: tk.fs.sm }}>
          تفاصيل المنتج
        </button>
      </div>
    </div>
  )
}

function ProductCard({
  product, allowPrices, showStock, qtyInCart, pcsInCart, cartUnit, tk, viewMode, perRow, lowStockCartons,
  onAdd, onRemoveOne, onOpenPicker, onOpen, onOpenImage,
}: {
  product: PublicCatalogProduct
  allowPrices: boolean
  showStock: boolean
  qtyInCart: number
  pcsInCart: number
  cartUnit: CatalogUnit | null
  tk: ThemeTokens
  viewMode: ViewMode
  perRow: number
  lowStockCartons: number
  onAdd: (unit: CatalogUnit) => void
  onRemoveOne: () => void
  onOpenPicker: () => void
  onOpen: () => void
  /** Tapping the picture shows the picture, not the product sheet. */
  onOpenImage: () => void
}) {
  // Prefer the lightweight thumbnail; the full-res image is fetched on zoom.
  const thumbSrc = product.thumbnailUrl || product.imageUrl
  // The picture exists but has not arrived yet — a quiet loading box, not the
  // "no picture" icon, which would otherwise flash on every card each time the
  // shopper turns a page.
  const awaitingThumb = !thumbSrc && (product.hasImage ?? false)
  const compact = perRow >= 4
  // The catalog is a phone-only storefront, so a card at 3-per-row is ~110px
  // wide. One fixed type scale made the price eat three quarters of that —
  // step the card's own typography down as the columns get narrower.
  const cardFs = perRow >= 3
    ? { price: tk.fs.lg, name: tk.fs.sm, sub: tk.fs.xs }
    : { price: tk.fs.xxl, name: tk.fs.md, sub: tk.fs.xs }
  const outOfStock = product.currentStock <= 0
  const cartonsLeft = Math.floor(product.currentStock / Math.max(1, product.pcsPerCarton))
  // Cartons, against the threshold the shop set. The old rule was "5 pieces
  // or fewer", which on a wholesale catalog selling by the carton essentially
  // never fired. 0 = the shop has not opted into scarcity warnings.
  const lowStock = !outOfStock && lowStockCartons > 0 && cartonsLeft <= lowStockCartons
  // Price shown is per PIECE by default (when not in cart) or the cart unit
  const displayUnit = cartUnit ?? "PIECE"
  const displayPrice = linePrice(product, displayUnit)
  // canAddMore: if single unit type in cart, check that unit's limit; else check total pieces vs stock
  const canAddMore = !outOfStock && (
    cartUnit
      ? maxQty(product, cartUnit) > qtyInCart
      : pcsInCart < product.currentStock
  )

  // "+ button" logic: if already have one unit type in cart → add same, else open picker
  function handleAddPress() {
    if (outOfStock) return
    if (cartUnit) { onAdd(cartUnit) } else { onOpenPicker() }
  }

  /* ── List view ── */
  if (viewMode === "list") {
    return (
      <div className="flex gap-2.5 overflow-hidden transition active:scale-[0.99]"
        style={{
          background: tk.cardBg,
          border: `2px solid ${qtyInCart > 0 ? tk.accent : tk.cardBorder}`,
          borderRadius: tk.radiusLg,
          boxShadow: qtyInCart > 0 ? tk.shadowMd : tk.shadowSm,
          padding: "8px",
        }}>
        {/* Square image */}
        <div className="relative h-[76px] w-[76px] shrink-0 cursor-pointer overflow-hidden" style={{ background: tk.catIdle, borderRadius: tk.radiusMd }} onClick={onOpenImage}>
          {thumbSrc ? (
            <img src={thumbSrc} alt={product.name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
          ) : (
            awaitingThumb
              ? <div className="h-full w-full animate-pulse" style={{ background: tk.skeletonBg }} />
              : <div className="flex h-full items-center justify-center"><ImageIcon className="h-6 w-6" style={{ color: tk.subtext, opacity: 0.3 }} /></div>
          )}
          {qtyInCart > 0 && (
            <span className="absolute left-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full font-extrabold text-white ring-1 ring-white/50" style={{ background: tk.accent, fontSize: tk.fs.xs }}>{qtyInCart}</span>
          )}
          {product.isOffer && <span className="absolute right-0.5 top-0.5 rounded-full bg-rose-500 px-1.5 py-0.5 font-bold text-white" style={{ fontSize: tk.fs.xs }}>عرض</span>}
          {outOfStock && <div className="absolute inset-0 bg-white/60 flex items-center justify-center"><span className="font-extrabold text-red-600" style={{ fontSize: tk.fs.xs }}>نفد</span></div>}
        </div>

        {/* Info */}
        <div className="flex min-w-0 flex-1 flex-col justify-between">
          <div className="flex items-start gap-1">
            <p onClick={onOpen} className="line-clamp-2 flex-1 cursor-pointer font-bold leading-snug" style={{ color: tk.text, fontSize: tk.fs.md }}>{product.name}</p>
            {product.isNewArrival && <span className="shrink-0 rounded-full px-1.5 py-0.5 font-bold text-white" style={{ background: tk.accent, fontSize: tk.fs.xs }}>جديد</span>}
          </div>
          <div className="flex items-center justify-between gap-1 mt-1">
            <div>
              {allowPrices && (
                <p className="font-extrabold leading-none" style={{ color: tk.accent, fontSize: tk.fs.xl }}>
                  {money(displayPrice)} <span className="font-normal" style={{ color: tk.subtext, fontSize: tk.fs.xs }}>د.ع/{UNIT_LABELS[displayUnit]}</span>
                </p>
              )}
              {showStock && !outOfStock && (
                <p className="mt-1 font-extrabold" style={{ color: lowStock ? "#dc2626" : tk.subtext, fontSize: tk.fs.xs }}>
                  {lowStock ? `⚠ تبقى ${cartonsLeft} كارتون` : `${money(cartonsLeft)} كرتون متوفر`}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {qtyInCart > 0 && (
                <button onClick={onRemoveOne} className="flex h-7 w-7 items-center justify-center rounded-full shadow-sm active:scale-90 transition-transform"
                  style={{ background: tk.accentLight }}>
                  <Minus className="h-3.5 w-3.5" style={{ color: tk.accent }} />
                </button>
              )}
              <button
                disabled={outOfStock || !canAddMore}
                onClick={handleAddPress}
                className="flex h-9 w-9 items-center justify-center rounded-full shadow-md active:scale-90 transition-transform disabled:opacity-40"
                style={{ background: tk.accent }}>
                <Plus className="h-5 w-5 text-white" />
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  /* ── Compact grid (4+ per row) ── */
  if (compact) {
    return (
      <div className="overflow-hidden transition-transform active:scale-[0.97]"
        style={{
          background: tk.cardBg,
          border: `2px solid ${qtyInCart > 0 ? tk.accent : tk.cardBorder}`,
          borderRadius: tk.radiusMd,
          boxShadow: qtyInCart > 0 ? tk.shadowMd : tk.shadowSm,
        }}>
        <div className="relative aspect-square cursor-pointer overflow-hidden" style={{ background: tk.catIdle }} onClick={onOpenImage}>
          {thumbSrc ? (
            <img src={thumbSrc} alt={product.name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
          ) : (
            awaitingThumb
              ? <div className="h-full w-full animate-pulse" style={{ background: tk.skeletonBg }} />
              : <div className="flex h-full items-center justify-center"><ImageIcon className="h-5 w-5" style={{ color: tk.subtext, opacity: 0.3 }} /></div>
          )}
          {outOfStock && <div className="absolute inset-0 bg-white/55 pointer-events-none" />}
          {qtyInCart > 0 && (
            <span className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full font-extrabold text-white ring-1 ring-white/40 shadow" style={{ background: tk.accent, fontSize: tk.fs.xs }}>{qtyInCart}</span>
          )}
          {product.isOffer && <span className="absolute right-0.5 top-0.5 rounded-full bg-rose-500 px-1.5 py-0.5 font-bold text-white" style={{ fontSize: tk.fs.xs }}>عرض</span>}
          {product.isNewArrival && !product.isOffer && <span className="absolute right-0.5 top-0.5 rounded-full px-1.5 py-0.5 font-bold text-white" style={{ background: tk.accent, fontSize: tk.fs.xs }}>جديد</span>}

          {/* At 4-per-row the card is ~80px wide. Sharing one row between the
              text and the +/- buttons left the price about 35px and clipped
              it, so the buttons float over the image and the name/price get
              the card's full width underneath. */}
          <div className="absolute bottom-1 left-1 flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            {qtyInCart > 0 && (
              <button onClick={onRemoveOne} className="flex h-6 w-6 items-center justify-center rounded-full shadow active:scale-90" style={{ background: "rgba(255,255,255,0.92)" }}>
                <Minus className="h-3 w-3" style={{ color: tk.text }} />
              </button>
            )}
            <button
              disabled={outOfStock || !canAddMore}
              onClick={handleAddPress}
              className="flex h-7 w-7 items-center justify-center rounded-full shadow-md disabled:opacity-40 active:scale-90 transition-transform"
              style={{ background: tk.accent }}>
              <Plus className="h-4 w-4 text-white" />
            </button>
          </div>
        </div>

        <div className="px-1.5 pb-1.5 pt-1">
          <p onClick={onOpen} className="truncate cursor-pointer font-bold leading-tight" style={{ color: tk.text, fontSize: tk.fs.xs }}>{product.name}</p>
          {allowPrices && !outOfStock && (
            <p className="truncate font-extrabold" style={{ color: tk.accent, fontSize: tk.fs.sm }}>{money(displayPrice)} د.ع</p>
          )}
          {outOfStock && <p className="font-bold text-red-500" style={{ fontSize: tk.fs.xs }}>نفد</p>}
        </div>
      </div>
    )
  }

  /* ── Full grid card (2-3 per row) ── */
  return (
    <div className="flex flex-col overflow-hidden transition-transform active:scale-[0.98]"
      style={{
        background: tk.cardBg,
        border: `2px solid ${qtyInCart > 0 ? tk.accent : tk.cardBorder}`,
        borderRadius: tk.radiusLg,
        boxShadow: qtyInCart > 0 ? tk.shadowLg : tk.shadowSm,
      }}>
      {/* Image — full square with all controls overlaid */}
      {/* The whole tile opens the product — hanging the handler off the <img>
          alone left every product without a photo with no way in at all. */}
      <div className="relative aspect-square cursor-pointer overflow-hidden" style={{ background: tk.catIdle }} onClick={onOpenImage}>
        {thumbSrc ? (
          <img src={thumbSrc} alt={product.name}
            className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
            loading="lazy" decoding="async" />
        ) : (
          awaitingThumb ? (
            <div className="h-full w-full animate-pulse" style={{ background: tk.skeletonBg }} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <ImageIcon className="h-10 w-10" style={{ color: tk.subtext, opacity: 0.2 }} />
            </div>
          )
        )}

        {/* Gradient overlay - bottom half only */}
        <div className="absolute inset-x-0 bottom-0 pointer-events-none"
          style={{ height: "65%", background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)" }} />

        {/* Out-of-stock dim */}
        {outOfStock && <div className="absolute inset-0 bg-white/60 pointer-events-none" />}

        {/* Top-right badges */}
        <div className="absolute right-1.5 top-1.5 flex flex-col items-end gap-1">
          {product.category && (
            <span className="rounded-full px-2 py-0.5 font-bold text-white" style={{ background: "rgba(0,0,0,0.6)", fontSize: tk.fs.xs }}>{product.category}</span>
          )}
          {product.isNewArrival && <span className="rounded-full px-2 py-0.5 font-bold text-white" style={{ background: tk.accent, fontSize: tk.fs.xs }}>جديد</span>}
          {product.isOffer && <span className="rounded-full bg-rose-500 px-2 py-0.5 font-bold text-white" style={{ fontSize: tk.fs.xs }}>عرض</span>}
          {product.isOffer && product.offerEndsAt && perRow <= 2 && (
            <OfferCountdown endsAt={product.offerEndsAt} tk={tk} size="sm" />
          )}
        </div>

        {/* Cart qty badge top-left */}
        {qtyInCart > 0 && (
          <span className="absolute left-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full font-extrabold text-white shadow-lg ring-2 ring-white/40"
            style={{ background: tk.accent, fontSize: tk.fs.sm }}>{qtyInCart}</span>
        )}

        {/* Bottom overlay: price + controls */}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between px-2 pb-2">
          {/* Price */}
          <div>
            {allowPrices && !outOfStock && (
              <>
                {product.isOffer && product.oldPrice != null && Number(product.oldPrice) > 0 && (
                  <p className="text-white/60 line-through leading-none" style={{ fontSize: tk.fs.xs }}>{money(Number(product.oldPrice))}</p>
                )}
                <p className="font-extrabold text-white leading-none drop-shadow" style={{ fontSize: cardFs.price }}>
                  {money(displayPrice)}<span className="font-normal text-white/75 mr-0.5" style={{ fontSize: tk.fs.xs }}>د.ع</span>
                </p>
                {cartUnit && cartUnit !== "PIECE" && (
                  <p className="text-white/75 leading-none mt-0.5" style={{ fontSize: tk.fs.xs }}>للـ{UNIT_LABELS[cartUnit]}</p>
                )}
              </>
            )}
            {outOfStock && <span className="rounded-full bg-red-500 px-2 py-0.5 font-bold text-white" style={{ fontSize: tk.fs.xs }}>نفد</span>}
            {showStock && !outOfStock && (
              lowStock ? (
                <span className="mt-1 inline-block rounded-full px-2 py-0.5 font-extrabold text-white"
                  style={{ background: "#dc2626", fontSize: tk.fs.xs }}>
                  ⚠ تبقى {cartonsLeft} كارتون
                </span>
              ) : (
                <p className="leading-none mt-1 font-semibold" style={{ color: "rgba(255,255,255,0.75)", fontSize: tk.fs.xs }}>
                  {money(cartonsLeft)} كرتون
                </p>
              )
            )}
          </div>

          {/* +/- controls */}
          <div className="flex items-center gap-1">
            {qtyInCart > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemoveOne() }}
                className="flex h-7 w-7 items-center justify-center rounded-full shadow-md active:scale-90 transition-transform"
                style={{ background: "rgba(255,255,255,0.92)" }}>
                <Minus className="h-3.5 w-3.5" style={{ color: tk.text }} />
              </button>
            )}
            <button
              disabled={outOfStock || !canAddMore}
              onClick={(e) => { e.stopPropagation(); handleAddPress() }}
              className="flex h-9 w-9 items-center justify-center rounded-full shadow-lg active:scale-90 transition-transform disabled:opacity-50"
              style={{ background: tk.accent }}>
              <Plus className="h-5 w-5 text-white" />
            </button>
          </div>
        </div>
      </div>

      {/* Name — two lines so long product names stay readable */}
      <div className="px-2.5 py-2">
        <p onClick={onOpen} className="line-clamp-2 cursor-pointer font-bold leading-snug" style={{ color: tk.text, fontSize: cardFs.name }}>{product.name}</p>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   CART OVERLAY
══════════════════════════════════════════════════════════════════════ */
function CartOverlay({
  cart, allowPrices, subtotal, notes, onNotes, onChangeQty, onChangeUnit, onRemove,
  onClose, onSubmit, isPending, submitted, isError, tk,
  promoCode, onPromoCode, promoResult, promoError, promoLoading, onApplyPromo,
  promoDiscount, finalTotal, hasFreeDelivery, onClearPromo, deliveryLine = null, firstOrderCoupon = null,
  guestMode, guestName, guestPhone, guestAddress, guestProvince,
  onGuestName, onGuestPhone, onGuestAddress, onGuestProvince, onSignIn,
  orderTiers,
}: {
  cart: CartLine[]; allowPrices: boolean; subtotal: number; notes: string
  onNotes: (v: string) => void; onChangeQty: (id: string, d: number) => void
  onChangeUnit: (id: string, u: CatalogUnit) => void; onRemove: (id: string) => void
  onClose: () => void; onSubmit: () => void; isPending: boolean; submitted: string | null; isError: boolean
  tk: ThemeTokens
  promoCode: string; onPromoCode: (v: string) => void
  promoResult: { code: string; type: string; value: number | null; description: string | null } | null
  promoError: string; promoLoading: boolean; onApplyPromo: () => void
  promoDiscount: number; finalTotal: number; hasFreeDelivery: boolean; onClearPromo: () => void
  deliveryLine?: string | null
  firstOrderCoupon?: { code: string; percent: number; expiresAt: string } | null
  guestMode?: boolean
  guestName?: string; guestPhone?: string; guestAddress?: string; guestProvince?: string
  onGuestProvince?: (v: string) => void
  onSignIn: () => void
  onGuestName?: (v: string) => void; onGuestPhone?: (v: string) => void; onGuestAddress?: (v: string) => void
  orderTiers?: Array<{ minTotal: number; freeDelivery: boolean; discountPercent: number }>
}) {
  // The details step, opened by the submit button rather than sitting in the
  // cart. Closing it returns to the basket with everything typed still there.
  const [detailsStep, setDetailsStep] = useState(false)
  const guestDetailsMissing = Boolean(guestMode) && (
    !guestName?.trim() ||
    (guestPhone?.replace(/\D/g, "").length ?? 0) < 7 ||
    !guestProvince?.trim()
  )
  const tier = resolveCartTier(subtotal, orderTiers)
  return (
    <>
      <div className="fixed inset-0 z-[140] bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="sheet-enter fixed inset-x-0 bottom-0 z-[145] flex max-h-[92vh] flex-col rounded-t-3xl shadow-2xl lg:inset-y-0 lg:right-0 lg:left-auto lg:w-[420px] lg:rounded-none"
        style={{ background: tk.cardBg }} dir="rtl">
        <div className="flex justify-center pt-3 pb-1 lg:hidden">
          <div className="h-1 w-10 rounded-full" style={{ background: tk.divider }} />
        </div>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${tk.divider}` }}>
          <h2 className="flex items-center gap-2 font-extrabold" style={{ color: tk.text, fontSize: tk.fs.lg }}>
            <ShoppingCart className="h-5 w-5" style={{ color: tk.accent }} />
            سلة التسوق
            {cart.length > 0 && (
              <span className="rounded-full px-2 py-0.5 font-bold" style={{ background: tk.accentLight, color: tk.accent, fontSize: tk.fs.xs }}>
                {cart.reduce((s, l) => s + l.quantity, 0)} مادة
              </span>
            )}
          </h2>
          <button onClick={onClose} className="rounded-xl p-2 transition" style={{ background: tk.catIdle }}>
            <X className="h-5 w-5" style={{ color: tk.subtext }} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {submitted ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full" style={{ background: tk.accentLight }}>
                <CheckCircle2 className="h-8 w-8" style={{ color: tk.accent }} />
              </div>
              <p className="font-extrabold" style={{ color: tk.text, fontSize: tk.fs.xl }}>تم إرسال الطلب!</p>
              <p style={{ color: tk.subtext, fontSize: tk.fs.md }}>
                {guestMode
                  ? "سيتم التواصل معك على رقمك وإرسال فاتورتك بعد تجهيز الطلب."
                  : "طلبك ينتظر موافقة الإدارة. سيتم التواصل معك قريباً."}
              </p>
              <button onClick={onClose} className="mt-2 rounded-xl px-6 py-2.5 text-sm font-bold text-white" style={{ background: tk.accent }}>
                متابعة التسوق
              </button>
            </div>
          ) : cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <ShoppingBag className="h-12 w-12" style={{ color: tk.subtext, opacity: 0.3 }} />
              <p className="font-semibold" style={{ color: tk.subtext }}>السلة فارغة</p>
              <button onClick={onClose} className="text-sm font-semibold underline" style={{ color: tk.accent }}>تصفح المنتجات</button>
            </div>
          ) : (
            <div className="space-y-3">
              {cart.map((line) => (
                <CartItem key={line.id} line={line} allowPrices={allowPrices} onChangeQty={onChangeQty} onChangeUnit={onChangeUnit} onRemove={onRemove} tk={tk} />
              ))}
            </div>
          )}
        </div>

        {!submitted && cart.length > 0 && (
          <div className="space-y-3 px-4 py-4" style={{ borderTop: `1px solid ${tk.divider}`, background: tk.pillBg }}>
            <input value={notes} onChange={(e) => onNotes(e.target.value)}
              placeholder="ملاحظات إضافية (اختياري)"
              className="w-full rounded-xl px-4 py-2.5 text-sm outline-none transition"
              style={{ background: tk.cardBg, color: tk.text, border: `1px solid ${tk.divider}` }} />

            {/* ── «عروض القائمة»: what this basket has earned, and what one
                   more carton would earn. Hidden when the shop runs no offers
                   and when prices are — showing a dinar target to someone who
                   cannot see prices is just noise. ── */}
            {allowPrices && (tier.reached || tier.next) && (
              <div className="rounded-xl px-3 py-2.5" style={{ background: tk.accentLight }}>
                {tier.reached && (
                  <p className="font-bold" style={{ color: tk.accent, fontSize: tk.fs.sm }}>
                    🎉 {tier.freeDelivery ? "توصيل مجاني" : ""}
                    {tier.freeDelivery && tier.discountPercent > 0 ? " + " : ""}
                    {tier.discountPercent > 0 ? `خصم ${tier.discountPercent}% (${money(tier.discountAmount)} د.ع)` : ""}
                  </p>
                )}
                {tier.next && (
                  <>
                    <p className="mt-0.5" style={{ color: tk.text, fontSize: tk.fs.xs }}>
                      باقي <span className="font-extrabold">{money(tier.remaining)}</span> د.ع وتحصل على
                      {tier.next.freeDelivery && !tier.freeDelivery ? " توصيل مجاني" : ""}
                      {tier.next.freeDelivery && !tier.freeDelivery && tier.next.discountPercent > 0 ? " و" : ""}
                      {tier.next.discountPercent > 0 ? ` خصم ${tier.next.discountPercent}%` : ""}
                    </p>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full" style={{ background: tk.divider }}>
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${Math.round(tier.progress * 100)}%`, background: tk.accent }} />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Promo code — not available for anonymous guests (no account to attach it to) */}
            {!guestMode && (promoResult ? (
              <div className="flex items-center justify-between rounded-xl px-3 py-2.5"
                style={{ background: "#d1fae5", border: "1px solid #6ee7b7" }}>
                <div>
                  <p className="text-xs font-bold text-emerald-800">✓ كود الخصم: {promoResult.code}</p>
                  <p className="text-xs text-emerald-700">
                    {promoResult.type === "FREE_DELIVERY" ? "توصيل مجاني" : `خصم ${money(promoDiscount)} د.ع`}
                    {promoResult.description ? ` — ${promoResult.description}` : ""}
                  </p>
                </div>
                <button onClick={onClearPromo} className="rounded-lg p-1 text-emerald-500 hover:text-red-500">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  value={promoCode}
                  onChange={(e) => onPromoCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && onApplyPromo()}
                  placeholder="كود خصم (اختياري)"
                  dir="ltr"
                  className="flex-1 rounded-xl px-3 py-2.5 text-sm font-mono uppercase tracking-widest outline-none transition"
                  style={{ background: tk.cardBg, color: tk.text, border: `1px solid ${tk.divider}` }}
                />
                <button onClick={onApplyPromo} disabled={!promoCode.trim() || promoLoading}
                  className="shrink-0 rounded-xl px-3 py-2.5 text-xs font-bold text-white transition disabled:opacity-40"
                  style={{ background: tk.accent }}>
                  {promoLoading ? "..." : "تطبيق"}
                </button>
              </div>
            ))}
            {!guestMode && promoError && <p className="text-xs text-red-600">{promoError}</p>}

            {/* بند ٧ — كوبون أول طلب النشط، لو موجود (غير متاح للضيوف). */}
            {firstOrderCoupon && (
              <div className="flex items-center justify-between gap-2 rounded-xl px-3 py-2.5" style={{ background: "#fef3c7", border: "1px solid #fbbf24" }}>
                <div className="min-w-0">
                  <p className="truncate text-xs font-extrabold text-amber-900">🎁 كوبونك: {firstOrderCoupon.code} — خصم {firstOrderCoupon.percent}%</p>
                  <p className="text-[11px] text-amber-700">استخدمه بخانة كود الخصم قبل ما ينتهي</p>
                </div>
                <OfferCountdown endsAt={firstOrderCoupon.expiresAt} tk={tk} size="sm" />
              </div>
            )}

            {/* بند ٤ — جملة توصيل واحدة حسب محافظة الزبون (غير متاحة للضيوف والزبائن بلا محافظة مسجّلة) */}
            {deliveryLine && (
              <p className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: tk.accentLight, color: tk.accent }}>
                🚚 {deliveryLine}
              </p>
            )}

            {/* Totals */}
            {allowPrices && (
              <div className="space-y-1.5 rounded-xl px-3 py-2.5" style={{ background: tk.cardBg, border: `1px solid ${tk.divider}` }}>
                <div className="flex justify-between text-sm" style={{ color: tk.subtext }}>
                  <span>المجموع الفرعي</span>
                  <span>{money(subtotal)} د.ع</span>
                </div>
                {promoDiscount > 0 && (
                  <div className="flex justify-between text-sm text-emerald-700">
                    <span>الخصم</span>
                    <span>- {money(promoDiscount)} د.ع</span>
                  </div>
                )}
                {hasFreeDelivery && (
                  <div className="flex justify-between text-sm text-blue-600">
                    <span>التوصيل</span>
                    <span>مجاني</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-2 font-extrabold" style={{ borderColor: tk.divider, color: tk.text, fontSize: tk.fs.lg }}>
                  <span>الإجمالي</span>
                  <span style={{ color: tk.accent }}>{money(finalTotal)} د.ع</span>
                </div>
              </div>
            )}

            {isError && <p className="text-xs text-red-600">تعذر إرسال الطلب. حاول مرة أخرى.</p>}
            {/* The cart stays a cart. Asking for a name and a phone beside the
                basket made the shopper read a form before they had decided to
                order at all — the details come after the decision, not before
                it. */}
            <button disabled={isPending} onClick={() => (guestMode ? setDetailsStep(true) : onSubmit())}
              className="w-full py-4 font-extrabold text-white transition active:scale-95 disabled:opacity-50"
              style={{ background: tk.accent, borderRadius: tk.radiusLg, boxShadow: tk.shadowMd, fontSize: tk.fs.lg }}>
              {isPending ? "جاري الإرسال..." : "إرسال الطلب للمراجعة ✓"}
            </button>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════
          «بياناتك» — the step after the decision, not before it.

          These fields used to sit in the cart itself, so a shopper reading
          their basket was reading a form at the same time. Now the submit
          button opens this, the basket total is repeated at the top so they
          still know what they are agreeing to, and «رجوع» returns to the cart
          with everything they typed still in it.
      ══════════════════════════════════════════════════════════════ */}
      {detailsStep && !submitted && (
        <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center"
          dir="rtl" onClick={() => setDetailsStep(false)}>
          <div className="max-h-[92vh] w-full max-w-[600px] overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl"
            style={{ background: tk.cardBg }} onClick={(e) => e.stopPropagation()}>

            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-extrabold" style={{ color: tk.text, fontSize: tk.fs.lg }}>بياناتك</p>
                <p style={{ color: tk.subtext, fontSize: tk.fs.xs }}>حتى نتواصل وياك ونوصّل طلبك</p>
              </div>
              <button onClick={() => setDetailsStep(false)} className="shrink-0 rounded-xl p-2" style={{ background: tk.catIdle }}>
                <X className="h-5 w-5" style={{ color: tk.subtext }} />
              </button>
            </div>

            {/* What they are agreeing to, repeated — the basket is behind this. */}
            <div className="mt-3 flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: tk.pillBg }}>
              <span style={{ color: tk.subtext, fontSize: tk.fs.xs }}>{cart.length} مادة</span>
              {allowPrices && (
                <span className="font-extrabold" style={{ color: tk.accent, fontSize: tk.fs.md }}>
                  {money(finalTotal)} د.ع
                </span>
              )}
            </div>

            <button onClick={onSignIn}
              className="mt-3 w-full text-center font-bold underline underline-offset-2"
              style={{ color: tk.accent, fontSize: tk.fs.xs }}>
              عندك حساب؟ سجّل دخول
            </button>

            <div className="mt-3 space-y-2">
              <input value={guestName ?? ""} onChange={(e) => onGuestName?.(e.target.value)}
                placeholder="اسمك الكامل" dir="rtl" autoFocus
                className="w-full rounded-xl px-3 py-3 text-sm outline-none transition"
                style={{ background: tk.bg, color: tk.text, border: `1px solid ${tk.divider}` }} />
              <input value={guestPhone ?? ""} onChange={(e) => onGuestPhone?.(e.target.value)}
                placeholder="رقم هاتفك" type="tel" inputMode="tel" dir="ltr"
                className="w-full rounded-xl px-3 py-3 text-sm outline-none transition"
                style={{ background: tk.bg, color: tk.text, border: `1px solid ${tk.divider}` }} />
              <select value={guestProvince ?? ""} onChange={(e) => onGuestProvince?.(e.target.value)}
                dir="rtl"
                className="w-full rounded-xl px-3 py-3 text-sm outline-none transition"
                style={{ background: tk.bg, color: guestProvince ? tk.text : tk.subtext, border: `1px solid ${tk.divider}` }}>
                <option value="">اختر المحافظة</option>
                {IRAQI_GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <input value={guestAddress ?? ""} onChange={(e) => onGuestAddress?.(e.target.value)}
                placeholder="العنوان (اختياري)" dir="rtl"
                className="w-full rounded-xl px-3 py-3 text-sm outline-none transition"
                style={{ background: tk.bg, color: tk.text, border: `1px solid ${tk.divider}` }} />
            </div>

            {isError && <p className="mt-2 text-xs text-red-600">تعذر إرسال الطلب. حاول مرة أخرى.</p>}
            {guestDetailsMissing && (
              <p className="mt-2" style={{ color: tk.subtext, fontSize: tk.fs.xs }}>
                الاسم والرقم والمحافظة مطلوبة لإتمام الطلب.
              </p>
            )}

            <button
              disabled={isPending || guestDetailsMissing}
              onClick={onSubmit}
              className="mt-3 w-full py-4 font-extrabold text-white transition active:scale-95 disabled:opacity-50"
              style={{ background: tk.accent, borderRadius: tk.radiusLg, boxShadow: tk.shadowMd, fontSize: tk.fs.lg }}>
              {isPending ? "جاري الإرسال..." : "أكّد وأرسل الطلب ✓"}
            </button>
            <button onClick={() => setDetailsStep(false)}
              className="mt-2 w-full py-3 font-bold transition active:scale-95"
              style={{ background: tk.catIdle, color: tk.catIdleText, borderRadius: tk.radiusMd, fontSize: tk.fs.sm }}>
              رجوع للسلة
            </button>
          </div>
        </div>
      )}
    </>
  )
}

/* ── Cart Item ─────────────────────────────────────────────────────── */
function CartItem({
  line, allowPrices, onChangeQty, onChangeUnit, onRemove, tk,
}: {
  line: CartLine; allowPrices: boolean
  onChangeQty: (id: string, d: number) => void; onChangeUnit: (id: string, u: CatalogUnit) => void
  onRemove: (id: string) => void; tk: ThemeTokens
}) {
  const unitPcs = pcs(line.product, line.unit)
  const unitPriceVal = linePrice(line.product, line.unit)
  const totalPcs = unitPcs * line.quantity

  return (
    <div className="rounded-2xl p-3" style={{ background: tk.bg, border: `1px solid ${tk.cardBorder}` }}>
      <div className="flex gap-3">
        <MiniThumb product={line.product} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate font-bold" style={{ color: tk.text, fontSize: tk.fs.md }}>
              {line.isSample && (
                <span className="ml-1.5 rounded-full px-2 py-0.5 font-bold"
                  style={{ background: tk.accentLight, color: tk.accent, fontSize: tk.fs.xs }}>
                  عيّنة
                </span>
              )}
              {line.product.name}
            </p>
            <button onClick={() => onRemove(line.id)} className="shrink-0 transition hover:scale-110">
              <Trash2 className="h-4 w-4 text-red-400" />
            </button>
          </div>
          {/* Unit badge */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full px-2 py-0.5 font-bold" style={{ background: tk.accentLight, color: tk.accent, fontSize: tk.fs.xs }}>
              {UNIT_LABELS[line.unit]}
            </span>
            <span style={{ color: tk.subtext, fontSize: tk.fs.xs }}>
              {unitPcs > 1 ? `${unitPcs} قطعة/وحدة` : "قطعة"}
            </span>
            {allowPrices && (
              <span className="font-semibold" style={{ color: tk.subtext, fontSize: tk.fs.xs }}>
                · {money(unitPriceVal)} د.ع/وحدة
              </span>
            )}
          </div>
          {allowPrices && (
            <p className="mt-1 font-extrabold" style={{ color: tk.accent, fontSize: tk.fs.md }}>
              {line.quantity} وحدة × {money(unitPriceVal)} = {money(unitPriceVal * line.quantity)} د.ع
              {unitPcs > 1 && <span className="mr-1 font-normal" style={{ color: tk.subtext, fontSize: tk.fs.xs }}>({money(totalPcs)} قطعة إجمالاً)</span>}
            </p>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        {/* Unit switcher */}
        <div className="flex gap-1 flex-wrap">
          {unitsFor().map((u) =>
            maxQty(line.product, u) > 0 ? (
              <button key={u} onClick={() => onChangeUnit(line.id, u)}
                className="rounded-lg px-2.5 py-1 font-bold transition"
                style={u === line.unit
                  ? { background: tk.accent, color: tk.accentText, fontSize: tk.fs.xs }
                  : { background: tk.catIdle, color: tk.catIdleText, fontSize: tk.fs.xs }}>
                {UNIT_LABELS[u]}
              </button>
            ) : null
          )}
        </div>
        {/* Qty controls */}
        <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: tk.catIdle }}>
          <button onClick={() => onChangeQty(line.id, -1)} className="flex h-6 w-6 items-center justify-center rounded-lg bg-white shadow-sm active:scale-90">
            <Minus className="h-3 w-3" style={{ color: tk.text }} />
          </button>
          <span className="min-w-[1.5rem] text-center font-extrabold" style={{ color: tk.text, fontSize: tk.fs.md }}>{line.quantity}</span>
          <button onClick={() => onChangeQty(line.id, 1)} disabled={line.quantity >= maxQty(line.product, line.unit)}
            className="flex h-6 w-6 items-center justify-center rounded-lg shadow-sm disabled:opacity-40 active:scale-90"
            style={{ background: tk.accent }}>
            <Plus className="h-3 w-3 text-white" />
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Thumbnail ─────────────────────────────────────────────────────── */
function MiniThumb({ product, size = "sm" }: { product: PublicCatalogProduct; size?: "sm" | "lg" }) {
  const cls = size === "lg" ? "h-14 w-14 rounded-xl" : "h-9 w-9 rounded-lg"
  const src = product.thumbnailUrl || product.imageUrl
  return src ? (
    <img src={src} alt="" className={cn("shrink-0 object-cover", cls)} loading="lazy" decoding="async" />
  ) : (
    <div className={cn("shrink-0 flex items-center justify-center bg-gray-100 text-gray-300", cls)}>
      <ImageIcon className={size === "lg" ? "h-5 w-5" : "h-3.5 w-3.5"} />
    </div>
  )
}
