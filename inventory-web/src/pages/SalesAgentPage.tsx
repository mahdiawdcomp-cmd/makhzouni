/**
 * «المندوب» — the sales rep's screen.
 *
 * DESIGN BRIEF, and the tension it has to hold:
 *
 * A rep works standing in a shop doorway, in direct sun, on mobile data, holding
 * a phone in one hand. That argues for brutal contrast. But an app that looks
 * like a fax machine is an app nobody wants to open eight hours a day.
 *
 * Both, then. The colour lives in SURFACES — a deep indigo→violet header, tinted
 * status chips, an emerald money rail — while every piece of TEXT stays at
 * slate-900-on-white or white-on-indigo, which are 8:1 and above. Nothing
 * legible is ever printed in the accent colour on a light ground, which is where
 * "colourful" usually goes to die outdoors.
 *
 * Navigation sits at the BOTTOM. The old top tab bar put the five things a rep
 * does all day at the far end of a thumb's reach; on a phone held one-handed the
 * bottom third is the only comfortable zone, so that is where the tabs, the cart
 * and every primary action live.
 *
 * Motion is deliberate and sparse — one or two moving things per view, ease-out
 * on enter, and the whole system disabled under `prefers-reduced-motion`.
 *
 * Phone and tablet are two layouts, not one scaled: the tablet puts the order
 * beside the catalog so the shopkeeper watches their own invoice being built,
 * and swaps the bottom bar for a side rail.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import {
  AlertTriangle,
  ArrowRight,
  BadgePercent,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Grid3x3,
  Loader2,
  Minus,
  Plus,
  Receipt,
  Search,
  ShoppingCart,
  Tag,
  UserPlus,
  Users,
  Wallet,
  X,
} from "lucide-react"
import { api } from "../api/client"
import { toast } from "../components/ui/use-toast"
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
    // blanking the list a rep is reading in the street.
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

/* ── motion ──────────────────────────────────────────────────────────── */

/**
 * One spring for the whole screen.
 *
 * A single curve everywhere is what makes motion read as one system rather than
 * as several developers. Sheets and bars use this; small state changes use plain
 * CSS transitions, which are cheaper and never queue.
 */
const SPRING = { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.7 }

/** Screen-to-screen transition. Kept small — a big slide reads as a page reload. */
const screenIn = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const },
}

/* ── page ────────────────────────────────────────────────────────────── */

type Screen = "catalog" | "customers" | "new-customer" | "orders" | "money" | "customer-detail" | "issues"

type CartsByCustomer = Record<string, CartLine[]>

const CARTS_KEY = "sales_agent_carts"

const TABS: Array<{ key: Screen; label: string; Icon: typeof Grid3x3 }> = [
  { key: "catalog", label: "الكتلوك", Icon: Grid3x3 },
  { key: "customers", label: "زبائني", Icon: Users },
  { key: "money", label: "فلوسي", Icon: Wallet },
  { key: "issues", label: "المشاكل", Icon: AlertTriangle },
  { key: "orders", label: "طلباتي", Icon: ClipboardList },
]

export function SalesAgentPage() {
  const user = useAuthStore((s) => s.user)
  const qc = useQueryClient()
  const reduce = useReducedMotion()

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
  useEffect(() => {
    if (customerId && header.isError) {
      setCustomerId(null)
      setScreen("customers")
    }
  }, [customerId, header.isError])

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

  const cartCount = cart.reduce((n, l) => n + l.quantity, 0)

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
      className="agent-root flex h-[100dvh] flex-col overflow-hidden bg-[var(--bg)] text-[var(--ink)]"
    >
      <AgentStyles />

      <div className="flex min-h-0 flex-1 lg:flex-row-reverse">
        {/* Tablet rail. Replaces the bottom bar above lg, where a thumb is no
            longer the constraint and vertical space is worth more. */}
        <SideRail screen={screen} onScreen={setScreen} cartCount={cartCount} />

        <div className="flex min-h-0 flex-1 flex-col">
          <CustomerBar
            agentName={user?.name ?? "المندوب"}
            header={header.data ?? null}
            loading={header.isLoading}
            onSwitch={() => setScreen("customers")}
          />

          <div className="flex min-h-0 flex-1">
            <main className="agent-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={screen} {...(reduce ? {} : screenIn)}>
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
                        loading={products.isLoading}
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
                        body="الأسعار والرصيد مربوطة بالزبون، فلازم تختاره قبل ما تفتح الكتلوك."
                        actionLabel="روح لزبائني"
                        onAction={() => setScreen("customers")}
                      />
                    ))}
                </motion.div>
              </AnimatePresence>
            </main>

            {/* Tablet: the order builds beside the catalog, facing the
                shopkeeper. Below lg it is the bottom sheet instead. */}
            {showCart && (
              <aside className="hidden w-[24rem] shrink-0 flex-col border-e border-[var(--line)] bg-[var(--card)] lg:flex">
                <div className="border-b border-[var(--line)] px-4 py-3">
                  <h2 className="display text-lg font-extrabold">الطلب</h2>
                </div>
                <CartPanel
                  cart={cart}
                  productById={productById}
                  total={cartTotal}
                  notes={notes}
                  onNotes={setNotes}
                  onChange={setCart}
                  onSubmit={() => submit.mutate()}
                  submitting={submit.isPending}
                  specialPrice={specialPriceFor}
                />
              </aside>
            )}
          </div>
        </div>
      </div>

      {/* Floating cart bar, phone only. Springs in when the cart stops being
          empty — one of the two moving things in this view. */}
      <AnimatePresence>
        {showCart && cart.length > 0 && (
          <motion.button
            type="button"
            onClick={() => setCartOpen(true)}
            initial={reduce ? false : { y: 90, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduce ? undefined : { y: 90, opacity: 0 }}
            transition={SPRING}
            className="agent-cartbar fixed inset-x-3 bottom-[5.25rem] z-40 flex h-16 cursor-pointer items-center justify-between rounded-2xl px-5 text-white shadow-lg shadow-indigo-900/30 lg:hidden"
          >
            <span className="flex items-center gap-2 text-base font-extrabold">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-white/25">
                <ShoppingCart className="h-4 w-4" />
              </span>
              {cart.length} سطر
            </span>
            <span className="display text-2xl font-extrabold tabular-nums">{money(cartTotal)}</span>
          </motion.button>
        )}
      </AnimatePresence>

      <BottomNav screen={screen} onScreen={setScreen} cartCount={cartCount} />

      {/* ── sheets ── */}
      <AnimatePresence>
        {cartOpen && customerId && (
          <Sheet key="cart" title="الطلب" onClose={() => setCartOpen(false)} bodyPadding={false}>
            <CartPanel
              cart={cart}
              productById={productById}
              total={cartTotal}
              notes={notes}
              onNotes={setNotes}
              onChange={setCart}
              onSubmit={() => submit.mutate()}
              submitting={submit.isPending}
              specialPrice={specialPriceFor}
            />
          </Sheet>
        )}

        {openProduct && (
          <ProductSheet
            key="product"
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
          <IssueSheet
            key="issue"
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
          <PriceRequestSheet
            key="price"
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
      </AnimatePresence>
    </div>
  )
}

/* ── design tokens ───────────────────────────────────────────────────── */

/**
 * The palette, scoped to this screen.
 *
 * Every token is declared on the light ground first and only redefined for dark,
 * so nothing depends on a media query having matched. Text tokens all sit at or
 * above 7:1 on their own surface — that is the sunlight budget, and the accent
 * colours are spent on surfaces instead of on words.
 */
function AgentStyles() {
  return (
    <style>{`
      .agent-root {
        --bg: #EEF1F7;
        --card: #FFFFFF;
        --line: #DCE3ED;
        --ink: #0B1220;
        --ink-2: #3F4B5F;
        --ink-3: #64748B;
        --brand: #4338CA;
        --brand-soft: #EEF0FF;
        --money: #047857;
        --money-soft: #E7F6F0;
        --warn: #B45309;
        --warn-soft: #FEF3E2;
        --danger: #BE123C;
        --danger-soft: #FDECF1;
        font-family: "IBM Plex Sans Arabic", system-ui, sans-serif;
      }
      /* The app toggles a .dark class on <html> (see the @custom-variant in
         index.css). Keying this off prefers-color-scheme instead made the dark
         palette activate from the OS while the rest of the app stayed light,
         which put dark tokens underneath light-mode text. Backticks are banned
         in here: this whole block is a template literal. */
      .dark .agent-root {
        --bg: #070B14;
        --card: #111826;
        --line: #1F2A3C;
        --ink: #F1F5FB;
        --ink-2: #B4C0D2;
        --ink-3: #8494AA;
        --brand: #A5B4FC;
        --brand-soft: #1B2340;
        --money: #5EEAD4;
        --money-soft: #0C2A2A;
        --warn: #FCD34D;
        --warn-soft: #2E2410;
        --danger: #FDA4AF;
        --danger-soft: #331420;
      }
      .agent-root .display { font-family: "Cairo", "IBM Plex Sans Arabic", sans-serif; }

      /* The one gradient, on the two surfaces that anchor the screen. White on
         it measures ~8:1, which is what keeps it readable outdoors. */
      .agent-grad { background-image: linear-gradient(135deg, #4338CA 0%, #6D28D9 55%, #7C3AED 100%); }
      .agent-cartbar { background-image: linear-gradient(135deg, #4338CA 0%, #6D28D9 100%); }

      .agent-scroll { scrollbar-width: thin; }
      .agent-scroll::-webkit-scrollbar { width: 6px; }
      .agent-scroll::-webkit-scrollbar-thumb { background: var(--line); border-radius: 9999px; }

      /* Press feedback beats hover on a touch screen: there is no hover, and a
         card that visibly gives under the thumb is the only confirmation the tap
         registered before the sheet opens. */
      .press { transition: transform .12s ease-out, box-shadow .2s ease-out, background-color .2s ease-out; }
      .press:active { transform: scale(.972); }

      .shimmer {
        background: linear-gradient(90deg, var(--line) 25%, var(--bg) 50%, var(--line) 75%);
        background-size: 200% 100%;
        animation: agentShimmer 1.3s ease-in-out infinite;
      }
      @keyframes agentShimmer { to { background-position: -200% 0; } }

      @media (prefers-reduced-motion: reduce) {
        .agent-root *, .agent-root *::before, .agent-root *::after {
          animation-duration: .01ms !important;
          animation-iteration-count: 1 !important;
          transition-duration: .01ms !important;
        }
        .press:active { transform: none; }
      }
    `}</style>
  )
}

/* ── chrome ──────────────────────────────────────────────────────────── */

/** Who the rep is selling to. The one place colour is spent at full strength. */
function CustomerBar({
  agentName,
  header,
  loading,
  onSwitch,
}: {
  agentName: string
  header: CustomerHeader | null
  loading: boolean
  onSwitch: () => void
}) {
  return (
    <header className="agent-grad shrink-0 px-4 pb-4 pt-3 text-white">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {loading && !header ? (
            <div className="space-y-2">
              <div className="h-5 w-40 rounded-full bg-white/25" />
              <div className="h-4 w-56 rounded-full bg-white/15" />
            </div>
          ) : header ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-white/75">
                تبيع لـ
              </p>
              <h1 className="display truncate text-xl font-extrabold leading-tight">{header.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white/20 px-3 py-1 text-sm font-bold tabular-nums">
                  الرصيد {money(header.currentBalance)}
                </span>
                {header.lastPayment ? (
                  <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold tabular-nums">
                    آخر دفعة {money(header.lastPayment.amount)} ·{" "}
                    {new Date(header.lastPayment.date).toLocaleDateString("en-GB")}
                  </span>
                ) : (
                  <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
                    ما عنده دفعات
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              <h1 className="display truncate text-xl font-extrabold leading-tight">{agentName}</h1>
              <p className="mt-1 text-sm font-semibold text-white/85">ما مختار زبون</p>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onSwitch}
          className="press flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-white/20 px-3.5 text-sm font-bold hover:bg-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <ArrowRight className="h-4 w-4" />
          تبديل
        </button>
      </div>
    </header>
  )
}

/**
 * Bottom navigation — phone only.
 *
 * The five things a rep does all day, in the only zone a one-handed thumb
 * reaches comfortably. The active pill slides between tabs with a shared
 * layoutId, which is the second and last moving thing in the main view.
 */
function BottomNav({
  screen,
  onScreen,
  cartCount,
}: {
  screen: Screen
  onScreen: (s: Screen) => void
  cartCount: number
}) {
  const reduce = useReducedMotion()
  return (
    <nav
      className="relative z-50 shrink-0 border-t border-[var(--line)] bg-[var(--card)] px-2 pb-[env(safe-area-inset-bottom)] lg:hidden"
      aria-label="التنقل"
    >
      <div className="flex items-stretch">
        {TABS.map(({ key, label, Icon }) => {
          const active = screen === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => onScreen(key)}
              aria-current={active ? "page" : undefined}
              className="relative flex min-h-[3.75rem] flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--brand)]"
            >
              {active &&
                (reduce ? (
                  <span className="absolute inset-x-1 inset-y-1 -z-10 rounded-xl bg-[var(--brand-soft)]" />
                ) : (
                  <motion.span
                    layoutId="agent-tab"
                    transition={SPRING}
                    className="absolute inset-x-1 inset-y-1 -z-10 rounded-xl bg-[var(--brand-soft)]"
                  />
                ))}
              <span className="relative">
                <Icon
                  className={cn("h-5 w-5", active ? "text-[var(--brand)]" : "text-[var(--ink-3)]")}
                  strokeWidth={active ? 2.6 : 2}
                />
                {key === "catalog" && cartCount > 0 && (
                  <span className="absolute -end-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-bold text-white">
                    {cartCount > 99 ? "99" : cartCount}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "text-[11px] font-bold leading-none",
                  active ? "text-[var(--brand)]" : "text-[var(--ink-3)]",
                )}
              >
                {label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

/** Tablet rail — same destinations, vertical, where a bottom bar would waste height. */
function SideRail({
  screen,
  onScreen,
  cartCount,
}: {
  screen: Screen
  onScreen: (s: Screen) => void
  cartCount: number
}) {
  return (
    <nav
      className="hidden w-24 shrink-0 flex-col gap-1 border-s border-[var(--line)] bg-[var(--card)] p-2 lg:flex"
      aria-label="التنقل"
    >
      {TABS.map(({ key, label, Icon }) => {
        const active = screen === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => onScreen(key)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-1.5 rounded-xl px-2 py-3 transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]",
              active ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "text-[var(--ink-3)] hover:bg-[var(--bg)]",
            )}
          >
            <span className="relative">
              <Icon className="h-5 w-5" strokeWidth={active ? 2.6 : 2} />
              {key === "catalog" && cartCount > 0 && (
                <span className="absolute -end-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-bold text-white">
                  {cartCount > 99 ? "99" : cartCount}
                </span>
              )}
            </span>
            <span className="text-[11px] font-bold leading-none">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}

/* ── shared shells ───────────────────────────────────────────────────── */

/**
 * Full-height sheet.
 *
 * Springs from the bottom on a phone and centres on a tablet, because a
 * full-width slide across a large screen reads as the whole app moving. Backdrop
 * click and Escape both close it.
 */
function Sheet({
  title,
  onClose,
  children,
  footer,
  bodyPadding = true,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  bodyPadding?: boolean
}) {
  const reduce = useReducedMotion()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex flex-col justify-end lg:justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <button
        type="button"
        aria-label="إغلاق"
        onClick={onClose}
        className="absolute inset-0 cursor-pointer bg-slate-950/45"
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={reduce ? { opacity: 0 } : { y: "100%" }}
        animate={reduce ? { opacity: 1 } : { y: 0 }}
        exit={reduce ? { opacity: 0 } : { y: "100%" }}
        transition={SPRING}
        className="relative flex max-h-[92dvh] min-h-0 flex-col rounded-t-3xl bg-[var(--card)] shadow-2xl lg:mx-auto lg:max-h-[86dvh] lg:w-[34rem] lg:rounded-3xl"
      >
        <div className="shrink-0 px-4 pb-2 pt-3">
          <div className="mx-auto mb-3 h-1.5 w-11 rounded-full bg-[var(--line)] lg:hidden" />
          <div className="flex items-center justify-between gap-3">
            <h2 className="display truncate text-lg font-extrabold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق"
              /* 44px, not 40: the minimum comfortable touch target, and this is
                 the control a rep hits with a thumb while holding the phone. */
              className="press grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl bg-[var(--bg)] text-[var(--ink-2)] hover:bg-[var(--line)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div
          className={cn(
            "agent-scroll flex min-h-0 flex-1 flex-col overflow-y-auto",
            bodyPadding && "px-4 pb-4",
          )}
        >
          {children}
        </div>

        {footer && (
          <div className="shrink-0 border-t border-[var(--line)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

/** The one primary button shape on the screen. */
function PrimaryButton({
  children,
  onClick,
  disabled,
  loading,
  tone = "brand",
  className,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
  tone?: "brand" | "money"
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "press flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl text-base font-extrabold text-white shadow-md",
        tone === "brand"
          ? "bg-[#4338CA] shadow-indigo-900/20 hover:bg-[#3730A3]"
          : "bg-[#047857] shadow-emerald-900/20 hover:bg-[#065F46]",
        "disabled:cursor-not-allowed disabled:bg-slate-400 disabled:shadow-none",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]",
        className,
      )}
    >
      {loading && <Loader2 className="h-5 w-5 animate-spin" />}
      {children}
    </button>
  )
}

function GhostButton({
  children,
  onClick,
  className,
  icon: Icon,
}: {
  children: React.ReactNode
  onClick?: () => void
  className?: string
  icon?: typeof Tag
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "press flex h-12 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--card)] text-sm font-bold text-[var(--ink-2)] hover:bg-[var(--bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]",
        className,
      )}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </button>
  )
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4", className)}>
      {children}
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  onBlur,
  inputMode,
  dir,
  big,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  inputMode?: "text" | "tel" | "numeric"
  dir?: "rtl" | "ltr"
  big?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-bold text-[var(--ink-2)]">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        inputMode={inputMode}
        dir={dir}
        className={cn(
          "w-full rounded-xl border border-[var(--line)] bg-[var(--card)] px-3.5 text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:border-[var(--brand)] focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-[var(--brand)]",
          big
            ? "display h-16 text-2xl font-extrabold tabular-nums"
            : "h-12 text-base font-semibold",
        )}
      />
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
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
        <Users className="h-7 w-7" />
      </div>
      <h2 className="display text-xl font-extrabold">{title}</h2>
      <p className="max-w-xs text-sm font-semibold leading-relaxed text-[var(--ink-2)]">{body}</p>
      <PrimaryButton className="mt-2 max-w-xs" onClick={onAction}>
        {actionLabel}
      </PrimaryButton>
    </div>
  )
}

/** Skeletons, not a spinner: they reserve the row height so nothing jumps. */
function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
          <div className="shimmer aspect-square w-full" />
          <div className="space-y-2 p-3">
            <div className="shimmer h-3.5 w-4/5 rounded-full" />
            <div className="shimmer h-5 w-1/2 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
          <div className="shimmer mb-2 h-4 w-1/2 rounded-full" />
          <div className="shimmer h-3.5 w-3/4 rounded-full" />
        </div>
      ))}
    </div>
  )
}

/* ── catalog ─────────────────────────────────────────────────────────── */

function CatalogScreen({
  products,
  loading,
  error,
  onRetry,
  search,
  onSearch,
  onOpen,
  specialPrice,
}: {
  products: AgentProduct[]
  loading: boolean
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

  if (error) {
    return (
      <EmptyState
        title="ما وصلت المواد"
        body="تحقق من الاتصال وحاول مرة أخرى."
        actionLabel="حاول مرة أخرى"
        onAction={onRetry}
      />
    )
  }

  return (
    <div className="p-3 pb-40 lg:pb-6">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute inset-y-0 start-3.5 my-auto h-5 w-5 text-[var(--ink-3)]" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="دور على مادة…"
          aria-label="بحث عن مادة"
          className="h-12 w-full rounded-2xl border border-[var(--line)] bg-[var(--card)] pe-4 ps-11 text-base font-semibold text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:border-[var(--brand)] focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-[var(--brand)]"
        />
      </div>

      {loading ? (
        <SkeletonGrid count={8} />
      ) : products.length === 0 ? (
        <p className="py-16 text-center text-base font-bold text-[var(--ink-2)]">ما اكو نتائج</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {products.map((product) => {
            const out = product.currentStock <= 0
            const special = availableUnits(product).some((u) => specialPrice(product.id, u) !== null)
            return (
              <button
                key={product.id}
                type="button"
                data-pid={product.id}
                ref={observe}
                onClick={() => onOpen(product)}
                className="press flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] text-start shadow-sm hover:border-[var(--brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
              >
                <div className="relative aspect-square w-full bg-[var(--bg)]">
                  {thumbs[product.id] ? (
                    <img
                      src={thumbs[product.id] as string}
                      alt={product.name}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-[var(--ink-3)]">
                      <Tag className="h-7 w-7" />
                    </div>
                  )}

                  {special && (
                    <span className="absolute end-2 top-2 flex items-center gap-1 rounded-full bg-[#047857] px-2 py-1 text-[10px] font-bold text-white shadow">
                      <BadgePercent className="h-3 w-3" />
                      سعر خاص
                    </span>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-1.5 p-3">
                  <p className="line-clamp-2 text-sm font-bold leading-snug text-[var(--ink)]">
                    {product.name}
                  </p>
                  <p className="display mt-auto text-lg font-extrabold tabular-nums text-[var(--ink)]">
                    {money(product.salePrice)}
                  </p>
                  {/* The real number, always — the shop's policy is that a
                      shortage never blocks a sale, so a product at or below zero
                      is still shown and still sellable. */}
                  <span
                    className={cn(
                      "w-fit rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
                      out ? "bg-[var(--warn-soft)] text-[var(--warn)]" : "bg-[var(--brand-soft)] text-[var(--brand)]",
                    )}
                  >
                    {out ? `ناقص ${Math.abs(product.currentStock)}` : `متوفر ${product.currentStock}`}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * The product sheet.
 *
 * Full picture, price for the chosen unit, real stock, and the three things the
 * rep does next — add it, record why the shopkeeper refused it, or ask for a
 * price. All three sit in the footer, in the thumb zone.
 */
function ProductSheet({
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
    <Sheet
      title={product.name}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          <PrimaryButton onClick={() => onAdd(unit, qty)}>
            <Plus className="h-5 w-5" />
            أضف للطلب · {money(line)}
          </PrimaryButton>
          <div className="flex gap-2">
            <GhostButton icon={AlertTriangle} onClick={() => onIssue(unit)}>
              أكو مشكلة
            </GhostButton>
            <GhostButton icon={BadgePercent} onClick={() => onAskPrice(unit)}>
              اطلب سعر
            </GhostButton>
          </div>
        </div>
      }
    >
      <div className="mx-auto aspect-square w-full max-w-xs shrink-0 overflow-hidden rounded-2xl bg-[var(--bg)]">
        {image ? (
          <img src={image} alt={product.name} className="h-full w-full object-contain" />
        ) : (
          <div className="grid h-full w-full place-items-center text-[var(--ink-3)]">
            <Tag className="h-10 w-10" />
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="rounded-xl bg-[var(--brand-soft)] px-3 py-2 text-sm font-bold tabular-nums text-[var(--brand)]">
          القطعة {money(product.salePrice)}
        </span>
        <span
          className={cn(
            "rounded-xl px-3 py-2 text-sm font-bold tabular-nums",
            product.currentStock <= 0
              ? "bg-[var(--warn-soft)] text-[var(--warn)]"
              : "bg-[var(--money-soft)] text-[var(--money)]",
          )}
        >
          {product.currentStock <= 0
            ? `ناقص ${Math.abs(product.currentStock)} قطعة`
            : `متوفر ${product.currentStock} قطعة`}
        </span>
      </div>

      {approved != null && (
        <div className="mt-3 rounded-2xl border border-[var(--money)] bg-[var(--money-soft)] p-3">
          <p className="flex items-center gap-1.5 text-sm font-extrabold text-[var(--money)]">
            <BadgePercent className="h-4 w-4" />
            سعر خاص موافق عليه
          </p>
          <p className="display mt-1 text-2xl font-extrabold tabular-nums text-[var(--money)]">
            {money(approved)}
          </p>
          <p className="mt-1 text-xs font-semibold text-[var(--ink-2)]">
            ينطبق على هذا الطلب فقط، ويُستهلك أول ما ترسل الطلب.
          </p>
        </div>
      )}

      <fieldset className="mt-5">
        <legend className="mb-2 text-sm font-bold text-[var(--ink-2)]">الوحدة</legend>
        <div className="flex flex-wrap gap-2">
          {units.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => {
                setUnit(u)
                setQty(1)
              }}
              aria-pressed={unit === u}
              className={cn(
                "press h-12 min-w-[5rem] cursor-pointer rounded-xl px-4 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]",
                unit === u
                  ? "bg-[#4338CA] text-white shadow-md shadow-indigo-900/20"
                  : "border border-[var(--line)] bg-[var(--card)] text-[var(--ink-2)] hover:bg-[var(--bg)]",
              )}
            >
              {UNIT_LABEL[u]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-5">
        <p className="mb-2 text-sm font-bold text-[var(--ink-2)]">
          الكمية {max > 0 ? <span className="tabular-nums">(المتوفر يكفي {max})</span> : null}
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="أنقص"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="press grid h-14 w-14 cursor-pointer place-items-center rounded-xl border border-[var(--line)] bg-[var(--card)] text-[var(--ink)] hover:bg-[var(--bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
          >
            <Minus className="h-5 w-5" />
          </button>
          <input
            value={qty}
            inputMode="numeric"
            aria-label="الكمية"
            onChange={(e) => {
              const n = Number(e.target.value.replace(/\D/g, ""))
              setQty(Number.isFinite(n) && n > 0 ? n : 1)
            }}
            className="display h-14 w-24 rounded-xl border border-[var(--line)] bg-[var(--card)] text-center text-2xl font-extrabold tabular-nums text-[var(--ink)] focus:border-[var(--brand)] focus:outline focus:outline-2 focus:outline-[var(--brand)]"
          />
          <button
            type="button"
            aria-label="زد"
            onClick={() => setQty((q) => q + 1)}
            className="press grid h-14 w-14 cursor-pointer place-items-center rounded-xl border border-[var(--line)] bg-[var(--card)] text-[var(--ink)] hover:bg-[var(--bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
      </div>

      <p className="display mt-5 text-2xl font-extrabold tabular-nums">المجموع {money(line)}</p>
    </Sheet>
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
      <div className="agent-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--bg)] text-[var(--ink-3)]">
              <ShoppingCart className="h-6 w-6" />
            </div>
            <p className="text-base font-bold text-[var(--ink-2)]">السلة فارغة</p>
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
                  className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold leading-snug text-[var(--ink)]">{product.name}</p>
                    <button
                      type="button"
                      aria-label="احذف السطر"
                      onClick={() => onChange((prev) => prev.filter((_, i) => i !== idx))}
                      className="press -m-1.5 grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg text-[var(--ink-3)] hover:bg-[var(--bg)] hover:text-[var(--danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {special != null && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[var(--money-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--money)]">
                      <BadgePercent className="h-3 w-3" />
                      سعر خاص
                    </span>
                  )}

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label="أنقص"
                        onClick={() =>
                          onChange((prev) =>
                            prev
                              .map((l, i) => (i === idx ? { ...l, quantity: l.quantity - 1 } : l))
                              .filter((l) => l.quantity > 0),
                          )
                        }
                        className="press grid h-11 w-11 cursor-pointer place-items-center rounded-lg border border-[var(--line)] text-[var(--ink)] hover:bg-[var(--bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="display min-w-10 text-center text-lg font-extrabold tabular-nums">
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label="زد"
                        onClick={() =>
                          onChange((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + 1 } : l)),
                          )
                        }
                        className="press grid h-11 w-11 cursor-pointer place-items-center rounded-lg border border-[var(--line)] text-[var(--ink)] hover:bg-[var(--bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                      <span className="ms-1 rounded-lg bg-[var(--bg)] px-2 py-1 text-xs font-bold text-[var(--ink-2)]">
                        {UNIT_LABEL[line.unit]}
                      </span>
                    </div>
                    <span className="display text-base font-extrabold tabular-nums">
                      {money(lineTotal)}
                    </span>
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
          className="mt-3 w-full rounded-2xl border border-[var(--line)] bg-[var(--card)] p-3 text-sm font-semibold text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:border-[var(--brand)] focus:outline focus:outline-2 focus:outline-[var(--brand)]"
        />
      </div>

      <div className="shrink-0 space-y-3 border-t border-[var(--line)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-bold text-[var(--ink-2)]">المجموع</span>
          <span className="display text-2xl font-extrabold tabular-nums">{money(total)}</span>
        </div>
        <PrimaryButton disabled={cart.length === 0} loading={submitting} onClick={onSubmit}>
          {submitting ? "جاري الإرسال…" : "أرسل الطلب"}
        </PrimaryButton>
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

  return (
    <div className="p-3 pb-28 lg:pb-6">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute inset-y-0 start-3.5 my-auto h-5 w-5 text-[var(--ink-3)]" />
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          placeholder="دور بالاسم أو الرقم…"
          aria-label="بحث عن زبون"
          className="h-12 w-full rounded-2xl border border-[var(--line)] bg-[var(--card)] pe-4 ps-11 text-base font-semibold text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:border-[var(--brand)] focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-[var(--brand)]"
        />
      </div>

      {customers.isLoading ? (
        <SkeletonRows count={5} />
      ) : customers.isError ? (
        <EmptyState
          title="ما وصلت القائمة"
          body="تحقق من الاتصال وحاول مرة أخرى."
          actionLabel="حاول مرة أخرى"
          onAction={() => void customers.refetch()}
        />
      ) : rows.length === 0 ? (
        <p className="py-12 text-center text-base font-bold text-[var(--ink-2)]">
          ما عندك زبائن بعد. أضف زبون جديد من الزر تحت.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((c) => {
            const active = c.id === currentId
            const quiet = c.daysSinceLastSale != null && c.daysSinceLastSale >= 30
            return (
              <li
                key={c.id}
                className={cn(
                  "overflow-hidden rounded-2xl border bg-[var(--card)]",
                  active ? "border-[var(--brand)] ring-1 ring-[var(--brand)]" : "border-[var(--line)]",
                )}
              >
                {/* Two targets, both full height: selling to a customer and
                    reading their account are different intents, and fumbling one
                    for the other in the street is a real cost. */}
                <button
                  type="button"
                  onClick={() => onPick(c.id)}
                  className="press w-full cursor-pointer p-3.5 text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--brand)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="display text-base font-extrabold leading-snug text-[var(--ink)]">
                      {c.name}
                    </p>
                    {active && (
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--brand)]">
                        <Check className="h-3 w-3" />
                        مختار
                      </span>
                    )}
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span
                      className="rounded-lg bg-[var(--bg)] px-2 py-1 text-xs font-bold tabular-nums text-[var(--ink-2)]"
                      dir="ltr"
                    >
                      {c.phone}
                    </span>
                    <span className="rounded-lg bg-[var(--brand-soft)] px-2 py-1 text-xs font-bold tabular-nums text-[var(--brand)]">
                      الرصيد {money(c.currentBalance)}
                    </span>
                    {c.area && (
                      <span className="rounded-lg bg-[var(--bg)] px-2 py-1 text-xs font-bold text-[var(--ink-2)]">
                        {c.area}
                      </span>
                    )}
                  </div>

                  {/* Quiet customers are the ones worth a visit, so they say so
                      on the row rather than hiding in a report nobody opens. */}
                  {(c.daysSinceLastSale === null || quiet) && (
                    <p className="mt-1.5 flex items-center gap-1 text-xs font-bold text-[var(--warn)]">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {c.daysSinceLastSale === null
                        ? "ما اشترى ولا مرة"
                        : `ما اشترى من ${c.daysSinceLastSale} يوم`}
                    </p>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => onOpenStatement(c.id)}
                  className="flex h-11 w-full cursor-pointer items-center justify-center gap-1.5 border-t border-[var(--line)] text-sm font-bold text-[var(--ink-2)] hover:bg-[var(--bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--brand)]"
                >
                  <Receipt className="h-4 w-4" />
                  كشف الحساب
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {(page > 1 || customers.data?.hasMore) && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <GhostButton icon={ChevronRight} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            السابق
          </GhostButton>
          <span className="shrink-0 text-sm font-bold tabular-nums text-[var(--ink-2)]">
            {page} / {pages}
          </span>
          <GhostButton icon={ChevronLeft} onClick={() => setPage((p) => p + 1)}>
            التالي
          </GhostButton>
        </div>
      )}

      <div className="sticky bottom-3 mt-4">
        <PrimaryButton onClick={onNew}>
          <UserPlus className="h-5 w-5" />
          زبون جديد
        </PrimaryButton>
      </div>
    </div>
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
      const res = await api.post<{ data: PhoneLookup }>("/sales-agent/customers/lookup", {
        phone: value,
      })
      return res.data.data
    },
    onSuccess: setLookup,
    onError: () => setLookup(null),
  })

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
  const canSave = name.trim().length > 0 && phone.trim().length > 0 && !lookup?.found

  return (
    <div className="p-3 pb-28 lg:pb-6">
      <Card className="space-y-4">
        <TextField label="اسم الزبون" value={name} onChange={setName} />

        <TextField
          label="رقم الهاتف"
          value={phone}
          onChange={(v) => {
            setPhone(v)
            setLookup(null)
          }}
          onBlur={() => {
            if (phone.trim()) checkPhone.mutate(phone.trim())
          }}
          inputMode="tel"
          dir="ltr"
        />

        {checkPhone.isPending && (
          <p className="flex items-center gap-2 text-sm font-bold text-[var(--ink-2)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            جاري التحقق من الرقم…
          </p>
        )}

        <AnimatePresence>
          {lookup?.found && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className={cn(
                "rounded-2xl border p-3",
                blocked ? "border-[var(--warn)] bg-[var(--warn-soft)]" : "border-[var(--money)] bg-[var(--money-soft)]",
              )}
            >
              <p
                className={cn(
                  "text-sm font-bold leading-relaxed",
                  blocked ? "text-[var(--warn)]" : "text-[var(--money)]",
                )}
              >
                {lookup.message}
              </p>
              {lookup.mine && lookup.id && (
                <PrimaryButton className="mt-2.5" tone="money" onClick={() => onDone(lookup.id as string)}>
                  استعمل هذا الزبون
                </PrimaryButton>
              )}
              {lookup.claimable && lookup.id && (
                <PrimaryButton
                  className="mt-2.5"
                  tone="money"
                  loading={claim.isPending}
                  onClick={() => claim.mutate(lookup.id as string)}
                >
                  {claim.isPending ? "جاري الإضافة…" : "أضفه لزبائني وابدأ البيع"}
                </PrimaryButton>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <TextField label="العنوان" value={address} onChange={setAddress} />

        <div>
          <span className="mb-1.5 block text-sm font-bold text-[var(--ink-2)]">المنطقة</span>
          {(areas.data ?? []).length === 0 ? (
            <p className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-sm font-semibold text-[var(--ink-2)]">
              ما اكو مناطق مضافة. صاحب المحل يضيفها من الإعدادات.
            </p>
          ) : (
            <select
              value={area}
              onChange={(e) => setArea(e.target.value)}
              aria-label="المنطقة"
              className="h-12 w-full cursor-pointer rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 text-base font-semibold text-[var(--ink)] focus:border-[var(--brand)] focus:outline focus:outline-2 focus:outline-[var(--brand)]"
            >
              <option value="">— اختر المنطقة —</option>
              {(areas.data ?? []).map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          )}
        </div>
      </Card>

      <div className="sticky bottom-3 mt-4 space-y-2">
        <PrimaryButton disabled={!canSave} loading={create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? "جاري الحفظ…" : "احفظ وابدأ البيع"}
        </PrimaryButton>
        <GhostButton className="w-full" onClick={onCancel}>
          رجوع
        </GhostButton>
      </div>
    </div>
  )
}

/* ── orders ──────────────────────────────────────────────────────────── */

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "بانتظار الموافقة", cls: "bg-[var(--warn-soft)] text-[var(--warn)]" },
  APPROVED: { label: "تمت الموافقة", cls: "bg-[var(--money-soft)] text-[var(--money)]" },
  REJECTED: { label: "مرفوض", cls: "bg-[var(--danger-soft)] text-[var(--danger)]" },
}

/** Three numbers the rep can read without any figure the owner keeps private. */
function TodayStrip() {
  const today = useQuery({
    queryKey: ["sales-agent", "today"],
    queryFn: async () => {
      const res = await api.get<{ data: AgentToday }>("/sales-agent/today")
      return res.data.data
    },
    retry: 3,
  })

  const d = today.data
  if (!d) return null

  const cells = [
    { label: "زبون", value: String(d.customersVisited) },
    { label: "باع", value: money(d.orderValue) },
    { label: "قبض", value: money(d.collected) },
  ]

  return (
    <Card className="mb-3 border-transparent bg-[var(--brand-soft)]">
      <p className="display text-sm font-extrabold text-[var(--brand)]">يومي</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {cells.map((c) => (
          <div key={c.label} className="text-center">
            <p className="display text-xl font-extrabold tabular-nums text-[var(--ink)]">{c.value}</p>
            <p className="text-xs font-bold text-[var(--ink-2)]">{c.label}</p>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] font-bold text-[var(--ink-2)]">
        <span className="tabular-nums">{d.orders} طلب</span>
        <span className="tabular-nums">{d.receipts} سند</span>
        <span className="tabular-nums">{d.issues} مشكلة</span>
        {d.newCustomers > 0 && <span className="tabular-nums">{d.newCustomers} زبون جديد</span>}
      </div>
    </Card>
  )
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

  return (
    <div className="p-3 pb-28 lg:pb-6">
      <TodayStrip />

      {orders.isLoading ? (
        <SkeletonRows count={4} />
      ) : orders.isError ? (
        <EmptyState
          title="ما وصلت الطلبات"
          body="تحقق من الاتصال وحاول مرة أخرى."
          actionLabel="حاول مرة أخرى"
          onAction={() => void orders.refetch()}
        />
      ) : (orders.data ?? []).length === 0 ? (
        <p className="py-12 text-center text-base font-bold text-[var(--ink-2)]">ما عندك طلبات بعد</p>
      ) : (
        <ul className="space-y-2">
          {(orders.data ?? []).map((o) => {
            const s = STATUS_STYLE[o.status] ?? { label: o.status, cls: "bg-[var(--bg)] text-[var(--ink-2)]" }
            return (
              <li key={o.id} className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="display text-base font-extrabold text-[var(--ink)]">{o.customerName}</p>
                  <span className="display shrink-0 text-base font-extrabold tabular-nums">
                    {money(o.total)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className={cn("rounded-lg px-2 py-1 text-xs font-bold", s.cls)}>{s.label}</span>
                  <span className="rounded-lg bg-[var(--bg)] px-2 py-1 text-xs font-bold tabular-nums text-[var(--ink-2)]">
                    {o.lineCount} سطر
                  </span>
                  <span className="rounded-lg bg-[var(--bg)] px-2 py-1 text-xs font-bold tabular-nums text-[var(--ink-2)]">
                    {new Date(o.createdAt).toLocaleDateString("en-GB")}
                  </span>
                </div>
                {/* Without the reason the rep sees a bare «مرفوض» and has to
                    telephone to find out what to change. */}
                {o.reviewNote && (
                  <p className="mt-2 rounded-xl bg-[var(--danger-soft)] p-2.5 text-sm font-bold text-[var(--danger)]">
                    السبب: {o.reviewNote}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/* ── money ───────────────────────────────────────────────────────────── */

/**
 * «معي الآن» is the number the rep is personally answerable for, so it is the
 * biggest thing on the page. Derived on the server from the receipt vouchers
 * themselves, so it cannot drift away from them.
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
      // The customer just paid, so the balance in the header strip is stale.
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

  const numericAmount = Number(amount)
  const canSave = Boolean(customerId) && numericAmount > 0 && !save.isPending
  const onHand = cash.data?.onHand ?? 0

  return (
    <div className="p-3 pb-28 lg:pb-6">
      {/* Emerald, not indigo: money is its own domain in this app and a rep
          should be able to find it by colour alone. */}
      <div className="rounded-2xl bg-[#047857] p-4 text-white shadow-lg shadow-emerald-900/20">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-white/75">معي الآن</p>
        {cash.isLoading ? (
          <div className="mt-1 h-10 w-40 rounded-full bg-white/20" />
        ) : (
          <p className="display text-4xl font-extrabold tabular-nums">{money(onHand)}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-lg bg-white/20 px-2.5 py-1 text-xs font-bold tabular-nums">
            تحصّلت {money(cash.data?.collected ?? 0)}
          </span>
          <span className="rounded-lg bg-white/15 px-2.5 py-1 text-xs font-bold tabular-nums">
            سلّمت {money(cash.data?.handedOver ?? 0)}
          </span>
        </div>
        {onHand < 0 && (
          <p className="mt-2.5 rounded-xl bg-white/20 p-2 text-xs font-bold">
            الرصيد سالب — انلغى سند بعد ما سلّمته. راجع صاحب المحل.
          </p>
        )}
      </div>

      <Card className="mt-3 space-y-3">
        <h2 className="display text-base font-extrabold">سجّل سند قبض</h2>

        {customerId ? (
          <p className="rounded-xl bg-[var(--brand-soft)] px-3 py-2 text-sm font-bold text-[var(--brand)]">
            الزبون: {customerName}
          </p>
        ) : (
          <GhostButton className="w-full" icon={Users} onClick={onNeedCustomer}>
            اختر الزبون أول
          </GhostButton>
        )}

        <TextField
          label="المبلغ"
          value={amount}
          onChange={(v) => setAmount(v.replace(/[^0-9]/g, ""))}
          inputMode="numeric"
          big
        />

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="ملاحظة…"
          aria-label="ملاحظة على السند"
          rows={2}
          className="w-full rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 text-sm font-semibold text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:border-[var(--brand)] focus:outline focus:outline-2 focus:outline-[var(--brand)]"
        />

        <PrimaryButton tone="money" disabled={!canSave} loading={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "جاري الحفظ…" : "احفظ السند"}
        </PrimaryButton>
      </Card>

      <Section title="سنداتي">
        {(receipts.data ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm font-bold text-[var(--ink-2)]">ما اكو سندات</p>
        ) : (
          <ul className="space-y-2">
            {(receipts.data ?? []).map((r) => (
              <li
                key={r.id}
                className={cn(
                  "rounded-2xl border border-[var(--line)] bg-[var(--card)] p-3.5",
                  r.cancelled && "opacity-60",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-bold text-[var(--ink)]">{r.customerName}</p>
                  <span className="display shrink-0 text-base font-extrabold tabular-nums text-[var(--money)]">
                    {money(r.amount)}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <span className="rounded-lg bg-[var(--bg)] px-2 py-0.5 text-[11px] font-bold text-[var(--ink-2)]">
                    {r.voucherNumber}
                  </span>
                  <span className="rounded-lg bg-[var(--bg)] px-2 py-0.5 text-[11px] font-bold tabular-nums text-[var(--ink-2)]">
                    {new Date(r.date).toLocaleDateString("en-GB")}
                  </span>
                  {r.cancelled && (
                    <span className="rounded-lg bg-[var(--danger-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--danger)]">
                      ملغي
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="تسليماتي">
        {(handovers.data ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm font-bold text-[var(--ink-2)]">ما سلّمت شي بعد</p>
        ) : (
          <ul className="space-y-2">
            {(handovers.data ?? []).map((h) => (
              <li key={h.id} className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-bold text-[var(--ink)]">استلمه: {h.receivedBy}</p>
                  <span className="display shrink-0 text-base font-extrabold tabular-nums">
                    {money(h.amount)}
                  </span>
                </div>
                <span className="mt-1.5 inline-block rounded-lg bg-[var(--bg)] px-2 py-0.5 text-[11px] font-bold tabular-nums text-[var(--ink-2)]">
                  {new Date(h.date).toLocaleDateString("en-GB")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="display mb-2 text-base font-extrabold">{title}</h2>
      {children}
    </section>
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
function IssueSheet({
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

  return (
    <Sheet
      title="أكو مشكلة"
      onClose={onClose}
      footer={
        <PrimaryButton disabled={!reason} loading={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "جاري الحفظ…" : "احفظ"}
        </PrimaryButton>
      }
    >
      <p className="rounded-xl bg-[var(--bg)] px-3 py-2 text-sm font-bold text-[var(--ink-2)]">
        {customerName}
        {product ? ` — ${product.name}` : ""}
        {unit ? ` (${UNIT_LABEL[unit]})` : ""}
      </p>

      <div className="mt-4 grid gap-2">
        {(reasons.data ?? []).map((r) => {
          const on = reason === r.code
          return (
            <button
              key={r.code}
              type="button"
              onClick={() => setReason(r.code)}
              aria-pressed={on}
              className={cn(
                "press flex h-12 cursor-pointer items-center justify-between rounded-xl px-4 text-start text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]",
                on
                  ? "bg-[#4338CA] text-white shadow-md shadow-indigo-900/20"
                  : "border border-[var(--line)] bg-[var(--card)] text-[var(--ink-2)] hover:bg-[var(--bg)]",
              )}
            >
              {r.label}
              {on && <Check className="h-4 w-4" />}
            </button>
          )
        })}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="ملاحظة (اختياري)…"
        aria-label="ملاحظة"
        rows={2}
        className="mt-4 w-full rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 text-sm font-semibold text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:border-[var(--brand)] focus:outline focus:outline-2 focus:outline-[var(--brand)]"
      />

      <label className="mt-3 block">
        <span className="mb-1.5 block text-sm font-bold text-[var(--ink-2)]">من من يشتريه وبأي سعر؟</span>
        <textarea
          value={competitorInfo}
          onChange={(e) => setCompetitorInfo(e.target.value)}
          placeholder="اسم المجهز والسعر…"
          rows={2}
          className="w-full rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 text-sm font-semibold text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:border-[var(--brand)] focus:outline focus:outline-2 focus:outline-[var(--brand)]"
        />
      </label>
    </Sheet>
  )
}

/**
 * The rep cannot discount, so this is the only route to a different price. It
 * goes to the same approvals screen as everything else, and an approved price is
 * spent on one order — it never becomes the customer's standing price.
 */
function PriceRequestSheet({
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

  return (
    <Sheet
      title="اطلب سعراً خاصاً"
      onClose={onClose}
      footer={
        <PrimaryButton disabled={!(Number(price) > 0)} loading={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "جاري الإرسال…" : "أرسل الطلب"}
        </PrimaryButton>
      }
    >
      <p className="rounded-xl bg-[var(--bg)] px-3 py-2 text-sm font-bold text-[var(--ink-2)]">
        {customerName} — {product.name} ({UNIT_LABEL[unit]})
      </p>

      <div className="mt-3">
        <span className="inline-block rounded-xl bg-[var(--brand-soft)] px-3 py-2 text-sm font-bold tabular-nums text-[var(--brand)]">
          السعر الحالي {money(current)}
        </span>
      </div>

      <div className="mt-4">
        <TextField
          label="السعر المطلوب"
          value={price}
          onChange={(v) => setPrice(v.replace(/[^0-9]/g, ""))}
          inputMode="numeric"
          big
        />
      </div>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-sm font-bold text-[var(--ink-2)]">السبب</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="ليش يستاهل سعر خاص؟"
          rows={3}
          className="w-full rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 text-sm font-semibold text-[var(--ink)] placeholder:text-[var(--ink-3)] focus:border-[var(--brand)] focus:outline focus:outline-2 focus:outline-[var(--brand)]"
        />
      </label>

      <p className="mt-3 rounded-xl bg-[var(--warn-soft)] p-3 text-xs font-bold leading-relaxed text-[var(--warn)]">
        إذا انوافق، ينطبق على هذا الطلب فقط — ما يصير سعر دائم للزبون.
      </p>
    </Sheet>
  )
}

/* ── the rep's own issues + price requests ───────────────────────────── */

const PRICE_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "بانتظار الموافقة", cls: "bg-[var(--warn-soft)] text-[var(--warn)]" },
  APPROVED: { label: "موافق عليه", cls: "bg-[var(--money-soft)] text-[var(--money)]" },
  REJECTED: { label: "مرفوض", cls: "bg-[var(--danger-soft)] text-[var(--danger)]" },
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
    <div className="p-3 pb-28 lg:pb-6">
      <Section title="طلبات الأسعار">
        {prices.isLoading ? (
          <SkeletonRows count={2} />
        ) : (prices.data ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm font-bold text-[var(--ink-2)]">ما طلبت أسعار</p>
        ) : (
          <ul className="space-y-2">
            {(prices.data ?? []).map((p) => {
              const s = PRICE_STATUS[p.status] ?? { label: p.status, cls: "bg-[var(--bg)] text-[var(--ink-2)]" }
              return (
                <li key={p.id} className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-3.5">
                  <p className="text-sm font-bold text-[var(--ink)]">{p.productName}</p>
                  <p className="mt-0.5 text-xs font-semibold text-[var(--ink-2)]">{p.customerName}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="display rounded-lg bg-[var(--bg)] px-2 py-1 text-xs font-extrabold tabular-nums text-[var(--ink)]">
                      {money(p.currentPrice)} ← {money(p.requestedPrice)}
                    </span>
                    <span className={cn("rounded-lg px-2 py-1 text-xs font-bold", s.cls)}>{s.label}</span>
                    {p.used && (
                      <span className="rounded-lg bg-[var(--bg)] px-2 py-1 text-xs font-bold text-[var(--ink-2)]">
                        انستعمل
                      </span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title="المشاكل الي سجّلتها">
        {issues.isLoading ? (
          <SkeletonRows count={3} />
        ) : (issues.data ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm font-bold text-[var(--ink-2)]">ما سجّلت مشاكل</p>
        ) : (
          <ul className="space-y-2">
            {(issues.data ?? []).map((i) => (
              <li key={i.id} className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="rounded-lg bg-[var(--warn-soft)] px-2 py-1 text-xs font-bold text-[var(--warn)]">
                    {i.reasonLabel}
                  </span>
                  <span className="shrink-0 text-[11px] font-bold tabular-nums text-[var(--ink-3)]">
                    {new Date(i.createdAt).toLocaleDateString("en-GB")}
                  </span>
                </div>
                <p className="mt-2 text-sm font-bold text-[var(--ink)]">{i.customerName}</p>
                {i.productName && (
                  <p className="text-xs font-semibold text-[var(--ink-2)]">{i.productName}</p>
                )}
                {i.note && <p className="mt-1.5 text-xs font-semibold text-[var(--ink-2)]">{i.note}</p>}
                {i.competitorInfo && (
                  <p className="mt-1.5 rounded-lg bg-[var(--money-soft)] px-2 py-1.5 text-xs font-bold text-[var(--money)]">
                    المنافس: {i.competitorInfo}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
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
 * «زبائني» — the full account of one customer.
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

  if (statement.isLoading) {
    return (
      <div className="p-3">
        <SkeletonRows count={5} />
      </div>
    )
  }
  if (statement.isError) {
    return (
      <EmptyState
        title="ما وصل الكشف"
        body="تحقق من الاتصال وحاول مرة أخرى."
        actionLabel="حاول مرة أخرى"
        onAction={() => void statement.refetch()}
      />
    )
  }

  const rows = statement.data?.transactions ?? []
  const last = rows.length > 0 ? rows[rows.length - 1] : null

  return (
    <div className="p-3 pb-28 lg:pb-6">
      <div className="agent-grad rounded-2xl p-4 text-white shadow-lg shadow-indigo-900/20">
        <h2 className="display text-lg font-extrabold">{statement.data?.customer.name}</h2>
        {last?.runningBalance != null && (
          <p className="display mt-1 text-3xl font-extrabold tabular-nums">
            {money(last.runningBalance)}
          </p>
        )}
        <span className="mt-2 inline-block rounded-lg bg-white/20 px-2.5 py-1 text-xs font-bold tabular-nums">
          الرصيد الافتتاحي {money(statement.data?.customer.openingBalance ?? 0)}
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {rows.length === 0 ? (
          <p className="py-10 text-center text-base font-bold text-[var(--ink-2)]">ما اكو حركات</p>
        ) : (
          // Newest first: the rep is standing in front of the shopkeeper and the
          // argument is always about the last few movements, not the first.
          [...rows].reverse().map((row) => {
            const cancelled = row.status === "CANCELLED"
            const credit = row.type === "RECEIPT" || row.type === "INVOICE_PAYMENT"
            return (
              <div
                key={`${row.id}:${row.type}`}
                className={cn(
                  "rounded-2xl border border-[var(--line)] bg-[var(--card)] p-3.5",
                  cancelled && "opacity-60",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={cn(
                      "rounded-lg px-2 py-1 text-xs font-bold",
                      credit ? "bg-[var(--money-soft)] text-[var(--money)]" : "bg-[var(--brand-soft)] text-[var(--brand)]",
                    )}
                  >
                    {TX_LABEL[row.type] ?? row.type}
                  </span>
                  <span className="display shrink-0 text-base font-extrabold tabular-nums">
                    {money(row.amount)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="rounded-lg bg-[var(--bg)] px-2 py-0.5 text-[11px] font-bold text-[var(--ink-2)]">
                    {row.referenceNumber}
                  </span>
                  <span className="rounded-lg bg-[var(--bg)] px-2 py-0.5 text-[11px] font-bold tabular-nums text-[var(--ink-2)]">
                    {new Date(row.date).toLocaleDateString("en-GB")}
                  </span>
                  {row.runningBalance != null && (
                    <span className="rounded-lg bg-[var(--bg)] px-2 py-0.5 text-[11px] font-bold tabular-nums text-[var(--ink-2)]">
                      الرصيد {money(row.runningBalance)}
                    </span>
                  )}
                  {cancelled && (
                    <span className="rounded-lg bg-[var(--danger-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--danger)]">
                      ملغية
                    </span>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="sticky bottom-3 mt-4">
        <GhostButton className="w-full" icon={ArrowRight} onClick={onBack}>
          رجوع لزبائني
        </GhostButton>
      </div>
    </div>
  )
}
