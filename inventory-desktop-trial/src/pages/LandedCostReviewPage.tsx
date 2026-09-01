import { useCallback, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Card, CardHeader, CardContent } from "../components/ui/card"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Label } from "../components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"
import { ConfirmDialog } from "../components/ui/confirm-dialog"
import { cn } from "../utils/cn"
import { toast } from "../components/ui/use-toast"
import { apiErrorMessage } from "../utils/apiError"
import {
  cancelLandedCostBatch,
  confirmLandedCostBatch,
  getBranches,
  getLandedCostBatch,
  type LandedCostItem,
} from "../api/endpoints"
import { useCustomers } from "../hooks/useCustomers"
import { LandedCostItemPanel } from "../components/LandedCostItemPanel"

function money(n: number | null | undefined) {
  if (n == null) return "—"
  return Math.round(n).toLocaleString("en-US")
}

function imgSrc(url?: string | null) {
  return url || null
}

/** One compact row in the review table. Details live in the side panel. */
function ItemRow({ item, highlighted, stillDuplicated, onOpen }: {
  item: LandedCostItem
  highlighted?: boolean
  stillDuplicated?: boolean
  onOpen: () => void
}) {
  const image = imgSrc(item.product?.thumbnailUrl ?? item.product?.imageUrl ?? item.newProductDraft?.imageUrl)
  // Mirrors the server: the saved draft's code wins over the Excel one.
  const effectiveCode = (item.newProductDraft?.itemCode || item.itemCode || "").trim()
  const displayName = item.newProductDraft?.name || item.product?.name || item.productName
  const tags = [...(item.newProductDraft?.categoryTags ?? []), ...(item.newProductDraft?.typeTags ?? [])]

  const state =
    item.action === "SKIP" ? { label: "متخطى", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" }
    : item.action === "LINK_EXISTING" ? { label: "مرتبط", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" }
    : item.action === "CREATE_NEW" ? { label: "مادة جديدة", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" }
    : { label: "يحتاج قرار", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" }

  return (
    <tr
      id={`lc-item-${item.id}`}
      onClick={onOpen}
      className={cn(
        "cursor-pointer border-t transition hover:bg-slate-50 dark:hover:bg-slate-800/60",
        highlighted && "bg-amber-50 ring-2 ring-amber-400 dark:bg-amber-900/20",
        stillDuplicated && "bg-rose-50 dark:bg-rose-950/20",
      )}
    >
      <td className="p-2">
        <div className="grid h-11 w-11 place-items-center overflow-hidden rounded-md border bg-slate-50 dark:bg-slate-800">
          {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <span className="text-[9px] text-muted-foreground">لا صورة</span>}
        </div>
      </td>
      <td className="p-2">
        <div className="font-semibold">{displayName || "بدون اسم"}</div>
        <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          <span>{effectiveCode || "بدون كود"}</span>
          {effectiveCode && effectiveCode !== item.itemCode && <span>(بالملف: {item.itemCode})</span>}
          {stillDuplicated && <span className="font-bold text-rose-600">رقم مكرر</span>}
        </div>
        {tags.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {tags.slice(0, 4).map((t) => (
              <span key={t} className="rounded-full bg-indigo-50 px-1.5 py-px text-[10px] text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">{t}</span>
            ))}
          </div>
        )}
      </td>
      <td className="p-2 text-center text-xs">
        <div className="font-semibold">{item.cartonCount ?? "—"} كرتون</div>
        <div className="text-muted-foreground">{item.quantity} قطعة</div>
      </td>
      <td className="p-2 text-center text-xs">
        <div className="font-semibold">{money(item.landedCostPerUnit)}</div>
        <div className="text-muted-foreground">الكرتون {money(item.landedCostPerCarton)}</div>
      </td>
      <td className="p-2 text-center">
        {item.confirmedSalePrice != null ? (
          <span className="font-bold text-emerald-700 dark:text-emerald-400">{money(item.confirmedSalePrice)}</span>
        ) : item.action === "SKIP" ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <span className="text-xs font-semibold text-amber-600">غير مسعّر</span>
        )}
      </td>
      <td className="p-2 text-center">
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", state.cls)}>{state.label}</span>
      </td>
      <td className="p-2 text-left">
        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onOpen() }}>تفاصيل</Button>
      </td>
    </tr>
  )
}

export function LandedCostReviewPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const batchId = id!

  const batchQuery = useQuery({ queryKey: ["landed-cost-batch", batchId], queryFn: () => getLandedCostBatch(batchId) })
  const branchesQuery = useQuery({ queryKey: ["branches-active"], queryFn: () => getBranches({ isActive: true }) })
  const { customersQuery } = useCustomers(true)

  const [supplierCustomerId, setSupplierCustomerId] = useState("")
  const [warehouseId, setWarehouseId] = useState("")
  const [paymentType, setPaymentType] = useState<"CASH" | "CREDIT" | "PARTIAL">("CREDIT")
  const [paidAmount, setPaidAmount] = useState(0)
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof confirmLandedCostBatch>> | null>(null)

  const confirmMutation = useMutation({
    mutationFn: () => confirmLandedCostBatch(batchId, { supplierCustomerId, warehouseId: warehouseId || undefined, paymentType, paidAmount }),
    onSuccess: (result) => {
      setSummary(result)
      toast({ title: "تم إنشاء فاتورة الشراء", description: `رقم الفاتورة: ${result.invoiceNumber}` })
    },
    onError: (err: unknown) => toast({ title: "تعذّر إنشاء فاتورة الشراء", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const [confirmCancel, setConfirmCancel] = useState(false)
  const [filter, setFilter] = useState<"ALL" | "PENDING" | "CREATE_NEW" | "LINK_EXISTING" | "SKIP">("ALL")
  const [search, setSearch] = useState("")
  const [panelItemId, setPanelItemId] = useState<string | null>(null)
  const cancelMutation = useMutation({
    mutationFn: () => cancelLandedCostBatch(batchId),
    onSuccess: () => navigate("/inventory/landed-cost"),
    onError: (err: unknown) => toast({ title: "تعذّر إلغاء الدفعة", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const batch = batchQuery.data
  const unresolvedCount = useMemo(() => (batch?.items ?? []).filter((it) => it.action === "PENDING").length, [batch])
  // itemNumber is unique — two rows asking to CREATE the same code can never
  // both become products, and the server would fail mid-confirm.
  const duplicateNewCodes = useMemo(() => {
    const owners = new Map<string, string[]>()
    for (const it of batch?.items ?? []) {
      if (it.action !== "CREATE_NEW") continue
      const code = (it.newProductDraft?.itemCode ?? it.itemCode ?? "").trim()
      if (!code) continue
      owners.set(code, [...(owners.get(code) ?? []), it.productName || code])
    }
    return [...owners.entries()].filter(([, names]) => names.length > 1)
  }, [batch])
  const duplicateCodeSet = useMemo(() => new Set(duplicateNewCodes.map(([code]) => code)), [duplicateNewCodes])
  const counts = useMemo(() => {
    const all = batch?.items ?? []
    return {
      all: all.length,
      PENDING: all.filter((it) => it.action === "PENDING").length,
      CREATE_NEW: all.filter((it) => it.action === "CREATE_NEW").length,
      LINK_EXISTING: all.filter((it) => it.action === "LINK_EXISTING").length,
      SKIP: all.filter((it) => it.action === "SKIP").length,
    }
  }, [batch])
  const visibleItems = useMemo(() => {
    let list = batch?.items ?? []
    if (filter !== "ALL") list = list.filter((it) => it.action === filter)
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter((it) => {
        const name = (it.newProductDraft?.name || it.product?.name || it.productName || "").toLowerCase()
        const code = (it.newProductDraft?.itemCode || it.itemCode || "").toLowerCase()
        return name.includes(q) || code.includes(q)
      })
    }
    return list
  }, [batch, filter, search])
  const codeTakenBy = useCallback(
    (code: string, exceptItemId: string) => {
      const wanted = code.trim()
      if (!wanted) return null
      const other = (batch?.items ?? []).find(
        (it) =>
          it.id !== exceptItemId &&
          it.action === "CREATE_NEW" &&
          (it.newProductDraft?.itemCode || it.itemCode || "").trim() === wanted,
      )
      return other ? other.productName || wanted : null
    },
    [batch],
  )
  const locked = batch?.status === "PURCHASE_INVOICE_CREATED" || batch?.status === "CANCELLED"

  if (batchQuery.isLoading) return <div className="p-6">جاري التحميل...</div>
  if (!batch) return <div className="p-6">الدفعة غير موجودة</div>

  if (summary) {
    return (
      <div className="mx-auto max-w-2xl p-6" dir="rtl">
        <Card>
          <CardHeader><span className="font-semibold">تم إنشاء فاتورة الشراء بنجاح</span></CardHeader>
          <CardContent className="flex flex-col gap-2 p-5 text-sm">
            <div>رقم الفاتورة: <b>{summary.invoiceNumber}</b></div>
            <div>عدد الأصناف المرتبطة بمواد موجودة: <b>{summary.linkedCount}</b></div>
            <div>عدد المواد الجديدة التي تم إنشاؤها: <b>{summary.createdCount}</b></div>
            <div>عدد الأصناف التي تم تخطيها: <b>{summary.skippedCount}</b></div>
            <div>إجمالي الكمية المضافة للمخزون: <b>{summary.totalStockAdded}</b></div>
            <div className="mt-3 flex gap-2">
              <Button onClick={() => navigate(`/invoices/${summary.purchaseInvoiceId}`)}>عرض فاتورة الشراء</Button>
              <Button variant="outline" onClick={() => navigate("/inventory/landed-cost")}>العودة لقائمة الاستيرادات</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-6" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">مراجعة الأوردر المسعّر</h1>
        {!locked && <Button variant="ghost" onClick={() => setConfirmCancel(true)}>إلغاء الدفعة</Button>}
      </div>

      {duplicateNewCodes.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/25 dark:text-rose-300">
          <div className="font-semibold">رقم مادة مكرر — لا يمكن إنشاء مادتين بنفس الرقم:</div>
          {duplicateNewCodes.map(([code, names]) => (
            <div key={code}>«{code}» مطلوب لـ {names.length} أصناف: {names.join("، ")}</div>
          ))}
          <div className="text-xs">غيّر رقم المادة في أحدها، أو اربطه بمادة موجودة، أو تخطّه.</div>
        </div>
      )}
      {unresolvedCount > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          يوجد {unresolvedCount} صنف بحاجة لقرار (ربط بمادة موجودة / إنشاء مادة جديدة / تخطي) قبل إنشاء فاتورة الشراء.
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {/* Toolbar: what is left to do, and how to find it. */}
          <div className="flex flex-wrap items-center gap-2 p-3">
            {([
              ["ALL", `الكل (${counts.all})`],
              ["PENDING", `يحتاج قرار (${counts.PENDING})`],
              ["CREATE_NEW", `جديد (${counts.CREATE_NEW})`],
              ["LINK_EXISTING", `مرتبط (${counts.LINK_EXISTING})`],
              ["SKIP", `متخطى (${counts.SKIP})`],
            ] as const).map(([value, label]) => (
              <Button key={value} size="sm" variant={filter === value ? "default" : "outline"} onClick={() => setFilter(value)}>
                {label}
              </Button>
            ))}
            <Input
              className="ms-auto w-56"
              placeholder="ابحث بالاسم أو رقم المادة..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-muted-foreground dark:bg-slate-800">
                <tr>
                  <th className="p-2"></th>
                  <th className="p-2 text-right">المادة</th>
                  <th className="p-2">الكمية</th>
                  <th className="p-2">الكلفة</th>
                  <th className="p-2">سعر البيع</th>
                  <th className="p-2">الحالة</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    stillDuplicated={duplicateCodeSet.has((item.newProductDraft?.itemCode || item.itemCode || "").trim())}
                    onOpen={() => setPanelItemId(item.id)}
                  />
                ))}
                {visibleItems.length === 0 && (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">ماكو أصناف بهذا الفلتر</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {!locked && (
        <Card>
          <CardHeader><span className="font-semibold">إنشاء فاتورة شراء من هذا الأوردر</span></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-4">
            <div>
              <Label>المورّد (كزبون)</Label>
              <Select value={supplierCustomerId} onValueChange={setSupplierCustomerId}>
                <SelectTrigger><SelectValue placeholder="اختر المورّد" /></SelectTrigger>
                <SelectContent>
                  {(customersQuery.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>المخزن (اختياري)</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger><SelectValue placeholder="افتراضي" /></SelectTrigger>
                <SelectContent>
                  {(branchesQuery.data ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>نوع الدفع</Label>
              <Select value={paymentType} onValueChange={(v) => setPaymentType(v as typeof paymentType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">نقد كامل</SelectItem>
                  <SelectItem value="CREDIT">آجل</SelectItem>
                  <SelectItem value="PARTIAL">دفع جزئي</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>المبلغ المدفوع</Label>
              <Input type="number" value={paidAmount} onChange={(e) => setPaidAmount(Number(e.target.value) || 0)} />
            </div>
            <div className="sm:col-span-4">
              <Button
                disabled={!supplierCustomerId || unresolvedCount > 0 || duplicateNewCodes.length > 0 || confirmMutation.isPending}
                onClick={() => confirmMutation.mutate()}
              >
                {confirmMutation.isPending ? "جاري الإنشاء..." : "إنشاء فاتورة شراء من هذا الأوردر"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <LandedCostItemPanel
        item={(batch.items ?? []).find((it) => it.id === panelItemId) ?? null}
        batchId={batchId}
        open={panelItemId !== null}
        onOpenChange={(o) => { if (!o) setPanelItemId(null) }}
        codeTakenBy={codeTakenBy}
      />

      <ConfirmDialog
        open={confirmCancel}
        title="إلغاء هذه الدفعة؟"
        description="سيتم إلغاء الأوردر المسعّر وكل القرارات اللي سويتها عليه، ولا يمكن التراجع عن ذلك."
        confirmLabel="إلغاء الدفعة"
        destructive
        loading={cancelMutation.isPending}
        onConfirm={() => cancelMutation.mutate()}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  )
}
