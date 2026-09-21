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
import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  BadgePercent,
  Check,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Loader2,
  Minus,
  Package,
  Plus,
  Receipt,
  Search,
  SlidersHorizontal,
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
import { ToastAction } from "../components/ui/toast"
import { QueryErrorBox } from "../components/ui/query-error"
import { apiErrorMessage } from "../utils/apiError"
import { cn } from "../utils/cn"
import { useAuthStore } from "../store/authStore"
import { piecesPerUnit as sharedPiecesPerUnit } from "../utils/units"
import { agentDefaultUnit, agentWholesaleUnits, stableThumbnailBatches } from "../utils/salesAgentCatalog"
import { scoreProduct } from "../utils/search"
import { cartonEligible, cleanAgentLines, draftKey, EMPTY_DRAFT, isDefinitiveOrderRejection, mergeAgentDrafts, pendingAttempts, readAgentWorkspace, workspaceKey, type AgentDraft, type AgentMode, type AgentWorkspace, type OrderPayload, type PendingMeta } from "../utils/salesAgentDrafts"
import { AgentDialog, AgentEmptyState, AgentField, AgentLoading, AgentStatusPill } from "./sales-agent/shared"
import { UNIT_LABEL, money, shortDate } from "./sales-agent/format"
import { CustomerInsights } from "./sales-agent/CustomerInsights"
import { OrderReviewDialog } from "./sales-agent/OrderReviewDialog"
import { PendingOrdersScreen } from "./sales-agent/PendingOrdersScreen"
import { VisitsScreen } from "./sales-agent/VisitsScreen"
import { ShopLocationPicker, type AreaOption, type ShopPoint } from "./sales-agent/ShopLocationPicker"
import { distanceMetres, hasFix, locationNote, readAgentLocation, type AgentLocation } from "../utils/agentLocation"
import type { FollowUpReason, OrderReview, SubmittedOrder } from "./sales-agent/types"

/* ── types ───────────────────────────────────────────────────────────── */

type Unit = "PIECE" | "DOZEN" | "BOX" | "CARTON"

type AgentProduct = {
  id: string
  itemNumber: string
  name: string
  category: string | null
  salePrice: number
  cartonPiecePrice?: number | null
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
  /** Present when the screen asked for reasons; server-worded. */
  followUpReasons?: FollowUpReason[]
}

type CustomerPage = {
  total: number
  page: number
  limit: number
  hasMore: boolean
  /** The shop's own inactive-customer setting, so no screen invents a number. */
  quietDays?: number
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
  /** The SHOP position, for showing the rep how far they are from it. */
  latitude: number | null
  longitude: number | null
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
 *
 * `piecesPerUnit` is imported from the shared util, not reimplemented here.
 * A from-scratch copy of this once existed on this page and rounded a BOX
 * DOWN for any odd carton size instead of up — pcsPerCarton=5 showed a box as
 * 5 pieces (a full carton) here while the server billed it at 3. The rep read
 * a wrong preview price and the picker's max-quantity was wrong too, off the
 * same broken number. `utils/units.ts` is the copy every other order-taking
 * page in the app already uses; this page just was not one of them.
 */

function piecesPerUnit(product: AgentProduct, unit: Unit) {
  // Only these two fields matter to the conversion; passed explicitly so a
  // wider (or narrower) AgentProduct shape can never trip up the shared util.
  return sharedPiecesPerUnit(unit, { pcsPerCarton: product.pcsPerCarton, boxPieces: product.boxPieces })
}

function unitPrice(product: AgentProduct, unit: Unit, mode: AgentMode = "WHOLESALE") {
  return (mode === "CARTON" ? Number(product.cartonPiecePrice ?? 0) : product.salePrice) * piecesPerUnit(product, unit)
}

function maxQty(product: AgentProduct, unit: Unit) {
  return Math.floor(product.currentStock / piecesPerUnit(product, unit))
}

function availableUnits(product: AgentProduct, mode: AgentMode = "WHOLESALE"): Unit[] {
  if (mode === "CARTON") return cartonEligible(product) ? ["CARTON"] : []
  return agentWholesaleUnits
}

// One definition for the whole rep experience, including the new screens, in
// `sales-agent/shared.tsx`. Aliased here so every existing call site is
// untouched by the move.
const Dialog = AgentDialog
const Field = AgentField
const EmptyState = AgentEmptyState
const Loading = AgentLoading
const StatusPill = AgentStatusPill

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

function useMyCustomers(search: string, page: number, followUp = "", area = "", needsFollowUp = false) {
  return useQuery({
    queryKey: ["sales-agent", "customers", search, page, followUp, area, needsFollowUp],
    queryFn: async () => {
      const res = await api.get<{ data: CustomerPage }>("/sales-agent/customers", {
        params: {
          page,
          limit: 200,
          ...(search ? { search } : {}),
          ...(followUp ? { followUp } : {}),
          ...(area ? { area } : {}),
          // Filtered in the database, not here: filtering a fetched page would
          // hide customers who need following up on a later page and make
          // `total` describe a list the screen does not show.
          ...(needsFollowUp ? { needsFollowUp: true } : {}),
          // The follow-up reasons for this page. A fixed number of extra reads
          // regardless of page size, computed on the server.
          withReasons: true,
        },
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
function useThumbnails(allIds: string[], visibleIds: string[]) {
  const qc = useQueryClient()
  const userId = useAuthStore(s => s.user?.id)
  const batches = stableThumbnailBatches(allIds, visibleIds)
  const queries = useQueries({ queries: batches.map(({ ids, enabled }) => ({
    queryKey: ["sales-agent", "thumbnails", userId, ids],
    enabled,
    queryFn: async () => {
      const data = (await api.post<{ data: Record<string, string | null> }>("/sales-agent/products/thumbnails", { ids })).data.data
      for (const [id, src] of Object.entries(data)) qc.setQueryData(["sales-agent", "thumbnail", userId, id], src)
      return data
    },
    // A product's picture almost never changes, and every refetch re-reads the
    // base64 column from the database, so keep them for the whole shift.
    staleTime: 30 * 60 * 1000, gcTime: 60 * 60 * 1000, retry: 2, refetchOnWindowFocus: false,
  })) })
  const cached = Object.fromEntries(visibleIds.map(id => [id, qc.getQueryData<string | null>(["sales-agent", "thumbnail", userId, id]) ?? null]))
  return Object.assign(cached, ...queries.map(query => query.data ?? {})) as Record<string, string | null>
}

/* ── page ────────────────────────────────────────────────────────────── */

type Screen = "catalog" | "customers" | "new-customer" | "orders" | "money" | "receipts" | "customer-detail" | "issues" | "visits" | "pending"
type CatalogColumns = 2 | 3 | 4
type CatalogSort = "name" | "newest" | "stock" | "price-low" | "price-high"

/**
 * The rep's own choice when they made one; otherwise sized to the device.
 *
 * Two columns on an iPad left each picture the width of half the screen and the
 * rep scrolling through a dozen products to see a shelf's worth. The reps work
 * on iPads almost entirely, so a wide screen now opens at four; a phone keeps
 * two, where four would shrink every name to 11px.
 */
function savedCatalogColumns(): CatalogColumns {
  try {
    const value = Number(localStorage.getItem("sales-agent-catalog-columns"))
    if (value === 2 || value === 3 || value === 4) return value
  } catch { /* storage blocked — fall through to the device default */ }
  try {
    return window.matchMedia("(min-width: 700px)").matches ? 4 : 2
  } catch { return 2 }
}

const CARTS_KEY = "sales_agent_carts"

const TABS: Array<{ key: Screen; label: string }> = [
  { key: "catalog", label: "الكتلوك" },
  { key: "customers", label: "زبائني" },
  { key: "visits", label: "زياراتي" },
  { key: "money", label: "فلوسي" },
  { key: "receipts", label: "سنداتي" },
  { key: "issues", label: "المشاكل" },
  { key: "orders", label: "طلباتي" },
]

export function SalesAgentPage() {
  const user = useAuthStore((s) => s.user)
  return <SalesAgentWorkspace key={user?.id} />
}

// `OrderReview` now lives in `sales-agent/types.ts`: the review dialog and this
// page must agree about it field for field, and the server sends more than the
// old local shape described (offers, price-change notes, the customer balance).

function SalesAgentWorkspace() {
  const user = useAuthStore((s) => s.user)
  const qc = useQueryClient()
  const storageKey = workspaceKey(user?.id ?? "signed-out")
  const [workspace, setWorkspace] = useState<AgentWorkspace>(() => {
    try {
      return readAgentWorkspace(localStorage.getItem(storageKey))
    } catch { return readAgentWorkspace(null) }
  })
  const [storageFailed, setStorageFailed] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  /**
   * Set when the connection returns. NOTHING is sent automatically: prices and
   * stock may have moved during the outage, so the rep is told there is an
   * attempt waiting and re-checks it themselves — with the same key.
   */
  const [reconnected, setReconnected] = useState(false)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    const onBack = () => setReconnected(true)
    window.addEventListener("online", onBack)
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      window.removeEventListener("online", onBack)
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [])
  // Commit synchronously before network writes so a lost response can be retried after reload.
  const persist = (next: AgentWorkspace) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
      setStorageFailed(false)
    } catch { setStorageFailed(true); setWorkspace(next); return false }
    setWorkspace(next)
    return true
  }
  const customerId = workspace.customerId
  const mode = workspace.mode
  const activeKey = draftKey(mode, customerId)
  const draft = workspace.drafts[activeKey] ?? EMPTY_DRAFT
  const cart = draft.items
  const notes = draft.notes
  const [screen, setScreen] = useState<Screen>("catalog")
  const setCustomerId = (id: string | null) => persist({ ...workspace, customerId: id })
  const updateDraft = (next: AgentDraft) => persist({ ...workspace, drafts: { ...workspace.drafts, [activeKey]: next } })
  const setCart = (updater: (prev: CartLine[]) => CartLine[]) => {
    if (!draft.pending) updateDraft({ ...draft, items: updater(cart) })
  }
  const setNotes = (value: string) => {
    if (!draft.pending) updateDraft({ ...draft, notes: value })
  }
  const [mergeCustomer, setMergeCustomer] = useState<string | null>(null)
  const [review, setReview] = useState<OrderReview | null>(null)
  const [reviewChanged, setReviewChanged] = useState(false)
  const [category, setCategory] = useState("")
  const [catalogFilter, setCatalogFilter] = useState("")
  const [catalogSort, setCatalogSort] = useState<CatalogSort>("name")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [catalogColumns, setCatalogColumns] = useState<CatalogColumns>(savedCatalogColumns)
  const changeCatalogColumns = (value: CatalogColumns) => {
    setCatalogColumns(value)
    try { localStorage.setItem("sales-agent-catalog-columns", String(value)) } catch { /* display preference still works this session */ }
  }
  const can = (cap: "NEW_CUSTOMER" | "ISSUE" | "PRICE_REQUEST") => !user?.permissions.includes(`AGENT_NO_${cap}`)
  const existingDraft = (id: string): AgentDraft => {
    const saved = workspace.drafts[draftKey(mode, id)]
    if (saved) return saved
    // Import the old wholesale cart only after choosing an owned customer. Keep the old storage untouched.
    if (mode === "WHOLESALE") {
      try { return { items: cleanAgentLines(JSON.parse(localStorage.getItem(CARTS_KEY) || "{}")[id]), notes: "" } } catch { /* no legacy cart */ }
    }
    return EMPTY_DRAFT
  }

  const [cartOpen, setCartOpen] = useState(false)
  const [openProduct, setOpenProduct] = useState<AgentProduct | null>(null)
  const [search, setSearch] = useState("")
  const [detailCustomerId, setDetailCustomerId] = useState<string | null>(null)
  const [issueFor, setIssueFor] = useState<{ product: AgentProduct | null; unit: Unit | null } | null>(null)
  const [priceFor, setPriceFor] = useState<{ product: AgentProduct; unit: Unit } | null>(null)

  const products = useAgentProducts()
  const header = useCustomerHeader(customerId)
  // The per-tenant area list, shared with the visits screen and the new-customer
  // form so both offer exactly the same neighbourhoods.
  const areas = useQuery({
    queryKey: ["sales-agent", "areas"],
    queryFn: async () => (await api.get<{ data: string[] }>("/sales-agent/areas")).data.data ?? [],
    staleTime: 10 * 60 * 1000,
    retry: 3,
  })

  /**
   * Every unconfirmed attempt on this device, for «الطلبات المعلّقة».
   *
   * Derived from the one workspace the carts already live in, so the queue and
   * the carts can never disagree about what was sent.
   */
  const pendingRows = useMemo(
    () => pendingAttempts(workspace).map((row) => ({ ...row, hasPayload: Boolean(row.payload) })),
    [workspace],
  )
  const unresolvedCount = pendingRows.filter((row) => row.hasPayload && !row.meta?.settled).length

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
      mode === "CARTON" ? null : (usablePrices.data ?? []).find((p) => p.productId === productId && p.unit === unit)?.price ?? null,
    [usablePrices.data, mode],
  )

  // A customer that was un-assigned (or removed) since the id was cached must
  // not leave the rep selling into a ghost.
  //
  // Only a real answer from the server clears the selection. Any error used to
  // count, so a dropped connection threw the rep out of the sale they were in
  // the middle of and back to the customer list.
  const headerStatus = (header.error as { response?: { status?: number } } | null)?.response?.status

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
        return sum + (special ?? unitPrice(product, line.unit, mode)) * line.quantity
      }, 0),
    [cart, productById, specialPriceFor, mode],
  )

  /**
   * Read the position the FIRST time a cart gets a line, and keep it.
   *
   * This is the moment the rep is demonstrably standing in the shop. Reading
   * it again at send time would overwrite it with wherever they finally found
   * signal, which on a bad day is home. Re-reading on every added line would
   * also wake the GPS several times for one order and drain the battery.
   *
   * Fire-and-forget: the cart line is added immediately and the reading lands
   * whenever it lands. Nothing waits on it, and a refusal costs no sale.
   */
  const captureCartLocation = () => {
    if (draft.location || draft.pending) return
    void readAgentLocation().then((location) => {
      setWorkspace((current) => {
        // Re-read from the freshest workspace, not the render that started
        // this: several seconds pass while the GPS settles, and the rep may
        // have added more lines meanwhile.
        const live = current.drafts[activeKey] ?? EMPTY_DRAFT
        if (live.location || live.pending) return current
        const next = { ...current, drafts: { ...current.drafts, [activeKey]: { ...live, location } } }
        try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* draft still lives in memory */ }
        return next
      })
    })
  }

  const addToCart = (product: AgentProduct, unit: Unit, quantity: number) => {
      if (draft.pending) { toast({ title: "تحقق من الطلب المرسل أولاً" }); return }
      const existingQuantity = cart.find(l => l.productId === product.id && l.unit === unit)?.quantity ?? 0
      if (existingQuantity + quantity > 100000) { toast({ title: "الكمية كبيرة جداً", variant: "destructive" }); return }
      setCart((prev) => {
        const idx = prev.findIndex((l) => l.productId === product.id && l.unit === unit)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = { ...next[idx], quantity: next[idx].quantity + quantity }
          return next
        }
        return [...prev, { productId: product.id, unit, quantity }]
      })
      captureCartLocation()
      toast({ title: `انضاف: ${product.name}` })
    }

  /**
   * Take back ONE unit that the quick-add button put in.
   *
   * Reads the live workspace rather than this render's `cart`: the toast that
   * offers «تراجع» outlives the render that created it, and the rep may have
   * added three more lines by the time they tap it. Undoing from a stale copy
   * would silently throw those lines away.
   *
   * `key` is the draft the unit was added to — captured at add time, so undoing
   * after switching customer still removes it from the right cart.
   */
  const undoQuickAdd = (key: string, productId: string, unit: Unit) => {
    setWorkspace((current) => {
      const live = current.drafts[key] ?? EMPTY_DRAFT
      if (live.pending) return current
      const items = live.items
        .map((l) => (l.productId === productId && l.unit === unit ? { ...l, quantity: l.quantity - 1 } : l))
        .filter((l) => l.quantity > 0)
      const next = { ...current, drafts: { ...current.drafts, [key]: { ...live, items } } }
      try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* still undone in memory */ }
      return next
    })
  }

  /**
   * «+» on a catalog card: one piece, straight into the cart.
   *
   * Always a PIECE in wholesale — the owner's call: a rep who wants a dozen opens
   * the product. Carton mode has no piece to add, so there it is one carton, the
   * only unit that mode sells.
   *
   * On a tablet a tap meant for scrolling can land on the button, so every
   * quick add carries its own «تراجع» instead of leaving the rep to find the
   * line in the cart and decrement it.
   */
  const quickAdd = (product: AgentProduct) => {
    if (draft.pending) { toast({ title: "تحقق من الطلب المرسل أولاً" }); return }
    const unit: Unit = mode === "CARTON" ? "CARTON" : "PIECE"
    const existing = cart.find((l) => l.productId === product.id && l.unit === unit)?.quantity ?? 0
    if (existing + 1 > 100000) { toast({ title: "الكمية كبيرة جداً", variant: "destructive" }); return }
    const key = activeKey
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.productId === product.id && l.unit === unit)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 }
        return next
      }
      return [...prev, { productId: product.id, unit, quantity: 1 }]
    })
    captureCartLocation()
    toast({
      title: `انضاف ${UNIT_LABEL[unit]}: ${product.name}`,
      action: (
        <ToastAction altText="تراجع عن الإضافة" onClick={() => undoQuickAdd(key, product.id, unit)}>
          تراجع
        </ToastAction>
      ),
    })
  }

  /** What is already in the cart per product, for the «بالسلة» note on a card. */
  const inCart = useMemo(() => {
    const map = new Map<string, Array<{ unit: Unit; quantity: number }>>()
    for (const line of cart) {
      const rows = map.get(line.productId) ?? []
      rows.push({ unit: line.unit, quantity: line.quantity })
      map.set(line.productId, rows)
    }
    return map
  }, [cart])

  const submit = useMutation({
    networkMode: "always",
    mutationFn: async (payload: OrderPayload) => {
      const res = await api.post("/sales-agent/orders", payload)
      return res.data as { data?: SubmittedOrder }
    },
    onSuccess: (res, payload) => {
      const short = res?.data?.shortages ?? []
      // The server links a sent order to an OPEN visit for that same customer.
      // Telling the rep here is what makes «أخذ طلب» a fact rather than a label
      // they pick by hand.
      if (res?.data?.linkedVisitId) {
        void qc.invalidateQueries({ queryKey: ["sales-agent", "visit-plan"] })
        void qc.invalidateQueries({ queryKey: ["sales-agent", "visits-today"] })
        void qc.invalidateQueries({ queryKey: ["sales-agent", "visit-customers"] })
        toast({ title: "انربط الطلب بالزيارة المفتوحة", description: "أنهِ الزيارة بنتيجة «أخذ طلب» من «زياراتي»" })
      }
      toast({
        title: "انرسل الطلب ✓",
        // A shortage does not block the sale, but the rep should know the shop
        // is short before the customer asks when it arrives.
        description:
          short.length > 0
            ? `انتبه: ${short.map((x) => x.productName).join("، ")} — الكمية ناقصة بالمخزن`
            : "راح يوصلك إشعار بعد الموافقة",
      })
      // Only the draft of THIS order is cleared, and only now that the server
      // has confirmed it — including its pending marker and the reason text
      // that went with it. Other customers' drafts are untouched.
      persist({ ...workspace, drafts: { ...workspace.drafts, [draftKey(payload.priceMode, payload.customerId)]: { items: [], notes: "" } } })
      setReconnected(false)
      setReview(null)
      setCartOpen(false)
      void qc.invalidateQueries({ queryKey: ["sales-agent", "orders"] })
      // Approved prices are spent by the order that used them.
      void qc.invalidateQueries({ queryKey: ["sales-agent", "usable-prices"] })
      void qc.invalidateQueries({ queryKey: ["sales-agent", "price-requests"] })
      void qc.invalidateQueries({ queryKey: ["sales-agent", "today"] })
    },
    onError: (err) => {
      const status = (err as { response?: { status: number } }).response?.status
      const code = (err as { response?: { data?: { code?: string } } }).response?.data?.code
      const reason = apiErrorMessage(err, "ما وصل تأكيد من السيرفر — تحقق من الاتصال")
      const meta = draft.pendingMeta
      if (isDefinitiveOrderRejection(code)) {
        // A definitive answer ends the attempt: the payload goes, so nothing
        // re-sends it, while the reason stays on screen until the rep acts.
        updateDraft({ ...draft, pending: undefined, pendingMeta: meta ? { ...meta, reason, settled: true } : undefined })
        setReview(null)
        void products.refetch()
      } else if (meta) {
        // Network, gateway and auth failures prove nothing about whether the
        // order landed, so the attempt and its key are kept for a safe re-check.
        updateDraft({ ...draft, pendingMeta: { ...meta, reason, settled: false } })
      }
      toast({
        title: status && status < 500 ? "تعذر إرسال الطلب" : "لم يصل تأكيد — المسودة محفوظة",
        description: reason,
        variant: "destructive",
      })
    },
  })

  /**
   * What to tell the rep about their own position, on the review dialog.
   *
   * Uses the reading taken when the cart was started, measured against the
   * shop the order is for. Null when either side is missing — most shops have
   * no pin on day one, and a screen that nags about it would train the rep to
   * ignore the banner that matters.
   */
  const reviewLocationNote = useMemo(() => {
    const here = draft.location
    if (!here) return null
    const shopLat = header.data?.latitude
    const shopLng = header.data?.longitude
    const far =
      hasFix(here) && shopLat != null && shopLng != null
        ? distanceMetres(here.latitude as number, here.longitude as number, shopLat, shopLng)
        : null
    return locationNote(here, far)
  }, [draft.location, header.data?.latitude, header.data?.longitude])

  const submitLock = useRef(false)
  const confirmOrder = async () => {
    if (submitLock.current || !online || !customerId || (!review && !draft.pending)) return
    submitLock.current = true
    // `draft.location` was read when the cart got its first line — inside the
    // shop. It rides along unchanged on every retry, so an order re-sent an
    // hour later still reports where it was actually taken.
    const payload: OrderPayload = draft.pending ?? { customerId, priceMode: mode, notes: notes.trim() || undefined, clientRequestId: crypto.randomUUID(), items: cart, reviewToken: review!.reviewToken, location: draft.location }
    // A re-check keeps the ORIGINAL attempt's key and its creation time; only
    // the counter and the timestamp move. That is what makes «إعادة المحاولة»
    // a re-check of one order instead of a second order.
    const at = Date.now()
    const meta: PendingMeta = draft.pendingMeta
      ? { ...draft.pendingMeta, lastAttemptAt: at, attempts: draft.pendingMeta.attempts + 1, reason: undefined, settled: false }
      : {
          createdAt: at,
          lastAttemptAt: at,
          attempts: 1,
          subtotal: review?.subtotal ?? cartTotal,
          customerName: review?.customerName ?? header.data?.name,
        }
    if (!updateDraft({ ...draft, pending: payload, pendingMeta: meta })) {
      submitLock.current = false
      toast({ title: "تعذر حفظ محاولة الإرسال؛ حرّر مساحة بالجهاز وأعد المحاولة", variant: "destructive" })
      return
    }
    try { await submit.mutateAsync(payload) } catch { /* mutation presents error */ } finally { submitLock.current = false }
  }
  const preview = useMutation({
    networkMode: "always",
    mutationFn: async () => {
      if (!online) throw new Error("OFFLINE")
      const res = await api.post<{ data: OrderReview }>("/sales-agent/orders/preview", { customerId, priceMode: mode, items: cart, notes: notes.trim() || undefined })
      return res.data.data
    },
    onSuccess: (data) => {
      setReviewChanged(data.subtotal !== cartTotal || data.items.some(item => {
        const product = productById.get(item.productId)
        return !product || item.availableStock !== product.currentStock
          || item.unitPrice !== (specialPriceFor(item.productId, item.unit) ?? unitPrice(product, item.unit, mode))
      }))
      setReview(data)
      setCartOpen(false)
    },
    onError: err => { toast({ title: "ما كدرنا نراجع الطلب؛ المسودة باقية", description: apiErrorMessage(err), variant: "destructive" }); void products.refetch() },
  })
  const prepareReview = useOnce(preview)
  const sendOrder = () => {
    if (draft.pending) { void confirmOrder(); return }
    if (!customerId) { setCartOpen(false); setScreen("customers"); toast({ title: "اختَر زبون الطلب أو أضف زبون جديد" }); return }
    if (!online) { toast({ title: "ماكو اتصال؛ الطلب مسودة وغير مُرسل" }); return }
    prepareReview()
  }

  /**
   * Re-check ONE pending attempt with its original key.
   *
   * When the attempt belongs to another customer or price mode, the workspace
   * is brought to it first and the rep taps again: the confirm path — and any
   * error it writes back — must act on the draft currently in hand, not on a
   * stale one from the previous render.
   */
  const recheckPending = async (key: string) => {
    const row = pendingRows.find((r) => r.key === key)
    if (!row?.payload) return
    if (row.mode !== mode || row.customerId !== customerId) {
      persist({ ...workspace, mode: row.mode, customerId: row.customerId })
      toast({ title: "فتحنا هذا الطلب — اضغط «إعادة التحقق» مرة ثانية" })
      return
    }
    await confirmOrder()
  }

  /** Open a settled attempt's items back in the cart for editing. */
  const openPendingDraft = (key: string) => {
    const row = pendingRows.find((r) => r.key === key)
    if (!row) return
    const target = workspace.drafts[key]
    if (target?.pending) {
      toast({ title: "تحقق من حالة الإرسال أولاً قبل التعديل" })
      return
    }
    persist({
      ...workspace,
      mode: row.mode,
      customerId: row.customerId,
      // The reason has been read now that the rep is acting on it.
      drafts: { ...workspace.drafts, [key]: { ...(target ?? EMPTY_DRAFT), pendingMeta: undefined } },
    })
    setScreen("catalog")
    setCartOpen(true)
  }

  /** Local only — this cannot cancel an order that did reach the shop. */
  const discardPending = (key: string) => {
    persist({ ...workspace, drafts: { ...workspace.drafts, [key]: { items: [], notes: "" } } })
    toast({ title: "انحذفت المسودة من هذا الجهاز" })
  }

  /**
   * The category strip: only categories that have something the rep can sell
   * right now, in the current price mode. A chip that opens onto an empty grid
   * teaches the rep to stop trusting the strip.
   *
   * Alphabetical, not by size: a chip that moves because a count changed is a
   * chip the rep has to hunt for every morning.
   */
  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of products.data ?? []) {
      if (!p.category || p.currentStock <= 0) continue
      if (mode === "CARTON" && !cartonEligible(p)) continue
      counts.set(p.category, (counts.get(p.category) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "ar"))
      .map(([name, count]) => ({ name, count }))
  }, [products.data, mode])

  const filtered = useMemo(() => {
    const list = (products.data ?? []).filter(p => p.currentStock > 0 && (mode !== "CARTON" || cartonEligible(p))
      && (!category || p.category === category) && (!catalogFilter || (catalogFilter === "new" ? p.isNewArrival : p.isOffer)))
    // The app-wide Arabic search, not a literal substring match: «بيبسى» finds
    // «بيبسي», «ڤيمتو» finds «فيمتو», and a rep typing half a name gets the
    // closest match first. Every other product search in the app already works
    // this way; the rep's grid was the one place that did not.
    const term = search.trim()
    const scores = new Map<string, number>()
    if (term) for (const p of list) scores.set(p.id, scoreProduct(p, term))
    const matching = !term ? list : list.filter((p) => (scores.get(p.id) ?? 0) > 0)
    return [...matching].sort((a, b) => {
      // While searching, the best match leads; the chosen sort only breaks ties.
      if (term) {
        const byScore = (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0)
        if (byScore !== 0) return byScore
      }
      if (catalogSort === "stock") return b.currentStock - a.currentStock || a.name.localeCompare(b.name, "ar")
      if (catalogSort === "price-low" || catalogSort === "price-high") {
        const price = (p: AgentProduct) => mode === "CARTON" ? unitPrice(p, "CARTON", mode) : p.salePrice
        return (catalogSort === "price-low" ? price(a) - price(b) : price(b) - price(a)) || a.name.localeCompare(b.name, "ar")
      }
      if (catalogSort === "newest") return Number(b.isNewArrival) - Number(a.isNewArrival) || a.name.localeCompare(b.name, "ar")
      return a.name.localeCompare(b.name, "ar")
    })
  }, [products.data, search, mode, category, catalogFilter, catalogSort])

  const pickCustomer = (id: string) => {
    if (draft.pending || submit.isPending || preview.isPending) { toast({ title: "تحقق من الطلب الحالي قبل تبديل الزبون" }); return }
    const target = existingDraft(id)
    const guestKey = draftKey(mode, null)
    const guest = workspace.drafts[guestKey] ?? EMPTY_DRAFT
    if (!customerId && (guest.items.length || guest.notes) && (target.items.length || target.notes || target.pending)) {
      setMergeCustomer(id); return
    }
    const next = !customerId && (guest.items.length || guest.notes) ? guest : target
    persist({ ...workspace, customerId: id, drafts: { ...workspace.drafts, [draftKey(mode, id)]: next,
      ...(!customerId && next === guest ? { [guestKey]: { items: [], notes: "" } } : {}) } })
    setScreen("catalog")
    setCartOpen(true)
  }

  const showCart = screen === "catalog"

  return (
    <div
      dir="rtl"
      className="sales-agent-shell flex h-[100dvh] flex-col overflow-hidden"
      style={{ backgroundColor: "var(--theme-pageBg)", color: "var(--theme-textPrimary)" }}
    >
      {/* Page header — the site's own pattern: title, one-line subtitle, actions
          on the far side. */}
      <div
        className="shrink-0 border-b px-3 py-3 sm:px-6"
        style={{ backgroundColor: "var(--theme-cardBg)", borderColor: "var(--theme-cardBorder)" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[var(--theme-accentSoft)] text-[var(--theme-accent)]" aria-hidden="true"><ShoppingCart className="size-5" /></div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-[var(--theme-accent)]">مساحة المندوب</p>
              <h1 className="truncate text-lg font-extrabold sm:text-xl">
                {header.data ? header.data.name : user?.name ?? "المندوب"}
              </h1>
              <p className="truncate text-xs text-slate-500 sm:text-sm">
              {header.data ? (
                <>
                  الرصيد {money(header.data.currentBalance)}
                  {header.data.lastPayment
                    ? ` · آخر دفعة ${money(header.data.lastPayment.amount)} بتاريخ ${shortDate(header.data.lastPayment.date)}`
                    : " · ما عنده دفعات"}
                </>
              ) : (
                "تصفح بحرية · اختَر الزبون وقت الطلب"
              )}
              </p>
            </div>
          </div>
          {/* items-center, not the default stretch: without it these two
              buttons were squeezed to their content height (36px) and lost the
              44px touch target they ask for. */}
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {customerId && (
              <Button
                variant="outline"
                // 44px on every touch screen, phone and iPad both — the rep is
                // outdoors with one thumb. The site's compact 36px starts at a
                // real desktop, not at 640px.
                className="h-11"
                onClick={() => { setDetailCustomerId(customerId); setScreen("customer-detail") }}
              >
                <Receipt className="h-4 w-4" /> كشف الحساب
              </Button>
            )}
            {customerId && <Button variant="outline" className="h-11" disabled={Boolean(draft.pending) || submit.isPending || preview.isPending} onClick={() => { setCustomerId(null); setScreen("catalog") }}>بدون زبون</Button>}
            <Button variant="outline" className="h-11" disabled={Boolean(draft.pending) || submit.isPending || preview.isPending} onClick={() => setScreen("customers")}>
              <Users className="h-4 w-4" /> {customerId ? "تبديل" : "اختَر زبون"}
            </Button>
          </div>
        </div>

        {/* Tab strip, identical to the customers/suppliers switch elsewhere. */}
        {/* On a phone the tabs overflowed the edge with nothing to say the
            strip scrolled. Equal columns below sm: everything reachable with one
            thumb, no scrolling. THREE columns, not one per tab — with «زياراتي»
            added, six columns on a 390px screen squeezed each label to ~60px
            and the last one wrapped onto a line of its own. Two rows of three
            stay legible at 44px tall. Wider screens keep the natural strip. */}
        <div
          className="mt-3 -mb-3 grid grid-cols-3 gap-1 border-b sm:flex sm:overflow-x-auto"
          style={{ borderColor: "var(--theme-cardBorder)" }}
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              disabled={submit.isPending || preview.isPending}
              onClick={() => setScreen(t.key)}
              className={cn(
                "min-h-11 shrink-0 rounded-t-xl px-1 py-2 text-sm font-semibold transition-colors sm:px-4",
                screen === t.key
                  ? "border-b-2 border-[var(--theme-accent)] bg-[var(--theme-accentSoft)] text-[var(--theme-accent)]"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800",
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

      <div className={cn("shrink-0 px-4 py-2 text-xs", !online || storageFailed || draft.pending ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800")} role="status">
        {storageFailed ? "تعذر الحفظ بالجهاز؛ لا تغلق الصفحة قبل تأكيد الطلب" : draft.pending ? "بانتظار تأكيد الطلب — لا تنشئ طلباً آخر؛ أعد التحقق بنفس المحاولة" : !online ? "بدون اتصال — السلة مسودة محفوظة، لم تُرسل" : "السلة والملاحظات محفوظة بهذا الجهاز — غير مُرسلة حتى التأكيد"}
        {draft.pending && <Button className="ms-3 h-11" disabled={!online || submit.isPending} onClick={() => void confirmOrder()}>تحقق من إرسال الطلب</Button>}
        {/* Every unconfirmed attempt on this device, including other customers'
            — the rep must be able to find them without guessing which customer
            they were on when the connection dropped. */}
        {pendingRows.length > 0 && (
          <Button className="ms-3 h-11" variant="outline" onClick={() => setScreen("pending")}>
            الطلبات المعلّقة
            {unresolvedCount > 0 && (
              <span className="ms-1.5 rounded-full bg-amber-200 px-1.5 py-0.5 text-[11px] font-bold text-amber-900">
                {unresolvedCount}
              </span>
            )}
          </Button>
        )}
      </div>
      {/* The connection came back and an attempt is still unconfirmed. The rep
          decides when to re-check: an automatic send would use prices and stock
          from before the outage. */}
      {reconnected && online && unresolvedCount > 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-2 bg-amber-50 p-3 text-sm text-amber-900">
          <span>رجع الإنترنت، وعندك {unresolvedCount} طلب معلق يحتاج مراجعة قبل الإرسال.</span>
          <Button
            className="h-11"
            onClick={() => {
              setReconnected(false)
              setScreen("pending")
            }}
          >
            راجع الطلبات المعلّقة
          </Button>
          <Button className="h-11" variant="outline" onClick={() => setReconnected(false)}>
            لاحقاً
          </Button>
        </div>
      )}
      {(headerStatus === 404 || headerStatus === 403) && <div role="alert" className="bg-red-50 p-3 text-red-800">الزبون المختار لم يعد ضمن زبائنك. السلة محفوظة؛ اختَر زبوناً آخر قبل الإرسال.</div>}
      <div className="flex min-h-0 flex-1">
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3 sm:p-5">
          {screen === "customers" && (
            <CustomersScreen
              currentId={customerId}
              areas={areas.data ?? []}
              onPick={pickCustomer}
              canCreate={can("NEW_CUSTOMER")}
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

          {screen === "visits" && (
            <VisitsScreen
              areas={areas.data ?? []}
              onOpenCustomer={(id) => { setDetailCustomerId(id); setScreen("customer-detail") }}
              onStartOrder={(id) => pickCustomer(id)}
            />
          )}

          {screen === "pending" && (
            <PendingOrdersScreen
              rows={pendingRows}
              online={online}
              busyKey={submit.isPending ? activeKey : null}
              customerName={(id) => {
                if (!id) return "بدون زبون (سلة مؤقتة)"
                if (id === customerId) return header.data?.name ?? "زبون"
                return workspace.drafts[draftKey(mode, id)]?.pendingMeta?.customerName
                  ?? pendingRows.find((row) => row.customerId === id)?.meta?.customerName
                  ?? "زبون"
              }}
              onRecheck={(row) => { void recheckPending(row.key) }}
              onEdit={(row) => { void openPendingDraft(row.key) }}
              onDiscard={(row) => discardPending(row.key)}
            />
          )}

          {(screen === "money" || screen === "receipts") && (
            <MoneyScreen
              section={screen}
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

          {screen === "catalog" && (
            <div className="space-y-4">
              <section className="sales-agent-intro rounded-3xl border border-[var(--theme-cardBorder)] bg-[var(--theme-cardBg)] p-3 shadow-sm sm:p-4" aria-label="خيارات الكتلوك">
                <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex rounded-2xl bg-slate-100 p-1 dark:bg-slate-800" aria-label="نوع التسعير">
                  {(["WHOLESALE", "CARTON"] as const).map(value => <Button key={value} className="h-11 rounded-xl" variant={mode === value ? "default" : "ghost"} aria-pressed={mode === value}
                    disabled={Boolean(draft.pending) || submit.isPending || preview.isPending}
                    onClick={() => { persist({ ...workspace, mode: value }); setOpenProduct(null); setReview(null) }}>
                    {value === "WHOLESALE" ? "جملة" : "توزيع كراتين"}
                    {(workspace.drafts[draftKey(value, customerId)]?.items.length ?? 0) > 0 && <span className="ms-1 rounded-full bg-black/10 px-2 text-xs">{workspace.drafts[draftKey(value, customerId)].items.length}</span>}
                  </Button>)}
                </div>
                <span className="text-xs text-slate-500">{mode === "CARTON" ? "كارتون كامل فقط · بسعر التوزيع" : "قطعة · درزن · علبة · كارتون بسعر الجملة"}</span>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <label className="relative min-w-[12rem] flex-1">
                    <Search className="pointer-events-none absolute inset-y-0 right-3 my-auto size-4 text-slate-400" aria-hidden="true" />
                    <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="دور على مادة أو رقمها" aria-label="بحث عن مادة" className="h-11 pe-10" />
                  </label>
                  {/* Only the sort lives behind this now; categories moved to the
                      strip below, where the rep can see them without a tap. */}
                  <Button className="h-11" variant={filtersOpen || catalogSort !== "name" ? "default" : "outline"} aria-expanded={filtersOpen} aria-controls="agent-catalog-filters" onClick={() => setFiltersOpen(value => !value)}>
                    <SlidersHorizontal className="size-4" /> الترتيب
                  </Button>
                  <div className="flex items-center gap-1 rounded-xl border border-[var(--theme-cardBorder)] p-1" role="group" aria-label="عدد الصور في السطر">
                    <LayoutGrid className="mx-1 hidden size-4 text-slate-400 sm:block" aria-hidden="true" />
                    {([2, 3, 4] as const).map(value => <button key={value} type="button" aria-label={`${value} صور في السطر`} aria-pressed={catalogColumns === value} title={`${value} صور في السطر`} onClick={() => changeCatalogColumns(value)} className={cn("min-h-11 min-w-11 rounded-lg px-2 text-sm font-bold transition-colors", catalogColumns === value ? "bg-[var(--theme-accent)] text-white shadow-sm" : "text-slate-500 hover:bg-[var(--theme-accentSoft)] hover:text-[var(--theme-accent)]")}>{value}</button>)}
                  </div>
                </div>
                {/* One row, always visible, scrolling sideways when it overflows.
                    The category is the first thing a rep narrows by, and it was
                    two taps deep behind «الفلاتر». */}
                <div
                  className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]"
                  role="group"
                  aria-label="الأقسام"
                >
                  {[
                    { key: "all", label: "الكل", active: !category && !catalogFilter, onClick: () => { setCategory(""); setCatalogFilter("") } },
                    { key: "new", label: "الجديد", active: catalogFilter === "new", onClick: () => setCatalogFilter(catalogFilter === "new" ? "" : "new") },
                    { key: "offer", label: "العروض", active: catalogFilter === "offer", onClick: () => setCatalogFilter(catalogFilter === "offer" ? "" : "offer") },
                    ...categoryOptions.map((c) => ({
                      key: `c:${c.name}`,
                      label: c.name,
                      count: c.count,
                      active: category === c.name,
                      onClick: () => setCategory(category === c.name ? "" : c.name),
                    })),
                  ].map((chip) => (
                    <button
                      key={chip.key}
                      type="button"
                      aria-pressed={chip.active}
                      onClick={chip.onClick}
                      className={cn(
                        "flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-semibold transition-colors",
                        chip.active
                          ? "border-[var(--theme-accent)] bg-[var(--theme-accent)] text-white"
                          : "border-[var(--theme-cardBorder)] bg-[var(--theme-cardBg)] text-slate-600 hover:border-[var(--theme-accent)] dark:text-slate-300",
                      )}
                    >
                      {chip.label}
                      {"count" in chip && (
                        <span className={cn("text-xs tabular-nums", chip.active ? "text-white/80" : "text-slate-400")}>
                          {chip.count}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {filtersOpen && <div id="agent-catalog-filters" className="sales-agent-filter-panel mt-3 grid gap-2 border-t border-[var(--theme-cardBorder)] pt-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <select aria-label="ترتيب المواد" className="h-11 min-w-0 rounded-xl border border-[var(--theme-cardBorder)] bg-[var(--theme-cardBg)] px-3" value={catalogSort} onChange={e => setCatalogSort(e.target.value as CatalogSort)}>
                    <option value="name">الاسم</option><option value="newest">الجديد أولاً</option><option value="stock">الأكثر توفراً</option><option value="price-low">السعر: الأقل</option><option value="price-high">السعر: الأعلى</option>
                  </select>
                  {catalogSort !== "name" && <Button className="h-11" variant="ghost" onClick={() => setCatalogSort("name")}>رجّع الترتيب</Button>}
                </div>}
              </section>
              {/* «يشتريها عادةً» + «عروضه»: the reason the rep picked this
                  customer, above the grid rather than buried in a menu. */}
              <CustomerInsights
                customerId={customerId}
                mode={mode}
                disabled={Boolean(draft.pending)}
                onAdd={(productId, unit, quantity) => {
                  const product = productById.get(productId)
                  if (!product) { toast({ title: "المادة ما عادت متاحة؛ حدّث الكتلوك" }); return }
                  addToCart(product, unit, quantity)
                }}
              />
              <CatalogScreen
                allProductIds={(products.data ?? []).filter(p => p.hasImage).map(p => p.id)}
                mode={mode}
                products={filtered}
                loading={products.isPending}
                paused={products.fetchStatus === "paused"}
                error={products.isError}
                onRetry={() => void products.refetch()}
                search={search}
                columns={catalogColumns}
                onOpen={p => { if (!submit.isPending && !preview.isPending) setOpenProduct(p) }}
                onQuickAdd={p => { if (!submit.isPending && !preview.isPending) quickAdd(p) }}
                locked={Boolean(draft.pending) || submit.isPending || preview.isPending}
                inCart={inCart}
                specialPrice={specialPriceFor}
              />
            </div>
          )}
        </main>

        {/* Tablet and up: the order builds beside the catalog, facing the
            shopkeeper. Below lg it is the bottom bar + dialog instead. */}
        {showCart && (
          <aside
            className="hidden w-[20rem] shrink-0 flex-col border-e lg:flex"
            style={{ backgroundColor: "var(--theme-cardBg)", borderColor: "var(--theme-cardBorder)" }}
          >
            <div className="border-b px-5 py-4" style={{ borderColor: "var(--theme-cardBorder)" }}>
              <h3 className="text-[15px] font-semibold tracking-tight">الطلب</h3>
            </div>
            <CartPanel
              mode={mode}
              locked={Boolean(draft.pending)}
              cart={cart}
              productById={productById}
              total={cartTotal}
              notes={notes}
              onNotes={setNotes}
              onChange={setCart}
              onSubmit={sendOrder}
              submitting={submit.isPending || preview.isPending}
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
          className="flex min-h-14 shrink-0 cursor-pointer items-center justify-between border-t bg-[var(--theme-primaryBtn)] px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-white transition-colors duration-200 hover:bg-[var(--theme-primaryBtnHover)] lg:hidden"
          style={{ borderColor: "var(--theme-cardBorder)" }}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <ShoppingCart className="h-4 w-4" />
            {cart.length} سطر
          </span>
          <span className="text-lg font-bold tabular-nums">{money(cartTotal)}</span>
        </button>
      )}

      {cartOpen && (
        <Dialog title="الطلب" onClose={() => setCartOpen(false)} padded={false}>
          <CartPanel
            mode={mode}
            locked={Boolean(draft.pending)}
            cart={cart}
            productById={productById}
            total={cartTotal}
            notes={notes}
            onNotes={setNotes}
            onChange={setCart}
            onSubmit={sendOrder}
            submitting={submit.isPending || preview.isPending}
            specialPrice={specialPriceFor}
          />
        </Dialog>
      )}

      {openProduct && (
        <ProductDialog
          key={`${openProduct.id}:${mode}`}
          mode={mode}
          canIssue={Boolean(customerId) && can("ISSUE")}
          canAskPrice={Boolean(customerId) && mode === "WHOLESALE" && can("PRICE_REQUEST")}
          locked={Boolean(draft.pending)}
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

      {mergeCustomer && <Dialog title="هذا الزبون عنده سلة محفوظة" onClose={() => setMergeCustomer(null)}>
        <p className="mb-4 text-sm">نحافظ على السلتين؛ اختَر دمجهن أو افتح سلة الزبون واترك المؤقتة محفوظة.</p>
        <div className="space-y-3">
          <Button className="h-11 w-full" disabled={Boolean(existingDraft(mergeCustomer).pending)} onClick={() => {
            try {
              const targetKey = draftKey(mode, mergeCustomer)
              const guestKey = draftKey(mode, null)
              persist({ ...workspace, customerId: mergeCustomer, drafts: { ...workspace.drafts, [targetKey]: mergeAgentDrafts(existingDraft(mergeCustomer), workspace.drafts[guestKey] ?? EMPTY_DRAFT), [guestKey]: { items: [], notes: "" } } })
              setMergeCustomer(null); setScreen("catalog"); setCartOpen(true)
            } catch (err) { toast({ title: (err as Error).message, variant: "destructive" }) }
          }}>ادمج السلتين</Button>
          <Button variant="outline" className="h-11 w-full" onClick={() => {
            persist({ ...workspace, customerId: mergeCustomer, drafts: { ...workspace.drafts, [draftKey(mode, mergeCustomer)]: existingDraft(mergeCustomer) } })
            setMergeCustomer(null); setScreen("catalog"); setCartOpen(true)
          }}>افتح سلة الزبون واترك المؤقتة</Button>
        </div>
      </Dialog>}

      {review && (
        <OrderReviewDialog
          review={review}
          mode={mode}
          notes={notes}
          online={online}
          sending={submit.isPending}
          isRetry={Boolean(draft.pending)}
          reviewChanged={reviewChanged}
          knownStock={(productId) => productById.get(productId)?.currentStock ?? null}
          locationNote={reviewLocationNote}
          onClose={() => { if (!submit.isPending) setReview(null) }}
          onConfirm={() => void confirmOrder()}
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


/* ── catalog ─────────────────────────────────────────────────────────── */

function CatalogScreen({
  allProductIds,
  mode,
  products,
  loading,
  paused,
  error,
  onRetry,
  search,
  columns,
  onOpen,
  onQuickAdd,
  locked,
  inCart,
  specialPrice,
}: {
  allProductIds: string[]
  mode: AgentMode
  products: AgentProduct[]
  loading: boolean
  paused: boolean
  error: boolean
  onRetry: () => void
  search: string
  columns: CatalogColumns
  onOpen: (p: AgentProduct) => void
  onQuickAdd: (p: AgentProduct) => void
  /** A sent order awaits confirmation: nothing may be added until it settles. */
  locked: boolean
  inCart: Map<string, Array<{ unit: Unit; quantity: number }>>
  specialPrice: (productId: string, unit: Unit) => number | null
}) {
  const [visible, setVisible] = useState<string[]>([])
  const thumbs = useThumbnails(allProductIds, visible)
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
  }, [])

  if (error && products.length === 0) return <QueryErrorBox title="ما وصلت المواد" onRetry={onRetry} />

  return (
    <section aria-label="كتلوك المندوب" className="space-y-3">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 px-1">
          <p className="text-sm font-semibold">{products.length} مادة متوفرة</p>
          <p className="text-xs text-slate-500">{search ? "نتائج البحث" : "اضغط الصورة للتفاصيل والإضافة"}</p>
        </div>

        {loading ? (
          paused ? (
            <QueryErrorBox title="ما في اتصال" onRetry={onRetry} />
          ) : (
            <Loading />
          )
        ) : products.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">ما اكو نتائج</p>
        ) : (
          <div className={cn("grid", columns === 4 ? "gap-1.5 sm:gap-3" : "gap-2.5 sm:gap-3")} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {products.map((product) => {
              const special = availableUnits(product).some((u) => specialPrice(product.id, u) !== null)
              const pieces = product.currentStock
              // «أقل من كارتون» is the owner's own line for "running out". Shown
              // in red, never enforced: a shortage does not block a sale here.
              const low = product.pcsPerCarton > 0 && pieces < product.pcsPerCarton
              // The reps count in pieces and dozens; cartons are rare. So the
              // wholesale line says both, and carton mode says cartons.
              const stockText =
                mode === "CARTON"
                  ? `متوفر ${Math.floor(pieces / Math.max(1, product.pcsPerCarton))} كارتون · ${product.pcsPerCarton} قطعة بالكارتون`
                  : pieces >= 12
                    ? `المتوفر ${pieces} قطعة · يكفي ${Math.floor(pieces / 12)} درزن`
                    : `المتوفر ${pieces} قطعة`
              const held = inCart.get(product.id)
              return (
                // A wrapper, not the card itself: the quick-add button cannot
                // live INSIDE the card's button — a button in a button is
                // invalid, and the browser hands the tap to the outer one.
                <div key={product.id} className="relative min-w-0">
                <button
                  type="button"
                  data-pid={product.id}
                  ref={observe}
                  onClick={() => onOpen(product)}
                  className="sales-agent-product group flex h-full w-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-2xl border bg-[var(--theme-cardBg)] text-start shadow-sm transition-[transform,box-shadow,border-color] duration-200 active:scale-[0.98] hover:-translate-y-0.5 hover:border-[var(--theme-accent)] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-accent)]"
                  style={{ borderColor: held ? "var(--theme-accent)" : "var(--theme-cardBorder)" }}
                >
                  <div className="relative aspect-square w-full bg-slate-100 dark:bg-slate-800">
                    {thumbs[product.id] ? (
                      <img
                        src={thumbs[product.id] as string}
                        alt={product.name}
                        loading="lazy"
                        decoding="async"
                      className="h-full w-full bg-white object-contain p-1 transition-transform duration-300 group-hover:scale-[1.04]"
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
                    {(product.isNewArrival || product.isOffer) && <span className="absolute start-2 bottom-2 rounded-full bg-indigo-600 px-2 py-1 text-[11px] font-bold text-white">{product.isNewArrival ? "جديد" : "عرض"}</span>}
                  </div>

                  <div className={cn("flex min-w-0 flex-1 flex-col gap-1", columns === 4 ? "p-1.5 sm:p-3" : "p-2.5 sm:p-3")}>
                    <p className={cn("line-clamp-2 font-semibold leading-snug", columns === 4 ? "min-h-8 text-[11px] sm:min-h-10 sm:text-sm" : "min-h-10 text-sm")}>{product.name}</p>
                    <p className="truncate text-[10px] text-slate-500 sm:text-[11px]">{product.itemNumber}</p>
                    <p className={cn("mt-auto break-words font-bold tabular-nums", columns === 4 ? "text-xs sm:text-base" : "text-sm sm:text-base")}>
                      {money(mode === "CARTON" ? unitPrice(product, "CARTON", mode) : product.salePrice)} <span className="text-[10px] font-normal sm:text-xs">/ {mode === "CARTON" ? "كارتون" : "قطعة"}</span>
                    </p>
                    <span
                      className={cn(
                        "tabular-nums",
                        low ? "font-semibold text-red-600 dark:text-red-400" : "text-slate-500",
                        // 10px on a phone at four columns only. It stayed 10px
                        // on the iPad too, the one screen the reps actually use.
                        columns === 4 ? "text-[10px] sm:text-xs" : "text-[12px]",
                      )}
                    >
                      {stockText}
                    </span>
                    {held && (
                      <span className={cn("font-semibold text-[var(--theme-accent)] tabular-nums", columns === 4 ? "text-[10px] sm:text-xs" : "text-[12px]")}>
                        بالسلة: {held.map((h) => `${h.quantity} ${UNIT_LABEL[h.unit]}`).join(" + ")}
                      </span>
                    )}
                    <span className={cn("mt-2 flex min-h-10 items-center justify-center gap-1 rounded-xl bg-[var(--theme-accentSoft)] font-semibold text-[var(--theme-accent)] sm:min-h-11", columns === 4 ? "text-[10px] sm:text-sm" : "text-xs sm:text-sm")}>{columns === 4 ? "تفاصيل" : "تفاصيل ووحدات"}</span>
                  </div>
                </button>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => onQuickAdd(product)}
                  aria-label={`أضف ${mode === "CARTON" ? "كارتون" : "قطعة"}: ${product.name}`}
                  title={mode === "CARTON" ? "أضف كارتون" : "أضف قطعة"}
                  className="absolute start-2 top-2 grid size-11 place-items-center rounded-full bg-[var(--theme-accent)] text-white shadow-md transition-transform active:scale-90 disabled:opacity-40"
                >
                  <Plus className="size-5" />
                </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
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
  mode,
  canIssue,
  canAskPrice,
  locked,
  product,
  onClose,
  onAdd,
  onIssue,
  onAskPrice,
  specialPrice,
}: {
  mode: AgentMode
  canIssue: boolean
  canAskPrice: boolean
  locked: boolean
  product: AgentProduct
  onClose: () => void
  onAdd: (unit: Unit, quantity: number) => void
  onIssue: (unit: Unit) => void
  onAskPrice: (unit: Unit) => void
  specialPrice: (unit: Unit) => number | null
}) {
  const units = availableUnits(product, mode)
  const [unit, setUnit] = useState<Unit>(() => agentDefaultUnit(mode, product.currentStock))
  const [qty, setQty] = useState(1)
  const qc = useQueryClient()
  const userId = useAuthStore(s => s.user?.id)
  const thumbnail = qc.getQueryData<string | null>(["sales-agent", "thumbnail", userId, product.id])
  const fullImage = useQuery({
    queryKey: ["sales-agent", "full-image", userId, product.id],
    enabled: product.hasImage,
    queryFn: async () => (await api.get<{ data: { imageUrl: string | null } }>(`/sales-agent/products/${product.id}/image`)).data.data.imageUrl,
    placeholderData: thumbnail,
    staleTime: 5 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  })
  const image = fullImage.data ?? thumbnail

  const max = Math.max(0, maxQty(product, unit))
  const approved = specialPrice(unit)
  // Preview only. `submitAgentOrder` re-resolves the approved price from the
  // database when the order is priced, so what is shown here can never become
  // what gets billed.
  const line = (approved ?? unitPrice(product, unit, mode)) * qty

  return (
    <Dialog
      title={product.name}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2" role="group" aria-label="وحدة الطلب">
            {units.map(u => <Button key={u} variant={unit === u ? "default" : "outline"}
              aria-pressed={unit === u} className="h-11 min-w-[4rem] flex-1"
              onClick={() => { setUnit(u); setQty(1) }}>{UNIT_LABEL[u]}</Button>)}
          </div>
          <Button className="h-12 w-full" disabled={locked || !unit || qty > 100000} onClick={() => onAdd(unit, qty)}>
            <Plus className="h-4 w-4" /> أضف للطلب · {money(line)}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" disabled={!canIssue} className="h-11 flex-1" onClick={() => onIssue(unit)}>
              <AlertTriangle className="h-4 w-4" /> أكو مشكلة
            </Button>
            <Button variant="outline" disabled={!canAskPrice} className="h-11 flex-1" onClick={() => onAskPrice(unit)}>
              <BadgePercent className="h-4 w-4" /> اطلب سعر
            </Button>
          </div>
        </div>
      }
    >
      <div className="mx-auto aspect-square w-full max-w-[26rem] shrink-0 overflow-hidden rounded-2xl bg-white">
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
          القطعة {money(mode === "CARTON" ? Number(product.cartonPiecePrice) : product.salePrice)}
        </span>
        <span className="rounded bg-slate-100 px-2.5 py-1.5 font-medium tabular-nums dark:bg-slate-800">
          المتوفر {product.currentStock} قطعة
        </span>
        <span className="rounded bg-slate-100 px-2.5 py-1.5 font-medium dark:bg-slate-800">
          {product.itemNumber}
        </span>
      </div>

      {mode === "CARTON" && <p className="mt-3 text-sm text-slate-500">الكارتون {product.pcsPerCarton} قطعة · السعر الخاص بالموافقة متاح بوضع الجملة فقط.</p>}

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
          <Button variant="outline" className="h-11 w-11 p-0" aria-label="زد" onClick={() => setQty((q) => Math.min(100000, q + 1))}>
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
  mode,
  locked,
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
  mode: AgentMode
  locked: boolean
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
      <fieldset disabled={locked || submitting} className="min-h-0 flex-1 overflow-y-auto p-4">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <ShoppingCart className="h-8 w-8 text-slate-300" />
            <p className="text-sm text-slate-500">السلة فارغة</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {cart.map((line, idx) => {
              const product = productById.get(line.productId)
              if (!product) return <li key={line.productId} className="rounded-xl border border-red-300 p-3 text-sm text-red-700">مادة غير متاحة حالياً ({line.quantity} {UNIT_LABEL[line.unit]}) — السطر محفوظ للمراجعة.<Button variant="outline" className="mt-2 h-11" onClick={() => onChange(prev => prev.filter((_, i) => i !== idx))}>إزالة المادة غير المتاحة</Button></li>
              const special = specialPrice(line.productId, line.unit)
              const lineTotal = (special ?? unitPrice(product, line.unit, mode)) * line.quantity
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
                            prev.map((l, i) => (i === idx ? { ...l, quantity: Math.min(100000, l.quantity + 1) } : l)),
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
          maxLength={4000}
          className="mt-3 w-full rounded border border-slate-300 bg-white p-3 text-[13.5px] placeholder:text-slate-400 focus:border-[var(--theme-accent)] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
        />
      </fieldset>

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
          {submitting ? "جاري التحقق…" : locked ? "تحقق من إرسال الطلب" : "مراجعة الطلب واختيار الزبون"}
        </Button>
      </div>
    </div>
  )
}

/* ── customers ───────────────────────────────────────────────────────── */

/**
 * The reasons this customer needs following up, as the server stated them.
 *
 * Wording comes from the server so «عليه رصيد» cannot quietly become «متأخر
 * بالدفع» on one screen: no due date is recorded anywhere in this system, so
 * nothing may claim a payment is late.
 */
function FollowUpReasons({ reasons }: { reasons?: FollowUpReason[] }) {
  if (!reasons || reasons.length === 0) return null
  const tone = (code: FollowUpReason["code"]) =>
    code === "ORDER_REJECTED" ? "bad" : code === "OFFER_ENDING" ? "ok" : "wait"
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {reasons.map((reason) => (
        <StatusPill key={reason.code} tone={tone(reason.code)}>
          {reason.label}
          {reason.detail ? ` · ${reason.detail}` : ""}
        </StatusPill>
      ))}
    </div>
  )
}

/**
 * Call, WhatsApp and open-on-the-map.
 *
 * Links only: nothing here sends a message by itself. The rep taps, their phone
 * opens, and they decide what to say.
 */
function CustomerQuickActions({
  phone,
  name,
  address,
  inline = false,
}: {
  phone: string
  name: string
  address?: string | null
  inline?: boolean
}) {
  const digits = phone.replace(/\D/g, "")
  const wa = digits.replace(/^0/, "964")
  const mapQuery = encodeURIComponent([name, address].filter(Boolean).join(" "))
  return (
    <div className={cn("flex flex-wrap gap-1.5", !inline && "mt-2")}>
      <a href={`tel:${phone}`} className="inline-flex">
        <Button size="sm" variant="outline" className="h-11">اتصال</Button>
      </a>
      <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="inline-flex">
        <Button size="sm" variant="outline" className="h-11">واتساب</Button>
      </a>
      {(address || name) && (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex"
        >
          <Button size="sm" variant="outline" className="h-11">موقعه</Button>
        </a>
      )}
    </div>
  )
}

function CustomersScreen({
  canCreate,
  currentId,
  areas,
  onPick,
  onNew,
  onOpenStatement,
}: {
  canCreate: boolean
  currentId: string | null
  areas: string[]
  onPick: (id: string) => void
  onNew: () => void
  onOpenStatement: (id: string) => void
}) {
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [followUp, setFollowUp] = useState("")
  const [area, setArea] = useState("")
  // «يحتاجون متابعة فقط» is a SERVER filter (`needsFollowUp`) applied before
  // pagination: never bought, quiet past the shop's setting, positive balance,
  // one of this rep's own pending/refused orders, or an offer about to end.
  // It used to narrow the already-fetched page, which hid customers on later
  // pages and left `total` describing a list the screen did not show.
  const [onlyNeedy, setOnlyNeedy] = useState(false)
  const customers = useMyCustomers(search, page, followUp, area, onlyNeedy)
  const rows = customers.data?.customers ?? []
  const quietDays = customers.data?.quietDays ?? 30
  const pages = Math.max(1, Math.ceil((customers.data?.total ?? 0) / (customers.data?.limit || 200)))

  if (customers.error) {
    return <QueryErrorBox title="ما وصلت قائمة الزبائن" onRetry={() => void customers.refetch()} />
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>زبائني</CardTitle>
        <Button disabled={!canCreate} className="h-11" onClick={onNew}>
          <UserPlus className="h-4 w-4" /> زبون جديد
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2" aria-label="زبائن يحتاجون متابعة">
          {([["", "كل زبائني"], ["quiet", `ما اشترى من ${quietDays} يوم`], ["balance", "عليهم رصيد"], ["never", "ما اشتروا بعد"]] as const).map(([value, label]) => <Button key={value} className="h-11" variant={followUp === value ? "default" : "outline"} onClick={() => { setFollowUp(value); setPage(1) }}>{label}</Button>)}
          <Button className="h-11" variant={onlyNeedy ? "default" : "outline"} onClick={() => { setOnlyNeedy(v => !v); setPage(1) }}>يحتاجون متابعة فقط</Button>
        </div>
        {areas.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="فلترة حسب المنطقة">
            {[["", "كل المناطق"], ...areas.map(a => [a, a] as const)].map(([value, label]) => (
              <Button key={String(value)} className="h-11" variant={area === value ? "default" : "outline"} onClick={() => { setArea(String(value)); setPage(1) }}>{label}</Button>
            ))}
          </div>
        )}
        {/* «مدة عدم الشراء» is the shop's own `inactiveCustomerDays` setting, not
            a number typed into this screen. */}
        {followUp === "quiet" && <p className="text-xs text-slate-500">المدة من إعدادات المحل ({quietDays} يوم)، مو رقم ثابت بالشاشة.</p>}
        {followUp === "balance" && <p className="text-xs text-slate-500">أرصدة موجبة على الزبائن؛ ليست بالضرورة ديوناً متأخرة عن موعد استحقاق.</p>}
        {onlyNeedy && <p className="text-xs text-slate-500">الفلترة من السيرفر قبل تقسيم الصفحات — العدد والترقيم يعكسان النتائج المفلترة، والأسباب معروضة بجانب كل زبون.</p>}
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          placeholder="بحث بالاسم أو الهاتف"
          aria-label="بحث عن زبون"
          className="h-11"
        />

        {customers.isPending ? (
          <Waiting q={customers} />
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            {followUp || search ? "ماكو زبائن مطابقين لهذا الفلتر." : "ما عندك زبائن بعد. أضف زبون جديد من الزر فوق."}
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
                const quiet = c.daysSinceLastSale != null && c.daysSinceLastSale >= quietDays
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

                    {/* WHY this customer needs a call, next to their name — a
                        bare list of names tells the rep nothing. */}
                    <FollowUpReasons reasons={c.followUpReasons} />

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
                    <CustomerQuickActions phone={c.phone} name={c.name} address={c.address} />
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
                const quiet = c.daysSinceLastSale != null && c.daysSinceLastSale >= quietDays
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
                      <FollowUpReasons reasons={c.followUpReasons} />
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
                      {/* The table starts at 640px, so an iPad gets it too —
                          and these two, the buttons the rep taps all day, were
                          28px there. Full touch height until a real desktop. */}
                      <div className="flex items-center gap-1.5">
                        <Button size="sm" className="h-11" onClick={() => onPick(c.id)}>
                          بيع
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-11"
                          onClick={() => onOpenStatement(c.id)}
                        >
                          <Receipt className="h-3.5 w-3.5" /> كشف
                        </Button>
                        <CustomerQuickActions phone={c.phone} name={c.name} address={c.address} inline />
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
  const [lookup, setLookup] = useState<PhoneLookup | null>(null)
  const qc = useQueryClient()

  // Full rows, not names: the picker needs ids to save the link and centres to
  // suggest an area from the pin.
  const areas = useQuery({
    queryKey: ["sales-agent", "area-rows"],
    queryFn: async () => {
      const res = await api.get<{ data: AreaOption[] }>("/areas", { params: { activeOnly: 1 } })
      return res.data.data ?? []
    },
    staleTime: 30 * 60 * 1000,
  })

  const [point, setPoint] = useState<ShopPoint | null>(null)
  const [areaId, setAreaId] = useState("")
  // The GPS reading that produced the pin, kept so the save carries WHEN it was
  // taken and how precise it was — not re-read at submit time, when the rep may
  // already be back in the car.
  const [located, setLocated] = useState<AgentLocation | null>(null)

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
  useEffect(() => { checkRef.current = checkPhone }, [checkPhone])
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
        areaId: areaId || undefined,
        // The reading taken when the pin was dropped, with its own timestamp.
        // The server fills the shop position from it and files one stamp.
        location: located ?? undefined,
        latitude: point?.lat,
        longitude: point?.lng,
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

        <Field label="العنوان">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} className="h-11" />
        </Field>

        {/* Position and area together, because the rep is standing in the shop
            exactly once — when they add it. Coming back later to place a pin is
            a trip nobody makes. */}
        <ShopLocationPicker
          point={point}
          onPoint={setPoint}
          areas={areas.data ?? []}
          areaId={areaId}
          onAreaId={setAreaId}
          onLocationRead={setLocated}
        />

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
  section,
  customerId,
  customerName,
  onNeedCustomer,
}: {
  // «فلوسي» = the rep's cash figures and handovers; «سنداتي» = recording and
  // listing receipts. Each section only runs the queries it shows.
  section: "money" | "receipts"
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
    enabled: section === "money",
    queryFn: async () => {
      const res = await api.get<{ data: CashOnHand }>("/sales-agent/cash-on-hand")
      return res.data.data
    },
    retry: 3,
  })

  const today = useQuery({
    queryKey: ["sales-agent", "today"],
    enabled: section === "money",
    queryFn: async () => {
      const res = await api.get<{ data: AgentToday }>("/sales-agent/today")
      return res.data.data
    },
    retry: 3,
  })

  // Paged by offset: the list used to stop at the newest 40, so a rep could
  // never see an older receipt. The server orders by (date, id), which keeps
  // the pages from overlapping.
  const RECEIPTS_PAGE = 40
  const receipts = useInfiniteQuery({
    queryKey: ["sales-agent", "receipts"],
    enabled: section === "receipts",
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const res = await api.get<{ data: AgentReceipt[] }>("/sales-agent/receipts", {
        params: { limit: RECEIPTS_PAGE, offset: pageParam },
      })
      return res.data.data ?? []
    },
    getNextPageParam: (last, all) => (last.length === RECEIPTS_PAGE ? all.length * RECEIPTS_PAGE : undefined),
    retry: 3,
  })
  const receiptRows = receipts.data?.pages.flat() ?? []

  const handovers = useQuery({
    queryKey: ["sales-agent", "handovers"],
    enabled: section === "money",
    queryFn: async () => {
      const res = await api.get<{ data: AgentHandoverRow[] }>("/sales-agent/handovers")
      return res.data.data ?? []
    },
    retry: 3,
  })

  const save = useMutation({
    mutationFn: async () => {
      // Read HERE, not at render: the position that matters is where the rep
      // stood when they took the money. A receipt is always written online —
      // unlike a cart, it has no offline draft — so reading it now is honest.
      const location = await readAgentLocation()
      const res = await api.post("/sales-agent/receipts", {
        customerId,
        amount: Number(amount),
        notes: notes.trim() || undefined,
        clientRequestId: requestId.current,
        location,
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
      {section === "money" && (
      <>
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
      </>
      )}

      {section === "receipts" && (
      <>
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
            {receiptRows.length} سند
          </span>
        </CardHeader>
        <CardContent>
          {receipts.isPending ? (
            <Waiting q={receipts} />
          ) : receipts.error ? (
            <QueryErrorBox title="ما وصلت السندات" onRetry={() => void receipts.refetch()} />
          ) : receiptRows.length === 0 ? (
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
                {receiptRows.map((r) => (
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
          {receipts.hasNextPage && (
            <Button
              variant="outline"
              className="mt-3 h-11 w-full"
              disabled={receipts.isFetchingNextPage}
              onClick={() => void receipts.fetchNextPage()}
            >
              {receipts.isFetchingNextPage ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              عرض المزيد
            </Button>
          )}
        </CardContent>
      </Card>
      </>
      )}

      {section === "money" && (
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
      )}
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
