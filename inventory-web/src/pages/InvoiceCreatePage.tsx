import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { usePageTitle } from "../hooks/usePageTitle"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate, useSearchParams } from "react-router-dom"
import { AlertTriangle, Camera, Download, ImageDown, Plus, Printer, Receipt, ScanLine, ShoppingCart, Trash2, X } from "lucide-react"
import { fmt } from "../utils/fmt"
import { listTabs, upsertTab, removeTab, newTabId, tabDataKey, type DraftTabMeta } from "../utils/draftTabs"
import { applyCoupon, createReceipt, getWalkInCustomer, invoiceImageObjectUrl, sendWhatsAppInvoice } from "../api/endpoints"
import { useCustomers } from "../hooks/useCustomers"
import { useCreateInvoice } from "../hooks/useInvoices"
import { useProducts } from "../hooks/useProducts"
import { useAuthStore } from "../store/authStore"
import { useUnsavedWarning } from "../hooks/useUnsavedWarning"
import type { Customer, Product } from "../types/api"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { Input } from "../components/ui/input"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import { UnsavedChangesDialog } from "../components/ui/UnsavedChangesDialog"
import { cn } from "../utils/cn"
import { VoiceInvoiceButton } from "../components/voice/VoiceInvoiceButton"
import { OcrInvoiceScanner, type OcrReadyItem } from "../components/ocr/OcrInvoiceScanner"
import { calculateInvoiceFinancials } from "../utils/financial"

type Unit = "PIECE" | "DOZEN" | "CARTON"
type PaymentMode = "CREDIT" | "CASH"
type InvoiceType = "SALE" | "PURCHASE"

interface DraftItem {
  product: Product
  unit: Unit
  quantity: number
  unitPrice: number
  warehouseId?: string
}

function stockOf(product: Product) {
  return product.currentStock ?? product.openingBalancePcs + product.cartonsAvailable * product.pcsPerCarton
}

function matchesProduct(product: Product, q: string) {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return (
    product.name.toLowerCase().includes(needle) ||
    product.itemNumber.toLowerCase().includes(needle) ||
    (product.qrCode?.toLowerCase().includes(needle) ?? false) ||
    (product.cartonQrCode?.toLowerCase().includes(needle) ?? false)
  )
}

function itemQuantityInPieces(item: DraftItem) {
  if (item.unit === "CARTON") return item.quantity * item.product.pcsPerCarton
  if (item.unit === "DOZEN") return item.quantity * 12
  return item.quantity
}

function ProductThumb({ product }: { product: Product }) {
  if (product.imageUrl) {
    return <img src={product.imageUrl} alt={product.name} className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-slate-200" />
  }
  return <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">{product.itemNumber.slice(0, 3)}</div>
}

// Legacy single-draft key (kept for backward compat with old autosaves)
function getDraftKey(userId: string | undefined, type: InvoiceType) {
  return `invoice_draft_${type}_${userId ?? "anon"}`
}

interface PersistedDraft {
  customerId: string | null
  date: string
  paymentMode: PaymentMode
  items: Array<{ productId: string; unit: Unit; quantity: number; unitPrice: number; warehouseId?: string }>
  discount: number
  paidAmount: number
  savedAt: number
}

function extractErrorMessage(err: unknown): string {
  if (!err) return "تعذر حفظ الفاتورة"
  // Axios error
  const axiosErr = err as { response?: { data?: { message?: string; error?: string } }; message?: string }
  const serverMsg = axiosErr.response?.data?.message ?? axiosErr.response?.data?.error
  if (serverMsg) return String(serverMsg)
  if (axiosErr.message) return axiosErr.message
  return "تعذر حفظ الفاتورة"
}

export function InvoiceCreatePage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const invoiceType: InvoiceType = (searchParams.get("type") === "PURCHASE" ? "PURCHASE" : "SALE")
  const isPurchase = invoiceType === "PURCHASE"
  usePageTitle(isPurchase ? "فاتورة شراء جديدة" : "فاتورة بيع جديدة")

  const userId = useAuthStore((s) => s.user?.id)
  const uid = userId ?? "anon"
  const permissions = useAuthStore((s) => s.user?.permissions ?? [])
  const hidePrice = !isPurchase && permissions.includes("VIEW_WITHOUT_PRICES" as never)

  // ── Tab ID from URL ──────────────────────────────────────────────────────────
  const urlTid = searchParams.get("tid")

  // On first mount: if no tid, create one and redirect
  useEffect(() => {
    if (urlTid) return
    const tid = newTabId()
    setSearchParams((p) => { const n = new URLSearchParams(p); n.set("tid", tid); return n }, { replace: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeTid = urlTid ?? ""
  const draftKey = activeTid ? tabDataKey(activeTid) : getDraftKey(userId, invoiceType)

  // Tabs list (read fresh on each render; updated via localStorage)
  const [tabs, setTabs] = useState<DraftTabMeta[]>(() => listTabs(uid))
  const refreshTabs = useCallback(() => setTabs(listTabs(uid)), [uid])
  const [closeTabId, setCloseTabId] = useState<string | null>(null)
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null)
  const [closeSaving, setCloseSaving] = useState(false)
  const [closeError, setCloseError] = useState("")

  const { customersQuery, createMutation: createCustomerMutation } = useCustomers()
  const { productsQuery, createMutation: createProductMutation } = useProducts()
  const createMutation = useCreateInvoice()
  const queryClient = useQueryClient()

  // ---- header state ----
  const [customerQuery, setCustomerQuery] = useState("")
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [customerHighlight, setCustomerHighlight] = useState(0)
  const [customerListOpen, setCustomerListOpen] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("CREDIT")

  // ---- quick-add modals ----
  const [quickAddCustomerOpen, setQuickAddCustomerOpen] = useState(false)
  const [quickAddCustomerName, setQuickAddCustomerName] = useState("")
  const [quickAddCustomerPhone, setQuickAddCustomerPhone] = useState("")
  const [quickAddCustomerAddress, setQuickAddCustomerAddress] = useState("")
  const [quickAddCustomerNotes, setQuickAddCustomerNotes] = useState("")
  const [quickAddCustomerBalance, setQuickAddCustomerBalance] = useState("0")
  const [quickAddCustomerCreditLimit, setQuickAddCustomerCreditLimit] = useState("")
  const [quickAddCustomerIsSupplier, setQuickAddCustomerIsSupplier] = useState(false)
  const [quickAddProductOpen, setQuickAddProductOpen] = useState(false)
  const [quickAddProductName, setQuickAddProductName] = useState("")
  const [quickAddProductSalePrice, setQuickAddProductSalePrice] = useState("")
  const [quickAddProductPurchasePrice, setQuickAddProductPurchasePrice] = useState("")

  // ---- items state ----
  const [items, setItems] = useState<DraftItem[]>([])
  const [productModal, setProductModal] = useState(false)
  const [productQuery, setProductQuery] = useState("")
  const [productHighlight, setProductHighlight] = useState(0)
  const [showPurchase, setShowPurchase] = useState(false)
  const [showStock, setShowStock] = useState(false)
  const [useRetailPrice, setUseRetailPrice] = useState(false)

  // ---- totals state ----
  const [discount, setDiscount] = useState(0)
  const [couponCode, setCouponCode] = useState("")
  const [couponMessage, setCouponMessage] = useState("")
  const [paidAmount, setPaidAmount] = useState(0)
  const [preview, setPreview] = useState(false)
  const [savedInvoiceId, setSavedInvoiceId] = useState<string | null>(null)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [whatsappPromptId, setWhatsappPromptId] = useState<string | null>(null)
  const [whatsappSending, setWhatsappSending] = useState(false)
  const [walkInLoading, setWalkInLoading] = useState(false)

  // Reset all form state when the active tab changes (so tabs are truly isolated)
  const prevTidRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeTid || activeTid === prevTidRef.current) return
    prevTidRef.current = activeTid
    setSelectedCustomer(null)
    setCustomerQuery("")
    setItems([])
    setDiscount(0)
    setPaidAmount(0)
    setSavedInvoiceId(null)
    setLastSavedAt(null)
    setDate(new Date().toISOString().slice(0, 10))
    setPaymentMode("CREDIT")
    clientRequestIdRef.current = crypto.randomUUID()
    // Draft loading will run separately via the draftKey effect
  }, [activeTid])

  // ── Tab title: shows customer name so user knows which tab is which ──────────
  useEffect(() => {
    const customerLabel = selectedCustomer?.name ?? ""
    const typeLabel = isPurchase ? "فاتورة شراء" : "فاتورة بيع"
    document.title = customerLabel
      ? `${typeLabel} — ${customerLabel}`
      : typeLabel
    return () => { document.title = "مخزوني" }
  }, [selectedCustomer, isPurchase])

  // ── Unsaved warning: active when there are items and no saved invoice ─────
  const savingRef = useRef(false)
  const isDirty = (!!selectedCustomer || items.length > 0 || discount > 0 || paidAmount > 0 || !!couponCode.trim()) && !savedInvoiceId
  const blocker = useUnsavedWarning(isDirty, savingRef)

  // ---- OCR state ----
  const [ocrOpen, setOcrOpen] = useState(false)

  // ---- barcode state ----
  const [scanBuffer, setScanBuffer] = useState("")
  const scanInputRef = useRef<HTMLInputElement | null>(null)
  const lastFocusRef = useRef(0)
  const clientRequestIdRef = useRef(crypto.randomUUID())

  // ---- field refs ----
  const customerInputRef = useRef<HTMLInputElement | null>(null)
  const paidInputRef = useRef<HTMLInputElement | null>(null)
  const productSearchRef = useRef<HTMLInputElement | null>(null)
  const productListRef = useRef<HTMLDivElement | null>(null)
  const productItemRefs = useRef<Record<number, HTMLButtonElement | null>>({})
  const quantityRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const priceRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const totalRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const customers = useMemo(() => customersQuery.data ?? [], [customersQuery.data])
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data])

  // All customers are eligible for any invoice type (supplier = customer, no distinction)
  const customerSuggestions = useMemo(
    () =>
      customers
        .filter((c) => c.name.includes(customerQuery) || c.phone.includes(customerQuery))
        .slice(0, 8),
    [customers, customerQuery],
  )
  const productSuggestions = useMemo(
    () => products.filter((p) => matchesProduct(p, productQuery)),
    [products, productQuery],
  )

  // Highlights reset inline in change handlers (avoid setState-in-effect)

  // Scroll highlighted product item into view
  useEffect(() => {
    const el = productItemRefs.current[productHighlight]
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [productHighlight])

  const subtotal = useMemo(() => items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0), [items])
  const previousBalance = selectedCustomer?.currentBalance ?? 0
  const beforePayment = calculateInvoiceFinancials({
    type: invoiceType,
    subtotal,
    discount,
    previousBalance,
  })
  const financials = calculateInvoiceFinancials({
    type: invoiceType,
    subtotal,
    discount,
    paidAmount: paymentMode === "CASH" ? beforePayment.totalAmount : paidAmount,
    previousBalance,
  })
  const total = financials.totalAmount
  const overpayment = isPurchase ? 0 : financials.overpayment
  const effectivePaid = financials.paidAmount
  const remaining = financials.remainingAmount
  const finalBalance = financials.finalBalance
  const hasInvalidTotal = total < 0

  function unitPriceFor(product: Product, unit: Unit) {
    const base = isPurchase
      ? product.purchasePrice
      : (useRetailPrice && product.retailPrice > 0 ? product.retailPrice : product.salePrice)
    if (unit === "CARTON") return base * product.pcsPerCarton
    if (unit === "DOZEN") return base * 12
    return base
  }

  // Items selling below purchase price
  const belowCostItems = useMemo(() => {
    if (isPurchase) return new Set<number>()
    const set = new Set<number>()
    items.forEach((item, i) => {
      if (item.unitPrice < Number(item.product.purchasePrice ?? 0)) set.add(i)
    })
    return set
  }, [items, isPurchase])

  const hasBelowCost = belowCostItems.size > 0

  // Items that would push stock into negative territory (warning only, not blocking)
  const lowStockWarnings = useMemo(() => {
    if (isPurchase) return [] // Purchase adds stock, can't go negative
    // First pass: aggregate total piece-consumption per product across ALL rows
    const consumed: Record<string, number> = {}
    for (const item of items) {
      const pid = item.product.id
      const pcs =
        item.unit === "CARTON"
          ? item.quantity * item.product.pcsPerCarton
          : item.unit === "DOZEN"
            ? item.quantity * 12
            : item.quantity
      consumed[pid] = (consumed[pid] ?? 0) + pcs
    }
    // Second pass: warn once per product whose cumulative consumption exceeds available stock
    const warnings: string[] = []
    const warned = new Set<string>()
    for (const item of items) {
      const pid = item.product.id
      if (warned.has(pid)) continue
      warned.add(pid)
      const available = stockOf(item.product)
      const totalPcs = consumed[pid] ?? 0
      const after = available - totalPcs
      if (after < 0)
        warnings.push(`${item.product.name} (متوفر: ${fmt(available)}, سيصبح: ${fmt(after)})`)
    }
    return warnings
  }, [items, isPurchase])

  // ----- LOAD DRAFT on mount -----
  useEffect(() => {
    if (savedInvoiceId) return
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw) return
      const draft: PersistedDraft = JSON.parse(raw)
      if (Date.now() - draft.savedAt > 7 * 86_400_000) return
      setDate(draft.date)
      setPaymentMode(draft.paymentMode)
      setDiscount(draft.discount ?? 0)
      setPaidAmount(draft.paidAmount)
      const cust = customers.find((c) => c.id === draft.customerId)
      if (cust) {
        setSelectedCustomer(cust)
        setCustomerQuery(cust.name)
      }
      const restoredItems: DraftItem[] = []
      for (const it of draft.items) {
        const p = products.find((x) => x.id === it.productId)
        if (p) restoredItems.push({ product: p, unit: it.unit, quantity: it.quantity, unitPrice: it.unitPrice, warehouseId: it.warehouseId })
      }
      setItems(restoredItems)
    } catch {
      // ignore corrupt draft
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, products, draftKey])

  useEffect(() => {
    if (!pendingCloseTabId || pendingCloseTabId !== activeTid) return
    const timeout = window.setTimeout(() => {
      setCloseTabId(pendingCloseTabId)
      setPendingCloseTabId(null)
    }, 100)
    return () => window.clearTimeout(timeout)
  }, [activeTid, pendingCloseTabId])

  // ----- AUTOSAVE every 3 seconds -----
  useEffect(() => {
    if (savedInvoiceId) return
    const id = window.setInterval(() => {
      if (items.length === 0 && !selectedCustomer) return
      const draft: PersistedDraft = {
        customerId: selectedCustomer?.id ?? null,
        date,
        paymentMode,
        items: items.map((i) => ({
          productId: i.product.id,
          unit: i.unit,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          warehouseId: i.warehouseId,
        })),
        discount,
        paidAmount,
        savedAt: Date.now(),
      }
      try {
        localStorage.setItem(draftKey, JSON.stringify(draft))
        setLastSavedAt(draft.savedAt)
      } catch {
        // quota exceeded
      }
      // Update tab metadata
      if (activeTid) {
        const sub = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0)
        upsertTab(uid, {
          id: activeTid,
          type: invoiceType,
          label: selectedCustomer?.name ?? "جديد",
          subtotal: sub,
          updatedAt: Date.now(),
        })
        refreshTabs()
      }
    }, 3000)
    return () => window.clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedCustomer, date, paymentMode, paidAmount, draftKey, savedInvoiceId, activeTid, uid, invoiceType])

  function clearDraft() {
    try { localStorage.removeItem(draftKey) } catch {}
    if (activeTid) removeTab(uid, activeTid)
    refreshTabs()
  }

  function openNewTab(type: InvoiceType = invoiceType) {
    const tid = newTabId()
    navigate(`/invoices/new?type=${type}&tid=${tid}`)
  }

  function destinationAfterClose(tid: string) {
    const remaining = listTabs(uid).filter((tab) => tab.id !== tid)
    if (remaining.length === 0) return "/invoices"
    const next = remaining[remaining.length - 1]
    return `/invoices/new?type=${next.type}&tid=${next.id}`
  }

  function requestCloseTab(tid: string) {
    setCloseError("")
    if (tid !== activeTid) {
      const target = tabs.find((tab) => tab.id === tid)
      if (target) {
        setPendingCloseTabId(tid)
        switchTab(target)
      }
      return
    }
    setCloseTabId(tid)
  }

  function discardAndCloseTab() {
    if (!closeTabId) return
    const tid = closeTabId
    const destination = destinationAfterClose(tid)
    savingRef.current = true
    removeTab(uid, tid)
    refreshTabs()
    setCloseTabId(null)
    setItems([])
    setSelectedCustomer(null)
    navigate(destination)
    window.setTimeout(() => { savingRef.current = false }, 0)
  }

  function switchTab(t: DraftTabMeta) {
    navigate(`/invoices/new?type=${t.type}&tid=${t.id}`)
  }

  function pickCustomer(customer: Customer) {
    setSelectedCustomer(customer)
    setCustomerQuery(customer.name)
    setCustomerListOpen(false)
    // Go directly to the product search after picking a customer
    window.setTimeout(() => {
      setProductModal(true)
      window.setTimeout(() => productSearchRef.current?.focus(), 50)
    }, 0)
  }

  // إضافة منتجات من OCR مباشرة للفاتورة
  function normalizeLookup(value: string) {
    return value.trim().replace(/\s+/g, " ").toLowerCase()
  }

  function setCustomerSilently(customer: Customer) {
    setSelectedCustomer(customer)
    setCustomerQuery(customer.name)
    setCustomerListOpen(false)
  }

  function handleOcrSupplierDetected(name: string) {
    if (!isPurchase) return
    const supplierName = name.trim()
    if (!supplierName) return

    const aliasKey = `ocr_supplier_alias:${normalizeLookup(supplierName)}`
    const savedName = localStorage.getItem(aliasKey)
    const targetName = savedName || supplierName
    const directMatch = customers.find((customer) => {
      const customerName = normalizeLookup(customer.name)
      const target = normalizeLookup(targetName)
      return customerName === target || customerName.includes(target) || target.includes(customerName)
    })

    if (directMatch) {
      localStorage.setItem(aliasKey, directMatch.name)
      setCustomerSilently(directMatch)
      return
    }

    const answer = window.prompt(`قريت اسم المورد/المحل "${supplierName}". هذا مال يا مورد؟ اكتب اسم المورد مثل الموجود بالنظام:`)
    if (!answer?.trim()) return
    const answerMatch = customers.find((customer) => normalizeLookup(customer.name).includes(normalizeLookup(answer)))
    if (answerMatch) {
      localStorage.setItem(aliasKey, answerMatch.name)
      setCustomerSilently(answerMatch)
      return
    }
    setCustomerQuery(answer.trim())
    setCustomerListOpen(true)
  }

  function addOcrItems(ocrItems: OcrReadyItem[]) {
    const newItems = ocrItems
      .map((ocr) => {
        const product = ocr.product ?? products.find((p) => p.id === ocr.productId)
        if (!product) return null
        return {
          product,
          unit: ocr.unit,
          quantity: ocr.quantity,
          unitPrice: ocr.unitPrice > 0 ? ocr.unitPrice : unitPriceFor(product, ocr.unit),
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    setItems((current) => [...current, ...newItems])
    void queryClient.invalidateQueries({ queryKey: ["products"] })
  }

  function defaultWarehouseId(product: Product): string | undefined {
    const stocks = product.warehouseStocks ?? []
    if (stocks.length === 1) return stocks[0].warehouseId
    // for multiple warehouses pick the one with most stock
    if (stocks.length > 1) {
      return stocks.reduce((a, b) => (a.quantityPieces >= b.quantityPieces ? a : b)).warehouseId
    }
    return undefined
  }

  function addProduct(product: Product) {
    const nextIndex = items.length
    setItems((current) => [
      ...current,
      {
        product,
        unit: "PIECE",
        quantity: 1,
        unitPrice: unitPriceFor(product, "PIECE"),
        warehouseId: defaultWarehouseId(product),
      },
    ])
    setProductModal(false)
    setProductQuery("")
    window.setTimeout(() => quantityRefs.current[`${nextIndex}`]?.focus(), 0)
  }

  function quickCreateProduct() {
    const name = productQuery.trim()
    if (!name) return
    setQuickAddProductName(name)
    setQuickAddProductSalePrice("")
    setQuickAddProductPurchasePrice("")
    setQuickAddProductOpen(true)
  }

  function submitQuickAddProduct() {
    const name = quickAddProductName.trim()
    if (!name || createProductMutation.isPending) return
    createProductMutation.mutate(
      {
        name,
        salePrice: Number(quickAddProductSalePrice) || 0,
        purchasePrice: Number(quickAddProductPurchasePrice) || 0,
        pcsPerCarton: 1,
        minStock: 0,
      },
      {
        onSuccess: (response) => {
          const product = response.data
          if (product) {
            setQuickAddProductOpen(false)
            addProduct(product)
          }
        },
      },
    )
  }

  function openQuickAddCustomer() {
    setQuickAddCustomerName(customerQuery.trim())
    setQuickAddCustomerPhone("")
    setQuickAddCustomerAddress("")
    setQuickAddCustomerNotes("")
    setQuickAddCustomerBalance("0")
    setQuickAddCustomerCreditLimit("")
    setQuickAddCustomerIsSupplier(isPurchase)
    setCustomerListOpen(false)
    setQuickAddCustomerOpen(true)
  }

  function submitQuickAddCustomer() {
    const name = quickAddCustomerName.trim()
    if (!name || createCustomerMutation.isPending) return
    createCustomerMutation.mutate(
      {
        name,
        phone: quickAddCustomerPhone.trim(),
        address: quickAddCustomerAddress.trim() || undefined,
        notes: quickAddCustomerNotes.trim() || undefined,
        openingBalance: Number(quickAddCustomerBalance) || 0,
        creditLimit: quickAddCustomerCreditLimit ? Number(quickAddCustomerCreditLimit) : undefined,
        isSupplier: quickAddCustomerIsSupplier,
      },
      {
        onSuccess: (response) => {
          const customer = (response as { data?: Customer }).data
          if (customer) {
            setQuickAddCustomerOpen(false)
            pickCustomer(customer)
          }
        },
      },
    )
  }

  function addProductByCode(code: string) {
    const c = code.trim()
    if (!c) return
    const hit =
      products.find((p) => p.qrCode?.toLowerCase() === c.toLowerCase()) ??
      products.find((p) => p.cartonQrCode?.toLowerCase() === c.toLowerCase()) ??
      products.find((p) => p.itemNumber.toLowerCase() === c.toLowerCase())
    if (!hit) return
    const isCarton = hit.cartonQrCode?.toLowerCase() === c.toLowerCase()
    setItems((current) => [
      ...current,
      {
        product: hit,
        unit: isCarton ? "CARTON" : "PIECE",
        quantity: 1,
        unitPrice: unitPriceFor(hit, isCarton ? "CARTON" : "PIECE"),
        warehouseId: defaultWarehouseId(hit),
      },
    ])
  }

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setItems((current) => current.map((item, i) => {
      if (i !== index) return item
      const next = { ...item, ...patch }
      if (patch.unit && patch.unit !== item.unit && patch.unitPrice === undefined) {
        next.unitPrice = unitPriceFor(item.product, patch.unit)
      }
      return next
    }))
  }

  // When user edits total → recalculate unit price
  function updateItemTotal(index: number, newTotal: number) {
    setItems((current) =>
      current.map((item, i) => {
        if (i !== index) return item
        const qty = item.quantity || 1
        return { ...item, unitPrice: Math.round((newTotal / qty) * 1000) / 1000 }
      }),
    )
  }

  function removeItem(index: number) {
    setItems((current) => current.filter((_, i) => i !== index))
  }

  // ---- keyboard handlers ----
  function handleCustomerKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!customerListOpen || customerSuggestions.length === 0) {
      if (e.key === "Enter" && selectedCustomer) {
        e.preventDefault()
        paidInputRef.current?.focus()
      }
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setCustomerHighlight((i) => (i + 1) % customerSuggestions.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setCustomerHighlight((i) => (i - 1 + customerSuggestions.length) % customerSuggestions.length)
    } else if (e.key === "Enter") {
      e.preventDefault()
      pickCustomer(customerSuggestions[customerHighlight])
    } else if (e.key === "Escape") {
      setCustomerListOpen(false)
    }
  }

  function handleProductSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (productSuggestions.length === 0) {
      if (e.key === "Enter" && productQuery.trim()) {
        e.preventDefault()
        quickCreateProduct()
      }
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setProductHighlight((i) => Math.min(i + 1, productSuggestions.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setProductHighlight((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      addProduct(productSuggestions[productHighlight])
    }
  }

  function handleRowKey(
    e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    rowKey: string,
    field: "unit" | "qty" | "price" | "total",
  ) {
    if (e.key !== "Enter") return
    e.preventDefault()
    if (field === "unit") quantityRefs.current[rowKey]?.focus()
    else if (field === "qty") priceRefs.current[rowKey]?.focus()
    else if (field === "price") totalRefs.current[rowKey]?.focus()
    else if (field === "total") {
      setProductModal(true)
      window.setTimeout(() => productSearchRef.current?.focus(), 50)
    }
  }

  function selectAllOnFocus(e: React.FocusEvent<HTMLInputElement>) {
    e.target.select()
  }

  // ---- USB barcode scanner ----
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return
      if (productModal || preview) return
      const now = Date.now()
      if (now - lastFocusRef.current > 100) setScanBuffer("")
      lastFocusRef.current = now
      if (e.key === "Enter") {
        if (scanBuffer.length >= 3) addProductByCode(scanBuffer)
        setScanBuffer("")
        return
      }
      if (e.key.length === 1) setScanBuffer((b) => b + e.key)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanBuffer, productModal, preview, products])

  async function persistInvoice(navigateAfterSave = false, showWhatsAppPrompt = true) {
    if (savedInvoiceId) return savedInvoiceId
    if (!selectedCustomer || items.length === 0 || hasInvalidTotal) return null
    savingRef.current = true
    try {
      const response = await createMutation.mutateAsync({
      customerId: selectedCustomer.id,
      type: invoiceType,
      date,
      clientRequestId: clientRequestIdRef.current,
      couponCode: couponCode.trim() || undefined,
      discount,
      tax: 0,
      paidAmount: effectivePaid,
      paymentType: financials.paymentType,
      items: items.map((item) => ({
        productId: item.product.id,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        warehouseId: item.warehouseId,
      })),
    })
      const id = response.data?.id ?? null
      if (id) {
      // If customer paid more than the invoice total, create a receipt voucher for the difference
      if (overpayment > 0 && selectedCustomer) {
        try {
          await createReceipt({ customerId: selectedCustomer.id, amount: overpayment, type: "RECEIPT", date })
        } catch { /* receipt failure shouldn't block invoice */ }
      }
      setSavedInvoiceId(id)
      clearDraft()
      if (showWhatsAppPrompt && !isPurchase && selectedCustomer?.phone) setWhatsappPromptId(id)
      if (navigateAfterSave && !(!isPurchase && selectedCustomer?.phone)) navigate(`/invoices/${id}`)
      }
      return id
    } catch (error) {
      savingRef.current = false
      throw error
    }
  }

  async function saveAndCloseTab() {
    if (!closeTabId || closeTabId !== activeTid || closeSaving) return
    if (!selectedCustomer) {
      setCloseError(`اختر ${isPurchase ? "المورّد" : "الزبون"} قبل الحفظ.`)
      return
    }
    if (items.length === 0) {
      setCloseError("أضف مادة واحدة على الأقل قبل الحفظ.")
      return
    }
    if (hasInvalidTotal) {
      setCloseError("راجع الكميات والأسعار قبل الحفظ.")
      return
    }
    setCloseSaving(true)
    setCloseError("")
    const tid = closeTabId
    const destination = destinationAfterClose(tid)
    try {
      const id = await persistInvoice(false, false)
      if (!id) throw new Error("تعذر حفظ الفاتورة. راجع البيانات وحاول مرة ثانية.")
      setCloseTabId(null)
      navigate(destination)
    } catch (error) {
      setCloseError(error instanceof Error ? error.message : "تعذر حفظ الفاتورة.")
    } finally {
      setCloseSaving(false)
    }
  }

  function save() {
    void persistInvoice(true)
  }

  // Ctrl+S → save invoice from anywhere on this page
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        save()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [selectedCustomer, items, hasInvalidTotal, paidAmount, discount, couponCode, invoiceType])

  async function applyCouponCode() {
    if (!couponCode.trim() || subtotal <= 0) return
    try {
      const result = await applyCoupon(couponCode, subtotal)
      setDiscount(result?.discount ?? 0)
      setCouponMessage(result ? `تم تطبيق ${result.coupon.code}` : "")
    } catch (error) {
      setCouponMessage(error instanceof Error ? error.message : "تعذر تطبيق الكوبون")
    }
  }

  async function openExport(kind: "pdf" | "image") {
    const id = await persistInvoice()
    if (!id) return
    if (kind === "pdf") {
      // Navigate to invoice detail page and print from there (matches the beautiful web design)
      navigate(`/invoices/${id}`)
    } else {
      const url = await invoiceImageObjectUrl(id)
      window.open(url, "_blank", "noopener,noreferrer")
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    }
  }

  // ---- Switch invoice type ----
  function switchType() {
    const next = isPurchase ? "SALE" : "PURCHASE"
    setSearchParams({ type: next }, { replace: true })
    // Reset form
    setItems([])
    setSelectedCustomer(null)
    setCustomerQuery("")
    setDiscount(0)
    setPaidAmount(0)
    setSavedInvoiceId(null)
  }

  // ---- Type-specific styling ----
  const titleText = isPurchase ? "فاتورة شراء جديدة" : "فاتورة بيع جديدة"
  const TitleIcon = isPurchase ? ShoppingCart : Receipt
  const accentBg = isPurchase ? "from-amber-500 to-amber-600" : "from-emerald-500 to-emerald-600"
  const cardBorder = isPurchase ? "border-r-4 border-r-amber-400" : "border-r-4 border-r-emerald-400"
  const pageTint = isPurchase ? "bg-amber-50/30 dark:bg-amber-950/10" : "bg-emerald-50/30 dark:bg-emerald-950/10"
  const customerLabel = isPurchase ? "المورّد" : "الزبون"

  // ── Loading skeleton while data fetches ──────────────────────────────────
  const isInitialLoading = productsQuery.isLoading || customersQuery.isLoading
  if (isInitialLoading && products.length === 0 && customers.length === 0) {
    return (
      <div className={`space-y-4 rounded-xl p-1 ${pageTint}`}>
        <div className={`rounded-xl bg-gradient-to-l ${accentBg} p-5 text-white shadow-sm`}>
          <div className="flex items-center gap-3">
            <TitleIcon className="h-7 w-7 animate-pulse" />
            <div>
              <h1 className="text-xl font-bold">{titleText}</h1>
              <p className="mt-1 text-sm opacity-80 animate-pulse">جاري تحميل البيانات...</p>
            </div>
          </div>
        </div>
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={`space-y-4 rounded-xl p-1 ${pageTint}`}>
      {/* ── Tabs bar ─────────────────────────────────────────────────────────── */}
      {(tabs.length > 0 || activeTid) ? (
        <div className="flex items-center gap-1.5 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1.5 dark:border-slate-700 dark:bg-slate-900">
          {tabs.map((t) => {
            const isActive = t.id === activeTid
            const typeColor = t.type === "PURCHASE" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200"
            const activeRing = isActive ? "ring-2 ring-offset-1 ring-slate-400 dark:ring-slate-500" : ""
            return (
              <div
                key={t.id}
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium cursor-pointer transition ${typeColor} ${activeRing}`}
                onClick={() => !isActive && switchTab(t)}
              >
                <span>{t.type === "PURCHASE" ? "🛒" : "🧾"}</span>
                <span className="max-w-[90px] truncate">{t.label}</span>
                {t.subtotal > 0 ? <span className="opacity-60">{fmt(t.subtotal)}</span> : null}
                <button
                  type="button"
                  className="rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                  onClick={(e) => { e.stopPropagation(); requestCloseTab(t.id) }}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })}
          <div className="flex gap-1 mr-auto shrink-0">
            <button
              type="button"
              title="فاتورة بيع جديدة"
              className="rounded-md border border-dashed border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
              onClick={() => openNewTab("SALE")}
            >
              + بيع
            </button>
            <button
              type="button"
              title="فاتورة شراء جديدة"
              className="rounded-md border border-dashed border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
              onClick={() => openNewTab("PURCHASE")}
            >
              + شراء
            </button>
          </div>
        </div>
      ) : null}

      {/* AI Buttons Row — صوت + كاميرا */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 py-2">
        <VoiceInvoiceButton compact />
        {isPurchase ? (
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => setOcrOpen(true)}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100 active:scale-95 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
            title="قراءة فاتورة بالكاميرا"
          >
            <Camera className="h-4 w-4" />
            قراءة صورة
          </button>
          <p className="hidden text-xs text-slate-400 text-center">
            مسح فاتورة ورقية
          </p>
        </div>
        ) : null}
      </div>

      {/* OCR Dialog */}
      {ocrOpen && (
        <Dialog open={ocrOpen} onOpenChange={setOcrOpen}>
          <DialogContent className="max-w-2xl">
            <OcrInvoiceScanner
              onItemsReady={addOcrItems}
              onSupplierDetected={handleOcrSupplierDetected}
              onClose={() => setOcrOpen(false)}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Header banner */}
      <div className={`rounded-xl bg-gradient-to-l ${accentBg} p-5 text-white shadow-sm`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <TitleIcon className="h-7 w-7" />
            <div>
              <h1 className="text-xl font-bold">{titleText}</h1>
              <p className="text-sm opacity-90">
                {isPurchase
                  ? "ستضاف الكمية إلى المخزون، وسيُسجَّل ما تبقى كمستحقّ للمورّد."
                  : "ستُخصم الكمية من المخزون، وسيُسجَّل ما تبقى كدَين على الزبون."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={switchType}
              className="rounded-lg border border-white/40 bg-white/20 px-3 py-1.5 text-sm font-medium text-white backdrop-blur hover:bg-white/30"
            >
              {isPurchase ? "↔ فاتورة بيع" : "↔ فاتورة شراء"}
            </button>
            <div className="flex items-center gap-1 text-xs opacity-90">
              <ScanLine className="h-4 w-4" />
              <span>باركود مفعّل</span>
            </div>
          </div>
        </div>
      </div>

      {lastSavedAt && !savedInvoiceId ? (
        <div className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
          حُفظ تلقائياً في {new Date(lastSavedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
        </div>
      ) : null}

      {/* Invoice header */}
      <Card className={cn(cardBorder, "border-sky-200 bg-sky-50/80 dark:border-sky-900 dark:bg-sky-950/25")}>
        <CardHeader><CardTitle>رأس الفاتورة</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="relative">
            <Input
              ref={customerInputRef}
              placeholder={`اختيار ${customerLabel}`}
              value={customerQuery}
              onChange={(event) => {
                setCustomerQuery(event.target.value)
                setCustomerHighlight(0)
                setSelectedCustomer(null)
                setCustomerListOpen(true)
              }}
              onFocus={() => { if (customerQuery && !selectedCustomer) setCustomerListOpen(true) }}
              onBlur={() => window.setTimeout(() => setCustomerListOpen(false), 150)}
              onKeyDown={handleCustomerKey}
            />
            {customerListOpen && !selectedCustomer && customerQuery ? (
              <div className="absolute z-20 mt-1 w-full rounded-md border bg-white p-1 shadow dark:border-slate-700 dark:bg-slate-950">
                {customerSuggestions.map((customer, idx) => (
                  <button
                    key={customer.id}
                    type="button"
                    className={`block w-full rounded px-2 py-2 text-right text-sm ${idx === customerHighlight ? "bg-amber-100 dark:bg-amber-900/40" : "hover:bg-slate-100 dark:hover:bg-slate-900"}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickCustomer(customer)}
                    onMouseEnter={() => setCustomerHighlight(idx)}
                  >
                    <span>{customer.name} — {customer.phone}</span>
                  {customer.isSupplier && (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">مورد</span>
                  )}
                  </button>
                ))}
                {customerSuggestions.length === 0 && (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-right text-sm text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={openQuickAddCustomer}
                  >
                    <Plus className="h-4 w-4" />
                    أضف "{customerQuery.trim()}" كـ{customerLabel} جديد
                  </button>
                )}
              </div>
            ) : null}
          </div>
          {!isPurchase && !selectedCustomer && (
            <button
              type="button"
              disabled={walkInLoading}
              onClick={async () => {
                setWalkInLoading(true)
                try {
                  const c = await getWalkInCustomer()
                  if (c) { setSelectedCustomer(c); setCustomerQuery(c.name) }
                } catch { /* ignore */ }
                setWalkInLoading(false)
              }}
              className="h-10 rounded-md border border-amber-200 bg-amber-50 px-3 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
            >
              {walkInLoading ? "..." : "⚡ الزبون النقدي"}
            </button>
          )}
          {isPurchase || selectedCustomer ? (
            <div className="rounded-md border bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-900 dark:border-slate-700">
              تاريخ الفاتورة يثبت تلقائياً عند الحفظ
            </div>
          ) : null}
          <select
            className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            value={paymentMode}
            onChange={(e) => {
              const mode = e.target.value as PaymentMode
              setPaymentMode(mode)
              if (mode === "CASH") setPaidAmount(total)
              else setPaidAmount(0)
            }}
          >
            <option value="CREDIT">آجل</option>
            <option value="CASH">نقد</option>
          </select>
        </CardContent>
      </Card>

      {/* Items table */}
      <Card className={cn(cardBorder, "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20")}>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>الأصناف</CardTitle>
            <div className="flex gap-2">
              {!isPurchase && (
                <Button
                  variant="outline"
                  size="sm"
                  className={useRetailPrice ? "border-orange-400 bg-orange-50 text-orange-700 dark:border-orange-600 dark:bg-orange-950/30 dark:text-orange-400" : ""}
                  onClick={() => setUseRetailPrice((v) => !v)}
                  title="تبديل بين سعر الجملة وسعر المفرد"
                >
                  {useRetailPrice ? "مفرد" : "جملة"}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setShowPurchase((v) => !v)}>سعر الشراء</Button>
              <Button variant="outline" size="sm" onClick={() => setShowStock((v) => !v)}>الكمية</Button>
              <Button size="sm" onClick={() => { setProductModal(true); window.setTimeout(() => productSearchRef.current?.focus(), 50) }}>
                <Plus className="h-4 w-4" /> أضف صنف
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>المادة</TH>
                  <TH>المخزن</TH>
                  <TH>الوحدة</TH>
                  <TH>العدد</TH>
                  {!hidePrice && <TH>سعر المفرد</TH>}
                  {!hidePrice && <TH>الإجمالي</TH>}
                  <TH>حذف</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((item, index) => {
                  const rowKey = `${index}`
                  const stockAfterLine = isPurchase ? stockOf(item.product) + itemQuantityInPieces(item) : stockOf(item.product) - itemQuantityInPieces(item)
                  const hasNegativeStock = stockOf(item.product) < 0 || stockAfterLine < 0
                  return (
                    <TR key={index}>
                      <TD>
                        <div className="flex items-center gap-2 min-w-[140px]">
                          <ProductThumb product={item.product} />
                          <span className="font-medium">{item.product.name}</span>
                          {hasNegativeStock ? (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                              رصيد سالب
                            </span>
                          ) : null}
                          {belowCostItems.has(index) ? (
                            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                              ⚠ أقل من التكلفة
                            </span>
                          ) : null}
                        </div>
                        {showPurchase ? <div className="text-xs text-slate-500">شراء: {fmt(item.product.purchasePrice)}</div> : null}
                        {showStock ? <div className="text-xs text-slate-500">متوفر: {stockOf(item.product)}</div> : null}
                      </TD>
                      <TD>
                        {/* warehouse selector — shown only when product has stocks in multiple warehouses */}
                        {(item.product.warehouseStocks ?? []).length > 1 ? (
                          <select
                            className="h-9 w-32 rounded-md border bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                            value={item.warehouseId ?? ""}
                            onChange={(e) => updateItem(index, { warehouseId: e.target.value || undefined })}
                          >
                            <option value="">— اختر —</option>
                            {(item.product.warehouseStocks ?? []).map((ws) => (
                              <option key={ws.warehouseId} value={ws.warehouseId}>
                                {ws.warehouse.name} ({ws.quantityPieces}ق)
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-slate-500">
                            {(item.product.warehouseStocks ?? [])[0]?.warehouse.name ?? "—"}
                          </span>
                        )}
                      </TD>
                      <TD>
                        <select
                          className="h-9 w-24 rounded-md border bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                          value={item.unit}
                          onChange={(event) => updateItem(index, { unit: event.target.value as Unit })}
                          onKeyDown={(e) => handleRowKey(e, rowKey, "unit")}
                        >
                          <option value="PIECE">قطعة</option>
                          <option value="DOZEN">درزن</option>
                          <option value="CARTON">كرتونة</option>
                        </select>
                      </TD>
                      <TD>
                        <Input
                          ref={(el) => { quantityRefs.current[rowKey] = el }}
                          type="number"
                          className="w-20"
                          value={item.quantity}
                          onFocus={selectAllOnFocus}
                          onChange={(event) => updateItem(index, { quantity: Number(event.target.value) })}
                          onKeyDown={(e) => handleRowKey(e, rowKey, "qty")}
                        />
                      </TD>
                      {!hidePrice && (
                        <TD>
                          <Input
                            ref={(el) => { priceRefs.current[rowKey] = el }}
                            type="number"
                            className="w-24"
                            value={item.unitPrice}
                            onFocus={selectAllOnFocus}
                            onChange={(event) => updateItem(index, { unitPrice: Number(event.target.value) })}
                            onKeyDown={(e) => handleRowKey(e, rowKey, "price")}
                          />
                        </TD>
                      )}
                      {!hidePrice && (
                        <TD>
                          <Input
                            ref={(el) => { totalRefs.current[rowKey] = el }}
                            type="number"
                            className="w-28 font-semibold"
                            value={Math.round(item.quantity * item.unitPrice * 1000) / 1000}
                            onFocus={selectAllOnFocus}
                            onChange={(e) => updateItemTotal(index, Number(e.target.value))}
                            onKeyDown={(e) => handleRowKey(e, rowKey, "total")}
                          />
                        </TD>
                      )}
                      <TD>
                        <Button variant="ghost" size="sm" onClick={() => removeItem(index)}>
                          <Trash2 className="h-4 w-4 text-rose-500" />
                        </Button>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </div>
          {items.length === 0 ? (
            <div className="mt-3 rounded-md border border-dashed p-6 text-center text-sm text-slate-500 dark:border-slate-700">
              لا يوجد أصناف. اضغط "أضف صنف" أو امسح الباركود مباشرة.
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Financial summary — always BELOW items */}
      <Card className={cn(cardBorder, "border-amber-200 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/20")}>
        <CardHeader><CardTitle>الملخص المالي</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-2">
            {/* Left: amounts */}
            <div className="space-y-3">
              <SummaryRow label="المجموع" value={subtotal} />
              {!isPurchase ? (
                <div>
                  <label className="mb-1 block text-xs text-slate-500">كود الكوبون</label>
                  <div className="flex gap-2">
                    <Input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="EID2026" />
                    <Button type="button" variant="outline" onClick={() => void applyCouponCode()}>تطبيق</Button>
                  </div>
                  {couponMessage ? <p className="mt-1 text-xs text-slate-500">{couponMessage}</p> : null}
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-500">الخصم</label>
                  <Input type="number" value={discount} onFocus={selectAllOnFocus} onChange={(e) => setDiscount(Number(e.target.value))} />
                </div>
              </div>
              <SummaryRow label="الإجمالي" value={total} strong />
            </div>
            {/* Right: balance */}
            <div className="space-y-3">
              <SummaryRow label={isPurchase ? "الرصيد السابق (للمورّد)" : "الحساب السابق"} value={previousBalance} />
              <div>
                <label className="mb-1 block text-xs text-slate-500">{isPurchase ? "المبلغ المدفوع للمورّد" : "المبلغ الواصل"}</label>
                <Input
                  ref={paidInputRef}
                  inputMode="numeric"
                  dir="ltr"
                  value={paidAmount === 0 ? "" : paidAmount.toLocaleString("en-US")}
                  placeholder="0"
                  onFocus={selectAllOnFocus}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, "")
                    setPaidAmount(raw ? Number(raw) : 0)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      setProductModal(true)
                      window.setTimeout(() => productSearchRef.current?.focus(), 50)
                    }
                  }}
                />
              </div>
              <SummaryRow label={isPurchase ? "المتبقي للمورّد" : "المبلغ الباقي"} value={remaining} />
              {overpayment > 0 ? (
                <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                  زيادة {fmt(overpayment)} — سيُنشأ سند قبض تلقائياً
                </div>
              ) : null}
              <SummaryRow label="الحساب النهائي" value={finalBalance} strong />
            </div>
          </div>

          {/* Actions */}
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
            <Button onClick={() => setPreview(true)}>معاينة</Button>
            <Button variant="outline" onClick={save} disabled={!selectedCustomer || items.length === 0 || hasInvalidTotal || createMutation.isPending}>
              حفظ
            </Button>
            <Button variant="outline" onClick={() => void openExport("pdf")} disabled={!selectedCustomer || items.length === 0 || hasInvalidTotal || createMutation.isPending}>
              <Download className="h-4 w-4" /> PDF
            </Button>
            <Button variant="outline" onClick={() => void openExport("image")} disabled={!selectedCustomer || items.length === 0 || hasInvalidTotal || createMutation.isPending}>
              <ImageDown className="h-4 w-4" /> صورة
            </Button>
          </div>

          {hasBelowCost ? (
            <div className="mt-2 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
              <div className="mb-1 flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" /> تحذير: بيع تحت سعر الشراء
              </div>
              <div className="text-xs">{belowCostItems.size} مادة بسعر أقل من التكلفة — ستخسر على هذه العملية.</div>
            </div>
          ) : null}
          {lowStockWarnings.length > 0 ? (
            <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <div className="mb-1 flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" /> تحذير: مخزون سيصبح سالب
              </div>
              {lowStockWarnings.map((w, i) => <div key={i} className="text-xs">• {w}</div>)}
              <div className="mt-1 text-xs opacity-75">الفاتورة ستُحفظ وسيظهر الرصيد سالباً بالمخزون.</div>
            </div>
          ) : null}
          {hasInvalidTotal ? (
            <div className="mt-2 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">
              الخصم أكبر من مجموع الفاتورة.
            </div>
          ) : null}
          {createMutation.isError ? (
            <div className="mt-2 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">
              ⚠ {extractErrorMessage(createMutation.error)}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <input ref={scanInputRef} className="sr-only" aria-hidden tabIndex={-1} />

      {/* Product picker modal */}
      <Dialog open={productModal} onOpenChange={setProductModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>اختيار صنف</DialogTitle></DialogHeader>
          <Input
            ref={productSearchRef}
            placeholder="بحث بالاسم أو رقم الصنف أو الباركود"
            value={productQuery}
            onChange={(event) => { setProductQuery(event.target.value); setProductHighlight(0) }}
            onKeyDown={handleProductSearchKey}
          />
          <div ref={productListRef} className="max-h-80 overflow-auto">
            {productSuggestions.map((product, idx) => (
              <button
                key={`${product.id}-${idx}`}
                ref={(el) => { productItemRefs.current[idx] = el }}
                type="button"
                className={`flex w-full items-center justify-between gap-3 border-b p-3 text-right text-sm ${idx === productHighlight ? "bg-amber-100 dark:bg-amber-900/40" : "hover:bg-slate-100 dark:hover:bg-slate-900"} dark:border-slate-800`}
                onMouseEnter={() => setProductHighlight(idx)}
                onClick={() => addProduct(product)}
              >
                <span className="flex items-center gap-2 font-medium"><ProductThumb product={product} />{product.name}</span>
                <span className="text-slate-500">{product.itemNumber}</span>
              </button>
            ))}
            {productSuggestions.length === 0 ? (
              <div className="space-y-3 p-4 text-center text-sm text-slate-500">
                <div>{productQuery.trim() ? "لا توجد مادة بهذا الاسم" : "اكتب اسم المادة للبحث"}</div>
                {productQuery.trim() ? (
                  <Button
                    type="button"
                    className="mx-auto"
                    onClick={quickCreateProduct}
                    disabled={createProductMutation.isPending}
                  >
                    <Plus className="h-4 w-4" /> {createProductMutation.isPending ? "جار الإضافة..." : "إضافة مادة جديدة"}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {/* Full customer-add modal */}
      <Dialog open={quickAddCustomerOpen} onOpenChange={setQuickAddCustomerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>إضافة {customerLabel} جديد</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="mb-1 block text-sm font-medium">الاسم *</label>
                <Input
                  autoFocus
                  value={quickAddCustomerName}
                  onChange={(e) => setQuickAddCustomerName(e.target.value)}
                  placeholder="اسم الزبون أو المورد"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">رقم الهاتف</label>
                <Input
                  value={quickAddCustomerPhone}
                  onChange={(e) => setQuickAddCustomerPhone(e.target.value)}
                  placeholder="07xxxxxxxxx"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">الرصيد الافتتاحي</label>
                <Input
                  type="number"
                  min="0"
                  value={quickAddCustomerBalance}
                  onChange={(e) => setQuickAddCustomerBalance(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">العنوان</label>
                <Input
                  value={quickAddCustomerAddress}
                  onChange={(e) => setQuickAddCustomerAddress(e.target.value)}
                  placeholder="العنوان (اختياري)"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">سقف الائتمان</label>
                <Input
                  type="number"
                  min="0"
                  value={quickAddCustomerCreditLimit}
                  onChange={(e) => setQuickAddCustomerCreditLimit(e.target.value)}
                  placeholder="بدون سقف"
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-sm font-medium">ملاحظات</label>
                <Input
                  value={quickAddCustomerNotes}
                  onChange={(e) => setQuickAddCustomerNotes(e.target.value)}
                  placeholder="ملاحظات إضافية (اختياري)"
                />
              </div>
              {/* Customer / Supplier toggle */}
              <div className="col-span-2">
                <label className="mb-1 block text-sm font-medium">النوع</label>
                <div className="flex gap-2">
                  {([
                    { label: "زبون", value: false },
                    { label: "مورد", value: true },
                  ] as const).map(({ label, value }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setQuickAddCustomerIsSupplier(value)}
                      className={`flex-1 rounded-lg border-2 py-2 text-sm font-semibold transition ${quickAddCustomerIsSupplier === value ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                className="flex-1"
                onClick={submitQuickAddCustomer}
                disabled={!quickAddCustomerName.trim() || createCustomerMutation.isPending}
              >
                {createCustomerMutation.isPending ? "جار الإضافة..." : "إضافة وتحديد"}
              </Button>
              <Button variant="outline" onClick={() => setQuickAddCustomerOpen(false)}>إلغاء</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Product-add modal — full inventory page in new tab */}
      <Dialog open={quickAddProductOpen} onOpenChange={setQuickAddProductOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>إضافة مادة جديدة</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              لإضافة مادة بكل تفاصيلها (الباركود، الفئة، الكارتون، المخزون...) افتح صفحة المخزن في تبويب جديد، أضف المادة، ثم ارجع هنا وابحث عنها.
            </p>
            <a
              href="/inventory"
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 active:scale-95 transition"
              onClick={() => setQuickAddProductOpen(false)}
            >
              فتح صفحة المخزن الكاملة ↗
            </a>
            <div className="relative flex items-center gap-2">
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
              <span className="text-xs text-slate-400">أو إضافة سريعة</span>
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">اسم المادة *</label>
              <Input
                autoFocus
                value={quickAddProductName}
                onChange={(e) => setQuickAddProductName(e.target.value)}
                placeholder="اسم المادة"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-sm font-medium">سعر البيع</label>
                <Input
                  type="number"
                  min="0"
                  value={quickAddProductSalePrice}
                  onChange={(e) => setQuickAddProductSalePrice(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">سعر الشراء</label>
                <Input
                  type="number"
                  min="0"
                  value={quickAddProductPurchasePrice}
                  onChange={(e) => setQuickAddProductPurchasePrice(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={submitQuickAddProduct}
                disabled={!quickAddProductName.trim() || createProductMutation.isPending}
              >
                {createProductMutation.isPending ? "جار الإضافة..." : "إضافة سريعة وإدراج"}
              </Button>
              <Button variant="outline" onClick={() => setQuickAddProductOpen(false)}>إلغاء</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>معاينة الفاتورة</DialogTitle></DialogHeader>
          <div className={`rounded-xl border p-5 dark:border-slate-800 ${isPurchase ? "border-amber-300" : "border-emerald-300"}`}>
            <div className="mb-4 flex justify-between">
              <div>
                <div className="text-xl font-bold">مخزوني</div>
                <div className="text-sm text-slate-500">{titleText}</div>
              </div>
              <div className="text-left text-sm">
                <div>رقم: تلقائي</div>
                <div>التاريخ: {date}</div>
              </div>
            </div>
            <div className="mb-4 text-sm">{customerLabel}: <span className="font-semibold">{selectedCustomer?.name ?? "—"}</span></div>
            <Table>
              <THead><TR><TH>المادة</TH><TH>العدد</TH><TH>السعر</TH><TH>الإجمالي</TH></TR></THead>
              <TBody>
                {items.map((item, i) => (
                  <TR key={i}>
                    <TD>{item.product.name}</TD>
                    <TD>{item.quantity}</TD>
                    <TD>{fmt(item.unitPrice)}</TD>
                    <TD>{fmt(item.quantity * item.unitPrice)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <div className="mt-4 space-y-1 text-sm">
              {discount > 0 ? <div className="flex justify-between"><span className="text-slate-500">الخصم</span><span>{fmt(discount)}</span></div> : null}
              <div className="flex justify-between text-base font-bold"><span>الإجمالي</span><span>{fmt(total)}</span></div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={hasInvalidTotal || createMutation.isPending}>حفظ وانتقل للفاتورة</Button>
            <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" /> طباعة</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Unsaved changes blocker dialog ───────────────────────────────── */}
      <UnsavedChangesDialog
        blocker={blocker}
        onSave={async () => {
          if (!selectedCustomer || items.length === 0 || hasInvalidTotal) {
            throw new Error("أكمل اسم الزبون والمواد والأسعار حتى يمكن حفظ الفاتورة.")
          }
          const id = await persistInvoice(false, false)
          if (!id) throw new Error("تعذر حفظ الفاتورة.")
        }}
        message="لديك أصناف في الفاتورة لم تُحفظ. إذا غادرت الصفحة ستُفقد هذه البيانات."
      />

      <Dialog open={!!closeTabId} onOpenChange={(open) => { if (!open && !closeSaving) { setCloseTabId(null); setCloseError("") } }}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <DialogTitle className="text-lg">إغلاق الفاتورة؟</DialogTitle>
          </DialogHeader>
          <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
            الحفظ والخروج يثبت الفاتورة في النظام، أما الخروج دون حفظ فيحذف هذه المسودة.
          </p>
          {closeError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{closeError}</p> : null}
          <div className="mt-4 flex flex-col gap-2">
            <Button className="w-full bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => void saveAndCloseTab()} disabled={closeSaving || closeTabId !== activeTid}>
              {closeSaving ? "جاري الحفظ..." : "حفظ وخروج"}
            </Button>
            <Button variant="outline" className="w-full border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-400" onClick={discardAndCloseTab} disabled={closeSaving}>
              خروج دون حفظ
            </Button>
            <Button variant="outline" className="w-full" onClick={() => { setCloseTabId(null); setCloseError("") }} disabled={closeSaving}>
              البقاء
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* WhatsApp send prompt */}
      <Dialog open={!!whatsappPromptId} onOpenChange={(open) => { if (!open && !whatsappSending) { navigate(`/invoices/${whatsappPromptId}`); setWhatsappPromptId(null) } }}>
        <DialogContent className="max-w-sm text-center">
          <DialogHeader>
            <DialogTitle className="text-xl">إرسال واتساب؟</DialogTitle>
          </DialogHeader>
          <p className="text-slate-500 text-sm mb-4">تريد ترسل الفاتورة للزبون على واتساب؟</p>
          <div className="flex gap-3 justify-center">
            <Button
              disabled={whatsappSending}
              onClick={async () => {
                if (!whatsappPromptId) return
                setWhatsappSending(true)
                try { await sendWhatsAppInvoice(whatsappPromptId) } catch { /* ignore */ }
                setWhatsappSending(false)
                setWhatsappPromptId(null)
                navigate(`/invoices/${whatsappPromptId}`)
              }}
            >
              {whatsappSending ? "جاري الإرسال..." : "نعم، أرسل"}
            </Button>
            <Button variant="outline" disabled={whatsappSending} onClick={() => { navigate(`/invoices/${whatsappPromptId}`); setWhatsappPromptId(null) }}>
              لا شكراً
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SummaryRow({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md px-2 py-1">
      <span className="text-sm text-slate-500">{label}</span>
      <span className={strong ? "text-lg font-bold" : "font-medium"}>{fmt(value)}</span>
    </div>
  )
}
