import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"
import { api, API_BASE_URL } from "../api/client"
import {
  Check,
  CheckCircle2,
  ChevronLeft,
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
  ShoppingBag,
  ShoppingCart,
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
  EMPTY_CATALOG_FOOTER,
  type CatalogFooter,
} from "../api/endpoints"
import type { CatalogStockFilter, PublicCatalogProduct } from "../types/api"
import { cn } from "../utils/cn"

/* ─── Types ─────────────────────────────────────────────────────────── */
type CatalogUnit = "PIECE" | "DOZEN" | "BOX" | "CARTON"
type CartLine = { id: string; product: PublicCatalogProduct; unit: CatalogUnit; quantity: number }
type Theme = "clean" | "warm" | "dark" | "vibrant"
type SortKey = "default" | "cheap" | "expensive" | "new"
type ViewMode = "grid" | "list"
type FontScale = "sm" | "md" | "lg" | "xl"
type FsKey = "xs" | "sm" | "md" | "lg" | "xl" | "xxl"
type AccentKey =
  | "emerald" | "teal" | "blue" | "indigo" | "violet"
  | "rose" | "red" | "orange" | "amber" | "slate"

const storageKey = "inventory_catalog_access"
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
const unitsFor = (product: PublicCatalogProduct): CatalogUnit[] => {
  const hidden = new Set(product.hiddenUnits ?? [])
  return UNITS.filter((u) => u === "PIECE" || !hidden.has(u as "DOZEN" | "BOX" | "CARTON"))
}
// UNITS is ascending PIECE→CARTON, so the last allowed entry is the largest
// bulk unit this product can actually be sold in — CARTON when it isn't
// hidden, otherwise the next best thing. PIECE is never hideable, so this
// is never empty.
const defaultUnitFor = (product: PublicCatalogProduct): CatalogUnit => {
  const allowed = unitsFor(product)
  return allowed[allowed.length - 1] ?? "PIECE"
}

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
  default: "الافتراضي", cheap: "الأرخص", expensive: "الأغلى", new: "الجديد أولاً",
}

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
// carton. Products with pcsPerCarton ≤ 0 (or no carton size) never qualify.
const hasFullCarton = (product: PublicCatalogProduct) =>
  product.pcsPerCarton >= 1 && product.currentStock >= product.pcsPerCarton

const key = (productId: string, unit: CatalogUnit) => `${productId}:${unit}`

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
    queryFn: () => api.get("/public/catalog/design").then(r => (r.data as { data?: { guestModeEnabled?: boolean } }).data ?? {}),
    enabled: !accessToken,
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (sessionQuery.isError) clearAccess()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionQuery.isError])

  if (!accessToken) {
    if (guestConfigQuery.isLoading)
      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50" dir="rtl">
          <div className="flex flex-col items-center gap-3 text-gray-400">
            <ShoppingBag className="h-10 w-10 animate-pulse" />
            <p className="text-sm font-medium">جاري فتح المتجر...</p>
          </div>
        </div>
      )
    if (guestConfigQuery.data?.guestModeEnabled) {
      return (
        <GuestPhoneGate>
          <CatalogShop
            accessToken="" allowPrices={false} showStock stockFilter="FULL_CARTON_ONLY"
            customerId="" customerName="" customerPhone="" guestMode
          />
        </GuestPhoneGate>
      )
    }
    return <CatalogGate onAccess={handleAccess} />
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

  if (!sessionQuery.data) return <CatalogGate onAccess={handleAccess} />

  const { customer, allowPrices, showStock, stockFilter, needsOtp } = sessionQuery.data

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
type GateStep = "phone" | "otp" | "details" | "check"

function CatalogGate({ onAccess }: { onAccess: (token: string) => void }) {
  const [step, setStep] = useState<GateStep>("phone")
  const [phone, setPhone] = useState("")
  const [otp, setOtp] = useState("")
  const [name, setName] = useState("")
  const [address, setAddress] = useState("")
  const [notes, setNotes] = useState("")
  const [msg, setMsg] = useState("")

  const sendOtpMut = useMutation({
    mutationFn: async () => {
      const status = await getCatalogAccessStatus(phone.trim())
      // The backend only returns a token when this phone has already proved
      // ownership via OTP, or when the merchant has turned OTP off entirely.
      // Anything else falls through to the OTP step below. Never treat
      // `approved` alone as permission to skip — knowing a customer's phone
      // number is not authentication.
      if (status?.approved && status.token) return { skip: true, token: status.token }
      await sendCatalogOtp(phone.trim())
      return { skip: false, token: null }
    },
    onSuccess: (result) => {
      setMsg("")
      if (result.skip && result.token) onAccess(result.token)
      else setStep("otp")
    },
    onError: () => setMsg("تعذر إرسال الرمز. تأكد من الرقم وحاول مرة ثانية."),
  })

  const verifyOtpMut = useMutation({
    // Verifying is now the ONLY way an already-approved customer gets their
    // access token: the status lookup deliberately withholds it until the phone
    // has proved ownership. So re-check status right after verifying — an
    // existing customer goes straight into the catalog, and only a genuinely
    // new phone falls through to the access-request form.
    mutationFn: async () => {
      await verifyCatalogOtp(phone.trim(), otp.trim())
      return getCatalogAccessStatus(phone.trim())
    },
    onSuccess: (status) => {
      setMsg("")
      if (status?.approved && status.token) onAccess(status.token)
      else setStep("details")
    },
    onError: () => setMsg("الرمز غير صحيح أو انتهت صلاحيته."),
  })

  const requestMut = useMutation({
    mutationFn: () => requestCatalogAccess({ customerName: name.trim(), phone: phone.trim(), address: address.trim() || undefined, notes: notes.trim() || undefined }),
    onSuccess: () => { setMsg("تم إرسال طلبك! انتظر موافقة الإدارة ثم اضغط «فحص الموافقة»."); setStep("check") },
    onError: () => setMsg("تعذر إرسال الطلب. حاول مرة ثانية."),
  })

  const checkMut = useMutation({
    mutationFn: () => getCatalogAccessStatus(phone.trim()),
    onSuccess: (s) => s?.approved && s.token ? onAccess(s.token) : setMsg("طلبك لم يُوافق عليه بعد، حاول لاحقاً."),
  })

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-teal-50 px-4 py-8" dir="rtl">
      <div className="mb-6 flex flex-col items-center gap-2">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 shadow-lg shadow-emerald-200">
          <ShoppingBag className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-xl font-extrabold text-gray-900">كتالوج المنتجات</h1>
        <p className="text-sm text-gray-500">تصفح واطلب بكل سهولة</p>
      </div>

      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl shadow-gray-100 ring-1 ring-gray-100">
        {step === "phone" && (
          <div className="space-y-4">
            <div className="text-center">
              <p className="font-semibold text-gray-800">أدخل رقم هاتفك</p>
              <p className="mt-1 text-xs text-gray-500">سنرسل رمز تحقق عبر الواتساب</p>
            </div>
            <Field icon="📱" placeholder="07xxxxxxxx" value={phone} onChange={setPhone} type="tel" />
            <button
              disabled={phone.trim().length < 9 || sendOtpMut.isPending}
              onClick={() => sendOtpMut.mutate()}
              className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white shadow-md shadow-emerald-100 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sendOtpMut.isPending ? "جاري الإرسال..." : "إرسال رمز التحقق"}
            </button>
            <button onClick={() => setStep("check")} className="w-full text-center text-xs text-emerald-600 hover:underline">
              لدي طلب سابق — فحص الموافقة
            </button>
          </div>
        )}

        {step === "otp" && (
          <div className="space-y-4">
            <div className="text-center">
              <p className="font-semibold text-gray-800">أدخل رمز التحقق</p>
              <p className="mt-1 text-xs text-gray-500">أُرسل إلى {phone} عبر الواتساب</p>
            </div>
            <input
              type="text" inputMode="numeric" maxLength={6}
              value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-center text-2xl font-bold tracking-widest outline-none focus:border-emerald-400 focus:bg-white"
              dir="ltr"
            />
            <button
              disabled={otp.length < 4 || verifyOtpMut.isPending}
              onClick={() => verifyOtpMut.mutate()}
              className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white shadow-md transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {verifyOtpMut.isPending ? "جاري التحقق..." : "تحقق"}
            </button>
            <button onClick={() => { setStep("phone"); setOtp(""); setMsg("") }} className="w-full text-center text-xs text-gray-400 hover:underline">
              ← تغيير الرقم
            </button>
          </div>
        )}

        {step === "details" && (
          <div className="space-y-3">
            <div className="text-center mb-2">
              <p className="font-semibold text-gray-800">أكمل بياناتك</p>
              <p className="mt-1 text-xs text-emerald-600">✓ تم التحقق من {phone}</p>
            </div>
            <Field icon="👤" placeholder="الاسم الكامل" value={name} onChange={setName} />
            <Field icon="📍" placeholder="العنوان (اختياري)" value={address} onChange={setAddress} />
            <Field icon="📝" placeholder="ملاحظات (اختيارية)" value={notes} onChange={setNotes} />
            <button
              disabled={name.trim().length < 2 || requestMut.isPending}
              onClick={() => requestMut.mutate()}
              className="mt-2 w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white shadow-md shadow-emerald-100 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {requestMut.isPending ? "جاري الإرسال..." : "إرسال طلب الدخول"}
            </button>
          </div>
        )}

        {step === "check" && (
          <div className="space-y-3">
            <div className="text-center mb-2">
              <p className="font-semibold text-gray-800">فحص حالة الطلب</p>
            </div>
            <Field icon="📱" placeholder="رقم الهاتف المسجل" value={phone} onChange={setPhone} type="tel" />
            <button
              disabled={phone.trim().length < 5 || checkMut.isPending}
              onClick={() => checkMut.mutate()}
              className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white shadow-md shadow-emerald-100 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checkMut.isPending ? "جاري الفحص..." : "فحص الموافقة"}
            </button>
            <button onClick={() => { setStep("phone"); setMsg("") }} className="w-full text-center text-xs text-emerald-600 hover:underline">
              ← طلب جديد
            </button>
          </div>
        )}

        {msg && (
          <div className={cn(
            "mt-4 rounded-xl px-4 py-3 text-sm border",
            msg.includes("تعذر") || msg.includes("غير صحيح") || msg.includes("لم يُوافق")
              ? "bg-red-50 text-red-700 border-red-100"
              : "bg-emerald-50 text-emerald-800 border-emerald-100"
          )}>
            {msg}
          </div>
        )}
      </div>
    </div>
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

/* ══════════════════════════════════════════════════════════════════════
   GUEST PHONE GATE (guest mode only — asked once per device)
   A visitor must enter their phone number before browsing. The number is
   recorded server-side (with a visit counter) so the merchant can follow up.
══════════════════════════════════════════════════════════════════════ */
const GUEST_PHONE_KEY = "catalog_guest_phone"

function GuestPhoneGate({ children }: { children: React.ReactNode }) {
  const [entered, setEntered] = useState<boolean>(() => Boolean(localStorage.getItem(GUEST_PHONE_KEY)))
  const [phone, setPhone] = useState("")
  const [err, setErr] = useState("")

  const enterMut = useMutation({
    mutationFn: () => guestCatalogEnter(phone.trim()),
    onSuccess: () => {
      localStorage.setItem(GUEST_PHONE_KEY, phone.trim())
      setErr("")
      setEntered(true)
    },
    onError: () => setErr("تعذر الحفظ. تأكد من الرقم وحاول مرة ثانية."),
  })

  if (entered) return <>{children}</>

  const digits = phone.replace(/\D/g, "")
  const valid = digits.length >= 10

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4" dir="rtl">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg">
        <div className="mb-5 flex flex-col items-center gap-2 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50">
            <ShoppingBag className="h-7 w-7 text-indigo-600" />
          </div>
          <h1 className="text-lg font-bold text-gray-900">أهلاً بك في الكتلوك</h1>
          <p className="text-sm text-gray-500">فضلاً أدخل رقم هاتفك للدخول وتصفح البضاعة</p>
        </div>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && valid && !enterMut.isPending) enterMut.mutate() }}
          inputMode="tel"
          placeholder="07XXXXXXXXX"
          className="w-full rounded-xl border border-gray-300 px-4 py-3 text-center text-base tracking-wide outline-none focus:border-indigo-500"
          dir="ltr"
          autoFocus
        />
        {err && <p className="mt-2 text-center text-xs text-red-600">{err}</p>}
        <button
          disabled={!valid || enterMut.isPending}
          onClick={() => enterMut.mutate()}
          className="mt-4 w-full rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
        >
          {enterMut.isPending ? "جاري الدخول..." : "دخول"}
        </button>
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
  accessToken, allowPrices, showStock, stockFilter, customerId, customerName, customerPhone,
  guestMode = false,
}: {
  accessToken: string; allowPrices: boolean; showStock: boolean; stockFilter: CatalogStockFilter
  customerId: string; customerName: string; customerPhone: string
  guestMode?: boolean
}) {
  // Per-customer display filter: FULL_CARTON_ONLY hides sub-carton products
  // (historical behavior); ALL_PRODUCTS shows everything the backend sent.
  // Ordering is still carton-only either way. Guests are always carton-only.
  const canDisplay = (p: PublicCatalogProduct) =>
    guestMode ? hasFullCarton(p) : stockFilter === "ALL_PRODUCTS" ? p.currentStock > 0 : hasFullCarton(p)
  const productsQuery = useQuery({
    queryKey: guestMode ? ["guest-catalog-products"] : ["public-catalog-products", accessToken],
    queryFn: () => guestMode ? getGuestCatalogProducts() : getPublicCatalogProducts(accessToken),
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
  const visitorPhone = guestMode ? (localStorage.getItem(GUEST_PHONE_KEY) || "") : ""

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
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>("default")
  const [viewMode, setViewMode] = useState<ViewMode>("grid")
  const [perRow, setPerRow] = useState(2)
  const [search, setSearch] = useState("")
  const [activeSugg, setActiveSugg] = useState(0)
  const suggItemRefs = useRef<Record<number, HTMLButtonElement | null>>({})
  const [category, setCategory] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")
  const [cart, setCart] = useState<CartLine[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [notes, setNotes] = useState("")
  const [submitted, setSubmitted] = useState<string | null>(null)
  const [bannerIndex, setBannerIndex] = useState(0)
  const [zoomedImg, setZoomedImg] = useState<{ src: string; name: string } | null>(null)
  const [pickerProduct, setPickerProduct] = useState<PublicCatalogProduct | null>(null)
  const [promoCode, setPromoCode] = useState("")
  const [promoResult, setPromoResult] = useState<{ code: string; type: string; value: number | null; description: string | null } | null>(null)
  const [promoError, setPromoError] = useState("")
  const [promoLoading, setPromoLoading] = useState(false)
  const [guestName, setGuestName] = useState("")
  // Prefilled from the number the shopper already gave GuestPhoneGate — still
  // editable, but they shouldn't have to retype it from scratch (retyping
  // invites a typo/different number, which desyncs the order from the phone
  // all their browsing time/views were tracked under).
  const [guestPhone, setGuestPhone] = useState(() => (guestMode ? localStorage.getItem(GUEST_PHONE_KEY) ?? "" : ""))
  const [guestAddress, setGuestAddress] = useState("")
  const [accessRequestOpen, setAccessRequestOpen] = useState(false)
  const [showTutorial, setShowTutorial] = useState<boolean>(() => !localStorage.getItem(TUTORIAL_SEEN_KEY))
  const searchRef = useRef<HTMLInputElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const bannerTouchX = useRef<number | null>(null)

  const designQuery = useQuery({
    queryKey: ["catalog-design-public"],
    queryFn: () => api.get("/public/catalog/design").then(r => (r.data as { data?: { primaryColor?: string | null; bgColor?: string | null; defaultTheme?: Theme; logoUrl?: string | null; welcomeMessage?: string | null; bannerEnabled?: boolean; bannerImages?: Array<{ url: string; title: string; order: number }>; footer?: Partial<CatalogFooter> } }).data ?? {}),
    staleTime: 5 * 60_000,
  })
  const design = designQuery.data

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
  function resetAppearance() {
    setThemePref(null); localStorage.removeItem(themeKey)
    setAccentPref(null); localStorage.removeItem(accentKey)
    setFontScale("md"); localStorage.removeItem(fontScaleKey)
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
    return sorted
  }, [products, catalogCatsList])

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

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    let result = products.filter((p) => {
      if (!canDisplay(p)) return false
      if (category !== "all") {
        const tags = p.categoryTags ?? []
        const inCat = tags.length > 0 ? tags.includes(category) : p.category === category
        if (!inCat) return false
      }
      if (typeFilter !== "all") {
        const tTags = (p.typeTags ?? []).map(t => t.trim())
        if (tTags.length > 0 && !tTags.includes(typeFilter.trim())) return false
      }
      if (!q) return true
      return [p.name, p.itemNumber, p.category ?? ""].some((s) => s.toLowerCase().includes(q))
    })
    if (sortKey === "cheap") result = [...result].sort((a, b) => Number(a.salePrice ?? 0) - Number(b.salePrice ?? 0))
    else if (sortKey === "expensive") result = [...result].sort((a, b) => Number(b.salePrice ?? 0) - Number(a.salePrice ?? 0))
    else if (sortKey === "new") result = [...result].sort((a, b) => (a.isNewArrival === b.isNewArrival ? 0 : a.isNewArrival ? -1 : 1))
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, search, category, typeFilter, sortKey, stockFilter])

  const suggestions = visible.slice(0, 6)
  const showSections = category === "all" && typeFilter === "all" && !search.trim()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const newArrivals = useMemo(() => products.filter(p => p.isNewArrival && canDisplay(p)).slice(0, 12), [products, stockFilter])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const offers = useMemo(() => products.filter(p => p.isOffer && canDisplay(p)).slice(0, 12), [products, stockFilter])
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
            notes: notes.trim() || undefined,
            items: cart.map(l => ({ productId: l.product.id, unit: l.unit, quantity: l.quantity })),
          })
        : submitPublicCatalogOrder(
            {
              customerName, phone: customerPhone, notes: notes.trim() || undefined,
              items: cart.map(l => ({ productId: l.product.id, unit: l.unit, quantity: l.quantity })),
              promoCode: promoResult?.code,
            },
            accessToken,
          ),
    onSuccess: (r) => { setSubmitted(r.data?.approvalId ?? "ok"); setCart([]); setNotes(""); setPromoResult(null); setPromoCode("") },
  })

  function add(product: PublicCatalogProduct, unit: CatalogUnit = defaultUnitFor(product)) {
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

  // Zoom: show the lightweight thumbnail instantly, then fetch the full-res
  // image in the background and swap it in once it arrives (mirrors the
  // inventory page so the catalog loads fast and images load on tap).
  async function openZoom(product: PublicCatalogProduct) {
    const thumb = product.thumbnailUrl || product.imageUrl
    if (!thumb) return
    void trackCatalogProductView(product.id, visitorPhone)
    setZoomedImg({ src: thumb, name: product.name })
    try {
      const full = guestMode ? await getGuestCatalogProductImage(product.id) : await getPublicCatalogProductImage(accessToken, product.id)
      if (full) setZoomedImg({ src: full, name: product.name })
    } catch {}
  }

  function renderCard(product: PublicCatalogProduct) {
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
        compact={viewMode === "grid" && perRow >= 4}
        onAdd={(unit) => add(product, unit)}
        onRemoveOne={() => firstLine && changeQty(firstLine.id, -1)}
        onOpenPicker={() => setPickerProduct(product)}
        onZoom={() => openZoom(product)}
      />
    )
  }

  /* ── Render ── */
  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: `radial-gradient(circle at top right, ${tk.accent}35 0%, ${tk.accent}55 28%, ${tk.bg} 65%)`, transition: "background 0.3s" }}>
      <div className="mx-auto flex min-h-screen max-w-[600px] flex-col shadow-2xl shadow-slate-950/15" style={{ background: tk.bg }}>

      {/* ── Sticky Header ── */}
      <header className="sticky top-0 z-30 overflow-hidden" style={{ background: `linear-gradient(135deg, ${tk.accent} 0%, ${tk.accent}cc 100%)`, boxShadow: "0 4px 24px rgba(0,0,0,0.22)" }}>
        {/* Decorative circles */}
        <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-sm" />
        <div className="pointer-events-none absolute -bottom-14 left-6 h-28 w-28 rounded-full bg-white/10 blur-md" />

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
                      <MiniThumb product={p} />
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
        </div>

        {/* Row 2: Category tabs */}
        {categories.length > 0 && (
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

        {/* Row 3: Sub-types (when category selected) */}
        {availableTypes.length > 0 && (
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

        {/* Row 4: Sort + View toggle */}
        <div className="relative flex items-center gap-2 px-3 py-2 border-t border-white/15">
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
      </header>

      {/* ── Guest banner: prices hidden until admin grants access ── */}
      {guestMode && (
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

      {/* ── Hero banner (slideshow) ── */}
      {(() => {
        const bannerEnabled = design?.bannerEnabled !== false
        if (!bannerEnabled) return null
        // Admin banner images take priority over product images
        const adminImgs = [...(design?.bannerImages ?? [])].sort((a, b) => a.order - b.order)
        const slides: Array<{ src: string; title: string; subtitle?: string }> =
          adminImgs.length >= 2
            ? adminImgs.map(img => ({ src: img.url, title: img.title || "" }))
            : products.filter(p => (p.thumbnailUrl || p.imageUrl) && canDisplay(p)).slice(0, 8).map(p => ({
                src: (p.thumbnailUrl || p.imageUrl)!, title: p.name,
                subtitle: allowPrices ? `${money(p.salePrice)} د.ع` : undefined,
              }))
        if (slides.length < 2) return null
        const total = slides.length
        const idx = ((bannerIndex % total) + total) % total
        const welcomeMsg = design?.welcomeMessage || (customerName ? `مرحباً ${customerName} 👋` : "مرحباً بك 👋")
        return (
          <div
            className="relative overflow-hidden select-none"
            style={{ height: "190px" }}
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
                <img src={s.src} alt={s.title} className="h-full w-full object-cover" />
                <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.15) 55%, transparent 100%)" }} />
                <div className="absolute bottom-8 right-4 left-4">
                  {s.title && <p className="text-sm font-extrabold text-white drop-shadow-md leading-snug">{s.title}</p>}
                  {s.subtitle && <p className="mt-0.5 text-sm font-bold" style={{ color: "#6ee7b7" }}>{s.subtitle}</p>}
                </div>
              </div>
            ))}
            {/* welcome pill */}
            <div className="absolute right-3 top-3 rounded-full px-3 py-1 text-right" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }}>
              <p className="text-[11px] font-semibold text-white">{welcomeMsg}</p>
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

      {/* ── Main content ── */}
      <main className="-mt-3 flex-1 rounded-t-[28px] px-3 pb-6 pt-4 overflow-hidden" style={{ background: tk.bg }}>

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
        {!productsQuery.isLoading && visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 rounded-full p-5" style={{ background: tk.catIdle }}>
              <Search className="h-8 w-8" style={{ color: tk.subtext }} />
            </div>
            <p className="font-extrabold" style={{ color: tk.text, fontSize: tk.fs.lg }}>لا توجد منتجات مطابقة</p>
            <p className="mt-1" style={{ color: tk.subtext, fontSize: tk.fs.md }}>جرب كلمة بحث مختلفة أو فئة أخرى</p>
          </div>
        )}

        {/* Special rows: عروض + جديد */}
        {!productsQuery.isLoading && showSections && (offers.length > 0 || newArrivals.length > 0) && (
          <div className="mb-5 space-y-5">
            {offers.length > 0 && (
              <section>
                <h2 className="mb-2 flex items-center gap-1.5 font-extrabold" style={{ color: "#e11d48", fontSize: tk.fs.lg }}>
                  🏷️ العروض
                </h2>
                <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                  {offers.map(p => (
                    <div key={p.id} style={{ width: "140px", flexShrink: 0 }}>{renderCard(p)}</div>
                  ))}
                </div>
              </section>
            )}
            {newArrivals.length > 0 && (
              <section>
                <h2 className="mb-2 flex items-center gap-1.5 font-extrabold" style={{ color: tk.accent, fontSize: tk.fs.lg }}>
                  ✨ وصل حديثاً
                </h2>
                <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                  {newArrivals.map(p => (
                    <div key={p.id} style={{ width: "140px", flexShrink: 0 }}>{renderCard(p)}</div>
                  ))}
                </div>
              </section>
            )}
            <div className="flex items-center gap-2 pt-1">
              <div className="h-px flex-1" style={{ background: tk.divider }} />
              <span className="font-bold" style={{ color: tk.subtext, fontSize: tk.fs.sm }}>كل المنتجات</span>
              <div className="h-px flex-1" style={{ background: tk.divider }} />
            </div>
          </div>
        )}

        {/* Products: grid or list */}
        {!productsQuery.isLoading && visible.length > 0 && (
          viewMode === "list" ? (
            <div className="flex flex-col gap-2.5">
              {visible.map(p => renderCard(p))}
            </div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}>
              {visible.map(p => renderCard(p))}
            </div>
          )
        )}
      </main>

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
          guestMode={guestMode}
          guestName={guestName} guestPhone={guestPhone} guestAddress={guestAddress}
          onGuestName={setGuestName} onGuestPhone={setGuestPhone} onGuestAddress={setGuestAddress}
        />
      )}

      {/* ── Guest price-access request modal ── */}
      {guestMode && accessRequestOpen && (
        <GuestAccessRequestModal tk={tk} onClose={() => setAccessRequestOpen(false)} />
      )}

      {/* ── Image lightbox ── */}
      {zoomedImg && (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/95"
          onClick={() => setZoomedImg(null)}>
          <button className="absolute right-4 top-4 rounded-full bg-white/10 p-2.5 transition hover:bg-white/20"
            onClick={() => setZoomedImg(null)}>
            <X className="h-6 w-6 text-white" />
          </button>
          <img src={zoomedImg.src} alt={zoomedImg.name}
            className="max-h-[80vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()} />
          <p className="mt-4 text-center text-sm font-semibold text-white/80 px-4">{zoomedImg.name}</p>
        </div>
      )}

      {/* ── Unit picker sheet ── */}
      {pickerProduct && (
        <UnitPickerSheet
          product={pickerProduct}
          allowPrices={allowPrices}
          showStock={showStock}
          tk={tk}
          onSelect={(unit) => { add(pickerProduct, unit); setPickerProduct(null) }}
          onClose={() => setPickerProduct(null)}
        />
      )}

      {/* ── Appearance: theme + accent colour + text size ── */}
      {appearanceOpen && (
        <AppearanceSheet
          tk={tk}
          theme={theme} accent={accentPref} fontScale={fontScale}
          onTheme={applyTheme} onAccent={applyAccent} onFontScale={applyFontScale}
          onReset={resetAppearance}
          onClose={() => setAppearanceOpen(false)}
        />
      )}

      {/* ── First-visit onboarding tutorial ── */}
      {showTutorial && (
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
   STOREFRONT FOOTER — trust block, filled in from catalog management
══════════════════════════════════════════════════════════════════════ */
const SOCIALS: Array<{ key: keyof CatalogFooter; label: string; icon: string; href: (v: string) => string }> = [
  { key: "instagram", label: "انستغرام", icon: "📷", href: (v) => v.startsWith("http") ? v : `https://instagram.com/${v.replace(/^@/, "")}` },
  { key: "facebook", label: "فيسبوك", icon: "👥", href: (v) => v.startsWith("http") ? v : `https://facebook.com/${v}` },
  { key: "telegram", label: "تيليگرام", icon: "✈️", href: (v) => v.startsWith("http") ? v : `https://t.me/${v.replace(/^@/, "")}` },
  { key: "tiktok", label: "تيك توك", icon: "🎵", href: (v) => v.startsWith("http") ? v : `https://tiktok.com/@${v.replace(/^@/, "")}` },
]

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

  const Row = ({ icon, label, value }: { icon: string; label: string; value: string }) =>
    value ? (
      <div className="flex items-start gap-2">
        <span className="shrink-0 leading-none" style={{ fontSize: tk.fs.md }}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold" style={{ color: tk.subtext, fontSize: tk.fs.xs }}>{label}</span>
          <span className="block font-semibold" style={{ color: tk.text, fontSize: tk.fs.sm }}>{value}</span>
        </span>
      </div>
    ) : null

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
                  <Row icon="☎️" label="الهاتف" value={footer.phone} />
                </a>
              )}
              {footer.whatsapp && (
                <a href={`https://wa.me/${digits(footer.whatsapp)}`} target="_blank" rel="noreferrer noopener"
                  className="block transition active:opacity-70">
                  <Row icon="💬" label="واتساب" value={footer.whatsapp} />
                </a>
              )}
              <Row icon="📍" label="العنوان" value={footer.address} />
              <Row icon="🕐" label="أوقات الدوام" value={footer.hours} />
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
              <Row icon="🗺️" label="مناطق التوصيل" value={footer.deliveryAreas} />
              <Row icon="⏱️" label="مدة التوصيل" value={footer.deliveryTime} />
              <Row icon="🧾" label="أقل مبلغ للطلب" value={footer.minOrder} />
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
  tk, theme, accent, fontScale, onTheme, onAccent, onFontScale, onReset, onClose,
}: {
  tk: ThemeTokens
  theme: Theme
  accent: AccentKey | null
  fontScale: FontScale
  onTheme: (t: Theme) => void
  onAccent: (a: AccentKey) => void
  onFontScale: (f: FontScale) => void
  onReset: () => void
  onClose: () => void
}) {
  const isDark = SURFACES[theme].isDark
  return (
    <>
      <div className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-[160] max-h-[88vh] overflow-y-auto"
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
  product, allowPrices, showStock, tk, onSelect, onClose,
}: {
  product: PublicCatalogProduct; allowPrices: boolean; showStock: boolean
  tk: ThemeTokens; onSelect: (unit: CatalogUnit) => void; onClose: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-[160] rounded-t-3xl shadow-2xl" style={{ background: tk.cardBg }} dir="rtl">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full" style={{ background: tk.divider }} />
        </div>

        {/* Header */}
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
            {showStock && (() => {
              const cartonsAvail = Math.floor(product.currentStock / Math.max(1, product.pcsPerCarton))
              return (
              <p className="text-xs font-semibold" style={{ color: cartonsAvail <= 2 ? "#ef4444" : tk.subtext }}>
                {cartonsAvail <= 2 ? `⚠️ ${cartonsAvail} كارتون متبقي` : `${money(cartonsAvail)} كارتون متوفر`}
              </p>
              )})()}
          </div>
          <button onClick={onClose} className="shrink-0 rounded-xl p-2" style={{ background: tk.catIdle }}>
            <X className="h-5 w-5" style={{ color: tk.subtext }} />
          </button>
        </div>

        {/* Unit options */}
        <div className="p-4 space-y-2.5 pb-8">
          <p className="mb-3 font-bold" style={{ color: tk.subtext, fontSize: tk.fs.sm }}>اختر الوحدة:</p>
          {unitsFor(product).map((u) => {
            const qty = maxQty(product, u)
            const price = linePrice(product, u)
            const disabled = qty < 1
            const pcsCount = pcs(product, u)
            return (
              <button
                key={u}
                disabled={disabled}
                onClick={() => onSelect(u)}
                className="flex w-full items-center gap-3 rounded-2xl p-4 text-right transition active:scale-[0.98] disabled:opacity-35"
                style={{
                  background: disabled ? tk.catIdle : tk.cardBg,
                  border: `2px solid ${disabled ? tk.divider : tk.accent}`,
                  boxShadow: disabled ? "none" : `0 2px 8px ${tk.accent}22`,
                }}
              >
                {/* Unit emoji / icon */}
                <span className="text-2xl">
                  {u === "PIECE" ? "1️⃣" : u === "DOZEN" ? "📦" : u === "BOX" ? "🗂️" : "📫"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold" style={{ color: disabled ? tk.subtext : tk.text, fontSize: tk.fs.lg }}>
                      {UNIT_LABELS[u]}
                    </span>
                    {u === "BOX" && (
                      <span className="rounded-full px-2 py-0.5 font-bold" style={{ background: tk.accentLight, color: tk.accent, fontSize: tk.fs.xs }}>
                        نصف كارتون
                      </span>
                    )}
                  </div>
                  <p style={{ color: tk.subtext, fontSize: tk.fs.sm }}>
                    {UNIT_DESC[u](pcs(product, u))}
                    {showStock && !disabled && ` · متوفر: ${qty} ${UNIT_LABELS[u]}`}
                    {disabled && " · غير متوفر"}
                  </p>
                </div>
                {allowPrices && !disabled && (
                  <div className="text-right">
                    <p className="font-extrabold" style={{ color: tk.accent, fontSize: tk.fs.xl }}>{money(price)}</p>
                    <p style={{ color: tk.subtext, fontSize: tk.fs.xs }}>د.ع / {UNIT_LABELS[u]}</p>
                    {pcsCount > 1 && (
                      <p style={{ color: tk.subtext, fontSize: tk.fs.xs }}>
                        ({money(Math.round(price / pcsCount))} للقطعة)
                      </p>
                    )}
                  </div>
                )}
                {!disabled && (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: tk.accent }}>
                    <Plus className="h-4 w-4 text-white" />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   PRODUCT CARD
══════════════════════════════════════════════════════════════════════ */
function ProductCard({
  product, allowPrices, showStock, qtyInCart, pcsInCart, cartUnit, tk, viewMode, compact,
  onAdd, onRemoveOne, onOpenPicker, onZoom,
}: {
  product: PublicCatalogProduct
  allowPrices: boolean
  showStock: boolean
  qtyInCart: number
  pcsInCart: number
  cartUnit: CatalogUnit | null
  tk: ThemeTokens
  viewMode: ViewMode
  compact: boolean
  onAdd: (unit: CatalogUnit) => void
  onRemoveOne: () => void
  onOpenPicker: () => void
  onZoom: () => void
}) {
  // Prefer the lightweight thumbnail; the full-res image is fetched on zoom.
  const thumbSrc = product.thumbnailUrl || product.imageUrl
  const outOfStock = product.currentStock <= 0
  const lowStock = product.currentStock > 0 && product.currentStock <= 5
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
        <div className="relative h-[76px] w-[76px] shrink-0 overflow-hidden" style={{ background: tk.catIdle, borderRadius: tk.radiusMd }}>
          {thumbSrc ? (
            <img src={thumbSrc} alt={product.name} className="h-full w-full cursor-zoom-in object-cover" loading="lazy" decoding="async" onClick={onZoom} />
          ) : (
            <div className="flex h-full items-center justify-center"><ImageIcon className="h-6 w-6" style={{ color: tk.subtext, opacity: 0.3 }} /></div>
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
            <p className="line-clamp-2 flex-1 font-bold leading-snug" style={{ color: tk.text, fontSize: tk.fs.md }}>{product.name}</p>
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
                <p className="mt-1 font-semibold" style={{ color: lowStock ? "#ef4444" : tk.subtext, fontSize: tk.fs.xs }}>
                  {(() => { const c = Math.floor(product.currentStock / Math.max(1, product.pcsPerCarton)); return lowStock ? `⚠ ${c} كرتون متبقي` : `${money(c)} كرتون متوفر` })()}
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
        <div className="relative aspect-square overflow-hidden" style={{ background: tk.catIdle }}>
          {thumbSrc ? (
            <img src={thumbSrc} alt={product.name} className="h-full w-full cursor-zoom-in object-cover" loading="lazy" decoding="async" onClick={onZoom} />
          ) : (
            <div className="flex h-full items-center justify-center"><ImageIcon className="h-5 w-5" style={{ color: tk.subtext, opacity: 0.3 }} /></div>
          )}
          {outOfStock && <div className="absolute inset-0 bg-white/55 pointer-events-none" />}
          {qtyInCart > 0 && (
            <span className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full font-extrabold text-white ring-1 ring-white/40 shadow" style={{ background: tk.accent, fontSize: tk.fs.xs }}>{qtyInCart}</span>
          )}
          {product.isOffer && <span className="absolute right-0.5 top-0.5 rounded-full bg-rose-500 px-1.5 py-0.5 font-bold text-white" style={{ fontSize: tk.fs.xs }}>عرض</span>}
          {product.isNewArrival && !product.isOffer && <span className="absolute right-0.5 top-0.5 rounded-full px-1.5 py-0.5 font-bold text-white" style={{ background: tk.accent, fontSize: tk.fs.xs }}>جديد</span>}
          {/* Bottom gradient with price + button */}
          <div className="absolute inset-x-0 bottom-0 px-1.5 pb-1.5 pt-9" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, transparent 100%)" }}>
            <div className="flex items-end justify-between">
              <div className="min-w-0">
                <p className="truncate font-bold leading-tight text-white" style={{ fontSize: tk.fs.sm }}>{product.name}</p>
                {allowPrices && !outOfStock && <p className="font-extrabold" style={{ color: "#6ee7b7", fontSize: tk.fs.md }}>{money(displayPrice)} د.ع</p>}
              </div>
              <div className="flex items-center gap-0.5 shrink-0 mr-1">
                {qtyInCart > 0 && (
                  <button onClick={onRemoveOne} className="flex h-5 w-5 items-center justify-center rounded-full active:scale-90" style={{ background: "rgba(255,255,255,0.85)" }}>
                    <Minus className="h-2.5 w-2.5" style={{ color: tk.text }} />
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
          </div>
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
      <div className="relative aspect-square overflow-hidden" style={{ background: tk.catIdle }}>
        {thumbSrc ? (
          <img src={thumbSrc} alt={product.name}
            className="h-full w-full object-cover cursor-zoom-in transition-transform duration-300 hover:scale-105"
            loading="lazy" decoding="async" onClick={onZoom} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ImageIcon className="h-10 w-10" style={{ color: tk.subtext, opacity: 0.2 }} />
          </div>
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
                <p className="font-extrabold text-white leading-none drop-shadow" style={{ fontSize: tk.fs.xxl }}>
                  {money(displayPrice)}<span className="font-normal text-white/75 mr-0.5" style={{ fontSize: tk.fs.xs }}>د.ع</span>
                </p>
                {cartUnit && cartUnit !== "PIECE" && (
                  <p className="text-white/75 leading-none mt-0.5" style={{ fontSize: tk.fs.xs }}>للـ{UNIT_LABELS[cartUnit]}</p>
                )}
              </>
            )}
            {outOfStock && <span className="rounded-full bg-red-500 px-2 py-0.5 font-bold text-white" style={{ fontSize: tk.fs.xs }}>نفد</span>}
            {showStock && !outOfStock && (
              <p className="leading-none mt-1 font-semibold" style={{ color: lowStock ? "#fca5a5" : "rgba(255,255,255,0.75)", fontSize: tk.fs.xs }}>
                {(() => { const c = Math.floor(product.currentStock / Math.max(1, product.pcsPerCarton)); return lowStock ? `⚠ ${c} كرتون متبقي` : `${money(c)} كرتون` })()}
              </p>
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
        <p className="line-clamp-2 font-bold leading-snug" style={{ color: tk.text, fontSize: tk.fs.md }}>{product.name}</p>
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
  promoDiscount, finalTotal, hasFreeDelivery, onClearPromo,
  guestMode, guestName, guestPhone, guestAddress, onGuestName, onGuestPhone, onGuestAddress,
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
  guestMode?: boolean
  guestName?: string; guestPhone?: string; guestAddress?: string
  onGuestName?: (v: string) => void; onGuestPhone?: (v: string) => void; onGuestAddress?: (v: string) => void
}) {
  const guestDetailsMissing = Boolean(guestMode) && (!guestName?.trim() || (guestPhone?.replace(/\D/g, "").length ?? 0) < 7)
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92vh] flex-col rounded-t-3xl shadow-2xl lg:inset-y-0 lg:right-0 lg:left-auto lg:w-[420px] lg:rounded-none"
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
            {guestMode && (
              <div className="space-y-2 rounded-xl p-3" style={{ background: tk.cardBg, border: `1px solid ${tk.divider}` }}>
                <p className="text-xs font-bold" style={{ color: tk.text }}>بياناتك — لإتمام الطلب والتواصل معك</p>
                <input value={guestName ?? ""} onChange={(e) => onGuestName?.(e.target.value)}
                  placeholder="اسمك الكامل" dir="rtl"
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none transition"
                  style={{ background: tk.bg, color: tk.text, border: `1px solid ${tk.divider}` }} />
                <input value={guestPhone ?? ""} onChange={(e) => onGuestPhone?.(e.target.value)}
                  placeholder="رقم هاتفك" type="tel" dir="ltr"
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none transition"
                  style={{ background: tk.bg, color: tk.text, border: `1px solid ${tk.divider}` }} />
                <input value={guestAddress ?? ""} onChange={(e) => onGuestAddress?.(e.target.value)}
                  placeholder="العنوان (اختياري)" dir="rtl"
                  className="w-full rounded-xl px-3 py-2.5 text-sm outline-none transition"
                  style={{ background: tk.bg, color: tk.text, border: `1px solid ${tk.divider}` }} />
              </div>
            )}
            <input value={notes} onChange={(e) => onNotes(e.target.value)}
              placeholder="ملاحظات إضافية (اختياري)"
              className="w-full rounded-xl px-4 py-2.5 text-sm outline-none transition"
              style={{ background: tk.cardBg, color: tk.text, border: `1px solid ${tk.divider}` }} />

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
            {guestDetailsMissing && <p className="text-xs" style={{ color: tk.subtext }}>أدخل اسمك ورقم هاتفك لإتمام الطلب</p>}
            <button disabled={isPending || guestDetailsMissing} onClick={onSubmit}
              className="w-full py-4 font-extrabold text-white transition active:scale-95 disabled:opacity-50"
              style={{ background: tk.accent, borderRadius: tk.radiusLg, boxShadow: tk.shadowMd, fontSize: tk.fs.lg }}>
              {isPending ? "جاري الإرسال..." : "إرسال الطلب للمراجعة ✓"}
            </button>
          </div>
        )}
      </div>
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
            <p className="truncate font-bold" style={{ color: tk.text, fontSize: tk.fs.md }}>{line.product.name}</p>
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
          {unitsFor(line.product).map((u) =>
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
