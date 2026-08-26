import { useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Card, CardHeader, CardContent } from "../components/ui/card"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Label } from "../components/ui/label"
import { Badge } from "../components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"
import { ConfirmDialog } from "../components/ui/confirm-dialog"
import { toast } from "../components/ui/use-toast"
import { apiErrorMessage } from "../utils/apiError"
import {
  cancelLandedCostBatch,
  confirmLandedCostBatch,
  getBranches,
  getLandedCostBatch,
  getProducts,
  setLandedCostItemDecision,
  type LandedCostItem,
} from "../api/endpoints"
import { useCustomers } from "../hooks/useCustomers"

function money(n: number | null | undefined) {
  if (n == null) return "—"
  return Math.round(n).toLocaleString("en-US")
}

function imgSrc(url?: string | null) {
  return url || null
}

function ProductPicker({ onPick }: { onPick: (productId: string, name: string) => void }) {
  const [q, setQ] = useState("")
  const { data } = useQuery({
    queryKey: ["product-search", q],
    queryFn: () => getProducts({ search: q, limit: 10 }),
    enabled: q.trim().length >= 2,
  })
  return (
    <div className="relative">
      <Input placeholder="ابحث بالاسم أو رقم المادة..." value={q} onChange={(e) => setQ(e.target.value)} />
      {q.trim().length >= 2 && (
        <div className="absolute z-10 mt-1 max-h-56 w-72 overflow-auto rounded-md border bg-white shadow-lg dark:bg-slate-900">
          {(data ?? []).length === 0 && <div className="p-2 text-xs text-muted-foreground">لا توجد نتائج</div>}
          {(data ?? []).map((p) => (
            <button
              key={p.id}
              className="flex w-full items-center gap-2 p-2 text-right text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
              onClick={() => { onPick(p.id, p.name); setQ("") }}
            >
              <span className="flex-1">{p.name}</span>
              <span className="text-xs text-muted-foreground">{p.itemNumber}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ItemRow({ item, batchId, highlighted }: { item: LandedCostItem; batchId: string; highlighted?: boolean }) {
  const queryClient = useQueryClient()
  const [showPicker, setShowPicker] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(item.action === "CREATE_NEW")
  const [draft, setDraft] = useState(item.newProductDraft ?? { name: item.productName, itemCode: item.itemCode, pcsPerCarton: undefined as number | undefined })
  const [salePrice, setSalePrice] = useState(item.confirmedSalePrice ?? item.suggestedSalePrice ?? undefined)

  const decisionMutation = useMutation({
    mutationFn: (payload: Parameters<typeof setLandedCostItemDecision>[2]) => setLandedCostItemDecision(batchId, item.id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["landed-cost-batch", batchId] }),
    onError: (err: unknown) => toast({ title: "تعذّر حفظ القرار", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const image = imgSrc(item.product?.thumbnailUrl ?? item.product?.imageUrl)

  return (
    <div
      id={`lc-item-${item.id}`}
      className={`flex flex-col gap-3 border-t p-4 sm:flex-row sm:items-start${
        highlighted ? " bg-amber-50 ring-2 ring-amber-400 dark:bg-amber-900/20" : ""
      }`}
    >
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-slate-50 dark:bg-slate-800">
        {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <span className="text-xs text-muted-foreground">لا صورة</span>}
      </div>

      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{item.productName}</span>
          <span className="text-xs text-muted-foreground">({item.itemCode || "بدون كود"})</span>
          {item.matchStatus === "MATCHED" && <Badge variant="success">مطابق</Badge>}
          {item.matchStatus === "NOT_FOUND" && <Badge variant="warning">غير موجود</Badge>}
          {item.matchStatus === "AMBIGUOUS" && <Badge variant="danger">مكرر بالملف</Badge>}
          {item.action === "SKIP" && <Badge variant="secondary">تم التخطي</Badge>}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {item.cartonCount ?? "—"} كرتون × {item.piecesPerCarton ?? "—"} قطعة = <b>{item.quantity}</b> قطعة
          {item.unitPriceCny != null && <> · سعر القطعة {item.unitPriceCny} ¥</>}
          {item.cartonCbm != null && <> · CBM {item.cartonCbm}</>}
        </div>
        <div className="mt-1 text-sm">
          كلفة القطعة: <b>{money(item.landedCostPerUnit)} د.ع</b>
          {item.unitCostUsd != null && <> ({item.unitCostUsd} $)</>}
          {item.landedCostPerCarton != null && <> · كلفة الكارتون: <b>{money(item.landedCostPerCarton)} د.ع</b></>}
          {item.cartonCostUsd != null && <> ({item.cartonCostUsd} $)</>}
          {item.suggestedSalePrice != null && <> · سعر بيع مقترح: <b>{money(item.suggestedSalePrice)}</b></>}
        </div>

        {item.action === "LINK_EXISTING" && item.product && (
          <div className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">مرتبط بـ: {item.product.name} ({item.product.itemNumber})</div>
        )}

        {showPicker && (
          <div className="mt-2">
            <ProductPicker onPick={(productId) => {
              setShowPicker(false)
              decisionMutation.mutate({ action: "LINK_EXISTING", productId })
            }} />
          </div>
        )}

        {showCreateForm && (
          <div className="mt-2 grid grid-cols-2 gap-2 rounded-md border p-3 sm:grid-cols-4">
            <div>
              <Label className="text-xs">الاسم</Label>
              <Input value={draft.name ?? ""} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">رقم المادة</Label>
              <Input value={draft.itemCode ?? ""} onChange={(e) => setDraft((d) => ({ ...d, itemCode: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">الباركود (اختياري)</Label>
              <Input value={draft.barcode ?? ""} onChange={(e) => setDraft((d) => ({ ...d, barcode: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">الفئة (اختياري)</Label>
              <Input value={draft.category ?? ""} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">قطع بالكرتون (اختياري)</Label>
              <Input type="number" value={draft.pcsPerCarton ?? ""} onChange={(e) => setDraft((d) => ({ ...d, pcsPerCarton: Number(e.target.value) || undefined }))} />
            </div>
            <div>
              <Label className="text-xs">سعر البيع (مطلوب)</Label>
              <Input type="number" value={salePrice ?? ""} onChange={(e) => setSalePrice(Number(e.target.value) || undefined)} />
            </div>
            <div className="col-span-2 flex items-end">
              <Button
                size="sm"
                disabled={!draft.name || !salePrice}
                onClick={() => decisionMutation.mutate({ action: "CREATE_NEW", newProductDraft: draft, confirmedSalePrice: salePrice })}
              >
                حفظ بيانات المادة الجديدة
              </Button>
            </div>
          </div>
        )}

        {item.action === "LINK_EXISTING" && item.productId && (
          <div className="mt-2">
            <Label className="text-xs">سعر البيع (للمعاينة فقط، لا يُحدَّث تلقائياً في المادة الموجودة)</Label>
            <Input
              type="number"
              className="w-40"
              value={salePrice ?? ""}
              onChange={(e) => setSalePrice(Number(e.target.value) || undefined)}
              onBlur={() => decisionMutation.mutate({ action: "LINK_EXISTING", confirmedSalePrice: salePrice, productId: item.productId })}
            />
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-2 sm:w-40">
        <Button size="sm" variant="outline" onClick={() => { setShowPicker((v) => !v); setShowCreateForm(false) }}>ربط بمادة موجودة</Button>
        <Button size="sm" variant="outline" onClick={() => { setShowCreateForm((v) => !v); setShowPicker(false) }}>إنشاء مادة جديدة</Button>
        <Button size="sm" variant={item.action === "SKIP" ? "secondary" : "ghost"} onClick={() => decisionMutation.mutate({ action: "SKIP" })}>تخطي</Button>
      </div>
    </div>
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
  const [onlyUnresolved, setOnlyUnresolved] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const cancelMutation = useMutation({
    mutationFn: () => cancelLandedCostBatch(batchId),
    onSuccess: () => navigate("/inventory/landed-cost"),
    onError: (err: unknown) => toast({ title: "تعذّر إلغاء الدفعة", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const batch = batchQuery.data
  const unresolvedItems = useMemo(() => (batch?.items ?? []).filter((it) => it.action === "PENDING"), [batch])
  const unresolvedCount = unresolvedItems.length
  const visibleItems = useMemo(
    () => (onlyUnresolved ? unresolvedItems : (batch?.items ?? [])),
    [onlyUnresolved, unresolvedItems, batch]
  )

  function goToItem(itemId: string) {
    setHighlightId(itemId)
    setOnlyUnresolved(false)
    requestAnimationFrame(() => {
      document.getElementById(`lc-item-${itemId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
    })
  }
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

      {unresolvedCount > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <div>
            يوجد {unresolvedCount} صنف بحاجة لقرار (ربط بمادة موجودة / إنشاء مادة جديدة / تخطي) قبل إنشاء فاتورة الشراء.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {unresolvedItems.slice(0, 20).map((it) => (
              <Button key={it.id} size="sm" variant="outline" onClick={() => goToItem(it.id)}>
                {it.productName || it.itemCode || "بدون اسم"}
              </Button>
            ))}
            {unresolvedCount > 20 && <span className="text-xs">و {unresolvedCount - 20} صنف آخر</span>}
          </div>
          <div>
            <Button size="sm" variant="ghost" onClick={() => setOnlyUnresolved((v) => !v)}>
              {onlyUnresolved ? "أظهر كل الأصناف" : "أظهر غير المحسومة فقط"}
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {visibleItems.map((item) => (
            <ItemRow key={item.id} item={item} batchId={batchId} highlighted={highlightId === item.id} />
          ))}
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
                disabled={!supplierCustomerId || unresolvedCount > 0 || confirmMutation.isPending}
                onClick={() => confirmMutation.mutate()}
              >
                {confirmMutation.isPending ? "جاري الإنشاء..." : "إنشاء فاتورة شراء من هذا الأوردر"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
