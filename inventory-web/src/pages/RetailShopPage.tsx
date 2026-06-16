import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { motion, AnimatePresence } from "framer-motion"
import {
  ArrowDownUp,
  ArrowRight,
  Bot,
  CheckCircle2,
  ClipboardList,
  Copy,
  Gift,
  LayoutGrid,
  Link2,
  Minus,
  Package,
  Phone,
  Plus,
  Search,
  Send,
  Share2,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store,
  Tag,
  Trash2,
  TrendingUp,
  Truck,
  Users,
  X,
} from "lucide-react"
import {
  getPublicActiveCoupon,
  getPublicCustomerReferral,
  getPublicReferralInfo,
  getPublicRetailCatalog,
  getPublicRetailCategories,
  getPublicRetailOrderStatus,
  getPublicRetailOrdersByPhone,
  getPublicRetailOrdersByToken,
  getPublicStoreInfo,
  previewPublicRetailCoupon,
  retailAiChat,
  submitPublicRetailOrder,
} from "../api/endpoints"
import type { AiChatProduct, PublicRetailItem, PublicRetailCategory } from "../types/api"

type Tab = "catalog" | "cart" | "orders"
type CartLine = { item: PublicRetailItem; quantity: number }
type SavedOrder = { id: string; orderNumber: string; total: number; createdAt: string }

const ORDERS_KEY = "retail_shop_orders"
const COUPON_SEEN_KEY = "retail_shop_coupon_seen"
const REFERRAL_KEY = "retail_ref_code"
const ORDERS_TOKEN_KEY = "retail_orders_token"

const money = (v: number) => new Intl.NumberFormat("en-US").format(Math.round(Number(v ?? 0)))

function loadOrders(): SavedOrder[] {
  try {
    return JSON.parse(localStorage.getItem(ORDERS_KEY) ?? "[]")
  } catch {
    return []
  }
}

export function RetailShopPage() {
  const settings = useQuery({ queryKey: ["public-store-info"], queryFn: getPublicStoreInfo }).data
  const storeName = settings?.storeName ?? "متجرنا"
  const currency = settings?.currency ?? "د.ع"

  const catalogQuery = useQuery({ queryKey: ["public-retail-catalog"], queryFn: getPublicRetailCatalog })
  const couponQuery = useQuery({ queryKey: ["public-retail-coupon"], queryFn: getPublicActiveCoupon })
  const categoriesQuery = useQuery({ queryKey: ["public-retail-categories"], queryFn: getPublicRetailCategories })

  function shareItem(item: PublicRetailItem) {
    const text = `${item.title}\nالسعر: ${money(item.price)} ${currency}\n${window.location.origin}/shop`
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`
    window.open(url, "_blank", "noopener,noreferrer")
  }

  const [tab, setTab] = useState<Tab>("catalog")
  const [cart, setCart] = useState<CartLine[]>([])
  const [detail, setDetail] = useState<PublicRetailItem | null>(null)
  const [showCoupon, setShowCoupon] = useState(false)
  const [orders, setOrders] = useState<SavedOrder[]>(loadOrders)
  const [chatOpen, setChatOpen] = useState(false)

  // Referral — detect ?ref= from URL, validate, persist
  const [activeReferralCode, setActiveReferralCode] = useState<string | null>(null)
  const [referralDiscountPct, setReferralDiscountPct] = useState<number>(0)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlRef = params.get("ref")?.trim().toUpperCase() || null
    const storedRef = localStorage.getItem(REFERRAL_KEY)
    const code = urlRef ?? storedRef
    if (!code) return
    if (urlRef) localStorage.setItem(REFERRAL_KEY, urlRef)
    getPublicReferralInfo(code)
      .then((info) => { setActiveReferralCode(info.code); setReferralDiscountPct(info.discountPercent) })
      .catch(() => { /* invalid code — ignore silently */ })
  }, [])

  // Private "my orders" link — ?orders=TOKEN persists the token and opens the tab
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get("orders")?.trim()
    if (urlToken) {
      localStorage.setItem(ORDERS_TOKEN_KEY, urlToken)
      setTab("orders")
    }
  }, [])

  // Welcome coupon popup (once per session)
  useEffect(() => {
    if (couponQuery.data && !sessionStorage.getItem(COUPON_SEEN_KEY)) {
      setShowCoupon(true)
      sessionStorage.setItem(COUPON_SEEN_KEY, "1")
    }
  }, [couponQuery.data])

  const cartCount = cart.reduce((s, l) => s + l.quantity, 0)
  const subtotal = cart.reduce((s, l) => s + l.item.price * l.quantity, 0)

  function addToCart(item: PublicRetailItem, qty = 1) {
    setCart((cur) => {
      const existing = cur.find((l) => l.item.id === item.id)
      const max = item.currentStock
      if (existing) {
        return cur.map((l) => (l.item.id === item.id ? { ...l, quantity: Math.min(max, l.quantity + qty) } : l))
      }
      return [...cur, { item, quantity: Math.min(max, qty) }]
    })
  }

  function setQty(id: string, qty: number) {
    setCart((cur) =>
      cur
        .map((l) => (l.item.id === id ? { ...l, quantity: Math.max(0, Math.min(l.item.currentStock, qty)) } : l))
        .filter((l) => l.quantity > 0),
    )
  }

  function onOrderPlaced(order: SavedOrder & { customerPhone: string; ordersToken?: string | null }) {
    const { customerPhone: _p, ordersToken: _t, ...saved } = order
    const next = [saved, ...orders]
    setOrders(next)
    localStorage.setItem(ORDERS_KEY, JSON.stringify(next))
    // Persist the private orders token so "طلباتي" works without re-typing the phone.
    if (_t) localStorage.setItem(ORDERS_TOKEN_KEY, _t)
    setCart([])
    // After first order, fetch their referral code and show it
    if (_p) {
      getPublicCustomerReferral(_p).catch(() => {})
    }
  }

  return (
    <div dir="rtl" className="min-h-screen bg-gradient-to-b from-indigo-50 via-slate-50 to-white">
      <div className="mx-auto flex min-h-screen max-w-[480px] flex-col bg-white/60 shadow-xl">
        {/* Header */}
        <header className="sticky top-0 z-20 bg-gradient-to-l from-indigo-600 to-violet-600 px-4 py-4 text-white shadow-lg">
          <div className="flex items-center gap-3">
            {settings?.storeLogo ? (
              <img src={settings.storeLogo} alt="logo" className="h-10 w-10 shrink-0 rounded-xl bg-white/20 object-contain" />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/20"><Store className="h-5 w-5" /></div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-extrabold leading-tight">{storeName}</div>
              <div className="truncate text-[11px] text-white/80">متجر المفرد — اطلب ووصلك لباب البيت</div>
            </div>
          </div>
        </header>

        {/* Body */}
        <main className="flex-1 px-3 pb-24 pt-3">
          {tab === "catalog" && (
            <CatalogView
              loading={catalogQuery.isLoading}
              items={catalogQuery.data ?? []}
              categories={categoriesQuery.data ?? []}
              currency={currency}
              onAdd={(it) => addToCart(it)}
              onOpen={setDetail}
              onShare={shareItem}
            />
          )}
          {tab === "cart" && (
            <CartView
              cart={cart}
              currency={currency}
              storeName={storeName}
              subtotal={subtotal}
              categories={categoriesQuery.data ?? []}
              setQty={setQty}
              onPlaced={onOrderPlaced}
              goCatalog={() => setTab("catalog")}
              referralCode={activeReferralCode}
              referralDiscountPct={referralDiscountPct}
            />
          )}
          {tab === "orders" && <OrdersView orders={orders} currency={currency} goCatalog={() => setTab("catalog")} />}

          {/* Designer credit */}
          {settings?.designerName ? (
            <div className="mt-6 pb-2 text-center text-[11px] text-slate-400">
              تم تصميم هذا الموقع بواسطة {settings.designerName}{settings.designerPhone ? ` — ${settings.designerPhone}` : ""}
            </div>
          ) : null}
        </main>

        {/* Bottom nav */}
        <nav className="fixed bottom-0 left-1/2 z-20 w-full max-w-[480px] -translate-x-1/2 border-t border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex">
            {([
              ["catalog", "الكتلوك", ShoppingBag],
              ["cart", "السلة", ShoppingCart],
              ["orders", "طلباتي", ClipboardList],
            ] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition ${tab === id ? "text-indigo-600" : "text-slate-400"}`}
              >
                <Icon className="h-5 w-5" />
                {label}
                {tab === id && <motion.span layoutId="navdot" className="absolute -bottom-0 h-0.5 w-8 rounded-full bg-indigo-600" />}
                {id === "cart" && cartCount > 0 && (
                  <span className="absolute right-[28%] top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{cartCount}</span>
                )}
              </button>
            ))}
            <button
              type="button"
              onClick={() => window.open("/catalog", "_blank", "noopener,noreferrer")}
              className="relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium text-emerald-600"
            >
              <Users className="h-5 w-5" />
              للجملة
            </button>
          </div>
        </nav>
      </div>

      {/* Item detail modal */}
      <AnimatePresence>
        {detail && (
          <ItemDetailModal
            item={detail}
            currency={currency}
            onClose={() => setDetail(null)}
            onShare={() => shareItem(detail)}
            onAdd={(qty) => { addToCart(detail, qty); setDetail(null); setTab("cart") }}
          />
        )}
      </AnimatePresence>

      {/* AI Chat floating button */}
      <button
        type="button"
        onClick={() => setChatOpen(true)}
        className="fixed bottom-20 left-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 shadow-lg shadow-indigo-300 active:scale-95"
        style={{ left: "calc(50% - 228px)" }}
        aria-label="مساعد التسوق"
      >
        <Bot className="h-6 w-6 text-white" />
      </button>

      {/* AI Chat Panel */}
      <AnimatePresence>
        {chatOpen && (
          <AiChatPanel
            currency={currency}
            onClose={() => setChatOpen(false)}
            onAddToCart={(item) => { addToCart(item); setTab("cart") }}
          />
        )}
      </AnimatePresence>

      {/* Welcome coupon popup */}
      {showCoupon && couponQuery.data && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-6" onClick={() => setShowCoupon(false)}>
          <div className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-white text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setShowCoupon(false)} className="absolute left-3 top-3 text-slate-400"><X className="h-5 w-5" /></button>
            <div className="bg-gradient-to-l from-amber-400 to-orange-500 px-6 py-8 text-white">
              <Gift className="mx-auto h-12 w-12" />
              <div className="mt-2 text-xl font-extrabold">عرض خاص لك! 🎉</div>
            </div>
            <div className="px-6 py-5">
              <div className="text-lg font-bold">{couponQuery.data.name}</div>
              <div className="mt-1 text-3xl font-extrabold text-orange-600">
                {couponQuery.data.discountType === "PERCENT" ? `${couponQuery.data.discountValue}%` : `${money(couponQuery.data.discountValue)} ${currency}`}
              </div>
              <div className="mt-3 rounded-xl border-2 border-dashed border-orange-300 bg-orange-50 px-4 py-2 font-mono text-lg font-bold tracking-widest text-orange-700">
                {couponQuery.data.code}
              </div>
              <p className="mt-3 text-xs text-slate-500">استخدم الكود عند إتمام الطلب للحصول على الخصم</p>
              <button type="button" onClick={() => setShowCoupon(false)} className="mt-4 w-full rounded-xl bg-indigo-600 py-3 font-bold text-white">تسوّق الآن</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Catalog ───────────────────────────────────────────────────────────────────
type Collection = "all" | "best" | "offers" | "new"

function discountPct(item: PublicRetailItem): number | null {
  if (item.oldPrice && item.oldPrice > item.price) return Math.round((1 - item.price / item.oldPrice) * 100)
  return null
}

function sameLabel(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function labelKey(value: string) {
  return value.trim().toLowerCase()
}

function CatalogView({ loading, items, categories, currency, onAdd, onOpen, onShare }: {
  loading: boolean
  items: PublicRetailItem[]
  categories: PublicRetailCategory[]
  currency: string
  onAdd: (item: PublicRetailItem) => void
  onOpen: (item: PublicRetailItem) => void
  onShare: (item: PublicRetailItem) => void
}) {
  const [collection, setCollection] = useState<Collection>("all")
  const [category, setCategory] = useState<string | null>(null)
  const [subCategory, setSubCategory] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<"default" | "price-asc" | "price-desc" | "discount" | "newest" | "name-asc">("default")
  const COL_CYCLE = [3, 2, 4, 5]
  const [cols, setCols] = useState(3)
  function cycleCols() {
    setCols((c) => COL_CYCLE[(COL_CYCLE.indexOf(c) + 1) % COL_CYCLE.length] ?? 3)
  }

  const featured = useMemo(() => items.filter((i) => i.featured).slice(0, 10), [items])
  const visibleCategories = useMemo(() => {
    const map = new Map<string, { name: string; subCategories: Set<string> }>()
    const definedSubsByCategory = new Map<string, Set<string>>()

    function ensure(name: string) {
      const trimmed = name.trim()
      if (!trimmed) return null
      const key = labelKey(trimmed)
      const found = map.get(key)
      if (found) return found
      const next = { name: trimmed, subCategories: new Set<string>() }
      map.set(key, next)
      return next
    }

    for (const c of categories) {
      const entry = ensure(c.name)
      if (!entry) continue
      const defined = new Set<string>()
      for (const sub of c.subCategories) {
        const trimmed = sub.trim()
        if (!trimmed) continue
        entry.subCategories.add(trimmed)
        defined.add(labelKey(trimmed))
      }
      definedSubsByCategory.set(labelKey(c.name), defined)
    }

    for (const item of items) {
      const itemCategories = item.categories.map((c) => c.trim()).filter(Boolean)
      const itemSubs = item.subCategories.map((s) => s.trim()).filter(Boolean)
      for (const cat of itemCategories) {
        const entry = ensure(cat)
        if (!entry) continue
        const defined = definedSubsByCategory.get(labelKey(cat))
        for (const sub of itemSubs) {
          if (!defined || defined.size === 0 || defined.has(labelKey(sub))) entry.subCategories.add(sub)
        }
      }
      if (itemCategories.length === 0 && itemSubs.length > 0) {
        for (const sub of itemSubs) {
          const owner = [...map.values()].find((cat) => [...cat.subCategories].some((s) => sameLabel(s, sub)))
          if (owner) owner.subCategories.add(sub)
        }
      }
    }

    return [...map.values()].map((c) => ({ name: c.name, subCategories: [...c.subCategories] }))
  }, [categories, items])

  // An item belongs to a main category if it's tagged with that category OR with
  // any sub-category that lives under it — so items the admin only tagged at the
  // sub-category level still appear (this was the root cause of "missing" items).
  const catSubs = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const c of visibleCategories) m.set(c.name, new Set(c.subCategories.map((s) => s.trim()).filter(Boolean)))
    return m
  }, [visibleCategories])

  const belongsTo = useCallback((item: PublicRetailItem, cat: string) => {
    if (item.categories.some((c) => sameLabel(c, cat))) return true
    const subs = catSubs.get(cat)
    return subs ? item.subCategories.some((s) => subs.has(s.trim())) : false
  }, [catSubs])

  // Item count per main category (hide empty categories from the bar).
  const catCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of visibleCategories) m.set(c.name, items.filter((it) => belongsTo(it, c.name)).length)
    return m
  }, [visibleCategories, items, belongsTo])

  // Sub-categories under the active category that actually have items, with counts.
  const subOptions = useMemo(() => {
    if (!category) return [] as { name: string; count: number }[]
    const defined = visibleCategories.find((c) => sameLabel(c.name, category))?.subCategories ?? []
    const counts = new Map<string, number>()
    const labels = new Map<string, string>()
    for (const s of defined) {
      const trimmed = s.trim()
      if (trimmed) labels.set(trimmed.toLowerCase(), trimmed)
    }
    for (const it of items) {
      if (!belongsTo(it, category)) continue
      for (const s of it.subCategories) {
        const trimmed = s.trim()
        if (!trimmed) continue
        const key = labelKey(trimmed)
        const label = labels.get(key)
        if (!label) continue
        labels.set(key, label)
        counts.set(label, (counts.get(label) ?? 0) + 1)
      }
    }
    return [...labels.values()].map((s) => ({ name: s, count: counts.get(s) ?? 0 }))
  }, [visibleCategories, items, category, belongsTo])

  const searching = search.trim().length > 0

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      // While searching, look across the WHOLE store (ignore collection/category).
      if (q) {
        return (
          item.title.toLowerCase().includes(q) ||
          (item.description ?? "").toLowerCase().includes(q) ||
          item.categories.some((c) => c.toLowerCase().includes(q)) ||
          item.subCategories.some((s) => s.toLowerCase().includes(q))
        )
      }
      if (collection === "best" && !item.isBestSeller) return false
      if (collection === "offers" && !item.isOffer) return false
      if (collection === "new" && !item.isNew) return false
      if (category && !belongsTo(item, category)) return false
      if (subCategory && !subOptions.some((s) => sameLabel(s.name, subCategory))) return false
      if (subCategory && !item.subCategories.some((s) => sameLabel(s, subCategory))) return false
      return true
    })
  }, [items, collection, category, subCategory, search, belongsTo, subOptions])

  // Sort the filtered list. "default" keeps the catalog's own order.
  const sorted = useMemo(() => {
    if (sort === "default") return filtered
    const arr = [...filtered]
    if (sort === "price-asc") arr.sort((a, b) => a.price - b.price)
    else if (sort === "price-desc") arr.sort((a, b) => b.price - a.price)
    else if (sort === "discount") arr.sort((a, b) => (discountPct(b) ?? 0) - (discountPct(a) ?? 0))
    else if (sort === "newest") arr.sort((a, b) => Number(b.isNew) - Number(a.isNew) || a.title.localeCompare(b.title, "ar"))
    else if (sort === "name-asc") arr.sort((a, b) => a.title.localeCompare(b.title, "ar"))
    return arr
  }, [filtered, sort])

  const collections: { id: Collection; label: string; icon?: typeof TrendingUp }[] = [
    { id: "all", label: "الكل" },
    { id: "best", label: "الأكثر مبيعاً", icon: TrendingUp },
    { id: "offers", label: "العروض", icon: Tag },
    { id: "new", label: "الجديد", icon: Sparkles },
  ]

  if (loading) return <div className="py-16 text-center text-slate-400">جاري التحميل...</div>
  if (items.length === 0) return (
    <div className="py-16 text-center text-slate-400">
      <Package className="mx-auto h-12 w-12 opacity-40" />
      <p className="mt-2">لا توجد مواد متاحة حالياً.</p>
    </div>
  )

  return (
    <div className="space-y-3">
      {/* Hero carousel stays fixed; filters below only change the product grid. */}
      {featured.length > 0 && (
        <div className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1">
          {featured.map((item) => {
            const pct = discountPct(item)
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpen(item)}
                className="relative h-40 w-[78%] shrink-0 snap-center overflow-hidden rounded-2xl bg-slate-200"
              >
                {item.images[0] ? <img src={item.images[0]} alt={item.title} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-slate-300"><Package className="h-10 w-10" /></div>}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 text-right">
                  <div className="text-sm font-bold text-white">{item.title}</div>
                  <div className="text-base font-extrabold text-white">{money(item.price)} {currency}</div>
                </div>
                {pct ? <span className="absolute right-2 top-2 rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-bold text-white">-{pct}%</span> : null}
              </button>
            )
          })}
        </div>
      )}

      {/* Search bar (always visible) — searches the whole store */}
      <div className="flex items-center gap-2">
        <div className={`flex flex-1 items-center gap-2 rounded-2xl border bg-white px-3 transition ${searching ? "border-indigo-300 ring-2 ring-indigo-100" : "border-slate-200"}`}>
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث في كل المتجر…"
            className="flex-1 bg-transparent py-2.5 text-sm outline-none"
          />
          {searching && <button type="button" onClick={() => setSearch("")} aria-label="مسح البحث"><X className="h-4 w-4 text-slate-400" /></button>}
        </div>
        <button type="button" onClick={cycleCols} className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-500" title="عدد المنتجات بالسطر" aria-label="تغيير عدد الأعمدة">
          <LayoutGrid className="h-4 w-4" /> {cols}
        </button>
      </div>

      {/* Sort bar */}
      <div className="rounded-2xl border border-slate-100 bg-white p-2 shadow-sm">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
          <ArrowDownUp className="h-4 w-4 shrink-0 text-slate-400" />
          <span>فرز المنتجات</span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {([
            ["default", "ترتيب المتجر"],
            ["price-asc", "السعر: الأقل"],
            ["price-desc", "السعر: الأعلى"],
            ["discount", "أعلى خصم"],
            ["newest", "الجديد"],
            ["name-asc", "الاسم"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSort(id)}
              className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold transition ${sort === id ? "bg-emerald-600 text-white shadow-sm" : "bg-white text-slate-500 ring-1 ring-slate-200"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Collections + categories hidden while searching (search is global) */}
      {!searching && (
        <>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {collections.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCollection(c.id)}
                className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${collection === c.id ? "bg-indigo-600 text-white shadow-sm" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}
              >
                {c.icon ? <c.icon className="h-3.5 w-3.5" /> : null}{c.label}
              </button>
            ))}
          </div>

          {categories.length > 0 && (
            <div className="space-y-2">
              {/* Main categories — show only non-empty, with counts */}
              <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                <button
                  type="button"
                  onClick={() => { setCollection("all"); setCategory(null); setSubCategory(null) }}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${!category ? "bg-slate-900 text-white shadow-sm" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}
                >
                  كل الأقسام
                </button>
                {visibleCategories.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => {
                      const next = category === c.name ? null : c.name
                      setCollection("all")
                      setCategory(next)
                      setSubCategory(null)
                    }}
                    className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${category === c.name ? "bg-slate-900 text-white shadow-sm" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}
                  >
                    {c.name}
                    <span className={`rounded-full px-1.5 text-[10px] ${category === c.name ? "bg-white/20" : "bg-slate-100 text-slate-400"}`}>{catCounts.get(c.name) ?? 0}</span>
                  </button>
                ))}
              </div>

              {/* Sub-categories of the active category — only non-empty, with counts */}
              {category && subOptions.length > 0 && (
                <div className="flex gap-1.5 overflow-x-auto rounded-xl bg-indigo-50/60 p-1.5">
                  <button type="button" onClick={() => setSubCategory(null)} className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold transition ${!subCategory ? "bg-indigo-600 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200"}`}>الكل</button>
                  {subOptions.map((s) => (
                    <button key={s.name} type="button" onClick={() => setSubCategory(subCategory === s.name ? null : s.name)} className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold transition ${subCategory === s.name ? "bg-indigo-600 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200"}`}>
                      {s.name}
                      <span className={`rounded-full px-1 text-[9px] ${subCategory === s.name ? "bg-white/20" : "bg-slate-100 text-slate-400"}`}>{s.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Result count while searching */}
      {searching && (
        <div className="text-xs text-slate-500">نتائج البحث في كل المتجر: <span className="font-bold text-slate-700">{filtered.length}</span></div>
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center text-sm text-slate-400">
          <Package className="h-10 w-10 opacity-30" />
          <p>لا توجد مواد مطابقة.</p>
          {(category || subCategory || collection !== "all" || searching) && (
            <button
              type="button"
              onClick={() => { setCategory(null); setSubCategory(null); setCollection("all"); setSearch("") }}
              className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white"
            >
              عرض كل المواد
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {sorted.map((item) => {
            const pct = discountPct(item)
            return (
              <div
                key={item.id}
                className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <button type="button" onClick={() => onOpen(item)} className="relative block aspect-square w-full bg-slate-100">
                  {item.images[0] ? <img src={item.images[0]} alt={item.title} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-slate-300"><Package className="h-8 w-8" /></div>}
                  {pct ? <span className="absolute right-1.5 top-1.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">-{pct}%</span> : null}
                  {item.lowStockBadge ? <span className="absolute left-1.5 top-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-white">كمية قليلة</span> : null}
                  {!item.lowStockBadge && item.isNew ? <span className="absolute left-1.5 top-1.5 rounded-full bg-blue-500 px-1.5 py-0.5 text-[9px] font-bold text-white">جديد</span> : null}
                </button>
                <div className="p-1.5">
                  <div className={`line-clamp-1 font-bold leading-tight ${cols <= 2 ? "text-sm" : "text-xs"}`}>{item.title}</div>
                  <div className="flex items-baseline gap-1">
                    <span className={`font-extrabold text-indigo-600 ${cols <= 2 ? "text-sm" : "text-xs"}`}>{money(item.price)}</span>
                    <span className="text-[9px] text-slate-400">{currency}</span>
                    {pct ? <span className="text-[10px] text-slate-400 line-through">{money(item.oldPrice!)}</span> : null}
                  </div>
                  {cols <= 2 && item.description ? <div className="line-clamp-1 text-[10px] text-slate-400">{item.description}</div> : null}
                  <div className="mt-1 flex items-center gap-1">
                    <button type="button" onClick={() => onAdd(item)} className="flex flex-1 items-center justify-center gap-0.5 rounded-lg bg-indigo-600 py-1.5 text-[11px] font-bold text-white active:scale-95">
                      <Plus className="h-3.5 w-3.5" /> {cols >= 4 ? "" : "أضف"}
                    </button>
                    {cols <= 3 && (
                      <button type="button" onClick={() => onShare(item)} className="rounded-lg bg-emerald-50 p-1.5 text-emerald-600" title="مشاركة واتساب">
                        <Share2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ItemDetailModal({ item, currency, onClose, onAdd, onShare }: {
  item: PublicRetailItem
  currency: string
  onClose: () => void
  onAdd: (qty: number) => void
  onShare: () => void
}) {
  const [active, setActive] = useState(0)
  const [qty, setQty] = useState(1)
  const pct = item.oldPrice && item.oldPrice > item.price ? Math.round((1 - item.price / item.oldPrice) * 100) : null

  // Hardware/browser back button closes the modal instead of leaving the page,
  // returning the user to the exact spot they were browsing.
  useEffect(() => {
    window.history.pushState({ retailDetail: true }, "")
    const onPop = () => onClose()
    window.addEventListener("popstate", onPop)
    return () => {
      window.removeEventListener("popstate", onPop)
      // If the modal closed without a back event, consume the pushed entry.
      if (window.history.state?.retailDetail) window.history.back()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <motion.div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="max-h-[90vh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl bg-white sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
      >
        <div className="relative aspect-square bg-slate-100">
          {item.images[active] ? (
            <img src={item.images[active]} alt={item.title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-slate-300"><Package className="h-16 w-16" /></div>
          )}
          <button type="button" onClick={onClose} className="absolute left-3 top-3 rounded-full bg-black/40 p-2 text-white"><X className="h-5 w-5" /></button>
        </div>
        {item.images.length > 1 && (
          <div className="flex gap-2 overflow-x-auto px-4 pt-3">
            {item.images.map((img, i) => (
              <button key={i} type="button" onClick={() => setActive(i)} className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg ring-2 ${active === i ? "ring-indigo-500" : "ring-transparent"}`}>
                <img src={img} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
        <div className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="text-xl font-extrabold">{item.title}</div>
            <button type="button" onClick={onShare} className="shrink-0 rounded-lg bg-emerald-50 p-2 text-emerald-600" title="مشاركة واتساب"><Share2 className="h-5 w-5" /></button>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-indigo-600">{money(item.price)} <span className="text-sm font-normal text-slate-400">{currency}</span></span>
            {pct ? <><span className="text-base text-slate-400 line-through">{money(item.oldPrice!)}</span><span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-bold text-white">-{pct}%</span></> : null}
          </div>
          {item.description ? <p className="text-sm leading-relaxed text-slate-600">{item.description}</p> : null}
          <div className="text-xs text-emerald-600">متوفر: {item.currentStock} قطعة</div>

          <div className="flex items-center justify-center gap-4 rounded-xl bg-slate-50 py-2">
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="rounded-full bg-white p-2 shadow"><Minus className="h-4 w-4" /></button>
            <span className="w-10 text-center text-lg font-bold">{qty}</span>
            <button type="button" onClick={() => setQty((q) => Math.min(item.currentStock, q + 1))} className="rounded-full bg-white p-2 shadow"><Plus className="h-4 w-4" /></button>
          </div>

          <button type="button" onClick={() => onAdd(qty)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3.5 font-bold text-white active:scale-95">
            <ShoppingCart className="h-5 w-5" /> أضف للسلة — {money(item.price * qty)} {currency}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Cart + Checkout ─────────────────────────────────────────────────────────
function CartView({ cart, currency, storeName, subtotal, categories, setQty, onPlaced, goCatalog, referralCode, referralDiscountPct }: {
  cart: CartLine[]
  currency: string
  categories: PublicRetailCategory[]
  storeName: string
  subtotal: number
  setQty: (id: string, qty: number) => void
  onPlaced: (order: SavedOrder & { customerPhone: string; ordersToken?: string | null }) => void
  goCatalog: () => void
  referralCode: string | null
  referralDiscountPct: number
}) {
  const [couponCode, setCouponCode] = useState("")
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discount: number } | null>(null)
  const [couponError, setCouponError] = useState("")
  const [couponLoading, setCouponLoading] = useState(false)

  const [checkout, setCheckout] = useState(false)
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [address, setAddress] = useState("")
  const [notes, setNotes] = useState("")
  const [placing, setPlacing] = useState(false)
  const [placeError, setPlaceError] = useState("")
  const [success, setSuccess] = useState<{ orderNumber: string } | null>(null)

  // Loyalty / survey
  const [isSubscriber, setIsSubscriber] = useState(false)
  const [showSurvey, setShowSurvey] = useState(false)
  const [interests, setInterests] = useState<string[]>([])
  const [wishNote, setWishNote] = useState("")
  const allInterestOptions = useMemo(
    () => [...new Set(categories.flatMap((c) => [c.name, ...c.subCategories]))],
    [categories],
  )
  function toggleInterest(v: string) {
    setInterests((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]))
  }

  const couponDiscount = appliedCoupon?.discount ?? 0
  const referralDiscount = referralCode ? Math.round((subtotal * referralDiscountPct) / 100) : 0
  const total = Math.max(0, subtotal - couponDiscount - referralDiscount)

  async function applyCoupon() {
    if (!couponCode.trim()) return
    setCouponLoading(true)
    setCouponError("")
    try {
      const res = await previewPublicRetailCoupon(couponCode.trim(), subtotal)
      setAppliedCoupon({ code: res.code, discount: res.discount })
    } catch (e) {
      setAppliedCoupon(null)
      setCouponError(e instanceof Error ? e.message : "كوبون غير صالح")
    } finally {
      setCouponLoading(false)
    }
  }

  async function placeOrder() {
    setPlacing(true)
    setPlaceError("")
    try {
      const res = await submitPublicRetailOrder({
        customerName: name.trim(),
        phone: phone.trim(),
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
        couponCode: appliedCoupon?.code,
        referralCode: referralCode ?? undefined,
        isSubscriber,
        interests: isSubscriber ? interests : undefined,
        wishNote: isSubscriber && wishNote.trim() ? wishNote.trim() : undefined,
        items: cart.map((l) => ({ retailItemId: l.item.id, quantity: l.quantity })),
      })
      setSuccess({ orderNumber: res.orderNumber })
      onPlaced({ id: res.id, orderNumber: res.orderNumber, total: res.total, createdAt: new Date().toISOString(), customerPhone: phone.trim(), ordersToken: res.ordersToken })
    } catch (e) {
      setPlaceError(e instanceof Error ? e.message : "تعذر إرسال الطلب")
    } finally {
      setPlacing(false)
    }
  }

  if (success) {
    return <SuccessScreen orderNumber={success.orderNumber} customerPhone={phone} goCatalog={goCatalog} />
  }

  if (cart.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center text-slate-400">
        <ShoppingCart className="h-14 w-14 opacity-40" />
        <p className="mt-3">سلتك فارغة</p>
        <button type="button" onClick={goCatalog} className="mt-4 flex items-center gap-1 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white">
          تصفح الكتلوك <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {cart.map((line) => (
        <div key={line.item.id} className="flex gap-3 rounded-2xl border border-slate-100 bg-white p-2.5 shadow-sm">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-100">
            {line.item.images[0] ? <img src={line.item.images[0]} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-slate-300"><Package className="h-6 w-6" /></div>}
          </div>
          <div className="flex flex-1 flex-col justify-between">
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-bold leading-tight">{line.item.title}</div>
              <button type="button" onClick={() => setQty(line.item.id, 0)} className="text-rose-400"><Trash2 className="h-4 w-4" /></button>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setQty(line.item.id, line.quantity - 1)} className="rounded-lg bg-slate-100 p-1.5"><Minus className="h-3.5 w-3.5" /></button>
                <span className="w-7 text-center font-bold">{line.quantity}</span>
                <button type="button" onClick={() => setQty(line.item.id, line.quantity + 1)} className="rounded-lg bg-slate-100 p-1.5"><Plus className="h-3.5 w-3.5" /></button>
              </div>
              <div className="font-extrabold text-indigo-600">{money(line.item.price * line.quantity)}</div>
            </div>
          </div>
        </div>
      ))}

      {/* Coupon */}
      <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-600"><Tag className="h-4 w-4 text-orange-500" /> كوبون الخصم</div>
        <div className="flex gap-2">
          <input
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
            placeholder="أدخل كود الخصم"
            dir="ltr"
            className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
          <button type="button" onClick={() => void applyCoupon()} disabled={couponLoading} className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
            {couponLoading ? "..." : "تطبيق"}
          </button>
        </div>
        {appliedCoupon ? <div className="mt-2 text-xs font-semibold text-emerald-600">✓ تم تطبيق خصم {money(appliedCoupon.discount)} {currency}</div> : null}
        {couponError ? <div className="mt-2 text-xs text-rose-600">{couponError}</div> : null}
      </div>

      {/* Referral banner */}
      {referralCode && referralDiscountPct > 0 && (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
          <Link2 className="h-4 w-4 shrink-0" />
          خصم الإحالة {referralDiscountPct}% مطبّق على طلبك! 🎉
        </div>
      )}

      {/* Totals */}
      <div className="rounded-2xl border border-slate-100 bg-white p-3 text-sm shadow-sm">
        <div className="flex justify-between py-1"><span className="text-slate-500">المجموع</span><span className="font-semibold">{money(subtotal)} {currency}</span></div>
        {couponDiscount > 0 && <div className="flex justify-between py-1 text-emerald-600"><span>خصم الكوبون</span><span>- {money(couponDiscount)} {currency}</span></div>}
        {referralDiscount > 0 && <div className="flex justify-between py-1 text-emerald-600"><span>خصم الإحالة {referralDiscountPct}%</span><span>- {money(referralDiscount)} {currency}</span></div>}
        <div className="mt-1 flex justify-between border-t border-slate-100 pt-2 text-lg font-extrabold"><span>الإجمالي</span><span className="text-indigo-600">{money(total)} {currency}</span></div>
      </div>

      <button type="button" onClick={() => setCheckout(true)} className="w-full rounded-2xl bg-indigo-600 py-3.5 font-bold text-white active:scale-95">
        إتمام الطلب
      </button>

      {/* Checkout mini-dialog */}
      {checkout && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center" onClick={() => !placing && setCheckout(false)}>
          <div className="w-full max-w-[480px] rounded-t-3xl bg-white p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()} dir="rtl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-extrabold">بيانات التوصيل</h3>
              <button type="button" onClick={() => !placing && setCheckout(false)} className="text-slate-400"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="الاسم" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="رقم الهاتف" dir="ltr" inputMode="tel" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="العنوان (المنطقة، أقرب نقطة دالة)" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات (اختياري)" rows={2} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />

              {/* Loyalty opt-in */}
              <label className="flex cursor-pointer items-start gap-2 rounded-xl bg-indigo-50 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={isSubscriber}
                  onChange={(e) => { setIsSubscriber(e.target.checked); if (e.target.checked) setShowSurvey(false) }}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  <span className="font-bold text-indigo-700">أحب أكون من الزبائن الدائمين 💜</span>
                  <span className="block text-[11px] text-indigo-600/80">لتوصلك إشعارات بالجديد وخصومات قوية</span>
                </span>
              </label>

              {isSubscriber && !showSurvey && allInterestOptions.length > 0 && (
                <button type="button" onClick={() => setShowSurvey(true)} className="w-full rounded-xl border border-dashed border-indigo-300 py-2 text-xs font-semibold text-indigo-600">
                  اكو استبيان صغير اختياري — تحب تكمله؟ (يساعدنا نرسلك الي يهمك)
                </button>
              )}

              {isSubscriber && showSurvey && (
                <div className="space-y-2 rounded-xl border border-indigo-100 p-3">
                  <div className="text-xs font-semibold text-slate-600">شنو يهمك؟ (اختر التصنيفات)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {allInterestOptions.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => toggleInterest(opt)}
                        className={`rounded-full px-2.5 py-1 text-[11px] transition ${interests.includes(opt) ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                  <input
                    value={wishNote}
                    onChange={(e) => setWishNote(e.target.value)}
                    placeholder="شي تدوّر عليه وما لگيته؟ (اختياري)"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
              )}

              {placeError ? <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-600">{placeError}</div> : null}
              <button
                type="button"
                disabled={name.trim().length < 2 || phone.trim().length < 5 || placing}
                onClick={() => void placeOrder()}
                className="w-full rounded-2xl bg-emerald-600 py-3.5 font-bold text-white disabled:opacity-50 active:scale-95"
              >
                {placing ? "جاري الإرسال..." : `تأكيد الطلب — ${money(total)} ${currency}`}
              </button>
              <p className="text-center text-[11px] text-slate-400">سيتم تجهيز طلبك من {storeName} وإرساله إليك</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Orders tracking ───────────────────────────────────────────────────────────
function statusBlock(status: string) {
  if (status === "PREPARED") return (
    <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-emerald-700">
      <Truck className="h-5 w-5" /><span className="text-sm font-bold">تم التجهيز — طلبك في الطريق إليك 🚗</span>
    </div>
  )
  if (status === "CANCELLED") return (
    <div className="flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-rose-700">
      <X className="h-5 w-5" /><span className="text-sm font-bold">تم إلغاء الطلب</span>
    </div>
  )
  return (
    <div className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-amber-700">
      <Package className="h-5 w-5 animate-pulse" /><span className="text-sm font-bold">قيد التجهيز — سنرسله إليك قريباً</span>
    </div>
  )
}

function OrdersView({ orders, currency, goCatalog }: { orders: SavedOrder[]; currency: string; goCatalog: () => void }) {
  const [phoneInput, setPhoneInput] = useState("")
  const [lookupPhone, setLookupPhone] = useState("")
  const [copied, setCopied] = useState(false)
  const token = useMemo(() => localStorage.getItem(ORDERS_TOKEN_KEY) ?? "", [])

  // Private link: load this customer's orders by their secret token (no phone needed).
  const byTokenQuery = useQuery({
    queryKey: ["public-retail-my-orders-token", token],
    queryFn: () => getPublicRetailOrdersByToken(token),
    enabled: token.length > 0,
    refetchInterval: 30_000,
  })
  const tokenOrders = byTokenQuery.data?.orders ?? []

  const byPhoneQuery = useQuery({
    queryKey: ["public-retail-my-orders", lookupPhone],
    queryFn: () => getPublicRetailOrdersByPhone(lookupPhone),
    enabled: lookupPhone.replace(/\D/g, "").length >= 6,
    refetchInterval: 30_000,
  })
  const phoneOrders = byPhoneQuery.data ?? []

  const ordersLink = token ? `${window.location.origin}/shop?orders=${token}` : null
  function copyLink() {
    if (!ordersLink) return
    navigator.clipboard.writeText(ordersLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="space-y-3">
      {/* Private orders link (secret token) */}
      {ordersLink && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-right shadow-sm">
          <div className="mb-1 flex items-center gap-1.5 text-sm font-bold text-emerald-700"><Link2 className="h-4 w-4" /> رابط طلباتي الخاص</div>
          <p className="mb-2 text-[11px] text-emerald-600">احفظ هذا الرابط لمتابعة طلباتك من أي جهاز بدون كتابة رقمك.</p>
          <div className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-white px-3 py-2">
            <span className="flex-1 overflow-hidden text-ellipsis text-[11px] text-slate-600" dir="ltr">{ordersLink}</span>
            <button type="button" onClick={copyLink} className="shrink-0 rounded-lg bg-emerald-600 p-1.5 text-white">
              {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}

      {/* Orders loaded via the private token */}
      {token && byTokenQuery.isLoading && <div className="py-6 text-center text-sm text-slate-400">جاري التحميل...</div>}
      {tokenOrders.map((order) => (
        <motion.div key={order.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="font-mono font-bold text-indigo-600">{order.orderNumber}</span>
            <span className="text-sm font-extrabold">{money(order.total)} {currency}</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">{new Date(order.createdAt).toLocaleString("en-GB")}</div>
          <div className="mt-3">{statusBlock(order.status)}</div>
        </motion.div>
      ))}

      {/* Phone lookup (fallback for customers without the saved link) */}
      <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-600"><Phone className="h-4 w-4 text-indigo-500" /> أو اعرض طلباتك برقم الهاتف</div>
        <div className="flex gap-2">
          <input
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            placeholder="اكتب رقم هاتفك"
            dir="ltr"
            inputMode="tel"
            className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
          <button type="button" onClick={() => setLookupPhone(phoneInput.trim())} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white">عرض</button>
        </div>
      </div>

      {lookupPhone && byPhoneQuery.isLoading && <div className="py-6 text-center text-sm text-slate-400">جاري البحث...</div>}
      {lookupPhone && !byPhoneQuery.isLoading && phoneOrders.length === 0 && (
        <div className="py-6 text-center text-sm text-slate-400">لا توجد طلبات لهذا الرقم.</div>
      )}

      {phoneOrders.map((order) => (
        <motion.div key={order.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="font-mono font-bold text-indigo-600">{order.orderNumber}</span>
            <span className="text-sm font-extrabold">{money(order.total)} {currency}</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">{new Date(order.createdAt).toLocaleString("en-GB")}</div>
          <div className="mt-3">{statusBlock(order.status)}</div>
        </motion.div>
      ))}

      {/* Locally-saved orders from this device (only when neither lookup is active) */}
      {!lookupPhone && !token && orders.length === 0 && (
        <div className="flex flex-col items-center justify-center px-6 py-12 text-center text-slate-400">
          <ClipboardList className="h-14 w-14 opacity-40" />
          <p className="mt-3">لا توجد طلبات على هذا الجهاز — اكتب رقمك أعلاه لعرض طلباتك</p>
          <button type="button" onClick={goCatalog} className="mt-4 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white">ابدأ التسوّق</button>
        </div>
      )}
      {!lookupPhone && !token && orders.map((order) => <OrderStatusCard key={order.id} order={order} currency={currency} />)}
    </div>
  )
}

function OrderStatusCard({ order, currency }: { order: SavedOrder; currency: string }) {
  const statusQuery = useQuery({
    queryKey: ["public-retail-order", order.id],
    queryFn: () => getPublicRetailOrderStatus(order.id),
    refetchInterval: 30_000,
  })
  const status = statusQuery.data?.status ?? "PENDING"

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-mono font-bold text-indigo-600">{order.orderNumber}</span>
        <span className="text-sm font-extrabold">{money(order.total)} {currency}</span>
      </div>
      <div className="mt-1 text-[11px] text-slate-400">{new Date(order.createdAt).toLocaleString("en-GB")}</div>
      <div className="mt-3">{statusBlock(status)}</div>
    </div>
  )
}

// ── Success Screen (with referral link) ───────────────────────────────────────
function SuccessScreen({ orderNumber, customerPhone, goCatalog }: { orderNumber: string; customerPhone: string; goCatalog: () => void }) {
  const [phone, setPhone] = useState(customerPhone)
  const [referralInfo, setReferralInfo] = useState<{ referralCode: string; discountPercent: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState("")

  // Auto-fetch when phone is known (delay gives backend time to finish upsert)
  useEffect(() => {
    if (!customerPhone || customerPhone.replace(/\D/g, "").length < 7) return
    const t = setTimeout(() => { void fetchReferral(customerPhone) }, 1800)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerPhone])

  async function fetchReferral(phoneToFetch = phone) {
    const digits = phoneToFetch.replace(/\D/g, "")
    if (digits.length < 7) { setFetchError("أدخل رقم هاتف صحيح"); return }
    setFetching(true)
    setFetchError("")
    try {
      const info = await getPublicCustomerReferral(phoneToFetch.trim())
      if (info) {
        setReferralInfo(info)
      } else {
        setFetchError("لم يُعثر على حساب بهذا الرقم. تأكد من الرقم وحاول مجدداً.")
      }
    } catch {
      setFetchError("تعذّر جلب رابط الإحالة. تحقق من اتصالك وحاول مجدداً.")
    } finally {
      setFetching(false)
    }
  }

  const referralLink = referralInfo
    ? `${window.location.origin}/shop?ref=${referralInfo.referralCode}`
    : null

  function copyLink() {
    if (!referralLink) return
    navigator.clipboard.writeText(referralLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
        <CheckCircle2 className="h-12 w-12 text-emerald-600" />
      </div>
      <h2 className="mt-4 text-xl font-extrabold">تم تثبيت طلبك! 🎉</h2>
      <p className="mt-1 text-sm text-slate-500">رقم الطلب <span className="font-mono font-bold text-indigo-600">{orderNumber}</span></p>
      <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-600">
        سوف يتم التجهيز بكل حب وإرساله إليك بأسرع وقت ❤️
      </p>

      {!referralInfo && (
        <div className="mt-6 w-full rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-right">
          <div className="mb-1 flex items-center gap-2 text-sm font-bold text-indigo-700">
            <Link2 className="h-4 w-4" /> احصل على رابط إحالتك الخاص
          </div>
          <p className="mb-3 text-xs text-indigo-600">شارك رابطك مع أصدقائك — كل طلب يجيك منه يحصلون كلاهم خصم تلقائي!</p>
          <div className="flex gap-2">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="رقم هاتفك"
              dir="ltr"
              inputMode="tel"
              className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            />
            <button type="button" onClick={() => void fetchReferral()} disabled={fetching} className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
              {fetching ? <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : "أظهر"}
            </button>
          </div>
          {fetchError && <p className="mt-2 text-xs text-rose-600">{fetchError}</p>}
        </div>
      )}

      {referralInfo && referralLink && (
        <div className="mt-6 w-full rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-right">
          <div className="mb-1 flex items-center gap-2 text-sm font-bold text-emerald-700">
            <Link2 className="h-4 w-4" /> رابط إحالتك الخاص 🎁
          </div>
          <p className="mb-3 text-xs text-emerald-600">
            كل شخص يطلب من رابطك يحصل على خصم <span className="font-bold">{referralInfo.discountPercent}%</span> — وأنت أيضاً!
          </p>
          <div className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-white px-3 py-2">
            <span className="flex-1 overflow-hidden text-ellipsis text-[11px] text-slate-600" dir="ltr">{referralLink}</span>
            <button type="button" onClick={copyLink} className="shrink-0 rounded-lg bg-emerald-600 p-1.5 text-white">
              {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <button
            type="button"
            onClick={() => window.open(
              `https://wa.me/?text=${encodeURIComponent(`🛍️ تسوّق وحصّل خصم ${referralInfo.discountPercent}% من هذا الرابط الخاص! ${referralLink}`)}`,
              "_blank", "noopener,noreferrer"
            )}
            className="mt-2 w-full rounded-xl bg-[#25D366] py-2 text-sm font-bold text-white"
          >
            شارك على واتساب
          </button>
        </div>
      )}

      <button type="button" onClick={goCatalog} className="mt-6 rounded-xl bg-indigo-600 px-6 py-3 font-bold text-white">
        متابعة التسوّق
      </button>
    </div>
  )
}

// ── AI Chat Panel ─────────────────────────────────────────────────────────────
type AiMessage = { role: "user" | "assistant"; content: string; products?: AiChatProduct[] }

function AiChatPanel({ currency, onClose, onAddToCart }: {
  currency: string
  onClose: () => void
  onAddToCart: (item: PublicRetailItem) => void
}) {
  const [messages, setMessages] = useState<AiMessage[]>([
    { role: "assistant", content: "أهلاً! أنا مساعدك للتسوق 🛍️ قولي شنو تدوّر — هدية، عمر، ميزانية — وأساعدك تلگي الشي المناسب 😊" }
  ])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    setInput("")
    setMessages((prev) => [...prev, { role: "user" as const, content: text }])
    setLoading(true)
    try {
      const history = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }))
      const res = await retailAiChat(text, history)
      setMessages((prev) => [...prev, { role: "assistant" as const, content: res.message, products: res.products }])
    } catch {
      setMessages((prev) => [...prev, { role: "assistant" as const, content: "آسف، صار خطأ. حاول مرة ثانية 🙏" }])
    } finally {
      setLoading(false)
    }
  }

  function toRetailItem(p: AiChatProduct): PublicRetailItem {
    return {
      id: p.id, title: p.title, description: null, price: p.price, oldPrice: p.oldPrice,
      categories: [], subCategories: [], images: p.images,
      featured: false, isBestSeller: false, isNew: false, isOffer: false,
      lowStockBadge: false, currentStock: p.currentStock,
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: "100%" }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: "100%" }}
      transition={{ type: "spring", damping: 28, stiffness: 300 }}
      className="fixed inset-0 z-40 flex flex-col bg-white"
      dir="rtl"
    >
      <div className="flex items-center gap-3 bg-gradient-to-l from-violet-600 to-indigo-600 px-4 py-3 text-white">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20">
          <Bot className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="font-bold">مساعد التسوق الذكي</div>
          <div className="text-[11px] text-white/70">يفهم عربي — قوله شنو تدوّر 😊</div>
        </div>
        <button type="button" onClick={onClose} className="rounded-full bg-white/20 p-1.5">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 p-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-start" : "justify-end"}`}>
            <div className="max-w-[85%]">
              <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "rounded-tr-sm bg-indigo-600 text-white"
                  : "rounded-tl-sm bg-slate-100 text-slate-800"
              }`}>
                {msg.content}
              </div>
              {msg.products && msg.products.length > 0 && (
                <div className="mt-2 space-y-2">
                  {msg.products.map((p) => (
                    <div key={p.id} className="flex gap-3 rounded-xl border border-slate-100 bg-white p-2.5 shadow-sm">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                        {p.images[0]
                          ? <img src={p.images[0]} alt={p.title} className="h-full w-full object-cover" />
                          : <div className="flex h-full items-center justify-center text-slate-300"><Package className="h-6 w-6" /></div>
                        }
                      </div>
                      <div className="flex flex-1 flex-col justify-between">
                        <div className="text-xs font-bold leading-tight text-slate-700">{p.title}</div>
                        <div className="flex items-center justify-between">
                          <span className="font-extrabold text-indigo-600 text-sm">{money(p.price)} <span className="text-[10px] font-normal text-slate-400">{currency}</span></span>
                          <button
                            type="button"
                            onClick={() => { onAddToCart(toRetailItem(p)); onClose() }}
                            disabled={p.currentStock === 0}
                            className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-40 active:scale-95"
                          >
                            <ShoppingCart className="h-3 w-3" /> أضف
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-end">
            <div className="rounded-2xl rounded-tl-sm bg-slate-100 px-5 py-3">
              <span className="flex gap-1 text-slate-400">
                <span className="animate-bounce">●</span>
                <span className="animate-bounce" style={{ animationDelay: "0.15s" }}>●</span>
                <span className="animate-bounce" style={{ animationDelay: "0.3s" }}>●</span>
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-100 bg-white p-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send() } }}
            placeholder="مثال: أبي هدية للبنت عمرها 5 بـ ١٥ ألف"
            className="flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!input.trim() || loading}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white disabled:opacity-40 active:scale-95"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
