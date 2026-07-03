import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  AlertTriangle, Ban, CheckCircle2, ChevronRight, ChevronLeft, FileUp,
  RotateCcw, Search, Undo2, Upload, UserPlus, ClipboardList,
} from "lucide-react"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Card, CardContent } from "../components/ui/card"
import { useToast } from "../components/ui/use-toast"
import { usePageTitle } from "../hooks/usePageTitle"
import { getCustomers, applyOpeningBalances, type BalanceMigrationEntry } from "../api/endpoints"
import { parseStatementFile } from "../utils/statementParse"
import type { Customer } from "../types/api"

// ─────────────────────────────────────────────────────────────────────────
// TEMPORARY OLD ACCOUNTING IMPORT TOOL — «نقل أرصدة النظام القديم».
// One-off wizard: walk the old statement (CSV/Excel/PDF) row by row, match or
// create each customer, then apply the amount as the OFFICIAL opening balance
// (Customer.openingBalance) — currentBalance is re-derived server-side by
// recalculateCustomerBalance(), never written directly. Nothing is applied
// until the final «تطبيق الأرصدة المختارة» confirm. The uploaded file is parsed
// entirely in the browser and is NEVER uploaded, saved to the repo, or
// committed. Delete this page (route + file + sidebar link) after migration.
// ─────────────────────────────────────────────────────────────────────────

type RowStatus = "undecided" | "ready" | "skipped" | "applied"
type RowAction = "link" | "create"

interface WorkRow {
  tempId: string
  oldCode?: string
  name: string       // name as it appears in the OLD statement
  amount: number
  notes?: string
  raw: string
  status: RowStatus
  action?: RowAction
  // link
  customerId?: string
  customerName?: string
  // create (prepared, NOT created until final apply)
  newName?: string
  newPhone?: string
  newNotes?: string
  skipReason?: string
}

const SKIP_REASONS = ["رصيد قديم وهمي", "زبون مكرر", "لا أريد نقله", "غير معروف", "سبب آخر"]
const STORAGE_KEY = "balanceMigration.v2"

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n))
}
function normalizeName(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase()
}
function direction(amount: number): { label: string; cls: string } {
  if (amount > 0) return { label: "عليه (مدين)", cls: "bg-red-100 text-red-700" }
  if (amount < 0) return { label: "له (دائن)", cls: "bg-green-100 text-green-700" }
  return { label: "صفر", cls: "bg-muted text-muted-foreground" }
}

let idCounter = 0
function nextId(): string {
  idCounter += 1
  return `r${Date.now()}_${idCounter}`
}

interface Persisted { rows: WorkRow[]; idx: number; mode: "wizard" | "review" }

export function BalanceMigrationPage() {
  usePageTitle("نقل أرصدة النظام القديم")
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [rows, setRows] = useState<WorkRow[]>([])
  const [idx, setIdx] = useState(0)
  const [mode, setMode] = useState<"wizard" | "review">("wizard")
  const [parsing, setParsing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [readInfo, setReadInfo] = useState<{ totalLines: number; source: string } | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  // Restore any in-progress session.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY)
      if (saved) {
        const p = JSON.parse(saved) as Persisted
        if (Array.isArray(p.rows) && p.rows.length) {
          setRows(p.rows); setIdx(p.idx ?? 0); setMode(p.mode ?? "wizard")
        }
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ rows, idx, mode } as Persisted)) } catch { /* ignore */ }
  }, [rows, idx, mode])

  const { data: customers = [] } = useQuery({
    queryKey: ["customers", "all-for-migration"],
    queryFn: () => getCustomers({ limit: 5000 }),
    staleTime: 60_000,
  })

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
          oldCode: r.oldCode,
          name: r.name,
          amount: r.amount,
          notes: r.notes,
          raw: r.raw,
          status: "undecided" as RowStatus,
          // Pre-suggest a match but leave the row UNDECIDED until the user confirms.
          action: match ? "link" : undefined,
          customerId: match?.id,
          customerName: match?.name,
        }
      })
      setRows(work)
      setIdx(0)
      setMode("wizard")
      setReadInfo({ totalLines: result.totalLines, source: result.source })
      toast({ title: "تمت القراءة", description: `أسطر مقروءة: ${result.totalLines} — صفوف صالحة: ${work.length}` })
    } catch (err) {
      toast({ variant: "destructive", title: "تعذّرت القراءة", description: err instanceof Error ? err.message : "جرّب Excel/CSV بدل الـ PDF" })
    } finally {
      setParsing(false)
    }
  }

  function patch(tempId: string, u: Partial<WorkRow>) {
    setRows((prev) => prev.map((r) => (r.tempId === tempId ? { ...r, ...u } : r)))
  }
  function goNext() { setIdx((i) => Math.min(i + 1, rows.length - 1)) }
  function goPrev() { setIdx((i) => Math.max(i - 1, 0)) }

  // Derived counts. Only READY rows ever apply.
  const ready = rows.filter((r) => r.status === "ready")
  const skipped = rows.filter((r) => r.status === "skipped")
  const applied = rows.filter((r) => r.status === "applied")
  const undecided = rows.filter((r) => r.status === "undecided")
  const newCustomers = ready.filter((r) => r.action === "create")
  const applyTotal = ready.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const skippedTotal = skipped.reduce((s, r) => s + (Number(r.amount) || 0), 0)

  async function handleApply() {
    setShowConfirm(false)
    // GUARD: build entries ONLY from READY rows. skipped/undecided/applied never enter.
    const seen = new Set<string>()
    const entries: BalanceMigrationEntry[] = []
    let dupCount = 0
    for (const r of ready) {
      // No row without a bound customer / prepared new customer.
      if (r.action === "link" && !r.customerId) continue
      if (r.action === "create" && !(r.newName || r.name)) continue
      // Dedup: same target + amount + old code must not apply twice.
      const key = r.action === "link"
        ? `link:${r.customerId}:${r.amount}:${r.oldCode ?? ""}`
        : `create:${normalizeName(r.newName || r.name)}:${r.amount}:${r.oldCode ?? ""}`
      if (seen.has(key)) { dupCount++; continue }
      seen.add(key)
      entries.push({
        tempId: r.tempId,
        action: r.action!,
        name: r.action === "create" ? (r.newName || r.name) : r.name,
        phone: r.action === "create" ? (r.newPhone ?? null) : null,
        amount: Number(r.amount) || 0,
        customerId: r.action === "link" ? r.customerId ?? null : null,
        notes: r.action === "create" ? (r.newNotes ?? r.notes ?? null) : null,
        oldCode: r.oldCode ?? null,
      })
    }

    if (entries.length === 0) {
      toast({ variant: "destructive", title: "لا توجد صفوف جاهزة للتطبيق" })
      return
    }

    setApplying(true)
    try {
      const res = await applyOpeningBalances(entries)
      const okIds = new Set(res.results.filter((x) => x.status !== "failed").map((x) => x.tempId))
      setRows((prev) => prev.map((r) => (okIds.has(r.tempId) ? { ...r, status: "applied" } : r)))
      toast({
        title: "تم التطبيق",
        description: `أُنشئ ${res.created} — رُبط ${res.linked} — فشل ${res.failed}${dupCount ? ` — مكرر متجاهَل ${dupCount}` : ""} — المجموع ${fmt(res.totalApplied)}`,
      })
      const firstErr = res.results.find((x) => x.status === "failed")
      if (firstErr) toast({ variant: "destructive", title: `فشل ${res.failed} صف`, description: firstErr.error ?? "" })
    } catch (err) {
      toast({ variant: "destructive", title: "فشل التطبيق", description: err instanceof Error ? err.message : "" })
    } finally {
      setApplying(false)
    }
  }

  function resetAll() {
    setRows([]); setIdx(0); setMode("wizard"); setReadInfo(null)
    sessionStorage.removeItem(STORAGE_KEY)
  }

  const current = rows[idx]

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4" dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">نقل أرصدة النظام القديم</h1>
          <p className="text-xs text-amber-600">أداة مؤقتة — الملف يُقرأ داخل المتصفح فقط ولا يُرفع للخادم. لا يُطبّق شيء إلا بزر التطبيق النهائي.</p>
        </div>
        {rows.length > 0 && (
          <Button variant="ghost" size="sm" onClick={resetAll}>
            <RotateCcw className="ml-1 h-4 w-4" /> مسح والبدء من جديد
          </Button>
        )}
      </div>

      {/* Upload */}
      {rows.length === 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.xlsx,.xls,.csv,application/pdf"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = "" }}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={parsing}>
              {parsing ? <Upload className="ml-1 h-4 w-4 animate-pulse" /> : <FileUp className="ml-1 h-4 w-4" />}
              {parsing ? "جارٍ القراءة…" : "رفع كشف النظام القديم"}
            </Button>
            <span className="text-xs text-muted-foreground">الأعمدة المتوقعة: الكود القديم / الاسم / المبلغ / ملاحظات — أو PDF (fallback).</span>
          </CardContent>
        </Card>
      )}

      {/* Progress bar */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2 text-xs">
          <span>الإجمالي <b>{rows.length}</b></span>
          <span className="text-green-600">جاهز <b>{ready.length}</b></span>
          <span className="text-amber-600">متخطّى <b>{skipped.length}</b></span>
          <span className="text-blue-600">زبائن جدد <b>{newCustomers.length}</b></span>
          <span className="text-muted-foreground">غير محسوم <b>{undecided.length}</b></span>
          {applied.length > 0 && <span className="text-indigo-600">مطبّق <b>{applied.length}</b></span>}
          {readInfo && <span className="ms-auto text-muted-foreground">المصدر: {readInfo.source === "pdf" ? "PDF" : "Excel/CSV"}</span>}
        </div>
      )}

      {/* WIZARD */}
      {rows.length > 0 && mode === "wizard" && current && (
        <>
          <WizardCard
            key={current.tempId}
            row={current}
            index={idx}
            total={rows.length}
            customers={customers}
            onPatch={patch}
            onNext={goNext}
          />
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" onClick={goPrev} disabled={idx === 0}>
              <ChevronRight className="ml-1 h-4 w-4" /> السابق
            </Button>
            <span className="text-sm text-muted-foreground">صف {idx + 1} من {rows.length}</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={goNext} disabled={idx === rows.length - 1}>
                التالي <ChevronLeft className="mr-1 h-4 w-4" />
              </Button>
              <Button onClick={() => setMode("review")}>
                <ClipboardList className="ml-1 h-4 w-4" /> المراجعة النهائية
              </Button>
            </div>
          </div>
        </>
      )}

      {/* FINAL REVIEW */}
      {rows.length > 0 && mode === "review" && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <SummaryStat label="إجمالي الصفوف" value={String(rows.length)} />
            <SummaryStat label="جاهز للتطبيق" value={String(ready.length)} sub={`${fmt(applyTotal)} د.ع`} tone="green" />
            <SummaryStat label="متخطّى" value={String(skipped.length)} sub={`${fmt(skippedTotal)} (للعلم)`} tone="amber" />
            <SummaryStat label="زبائن جدد" value={String(newCustomers.length)} tone="blue" />
            <SummaryStat label="غير صالح/محسوم" value={String(undecided.length)} tone="muted" />
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="max-h-[50vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 text-xs">
                    <tr>
                      <th className="p-2 text-right">الاسم القديم</th>
                      <th className="p-2 text-right">الزبون المختار</th>
                      <th className="p-2 text-right">المبلغ</th>
                      <th className="p-2 text-right">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const st = statusLabel(r)
                      return (
                        <tr key={r.tempId} className="border-t">
                          <td className="p-2">{r.name}{r.oldCode ? <span className="text-xs text-muted-foreground"> (#{r.oldCode})</span> : null}</td>
                          <td className="p-2">
                            {r.status === "skipped" ? "—"
                              : r.action === "create" ? <span className="text-blue-600">جديد: {r.newName || r.name}</span>
                              : r.customerName ?? <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="p-2">{fmt(r.amount)}</td>
                          <td className={`p-2 ${st.cls}`}>{st.label}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" onClick={() => setMode("wizard")}>
              <ChevronRight className="ml-1 h-4 w-4" /> رجوع للمراجعة صف‑صف
            </Button>
            <Button onClick={() => setShowConfirm(true)} disabled={applying || ready.length === 0}>
              <CheckCircle2 className="ml-1 h-4 w-4" /> تطبيق الأرصدة المختارة ({ready.length})
            </Button>
          </div>
        </>
      )}

      {/* Strong final confirm */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
          <div className="w-full max-w-md rounded-lg bg-background p-5 shadow-xl">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
              <AlertTriangle className="h-5 w-5 text-red-500" /> تأكيد التطبيق
            </h2>
            <p className="text-sm">
              سيتم حفظ هذه المبالغ كـ<b> رصيد أول مدة</b> للزبائن المختارين — عددهم <b className="text-green-600">{ready.length}</b> بمجموع <b className="text-green-600">{fmt(applyTotal)}</b> د.ع.
            </p>
            <p className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-xs font-semibold text-red-700">
              يُعدَّل «الرصيد الافتتاحي» فقط ولا يتم إنشاء فاتورة أو سند. الصفوف المتخطّاة وغير المحسومة لن تُطبّق. هل أنت متأكد؟
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowConfirm(false)} disabled={applying}>إلغاء</Button>
              <Button onClick={handleApply} disabled={applying}>
                {applying ? "جارٍ التطبيق…" : "نعم، طبّق الأرصدة"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function statusLabel(r: WorkRow): { label: string; cls: string } {
  switch (r.status) {
    case "applied": return { label: "مطبّق", cls: "text-indigo-600 font-medium" }
    case "ready": return { label: r.action === "create" ? "جاهز (زبون جديد)" : "جاهز", cls: "text-green-600 font-medium" }
    case "skipped": return { label: `متخطّى${r.skipReason ? ` — ${r.skipReason}` : ""}`, cls: "text-amber-600" }
    default: return { label: "غير محسوم", cls: "text-muted-foreground" }
  }
}

function SummaryStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "green" | "amber" | "blue" | "muted" }) {
  const color = tone === "green" ? "text-green-600" : tone === "amber" ? "text-amber-600" : tone === "blue" ? "text-blue-600" : ""
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

function WizardCard({
  row, index, total, customers, onPatch, onNext,
}: {
  row: WorkRow
  index: number
  total: number
  customers: Customer[]
  onPatch: (id: string, u: Partial<WorkRow>) => void
  onNext: () => void
}) {
  const [query, setQuery] = useState("")
  const [showNewForm, setShowNewForm] = useState(row.action === "create")
  const [showSkip, setShowSkip] = useState(false)
  const [newName, setNewName] = useState(row.newName ?? row.name)
  const [newPhone, setNewPhone] = useState(row.newPhone ?? "")
  const [newNotes, setNewNotes] = useState(row.newNotes ?? row.notes ?? "")

  const dir = direction(row.amount)
  const suggestions = useMemo(() => {
    const q = normalizeName(query)
    if (!q) return []
    return customers.filter((c) => normalizeName(c.name).includes(q)).slice(0, 8)
  }, [query, customers])

  function saveLink() {
    if (!row.customerId) return
    onPatch(row.tempId, { status: "ready", action: "link", newName: undefined, newPhone: undefined, newNotes: undefined })
    onNext()
  }
  function saveNew() {
    const nm = newName.trim() || row.name
    onPatch(row.tempId, {
      status: "ready", action: "create",
      newName: nm, newPhone: newPhone.trim() || undefined, newNotes: newNotes.trim() || undefined,
      customerId: undefined, customerName: undefined,
    })
    onNext()
  }
  function skip(reason: string) {
    onPatch(row.tempId, { status: "skipped", skipReason: reason || undefined, action: undefined, customerId: undefined, customerName: undefined })
    setShowSkip(false)
    onNext()
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {/* Old statement row */}
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">صف {index + 1} من {total}</span>
            <StatusBadge row={row} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-lg font-bold">{row.name}</div>
            {row.oldCode && <span className="rounded bg-muted px-2 py-0.5 text-xs">كود قديم: {row.oldCode}</span>}
            <span className="text-lg font-bold">{fmt(row.amount)} د.ع</span>
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${dir.cls}`}>{dir.label}</span>
          </div>
          {row.notes && <div className="mt-1 text-xs text-muted-foreground">ملاحظات: {row.notes}</div>}
        </div>

        {/* Match existing */}
        {!showNewForm && (
          <div>
            <label className="mb-1 block text-sm font-medium">من هو هذا الزبون في النظام الجديد؟</label>
            <div className="relative">
              <div className="flex items-center gap-1">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ابحث بالاسم بين زبائن الموقع…"
                  className="h-10"
                />
              </div>
              {query && suggestions.length > 0 && (
                <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-background shadow-lg">
                  {suggestions.map((c) => (
                    <button
                      key={c.id}
                      className="flex w-full items-center justify-between px-3 py-2 text-right text-sm hover:bg-muted"
                      onClick={() => { onPatch(row.tempId, { action: "link", customerId: c.id, customerName: c.name }); setQuery("") }}
                    >
                      <span>{c.name}</span>
                      <span className="text-xs text-muted-foreground">{c.phone} · رصيد {fmt(Number(c.currentBalance) || 0)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {row.customerId && (
              <div className="mt-2 flex items-center justify-between rounded-md border border-blue-200 bg-blue-50/50 p-2 text-sm">
                <span className="text-blue-700">الزبون المختار: <b>{row.customerName}</b></span>
                <Button size="sm" onClick={saveLink}>
                  <CheckCircle2 className="ml-1 h-4 w-4" /> احفظ هذا المبلغ كرصيد أول مدة لهذا الزبون
                </Button>
              </div>
            )}
          </div>
        )}

        {/* New customer form (prepared, applied only at final step) */}
        {showNewForm && (
          <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-blue-700">
              <UserPlus className="h-4 w-4" /> إضافة زبون جديد (يُنشأ عند التطبيق النهائي فقط)
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground">اسم الزبون</label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="h-9" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">الهاتف (اختياري)</label>
                <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} className="h-9" placeholder="اختياري" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-muted-foreground">ملاحظات (اختياري)</label>
                <Input value={newNotes} onChange={(e) => setNewNotes(e.target.value)} className="h-9" placeholder={row.oldCode ? `كود قديم ${row.oldCode} سيُحفظ تلقائياً` : "اختياري"} />
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={saveNew}>
                <CheckCircle2 className="ml-1 h-4 w-4" /> جهّز هذا الزبون الجديد بالرصيد
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowNewForm(false)}>رجوع للبحث</Button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {!showNewForm && (
            <Button variant="outline" size="sm" onClick={() => setShowNewForm(true)}>
              <UserPlus className="ml-1 h-4 w-4" /> إضافة زبون جديد
            </Button>
          )}
          <Button variant="destructive" size="sm" onClick={() => setShowSkip((v) => !v)}>
            <Ban className="ml-1 h-4 w-4" /> تخطي هذا الزبون
          </Button>
          {row.status === "ready" && (
            <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-4 w-4" /> محفوظ كجاهز</span>
          )}
          {row.status === "skipped" && (
            <span className="flex items-center gap-2 text-xs text-amber-600">
              متخطّى {row.skipReason ? `— ${row.skipReason}` : ""}
              <button className="underline" onClick={() => onPatch(row.tempId, { status: "undecided", skipReason: undefined })}>
                <Undo2 className="inline h-3.5 w-3.5" /> تراجع
              </button>
            </span>
          )}
        </div>

        {showSkip && (
          <div className="flex flex-wrap items-center gap-2 rounded bg-muted/50 p-2">
            <span className="text-xs text-muted-foreground">سبب التخطي (اختياري):</span>
            {SKIP_REASONS.map((reason) => (
              <button key={reason} className="rounded border px-2 py-1 text-xs hover:bg-background" onClick={() => skip(reason)}>{reason}</button>
            ))}
            <button className="rounded px-2 py-1 text-xs text-muted-foreground underline" onClick={() => skip("")}>تخطّي بدون سبب</button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StatusBadge({ row }: { row: WorkRow }) {
  const st = statusLabel(row)
  return <span className={`rounded px-2 py-0.5 text-xs ${st.cls}`}>{st.label}</span>
}

export default BalanceMigrationPage
