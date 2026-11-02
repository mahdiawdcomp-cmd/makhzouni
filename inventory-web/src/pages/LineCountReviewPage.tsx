// «جرد بالسطور» review: variances on top, coloured by how big they are (red /
// orange / yellow) and sorted worst first, matched rows folded below, uncounted
// products listed apart. The manager can correct what the worker wrote (a line,
// a total, or a piece↔carton mix-up the page spots), send chosen products back
// for a recount, filter, export to Excel, then accept/reject and «اعتماد» —
// one cash sale for shortages and one cash purchase for overages. Any
// correction puts the item back to «بلا قرار»; nothing is booked unaccepted.
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, ArrowRight, Check, ChevronDown, Download, Pencil, RefreshCw, Search, SlidersHorizontal, Trash2, X } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  decideLineCount,
  deleteLineCountLine,
  editLineCountLine,
  finalizeLineCount,
  getLineCount,
  cancelLineCountRecount,
  markLineCountGone,
  recountLineCount,
  reopenLineCount,
  setLineCountProductTotal,
  swapLineCountUnits,
  type LineCountDecision,
  type LineCountLine,
  type LineCountReview,
  type LineCountReviewItem,
  type LineCountUnit,
} from "../api/lineCount"
import { Button } from "../components/ui/button"
import { Card, CardContent } from "../components/ui/card"
import { toast } from "../components/ui/use-toast"
import { useReadOnly } from "../hooks/useTenantConfig"
import { usePageTitle } from "../hooks/usePageTitle"
import { apiErrorMessage } from "../utils/apiError"
import { cn } from "../utils/cn"
import { normalizeArabic } from "../utils/search"
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

const unitWord = (u: string | null) => (u === "CARTON" ? "كارتون" : "قطعة")

function digitsOnly(v: string) {
  return v
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, "")
}

// ── Severity ────────────────────────────────────────────────────────────────

type Severity = "red" | "orange" | "yellow"

interface Thresholds {
  redValue: number
  orangeValue: number
  redPct: number
  orangePct: number
}

const DEFAULT_THRESHOLDS: Thresholds = { redValue: 250_000, orangeValue: 50_000, redPct: 50, orangePct: 20 }
const THRESHOLDS_KEY = "line-count-thresholds"

function loadThresholds(): Thresholds {
  try {
    const raw = localStorage.getItem(THRESHOLDS_KEY)
    return raw ? { ...DEFAULT_THRESHOLDS, ...(JSON.parse(raw) as Partial<Thresholds>) } : DEFAULT_THRESHOLDS
  } catch {
    return DEFAULT_THRESHOLDS
  }
}

/** Red: big money, or a big share that is also worth something. Orange: either
 * moderately. Yellow: the rest. A product with nothing in the system counts as
 * 100% off. */
function severityOf(it: LineCountReviewItem, th: Thresholds): Severity {
  const pct = it.systemQty > 0 ? (Math.abs(it.delta) / it.systemQty) * 100 : 100
  if (it.value >= th.redValue || (pct >= th.redPct && it.value >= th.orangeValue)) return "red"
  if (it.value >= th.orangeValue || pct >= th.orangePct) return "orange"
  return "yellow"
}

const SEV_RANK: Record<Severity, number> = { red: 0, orange: 1, yellow: 2 }
const SEV_STYLE: Record<Severity, { row: string; chip: string; label: string }> = {
  red: { row: "border-r-8 border-r-red-600 bg-red-50 dark:bg-red-950/40", chip: "bg-red-600 text-white", label: "فرق كبير" },
  orange: { row: "border-r-8 border-r-orange-400 bg-orange-50 dark:bg-orange-950/30", chip: "bg-orange-400 text-white", label: "فرق متوسط" },
  yellow: { row: "border-r-8 border-r-yellow-300 bg-yellow-50/60 dark:bg-yellow-950/20", chip: "bg-yellow-300 text-yellow-900", label: "فرق صغير" },
}

type Filter = "all" | Severity | "unit" | "shortage" | "overage" | "pending" | "edited"

// ── Excel ───────────────────────────────────────────────────────────────────

const DECISION_LABEL: Record<LineCountDecision, string> = { PENDING: "بلا قرار", ACCEPTED: "مقبول", REJECTED: "مرفوض" }

async function exportExcel(s: LineCountReview, th: Thresholds) {
  const XLSX = await import("xlsx")
  const rows = s.items.map((it) => ({
    "المادة": it.productName,
    "رقم المادة": it.itemNumber ?? "",
    "بالنظام (قطعة)": it.systemQty,
    "المعدود (قطعة)": it.countedQty,
    "الفرق (قطعة)": it.delta,
    "الفرق": it.delta === 0 ? "مطابق" : `${it.delta < 0 ? "نقص" : "زيادة"} ${qtyText(Math.abs(it.delta), it.pcsPerCarton)}`,
    "القيمة (د.ع)": it.delta === 0 ? 0 : it.value,
    "الشدة": it.delta === 0 ? "" : SEV_STYLE[severityOf(it, th)].label,
    "القرار": it.delta === 0 ? "" : DECISION_LABEL[it.decision],
    "مشكوك بالوحدة": it.unitSuggestion ? `لو تبدّلت الوحدة يصير ${it.unitSuggestion.countedQty}` : "",
    "العامل كتب بالأصل": it.workerCountedQty ?? "",
    "عدد السطور": it.lines.filter((l) => !l.deleted).length,
  }))
  const uncounted = s.uncounted.map((u) => ({ "المادة": u.productName, "رقم المادة": u.itemNumber ?? "", "بالنظام (قطعة)": u.systemQty }))
  const wb = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(rows)
  sheet["!views"] = [{ RTL: true }]
  XLSX.utils.book_append_sheet(wb, sheet, "المحسوبة")
  if (uncounted.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(uncounted), "ما انحسبت")
  XLSX.writeFile(wb, `جرد-${s.warehouseName}-${(s.submittedAt ?? s.createdAt).slice(0, 10)}.xlsx`)
}

/** For checking against the paper count sheets: every line exactly in the
 * order it was typed, with no system stock and no prices, so it can go to the
 * person who counted. Corrections show beside what was originally typed. */
async function exportEntryOrder(s: LineCountReview) {
  const XLSX = await import("xlsx")
  const lines = s.items
    .flatMap((it) => it.lines.map((l) => ({ it, l })))
    .sort((a, b) => a.l.position - b.l.position)
  const rows = lines.map(({ it, l }) => {
    const typedQty = l.originalQty ?? l.qty
    const typedUnit = l.originalUnit ?? l.unit
    const corrected = l.originalQty !== null && (l.originalQty !== l.qty || l.originalUnit !== l.unit)
    return {
      "التسلسل": l.position,
      "المادة": it.productName,
      "رقم المادة": it.itemNumber ?? "",
      "الكمية": l.source === "ADMIN" ? "" : typedQty,
      "الوحدة": l.source === "ADMIN" ? "" : unitWord(typedUnit),
      "ملاحظة": l.source === "ADMIN"
        ? `مجموع صحّحه المدير: ${l.qty} ${unitWord(l.unit)}${l.deleted ? " (محذوف)" : ""}`
        : [corrected ? `صُحّح إلى ${l.qty} ${unitWord(l.unit)}` : "", l.deleted ? "محذوف" : ""].filter(Boolean).join(" — "),
    }
  })
  const sheet = XLSX.utils.json_to_sheet(rows)
  sheet["!views"] = [{ RTL: true }]
  sheet["!cols"] = [{ wch: 8 }, { wch: 40 }, { wch: 14 }, { wch: 10 }, { wch: 8 }, { wch: 36 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, "بترتيب الإدخال")
  XLSX.writeFile(wb, `مطابقة-جرد-${s.warehouseName}-${(s.submittedAt ?? s.createdAt).slice(0, 10)}.xlsx`)
}

// ── Page ────────────────────────────────────────────────────────────────────

export function LineCountReviewPage() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const readOnly = useReadOnly()
  const [showMatched, setShowMatched] = useState(false)
  const [showUncounted, setShowUncounted] = useState(true)
  const [showThresholds, setShowThresholds] = useState(false)
  const [thresholds, setThresholds] = useState<Thresholds>(loadThresholds)
  const [filter, setFilter] = useState<Filter>("all")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const q = useQuery({ queryKey: ["line-count", id], queryFn: () => getLineCount(id), enabled: Boolean(id) })
  usePageTitle("مراجعة الجرد بالسطور")

  const refresh = () => qc.invalidateQueries({ queryKey: ["line-count", id] })
  const onErr = (fallback: string) => (err: unknown) => toast({ title: apiErrorMessage(err, fallback), variant: "destructive" })

  const decideMut = useMutation({
    mutationFn: (v: { decision: LineCountDecision; productId?: string; productIds?: string[] }) => decideLineCount(id, v.decision, v.productId, v.productIds),
    onSuccess: refresh,
    onError: onErr("تعذر حفظ القرار"),
  })
  const finalizeMut = useMutation({
    mutationFn: () => finalizeLineCount(id),
    onSuccess: async () => {
      toast({ title: "اعتُمد الجرد وانكتبت الفواتير" })
      await Promise.all([refresh(), ...["line-counts", "line-count-watch", "invoices", "products", "branches", "negative-stock", "stock-history"].map((k) => qc.invalidateQueries({ queryKey: [k] }))])
    },
    onError: onErr("تعذر الاعتماد"),
  })
  const reopenMut = useMutation({
    mutationFn: () => reopenLineCount(id),
    onSuccess: async () => {
      toast({ title: "رجع الجرد للعامل — نفس الرابط" })
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ["line-counts"] })])
      navigate(-1)
    },
    onError: onErr("تعذر إعادة الفتح"),
  })
  const recountMut = useMutation({
    mutationFn: (productIds: string[]) => recountLineCount(id, productIds),
    onSuccess: async (r) => {
      toast({ title: `رجعت ${r.products} مادة للعامل يعدّها — نفس الرابط` })
      setSelected(new Set())
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ["line-counts"] })])
    },
    onError: onErr("تعذر إرسال إعادة العدّ"),
  })

  const cancelRecountMut = useMutation({
    mutationFn: () => cancelLineCountRecount(id),
    onSuccess: async () => {
      toast({ title: "رجع الجرد للمراجعة — كل شي مثل ما كان" })
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: ["line-counts"] })])
    },
    onError: onErr("تعذر إلغاء إعادة العدّ"),
  })
  const goneMut = useMutation({
    mutationFn: (productIds: string[]) => markLineCountGone(id, productIds),
    onSuccess: async () => {
      toast({ title: "انحسبت صفر — تنتظر قبولك مثل باقي الفروقات" })
      await refresh()
    },
    onError: onErr("تعذر الحفظ"),
  })

  const s = q.data
  const items = s?.items ?? []
  const diffs = useMemo(
    () =>
      items
        .filter((i) => i.delta !== 0)
        .map((it) => ({ it, sev: severityOf(it, thresholds) }))
        .sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev] || b.it.value - a.it.value || Math.abs(b.it.delta) - Math.abs(a.it.delta)),
    [items, thresholds],
  )
  const visible = useMemo(() => {
    const nq = normalizeArabic(query.trim())
    return diffs.filter(({ it, sev }) => {
      if (nq && !normalizeArabic(it.productName).includes(nq) && !(it.itemNumber ?? "").toLowerCase().includes(query.trim().toLowerCase())) return false
      switch (filter) {
        case "all": return true
        case "unit": return it.unitSuggestion !== null
        case "shortage": return it.delta < 0
        case "overage": return it.delta > 0
        case "pending": return it.decision === "PENDING"
        case "edited": return it.workerCountedQty !== null
        default: return sev === filter
      }
    })
  }, [diffs, filter, query])

  if (q.isLoading) return <div className="text-sm text-slate-500">جاري التحميل…</div>
  if (q.isError || !s) return <div className="text-sm text-red-600">{apiErrorMessage(q.error, "تعذر تحميل الجرد")}</div>

  const editable = s.status === "SUBMITTED" && !readOnly
  const matched = items.filter((i) => i.delta === 0)
  const accepted = diffs.filter((d) => d.it.decision === "ACCEPTED").map((d) => d.it)
  const pending = diffs.filter((d) => d.it.decision === "PENDING")
  const saleTotal = accepted.filter((i) => i.delta < 0).reduce((t, i) => t + i.value, 0)
  const purchaseTotal = accepted.filter((i) => i.delta > 0).reduce((t, i) => t + i.value, 0)
  const hasOverage = accepted.some((i) => i.delta > 0)
  const shortageAll = diffs.filter((d) => d.it.delta < 0).reduce((t, d) => t + d.it.value, 0)
  const overageAll = diffs.filter((d) => d.it.delta > 0).reduce((t, d) => t + d.it.value, 0)
  const count = (f: Filter) =>
    f === "all" ? diffs.length
      : f === "unit" ? diffs.filter((d) => d.it.unitSuggestion).length
      : f === "shortage" ? diffs.filter((d) => d.it.delta < 0).length
      : f === "overage" ? diffs.filter((d) => d.it.delta > 0).length
      : f === "pending" ? pending.length
      : f === "edited" ? diffs.filter((d) => d.it.workerCountedQty !== null).length
      : diffs.filter((d) => d.sev === f).length
  // «قبول سريع»: only undecided rows, and never a suspected unit mix-up — those
  // stay for the manager to look at one by one.
  const acceptGroup = (label: string, rows: typeof diffs) => {
    const open = rows.filter((d) => d.it.decision === "PENDING")
    const take = open.filter((d) => !d.it.unitSuggestion)
    const skipped = open.length - take.length
    const moved = take.filter((d) => d.it.movedAfterWriting).length
    if (take.length === 0) return
    const notes = [
      skipped > 0 ? `${skipped} مادة مشكوك بوحدتها ما انقبلت — شوفها بنفسك.` : "",
      moved > 0 ? `${moved} مادة صارت عليها حركة بعد ما انكتبت.` : "",
    ].filter(Boolean).join("\n")
    if (!confirm(`تقبل ${take.length} ${label}؟${notes ? `\n\n${notes}` : ""}\n\nما ينحسب شي إلا لما تضغط «اعتماد».`)) return
    decideMut.mutate({ decision: "ACCEPTED", productIds: take.map((d) => d.it.productId) })
  }
  const quickCount = (rows: typeof diffs) => rows.filter((d) => d.it.decision === "PENDING" && !d.it.unitSuggestion).length
  const QUICK: { label: string; rows: typeof diffs; cls: string }[] = [
    { label: "فرق صغير", rows: diffs.filter((d) => d.sev === "yellow"), cls: "border-yellow-300 bg-yellow-50 text-yellow-900" },
    { label: "فرق متوسط", rows: diffs.filter((d) => d.sev === "orange"), cls: "border-orange-300 bg-orange-50 text-orange-800" },
    { label: "فرق كبير", rows: diffs.filter((d) => d.sev === "red"), cls: "border-red-300 bg-red-50 text-red-700" },
    { label: "نقص", rows: diffs.filter((d) => d.it.delta < 0), cls: "" },
    { label: "زيادة", rows: diffs.filter((d) => d.it.delta > 0), cls: "" },
    { label: "فرق (الكل)", rows: diffs, cls: "" },
  ]
  const matchedOpen = matched.filter((i) => i.decision !== "ACCEPTED")
  const visibleIds = visible.map((v) => v.it.productId)
  const toggleSelect = (pid: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(pid)) next.delete(pid)
      else next.add(pid)
      return next
    })
  const saveThresholds = (t: Thresholds) => {
    setThresholds(t)
    try { localStorage.setItem(THRESHOLDS_KEY, JSON.stringify(t)) } catch { /* storage blocked */ }
  }

  const FILTERS: { key: Filter; label: string; cls?: string }[] = [
    { key: "all", label: "الكل" },
    { key: "red", label: "كبير", cls: "data-[on=true]:bg-red-600 data-[on=true]:text-white" },
    { key: "orange", label: "متوسط", cls: "data-[on=true]:bg-orange-400 data-[on=true]:text-white" },
    { key: "yellow", label: "صغير", cls: "data-[on=true]:bg-yellow-300 data-[on=true]:text-yellow-900" },
    { key: "unit", label: "مشكوك بالوحدة" },
    { key: "shortage", label: "نقص" },
    { key: "overage", label: "زيادة" },
    { key: "pending", label: "بلا قرار" },
    { key: "edited", label: "معدّلة" },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-4">
      <Button variant="ghost" className="px-0" onClick={() => navigate("/inventory/line-count")}>
        <ArrowRight className="h-4 w-4" /> رجوع للجرد بالسطور
      </Button>

      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="text-2xl font-bold">جرد بالسطور — {s.warehouseName}</h1>
              <p className="text-sm text-slate-500">
                {s.lineCount} سطر · {items.length} مادة محسوبة · <span className="font-semibold text-red-600">{diffs.length} فيها فرق</span> · {matched.length} مطابقة · {s.uncounted.length} ما انحسبت
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void exportEntryOrder(s).catch(onErr("تعذر التصدير"))}>
                <Download className="h-4 w-4" /> إكسل للمطابقة مع الورق
              </Button>
              <Button variant="outline" size="sm" onClick={() => void exportExcel(s, thresholds).catch(onErr("تعذر التصدير"))}>
                <Download className="h-4 w-4" /> إكسل الفروقات
              </Button>
            </div>
          </div>

          {/* Money summary for every variance, decided or not */}
          {diffs.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg bg-red-50 p-3 dark:bg-red-950/40">
                <p className="text-xs text-red-700">مجموع النقص</p>
                <p className="text-lg font-bold text-red-700">{money(shortageAll)}</p>
              </div>
              <div className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-950/40">
                <p className="text-xs text-emerald-700">مجموع الزيادة</p>
                <p className="text-lg font-bold text-emerald-700">{money(overageAll)}</p>
              </div>
              <div className="rounded-lg bg-slate-100 p-3 dark:bg-slate-800">
                <p className="text-xs text-slate-600 dark:text-slate-300">الصافي</p>
                <p className={cn("text-lg font-bold", overageAll - shortageAll < 0 ? "text-red-700" : "text-emerald-700")}>{money(overageAll - shortageAll)}</p>
              </div>
            </div>
          )}
          {diffs.length > 0 && (
            <p className="flex flex-wrap gap-2 text-xs">
              {(["red", "orange", "yellow"] as const).map((sev) => (
                <span key={sev} className={cn("rounded-full px-2.5 py-1 font-semibold", SEV_STYLE[sev].chip)}>{SEV_STYLE[sev].label}: {count(sev)}</span>
              ))}
              {count("unit") > 0 && <span className="rounded-full bg-violet-600 px-2.5 py-1 font-semibold text-white">مشكوك بالوحدة: {count("unit")}</span>}
            </p>
          )}

          {s.status === "FINALIZED" && (
            <p className="text-sm font-medium text-emerald-700">
              معتمد.
              {s.saleInvoice && <> فاتورة البيع <Link className="underline" to={`/invoices/${s.saleInvoice.id}`}>#{s.saleInvoice.invoiceNumber}</Link>.</>}
              {s.purchaseInvoice && <> فاتورة الشراء <Link className="underline" to={`/invoices/${s.purchaseInvoice.id}`}>#{s.purchaseInvoice.invoiceNumber}</Link>.</>}
              {!s.saleInvoice && !s.purchaseInvoice && " ما انكتبت فواتير (ماكو فروقات مقبولة)."}
            </p>
          )}
          {s.status === "SUBMITTED" && pending.length > 0 && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              🔒 {pending.length} مادة مقفولة بـ{s.warehouseName}: ما تطلع منها بيعة ولا تحويل ولا تالف لحد ما تقبلها أو ترفضها. كل مادة تقرر عليها تنفتح فوراً.
            </p>
          )}
          {s.status === "OPEN" && (
            <p className="text-sm font-medium text-sky-700">
              الجرد عند العامل هسه — تكدر تراجعه بعد ما يرفعه.
              {pending.length > 0 && ` المواد اللي ما قررت عليها (${pending.length}) تبقى مقفولة بالمخزن.`}
            </p>
          )}
          {s.status === "OPEN" && s.recountProductIds.length > 0 && !readOnly && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-violet-50 p-3 text-sm text-violet-800 dark:bg-violet-950/40 dark:text-violet-200">
              <span>{s.recountProductIds.length} مادة عند العامل يعيد عدّها. إذا ما يكدر يعدّها، ألغِ وارجع للمراجعة — كل شي يرجع مثل ما كان.</span>
              <Button
                size="sm"
                variant="outline"
                disabled={cancelRecountMut.isPending}
                onClick={() => { if (confirm("تلغي إعادة العدّ وترجع للمراجعة؟ العدّ القديم لهاي المواد يبقى.")) cancelRecountMut.mutate() }}
              >
                ألغِ إعادة العدّ
              </Button>
            </div>
          )}
          {s.status === "CANCELLED" && <p className="text-sm text-slate-500">هذا الجرد ملغى.</p>}
        </CardContent>
      </Card>

      {editable && hasOverage && <OverageSupplierCard readOnly={readOnly} />}

      {/* Variances */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-red-600">الفروقات ({diffs.length})</h2>
          <button type="button" onClick={() => setShowThresholds((v) => !v)} className="inline-flex items-center gap-1 text-xs text-slate-500 underline">
            <SlidersHorizontal className="h-3.5 w-3.5" /> حدود الألوان
          </button>
        </div>

        {showThresholds && <ThresholdsEditor value={thresholds} onChange={saveThresholds} />}

        {editable && (diffs.length > 0 || matched.length > 0) && (
          <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
            <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">قبول سريع</p>
            <p className="text-xs text-slate-500">يقبل اللي بلا قرار بس. المشكوك بوحدتها ما تنقبل هنا. وما ينحسب شي على المخزن إلا لما تعتمد.</p>
            <div className="flex flex-wrap gap-2">
              {QUICK.map((g) => (
                <Button
                  key={g.label}
                  size="sm"
                  variant="outline"
                  className={g.cls}
                  disabled={decideMut.isPending || quickCount(g.rows) === 0}
                  onClick={() => acceptGroup(`مادة (${g.label})`, g.rows)}
                >
                  <Check className="h-4 w-4" /> اقبل كل {g.label} ({quickCount(g.rows)})
                </Button>
              ))}
              {matched.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-emerald-300 bg-white text-emerald-700"
                  disabled={decideMut.isPending || matchedOpen.length === 0}
                  onClick={() => {
                    if (confirm(`تثبّت ${matchedOpen.length} مادة مطابقة؟ رصيدها ما يتغيّر.`))
                      decideMut.mutate({ decision: "ACCEPTED", productIds: matchedOpen.map((i) => i.productId) })
                  }}
                >
                  <Check className="h-4 w-4" /> {matchedOpen.length > 0 ? `اقبل كل المطابق (${matchedOpen.length})` : "المطابق كله مقبول ✓"}
                </Button>
              )}
            </div>
          </div>
        )}

        {diffs.length > 0 && (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ابحث باسم المادة أو رقمها"
                className="h-10 w-full rounded-md border border-slate-200 bg-white pr-9 pl-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  data-on={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300",
                    "data-[on=true]:border-transparent data-[on=true]:bg-slate-900 data-[on=true]:text-white dark:data-[on=true]:bg-slate-100 dark:data-[on=true]:text-slate-900",
                    f.cls,
                  )}
                >
                  {f.label} ({count(f.key)})
                </button>
              ))}
            </div>
            {editable && (
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={decideMut.isPending || visibleIds.length === 0}
                  onClick={() => {
                    const moved = visible.filter((v) => v.it.movedAfterWriting).length
                    const unit = visible.filter((v) => v.it.unitSuggestion).length
                    const warn = [moved > 0 ? `${moved} مادة صارت عليها حركة بعد ما انكتبت` : "", unit > 0 ? `${unit} مادة مشكوك بوحدتها` : ""].filter(Boolean).join("\n")
                    if (!confirm(`تقبل ${visibleIds.length} فرق المعروضة؟${warn ? `\n\nانتبه:\n${warn}` : ""}`)) return
                    decideMut.mutate({ decision: "ACCEPTED", productIds: visibleIds })
                  }}
                >
                  <Check className="h-4 w-4" /> اقبل المعروض ({visibleIds.length})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={decideMut.isPending || visibleIds.length === 0}
                  onClick={() => { if (confirm(`ترفض ${visibleIds.length} فرق المعروضة؟`)) decideMut.mutate({ decision: "REJECTED", productIds: visibleIds }) }}
                >
                  <X className="h-4 w-4" /> ارفض المعروض
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={visibleIds.length === 0}
                  onClick={() => setSelected((prev) => (visibleIds.every((x) => prev.has(x)) ? new Set([...prev].filter((x) => !visibleIds.includes(x))) : new Set([...prev, ...visibleIds])))}
                >
                  {visibleIds.length > 0 && visibleIds.every((x) => selected.has(x)) ? "إلغاء تحديد المعروض" : "حدّد المعروض"}
                </Button>
                {selected.size > 0 && (
                  <Button
                    size="sm"
                    disabled={recountMut.isPending}
                    onClick={() => {
                      if (confirm(`ترجع ${selected.size} مادة للعامل حتى يعدّها مرة ثانية؟\nنفس الرابط يفتح بس بهاي المواد، وباقي القرارات تبقى.`)) recountMut.mutate([...selected])
                    }}
                  >
                    <RefreshCw className="h-4 w-4" /> أعد عدّ المختار ({selected.size})
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {diffs.length === 0 ? (
          <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">كل المواد المحسوبة مطابقة ✓</p>
        ) : visible.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-500">ماكو مواد بهذا التصفية.</p>
        ) : (
          visible.map(({ it, sev }) => (
            <VarianceRow
              key={it.productId}
              sessionId={id}
              it={it}
              sev={sev}
              editable={editable}
              busy={decideMut.isPending}
              selected={selected.has(it.productId)}
              onSelect={() => toggleSelect(it.productId)}
              onDecide={(d) => decideMut.mutate({ decision: d, productId: it.productId })}
              onChanged={refresh}
            />
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
                  <span>
                    {it.productName}
                    {it.workerCountedQty !== null && <span className="mr-2 text-xs text-violet-700">(معدّلة — العامل كتب {qtyText(it.workerCountedQty, it.pcsPerCarton)})</span>}
                  </span>
                  <span className="text-slate-500">{qtyText(it.countedQty, it.pcsPerCarton)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Uncounted */}
      {s.uncounted.length > 0 && (
        <section>
          <button type="button" onClick={() => setShowUncounted((v) => !v)} className="flex items-center gap-1 text-base font-bold text-amber-700">
            <ChevronDown className={cn("h-4 w-4 transition", showUncounted && "rotate-180")} /> مواد غير مذكورة، يرجى التأكد منها ({s.uncounted.length})
          </button>
          {showUncounted && (
            <>
              <p className="mt-1 text-xs text-slate-500">
                {s.status === "FINALIZED"
                  ? "دخلت المتابعة: إذا ما انباعت ولا انجردت خلال شهرين تطلع بالمواد الراكدة."
                  : "العامل ما كتبها. أرصدتها ما تتغيّر. اللي تتركها تدخل المتابعة بعد الاعتماد: إذا ما انباعت ولا انجردت خلال شهرين تطلع بالمواد الراكدة."}
              </p>
              <ul className="mt-2 divide-y divide-amber-100 rounded-lg border border-amber-200 bg-white dark:divide-slate-800 dark:border-amber-900 dark:bg-slate-900">
                {s.uncounted.map((u) => (
                  <li key={u.productId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                    <span>
                      {u.productName}
                      {u.itemNumber && <span className="ms-2 text-xs text-slate-400">{u.itemNumber}</span>}
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-slate-500">بالنظام {qtyText(u.systemQty, u.pcsPerCarton)}</span>
                      {editable && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={recountMut.isPending}
                            onClick={() => {
                              if (window.confirm(`ترجع «${u.productName}» للعامل يعدّها؟ نفس الرابط، وبس هاي المادة.`)) recountMut.mutate([u.productId])
                            }}
                          >
                            أعد عدّها
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-red-300 text-red-700"
                            disabled={goneMut.isPending}
                            onClick={() => {
                              if (window.confirm(`«${u.productName}» خلصانة؟ تنحسب صفر وتطلع فرق نقص، وما تنعتمد إلا بعد ما تقبلها.`)) goneMut.mutate([u.productId])
                            }}
                          >
                            أكيد خلصانة
                          </Button>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
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
                onClick={() => { if (confirm("ترجع الجرد كله للعامل حتى يعدّل؟\nيفتح نفس الرابط وبي كل السطور مع تصحيحاتك، حتى لو فتحه من جهاز ثاني.\nبس القرارات (قبول/رفض) تنمسح وتعيدها بعد ما يرفع.")) reopenMut.mutate() }}
              >
                أعد الكل للعامل
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

function ThresholdsEditor({ value, onChange }: { value: Thresholds; onChange: (t: Thresholds) => void }) {
  const field = (key: keyof Thresholds, label: string, suffix: string) => (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-40 shrink-0 text-slate-600 dark:text-slate-300">{label}</span>
      <input
        value={String(value[key])}
        onChange={(e) => onChange({ ...value, [key]: Number(digitsOnly(e.target.value) || 0) })}
        inputMode="numeric"
        dir="ltr"
        className="h-9 w-32 rounded-md border border-slate-200 bg-white px-2 text-center tabular-nums dark:border-slate-700 dark:bg-slate-950"
      />
      <span className="text-xs text-slate-400">{suffix}</span>
    </label>
  )
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs text-slate-500">أحمر إذا القيمة فوق الحد الأحمر، أو النسبة فوق النسبة الحمرة والقيمة فوق الحد البرتقالي. برتقالي إذا القيمة أو النسبة فوق حدها البرتقالي. الباقي أصفر. تنحفظ على هذا الجهاز.</p>
      {field("redValue", "أحمر — قيمة الفرق فوق", "د.ع")}
      {field("orangeValue", "برتقالي — قيمة الفرق فوق", "د.ع")}
      {field("redPct", "أحمر — نسبة الفرق فوق", "٪ من النظام")}
      {field("orangePct", "برتقالي — نسبة الفرق فوق", "٪ من النظام")}
      <button type="button" onClick={() => onChange(DEFAULT_THRESHOLDS)} className="text-xs text-sky-700 underline">رجّع الافتراضي</button>
    </div>
  )
}

function VarianceRow({
  sessionId,
  it,
  sev,
  editable,
  busy,
  selected,
  onSelect,
  onDecide,
  onChanged,
}: {
  sessionId: string
  it: LineCountReviewItem
  sev: Severity
  editable: boolean
  busy: boolean
  selected: boolean
  onSelect: () => void
  onDecide: (d: LineCountDecision) => void
  onChanged: () => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const shortage = it.delta < 0
  const sug = it.unitSuggestion
  const swapMut = useMutation({
    mutationFn: () => swapLineCountUnits(sessionId, it.productId, sug!.lineIds),
    onSuccess: async () => {
      toast({ title: "انصححت الوحدة — راجعها واقبلها" })
      await onChanged()
    },
    onError: (err) => toast({ title: apiErrorMessage(err, "تعذر تصحيح الوحدة"), variant: "destructive" }),
  })
  const sugLines = sug ? it.lines.filter((l) => sug.lineIds.includes(l.id)) : []

  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200 p-3 dark:border-slate-700",
        SEV_STYLE[sev].row,
        it.decision === "ACCEPTED" && "ring-2 ring-emerald-500",
        it.decision === "REJECTED" && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2">
          {editable && (
            <input type="checkbox" checked={selected} onChange={onSelect} aria-label="حدّد لإعادة العدّ" className="mt-1.5 h-4 w-4 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="font-semibold">
              <span className={cn("ml-2 rounded px-1.5 py-0.5 text-[11px] font-bold", SEV_STYLE[sev].chip)}>{SEV_STYLE[sev].label}</span>
              {it.productName}
              {it.itemNumber && <span dir="ltr" className="mr-2 font-mono text-xs text-slate-400">{it.itemNumber}</span>}
            </p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span className="text-slate-500">بالنظام: <b className="text-slate-800 dark:text-slate-100">{qtyText(it.systemQty, it.pcsPerCarton)}</b></span>
              <span className="text-slate-500">المعدود: <b className="text-slate-800 dark:text-slate-100">{qtyText(it.countedQty, it.pcsPerCarton)}</b></span>
              <span className={cn("font-bold", sev === "yellow" ? "text-amber-700" : sev === "orange" ? "text-orange-700" : "text-red-700")}>
                {shortage ? "نقص" : "زيادة"} {qtyText(Math.abs(it.delta), it.pcsPerCarton)} · {money(it.value)}
              </span>
            </div>
            {it.workerCountedQty !== null && (
              <p className="mt-1 text-xs font-medium text-violet-700">معدّلة منك — العامل كتب بالأصل {qtyText(it.workerCountedQty, it.pcsPerCarton)}</p>
            )}
            {sug && (
              <div className="mt-2 rounded-md border border-violet-300 bg-violet-50 px-3 py-2 text-sm dark:border-violet-800 dark:bg-violet-950/40">
                <p className="font-semibold text-violet-800 dark:text-violet-200">⚠️ يمكن العامل غلط بالوحدة</p>
                <p className="text-violet-800 dark:text-violet-200">
                  {sugLines.map((l) => `سطر ${l.position}: ${l.qty} ${unitWord(l.unit)} ← ${l.qty} ${unitWord(l.unit === "CARTON" ? "PIECE" : "CARTON")}`).join("، ")}
                  {" — "}يصير المعدود {qtyText(sug.countedQty, it.pcsPerCarton)}
                  {sug.delta === 0 ? " ويطابق النظام." : ` والفرق ${sug.delta < 0 ? "نقص" : "زيادة"} ${qtyText(Math.abs(sug.delta), it.pcsPerCarton)}.`}
                </p>
                {editable && (
                  <Button
                    size="sm"
                    className="mt-1.5 bg-violet-700 hover:bg-violet-800"
                    disabled={swapMut.isPending}
                    onClick={() => { if (confirm("تصحّح الوحدة بهاي السطور؟ المادة ترجع بلا قرار حتى تقبلها أنت.")) swapMut.mutate() }}
                  >
                    صحّح الوحدة
                  </Button>
                )}
              </div>
            )}
            {it.movedAfterWriting && (
              <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" /> صارت حركة على هاي المادة بعد ما انكتبت — تأكد قبل القبول
              </p>
            )}
            {it.unitPrice <= 0 && (
              <p className="mt-1 text-xs font-medium text-amber-700">ما إلها {shortage ? "سعر بيع" : "كلفة"} — القبول راح يوكّف الاعتماد</p>
            )}
            <div className="mt-1 flex gap-3">
              <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-sky-700 underline">
                {it.lines.filter((l) => !l.deleted).length} {it.lines.filter((l) => !l.deleted).length === 1 ? "سطر" : "سطور"}
              </button>
              {editable && (
                <button type="button" onClick={() => { setEditing((v) => !v); setOpen(false) }} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 underline dark:text-slate-200">
                  <Pencil className="h-3 w-3" /> عدّل
                </button>
              )}
            </div>
            {open && !editing && (
              <ul className="mt-1 text-xs text-slate-500">
                {it.lines.map((l) => (
                  <li key={l.id} className={cn(l.deleted && "line-through opacity-60")}>
                    سطر {l.position}: {l.qty} {unitWord(l.unit)} = {l.qtyPieces} قطعة
                    {l.source === "ADMIN" && " (مجموعك)"}
                    {l.originalQty !== null && ` — العامل كتب ${l.originalQty} ${unitWord(l.originalUnit)}`}
                    {l.deleted && " — محذوف"}
                  </li>
                ))}
              </ul>
            )}
          </div>
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
            {DECISION_LABEL[it.decision]}
          </span>
        )}
      </div>
      {editing && editable && <ItemEditor sessionId={sessionId} it={it} onChanged={onChanged} onClose={() => setEditing(false)} />}
    </div>
  )
}

function UnitPicker({ unit, ppc, onChange }: { unit: LineCountUnit; ppc: number; onChange: (u: LineCountUnit) => void }) {
  if (ppc <= 1) return <span className="px-2 text-xs text-slate-500">قطعة</span>
  return (
    <div className="flex shrink-0 rounded-md bg-slate-100 p-0.5 dark:bg-slate-800">
      {(["PIECE", "CARTON"] as const).map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => onChange(u)}
          className={cn("rounded px-2.5 text-xs font-semibold", unit === u ? "bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white" : "text-slate-500")}
        >
          {u === "PIECE" ? "قطعة" : `كارتون (${ppc})`}
        </button>
      ))}
    </div>
  )
}

function ItemEditor({ sessionId, it, onChanged, onClose }: { sessionId: string; it: LineCountReviewItem; onChanged: () => Promise<unknown>; onClose: () => void }) {
  const live = it.lines.filter((l) => !l.deleted)
  const [total, setTotal] = useState("")
  const [totalUnit, setTotalUnit] = useState<LineCountUnit>("PIECE")
  const done = (msg: string) => async () => {
    toast({ title: msg })
    await onChanged()
  }
  const err = (fallback: string) => (e: unknown) => toast({ title: apiErrorMessage(e, fallback), variant: "destructive" })
  const totalMut = useMutation({
    mutationFn: () => setLineCountProductTotal(sessionId, it.productId, Number(total), totalUnit),
    onSuccess: async () => {
      await done("انحفظ المجموع — المادة رجعت بلا قرار")()
      onClose()
    },
    onError: err("تعذر حفظ المجموع"),
  })
  const preview = total === "" ? null : totalUnit === "CARTON" ? Number(total) * Math.max(1, it.pcsPerCarton) : Number(total)

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900">
      <p className="text-xs text-slate-500">أي تعديل يرجّع المادة «بلا قرار»، وكلشي كتبه العامل يبقى محفوظ للأثر.</p>
      <div className="space-y-2">
        <p className="text-sm font-semibold">سطور العامل</p>
        {live.map((l) => <LineEditorRow key={l.id} sessionId={sessionId} line={l} ppc={it.pcsPerCarton} lastLine={live.length === 1} onSaved={done("انحفظ السطر")} onError={err("تعذر الحفظ")} />)}
        {it.lines.filter((l) => l.deleted).map((l) => (
          <p key={l.id} className="text-xs text-slate-400 line-through">سطر {l.position}: {l.qty} {unitWord(l.unit)}{l.source === "ADMIN" ? " (مجموعك)" : ""}</p>
        ))}
      </div>
      <div className="space-y-1 border-t border-slate-100 pt-3 dark:border-slate-800">
        <p className="text-sm font-semibold">أو اكتب المجموع الصحيح للمادة</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={total}
            onChange={(e) => setTotal(digitsOnly(e.target.value))}
            inputMode="numeric"
            dir="ltr"
            placeholder="الكمية"
            className="h-9 w-28 rounded-md border border-slate-200 bg-white px-2 text-center tabular-nums dark:border-slate-700 dark:bg-slate-950"
          />
          <UnitPicker unit={totalUnit} ppc={it.pcsPerCarton} onChange={setTotalUnit} />
          <Button size="sm" disabled={total === "" || totalMut.isPending} onClick={() => totalMut.mutate()}>احفظ المجموع</Button>
          {preview !== null && <span className="text-xs text-slate-500">= {qtyText(preview, it.pcsPerCarton)} · الفرق {preview - it.systemQty > 0 ? "+" : ""}{preview - it.systemQty}</span>}
        </div>
      </div>
      <button type="button" onClick={onClose} className="text-xs text-slate-500 underline">سدّ</button>
    </div>
  )
}

function LineEditorRow({
  sessionId,
  line,
  ppc,
  lastLine,
  onSaved,
  onError,
}: {
  sessionId: string
  line: LineCountLine
  ppc: number
  lastLine: boolean
  onSaved: () => Promise<void>
  onError: (e: unknown) => void
}) {
  const [qty, setQty] = useState(String(line.qty))
  const [unit, setUnit] = useState<LineCountUnit>(line.unit)
  const changed = qty !== String(line.qty) || unit !== line.unit
  const saveMut = useMutation({ mutationFn: () => editLineCountLine(sessionId, line.id, Number(qty), unit), onSuccess: onSaved, onError })
  const delMut = useMutation({ mutationFn: () => deleteLineCountLine(sessionId, line.id), onSuccess: onSaved, onError })
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-14 shrink-0 text-xs text-slate-500">سطر {line.position}</span>
      <input
        value={qty}
        onChange={(e) => setQty(digitsOnly(e.target.value))}
        inputMode="numeric"
        dir="ltr"
        className="h-9 w-24 rounded-md border border-slate-200 bg-white px-2 text-center tabular-nums dark:border-slate-700 dark:bg-slate-950"
      />
      <UnitPicker unit={unit} ppc={ppc} onChange={setUnit} />
      <Button size="sm" variant="outline" disabled={!changed || qty === "" || saveMut.isPending} onClick={() => saveMut.mutate()}>احفظ</Button>
      <button
        type="button"
        aria-label="حذف السطر"
        disabled={delMut.isPending}
        onClick={() => {
          const msg = lastLine ? "هذا آخر سطر — حذفه يخلّي المادة «ما انحسبت» ورصيدها ما يتغيّر. تحذفه؟" : `حذف سطر ${line.position}؟`
          if (confirm(msg)) delMut.mutate()
        }}
        className="flex h-9 w-9 items-center justify-center rounded-md text-red-600 hover:bg-red-50"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      {line.originalQty !== null && <span className="text-xs text-violet-700">العامل كتب {line.originalQty} {unitWord(line.originalUnit)}</span>}
      {line.source === "ADMIN" && <span className="text-xs text-violet-700">مجموعك</span>}
    </div>
  )
}
