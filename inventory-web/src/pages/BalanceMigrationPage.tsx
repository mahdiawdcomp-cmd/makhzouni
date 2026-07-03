import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, Ban, CheckCircle2, FileUp, RotateCcw, Search, Undo2, Upload } from "lucide-react"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { useToast } from "../components/ui/use-toast"
import { usePageTitle } from "../hooks/usePageTitle"
import { getCustomers, applyOpeningBalances, type BalanceMigrationEntry } from "../api/endpoints"
import { parseStatementFile } from "../utils/statementParse"
import type { Customer } from "../types/api"

// ─────────────────────────────────────────────────────────────────────────
// TEMPORARY «نقل الأرصدة» page — imports opening balances from the shop's OLD
// accounting system. Delete this page (route + file + sidebar link) once the
// one-time migration is done. The uploaded PDF/Excel is parsed in the browser
// and is NEVER uploaded, saved to the repo, or committed.
// ─────────────────────────────────────────────────────────────────────────

type RowStatus = "pending" | "skipped" | "applied"
type RowAction = "create" | "link"

interface WorkRow {
  tempId: string
  name: string
  amount: number
  phone?: string
  raw: string
  status: RowStatus
  action: RowAction
  customerId?: string
  customerName?: string
  skipReason?: string
}

const SKIP_REASONS = [
  "رصيد قديم وهمي",
  "زبون مكرر",
  "لا أريد نقله",
  "غير معروف",
  "سبب آخر",
]

const STORAGE_KEY = "balanceMigration.v1"

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n))
}

function normalizeName(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase()
}

let idCounter = 0
function nextId(): string {
  idCounter += 1
  return `r${Date.now()}_${idCounter}`
}

export function BalanceMigrationPage() {
  usePageTitle("نقل الأرصدة من النظام القديم")
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [rows, setRows] = useState<WorkRow[]>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY)
      if (saved) return JSON.parse(saved) as WorkRow[]
    } catch { /* ignore */ }
    return []
  })
  const [parsing, setParsing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [showFinal, setShowFinal] = useState(false)
  const [readInfo, setReadInfo] = useState<{ totalLines: number; source: string } | null>(null)
  const [skipFor, setSkipFor] = useState<string | null>(null) // tempId awaiting a reason

  // Existing customers, for linking / auto-matching.
  const { data: customers = [] } = useQuery({
    queryKey: ["customers", "all-for-migration"],
    queryFn: () => getCustomers({ limit: 5000 }),
    staleTime: 60_000,
  })

  // Persist the working set so a refresh doesn't lose skip decisions.
  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(rows)) } catch { /* ignore */ }
  }, [rows])

  const customerByName = useMemo(() => {
    const m = new Map<string, Customer>()
    for (const c of customers) {
      const k = normalizeName(c.name)
      if (!m.has(k)) m.set(k, c)
    }
    return m
  }, [customers])

  async function handleFile(file: File) {
    setParsing(true)
    try {
      const result = await parseStatementFile(file)
      const work: WorkRow[] = result.rows.map((r) => {
        const match = customerByName.get(normalizeName(r.name))
        return {
          tempId: nextId(),
          name: r.name,
          amount: r.amount,
          phone: r.phone,
          raw: r.raw,
          status: "pending",
          action: match ? "link" : "create",
          customerId: match?.id,
          customerName: match?.name,
        }
      })
      setRows(work)
      setReadInfo({ totalLines: result.totalLines, source: result.source })
      setShowFinal(false)
      toast({
        title: "تمت القراءة",
        description: `عدد الأسطر المقروءة: ${result.totalLines} — صفوف صالحة: ${work.length}`,
      })
    } catch (err) {
      toast({
        variant: "destructive",
        title: "تعذّرت القراءة",
        description: err instanceof Error ? err.message : "جرّب رفع ملف Excel/CSV بدل الـ PDF",
      })
    } finally {
      setParsing(false)
    }
  }

  function patch(tempId: string, updates: Partial<WorkRow>) {
    setRows((prev) => prev.map((r) => (r.tempId === tempId ? { ...r, ...updates } : r)))
  }

  function confirmSkip(tempId: string, reason: string) {
    patch(tempId, { status: "skipped", skipReason: reason })
    setSkipFor(null)
  }

  function unskip(tempId: string) {
    patch(tempId, { status: "pending", skipReason: undefined })
  }

  // Derived counts. Skipped rows are EXCLUDED from every apply total.
  const pending = rows.filter((r) => r.status === "pending")
  const skipped = rows.filter((r) => r.status === "skipped")
  const applied = rows.filter((r) => r.status === "applied")
  const applyTotal = pending.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const skippedTotal = skipped.reduce((s, r) => s + (Number(r.amount) || 0), 0)

  async function handleApply() {
    // GUARD: build entries ONLY from pending rows. Skipped/applied never enter.
    const entries: BalanceMigrationEntry[] = pending.map((r) => ({
      tempId: r.tempId,
      action: r.action,
      name: r.name,
      phone: r.phone ?? null,
      amount: Number(r.amount) || 0,
      customerId: r.action === "link" ? r.customerId ?? null : null,
    }))

    const badLink = pending.find((r) => r.action === "link" && !r.customerId)
    if (badLink) {
      toast({ variant: "destructive", title: "صف بلا زبون مرتبط", description: `«${badLink.name}» — اختر زبون أو حوّله لإنشاء جديد أو تخطّاه` })
      return
    }
    if (entries.length === 0) {
      toast({ variant: "destructive", title: "لا توجد صفوف للتطبيق" })
      return
    }

    setApplying(true)
    try {
      const res = await applyOpeningBalances(entries)
      const okIds = new Set(res.results.filter((x) => x.status !== "failed").map((x) => x.tempId))
      setRows((prev) => prev.map((r) => (okIds.has(r.tempId) ? { ...r, status: "applied" } : r)))
      setShowFinal(false)
      toast({
        title: "تم التطبيق",
        description: `أُنشئ ${res.created} — رُبط ${res.linked} — فشل ${res.failed} — المجموع المطبّق ${fmt(res.totalApplied)}`,
      })
      const firstErr = res.results.find((x) => x.status === "failed")
      if (firstErr) {
        toast({ variant: "destructive", title: `فشل ${res.failed} صف`, description: firstErr.error ?? "" })
      }
    } catch (err) {
      toast({ variant: "destructive", title: "فشل التطبيق", description: err instanceof Error ? err.message : "" })
    } finally {
      setApplying(false)
    }
  }

  function resetAll() {
    setRows([])
    setReadInfo(null)
    setShowFinal(false)
    sessionStorage.removeItem(STORAGE_KEY)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4" dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">نقل الأرصدة من النظام القديم</h1>
          <p className="text-sm text-muted-foreground">
            ارفع كشف الحساب (PDF أو Excel/CSV). الملف يُقرأ داخل المتصفح فقط ولا يُرفع للخادم.
          </p>
        </div>
        {rows.length > 0 && (
          <Button variant="ghost" size="sm" onClick={resetAll}>
            <RotateCcw className="ml-1 h-4 w-4" /> مسح والبدء من جديد
          </Button>
        )}
      </div>

      {/* Upload */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-6">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.xlsx,.xls,.csv,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
              e.target.value = ""
            }}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={parsing}>
            {parsing ? <Upload className="ml-1 h-4 w-4 animate-pulse" /> : <FileUp className="ml-1 h-4 w-4" />}
            {parsing ? "جارٍ القراءة…" : "رفع الكشف"}
          </Button>
          {readInfo && (
            <span className="text-sm text-muted-foreground">
              المصدر: {readInfo.source === "pdf" ? "PDF" : "Excel/CSV"} — أسطر مقروءة: {readInfo.totalLines} — صفوف صالحة: {rows.length}
            </span>
          )}
          <span className="text-xs text-amber-600">
            لو صارت قراءة الـ PDF غير دقيقة، صدّر الكشف كـ Excel/CSV وارفعه.
          </span>
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <>
          {/* Summary bar */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryStat label="إجمالي الصفوف" value={String(rows.length)} />
            <SummaryStat label="سيُطبّق" value={String(pending.length)} sub={`${fmt(applyTotal)} د.ع`} tone="green" />
            <SummaryStat label="متخطّى" value={String(skipped.length)} sub={`${fmt(skippedTotal)} د.ع (للعلم فقط)`} tone="amber" />
            <SummaryStat label="مطبّق" value={String(applied.length)} tone="blue" />
          </div>

          {/* Rows */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">مراجعة الصفوف</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {rows.map((r) => (
                <RowItem
                  key={r.tempId}
                  row={r}
                  customers={customers}
                  onPatch={patch}
                  onAskSkip={() => setSkipFor(r.tempId)}
                  onUnskip={() => unskip(r.tempId)}
                  isAskingSkip={skipFor === r.tempId}
                  onConfirmSkip={(reason) => confirmSkip(r.tempId, reason)}
                  onCancelSkip={() => setSkipFor(null)}
                />
              ))}
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-lg border bg-background/95 p-3 backdrop-blur">
            <div className="text-sm">
              سيُطبّق <b className="text-green-600">{pending.length}</b> صف بمجموع{" "}
              <b className="text-green-600">{fmt(applyTotal)}</b> — المتخطّى{" "}
              <b className="text-amber-600">{skipped.length}</b> (لا يدخل بالمجموع)
            </div>
            <Button onClick={() => setShowFinal(true)} disabled={applying || pending.length === 0}>
              <CheckCircle2 className="ml-1 h-4 w-4" /> مراجعة نهائية وتطبيق
            </Button>
          </div>
        </>
      )}

      {/* Final review modal */}
      {showFinal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
          <div className="w-full max-w-lg rounded-lg bg-background p-5 shadow-xl">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> المراجعة النهائية
            </h2>
            <div className="space-y-2 text-sm">
              <FinalRow label="عدد الصفوف التي ستُطبّق" value={`${pending.length}`} />
              <FinalRow label="مجموع المبالغ التي ستُطبّق" value={`${fmt(applyTotal)} د.ع`} strong />
              <hr />
              <FinalRow label="عدد الصفوف المتخطّاة" value={`${skipped.length}`} tone="amber" />
              <FinalRow label="مجموع مبالغ المتخطّاة (للعلم فقط)" value={`${fmt(skippedTotal)} د.ع`} tone="amber" />
              <p className="rounded bg-amber-50 p-2 text-xs text-amber-700">
                الصفوف المتخطّاة لن تُطبّق ولن تدخل ضمن المجموع الفعلي.
              </p>
              <p className="rounded border border-red-200 bg-red-50 p-2 text-xs font-semibold text-red-700">
                ⚠️ سيتم تعديل «الرصيد الافتتاحي» للزبون مباشرةً — لن يتم إنشاء فاتورة أو سند.
                رصيد الزبون الحالي يُعاد حسابه تلقائياً من الرصيد الافتتاحي + حركاته.
              </p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowFinal(false)} disabled={applying}>رجوع</Button>
              <Button onClick={handleApply} disabled={applying}>
                {applying ? "جارٍ التطبيق…" : `تأكيد وتطبيق ${pending.length} صف`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "green" | "amber" | "blue" }) {
  const color = tone === "green" ? "text-green-600" : tone === "amber" ? "text-amber-600" : tone === "blue" ? "text-blue-600" : ""
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

function FinalRow({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "amber" }) {
  return (
    <div className="flex items-center justify-between">
      <span className={tone === "amber" ? "text-amber-700" : ""}>{label}</span>
      <span className={`${strong ? "text-lg font-bold text-green-600" : "font-medium"} ${tone === "amber" ? "text-amber-700" : ""}`}>{value}</span>
    </div>
  )
}

function RowItem({
  row, customers, onPatch, onAskSkip, onUnskip, isAskingSkip, onConfirmSkip, onCancelSkip,
}: {
  row: WorkRow
  customers: Customer[]
  onPatch: (tempId: string, u: Partial<WorkRow>) => void
  onAskSkip: () => void
  onUnskip: () => void
  isAskingSkip: boolean
  onConfirmSkip: (reason: string) => void
  onCancelSkip: () => void
}) {
  const [query, setQuery] = useState("")
  const [openList, setOpenList] = useState(false)

  const suggestions = useMemo(() => {
    const q = normalizeName(query || row.name)
    if (!q) return []
    return customers.filter((c) => normalizeName(c.name).includes(q)).slice(0, 8)
  }, [query, row.name, customers])

  if (row.status === "applied") {
    return (
      <div className="flex items-center justify-between rounded-md border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm">
        <span className="flex items-center gap-2 text-blue-700">
          <CheckCircle2 className="h-4 w-4" /> {row.name} — {fmt(row.amount)} د.ع
        </span>
        <span className="text-xs text-blue-600">مطبّق ({row.action === "link" ? "ربط" : "إنشاء"})</span>
      </div>
    )
  }

  const skipped = row.status === "skipped"

  return (
    <div className={`rounded-md border px-3 py-2 ${skipped ? "border-amber-200 bg-amber-50/40 opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={row.name}
          disabled={skipped}
          onChange={(e) => onPatch(row.tempId, { name: e.target.value })}
          className="h-9 w-48 flex-shrink-0"
          placeholder="اسم الزبون"
        />
        <Input
          type="number"
          value={row.amount}
          disabled={skipped}
          onChange={(e) => onPatch(row.tempId, { amount: Number(e.target.value) })}
          className="h-9 w-32 flex-shrink-0"
          placeholder="الرصيد"
        />

        {!skipped && (
          <div className="flex items-center gap-1 text-xs">
            <button
              className={`rounded px-2 py-1 ${row.action === "create" ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}
              onClick={() => onPatch(row.tempId, { action: "create", customerId: undefined, customerName: undefined })}
            >
              زبون جديد
            </button>
            <button
              className={`rounded px-2 py-1 ${row.action === "link" ? "bg-blue-100 text-blue-700" : "bg-muted text-muted-foreground"}`}
              onClick={() => { onPatch(row.tempId, { action: "link" }); setOpenList(true) }}
            >
              ربط بموجود
            </button>
          </div>
        )}

        {!skipped && row.action === "link" && (
          <div className="relative">
            <div className="flex items-center gap-1">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={query || row.customerName || ""}
                onChange={(e) => { setQuery(e.target.value); setOpenList(true) }}
                onFocus={() => setOpenList(true)}
                className="h-9 w-52"
                placeholder="ابحث عن زبون موجود…"
              />
            </div>
            {openList && suggestions.length > 0 && (
              <div className="absolute z-20 mt-1 max-h-56 w-64 overflow-auto rounded-md border bg-background shadow-lg">
                {suggestions.map((c) => (
                  <button
                    key={c.id}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-right text-sm hover:bg-muted"
                    onClick={() => {
                      onPatch(row.tempId, { customerId: c.id, customerName: c.name })
                      setQuery("")
                      setOpenList(false)
                    }}
                  >
                    <span>{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.phone}</span>
                  </button>
                ))}
              </div>
            )}
            {row.customerId && (
              <span className="mt-1 block text-xs text-blue-600">مرتبط بـ: {row.customerName}</span>
            )}
          </div>
        )}

        <div className="ms-auto flex items-center gap-2">
          {skipped ? (
            <>
              <span className="text-xs text-amber-700">متخطّى: {row.skipReason}</span>
              <Button variant="ghost" size="sm" onClick={onUnskip}>
                <Undo2 className="ml-1 h-4 w-4" /> إلغاء التخطي
              </Button>
            </>
          ) : (
            <Button variant="destructive" size="sm" onClick={onAskSkip}>
              <Ban className="ml-1 h-4 w-4" /> تخطي هذا الزبون
            </Button>
          )}
        </div>
      </div>

      {row.raw && !skipped && (
        <div className="mt-1 truncate text-[11px] text-muted-foreground" title={row.raw}>السطر الأصلي: {row.raw}</div>
      )}

      {isAskingSkip && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded bg-muted/50 p-2">
          <span className="text-xs text-muted-foreground">سبب التخطي (اختياري):</span>
          {SKIP_REASONS.map((reason) => (
            <button
              key={reason}
              className="rounded border px-2 py-1 text-xs hover:bg-background"
              onClick={() => onConfirmSkip(reason)}
            >
              {reason}
            </button>
          ))}
          <button className="rounded px-2 py-1 text-xs text-muted-foreground underline" onClick={() => onConfirmSkip("")}>
            تخطّي بدون سبب
          </button>
          <button className="rounded px-2 py-1 text-xs" onClick={onCancelSkip}>إلغاء</button>
        </div>
      )}
    </div>
  )
}

export default BalanceMigrationPage
