// "جدولة الجرد الذكي" (scheduled smart cycle count) — a fully independent
// page/feature from StocktakePage.tsx (manual "الجرد الدوري"). Do not merge.
import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"
import {
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Copy,
  ExternalLink,
  Plus,
  RotateCcw,
  X,
  XCircle,
} from "lucide-react"
import {
  approveAllCycleCountItems,
  approveCycleCountItem,
  cancelCycleCountSession,
  closeCycleCountSession,
  createCycleCountSession,
  getBranches,
  getCycleCountSession,
  listCycleCountSessions,
  rejectAllCycleCountItems,
  rejectCycleCountItem,
  reopenCycleCountSession,
  submitCycleCountSession,
  updateCycleCountItem,
} from "../api/endpoints"
import type { CycleCountSessionDetail, CycleCountSessionSummary, CycleCountStrategy, StockCorrectionReason } from "../types/api"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { ReasonPromptModal } from "../components/ReasonPromptModal"
import { useSettings, useUpdateSettings } from "../hooks/useSettings"
import { READ_ONLY_MESSAGE, useReadOnly } from "../hooks/useTenantConfig"

const PUBLIC_BASE = `${window.location.origin}/cycle-count`

// Per-item approve: a surplus (overage) is rarely damage/theft/expiry, so the
// reason dropdown narrows to the two sensible options. A shortage keeps all 6.
const OVERAGE_REASONS: StockCorrectionReason[] = ["COUNT_ERROR", "OTHER"]

function extractUnresolvedError(err: unknown): { code?: string; message?: string } {
  return (err as { response?: { data?: { code?: string; message?: string } } })?.response?.data ?? {}
}

const STRATEGY_LABELS: Record<CycleCountStrategy, string> = {
  RANDOM: "عشوائي",
  HIGH_VALUE: "الأعلى قيمة",
  FAST_MOVING: "الأسرع حركة",
  LOW_STOCK: "الأقرب لنفاد المخزون",
  LEAST_RECENTLY_COUNTED: "الأقدم عهداً بالجرد",
}

function statusLabel(status: string) {
  if (status === "OPEN") return { label: "مفتوح — جاري الجرد", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" }
  if (status === "SUBMITTED") return { label: "مرفوع — بانتظار المراجعة", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" }
  if (status === "CANCELLED") return { label: "ملغى", cls: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400" }
  return { label: "مغلق", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" }
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function CycleCountPage() {
  const readOnly = useReadOnly()
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("session"))
  const [showNew, setShowNew] = useState(false)

  const listQ = useQuery({ queryKey: ["cycle-count-sessions"], queryFn: listCycleCountSessions })
  const sessionQ = useQuery({
    queryKey: ["cycle-count-session", selectedId],
    queryFn: () => getCycleCountSession(selectedId!),
    enabled: Boolean(selectedId),
  })

  const createMut = useMutation({
    mutationFn: (p: { warehouseId?: string; strategy: CycleCountStrategy; itemLimit: number; notes?: string }) =>
      createCycleCountSession(p),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ["cycle-count-sessions"] })
      setSelectedId(d.id)
      setShowNew(false)
    },
  })

  if (selectedId && sessionQ.data) {
    return <SessionView session={sessionQ.data} onBack={() => setSelectedId(null)} />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">جدولة الجرد الذكي</h1>
          <p className="text-slate-500">جرد تلقائي مجدول لعينة من المنتجات — مستقل تماماً عن الجرد الدوري اليدوي.</p>
        </div>
        <Button onClick={() => setShowNew(true)} disabled={readOnly} title={readOnly ? READ_ONLY_MESSAGE : undefined}>
          <Plus className="h-4 w-4" /> جلسة جديدة يدوياً
        </Button>
      </div>

      <CycleCountSettingsCard />

      {showNew && (
        <NewSessionCard
          onCancel={() => setShowNew(false)}
          onCreate={(p) => createMut.mutate(p)}
          loading={createMut.isPending}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" /> جلسات الجرد الذكي
          </CardTitle>
        </CardHeader>
        <CardContent>
          {listQ.isLoading ? (
            <p className="text-slate-500 text-sm">جاري التحميل...</p>
          ) : (listQ.data ?? []).length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-8">
              لا توجد جلسات جرد ذكي بعد. فعّل الجدولة التلقائية أعلاه أو أنشئ جلسة يدوياً.
            </p>
          ) : (
            <div className="space-y-2">
              {(listQ.data ?? []).map((s) => (
                <SessionRow key={s.id} session={s} onClick={() => setSelectedId(s.id)} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Settings card (enable / warehouse / interval / item count / strategy) ────

function CycleCountSettingsCard() {
  const readOnly = useReadOnly()
  const settingsQ = useSettings()
  const updateMut = useUpdateSettings()
  const branchesQ = useQuery({ queryKey: ["branches"], queryFn: () => getBranches() })
  const branches = branchesQ.data ?? []

  const [enabled, setEnabled] = useState(false)
  const [warehouseId, setWarehouseId] = useState("")
  const [intervalDays, setIntervalDays] = useState("7")
  const [itemLimit, setItemLimit] = useState("20")
  const [strategy, setStrategy] = useState<CycleCountStrategy>("LEAST_RECENTLY_COUNTED")

  useEffect(() => {
    if (!settingsQ.data) return
    setEnabled(Boolean(settingsQ.data.cycleCountEnabled))
    setWarehouseId(settingsQ.data.cycleCountWarehouseId ?? "")
    setIntervalDays(String(settingsQ.data.cycleCountIntervalDays ?? 7))
    setItemLimit(String(settingsQ.data.cycleCountItemLimit ?? 20))
    setStrategy((settingsQ.data.cycleCountStrategy as CycleCountStrategy | undefined) ?? "LEAST_RECENTLY_COUNTED")
  }, [settingsQ.data])

  function save() {
    updateMut.mutate({
      cycleCountEnabled: enabled,
      cycleCountWarehouseId: warehouseId || undefined,
      cycleCountIntervalDays: Number(intervalDays) || 7,
      cycleCountItemLimit: Number(itemLimit) || 20,
      cycleCountStrategy: strategy,
    })
  }

  return (
    <Card className="border-indigo-200 dark:border-indigo-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5" /> إعدادات الجدولة التلقائية
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={readOnly} />
          تفعيل الجدولة التلقائية
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700">المخزن</label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              disabled={readOnly}
              className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="">اختر مخزناً</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700">كل كم يوم</label>
            <Input type="number" min={1} value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} disabled={readOnly} />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700">عدد المواد بكل جلسة</label>
            <Input type="number" min={1} value={itemLimit} onChange={(e) => setItemLimit(e.target.value)} disabled={readOnly} />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700">طريقة اختيار المواد</label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as CycleCountStrategy)}
              disabled={readOnly}
              className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
            >
              {Object.entries(STRATEGY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
        </div>
        <Button onClick={save} disabled={readOnly || updateMut.isPending} title={readOnly ? READ_ONLY_MESSAGE : undefined}>
          {updateMut.isPending ? "جاري الحفظ..." : "حفظ الإعدادات"}
        </Button>
      </CardContent>
    </Card>
  )
}

// ── New session card (manual) ──────────────────────────────────────────────────

function NewSessionCard({
  onCancel,
  onCreate,
  loading,
}: {
  onCancel: () => void
  onCreate: (p: { warehouseId?: string; strategy: CycleCountStrategy; itemLimit: number; notes?: string }) => void
  loading: boolean
}) {
  const [warehouseId, setWarehouseId] = useState("")
  const [strategy, setStrategy] = useState<CycleCountStrategy>("RANDOM")
  const [itemLimit, setItemLimit] = useState("20")
  const [notes, setNotes] = useState("")
  const branchesQ = useQuery({ queryKey: ["branches"], queryFn: () => getBranches() })
  const branches = branchesQ.data ?? []

  return (
    <Card className="border-blue-200 dark:border-blue-800">
      <CardContent className="p-4 space-y-3">
        <p className="font-medium">جلسة جرد ذكي جديدة (يدوية)</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700">المخزن</label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="">المخزن الرئيسي</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700">طريقة الاختيار</label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as CycleCountStrategy)}
              className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
            >
              {Object.entries(STRATEGY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-700">عدد المواد</label>
            <Input type="number" min={1} value={itemLimit} onChange={(e) => setItemLimit(e.target.value)} />
          </div>
        </div>
        <Input placeholder="ملاحظة (اختياري)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex gap-2">
          <Button
            onClick={() => onCreate({
              warehouseId: warehouseId || undefined,
              strategy,
              itemLimit: Number(itemLimit) || 1,
              notes: notes || undefined,
            })}
            disabled={loading}
          >
            {loading ? "جاري الإنشاء..." : "إنشاء الجلسة"}
          </Button>
          <Button variant="outline" onClick={onCancel}>إلغاء</Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Session row ───────────────────────────────────────────────────────────────

function SessionRow({ session, onClick }: { session: CycleCountSessionSummary; onClick: () => void }) {
  const st = statusLabel(session.status)
  const publicUrl = session.publicToken ? `${PUBLIC_BASE}/${session.publicToken}` : null
  const showLink = publicUrl && session.status !== "CLOSED" && session.status !== "CANCELLED"

  return (
    <div className="rounded-lg border p-3 dark:border-slate-700">
      <button type="button" onClick={onClick} className="w-full text-right">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${st.cls}`}>{st.label}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {session.source === "SCHEDULED" ? "تلقائي" : "يدوي"}
          </span>
          <span className="text-sm font-medium">{session.createdAt.slice(0, 10)}</span>
          {session.warehouse && <span className="text-xs text-slate-400">— {session.warehouse.name}</span>}
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          {session.creator?.name ?? "—"} · {session.itemCount} منتج · {STRATEGY_LABELS[session.strategy]}
          {session.notes ? ` · ${session.notes}` : ""}
        </p>
      </button>

      {showLink && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2">
          <p className="flex-1 text-xs text-slate-500 font-mono truncate" dir="ltr">{publicUrl}</p>
          <button
            type="button"
            title="نسخ رابط العامل"
            onClick={() => navigator.clipboard.writeText(publicUrl)}
            className="text-slate-400 hover:text-slate-700 transition"
          >
            <Copy className="h-4 w-4" />
          </button>
          <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-blue-600 transition">
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      )}
    </div>
  )
}

// ── Session detail view ───────────────────────────────────────────────────────

function SessionView({ session, onBack }: { session: CycleCountSessionDetail; onBack: () => void }) {
  const readOnly = useReadOnly()
  const qc = useQueryClient()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState(false)
  const [reasonPrompt, setReasonPrompt] = useState<
    | { type: "approve"; itemId: string; options?: StockCorrectionReason[] }
    | { type: "approve-all" }
    | null
  >(null)

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["cycle-count-session", session.id] })
    void qc.invalidateQueries({ queryKey: ["cycle-count-sessions"] })
  }

  const updateItemMut = useMutation({
    mutationFn: ({ productId, actualQty }: { productId: string; actualQty: number }) =>
      updateCycleCountItem(session.id, productId, actualQty),
    onSuccess: invalidate,
  })
  const submitMut = useMutation({ mutationFn: () => submitCycleCountSession(session.id), onSuccess: invalidate })
  const closeMut = useMutation({
    mutationFn: (force: boolean) => closeCycleCountSession(session.id, force),
    onSuccess: invalidate,
    onError: (err) => {
      const { code, message } = extractUnresolvedError(err)
      if (code === "UNRESOLVED_ITEMS") {
        const n = message?.match(/\d+/)?.[0]
        const confirmMsg = n
          ? `توجد ${n} فروقات لم تتم مراجعتها — إغلاق رغم ذلك؟`
          : "توجد فروقات لم تتم مراجعتها — إغلاق رغم ذلك؟"
        if (confirm(confirmMsg)) closeMut.mutate(true)
      }
    },
  })
  const reopenMut = useMutation({ mutationFn: () => reopenCycleCountSession(session.id), onSuccess: invalidate })
  const cancelMut = useMutation({
    mutationFn: () => cancelCycleCountSession(session.id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["cycle-count-sessions"] }); onBack() },
  })
  const approveMut = useMutation({
    mutationFn: ({ itemId, reason }: { itemId: string; reason: StockCorrectionReason }) => approveCycleCountItem(session.id, itemId, reason),
    onSuccess: invalidate,
  })
  const rejectMut = useMutation({ mutationFn: (itemId: string) => rejectCycleCountItem(session.id, itemId), onSuccess: invalidate })
  const approveAllMut = useMutation({
    mutationFn: (reason: StockCorrectionReason) => approveAllCycleCountItems(session.id, reason),
    onSuccess: invalidate,
  })
  const rejectAllMut = useMutation({ mutationFn: () => rejectAllCycleCountItems(session.id), onSuccess: invalidate })

  function openApprovePrompt(itemId: string, variance: number | null) {
    setReasonPrompt({ type: "approve", itemId, options: variance !== null && variance > 0 ? OVERAGE_REASONS : undefined })
  }

  const errors = session.items.filter((i) => i.hasError)
  const uncounted = session.items.filter((i) => i.actualQty === null)
  const pendingWithDiff = session.items.filter((i) => i.approvalStatus === "PENDING" && i.hasError)
  const st = statusLabel(session.status)
  const publicUrl = session.publicToken ? `${PUBLIC_BASE}/${session.publicToken}` : null
  const showLink = publicUrl && session.status !== "CLOSED" && session.status !== "CANCELLED"

  function copyLink() {
    if (!publicUrl) return
    navigator.clipboard.writeText(publicUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={onBack}>
          <ChevronRight className="h-4 w-4" /> رجوع
        </Button>
        <div>
          <h1 className="text-xl font-bold">
            جرد ذكي {session.createdAt.slice(0, 10)}
            {session.notes ? ` — ${session.notes}` : ""}
          </h1>
          <p className="text-xs text-slate-500 flex flex-wrap items-center gap-2 mt-1">
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${st.cls}`}>{st.label}</span>
            <span>{session.stats.filled}/{session.stats.total} منتج</span>
            <span className="text-red-600">{errors.length} خطأ</span>
            <span className="text-slate-400">{uncounted.length} لم يُحسب</span>
          </p>
        </div>
      </div>

      {/* Worker link — admin can copy/open the same link the worker received */}
      {showLink && (
        <Card className="border-blue-200 dark:border-blue-800">
          <CardContent className="p-4 space-y-2">
            <p className="text-sm font-semibold">رابط العامل للعد</p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={publicUrl}
                dir="ltr"
                className="flex-1 rounded-lg border bg-slate-50 px-3 py-2 text-xs font-mono dark:bg-slate-900"
              />
              <Button size="sm" variant="outline" onClick={copyLink}>
                <Copy className="h-4 w-4" /> {copied ? "تم النسخ!" : "نسخ"}
              </Button>
              <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline"><ExternalLink className="h-4 w-4" /></Button>
              </a>
            </div>
            <p className="text-xs text-slate-400">
              أُرسل هذا الرابط تلقائياً عبر واتساب لهاتف المخزن (إن كان مضبوطاً) — ويمكنك فتحه وإدخال الكميات بنفسك أيضاً.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {session.status === "OPEN" && (
          <Button onClick={() => submitMut.mutate()} disabled={readOnly || submitMut.isPending} title={readOnly ? READ_ONLY_MESSAGE : undefined}>
            <CheckCircle2 className="h-4 w-4" /> {submitMut.isPending ? "جاري الإرسال..." : "إرسال الجرد للمراجعة"}
          </Button>
        )}
        {session.status === "SUBMITTED" && (
          <>
            <Button
              onClick={() => { if (confirm(`الموافقة على كل الفروقات (${pendingWithDiff.length})؟`)) setReasonPrompt({ type: "approve-all" }) }}
              disabled={readOnly || approveAllMut.isPending || pendingWithDiff.length === 0}
              title={readOnly ? READ_ONLY_MESSAGE : undefined}
            >
              <Check className="h-4 w-4" /> {approveAllMut.isPending ? "جاري الموافقة..." : "الموافقة على كل الفروقات"}
            </Button>
            <Button
              variant="outline"
              className="border-red-200 text-red-600"
              onClick={() => { if (confirm(`رفض كل الفروقات (${pendingWithDiff.length})؟ لن يتغيّر المخزون.`)) rejectAllMut.mutate() }}
              disabled={readOnly || rejectAllMut.isPending || pendingWithDiff.length === 0}
              title={readOnly ? READ_ONLY_MESSAGE : undefined}
            >
              <X className="h-4 w-4" /> {rejectAllMut.isPending ? "جاري الرفض..." : "رفض كل الفروقات"}
            </Button>
            <Button
              variant="outline"
              onClick={() => reopenMut.mutate()}
              disabled={readOnly || reopenMut.isPending}
              title={readOnly ? READ_ONLY_MESSAGE : "إعادة فتح الجلسة للتعديل — العناصر التي عُولجت (موافقة/رفض) تبقى كما هي"}
            >
              <RotateCcw className="h-4 w-4" /> {reopenMut.isPending ? "جاري إعادة الفتح..." : "إعادة فتح الجلسة"}
            </Button>
            <Button
              variant="outline"
              onClick={() => { if (confirm("متأكد من إغلاق الجلسة؟")) closeMut.mutate(false) }}
              disabled={readOnly || closeMut.isPending}
              title={readOnly ? READ_ONLY_MESSAGE : undefined}
            >
              <CheckCircle2 className="h-4 w-4" /> {closeMut.isPending ? "جاري الإغلاق..." : "إغلاق الجلسة"}
            </Button>
          </>
        )}
        {(session.status === "OPEN" || session.status === "SUBMITTED") && (
          <Button
            variant="outline"
            className="border-red-200 text-red-600"
            onClick={() => { if (confirm("إلغاء هذه الجلسة؟")) cancelMut.mutate() }}
            disabled={readOnly || cancelMut.isPending}
            title={readOnly ? READ_ONLY_MESSAGE : undefined}
          >
            <XCircle className="h-4 w-4" /> إلغاء الجلسة
          </Button>
        )}
      </div>

      {session.status === "SUBMITTED" ? (
        <div className="space-y-4">
          <ItemsGroup
            title={`فروقات (${errors.length})`}
            items={session.items.filter((i) => i.hasError)}
            status={session.status}
            readOnly={readOnly}
            onApprove={(item) => openApprovePrompt(item.id, item.variance)}
            onReject={(id) => rejectMut.mutate(id)}
            approvePending={approveMut.isPending}
            rejectPending={rejectMut.isPending}
          />
          <ItemsGroup
            title={`مطابقة — بلا فرق (${session.items.length - errors.length - uncounted.length})`}
            items={session.items.filter((i) => !i.hasError && i.actualQty !== null)}
            status={session.status}
            readOnly={readOnly}
            onApprove={(item) => openApprovePrompt(item.id, item.variance)}
            onReject={(id) => rejectMut.mutate(id)}
            approvePending={approveMut.isPending}
            rejectPending={rejectMut.isPending}
          />
          {uncounted.length > 0 && (
            <ItemsGroup
              title={`لم يُحسب (${uncounted.length})`}
              items={uncounted}
              status={session.status}
              readOnly={readOnly}
              onApprove={(item) => openApprovePrompt(item.id, item.variance)}
              onReject={(id) => rejectMut.mutate(id)}
              approvePending={approveMut.isPending}
              rejectPending={rejectMut.isPending}
            />
          )}
        </div>
      ) : (
        <ItemsGroup
          items={session.items}
          status={session.status}
          readOnly={readOnly}
          openDrafts={drafts}
          onOpenDraftChange={(id, v) => setDrafts((d) => ({ ...d, [id]: v }))}
          onOpenCommit={(productId, actualQty) => updateItemMut.mutate({ productId, actualQty })}
        />
      )}

      {reasonPrompt && (
        <ReasonPromptModal
          title={reasonPrompt.type === "approve" ? "سبب الموافقة على الفرق" : `سبب الموافقة على كل الفروقات (${pendingWithDiff.length})`}
          options={reasonPrompt.type === "approve" ? reasonPrompt.options : undefined}
          loading={approveMut.isPending || approveAllMut.isPending}
          onCancel={() => setReasonPrompt(null)}
          onConfirm={(reason) => {
            if (reasonPrompt.type === "approve") approveMut.mutate({ itemId: reasonPrompt.itemId, reason })
            else approveAllMut.mutate(reason)
            setReasonPrompt(null)
          }}
        />
      )}
    </div>
  )
}

// ── Items table (grouped for SUBMITTED review, single table for OPEN/CLOSED) ──

function ItemsGroup({
  title,
  items,
  status,
  readOnly,
  onApprove,
  onReject,
  approvePending,
  rejectPending,
  openDrafts,
  onOpenDraftChange,
  onOpenCommit,
}: {
  title?: string
  items: CycleCountSessionDetail["items"]
  status: string
  readOnly: boolean
  onApprove?: (item: CycleCountSessionDetail["items"][number]) => void
  onReject?: (itemId: string) => void
  approvePending?: boolean
  rejectPending?: boolean
  openDrafts?: Record<string, string>
  onOpenDraftChange?: (itemId: string, value: string) => void
  onOpenCommit?: (productId: string, actualQty: number) => void
}) {
  if (title && items.length === 0) return null

  return (
    <Card>
      {title && (
        <CardHeader className="py-3">
          <CardTitle className="text-sm">{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                <th className="px-3 py-2 text-right font-medium">المادة</th>
                <th className="px-3 py-2 text-center font-medium">بالنظام</th>
                <th className="px-3 py-2 text-center font-medium">فعلي (العامل)</th>
                <th className="px-3 py-2 text-center font-medium">الفرق</th>
                {status === "SUBMITTED" && <th className="px-3 py-2 text-center font-medium">المراجعة</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.map((item) => {
                const rowCls = item.hasError
                  ? "bg-red-50 dark:bg-red-950"
                  : item.actualQty === null ? "" : "bg-emerald-50/40 dark:bg-emerald-950/20"
                return (
                  <tr key={item.id} className={rowCls}>
                    <td className="px-3 py-2 font-medium">{item.productName}</td>
                    <td className="px-3 py-2 text-center">{item.systemQty}</td>
                    <td className="px-3 py-2 text-center">
                      {status === "OPEN" && item.approvalStatus === "PENDING" ? (
                        <input
                          type="number"
                          disabled={readOnly}
                          className="w-20 rounded border border-slate-200 px-2 py-1 text-center dark:border-slate-700 dark:bg-slate-950"
                          value={openDrafts?.[item.id] ?? (item.actualQty ?? "")}
                          onChange={(e) => onOpenDraftChange?.(item.id, e.target.value)}
                          onBlur={(e) => {
                            const v = Number(e.target.value)
                            if (!Number.isNaN(v) && e.target.value !== "") onOpenCommit?.(item.productId, v)
                          }}
                        />
                      ) : item.actualQty !== null ? item.actualQty : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {item.variance !== null ? (
                        <span className={
                          item.variance === 0
                            ? "text-emerald-600 font-bold"
                            : item.variance > 0 ? "text-blue-600 font-bold" : "text-red-600 font-bold"
                        }>
                          {item.variance > 0 ? `+${item.variance}` : item.variance}
                        </span>
                      ) : "—"}
                    </td>
                    {status === "SUBMITTED" && (
                      <td className="px-3 py-2 text-center">
                        {item.approvalStatus === "PENDING" && (
                          <div className="flex justify-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-emerald-600 hover:bg-emerald-100"
                              onClick={() => onApprove?.(item)}
                              disabled={readOnly || approvePending || item.actualQty === null}
                              title="وافق"
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-red-600 hover:bg-red-100"
                              onClick={() => onReject?.(item.id)}
                              disabled={readOnly || rejectPending}
                              title="رفض"
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
  )
}
