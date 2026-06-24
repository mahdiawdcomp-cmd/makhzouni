import { useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Boxes, Plus, Trash2, ArrowLeft } from "lucide-react"
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
  const [targetProductId, setTargetProductId] = useState("")
  const [search, setSearch] = useState("")
  const [rows, setRows] = useState<Row[]>([])

  // Default the source to the first non-shop warehouse, and the target to a
  // product whose name contains «متنوع».
  const shopBranch = branches.find((b) => b.name.includes("محل"))
  const defaultFrom = branches.find((b) => b.id !== shopBranch?.id)?.id ?? ""
  const effectiveFrom = fromWarehouseId || defaultFrom
  const varietyProduct = products.find((p) => p.name.includes("متنوع"))
  const effectiveTarget = targetProductId || varietyProduct?.id || ""

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return products
      .filter((p) =>
        p.id !== effectiveTarget &&
        ([p.name, p.itemNumber, p.qrCode ?? "", p.cartonQrCode ?? ""].some((v) => v.toLowerCase().includes(q))),
      )
      .slice(0, 8)
  }, [search, products, effectiveTarget])

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
        targetProductId: effectiveTarget,
        items: rows.map((r) => ({ productId: r.product.id, unit: r.unit, quantity: r.quantity })),
      }),
    onSuccess: (res) => {
      toast({ title: `تم التحويل — أُضيفت ${res?.addedPieces ?? totalPieces} قطعة للمتنوع` })
      setRows([])
      void qc.invalidateQueries({ queryKey: ["products"] })
    },
    onError: (e: Error) => toast({ title: e.message ?? "تعذّر التحويل", variant: "destructive" }),
  })

  const canSubmit = effectiveFrom && effectiveTarget && rows.length > 0 && !mutation.isPending

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Boxes className="h-6 w-6" /> تحويل إلى متنوع</h1>
          <p className="text-sm text-slate-500">حوّل عدة مواد من المخزن الكبير إلى مادة «متنوع» واحدة في المحل.</p>
        </div>
        <Button variant="outline" asChild><Link to="/inventory"><ArrowLeft className="h-4 w-4" /> المخزن</Link></Button>
      </div>

      <div className="grid gap-3 rounded-xl border bg-white p-4 dark:bg-slate-950 md:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-600">من المخزن (المصدر)</label>
          <select className="h-10 w-full rounded-lg border px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            value={effectiveFrom} onChange={(e) => setFromWarehouseId(e.target.value)}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-600">المادة المتنوعة (الهدف في المحل)</label>
          <select className="h-10 w-full rounded-lg border px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            value={effectiveTarget} onChange={(e) => setTargetProductId(e.target.value)}>
            <option value="">— اختر —</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4 dark:bg-slate-950">
        <label className="text-xs font-semibold text-slate-600">أضف مادة (اسم أو رمز / مسدس باركود)</label>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addByCode(search) } }}
          placeholder="اكتب اسم المادة أو اقرأ الباركود ثم Enter"
          className="mt-1"
        />
        {matches.length > 0 && (
          <div className="mt-2 divide-y rounded-lg border dark:border-slate-800">
            {matches.map((p) => (
              <button key={p.id} type="button" onClick={() => addRow(p)}
                className="flex w-full items-center justify-between p-2.5 text-right text-sm hover:bg-slate-50 dark:hover:bg-slate-900">
                <span className="font-medium">{p.name}</span>
                <span className="flex items-center gap-1 text-xs text-slate-500"><Plus className="h-3.5 w-3.5" /> إضافة</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-white dark:bg-slate-950">
        <div className="border-b px-4 py-3 font-semibold">المواد المحوّلة ({rows.length})</div>
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-400">لم تُضف مواد بعد.</p>
        ) : (
          <div className="divide-y dark:divide-slate-800">
            {rows.map((r, i) => (
              <div key={`${r.product.id}-${r.unit}`} className="flex flex-wrap items-center gap-2 p-3">
                <span className="flex-1 font-medium">{r.product.name}</span>
                <select className="h-9 rounded-lg border px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                  value={r.unit}
                  onChange={(e) => setRows((prev) => prev.map((x, j) => j === i ? { ...x, unit: e.target.value as Unit } : x))}>
                  {(Object.keys(UNIT_LABEL) as Unit[]).map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}
                </select>
                <Input type="number" min={1} value={r.quantity}
                  onChange={(e) => setRows((prev) => prev.map((x, j) => j === i ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x))}
                  className="h-9 w-20" />
                <span className="w-24 text-left text-xs text-slate-500">{piecesOf(r.product, r.unit, r.quantity)} قطعة</span>
                <button type="button" onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                  className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between border-t px-4 py-3">
          <span className="text-sm font-semibold">المجموع: {totalPieces} قطعة</span>
          <Button disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "جارٍ التحويل..." : "تحويل إلى المتنوع"}
          </Button>
        </div>
      </div>
    </div>
  )
}
