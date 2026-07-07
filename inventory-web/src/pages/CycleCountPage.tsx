// "جدولة الجرد الذكي" (scheduled smart cycle count) — a fully independent
// page/feature from StocktakePage.tsx (manual "الجرد الدوري"). Do not merge.
import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarClock, Check, CheckCircle2, ChevronRight, ClipboardList, Plus, X, XCircle } from "lucide-react"
import {
  approveCycleCountItem,
  cancelCycleCountSession,
  closeCycleCountSession,
  createCycleCountSession,
  getBranches,
  getCycleCountSession,
  listCycleCountSessions,
  rejectCycleCountItem,
  submitCycleCountSession,
  updateCycleCountItem,
} from "../api/endpoints"
import type { CycleCountSessionDetail, CycleCountSessionSummary, CycleCountStrategy } from "../types/api"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { useSettings, useUpdateSettings } from "../hooks/useSettings"
import { READ_ONLY_MESSAGE, useReadOnly } from "../hooks/useTenantConfig"

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
  const [selectedId, setSelectedId] = useState<string | null>(null)
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
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border p-3 text-right hover:border-indigo-300 transition dark:border-slate-700"
    >
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
  )
}

// ── Session detail view ───────────────────────────────────────────────────────

function SessionView({ session, onBack }: { session: CycleCountSessionDetail; onBack: () => void }) {
  const readOnly = useReadOnly()
  const qc = useQueryClient()
  const [drafts, setDrafts] = useState<Record<string, string>>({})

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
  const closeMut = useMutation({ mutationFn: () => closeCycleCountSession(session.id), onSuccess: invalidate })
  const cancelMut = useMutation({
    mutationFn: () => cancelCycleCountSession(session.id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["cycle-count-sessions"] }); onBack() },
  })
  const approveMut = useMutation({ mutationFn: (itemId: string) => approveCycleCountItem(session.id, itemId), onSuccess: invalidate })
  const rejectMut = useMutation({ mutationFn: (itemId: string) => rejectCycleCountItem(session.id, itemId), onSuccess: invalidate })

  const errors = session.items.filter((i) => i.hasError)
  const uncounted = session.items.filter((i) => i.actualQty === null)
  const st = statusLabel(session.status)

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

      <div className="flex flex-wrap gap-2">
        {session.status === "OPEN" && (
          <Button onClick={() => submitMut.mutate()} disabled={readOnly || submitMut.isPending} title={readOnly ? READ_ONLY_MESSAGE : undefined}>
            <CheckCircle2 className="h-4 w-4" /> {submitMut.isPending ? "جاري الإرسال..." : "إرسال الجرد للمراجعة"}
          </Button>
        )}
        {session.status === "SUBMITTED" && (
          <Button variant="outline" onClick={() => closeMut.mutate()} disabled={readOnly || closeMut.isPending} title={readOnly ? READ_ONLY_MESSAGE : undefined}>
            <CheckCircle2 className="h-4 w-4" /> {closeMut.isPending ? "جاري الإغلاق..." : "إغلاق الجلسة"}
          </Button>
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

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">المادة</th>
                  <th className="px-3 py-2 text-center font-medium">بالنظام</th>
                  <th className="px-3 py-2 text-center font-medium">فعلي</th>
                  <th className="px-3 py-2 text-center font-medium">الفرق</th>
                  {session.status === "SUBMITTED" && <th className="px-3 py-2 text-center font-medium">المراجعة</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {session.items.map((item) => {
                  const rowCls = item.hasError
                    ? "bg-red-50 dark:bg-red-950"
                    : item.actualQty === null ? "" : "bg-emerald-50/40 dark:bg-emerald-950/20"
                  return (
                    <tr key={item.id} className={rowCls}>
                      <td className="px-3 py-2 font-medium">{item.productName}</td>
                      <td className="px-3 py-2 text-center">{item.systemQty}</td>
                      <td className="px-3 py-2 text-center">
                        {session.status === "OPEN" ? (
                          <input
                            type="number"
                            disabled={readOnly}
                            className="w-20 rounded border border-slate-200 px-2 py-1 text-center dark:border-slate-700 dark:bg-slate-950"
                            value={drafts[item.id] ?? (item.actualQty ?? "")}
                            onChange={(e) => setDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                            onBlur={(e) => {
                              const v = Number(e.target.value)
                              if (!Number.isNaN(v) && e.target.value !== "") {
                                updateItemMut.mutate({ productId: item.productId, actualQty: v })
                              }
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
                      {session.status === "SUBMITTED" && (
                        <td className="px-3 py-2 text-center">
                          {item.approvalStatus === "PENDING" && (
                            <div className="flex justify-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-emerald-600 hover:bg-emerald-100"
                                onClick={() => approveMut.mutate(item.id)}
                                disabled={readOnly || approveMut.isPending || item.actualQty === null}
                                title="وافق"
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-red-600 hover:bg-red-100"
                                onClick={() => rejectMut.mutate(item.id)}
                                disabled={readOnly || rejectMut.isPending}
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
    </div>
  )
}
