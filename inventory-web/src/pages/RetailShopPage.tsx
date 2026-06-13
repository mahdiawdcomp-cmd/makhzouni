import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Gift,
  Grid2x2,
  Grid3x3,
  Minus,
  Package,
  Plus,
  Search,
  Share2,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store,
  Tag,
  Trash2,
  TrendingUp,
  Truck,
  X,
} from "lucide-react"
import {
  getPublicActiveCoupon,
  getPublicRetailCatalog,
  getPublicRetailCategories,
  getPublicRetailOrderStatus,
  getPublicStoreInfo,
  previewPublicRetailCoupon,
  submitPublicRetailOrder,
} from "../api/endpoints"
import type { PublicRetailItem, PublicRetailCategory } from "../types/api"

type Tab = "catalog" | "cart" | "orders"
type CartLine = { item: PublicRetailItem; quantity: number }
type SavedOrder = { id: string; orderNumber: string; total: number; createdAt: string }

const ORDERS_KEY = "retail_shop_orders"
const COUPON_SEEN_KEY = "retail_shop_coupon_seen"

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

  function onOrderPlaced(order: SavedOrder) {
    const next = [order, ...orders]
    setOrders(next)
    localStorage.setItem(ORDERS_KEY, JSON.stringify(next))
    setCart([])
  }

  return (
    <div dir="rtl" className="min-h-screen bg-gradient-to-b from-indigo-50 via-slate-50 to-white">
      <div className="mx-auto flex min-h-screen max-w-[480px] flex-col bg-white/60 shadow-xl">
        {/* Header */}
        <header className="sticky top-0 z-20 bg-gradient-to-l from-indigo-600 to-violet-600 px-4 py-4 text-white shadow-lg">
          <div className="flex items-center gap-3">
            {settings?.storeLogo ? (
              <img src={settings.storeLogo} alt="logo" className="h-10 w-10 rounded-xl bg-white/20 object-contain" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20"><Store className="h-5 w-5" /></div>
            )}
            <div>
              <div className="text-lg font-extrabold leading-tight">{storeName}</div>
              <div className="text-[11px] text-white/80">متجر المفرد — اطلب ووصلك لباب البيت</div>
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
              setQty={setQty}
              onPlaced={onOrderPlaced}
              goCatalog={() => setTab("catalog")}
            />
          )}
          {tab === "orders" && <OrdersView orders={orders} currency={currency} goCatalog={() => setTab("catalog")} />}
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
                {id === "cart" && cartCount > 0 && (
                  <span className="absolute right-[28%] top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{cartCount}</span>
                )}
              </button>
            ))}
          </div>
        </nav>
      </div>

      {/* Item detail modal */}
      {detail && (
        <ItemDetailModal
          item={detail}
          currency={currency}
          onClose={() => setDetail(null)}
          onShare={() => shareItem(detail)}
          onAdd={(qty) => { addToCart(detail, qty); setDetail(null); setTab("cart") }}
        />
      )}

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
  const [searchOpen, setSearchOpen] = useState(false)
  const [cols, setCols] = useState<2 | 3>(2)

  const featured = useMemo(() => items.filter((i) => i.featured).slice(0, 10), [items])
  const subOptions = categories.find((c) => c.name === category)?.subCategories ?? []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      if (collection === "best" && !item.isBestSeller) return false
      if (collection === "offers" && !item.isOffer) return false
      if (collection === "new" && !item.isNew) return false
      if (category && item.category !== category) return false
      if (subCategory && item.subCategory !== subCategory) return false
      if (q && !(item.title.toLowerCase().includes(q) || (item.description ?? "").toLowerCase().includes(q))) return false
      return true
    })
  }, [items, collection, category, subCategory, search])

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
      {/* Hero carousel */}
      {featured.length > 0 && collection === "all" && !category && !search && (
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

      {/* Search + grid toggle */}
      <div className="flex items-center gap-2">
        {searchOpen ? (
          <div className="flex flex-1 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث عن مادة..."
              className="flex-1 bg-transparent py-2 text-sm outline-none"
            />
            <button type="button" onClick={() => { setSearch(""); setSearchOpen(false) }}><X className="h-4 w-4 text-slate-400" /></button>
          </div>
        ) : (
          <>
            <button type="button" onClick={() => setSearchOpen(true)} className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500"><Search className="h-4 w-4" /></button>
            <div className="flex flex-1 gap-1.5 overflow-x-auto">
              {collections.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCollection(c.id)}
                  className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${collection === c.id ? "bg-indigo-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}
                >
                  {c.icon ? <c.icon className="h-3.5 w-3.5" /> : null}{c.label}
                </button>
              ))}
            </div>
          </>
        )}
        <button type="button" onClick={() => setCols((c) => (c === 2 ? 3 : 2))} className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500" title="طريقة العرض">
          {cols === 2 ? <Grid3x3 className="h-4 w-4" /> : <Grid2x2 className="h-4 w-4" />}
        </button>
      </div>

      {/* Category chips */}
      {categories.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          <button type="button" onClick={() => { setCategory(null); setSubCategory(null) }} className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${!category ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>كل الأقسام</button>
          {categories.map((c) => (
            <button key={c.name} type="button" onClick={() => { setCategory(c.name); setSubCategory(null) }} className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${category === c.name ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>{c.name}</button>
          ))}
        </div>
      )}
      {/* Sub-category chips */}
      {subOptions.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          <button type="button" onClick={() => setSubCategory(null)} className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] ${!subCategory ? "bg-indigo-100 text-indigo-700" : "bg-white text-slate-500 ring-1 ring-slate-200"}`}>الكل</button>
          {subOptions.map((s) => (
            <button key={s} type="button" onClick={() => setSubCategory(s)} className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] ${subCategory === s ? "bg-indigo-100 text-indigo-700" : "bg-white text-slate-500 ring-1 ring-slate-200"}`}>{s}</button>
          ))}
        </div>
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-400">لا توجد مواد مطابقة.</div>
      ) : (
        <div className={`grid gap-2 ${cols === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
          {filtered.map((item) => {
            const pct = discountPct(item)
            return (
              <div key={item.id} className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
                <button type="button" onClick={() => onOpen(item)} className="relative block aspect-square w-full bg-slate-100">
                  {item.images[0] ? <img src={item.images[0]} alt={item.title} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-slate-300"><Package className="h-8 w-8" /></div>}
                  {pct ? <span className="absolute right-1.5 top-1.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">-{pct}%</span> : null}
                  {item.lowStockBadge ? <span className="absolute left-1.5 top-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-white">كمية قليلة</span> : null}
                  {!item.lowStockBadge && item.isNew ? <span className="absolute left-1.5 top-1.5 rounded-full bg-blue-500 px-1.5 py-0.5 text-[9px] font-bold text-white">جديد</span> : null}
                </button>
                <div className="p-1.5">
                  <div className={`line-clamp-1 font-bold leading-tight ${cols === 2 ? "text-sm" : "text-xs"}`}>{item.title}</div>
                  <div className="flex items-baseline gap-1">
                    <span className={`font-extrabold text-indigo-600 ${cols === 2 ? "text-sm" : "text-xs"}`}>{money(item.price)}</span>
                    {pct ? <span className="text-[10px] text-slate-400 line-through">{money(item.oldPrice!)}</span> : <span className="text-[9px] text-slate-400">{currency}</span>}
                  </div>
                  {cols === 2 && item.description ? <div className="line-clamp-1 text-[10px] text-slate-400">{item.description}</div> : null}
                  <div className="mt-1 flex items-center gap-1">
                    <button type="button" onClick={() => onAdd(item)} className="flex flex-1 items-center justify-center gap-0.5 rounded-lg bg-indigo-600 py-1.5 text-[11px] font-bold text-white active:scale-95">
                      <Plus className="h-3.5 w-3.5" /> أضف
                    </button>
                    <button type="button" onClick={() => onShare(item)} className="rounded-lg bg-emerald-50 p-1.5 text-emerald-600" title="مشاركة واتساب">
                      <Share2 className="h-3.5 w-3.5" />
                    </button>
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
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl bg-white sm:rounded-3xl" onClick={(e) => e.stopPropagation()} dir="rtl">
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
      </div>
    </div>
  )
}

// ── Cart + Checkout ─────────────────────────────────────────────────────────
function CartView({ cart, currency, storeName, subtotal, setQty, onPlaced, goCatalog }: {
  cart: CartLine[]
  currency: string
  storeName: string
  subtotal: number
  setQty: (id: string, qty: number) => void
  onPlaced: (order: SavedOrder) => void
  goCatalog: () => void
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

  const discount = appliedCoupon?.discount ?? 0
  const total = Math.max(0, subtotal - discount)

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
        items: cart.map((l) => ({ retailItemId: l.item.id, quantity: l.quantity })),
      })
      setSuccess({ orderNumber: res.orderNumber })
      onPlaced({ id: res.id, orderNumber: res.orderNumber, total: res.total, createdAt: new Date().toISOString() })
    } catch (e) {
      setPlaceError(e instanceof Error ? e.message : "تعذر إرسال الطلب")
    } finally {
      setPlacing(false)
    }
  }

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100"><CheckCircle2 className="h-12 w-12 text-emerald-600" /></div>
        <h2 className="mt-4 text-xl font-extrabold">تم تثبيت طلبك! 🎉</h2>
        <p className="mt-1 text-sm text-slate-500">رقم الطلب <span className="font-mono font-bold text-indigo-600">{success.orderNumber}</span></p>
        <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-600">
          سوف يتم التجهيز بكل حب وإرساله إليك بأسرع وقت ❤️<br />ستصلك رسالة عند تجهيز الطلب.
        </p>
        <button type="button" onClick={goCatalog} className="mt-6 rounded-xl bg-indigo-600 px-6 py-3 font-bold text-white">متابعة التسوّق</button>
      </div>
    )
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

      {/* Totals */}
      <div className="rounded-2xl border border-slate-100 bg-white p-3 text-sm shadow-sm">
        <div className="flex justify-between py-1"><span className="text-slate-500">المجموع</span><span className="font-semibold">{money(subtotal)} {currency}</span></div>
        {discount > 0 && <div className="flex justify-between py-1 text-emerald-600"><span>الخصم</span><span>- {money(discount)} {currency}</span></div>}
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
function OrdersView({ orders, currency, goCatalog }: { orders: SavedOrder[]; currency: string; goCatalog: () => void }) {
  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center text-slate-400">
        <ClipboardList className="h-14 w-14 opacity-40" />
        <p className="mt-3">لا توجد طلبات بعد</p>
        <button type="button" onClick={goCatalog} className="mt-4 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white">ابدأ التسوّق</button>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {orders.map((order) => (
        <OrderStatusCard key={order.id} order={order} currency={currency} />
      ))}
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
      <div className="mt-3">
        {status === "PREPARED" ? (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-emerald-700">
            <Truck className="h-5 w-5" />
            <span className="text-sm font-bold">تم التجهيز — طلبك في الطريق إليك 🚗</span>
          </div>
        ) : status === "CANCELLED" ? (
          <div className="flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-rose-700">
            <X className="h-5 w-5" /><span className="text-sm font-bold">تم إلغاء الطلب</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-amber-700">
            <Package className="h-5 w-5 animate-pulse" />
            <span className="text-sm font-bold">قيد التجهيز — سنرسله إليك قريباً</span>
          </div>
        )}
      </div>
    </div>
  )
}
