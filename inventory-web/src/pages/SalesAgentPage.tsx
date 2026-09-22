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
import { LayoutGrid, Receipt, Search, SlidersHorizontal, ShoppingCart, Users } from "lucide-react"
import { api } from "../api/client"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { toast } from "../components/ui/use-toast"
import { ToastAction } from "../components/ui/toast"
import { apiErrorMessage } from "../utils/apiError"
import { cn } from "../utils/cn"
import { useAuthStore } from "../store/authStore"
import { scoreProduct } from "../utils/search"
import { cartonEligible, cleanAgentLines, draftKey, EMPTY_DRAFT, isDefinitiveOrderRejection, mergeAgentDrafts, pendingAttempts, readAgentWorkspace, workspaceKey, type AgentDraft, type AgentWorkspace, type OrderPayload, type PendingMeta } from "../utils/salesAgentDrafts"
import { UNIT_LABEL, money, shortDate } from "./sales-agent/format"
import { CustomerInsights } from "./sales-agent/CustomerInsights"
import { OrderReviewDialog } from "./sales-agent/OrderReviewDialog"
import { PendingOrdersScreen } from "./sales-agent/PendingOrdersScreen"
import { VisitsScreen } from "./sales-agent/VisitsScreen"
import { distanceMetres, hasFix, locationNote, readAgentLocation } from "../utils/agentLocation"
import type { OrderReview, SubmittedOrder } from "./sales-agent/types"
import { type Unit, type AgentProduct, type CartLine, type UsablePrice, unitPrice, type Screen, type CatalogColumns, type CatalogSort } from "./sales-agent/model"
import { Dialog, EmptyState } from "./sales-agent/ui"
import { useAgentProducts, useCustomerHeader, useOnce } from "./sales-agent/hooks"
import { CatalogScreen, ProductDialog } from "./sales-agent/CatalogScreen"
import { CartPanel } from "./sales-agent/CartPanel"
import { CustomersScreen, NewCustomerScreen } from "./sales-agent/CustomersScreen"
import { OrdersScreen } from "./sales-agent/OrdersScreen"
import { MoneyScreen } from "./sales-agent/MoneyScreen"
import { IssueDialog, PriceRequestDialog, MyIssuesScreen } from "./sales-agent/IssueScreens"
import { CustomerDetailScreen } from "./sales-agent/CustomerDetailScreen"
import { TodayScreen } from "./sales-agent/TodayScreen"

// The screens, their shared shapes and hooks live in ./sales-agent/ — this file
// is the workspace that holds the carts and routes between them.

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
  // First, and where the page opens: the rep's first question every morning is
  // «وين أبدي؟», and the answer used to be spread over four other tabs.
  { key: "today", label: "يومي" },
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
  const [screen, setScreen] = useState<Screen>("today")
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
  /**
   * «تراجع» after a line left the cart — put it back where it was.
   *
   * Same live-workspace read as undoQuickAdd, for the same reason: the toast
   * outlives this render. If the rep has since added that product again, the
   * quantities are added together instead of making a second line for it.
   * `key` is the cart the line was removed FROM, captured at removal.
   */
  const restoreCartLine = (key: string, line: CartLine, index: number) => {
    setWorkspace((current) => {
      const live = current.drafts[key] ?? EMPTY_DRAFT
      if (live.pending) return current
      const existing = live.items.findIndex((l) => l.productId === line.productId && l.unit === line.unit)
      const items = [...live.items]
      if (existing >= 0) {
        items[existing] = { ...items[existing], quantity: Math.min(100000, items[existing].quantity + line.quantity) }
      } else {
        items.splice(Math.min(index, items.length), 0, line)
      }
      const next = { ...current, drafts: { ...current.drafts, [key]: { ...live, items } } }
      try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* restored in memory */ }
      return next
    })
  }
  const offerLineRestore = (line: CartLine, index: number) => {
    const key = activeKey
    const name = productById.get(line.productId)?.name ?? "المادة"
    toast({
      title: `انشالت: ${name}`,
      description: `${line.quantity} ${UNIT_LABEL[line.unit]}`,
      action: (
        <ToastAction altText="رجّع السطر" onClick={() => restoreCartLine(key, line, index)}>
          تراجع
        </ToastAction>
      ),
    })
  }

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

          {screen === "today" && (
            <TodayScreen
              repName={user?.name ?? ""}
              unresolvedCount={unresolvedCount}
              onOpenPending={() => setScreen("pending")}
              onSell={(id) => pickCustomer(id)}
              onOpenStatement={(id) => { setDetailCustomerId(id); setScreen("customer-detail") }}
              onGo={(next) => setScreen(next)}
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
                // Today's wholesale price per unit from the grid already loaded,
                // for the «أكثر من ٦٪» warning. The server re-checks it.
                catalogUnitPrice={(productId, unit, priceMode) => {
                  const product = productById.get(productId)
                  // Against the invoice's OWN price mode: a carton invoice is
                  // cheaper by design, and comparing it with the wholesale
                  // price would warn about a discount nobody gave.
                  return product ? unitPrice(product, unit, priceMode === "CARTON" ? "CARTON" : "WHOLESALE") : null
                }}
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
              onRemoved={offerLineRestore}
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
            onRemoved={offerLineRestore}
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
