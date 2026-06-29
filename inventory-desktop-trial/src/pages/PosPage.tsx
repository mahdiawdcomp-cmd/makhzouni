import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowRight,
  Banknote,
  Barcode,
  ChevronDown,
  ChevronUp,
  Minus,
  Package,
  Plus,
  Printer,
  Search,
  Settings2,
  Star,
  Tag,
  Trash2,
  UserRound,
  X,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { createInvoice, getCustomers, getProducts, getSettings } from "../api/endpoints"
import { Input } from "../components/ui/input"
import type { Customer, Product } from "../types/api"
import { fmt } from "../utils/fmt"
import { cn } from "../utils/cn"
import { apiErrorMessage } from "../utils/apiError"
import { calculateInvoiceFinancials } from "../utils/financial"
import { useBarcodeScanner, findProductByScan } from "../utils/barcode-scan"
import { renderInvoiceHTML, parseTemplate } from "../print/invoiceTemplate"
import type { PrintInvoice, PrintStore } from "../print/invoiceTemplate"

// ── Quick panel config types ──────────────────────────────────────
interface CategoryPanel {
  id: string
  type: "category"
  label: string
  category: string
  color: string
}
interface BoxPanel {
  id: string
  type: "box"
  label: string
  productIds: string[]
  color: string
}
interface MostSoldPanel {
  id: string
  type: "most-sold"
  label: string
  topN: number
  color: string
}
type QuickPanel = CategoryPanel | BoxPanel | MostSoldPanel

interface PosConfig {
  panels: QuickPanel[]
  salesCounts: Record<string, number>
}

const CONFIG_KEY = "pos_config_v1"
function loadConfig(): PosConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return { panels: [], salesCounts: {} }
    return { panels: [], salesCounts: {}, ...JSON.parse(raw) }
  } catch {
    return { panels: [], salesCounts: {} }
  }
}
function saveConfig(c: PosConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(c))
}

const PANEL_COLORS = [
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
]

// ── Cart types ────────────────────────────────────────────────────
type PosUnit = "PIECE" | "DOZEN" | "CARTON"
type PosItem = {
  lineId: string
  productId: string
  warehouseId?: string
  name: string
  unit: PosUnit
  quantity: number
  unitPrice: number
}

function normalize(v: string | undefined | null) {
  return String(v ?? "").trim().toLowerCase()
}
function productMatches(p: Product, query: string) {
  const q = normalize(query)
  if (!q) return true
  return [p.name, p.itemNumber, p.qrCode ?? "", p.cartonQrCode ?? ""].some((v) => normalize(v).includes(q))
}
function detectUnit(p: Product, code: string): PosUnit {
  if (code && p.cartonQrCode && normalize(code) === normalize(p.cartonQrCode)) return "CARTON"
  return "PIECE"
}
function priceFor(p: Product, unit: PosUnit) {
  if (unit === "CARTON") return Number(p.salePrice) * Number(p.pcsPerCarton || 1)
  if (unit === "DOZEN") return Number(p.salePrice) * 12
  return Number(p.salePrice)
}
function bestAlternativeWarehouse(p: Product): { id: string; name: string; qty: number } | null {
  const best = (p.warehouseStocks ?? [])
    .filter((ws) => ws.quantityPieces > 0)
    .sort((a, b) => b.quantityPieces - a.quantityPieces)[0]
  if (!best) return null
  return { id: best.warehouseId, name: best.warehouse?.name ?? best.warehouseId, qty: best.quantityPieces }
}

// ── Panel form state ──────────────────────────────────────────────
interface PanelFormState {
  mode: "add" | "edit"
  type: "category" | "box" | "most-sold"
  id: string
  label: string
  color: string
  category: string
  productIds: string[]
  topN: number
}

function defaultForm(type: "category" | "box" | "most-sold"): PanelFormState {
  return {
    mode: "add",
    type,
    id: crypto.randomUUID(),
    label: "",
    color: PANEL_COLORS[0],
    category: "",
    productIds: [],
    topN: 10,
  }
}

// ── Customize Modal ───────────────────────────────────────────────
function CustomizeModal({
  config,
  products,
  onClose,
  onChange,
}: {
  config: PosConfig
  products: Product[]
  onClose: () => void
  onChange: (c: PosConfig) => void
}) {
  const [form, setForm] = useState<PanelFormState | null>(null)
  const [boxSearch, setBoxSearch] = useState("")

  const categories = useMemo(() => {
    const cats = new Set<string>()
    products.forEach((p) => {
      if (p.category) cats.add(p.category)
    })
    return [...cats].sort()
  }, [products])

  function movePanel(index: number, dir: -1 | 1) {
    const panels = [...config.panels]
    const to = index + dir
    if (to < 0 || to >= panels.length) return
    ;[panels[index], panels[to]] = [panels[to], panels[index]]
    onChange({ ...config, panels })
  }

  function deletePanel(id: string) {
    onChange({ ...config, panels: config.panels.filter((p) => p.id !== id) })
  }

  function editPanel(panel: QuickPanel) {
    setBoxSearch("")
    if (panel.type === "category") {
      setForm({
        mode: "edit",
        type: "category",
        id: panel.id,
        label: panel.label,
        color: panel.color,
        category: panel.category,
        productIds: [],
        topN: 10,
      })
    } else if (panel.type === "box") {
      setForm({
        mode: "edit",
        type: "box",
        id: panel.id,
        label: panel.label,
        color: panel.color,
        category: "",
        productIds: [...panel.productIds],
        topN: 10,
      })
    } else {
      setForm({
        mode: "edit",
        type: "most-sold",
        id: panel.id,
        label: panel.label,
        color: panel.color,
        category: "",
        productIds: [],
        topN: panel.topN,
      })
    }
  }

  function saveForm() {
    if (!form || !form.label.trim()) return
    let newPanel: QuickPanel
    if (form.type === "category") {
      if (!form.category) return
      newPanel = {
        id: form.id,
        type: "category",
        label: form.label.trim(),
        category: form.category,
        color: form.color,
      }
    } else if (form.type === "box") {
      newPanel = {
        id: form.id,
        type: "box",
        label: form.label.trim(),
        productIds: form.productIds,
        color: form.color,
      }
    } else {
      newPanel = {
        id: form.id,
        type: "most-sold",
        label: form.label.trim(),
        topN: form.topN,
        color: form.color,
      }
    }
    const panels =
      form.mode === "edit"
        ? config.panels.map((p) => (p.id === form.id ? newPanel : p))
        : [...config.panels, newPanel]
    onChange({ ...config, panels })
    setForm(null)
  }

  function toggleProduct(id: string) {
    setForm((f) => {
      if (!f) return f
      const ids = f.productIds.includes(id)
        ? f.productIds.filter((i) => i !== id)
        : [...f.productIds, id]
      return { ...f, productIds: ids }
    })
  }

  const filteredBoxProducts = useMemo(() => {
    const q = normalize(boxSearch)
    if (!q) return products.slice(0, 60)
    return products
      .filter((p) => normalize(p.name).includes(q) || normalize(p.itemNumber).includes(q))
      .slice(0, 60)
  }, [products, boxSearch])

  const panelTypeIcon = {
    category: <Tag className="h-3.5 w-3.5" />,
    box: <Package className="h-3.5 w-3.5" />,
    "most-sold": <Star className="h-3.5 w-3.5" />,
  }

  const resetCounts = () => {
    if (!confirm("هل تريد إعادة ضبط إحصائيات المبيعات؟")) return
    onChange({ ...config, salesCounts: {} })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4"
      dir="rtl"
    >
      <div
        className="flex w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
        style={{ maxHeight: "92vh" }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-3 dark:border-slate-700">
          {form ? (
            <button
              onClick={() => setForm(null)}
              className="flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400"
            >
              ← رجوع
            </button>
          ) : (
            <h2 className="text-lg font-bold">تخصيص الكاشير</h2>
          )}
          <div className="flex items-center gap-2">
            {!form && (
              <button
                onClick={resetCounts}
                className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
              >
                إعادة ضبط الإحصائيات
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-full p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Panel list */}
        {!form && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-2">
              {config.panels.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-400">
                  لا توجد لوحات بعد. أضف لوحة من الأزرار أدناه.
                </div>
              ) : (
                config.panels.map((panel, i) => (
                  <div
                    key={panel.id}
                    className="flex items-center gap-2 rounded-xl border bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
                      style={{ backgroundColor: panel.color }}
                    >
                      {panelTypeIcon[panel.type]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-sm">{panel.label}</div>
                      <div className="text-[11px] text-slate-500">
                        {panel.type === "category" && `فئة: ${(panel as CategoryPanel).category}`}
                        {panel.type === "box" &&
                          `مجموعة · ${(panel as BoxPanel).productIds.length} مادة`}
                        {panel.type === "most-sold" &&
                          `الأكثر مبيعاً · أعلى ${(panel as MostSoldPanel).topN}`}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        onClick={() => movePanel(i, -1)}
                        disabled={i === 0}
                        className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-200"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => movePanel(i, 1)}
                        disabled={i === config.panels.length - 1}
                        className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 dark:hover:text-slate-200"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => editPanel(panel)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-950/30"
                      >
                        <Settings2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => deletePanel(panel.id)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            {/* Add buttons */}
            <div className="shrink-0 grid grid-cols-3 gap-2 border-t p-3 dark:border-slate-700">
              <button
                onClick={() => setForm({ ...defaultForm("category"), mode: "add" })}
                className="flex flex-col items-center gap-1 rounded-xl border-2 border-dashed border-sky-300 py-3 text-xs font-semibold text-sky-600 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-400 dark:hover:bg-sky-950/30"
              >
                <Tag className="h-5 w-5" />
                + فئة
              </button>
              <button
                onClick={() => setForm({ ...defaultForm("box"), mode: "add" })}
                className="flex flex-col items-center gap-1 rounded-xl border-2 border-dashed border-violet-300 py-3 text-xs font-semibold text-violet-600 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-400 dark:hover:bg-violet-950/30"
              >
                <Package className="h-5 w-5" />
                + مجموعة
              </button>
              <button
                onClick={() => setForm({ ...defaultForm("most-sold"), mode: "add" })}
                className="flex flex-col items-center gap-1 rounded-xl border-2 border-dashed border-amber-300 py-3 text-xs font-semibold text-amber-600 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30"
              >
                <Star className="h-5 w-5" />
                + الأكثر مبيعاً
              </button>
            </div>
          </div>
        )}

        {/* Edit / Add form */}
        {form && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
              {/* Form title */}
              <div className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                {form.mode === "add" ? "إضافة" : "تعديل"}{" "}
                {form.type === "category"
                  ? "لوحة فئة"
                  : form.type === "box"
                    ? "مجموعة مواد"
                    : "لوحة الأكثر مبيعاً"}
              </div>

              {/* Label */}
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-slate-400">
                  الاسم
                </label>
                <Input
                  autoFocus
                  value={form.label}
                  onChange={(e) => setForm((f) => f && { ...f, label: e.target.value })}
                  placeholder={
                    form.type === "category"
                      ? "مثال: مشروبات"
                      : form.type === "box"
                        ? "مثال: العروض الخاصة"
                        : "مثال: الأكثر مبيعاً"
                  }
                />
              </div>

              {/* Color picker */}
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-slate-400">
                  اللون
                </label>
                <div className="flex gap-2">
                  {PANEL_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm((f) => f && { ...f, color: c })}
                      className={cn(
                        "h-8 w-8 rounded-full transition-all",
                        form.color === c &&
                          "ring-2 ring-slate-800 ring-offset-2 scale-110 dark:ring-slate-200",
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {/* Category picker */}
              {form.type === "category" && (
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-slate-400">
                    الفئة
                  </label>
                  {categories.length === 0 ? (
                    <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-400 dark:bg-slate-800">
                      لا توجد فئات في المخزون. أضف فئة للمنتجات من صفحة المنتجات أولاً.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {categories.map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setForm((f) => f && { ...f, category: cat })}
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-sm font-semibold transition",
                            form.category === cat
                              ? "border-sky-500 bg-sky-100 text-sky-700 dark:border-sky-500 dark:bg-sky-900/50 dark:text-sky-300"
                              : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
                          )}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Most-sold top N */}
              {form.type === "most-sold" && (
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-slate-400">
                    عدد المواد المعروضة
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {[5, 10, 15, 20, 30, 50].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setForm((f) => f && { ...f, topN: n })}
                        className={cn(
                          "rounded-xl border px-4 py-2 text-sm font-bold transition",
                          form.topN === n
                            ? "border-amber-500 bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                            : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800",
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-slate-400">
                    يتتبع النظام مبيعاتك محلياً ويعرض المواد الأكثر طلباً في أعلى القائمة.
                  </p>
                </div>
              )}

              {/* Box product picker */}
              {form.type === "box" && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-600 dark:text-slate-400">
                      المواد
                    </label>
                    <span className="text-xs text-slate-400">{form.productIds.length} مختار</span>
                  </div>
                  <Input
                    value={boxSearch}
                    onChange={(e) => setBoxSearch(e.target.value)}
                    placeholder="ابحث عن مادة..."
                    className="mb-2"
                  />
                  <div className="max-h-52 overflow-y-auto rounded-xl border dark:border-slate-700">
                    {filteredBoxProducts.length === 0 ? (
                      <div className="py-6 text-center text-sm text-slate-400">لا توجد نتائج</div>
                    ) : (
                      filteredBoxProducts.map((product) => {
                        const selected = form.productIds.includes(product.id)
                        return (
                          <button
                            key={product.id}
                            type="button"
                            onClick={() => toggleProduct(product.id)}
                            className={cn(
                              "flex w-full items-center gap-2.5 border-b px-3 py-2 text-right transition last:border-b-0 dark:border-slate-700",
                              selected
                                ? "bg-violet-50 dark:bg-violet-950/30"
                                : "hover:bg-slate-50 dark:hover:bg-slate-800",
                            )}
                          >
                            <div
                              className={cn(
                                "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                selected
                                  ? "border-violet-500 bg-violet-500"
                                  : "border-slate-300 dark:border-slate-600",
                              )}
                            >
                              {selected && (
                                <span className="text-[10px] font-bold text-white">✓</span>
                              )}
                            </div>
                            <span className="flex-1 truncate text-sm">{product.name}</span>
                            <span className="shrink-0 text-xs text-slate-400">
                              {fmt(product.salePrice)}
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>

                  {/* Selected products chips */}
                  {form.productIds.length > 0 && (
                    <div className="mt-3">
                      <div className="mb-1 text-[11px] text-slate-500">
                        ترتيب المختارين (يمكن إزالة أي مادة بالضغط عليها):
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {form.productIds.map((id) => {
                          const p = products.find((x) => x.id === id)
                          return p ? (
                            <span
                              key={id}
                              className="flex cursor-pointer items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700 transition hover:bg-rose-100 hover:text-rose-700 dark:bg-violet-900/40 dark:text-violet-300"
                              onClick={() => toggleProduct(id)}
                            >
                              {p.name}
                              <X className="h-3 w-3" />
                            </span>
                          ) : null
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Save */}
            <div className="shrink-0 border-t p-3 dark:border-slate-700">
              <button
                onClick={saveForm}
                disabled={
                  !form.label.trim() ||
                  (form.type === "category" && !form.category)
                }
                className="w-full rounded-xl bg-emerald-600 py-2.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                {form.mode === "add" ? "إضافة اللوحة" : "حفظ التغييرات"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main POS Component ────────────────────────────────────────────
export function POSPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const barcodeInputRef = useRef<HTMLInputElement>(null)
  const paidInputRef = useRef<HTMLInputElement>(null)
  const clientRequestIdRef = useRef(crypto.randomUUID())
  const itemsRef = useRef<PosItem[]>([])
  const posConfigRef = useRef<PosConfig>(loadConfig())

  const [customerQuery, setCustomerQuery] = useState("")
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [productQuery, setProductQuery] = useState("")
  const [items, setItems] = useState<PosItem[]>([])
  const [paid, setPaid] = useState("")
  const [message, setMessage] = useState("")
  const [lastReceipt, setLastReceipt] = useState<{ inv: PrintInvoice; store: PrintStore } | null>(null)
  const [showCustomerPicker, setShowCustomerPicker] = useState(false)
  const [posConfig, setPosConfig] = useState<PosConfig>(loadConfig)
  const [activePanel, setActivePanel] = useState<string | null>(null)
  const [showCustomize, setShowCustomize] = useState(false)
  const [shopStockAlert, setShopStockAlert] = useState<Product | null>(null)

  // Keep callback snapshots synchronized after React commits the latest state.
  useEffect(() => {
    itemsRef.current = items
  }, [items])
  useEffect(() => {
    posConfigRef.current = posConfig
  }, [posConfig])

  function updateConfig(c: PosConfig) {
    setPosConfig(c)
    posConfigRef.current = c
    saveConfig(c)
  }

  const { data: customers = [] } = useQuery({
    queryKey: ["customers", "pos"],
    queryFn: () => getCustomers({ limit: 2000 }),
  })
  const { data: products = [] } = useQuery({
    queryKey: ["products", "pos"],
    queryFn: () => getProducts({ limit: 300 }),
  })
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: getSettings, staleTime: 60_000 })

  const customerSuggestions = useMemo(() => {
    const q = normalize(customerQuery)
    if (!q) return customers.slice(0, 12)
    return customers
      .filter((c) => normalize(c.name).includes(q) || normalize(c.phone).includes(q))
      .slice(0, 12)
  }, [customers, customerQuery])

  // Products filtered by active panel + search query
  const displayedProducts = useMemo(() => {
    let base = products

    if (activePanel) {
      const panel = posConfig.panels.find((p) => p.id === activePanel)
      if (panel) {
        if (panel.type === "category") {
          base = base.filter(
            (p) => normalize(p.category ?? "") === normalize(panel.category),
          )
        } else if (panel.type === "box") {
          const idSet = new Set(panel.productIds)
          const ordered = panel.productIds
            .map((id) => base.find((p) => p.id === id))
            .filter((p): p is Product => p !== undefined)
          base = [...ordered, ...base.filter((p) => !idSet.has(p.id) && false)]
          // only show exactly the box items, in order
          base = ordered
        } else if (panel.type === "most-sold") {
          const counts = posConfig.salesCounts
          const sorted = [...base].sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0))
          base = sorted.slice(0, panel.topN)
        }
      }
    }

    if (productQuery) {
      base = base.filter((p) => productMatches(p, productQuery))
    }

    return base.slice(0, 100)
  }, [products, activePanel, posConfig, productQuery])

  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
  const paidValue = Number(paid || 0)
  const financials = calculateInvoiceFinancials({ type: "SALE", subtotal, paidAmount: paidValue })
  const remaining = financials.remainingAmount
  const change = financials.overpayment

  function chooseCustomer(c: Customer) {
    setSelectedCustomer(c)
    setCustomerQuery(c.name)
    setShowCustomerPicker(false)
    setTimeout(() => barcodeInputRef.current?.focus(), 0)
  }

  function doAddProduct(product: Product, preferredCode = productQuery, overrideWarehouseId?: string) {
    const unit = detectUnit(product, preferredCode)
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === product.id && i.unit === unit && i.warehouseId === overrideWarehouseId)
      if (existing) {
        return prev.map((i) =>
          i.lineId === existing.lineId ? { ...i, quantity: i.quantity + 1 } : i,
        )
      }
      return [
        ...prev,
        {
          lineId: crypto.randomUUID(),
          productId: product.id,
          warehouseId: overrideWarehouseId, // undefined → backend uses المحل
          name: product.name,
          unit,
          quantity: 1,
          unitPrice: priceFor(product, unit),
        },
      ]
    })
    setProductQuery("")
    setMessage("")
    setTimeout(() => barcodeInputRef.current?.focus(), 0)
  }

  function addProduct(product: Product, preferredCode = productQuery) {
    const shopStock = product.shopStock ?? 0
    if (shopStock === 0) {
      const alt = bestAlternativeWarehouse(product)
      if (alt) {
        setShopStockAlert(product)
        return
      }
    }
    doAddProduct(product, preferredCode)
  }

  function addBySearch() {
    if (!normalize(productQuery)) return
    // findProductByScan tolerates an Arabic-keyboard-garbled scan (mobile).
    const found = findProductByScan(products, productQuery)
    if (found) addProduct(found.product, found.isCarton ? found.product.cartonQrCode ?? productQuery : productQuery)
    else if (displayedProducts.length > 0) addProduct(displayedProducts[0])
  }

  // Hardware scanner: works under an Arabic keyboard layout on desktop (physical
  // keys) AND mobile (de-arabicizing the garbled code).
  function addByCode(code: string) {
    if (!normalize(code)) return
    const found = findProductByScan(products, code)
    if (found) { addProduct(found.product, found.isCarton ? found.product.cartonQrCode ?? code : code); return }
    setProductQuery(code)
    setMessage("ماكو مادة بهذا الباركود")
    setTimeout(() => barcodeInputRef.current?.focus(), 0)
  }

  function adjustQty(lineId: string, delta: number) {
    setItems((prev) =>
      prev
        .map((i) => (i.lineId === lineId ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0),
    )
  }

  function handleBarcodeKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault()
      addBySearch()
    }
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      createInvoice({
        customerId: selectedCustomer?.id ?? "",
        type: "SALE",
        clientRequestId: clientRequestIdRef.current,
        discount: 0,
        tax: 0,
        paidAmount: financials.paidAmount,
        paymentType: financials.paymentType,
        items: items.map((item) => ({
          productId: item.productId,
          warehouseId: item.warehouseId,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      }),
    onSuccess: (response) => {
      // Track sales counts
      const newCounts = { ...posConfigRef.current.salesCounts }
      itemsRef.current.forEach((item) => {
        newCounts[item.productId] = (newCounts[item.productId] ?? 0) + item.quantity
      })
      updateConfig({ ...posConfigRef.current, salesCounts: newCounts })

      const inv = response.data
      if (inv) {
        setLastReceipt({
          inv: {
            number: inv.invoiceNumber,
            date: inv.date,
            customerName: inv.customer?.name ?? inv.customerId,
            customerPhone: inv.customer?.phone,
            lines: itemsRef.current.map((it) => ({
              name: it.name,
              qty: it.quantity,
              price: it.unitPrice,
            })),
            paidAmount: inv.paidAmount,
            remainingAmount: inv.remainingAmount,
            previousBalance: inv.previousBalance,
            notes: inv.notes ?? undefined,
          },
          store: {
            storeName: settings?.storeName ?? "المحل",
            storeLogo: settings?.storeLogo ?? undefined,
            storePhone: settings?.storePhone ?? undefined,
            storeAddress: settings?.storeAddress ?? undefined,
            currency: settings?.currency ?? "د.ع",
          },
        })
      }

      setMessage(`✓ فاتورة ${response.data?.invoiceNumber ?? ""} — تم الحفظ`)
      setItems([])
      setPaid("")
      setProductQuery("")
      clientRequestIdRef.current = crypto.randomUUID()
      void queryClient.invalidateQueries({ queryKey: ["invoices"] })
      void queryClient.invalidateQueries({ queryKey: ["products"] })
      void queryClient.invalidateQueries({ queryKey: ["customers"] })
      setTimeout(() => barcodeInputRef.current?.focus(), 0)
    },
    onError: () => {
      clientRequestIdRef.current = crypto.randomUUID()
    },
  })

  function printReceipt(data: { inv: PrintInvoice; store: PrintStore }) {
    const tmpl = parseTemplate(settings?.invoiceTemplate)
    const html = renderInvoiceHTML(tmpl, data.inv, data.store)
    const iframe = document.createElement("iframe")
    iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:0"
    document.body.appendChild(iframe)
    iframe.contentDocument?.open()
    iframe.contentDocument?.write(html)
    iframe.contentDocument?.close()
    iframe.onload = () => {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      setTimeout(() => document.body.removeChild(iframe), 2000)
    }
  }

  // Hardware barcode gun — layout-independent, works while the search box is
  // focused. Disabled while a panel/modal owns the screen.
  useBarcodeScanner({ onScan: addByCode, enabled: activePanel === null && !shopStockAlert })

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        if (selectedCustomer && items.length > 0 && !saveMutation.isPending) saveMutation.mutate()
      }
      if (event.key === "F8") {
        event.preventDefault()
        paidInputRef.current?.focus()
      }
      if (event.key === "Escape") {
        event.preventDefault()
        if (activePanel !== null) {
          setActivePanel(null)
        } else {
          navigate("/")
        }
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [selectedCustomer, items, saveMutation, navigate, activePanel])

  const canSave = !!selectedCustomer && items.length > 0 && !saveMutation.isPending

  const quickAmounts = [
    ...new Set([
      subtotal,
      Math.ceil(subtotal / 1000) * 1000,
      Math.ceil(subtotal / 5000) * 5000,
    ]),
  ].filter((v) => v > 0)

  // Panel type -> icon
  const panelIcons = {
    category: <Tag className="h-3 w-3" />,
    box: <Package className="h-3 w-3" />,
    "most-sold": <Star className="h-3 w-3" />,
  }

  return (
    <div className="flex h-full flex-col gap-2" dir="rtl">
      {/* ── Top bar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Barcode className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            ref={barcodeInputRef}
            className="pr-9 text-base"
            value={productQuery}
            onChange={(e) => setProductQuery(e.target.value)}
            onKeyDown={handleBarcodeKey}
            placeholder="باركود أو اسم المادة — Enter للإضافة"
            autoFocus
          />
        </div>
        {productQuery && (
          <button
            type="button"
            onClick={addBySearch}
            className="rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700 active:scale-95"
          >
            إضافة
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowCustomerPicker(true)}
          className={cn(
            "flex min-w-36 items-center gap-2 rounded-lg border px-3 py-2 text-sm transition",
            selectedCustomer
              ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900",
          )}
        >
          <UserRound className="h-4 w-4 shrink-0" />
          <span className="truncate font-semibold">{selectedCustomer?.name ?? "اختر الزبون"}</span>
        </button>
        <button
          type="button"
          onClick={() => setShowCustomize(true)}
          title="تخصيص الكاشير"
          className="rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <Settings2 className="h-5 w-5" />
        </button>
      </div>

      {/* ── Quick panel tabs ── */}
      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto pb-0.5">
        {/* "الكل" always first */}
        <button
          type="button"
          onClick={() => setActivePanel(null)}
          className={cn(
            "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition",
            activePanel === null
              ? "bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700",
          )}
        >
          الكل
        </button>

        {posConfig.panels.map((panel) => {
          const isActive = activePanel === panel.id
          return (
            <button
              key={panel.id}
              type="button"
              onClick={() => setActivePanel(isActive ? null : panel.id)}
              style={isActive ? { backgroundColor: panel.color, color: "white" } : {}}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition",
                isActive
                  ? ""
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700",
              )}
            >
              {panelIcons[panel.type]}
              {panel.label}
              {panel.type === "most-sold" && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0 text-[10px] font-bold",
                    isActive ? "bg-white/25" : "bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400",
                  )}
                >
                  {(panel as MostSoldPanel).topN}
                </span>
              )}
              {panel.type === "box" && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0 text-[10px] font-bold",
                    isActive ? "bg-white/25" : "bg-violet-100 text-violet-600 dark:bg-violet-900/50 dark:text-violet-400",
                  )}
                >
                  {(panel as BoxPanel).productIds.length}
                </span>
              )}
            </button>
          )
        })}

        {posConfig.panels.length === 0 && (
          <button
            type="button"
            onClick={() => setShowCustomize(true)}
            className="shrink-0 rounded-full border border-dashed border-slate-300 px-3 py-1 text-xs text-slate-400 transition hover:border-slate-400 hover:text-slate-600 dark:border-slate-600 dark:text-slate-500 dark:hover:border-slate-500"
          >
            + أضف لوحة وصول سريع
          </button>
        )}
      </div>

      {/* ── Main: products grid + cart ── */}
      <div className="flex min-h-0 flex-1 gap-2">
        {/* Products grid */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          {productQuery ? (
            <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs text-slate-500 dark:border-slate-700">
              <Search className="h-3 w-3" />
              {displayedProducts.length} نتيجة
              <button
                type="button"
                onClick={() => setProductQuery("")}
                className="mr-auto text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : activePanel ? (
            <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1 text-xs text-slate-500 dark:border-slate-700">
              {(() => {
                const panel = posConfig.panels.find((p) => p.id === activePanel)
                return (
                  <>
                    <button
                      type="button"
                      onClick={() => setActivePanel(null)}
                      className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      <ArrowRight className="h-3 w-3" />
                      رجوع
                    </button>
                    <span
                      className="flex h-4 w-4 items-center justify-center rounded-full text-white"
                      style={{ backgroundColor: panel?.color }}
                    >
                      {panel ? panelIcons[panel.type] : null}
                    </span>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      {panel?.label}
                    </span>
                    <span className="text-slate-400">{displayedProducts.length} مادة</span>
                  </>
                )
              })()}
            </div>
          ) : null}

          <div className="grid min-h-0 flex-1 auto-rows-max gap-1.5 overflow-y-auto p-1.5 grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {displayedProducts.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => addProduct(product)}
                className="flex flex-col items-center justify-between rounded-xl border-2 border-transparent bg-slate-50 p-2 text-center transition active:scale-95 hover:border-emerald-400 hover:bg-emerald-50 dark:bg-slate-800 dark:hover:border-emerald-600 dark:hover:bg-emerald-950/30"
                style={{ minHeight: "84px" }}
              >
                <span className="line-clamp-2 w-full text-xs font-bold leading-tight text-slate-800 dark:text-slate-100">
                  {product.name}
                </span>
                <div className="mt-1 flex flex-col items-center gap-0.5">
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                    {fmt(product.salePrice)}
                  </span>
                  {(() => {
                    // Sales come from المحل only — show المحل stock, not the all-warehouse total.
                    const shop = Number(product.shopStock ?? product.currentStock ?? 0)
                    if (shop <= 0) return <span className="text-[9px] font-semibold text-rose-500">نفد من المحل</span>
                    return <span className="text-[9px] text-slate-400">المحل: {fmt(shop)} قطعة</span>
                  })()}
                </div>
              </button>
            ))}
            {displayedProducts.length === 0 && (
              <div className="col-span-full py-16 text-center text-slate-400">
                {activePanel ? "لا توجد مواد في هذه اللوحة" : "لا توجد مواد مطابقة"}
              </div>
            )}
          </div>
        </div>

        {/* ── Cart / Receipt ── */}
        <div className="flex w-64 shrink-0 flex-col overflow-hidden rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:w-72 xl:w-80">
          {/* Cart header */}
          <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5 dark:border-slate-700">
            <span className="font-bold">الكاشير</span>
            {items.length > 0 && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold dark:bg-slate-800">
                {items.length}
              </span>
            )}
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => setItems([])}
                className="mr-auto text-xs text-slate-400 hover:text-rose-600"
              >
                مسح الكل
              </button>
            )}
          </div>

          {/* Cart items */}
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
            {items.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-400">اضغط على مادة لإضافتها</div>
            ) : (
              <div className="space-y-1">
                {items.map((item) => (
                  <div
                    key={item.lineId}
                    className="flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-800"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold leading-tight">{item.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {fmt(item.unitPrice)} ×{" "}
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {fmt(item.quantity * item.unitPrice)}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => adjustQty(item.lineId, -1)}
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-slate-700 active:bg-rose-100 dark:bg-slate-700 dark:text-slate-200"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-6 text-center text-sm font-bold">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => adjustQty(item.lineId, 1)}
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 active:bg-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-300"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustQty(item.lineId, -item.quantity)}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-slate-300 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Payment section */}
          <div className="shrink-0 space-y-2 border-t p-3 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">الإجمالي</span>
              <span className="text-xl font-bold">{fmt(subtotal)}</span>
            </div>

            <Input
              ref={paidInputRef}
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
              type="number"
              placeholder="المبلغ المدفوع (F8)"
              className="text-center text-base font-bold"
              inputMode="numeric"
              onFocus={(e) => e.target.select()}
            />

            {subtotal > 0 && (
              <div className="grid grid-cols-3 gap-1">
                {quickAmounts.map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => setPaid(String(amount))}
                    className="rounded-lg bg-slate-100 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200 active:bg-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    {fmt(amount)}
                  </button>
                ))}
              </div>
            )}

            {remaining > 0 && (
              <div className="flex items-center justify-between rounded-md bg-amber-50 px-3 py-1.5 text-sm dark:bg-amber-950/30">
                <span className="text-slate-500">باقي</span>
                <span className="font-bold text-amber-700 dark:text-amber-400">{fmt(remaining)}</span>
              </div>
            )}
            {change > 0 && (
              <div className="flex items-center justify-between rounded-md bg-emerald-50 px-3 py-1.5 text-sm dark:bg-emerald-950/30">
                <span className="text-slate-500">راجع</span>
                <span className="font-bold text-emerald-700 dark:text-emerald-400">{fmt(change)}</span>
              </div>
            )}

            <button
              type="button"
              disabled={!canSave}
              onClick={() => saveMutation.mutate()}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-base font-bold text-white shadow transition active:scale-[.98] disabled:opacity-40 hover:bg-emerald-700"
            >
              <Banknote className="h-5 w-5" />
              {saveMutation.isPending ? "جاري الحفظ..." : "حفظ البيع"}
            </button>

            {!selectedCustomer && (
              <p className="text-center text-xs text-amber-600">اختر الزبون أولاً</p>
            )}

            <p className="text-center text-[10px] text-slate-400">Ctrl+S حفظ | F8 المبلغ | Esc خروج</p>

            {message && (
              <div className="space-y-2">
                <div className="rounded-md bg-emerald-50 p-2 text-center text-sm font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  {message}
                </div>
                {lastReceipt && (
                  <button
                    type="button"
                    onClick={() => printReceipt(lastReceipt)}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 active:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <Printer className="h-4 w-4" />
                    طباعة الإيصال
                  </button>
                )}
              </div>
            )}
            {saveMutation.isError && (
              <div className="rounded-md bg-rose-50 p-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                {apiErrorMessage(saveMutation.error, "تعذر حفظ البيع")}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Shop-stock alert modal ── */}
      {shopStockAlert && (() => {
        const p = shopStockAlert
        const alts = (p.warehouseStocks ?? []).filter((ws) => ws.quantityPieces > 0)
        return (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={() => setShopStockAlert(null)}>
            <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold text-slate-800 dark:text-slate-100">{p.name}</h3>
                  <p className="text-xs text-rose-600 mt-0.5">نفد من المحل — المخزون موجود في مخازن أخرى</p>
                </div>
                <button type="button" onClick={() => setShopStockAlert(null)} className="rounded-full p-1 hover:bg-slate-100 dark:hover:bg-slate-800">
                  <X className="h-4 w-4 text-slate-500" />
                </button>
              </div>
              <div className="space-y-2">
                {alts.map((ws) => (
                  <button
                    key={ws.warehouseId}
                    type="button"
                    className="flex w-full items-center justify-between rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-right font-semibold text-sky-800 transition hover:bg-sky-100 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200 dark:hover:bg-sky-900/60"
                    onClick={() => { doAddProduct(p, productQuery, ws.warehouseId); setShopStockAlert(null) }}
                  >
                    <span>📦 سحب من {ws.warehouse?.name ?? ws.warehouseId}</span>
                    <span className="text-sm text-sky-600 dark:text-sky-400">{ws.quantityPieces} قطعة</span>
                  </button>
                ))}
                <button
                  type="button"
                  className="w-full rounded-xl border border-slate-200 py-2.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  onClick={() => { doAddProduct(p, productQuery, undefined); setShopStockAlert(null) }}
                >
                  إضافة بدون تحديد مخزن
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Customize Modal ── */}
      {showCustomize && (
        <CustomizeModal
          config={posConfig}
          products={products}
          onClose={() => setShowCustomize(false)}
          onChange={updateConfig}
        />
      )}

      {/* ── Customer picker modal ── */}
      {showCustomerPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-bold">اختر الزبون</h3>
              <button
                type="button"
                onClick={() => setShowCustomerPicker(false)}
                className="rounded-full p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            <Input
              autoFocus
              value={customerQuery}
              onChange={(e) => {
                setCustomerQuery(e.target.value)
                setSelectedCustomer(null)
              }}
              placeholder="اسم أو هاتف الزبون"
              className="mb-2"
            />
            <div className="max-h-72 space-y-1 overflow-auto">
              {customerSuggestions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-right hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => chooseCustomer(c)}
                >
                  <span className="font-bold">{c.name}</span>
                  <span className="text-xs text-slate-500">{c.phone}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
