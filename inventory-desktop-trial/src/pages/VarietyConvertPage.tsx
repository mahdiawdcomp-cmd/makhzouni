/**
 * Unified Inventory Transfer Page
 *
 * Mode A — Normal transfer:   product X from warehouse A → same product X in warehouse B
 * Mode B — Variety convert:   multiple named items → one generic "variety" product
 *                             (supports same-warehouse "open-carton" case)
 *
 * Rules enforced:
 *  • Normal transfer only when fromWarehouse ≠ toWarehouse.
 *  • Product search limited to items with qty > 0 in fromWarehouse.
 *  • Variety mode: source items additionally filtered by target product's typeTags.
 *  • Qty capped at available warehouse stock.
 *  • Purchase price hidden from VARIETY_CONVERT users.
 */

import { useMemo, useState, useRef, useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftRight,
  Boxes,
  Building2,
  ChevronDown,
  MoveRight,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { Link } from "react-router-dom"
import { getBranches, convertToVariety, createTransfer } from "../api/endpoints"
import { useProducts } from "../hooks/useProducts"
import { useAuthStore } from "../store/authStore"
import type { Product } from "../types/api"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { toast } from "../components/ui/use-toast"

// ── Unit helpers ───────────────────────────────────────────────────────────────

type Unit = "PIECE" | "DOZEN" | "BOX" | "CARTON"
const UNIT_LABEL: Record<Unit, string> = {
  PIECE: "قطعة",
  DOZEN: "درزن",
  BOX: "علبة",
  CARTON: "كرتونة",
}

function piecesOf(product: Product, unit: Unit, quantity: number): number {
  const n = Math.max(1, product.pcsPerCarton)
  if (unit === "CARTON") return quantity * n
  if (unit === "BOX") return quantity * Math.ceil(n / 2)
  if (unit === "DOZEN") return quantity * 12
  return quantity
}

function maxUnitsForStock(availablePieces: number, product: Product, unit: Unit): number {
  const n = Math.max(1, product.pcsPerCarton)
  if (unit === "CARTON") return Math.floor(availablePieces / n)
  if (unit === "BOX") return Math.floor(availablePieces / Math.ceil(n / 2))
  if (unit === "DOZEN") return Math.floor(availablePieces / 12)
  return availablePieces
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function warehouseStock(product: Product, warehouseId: string): number {
  return product.warehouseStocks?.find((s) => s.warehouseId === warehouseId)?.quantityPieces ?? 0
}

function normalize(s: string) {
  return s.trim().toLowerCase()
}

// ── Types ──────────────────────────────────────────────────────────────────────

type TransferType = "NORMAL" | "VARIETY"

interface Row {
  product: Product
  unit: Unit
  quantity: number
  availablePieces: number
}

// ── Component ──────────────────────────────────────────────────────────────────

export function VarietyConvertPage() {
  const qc = useQueryClient()
  const { productsQuery } = useProducts()
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data])
  const { data: branches = [] } = useQuery({
    queryKey: ["branches"],
    queryFn: () => getBranches({ isActive: true }),
  })

  const isAdmin = useAuthStore((s) => s.user?.role === "ADMIN")
  const hasVarietyConvert = useAuthStore((s) => s.hasPermission("VARIETY_CONVERT"))
  const hasViewPurchasePrice = useAuthStore((s) => s.hasPermission("VIEW_PURCHASE_PRICE"))
  const hidePrices = hasVarietyConvert && !isAdmin && !hasViewPurchasePrice

  // ── Warehouse selection ────────────────────────────────────────────────────

  const [fromWarehouseId, setFromWarehouseId] = useState("")
  const [toWarehouseId, setToWarehouseId] = useState("")

  const fromId = fromWarehouseId || branches[0]?.id || ""
  const toId = toWarehouseId || branches[1]?.id || branches[0]?.id || ""
  const sameWarehouse = fromId === toId

  // ── Transfer type ─────────────────────────────────────────────────────────

  const [transferType, setTransferType] = useState<TransferType>("VARIETY")
  const effectiveType: TransferType = sameWarehouse ? "VARIETY" : transferType

  // ── Target product (variety mode) ─────────────────────────────────────────

  const [targetSearch, setTargetSearch] = useState("")
  const [targetProductId, setTargetProductId] = useState("")
  const [targetDropOpen, setTargetDropOpen] = useState(false)
  const targetRef = useRef<HTMLDivElement>(null)

  const targetProduct = useMemo(
    () => products.find((p) => p.id === targetProductId) ?? null,
    [products, targetProductId],
  )

  const targetMatches = useMemo(() => {
    const q = normalize(targetSearch)
    if (!q || targetProductId) return []
    return products
      .filter((p) => normalize(p.name).includes(q) || normalize(p.itemNumber).includes(q))
      .slice(0, 8)
  }, [targetSearch, products, targetProductId])

  function selectTarget(p: Product) {
    setTargetProductId(p.id)
    setTargetSearch(p.name)
    setTargetDropOpen(false)
  }
  function clearTarget() {
    setTargetProductId("")
    setTargetSearch("")
    setTargetDropOpen(false)
  }

  // ── Product search ────────────────────────────────────────────────────────

  const [search, setSearch] = useState("")

  const targetTags = useMemo<string[]>(() => {
    if (!targetProduct) return []
    return [...(targetProduct.typeTags ?? []), ...(targetProduct.categoryTags ?? [])]
  }, [targetProduct])

  const matches = useMemo(() => {
    if (!fromId) return []
    const q = normalize(search)
    return products
      .filter((p) => {
        if (warehouseStock(p, fromId) <= 0) return false
        if (p.id === targetProductId) return false
        if (effectiveType === "VARIETY" && targetProductId && targetTags.length > 0) {
          const pTags = [...(p.typeTags ?? []), ...(p.categoryTags ?? [])]
          if (!targetTags.some((t) => pTags.includes(t))) return false
        }
        if (!q) return false
        return [p.name, p.itemNumber, p.qrCode ?? "", p.cartonQrCode ?? ""].some((v) =>
          normalize(v).includes(q),
        )
      })
      .slice(0, 12)
  }, [search, products, fromId, targetProductId, effectiveType, targetTags])

  // ── Rows ──────────────────────────────────────────────────────────────────

  const [rows, setRows] = useState<Row[]>([])

  const addRow = useCallback(
    (product: Product, unit: Unit = "PIECE") => {
      const availablePieces = warehouseStock(product, fromId)
      setRows((prev) => {
        const existing = prev.find((r) => r.product.id === product.id && r.unit === unit)
        if (existing) {
          const newQty = Math.min(
            existing.quantity + 1,
            maxUnitsForStock(existing.availablePieces, existing.product, existing.unit),
          )
          return prev.map((r) => (r === existing ? { ...r, quantity: newQty } : r))
        }
        return [...prev, { product, unit, quantity: 1, availablePieces }]
      })
      setSearch("")
    },
    [fromId],
  )

  function addByCode(code: string) {
    const c = normalize(code)
    if (!c) return
    const hit =
      products.find((p) => normalize(p.qrCode ?? "") === c) ??
      products.find((p) => normalize(p.cartonQrCode ?? "") === c) ??
      products.find((p) => normalize(p.itemNumber) === c)
    if (!hit) {
      toast({ title: "لا توجد مادة بهذا الرمز", variant: "destructive" })
      return
    }
    const stock = warehouseStock(hit, fromId)
    if (stock <= 0) {
      toast({
        title: "المادة غير متوفرة في المخزن المحدد",
        description: `${hit.name} — المتوفر: 0`,
        variant: "destructive",
      })
      return
    }
    addRow(hit, normalize(hit.cartonQrCode ?? "") === c ? "CARTON" : "PIECE")
  }

  function handleFromChange(id: string) {
    setFromWarehouseId(id)
    setRows([]) // clear rows when warehouse changes
  }

  // ── Totals + validation ───────────────────────────────────────────────────

  const totalPieces = rows.reduce((s, r) => s + piecesOf(r.product, r.unit, r.quantity), 0)
  const hasExceeded = rows.some((r) => piecesOf(r.product, r.unit, r.quantity) > r.availablePieces)

  // ── Submit ────────────────────────────────────────────────────────────────

  const normalMutation = useMutation({
    mutationFn: () =>
      createTransfer({
        fromBranchId: fromId,
        toBranchId: toId,
        items: rows.map((r) => ({ productId: r.product.id, unit: r.unit, quantity: r.quantity })),
      }),
    onSuccess: (res) => {
      const isApproval = res && "approvalId" in res
      toast({
        title: isApproval
          ? `طلب النقل أُرسل للموافقة — ${totalPieces} قطعة`
          : `تم النقل — ${totalPieces} قطعة بنجاح`,
      })
      setRows([])
      void qc.invalidateQueries({ queryKey: ["products"] })
      void qc.invalidateQueries({ queryKey: ["transfers"] })
    },
    onError: (e: unknown) => {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ?? "تعذّر النقل"
      toast({ title: "خطأ", description: msg, variant: "destructive" })
    },
  })

  const varietyMutation = useMutation({
    mutationFn: () =>
      convertToVariety({
        fromWarehouseId: fromId,
        targetProductId,
        toWarehouseId: toId,
        items: rows.map((r) => ({ productId: r.product.id, unit: r.unit, quantity: r.quantity })),
      }),
    onSuccess: (res) => {
      toast({
        title: `تم التحويل — ${res?.addedPieces ?? totalPieces} قطعة → "${res?.targetProductName ?? "المتنوع"}"`,
      })
      setRows([])
      void qc.invalidateQueries({ queryKey: ["products"] })
    },
    onError: (e: unknown) => {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ?? "تعذّر التحويل"
      toast({ title: "خطأ", description: msg, variant: "destructive" })
    },
  })

  const isPending = normalMutation.isPending || varietyMutation.isPending

  function handleSubmit() {
    if (hasExceeded) return
    if (effectiveType === "NORMAL") normalMutation.mutate()
    else varietyMutation.mutate()
  }

  const canSubmit =
    !!fromId &&
    !!toId &&
    rows.length > 0 &&
    !isPending &&
    !hasExceeded &&
    (effectiveType === "NORMAL" || !!targetProductId)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ArrowLeftRight className="h-6 w-6 text-indigo-600" />
            نقل المخزون / تحويل متنوع
          </h1>
          <p className="text-sm text-slate-500">نقل بين المخازن أو تحويل مواد إلى مادة متنوعة</p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/inventory">
            <Building2 className="h-4 w-4" /> المخزن
          </Link>
        </Button>
      </div>

      {/* ── Step 1: Warehouse selectors + type ───────────────────────────── */}
      <div className="rounded-xl border bg-white p-4 dark:bg-slate-950 space-y-4">
        <p className="text-xs font-bold tracking-wider text-slate-400 uppercase">الخطوة ١ — المخازن ونوع العملية</p>

        {/* From / To selectors */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <div className="space-y-1">
            <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">من المخزن</label>
            <div className="relative">
              <select
                className="h-10 w-full appearance-none rounded-lg border px-3 pr-8 text-sm dark:border-slate-700 dark:bg-slate-900"
                value={fromId}
                onChange={(e) => handleFromChange(e.target.value)}
              >
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          <MoveRight className="h-5 w-5 text-slate-300 mb-2.5 shrink-0" />

          <div className="space-y-1">
            <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">إلى المخزن</label>
            <div className="relative">
              <select
                className="h-10 w-full appearance-none rounded-lg border px-3 pr-8 text-sm dark:border-slate-700 dark:bg-slate-900"
                value={toId}
                onChange={(e) => setToWarehouseId(e.target.value)}
              >
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </div>
        </div>

        {/* Operation type */}
        <div className="space-y-1">
          <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">نوع العملية</label>
          <div className="flex gap-2">
            {!sameWarehouse && (
              <button
                type="button"
                onClick={() => {
                  setTransferType("NORMAL")
                  clearTarget()
                }}
                className={`flex-1 rounded-xl border py-2.5 text-sm font-semibold transition ${
                  effectiveType === "NORMAL"
                    ? "border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-600 dark:bg-blue-950/30 dark:text-blue-300"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                }`}
              >
                📦 نقل عادي
                <span className="block text-xs font-normal opacity-70 mt-0.5">نفس المادة — مخزن مختلف</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setTransferType("VARIETY")}
              className={`flex-1 rounded-xl border py-2.5 text-sm font-semibold transition ${
                effectiveType === "VARIETY"
                  ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-600 dark:bg-indigo-950/30 dark:text-indigo-300"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              }`}
            >
              <Boxes className="inline h-4 w-4 mr-1 mb-0.5" />
              {sameWarehouse ? "فتح كارتون / متنوع" : "تحويل إلى متنوع"}
              <span className="block text-xs font-normal opacity-70 mt-0.5">
                {sameWarehouse ? "فتح كارتون داخل نفس المخزن" : "تجميع مواد في مادة واحدة"}
              </span>
            </button>
          </div>
          {sameWarehouse && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              ⚠ نفس المخزن — النقل العادي غير متاح. فقط فتح كارتون / تحويل متنوع.
            </p>
          )}
        </div>

        {/* Target product — variety mode only */}
        {effectiveType === "VARIETY" && (
          <div className="space-y-1" ref={targetRef}>
            <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              المادة الهدف (المتنوعة)
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={targetSearch}
                onChange={(e) => {
                  setTargetSearch(e.target.value)
                  if (targetProductId) clearTarget()
                  setTargetDropOpen(true)
                }}
                onFocus={() => setTargetDropOpen(true)}
                placeholder="مثال: حاجة الف منوع"
                className="pr-9"
              />
              {targetProductId && (
                <button
                  type="button"
                  onClick={clearTarget}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {targetDropOpen && targetMatches.length > 0 && (
              <div className="relative z-50">
                <div className="absolute left-0 right-0 top-0 rounded-lg border bg-white shadow-lg dark:bg-slate-900 dark:border-slate-700">
                  {targetMatches.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onMouseDown={() => selectTarget(p)}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-right text-sm hover:bg-indigo-50 dark:hover:bg-slate-800"
                    >
                      {(p.thumbnailUrl || p.imageUrl) && (
                        <img src={p.thumbnailUrl || p.imageUrl || ""} alt="" className="h-8 w-8 rounded object-cover shrink-0" />
                      )}
                      <span className="font-medium flex-1">{p.name}</span>
                      <span className="text-xs text-slate-400">{p.itemNumber}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {targetProduct ? (
              <div className="flex items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 dark:border-indigo-800 dark:bg-indigo-950/40">
                {(targetProduct.thumbnailUrl || targetProduct.imageUrl) && (
                  <img
                    src={targetProduct.thumbnailUrl || targetProduct.imageUrl || ""}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">{targetProduct.name}</div>
                  <div className="text-xs text-indigo-400">{targetProduct.itemNumber}</div>
                  {targetTags.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {[...new Set(targetTags)].map((t) => (
                        <span key={t} className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] text-indigo-600 dark:bg-indigo-900 dark:text-indigo-300">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span className="text-xs text-indigo-400 shrink-0">الهدف</span>
              </div>
            ) : (
              targetSearch && !targetDropOpen && (
                <p className="text-xs text-rose-500">لا توجد مادة بهذا الاسم</p>
              )
            )}

            {targetProduct && targetTags.length > 0 && (
              <p className="text-xs text-slate-500">
                🔍 البحث يعرض فقط المواد التي تحمل:{" "}
                <span className="font-medium text-indigo-600">{[...new Set(targetTags)].join(" / ")}</span>
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Step 2: Product search ─────────────────────────────────────────── */}
      <div className="rounded-xl border bg-white p-4 dark:bg-slate-950 space-y-3">
        <p className="text-xs font-bold tracking-wider text-slate-400 uppercase">الخطوة ٢ — ابحث وأضف المواد</p>
        <div>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addByCode(search)
              }
            }}
            placeholder="اسم المادة / رقم الصنف / امسح الباركود ثم Enter"
          />
          <p className="mt-1 text-xs text-slate-400">مسدس الباركود → يضيف تلقائياً | يد → اكتب ثم اختر</p>
        </div>

        {matches.length > 0 && (
          <div className="divide-y rounded-lg border dark:border-slate-800 dark:divide-slate-800">
            {matches.map((p) => {
              const stock = warehouseStock(p, fromId)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addRow(p)}
                  className="flex w-full items-center gap-3 p-3 text-right hover:bg-slate-50 dark:hover:bg-slate-900"
                >
                  {(p.thumbnailUrl || p.imageUrl) ? (
                    <img
                      src={p.thumbnailUrl || p.imageUrl || ""}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="h-12 w-12 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                      <Boxes className="h-5 w-5 text-slate-400" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-xs text-slate-400">{p.itemNumber} · تعبئة {p.pcsPerCarton} قطعة/كرتون</div>
                    <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">متوفر: {stock} قطعة</div>
                    {p.typeTags && p.typeTags.length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {p.typeTags.map((t) => (
                          <span key={t} className="rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="flex items-center gap-1 text-xs font-semibold text-indigo-500 shrink-0">
                    <Plus className="h-3.5 w-3.5" /> إضافة
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {search.trim() && matches.length === 0 && (
          <p className="py-3 text-center text-sm text-slate-400">
            {effectiveType === "VARIETY" && targetProduct && targetTags.length > 0
              ? "لا توجد مواد بهذا البحث تحمل التاغ المطلوب في المخزن المحدد"
              : "لا توجد مواد بهذا البحث في المخزن المحدد"}
          </p>
        )}
      </div>

      {/* ── Step 3: Items table ────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-white dark:bg-slate-950 overflow-hidden">
        <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
          <span>قائمة المواد</span>
          {rows.length > 0 && (
            <span className="rounded-full bg-indigo-100 dark:bg-indigo-900 px-2 py-0.5 text-xs text-indigo-700 dark:text-indigo-300">
              {rows.length}
            </span>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">لم تُضف مواد بعد</p>
        ) : (
          <div className="divide-y dark:divide-slate-800">
            {rows.map((r, i) => {
              const pieces = piecesOf(r.product, r.unit, r.quantity)
              const exceeds = pieces > r.availablePieces
              const maxQty = maxUnitsForStock(r.availablePieces, r.product, r.unit)
              return (
                <div
                  key={`${r.product.id}-${r.unit}`}
                  className={`flex flex-wrap items-center gap-2 p-3 ${exceeds ? "bg-rose-50 dark:bg-rose-950/20" : ""}`}
                >
                  {(r.product.thumbnailUrl || r.product.imageUrl) ? (
                    <img
                      src={r.product.thumbnailUrl || r.product.imageUrl || ""}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="h-10 w-10 shrink-0 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                      <Boxes className="h-4 w-4 text-slate-400" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{r.product.name}</div>
                    <div className="text-xs text-slate-400">{r.product.itemNumber}</div>
                    <div className={`text-xs ${exceeds ? "text-rose-600 font-semibold" : "text-slate-400"}`}>
                      متوفر: {r.availablePieces} ق{exceeds && " ⚠ يتجاوز المتوفر"}
                    </div>
                  </div>

                  <select
                    className="h-9 rounded-lg border px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                    value={r.unit}
                    onChange={(e) => {
                      const u = e.target.value as Unit
                      setRows((prev) =>
                        prev.map((x, j) =>
                          j === i
                            ? { ...x, unit: u, quantity: Math.min(x.quantity, maxUnitsForStock(x.availablePieces, x.product, u)) }
                            : x,
                        ),
                      )
                    }}
                  >
                    {(Object.keys(UNIT_LABEL) as Unit[]).map((u) => (
                      <option key={u} value={u}>{UNIT_LABEL[u]}</option>
                    ))}
                  </select>

                  <Input
                    type="number"
                    min={1}
                    max={maxQty || undefined}
                    value={r.quantity}
                    onChange={(e) => {
                      const v = Math.max(1, Number(e.target.value) || 1)
                      setRows((prev) => prev.map((x, j) => j === i ? { ...x, quantity: v } : x))
                    }}
                    className="h-9 w-20"
                  />

                  <span className="w-20 text-right text-xs text-slate-500">{pieces} قطعة</span>

                  <button
                    type="button"
                    onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                    className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
          <div className="space-y-0.5 text-sm">
            <div>
              <span className="text-base font-bold">{totalPieces.toLocaleString()}</span>
              <span className="text-slate-500 mr-1">قطعة إجمالاً</span>
            </div>
            {effectiveType === "VARIETY" && targetProduct && (
              <div className="text-xs text-slate-400">→ {targetProduct.name}</div>
            )}
            {hasExceeded && (
              <div className="text-xs font-semibold text-rose-600">⚠ إحدى المواد تتجاوز المتوفر</div>
            )}
            {effectiveType === "VARIETY" && !targetProductId && rows.length > 0 && (
              <div className="text-xs text-amber-600">اختر المادة الهدف أولاً</div>
            )}
          </div>
          <div className="flex gap-2">
            {rows.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setRows([])}>
                مسح الكل
              </Button>
            )}
            <Button disabled={!canSubmit} onClick={handleSubmit}>
              {isPending
                ? "جارٍ التنفيذ..."
                : effectiveType === "NORMAL"
                ? "تنفيذ النقل"
                : "تنفيذ التحويل"}
            </Button>
          </div>
        </div>
      </div>

      {/* Cost note — admin / price-visible users only */}
      {!hidePrices && effectiveType === "VARIETY" && targetProduct && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900">
          <span className="font-semibold text-slate-600 dark:text-slate-300">ملاحظة: </span>
          تُحسب كلفة "{targetProduct.name}" بعد التحويل كمتوسط مرجح — يحمي دقة تقارير الربح.
        </div>
      )}
    </div>
  )
}
