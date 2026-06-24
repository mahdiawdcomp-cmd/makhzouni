import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"
import { api } from "../api/client"
import {
  CheckCircle2,
  ChevronLeft,
  Grid,
  ImageIcon,
  LayoutList,
  Minus,
  Palette,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react"
import {
  getCatalogAccessStatus,
  getCatalogSession,
  getPublicCatalogProducts,
  requestCatalogAccess,
  sendCatalogOtp,
  verifyCatalogOtp,
  submitPublicCatalogOrder,
  validatePublicPromoCode,
} from "../api/endpoints"
import type { PublicCatalogProduct } from "../types/api"
import { cn } from "../utils/cn"

/* ─── Types ─────────────────────────────────────────────────────────── */
type CatalogUnit = "PIECE" | "DOZEN" | "BOX" | "CARTON"
type CartLine = { id: string; product: PublicCatalogProduct; unit: CatalogUnit; quantity: number }
type Theme = "clean" | "warm" | "dark" | "vibrant"
type SortKey = "default" | "cheap" | "expensive" | "new"
type ViewMode = "grid" | "list"

const storageKey = "inventory_catalog_access"
const themeKey = "catalog_theme"
const UNIT_LABELS: Record<CatalogUnit, string> = { PIECE: "قطعة", DOZEN: "درزن", BOX: "علبة", CARTON: "كارتون" }
const UNIT_DESC: Record<CatalogUnit, (pcsPerCarton: number) => string> = {
  PIECE: () => "قطعة واحدة",
  DOZEN: () => "12 قطعة",
  BOX: (n) => `${Math.ceil(n / 2)} قطعة — نصف كارتون`,
  CARTON: (n) => `${n} قطعة`,
}
const UNITS: CatalogUnit[] = ["PIECE", "DOZEN", "BOX", "CARTON"]

/* ─── Theme system ───────────────────────────────────────────────────── */
interface ThemeTokens {
  bg: string
  cardBg: string
  cardBorder: string
  headerBg: string
  headerShadow: string
  text: string
  subtext: string
  accent: string
  accentText: string
  accentLight: string
  catActive: string
  catActiveText: string
  catIdle: string
  catIdleText: string
  inputBg: string
  inputText: string
  divider: string
  skeletonBg: string
  pillBg: string
  icon: string
  name: string
}

const THEMES: Record<Theme, ThemeTokens> = {
  clean: {
    bg: "#f8fafc", cardBg: "#ffffff", cardBorder: "rgba(0,0,0,0.06)",
    headerBg: "#ffffff", headerShadow: "0 1px 4px rgba(0,0,0,0.07)",
    text: "#0f172a", subtext: "#64748b",
    accent: "#059669", accentText: "#ffffff", accentLight: "#d1fae5",
    catActive: "#059669", catActiveText: "#ffffff",
    catIdle: "#f1f5f9", catIdleText: "#475569",
    inputBg: "#f1f5f9", inputText: "#0f172a",
    divider: "#e2e8f0", skeletonBg: "#e2e8f0", pillBg: "#f0fdf4",
    icon: "☀️", name: "نظيف",
  },
  warm: {
    bg: "#fffbeb", cardBg: "#fffdf7", cardBorder: "rgba(180,83,9,0.08)",
    headerBg: "#ffffff", headerShadow: "0 1px 4px rgba(180,83,9,0.08)",
    text: "#78350f", subtext: "#92400e",
    accent: "#d97706", accentText: "#ffffff", accentLight: "#fef3c7",
    catActive: "#d97706", catActiveText: "#ffffff",
    catIdle: "#fef3c7", catIdleText: "#92400e",
    inputBg: "#fef3c7", inputText: "#78350f",
    divider: "#fde68a", skeletonBg: "#fde68a", pillBg: "#fefce8",
    icon: "🏪", name: "دافئ",
  },
  dark: {
    bg: "#0f172a", cardBg: "#1e293b", cardBorder: "rgba(255,255,255,0.06)",
    headerBg: "#1e293b", headerShadow: "0 1px 8px rgba(0,0,0,0.4)",
    text: "#f1f5f9", subtext: "#94a3b8",
    accent: "#10b981", accentText: "#ffffff", accentLight: "rgba(16,185,129,0.15)",
    catActive: "#10b981", catActiveText: "#ffffff",
    catIdle: "#334155", catIdleText: "#94a3b8",
    inputBg: "#334155", inputText: "#f1f5f9",
    divider: "#334155", skeletonBg: "#334155", pillBg: "rgba(16,185,129,0.1)",
    icon: "🌙", name: "فاخر",
  },
  vibrant: {
    bg: "#faf5ff", cardBg: "#ffffff", cardBorder: "rgba(139,92,246,0.1)",
    headerBg: "#ffffff", headerShadow: "0 1px 4px rgba(139,92,246,0.1)",
    text: "#2e1065", subtext: "#7c3aed",
    accent: "#7c3aed", accentText: "#ffffff", accentLight: "#ede9fe",
    catActive: "#7c3aed", catActiveText: "#ffffff",
    catIdle: "#ede9fe", catIdleText: "#6d28d9",
    inputBg: "#ede9fe", inputText: "#2e1065",
    divider: "#ddd6fe", skeletonBg: "#ddd6fe", pillBg: "#f5f3ff",
    icon: "🎨", name: "حيوي",
  },
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
  if (unit === "BOX") return Math.ceil(n / 2)
  if (unit === "DOZEN") return 12
  return 1 // PIECE
}

const linePrice = (product: PublicCatalogProduct, unit: CatalogUnit) =>
  Number(product.salePrice ?? 0) * pcs(product, unit)

const maxQty = (product: PublicCatalogProduct, unit: CatalogUnit) =>
  Math.floor(product.currentStock / pcs(product, unit))

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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (sessionQuery.isError) clearAccess()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionQuery.isError])

  if (!accessToken) return <CatalogGate onAccess={handleAccess} />

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

  const { customer, allowPrices, showStock } = sessionQuery.data
  return (
    <CatalogShop
      accessToken={accessToken}
      allowPrices={allowPrices}
      showStock={showStock ?? true}
      customerId={customer.id}
      customerName={customer.name}
      customerPhone={customer.phone}
    />
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
    mutationFn: () => verifyCatalogOtp(phone.trim(), otp.trim()),
    onSuccess: () => { setMsg(""); setStep("details") },
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
   SHOP
══════════════════════════════════════════════════════════════════════ */
function CatalogShop({
  accessToken, allowPrices, showStock, customerId, customerName, customerPhone,
}: {
  accessToken: string; allowPrices: boolean; showStock: boolean
  customerId: string; customerName: string; customerPhone: string
}) {
  const productsQuery = useQuery({
    queryKey: ["public-catalog-products", accessToken],
    queryFn: () => getPublicCatalogProducts(accessToken),
    refetchOnMount: "always",
    staleTime: 0,
  })

  useEffect(() => {
    document.title = "كتالوج المنتجات"
    return () => { document.title = "مخزوني" }
  }, [])

  /* ── State ── */
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(themeKey) as Theme) || "clean")
  const [sortKey, setSortKey] = useState<SortKey>("default")
  const [viewMode, setViewMode] = useState<ViewMode>("grid")
  const [perRow, setPerRow] = useState(2)
  const [search, setSearch] = useState("")
  const [activeSugg, setActiveSugg] = useState(0)
  const [category, setCategory] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")
  const [cart, setCart] = useState<CartLine[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [notes, setNotes] = useState("")
  const [submitted, setSubmitted] = useState<string | null>(null)
  const [bannerIndex, setBannerIndex] = useState(0)
  const [showThemePicker, setShowThemePicker] = useState(false)
  const [zoomedImg, setZoomedImg] = useState<{ src: string; name: string } | null>(null)
  const [pickerProduct, setPickerProduct] = useState<PublicCatalogProduct | null>(null)
  const [promoCode, setPromoCode] = useState("")
  const [promoResult, setPromoResult] = useState<{ code: string; type: string; value: number | null; description: string | null } | null>(null)
  const [promoError, setPromoError] = useState("")
  const [promoLoading, setPromoLoading] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const themeRef = useRef<HTMLDivElement>(null)
  const bannerTouchX = useRef<number | null>(null)

  const designQuery = useQuery({
    queryKey: ["catalog-design-public"],
    queryFn: () => api.get("/public/catalog/design").then(r => (r.data as { data?: { primaryColor?: string | null; bgColor?: string | null; defaultTheme?: Theme; logoUrl?: string | null; welcomeMessage?: string | null; bannerEnabled?: boolean; bannerImages?: Array<{ url: string; title: string; order: number }> } }).data ?? {}),
    staleTime: 5 * 60_000,
  })
  const design = designQuery.data

  const baseTk = THEMES[design?.defaultTheme ?? theme]
  const tk: ThemeTokens = {
    ...baseTk,
    ...(design?.primaryColor ? {
      accent: design.primaryColor,
      catActive: design.primaryColor,
      accentLight: design.primaryColor + "22",
    } : {}),
    ...(design?.bgColor ? { bg: design.bgColor } : {}),
  }

  function applyTheme(t: Theme) {
    setTheme(t)
    localStorage.setItem(themeKey, t)
    setShowThemePicker(false)
  }

  // Close theme picker on outside click
  useEffect(() => {
    if (!showThemePicker) return
    function handler(e: MouseEvent) {
      if (themeRef.current && !themeRef.current.contains(e.target as Node)) setShowThemePicker(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [showThemePicker])

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
      if (p.currentStock <= 0) return false
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
  }, [products, search, category, typeFilter, sortKey])

  const suggestions = visible.slice(0, 6)
  const showSections = category === "all" && typeFilter === "all" && !search.trim()
  const newArrivals = useMemo(() => products.filter(p => p.isNewArrival && p.currentStock > 0).slice(0, 12), [products])
  const offers = useMemo(() => products.filter(p => p.isOffer && p.currentStock > 0).slice(0, 12), [products])
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
      submitPublicCatalogOrder(
        {
          customerName, phone: customerPhone, notes: notes.trim() || undefined,
          items: cart.map(l => ({ productId: l.product.id, unit: l.unit, quantity: l.quantity })),
          promoCode: promoResult?.code,
        },
        accessToken,
      ),
    onSuccess: (r) => { setSubmitted(r.data?.approvalId ?? "ok"); setCart([]); setNotes(""); setPromoResult(null); setPromoCode("") },
  })

  function add(product: PublicCatalogProduct, unit: CatalogUnit = "PIECE") {
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

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!suggestions.length) return
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveSugg(v => Math.min(v + 1, suggestions.length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveSugg(v => Math.max(v - 1, 0)) }
    else if (e.key === "Enter") { e.preventDefault(); add(suggestions[activeSugg] ?? suggestions[0]); setSearch("") }
    else if (e.key === "Escape") { setSearch(""); setActiveSugg(0) }
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
        onZoom={(src) => setZoomedImg({ src, name: product.name })}
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
                className="h-9 w-full rounded-xl border-0 pr-9 pl-3 text-sm text-white outline-none transition placeholder:text-white/55"
                style={{ background: "rgba(255,255,255,0.2)" }}
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100">
                  <X className="h-4 w-4" style={{ color: tk.text }} />
                </button>
              )}
              {/* Autocomplete */}
              {search.trim() && suggestions.length > 0 && (
                <div className="absolute top-full right-0 z-50 mt-1 w-full overflow-hidden rounded-xl border shadow-xl"
                  style={{ background: tk.cardBg, borderColor: tk.divider }}>
                  {suggestions.map((p, i) => (
                    <button key={p.id} type="button"
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-right text-sm transition"
                      style={{ background: i === activeSugg ? tk.accentLight : "transparent" }}
                      onMouseEnter={() => setActiveSugg(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { add(p); setSearch("") }}
                    >
                      <MiniThumb product={p} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium" style={{ color: tk.text }}>{p.name}</span>
                        <span className="text-xs" style={{ color: tk.subtext }}>{p.itemNumber}{showStock ? ` · ${money(p.currentStock)} قطعة` : ""}</span>
                      </span>
                      {allowPrices && <span className="shrink-0 text-xs font-bold" style={{ color: tk.accent }}>{money(p.salePrice)} د.ع</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Theme picker */}
            <div className="relative" ref={themeRef}>
              <button
                onClick={() => setShowThemePicker(v => !v)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition active:scale-95"
                style={{ background: showThemePicker ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.2)" }}
                title="تغيير الثيم"
              >
                <Palette className="h-4 w-4 text-white" />
              </button>
              {showThemePicker && (
                <div className="absolute top-full left-0 z-50 mt-2 rounded-2xl p-2 shadow-2xl"
                  style={{ background: tk.cardBg, border: `1px solid ${tk.divider}`, minWidth: "160px" }}>
                  <p className="mb-1.5 px-1 text-[10px] font-bold" style={{ color: tk.subtext }}>اختر الثيم</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(Object.keys(THEMES) as Theme[]).map(t => (
                      <button key={t} onClick={() => applyTheme(t)}
                        className="flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-right transition active:scale-95"
                        style={{ background: theme === t ? tk.accentLight : "transparent", border: `1.5px solid ${theme === t ? tk.accent : "transparent"}` }}>
                        <span className="text-base leading-none">{THEMES[t].icon}</span>
                        <span className="text-[11px] font-bold" style={{ color: tk.text }}>{THEMES[t].name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Refresh */}
            <button
              onClick={() => void productsQuery.refetch()}
              disabled={productsQuery.isFetching}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition disabled:opacity-50 active:scale-95"
              style={{ background: "rgba(255,255,255,0.2)" }}
            >
              <RefreshCw className={cn("h-4 w-4 text-white/80", productsQuery.isFetching && "animate-spin")} />
            </button>

            {/* Cart */}
            <button onClick={() => setCartOpen(true)}
              className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition active:scale-95"
              style={{ background: "rgba(255,255,255,0.28)" }}>
              <ShoppingCart className="h-5 w-5 text-white" />
              {cartQty > 0 && (
                <span className="absolute -left-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
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
                  className="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all active:scale-95"
                  style={category === cat
                    ? { background: "rgba(255,255,255,0.92)", color: tk.accent }
                    : { background: "rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.92)" }
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
                  className="shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold transition-all"
                  style={typeFilter === t
                    ? { background: "rgba(255,255,255,0.85)", color: tk.accent }
                    : { background: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.25)" }
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
                className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all"
                style={sortKey === sk
                  ? { background: "rgba(255,255,255,0.9)", color: tk.accent }
                  : { background: "rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.85)" }
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
                  className="flex h-7 w-6 items-center justify-center text-[11px] font-bold transition"
                  style={{ background: perRow === n ? "rgba(255,255,255,0.9)" : "transparent", color: perRow === n ? tk.accent : "rgba(255,255,255,0.8)" }}>
                  {n}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* ── Hero banner (slideshow) ── */}
      {(() => {
        const bannerEnabled = design?.bannerEnabled !== false
        if (!bannerEnabled) return null
        // Admin banner images take priority over product images
        const adminImgs = [...(design?.bannerImages ?? [])].sort((a, b) => a.order - b.order)
        const slides: Array<{ src: string; title: string; subtitle?: string }> =
          adminImgs.length >= 2
            ? adminImgs.map(img => ({ src: img.url, title: img.title || "" }))
            : products.filter(p => p.imageUrl && p.currentStock > 0).slice(0, 8).map(p => ({
                src: p.imageUrl!, title: p.name,
                subtitle: allowPrices ? `${money(p.salePrice)} د.ع` : undefined,
              }))
        if (slides.length < 2) return null
        const total = slides.length
        const idx = ((bannerIndex % total) + total) % total
        const welcomeMsg = design?.welcomeMessage || `مرحباً ${customerName} 👋`
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
      <main className="-mt-3 flex-1 rounded-t-[28px] px-3 pb-32 pt-4 overflow-hidden" style={{ background: tk.bg }}>

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
            <p className="font-bold" style={{ color: tk.text }}>لا توجد منتجات مطابقة</p>
            <p className="mt-1 text-sm" style={{ color: tk.subtext }}>جرب كلمة بحث مختلفة أو فئة أخرى</p>
          </div>
        )}

        {/* Special rows: عروض + جديد */}
        {!productsQuery.isLoading && showSections && (offers.length > 0 || newArrivals.length > 0) && (
          <div className="mb-5 space-y-5">
            {offers.length > 0 && (
              <section>
                <h2 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold" style={{ color: "#e11d48" }}>
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
                <h2 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold" style={{ color: tk.accent }}>
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
              <span className="text-xs font-semibold" style={{ color: tk.subtext }}>كل المنتجات</span>
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
      </div>{/* end card container */}

      {/* ── Floating cart button ── */}
      {cartQty > 0 && !cartOpen && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed bottom-5 left-1/2 z-40 -translate-x-1/2 flex items-center gap-3 rounded-2xl px-5 py-3.5 text-white shadow-2xl transition active:scale-95"
          style={{ background: tk.accent }}>
          <ShoppingCart className="h-5 w-5" />
          <span className="font-bold text-sm">السلة — {cartQty} مادة</span>
          {allowPrices && <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold">{money(finalTotal)} د.ع{promoResult && <span className="mr-1 opacity-80 line-through text-[9px]">{money(subtotal)}</span>}</span>}
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
        />
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
    </div>
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
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.name} className="h-14 w-14 rounded-xl object-cover border" style={{ borderColor: tk.divider }} />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-xl" style={{ background: tk.catIdle }}>
              <ImageIcon className="h-6 w-6" style={{ color: tk.subtext, opacity: 0.4 }} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-bold" style={{ color: tk.text }}>{product.name}</p>
            <p className="text-xs" style={{ color: tk.subtext }}>{product.itemNumber}</p>
            {showStock && (
              <p className="text-xs font-semibold" style={{ color: product.currentStock <= 5 ? "#ef4444" : tk.subtext }}>
                {product.currentStock <= 5 ? `⚠️ ${product.currentStock} قطعة متبقية` : `${money(product.currentStock)} قطعة متوفرة`}
              </p>
            )}
          </div>
          <button onClick={onClose} className="shrink-0 rounded-xl p-2" style={{ background: tk.catIdle }}>
            <X className="h-5 w-5" style={{ color: tk.subtext }} />
          </button>
        </div>

        {/* Unit options */}
        <div className="p-4 space-y-2.5 pb-8">
          <p className="text-xs font-semibold mb-3" style={{ color: tk.subtext }}>اختر الوحدة:</p>
          {UNITS.map((u) => {
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
                    <span className="text-base font-extrabold" style={{ color: disabled ? tk.subtext : tk.text }}>
                      {UNIT_LABELS[u]}
                    </span>
                    {u === "BOX" && (
                      <span className="rounded-full px-2 py-0.5 text-[9px] font-bold" style={{ background: tk.accentLight, color: tk.accent }}>
                        نصف كارتون
                      </span>
                    )}
                  </div>
                  <p className="text-xs" style={{ color: tk.subtext }}>
                    {UNIT_DESC[u](product.pcsPerCarton)}
                    {!disabled && ` · متوفر: ${qty} ${UNIT_LABELS[u]}`}
                    {disabled && " · غير متوفر"}
                  </p>
                </div>
                {allowPrices && !disabled && (
                  <div className="text-right">
                    <p className="text-base font-extrabold" style={{ color: tk.accent }}>{money(price)}</p>
                    <p className="text-[10px]" style={{ color: tk.subtext }}>د.ع / {UNIT_LABELS[u]}</p>
                    {pcsCount > 1 && (
                      <p className="text-[9px]" style={{ color: tk.subtext }}>
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
  onZoom: (src: string) => void
}) {
  const outOfStock = product.currentStock <= 0
  const lowStock = product.currentStock > 0 && product.currentStock <= 5
  // Price shown is for PIECE by default (when not in cart) or the cart unit
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
      <div className="flex gap-2.5 overflow-hidden rounded-2xl transition active:scale-[0.99]"
        style={{
          background: tk.cardBg,
          border: `2px solid ${qtyInCart > 0 ? tk.accent : "transparent"}`,
          boxShadow: qtyInCart > 0 ? `0 0 0 1px ${tk.accent}30` : "0 1px 6px rgba(0,0,0,0.05)",
          padding: "8px",
        }}>
        {/* Square image */}
        <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl" style={{ background: tk.catIdle }}>
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.name} className="h-full w-full cursor-zoom-in object-cover" loading="lazy" onClick={() => onZoom(product.imageUrl!)} />
          ) : (
            <div className="flex h-full items-center justify-center"><ImageIcon className="h-6 w-6" style={{ color: tk.subtext, opacity: 0.3 }} /></div>
          )}
          {qtyInCart > 0 && (
            <span className="absolute left-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-extrabold text-white ring-1 ring-white/50" style={{ background: tk.accent }}>{qtyInCart}</span>
          )}
          {product.isOffer && <span className="absolute right-0.5 top-0.5 rounded-full bg-rose-500 px-1 py-0.5 text-[7px] font-bold text-white">عرض</span>}
          {outOfStock && <div className="absolute inset-0 bg-white/55 flex items-center justify-center"><span className="text-[8px] font-bold text-red-600">نفد</span></div>}
        </div>

        {/* Info */}
        <div className="flex min-w-0 flex-1 flex-col justify-between">
          <div className="flex items-start gap-1">
            <p className="line-clamp-2 flex-1 text-xs font-bold leading-snug" style={{ color: tk.text }}>{product.name}</p>
            {product.isNewArrival && <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[7px] font-bold text-white" style={{ background: tk.accent }}>جديد</span>}
          </div>
          <div className="flex items-center justify-between gap-1 mt-1">
            <div>
              {allowPrices && (
                <p className="text-sm font-extrabold leading-none" style={{ color: tk.accent }}>
                  {money(displayPrice)} <span className="text-[9px] font-normal" style={{ color: tk.subtext }}>د.ع/{UNIT_LABELS[displayUnit]}</span>
                </p>
              )}
              {showStock && !outOfStock && (
                <p className="text-[9px] mt-0.5" style={{ color: lowStock ? "#ef4444" : tk.subtext }}>
                  {lowStock ? `⚠ ${product.currentStock} متبقية` : `${money(product.currentStock)} متوفر`}
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
      <div className="overflow-hidden rounded-xl transition-transform active:scale-[0.97]"
        style={{ background: tk.cardBg, border: `2px solid ${qtyInCart > 0 ? tk.accent : "transparent"}` }}>
        <div className="relative aspect-square overflow-hidden" style={{ background: tk.catIdle }}>
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.name} className="h-full w-full cursor-zoom-in object-cover" loading="lazy" onClick={() => onZoom(product.imageUrl!)} />
          ) : (
            <div className="flex h-full items-center justify-center"><ImageIcon className="h-5 w-5" style={{ color: tk.subtext, opacity: 0.3 }} /></div>
          )}
          {outOfStock && <div className="absolute inset-0 bg-white/55 pointer-events-none" />}
          {qtyInCart > 0 && (
            <span className="absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-extrabold text-white ring-1 ring-white/40 shadow" style={{ background: tk.accent }}>{qtyInCart}</span>
          )}
          {product.isOffer && <span className="absolute right-0.5 top-0.5 rounded-full bg-rose-500 px-1 py-0.5 text-[6px] font-bold text-white">عرض</span>}
          {product.isNewArrival && !product.isOffer && <span className="absolute right-0.5 top-0.5 rounded-full px-1 py-0.5 text-[6px] font-bold text-white" style={{ background: tk.accent }}>جديد</span>}
          {/* Bottom gradient with price + button */}
          <div className="absolute inset-x-0 bottom-0 px-1.5 pb-1.5 pt-8" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)" }}>
            <div className="flex items-end justify-between">
              <div>
                <p className="truncate text-[9px] font-bold leading-tight text-white">{product.name}</p>
                {allowPrices && !outOfStock && <p className="text-[8px] font-semibold" style={{ color: "#6ee7b7" }}>{money(displayPrice)} د.ع</p>}
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
    <div className="flex flex-col overflow-hidden rounded-2xl transition-transform active:scale-[0.98]"
      style={{
        background: tk.cardBg,
        border: `2px solid ${qtyInCart > 0 ? tk.accent : "transparent"}`,
        boxShadow: qtyInCart > 0 ? `0 0 0 1px ${tk.accent}40, 0 4px 16px rgba(0,0,0,0.08)` : "0 2px 8px rgba(0,0,0,0.06)",
      }}>
      {/* Image — full square with all controls overlaid */}
      <div className="relative aspect-square overflow-hidden" style={{ background: tk.catIdle }}>
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name}
            className="h-full w-full object-cover cursor-zoom-in transition-transform duration-300 hover:scale-105"
            loading="lazy" onClick={() => onZoom(product.imageUrl!)} />
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
            <span className="rounded-full px-2 py-0.5 text-[8px] font-bold text-white" style={{ background: "rgba(0,0,0,0.55)" }}>{product.category}</span>
          )}
          {product.isNewArrival && <span className="rounded-full px-2 py-0.5 text-[8px] font-bold text-white" style={{ background: tk.accent }}>جديد</span>}
          {product.isOffer && <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[8px] font-bold text-white">عرض</span>}
        </div>

        {/* Cart qty badge top-left */}
        {qtyInCart > 0 && (
          <span className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-extrabold text-white shadow-lg ring-2 ring-white/40"
            style={{ background: tk.accent }}>{qtyInCart}</span>
        )}

        {/* Bottom overlay: price + controls */}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between px-2 pb-2">
          {/* Price */}
          <div>
            {allowPrices && !outOfStock && (
              <>
                {product.isOffer && product.oldPrice != null && Number(product.oldPrice) > 0 && (
                  <p className="text-[9px] text-white/60 line-through leading-none">{money(Number(product.oldPrice))}</p>
                )}
                <p className="text-sm font-extrabold text-white leading-none drop-shadow">
                  {money(displayPrice)}<span className="text-[9px] font-normal text-white/70 mr-0.5">د.ع</span>
                </p>
                {cartUnit && cartUnit !== "PIECE" && (
                  <p className="text-[8px] text-white/70 leading-none mt-0.5">للـ{UNIT_LABELS[cartUnit]}</p>
                )}
              </>
            )}
            {outOfStock && <span className="rounded-full bg-red-500 px-2 py-0.5 text-[9px] font-bold text-white">نفد</span>}
            {showStock && !outOfStock && (
              <p className="text-[8px] leading-none mt-0.5" style={{ color: lowStock ? "#fca5a5" : "rgba(255,255,255,0.65)" }}>
                {lowStock ? `⚠ ${product.currentStock} متبقية` : `${money(product.currentStock)} قطعة`}
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

      {/* Name only — one line, compact */}
      <div className="px-2 py-1.5">
        <p className="line-clamp-1 text-[11px] font-bold leading-snug" style={{ color: tk.text }}>{product.name}</p>
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
}) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92vh] flex-col rounded-t-3xl shadow-2xl lg:inset-y-0 lg:right-0 lg:left-auto lg:w-[420px] lg:rounded-none"
        style={{ background: tk.cardBg }} dir="rtl">
        <div className="flex justify-center pt-3 pb-1 lg:hidden">
          <div className="h-1 w-10 rounded-full" style={{ background: tk.divider }} />
        </div>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${tk.divider}` }}>
          <h2 className="flex items-center gap-2 text-base font-extrabold" style={{ color: tk.text }}>
            <ShoppingCart className="h-5 w-5" style={{ color: tk.accent }} />
            سلة التسوق
            {cart.length > 0 && (
              <span className="rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: tk.accentLight, color: tk.accent }}>
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
              <p className="text-lg font-extrabold" style={{ color: tk.text }}>تم إرسال الطلب!</p>
              <p className="text-sm" style={{ color: tk.subtext }}>طلبك ينتظر موافقة الإدارة. سيتم التواصل معك قريباً.</p>
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

            {/* Promo code */}
            {promoResult ? (
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
            )}
            {promoError && <p className="text-xs text-red-600">{promoError}</p>}

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
                <div className="flex justify-between border-t pt-1.5 text-sm font-extrabold" style={{ borderColor: tk.divider, color: tk.text }}>
                  <span>الإجمالي</span>
                  <span style={{ color: tk.accent }}>{money(finalTotal)} د.ع</span>
                </div>
              </div>
            )}

            {isError && <p className="text-xs text-red-600">تعذر إرسال الطلب. حاول مرة أخرى.</p>}
            <button disabled={isPending} onClick={onSubmit}
              className="w-full rounded-2xl py-3.5 text-sm font-extrabold text-white shadow-lg transition active:scale-95 disabled:opacity-50"
              style={{ background: tk.accent }}>
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
            <p className="truncate text-sm font-bold" style={{ color: tk.text }}>{line.product.name}</p>
            <button onClick={() => onRemove(line.id)} className="shrink-0 transition hover:scale-110">
              <Trash2 className="h-4 w-4 text-red-400" />
            </button>
          </div>
          {/* Unit badge */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: tk.accentLight, color: tk.accent }}>
              {UNIT_LABELS[line.unit]}
            </span>
            <span className="text-[10px]" style={{ color: tk.subtext }}>
              {unitPcs > 1 ? `${unitPcs} قطعة/وحدة` : "قطعة"}
            </span>
            {allowPrices && (
              <span className="text-[10px] font-semibold" style={{ color: tk.subtext }}>
                · {money(unitPriceVal)} د.ع/وحدة
              </span>
            )}
          </div>
          {allowPrices && (
            <p className="mt-0.5 text-xs font-bold" style={{ color: tk.accent }}>
              {line.quantity} وحدة × {money(unitPriceVal)} = {money(unitPriceVal * line.quantity)} د.ع
              {unitPcs > 1 && <span className="mr-1 text-[9px] font-normal" style={{ color: tk.subtext }}>({money(totalPcs)} قطعة إجمالاً)</span>}
            </p>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        {/* Unit switcher */}
        <div className="flex gap-1 flex-wrap">
          {UNITS.map((u) =>
            maxQty(line.product, u) > 0 ? (
              <button key={u} onClick={() => onChangeUnit(line.id, u)}
                className="rounded-lg px-2 py-1 text-[9px] font-bold transition"
                style={u === line.unit ? { background: tk.accent, color: tk.accentText } : { background: tk.catIdle, color: tk.catIdleText }}>
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
          <span className="min-w-[1.5rem] text-center text-sm font-bold" style={{ color: tk.text }}>{line.quantity}</span>
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
  return product.imageUrl ? (
    <img src={product.imageUrl} alt="" className={cn("shrink-0 object-cover", cls)} loading="lazy" />
  ) : (
    <div className={cn("shrink-0 flex items-center justify-center bg-gray-100 text-gray-300", cls)}>
      <ImageIcon className={size === "lg" ? "h-5 w-5" : "h-3.5 w-3.5"} />
    </div>
  )
}
