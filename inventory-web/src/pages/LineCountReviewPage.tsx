// «جرد بالسطور» review: variances on top (largest value first, in red),
// matched rows folded below, uncounted products listed apart. Accept/reject
// each variance, then «اعتماد» books one cash sale for shortages and one cash
// purchase for overages.
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, ArrowRight, Check, ChevronDown, X } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { decideLineCount, finalizeLineCount, getLineCount, reopenLineCount, type LineCountDecision, type LineCountReviewItem } from "../api/lineCount"
import { Button } from "../components/ui/button"
import { Card, CardContent } from "../components/ui/card"
import { toast } from "../components/ui/use-toast"
import { useReadOnly } from "../hooks/useTenantConfig"
import { usePageTitle } from "../hooks/usePageTitle"
import { apiErrorMessage } from "../utils/apiError"
import { cn } from "../utils/cn"
import { OverageSupplierCard } from "./StocktakePage"

const money = (n: number) => `${Math.round(n).toLocaleString("en-US")} د.ع`

function qtyText(pieces: number, ppc: number) {
  const size = Math.max(1, ppc)
  const abs = Math.abs(pieces)
  if (size <= 1 || abs < size) return `${pieces} قطعة`
  const c = Math.floor(abs / size)
  const r = abs % size
  return `${pieces} قطعة (${c} كارتون${r ? ` + ${r}` : ""})`
}

export function LineCountReviewPage() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const readOnly = useReadOnly()
  const [showMatched, setShowMatched] = useState(false)
  const [showUncounted, setShowUncounted] = useState(false)
  const q = useQuery({ queryKey: ["line-count", id], queryFn: () => getLineCount(id), enabled: Boolean(id) })
  usePageTitle("مراجعة الجرد بالسطور")

  const refresh = () => qc.invalidateQueries({ queryKey: ["line-count", id] })
  const onErr = (fallback: string) => (err: unknown) => toast({ title: apiErrorMessage(err, fallback), variant: "destructive" })

  const decideMut = useMutation({
    mutationFn: (v: { decision: LineCountDecision; productId?: string }) => decideLineCount(id, v.decision, v.productId),
    onSuccess: refresh,
    onError: onErr("تعذر حفظ القرار"),
  })
  const finalizeMut = useMutation({
    mutationFn: () => finalizeLineCount(id),
    onSuccess: async () => {
      toast({ title: "اعتُمد الجرد وانكتبت الفواتير" })
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ["line-counts"] }), qc.invalidateQueries({ queryKey: ["invoices"] }), qc.invalidateQueries({ queryKey: ["products"] })])
    },
    onError: onErr("تعذر الاعتماد"),
  })
  const reopenMut = useMutation({
    mutationFn: () => reopenLineCount(id),
    onSuccess: async () => {
      toast({ title: "رجع الجرد للعامل — نفس الرابط" })
      await qc.invalidateQueries({ queryKey: ["line-counts"] })
      navigate(-1)
    },
    onError: onErr("تعذر إعادة الفتح"),
  })

  if (q.isLoading) return <div className="text-sm text-slate-500">جاري التحميل…</div>
  if (q.isError || !q.data) return <div className="text-sm text-red-600">{apiErrorMessage(q.error, "تعذر تحميل الجرد")}</div>

  const s = q.data
  const editable = s.status === "SUBMITTED" && !readOnly
  const diffs = s.items.filter((i) => i.delta !== 0)
  const matched = s.items.filter((i) => i.delta === 0)
  const accepted = diffs.filter((i) => i.decision === "ACCEPTED")
  const pending = diffs.filter((i) => i.decision === "PENDING")
  const saleTotal = accepted.filter((i) => i.delta < 0).reduce((t, i) => t + i.value, 0)
  const purchaseTotal = accepted.filter((i) => i.delta > 0).reduce((t, i) => t + i.value, 0)
  const hasOverage = accepted.some((i) => i.delta > 0)

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Button variant="ghost" className="px-0" onClick={() => navigate(`/branches/${s.warehouseId}`)}>
        <ArrowRight className="h-4 w-4" /> رجوع للمخزن
      </Button>

      <Card>
        <CardContent className="space-y-2 p-5">
          <h1 className="text-2xl font-bold">جرد بالسطور — {s.warehouseName}</h1>
          <p className="text-sm text-slate-500">
            {s.lineCount} سطر · {s.items.length} مادة محسوبة · <span className="font-semibold text-red-600">{diffs.length} فيها فرق</span> · {matched.length} مطابقة · {s.uncounted.length} ما انحسبت
          </p>
          {s.status === "FINALIZED" && (
            <p className="text-sm font-medium text-emerald-700">
              معتمد.
              {s.saleInvoice && <> فاتورة البيع <Link className="underline" to={`/invoices/${s.saleInvoice.id}`}>#{s.saleInvoice.invoiceNumber}</Link>.</>}
              {s.purchaseInvoice && <> فاتورة الشراء <Link className="underline" to={`/invoices/${s.purchaseInvoice.id}`}>#{s.purchaseInvoice.invoiceNumber}</Link>.</>}
              {!s.saleInvoice && !s.purchaseInvoice && " ما انكتبت فواتير (ماكو فروقات مقبولة)."}
            </p>
          )}
          {s.status === "CANCELLED" && <p className="text-sm text-slate-500">هذا الجرد ملغى.</p>}
        </CardContent>
      </Card>

      {editable && hasOverage && <OverageSupplierCard readOnly={readOnly} />}

      {/* Variances */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-red-600">الفروقات ({diffs.length})</h2>
          {editable && diffs.length > 0 && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={decideMut.isPending} onClick={() => decideMut.mutate({ decision: "ACCEPTED" })}>
                <Check className="h-4 w-4" /> اقبل الكل
              </Button>
              <Button size="sm" variant="outline" disabled={decideMut.isPending} onClick={() => decideMut.mutate({ decision: "REJECTED" })}>
                <X className="h-4 w-4" /> ارفض الكل
              </Button>
            </div>
          )}
        </div>
        {diffs.length === 0 ? (
          <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">كل المواد المحسوبة مطابقة ✓</p>
        ) : (
          diffs.map((it) => (
            <VarianceRow key={it.productId} it={it} editable={editable} busy={decideMut.isPending} onDecide={(d) => decideMut.mutate({ decision: d, productId: it.productId })} />
          ))
        )}
      </section>

      {/* Matched */}
      {matched.length > 0 && (
        <section>
          <button type="button" onClick={() => setShowMatched((v) => !v)} className="flex items-center gap-1 text-base font-bold text-emerald-700">
            <ChevronDown className={cn("h-4 w-4 transition", showMatched && "rotate-180")} /> المطابقة ({matched.length})
          </button>
          {showMatched && (
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
              {matched.map((it) => (
                <li key={it.productId} className="flex justify-between gap-2 px-4 py-2 text-sm">
                  <span>{it.productName}</span>
                  <span className="text-slate-500">{qtyText(it.countedQty, it.pcsPerCarton)}{it.lines.length > 1 ? ` · ${it.lines.length} سطور` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Uncounted */}
      {s.uncounted.length > 0 && (
        <section>
          <button type="button" onClick={() => setShowUncounted((v) => !v)} className="flex items-center gap-1 text-base font-bold text-slate-600">
            <ChevronDown className={cn("h-4 w-4 transition", showUncounted && "rotate-180")} /> ما انحسبت ({s.uncounted.length}) — أرصدتها ما تتغيّر
          </button>
          {showUncounted && (
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
              {s.uncounted.map((u) => (
                <li key={u.productId} className="flex justify-between gap-2 px-4 py-2 text-sm">
                  <span>{u.productName}</span>
                  <span className="text-slate-500">بالنظام {qtyText(u.systemQty, u.pcsPerCarton)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {editable && (
        <Card className="sticky bottom-2 border-2 border-slate-900 dark:border-slate-200">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <p>فاتورة بيع نقدية للنواقص المقبولة: <b>{money(saleTotal)}</b></p>
              <p>فاتورة شراء نقدية للزيادات المقبولة: <b>{money(purchaseTotal)}</b></p>
              {pending.length > 0 && <p className="font-medium text-amber-700">باقي {pending.length} فرق بلا قرار</p>}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={reopenMut.isPending}
                onClick={() => { if (confirm("ترجع الجرد للعامل حتى يعدّل؟ يفتح نفس الرابط.")) reopenMut.mutate() }}
              >
                أعد للعامل
              </Button>
              <Button
                disabled={pending.length > 0 || finalizeMut.isPending}
                onClick={() => {
                  if (confirm(`اعتماد الجرد؟\nبيع نقدي ${money(saleTotal)} · شراء نقدي ${money(purchaseTotal)}\nالمرفوض ما يتغيّر.`)) finalizeMut.mutate()
                }}
              >
                {finalizeMut.isPending ? "دا يعتمد…" : "اعتماد"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function VarianceRow({ it, editable, busy, onDecide }: { it: LineCountReviewItem; editable: boolean; busy: boolean; onDecide: (d: LineCountDecision) => void }) {
  const [open, setOpen] = useState(false)
  const shortage = it.delta < 0
  return (
    <div
      className={cn(
        "rounded-lg border bg-white p-3 dark:bg-slate-900",
        it.decision === "ACCEPTED" ? "border-emerald-300" : it.decision === "REJECTED" ? "border-slate-300 opacity-70" : "border-red-300",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            {it.productName}
            {it.itemNumber && <span dir="ltr" className="mr-2 font-mono text-xs text-slate-400">{it.itemNumber}</span>}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="text-slate-500">بالنظام: <b className="text-slate-800 dark:text-slate-100">{qtyText(it.systemQty, it.pcsPerCarton)}</b></span>
            <span className="text-slate-500">المعدود: <b className="text-slate-800 dark:text-slate-100">{qtyText(it.countedQty, it.pcsPerCarton)}</b></span>
            <span className="font-bold text-red-600">
              {shortage ? "نقص" : "زيادة"} {qtyText(Math.abs(it.delta), it.pcsPerCarton)} · {money(it.value)}
            </span>
          </div>
          {it.movedAfterWriting && (
            <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" /> صارت حركة على هاي المادة بعد ما انكتبت — تأكد قبل القبول
            </p>
          )}
          {it.unitPrice <= 0 && (
            <p className="mt-1 text-xs font-medium text-amber-700">ما إلها {shortage ? "سعر بيع" : "كلفة"} — القبول راح يوكّف الاعتماد</p>
          )}
          <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 text-xs text-sky-700 underline">
            {it.lines.length} {it.lines.length === 1 ? "سطر" : "سطور"}
          </button>
          {open && (
            <ul className="mt-1 text-xs text-slate-500">
              {it.lines.map((l) => (
                <li key={l.position}>سطر {l.position}: {l.qty} {l.unit === "CARTON" ? "كارتون" : "قطعة"} = {l.qtyPieces} قطعة</li>
              ))}
            </ul>
          )}
        </div>
        {editable ? (
          <div className="flex gap-2">
            <Button size="sm" variant={it.decision === "ACCEPTED" ? "default" : "outline"} disabled={busy} onClick={() => onDecide(it.decision === "ACCEPTED" ? "PENDING" : "ACCEPTED")}>
              <Check className="h-4 w-4" /> اقبل
            </Button>
            <Button size="sm" variant={it.decision === "REJECTED" ? "default" : "outline"} disabled={busy} onClick={() => onDecide(it.decision === "REJECTED" ? "PENDING" : "REJECTED")}>
              <X className="h-4 w-4" /> ارفض
            </Button>
          </div>
        ) : (
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", it.decision === "ACCEPTED" ? "bg-emerald-100 text-emerald-700" : it.decision === "REJECTED" ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-800")}>
            {it.decision === "ACCEPTED" ? "مقبول" : it.decision === "REJECTED" ? "مرفوض" : "بلا قرار"}
          </span>
        )}
      </div>
    </div>
  )
}
