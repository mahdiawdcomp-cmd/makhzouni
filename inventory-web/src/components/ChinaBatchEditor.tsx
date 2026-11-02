// «تعديل الدفعة» — a China order after it was priced: download it back as the
// same Excel template, edit, upload and compare row by row before saving; or fix
// one row right here. Saving rewrites the SAME purchase invoice on the server.
import { useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Download, ImagePlus, Upload } from "lucide-react"
import { Card, CardContent, CardHeader } from "./ui/card"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { ConfirmDialog } from "./ui/confirm-dialog"
import { toast } from "./ui/use-toast"
import { apiErrorMessage } from "../utils/apiError"
import { downloadBlobUrl } from "../utils/download"
import { downscaleImage } from "../utils/downscaleImage"
import { cn } from "../utils/cn"
import {
  applyChinaBatchEditFile,
  downloadChinaBatchExcel,
  editChinaBatchRow,
  previewChinaBatchEdit,
  type ChinaEditPreview,
  type ChinaEditResult,
  type LandedCostItem,
} from "../api/endpoints"

const iqd = (n: number) => Math.round(n).toLocaleString("en-US")

type RowDraft = {
  name: string
  salePrice: string
  cartonCount: string
  piecesPerCarton: string
  unitPriceCny: string
  cartonCbm: string
  imageUrl?: string
}

const draftOf = (it: LandedCostItem): RowDraft => ({
  name: it.product?.name ?? it.newProductDraft?.name ?? it.productName,
  salePrice: String(it.product?.salePrice ?? it.confirmedSalePrice ?? ""),
  cartonCount: String(it.cartonCount ?? ""),
  piecesPerCarton: String(it.piecesPerCarton ?? ""),
  unitPriceCny: String(it.unitPriceCny ?? ""),
  cartonCbm: String(it.cartonCbm ?? ""),
})

export function ChinaBatchEditor({ batchId, items, label }: { batchId: string; items: LandedCostItem[]; label: string }) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ChinaEditPreview | null>(null)
  const [confirmApply, setConfirmApply] = useState(false)
  const [showTable, setShowTable] = useState(false)

  const done = (r: ChinaEditResult) => {
    toast({
      title: `انحفظ تعديل ${r.editedRows} صنف`,
      description: r.newInvoiceTotal != null
        ? `فاتورة الشراء ${r.invoiceNumber ?? ""}: ${iqd(r.oldInvoiceTotal ?? 0)} ← ${iqd(r.newInvoiceTotal)} د.ع`
        : "تحدّثت الأصناف",
    })
    for (const key of [["landed-cost-batch", batchId], ["landed-cost-batches"], ["products"], ["invoices"], ["customers"]]) {
      void qc.invalidateQueries({ queryKey: key })
    }
  }
  const onErr = (title: string) => (e: unknown) => toast({ title, description: apiErrorMessage(e), variant: "destructive" })

  const downloadMut = useMutation({
    mutationFn: () => downloadChinaBatchExcel(batchId),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob)
      downloadBlobUrl(url, `${label}-تعديل.xlsx`)
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    },
    onError: onErr("تعذر تنزيل الإكسل"),
  })
  const previewMut = useMutation({
    mutationFn: (f: File) => previewChinaBatchEdit(batchId, f),
    onSuccess: (p) => {
      setPreview(p)
      if (p.rows.length === 0) toast({ title: "ما لكيت أي تغيير بالملف" })
    },
    onError: onErr("تعذر قراءة الملف"),
  })
  const applyMut = useMutation({
    mutationFn: () => applyChinaBatchEditFile(batchId, file!),
    onSuccess: (r) => { done(r); setPreview(null); setFile(null); setConfirmApply(false) },
    onError: onErr("تعذر حفظ التعديلات"),
  })

  const warnCount = preview?.rows.filter((r) => r.warnings.some((w) => w.includes("الكلفة"))).length ?? 0

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">تعديل الدفعة — الأسماء والأسعار والصور والكميات</span>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={downloadMut.isPending} onClick={() => downloadMut.mutate()}>
            <Download className="h-4 w-4" /> {downloadMut.isPending ? "جاري التجهيز..." : "نزّل الإكسل للتعديل"}
          </Button>
          <Button variant="outline" size="sm" disabled={previewMut.isPending} onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" /> {previewMut.isPending ? "جاري المقارنة..." : "ارفع الإكسل المعدّل"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowTable((v) => !v)}>
            {showTable ? "إخفاء التعديل السريع" : "تعديل سريع هنا"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ""
              if (!f) return
              setFile(f)
              setPreview(null)
              previewMut.mutate(f)
            }}
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-5 text-sm">
        <p className="text-xs text-muted-foreground">
          نزّل الإكسل، عدّل الاسم أو سعر البيع أو الكمية أو الصورة، وارفعه. يطلعلك قبل ← بعد لكل صنف، وما ينحفظ شي
          لحد ما تضغط «احفظ». الحفظ يحدّث نفس فاتورة الشراء والمخزن والكلفة.
        </p>

        {preview && preview.rows.length > 0 && (
          <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50/50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <b>{preview.rows.length} صنف تغيّر</b>
              <span>مجموع الفاتورة: {iqd(preview.oldTotal)} ← <b>{iqd(preview.newTotal)}</b> د.ع</span>
              {warnCount > 0 && <span className="font-semibold text-red-600">{warnCount} صنف سعر بيعه تحت الكلفة</span>}
            </div>
            {preview.unmatched.length > 0 && (
              <p className="text-xs text-red-600">أرقام بالملف مو موجودة بالدفعة (ما راح تنحفظ): {preview.unmatched.join("، ")}</p>
            )}
            {preview.missingFromFile.length > 0 && (
              <p className="text-xs text-muted-foreground">أصناف مو موجودة بالملف (تبقى مثل ما هي): {preview.missingFromFile.length}</p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="p-1.5 text-right">رقم المادة</th>
                    <th className="p-1.5">الصورة</th>
                    <th className="p-1.5 text-right">الاسم</th>
                    <th className="p-1.5">سعر البيع</th>
                    <th className="p-1.5">القطع</th>
                    <th className="p-1.5">كلفة القطعة</th>
                    <th className="p-1.5 text-right">ملاحظات</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => {
                    const loss = r.warnings.some((w) => w.includes("الكلفة"))
                    return (
                      <tr key={r.itemId} className={cn("border-t", loss && "bg-red-50 dark:bg-red-950/30")}>
                        <td className="p-1.5 font-semibold">{r.itemCode}</td>
                        <td className="p-1.5 text-center">
                          {r.newImageThumb ? <img src={r.newImageThumb} alt="" className="mx-auto h-9 w-9 rounded object-cover" /> : "—"}
                        </td>
                        <td className="p-1.5">
                          {r.before.name !== r.after.name ? <><s className="text-muted-foreground">{r.before.name}</s><br /><b>{r.after.name}</b></> : r.after.name}
                        </td>
                        <td className="p-1.5 text-center">
                          {r.before.salePrice !== r.after.salePrice ? <>{iqd(r.before.salePrice)} ← <b>{iqd(r.after.salePrice)}</b></> : iqd(r.after.salePrice)}
                        </td>
                        <td className="p-1.5 text-center">
                          {r.before.pieces !== r.after.pieces ? <>{r.before.pieces} ← <b>{r.after.pieces}</b></> : r.after.pieces}
                        </td>
                        <td className="p-1.5 text-center">
                          {r.before.unitCostIqd !== r.after.unitCostIqd ? <>{iqd(r.before.unitCostIqd)} ← <b>{iqd(r.after.unitCostIqd)}</b></> : iqd(r.after.unitCostIqd)}
                        </td>
                        <td className="p-1.5">
                          {r.warnings.map((w) => (
                            <span key={w} className={cn("me-1 inline-block rounded px-1.5 py-0.5", w.includes("الكلفة") ? "bg-red-600 text-white" : "bg-amber-200 text-amber-900")}>{w}</span>
                          ))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <Button disabled={applyMut.isPending || !file} onClick={() => setConfirmApply(true)}>
                {applyMut.isPending ? "جاري الحفظ..." : `احفظ التعديلات (${preview.rows.length})`}
              </Button>
              <Button variant="outline" onClick={() => { setPreview(null); setFile(null) }}>إلغاء</Button>
            </div>
          </div>
        )}

        {showTable && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="p-1.5 text-right">رقم المادة</th>
                  <th className="p-1.5">الصورة</th>
                  <th className="p-1.5 text-right">الاسم</th>
                  <th className="p-1.5">سعر البيع</th>
                  <th className="p-1.5">كراتين</th>
                  <th className="p-1.5">قطع/كرتون</th>
                  <th className="p-1.5">سعر ¥</th>
                  <th className="p-1.5">CBM</th>
                  <th className="p-1.5">كلفة القطعة</th>
                  <th className="p-1.5" />
                </tr>
              </thead>
              <tbody>
                {items.filter((it) => it.action !== "SKIP").map((it) => (
                  <QuickRow key={it.id} batchId={batchId} item={it} onSaved={done} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmApply}
        title="حفظ تعديلات الإكسل؟"
        description={`${preview?.rows.length ?? 0} صنف يتحدّث، ونفس فاتورة الشراء تتحدّث: ${iqd(preview?.oldTotal ?? 0)} ← ${iqd(preview?.newTotal ?? 0)} د.ع${warnCount ? ` — انتبه: ${warnCount} صنف سعر بيعه تحت الكلفة` : ""}`}
        confirmLabel="احفظ"
        loading={applyMut.isPending}
        onConfirm={() => applyMut.mutate()}
        onCancel={() => setConfirmApply(false)}
      />
    </Card>
  )
}

function QuickRow({ batchId, item, onSaved }: { batchId: string; item: LandedCostItem; onSaved: (r: ChinaEditResult) => void }) {
  const initial = draftOf(item)
  const [d, setD] = useState<RowDraft>(initial)
  const imgRef = useRef<HTMLInputElement>(null)
  const dirty = (Object.keys(initial) as (keyof RowDraft)[]).some((k) => d[k] !== initial[k]) || Boolean(d.imageUrl)
  const cost = Number(item.landedCostPerUnit ?? 0)
  const sale = Number(d.salePrice) || 0
  const loss = sale > 0 && sale <= cost
  const thumb = d.imageUrl ?? item.product?.thumbnailUrl ?? item.product?.imageUrl ?? item.newProductDraft?.imageUrl ?? null

  const saveMut = useMutation({
    mutationFn: () => {
      const n = (v: string) => (v.trim() === "" ? undefined : Number(v))
      return editChinaBatchRow(batchId, item.id, {
        name: d.name !== initial.name ? d.name : undefined,
        salePrice: d.salePrice !== initial.salePrice ? n(d.salePrice) : undefined,
        cartonCount: d.cartonCount !== initial.cartonCount ? n(d.cartonCount) : undefined,
        piecesPerCarton: d.piecesPerCarton !== initial.piecesPerCarton ? n(d.piecesPerCarton) : undefined,
        unitPriceCny: d.unitPriceCny !== initial.unitPriceCny ? n(d.unitPriceCny) : undefined,
        cartonCbm: d.cartonCbm !== initial.cartonCbm ? n(d.cartonCbm) : undefined,
        imageUrl: d.imageUrl,
      })
    },
    onSuccess: (r) => { setD((cur) => ({ ...cur, imageUrl: undefined })); onSaved(r) },
    onError: (e) => toast({ title: "تعذر حفظ الصنف", description: apiErrorMessage(e), variant: "destructive" }),
  })

  const field = (k: Exclude<keyof RowDraft, "imageUrl">, w: string, type = "number") => (
    <Input type={type} value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} className={cn("h-8 text-xs", w, k === "salePrice" && loss && "border-red-500 text-red-600")} />
  )

  return (
    <tr className={cn("border-t", loss && "bg-red-50 dark:bg-red-950/30")}>
      <td className="p-1.5 font-semibold">{item.itemCode}</td>
      <td className="p-1.5 text-center">
        <button type="button" onClick={() => imgRef.current?.click()} className="relative" title="غيّر الصورة">
          {thumb ? <img src={thumb} alt="" className="h-9 w-9 rounded object-cover" /> : <ImagePlus className="h-6 w-6 text-slate-400" />}
        </button>
        <input
          ref={imgRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ""
            if (!f) return
            try {
              const url = await downscaleImage(f, 900, 0.82)
              setD((cur) => ({ ...cur, imageUrl: url }))
            } catch {
              toast({ title: "تعذر قراءة الصورة", variant: "destructive" })
            }
          }}
        />
      </td>
      <td className="p-1.5">{field("name", "min-w-[180px]", "text")}</td>
      <td className="p-1.5">{field("salePrice", "w-24")}</td>
      <td className="p-1.5">{field("cartonCount", "w-16")}</td>
      <td className="p-1.5">{field("piecesPerCarton", "w-16")}</td>
      <td className="p-1.5">{field("unitPriceCny", "w-20")}</td>
      <td className="p-1.5">{field("cartonCbm", "w-20")}</td>
      <td className={cn("p-1.5 text-center font-semibold", loss && "text-red-600")}>{iqd(cost)}</td>
      <td className="p-1.5">
        <Button size="sm" disabled={!dirty || saveMut.isPending} onClick={() => saveMut.mutate()}>
          {saveMut.isPending ? "..." : "احفظ"}
        </Button>
      </td>
    </tr>
  )
}
