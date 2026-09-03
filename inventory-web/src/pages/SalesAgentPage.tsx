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

function useMyCustomers(search: string) {
  return useQuery({
    queryKey: ["sales-agent", "customers", search],
    queryFn: async () => {
      const res = await api.get<{ data: AgentCustomer[] }>("/sales-agent/customers", {
        params: search ? { search } : undefined,
      })
      return res.data.data ?? []
    },
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

type Screen = "catalog" | "customers" | "new-customer" | "orders" | "money" | "customer-detail"

/**
 * Carts are kept PER CUSTOMER, in one map.
 *
 * A rep walks a row of shops: start an order, get interrupted, start the next
 * one, come back. Keying the cart by customer id means switching customers is
 * just a pointer change and nothing is ever lost — which is why switching is
 * cheap enough to put a button for it in the header.
 */
type CartsByCustomer = Record<string, CartLine[]>

export function SalesAgentPage() {
  const user = useAuthStore((s) => s.user)
  const qc = useQueryClient()

  const [screen, setScreen] = useState<Screen>("customers")
  const [customerId, setCustomerId] = useState<string | null>(
    () => localStorage.getItem("sales_agent_customer") || null,
  )
  const [carts, setCarts] = useState<CartsByCustomer>({})
  const [cartOpen, setCartOpen] = useState(false)
  const [openProduct, setOpenProduct] = useState<AgentProduct | null>(null)
  // Which customer's full statement is open. Separate from `customerId` (the
  // one being SOLD to) on purpose: a rep often wants to read one customer's
  // account while a half-built cart belongs to another.
  const [detailCustomerId, setDetailCustomerId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [notes, setNotes] = useState("")

  useEffect(() => {
    if (customerId) localStorage.setItem("sales_agent_customer", customerId)
    else localStorage.removeItem("sales_agent_customer")
  }, [customerId])

  const products = useAgentProducts()
  const header = useCustomerHeader(customerId)

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
        return product ? sum + unitPrice(product, line.unit) * line.quantity : sum
      }, 0),
    [cart, productById],
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
        items: cart,
      })
      return res.data
    },
    onSuccess: () => {
      toast({ title: "انرسل الطلب ✓", description: "راح يوصلك إشعار بعد الموافقة" })
      if (customerId) setCarts((prev) => ({ ...prev, [customerId]: [] }))
      setNotes("")
      setCartOpen(false)
      void qc.invalidateQueries({ queryKey: ["sales-agent", "orders"] })
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
                  المتوفر: {product.currentStock}
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
}: {
  product: AgentProduct
  onClose: () => void
  onAdd: (unit: Unit, quantity: number) => void
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
  const line = unitPrice(product, unit) * qty

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
          <div className="mb-2 text-lg font-black">
            الكمية {max > 0 ? `(الأقصى ${max})` : ""}
          </div>
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

        <div className="mt-4 text-2xl font-black tabular-nums">المجموع: {money(line)}</div>
      </div>

      <div className="shrink-0 border-t-4 border-black p-3">
        <button
          type="button"
          disabled={max <= 0 || qty > max}
          onClick={() => onAdd(unit, qty)}
          className="h-16 w-full rounded-xl bg-black text-xl font-black text-white disabled:bg-neutral-400"
        >
          {max <= 0
            ? "الكمية ما تكفي"
            : qty > max
              ? `الأقصى ${max}`
              : "أضف للطلب"}
        </button>
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
}: {
  cart: CartLine[]
  productById: Map<string, AgentProduct>
  total: number
  notes: string
  onNotes: (v: string) => void
  onChange: (updater: (prev: CartLine[]) => CartLine[]) => void
  onSubmit: () => void
  submitting: boolean
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
              const lineTotal = unitPrice(product, line.unit) * line.quantity
              return (
                <li key={`${line.productId}:${line.unit}`} className="rounded-xl border-4 border-black p-2">
                  <div className="text-base font-black leading-tight">{product.name}</div>
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
  const customers = useMyCustomers(search)

  return (
    <div className="flex min-h-full flex-col p-3">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
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
      ) : (customers.data ?? []).length === 0 ? (
        <div className="py-12 text-center text-lg font-black">
          ما عندك زبائن بعد. أضف زبون جديد من الزر تحت.
        </div>
      ) : (
        <ul className="space-y-2 pb-24">
          {(customers.data ?? []).map((c) => (
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
    <ul className="space-y-2 p-3">
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
        </li>
      ))}
    </ul>
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
