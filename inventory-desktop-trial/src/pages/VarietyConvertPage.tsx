import { useMemo, useState, useRef } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Boxes, Plus, Trash2, ArrowLeft, Search } from "lucide-react"
import { Link } from "react-router-dom"
import { getBranches, convertToVariety } from "../api/endpoints"
import { useProducts } from "../hooks/useProducts"
import type { Product } from "../types/api"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { toast } from "../components/ui/use-toast"

type Unit = "PIECE" | "DOZEN" | "BOX" | "CARTON"
const UNIT_LABEL: Record<Unit, string> = { PIECE: "قطعة", DOZEN: "درزن", BOX: "علبة", CARTON: "كرتونة" }

interface Row {
  product: Product
  unit: Unit
  quantity: number
}

function piecesOf(product: Product, unit: Unit, quantity: number) {
  const n = Math.max(1, product.pcsPerCarton)
  if (unit === "CARTON") return quantity * n
  if (unit === "BOX") return quantity * Math.ceil(n / 2)
  if (unit === "DOZEN") return quantity * 12
  return quantity
}

export function VarietyConvertPage() {
  const qc = useQueryClient()
  const { productsQuery } = useProducts()
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data])
  const { data: branches = [] } = useQuery({ queryKey: ["branches"], queryFn: () => getBranches({ isActive: true }) })

  const [fromWarehouseId, setFromWarehouseId] = useState("")
  // Target product — typed name search
  const [targetSearch, setTargetSearch] = useState("")
  const [targetProductId, setTargetProductId] = useState("")
  const [targetDropOpen, setTargetDropOpen] = useState(false)
  const targetRef = useRef<HTMLDivElement>(null)

  const [search, setSearch] = useState("")
  const [rows, setRows] = useState<Row[]>([])

  const shopBranch = branches.find((b) => b.name.includes("محل"))
  const defaultFrom = branches.find((b) => b.id !== shopBranch?.id)?.id ?? ""
  const effectiveFrom = fromWarehouseId || defaultFrom

  // Resolve the selected target product object
  const targetProduct = useMemo(
    () => products.find((p) => p.id === targetProductId) ?? null,
    [products, targetProductId],
  )

  // Suggestions when typing in target field
  const targetMatches = useMemo(() => {
    const q = targetSearch.trim().toLowerCase()
    if (!q || targetProductId) return []
    return products.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8)
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

  // Source product search / barcode
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return products
      .filter(
        (p) =>
          p.id !== targetProductId &&
          [p.name, p.itemNumber, p.qrCode ?? "", p.cartonQrCode ?? ""].some((v) =>
            v.toLowerCase().includes(q),
          ),
      )
      .slice(0, 8)
  }, [search, products, targetProductId])

  function addRow(product: Product, unit: Unit = "PIECE") {
    setRows((prev) => {
      const existing = prev.find((r) => r.product.id === product.id && r.unit === unit)
      if (existing) return prev.map((r) => (r === existing ? { ...r, quantity: r.quantity + 1 } : r))
      return [...prev, { product, unit, quantity: 1 }]
    })
    setSearch("")
  }

  function addByCode(code: string) {
    const c = code.trim().toLowerCase()
    if (!c) return
    const hit =
      products.find((p) => p.qrCode?.toLowerCase() === c) ??
      products.find((p) => p.cartonQrCode?.toLowerCase() === c) ??
      products.find((p) => p.itemNumber.toLowerCase() === c)
    if (!hit) { toast({ title: "لا توجد مادة بهذا الرمز", variant: "destructive" }); return }
    const isCarton = hit.cartonQrCode?.toLowerCase() === c
    addRow(hit, isCarton ? "CARTON" : "PIECE")
  }

  const totalPieces = rows.reduce((s, r) => s + piecesOf(r.product, r.unit, r.quantity), 0)

  const mutation = useMutation({
    mutationFn: () =>
      convertToVariety({
        fromWarehouseId: effectiveFrom,
        targetProductId: targetProductId,
        items: rows.map((r) => ({ productId: r.product.id, unit: r.unit, quantity: r.quantity })),
      }),
    onSuccess: (res) => {
      toast({ title: `تم التحويل — أُضيفت ${res?.addedPieces ?? totalPieces} قطعة للمتنوع` })
      setRows([])
      void qc.invalidateQueries({ queryKey: ["products"] })
    },
    onError: (e: any) => toast({ title: "خطأ", description: e.response?.data?.message ?? e.message ?? "تعذّر التحويل", variant: "destructive" }),
  })

  const canSubmit = effectiveFrom && targetProductId && rows.length > 0 && !mutation.isPending

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Boxes className="h-6 w-6" /> تحويل إلى متنوع
          </h1>
          <p className="text-sm text-slate-500">
            حوّل عدة مواد من المخزن الكبير إلى مادة «متنوع» واحدة في المحل.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/inventory">
            <ArrowLeft className="h-4 w-4" /> المخزن
          </Link>
        </Button>
      </div>

      {/* Step 1: Source + Target */}
      <div className="rounded-xl border bg-white p-4 dark:bg-slate-950 space-y-4">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">الخطوة ١ — حدد المصدر والهدف</p>

        {/* Source warehouse */}
        <div className="space-y-1">
          <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            من المخزن (المصدر)
          </label>
          <select
            className="h-10 w-full rounded-lg border px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
            value={effectiveFrom}
            onChange={(e) => setFromWarehouseId(e.target.value)}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>

        {/* Target variety product — text search */}
        <div className="space-y-1" ref={targetRef}>
          <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            اسم مادة المتنوع (الهدف بالمحل)
          </label>
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <Input
              value={targetSearch}
              onChange={(e) => {
                setTargetSearch(e.target.value)
                if (targetProductId) clearTarget()
                setTargetDropOpen(true)
              }}
              onFocus={() => setTargetDropOpen(true)}
              placeholder="مثال: حاجة الف متنوع"
              className="pr-9"
            />
            {targetProductId && (
              <button
                type="button"
                onClick={clearTarget}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Autocomplete dropdown */}
          {targetDropOpen && targetMatches.length > 0 && (
            <div className="relative z-50">
              <div className="absolute top-0 left-0 right-0 rounded-lg border bg-white shadow-lg dark:bg-slate-900 dark:border-slate-700">
                {targetMatches.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onMouseDown={() => selectTarget(p)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-right text-sm hover:bg-indigo-50 dark:hover:bg-slate-800"
                  >
                    <Boxes className="h-4 w-4 text-indigo-400 shrink-0" />
                    <span>{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Confirm chip when selected */}
          {targetProduct && (
            <div className="flex items-center gap-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 px-3 py-2 text-sm">
              <Boxes className="h-4 w-4 text-indigo-500 shrink-0" />
              <span className="font-medium text-indigo-700 dark:text-indigo-300">{targetProduct.name}</span>
              <span className="text-indigo-400 text-xs mr-auto">محدد كهدف</span>
            </div>
          )}
          {!targetProduct && targetSearch && targetMatches.length === 0 && (
            <p className="text-xs text-rose-500">لا توجد مادة بهذا الاسم — تأكد من الاسم أو أضف المادة أولاً</p>
          )}
        </div>
      </div>

      {/* Step 2: Add items */}
      <div className="rounded-xl border bg-white p-4 dark:bg-slate-950 space-y-3">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">الخطوة ٢ — أضف المواد المراد تحويلها</p>
        <div>
          <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            ابحث عن مادة أو اقرأ الباركود بالمسدس
          </label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); addByCode(search) }
            }}
            placeholder="اكتب اسم المادة / رقم الصنف / امسح الباركود ثم Enter"
            className="mt-1"
          />
          <p className="mt-1 text-xs text-slate-400">
            مسدس الباركود → يضيف المادة تلقائياً. يد → اكتب ثم اختر من القائمة.
          </p>
        </div>

        {matches.length > 0 && (
          <div className="divide-y rounded-lg border dark:border-slate-800">
            {matches.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => addRow(p)}
                className="flex w-full items-center justify-between p-2.5 text-right text-sm hover:bg-slate-50 dark:hover:bg-slate-900"
              >
                <span className="font-medium">{p.name}</span>
                <span className="flex items-center gap-1 text-xs text-indigo-500">
                  <Plus className="h-3.5 w-3.5" /> إضافة
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Step 3: Items table */}
      <div className="rounded-xl border bg-white dark:bg-slate-950">
        <div className="border-b px-4 py-3 font-semibold text-sm flex items-center gap-2">
          <span>المواد المحوّلة</span>
          {rows.length > 0 && (
            <span className="rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 text-xs px-2 py-0.5">
              {rows.length}
            </span>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-400">لم تُضف مواد بعد — استخدم البحث أعلاه</p>
        ) : (
          <div className="divide-y dark:divide-slate-800">
            {rows.map((r, i) => (
              <div key={`${r.product.id}-${r.unit}`} className="flex flex-wrap items-center gap-2 p-3">
                <span className="flex-1 font-medium text-sm">{r.product.name}</span>
                <select
                  className="h-9 rounded-lg border px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                  value={r.unit}
                  onChange={(e) =>
                    setRows((prev) => prev.map((x, j) => j === i ? { ...x, unit: e.target.value as Unit } : x))
                  }
                >
                  {(Object.keys(UNIT_LABEL) as Unit[]).map((u) => (
                    <option key={u} value={u}>{UNIT_LABEL[u]}</option>
                  ))}
                </select>
                <Input
                  type="number"
                  min={1}
                  value={r.quantity}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((x, j) => j === i ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x),
                    )
                  }
                  className="h-9 w-20"
                />
                <span className="w-20 text-left text-xs text-slate-500">
                  {piecesOf(r.product, r.unit, r.quantity)} قطعة
                </span>
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                  className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between border-t px-4 py-3">
          <div className="text-sm">
            <span className="font-semibold">{totalPieces} قطعة</span>
            {targetProduct && (
              <span className="text-slate-400 mr-1">→ {targetProduct.name}</span>
            )}
          </div>
          <Button disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "جارٍ التحويل..." : "تحويل الآن"}
          </Button>
        </div>
      </div>
    </div>
  )
}
