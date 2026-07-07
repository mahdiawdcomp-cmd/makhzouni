import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Card, CardHeader, CardContent } from "../components/ui/card"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Label } from "../components/ui/label"
import { Badge } from "../components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"
import { toast } from "../components/ui/use-toast"
import {
  cancelLandedCostBatch,
  createLandedCostBatch,
  getLandedCostTemplateUrl,
  listLandedCostBatches,
  previewLandedCost,
  type LandedCostAllocationMethod,
  type LandedCostBatch,
  type LandedCostPreviewResult,
} from "../api/endpoints"

const ALLOCATION_LABELS: Record<LandedCostAllocationMethod, string> = {
  BY_QUANTITY: "حسب الكمية",
  BY_VALUE: "حسب قيمة الشراء",
  BY_CARTON: "حسب عدد الكراتين",
}

const STATUS_LABELS: Record<LandedCostBatch["status"], { label: string; variant: "secondary" | "info" | "success" | "danger" }> = {
  DRAFT_PRICED: { label: "تم التسعير", variant: "info" },
  REVIEWING_ITEMS: { label: "قيد المراجعة", variant: "secondary" },
  PURCHASE_INVOICE_CREATED: { label: "تم إنشاء فاتورة شراء", variant: "success" },
  CANCELLED: { label: "ملغاة", variant: "danger" },
}

function money(n: number) {
  return Math.round(n).toLocaleString("en-US")
}

export function LandedCostImportPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [file, setFile] = useState<File | null>(null)
  const [allocationMethod, setAllocationMethod] = useState<LandedCostAllocationMethod>("BY_VALUE")
  const [invoiceNumber, setInvoiceNumber] = useState("")
  const [supplier, setSupplier] = useState("")
  const [note, setNote] = useState("")
  const [extra, setExtra] = useState({ freight: "", customs: "", localTransport: "", unloading: "", commission: "", otherCosts: "" })
  const [preview, setPreview] = useState<LandedCostPreviewResult | null>(null)

  const extraNumbers = useMemo(() => ({
    freight: Number(extra.freight) || undefined,
    customs: Number(extra.customs) || undefined,
    localTransport: Number(extra.localTransport) || undefined,
    unloading: Number(extra.unloading) || undefined,
    commission: Number(extra.commission) || undefined,
    otherCosts: Number(extra.otherCosts) || undefined,
  }), [extra])

  const batchesQuery = useQuery({ queryKey: ["landed-cost-batches"], queryFn: listLandedCostBatches })

  const previewMutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("اختر ملف Excel أولاً")
      return previewLandedCost(file, allocationMethod, extraNumbers)
    },
    onSuccess: (result) => setPreview(result),
    onError: (err: unknown) => toast({ title: "تعذّرت معاينة الملف", description: String((err as Error)?.message ?? err), variant: "destructive" }),
  })

  const createBatchMutation = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error("لا يوجد معاينة")
      return createLandedCostBatch({
        invoiceNumber: invoiceNumber || undefined,
        supplier: supplier || undefined,
        allocationMethod,
        ...extraNumbers,
        note: note || undefined,
        originalFileName: file?.name,
        items: preview.items,
      })
    },
    onSuccess: (batch) => {
      toast({ title: "تم حفظ التسعير", description: "الآن راجع الأصناف قبل إنشاء فاتورة الشراء." })
      queryClient.invalidateQueries({ queryKey: ["landed-cost-batches"] })
      navigate(`/inventory/landed-cost/${batch.id}`)
    },
    onError: (err: unknown) => toast({ title: "تعذّر حفظ الدفعة", description: String((err as Error)?.message ?? err), variant: "destructive" }),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelLandedCostBatch(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["landed-cost-batches"] }),
  })

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6" dir="rtl">
      <div>
        <h1 className="text-xl font-bold">استيراد كلفة الشحنة (Landed Cost)</h1>
        <p className="text-sm text-muted-foreground">
          ارفع ملف Excel لأصناف شحنة وارد، وزّع كلفة الشحن والجمارك وغيرها على الأصناف، وحوّل الأوردر المسعّر لفاتورة شراء حقيقية بعد المراجعة.
        </p>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <span className="font-semibold">1. رفع الملف وتوزيع الكلفة</span>
          <a href={getLandedCostTemplateUrl()} className="text-sm text-indigo-600 underline">تحميل نموذج Excel</a>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label>ملف Excel</Label>
              <Input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <div>
              <Label>طريقة توزيع الكلفة الإضافية</Label>
              <Select value={allocationMethod} onValueChange={(v) => setAllocationMethod(v as LandedCostAllocationMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ALLOCATION_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>رقم فاتورة المورّد (اختياري)</Label>
              <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </div>
            <div>
              <Label>اسم المورّد (اختياري، للعرض فقط)</Label>
              <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label>ملاحظة (اختياري)</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="mb-2 block">التكاليف الإضافية الإجمالية للشحنة (تُوزَّع على الأصناف التي لا تحمل كلفتها الخاصة داخل الملف)</Label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
              {(["freight", "customs", "localTransport", "unloading", "commission", "otherCosts"] as const).map((key) => (
                <div key={key}>
                  <Label className="text-xs text-muted-foreground">
                    {{ freight: "الشحن", customs: "الجمارك", localTransport: "نقل داخلي", unloading: "تفريغ", commission: "عمولة", otherCosts: "تكاليف أخرى" }[key]}
                  </Label>
                  <Input type="number" value={extra[key]} onChange={(e) => setExtra((s) => ({ ...s, [key]: e.target.value }))} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <Button disabled={!file || previewMutation.isPending} onClick={() => previewMutation.mutate()}>
              {previewMutation.isPending ? "جاري المعاينة..." : "معاينة"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <span className="font-semibold">2. معاينة النتائج ({preview.items.length} صنف)</span>
            <div className="flex gap-2">
              {preview.notFoundCount > 0 && <Badge variant="warning">{preview.notFoundCount} صنف غير موجود</Badge>}
              {preview.ambiguousCount > 0 && <Badge variant="danger">{preview.ambiguousCount} صنف مكرر بالملف</Badge>}
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-muted-foreground dark:bg-slate-800">
                <tr>
                  <th className="p-2 text-right">كود</th>
                  <th className="p-2 text-right">الاسم</th>
                  <th className="p-2">الكمية</th>
                  <th className="p-2">كراتين</th>
                  <th className="p-2">سعر الشراء</th>
                  <th className="p-2">كلفة موزّعة</th>
                  <th className="p-2">كلفة/قطعة</th>
                  <th className="p-2">كلفة/كرتون</th>
                  <th className="p-2">سعر بيع مقترح</th>
                  <th className="p-2">ربح متوقع</th>
                  <th className="p-2">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.map((it, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2">{it.itemCode || "—"}</td>
                    <td className="p-2">{it.productName}</td>
                    <td className="p-2 text-center">{it.quantity}</td>
                    <td className="p-2 text-center">{it.cartonCount ?? "—"}</td>
                    <td className="p-2 text-center">{money(it.purchasePrice)}</td>
                    <td className="p-2 text-center">{money(it.allocatedExtraCost)}</td>
                    <td className="p-2 text-center font-semibold">{money(it.landedCostPerUnit)}</td>
                    <td className="p-2 text-center">{it.landedCostPerCarton != null ? money(it.landedCostPerCarton) : "—"}</td>
                    <td className="p-2 text-center">{it.suggestedSalePrice != null ? money(it.suggestedSalePrice) : "—"}</td>
                    <td className="p-2 text-center">{it.expectedProfit != null ? money(it.expectedProfit) : "—"}</td>
                    <td className="p-2 text-center">
                      {it.matchStatus === "MATCHED" && <Badge variant="success">مطابق</Badge>}
                      {it.matchStatus === "NOT_FOUND" && <Badge variant="warning">غير موجود</Badge>}
                      {it.matchStatus === "AMBIGUOUS" && <Badge variant="danger">مكرر</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
          <div className="flex justify-end p-4">
            <Button disabled={createBatchMutation.isPending} onClick={() => createBatchMutation.mutate()}>
              {createBatchMutation.isPending ? "جاري الحفظ..." : "تأكيد التسعير ومتابعة إلى المراجعة"}
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader><span className="font-semibold">سجل الاستيرادات السابقة</span></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-muted-foreground dark:bg-slate-800">
              <tr>
                <th className="p-2 text-right">التاريخ</th>
                <th className="p-2 text-right">المورّد</th>
                <th className="p-2">عدد الأصناف</th>
                <th className="p-2">الحالة</th>
                <th className="p-2">فاتورة الشراء</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {(batchesQuery.data ?? []).map((b) => (
                <tr key={b.id} className="border-t">
                  <td className="p-2">{new Date(b.createdAt).toLocaleDateString("en-US")}</td>
                  <td className="p-2">{b.supplier ?? "—"}</td>
                  <td className="p-2 text-center">{b.items?.length ?? 0}</td>
                  <td className="p-2 text-center"><Badge variant={STATUS_LABELS[b.status].variant}>{STATUS_LABELS[b.status].label}</Badge></td>
                  <td className="p-2 text-center">{b.purchaseInvoice?.invoiceNumber ?? "—"}</td>
                  <td className="p-2 flex justify-center gap-2">
                    {b.status !== "PURCHASE_INVOICE_CREATED" && b.status !== "CANCELLED" && (
                      <Button size="sm" variant="outline" onClick={() => navigate(`/inventory/landed-cost/${b.id}`)}>مراجعة</Button>
                    )}
                    {b.status === "PURCHASE_INVOICE_CREATED" && (
                      <Button size="sm" variant="outline" onClick={() => navigate(`/invoices/${b.purchaseInvoice?.id}`)}>عرض الفاتورة</Button>
                    )}
                    {(b.status === "DRAFT_PRICED" || b.status === "REVIEWING_ITEMS") && (
                      <Button size="sm" variant="ghost" onClick={() => cancelMutation.mutate(b.id)}>إلغاء</Button>
                    )}
                  </td>
                </tr>
              ))}
              {(batchesQuery.data ?? []).length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">لا يوجد استيرادات سابقة</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
