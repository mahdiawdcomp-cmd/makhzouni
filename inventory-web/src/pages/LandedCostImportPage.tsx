import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Card, CardHeader, CardContent } from "../components/ui/card"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Label } from "../components/ui/label"
import { Badge } from "../components/ui/badge"
import { toast } from "../components/ui/use-toast"
import { apiErrorMessage } from "../utils/apiError"
import {
  cancelLandedCostBatch,
  createChinaOrderBatch,
  getChinaTemplateUrl,
  listLandedCostBatches,
  previewChinaOrder,
  type ChinaPricingParams,
  type ChinaPricingResult,
  type LandedCostBatch,
} from "../api/endpoints"

const STATUS_LABELS: Record<LandedCostBatch["status"], { label: string; variant: "secondary" | "info" | "success" | "danger" }> = {
  DRAFT_PRICED: { label: "تم التسعير", variant: "info" },
  REVIEWING_ITEMS: { label: "قيد المراجعة", variant: "secondary" },
  PURCHASE_INVOICE_CREATED: { label: "تم إنشاء فاتورة شراء", variant: "success" },
  CANCELLED: { label: "ملغاة", variant: "danger" },
}

function iqd(n: number) {
  return Math.round(n).toLocaleString("en-US")
}

function usd(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export function LandedCostImportPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [file, setFile] = useState<File | null>(null)
  const [invoiceNumber, setInvoiceNumber] = useState("")
  const [supplier, setSupplier] = useState("")
  const [note, setNote] = useState("")
  // Screen inputs — local to this pricing only (no general currency system).
  const [cbmPriceUsd, setCbmPriceUsd] = useState("")
  const [officePercent, setOfficePercent] = useState("")
  const [cnyPerUsd, setCnyPerUsd] = useState("")
  const [usdToIqd, setUsdToIqd] = useState("")
  const [preview, setPreview] = useState<ChinaPricingResult | null>(null)

  const params: ChinaPricingParams = {
    cbmPriceUsd: Number(cbmPriceUsd) || 0,
    officePercent: Number(officePercent) || 0,
    cnyPerUsd: Number(cnyPerUsd) || 0,
    usdToIqd: Number(usdToIqd) || 0,
  }
  const paramsReady = params.cnyPerUsd > 0 && params.usdToIqd > 0

  const batchesQuery = useQuery({ queryKey: ["landed-cost-batches"], queryFn: listLandedCostBatches })

  const previewMutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("اختر ملف Excel أولاً")
      return previewChinaOrder(file, params)
    },
    onSuccess: (result) => setPreview(result),
    onError: (err: unknown) => toast({ title: "تعذّر تسعير الملف", description: apiErrorMessage(err, "تأكد من أن الملف على القالب الثابت ومن مدخلات التسعير"), variant: "destructive" }),
  })

  const createBatchMutation = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error("لا يوجد تسعير")
      return createChinaOrderBatch({
        invoiceNumber: invoiceNumber || undefined,
        supplier: supplier || undefined,
        note: note || undefined,
        originalFileName: file?.name,
        params: preview.params,
        items: preview.items,
      })
    },
    onSuccess: (batch) => {
      toast({ title: "تم حفظ الأوردر المسعّر", description: "الآن راجع الأصناف قبل إنشاء فاتورة الشراء." })
      queryClient.invalidateQueries({ queryKey: ["landed-cost-batches"] })
      navigate(`/inventory/landed-cost/${batch.id}`)
    },
    onError: (err: unknown) => toast({ title: "تعذّر حفظ الأوردر", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelLandedCostBatch(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["landed-cost-batches"] }),
  })

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6" dir="rtl">
      <div>
        <h1 className="text-xl font-bold">تسعيرة أوردر الصين</h1>
        <p className="text-sm text-muted-foreground">
          ارفع ملف Excel بالأعمدة الثابتة (رقم المادة، الصورة، عدد الكراتين، قطع الكارتون، سعر القطعة يوان، حجم الكارتون CBM)،
          وأدخل سعر المتر ونسبة المكتب وأسعار الصرف — يحسب لك كلفة القطعة بالدينار وكل تفاصيل الكارتون.
        </p>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <span className="font-semibold">1. رفع الملف ومدخلات التسعير</span>
          <a href={getChinaTemplateUrl()} className="text-sm text-indigo-600 underline">تحميل قالب Excel الثابت</a>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label>ملف Excel (القالب الثابت)</Label>
              <Input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <div>
              <Label>رقم فاتورة المورّد (اختياري)</Label>
              <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </div>
            <div>
              <Label>اسم المورّد (اختياري)</Label>
              <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            </div>
            <div className="sm:col-span-3">
              <Label>ملاحظة (اختياري)</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <Label className="text-xs">سعر المتر المكعب $ (شحن + كمرك + نقل)</Label>
              <Input type="number" value={cbmPriceUsd} onChange={(e) => setCbmPriceUsd(e.target.value)} placeholder="مثال: 170" />
            </div>
            <div>
              <Label className="text-xs">نسبة المكتب %</Label>
              <Input type="number" value={officePercent} onChange={(e) => setOfficePercent(e.target.value)} placeholder="مثال: 3" />
            </div>
            <div>
              <Label className="text-xs">كم يوان = 1 دولار</Label>
              <Input type="number" value={cnyPerUsd} onChange={(e) => setCnyPerUsd(e.target.value)} placeholder="مثال: 7.2" />
            </div>
            <div>
              <Label className="text-xs">سعر صرف الدولار للدينار</Label>
              <Input type="number" value={usdToIqd} onChange={(e) => setUsdToIqd(e.target.value)} placeholder="مثال: 1400" />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button disabled={!file || !paramsReady || previewMutation.isPending} onClick={() => previewMutation.mutate()}>
              {previewMutation.isPending ? "جاري التسعير..." : "تسعير الأوردر"}
            </Button>
            {!paramsReady && <span className="text-xs text-muted-foreground">أدخل سعر صرف اليوان والدولار أولاً</span>}
          </div>
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <span className="font-semibold">2. الأوردر المسعّر ({preview.items.length} صنف)</span>
            <div className="flex gap-2">
              {preview.notFoundCount > 0 && <Badge variant="warning">{preview.notFoundCount} صنف غير موجود</Badge>}
              {preview.ambiguousCount > 0 && <Badge variant="danger">{preview.ambiguousCount} صنف مكرر بالملف</Badge>}
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-muted-foreground dark:bg-slate-800">
                <tr>
                  <th className="p-2 text-right">رقم المادة</th>
                  <th className="p-2">كراتين</th>
                  <th className="p-2">قطع/كرتون</th>
                  <th className="p-2">إجمالي القطع</th>
                  <th className="p-2">سعر القطعة ¥</th>
                  <th className="p-2">كارتون ¥ (X)</th>
                  <th className="p-2">كارتون $ (Y)</th>
                  <th className="p-2">بعد المكتب $ (Z)</th>
                  <th className="p-2">شحن الكارتون $ (V)</th>
                  <th className="p-2">كلفة الكارتون $ (A)</th>
                  <th className="p-2">القطعة $ (N)</th>
                  <th className="p-2">القطعة د.ع (H)</th>
                  <th className="p-2">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.map((it, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2 font-semibold">{it.itemNumber || "—"}</td>
                    <td className="p-2 text-center">{it.cartonCount}</td>
                    <td className="p-2 text-center">{it.piecesPerCarton}</td>
                    <td className="p-2 text-center">{it.totalPieces}</td>
                    <td className="p-2 text-center">{usd(it.unitPriceCny)}</td>
                    <td className="p-2 text-center">{usd(it.cartonCny)}</td>
                    <td className="p-2 text-center">{usd(it.cartonUsdBeforeOffice)}</td>
                    <td className="p-2 text-center">{usd(it.cartonUsdAfterOffice)}</td>
                    <td className="p-2 text-center">{usd(it.cartonShippingUsd)}</td>
                    <td className="p-2 text-center font-semibold">{usd(it.cartonCostUsd)}</td>
                    <td className="p-2 text-center">{usd(it.unitCostUsd)}</td>
                    <td className="p-2 text-center font-bold">{iqd(it.unitCostIqd)}</td>
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
          <div className="flex flex-col gap-3 border-t p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              <div>إجمالي الكراتين: <b>{preview.totalCartons}</b></div>
              <div>إجمالي القطع: <b>{preview.totalPieces}</b></div>
              <div>كلفة الأوردر: <b>{usd(preview.totalOrderCostUsd)} $</b></div>
              <div>كلفة الأوردر: <b>{iqd(preview.totalOrderCostIqd)} د.ع</b></div>
            </div>
            <Button disabled={createBatchMutation.isPending} onClick={() => createBatchMutation.mutate()}>
              {createBatchMutation.isPending ? "جاري الحفظ..." : "تريد تضيف هذا الأوردر المسعّر كفاتورة شراء؟"}
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader><span className="font-semibold">سجل الأوردرات السابقة</span></CardHeader>
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
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">لا يوجد أوردرات سابقة</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
