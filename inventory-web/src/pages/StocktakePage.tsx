import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, ChevronRight, ClipboardList, Copy, ExternalLink, Plus } from "lucide-react"
import {
  closeStocktakeSession,
  createStocktakeSession,
  getStocktakeSession,
  listStocktakeSessions,
  getBranches,
} from "../api/endpoints"
import type { StocktakeSessionDetail, StocktakeSessionSummary } from "../types/api"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"

const PUBLIC_BASE = `${window.location.origin}/stocktake`

function statusLabel(s: string) {
  if (s === "OPEN") return { label: "مفتوح — جاري الجرد", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" }
  if (s === "SUBMITTED") return { label: "مرفوع — بانتظار المراجعة", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" }
  return { label: "مغلق", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" }
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function StocktakePage() {
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
  })

  const closeMut = useMutation({
    mutationFn: (id: string) => closeStocktakeSession(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stocktake-session", selectedId] })
      void qc.invalidateQueries({ queryKey: ["stocktake-sessions"] })
    },
  })

  if (selectedId && sessionQ.data) {
    return (
      <SessionView
        session={sessionQ.data}
        onBack={() => setSelectedId(null)}
        onClose={() => closeMut.mutate(selectedId)}
        closing={closeMut.isPending}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">الجرد الدوري</h1>
          <p className="text-slate-500">أنشئ جلسة جرد، أرسل الرابط للعمال، راجع الفروقات.</p>
        </div>
        <Button onClick={() => setShowNew(true)}>
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
          ) : (listQ.data ?? []).length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-8">
              لا توجد جلسات. اضغط «جلسة جرد جديدة» للبدء.
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
  onClick,
}: {
  session: StocktakeSessionSummary
  onClick: () => void
}) {
  const st = statusLabel(session.status)
  const publicUrl = `${PUBLIC_BASE}/${session.publicToken}`

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
  const publicUrl = `${PUBLIC_BASE}/${session.publicToken}`
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(publicUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const errors = session.items.filter((i: StocktakeSessionDetail["items"][0]) => i.hasError)
  const ok = session.items.filter((i: StocktakeSessionDetail["items"][0]) => i.variance === 0)
  const uncounted = session.items.filter((i: StocktakeSessionDetail["items"][0]) => i.actualQty === null)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={onBack}>
          <ChevronRight className="h-4 w-4" /> رجوع
        </Button>
        <div>
          <h1 className="text-xl font-bold">
            جرد {session.createdAt.slice(0, 10)}
            {session.notes ? ` — ${session.notes}` : ""}
          </h1>
          <p className="text-xs text-slate-500">
            {session.stats ? `${session.stats.filled}/${session.stats.total}` : `${session.items.length - uncounted.length}/${session.items.length}`} منتج ·
            <span className="text-red-600 mx-1">{errors.length} خطأ</span>·
            <span className="text-emerald-600">{ok.length} صحيح</span>·
            <span className="text-slate-400 ml-1">{uncounted.length} لم يُحسب</span>
          </p>
        </div>
      </div>

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
      {session.status === "SUBMITTED" && (
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
          <Button onClick={onClose} disabled={closing} variant="outline">
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

      {/* Items table — errors first */}
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
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {(session.items as StocktakeSessionDetail["items"]).map((item) => {
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
