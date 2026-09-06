/**
 * «المندوب» — the sales rep's screen.
 *
 * Built from the SAME parts as the rest of the site, deliberately: Card /
 * CardHeader / CardTitle, Button, Input, the Table set, and the app's own
 * `--theme-*` variables. An earlier version invented its own palette and shapes,
 * which made a screen that was recognisably not this product — a rep who also
 * uses the shop's other pages had to learn a second set of conventions for the
 * same actions.
 *
 * What stays rep-specific is only what the job actually requires:
 *
 *  - It is a standalone route, not inside AppLayout, because the sidebar lists
 *    pages a rep must never reach. The page header and tab strip below are the
 *    site's own patterns, so it still reads as the same product.
 *  - Touch targets stay at 44px and the primary actions stay reachable, because
 *    this is used one-handed in the street rather than at a desk.
 *  - The grid collapses to two columns on a phone and the order panel moves
 *    beside the catalog on a tablet.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  BadgePercent,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Minus,
  Package,
  Plus,
  Receipt,
  ShoppingCart,
  UserPlus,
  Users,
  Wallet,
  X,
} from "lucide-react"
import { api } from "../api/client"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import { toast } from "../components/ui/use-toast"
import { QueryErrorBox } from "../components/ui/query-error"
import { apiErrorMessage } from "../utils/apiError"
import { cn } from "../utils/cn"
import { useAuthStore } from "../store/authStore"

/* ── types ───────────────────────────────────────────────────────────── */

type Unit = "PIECE" | "DOZEN" | "BOX" | "CARTON"

type AgentProduct = {
  id: string
  itemNumber: string
  name: string
  category: string | null
  salePrice: number
  oldPrice: number | null
  isOffer: boolean
  isNewArrival: boolean
  pcsPerCarton: number
  boxPieces: number | null
  hiddenUnits: string[]
  hasImage: boolean
  currentStock: number
}

type AgentCustomer = {
  id: string
  name: string
  phone: string
  address: string | null
  area: string | null
  province: string | null
  currentBalance: number
  lastTransactionAt: string | null
  lastSaleAt: string | null
  /** null = never bought anything, which reads differently from "quiet 40 days". */
  daysSinceLastSale: number | null
}

type CustomerPage = {
  total: number
  page: number
  limit: number
  hasMore: boolean
  customers: AgentCustomer[]
}

/** «يومي» — the rep's own day. Contains no figure the owner keeps private. */
type AgentToday = {
  orders: number
  /** Refused orders, shown separately so the number never silently shrinks. */
  rejectedOrders: number
  rejectedValue: number
  orderValue: number
  receipts: number
  collected: number
  issues: number
  newCustomers: number
  customersVisited: number
}

type CustomerHeader = AgentCustomer & {
  lastPayment: { amount: number; date: string } | null
}

type PhoneLookup = {
  found: boolean
  phone: string
  id?: string
  name?: string
  mine?: boolean
  claimable?: boolean
  reason?: "MINE" | "UNASSIGNED" | "OTHER_AGENT" | "DELETED"
  message?: string
}

type CartLine = { productId: string; unit: Unit; quantity: number }

type AgentOrder = {
  id: string
  status: string
  createdAt: string
  reviewedAt: string | null
  /** Why it was refused, so the rep can fix it instead of telephoning. */
  reviewNote: string | null
  customerName: string
  total: number
  lineCount: number
}

type CashOnHand = { collected: number; handedOver: number; onHand: number }

type AgentReceipt = {
  id: string
  voucherNumber: string
  amount: number
  date: string
  cancelled: boolean
  customerId: string | null
  customerName: string
}

type AgentIssue = {
  id: string
  reason: string
  reasonLabel: string
  note: string | null
  competitorInfo: string | null
  createdAt: string
  customerName: string
  productName: string | null
}

type AgentPriceRequest = {
  id: string
  unit: Unit
  currentPrice: number
  requestedPrice: number
  reason: string | null
  status: string
  used: boolean
  createdAt: string
  customerId: string
  customerName: string
  productId: string
  productName: string
}

type UsablePrice = { id: string; productId: string; unit: Unit; price: number }

type AgentHandoverRow = {
  id: string
  amount: number
  date: string
  notes: string | null
  receivedBy: string
}

type StatementRow = {
  id: string
  date: string
  type: string
  invoiceType: string | null
  amount: number
  referenceNumber: string
  status?: string | null
  runningBalance?: number
  createdByName?: string | null
}

type CustomerStatement = {
  customer: { id: string; name: string; openingBalance: number }
  transactions: StatementRow[]
}

type IssueReason = { code: string; label: string; aboutProduct: boolean }

/* ── unit helpers ────────────────────────────────────────────────────
 * Mirrors the server's conversion exactly. The server recomputes every price
 * from the database when the order is submitted — what is shown here is a
 * preview, never the number that gets billed.
 */

const UNIT_LABEL: Record<Unit, string> = {
  PIECE: "قطعة",
  DOZEN: "دزينة",
  BOX: "علبة",
  CARTON: "كارتون",
}

const ALL_UNITS: Unit[] = ["CARTON", "BOX", "DOZEN", "PIECE"]

function effectiveBoxPieces(pcsPerCarton: number, boxPieces: number | null) {
  if (boxPieces && boxPieces > 0) return boxPieces
  const n = Math.max(1, pcsPerCarton)
  return n % 2 === 0 ? n / 2 : n
}

function piecesPerUnit(product: AgentProduct, unit: Unit) {
  const n = Math.max(1, product.pcsPerCarton)
  if (unit === "CARTON") return n
  if (unit === "BOX") return effectiveBoxPieces(n, product.boxPieces)
  if (unit === "DOZEN") return 12
  return 1
}

function unitPrice(product: AgentProduct, unit: Unit) {
  return product.salePrice * piecesPerUnit(product, unit)
}

function maxQty(product: AgentProduct, unit: Unit) {
  return Math.floor(product.currentStock / piecesPerUnit(product, unit))
}

function availableUnits(product: AgentProduct): Unit[] {
  const hidden = new Set(product.hiddenUnits ?? [])
  const units = ALL_UNITS.filter((u) => !hidden.has(u))
  return units.length > 0 ? units : ["PIECE"]
}

const money = (n: number) => Math.round(n).toLocaleString("en-US")
const shortDate = (d: string) => new Date(d).toLocaleDateString("en-GB")

/* ── data hooks ──────────────────────────────────────────────────────── */

function useAgentProducts() {
  return useQuery({
    queryKey: ["sales-agent", "products"],
    queryFn: async () => {
      const res = await api.get<{ data: AgentProduct[] }>("/sales-agent/products")
      return res.data.data ?? []
    },
    // The rep reopens this all day; a stale grid beats a spinner on a dead spot.
    staleTime: 5 * 60 * 1000,
    retry: 3,
  })
}

function useMyCustomers(search: string, page: number) {
  return useQuery({
    queryKey: ["sales-agent", "customers", search, page],
    queryFn: async () => {
      const res = await api.get<{ data: CustomerPage }>("/sales-agent/customers", {
        params: { page, limit: 200, ...(search ? { search } : {}) },
      })
      return res.data.data
    },
    // Keeps the previous page on screen while the next one loads, instead of
    // blanking a list the rep is reading in the street.
    placeholderData: (prev) => prev,
    retry: 3,
  })
}

function useCustomerHeader(customerId: string | null) {
  return useQuery({
    queryKey: ["sales-agent", "customer-header", customerId],
    enabled: Boolean(customerId),
    queryFn: async () => {
      const res = await api.get<{ data: CustomerHeader }>(`/sales-agent/customers/${customerId}/header`)
      return res.data.data
    },
    retry: 3,
  })
}

/**
 * Thumbnails for the cards currently on screen, fetched in batches.
 *
 * Cards report themselves visible through an IntersectionObserver attached by
 * callback ref. Ids collect for a beat, then go out as one request, so a fast
 * scroll produces a handful of calls rather than one per card.
 */
function useThumbnails(visibleIds: string[]) {
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({})
  const pending = useRef<Set<string>>(new Set())
  const requested = useRef<Set<string>>(new Set())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const fresh = visibleIds.filter((id) => !requested.current.has(id))
    if (fresh.length === 0) return

    for (const id of fresh) {
      requested.current.add(id)
      pending.current.add(id)
    }

    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const ids = [...pending.current]
      pending.current.clear()
      if (ids.length === 0) return
      api
        .post<{ data: Record<string, string | null> }>("/sales-agent/products/thumbnails", { ids })
        .then((res) => setThumbs((prev) => ({ ...prev, ...(res.data.data ?? {}) })))
        .catch(() => {
          // A failed batch must be retryable — otherwise those cards stay blank
          // for the rest of the session.
          for (const id of ids) requested.current.delete(id)
        })
    }, 120)
  }, [visibleIds])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return thumbs
}

/* ── page ────────────────────────────────────────────────────────────── */

type Screen = "catalog" | "customers" | "new-customer" | "orders" | "money" | "customer-detail" | "issues"

type CartsByCustomer = Record<string, CartLine[]>

const CARTS_KEY = "sales_agent_carts"

const TABS: Array<{ key: Screen; label: string }> = [
  { key: "catalog", label: "المواد" },
  { key: "customers", label: "زبائني" },
  { key: "money", label: "فلوسي" },
  { key: "issues", label: "المشاكل" },
  { key: "orders", label: "طلباتي" },
]

export function SalesAgentPage() {
  const user = useAuthStore((s) => s.user)
  const qc = useQueryClient()

  const [screen, setScreen] = useState<Screen>("customers")
  const [customerId, setCustomerId] = useState<string | null>(
    () => localStorage.getItem("sales_agent_customer") || null,
  )

  // Carts survive a closed browser, a dropped connection, a phone that slept
  // until the tab was evicted. A rep who has walked three shops and loses the
  // lot has to redo the whole round.
  const [carts, setCarts] = useState<CartsByCustomer>(() => {
    try {
      const raw = localStorage.getItem(CARTS_KEY)
      const parsed = raw ? (JSON.parse(raw) as CartsByCustomer) : {}
      return parsed && typeof parsed === "object" ? parsed : {}
    } catch {
      // A private window, cleared site data, or a browser that blocks storage —
      // an empty cart is the right answer, never a crashed screen.
      return {}
    }
  })

  useEffect(() => {
    try {
      const kept = Object.fromEntries(Object.entries(carts).filter(([, lines]) => lines.length > 0))
      localStorage.setItem(CARTS_KEY, JSON.stringify(kept))
    } catch {
      /* storage unavailable — the cart still works for this session */
    }
  }, [carts])

  const [cartOpen, setCartOpen] = useState(false)
  const [openProduct, setOpenProduct] = useState<AgentProduct | null>(null)
  const [search, setSearch] = useState("")
  const [notes, setNotes] = useState("")
  const [detailCustomerId, setDetailCustomerId] = useState<string | null>(null)
  const [issueFor, setIssueFor] = useState<{ product: AgentProduct | null; unit: Unit | null } | null>(null)
  const [priceFor, setPriceFor] = useState<{ product: AgentProduct; unit: Unit } | null>(null)

  // One key per cart attempt. A rep on a bad connection taps «أرسل الطلب», sees
  // nothing, and taps again — the retry carries the same key and gets the first
  // order back rather than creating a second.
  const orderKey = useRef(crypto.randomUUID())

  useEffect(() => {
    if (customerId) localStorage.setItem("sales_agent_customer", customerId)
    else localStorage.removeItem("sales_agent_customer")
  }, [customerId])

  const products = useAgentProducts()
  const header = useCustomerHeader(customerId)

  const usablePrices = useQuery({
    queryKey: ["sales-agent", "usable-prices", customerId],
    enabled: Boolean(customerId),
    queryFn: async () => {
      const res = await api.get<{ data: UsablePrice[] }>(
        `/sales-agent/customers/${customerId}/usable-prices`,
      )
      return res.data.data ?? []
    },
    retry: 3,
  })

  const specialPriceFor = useCallback(
    (productId: string, unit: Unit) =>
      (usablePrices.data ?? []).find((p) => p.productId === productId && p.unit === unit)?.price ?? null,
    [usablePrices.data],
  )

  // A customer that was un-assigned (or removed) since the id was cached must
  // not leave the rep selling into a ghost.
  //
  // Only a real answer from the server clears the selection. Any error used to
  // count, so a dropped connection threw the rep out of the sale they were in
  // the middle of and back to the customer list.
  const headerStatus = (header.error as { response?: { status?: number } } | null)?.response?.status
  useEffect(() => {
    if (customerId && (headerStatus === 404 || headerStatus === 403)) {
      setCustomerId(null)
      setScreen("customers")
    }
  }, [customerId, headerStatus])

  const cart = customerId ? carts[customerId] ?? [] : []
  const setCart = useCallback(
    (updater: (prev: CartLine[]) => CartLine[]) => {
      if (!customerId) return
      setCarts((prev) => ({ ...prev, [customerId]: updater(prev[customerId] ?? []) }))
    },
    [customerId],
  )

  const productById = useMemo(
    () => new Map((products.data ?? []).map((p) => [p.id, p])),
    [products.data],
  )

  const cartTotal = useMemo(
    () =>
      cart.reduce((sum, line) => {
        const product = productById.get(line.productId)
        if (!product) return sum
        const special = specialPriceFor(line.productId, line.unit)
        return sum + (special ?? unitPrice(product, line.unit)) * line.quantity
      }, 0),
    [cart, productById, specialPriceFor],
  )

  const addToCart = useCallback(
    (product: AgentProduct, unit: Unit, quantity: number) => {
      setCart((prev) => {
        const idx = prev.findIndex((l) => l.productId === product.id && l.unit === unit)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { ...next[idx], quantity: next[idx].quantity + quantity }
          return next
        }
        return [...prev, { productId: product.id, unit, quantity }]
      })
      toast({ title: `انضاف: ${product.name}` })
    },
    [setCart],
  )

  const submit = useMutation({
    mutationFn: async () => {
      const res = await api.post("/sales-agent/orders", {
        customerId,
        notes: notes.trim() || undefined,
        clientRequestId: orderKey.current,
        items: cart,
      })
      return res.data as { data?: { shortages?: Array<{ productName: string; short: number }> } }
    },
    onSuccess: (res) => {
      const short = res?.data?.shortages ?? []
      toast({
        title: "انرسل الطلب ✓",
        // A shortage does not block the sale, but the rep should know the shop
        // is short before the customer asks when it arrives.
        description:
          short.length > 0
            ? `انتبه: ${short.map((x) => x.productName).join("، ")} — الكمية ناقصة بالمخزن`
            : "راح يوصلك إشعار بعد الموافقة",
      })
      orderKey.current = crypto.randomUUID()
      if (customerId) setCarts((prev) => ({ ...prev, [customerId]: [] }))
      setNotes("")
      setCartOpen(false)
      void qc.invalidateQueries({ queryKey: ["sales-agent", "orders"] })
      // Approved prices are spent by the order that used them.
      void qc.invalidateQueries({ queryKey: ["sales-agent", "usable-prices"] })
      void qc.invalidateQueries({ queryKey: ["sales-agent", "price-requests"] })
      void qc.invalidateQueries({ queryKey: ["sales-agent", "today"] })
    },
    onError: (err) =>
      toast({
        title: "ما انرسل الطلب",
        description: apiErrorMessage(err, "تحقق من الاتصال وحاول مرة أخرى"),
        variant: "destructive",
      }),
  })

  const sendOrder = useOnce(submit)

  const filtered = useMemo(() => {
    const list = products.data ?? []
    const term = search.trim().toLowerCase()
    if (!term) return list
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        p.itemNumber.toLowerCase().includes(term) ||
        (p.category ?? "").toLowerCase().includes(term),
    )
  }, [products.data, search])

  const pickCustomer = (id: string) => {
    setCustomerId(id)
    setScreen("catalog")
  }

  const showCart = screen === "catalog" && Boolean(customerId)

  return (
    <div
      dir="rtl"
      className="flex h-[100dvh] flex-col overflow-hidden"
      style={{ backgroundColor: "var(--theme-pageBg)", color: "var(--theme-textPrimary)" }}
    >
      {/* Page header — the site's own pattern: title, one-line subtitle, actions
          on the far side. */}
      <div
        className="shrink-0 border-b px-4 py-3 sm:px-6"
        style={{ backgroundColor: "var(--theme-cardBg)", borderColor: "var(--theme-cardBorder)" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold">
              {header.data ? header.data.name : user?.name ?? "المندوب"}
            </h1>
            <p className="truncate text-slate-500">
              {header.data ? (
                <>
                  الرصيد {money(header.data.currentBalance)}
                  {header.data.lastPayment
                    ? ` · آخر دفعة ${money(header.data.lastPayment.amount)} بتاريخ ${shortDate(header.data.lastPayment.date)}`
                    : " · ما عنده دفعات"}
                </>
              ) : (
                "اختر الزبون قبل ما تبدأ البيع."
              )}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {customerId && (
              <Button
                variant="outline"
                className="h-11 sm:h-9"
                onClick={() => { setDetailCustomerId(customerId); setScreen("customer-detail") }}
              >
                <Receipt className="h-4 w-4" /> كشف الحساب
              </Button>
            )}
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => setScreen("customers")}>
              <Users className="h-4 w-4" /> تبديل الزبون
            </Button>
          </div>
        </div>

        {/* Tab strip, identical to the customers/suppliers switch elsewhere. */}
        <div className="mt-3 -mb-3 flex overflow-x-auto border-b" style={{ borderColor: "var(--theme-cardBorder)" }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setScreen(t.key)}
              className={cn(
                "shrink-0 px-4 py-2 text-sm font-medium",
                screen === t.key
                  ? "border-b-2 border-indigo-500 text-indigo-600"
                  : "text-slate-500 hover:text-slate-700",
              )}
            >
              {t.label}
              {t.key === "catalog" && cart.length > 0 && (
                <span className="ms-1.5 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[11px] font-bold text-indigo-700">
                  {cart.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {screen === "customers" && (
            <CustomersScreen
              currentId={customerId}
              onPick={pickCustomer}
              onNew={() => setScreen("new-customer")}
              onOpenStatement={(id) => {
                setDetailCustomerId(id)
                setScreen("customer-detail")
              }}
            />
          )}

          {screen === "new-customer" && (
            <NewCustomerScreen
              onDone={(id) => {
                void qc.invalidateQueries({ queryKey: ["sales-agent", "customers"] })
                pickCustomer(id)
              }}
              onCancel={() => setScreen("customers")}
            />
          )}

          {screen === "orders" && <OrdersScreen />}
          {screen === "issues" && <MyIssuesScreen />}

          {screen === "money" && (
            <MoneyScreen
              customerId={customerId}
              customerName={header.data?.name ?? null}
              onNeedCustomer={() => setScreen("customers")}
            />
          )}

          {screen === "customer-detail" &&
            (detailCustomerId ? (
              <CustomerDetailScreen
                customerId={detailCustomerId}
                onBack={() => setScreen("customers")}
              />
            ) : (
              <EmptyState
                title="ما اخترت زبون"
                body="افتح زبوناً من «زبائني»."
                actionLabel="روح لزبائني"
                onAction={() => setScreen("customers")}
              />
            ))}

          {screen === "catalog" &&
            (customerId ? (
              <CatalogScreen
                products={filtered}
                loading={products.isPending}
                paused={products.fetchStatus === "paused"}
                error={products.isError}
                onRetry={() => void products.refetch()}
                search={search}
                onSearch={setSearch}
                onOpen={setOpenProduct}
                specialPrice={specialPriceFor}
              />
            ) : (
              <EmptyState
                title="اختر الزبون أول"
                body="الأسعار والرصيد مربوطة بالزبون، فلازم تختاره قبل ما تفتح المواد."
                actionLabel="روح لزبائني"
                onAction={() => setScreen("customers")}
              />
            ))}
        </main>

        {/* Tablet and up: the order builds beside the catalog, facing the
            shopkeeper. Below lg it is the bottom bar + dialog instead. */}
        {showCart && (
          <aside
            className="hidden w-[22rem] shrink-0 flex-col border-e lg:flex"
            style={{ backgroundColor: "var(--theme-cardBg)", borderColor: "var(--theme-cardBorder)" }}
          >
            <div className="border-b px-5 py-4" style={{ borderColor: "var(--theme-cardBorder)" }}>
              <h3 className="text-[15px] font-semibold tracking-tight">الطلب</h3>
            </div>
            <CartPanel
              cart={cart}
              productById={productById}
              total={cartTotal}
              notes={notes}
              onNotes={setNotes}
              onChange={setCart}
              onSubmit={sendOrder}
              submitting={submit.isPending}
              specialPrice={specialPriceFor}
            />
          </aside>
        )}
      </div>

      {/* Phone: the order folded into one bar above the fold. */}
      {showCart && cart.length > 0 && (
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          className="flex h-14 shrink-0 cursor-pointer items-center justify-between border-t bg-[var(--theme-primaryBtn)] px-5 text-white transition-colors duration-200 hover:bg-[var(--theme-primaryBtnHover)] lg:hidden"
          style={{ borderColor: "var(--theme-cardBorder)" }}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <ShoppingCart className="h-4 w-4" />
            {cart.length} سطر
          </span>
          <span className="text-lg font-bold tabular-nums">{money(cartTotal)}</span>
        </button>
      )}

      {cartOpen && customerId && (
        <Dialog title="الطلب" onClose={() => setCartOpen(false)} padded={false}>
          <CartPanel
            cart={cart}
            productById={productById}
            total={cartTotal}
            notes={notes}
            onNotes={setNotes}
            onChange={setCart}
            onSubmit={sendOrder}
            submitting={submit.isPending}
            specialPrice={specialPriceFor}
          />
        </Dialog>
      )}

      {openProduct && (
        <ProductDialog
          product={openProduct}
          onClose={() => setOpenProduct(null)}
          onAdd={(unit, qty) => {
            addToCart(openProduct, unit, qty)
            setOpenProduct(null)
          }}
          onIssue={(unit) => setIssueFor({ product: openProduct, unit })}
          onAskPrice={(unit) => setPriceFor({ product: openProduct, unit })}
          specialPrice={(unit) => specialPriceFor(openProduct.id, unit)}
        />
      )}

      {issueFor && customerId && (
        <IssueDialog
          product={issueFor.product}
          unit={issueFor.unit}
          customerId={customerId}
          customerName={header.data?.name ?? ""}
          onClose={() => {
            setIssueFor(null)
            void qc.invalidateQueries({ queryKey: ["sales-agent", "issues"] })
            void qc.invalidateQueries({ queryKey: ["sales-agent", "today"] })
          }}
        />
      )}

      {priceFor && customerId && (
        <PriceRequestDialog
          product={priceFor.product}
          unit={priceFor.unit}
          customerId={customerId}
          customerName={header.data?.name ?? ""}
          onClose={() => {
            setPriceFor(null)
            void qc.invalidateQueries({ queryKey: ["sales-agent", "price-requests"] })
            void qc.invalidateQueries({ queryKey: ["sales-agent", "usable-prices"] })
          }}
        />
      )}
    </div>
  )
}

/* ── shared shells ───────────────────────────────────────────────────── */

/**
 * Centred dialog, matching the site's modal shape.
 *
 * Full-height on a phone so a long form is usable one-handed, centred and
 * bounded on a tablet. Backdrop click and Escape both close it.
 */
function Dialog({
  title,
  onClose,
  children,
  footer,
  padded = true,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  padded?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="إغلاق"
        onClick={onClose}
        className="absolute inset-0 cursor-pointer bg-slate-900/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[92dvh] w-full min-h-0 flex-col rounded-t-xl border sm:max-h-[85dvh] sm:max-w-lg sm:rounded-xl"
        style={{
          backgroundColor: "var(--theme-cardBg)",
          borderColor: "var(--theme-cardBorder)",
          boxShadow: "var(--z-shadow-lg)",
        }}
      >
        <div
          className="flex shrink-0 items-center justify-between border-b px-5 py-4"
          style={{ borderColor: "var(--theme-cardBorder)" }}
        >
          <h3 className="truncate text-[15px] font-semibold tracking-tight">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", padded && "p-5")}>
          {children}
        </div>

        {footer && (
          <div
            className="shrink-0 border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            style={{ borderColor: "var(--theme-cardBorder)" }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-slate-600 dark:text-slate-300">
        {label}
      </span>
      {children}
    </label>
  )
}

function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string
  body: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-lg bg-[var(--theme-accentSoft)] text-[var(--theme-accent)]">
          <Users className="h-6 w-6" />
        </div>
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <p className="max-w-sm text-sm text-slate-500">{body}</p>
        <Button className="mt-1" onClick={onAction}>
          {actionLabel}
        </Button>
      </CardContent>
    </Card>
  )
}

// TanStack pauses a retry when the browser reports itself offline or the tab
// loses focus: the query stays `pending` with `fetchStatus: "paused"` and
// nothing moves again on its own. Outdoors on a weak signal that is the rep's
// normal state, so it gets a message and a button instead of a spinner that
// never stops.
function Waiting({ q }: { q: { fetchStatus: string; refetch: () => unknown } }) {
  if (q.fetchStatus === "paused") {
    return <QueryErrorBox title="ما في اتصال" onRetry={() => void q.refetch()} />
  }
  return <Loading />
}

/**
 * One tap, one request.
 *
 * Two taps land in the same tick, before React can re-render the button as
 * disabled. Every save on this page produced a twin that way: two orders for
 * the same cart, two receipts for the same cash, two refusals, two price
 * requests. The server refuses duplicates too — this just stops the round trip.
 */
function useOnce(mutation: {
  mutate: (vars: undefined, opts?: { onSettled?: () => void }) => void
}) {
  const busy = useRef(false)
  return useCallback(() => {
    if (busy.current) return
    busy.current = true
    mutation.mutate(undefined, { onSettled: () => (busy.current = false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutation])
}

// Reps type on Arabic keyboards. Stripping non-ASCII digits read «١٢» as an
// empty string, so the field silently fell back to 1.
function toAsciiDigits(value: string) {
  return value.replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf))
}

// Money is written «50.000» here and means fifty thousand, so the separator is
// dropped. Quantities are the opposite: they are whole units and small, so a
// separator is a typo — «1.5» must read as 1, not 15. Stripping the dot turned
// a habit of typing a decimal point into ten times the order.
function digitsOnly(value: string) {
  return toAsciiDigits(value).replace(/\D/g, "")
}

function wholeUnits(value: string, max = 100_000) {
  const n = Number(digitsOnly(toAsciiDigits(value).split(/[.,٫٬]/)[0]))
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.min(n, max)
}

function Loading({ label = "جاري التحميل…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  )
}

/** Status pill, using the site's status colours. */
function StatusPill({ tone, children }: { tone: "ok" | "wait" | "bad" | "muted"; children: React.ReactNode }) {
  const cls = {
    ok: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    wait: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    bad: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
    muted: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  }[tone]
  return <span className={cn("rounded px-2 py-0.5 text-[12px] font-medium", cls)}>{children}</span>
}

/* ── catalog ─────────────────────────────────────────────────────────── */

function CatalogScreen({
  products,
  loading,
  paused,
  error,
  onRetry,
  search,
  onSearch,
  onOpen,
  specialPrice,
}: {
  products: AgentProduct[]
  loading: boolean
  paused: boolean
  error: boolean
  onRetry: () => void
  search: string
  onSearch: (v: string) => void
  onOpen: (p: AgentProduct) => void
  specialPrice: (productId: string, unit: Unit) => number | null
}) {
  const [visible, setVisible] = useState<string[]>([])
  const thumbs = useThumbnails(visible)
  const observer = useRef<IntersectionObserver | null>(null)

  /**
   * Built ON FIRST USE, not in an effect.
   *
   * Callback refs run BEFORE effects. Creating the observer in a `useEffect`
   * means it does not exist when the first screenful of cards attaches, so every
   * one of them is silently skipped and their thumbnails never load.
   */
  const getObserver = () => {
    if (!observer.current) {
      observer.current = new IntersectionObserver(
        (entries) => {
          const seen = entries
            .filter((e) => e.isIntersecting)
            .map((e) => (e.target as HTMLElement).dataset.pid)
            .filter(Boolean) as string[]
          if (seen.length === 0) return
          setVisible((prev) => {
            const next = seen.filter((id) => !prev.includes(id))
            return next.length > 0 ? [...prev, ...next] : prev
          })
        },
        { rootMargin: "300px" },
      )
    }
    return observer.current
  }

  useEffect(() => () => observer.current?.disconnect(), [])

  const observe = useCallback((node: HTMLElement | null) => {
    if (node) getObserver().observe(node)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) return <QueryErrorBox title="ما وصلت المواد" onRetry={onRetry} />

  return (
    <Card>
      <CardHeader>
        <CardTitle>المواد</CardTitle>
        <span className="text-[12px] text-slate-500 tabular-nums">{products.length} مادة</span>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="بحث بالاسم أو رقم المادة"
          aria-label="بحث عن مادة"
          className="h-11 sm:h-9"
        />

        {loading ? (
          paused ? (
            <QueryErrorBox title="ما في اتصال" onRetry={onRetry} />
          ) : (
            <Loading />
          )
        ) : products.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">ما اكو نتائج</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {products.map((product) => {
              const special = availableUnits(product).some((u) => specialPrice(product.id, u) !== null)
              return (
                <button
                  key={product.id}
                  type="button"
                  data-pid={product.id}
                  ref={observe}
                  onClick={() => onOpen(product)}
                  className="flex cursor-pointer flex-col overflow-hidden rounded-lg border text-start transition-colors duration-150 hover:border-[var(--theme-accent)]"
                  style={{ borderColor: "var(--theme-cardBorder)" }}
                >
                  <div className="relative aspect-square w-full bg-slate-100 dark:bg-slate-800">
                    {thumbs[product.id] ? (
                      <img
                        src={thumbs[product.id] as string}
                        alt={product.name}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-slate-400">
                        <Package className="h-7 w-7" />
                      </div>
                    )}
                    {special && (
                      <span className="absolute end-2 top-2 flex items-center gap-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[11px] font-medium text-white">
                        <BadgePercent className="h-3 w-3" />
                        سعر خاص
                      </span>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col gap-1 p-3">
                    <p className="line-clamp-2 text-[13px] font-medium leading-snug">{product.name}</p>
                    <p className="mt-auto text-base font-bold tabular-nums">
                      {money(product.salePrice)}
                    </p>
                    <span className="text-[12px] text-slate-500 tabular-nums">
                      المتوفر {product.currentStock}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * The product dialog.
 *
 * Full picture, price for the chosen unit, real stock, and the three things the
 * rep does next: add it, record why the shopkeeper refused it, or ask for a
 * price. All three sit in the footer, within thumb reach.
 */
function ProductDialog({
  product,
  onClose,
  onAdd,
  onIssue,
  onAskPrice,
  specialPrice,
}: {
  product: AgentProduct
  onClose: () => void
  onAdd: (unit: Unit, quantity: number) => void
  onIssue: (unit: Unit) => void
  onAskPrice: (unit: Unit) => void
  specialPrice: (unit: Unit) => number | null
}) {
  const units = availableUnits(product)
  const [unit, setUnit] = useState<Unit>(units[0])
  const [qty, setQty] = useState(1)
  const [image, setImage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!product.hasImage) return
    api
      .get<{ data: { imageUrl: string | null } }>(`/sales-agent/products/${product.id}/image`)
      .then((res) => {
        if (!cancelled) setImage(res.data.data?.imageUrl ?? null)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [product.id, product.hasImage])

  const max = Math.max(0, maxQty(product, unit))
  const approved = specialPrice(unit)
  // Preview only. `submitAgentOrder` re-resolves the approved price from the
  // database when the order is priced, so what is shown here can never become
  // what gets billed.
  const line = (approved ?? unitPrice(product, unit)) * qty

  return (
    <Dialog
      title={product.name}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          <Button className="h-11 w-full" onClick={() => onAdd(unit, qty)}>
            <Plus className="h-4 w-4" /> أضف للطلب · {money(line)}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" className="h-11 flex-1" onClick={() => onIssue(unit)}>
              <AlertTriangle className="h-4 w-4" /> أكو مشكلة
            </Button>
            <Button variant="outline" className="h-11 flex-1" onClick={() => onAskPrice(unit)}>
              <BadgePercent className="h-4 w-4" /> اطلب سعر
            </Button>
          </div>
        </div>
      }
    >
      <div className="mx-auto aspect-square w-full max-w-[15rem] shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
        {image ? (
          <img src={image} alt={product.name} className="h-full w-full object-contain" />
        ) : (
          <div className="grid h-full w-full place-items-center text-slate-400">
            <Package className="h-10 w-10" />
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-[13px]">
        <span className="rounded bg-slate-100 px-2.5 py-1.5 font-medium tabular-nums dark:bg-slate-800">
          القطعة {money(product.salePrice)}
        </span>
        <span className="rounded bg-slate-100 px-2.5 py-1.5 font-medium tabular-nums dark:bg-slate-800">
          المتوفر {product.currentStock} قطعة
        </span>
        <span className="rounded bg-slate-100 px-2.5 py-1.5 font-medium dark:bg-slate-800">
          {product.itemNumber}
        </span>
      </div>

      {approved != null && (
        <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700 dark:text-emerald-300">
            <BadgePercent className="h-4 w-4" /> سعر خاص موافق عليه
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
            {money(approved)}
          </p>
          <p className="mt-1 text-[12px] text-slate-600 dark:text-slate-400">
            ينطبق على هذا الطلب فقط، ويُستهلك أول ما ترسل الطلب.
          </p>
        </div>
      )}

      <div className="mt-5">
        <p className="mb-2 text-[13px] font-medium text-slate-600 dark:text-slate-300">الوحدة</p>
        <div className="flex flex-wrap gap-2">
          {units.map((u) => (
            <Button
              key={u}
              variant={unit === u ? "default" : "outline"}
              className="h-11 min-w-[4.5rem]"
              onClick={() => {
                setUnit(u)
                setQty(1)
              }}
            >
              {UNIT_LABEL[u]}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <p className="mb-2 text-[13px] font-medium text-slate-600 dark:text-slate-300">
          الكمية {max > 0 ? <span className="tabular-nums">(المتوفر يكفي {max})</span> : null}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-11 w-11 p-0" aria-label="أنقص" onClick={() => setQty((q) => Math.max(1, q - 1))}>
            <Minus className="h-4 w-4" />
          </Button>
          <Input
            value={qty}
            inputMode="numeric"
            aria-label="الكمية"
            onChange={(e) => setQty(wholeUnits(e.target.value))}
            className="h-11 w-20 text-center text-base font-bold tabular-nums"
          />
          <Button variant="outline" className="h-11 w-11 p-0" aria-label="زد" onClick={() => setQty((q) => q + 1)}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <p className="mt-5 text-lg font-bold tabular-nums">المجموع {money(line)}</p>
    </Dialog>
  )
}

/* ── cart ────────────────────────────────────────────────────────────── */

function CartPanel({
  cart,
  productById,
  total,
  notes,
  onNotes,
  onChange,
  onSubmit,
  submitting,
  specialPrice,
}: {
  cart: CartLine[]
  productById: Map<string, AgentProduct>
  total: number
  notes: string
  onNotes: (v: string) => void
  onChange: (updater: (prev: CartLine[]) => CartLine[]) => void
  onSubmit: () => void
  submitting: boolean
  specialPrice: (productId: string, unit: Unit) => number | null
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <ShoppingCart className="h-8 w-8 text-slate-300" />
            <p className="text-sm text-slate-500">السلة فارغة</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {cart.map((line, idx) => {
              const product = productById.get(line.productId)
              if (!product) return null
              const special = specialPrice(line.productId, line.unit)
              const lineTotal = (special ?? unitPrice(product, line.unit)) * line.quantity
              return (
                <li
                  key={`${line.productId}:${line.unit}`}
                  className="rounded-lg border p-3"
                  style={{ borderColor: "var(--theme-cardBorder)" }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[13px] font-medium leading-snug">{product.name}</p>
                    <button
                      type="button"
                      aria-label="احذف السطر"
                      onClick={() => onChange((prev) => prev.filter((_, i) => i !== idx))}
                      className="-m-1.5 grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {special != null && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <BadgePercent className="h-3 w-3" /> سعر خاص
                    </span>
                  )}

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        className="h-11 w-11 p-0"
                        aria-label="أنقص"
                        onClick={() =>
                          onChange((prev) =>
                            prev
                              .map((l, i) => (i === idx ? { ...l, quantity: l.quantity - 1 } : l))
                              .filter((l) => l.quantity > 0),
                          )
                        }
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <span className="min-w-9 text-center text-[15px] font-bold tabular-nums">
                        {line.quantity}
                      </span>
                      <Button
                        variant="outline"
                        className="h-11 w-11 p-0"
                        aria-label="زد"
                        onClick={() =>
                          onChange((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + 1 } : l)),
                          )
                        }
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                      <span className="ms-1 text-[12px] text-slate-500">{UNIT_LABEL[line.unit]}</span>
                    </div>
                    <span className="text-[14px] font-bold tabular-nums">{money(lineTotal)}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <textarea
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
          placeholder="ملاحظة على الطلب…"
          aria-label="ملاحظة على الطلب"
          rows={2}
          className="mt-3 w-full rounded border border-slate-300 bg-white p-3 text-[13.5px] placeholder:text-slate-400 focus:border-[var(--theme-accent)] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
        />
      </div>

      <div
        className="shrink-0 space-y-3 border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        style={{ borderColor: "var(--theme-cardBorder)" }}
      >
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-slate-500">المجموع</span>
          <span className="text-xl font-bold tabular-nums">{money(total)}</span>
        </div>
        <Button className="h-11 w-full" disabled={cart.length === 0 || submitting} onClick={onSubmit}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {submitting ? "جاري الإرسال…" : "أرسل الطلب"}
        </Button>
      </div>
    </div>
  )
}

/* ── customers ───────────────────────────────────────────────────────── */

function CustomersScreen({
  currentId,
  onPick,
  onNew,
  onOpenStatement,
}: {
  currentId: string | null
  onPick: (id: string) => void
  onNew: () => void
  onOpenStatement: (id: string) => void
}) {
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const customers = useMyCustomers(search, page)
  const rows = customers.data?.customers ?? []
  const pages = Math.max(1, Math.ceil((customers.data?.total ?? 0) / (customers.data?.limit || 200)))

  if (customers.error) {
    return <QueryErrorBox title="ما وصلت قائمة الزبائن" onRetry={() => void customers.refetch()} />
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>زبائني</CardTitle>
        <Button className="h-11 sm:h-9" onClick={onNew}>
          <UserPlus className="h-4 w-4" /> زبون جديد
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          placeholder="بحث بالاسم أو الهاتف"
          aria-label="بحث عن زبون"
          className="h-11 sm:h-9"
        />

        {customers.isPending ? (
          <Waiting q={customers} />
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            ما عندك زبائن بعد. أضف زبون جديد من الزر فوق.
          </p>
        ) : (
          <>
            {/* Phone: the same fields as the table, stacked.
                A five-column table on a 375px screen scrolls sideways, and the
                two buttons — the whole point of the row — end up off the edge
                where the rep never finds them. Same components and colours as
                the table below it, just not forced into a horizontal scroll. */}
            <ul className="space-y-2 sm:hidden">
              {rows.map((c) => {
                const quiet = c.daysSinceLastSale != null && c.daysSinceLastSale >= 30
                return (
                  <li
                    key={c.id}
                    className={cn(
                      "rounded-lg border p-3",
                      c.id === currentId && "bg-[var(--theme-accentSoft)]",
                    )}
                    style={{ borderColor: "var(--theme-cardBorder)" }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 font-medium">
                          {c.name}
                          {c.id === currentId && (
                            <Check className="h-3.5 w-3.5 shrink-0 text-[var(--theme-accent)]" />
                          )}
                        </p>
                        <p className="text-[12px] text-slate-500 tabular-nums" dir="ltr">
                          {c.phone}
                        </p>
                      </div>
                      <span className="shrink-0 font-medium tabular-nums">
                        {money(c.currentBalance)}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {c.area && <StatusPill tone="muted">{c.area}</StatusPill>}
                      {c.daysSinceLastSale === null ? (
                        <StatusPill tone="muted">ما اشترى</StatusPill>
                      ) : quiet ? (
                        <StatusPill tone="wait">من {c.daysSinceLastSale} يوم</StatusPill>
                      ) : null}
                    </div>

                    <div className="mt-3 flex gap-2">
                      <Button className="h-11 flex-1" onClick={() => onPick(c.id)}>
                        بيع
                      </Button>
                      <Button
                        variant="outline"
                        className="h-11 flex-1"
                        onClick={() => onOpenStatement(c.id)}
                      >
                        <Receipt className="h-4 w-4" /> كشف الحساب
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>

            <div className="hidden sm:block">
          <Table>
            <THead>
              <TR>
                <TH>الزبون</TH>
                <TH>الهاتف</TH>
                <TH>الرصيد</TH>
                <TH>آخر شراء</TH>
                <TH>الإجراء</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((c) => {
                const quiet = c.daysSinceLastSale != null && c.daysSinceLastSale >= 30
                return (
                  <TR key={c.id} className={c.id === currentId ? "bg-[var(--theme-accentSoft)]" : ""}>
                    <TD>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{c.name}</span>
                        {c.id === currentId && (
                          <Check className="h-3.5 w-3.5 text-[var(--theme-accent)]" />
                        )}
                      </div>
                      {c.area && <span className="text-[12px] text-slate-500">{c.area}</span>}
                    </TD>
                    <TD>
                      <span className="tabular-nums" dir="ltr">{c.phone}</span>
                    </TD>
                    <TD className="font-medium tabular-nums">{money(c.currentBalance)}</TD>
                    <TD>
                      {/* Quiet customers are the ones worth a visit, so they say
                          so on the row rather than hiding in a report. */}
                      {c.daysSinceLastSale === null ? (
                        <StatusPill tone="muted">ما اشترى</StatusPill>
                      ) : quiet ? (
                        <StatusPill tone="wait">من {c.daysSinceLastSale} يوم</StatusPill>
                      ) : (
                        <span className="text-[12px] text-slate-500 tabular-nums">
                          قبل {c.daysSinceLastSale} يوم
                        </span>
                      )}
                    </TD>
                    <TD>
                      <div className="flex gap-1.5">
                        <Button size="sm" onClick={() => onPick(c.id)}>
                          بيع
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => onOpenStatement(c.id)}>
                          <Receipt className="h-3.5 w-3.5" /> كشف
                        </Button>
                      </div>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
            </div>
          </>
        )}

        {(page > 1 || customers.data?.hasMore) && (
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronRight className="h-4 w-4" /> السابق
            </Button>
            <span className="text-[13px] text-slate-500 tabular-nums">
              {page} / {pages}
            </span>
            <Button variant="outline" disabled={!customers.data?.hasMore} onClick={() => setPage((p) => p + 1)}>
              التالي <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * New customer, with the duplicate check that has to happen BEFORE the save.
 *
 * The rep types a phone; the moment they leave the field the server is asked
 * whether that number is already known. Four answers, four different next steps.
 */
function NewCustomerScreen({
  onDone,
  onCancel,
}: {
  onDone: (customerId: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [address, setAddress] = useState("")
  const [area, setArea] = useState("")
  const [lookup, setLookup] = useState<PhoneLookup | null>(null)
  const qc = useQueryClient()

  const areas = useQuery({
    queryKey: ["sales-agent", "areas"],
    queryFn: async () => {
      const res = await api.get<{ data: string[] }>("/sales-agent/areas")
      return res.data.data ?? []
    },
    staleTime: 30 * 60 * 1000,
  })

  const checkPhone = useMutation({
    mutationFn: async (value: string) => {
      const res = await api.post<{ data: PhoneLookup }>("/sales-agent/customers/lookup", { phone: value })
      return res.data.data
    },
    onSuccess: setLookup,
    onError: () => setLookup(null),
  })

  /**
   * Look the number up while it is being typed, not only on blur.
   *
   * Waiting for blur meant the rep filled the whole form before learning the
   * customer already exists — and if they went straight from the phone field to
   * «احفظ», the check was still in flight while the button read as enabled.
   */
  const checkRef = useRef(checkPhone)
  checkRef.current = checkPhone
  useEffect(() => {
    const value = phone.trim()
    if (value.length < 10) return
    const t = setTimeout(() => checkRef.current.mutate(value), 400)
    return () => clearTimeout(t)
  }, [phone])

  const claim = useMutation({
    mutationFn: async (customerId: string) => {
      const res = await api.post("/sales-agent/customers/claim", { customerId })
      return res.data
    },
    onSuccess: (_data, customerId) => {
      toast({ title: "انضاف لزبائنك ✓" })
      void qc.invalidateQueries({ queryKey: ["sales-agent", "customers"] })
      onDone(customerId)
    },
    onError: (err) =>
      toast({ title: "ما انضاف", description: apiErrorMessage(err, "حاول مرة أخرى"), variant: "destructive" }),
  })

  const create = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: { id: string } }>("/sales-agent/customers", {
        name,
        phone,
        address: address.trim() || undefined,
        area: area || undefined,
      })
      return res.data.data
    },
    onSuccess: (data) => {
      toast({ title: "انضاف الزبون ✓", description: "تكدر تبيع له هسه" })
      void qc.invalidateQueries({ queryKey: ["sales-agent", "today"] })
      onDone(data.id)
    },
    onError: (err) =>
      toast({ title: "ما انحفظ", description: apiErrorMessage(err, "تحقق من البيانات"), variant: "destructive" }),
  })

  const blocked = Boolean(lookup?.found && !lookup.claimable && !lookup.mine)
  const canSave =
    name.trim().length > 0 && phone.trim().length > 0 && !lookup?.found && !checkPhone.isPending

  return (
    <Card>
      <CardHeader>
        <CardTitle>زبون جديد</CardTitle>
        <Button variant="outline" onClick={onCancel}>رجوع</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="اسم الزبون">
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-11" />
          </Field>
          <Field label="رقم الهاتف">
            <Input
              value={phone}
              dir="ltr"
              inputMode="tel"
              className="h-11"
              onChange={(e) => {
                setPhone(e.target.value)
                setLookup(null)
              }}
              onBlur={() => {
                if (phone.trim()) checkPhone.mutate(phone.trim())
              }}
              aria-describedby="phone-lookup"
            />
          </Field>
        </div>

        {checkPhone.isPending && (
          <p id="phone-lookup" className="flex items-center gap-2 text-[13px] text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> جاري التحقق من الرقم…
          </p>
        )}

        {lookup?.found && (
          <div
            className={cn(
              "rounded-lg border p-3",
              blocked
                ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
                : "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30",
            )}
          >
            <p
              className={cn(
                "text-[13px] font-medium leading-relaxed",
                blocked ? "text-amber-800 dark:text-amber-300" : "text-emerald-800 dark:text-emerald-300",
              )}
            >
              {lookup.message}
            </p>
            {lookup.mine && lookup.id && (
              <Button className="mt-2.5 h-11" onClick={() => onDone(lookup.id as string)}>
                استعمل هذا الزبون
              </Button>
            )}
            {lookup.claimable && lookup.id && (
              <Button
                className="mt-2.5 h-11"
                disabled={claim.isPending}
                onClick={() => claim.mutate(lookup.id as string)}
              >
                {claim.isPending ? "جاري الإضافة…" : "أضفه لزبائني وابدأ البيع"}
              </Button>
            )}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="العنوان">
            <Input value={address} onChange={(e) => setAddress(e.target.value)} className="h-11" />
          </Field>
          <Field label="المنطقة">
            {(areas.data ?? []).length === 0 ? (
              <p className="rounded border border-slate-300 bg-slate-50 p-2.5 text-[13px] text-slate-500 dark:border-slate-700 dark:bg-slate-900">
                ما اكو مناطق مضافة. صاحب المحل يضيفها من الإعدادات.
              </p>
            ) : (
              <select
                value={area}
                onChange={(e) => setArea(e.target.value)}
                aria-label="المنطقة"
                className="h-11 w-full cursor-pointer rounded border border-slate-300 bg-white px-3 text-[13.5px] focus:border-[var(--theme-accent)] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="">— اختر المنطقة —</option>
                {(areas.data ?? []).map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <Button className="h-11" disabled={!canSave || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {create.isPending ? "جاري الحفظ…" : "احفظ وابدأ البيع"}
        </Button>
      </CardContent>
    </Card>
  )
}

/* ── orders ──────────────────────────────────────────────────────────── */

const ORDER_STATUS: Record<string, { label: string; tone: "ok" | "wait" | "bad" }> = {
  PENDING: { label: "بانتظار الموافقة", tone: "wait" },
  APPROVED: { label: "تمت الموافقة", tone: "ok" },
  REJECTED: { label: "مرفوض", tone: "bad" },
}

function OrdersScreen() {
  const orders = useQuery({
    queryKey: ["sales-agent", "orders"],
    queryFn: async () => {
      const res = await api.get<{ data: AgentOrder[] }>("/sales-agent/orders")
      return res.data.data ?? []
    },
    retry: 3,
  })

  if (orders.error) return <QueryErrorBox title="ما وصلت الطلبات" onRetry={() => void orders.refetch()} />

  const rows = orders.data ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>طلباتي</CardTitle>
        <span className="text-[12px] text-slate-500 tabular-nums">{rows.length} طلب</span>
      </CardHeader>
      <CardContent>
        {orders.isPending ? (
          <Waiting q={orders} />
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">ما عندك طلبات بعد</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>الزبون</TH>
                <TH>المبلغ</TH>
                <TH>الأسطر</TH>
                <TH>التاريخ</TH>
                <TH>الحالة</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((o) => {
                const s = ORDER_STATUS[o.status] ?? { label: o.status, tone: "muted" as const }
                return (
                  <TR key={o.id}>
                    <TD className="font-medium">{o.customerName}</TD>
                    <TD className="font-medium tabular-nums">{money(o.total)}</TD>
                    <TD className="tabular-nums">{o.lineCount}</TD>
                    <TD className="tabular-nums">{shortDate(o.createdAt)}</TD>
                    <TD>
                      <StatusPill tone={s.tone as "ok" | "wait" | "bad"}>{s.label}</StatusPill>
                      {/* Without the reason the rep sees a bare «مرفوض» and has
                          to telephone to find out what to change. */}
                      {o.reviewNote && (
                        <p className="mt-1 text-[12px] text-red-600 dark:text-red-400">
                          السبب: {o.reviewNote}
                        </p>
                      )}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

/* ── money ───────────────────────────────────────────────────────────── */

/**
 * «فلوسي» — everything about money in one screen.
 *
 * «معي الآن» is the number the rep is personally answerable for, so it leads.
 * The day's takings sit beside it — sales AND collections — because both are
 * money and the rep was looking for them here rather than under «طلباتي».
 *
 * The rep records receipts here but NEVER a handover: only the owner writes
 * those.
 */
function MoneyScreen({
  customerId,
  customerName,
  onNeedCustomer,
}: {
  customerId: string | null
  customerName: string | null
  onNeedCustomer: () => void
}) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState("")
  const [notes, setNotes] = useState("")
  // A fresh key per saved receipt, so a retry after a timeout cannot bill twice.
  const requestId = useRef(crypto.randomUUID())

  const cash = useQuery({
    queryKey: ["sales-agent", "cash"],
    queryFn: async () => {
      const res = await api.get<{ data: CashOnHand }>("/sales-agent/cash-on-hand")
      return res.data.data
    },
    retry: 3,
  })

  const today = useQuery({
    queryKey: ["sales-agent", "today"],
    queryFn: async () => {
      const res = await api.get<{ data: AgentToday }>("/sales-agent/today")
      return res.data.data
    },
    retry: 3,
  })

  const receipts = useQuery({
    queryKey: ["sales-agent", "receipts"],
    queryFn: async () => {
      const res = await api.get<{ data: AgentReceipt[] }>("/sales-agent/receipts")
      return res.data.data ?? []
    },
    retry: 3,
  })

  const handovers = useQuery({
    queryKey: ["sales-agent", "handovers"],
    queryFn: async () => {
      const res = await api.get<{ data: AgentHandoverRow[] }>("/sales-agent/handovers")
      return res.data.data ?? []
    },
    retry: 3,
  })

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.post("/sales-agent/receipts", {
        customerId,
        amount: Number(amount),
        notes: notes.trim() || undefined,
        clientRequestId: requestId.current,
      })
      return res.data
    },
    onSuccess: () => {
      toast({ title: "انحفظ السند ✓" })
      setAmount("")
      setNotes("")
      requestId.current = crypto.randomUUID()
      void qc.invalidateQueries({ queryKey: ["sales-agent", "cash"] })
      void qc.invalidateQueries({ queryKey: ["sales-agent", "receipts"] })
      void qc.invalidateQueries({ queryKey: ["sales-agent", "today"] })
      // The customer just paid, so the balance in the page header is stale.
      void qc.invalidateQueries({ queryKey: ["sales-agent", "customer-header"] })
      void qc.invalidateQueries({ queryKey: ["sales-agent", "customers"] })
    },
    onError: (err) =>
      toast({
        title: "ما انحفظ السند",
        description: apiErrorMessage(err, "تحقق من المبلغ وحاول مرة أخرى"),
        variant: "destructive",
      }),
  })

  const saveReceipt = useOnce(save)

  const canSave = Boolean(customerId) && Number(amount) > 0 && !save.isPending
  const onHand = cash.data?.onHand ?? 0
  const d = today.data
  // A failed request must not print «معي الآن 0». Zero is a claim about the
  // rep's own cash, and they would act on it.
  const cashBroken = Boolean(cash.error) || cash.fetchStatus === "paused"
  const todayBroken = Boolean(today.error) || today.fetchStatus === "paused"

  return (
    <div className="space-y-4">
      {/* Three figures, and deliberately not a fourth: nothing here is a number
          the owner keeps private, so the rep reads their own day without the
          commission ever appearing on their phone. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          title="معي الآن"
          value={cashBroken ? "—" : cash.isPending ? "…" : money(onHand)}
          sub={
            cashBroken
              ? "ما وصل الرقم — تحقق من الاتصال"
              : cash.data
                ? `تحصّلت ${money(cash.data.collected)} · سلّمت ${money(cash.data.handedOver)}`
                : undefined
          }
          color={onHand < 0 ? "#EF4444" : "var(--theme-receipt)"}
          icon={<Wallet className="h-5 w-5" />}
        />
        <StatTile
          title="مبيعاتي اليوم"
          value={todayBroken ? "—" : d ? money(d.orderValue) : "…"}
          sub={
            todayBroken
              ? "ما وصل الرقم — تحقق من الاتصال"
              : d
              ? `${d.orders} طلب · ${d.customersVisited} زبون` +
                // Named rather than hidden: a rep whose figure drops should see
                // why, not wonder whether the screen is wrong.
                (d.rejectedOrders > 0 ? ` · ${d.rejectedOrders} مرفوض (${money(d.rejectedValue)})` : "")
              : undefined
          }
          color="var(--theme-accent)"
          icon={<ShoppingCart className="h-5 w-5" />}
        />
        <StatTile
          title="قبضت اليوم"
          value={todayBroken ? "—" : d ? money(d.collected) : "…"}
          sub={
            todayBroken
              ? "ما وصل الرقم — تحقق من الاتصال"
              : d
                ? `${d.receipts} سند · ${d.issues} مشكلة`
                : undefined
          }
          color="var(--theme-payment)"
          icon={<Receipt className="h-5 w-5" />}
        />
      </div>

      {onHand < 0 && !cashBroken && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-[13px] font-medium text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          الرصيد سالب — انلغى سند بعد ما سلّمته. راجع صاحب المحل.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>سجّل سند قبض</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {customerId ? (
            <p className="rounded bg-[var(--theme-accentSoft)] px-3 py-2 text-[13px] font-medium text-[var(--theme-accentDark)]">
              الزبون: {customerName}
            </p>
          ) : (
            <Button variant="outline" className="h-11" onClick={onNeedCustomer}>
              <Users className="h-4 w-4" /> اختر الزبون أول
            </Button>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="المبلغ">
              <Input
                value={amount}
                inputMode="numeric"
                onChange={(e) => setAmount(digitsOnly(e.target.value))}
                className="h-11 text-lg font-bold tabular-nums"
              />
            </Field>
            <Field label="ملاحظة">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-11" />
            </Field>
          </div>

          <Button className="h-11" disabled={!canSave} onClick={saveReceipt}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {save.isPending ? "جاري الحفظ…" : "احفظ السند"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>سنداتي</CardTitle>
          <span className="text-[12px] text-slate-500 tabular-nums">
            {(receipts.data ?? []).length} سند
          </span>
        </CardHeader>
        <CardContent>
          {receipts.isPending ? (
            <Waiting q={receipts} />
          ) : receipts.error ? (
            <QueryErrorBox title="ما وصلت السندات" onRetry={() => void receipts.refetch()} />
          ) : (receipts.data ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">ما اكو سندات</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>السند</TH>
                  <TH>الزبون</TH>
                  <TH>المبلغ</TH>
                  <TH>التاريخ</TH>
                </TR>
              </THead>
              <TBody>
                {(receipts.data ?? []).map((r) => (
                  <TR key={r.id} className={r.cancelled ? "opacity-60" : ""}>
                    <TD className="tabular-nums">{r.voucherNumber}</TD>
                    <TD>{r.customerName}</TD>
                    <TD className="font-medium tabular-nums">{money(r.amount)}</TD>
                    <TD className="tabular-nums">
                      {shortDate(r.date)}
                      {r.cancelled && <StatusPill tone="bad">ملغي</StatusPill>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>تسليماتي</CardTitle>
        </CardHeader>
        <CardContent>
          {handovers.isPending ? (
            <Waiting q={handovers} />
          ) : handovers.error ? (
            <QueryErrorBox title="ما وصلت التسليمات" onRetry={() => void handovers.refetch()} />
          ) : (handovers.data ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">ما سلّمت شي بعد</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>التاريخ</TH>
                  <TH>المبلغ</TH>
                  <TH>استلمه</TH>
                </TR>
              </THead>
              <TBody>
                {(handovers.data ?? []).map((h) => (
                  <TR key={h.id}>
                    <TD className="tabular-nums">{shortDate(h.date)}</TD>
                    <TD className="font-medium tabular-nums">{money(h.amount)}</TD>
                    <TD>{h.receivedBy}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** The site's stat card shape, with an accent top border. */
function StatTile({
  title,
  value,
  sub,
  color,
  icon,
}: {
  title: string
  value: string
  sub?: string
  color: string
  icon: React.ReactNode
}) {
  return (
    <div
      className="relative overflow-hidden rounded-lg border p-5"
      style={{
        backgroundColor: "var(--theme-cardBg)",
        borderColor: "var(--theme-cardBorder)",
        boxShadow: "0 1px 3px rgba(17,17,26,0.07)",
        borderTop: `3px solid ${color}`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-medium uppercase tracking-wide text-slate-500">{title}</p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums">{value}</p>
          {sub ? <p className="mt-0.5 text-[12px] text-slate-500 tabular-nums">{sub}</p> : null}
        </div>
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${color}18`, color }}
        >
          {icon}
        </div>
      </div>
    </div>
  )
}

/* ── «أكو مشكلة» ─────────────────────────────────────────────────────── */

/**
 * Why the shopkeeper said no.
 *
 * One tap on a fixed reason and the rep is done — free text alone would be
 * unreportable. The two optional fields carry the value: a note, and «من من
 * يشتريه وبأي سعر؟», which turns a lost sale into competitor pricing.
 */
function IssueDialog({
  product,
  unit,
  customerId,
  customerName,
  onClose,
}: {
  product: AgentProduct | null
  unit: Unit | null
  customerId: string
  customerName: string
  onClose: () => void
}) {
  const [reason, setReason] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [competitorInfo, setCompetitorInfo] = useState("")

  const reasons = useQuery({
    queryKey: ["sales-agent", "issue-reasons"],
    queryFn: async () => {
      const res = await api.get<{ data: IssueReason[] }>("/sales-agent/issue-reasons")
      return res.data.data ?? []
    },
    staleTime: 60 * 60 * 1000,
  })

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.post("/sales-agent/issues", {
        customerId,
        productId: product?.id,
        reason,
        note: note.trim() || undefined,
        competitorInfo: competitorInfo.trim() || undefined,
      })
      return res.data
    },
    onSuccess: () => {
      toast({ title: "انسجلت المشكلة ✓" })
      onClose()
    },
    onError: (err) =>
      toast({ title: "ما انسجلت", description: apiErrorMessage(err, "حاول مرة أخرى"), variant: "destructive" }),
  })

  const saveOnce = useOnce(save)

  return (
    <Dialog
      title="أكو مشكلة"
      onClose={onClose}
      footer={
        <Button className="h-11 w-full" disabled={!reason || save.isPending} onClick={saveOnce}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {save.isPending ? "جاري الحفظ…" : "احفظ"}
        </Button>
      }
    >
      <p className="rounded bg-slate-100 px-3 py-2 text-[13px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        {customerName}
        {product ? ` — ${product.name}` : ""}
        {unit ? ` (${UNIT_LABEL[unit]})` : ""}
      </p>

      <div className="mt-4 grid gap-2">
        {(reasons.data ?? []).map((r) => (
          <Button
            key={r.code}
            variant={reason === r.code ? "default" : "outline"}
            className="h-11 w-full justify-between"
            onClick={() => setReason(r.code)}
          >
            {r.label}
            {reason === r.code && <Check className="h-4 w-4" />}
          </Button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        <Field label="ملاحظة (اختياري)">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full rounded border border-slate-300 bg-white p-3 text-[13.5px] placeholder:text-slate-400 focus:border-[var(--theme-accent)] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
          />
        </Field>
        <Field label="من من يشتريه وبأي سعر؟">
          <textarea
            value={competitorInfo}
            onChange={(e) => setCompetitorInfo(e.target.value)}
            placeholder="اسم المجهز والسعر…"
            rows={2}
            className="w-full rounded border border-slate-300 bg-white p-3 text-[13.5px] placeholder:text-slate-400 focus:border-[var(--theme-accent)] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
          />
        </Field>
      </div>
    </Dialog>
  )
}

/**
 * The rep cannot discount, so this is the only route to a different price. It
 * goes to the same approvals screen as everything else, and an approved price is
 * spent on one order — it never becomes the customer's standing price.
 */
function PriceRequestDialog({
  product,
  unit,
  customerId,
  customerName,
  onClose,
}: {
  product: AgentProduct
  unit: Unit
  customerId: string
  customerName: string
  onClose: () => void
}) {
  const [price, setPrice] = useState("")
  const [reason, setReason] = useState("")
  const current = unitPrice(product, unit)

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.post("/sales-agent/price-requests", {
        customerId,
        productId: product.id,
        unit,
        requestedPrice: Number(price),
        reason: reason.trim() || undefined,
      })
      return res.data
    },
    onSuccess: () => {
      toast({ title: "انرسل طلب السعر ✓", description: "راح يوصلك جواب بعد الموافقة" })
      onClose()
    },
    onError: (err) =>
      toast({ title: "ما انرسل", description: apiErrorMessage(err, "حاول مرة أخرى"), variant: "destructive" }),
  })

  const saveOnce = useOnce(save)

  return (
    <Dialog
      title="اطلب سعراً خاصاً"
      onClose={onClose}
      footer={
        <Button
          className="h-11 w-full"
          disabled={!(Number(price) > 0) || save.isPending}
          onClick={saveOnce}
        >
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {save.isPending ? "جاري الإرسال…" : "أرسل الطلب"}
        </Button>
      }
    >
      <p className="rounded bg-slate-100 px-3 py-2 text-[13px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        {customerName} — {product.name} ({UNIT_LABEL[unit]})
      </p>

      <p className="mt-3 text-[13px] text-slate-500">
        السعر الحالي <span className="font-bold tabular-nums text-[var(--theme-textPrimary)]">{money(current)}</span>
      </p>

      <div className="mt-4 space-y-3">
        <Field label="السعر المطلوب">
          <Input
            value={price}
            inputMode="numeric"
            onChange={(e) => setPrice(digitsOnly(e.target.value))}
            className="h-11 text-lg font-bold tabular-nums"
          />
        </Field>
        <Field label="السبب">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="ليش يستاهل سعر خاص؟"
            rows={3}
            className="w-full rounded border border-slate-300 bg-white p-3 text-[13.5px] placeholder:text-slate-400 focus:border-[var(--theme-accent)] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
          />
        </Field>
      </div>

      <p className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-[12px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
        إذا انوافق، ينطبق على هذا الطلب فقط — ما يصير سعر دائم للزبون.
      </p>
    </Dialog>
  )
}

/* ── the rep's own issues + price requests ───────────────────────────── */

const PRICE_STATUS: Record<string, { label: string; tone: "ok" | "wait" | "bad" }> = {
  PENDING: { label: "بانتظار الموافقة", tone: "wait" },
  APPROVED: { label: "موافق عليه", tone: "ok" },
  REJECTED: { label: "مرفوض", tone: "bad" },
}

function MyIssuesScreen() {
  const issues = useQuery({
    queryKey: ["sales-agent", "issues"],
    queryFn: async () => {
      const res = await api.get<{ data: AgentIssue[] }>("/sales-agent/issues")
      return res.data.data ?? []
    },
    retry: 3,
  })

  const prices = useQuery({
    queryKey: ["sales-agent", "price-requests"],
    queryFn: async () => {
      const res = await api.get<{ data: AgentPriceRequest[] }>("/sales-agent/price-requests")
      return res.data.data ?? []
    },
    retry: 3,
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>طلبات الأسعار</CardTitle>
        </CardHeader>
        <CardContent>
          {prices.isPending ? (
            <Waiting q={prices} />
          ) : prices.error ? (
            <QueryErrorBox title="ما وصلت طلبات الأسعار" onRetry={() => void prices.refetch()} />
          ) : (prices.data ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">ما طلبت أسعار</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>المادة</TH>
                  <TH>الزبون</TH>
                  <TH>السعر</TH>
                  <TH>الحالة</TH>
                </TR>
              </THead>
              <TBody>
                {(prices.data ?? []).map((p) => {
                  const s = PRICE_STATUS[p.status] ?? { label: p.status, tone: "wait" as const }
                  return (
                    <TR key={p.id}>
                      <TD className="font-medium">{p.productName}</TD>
                      <TD>{p.customerName}</TD>
                      <TD className="tabular-nums">
                        {money(p.currentPrice)} ← {money(p.requestedPrice)}
                      </TD>
                      <TD>
                        <StatusPill tone={s.tone}>{s.label}</StatusPill>
                        {p.used && <span className="ms-1 text-[12px] text-slate-500">انستعمل</span>}
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>المشاكل الي سجّلتها</CardTitle>
        </CardHeader>
        <CardContent>
          {issues.isPending ? (
            <Waiting q={issues} />
          ) : issues.error ? (
            <QueryErrorBox title="ما وصلت المشاكل" onRetry={() => void issues.refetch()} />
          ) : (issues.data ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">ما سجّلت مشاكل</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>التاريخ</TH>
                  <TH>الزبون</TH>
                  <TH>المادة</TH>
                  <TH>السبب</TH>
                  <TH>المنافس</TH>
                </TR>
              </THead>
              <TBody>
                {(issues.data ?? []).map((i) => (
                  <TR key={i.id}>
                    <TD className="tabular-nums">{shortDate(i.createdAt)}</TD>
                    <TD className="font-medium">{i.customerName}</TD>
                    <TD>{i.productName ?? "—"}</TD>
                    <TD>
                      <StatusPill tone="muted">{i.reasonLabel}</StatusPill>
                      {i.note && <p className="mt-1 text-[12px] text-slate-500">{i.note}</p>}
                    </TD>
                    <TD className="text-[12px] text-slate-500">{i.competitorInfo ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/* ── customer detail ─────────────────────────────────────────────────── */

const TX_LABEL: Record<string, string> = {
  INVOICE: "فاتورة",
  INVOICE_PAYMENT: "دفعة على فاتورة",
  RECEIPT: "سند قبض",
  PAYMENT: "سند دفع",
  OPENING_BALANCE: "رصيد افتتاحي",
}

/**
 * «كشف الحساب» — the full account of one customer.
 *
 * These customers are the rep's responsibility and they see all of it. This
 * renders the shop's REAL statement, not a rep-flavoured summary, so the rep and
 * the owner can never argue from two different versions of one account.
 */
function CustomerDetailScreen({
  customerId,
  onBack,
}: {
  customerId: string
  onBack: () => void
}) {
  const statement = useQuery({
    queryKey: ["sales-agent", "customer-detail", customerId],
    queryFn: async () => {
      const res = await api.get<{ data: CustomerStatement }>(
        `/sales-agent/customers/${customerId}/detail`,
      )
      return res.data.data
    },
    retry: 3,
  })

  if (statement.error) {
    return <QueryErrorBox title="ما وصل كشف الحساب" onRetry={() => void statement.refetch()} />
  }

  const rows = statement.data?.transactions ?? []
  const last = rows.length > 0 ? rows[rows.length - 1] : null

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>كشف حساب {statement.data?.customer.name ?? ""}</CardTitle>
          {last?.runningBalance != null && (
            <p className="mt-0.5 text-[12px] text-slate-500 tabular-nums">
              الرصيد الحالي {money(last.runningBalance)} · الافتتاحي{" "}
              {money(statement.data?.customer.openingBalance ?? 0)}
            </p>
          )}
        </div>
        <Button variant="outline" onClick={onBack}>رجوع</Button>
      </CardHeader>
      <CardContent>
        {statement.isPending ? (
          <Waiting q={statement} />
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">ما اكو حركات</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>التاريخ</TH>
                <TH>النوع</TH>
                <TH>المرجع</TH>
                <TH>المبلغ</TH>
                <TH>الرصيد</TH>
              </TR>
            </THead>
            <TBody>
              {/* Newest first: the rep is standing in front of the shopkeeper and
                  the argument is always about the last few movements. */}
              {[...rows].reverse().map((row) => (
                <TR
                  key={`${row.id}:${row.type}`}
                  className={row.status === "CANCELLED" ? "opacity-60" : ""}
                >
                  <TD className="tabular-nums">{shortDate(row.date)}</TD>
                  <TD>
                    {TX_LABEL[row.type] ?? row.type}
                    {row.status === "CANCELLED" && <StatusPill tone="bad">ملغية</StatusPill>}
                  </TD>
                  <TD className="tabular-nums">{row.referenceNumber}</TD>
                  <TD className="font-medium tabular-nums">{money(row.amount)}</TD>
                  <TD className="tabular-nums">
                    {row.runningBalance != null ? money(row.runningBalance) : "—"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
