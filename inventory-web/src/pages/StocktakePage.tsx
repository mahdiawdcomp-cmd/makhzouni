import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Archive,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Plus,
  Printer,
  Search,
  Check,
  X,
} from "lucide-react"
import {
  approveStocktakeItem,
  archiveStocktakeSession,
  closeStocktakeSession,
  createStocktakeSession,
  getStocktakeSession,
  listStocktakeSessions,
  getBranches,
  rejectStocktakeItem,
} from "../api/endpoints"
import type { StocktakeSessionDetail, StocktakeSessionSummary, StockCorrectionReason } from "../types/api"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { toast } from "../components/ui/use-toast"
import { ReasonPromptModal } from "../components/ReasonPromptModal"
import { READ_ONLY_MESSAGE, useReadOnly } from "../hooks/useTenantConfig"
import { apiErrorMessage } from "../utils/apiError"
import { fmtD } from "../utils/fmt"
import { exportStocktakeCsv, printStocktake } from "../utils/stocktakeExport"

const PUBLIC_BASE = `${window.location.origin}/stocktake`

// Per-item approve: a surplus (overage) is rarely damage/theft/expiry, so the
// reason dropdown narrows to the two sensible options. A shortage keeps all 6.
const OVERAGE_REASONS: StockCorrectionReason[] = ["COUNT_ERROR", "OTHER"]

type Item = StocktakeSessionDetail["items"][number]
type ItemFilter = "ALL" | "ERRORS" | "SHORTAGE" | "OVERAGE" | "UNCOUNTED" | "PENDING"

const FILTERS: { key: ItemFilter; label: string; match: (i: Item) => boolean }[] = [
  { key: "ALL", label: "الكل", match: () => true },
  { key: "ERRORS", label: "الفروقات", match: (i) => Boolean(i.hasError) },
  { key: "SHORTAGE", label: "نقص", match: (i) => i.variance !== null && i.variance < 0 },
  { key: "OVERAGE", label: "زيادة", match: (i) => i.variance !== null && i.variance > 0 },
  { key: "UNCOUNTED", label: "لم يُحسب", match: (i) => i.actualQty === null },
  { key: "PENDING", label: "بانتظار المراجعة", match: (i) => i.actualQty !== null && i.approvalStatus === "PENDING" },
]

function extractUnresolvedError(err: unknown): { code?: string; message?: string } {
  return (err as { response?: { data?: { code?: string; message?: string } } })?.response?.data ?? {}
}

function unresolvedConfirmMessage(message: string | undefined, action: string) {
  const n = message?.match(/\d+/)?.[0]
  return n
    ? `توجد ${n} فروقات لم تتم مراجعتها — ${action} رغم ذلك؟`
    : `توجد فروقات لم تتم مراجعتها — ${action} رغم ذلك؟`
}

function showError(err: unknown, fallback: string) {
  toast({ title: apiErrorMessage(err, fallback), variant: "destructive" })
}

function statusLabel(s: string) {
  if (s === "OPEN") return { label: "مفتوح — جاري الجرد", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" }
  if (s === "SUBMITTED") return { label: "مرفوع — بانتظار المراجعة", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" }
  return { label: "مغلق", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" }
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function StocktakePage() {
  const readOnly = useReadOnly()
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  const listQ = useQuery({ queryKey: ["stocktake-sessions"], queryFn: listStocktakeSessions })
  const sessionQ = useQuery({
    queryKey: ["stocktake-session", selectedId],
    queryFn: () => getStocktakeSession(selectedId!),
    enabled: Boolean(selectedId),
    refetchInterval: (q) => q.state.data?.status === "SUBMITTED" ? false : 15_000,
  })

  const createMut = useMutation({
    mutationFn: (p: { notes?: string; branchId?: string }) => createStocktakeSession(p),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ["stocktake-sessions"] })
      setSelectedId(d.id)
      setShowNew(false)
    },
    onError: (err) => showError(err, "تعذر إنشاء جلسة الجرد"),
  })

  const closeMut = useMutation({
    mutationFn: (vars: { id: string; force: boolean }) => closeStocktakeSession(vars.id, vars.force),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stocktake-session", selectedId] })
      void qc.invalidateQueries({ queryKey: ["stocktake-sessions"] })
      toast({ title: "تم إغلاق الجلسة" })
    },
    onError: (err, vars) => {
      const { code, message } = extractUnresolvedError(err)
      if (code === "UNRESOLVED_ITEMS" && !vars.force) {
        if (confirm(unresolvedConfirmMessage(message, "إغلاق"))) closeMut.mutate({ id: vars.id, force: true })
        return
      }
      showError(err, "تعذر إغلاق الجلسة")
    },
  })

  const archiveMut = useMutation({
    mutationFn: (vars: { id: string; force: boolean }) => archiveStocktakeSession(vars.id, vars.force),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stocktake-sessions"] })
      setSelectedId(null)
      toast({ title: "تمت أرشفة الجلسة" })
    },
    onError: (err, vars) => {
      const { code, message } = extractUnresolvedError(err)
      if (code === "UNRESOLVED_ITEMS" && !vars.force) {
        if (confirm(unresolvedConfirmMessage(message, "أرشفة"))) archiveMut.mutate({ id: vars.id, force: true })
        return
      }
      showError(err, "تعذر أرشفة الجلسة")
    },
  })

  if (selectedId) {
    if (sessionQ.data) {
      return (
        <SessionView
          session={sessionQ.data}
          onBack={() => setSelectedId(null)}
          onClose={() => { if (confirm("متأكد من إغلاق الجلسة؟")) closeMut.mutate({ id: selectedId, force: false }) }}
          closing={closeMut.isPending}
        />
      )
    }
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={() => setSelectedId(null)}>
          <ChevronRight className="h-4 w-4" /> رجوع
        </Button>
        {sessionQ.isError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            <p className="font-semibold">{apiErrorMessage(sessionQ.error, "تعذر تحميل جلسة الجرد")}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => void sessionQ.refetch()}>
              إعادة المحاولة
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" /> جاري تحميل الجلسة...
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">الجرد الدوري</h1>
          <p className="text-slate-500">أنشئ جلسة جرد، أرسل الرابط للعمال، راجع الفروقات.</p>
        </div>
        <Button onClick={() => setShowNew(true)} disabled={readOnly} title={readOnly ? READ_ONLY_MESSAGE : undefined}>
          <Plus className="h-4 w-4" /> جلسة جرد جديدة
        </Button>
      </div>

      {showNew && (
        <NewSessionCard
          onCancel={() => setShowNew(false)}
          onCreate={(notes, branchId) => createMut.mutate({ notes, branchId })}
          loading={createMut.isPending}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" /> جلسات الجرد
          </CardTitle>
        </CardHeader>
        <CardContent>
          {listQ.isLoading ? (
            <p className="text-slate-500 text-sm">جاري التحميل...</p>
          ) : listQ.isError ? (
            <p className="text-red-600 text-sm">{apiErrorMessage(listQ.error, "تعذر تحميل جلسات الجرد")}</p>
          ) : (listQ.data ?? []).length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-8">
              لا توجد جلسات. اضغط «جلسة جرد جديدة» للبدء.
            </p>
          ) : (
            <div className="space-y-2">
              {(listQ.data ?? []).map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  readOnly={readOnly}
                  archiving={archiveMut.isPending && archiveMut.variables?.id === s.id}
                  onClick={() => setSelectedId(s.id)}
                  onArchive={() => {
                    if (confirm("أرشفة هذه الجلسة؟ ستختفي من القائمة ولن تتأثر الكميات أو سجل الحركة."))
                      archiveMut.mutate({ id: s.id, force: false })
                  }}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── New session card ──────────────────────────────────────────────────────────

function NewSessionCard({
  onCancel,
  onCreate,
  loading,
}: {
  onCancel: () => void
  onCreate: (notes?: string, branchId?: string) => void
  loading: boolean
}) {
  const [notes, setNotes] = useState("")
  const [branchId, setBranchId] = useState("")
  const branchesQuery = useQuery({ queryKey: ["branches"], queryFn: () => getBranches() })
  const branches = branchesQuery.data ?? []

  return (
    <Card className="border-blue-200 dark:border-blue-800">
      <CardContent className="p-4 space-y-3">
        <p className="font-medium">جلسة جرد جديدة</p>
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700">المخزن</label>
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="">المخزن الرئيسي</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <Input
          placeholder="اسم الجرد أو ملاحظة (اختياري) — مثال: جرد شهر يونيو"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="flex gap-2">
          <Button onClick={() => onCreate(notes || undefined, branchId || undefined)} disabled={loading}>
            {loading ? "جاري الإنشاء..." : "إنشاء الجلسة"}
          </Button>
          <Button variant="outline" onClick={onCancel}>إلغاء</Button>
        </div>
        <p className="text-xs text-slate-500">
          سيُنشأ رابط خارجي للعمال — لا يحتاجون تسجيل دخول.
        </p>
      </CardContent>
    </Card>
  )
}

// ── Session row ───────────────────────────────────────────────────────────────

function SessionRow({
  session,
  readOnly,
  archiving,
  onClick,
  onArchive,
}: {
  session: StocktakeSessionSummary
  readOnly: boolean
  archiving: boolean
  onClick: () => void
  onArchive: () => void
}) {
  const st = statusLabel(session.status)
  const publicUrl = `${PUBLIC_BASE}/${session.publicToken}`
  // An OPEN session is still being counted by workers — archiving it would
  // hide it mid-count, so the button only appears once counting is done.
  const canArchive = session.status !== "OPEN"

  return (
    <div className="rounded-lg border p-3 dark:border-slate-700">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onClick}
          className="flex-1 text-right hover:text-blue-600 transition"
        >
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${st.cls}`}>{st.label}</span>
            <span className="text-sm font-medium">{session.createdAt.slice(0, 10)}</span>
            {session.branch && <span className="text-xs text-slate-400">— {session.branch.name}</span>}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {session.creator.name} · {session.itemCount} منتج
            {session.notes ? ` · ${session.notes}` : ""}
          </p>
        </button>
        {canArchive && (
          <button
            type="button"
            title={readOnly ? READ_ONLY_MESSAGE : "أرشفة الجلسة (إخفاء فقط — لا يرجع الكميات)"}
            onClick={onArchive}
            disabled={readOnly || archiving}
            className="text-slate-400 hover:text-red-600 transition mr-2 disabled:opacity-40 disabled:hover:text-slate-400 disabled:cursor-not-allowed"
          >
            {archiving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
          </button>
        )}
        <ChevronRight className="h-4 w-4 text-slate-400 mr-2" />
      </div>

      {/* Public link */}
      {session.status !== "CLOSED" && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2">
          <p className="flex-1 text-xs text-slate-500 font-mono truncate" dir="ltr">{publicUrl}</p>
          <button
            type="button"
            title="نسخ الرابط"
            onClick={() => navigator.clipboard.writeText(publicUrl)}
            className="text-slate-400 hover:text-slate-700 transition"
          >
            <Copy className="h-4 w-4" />
          </button>
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 hover:text-blue-600 transition"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      )}
    </div>
  )
}

// ── Session detail view ───────────────────────────────────────────────────────

function SessionView({
  session,
  onBack,
  onClose,
  closing,
}: {
  session: StocktakeSessionDetail
  onBack: () => void
  onClose: () => void
  closing: boolean
}) {
  const readOnly = useReadOnly()
  const publicUrl = `${PUBLIC_BASE}/${session.publicToken}`
  const [copied, setCopied] = useState(false)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<ItemFilter>("ALL")
  const [reasonPrompt, setReasonPrompt] = useState<
    { mode: "one"; itemId: string; options?: StockCorrectionReason[] } | { mode: "bulk"; itemIds: string[]; options?: StockCorrectionReason[] } | null
  >(null)
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null)
  const qc = useQueryClient()

  const invalidate = () => qc.invalidateQueries({ queryKey: ["stocktake-session", session.id] })

  const approveMut = useMutation({
    mutationFn: ({ itemId, reason }: { itemId: string; reason: StockCorrectionReason }) => approveStocktakeItem(session.id, itemId, reason),
    onSuccess: invalidate,
    onError: (err) => showError(err, "تعذرت الموافقة على الفرق"),
  })

  const rejectMut = useMutation({
    mutationFn: (itemId: string) => rejectStocktakeItem(session.id, itemId),
    onSuccess: invalidate,
    onError: (err) => showError(err, "تعذر رفض الفرق"),
  })

  // Sequential on purpose: each approval is its own stock-adjust transaction
  // on the same warehouse, so firing them in parallel only causes lock waits.
  async function approveMany(itemIds: string[], reason: StockCorrectionReason) {
    setBulk({ done: 0, total: itemIds.length })
    let failed = 0
    let firstError: unknown = null
    for (let i = 0; i < itemIds.length; i++) {
      try {
        await approveStocktakeItem(session.id, itemIds[i], reason)
      } catch (err) {
        failed++
        firstError ??= err
      }
      setBulk({ done: i + 1, total: itemIds.length })
    }
    setBulk(null)
    await invalidate()
    if (failed === 0) {
      toast({ title: `تمت الموافقة على ${itemIds.length} مادة` })
    } else {
      toast({
        title: `تمت الموافقة على ${itemIds.length - failed} من ${itemIds.length} — فشل ${failed}`,
        description: apiErrorMessage(firstError, "تعذرت الموافقة على بعض المواد"),
        variant: "destructive",
      })
    }
  }

  function copy() {
    navigator.clipboard.writeText(publicUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const errors = session.items.filter((i) => i.hasError)
  const ok = session.items.filter((i) => i.variance === 0)
  const uncounted = session.items.filter((i) => i.actualQty === null)

  const counts = useMemo(() => {
    const out = {} as Record<ItemFilter, number>
    for (const f of FILTERS) out[f.key] = session.items.filter(f.match).length
    return out
  }, [session.items])

  const visible = useMemo(() => {
    const match = FILTERS.find((f) => f.key === filter)!.match
    const q = search.trim().toLowerCase()
    return session.items.filter(
      (i) => match(i) && (!q || i.productName.toLowerCase().includes(q) || (i.category ?? "").toLowerCase().includes(q)),
    )
  }, [session.items, filter, search])

  // «موافقة على الظاهر» acts on what's on screen, so the admin can filter to
  // shortages or overages first and give each group a fitting reason.
  const bulkTargets = visible.filter((i) => i.actualQty !== null && i.approvalStatus === "PENDING")
  const bulkOptions = bulkTargets.length > 0 && bulkTargets.every((i) => (i.variance ?? 0) >= 0) && bulkTargets.some((i) => (i.variance ?? 0) > 0)
    ? OVERAGE_REASONS
    : undefined

  const hasValue = session.items.some((i) => i.varianceValue !== undefined)
  const stats = session.stats
  const busy = approveMut.isPending || rejectMut.isPending || bulk !== null
  const reviewing = session.status === "SUBMITTED"

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={onBack}>
          <ChevronRight className="h-4 w-4" /> رجوع
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">
            جرد {session.createdAt.slice(0, 10)}
            {session.notes ? ` — ${session.notes}` : ""}
          </h1>
          <p className="text-xs text-slate-500">
            {stats ? `${stats.filled}/${stats.total}` : `${session.items.length - uncounted.length}/${session.items.length}`} منتج ·
            <span className="text-red-600 mx-1">{errors.length} خطأ</span>·
            <span className="text-emerald-600 mx-1">{ok.length} صحيح</span>·
            <span className="text-slate-400 mx-1">{uncounted.length} لم يُحسب</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => exportStocktakeCsv(session)} title="تصدير إلى Excel (CSV)">
            <Download className="h-4 w-4" /> Excel
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { if (!printStocktake(session)) toast({ title: "تعذر فتح الطباعة", variant: "destructive" }) }}
            title="طباعة / حفظ PDF"
          >
            <Printer className="h-4 w-4" /> طباعة
          </Button>
        </div>
      </div>

      {/* Variance value summary */}
      {hasValue && stats && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
            <p className="text-xs text-red-700 dark:text-red-300">قيمة النقص (بالكلفة)</p>
            <p className="text-lg font-bold text-red-700 dark:text-red-300">{fmtD(stats.shortageValue ?? 0)}</p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950">
            <p className="text-xs text-blue-700 dark:text-blue-300">قيمة الزيادة (بالكلفة)</p>
            <p className="text-lg font-bold text-blue-700 dark:text-blue-300">{fmtD(stats.overageValue ?? 0)}</p>
          </div>
          <div className="rounded-lg border p-3 dark:border-slate-700">
            <p className="text-xs text-slate-500">صافي الفرق</p>
            <p className={`text-lg font-bold ${(stats.netVarianceValue ?? 0) < 0 ? "text-red-600" : (stats.netVarianceValue ?? 0) > 0 ? "text-blue-600" : "text-emerald-600"}`}>
              {fmtD(stats.netVarianceValue ?? 0)}
            </p>
          </div>
        </div>
      )}

      {/* Public link */}
      {session.status !== "CLOSED" && (
        <Card className="border-blue-200 dark:border-blue-800">
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-semibold">رابط العمال</p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={publicUrl}
                dir="ltr"
                className="flex-1 rounded-lg border bg-slate-50 px-3 py-2 text-xs font-mono dark:bg-slate-900"
              />
              <Button size="sm" variant="outline" onClick={copy}>
                <Copy className="h-4 w-4" />
                {copied ? "تم النسخ!" : "نسخ"}
              </Button>
              <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline">
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </a>
            </div>
            <p className="text-xs text-slate-400">
              أرسل هذا الرابط للعمال — يفتح بدون تسجيل دخول ويُحفظ تلقائياً.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Status banners */}
      {reviewing && (
        <div className="space-y-3">
          {errors.length > 0 && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 dark:bg-red-950 dark:border-red-800">
              <p className="font-semibold text-red-800 dark:text-red-300">
                ⚠️ {errors.length} منتج بها فروقات
              </p>
            </div>
          )}
          {errors.length === 0 && uncounted.length === 0 && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 dark:bg-emerald-950 dark:border-emerald-800">
              <p className="font-semibold text-emerald-800 dark:text-emerald-300">
                ✓ الجرد مطابق بالكامل!
              </p>
            </div>
          )}
          <Button onClick={onClose} disabled={readOnly || closing || bulk !== null} title={readOnly ? READ_ONLY_MESSAGE : undefined} variant="outline">
            <CheckCircle2 className="h-4 w-4" />
            {closing ? "جاري الإغلاق..." : "إغلاق الجلسة وتأكيد الجرد"}
          </Button>
        </div>
      )}

      {session.status === "CLOSED" && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 dark:bg-emerald-950 dark:border-emerald-800">
          <p className="font-semibold text-emerald-800 dark:text-emerald-300">
            ✓ الجلسة مغلقة — الجرد مكتمل
          </p>
        </div>
      )}

      {/* Search + filters */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث باسم المادة أو الفئة..."
              className="pr-9"
            />
          </div>
          {reviewing && (
            <Button
              onClick={() => setReasonPrompt({ mode: "bulk", itemIds: bulkTargets.map((i) => i.id), options: bulkOptions })}
              disabled={readOnly || busy || bulkTargets.length === 0}
              title={readOnly ? READ_ONLY_MESSAGE : "الموافقة على كل المواد الظاهرة التي بانتظار المراجعة"}
            >
              {bulk ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
              {bulk ? `جاري الموافقة ${bulk.done}/${bulk.total}` : `موافقة على الظاهر (${bulkTargets.length})`}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                filter === f.key
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              {f.label} ({counts[f.key]})
            </button>
          ))}
        </div>
      </div>

      {/* Items table — errors first (sorted by the server) */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">المادة</th>
                  <th className="px-3 py-2 text-right font-medium">الفئة</th>
                  <th className="px-3 py-2 text-center font-medium">بالنظام</th>
                  <th className="px-3 py-2 text-center font-medium">فعلي</th>
                  <th className="px-3 py-2 text-center font-medium">الفرق</th>
                  {hasValue && <th className="px-3 py-2 text-center font-medium">قيمة الفرق</th>}
                  {reviewing && <th className="px-3 py-2 text-center font-medium">الموافقة</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                      لا توجد مواد مطابقة للبحث أو الفلتر.
                    </td>
                  </tr>
                )}
                {visible.map((item) => {
                  const rowCls =
                    item.hasError
                      ? "bg-red-50 dark:bg-red-950"
                      : item.actualQty === null
                        ? ""
                        : "bg-emerald-50/40 dark:bg-emerald-950/20"
                  return (
                    <tr key={item.id} className={rowCls}>
                      <td className="px-3 py-2 font-medium">{item.productName}</td>
                      <td className="px-3 py-2 text-slate-500 text-xs">{item.category ?? "—"}</td>
                      <td className="px-3 py-2 text-center">{item.systemQty}</td>
                      <td className="px-3 py-2 text-center">
                        {item.actualQty !== null ? item.actualQty : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {item.variance !== null ? (
                          <span className={
                            item.variance === 0
                              ? "text-emerald-600 font-bold"
                              : item.variance > 0
                                ? "text-blue-600 font-bold"
                                : "text-red-600 font-bold text-base"
                          }>
                            {item.variance > 0 ? `+${item.variance}` : item.variance}
                          </span>
                        ) : "—"}
                      </td>
                      {hasValue && (
                        <td className="px-3 py-2 text-center text-xs" title={item.unitCost ? `كلفة الوحدة: ${fmtD(item.unitCost)}` : "لا توجد كلفة للمادة"}>
                          {item.varianceValue === null || item.varianceValue === undefined || item.varianceValue === 0 ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            <span className={item.varianceValue < 0 ? "text-red-600 font-semibold" : "text-blue-600 font-semibold"}>
                              {item.varianceValue > 0 ? "+" : ""}{fmtD(item.varianceValue)}
                            </span>
                          )}
                        </td>
                      )}
                      {reviewing && (
                        <td className="px-3 py-2 text-center">
                          {item.approvalStatus === "PENDING" && item.actualQty !== null && (
                            <div className="flex justify-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-emerald-600 hover:bg-emerald-100"
                                onClick={() => setReasonPrompt({ mode: "one", itemId: item.id, options: item.variance !== null && item.variance > 0 ? OVERAGE_REASONS : undefined })}
                                disabled={readOnly || busy}
                                title={readOnly ? READ_ONLY_MESSAGE : "وافق"}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-red-600 hover:bg-red-100"
                                onClick={() => rejectMut.mutate(item.id)}
                                disabled={readOnly || busy}
                                title={readOnly ? READ_ONLY_MESSAGE : "رفض"}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                          {item.approvalStatus === "APPROVED" && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-700">
                              <Check className="h-3 w-3" /> موافق
                            </span>
                          )}
                          {item.approvalStatus === "REJECTED" && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-xs text-red-700">
                              <X className="h-3 w-3" /> مرفوض
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {reasonPrompt && (
        <ReasonPromptModal
          title={reasonPrompt.mode === "bulk" ? `سبب الموافقة على ${reasonPrompt.itemIds.length} مادة` : "سبب الموافقة على الفرق"}
          description={reasonPrompt.mode === "bulk" ? "سيُطبَّق نفس السبب على كل المواد الظاهرة التي بانتظار المراجعة." : undefined}
          options={reasonPrompt.options}
          loading={approveMut.isPending}
          onCancel={() => setReasonPrompt(null)}
          onConfirm={(reason) => {
            const prompt = reasonPrompt
            setReasonPrompt(null)
            if (prompt.mode === "bulk") void approveMany(prompt.itemIds, reason)
            else approveMut.mutate({ itemId: prompt.itemId, reason })
          }}
        />
      )}
    </div>
  )
}
