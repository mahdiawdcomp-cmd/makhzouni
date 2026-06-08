import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, ChevronRight, ClipboardList, Plus, Save } from "lucide-react"
import {
  closeStocktakeSession,
  createStocktakeSession,
  getStocktakeSession,
  listStocktakeSessions,
  submitStocktakeSession,
  updateStocktakeItem,
} from "../api/endpoints"
import type { StocktakeSessionDetail, StocktakeSessionSummary } from "../types/api"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"

function statusLabel(s: string) {
  if (s === "OPEN") return { label: "مفتوح", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" }
  if (s === "SUBMITTED") return { label: "مرفوع", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" }
  return { label: "مغلق", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" }
}

export function StocktakePage() {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  const listQ = useQuery({ queryKey: ["stocktake-sessions"], queryFn: listStocktakeSessions })
  const sessionQ = useQuery({
    queryKey: ["stocktake-session", selectedId],
    queryFn: () => getStocktakeSession(selectedId!),
    enabled: Boolean(selectedId),
  })

  const createMut = useMutation({
    mutationFn: (p: { notes?: string }) => createStocktakeSession(p),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["stocktake-sessions"] })
      setSelectedId(d.id)
      setShowNew(false)
    },
  })

  const submitMut = useMutation({
    mutationFn: (id: string) => submitStocktakeSession(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stocktake-session", selectedId] }),
  })

  const closeMut = useMutation({
    mutationFn: (id: string) => closeStocktakeSession(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stocktake-session", selectedId] })
      qc.invalidateQueries({ queryKey: ["stocktake-sessions"] })
    },
  })

  if (selectedId && sessionQ.data) {
    return <SessionView
      session={sessionQ.data}
      onBack={() => setSelectedId(null)}
      onSubmit={() => submitMut.mutate(selectedId)}
      onClose={() => closeMut.mutate(selectedId)}
      submitting={submitMut.isPending}
      closing={closeMut.isPending}
      onRefresh={() => qc.invalidateQueries({ queryKey: ["stocktake-session", selectedId] })}
    />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">الجرد الدوري</h1>
          <p className="text-slate-500">أنشئ جلسة جرد، وزّعها على الموظفين، وراجع الفروقات.</p>
        </div>
        <Button onClick={() => setShowNew(true)}>
          <Plus className="h-4 w-4" /> جلسة جرد جديدة
        </Button>
      </div>

      {showNew && (
        <NewSessionCard
          onCancel={() => setShowNew(false)}
          onCreate={(notes) => createMut.mutate({ notes })}
          loading={createMut.isPending}
        />
      )}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" /> جلسات الجرد</CardTitle></CardHeader>
        <CardContent>
          {listQ.isLoading ? (
            <p className="text-slate-500 text-sm">جاري التحميل...</p>
          ) : (listQ.data ?? []).length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-8">لا توجد جلسات جرد. اضغط «جلسة جرد جديدة» للبدء.</p>
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

function NewSessionCard({ onCancel, onCreate, loading }: { onCancel: () => void; onCreate: (notes?: string) => void; loading: boolean }) {
  const [notes, setNotes] = useState("")
  return (
    <Card className="border-blue-200 dark:border-blue-800">
      <CardContent className="p-4 space-y-3">
        <p className="font-medium">جلسة جرد جديدة</p>
        <Input placeholder="ملاحظات (اختياري)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex gap-2">
          <Button onClick={() => onCreate(notes || undefined)} disabled={loading}>
            {loading ? "جاري الإنشاء..." : "إنشاء الجلسة"}
          </Button>
          <Button variant="outline" onClick={onCancel}>إلغاء</Button>
        </div>
        <p className="text-xs text-slate-500">سيتم استيراد قائمة جميع المنتجات مع كمياتها الحالية في النظام.</p>
      </CardContent>
    </Card>
  )
}

function SessionRow({ session, onClick }: { session: StocktakeSessionSummary; onClick: () => void }) {
  const st = statusLabel(session.status)
  return (
    <button type="button" onClick={onClick}
      className="w-full flex items-center justify-between rounded-lg border p-3 text-right hover:bg-slate-50 dark:hover:bg-slate-800 transition">
      <div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${st.cls}`}>{st.label}</span>
          <span className="text-sm font-medium">{session.createdAt.slice(0, 10)}</span>
          {session.branch && <span className="text-xs text-slate-400">— {session.branch.name}</span>}
        </div>
        <p className="text-xs text-slate-500 mt-0.5">{session.creator.name} · {session.itemCount} منتج</p>
        {session.notes && <p className="text-xs text-slate-400 mt-0.5">{session.notes}</p>}
      </div>
      <ChevronRight className="h-4 w-4 text-slate-400" />
    </button>
  )
}

function SessionView({
  session, onBack, onSubmit, onClose, submitting, closing, onRefresh,
}: {
  session: StocktakeSessionDetail
  onBack: () => void
  onSubmit: () => void
  onClose: () => void
  submitting: boolean
  closing: boolean
  onRefresh: () => void
}) {
  const qc = useQueryClient()
  const updateMut = useMutation({
    mutationFn: (p: { productId: string; actualQty: number; notes?: string }) =>
      updateStocktakeItem(session.id, p.productId, p.actualQty, p.notes),
    onSuccess: () => onRefresh(),
  })

  const [localQty, setLocalQty] = useState<Record<string, string>>({})
  const filled = session.items.filter((i) => i.actualQty !== null).length
  const total = session.items.length
  const discrepancies = session.items.filter((i) => i.variance !== null && i.variance !== 0)

  function save(productId: string) {
    const val = localQty[productId]
    if (val === undefined || val === "") return
    updateMut.mutate({ productId, actualQty: Number(val) })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={onBack}><ChevronRight className="h-4 w-4" /> رجوع</Button>
        <div>
          <h1 className="text-xl font-bold">جلسة جرد — {session.createdAt.slice(0, 10)}</h1>
          <p className="text-xs text-slate-500">{filled} / {total} منتج تم عده — {discrepancies.length} فرق</p>
        </div>
      </div>

      {session.status === "OPEN" && (
        <div className="flex gap-2 flex-wrap">
          <Button onClick={onSubmit} disabled={submitting}>
            <Save className="h-4 w-4" />
            {submitting ? "جاري الرفع..." : "رفع الجرد للمراجعة"}
          </Button>
        </div>
      )}
      {session.status === "SUBMITTED" && (
        <div className="space-y-2">
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 dark:bg-amber-950 dark:border-amber-800">
            <p className="font-semibold text-amber-800 dark:text-amber-300">الجلسة مرفوعة للمراجعة</p>
            <p className="text-xs text-amber-600 mt-1">راجع الفروقات أدناه وأغلق الجلسة للتأكيد.</p>
          </div>
          <Button onClick={onClose} disabled={closing} variant="outline">
            <CheckCircle2 className="h-4 w-4" />
            {closing ? "جاري الإغلاق..." : "إغلاق الجلسة وتأكيد الجرد"}
          </Button>
        </div>
      )}
      {session.status === "CLOSED" && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 dark:bg-emerald-950 dark:border-emerald-800">
          <p className="font-semibold text-emerald-800 dark:text-emerald-300">✓ الجلسة مغلقة — الجرد مكتمل</p>
        </div>
      )}

      {/* Items table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">المادة</th>
                  <th className="px-3 py-2 text-right font-medium">الفئة</th>
                  <th className="px-3 py-2 text-center font-medium">النظام<br/><span className="text-xs text-slate-400">(كارتون)</span></th>
                  <th className="px-3 py-2 text-center font-medium">الفعلي<br/><span className="text-xs text-slate-400">(كارتون)</span></th>
                  <th className="px-3 py-2 text-center font-medium">الفرق</th>
                  {session.status === "OPEN" && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {session.items.map((item) => {
                  const hasVariance = item.variance !== null && item.variance !== 0
                  return (
                    <tr key={item.id} className={hasVariance ? "bg-red-50 dark:bg-red-950" : ""}>
                      <td className="px-3 py-2 font-medium">{item.productName}</td>
                      <td className="px-3 py-2 text-slate-500">{item.category ?? "—"}</td>
                      <td className="px-3 py-2 text-center">
                        {item.systemQty !== null ? item.systemQty : <span className="text-slate-300">مخفي</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {session.status === "OPEN" ? (
                          <Input
                            type="number"
                            min={0}
                            className="w-20 text-center mx-auto"
                            placeholder={item.actualQty !== null ? String(item.actualQty) : "أدخل"}
                            value={localQty[item.productId] ?? (item.actualQty !== null ? String(item.actualQty) : "")}
                            onChange={(e) => setLocalQty((p) => ({ ...p, [item.productId]: e.target.value }))}
                            onBlur={() => save(item.productId)}
                            onKeyDown={(e) => e.key === "Enter" && save(item.productId)}
                          />
                        ) : (
                          item.actualQty !== null ? item.actualQty : "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {item.variance !== null ? (
                          <span className={item.variance === 0 ? "text-emerald-600" : item.variance > 0 ? "text-blue-600" : "text-red-600 font-bold"}>
                            {item.variance > 0 ? `+${item.variance}` : item.variance}
                          </span>
                        ) : "—"}
                      </td>
                      {session.status === "OPEN" && (
                        <td className="px-3 py-2 text-center">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!localQty[item.productId] && item.actualQty === null}
                            onClick={() => save(item.productId)}
                          >
                            <Save className="h-3 w-3" />
                          </Button>
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
