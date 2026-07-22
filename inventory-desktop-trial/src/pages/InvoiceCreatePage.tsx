import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { usePageTitle } from "../hooks/usePageTitle"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useSearchParams } from "react-router-dom"
import { AlertTriangle, Camera, Download, ImageDown, Plus, Printer, Receipt, ScanLine, ShoppingCart, Trash2, Users, X } from "lucide-react"
import { WorkerSendModal } from "../components/WorkerSendModal"
import { fmt } from "../utils/fmt"
import { listTabs, upsertTab, removeTab, newTabId, tabDataKey, type DraftTabMeta } from "../utils/draftTabs"
import { applyCoupon, completeOrderPreparation, createReceipt, getLastSoldPrice, getLastSoldPriceOverall, getOrderPreparations, getWalkInCustomer, invoiceImageObjectUrl, sendWhatsAppInvoice, downloadInvoicePdfBlob, updateInvoice, type LastSoldPrice, type LastSoldPriceOverall } from "../api/endpoints"
import { WhatsAppChannelDialog } from "../components/WhatsAppChannelDialog"
import { fillTemplate } from "../utils/whatsapp"
import { useSettings } from "../hooks/useSettings"
import { downloadBlobUrl } from "../utils/download"
import { useCustomers } from "../hooks/useCustomers"
import { useCreateInvoice, useInvoice } from "../hooks/useInvoices"
import { useProducts } from "../hooks/useProducts"
import { useAuthStore } from "../store/authStore"
import { useUiStore } from "../store/uiStore"
import { useUnsavedWarning } from "../hooks/useUnsavedWarning"
import { READ_ONLY_MESSAGE, useReadOnly } from "../hooks/useTenantConfig"
import type { Customer, InvoiceItem, Product } from "../types/api"
import { Button } from "../components/ui/button"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { Input } from "../components/ui/input"
import { NumericInput } from "../components/ui/NumericInput"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import { UnsavedChangesDialog } from "../components/ui/UnsavedChangesDialog"
import { toast } from "../components/ui/use-toast"
import { ToastAction } from "../components/ui/toast"
import { referenceUnitPrice, priceLooksSuspicious } from "../utils/priceGuard"
import { localDateStr } from "../utils/date"
import { cn } from "../utils/cn"
import { VoiceInvoiceButton } from "../components/voice/VoiceInvoiceButton"
import { OcrInvoiceScanner, type OcrReadyItem } from "../components/ocr/OcrInvoiceScanner"
import { calculateInvoiceFinancials } from "../utils/financial"
import { findProductByScan } from "../utils/barcode-scan"
import { sortProductsByRelevance, sortCustomersByRelevance } from "../utils/search"
import { apiErrorMessage } from "../utils/apiError"
import { CameraScanModal } from "../components/CameraScanModal"
import { UNIT_LABELS, piecesPerUnit, unitToPieces, visibleUnits } from "../utils/units"

type Unit = "PIECE" | "DOZEN" | "BOX" | "CARTON"
type PaymentMode = "CREDIT" | "CASH"
type InvoiceType = "SALE" | "PURCHASE"

// Read a barcode character from the PHYSICAL key (e.code), not e.key — so a
// scanner works the same whether the keyboard is set to Arabic or English.
// (e.key returns Arabic letters / Arabic-Indic digits under an Arabic layout.)
function scanCharFromCode(e: globalThis.KeyboardEvent): string | null {
  const code = e.code
  if (code.startsWith("Digit")) return code.slice(5)          // Digit7 → "7"
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6)         // Numpad7 → "7"
  if (code.startsWith("Key")) return code.slice(3).toLowerCase() // KeyA → "a"
  if (code === "Minus" || code === "NumpadSubtract") return "-"
  // Fallback for layouts that don't report e.code: accept a clean ASCII char.
  if (e.key.length === 1 && /[a-zA-Z0-9-]/.test(e.key)) return e.key.toLowerCase()
  return null
}

interface DraftItem {
  product: Product
  unit: Unit
  quantity: number
  unitPrice: number
  warehouseId?: string
  warehouseName?: string  // display name when pulling from a non-default warehouse
  allowNegativeStock?: boolean  // seller chose to sell while out of stock (records a deficit)
  notes?: string
}

function stockOf(product: Product) {
  return product.currentStock ?? product.openingBalancePcs + product.cartonsAvailable * product.pcsPerCarton
}

// Pieces available in the exact warehouse the backend will deduct this sale line from
// (the chosen warehouse, else المحل). Used to detect an out-of-stock sale.
function effectiveAvailablePcs(item: DraftItem): number {
  const stocks = item.product.warehouseStocks ?? []
  if (!stocks.length) return stockOf(item.product)
  if (item.warehouseId) return stocks.find((ws) => ws.warehouseId === item.warehouseId)?.quantityPieces ?? 0
  return item.product.shopStock ?? stocks.find((ws) => ws.warehouse.name.includes("محل"))?.quantityPieces ?? 0
}

// The walk-in (الزبون النقدي) customer carries a sentinel phone of all zeros.
// A "real" phone is non-empty and not the placeholder, so we never offer to
// send a WhatsApp invoice to a walk-in.
// Same wording as the Meta invoice template (and InvoiceDetailPage) — the
// wa.me web channel can't attach the PDF, so the text must carry the numbers.
const DEFAULT_INVOICE_TEMPLATE =
  "مرحبا {{customerName}} تم اصدار فاتورة بيع رقم {{invoiceNumber}}\nبتاريخ {{date}}\nمبلغ الفاتورة {{total}} {{currency}}\nالمبلغ الواصل {{paid}} {{currency}}\nالمتبقي من الفاتورة {{remaining}} {{currency}}\nحسابك السابق قبل الفاتورة {{previousBalance}} {{currency}}\nالحساب النهائي {{finalBalance}} {{currency}}\nشكرا لتسوق من {{storeName}}\nنتمنى لك الرزق الوفير والكثير"

function hasRealPhone(phone?: string | null): boolean {
  if (!phone) return false
  const digits = phone.replace(/\D/g, "")
  return digits.length > 0 && !/^0+$/.test(digits)
}

// The shared walk-in (الزبون النقدي) account: its all-zero phone is the sentinel.
// Change for a walk-in is handed back physically at the counter, so it must NOT
// be recorded as a receipt voucher — that would drift the account negative.
function isWalkInCustomer(phone?: string | null): boolean {
  if (!phone) return false
  const digits = phone.replace(/\D/g, "")
  return digits.length > 0 && /^0+$/.test(digits)
}

function itemQuantityInPieces(item: DraftItem) {
  return unitToPieces(item.unit, item.quantity, item.product)
}

// Quick quantity-fill amount, expressed in the line's CURRENT unit. Restricted to
// PIECE lines only: for any other unit (e.g. CARTON) "+half a carton" would need a
// fractional quantity, which the quantity field (decimal={false}) can't hold.
function quickQtyIncrement(item: DraftItem, kind: "carton" | "halfCarton" | "dozen"): number | null {
  if (item.unit !== "PIECE") return null
  const cartonPieces = item.product.pcsPerCarton
  if (kind === "carton") return cartonPieces
  if (kind === "halfCarton") return cartonPieces % 2 === 0 ? cartonPieces / 2 : null
  return 12
}

function ProductThumb({ product }: { product: Product }) {
  const src = product.thumbnailUrl || product.imageUrl
  if (src) {
    return <img src={src} alt={product.name} loading="lazy" decoding="async" className="h-7 w-7 shrink-0 rounded-md object-cover ring-1 ring-slate-200" />
  }
  return <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-slate-100 text-[9px] font-bold text-slate-500 ring-1 ring-slate-200">{product.itemNumber.slice(0, 3)}</div>
}

// Right-click on a line's product name → quick reference (last price for this
// customer / overall, per-warehouse stock, cost) + quick actions. SALE only for
// the price-history section: "last SALE price" has no meaning on a purchase line,
// and a supplier (also stored as a Customer) has no purchase-price history here.
function InvoiceLineContextMenu({
  item,
  index,
  x,
  y,
  isPurchase,
  canViewPurchasePrice,
  customerId,
  onClose,
  onUpdateItem,
  onDuplicateItem,
  onRemoveItem,
}: {
  item: DraftItem
  index: number
  x: number
  y: number
  isPurchase: boolean
  canViewPurchasePrice: boolean
  customerId?: string
  onClose: () => void
  onUpdateItem: (index: number, patch: Partial<DraftItem>) => void
  onDuplicateItem: (index: number) => void
  onRemoveItem: (index: number) => void
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [forCustomer, setForCustomer] = useState<{ loading: boolean; data: LastSoldPrice | null }>({ loading: Boolean(customerId), data: null })
  const [overall, setOverall] = useState<{ loading: boolean; data: LastSoldPriceOverall | null }>({ loading: true, data: null })

  useEffect(() => {
    let cancelled = false
    if (!isPurchase && customerId) {
      setForCustomer({ loading: true, data: null })
      getLastSoldPrice(customerId, item.product.id)
        .then((data) => { if (!cancelled) setForCustomer({ loading: false, data }) })
        .catch(() => { if (!cancelled) setForCustomer({ loading: false, data: null }) })
    } else {
      setForCustomer({ loading: false, data: null })
    }
    if (!isPurchase) {
      setOverall({ loading: true, data: null })
      getLastSoldPriceOverall(item.product.id)
        .then((data) => { if (!cancelled) setOverall({ loading: false, data }) })
        .catch(() => { if (!cancelled) setOverall({ loading: false, data: null }) })
    } else {
      setOverall({ loading: false, data: null })
    }
    return () => { cancelled = true }
  }, [isPurchase, customerId, item.product.id])

  // Close on outside click, Escape, or scroll — a stale floating menu pointing at
  // the wrong row after the table scrolls is worse than no menu at all.
  useEffect(() => {
    function handlePointer(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("mousedown", handlePointer)
    document.addEventListener("keydown", handleKey)
    window.addEventListener("scroll", onClose, true)
    return () => {
      document.removeEventListener("mousedown", handlePointer)
      document.removeEventListener("keydown", handleKey)
      window.removeEventListener("scroll", onClose, true)
    }
  }, [onClose])

  // Clamp so a right-click near the window edge doesn't render the menu off-screen.
  const MENU_WIDTH = 280
  const MENU_MAX_HEIGHT = 420
  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8))
  const top = Math.max(8, Math.min(y, window.innerHeight - MENU_MAX_HEIGHT - 8))

  // Exclude whichever warehouse this line is CURRENTLY sourced from — item.warehouseId
  // when explicitly set, otherwise المحل (the default for every sale line that hasn't
  // been redirected). Comparing against item.warehouseId alone would, for the common
  // undefined-means-shop case, wrongly list المحل itself as a "transfer from" target.
  const currentWarehouseId = item.warehouseId
    ?? item.product.warehouseStocks?.find((ws) => ws.warehouse.name.includes("محل"))?.warehouseId
  const otherWarehouses = (item.product.warehouseStocks ?? []).filter((ws) => ws.warehouseId !== currentWarehouseId)
  const units = visibleUnits(item.product)
  const lastForCustomer = forCustomer.data

  function applyLastDeal(deal: LastSoldPrice) {
    onUpdateItem(index, { unit: deal.unit as Unit, quantity: deal.quantity, unitPrice: deal.unitPrice })
    onClose()
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-[80] max-h-[420px] w-[280px] overflow-y-auto rounded-lg border bg-white p-1.5 text-sm shadow-xl dark:border-slate-700 dark:bg-slate-900"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="border-b px-2 pb-1.5 pt-1 text-xs font-bold text-slate-700 dark:border-slate-800 dark:text-slate-200">
        {item.product.name}
      </div>

      {!isPurchase && (
        <div className="space-y-1 border-b px-2 py-1.5 text-[11px] text-slate-600 dark:border-slate-800 dark:text-slate-300">
          <div>
            <span className="font-semibold">آخر سعر لهذا الزبون: </span>
            {!customerId
              ? "اختر الزبون أولاً"
              : forCustomer.loading
                ? "..."
                : lastForCustomer
                  ? `${fmt(lastForCustomer.unitPrice)} / ${UNIT_LABELS[lastForCustomer.unit as Unit]} — بتاريخ ${lastForCustomer.date.slice(0, 10)} (الكمية يومها: ${lastForCustomer.quantity})`
                  : "ماكو بيع سابق"}
          </div>
          <div>
            <span className="font-semibold">آخر سعر بيع عام: </span>
            {overall.loading
              ? "..."
              : overall.data
                ? `${fmt(overall.data.unitPrice)} / ${UNIT_LABELS[overall.data.unit as Unit]} — لـ ${overall.data.customerName ?? "زبون"} بتاريخ ${overall.data.date.slice(0, 10)}`
                : "ماكو بيع سابق لهذه المادة"}
          </div>
        </div>
      )}

      {(item.product.warehouseStocks?.length ?? 0) > 0 && (
        <div className="border-b px-2 py-1.5 dark:border-slate-800">
          <div className="mb-1 text-[11px] font-semibold text-slate-500">المخزون بكل مخزن</div>
          <div className="flex flex-wrap gap-1">
            {item.product.warehouseStocks!.map((ws) => (
              <span key={ws.warehouseId} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {ws.warehouse.name}: {ws.quantityPieces}
              </span>
            ))}
          </div>
        </div>
      )}

      {canViewPurchasePrice && (
        <div className="border-b px-2 py-1.5 text-[11px] text-slate-600 dark:border-slate-800 dark:text-slate-300">
          <span className="font-semibold">سعر الكلفة الحالي: </span>
          {fmt(item.product.costPrice && item.product.costPrice > 0 ? item.product.costPrice : item.product.purchasePrice)}
        </div>
      )}

      <div className="py-1">
        {!isPurchase && lastForCustomer && (
          <button type="button" className="block w-full rounded px-2 py-1.5 text-right text-xs hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => applyLastDeal(lastForCustomer)}>
            ⚡ طبّق آخر صفقة لهذا الزبون
          </button>
        )}
        <button type="button" className="block w-full rounded px-2 py-1.5 text-right text-xs hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => { onDuplicateItem(index); onClose() }}>
          🔁 كرّر السطر
        </button>
        {!isPurchase && otherWarehouses.length > 0 && (
          <div>
            <div className="px-2 pt-1 text-[11px] font-semibold text-slate-500">انقل من مخزن</div>
            {otherWarehouses.map((ws) => (
              <button
                key={ws.warehouseId}
                type="button"
                className="block w-full rounded px-2 py-1.5 text-right text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={() => { onUpdateItem(index, { warehouseId: ws.warehouseId, warehouseName: ws.warehouse.name }); onClose() }}
              >
                🔄 {ws.warehouse.name} ({ws.quantityPieces})
              </button>
            ))}
          </div>
        )}
        {units.length > 1 && (
          <div>
            <div className="px-2 pt-1 text-[11px] font-semibold text-slate-500">غيّر الوحدة</div>
            <div className="flex flex-wrap gap-1 px-2 py-1">
              {units.map((u) => (
                <button
                  key={u}
                  type="button"
                  disabled={u === item.unit}
                  className={cn("rounded border px-2 py-1 text-[11px]", u === item.unit ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "border-slate-200 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800")}
                  onClick={() => { onUpdateItem(index, { unit: u }); onClose() }}
                >
                  {UNIT_LABELS[u]}
                </button>
              ))}
            </div>
          </div>
        )}
        <button type="button" className="mt-1 block w-full rounded px-2 py-1.5 text-right text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30" onClick={() => { onRemoveItem(index); onClose() }}>
          🗑 حذف السطر
        </button>
      </div>
    </div>
  )
}

// Legacy single-draft key (kept for backward compat with old autosaves)
function getDraftKey(userId: string | undefined, type: InvoiceType) {
  return `invoice_draft_${type}_${userId ?? "anon"}`
}

interface PersistedDraft {
  customerId: string | null
  date: string
  paymentMode: PaymentMode
  items: Array<{ productId: string; unit: Unit; quantity: number; unitPrice: number; warehouseId?: string; warehouseName?: string; allowNegativeStock?: boolean; notes?: string }>
  discount: number
  paidAmount: number
  invoiceNotes?: string
  savedAt: number
  // Idempotency key stored with the draft: if this exact draft is restored and
  // saved again (back-navigation, crash recovery), the backend recognizes the
  // key and returns the already-created invoice instead of duplicating it.
  clientRequestId?: string
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

// Fallback Product for an invoice line whose product no longer exists in the
// products list (deleted/archived). Keeps the line visible and editable instead
// of silently dropping it from the edited invoice.
function placeholderProduct(it: InvoiceItem): Product {
  return {
    id: it.productId,
    name: it.productName ?? "مادة غير موجودة",
    itemNumber: it.itemNumber ?? "؟",
    pcsPerCarton: 1,
    salePrice: Number(it.unitPrice) || 0,
    retailPrice: 0,
    purchasePrice: 0,
    openingBalancePcs: 0,
    cartonsAvailable: 0,
  } as unknown as Product
}

export function InvoiceCreatePage({ editId }: { editId?: string } = {}) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  // ── Edit mode: same page/UX as create, but loads an existing invoice and
  // saves via PUT. Drafts/tabs/autosave/coupon/WhatsApp-prompt are disabled.
  const isEdit = !!editId
  const invoiceQuery = useInvoice(editId)
  const editingInvoice = isEdit ? invoiceQuery.data : undefined
  const invoiceType: InvoiceType = isEdit
    ? ((editingInvoice?.type as InvoiceType) ?? "SALE")
    : (searchParams.get("type") === "PURCHASE" ? "PURCHASE" : "SALE")
  const isPurchase = invoiceType === "PURCHASE"
  usePageTitle(
    isEdit
      ? (editingInvoice ? `تعديل الفاتورة ${editingInvoice.invoiceNumber}` : "تعديل الفاتورة")
      : isPurchase ? "فاتورة شراء جديدة" : "فاتورة بيع جديدة",
  )
  const readOnly = useReadOnly()

  const userId = useAuthStore((s) => s.user?.id)
  const uid = userId ?? "anon"
  const permissions = useAuthStore((s) => s.user?.permissions ?? [])
  const hidePrice = !isPurchase && permissions.includes("VIEW_WITHOUT_PRICES" as never)
  const canViewPurchasePrice = useAuthStore((s) => s.hasPermission("VIEW_PURCHASE_PRICE"))

  // ── Tab ID from URL ──────────────────────────────────────────────────────────
  const urlTid = searchParams.get("tid")

  // On first mount: if no tid, create one and redirect (create mode only)
  useEffect(() => {
    if (isEdit || urlTid) return
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
  const setFocusMode = useUiStore((s) => s.setFocusMode)

  // ---- header state ----
  const [customerQuery, setCustomerQuery] = useState("")
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [customerHighlight, setCustomerHighlight] = useState(0)
  const [customerListOpen, setCustomerListOpen] = useState(false)
  const [date, setDate] = useState(localDateStr())
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("CREDIT")
  const [invoiceNotes, setInvoiceNotes] = useState("")

  // ---- quick-add modals ----
  const [quickAddCustomerOpen, setQuickAddCustomerOpen] = useState(false)
  const [quickAddCustomerName, setQuickAddCustomerName] = useState("")
  const [quickAddCustomerPhone, setQuickAddCustomerPhone] = useState("")
  const [quickAddCustomerAddress, setQuickAddCustomerAddress] = useState("")
  const [quickAddCustomerNotes, setQuickAddCustomerNotes] = useState("")
  const [quickAddCustomerBalance, setQuickAddCustomerBalance] = useState("0")
  const [quickAddCustomerCreditLimit, setQuickAddCustomerCreditLimit] = useState("")
  const [quickAddCustomerIsSupplier, setQuickAddCustomerIsSupplier] = useState(false)
  const [quickAddCustomerIsBoth, setQuickAddCustomerIsBoth] = useState(false)
  const [quickAddProductOpen, setQuickAddProductOpen] = useState(false)
  const [quickAddProductName, setQuickAddProductName] = useState("")
  const [quickAddProductSalePrice, setQuickAddProductSalePrice] = useState("")
  const [quickAddProductPurchasePrice, setQuickAddProductPurchasePrice] = useState("")
  // Alert shown when a sale product has 0 stock in المحل
  const [shopStockAlert, setShopStockAlert] = useState<Product | null>(null)
  const [shopStockAlertUnit, setShopStockAlertUnit] = useState<Unit>("PIECE")

  // ---- items state ----
  const [items, setItems] = useState<DraftItem[]>([])
  const [preparedRows, setPreparedRows] = useState<Record<number, boolean>>({})
  // Right-click context menu on a line's product name — see InvoiceLineContextMenu.
  const [lineMenu, setLineMenu] = useState<{ index: number; x: number; y: number } | null>(null)
  const [productModal, setProductModal] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  // ---- Mobile Smart Invoice Preview: show a product card before adding it as a line ----
  const [scanPreview, setScanPreview] = useState<{ product: Product; unit: Unit; qty: number } | null>(null)
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches)
  const [productQuery, setProductQuery] = useState("")
  const [productHighlight, setProductHighlight] = useState(0)
  const [showPurchase, setShowPurchase] = useState(false)
  const [showStock, setShowStock] = useState(false)
  const [useRetailPrice, setUseRetailPrice] = useState(false)
  // When the clerk flips جملة/مفرد while rows already exist we ask what to do
  // with the existing lines. Holds the *target* useRetailPrice value, or null.
  const [priceModePrompt, setPriceModePrompt] = useState<boolean | null>(null)

  // ---- totals state ----
  const [discount, setDiscount] = useState(0)
  const [couponCode, setCouponCode] = useState("")
  const [couponMessage, setCouponMessage] = useState("")
  // True while the current `discount` value came from an applied coupon (not a
  // manual entry). Lets us (a) warn when a coupon replaces a manual discount and
  // (b) clear the stale "coupon applied" note the moment the clerk edits discount.
  const [couponApplied, setCouponApplied] = useState(false)
  // The applied coupon's rule (kept separately from `discount` so the amount
  // can be recomputed whenever the cart changes — see the effect below).
  const [appliedCoupon, setAppliedCoupon] = useState<{ discountType: "PERCENT" | "AMOUNT"; discountValue: number } | null>(null)
  const [paidAmount, setPaidAmount] = useState(0)
  const [preview, setPreview] = useState(false)
  const [savedInvoiceId, setSavedInvoiceId] = useState<string | null>(null)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [whatsappPromptId, setWhatsappPromptId] = useState<string | null>(null)
  const [whatsappSending, setWhatsappSending] = useState(false)
  // Channel picker step after "نعم، أرسل" — official / personal / wa.me web.
  const [waChannelInvoiceId, setWaChannelInvoiceId] = useState<string | null>(null)
  const [whatsappBusy, setWhatsappBusy] = useState(false)
  // Invoice number of the just-created invoice — for the wa.me web message.
  const [waPromptInvoiceNumber, setWaPromptInvoiceNumber] = useState("")
  const waSettings = useSettings().data
  const [workerModalId, setWorkerModalId] = useState<string | null>(null)
  const [walkInLoading, setWalkInLoading] = useState(false)
  // ---- edit-mode state ----
  const [editReady, setEditReady] = useState(false)
  const editInitRef = useRef(false)
  const editSnapshotRef = useRef("")
  const [editSaveError, setEditSaveError] = useState<unknown>(null)
  const [editSaving, setEditSaving] = useState(false)

  // Track mobile viewport (drives the Smart Invoice Preview bottom-sheet behavior)
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)")
    const handler = () => setIsMobile(mq.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  // Reset all form state when the active tab changes (so tabs are truly isolated)
  const prevTidRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeTid || activeTid === prevTidRef.current) return
    prevTidRef.current = activeTid
    setSelectedCustomer(null)
    setCustomerQuery("")
    setInvoiceNotes("")
    setItems([])
    setDiscount(0)
    setCouponCode("")
    setCouponApplied(false)
    setAppliedCoupon(null)
    setCouponMessage("")
    setPaidAmount(0)
    setSavedInvoiceId(null)
    setLastSavedAt(null)
    setDate(localDateStr())
    setPaymentMode("CREDIT")
    clientRequestIdRef.current = crypto.randomUUID()
    invoiceSavedRef.current = false
    // Draft loading will run separately via the draftKey effect
  }, [activeTid])

  // ── Focus mode: hide sidebar when a customer is selected to get full-width writing space ─
  useEffect(() => {
    setFocusMode(!!selectedCustomer)
    return () => setFocusMode(false)
  }, [selectedCustomer, setFocusMode])

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
  // In edit mode it activates only when something actually CHANGED vs the
  // loaded invoice (snapshot comparison), so plain back-navigation stays silent.
  const savingRef = useRef(false)
  const serializeEditState = () =>
    JSON.stringify({
      customerId: selectedCustomer?.id ?? null,
      discount,
      paidAmount,
      paymentMode,
      invoiceNotes,
      items: items.map((i) => [i.product.id, i.unit, i.quantity, i.unitPrice, i.warehouseId ?? null, i.notes ?? ""]),
    })
  const isDirty = isEdit
    ? editReady && !savedInvoiceId && serializeEditState() !== editSnapshotRef.current
    : (!!selectedCustomer || items.length > 0 || discount > 0 || paidAmount > 0 || !!couponCode.trim()) && !savedInvoiceId
  const blocker = useUnsavedWarning(isDirty, savingRef)

  // ---- OCR state ----
  const [ocrOpen, setOcrOpen] = useState(false)

  // ---- barcode scanner (ref-based, keyboard-layout independent) ----
  const scanInputRef = useRef<HTMLInputElement | null>(null)
  const scanBufRef = useRef("")
  const scanLastKeyRef = useRef(0)
  const scanSnapRef = useRef<{ el: HTMLInputElement | HTMLTextAreaElement; val: string } | null>(null)
  const clientRequestIdRef = useRef<string>(crypto.randomUUID())
  // Synchronous "already saved" flag — see the autosave interval guard.
  const invoiceSavedRef = useRef(false)
  const prefillAppliedRef = useRef(false)
  // Order-preparation id from the URL (?fromPrep=...). The page fetches the
  // matching pending preparation and fills customer + items from it. Passing it
  // in the URL (not location.state) survives the tid redirect / refresh / new tab.
  const fromPrepId = searchParams.get("fromPrep")
  // Customer id from the URL (?customerId=...) — used by "quick invoice" links
  // elsewhere (e.g. the WhatsApp chat screen) to preselect the customer.
  const urlCustomerId = searchParams.get("customerId")
  const customerPrefillAppliedRef = useRef(false)
  const { data: pendingPreps } = useQuery({
    queryKey: ["order-preparations"],
    queryFn: getOrderPreparations,
    enabled: !!fromPrepId,
  })

  // ---- field refs ----
  const customerInputRef = useRef<HTMLInputElement | null>(null)
  const paidInputRef = useRef<HTMLInputElement | null>(null)
  const productSearchRef = useRef<HTMLInputElement | null>(null)
  const productListRef = useRef<HTMLDivElement | null>(null)
  const productItemRefs = useRef<Record<number, HTMLButtonElement | null>>({})
  const quantityRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const priceRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const totalRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const unitRefs = useRef<Record<string, HTMLSelectElement | null>>({})
  const notesRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const customers = useMemo(() => customersQuery.data ?? [], [customersQuery.data])
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data])

  // All customers are eligible for any invoice type (supplier = customer, no distinction)
  const customerSuggestions = useMemo(
    () => sortCustomersByRelevance(customers, customerQuery).slice(0, 8),
    [customers, customerQuery],
  )
  const productSuggestions = useMemo(
    // Cap the dropdown so a broad query shows the top matches only, not a wall
    // of results. Ranking already puts the best first.
    () => sortProductsByRelevance(products, productQuery).slice(0, 15),
    [products, productQuery],
  )

  // Highlights reset inline in change handlers (avoid setState-in-effect)

  // Scroll highlighted product item into view
  useEffect(() => {
    const el = productItemRefs.current[productHighlight]
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [productHighlight])

  const subtotal = useMemo(() => items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0), [items])
  // Edit mode: the customer's currentBalance ALREADY CONTAINS this invoice's
  // remaining amount — using it as-is double-counts the invoice (بيع 1,250 على
  // رصيد 15,000 كان يعرض حساب سابق 16,250 ونهائي 17,500). Subtract the
  // invoice's own contribution to get the true pre-invoice balance.
  const rawCustomerBalance = selectedCustomer?.currentBalance ?? 0
  const previousBalance =
    isEdit && editingInvoice && selectedCustomer?.id === editingInvoice.customerId && editingInvoice.status === "ACTIVE"
      ? rawCustomerBalance - (editingInvoice.type === "PURCHASE" ? -1 : 1) * Number(editingInvoice.remainingAmount ?? 0)
      : rawCustomerBalance
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

  // PURCHASE edit guard: a 0/blank purchase price would silently zero the
  // product's weighted-average cost on the server — block the save.
  const missingPurchasePrice = isEdit && isPurchase && items.some((it) => !(it.unitPrice > 0))

  // Per-unit price for an explicit retail/wholesale mode (used when re-pricing
  // existing rows after the جملة/مفرد toggle, where the state flag hasn't flipped yet).
  function unitPriceForMode(product: Product, unit: Unit, retail: boolean) {
    const base = isPurchase
      ? product.purchasePrice
      : (retail && product.retailPrice > 0 ? product.retailPrice : product.salePrice)
    return base * piecesPerUnit(unit, product)
  }

  function unitPriceFor(product: Product, unit: Unit) {
    return unitPriceForMode(product, unit, useRetailPrice)
  }

  // Items selling below purchase price — compare in the SAME unit as unitPrice
  const belowCostItems = useMemo(() => {
    if (isPurchase) return new Set<number>()
    const set = new Set<number>()
    items.forEach((item, i) => {
      const baseCost = Number(item.product.purchasePrice ?? 0)
      const costInUnit = baseCost * piecesPerUnit(item.unit, item.product)
      if (item.unitPrice < costInUnit) set.add(i)
    })
    return set
  }, [items, isPurchase])

  const hasBelowCost = belowCostItems.size > 0

  // Same product added on more than one line — usually a slip during fast entry
  // (scanned twice, added from search then again from a scan). Warning only —
  // legitimate cases exist (same product in two units, or two warehouses).
  const duplicateProductCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const item of items) counts[item.product.id] = (counts[item.product.id] ?? 0) + 1
    return counts
  }, [items])

  // Suspicious (extreme) unit price vs a reference price — WARNING ONLY, never blocks.
  // Flags a likely fat-fingered price (extra/missing zero) so the clerk can catch it.
  const priceWarnItems = useMemo(() => {
    const map = new Map<number, "HIGH" | "LOW">()
    items.forEach((item, i) => {
      const ref = referenceUnitPrice(item.product, isPurchase, piecesPerUnit(item.unit, item.product))
      const flag = priceLooksSuspicious(item.unitPrice, ref)
      if (flag) map.set(i, flag)
    })
    return map
  }, [items, isPurchase])
  const hasPriceWarn = priceWarnItems.size > 0

  // Edit mode: pieces the ORIGINAL invoice already deducted, per product. The
  // backend edit reverses the old lines then re-applies the new ones, so any
  // stock projection must credit these back first — otherwise unchanged lines
  // look like shortages against the already-deducted stock.
  const originalInvoicePcs = useMemo(() => {
    const acc: Record<string, number> = {}
    if (!isEdit || editingInvoice?.type !== "SALE") return acc
    for (const it of editingInvoice?.items ?? []) {
      const prod = products.find((p) => p.id === it.productId)
      const pcs = prod ? unitToPieces((it.unit ?? "PIECE") as Unit, it.quantity, prod) : it.quantity
      acc[it.productId] = (acc[it.productId] ?? 0) + pcs
    }
    return acc
  }, [isEdit, editingInvoice, products])

  // Items that would push stock into negative territory (warning only, not blocking).
  // Also exposed per-product (negativeAfterByProduct) so each row can carry its own
  // badge — in edit mode the per-line shortage row further down is disabled (its
  // check misfires on unchanged lines; see lineShort), so this credit-back-aware
  // calculation is the only accurate "will go negative" signal available there.
  const { lowStockWarnings, negativeAfterByProduct } = useMemo(() => {
    if (isPurchase) return { lowStockWarnings: [] as string[], negativeAfterByProduct: new Map<string, number>() } // Purchase adds stock, can't go negative
    // First pass: aggregate total piece-consumption per product across ALL rows
    const consumed: Record<string, number> = {}
    for (const item of items) {
      const pid = item.product.id
      const pcs = unitToPieces(item.unit, item.quantity, item.product)
      consumed[pid] = (consumed[pid] ?? 0) + pcs
    }
    // Second pass: warn once per product whose cumulative consumption exceeds available stock
    const warnings: string[] = []
    const negativeAfterByProduct = new Map<string, number>()
    const warned = new Set<string>()
    for (const item of items) {
      const pid = item.product.id
      if (warned.has(pid)) continue
      warned.add(pid)
      // Sales come from المحل only — warn against المحل stock, not the total.
      // (Edit mode: credit back what the original invoice already deducted.)
      const available = (item.product.shopStock ?? stockOf(item.product)) + (originalInvoicePcs[pid] ?? 0)
      const totalPcs = consumed[pid] ?? 0
      const after = available - totalPcs
      if (after < 0) {
        warnings.push(`${item.product.name} (المحل بي ${fmt(available)} فقط، تحتاج تحويل من المخزن — سيصبح ${fmt(after)})`)
        negativeAfterByProduct.set(pid, after)
      }
    }
    return { lowStockWarnings: warnings, negativeAfterByProduct }
  }, [items, isPurchase, originalInvoicePcs])

  // ----- EDIT MODE: initialize the form from the loaded invoice (once) -----
  useEffect(() => {
    if (!isEdit || editInitRef.current) return
    const inv = invoiceQuery.data
    // Wait for products/customers too, so warehouse names + customer resolve.
    if (!inv || !productsQuery.isSuccess || !customersQuery.isSuccess) return
    editInitRef.current = true

    const nextDiscount = Number(inv.discount ?? 0)
    const nextPaid = Number(inv.paidAmount ?? 0)
    const nextPaymentMode: PaymentMode = inv.paymentType === "CASH" ? "CASH" : "CREDIT"
    const nextNotes = inv.notes ?? ""
    const cust = customers.find((c) => c.id === inv.customerId) ?? inv.customer ?? null
    const nextItems: DraftItem[] = (inv.items ?? []).map((it) => {
      const product = products.find((p) => p.id === it.productId) ?? placeholderProduct(it)
      const wsName = it.warehouseId
        ? product.warehouseStocks?.find((ws) => ws.warehouseId === it.warehouseId)?.warehouse.name ?? it.warehouseName ?? undefined
        : undefined
      return {
        product,
        unit: (it.unit ?? "PIECE") as Unit,
        quantity: it.quantity,
        unitPrice: Number(it.unitPrice),
        warehouseId: it.warehouseId,
        warehouseName: wsName,
        notes: it.notes ?? "",
      }
    })

    setDate(inv.date ? inv.date.slice(0, 10) : localDateStr())
    setDiscount(nextDiscount)
    setPaidAmount(nextPaid)
    setPaymentMode(nextPaymentMode)
    setInvoiceNotes(nextNotes)
    if (cust) {
      setSelectedCustomer(cust)
      setCustomerQuery(cust.name)
    }
    setItems(nextItems)
    // Snapshot AFTER init — the unsaved-warning fires only on real changes.
    editSnapshotRef.current = JSON.stringify({
      customerId: cust?.id ?? null,
      discount: nextDiscount,
      paidAmount: nextPaid,
      paymentMode: nextPaymentMode,
      invoiceNotes: nextNotes,
      items: nextItems.map((i) => [i.product.id, i.unit, i.quantity, i.unitPrice, i.warehouseId ?? null, i.notes ?? ""]),
    })
    setEditReady(true)
  }, [isEdit, invoiceQuery.data, productsQuery.isSuccess, customersQuery.isSuccess, customers, products])

  // ----- LOAD DRAFT on mount -----
  useEffect(() => {
    if (isEdit) return
    if (savedInvoiceId) return
    // Skip draft when coming from an order preparation (prefill effect handles it)
    if (fromPrepId) return
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw) return
      const draft: PersistedDraft = JSON.parse(raw)
      if (Date.now() - draft.savedAt > 7 * 86_400_000) return
      if (draft.clientRequestId) clientRequestIdRef.current = draft.clientRequestId
      setDate(draft.date)
      setPaymentMode(draft.paymentMode)
      setDiscount(draft.discount ?? 0)
      setPaidAmount(draft.paidAmount)
      setInvoiceNotes(draft.invoiceNotes ?? "")
      const cust = customers.find((c) => c.id === draft.customerId)
      if (cust) {
        setSelectedCustomer(cust)
        setCustomerQuery(cust.name)
      }
      const restoredItems: DraftItem[] = []
      for (const it of draft.items) {
        const p = products.find((x) => x.id === it.productId)
        if (p) restoredItems.push({ product: p, unit: it.unit, quantity: it.quantity, unitPrice: it.unitPrice, warehouseId: it.warehouseId, warehouseName: it.warehouseName, allowNegativeStock: it.allowNegativeStock, notes: it.notes })
      }
      setItems(restoredItems)
    } catch {
      // ignore corrupt draft
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, products, draftKey])

  // ----- PREFILL from an order preparation (?fromPrep=<id>) -----
  useEffect(() => {
    if (!fromPrepId) return
    if (!activeTid) return            // wait until tid is established (after reset)
    if (prefillAppliedRef.current) return
    if (customers.length === 0 || products.length === 0) return
    if (!pendingPreps) return         // wait until preparations are fetched

    const prep = pendingPreps.find((p) => p.id === fromPrepId)
    if (!prep) return                 // already prepared/cancelled or unknown id

    prefillAppliedRef.current = true

    // Match the customer by id first, then by phone (preparations store phone;
    // the id is resolved server-side and may be absent on older records).
    let customer = prep.customerId
      ? customers.find((c) => c.id === prep.customerId)
      : undefined
    if (!customer && prep.customerPhone) {
      customer = customers.find((c) => c.phone === prep.customerPhone)
    }
    if (customer) {
      setSelectedCustomer(customer)
      setCustomerQuery(customer.name)
    } else if (prep.customerName) {
      // No matching customer record — seed the search box so the user can pick/add.
      setCustomerQuery(prep.customerName)
    }

    if (!prep.items?.length) return

    const newItems: DraftItem[] = []
    for (const pi of prep.items) {
      const product = products.find((p) => p.id === pi.productId)
      if (!product) continue
      const unit = (pi.unit === "CARTON" || pi.unit === "DOZEN" || pi.unit === "BOX" ? pi.unit : "PIECE") as Unit

      const allWhs = product.warehouseStocks ?? []
      const activeWhs = allWhs.filter((ws) => ws.quantityPieces > 0)

      // Fall back to the product's catalog price when the order didn't carry one.
      const linePrice = (pi.unitPrice ?? 0) > 0 ? pi.unitPrice! : unitPriceFor(product, unit)

      if (activeWhs.length <= 1) {
        // Single warehouse (or no warehouse data) — one row
        newItems.push({
          product,
          unit,
          quantity: pi.quantity,
          unitPrice: linePrice,
          warehouseId: activeWhs[0]?.warehouseId,
          warehouseName: activeWhs[0]?.warehouse.name,
        })
      } else {
        // Multiple warehouses — split into one PIECE row per warehouse
        const piecePrice = linePrice / piecesPerUnit(unit, product)
        const totalPcs = unitToPieces(unit, pi.quantity, product)

        const shopWh = allWhs.find((ws) => ws.warehouse.name.includes("محل"))
        const shopId = shopWh?.warehouseId
        const others = allWhs
          .filter((ws) => ws.quantityPieces > 0 && ws.warehouseId !== shopId)
          .sort((a, b) => b.quantityPieces - a.quantityPieces)

        let remaining = totalPcs

        if (shopWh && shopWh.quantityPieces > 0) {
          const take = Math.min(shopWh.quantityPieces, remaining)
          newItems.push({ product, unit: "PIECE", quantity: take, unitPrice: piecePrice, warehouseId: shopId, warehouseName: shopWh.warehouse.name })
          remaining -= take
        }
        for (const ws of others) {
          if (remaining <= 0) break
          const take = Math.min(ws.quantityPieces, remaining)
          if (take <= 0) continue
          newItems.push({ product, unit: "PIECE", quantity: take, unitPrice: piecePrice, warehouseId: ws.warehouseId, warehouseName: ws.warehouse.name })
          remaining -= take
        }
        // Any leftover (insufficient stock across all warehouses) goes on a last row
        if (remaining > 0) {
          newItems.push({ product, unit: "PIECE", quantity: remaining, unitPrice: piecePrice })
        }
      }
    }
    if (newItems.length > 0) setItems(newItems)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, products, activeTid, pendingPreps, fromPrepId])

  // ----- PREFILL customer from a quick-invoice link (?customerId=<id>) -----
  useEffect(() => {
    if (!urlCustomerId) return
    if (fromPrepId) return // order-prep prefill takes priority when both are present
    if (customerPrefillAppliedRef.current) return
    if (customers.length === 0) return
    const customer = customers.find((c) => c.id === urlCustomerId)
    if (!customer) return
    customerPrefillAppliedRef.current = true
    setSelectedCustomer(customer)
    setCustomerQuery(customer.name)
  }, [customers, urlCustomerId, fromPrepId])

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
    if (isEdit) return
    if (savedInvoiceId) return
    const id = window.setInterval(() => {
      // invoiceSavedRef flips synchronously on save success; the state-based
      // guard above only kicks in after the next render, so a pending tick
      // could resurrect the draft that clearDraft() just removed.
      if (invoiceSavedRef.current) return
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
          warehouseName: i.warehouseName,
          allowNegativeStock: i.allowNegativeStock,
          notes: i.notes,
        })),
        discount,
        paidAmount,
        invoiceNotes,
        savedAt: Date.now(),
        clientRequestId: clientRequestIdRef.current,
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
  }, [items, selectedCustomer, date, paymentMode, paidAmount, discount, invoiceNotes, draftKey, savedInvoiceId, activeTid, uid, invoiceType, isEdit])

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
    // Invoice already saved — close immediately without asking
    if (savedInvoiceId) {
      const destination = destinationAfterClose(tid)
      removeTab(uid, tid)
      refreshTabs()
      navigate(destination)
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
    // Sales always come out of المحل (enforced server-side) — never auto-pick the
    // largest warehouse for a sale line.
    if (!isPurchase) return undefined
    const stocks = product.warehouseStocks ?? []
    if (stocks.length === 1) return stocks[0].warehouseId
    // For purchases (adding stock) default to the warehouse that already has most.
    if (stocks.length > 1) {
      return stocks.reduce((a, b) => (a.quantityPieces >= b.quantityPieces ? a : b)).warehouseId
    }
    return undefined
  }

  // Remove exactly the line that was just added (matched by object identity so a
  // later scan/edit can't cause the wrong row to be removed). If the row was since
  // edited via updateItem its reference changed and this becomes a safe no-op.
  function undoAddedItem(target: DraftItem) {
    setItems((current) => current.filter((x) => x !== target))
  }

  // Toast with an «تراجع» (undo) button, shown after a scan direct-adds a line.
  function showAddedUndoToast(product: Product, added: DraftItem) {
    toast({
      title: `أُضيف: ${product.name}`,
      description: "اضغط «تراجع» لإزالة آخر إضافة",
      duration: 6000,
      action: (
        <ToastAction altText="تراجع عن إضافة المادة" onClick={() => undoAddedItem(added)}>
          تراجع
        </ToastAction>
      ),
    })
  }

  function doAddProduct(product: Product, overrideWarehouseId?: string, overrideWarehouseName?: string, unit: Unit = "PIECE", qty = 1, opts?: { undo?: boolean }) {
    const nextIndex = items.length
    const newItem: DraftItem = {
      product,
      unit,
      quantity: Math.max(1, qty),
      unitPrice: unitPriceFor(product, unit),
      warehouseId: overrideWarehouseId ?? defaultWarehouseId(product),
      warehouseName: overrideWarehouseName,
    }
    setItems((current) => [...current, newItem])
    setProductModal(false)
    setProductQuery("")
    if (opts?.undo) {
      // Scan path: don't steal focus (keeps the gun ready for the next scan) and
      // offer an inline undo instead.
      showAddedUndoToast(product, newItem)
    } else {
      window.setTimeout(() => quantityRefs.current[`${nextIndex}`]?.focus(), 0)
    }
  }

  // ---- Smart Invoice Preview: look up a scanned/selected product and show its card ----
  function openScanPreview(product: Product, unit: Unit = "PIECE") {
    setProductModal(false)
    setScanPreview({ product, unit, qty: 1 })
  }


  // Confirm from the preview card → add the line exactly like the manual/scan path
  // (keeps the same shop-stock warehouse guard so a scan never pulls from an empty shop).
  function addFromPreview() {
    if (!scanPreview) return
    const { product, unit, qty } = scanPreview
    const q = Math.max(1, qty || 1)
    setScanPreview(null)
    if (maybePromptWarehouse(product, unit)) return
    doAddProduct(product, undefined, undefined, unit, q)
  }

  // For sales: if المحل has 0 stock but other warehouses have stock, prompt the
  // user to pick a warehouse instead of silently pulling from an empty shop.
  // Returns true when it opened the picker (caller should stop).
  function maybePromptWarehouse(product: Product, unit: Unit): boolean {
    if (isPurchase) return false
    const shopStock = product.shopStock ?? 0
    const totalStock = product.currentStock ?? (product.openingBalancePcs + product.cartonsAvailable * product.pcsPerCarton)
    const othersHaveStock = (product.warehouseStocks ?? []).some((ws) => ws.quantityPieces > 0)
    if (shopStock === 0 && (totalStock > 0 || othersHaveStock)) {
      setShopStockAlert(product)
      setShopStockAlertUnit(unit)
      return true
    }
    return false
  }

  function addProduct(product: Product) {
    if (maybePromptWarehouse(product, "PIECE")) return
    doAddProduct(product)
  }

  // Split a line item across warehouses when qty > shopStock.
  // Example: order 20, shop has 10 → line1: 10 from shop, line2: 10 from next warehouse.
  function splitLineAcrossWarehouses(index: number) {
    const item = items[index]
    if (!item) return
    const allWhs = item.product.warehouseStocks ?? []
    const shopWh = allWhs.find((ws) => ws.warehouse.name.includes("محل"))
    const shopPcs = item.product.shopStock
      ?? shopWh?.quantityPieces
      ?? 0
    const itemPcs = unitToPieces(item.unit, item.quantity, item.product)
    // Works from any starting state: shop may be EMPTY (all pieces come from
    // depots) and the line may already point at a specific warehouse.
    if (itemPcs <= shopPcs) return

    // The new lines are all in PIECE units, so the (possibly hand-edited) carton/
    // dozen unit price MUST be converted down to a per-piece price — otherwise each
    // piece would be billed at the carton price.
    const piecePrice = item.unitPrice / piecesPerUnit(item.unit, item.product)
    const roundedPiecePrice = Math.round(piecePrice * 1000) / 1000

    // Greedy fill: المحل first, then the other warehouses by stock (most first),
    // taking only what each holds so we never over-allocate a warehouse.
    const shopId = shopWh?.warehouseId
    const others = allWhs
      .filter((ws) => ws.quantityPieces > 0 && ws.warehouseId !== shopId)
      .sort((a, b) => b.quantityPieces - a.quantityPieces)

    type Alloc = { warehouseId?: string; warehouseName?: string; pcs: number }
    const allocations: Alloc[] = []
    let remaining = itemPcs

    const shopTake = Math.min(shopPcs, remaining)
    allocations.push({ warehouseId: shopId, warehouseName: shopWh?.warehouse.name, pcs: shopTake })
    remaining -= shopTake

    for (const ws of others) {
      if (remaining <= 0) break
      const take = Math.min(ws.quantityPieces, remaining)
      if (take <= 0) continue
      allocations.push({ warehouseId: ws.warehouseId, warehouseName: ws.warehouse.name, pcs: take })
      remaining -= take
    }

    // If total stock still can't cover the request, keep the leftover on the first
    // (shop) line so NO quantity is silently dropped — that line then sells the
    // leftover negative with the seller's explicit acknowledgment.
    if (remaining > 0) {
      allocations[0].pcs += remaining
    }

    setItems((current) => {
      const next = [...current]
      const newLines: DraftItem[] = allocations
        .filter((a) => a.pcs > 0) // an empty shop contributes nothing — drop its zero line
        .map((a) => ({
          product: item.product,
          unit: "PIECE" as Unit,
          quantity: a.pcs,
          unitPrice: roundedPiecePrice,
          warehouseId: a.warehouseId,
          warehouseName: a.warehouseName,
          // The split itself covered the shortage; if a leftover stayed on the
          // shop line the seller already saw the shortage row, so mark it
          // acknowledged rather than re-warning on the fresh lines.
          allowNegativeStock: remaining > 0 && a.warehouseId === shopId ? true : undefined,
        }))
      next.splice(index, 1, ...newLines)
      return next
    })
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
    setQuickAddCustomerIsBoth(false)
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
        isBoth: quickAddCustomerIsBoth,
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
    if (!code.trim()) return
    const found = findProductByScan(products, code)
    if (!found) {
      toast({ title: "المادة غير موجودة", description: `لا توجد مادة بهذا الباركود: ${code}`, variant: "destructive" })
      return
    }
    const hit = found.product
    const unit: Unit = found.isCarton ? "CARTON" : "PIECE"
    // Route through the same shop-stock warehouse picker as manual add, so a
    // scanned item with an empty shop never silently adds from the wrong place.
    if (maybePromptWarehouse(hit, unit)) return
    // Scan paths (gun / camera / URL) direct-add for speed, with an undo toast.
    doAddProduct(hit, undefined, undefined, unit, 1, { undo: true })
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
    setPreparedRows((current) => {
      const next: Record<number, boolean> = {}
      Object.entries(current).forEach(([key, value]) => {
        const rowIndex = Number(key)
        if (rowIndex < index) next[rowIndex] = value
        if (rowIndex > index) next[rowIndex - 1] = value
      })
      return next
    })
  }

  // Insert a copy of the line right after itself — e.g. same product needed in
  // two units, or split across two warehouses by hand.
  function duplicateItem(index: number) {
    setItems((current) => {
      const target = current[index]
      if (!target) return current
      const next = [...current]
      next.splice(index + 1, 0, { ...target })
      return next
    })
    // Inserting a row shifts every later row's index up by one — re-key
    // preparedRows (تم تجهيز checkboxes) the same way removeItem does in reverse,
    // or the checkbox states end up displayed against the wrong rows.
    setPreparedRows((current) => {
      const next: Record<number, boolean> = {}
      Object.entries(current).forEach(([key, value]) => {
        const rowIndex = Number(key)
        next[rowIndex <= index ? rowIndex : rowIndex + 1] = value
      })
      return next
    })
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

  type RowField = "unit" | "qty" | "price" | "total" | "notes"

  function focusRowField(rowKey: string, field: RowField): boolean {
    const el =
      field === "unit" ? unitRefs.current[rowKey]
      : field === "qty" ? quantityRefs.current[rowKey]
      : field === "price" ? priceRefs.current[rowKey]
      : field === "total" ? totalRefs.current[rowKey]
      : notesRefs.current[rowKey]
    if (!el) return false
    el.focus()
    if (el instanceof HTMLInputElement) el.select()
    return true
  }

  function handleRowKey(
    e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    rowKey: string,
    field: RowField,
  ) {
    // hidePrice rows skip price/total, so navigate over whatever actually exists
    const order: RowField[] = ["unit", "qty", "price", "total", "notes"]
    const idx = order.indexOf(field)
    const focusNext = () => {
      for (let i = idx + 1; i < order.length; i++) if (focusRowField(rowKey, order[i])) return true
      return false
    }
    const focusPrev = () => {
      for (let i = idx - 1; i >= 0; i--) if (focusRowField(rowKey, order[i])) return true
      return false
    }
    if (e.key === "Enter") {
      e.preventDefault()
      // Enter walks: unit → qty → price → total → notes → new item
      if (!focusNext()) {
        setProductModal(true)
        window.setTimeout(() => productSearchRef.current?.focus(), 50)
      }
      return
    }
    // RTL layout: the "next" column is visually to the LEFT.
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      // In the free-text notes field, arrows keep moving the caret until it
      // reaches the edge — only then do they jump to the neighbouring column.
      if (field === "notes") {
        const input = e.currentTarget as HTMLInputElement
        const atStart = input.selectionStart === 0 && input.selectionEnd === 0
        const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length
        if (e.key === "ArrowLeft" && !atEnd) return
        if (e.key === "ArrowRight" && !atStart) return
      }
      e.preventDefault()
      if (e.key === "ArrowLeft") focusNext()
      else focusPrev()
      return
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const row = Number(rowKey)
      if (Number.isNaN(row)) return
      const targetRow = `${e.key === "ArrowDown" ? row + 1 : row - 1}`
      // Only swallow the key when the neighbouring row exists.
      const moved = focusRowField(targetRow, field) || (field !== "unit" && focusRowField(targetRow, "qty"))
      if (moved) e.preventDefault()
    }
  }

  function selectAllOnFocus(e: React.FocusEvent<HTMLInputElement>) {
    e.target.select()
  }

  // ---- USB barcode scanner (works even while a field is focused) ----
  useEffect(() => {
    // Undo any characters the gun leaked into a focused field during a burst.
    function restoreField(el: HTMLInputElement | HTMLTextAreaElement, val: string) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
      setter?.call(el, val)
      el.dispatchEvent(new Event("input", { bubbles: true }))
    }

    function onKey(e: globalThis.KeyboardEvent) {
      if (productModal || preview || shopStockAlert || scanPreview) return
      if (e.ctrlKey || e.altKey || e.metaKey) return

      const now = Date.now()
      const gap = now - scanLastKeyRef.current
      scanLastKeyRef.current = now
      // A slow gap means a human typing, not a scanner gun → fresh buffer.
      if (gap > 100) { scanBufRef.current = ""; scanSnapRef.current = null }

      if (e.key === "Enter") {
        const code = scanBufRef.current.trim()
        scanBufRef.current = ""
        // A fast multi-char burst ending in Enter = a real scan.
        if (code.length >= 3) {
          e.preventDefault()
          e.stopPropagation()
          const snap = scanSnapRef.current
          scanSnapRef.current = null
          if (snap) restoreField(snap.el, snap.val)
          addProductByCode(code)
        }
        return
      }

      const ch = scanCharFromCode(e)
      if (ch) {
        // At burst start, snapshot the focused field so we can wipe leaked chars.
        if (scanBufRef.current === "") {
          const el = document.activeElement as HTMLElement | null
          if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
            scanSnapRef.current = { el: el as HTMLInputElement, val: (el as HTMLInputElement).value }
          } else {
            scanSnapRef.current = null
          }
        }
        scanBufRef.current += ch
      }
    }
    // Capture phase so we see keys before the focused input does.
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productModal, preview, products, shopStockAlert, scanPreview])

  // ---- Auto-add a product when arriving from the global scanner (/invoices/new?scan=CODE) ----
  const scanParamAppliedRef = useRef(false)
  useEffect(() => {
    if (scanParamAppliedRef.current) return
    const code = searchParams.get("scan")
    if (!code) return
    if (products.length === 0) return // wait until products are loaded
    scanParamAppliedRef.current = true
    addProductByCode(code)
    // Clear the param so a refresh doesn't re-add the same line.
    const next = new URLSearchParams(searchParams)
    next.delete("scan")
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, searchParams])

  async function persistInvoice(navigateAfterSave = false, showWhatsAppPrompt = true) {
    if (savedInvoiceId) return savedInvoiceId
    if (!selectedCustomer || items.length === 0 || hasInvalidTotal) return null
    if (missingPurchasePrice) return null
    // ── Edit mode: PUT the updated invoice; no draft/receipt/WhatsApp side-effects.
    if (isEdit && editId) {
      savingRef.current = true
      setEditSaveError(null)
      setEditSaving(true)
      try {
        await updateInvoice(editId, {
          type: invoiceType,
          customerId: selectedCustomer.id,
          discount,
          tax: 0,
          paidAmount: effectivePaid,
          paymentType: financials.paymentType,
          notes: invoiceNotes.trim() || undefined,
          items: items.map((item) => ({
            productId: item.product.id,
            unit: item.unit,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            warehouseId: item.warehouseId,
            notes: item.notes?.trim() || undefined,
          })),
        })
        invoiceSavedRef.current = true
        setSavedInvoiceId(editId)
        void queryClient.invalidateQueries({ queryKey: ["invoices"] })
        void queryClient.invalidateQueries({ queryKey: ["invoices", editId] })
        void queryClient.invalidateQueries({ queryKey: ["invoices", editId, "audit-trail"] })
        void queryClient.invalidateQueries({ queryKey: ["products"] })
        // The edit changed totals → the customer's currentBalance changed
        // server-side; without this the UI keeps showing the stale balance.
        void queryClient.invalidateQueries({ queryKey: ["customers"] })
        navigate(`/invoices/${editId}`)
        return editId
      } catch (error) {
        savingRef.current = false
        setEditSaveError(error)
        throw error
      } finally {
        setEditSaving(false)
      }
    }
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
      notes: invoiceNotes.trim() || undefined,
      items: items.map((item) => ({
        productId: item.product.id,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        warehouseId: item.warehouseId,
        notes: item.notes?.trim() || undefined,
        // Authorize the deficit for any sale line that can't be fully covered — by the
        // warehouse it pulls from OR by total stock. allowNegative only *permits* going
        // below zero; it never forces it, so it's safe to set whenever a shortfall is possible.
        allowNegativeStock:
          (item.allowNegativeStock
            || (invoiceType === "SALE"
              && (itemQuantityInPieces(item) > effectiveAvailablePcs(item)
                || itemQuantityInPieces(item) > stockOf(item.product))))
          || undefined,
      })),
    })
      const id = response.data?.id ?? null
      if (id) {
      invoiceSavedRef.current = true
      // If customer paid more than the invoice total, create a receipt voucher for
      // the difference — except for the walk-in account, whose change is handed
      // back in cash and must not accumulate as a credit balance.
      if (overpayment > 0 && selectedCustomer && !isWalkInCustomer(selectedCustomer.phone)) {
        try {
          await createReceipt({ customerId: selectedCustomer.id, amount: overpayment, type: "RECEIPT", date, clientRequestId: `${clientRequestIdRef.current}:overpay` })
        } catch {
          // The invoice itself saved — but the surplus receipt didn't. Say so
          // instead of silently overstating the customer's debt.
          toast({
            title: "الفاتورة انحفظت لكن سند الزيادة فشل",
            description: `سجّل سند قبض يدوي بمبلغ ${fmt(overpayment)} للزبون ${selectedCustomer.name}.`,
            variant: "destructive",
          })
        }
      }
      setSavedInvoiceId(id)
      clearDraft()
      // If this invoice was built from a pending order preparation, mark that
      // preparation done and link this invoice so it leaves the pending list.
      if (fromPrepId) {
        try {
          await completeOrderPreparation(fromPrepId, id)
          void queryClient.invalidateQueries({ queryKey: ["order-preparations"] })
        } catch { /* don't block the invoice if completing the prep fails */ }
      }
      const customerHasPhone = hasRealPhone(selectedCustomer?.phone)
      if (showWhatsAppPrompt && !isPurchase && customerHasPhone) {
        setWaPromptInvoiceNumber((response.data as { invoiceNumber?: string } | undefined)?.invoiceNumber ?? "")
        setWhatsappPromptId(id)
      }
      if (navigateAfterSave && !(!isPurchase && customerHasPhone)) navigate(`/invoices/${id}`)
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
      setCloseError(apiErrorMessage(error, "تعذر حفظ الفاتورة."))
    } finally {
      setCloseSaving(false)
    }
  }

  function save() {
    persistInvoice(true).catch((err) => {
      toast({ title: apiErrorMessage(err, "تعذر حفظ الفاتورة"), variant: "destructive" })
    })
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
      // A manual discount and a coupon must NOT stack — the coupon replaces it.
      const hadManualDiscount = discount > 0 && !couponApplied
      const result = await applyCoupon(couponCode, subtotal)
      setDiscount(result?.discount ?? 0)
      setCouponApplied(!!result)
      setAppliedCoupon(result ? { discountType: result.coupon.discountType, discountValue: result.coupon.discountValue } : null)
      setCouponMessage(result ? `تم تطبيق ${result.coupon.code}` : "")
      if (result && hadManualDiscount) {
        toast({
          title: "استبدل الكوبون الخصم اليدوي",
          description: `الخصم الآن ${fmt(result.discount ?? 0)} من الكوبون بدل الخصم المُدخل يدوياً`,
        })
      }
    } catch (error) {
      setCouponMessage(apiErrorMessage(error, "تعذر تطبيق الكوبون"))
    }
  }

  // Keep a coupon's discount in sync with the cart: `discount` was previously
  // frozen at whatever the subtotal was at the moment ✓ was clicked, so adding/
  // removing/repricing items afterward left a PERCENT coupon applying the wrong
  // amount (and an AMOUNT coupon could exceed the new, smaller subtotal). Mirrors
  // the exact clamp formula the server uses in coupon.service.ts.
  useEffect(() => {
    if (!appliedCoupon) return
    const raw = appliedCoupon.discountType === "PERCENT"
      ? subtotal * (appliedCoupon.discountValue / 100)
      : appliedCoupon.discountValue
    setDiscount(Math.min(subtotal, Math.max(0, raw)))
  }, [subtotal, appliedCoupon])

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

  // ---- جملة/مفرد (wholesale/retail) price-mode toggle ----
  // If rows already exist we ask the clerk what to do; otherwise flip silently.
  function requestPriceModeToggle() {
    const target = !useRetailPrice
    if (items.length > 0) setPriceModePrompt(target)
    else setUseRetailPrice(target)
  }

  // Resolve the prompt. scope: "all" reprices existing rows to the new mode
  // (quantities + units preserved); "future" leaves existing rows untouched.
  function resolvePriceMode(scope: "all" | "future" | "cancel") {
    const target = priceModePrompt
    setPriceModePrompt(null)
    if (target === null || scope === "cancel") return
    setUseRetailPrice(target)
    if (scope === "all") {
      setItems((current) =>
        current.map((item) => ({ ...item, unitPrice: unitPriceForMode(item.product, item.unit, target) })),
      )
    }
  }

  // ---- Switch invoice type ----
  // Moves to a FRESH tab id: the tid-change effect then resets the whole form
  // INCLUDING clientRequestId/invoiceSavedRef. The old in-place reset kept the
  // previous idempotency key, so a save after switching could silently return
  // the previously-created invoice instead of creating a new one. It also
  // dropped the tid from the URL entirely (draft went to a legacy shared key).
  function switchType() {
    if (isEdit) return
    const next = isPurchase ? "SALE" : "PURCHASE"
    setSearchParams({ type: next, tid: newTabId() }, { replace: true })
  }

  // ---- Type-specific styling ----
  const titleText = isEdit
    ? (isPurchase ? "تعديل فاتورة شراء" : "تعديل فاتورة بيع")
    : isPurchase ? "فاتورة شراء جديدة" : "فاتورة بيع جديدة"
  const TitleIcon = isPurchase ? ShoppingCart : Receipt
  const accentBg = isPurchase ? "from-amber-500 to-amber-600" : "from-emerald-500 to-emerald-600"
  const cardBorder = isPurchase ? "border-r-4 border-r-amber-400" : "border-r-4 border-r-emerald-400"
  const pageTint = isPurchase ? "bg-amber-50/30 dark:bg-amber-950/10" : "bg-emerald-50/30 dark:bg-emerald-950/10"
  const customerLabel = isPurchase ? "المورّد" : "الزبون"

  // ── Edit mode: wait for the invoice (and form init) before rendering ─────
  if (isEdit && !editReady) {
    if (!invoiceQuery.isLoading && invoiceQuery.isFetched && !editingInvoice) {
      return <div className="p-6 text-sm text-slate-500">الفاتورة غير موجودة.</div>
    }
    return <div className="p-6 text-sm text-slate-500">جاري تحميل الفاتورة...</div>
  }

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
    <div className={`space-y-2 rounded-xl ${pageTint}`}>
      {/* ── Tabs bar ─────────────────────────────────────────────────────────── */}
      {!isEdit && (tabs.length > 0 || activeTid) ? (
        <div className="flex items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
          {tabs.map((t) => {
            const isActive = t.id === activeTid
            const typeColor = t.type === "PURCHASE" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200"
            const activeRing = isActive ? "ring-2 ring-offset-1 ring-slate-400 dark:ring-slate-500" : ""
            return (
              <div
                key={t.id}
                className={`flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-medium cursor-pointer transition ${typeColor} ${activeRing}`}
                onClick={() => !isActive && switchTab(t)}
              >
                <span>{t.type === "PURCHASE" ? "🛒" : "🧾"}</span>
                <span className="max-w-[80px] truncate">{t.label}</span>
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
            <button type="button" className="rounded border border-dashed border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" onClick={() => openNewTab("SALE")}>+ بيع</button>
            <button type="button" className="rounded border border-dashed border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300" onClick={() => openNewTab("PURCHASE")}>+ شراء</button>
          </div>
        </div>
      ) : null}

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

      {/* Compact header toolbar */}
      <div className={`flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 bg-gradient-to-l ${accentBg} text-white shadow-sm`}>
        <TitleIcon className="h-5 w-5 shrink-0" />
        <h1 className="text-base font-bold">{titleText}</h1>
        {isEdit ? (
          <>
            <span className="rounded bg-white/20 px-2 py-0.5 text-xs font-semibold">{editingInvoice?.invoiceNumber}</span>
            <span className="rounded bg-white/15 px-2 py-0.5 text-[11px]">التاريخ ورقم الفاتورة ثابتان</span>
          </>
        ) : (
          <button type="button" onClick={switchType} className="rounded border border-white/30 bg-white/20 px-2.5 py-1 text-xs font-medium text-white hover:bg-white/30">
            {isPurchase ? "↔ بيع" : "↔ شراء"}
          </button>
        )}
        <div className="flex items-center gap-1 text-xs opacity-75">
          <ScanLine className="h-3.5 w-3.5" /><span>باركود</span>
        </div>
        <div className="mr-auto flex items-center gap-1.5">
          <VoiceInvoiceButton compact />
          {isPurchase && (
            <button type="button" onClick={() => setOcrOpen(true)} className="inline-flex h-7 items-center gap-1.5 rounded border border-white/30 bg-white/20 px-2 text-xs font-medium text-white hover:bg-white/30">
              <Camera className="h-3.5 w-3.5" /> صورة
            </button>
          )}
        </div>
      </div>

      {lastSavedAt && !savedInvoiceId ? (
        <div className="rounded-md bg-sky-50 px-2.5 py-1 text-xs text-sky-700 dark:bg-sky-950/40 dark:text-sky-200">
          حُفظ تلقائياً {new Date(lastSavedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
        </div>
      ) : null}

      {/* Invoice header form */}
      <div className={cn("rounded-xl border border-sky-200 bg-sky-50/60 px-2.5 py-2 dark:border-sky-900 dark:bg-sky-950/20", cardBorder)}>
        {/* Row 1: customer + payment + walk-in */}
        <div className="flex items-center gap-1.5">
          {/* Customer picker */}
          <div className="relative min-w-0 flex-1">
            <Input
              ref={customerInputRef}
              className="h-8 text-sm"
              placeholder={customerLabel}
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
                    className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-right text-sm ${idx === customerHighlight ? "bg-amber-100 dark:bg-amber-900/40" : "hover:bg-slate-100 dark:hover:bg-slate-900"}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickCustomer(customer)}
                    onMouseEnter={() => setCustomerHighlight(idx)}
                  >
                    <span className="flex-1 truncate">{customer.name} — {customer.phone}</span>
                    {customer.isBoth ? (
                      <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 shrink-0">ز+م</span>
                    ) : customer.isSupplier ? (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 shrink-0">مورد</span>
                    ) : null}
                  </button>
                ))}
                {customerSuggestions.length === 0 && (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-right text-sm text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={openQuickAddCustomer}
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">أضف "{customerQuery.trim()}"</span>
                  </button>
                )}
              </div>
            ) : null}
          </div>
          {/* Payment type */}
          <select
            className="h-8 shrink-0 rounded-md border border-slate-200 bg-white px-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
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
          {/* Walk-in */}
          {!isPurchase && !isEdit && !selectedCustomer && (
            <button
              type="button"
              disabled={walkInLoading}
              onClick={async () => {
                setWalkInLoading(true)
                try {
                  const c = await getWalkInCustomer()
                  if (c) {
                    setSelectedCustomer(c)
                    setCustomerQuery(c.name)
                    // A walk-in (الزبون النقدي) sale is paid on the spot — default
                    // the payment to cash so the user doesn't have to switch it.
                    setPaymentMode("CASH")
                  }
                } catch { /* ignore */ }
                setWalkInLoading(false)
              }}
              className="h-8 shrink-0 rounded-md border border-amber-200 bg-amber-50 px-2 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
            >
              {walkInLoading ? "..." : "⚡ نقدي"}
            </button>
          )}
        </div>
        {/* Row 2: notes */}
        <div className="mt-1.5">
          <Input
            className="h-8 text-sm"
            value={invoiceNotes}
            onChange={(event) => setInvoiceNotes(event.target.value)}
            placeholder="ملاحظات الفاتورة (اختياري)"
          />
        </div>
      </div>

      {/* Main body */}
      <div className="flex gap-2 items-start">
      <div className="min-w-0 flex-1 space-y-2">

      {/* Items section */}
      <div className={cn("rounded-xl border border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20", cardBorder)}>
        <div className="flex items-center justify-between gap-2 border-b border-emerald-100 px-3 py-2 dark:border-emerald-900/50">
          {/* Buttons first = right side in RTL layout */}
          <div className="flex gap-1">
            <button type="button" className="inline-flex h-7 items-center gap-1 rounded bg-emerald-600 px-2.5 text-[11px] font-semibold text-white hover:bg-emerald-700" onClick={() => { setProductModal(true); window.setTimeout(() => productSearchRef.current?.focus(), 50) }}>
              <Plus className="h-3.5 w-3.5" /> أضف
            </button>
            <button
              type="button"
              title="قراءة باركود بالكاميرا"
              className="inline-flex h-7 items-center gap-1 rounded border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
              onClick={() => setCameraOpen(true)}
            >
              <Camera className="h-3.5 w-3.5" /> 📷 باركود
            </button>
            {!isPurchase && (
              <button
                type="button"
                className={cn("rounded border px-2 py-1 text-[11px] font-medium transition", useRetailPrice ? "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-700 dark:bg-orange-950/30 dark:text-orange-400" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300")}
                onClick={requestPriceModeToggle}
              >
                {useRetailPrice ? "مفرد" : "جملة"}
              </button>
            )}
            {canViewPurchasePrice && (
              <button type="button" className={cn("rounded border px-2 py-1 text-[11px] font-medium transition", showPurchase ? "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950/30 dark:text-sky-400" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300")} onClick={() => setShowPurchase((v) => !v)}>شراء</button>
            )}
            <button type="button" className={cn("rounded border px-2 py-1 text-[11px] font-medium transition", showStock ? "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950/30 dark:text-sky-400" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300")} onClick={() => setShowStock((v) => !v)}>كمية</button>
          </div>
          {/* Label on the left side */}
          <span className="text-sm font-semibold text-[color:var(--theme-textPrimary)]">
            {items.length > 0 ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">{items.length}</span> : null}
            {" "}الأصناف
          </span>
        </div>
        {/* Dense rows: more invoice lines visible without scrolling */}
        <div className="overflow-x-auto px-1 py-1 [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1.5">
            <Table>
              <THead>
                <TR>
                  <TH className="w-10 text-center">جهز</TH>
                  <TH>المادة</TH>
                  <TH>المخزن</TH>
                  <TH>الوحدة</TH>
                  <TH>العدد</TH>
                  {!hidePrice && <TH>سعر المفرد</TH>}
                  {!hidePrice && <TH>الإجمالي</TH>}
                  <TH>الملاحظات</TH>
                  <TH>حذف</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((item, index) => {
                  const rowKey = `${index}`
                  // Edit mode: current stock already reflects this invoice's original
                  // deduction, so subtracting the line qty again would double-count —
                  // use the credit-back-aware negativeAfterByProduct map instead (same
                  // one the aggregate warning box above uses) so the badge is accurate.
                  const editNegativeAfter = isEdit ? negativeAfterByProduct.get(item.product.id) : undefined
                  const stockAfterLine = isPurchase ? stockOf(item.product) + itemQuantityInPieces(item) : stockOf(item.product) - itemQuantityInPieces(item)
                  const hasNegativeStock = isEdit
                    ? editNegativeAfter !== undefined
                    : stockOf(item.product) < 0 || stockAfterLine < 0
                  const lineQtyPcs = itemQuantityInPieces(item)
                  // Shortage row: any sale line the warehouse it pulls from can't fully
                  // cover. Shown INLINE under the line (never a blocking dialog) with the
                  // seller's three choices: pull/split from other warehouses, sell negative,
                  // or remove the line. Ignoring it keeps today's default: sell negative.
                  // In edit mode the original lines' stock is already deducted, so a
                  // per-line shortage check would misfire on unchanged lines — the
                  // aggregate projection (lowStockWarnings, with credit-back) covers it.
                  const linePullPcs = effectiveAvailablePcs(item)
                  const lineShort = !isPurchase && !isEdit && lineQtyPcs > linePullPcs
                  const shortageAcknowledged = Boolean(item.allowNegativeStock)
                  const stocksList = item.product.warehouseStocks ?? []
                  const shopWhRow = stocksList.find((ws) => ws.warehouse.name.includes("محل"))
                  const otherWhs = stocksList
                    .filter((ws) => ws.quantityPieces > 0 && ws.warehouseId !== shopWhRow?.warehouseId && ws.warehouseId !== item.warehouseId)
                    .sort((a, b) => b.quantityPieces - a.quantityPieces)
                  // A single other warehouse that covers the WHOLE line → offer a direct pull.
                  const fullCoverWh = otherWhs.find((ws) => ws.quantityPieces >= lineQtyPcs)
                  // Splitting helps whenever the others hold anything at all.
                  const canSplit = lineShort && !isPurchase && otherWhs.length > 0
                  const lineOutOfStock = lineShort && !canSplit && !fullCoverWh
                  return (
                    <Fragment key={index}>
                    <TR>
                      <TD className="text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-emerald-600"
                          checked={Boolean(preparedRows[index])}
                          title="تم تجهيز المادة"
                          aria-label={`تم تجهيز ${item.product.name}`}
                          onChange={(event) => setPreparedRows((current) => ({ ...current, [index]: event.target.checked }))}
                        />
                      </TD>
                      <TD
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setLineMenu({ index, x: e.clientX, y: e.clientY })
                        }}
                        title="كلك يمين لخيارات إضافية"
                      >
                        <div className="flex items-center gap-2 min-w-[140px] cursor-context-menu">
                          <ProductThumb product={item.product} />
                          <span className="font-medium">{item.product.name}</span>
                          {item.warehouseName && (
                            <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-semibold text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                              📦 {item.warehouseName}
                            </span>
                          )}
                          {lineOutOfStock ? (
                            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                              ⛔ نفد — سيُسجَّل بالسالب
                            </span>
                          ) : hasNegativeStock ? (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                              {editNegativeAfter !== undefined ? `رصيد سالب — سيصبح ${fmt(editNegativeAfter)}` : "رصيد سالب"}
                            </span>
                          ) : null}
                          {(duplicateProductCounts[item.product.id] ?? 0) > 1 ? (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                              🔁 مكررة ×{duplicateProductCounts[item.product.id]}
                            </span>
                          ) : null}
                          {belowCostItems.has(index) ? (
                            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                              ⚠ أقل من التكلفة
                            </span>
                          ) : null}
                          {priceWarnItems.get(index) === "HIGH" ? (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                              ⚠ سعر مرتفع غير معتاد؟
                            </span>
                          ) : priceWarnItems.get(index) === "LOW" ? (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                              ⚠ سعر منخفض غير معتاد؟
                            </span>
                          ) : null}
                        </div>
                        {/* One compact sub-line instead of three stacked ones — keeps rows short */}
                        {(item.product.pcsPerCarton > 1 || showPurchase || showStock) ? (
                          <div className="flex flex-wrap gap-x-2 text-[11px] leading-4 text-slate-500">
                            {item.product.pcsPerCarton > 1 ? <span className="text-slate-400">{item.product.pcsPerCarton} قطعة/كرتون</span> : null}
                            {showPurchase ? <span>شراء: {fmt(item.product.purchasePrice)}</span> : null}
                            {showStock ? <span>متوفر: {stockOf(item.product)}</span> : null}
                          </div>
                        ) : null}
                      </TD>
                      <TD>
                        {/* warehouse selector — shown only when product has stocks in multiple warehouses */}
                        {(item.product.warehouseStocks ?? []).length > 1 ? (
                          <select
                            className="h-8 w-28 rounded-md border bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                            value={item.warehouseId ?? ""}
                            onChange={(e) => {
                              const wsId = e.target.value || undefined
                              const wsName = wsId
                                ? (item.product.warehouseStocks ?? []).find((ws) => ws.warehouseId === wsId)?.warehouse.name
                                : undefined
                              updateItem(index, { warehouseId: wsId, warehouseName: wsName })
                            }}
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
                          ref={(el) => { unitRefs.current[rowKey] = el }}
                          className="h-8 w-24 rounded-md border bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                          value={item.unit}
                          onChange={(event) => updateItem(index, { unit: event.target.value as Unit })}
                          onKeyDown={(e) => handleRowKey(e, rowKey, "unit")}
                        >
                          {visibleUnits(item.product).map((u) => (
                            <option key={u} value={u}>{UNIT_LABELS[u]}</option>
                          ))}
                        </select>
                      </TD>
                      <TD>
                        <NumericInput
                          ref={(el) => { quantityRefs.current[rowKey] = el }}
                          decimal={false}
                          className="h-8 w-20"
                          value={item.quantity}
                          onFocus={selectAllOnFocus}
                          onValueChange={(n) => updateItem(index, { quantity: n })}
                          onKeyDown={(e) => handleRowKey(e, rowKey, "qty")}
                        />
                        {item.unit !== "PIECE" && (
                          <div className="mt-0.5 text-[10px] text-slate-400">= {itemQuantityInPieces(item)} قطعة</div>
                        )}
                        {item.product.pcsPerCarton > 1 && item.unit === "PIECE" && (
                          <div className="mt-0.5 flex flex-wrap gap-0.5">
                            {(["carton", "halfCarton", "dozen"] as const).map((kind) => {
                              const delta = quickQtyIncrement(item, kind)
                              if (delta === null) return null
                              const label = kind === "carton" ? "+كرتون" : kind === "halfCarton" ? "+نصف" : "+درزن"
                              return (
                                <button
                                  key={kind}
                                  type="button"
                                  title={`أضف ${delta} قطعة`}
                                  className="rounded border border-slate-200 px-1 text-[9px] text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                                  onClick={() => updateItem(index, { quantity: item.quantity + delta })}
                                >
                                  {label}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </TD>
                      {!hidePrice && (
                        <TD>
                          <NumericInput
                            ref={(el) => { priceRefs.current[rowKey] = el }}
                            className="h-8 w-24"
                            value={item.unitPrice}
                            onFocus={selectAllOnFocus}
                            onValueChange={(n) => updateItem(index, { unitPrice: n })}
                            onKeyDown={(e) => handleRowKey(e, rowKey, "price")}
                          />
                        </TD>
                      )}
                      {!hidePrice && (
                        <TD>
                          <NumericInput
                            ref={(el) => { totalRefs.current[rowKey] = el }}
                            className="h-8 w-28 font-semibold"
                            value={Math.round(item.quantity * item.unitPrice * 1000) / 1000}
                            onFocus={selectAllOnFocus}
                            onValueChange={(n) => updateItemTotal(index, n)}
                            onKeyDown={(e) => handleRowKey(e, rowKey, "total")}
                          />
                        </TD>
                      )}
                      <TD>
                        <Input
                          ref={(el) => { notesRefs.current[rowKey] = el }}
                          className="h-8 min-w-32"
                          value={item.notes ?? ""}
                          onChange={(event) => updateItem(index, { notes: event.target.value })}
                          onKeyDown={(e) => handleRowKey(e, rowKey, "notes")}
                          placeholder="ملاحظة للمادة"
                        />
                      </TD>
                      <TD>
                        <Button variant="ghost" size="sm" onClick={() => removeItem(index)}>
                          <Trash2 className="h-4 w-4 text-rose-500" />
                        </Button>
                      </TD>
                    </TR>
                    {lineShort && !shortageAcknowledged && (
                      <TR>
                        <TD colSpan={hidePrice ? 7 : 9} className="p-0 pb-1">
                          <div className="mx-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700/50 dark:bg-amber-950/30">
                            <div className="text-[12px] text-amber-800 dark:text-amber-300">
                              ⚠️ <strong>{item.warehouseName ?? "المحل"} عنده {linePullPcs} قطعة</strong> — المطلوب {lineQtyPcs} قطعة.
                              {otherWhs.length > 0
                                ? ` متوفر بمخازن أخرى: ${otherWhs.map((ws) => `${ws.warehouse.name} (${ws.quantityPieces})`).join("، ")}.`
                                : " لا يوجد رصيد بمخازن أخرى."}
                              {" "}إذا تكمل بدون إجراء، النقص ينباع بالسالب.
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {fullCoverWh && (
                                <Button
                                  size="sm"
                                  className="h-7 bg-sky-600 px-2.5 text-xs text-white hover:bg-sky-700"
                                  onClick={() => updateItem(index, { warehouseId: fullCoverWh.warehouseId, warehouseName: fullCoverWh.warehouse.name })}
                                >
                                  🔄 تحويل من {fullCoverWh.warehouse.name}
                                </Button>
                              )}
                              {canSplit && !fullCoverWh && (
                                <Button
                                  size="sm"
                                  className="h-7 bg-sky-600 px-2.5 text-xs text-white hover:bg-sky-700"
                                  onClick={() => splitLineAcrossWarehouses(index)}
                                >
                                  ⚡ تقسيم تلقائي
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 border-amber-400 px-2.5 text-xs text-amber-800 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
                                onClick={() => updateItem(index, { allowNegativeStock: true })}
                              >
                                بيع بالسالب
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                                onClick={() => removeItem(index)}
                              >
                                إلغاء المادة
                              </Button>
                            </div>
                          </div>
                        </TD>
                      </TR>
                    )}
                    </Fragment>
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
        </div>

      {lineMenu && items[lineMenu.index] ? (
        <InvoiceLineContextMenu
          item={items[lineMenu.index]}
          index={lineMenu.index}
          x={lineMenu.x}
          y={lineMenu.y}
          isPurchase={isPurchase}
          canViewPurchasePrice={canViewPurchasePrice}
          customerId={selectedCustomer?.id}
          onClose={() => setLineMenu(null)}
          onUpdateItem={updateItem}
          onDuplicateItem={duplicateItem}
          onRemoveItem={removeItem}
        />
      ) : null}

      {/* Financial summary */}
      <div className={cn("rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2.5 dark:border-amber-900 dark:bg-amber-950/20", cardBorder)}>

        {/* Top grid: amounts on right, balance on left */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">

          {/* Right column: invoice amounts */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">{fmt(subtotal)}</span>
              <span className="text-slate-500">المجموع</span>
            </div>
            <div>
              <label className="text-[11px] font-medium text-slate-500">الخصم</label>
              <NumericInput
                className="mt-0.5 h-8 text-sm"
                value={discount}
                onFocus={selectAllOnFocus}
                onValueChange={(n) => {
                  setDiscount(n)
                  // Editing the discount by hand overrides any coupon: clear the
                  // coupon code (so the server uses this manual value, not the
                  // coupon) and drop the stale "coupon applied" note.
                  if (couponApplied || couponCode || couponMessage) {
                    setCouponApplied(false)
                    setAppliedCoupon(null)
                    setCouponCode("")
                    setCouponMessage("")
                  }
                }}
              />
            </div>
            {!isPurchase && !isEdit && (
              <div>
                <label className="text-[11px] font-medium text-slate-500">كوبون</label>
                <div className="mt-0.5 flex gap-1">
                  <Input className="h-8 text-sm" value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="EID2026" />
                  <Button type="button" variant="outline" className="h-8 shrink-0 px-2 text-xs" onClick={() => void applyCouponCode()}>✓</Button>
                </div>
                {couponMessage ? <p className="mt-0.5 text-[11px] text-slate-500">{couponMessage}</p> : null}
              </div>
            )}
          </div>

          {/* Left column: balance / payment */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className={cn("font-semibold", previousBalance > 0 ? "text-red-600 dark:text-red-400" : previousBalance < 0 ? "text-amber-600 dark:text-amber-400" : "")}>{fmt(Math.abs(previousBalance))}</span>
              <span className="text-slate-500 text-right">{isPurchase ? "رصيد المورد" : "حساب سابق"}</span>
            </div>
            <div>
              <label className="text-[11px] font-medium text-slate-500">{isPurchase ? "المدفوع للمورد" : "المبلغ الواصل"}</label>
              <Input
                ref={paidInputRef}
                className="mt-0.5 h-8 text-sm"
                inputMode="numeric"
                dir="ltr"
                // In CASH mode the paid amount is always the (live) total, so show the
                // derived effectivePaid and lock the field — otherwise it would keep a
                // stale number after the quantity/total changes.
                disabled={paymentMode === "CASH"}
                value={
                  paymentMode === "CASH"
                    ? (effectivePaid === 0 ? "" : effectivePaid.toLocaleString("en-US"))
                    : (paidAmount === 0 ? "" : paidAmount.toLocaleString("en-US"))
                }
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
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">{fmt(remaining)}</span>
              <span className="text-slate-500">متبقي</span>
            </div>
          </div>
        </div>

        {/* Totals highlight row */}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50/80 px-2.5 py-1.5 dark:border-emerald-800 dark:bg-emerald-950/30">
            <span className="font-bold text-emerald-700 dark:text-emerald-400">{fmt(total)}</span>
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">الإجمالي</span>
          </div>
          <div className={cn("flex items-center justify-between rounded-lg border px-2.5 py-1.5",
            finalBalance > 0 ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
              : finalBalance < 0 ? "border-amber-200 bg-amber-100/60 dark:border-amber-800 dark:bg-amber-950/30"
              : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/40"
          )}>
            <span className={cn("font-bold",
              finalBalance > 0 ? "text-red-600 dark:text-red-400"
                : finalBalance < 0 ? "text-amber-600 dark:text-amber-400"
                : "text-slate-700 dark:text-slate-300"
            )}>{fmt(Math.abs(finalBalance))}</span>
            <span className={cn("text-xs font-medium",
              finalBalance > 0 ? "text-red-500 dark:text-red-400"
                : finalBalance < 0 ? "text-amber-500 dark:text-amber-400"
                : "text-slate-500"
            )}>حساب نهائي</span>
          </div>
        </div>

        {overpayment > 0 ? (
          <div className="mt-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
            ↑ زيادة {fmt(overpayment)} — سيُنشأ سند قبض تلقائياً
          </div>
        ) : null}

        {/* Action buttons */}
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-amber-100 pt-2 dark:border-amber-900/50">
          <Button size="sm" className="h-8 text-xs" onClick={() => setPreview(true)}>معاينة</Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={save} disabled={readOnly || !selectedCustomer || items.length === 0 || hasInvalidTotal || missingPurchasePrice || createMutation.isPending || editSaving} title={readOnly ? READ_ONLY_MESSAGE : missingPurchasePrice ? "أدخل سعر شراء صحيح لكل مادة قبل الحفظ" : undefined}>
            {(createMutation.isPending || editSaving) ? "..." : isEdit ? "حفظ التعديلات" : "حفظ"}
          </Button>
          {isEdit ? (
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => navigate(`/invoices/${editId}`)} disabled={editSaving}>
              إلغاء
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => void openExport("pdf")} disabled={!selectedCustomer || items.length === 0 || hasInvalidTotal || createMutation.isPending}>
                <Download className="h-3.5 w-3.5 ml-1" /> PDF
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => void openExport("image")} disabled={!selectedCustomer || items.length === 0 || hasInvalidTotal || createMutation.isPending}>
                <ImageDown className="h-3.5 w-3.5 ml-1" /> صورة
              </Button>
            </>
          )}
        </div>

        {missingPurchasePrice ? (
          <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            أدخل سعر شراء صحيح (أكبر من صفر) لكل مادة قبل الحفظ — سعر الصفر يصفّر كلفة المادة.
          </div>
        ) : null}
        {isEdit && editSaveError ? (
          <div className="mt-1.5 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-200">
            ⚠ {extractErrorMessage(editSaveError)}
          </div>
        ) : null}

        {hasBelowCost ? (
          <div className="mt-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
            <span className="font-semibold"><AlertTriangle className="inline h-3.5 w-3.5 ml-1" />بيع تحت سعر الشراء</span> — {belowCostItems.size} مادة
            <span className="block text-[11px] opacity-80">تنبيه فقط — يمكنك الحفظ، وسيُسجَّل للمراجعة من المدير.</span>
          </div>
        ) : null}
        {hasPriceWarn ? (
          <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <span className="font-semibold"><AlertTriangle className="inline h-3.5 w-3.5 ml-1" />سعر غير معتاد</span> — راجع {priceWarnItems.size} مادة (تنبيه فقط، لا يمنع الحفظ)
          </div>
        ) : null}
        {lowStockWarnings.length > 0 ? (
          <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="font-semibold"><AlertTriangle className="inline h-3.5 w-3.5 ml-1" />مخزون سيصبح سالب</div>
            {lowStockWarnings.map((w, i) => <div key={i} className="mt-0.5">• {w}</div>)}
          </div>
        ) : null}
        {hasInvalidTotal ? (
          <div className="mt-1.5 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-200">الخصم أكبر من المجموع.</div>
        ) : null}
        {createMutation.isError ? (
          <div className="mt-1.5 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-200">
            ⚠ {extractErrorMessage(createMutation.error)}
          </div>
        ) : null}
      </div>

      <input ref={scanInputRef} className="sr-only" aria-hidden tabIndex={-1} />
      </div>{/* end flex-1 */}

      {/* Customer mini-panel — sticky on the right, only when customer selected */}
      {selectedCustomer && (
        <div className="hidden lg:flex flex-col w-52 shrink-0 sticky top-0 gap-2">
          {/* Balance */}
          <div className={cn(
            "rounded-xl border px-3 py-2.5 flex flex-col gap-0.5",
            selectedCustomer.currentBalance > 0
              ? "border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/20"
              : selectedCustomer.currentBalance < 0
                ? "border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20"
                : "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40",
          )}>
            <p className="text-[10px] font-medium text-slate-400">الرصيد</p>
            <p className={cn(
              "text-lg font-bold leading-tight",
              selectedCustomer.currentBalance > 0 ? "text-red-600 dark:text-red-400"
                : selectedCustomer.currentBalance < 0 ? "text-amber-600 dark:text-amber-400"
                : "text-slate-700 dark:text-slate-300",
            )}>
              {fmt(Math.abs(selectedCustomer.currentBalance))}
            </p>
            <p className="text-[10px] text-slate-400">
              {selectedCustomer.currentBalance > 0 ? "عليه" : selectedCustomer.currentBalance < 0 ? "له" : "صفر"}
            </p>
          </div>

          {/* Last transaction */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/40">
            <p className="text-[10px] font-medium text-slate-400">آخر معاملة</p>
            <p className="mt-0.5 text-[12px] font-semibold text-slate-700 dark:text-slate-300">
              {selectedCustomer.lastTransactionAt
                ? new Date(selectedCustomer.lastTransactionAt).toLocaleDateString("ar-IQ", { month: "short", day: "numeric", year: "numeric" })
                : "لا توجد"}
            </p>
            {selectedCustomer.phone && (
              <p className="mt-0.5 text-[10px] text-slate-400">{selectedCustomer.phone}</p>
            )}
          </div>

          {/* Link to full customer file */}
          <button
            type="button"
            onClick={() => navigate(`/customers/${selectedCustomer.id}`)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-right transition hover:border-blue-300 hover:bg-blue-50 dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-blue-700 dark:hover:bg-blue-950/30"
          >
            <p className="text-[10px] text-slate-400">ملف الزبون</p>
            <p className="mt-0.5 text-[12px] font-semibold text-blue-600 dark:text-blue-400 truncate">{selectedCustomer.name}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">فتح السجل الكامل ←</p>
          </button>
        </div>
      )}
      </div>{/* end flex row */}

      {/* Product picker modal */}
      <Dialog open={productModal} onOpenChange={setProductModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>اختيار صنف</DialogTitle></DialogHeader>
          <div className="flex items-center gap-2">
            <Input
              ref={productSearchRef}
              className="flex-1"
              placeholder="بحث بالاسم أو رقم الصنف أو الباركود"
              value={productQuery}
              onChange={(event) => { setProductQuery(event.target.value); setProductHighlight(0) }}
              onKeyDown={handleProductSearchKey}
            />
            <button
              type="button"
              title="مسح بالكاميرا"
              onClick={() => setCameraOpen(true)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-lg hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950"
            >📷</button>
          </div>
          <div ref={productListRef} className="max-h-80 overflow-auto">
            {productSuggestions.map((product, idx) => (
              <button
                key={`${product.id}-${idx}`}
                ref={(el) => { productItemRefs.current[idx] = el }}
                type="button"
                className={`flex w-full items-center justify-between gap-3 border-b p-3 text-right text-sm ${idx === productHighlight ? "bg-amber-100 dark:bg-amber-900/40" : "hover:bg-slate-100 dark:hover:bg-slate-900"} dark:border-slate-800`}
                onMouseEnter={() => setProductHighlight(idx)}
                onClick={() => { if (isMobile) openScanPreview(product, "PIECE"); else addProduct(product) }}
              >
                <span className="flex flex-col items-start gap-0.5">
                  <span className="flex items-center gap-2 font-medium"><ProductThumb product={product} />{product.name}</span>
                  {product.pcsPerCarton > 1 && (
                    <span className="text-[11px] text-slate-400">{product.pcsPerCarton} قطعة/كرتون</span>
                  )}
                  {/* Shop-stock availability BEFORE adding — so the seller sees a
                      shortage up front instead of only after the line is on the
                      invoice (matches the sale-only "sales come from المحل" rule). */}
                  {!isPurchase ? (() => {
                    const shop = product.shopStock ?? product.warehouseStocks?.find((ws) => ws.warehouse.name.includes("محل"))?.quantityPieces
                    if (shop === undefined) return null
                    return (
                      <span className={cn("text-[11px]", shop <= 0 ? "font-semibold text-rose-500" : "text-emerald-600 dark:text-emerald-400")}>
                        {shop <= 0 ? "نفد من المحل" : `متوفر بالمحل: ${shop}`}
                      </span>
                    )
                  })() : null}
                </span>
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

      {cameraOpen && (
        <CameraScanModal
          title="مسح صنف بالكاميرا"
          onDetect={(code) => {
            setCameraOpen(false)
            // Unified scan behavior: camera scan direct-adds the line (like the
            // barcode gun / URL scan) with an undo toast, for speed.
            addProductByCode(code)
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {/* جملة/مفرد price-mode change with existing rows */}
      <Dialog open={priceModePrompt !== null} onOpenChange={(open) => { if (!open) setPriceModePrompt(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>تغيير التسعير إلى {priceModePrompt ? "المفرد" : "الجملة"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            يوجد {items.length} صنف بالفاتورة. كيف تريد تطبيق سعر {priceModePrompt ? "المفرد" : "الجملة"}؟
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <Button onClick={() => resolvePriceMode("all")}>تطبيق على كل الأصناف الحالية</Button>
            <Button variant="outline" onClick={() => resolvePriceMode("future")}>للأصناف الجديدة فقط</Button>
            <Button variant="ghost" onClick={() => resolvePriceMode("cancel")}>إلغاء</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Smart Invoice Preview: bottom-sheet (mobile) / centered card ── */}
      {scanPreview && (() => {
        const p = scanPreview.product
        const img = p.thumbnailUrl || p.imageUrl
        const totalStock = p.currentStock ?? (p.openingBalancePcs + p.cartonsAvailable * p.pcsPerCarton)
        const shopStock = p.shopStock ?? p.warehouseStocks?.find((ws) => ws.warehouse.name.includes("محل"))?.quantityPieces
        const unitPrice = unitPriceFor(p, scanPreview.unit)
        return (
          <div
            className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center"
            onClick={() => setScanPreview(null)}
          >
            <div
              className="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-2xl dark:bg-slate-900 sm:rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  {img ? (
                    <img src={img} alt={p.name} className="h-16 w-16 shrink-0 rounded-lg border object-cover dark:border-slate-700" />
                  ) : (
                    <div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg border bg-slate-50 text-slate-300 dark:border-slate-700 dark:bg-slate-800">
                      <ShoppingCart className="h-7 w-7" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-base font-bold text-[color:var(--theme-textPrimary)]">{p.name}</p>
                    <p className="text-xs text-slate-500">رقم الصنف: {p.itemNumber || "—"}</p>
                    {p.qrCode ? <p className="text-xs text-slate-500">باركود: {p.qrCode}</p> : null}
                  </div>
                </div>
                <button type="button" onClick={() => setScanPreview(null)} className="shrink-0 rounded-full p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Price + stock grid */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30">
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-400">سعر {UNIT_LABELS[scanPreview.unit]}</p>
                  <p className="text-lg font-extrabold text-emerald-700 dark:text-emerald-300">{fmt(unitPrice)}</p>
                </div>
                <div className="rounded-lg bg-sky-50 px-3 py-2 dark:bg-sky-950/30">
                  <p className="text-[11px] text-sky-700 dark:text-sky-400">المتوفر</p>
                  <p className="text-lg font-extrabold text-sky-700 dark:text-sky-300">{totalStock} قطعة</p>
                  {shopStock !== undefined ? <p className="text-[11px] text-slate-500">المحل: {shopStock} قطعة</p> : null}
                </div>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">القطع بالكرتونة: {p.pcsPerCarton}</p>

              {/* Per-warehouse breakdown (if any) */}
              {p.warehouseStocks && p.warehouseStocks.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.warehouseStocks.map((ws) => (
                    <span key={ws.warehouseId} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {ws.warehouse.name}: {ws.quantityPieces}
                    </span>
                  ))}
                </div>
              ) : null}

              {/* Unit toggle + quick qty — supports ALL visible units (PIECE/DOZEN/BOX/CARTON) */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {visibleUnits(p).length > 1 && (
                  <div className="flex overflow-hidden rounded-lg border dark:border-slate-700">
                    {visibleUnits(p).map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setScanPreview((s) => (s ? { ...s, unit: u } : s))}
                        className={cn("px-3 py-1.5 text-xs font-semibold", scanPreview.unit === u ? "bg-emerald-600 text-white" : "bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300")}
                      >
                        {UNIT_LABELS[u]}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-500">العدد</span>
                  <NumericInput
                    decimal={false}
                    className="h-9 w-20 text-center"
                    value={scanPreview.qty}
                    onFocus={selectAllOnFocus}
                    onValueChange={(n) => setScanPreview((s) => (s ? { ...s, qty: Math.max(1, n || 1) } : s))}
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="mt-4 flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setScanPreview(null)}>إلغاء</Button>
                <Button type="button" className="flex-[2] bg-emerald-600 hover:bg-emerald-700" onClick={addFromPreview}>
                  <Plus className="h-4 w-4" /> إضافة للفاتورة
                </Button>
              </div>
            </div>
          </div>
        )
      })()}

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
                  type="text"
                  inputMode="decimal"
                  value={quickAddCustomerBalance}
                  onChange={(e) => setQuickAddCustomerBalance(e.target.value.replace(/[^0-9.]/g, ""))}
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
                  type="text"
                  inputMode="decimal"
                  value={quickAddCustomerCreditLimit}
                  onChange={(e) => setQuickAddCustomerCreditLimit(e.target.value.replace(/[^0-9.]/g, ""))}
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
                    { label: "زبون", isSupplier: false, isBoth: false },
                    { label: "مورد", isSupplier: true, isBoth: false },
                    { label: "ز+م", isSupplier: false, isBoth: true },
                  ] as const).map(({ label, isSupplier, isBoth }) => {
                    const active = quickAddCustomerIsBoth ? isBoth : (quickAddCustomerIsSupplier === isSupplier && !isBoth)
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => { setQuickAddCustomerIsSupplier(isSupplier); setQuickAddCustomerIsBoth(isBoth) }}
                        className={`flex-1 rounded-lg border-2 py-2 text-sm font-semibold transition ${active ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}
                      >
                        {label}
                      </button>
                    )
                  })}
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
                  type="text"
                  inputMode="decimal"
                  value={quickAddProductSalePrice}
                  onChange={(e) => setQuickAddProductSalePrice(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">سعر الشراء</label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={quickAddProductPurchasePrice}
                  onChange={(e) => setQuickAddProductPurchasePrice(e.target.value.replace(/[^0-9.]/g, ""))}
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
                <div>رقم: {isEdit ? (editingInvoice?.invoiceNumber ?? "—") : "تلقائي"}</div>
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
            <Button onClick={save} disabled={readOnly || hasInvalidTotal || createMutation.isPending} title={readOnly ? READ_ONLY_MESSAGE : undefined}>حفظ وانتقل للفاتورة</Button>
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
      <Dialog
        open={!!whatsappPromptId}
        onOpenChange={(open) => {
          // Only navigate from here when the dialog is dismissed by backdrop/X (not via the button)
          if (!open && !whatsappSending) {
            const id = whatsappPromptId
            setWhatsappPromptId(null)
            if (id) navigate(`/invoices/${id}`)
          }
        }}
      >
        <DialogContent className="max-w-sm text-center">
          <DialogHeader>
            <DialogTitle className="text-xl">إرسال واتساب؟</DialogTitle>
          </DialogHeader>
          <p className="text-slate-500 text-sm mb-4">
            تريد ترسل الفاتورة لـ <strong>{selectedCustomer?.name}</strong> على واتساب؟
          </p>
          <div className="flex gap-3 justify-center">
            <Button
              disabled={whatsappSending}
              onClick={() => {
                const id = whatsappPromptId
                if (!id) return
                // Keep whatsappSending=true while swapping dialogs so the
                // prompt's onOpenChange doesn't navigate away mid-flow.
                setWhatsappSending(true)
                setWhatsappPromptId(null)
                setWaChannelInvoiceId(id)
              }}
            >
              نعم، أرسل
            </Button>
            <Button
              variant="outline"
              disabled={whatsappSending}
              onClick={() => {
                const id = whatsappPromptId
                setWhatsappPromptId(null)
                if (id) navigate(`/invoices/${id}`)
              }}
            >
              لا شكراً
            </Button>
          </div>
          <Button
            variant="ghost"
            className="mt-1 w-full text-sm"
            disabled={whatsappSending}
            onClick={() => setWorkerModalId(whatsappPromptId)}
          >
            <Users className="h-4 w-4" />
            إرسال هذه الفاتورة للعامل
          </Button>
        </DialogContent>
      </Dialog>

      {/* Channel picker — step 2 of the post-create WhatsApp prompt */}
      <WhatsAppChannelDialog
        open={!!waChannelInvoiceId}
        onClose={() => {
          const id = waChannelInvoiceId
          setWaChannelInvoiceId(null)
          setWhatsappSending(false)
          if (id) navigate(`/invoices/${id}`)
        }}
        sending={whatsappBusy}
        phone={selectedCustomer?.phone}
        webMessage={fillTemplate(
          (waSettings?.invoiceTemplate ?? "").trim() && !(waSettings?.invoiceTemplate ?? "").trim().startsWith("{") && !(waSettings?.invoiceTemplate ?? "").trim().startsWith("[")
            ? (waSettings?.invoiceTemplate as string)
            : DEFAULT_INVOICE_TEMPLATE,
          {
            customerName: selectedCustomer?.name ?? "",
            invoiceNumber: waPromptInvoiceNumber,
            date,
            total: fmt(total),
            paid: fmt(effectivePaid),
            remaining: fmt(remaining),
            previousBalance: fmt(previousBalance),
            finalBalance: fmt(finalBalance),
            currency: waSettings?.currency ?? "د.ع",
            storeName: waSettings?.storeName ?? "",
          },
        )}
        title="إرسال الفاتورة عبر واتساب"
        webFile={waChannelInvoiceId ? {
          getBlob: () => downloadInvoicePdfBlob(waChannelInvoiceId),
          filename: `${waPromptInvoiceNumber || waChannelInvoiceId}.pdf`,
        } : undefined}
        onWebOpen={() => {
          // wa.me can't attach files — download the same PDF the Meta send
          // attaches so the employee drags it into the opened chat.
          const id = waChannelInvoiceId
          if (!id) return
          void (async () => {
            try {
              const blob = await downloadInvoicePdfBlob(id)
              const url = URL.createObjectURL(blob)
              downloadBlobUrl(url, `${waPromptInvoiceNumber || id}.pdf`)
              setTimeout(() => URL.revokeObjectURL(url), 5000)
              toast({ title: "انفتحت المحادثة ونزل ملف PDF", description: "اسحب الملف المنزّل إلى المحادثة قبل الإرسال." })
            } catch {
              toast({ title: "انفتحت المحادثة لكن تعذر تنزيل الـ PDF", variant: "destructive" })
            }
          })()
        }}
        onSend={async (channel) => {
          const id = waChannelInvoiceId
          if (!id) return
          setWhatsappBusy(true)
          try {
            await sendWhatsAppInvoice(id, channel)
            toast({ title: "تم الإرسال على واتساب ✓" })
          } catch (err) {
            toast({
              title: "فشل إرسال واتساب",
              description: apiErrorMessage(err, "تحقق من إعدادات واتساب في الإعدادات"),
              variant: "destructive",
            })
          }
          setWhatsappBusy(false)
          setWaChannelInvoiceId(null)
          setWhatsappSending(false)
          navigate(`/invoices/${id}`)
        }}
      />

      <WorkerSendModal
        invoiceId={workerModalId}
        open={!!workerModalId}
        onClose={() => setWorkerModalId(null)}
      />

      {/* Shop-stock-zero alert: المحل has 0, other warehouses have stock */}
      <Dialog open={!!shopStockAlert} onOpenChange={(open) => { if (!open) setShopStockAlert(null) }}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-amber-600">⚠️ مخزون المحل صفر</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-slate-700 dark:text-slate-300">
              <strong>{shopStockAlert?.name}</strong> — المحل فاضي.
            </p>
            <p className="text-xs text-slate-500">اختر مخزن — تنحوّل الكمية منه إلى المحل تلقائياً ثم تنباع. يبقى أثر التحويل بالحركة:</p>
            <div className="flex flex-col gap-2">
              {(shopStockAlert?.warehouseStocks ?? [])
                .filter((ws) => ws.quantityPieces > 0)
                .map((ws) => (
                  <Button
                    key={ws.warehouseId}
                    className="w-full justify-between"
                    onClick={() => {
                      const p = shopStockAlert!
                      setShopStockAlert(null)
                      doAddProduct(p, ws.warehouseId, ws.warehouse.name, shopStockAlertUnit)
                    }}
                  >
                    <span>🔄 تحويل من {ws.warehouse.name} ← المحل</span>
                    <span className="opacity-70 text-xs">{ws.quantityPieces} قطعة</span>
                  </Button>
                ))}
              {(shopStockAlert?.warehouseStocks ?? []).filter((ws) => ws.quantityPieces > 0).length === 0 && (
                <p className="text-rose-600 text-xs">لا يوجد مخزون في أي مخزن.</p>
              )}
            </div>
            <Button variant="outline" className="w-full text-xs" onClick={() => {
              const p = shopStockAlert!
              setShopStockAlert(null)
              doAddProduct(p, undefined, undefined, shopStockAlertUnit)
            }}>
              إضافة بدون تحديد مخزن
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
