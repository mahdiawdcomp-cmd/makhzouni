/**
 * «المندوب» — the sales rep's screen.
 *
 * A rep works standing in a shop doorway, in sunlight, on mobile data, holding
 * a phone in one hand. Three constraints follow from that, and every layout
 * decision below serves one of them:
 *
 *  1. ONE THUMB. Every control that matters sits in the lower half of the
 *     screen, where a thumb reaches without regripping.
 *  2. SUNLIGHT. Near-black on white, heavy weights, no light grey on white.
 *     Contrast here is legibility, not taste.
 *  3. MOBILE DATA. The grid ships no images at all; thumbnails are fetched for
 *     the cards actually on screen, and the full picture only when a product is
 *     opened. A few hundred inlined images would be megabytes before the first
 *     product is visible.
 *
 * Phone and tablet are two layouts, not one scaled: the tablet shows catalog and
 * order side by side so the shopkeeper can watch their own invoice being built,
 * while the phone keeps the order folded into a bottom bar that opens on tap.
 *
 * The rep picks the CUSTOMER before anything else. Balance and history hang off
 * the customer, and a cart assembled first would have to be re-pointed at
 * whoever was chosen last.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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

/**
 * «معي الآن» — collected minus handed over.
 *
 * Computed on the server from the vouchers themselves, so it can never disagree
 * with them. The rep is personally answerable for `onHand`, which is why it is
 * shown as a number and not a status word.
 */
type CashOnHand = {
  collected: number
  handedOver: number
  onHand: number
}

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

/** An approved, unspent price the rep may use on their next order. */
type UsablePrice = { id: string; productId: string; unit: Unit; price: number }

type AgentHandoverRow = {
  id: string
  amount: number
  date: string
  notes: string | null
  receivedBy: string
}

/**
 * One line of the shared statement builder — the SAME builder the owner reads.
 * Nothing rep-specific: reusing it means the rep and the owner can never be
 * looking at two different versions of one customer's account.
 */
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
 * callback ref (not a `useRef` read in an effect — the node may not exist on the
 * pass that effect runs). Ids collect for a beat, then go out as one request, so
 * a fast scroll produces a handful of calls rather than one per card.
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

/**
 * Carts are kept PER CUSTOMER, in one map.
 *
 * A rep walks a row of shops: start an order, get interrupted, start the next
 * one, come back. Keying the cart by customer id means switching customers is
 * just a pointer change and nothing is ever lost — which is why switching is
 * cheap enough to put a button for it in the header.
 */
type CartsByCustomer = Record<string, CartLine[]>

const CARTS_KEY = "sales_agent_carts"

export function SalesAgentPage() {
  const user = useAuthStore((s) => s.user)
  const qc = useQueryClient()

  const [screen, setScreen] = useState<Screen>("customers")
  const [customerId, setCustomerId] = useState<string | null>(
    () => localStorage.getItem("sales_agent_customer") || null,
  )
  // Carts survive a closed browser, a dropped connection, a phone that slept
  // until the tab was evicted. A rep who has walked three shops and loses the
  // lot has to redo the whole round, so this is stored rather than held in
  // memory. Per-viewer and per-device by nature, which is exactly right: a cart
  // is a half-finished thought, not shop data.
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
      // Drop emptied carts rather than accumulating one key per customer the rep
      // has ever opened.
      const kept = Object.fromEntries(Object.entries(carts).filter(([, lines]) => lines.length > 0))
      localStorage.setItem(CARTS_KEY, JSON.stringify(kept))
    } catch {
      /* storage unavailable — the cart still works for this session */
    }
  }, [carts])
  const [cartOpen, setCartOpen] = useState(false)
  const [openProduct, setOpenProduct] = useState<AgentProduct | null>(null)
  // Which customer's full statement is open. Separate from `customerId` (the
  // one being SOLD to) on purpose: a rep often wants to read one customer's
  // account while a half-built cart belongs to another.
  const [detailCustomerId, setDetailCustomerId] = useState<string | null>(null)
  // The two sheets that open ON TOP of the product sheet. Each carries the unit
  // the rep was looking at, because a price or a refusal is about a carton or a
  // piece, never about the product in the abstract.
  // One key per cart attempt. A rep on a bad connection taps «أرسل الطلب», sees
  // nothing, and taps again — this shop has been bitten by duplicate invoices
  // that way. The retry carries the same key and gets the first order back.
  const orderKey = useRef(crypto.randomUUID())
  const [issueFor, setIssueFor] = useState<{ product: AgentProduct | null; unit: Unit | null } | null>(null)
  const [priceFor, setPriceFor] = useState<{ product: AgentProduct; unit: Unit } | null>(null)
  const [search, setSearch] = useState("")
  const [notes, setNotes] = useState("")

  useEffect(() => {
    if (customerId) localStorage.setItem("sales_agent_customer", customerId)
    else localStorage.removeItem("sales_agent_customer")
  }, [customerId])

  const products = useAgentProducts()
  const header = useCustomerHeader(customerId)

  // Approved, unspent special prices for the customer being sold to. Advisory
  // here — the server re-resolves them when the order is priced.
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
  // not leave the rep selling into a ghost. Bounce them back to the picker.
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
      // Approved prices are spent by the order that used them, so the cached
      // list would otherwise keep offering a price that no longer exists.
      void qc.invalidateQueries({ queryKey: ["sales-agent", "usable-prices"] })
      void qc.invalidateQueries({ queryKey: ["sales-agent", "price-requests"] })
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

  return (
    <div dir="rtl" className="flex h-[100dvh] flex-col bg-white text-black">
      <AgentHeader
        agentName={user?.name ?? "المندوب"}
        header={header.data ?? null}
        screen={screen}
        onSwitchCustomer={() => setScreen("customers")}
        onScreen={setScreen}
      />

      <div className="flex min-h-0 flex-1">
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
              />
            ) : (
              <EmptyState
                title="اختر الزبون أول"
                body="الأسعار والرصيد مربوطة بالزبون، فلازم تختاره قبل ما تفتح الكتلوك."
                actionLabel="روح لزبائني"
                onAction={() => setScreen("customers")}
              />
            ))}
        </main>

        {/* Tablet only: the order builds beside the catalog, facing the
            shopkeeper. Below lg it is hidden and the bottom sheet takes over. */}
        {screen === "catalog" && customerId && (
          <aside className="hidden w-[380px] shrink-0 border-r-4 border-black lg:flex lg:flex-col">
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

      {/* Phone: the order folded into one bar. Tapping it opens the full
          sheet — the bar itself carries line count and total so the rep can
          read the state without opening anything. */}
      {screen === "catalog" && customerId && (
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          className="flex h-20 shrink-0 items-center justify-between border-t-4 border-black bg-black px-5 text-white lg:hidden"
        >
          <span className="text-lg font-black">
            {cart.length > 0 ? `${cart.length} سطر` : "السلة فارغة"}
          </span>
          <span className="text-2xl font-black tabular-nums">{money(cartTotal)}</span>
        </button>
      )}

      {cartOpen && customerId && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white lg:hidden">
          <div className="flex h-16 shrink-0 items-center justify-between border-b-4 border-black px-4">
            <span className="text-xl font-black">الطلب</span>
            <button
              type="button"
              onClick={() => setCartOpen(false)}
              className="h-12 rounded-xl border-4 border-black px-5 text-lg font-black"
            >
              رجوع
            </button>
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
        </div>
      )}

      {openProduct && (
        <ProductSheet
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
          product={issueFor.product}
          unit={issueFor.unit}
          customerId={customerId}
          customerName={header.data?.name ?? ""}
          onClose={() => {
            setIssueFor(null)
            void qc.invalidateQueries({ queryKey: ["sales-agent", "issues"] })
          }}
        />
      )}

      {priceFor && customerId && (
        <PriceRequestSheet
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

/* ── header ──────────────────────────────────────────────────────────── */

function AgentHeader({
  agentName,
  header,
  screen,
  onSwitchCustomer,
  onScreen,
}: {
  agentName: string
  header: CustomerHeader | null
  screen: Screen
  onSwitchCustomer: () => void
  onScreen: (s: Screen) => void
}) {
  return (
    <header className="shrink-0 border-b-4 border-black bg-white">
      <div className="flex items-stretch gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          {header ? (
            <>
              <div className="truncate text-xl font-black leading-tight">
                تبيع لـ: {header.name}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-base font-bold text-black">
                <span className="tabular-nums">
                  الرصيد: {money(header.currentBalance)}
                </span>
                {header.lastPayment ? (
                  <span className="tabular-nums">
                    آخر دفعة: {money(header.lastPayment.amount)} —{" "}
                    {new Date(header.lastPayment.date).toLocaleDateString("en-GB")}
                  </span>
                ) : (
                  <span>ما عنده دفعات</span>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="text-xl font-black leading-tight">{agentName}</div>
              <div className="text-base font-bold">ما مختار زبون</div>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onSwitchCustomer}
          className="shrink-0 self-center rounded-xl border-4 border-black px-4 py-3 text-base font-black"
        >
          تبديل
        </button>
      </div>

      <nav className="flex border-t-2 border-black">
        {(
          [
            ["catalog", "الكتلوك"],
            ["customers", "زبائني"],
            ["money", "فلوسي"],
            ["issues", "المشاكل"],
            ["orders", "طلباتي"],
          ] as Array<[Screen, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onScreen(key)}
            className={cn(
              "flex-1 py-3 text-lg font-black",
              screen === key ? "bg-black text-white" : "bg-white text-black",
            )}
          >
            {label}
          </button>
        ))}
      </nav>
    </header>
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
}: {
  products: AgentProduct[]
  loading: boolean
  error: boolean
  onRetry: () => void
  search: string
  onSearch: (v: string) => void
  onOpen: (p: AgentProduct) => void
}) {
  const [visible, setVisible] = useState<string[]>([])
  const thumbs = useThumbnails(visible)

  const observer = useRef<IntersectionObserver | null>(null)

  /**
   * Build the observer ON FIRST USE, not in an effect.
   *
   * Callback refs run BEFORE effects. Creating the observer in a `useEffect`
   * means it does not exist yet when the first screenful of cards attaches, so
   * every one of them is silently skipped and their thumbnails never load —
   * exactly the blank-images failure this codebase has hit before. Creating it
   * lazily here guarantees it exists the moment the first card asks for it.
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
            // Returning `prev` unchanged when nothing is new keeps this from
            // re-rendering the whole grid on every scroll tick.
            return next.length > 0 ? [...prev, ...next] : prev
          })
        },
        { rootMargin: "300px" },
      )
    }
    return observer.current
  }

  useEffect(() => () => observer.current?.disconnect(), [])

  // Callback ref, not a useRef read inside an effect: the card node exists at
  // the moment React calls this, which is the only moment it is guaranteed to.
  const observe = useCallback((node: HTMLElement | null) => {
    if (node) getObserver().observe(node)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) {
    return (
      <EmptyState
        title="ما وصلت المواد"
        body="تحقق من الاتصال."
        actionLabel="حاول مرة أخرى"
        onAction={onRetry}
      />
    )
  }

  return (
    <div className="p-3">
      <input
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="دور على مادة…"
        className="mb-3 h-14 w-full rounded-xl border-4 border-black px-4 text-lg font-bold placeholder:text-neutral-600 focus:outline-none"
      />

      {loading ? (
        <div className="py-16 text-center text-xl font-black">جاري التحميل…</div>
      ) : products.length === 0 ? (
        <div className="py-16 text-center text-xl font-black">ما اكو نتائج</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 pb-6 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <button
              key={product.id}
              type="button"
              data-pid={product.id}
              ref={observe}
              onClick={() => onOpen(product)}
              className="flex flex-col overflow-hidden rounded-xl border-4 border-black text-right"
            >
              <div className="aspect-square w-full bg-neutral-200">
                {thumbs[product.id] ? (
                  <img
                    src={thumbs[product.id] as string}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-2">
                <div className="line-clamp-2 text-base font-black leading-tight">{product.name}</div>
                <div className="mt-auto text-xl font-black tabular-nums">
                  {money(product.salePrice)}
                </div>
                <div className="text-sm font-bold tabular-nums">
                  {product.currentStock > 0 ? `المتوفر: ${product.currentStock}` : "ما بقى بالمخزن"}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The product sheet.
 *
 * Full picture, price per chosen unit, real stock, and the two things the rep
 * does next: add it, or record why the shopkeeper said no. Both buttons sit at
 * the bottom, within thumb reach, and the sheet fills the screen so nothing else
 * competes for the tap.
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
  /** An approved, unspent price for this product+unit, if the owner granted one. */
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
  // database when the order is actually priced, so what is shown here can never
  // become what gets billed.
  const line = (approved ?? unitPrice(product, unit)) * qty

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" dir="rtl">
      <div className="flex h-16 shrink-0 items-center justify-between border-b-4 border-black px-4">
        <span className="truncate text-xl font-black">{product.name}</span>
        <button
          type="button"
          onClick={onClose}
          className="h-12 shrink-0 rounded-xl border-4 border-black px-5 text-lg font-black"
        >
          رجوع
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto aspect-square w-full max-w-sm bg-neutral-200">
          {image ? <img src={image} alt="" className="h-full w-full object-contain" /> : null}
        </div>

        <div className="mt-4 space-y-1 text-lg font-black">
          <div className="tabular-nums">سعر القطعة: {money(product.salePrice)}</div>
          <div className="tabular-nums">المتوفر: {product.currentStock} قطعة</div>
        </div>

        <div className="mt-4">
          <div className="mb-2 text-lg font-black">الوحدة</div>
          <div className="flex flex-wrap gap-2">
            {units.map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => {
                  setUnit(u)
                  setQty(1)
                }}
                className={cn(
                  "h-14 rounded-xl border-4 border-black px-5 text-lg font-black",
                  unit === u ? "bg-black text-white" : "bg-white text-black",
                )}
              >
                {UNIT_LABEL[u]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-2 text-lg font-black">الكمية</div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="h-16 w-16 rounded-xl border-4 border-black text-3xl font-black"
            >
              −
            </button>
            <input
              value={qty}
              inputMode="numeric"
              onChange={(e) => {
                const n = Number(e.target.value.replace(/\D/g, ""))
                setQty(Number.isFinite(n) && n > 0 ? n : 1)
              }}
              className="h-16 w-24 rounded-xl border-4 border-black text-center text-2xl font-black tabular-nums focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setQty((q) => q + 1)}
              className="h-16 w-16 rounded-xl border-4 border-black text-3xl font-black"
            >
              +
            </button>
          </div>
        </div>

        {approved != null && (
          <div className="mt-4 rounded-xl border-4 border-black p-3">
            <div className="text-lg font-black">سعر خاص موافق عليه</div>
            <div className="mt-1 text-2xl font-black tabular-nums">{money(approved)}</div>
            <div className="mt-1 text-sm font-bold">
              ينطبق على هذا الطلب فقط، ويُستهلك أول ما ترسل الطلب.
            </div>
          </div>
        )}

        <div className="mt-4 text-2xl font-black tabular-nums">المجموع: {money(line)}</div>
      </div>

      {/* Three actions, all in the bottom third where a thumb reaches. «أكو
          مشكلة» sits BESIDE add-to-cart, not buried in a menu: the moment the
          shopkeeper says no is the only moment the real reason is known. */}
      <div className="shrink-0 space-y-2 border-t-4 border-black p-3">
        {/* A shortage WARNS, it does not block. The shop's standing policy is
            that a shortage never stops a sale, and the rep is standing in front
            of a customer who wants the goods. */}
        {qty > max && (
          <div className="rounded-xl border-4 border-black bg-neutral-200 p-2 text-center text-base font-black">
            المخزن ناقص {qty - max} {UNIT_LABEL[unit]} — تكدر تبيع وتنكتب بالطلب
          </div>
        )}
        <button
          type="button"
          onClick={() => onAdd(unit, qty)}
          className="h-16 w-full rounded-xl bg-black text-xl font-black text-white"
        >
          أضف للطلب
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onIssue(unit)}
            className="h-14 flex-1 rounded-xl border-4 border-black text-lg font-black"
          >
            أكو مشكلة
          </button>
          <button
            type="button"
            onClick={() => onAskPrice(unit)}
            className="h-14 flex-1 rounded-xl border-4 border-black text-lg font-black"
          >
            اطلب سعر
          </button>
        </div>
      </div>
    </div>
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
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {cart.length === 0 ? (
          <div className="py-12 text-center text-lg font-black">السلة فارغة</div>
        ) : (
          <ul className="space-y-2">
            {cart.map((line, idx) => {
              const product = productById.get(line.productId)
              if (!product) return null
              const special = specialPrice(line.productId, line.unit)
              const lineTotal = (special ?? unitPrice(product, line.unit)) * line.quantity
              return (
                <li key={`${line.productId}:${line.unit}`} className="rounded-xl border-4 border-black p-2">
                  <div className="text-base font-black leading-tight">{product.name}</div>
                  {special != null && (
                    <div className="mt-0.5 text-sm font-black">سعر خاص موافق عليه</div>
                  )}
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
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
                        className="h-12 w-12 rounded-lg border-4 border-black text-2xl font-black"
                      >
                        −
                      </button>
                      <span className="min-w-[3rem] text-center text-xl font-black tabular-nums">
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
                        className="h-12 w-12 rounded-lg border-4 border-black text-2xl font-black"
                      >
                        +
                      </button>
                      <span className="text-base font-black">{UNIT_LABEL[line.unit]}</span>
                    </div>
                    <span className="text-lg font-black tabular-nums">{money(lineTotal)}</span>
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
          rows={2}
          className="mt-3 w-full rounded-xl border-4 border-black p-3 text-base font-bold placeholder:text-neutral-600 focus:outline-none"
        />
      </div>

      <div className="shrink-0 space-y-2 border-t-4 border-black p-3">
        <div className="flex items-center justify-between text-2xl font-black tabular-nums">
          <span>المجموع</span>
          <span>{money(total)}</span>
        </div>
        <button
          type="button"
          disabled={cart.length === 0 || submitting}
          onClick={onSubmit}
          className="h-16 w-full rounded-xl bg-black text-xl font-black text-white disabled:bg-neutral-400"
        >
          {submitting ? "جاري الإرسال…" : "أرسل الطلب"}
        </button>
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

  return (
    <div className="flex min-h-full flex-col p-3">
      <input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          setPage(1)
        }}
        placeholder="دور بالاسم أو الرقم…"
        className="mb-3 h-14 w-full rounded-xl border-4 border-black px-4 text-lg font-bold placeholder:text-neutral-600 focus:outline-none"
      />

      {customers.isLoading ? (
        <div className="py-16 text-center text-xl font-black">جاري التحميل…</div>
      ) : customers.isError ? (
        <EmptyState
          title="ما وصلت القائمة"
          body="تحقق من الاتصال."
          actionLabel="حاول مرة أخرى"
          onAction={() => void customers.refetch()}
        />
      ) : (customers.data?.customers ?? []).length === 0 ? (
        <div className="py-12 text-center text-lg font-black">
          ما عندك زبائن بعد. أضف زبون جديد من الزر تحت.
        </div>
      ) : (
        <ul className="space-y-2 pb-24">
          {(customers.data?.customers ?? []).map((c) => (
            <li key={c.id} className="rounded-xl border-4 border-black">
              {/* Two separate targets, both full-height: selling to a customer
                  and reading their account are different intents, and a rep
                  fumbling one for the other in the street is a real cost. */}
              <button
                type="button"
                onClick={() => onPick(c.id)}
                className={cn(
                  "w-full rounded-t-lg p-3 text-right",
                  c.id === currentId ? "bg-black text-white" : "bg-white text-black",
                )}
              >
                <div className="text-lg font-black leading-tight">{c.name}</div>
                <div className="mt-1 flex flex-wrap gap-x-4 text-base font-bold">
                  <span className="tabular-nums" dir="ltr">{c.phone}</span>
                  <span className="tabular-nums">الرصيد: {money(c.currentBalance)}</span>
                  {c.area ? <span>{c.area}</span> : null}
                </div>
                {/* Quiet customers are the ones worth a visit, so they say so on
                    the row rather than hiding in a report the rep never opens. */}
                {c.daysSinceLastSale === null ? (
                  <div className="mt-1 text-sm font-black">ما اشترى ولا مرة</div>
                ) : c.daysSinceLastSale >= 30 ? (
                  <div className="mt-1 text-sm font-black">
                    ما اشترى من {c.daysSinceLastSale} يوم
                  </div>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => onOpenStatement(c.id)}
                className="h-14 w-full border-t-4 border-black text-lg font-black"
              >
                كشف الحساب
              </button>
            </li>
          ))}
        </ul>
      )}

      {(page > 1 || customers.data?.hasMore) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="h-14 flex-1 rounded-xl border-4 border-black text-lg font-black disabled:opacity-40"
          >
            السابق
          </button>
          <span className="text-base font-black tabular-nums">
            {page} / {Math.max(1, Math.ceil((customers.data?.total ?? 0) / (customers.data?.limit || 200)))}
          </span>
          <button
            type="button"
            disabled={!customers.data?.hasMore}
            onClick={() => setPage((p) => p + 1)}
            className="h-14 flex-1 rounded-xl border-4 border-black text-lg font-black disabled:opacity-40"
          >
            التالي
          </button>
        </div>
      )}

      {/* Sticky at the bottom, where the thumb is. */}
      <div className="sticky bottom-0 mt-auto -mx-3 border-t-4 border-black bg-white p-3">
        <button
          type="button"
          onClick={onNew}
          className="h-16 w-full rounded-xl bg-black text-xl font-black text-white"
        >
          زبون جديد
        </button>
      </div>
    </div>
  )
}

/**
 * New customer, with the duplicate check that has to happen BEFORE the save.
 *
 * The rep types a phone; the moment they leave the field the server is asked
 * whether that number is already known. Four answers, four different next steps:
 * already yours (just use it), unassigned (take it), someone else's (stop, ask
 * the owner), deleted (stop). The check is advisory here and binding on the
 * server — the client's version is what keeps the rep from typing a whole form
 * they cannot save.
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
      toast({
        title: "ما انضاف",
        description: apiErrorMessage(err, "حاول مرة أخرى"),
        variant: "destructive",
      }),
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
      onDone(data.id)
    },
    onError: (err) =>
      toast({
        title: "ما انحفظ",
        description: apiErrorMessage(err, "تحقق من البيانات"),
        variant: "destructive",
      }),
  })

  const blocked = lookup?.found && !lookup.claimable && !lookup.mine
  const canSave = name.trim().length > 0 && phone.trim().length > 0 && !lookup?.found

  return (
    <div className="flex min-h-full flex-col p-3">
      <div className="space-y-3">
        <Field label="اسم الزبون" value={name} onChange={setName} />
        <Field
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
          <div className="text-base font-black">جاري التحقق من الرقم…</div>
        )}

        {lookup?.found && (
          <div
            className={cn(
              "rounded-xl border-4 p-3 text-base font-black",
              blocked ? "border-black bg-neutral-200" : "border-black bg-white",
            )}
          >
            <div>{lookup.message}</div>
            {lookup.mine && lookup.id && (
              <button
                type="button"
                onClick={() => onDone(lookup.id as string)}
                className="mt-2 h-14 w-full rounded-xl bg-black text-lg font-black text-white"
              >
                استعمل هذا الزبون
              </button>
            )}
            {lookup.claimable && lookup.id && (
              <button
                type="button"
                disabled={claim.isPending}
                onClick={() => claim.mutate(lookup.id as string)}
                className="mt-2 h-14 w-full rounded-xl bg-black text-lg font-black text-white disabled:bg-neutral-400"
              >
                {claim.isPending ? "جاري الإضافة…" : "أضفه لزبائني وابدأ البيع"}
              </button>
            )}
          </div>
        )}

        <Field label="العنوان" value={address} onChange={setAddress} />

        <div>
          <div className="mb-1 text-lg font-black">المنطقة</div>
          {(areas.data ?? []).length === 0 ? (
            <div className="rounded-xl border-4 border-black p-3 text-base font-bold">
              ما اكو مناطق مضافة. صاحب المحل يضيفها من الإعدادات.
            </div>
          ) : (
            <select
              value={area}
              onChange={(e) => setArea(e.target.value)}
              className="h-14 w-full rounded-xl border-4 border-black px-3 text-lg font-bold focus:outline-none"
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
      </div>

      <div className="sticky bottom-0 mt-auto -mx-3 space-y-2 border-t-4 border-black bg-white p-3">
        <button
          type="button"
          disabled={!canSave || create.isPending}
          onClick={() => create.mutate()}
          className="h-16 w-full rounded-xl bg-black text-xl font-black text-white disabled:bg-neutral-400"
        >
          {create.isPending ? "جاري الحفظ…" : "احفظ وابدأ البيع"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-14 w-full rounded-xl border-4 border-black text-lg font-black"
        >
          رجوع
        </button>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  onBlur,
  inputMode,
  dir,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  inputMode?: "text" | "tel" | "numeric"
  dir?: "rtl" | "ltr"
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-lg font-black">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        inputMode={inputMode}
        dir={dir}
        className="h-14 w-full rounded-xl border-4 border-black px-3 text-lg font-bold focus:outline-none"
      />
    </label>
  )
}

/* ── orders ──────────────────────────────────────────────────────────── */

const STATUS_LABEL: Record<string, string> = {
  PENDING: "بانتظار الموافقة",
  APPROVED: "تمت الموافقة",
  REJECTED: "مرفوض",
}

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

  // Three numbers, and deliberately not a fourth: nothing here is a figure the
  // owner keeps private, so the rep can read their own day without the
  // commission ever appearing on their phone.
  return (
    <div className="mb-3 rounded-xl border-4 border-black p-3">
      <div className="text-lg font-black">يومي</div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-2xl font-black tabular-nums">{d.customersVisited}</div>
          <div className="text-sm font-bold">زبون</div>
        </div>
        <div>
          <div className="text-2xl font-black tabular-nums">{money(d.orderValue)}</div>
          <div className="text-sm font-bold">باع</div>
        </div>
        <div>
          <div className="text-2xl font-black tabular-nums">{money(d.collected)}</div>
          <div className="text-sm font-bold">قبض</div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-x-4 text-sm font-bold">
        <span className="tabular-nums">{d.orders} طلب</span>
        <span className="tabular-nums">{d.receipts} سند</span>
        <span className="tabular-nums">{d.issues} مشكلة</span>
        {d.newCustomers > 0 && <span className="tabular-nums">{d.newCustomers} زبون جديد</span>}
      </div>
    </div>
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

  if (orders.isLoading) {
    return <div className="py-16 text-center text-xl font-black">جاري التحميل…</div>
  }
  if (orders.isError) {
    return (
      <EmptyState
        title="ما وصلت الطلبات"
        body="تحقق من الاتصال."
        actionLabel="حاول مرة أخرى"
        onAction={() => void orders.refetch()}
      />
    )
  }
  if ((orders.data ?? []).length === 0) {
    return <div className="py-16 text-center text-xl font-black">ما عندك طلبات بعد</div>
  }

  return (
    <div className="p-3">
      <TodayStrip />
      <ul className="space-y-2">
      {(orders.data ?? []).map((o) => (
        <li key={o.id} className="rounded-xl border-4 border-black p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-lg font-black">{o.customerName}</span>
            <span className="text-lg font-black tabular-nums">{money(o.total)}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 text-base font-bold">
            <span>{STATUS_LABEL[o.status] ?? o.status}</span>
            <span className="tabular-nums">{o.lineCount} سطر</span>
            <span className="tabular-nums">
              {new Date(o.createdAt).toLocaleDateString("en-GB")}
            </span>
          </div>
          {/* The reason it was refused. Without it the rep sees a bare «مرفوض»
              and has to telephone to find out what to change. */}
          {o.reviewNote && (
            <div className="mt-1 rounded-lg border-4 border-black bg-neutral-200 p-2 text-sm font-black">
              السبب: {o.reviewNote}
            </div>
          )}
        </li>
      ))}
      </ul>
    </div>
  )
}

/* ── shared ──────────────────────────────────────────────────────────── */

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
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="text-2xl font-black">{title}</div>
      <div className="text-lg font-bold">{body}</div>
      <button
        type="button"
        onClick={onAction}
        className="h-16 w-full max-w-xs rounded-xl bg-black text-xl font-black text-white"
      >
        {actionLabel}
      </button>
    </div>
  )
}

/* ── money: «معي الآن», receipts, handovers ──────────────────────────── */

/**
 * The rep's money screen.
 *
 * «معي الآن» is the number they are personally answerable for, so it is the
 * biggest thing on the page — collected minus what the owner has taken off
 * them. It is derived on the server from the receipt vouchers themselves, so it
 * cannot drift away from them.
 *
 * The rep records receipts here but NEVER records a handover: only the owner
 * writes those. One-sided is simpler and safer than a two-party confirmation
 * for a problem that has none — the owner knows when cash is in their hand.
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

  return (
    <div className="p-3 pb-8">
      <div className="rounded-xl border-4 border-black p-4">
        <div className="text-lg font-black">معي الآن</div>
        <div className="mt-1 text-4xl font-black tabular-nums">
          {cash.isLoading ? "…" : money(cash.data?.onHand ?? 0)}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 text-base font-bold">
          <span className="tabular-nums">تحصّلت: {money(cash.data?.collected ?? 0)}</span>
          <span className="tabular-nums">سلّمت: {money(cash.data?.handedOver ?? 0)}</span>
        </div>
      </div>

      <div className="mt-4 rounded-xl border-4 border-black p-3">
        <div className="text-lg font-black">سجّل سند قبض</div>

        {customerId ? (
          <div className="mt-1 text-base font-bold">الزبون: {customerName}</div>
        ) : (
          <button
            type="button"
            onClick={onNeedCustomer}
            className="mt-2 h-14 w-full rounded-xl border-4 border-black text-lg font-black"
          >
            اختر الزبون أول
          </button>
        )}

        <label className="mt-3 block">
          <span className="mb-1 block text-lg font-black">المبلغ</span>
          <input
            value={amount}
            inputMode="numeric"
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
            className="h-16 w-full rounded-xl border-4 border-black px-3 text-2xl font-black tabular-nums focus:outline-none"
          />
        </label>

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="ملاحظة…"
          rows={2}
          className="mt-3 w-full rounded-xl border-4 border-black p-3 text-base font-bold placeholder:text-neutral-600 focus:outline-none"
        />

        <button
          type="button"
          disabled={!canSave}
          onClick={() => save.mutate()}
          className="mt-3 h-16 w-full rounded-xl bg-black text-xl font-black text-white disabled:bg-neutral-400"
        >
          {save.isPending ? "جاري الحفظ…" : "احفظ السند"}
        </button>
      </div>

      <Section title="سنداتي">
        {(receipts.data ?? []).length === 0 ? (
          <div className="py-6 text-center text-base font-black">ما اكو سندات</div>
        ) : (
          <ul className="space-y-2">
            {(receipts.data ?? []).map((r) => (
              <li
                key={r.id}
                className={cn(
                  "rounded-xl border-4 border-black p-3",
                  r.cancelled && "bg-neutral-200",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-black">{r.customerName}</span>
                  <span className="text-lg font-black tabular-nums">{money(r.amount)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 text-sm font-bold">
                  <span>{r.voucherNumber}</span>
                  <span className="tabular-nums">
                    {new Date(r.date).toLocaleDateString("en-GB")}
                  </span>
                  {r.cancelled && <span>ملغي</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="تسليماتي">
        {(handovers.data ?? []).length === 0 ? (
          <div className="py-6 text-center text-base font-black">ما سلّمت شي بعد</div>
        ) : (
          <ul className="space-y-2">
            {(handovers.data ?? []).map((h) => (
              <li key={h.id} className="rounded-xl border-4 border-black p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-black">استلمه: {h.receivedBy}</span>
                  <span className="text-lg font-black tabular-nums">{money(h.amount)}</span>
                </div>
                <div className="mt-1 text-sm font-bold tabular-nums">
                  {new Date(h.date).toLocaleDateString("en-GB")}
                </div>
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
    <div className="mt-5">
      <div className="mb-2 text-lg font-black">{title}</div>
      {children}
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
 * The requirement was explicit: these customers are the rep's responsibility
 * and they must see all of it — invoices, receipts, movements, the complete
 * statement. So this renders the shop's real statement rather than a
 * rep-flavoured summary of it, which also means the rep and the owner can never
 * be arguing from two different versions of one account.
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
    return <div className="py-16 text-center text-xl font-black">جاري التحميل…</div>
  }
  if (statement.isError) {
    return (
      <EmptyState
        title="ما وصل الكشف"
        body="تحقق من الاتصال."
        actionLabel="حاول مرة أخرى"
        onAction={() => void statement.refetch()}
      />
    )
  }

  const rows = statement.data?.transactions ?? []
  const last = rows.length > 0 ? rows[rows.length - 1] : null

  return (
    <div className="p-3 pb-8">
      <div className="rounded-xl border-4 border-black p-4">
        <div className="text-xl font-black">{statement.data?.customer.name}</div>
        <div className="mt-1 text-base font-bold tabular-nums">
          الرصيد الافتتاحي: {money(statement.data?.customer.openingBalance ?? 0)}
        </div>
        {last?.runningBalance != null && (
          <div className="mt-1 text-2xl font-black tabular-nums">
            الرصيد الحالي: {money(last.runningBalance)}
          </div>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {rows.length === 0 ? (
          <div className="py-10 text-center text-lg font-black">ما اكو حركات</div>
        ) : (
          // Newest first: the rep is standing in front of the shopkeeper and the
          // argument is always about the last few movements, not the first.
          [...rows].reverse().map((row) => (
            <div
              key={`${row.id}:${row.type}`}
              className={cn(
                "rounded-xl border-4 border-black p-3",
                row.status === "CANCELLED" && "bg-neutral-200",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-base font-black">{TX_LABEL[row.type] ?? row.type}</span>
                <span className="text-lg font-black tabular-nums">{money(row.amount)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 text-sm font-bold">
                <span>{row.referenceNumber}</span>
                <span className="tabular-nums">
                  {new Date(row.date).toLocaleDateString("en-GB")}
                </span>
                {row.runningBalance != null && (
                  <span className="tabular-nums">الرصيد: {money(row.runningBalance)}</span>
                )}
                {row.status === "CANCELLED" && <span>ملغية</span>}
              </div>
            </div>
          ))
        )}
      </div>

      <button
        type="button"
        onClick={onBack}
        className="mt-4 h-16 w-full rounded-xl border-4 border-black text-xl font-black"
      >
        رجوع لزبائني
      </button>
    </div>
  )
}

/* ── «أكو مشكلة» ─────────────────────────────────────────────────────── */

type IssueReason = { code: string; label: string; aboutProduct: boolean }

/**
 * Why the shopkeeper said no.
 *
 * One tap on a fixed reason and the rep is done — free text alone would be
 * unreportable, because "غالي" typed nine ways answers no question. The two
 * optional fields carry the value: a note, and «من من يشتريه وبأي سعر؟», which
 * turns a lost sale into competitor pricing collected daily.
 *
 * No WhatsApp fires for these, by design: they arrive all day and none is
 * urgent.
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
      toast({
        title: "ما انسجلت",
        description: apiErrorMessage(err, "حاول مرة أخرى"),
        variant: "destructive",
      }),
  })

  // A refusal about the visit itself (shop closed, owner away) is not about any
  // product, so those reasons stay offered even with a product open.
  const list = reasons.data ?? []

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-white" dir="rtl">
      <div className="flex h-16 shrink-0 items-center justify-between border-b-4 border-black px-4">
        <span className="truncate text-xl font-black">أكو مشكلة</span>
        <button
          type="button"
          onClick={onClose}
          className="h-12 shrink-0 rounded-xl border-4 border-black px-5 text-lg font-black"
        >
          رجوع
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="text-base font-bold">
          الزبون: {customerName}
          {product ? ` — ${product.name}` : ""}
          {unit ? ` (${UNIT_LABEL[unit]})` : ""}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2">
          {list.map((r) => (
            <button
              key={r.code}
              type="button"
              onClick={() => setReason(r.code)}
              className={cn(
                "h-14 rounded-xl border-4 border-black px-4 text-right text-lg font-black",
                reason === r.code ? "bg-black text-white" : "bg-white text-black",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="ملاحظة (اختياري)…"
          rows={2}
          className="mt-4 w-full rounded-xl border-4 border-black p-3 text-base font-bold placeholder:text-neutral-600 focus:outline-none"
        />

        <label className="mt-3 block">
          <span className="mb-1 block text-lg font-black">من من يشتريه وبأي سعر؟</span>
          <textarea
            value={competitorInfo}
            onChange={(e) => setCompetitorInfo(e.target.value)}
            placeholder="اسم المجهز والسعر…"
            rows={2}
            className="w-full rounded-xl border-4 border-black p-3 text-base font-bold placeholder:text-neutral-600 focus:outline-none"
          />
        </label>
      </div>

      <div className="shrink-0 border-t-4 border-black p-3">
        <button
          type="button"
          disabled={!reason || save.isPending}
          onClick={() => save.mutate()}
          className="h-16 w-full rounded-xl bg-black text-xl font-black text-white disabled:bg-neutral-400"
        >
          {save.isPending ? "جاري الحفظ…" : "احفظ"}
        </button>
      </div>
    </div>
  )
}

/* ── «اطلب سعراً خاصاً» ──────────────────────────────────────────────── */

/**
 * The rep cannot discount, so this is the only route to a different price.
 *
 * It goes to the same approvals screen as everything else, and an approved
 * price is spent on one order — it never becomes the customer's standing price.
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
      toast({
        title: "ما انرسل",
        description: apiErrorMessage(err, "حاول مرة أخرى"),
        variant: "destructive",
      }),
  })

  const numeric = Number(price)
  const canSend = numeric > 0 && !save.isPending

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-white" dir="rtl">
      <div className="flex h-16 shrink-0 items-center justify-between border-b-4 border-black px-4">
        <span className="truncate text-xl font-black">اطلب سعراً خاصاً</span>
        <button
          type="button"
          onClick={onClose}
          className="h-12 shrink-0 rounded-xl border-4 border-black px-5 text-lg font-black"
        >
          رجوع
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="text-base font-bold">
          {customerName} — {product.name} ({UNIT_LABEL[unit]})
        </div>

        <div className="mt-3 text-xl font-black tabular-nums">
          السعر الحالي: {money(current)}
        </div>

        <label className="mt-4 block">
          <span className="mb-1 block text-lg font-black">السعر المطلوب</span>
          <input
            value={price}
            inputMode="numeric"
            onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))}
            className="h-16 w-full rounded-xl border-4 border-black px-3 text-2xl font-black tabular-nums focus:outline-none"
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-lg font-black">السبب</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="ليش يستاهل سعر خاص؟"
            rows={3}
            className="w-full rounded-xl border-4 border-black p-3 text-base font-bold placeholder:text-neutral-600 focus:outline-none"
          />
        </label>

        <div className="mt-3 text-base font-bold">
          إذا انوافق، ينطبق على هذا الطلب فقط — ما يصير سعر دائم للزبون.
        </div>
      </div>

      <div className="shrink-0 border-t-4 border-black p-3">
        <button
          type="button"
          disabled={!canSend}
          onClick={() => save.mutate()}
          className="h-16 w-full rounded-xl bg-black text-xl font-black text-white disabled:bg-neutral-400"
        >
          {save.isPending ? "جاري الإرسال…" : "أرسل الطلب"}
        </button>
      </div>
    </div>
  )
}

/* ── the rep's own issues + price requests ───────────────────────────── */

const PRICE_STATUS_LABEL: Record<string, string> = {
  PENDING: "بانتظار الموافقة",
  APPROVED: "موافق عليه",
  REJECTED: "مرفوض",
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
    <div className="p-3 pb-8">
      <Section title="طلبات الأسعار">
        {(prices.data ?? []).length === 0 ? (
          <div className="py-6 text-center text-base font-black">ما طلبت أسعار</div>
        ) : (
          <ul className="space-y-2">
            {(prices.data ?? []).map((p) => (
              <li key={p.id} className="rounded-xl border-4 border-black p-3">
                <div className="text-base font-black">{p.productName}</div>
                <div className="mt-1 flex flex-wrap gap-x-4 text-base font-bold">
                  <span>{p.customerName}</span>
                  <span className="tabular-nums">
                    {money(p.currentPrice)} ← {money(p.requestedPrice)}
                  </span>
                </div>
                <div className="mt-1 text-base font-black">
                  {PRICE_STATUS_LABEL[p.status] ?? p.status}
                  {p.used ? " — انستعمل" : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="المشاكل الي سجّلتها">
        {issues.isLoading ? (
          <div className="py-6 text-center text-base font-black">جاري التحميل…</div>
        ) : (issues.data ?? []).length === 0 ? (
          <div className="py-6 text-center text-base font-black">ما سجّلت مشاكل</div>
        ) : (
          <ul className="space-y-2">
            {(issues.data ?? []).map((i) => (
              <li key={i.id} className="rounded-xl border-4 border-black p-3">
                <div className="text-base font-black">{i.reasonLabel}</div>
                <div className="mt-1 flex flex-wrap gap-x-4 text-base font-bold">
                  <span>{i.customerName}</span>
                  {i.productName && <span>{i.productName}</span>}
                  <span className="tabular-nums">
                    {new Date(i.createdAt).toLocaleDateString("en-GB")}
                  </span>
                </div>
                {i.note && <div className="mt-1 text-sm font-bold">{i.note}</div>}
                {i.competitorInfo && (
                  <div className="mt-1 text-sm font-bold">المنافس: {i.competitorInfo}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
