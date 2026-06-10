import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"
import { api } from "../api/client"
import {
  CheckCircle2,
  ChevronLeft,
  ImageIcon,
  Minus,
  Plus,
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
} from "../api/endpoints"
import type { PublicCatalogProduct } from "../types/api"
import { cn } from "../utils/cn"

/* ─── Types ─────────────────────────────────────────────────────────── */
type CatalogUnit = "PIECE" | "DOZEN" | "CARTON"
type CartLine = { id: string; product: PublicCatalogProduct; unit: CatalogUnit; quantity: number }

const storageKey = "inventory_catalog_access"
const UNIT_LABELS: Record<CatalogUnit, string> = { PIECE: "قطعة", DOZEN: "درزن", CARTON: "كارتون" }
const UNITS: CatalogUnit[] = ["PIECE", "DOZEN", "CARTON"]

/* ─── Helpers ────────────────────────────────────────────────────────── */
const money = (v: number | null | undefined) =>
  new Intl.NumberFormat("en-US").format(Math.round(Number(v ?? 0)))

const pcs = (product: PublicCatalogProduct, unit: CatalogUnit) =>
  unit === "CARTON" ? Math.max(1, product.pcsPerCarton) : unit === "DOZEN" ? 12 : 1

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

  // Single source of truth: URL param first, then localStorage
  // useState so queryKey stays stable across renders
  const [accessToken, setAccessToken] = useState<string>(
    () => searchParams.get("access") || localStorage.getItem(storageKey) || "",
  )

  // One clean handler — updates state + URL + localStorage atomically
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

  // Token rejected by server — clear it so Gate is shown clean
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
      customerName={customer.name}
      customerPhone={customer.phone}
    />
  )
}

/* ══════════════════════════════════════════════════════════════════════
   GATE (login screen)
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

  // Check first if already approved → skip OTP entirely
  const sendOtpMut = useMutation({
    mutationFn: async () => {
      // Fast-path: if the phone is already approved, return the token immediately
      const status = await getCatalogAccessStatus(phone.trim())
      if (status?.approved && status.token) return { skip: true, token: status.token }
      // Normal path: send OTP
      await sendCatalogOtp(phone.trim())
      return { skip: false, token: null }
    },
    onSuccess: (result) => {
      setMsg("")
      if (result.skip && result.token) {
        onAccess(result.token)
      } else {
        setStep("otp")
      }
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

        {/* Step 1 — أدخل رقمك */}
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

        {/* Step 2 — أدخل رمز OTP */}
        {step === "otp" && (
          <div className="space-y-4">
            <div className="text-center">
              <p className="font-semibold text-gray-800">أدخل رمز التحقق</p>
              <p className="mt-1 text-xs text-gray-500">أُرسل إلى {phone} عبر الواتساب</p>
            </div>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
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

        {/* Step 3 — بيانات الطلب */}
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

        {/* Step 4 — فحص الموافقة */}
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
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
        dir="rtl"
      />
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   SHOP
══════════════════════════════════════════════════════════════════════ */
function CatalogShop({
  accessToken, allowPrices, showStock, customerName, customerPhone,
}: {
  accessToken: string; allowPrices: boolean; showStock: boolean; customerName: string; customerPhone: string
}) {
  const productsQuery = useQuery({
    queryKey: ["public-catalog-products", accessToken],
    queryFn: () => getPublicCatalogProducts(accessToken),
  })

  const [search, setSearch] = useState("")
  const [activeSugg, setActiveSugg] = useState(0)
  const [category, setCategory] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")
  const [cart, setCart] = useState<CartLine[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [notes, setNotes] = useState("")
  const [submitted, setSubmitted] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Welcome banner — shown once per session
  const welcomeKey = "catalog_welcome_seen"
  const [showWelcome, setShowWelcome] = useState(() => !sessionStorage.getItem(welcomeKey))
  function dismissWelcome() {
    sessionStorage.setItem(welcomeKey, "1")
    setShowWelcome(false)
  }

  // Load predefined categories for filter panel
  const catsQuery = useQuery({
    queryKey: ["catalog-categories-public"],
    queryFn: () => api.get("/catalog-categories").then(r => (r.data as { data?: Array<{ name: string; types: string[] }> }).data ?? []).catch(() => []),
    staleTime: 10 * 60_000,
  })
  const catalogCatsList = useMemo(
    () => (catsQuery.data ?? []) as Array<{ name: string; types: string[] }>,
    [catsQuery.data],
  )

  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data])
  // Build category list: use categoryTags when available, fall back to category field
  const categories = useMemo(() => {
    const catSet = new Set<string>()
    products.forEach(p => {
      if (p.categoryTags && p.categoryTags.length > 0) {
        p.categoryTags.forEach(t => catSet.add(t))
      } else if (p.category) {
        catSet.add(p.category)
      }
    })
    // Sort by catalogCatsList order if available, otherwise alphabetically
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

  // Available types for the currently selected category
  // Uses backend catalog-categories first, then falls back to typeTags on products
  const availableTypes = useMemo(() => {
    if (category === "all") return []
    const catDef = catalogCatsList.find(c => c.name === category)
    if (catDef?.types.length) return catDef.types
    // Fallback: collect unique typeTags from products that belong to this category
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
    return products.filter((p) => {
      if (p.currentStock <= 0) return false
      if (category !== "all") {
        const tags = p.categoryTags ?? []
        const inCat = tags.length > 0 ? tags.includes(category) : p.category === category
        if (!inCat) return false
      }
      if (typeFilter !== "all") {
        const tTags = (p.typeTags ?? []).map(t => t.trim())
        // Products with no type tags are shown in all type filters (unclassified)
        if (tTags.length > 0 && !tTags.includes(typeFilter.trim())) return false
      }
      if (!q) return true
      return [p.name, p.itemNumber, p.category ?? ""].some((s) => s.toLowerCase().includes(q))
    })
  }, [products, search, category, typeFilter])

  const suggestions = visible.slice(0, 6)
  const cartQty = cart.reduce((s, l) => s + l.quantity, 0)
  const subtotal = cart.reduce((s, l) => s + l.quantity * linePrice(l.product, l.unit), 0)

  const orderMut = useMutation({
    mutationFn: () =>
      submitPublicCatalogOrder(
        { customerName, phone: customerPhone, notes: notes.trim() || undefined, items: cart.map((l) => ({ productId: l.product.id, unit: l.unit, quantity: l.quantity })) },
        accessToken,
      ),
    onSuccess: (r) => { setSubmitted(r.data?.approvalId ?? "ok"); setCart([]); setNotes("") },
  })

  function add(product: PublicCatalogProduct, unit: CatalogUnit = "PIECE") {
    const max = maxQty(product, unit)
    if (max < 1) return
    setSubmitted(null)
    setCart((prev) => {
      const id = key(product.id, unit)
      const cur = prev.find((l) => l.id === id)
      if (cur) return prev.map((l) => l.id === id ? { ...l, quantity: Math.min(l.quantity + 1, max) } : l)
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
      const target = prev.find((l) => l.id === lineId)
      if (!target) return prev
      const max = maxQty(target.product, unit)
      if (max < 1) return prev.filter((l) => l.id !== lineId)
      const newId = key(target.product.id, unit)
      const rest = prev.filter((l) => l.id !== lineId)
      const existing = rest.find((l) => l.id === newId)
      if (existing) return rest.map((l) => l.id === newId ? { ...l, quantity: Math.min(l.quantity + target.quantity, max) } : l)
      return [...rest, { ...target, id: newId, unit, quantity: Math.min(target.quantity, max) }]
    })
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!suggestions.length) return
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveSugg((v) => Math.min(v + 1, suggestions.length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveSugg((v) => Math.max(v - 1, 0)) }
    else if (e.key === "Enter") { e.preventDefault(); add(suggestions[activeSugg] ?? suggestions[0]); setSearch("") }
    else if (e.key === "Escape") { setSearch(""); setActiveSugg(0) }
  }

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">

      {/* ── Welcome Banner ── */}
      {showWelcome && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3" dir="rtl">
          <div className="mx-auto flex max-w-7xl items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-lg">💡</span>
              <p className="text-sm font-medium text-amber-800">
                تنبيه: الأسعار المعروضة تتغير حسب الكمية — تواصل معنا لأسعار الجملة والكميات الكبيرة.
              </p>
            </div>
            <button
              type="button"
              onClick={dismissWelcome}
              className="mt-0.5 shrink-0 rounded-full p-1 text-amber-600 hover:bg-amber-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Sticky Header ── */}
      <header className="sticky top-0 z-30 bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-3 py-3">
          <div className="flex items-center gap-3">
            {/* Store / customer */}
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600">
              <ShoppingBag className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              {/* Search */}
              <div className="relative">
                <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setActiveSugg(0) }}
                  onKeyDown={handleKey}
                  placeholder="ابحث عن منتج..."
                  className="h-9 w-full rounded-xl border-0 bg-gray-100 pr-9 pl-3 text-sm outline-none placeholder:text-gray-400 focus:bg-gray-200 transition"
                />
                {/* Autocomplete */}
                {search.trim() && suggestions.length > 0 && (
                  <div className="absolute top-full right-0 z-50 mt-1 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
                    {suggestions.map((p, i) => (
                      <button
                        key={p.id}
                        type="button"
                        className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-right text-sm transition", i === activeSugg ? "bg-emerald-50" : "hover:bg-gray-50")}
                        onMouseEnter={() => setActiveSugg(i)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { add(p); setSearch("") }}
                      >
                        <MiniThumb product={p} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-gray-900">{p.name}</span>
                          <span className="text-xs text-gray-500">{p.itemNumber}{showStock ? ` · ${money(p.currentStock)} قطعة` : ""}</span>
                        </span>
                        {allowPrices && <span className="shrink-0 text-xs font-bold text-emerald-700">{money(p.salePrice)} د.ع</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* Cart button */}
            <button
              onClick={() => setCartOpen(true)}
              className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-md shadow-emerald-200 transition active:scale-95"
            >
              <ShoppingCart className="h-5 w-5" />
              {cartQty > 0 && (
                <span className="absolute -left-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none">
                  {cartQty}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Categories bar */}
        <div className="overflow-x-auto border-t border-gray-100 scrollbar-hide">
          <div className="flex gap-2 px-3 py-2">
            {["all", ...categories].map((cat) => (
              <button
                key={cat}
                onClick={() => { setCategory(cat); setTypeFilter("all") }}
                className={cn(
                  "shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-all",
                  category === cat
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200",
                )}
              >
                {cat === "all" ? "الكل" : cat}
              </button>
            ))}
          </div>
        </div>

        {/* Types bar — only shown when a category is selected and it has types */}
        {availableTypes.length > 0 && (
          <div className="overflow-x-auto border-t border-gray-100 bg-gray-50 scrollbar-hide">
            <div className="flex gap-2 px-3 py-1.5">
              {["all", ...availableTypes].map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-all",
                    typeFilter === t
                      ? "bg-violet-600 text-white shadow-sm"
                      : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50",
                  )}
                >
                  {t === "all" ? "كل الأنواع" : t}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* ── Welcome banner ── */}
      <div className="mx-auto max-w-7xl px-3 pt-4 pb-1">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">مرحباً</p>
            <p className="text-sm font-bold text-gray-900">{customerName} 👋</p>
          </div>
          <div className="flex gap-1.5">
            {allowPrices && <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[10px] font-semibold text-blue-700">الأسعار ظاهرة</span>}
            {!showStock && <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-[10px] font-semibold text-orange-700">الكميات مخفية</span>}
          </div>
        </div>
      </div>

      {/* ── Product Grid ── */}
      <main className="mx-auto max-w-7xl px-3 pb-28 pt-3">
        {productsQuery.isLoading && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-2xl bg-white">
                <div className="aspect-square bg-gray-200 rounded-t-2xl" />
                <div className="p-3 space-y-2">
                  <div className="h-3 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!productsQuery.isLoading && visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-3 rounded-full bg-gray-100 p-5">
              <Search className="h-8 w-8 text-gray-400" />
            </div>
            <p className="font-semibold text-gray-600">لا توجد منتجات مطابقة</p>
            <p className="mt-1 text-sm text-gray-400">جرب كلمة بحث مختلفة أو اختر فئة أخرى</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visible.map((product) => {
            const cartLine = cart.find((l) => l.product.id === product.id)
            const qtyInCart = cartLine?.quantity ?? 0
            return (
              <ProductCard
                key={product.id}
                product={product}
                allowPrices={allowPrices}
                showStock={showStock}
                qtyInCart={qtyInCart}
                onAdd={(unit) => add(product, unit)}
                onRemoveOne={() => cartLine && changeQty(cartLine.id, -1)}
              />
            )
          })}
        </div>
      </main>

      {/* ── Floating Cart Button (mobile) ── */}
      {cartQty > 0 && !cartOpen && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed bottom-5 left-1/2 z-40 -translate-x-1/2 flex items-center gap-3 rounded-2xl bg-emerald-600 px-5 py-3.5 text-white shadow-xl shadow-emerald-300 transition active:scale-95"
        >
          <ShoppingCart className="h-5 w-5" />
          <span className="font-bold">السلة — {cartQty} مادة</span>
          {allowPrices && <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold">{money(subtotal)} د.ع</span>}
          <ChevronLeft className="h-4 w-4 opacity-70" />
        </button>
      )}

      {/* ── Cart Overlay ── */}
      {cartOpen && (
        <CartOverlay
          cart={cart}
          allowPrices={allowPrices}
          subtotal={subtotal}
          notes={notes}
          onNotes={setNotes}
          onChangeQty={changeQty}
          onChangeUnit={changeUnit}
          onRemove={(id) => setCart((prev) => prev.filter((l) => l.id !== id))}
          onClose={() => setCartOpen(false)}
          onSubmit={() => orderMut.mutate()}
          isPending={orderMut.isPending}
          submitted={submitted}
          isError={orderMut.isError}
        />
      )}
    </div>
  )
}

/* ── Product Card ────────────────────────────────────────────────────── */
function ProductCard({
  product, allowPrices, showStock, qtyInCart, onAdd, onRemoveOne,
}: {
  product: PublicCatalogProduct
  allowPrices: boolean
  showStock: boolean
  qtyInCart: number
  onAdd: (unit: CatalogUnit) => void
  onRemoveOne: () => void
}) {
  const [unit, setUnit] = useState<CatalogUnit>("PIECE")
  const max = maxQty(product, unit)

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 transition hover:shadow-md">
      {/* Image */}
      <div className="relative aspect-square bg-gray-100">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-gray-300">
            <ImageIcon className="h-8 w-8" />
            <span className="text-[10px]">بدون صورة</span>
          </div>
        )}
        {product.category && (
          <span className="absolute right-2 top-2 rounded-full bg-black/40 px-2 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">
            {product.category}
          </span>
        )}
        {qtyInCart > 0 && (
          <span className="absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white shadow">
            {qtyInCart}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col p-2.5">
        <p className="line-clamp-2 text-xs font-bold leading-snug text-gray-900 min-h-[2.4rem]">{product.name}</p>
        <p className="mt-0.5 text-[10px] text-gray-400">{product.itemNumber}</p>
        {product.typeTags && product.typeTags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {product.typeTags.map(t => (
              <span key={t} className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700">{t}</span>
            ))}
          </div>
        )}

        {/* Price + Stock */}
        <div className="mt-2 flex items-end justify-between gap-1">
          <div>
            {allowPrices ? (
              <p className="text-sm font-extrabold text-emerald-700">{money(linePrice(product, unit))} <span className="text-[10px] font-medium text-gray-500">د.ع</span></p>
            ) : (
              <p className="text-xs font-semibold text-gray-400">السعر مخفي</p>
            )}
            {showStock && (
              <p className="text-[10px] text-gray-400">{money(product.currentStock)} {unit === "CARTON" ? "كارتون" : "قطعة"} متوفر</p>
            )}
          </div>
        </div>

        {/* Unit picker */}
        <div className="mt-2 flex gap-1">
          {UNITS.map((u) => (
            maxQty(product, u) > 0 ? (
              <button
                key={u}
                onClick={() => setUnit(u)}
                className={cn(
                  "flex-1 rounded-lg py-1 text-[9px] font-bold transition",
                  u === unit ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200",
                )}
              >
                {UNIT_LABELS[u]}
              </button>
            ) : null
          ))}
        </div>

        {/* Add/Remove */}
        <div className="mt-2">
          {qtyInCart > 0 ? (
            <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-2 py-1">
              <button onClick={onRemoveOne} className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-gray-700 shadow-sm active:scale-90">
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="text-sm font-bold text-emerald-800">{qtyInCart}</span>
              <button onClick={() => onAdd(unit)} disabled={max < 1} className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm disabled:opacity-40 active:scale-90">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              disabled={max < 1}
              onClick={() => onAdd(unit)}
              className="w-full rounded-xl bg-emerald-600 py-2 text-xs font-bold text-white shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {max < 1 ? "نفد المخزون" : "أضف للسلة"}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Cart Overlay (bottom sheet on mobile, sidebar on desktop) ────── */
function CartOverlay({
  cart, allowPrices, subtotal, notes, onNotes, onChangeQty, onChangeUnit, onRemove, onClose, onSubmit, isPending, submitted, isError,
}: {
  cart: CartLine[]
  allowPrices: boolean
  subtotal: number
  notes: string
  onNotes: (v: string) => void
  onChangeQty: (id: string, d: number) => void
  onChangeUnit: (id: string, u: CatalogUnit) => void
  onRemove: (id: string) => void
  onClose: () => void
  onSubmit: () => void
  isPending: boolean
  submitted: string | null
  isError: boolean
}) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] flex-col rounded-t-3xl bg-white shadow-2xl lg:inset-y-0 lg:right-0 lg:left-auto lg:w-[420px] lg:rounded-none"
        dir="rtl"
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 lg:hidden">
          <div className="h-1 w-10 rounded-full bg-gray-300" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 className="text-base font-extrabold text-gray-900 flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-emerald-600" />
            سلة التسوق
            {cart.length > 0 && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
                {cart.reduce((s, l) => s + l.quantity, 0)} مادة
              </span>
            )}
          </h2>
          <button onClick={onClose} className="rounded-xl p-2 hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {submitted ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </div>
              <p className="text-lg font-extrabold text-gray-900">تم إرسال الطلب!</p>
              <p className="text-sm text-gray-500">طلبك ينتظر موافقة الإدارة. سيتم التواصل معك قريباً.</p>
              <button onClick={onClose} className="mt-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white">
                متابعة التسوق
              </button>
            </div>
          ) : cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <ShoppingBag className="h-12 w-12 text-gray-200" />
              <p className="font-semibold text-gray-400">السلة فارغة</p>
              <button onClick={onClose} className="text-sm text-emerald-600 underline">تصفح المنتجات</button>
            </div>
          ) : (
            <div className="space-y-3">
              {cart.map((line) => (
                <CartItem
                  key={line.id}
                  line={line}
                  allowPrices={allowPrices}
                  onChangeQty={onChangeQty}
                  onChangeUnit={onChangeUnit}
                  onRemove={onRemove}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer (checkout) */}
        {!submitted && cart.length > 0 && (
          <div className="border-t border-gray-100 bg-gray-50 px-4 py-4 space-y-3">
            <input
              value={notes}
              onChange={(e) => onNotes(e.target.value)}
              placeholder="ملاحظات إضافية (اختياري)"
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-emerald-400 placeholder:text-gray-400"
            />
            {allowPrices && (
              <div className="flex justify-between text-sm font-extrabold text-gray-900">
                <span>المجموع</span>
                <span className="text-emerald-700">{money(subtotal)} د.ع</span>
              </div>
            )}
            {isError && <p className="text-xs text-red-600">تعذر إرسال الطلب. حاول مرة أخرى.</p>}
            <button
              disabled={isPending}
              onClick={onSubmit}
              className="w-full rounded-2xl bg-emerald-600 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-emerald-200 transition active:scale-95 disabled:opacity-50"
            >
              {isPending ? "جاري الإرسال..." : "إرسال الطلب للمراجعة ✓"}
            </button>
          </div>
        )}
      </div>
    </>
  )
}

/* ── Cart Item Row ───────────────────────────────────────────────────── */
function CartItem({
  line, allowPrices, onChangeQty, onChangeUnit, onRemove,
}: {
  line: CartLine
  allowPrices: boolean
  onChangeQty: (id: string, d: number) => void
  onChangeUnit: (id: string, u: CatalogUnit) => void
  onRemove: (id: string) => void
}) {
  return (
    <div className="rounded-2xl bg-white p-3 ring-1 ring-gray-100 shadow-sm">
      <div className="flex gap-3">
        <MiniThumb product={line.product} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm font-bold text-gray-900">{line.product.name}</p>
            <button onClick={() => onRemove(line.id)} className="shrink-0 text-gray-300 hover:text-red-500 transition">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          {allowPrices && (
            <p className="text-xs font-semibold text-emerald-700">
              {money(linePrice(line.product, line.unit))} د.ع × {line.quantity} = {money(linePrice(line.product, line.unit) * line.quantity)} د.ع
            </p>
          )}
        </div>
      </div>
      {/* Unit + Qty */}
      <div className="mt-2 flex items-center gap-2">
        <div className="flex gap-1 flex-1">
          {UNITS.map((u) =>
            maxQty(line.product, u) > 0 ? (
              <button
                key={u}
                onClick={() => onChangeUnit(line.id, u)}
                className={cn(
                  "rounded-lg px-2 py-1 text-[10px] font-semibold transition",
                  u === line.unit ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-500",
                )}
              >
                {UNIT_LABELS[u]}
              </button>
            ) : null,
          )}
        </div>
        <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1">
          <button onClick={() => onChangeQty(line.id, -1)} className="flex h-6 w-6 items-center justify-center rounded-lg bg-white shadow-sm active:scale-90">
            <Minus className="h-3 w-3" />
          </button>
          <span className="min-w-[1.5rem] text-center text-sm font-bold">{line.quantity}</span>
          <button onClick={() => onChangeQty(line.id, 1)} disabled={line.quantity >= maxQty(line.product, line.unit)} className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm disabled:opacity-40 active:scale-90">
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Thumbnail ───────────────────────────────────────────────────────── */
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
