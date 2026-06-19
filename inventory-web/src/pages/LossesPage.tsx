import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Plus, Trash2, X } from "lucide-react"
import { cancelStockLoss, createStockLoss, getBranches, listStockLosses } from "../api/endpoints"
import type { Branch, LossReason, StockLoss } from "../types/api"
import { useProducts } from "../hooks/useProducts"
import { usePageTitle } from "../hooks/usePageTitle"
import { Button } from "../components/ui/button"
import { Card, CardContent } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { toast } from "../components/ui/use-toast"
import { localDateStr, formatDate, formatDateTime } from "../utils/date"

const REASONS: Record<LossReason, string> = {
  DAMAGE: "تلف",
  EXPIRY: "انتهاء صلاحية",
  THEFT: "سرقة / فقدان",
  DEFECT: "عطل في المنتج",
  OTHER: "أخرى",
}

function unitLabel(u: string) {
  if (u === "CARTON") return "كرتونة"
  if (u === "DOZEN") return "درزن"
  return "قطعة"
}

interface DraftItem {
  productId: string
  productName: string
  unit: "PIECE" | "DOZEN" | "CARTON"
  quantity: number
}

export function LossesPage() {
  usePageTitle("التلف والخسائر")
  const qc = useQueryClient()
  const { productsQuery } = useProducts()
  const allProducts = productsQuery.data ?? []
  const branchesQuery = useQuery<Branch[]>({ queryKey: ["branches"], queryFn: () => getBranches() })


  const [open, setOpen] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<StockLoss | null>(null)

  // Form state
  const [date, setDate] = useState(localDateStr())
  const [warehouseId, setWarehouseId] = useState("")
  const [reason, setReason] = useState<LossReason>("DAMAGE")
  const [notes, setNotes] = useState("")
  const [items, setItems] = useState<DraftItem[]>([])
  const [productSearch, setProductSearch] = useState("")

  const lossesQuery = useQuery({
    queryKey: ["stock-losses"],
    queryFn: () => listStockLosses(),
  })
  const losses = lossesQuery.data ?? []

  const createMutation = useMutation({
    mutationFn: createStockLoss,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stock-losses"] })
      void qc.invalidateQueries({ queryKey: ["products"] })
      toast({ title: "تم تسجيل الخسارة بنجاح" })
      closeForm()
    },
    onError: (e) => toast({ title: e instanceof Error ? e.message : "تعذر الحفظ", variant: "destructive" }),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelStockLoss(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stock-losses"] })
      void qc.invalidateQueries({ queryKey: ["products"] })
      toast({ title: "تم إلغاء السجل وإرجاع المخزون" })
      setCancelTarget(null)
    },
    onError: (e) => toast({ title: e instanceof Error ? e.message : "تعذر الإلغاء", variant: "destructive" }),
  })

  function closeForm() {
    setOpen(false)
    setDate(localDateStr())
    setWarehouseId("")
    setReason("DAMAGE")
    setNotes("")
    setItems([])
    setProductSearch("")
  }

  function addItem(productId: string) {
    const p = allProducts.find((x) => x.id === productId)
    if (!p) return
    setItems((prev) => [...prev, { productId: p.id, productName: p.name, unit: "PIECE", quantity: 1 }])
    setProductSearch("")
  }

  function updateItem(i: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  }

  function removeItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i))
  }

  function submit() {
    if (!warehouseId) { toast({ title: "اختر المخزن", variant: "destructive" }); return }
    if (!items.length) { toast({ title: "أضف مادة واحدة على الأقل", variant: "destructive" }); return }
    createMutation.mutate({ date, warehouseId, reason, notes: notes || undefined, items })
  }

  const filteredProducts = allProducts.filter(
    (p) => p.name.toLowerCase().includes(productSearch.toLowerCase())
  ).slice(0, 10)

  return (
    <div className="space-y-4 p-4" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">التلف والخسائر</h1>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> تسجيل خسارة
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>الرقم</TH>
                <TH>التاريخ</TH>
                <TH>المخزن</TH>
                <TH>السبب</TH>
                <TH>المواد</TH>
                <TH>الحالة</TH>
                <TH>إلغاء</TH>
              </TR>
            </THead>
            <TBody>
              {losses.length === 0 && (
                <TR><TD colSpan={7} className="text-center text-slate-500 py-8">لا يوجد سجلات</TD></TR>
              )}
              {losses.map((loss) => (
                <TR key={loss.id} className={loss.cancelledAt ? "opacity-50" : ""}>
                  <TD className="font-mono text-sm">{loss.lossNumber}</TD>
                  <TD>
                    <div>{formatDate(loss.date)}</div>
                    <div className="text-[11px] text-slate-400">إدخال: {formatDateTime(loss.createdAt)}</div>
                  </TD>
                  <TD>{loss.warehouse.name}</TD>
                  <TD>{REASONS[loss.reason]}</TD>
                  <TD>
                    <div className="space-y-0.5">
                      {loss.items.map((it) => (
                        <div key={it.id} className="text-xs">
                          {it.productName} — {it.quantity} {unitLabel(it.unit)}
                        </div>
                      ))}
                    </div>
                  </TD>
                  <TD>
                    {loss.cancelledAt
                      ? <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">ملغي</span>
                      : <span className="rounded bg-rose-100 px-2 py-0.5 text-xs text-rose-700">مسجل</span>}
                  </TD>
                  <TD>
                    {!loss.cancelledAt && (
                      <Button variant="ghost" size="sm" onClick={() => setCancelTarget(loss)}>
                        <Trash2 className="h-4 w-4 text-rose-500" />
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={(v) => { if (!v) closeForm() }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> تسجيل تلف / خسارة
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-500">التاريخ</label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">المخزن</label>
                <select
                  className="h-9 w-full rounded-md border bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(e.target.value)}
                >
                  <option value="">— اختر المخزن —</option>
                  {(branchesQuery.data ?? []).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">السبب</label>
                <select
                  className="h-9 w-full rounded-md border bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  value={reason}
                  onChange={(e) => setReason(e.target.value as LossReason)}
                >
                  {(Object.entries(REASONS) as [LossReason, string][]).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">ملاحظات</label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" />
              </div>
            </div>

            {/* Product search */}
            <div>
              <label className="mb-1 block text-xs text-slate-500">إضافة مادة</label>
              <Input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="ابحث عن المادة..."
              />
              {productSearch && (
                <div className="mt-1 rounded-md border bg-white shadow-md dark:bg-slate-900">
                  {filteredProducts.map((p) => (
                    <button
                      key={p.id}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                      onClick={() => addItem(p.id)}
                    >
                      {p.name}
                    </button>
                  ))}
                  {filteredProducts.length === 0 && (
                    <div className="px-3 py-2 text-sm text-slate-400">لا توجد نتائج</div>
                  )}
                </div>
              )}
            </div>

            {/* Items table */}
            {items.length > 0 && (
              <Table>
                <THead>
                  <TR>
                    <TH>المادة</TH>
                    <TH>الوحدة</TH>
                    <TH>الكمية</TH>
                    <TH></TH>
                  </TR>
                </THead>
                <TBody>
                  {items.map((it, i) => (
                    <TR key={i}>
                      <TD className="font-medium">{it.productName}</TD>
                      <TD>
                        <select
                          className="h-8 w-24 rounded-md border bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                          value={it.unit}
                          onChange={(e) => updateItem(i, { unit: e.target.value as DraftItem["unit"] })}
                        >
                          <option value="PIECE">قطعة</option>
                          <option value="DOZEN">درزن</option>
                          <option value="CARTON">كرتونة</option>
                        </select>
                      </TD>
                      <TD>
                        <Input
                          type="number"
                          className="w-20"
                          value={it.quantity}
                          min={1}
                          onChange={(e) => updateItem(i, { quantity: Number(e.target.value) })}
                        />
                      </TD>
                      <TD>
                        <Button variant="ghost" size="sm" onClick={() => removeItem(i)}>
                          <X className="h-4 w-4 text-rose-500" />
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeForm}>إلغاء</Button>
              <Button
                variant="destructive"
                onClick={submit}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? "جاري الحفظ..." : "تسجيل الخسارة"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel confirmation — shows which items stock will be restored */}
      {cancelTarget && (
        <Dialog open onOpenChange={(v) => { if (!v) setCancelTarget(null) }}>
          <DialogContent className="max-w-sm" dir="rtl">
            <DialogHeader>
              <DialogTitle className="text-amber-600">إلغاء سجل الخسارة؟</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              سيتم إرجاع الكميات التالية إلى مخزن <strong>{cancelTarget.warehouse.name}</strong>:
            </p>
            <div className="space-y-1 rounded-md bg-slate-50 p-3 dark:bg-slate-900">
              {cancelTarget.items.map((it) => (
                <div key={it.id} className="flex justify-between text-sm">
                  <span>{it.productName}</span>
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                    +{it.quantity} {unitLabel(it.unit)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setCancelTarget(null)}>تراجع</Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate(cancelTarget.id)}
              >
                {cancelMutation.isPending ? "..." : "تأكيد الإلغاء"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
