import { useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { ArchiveX, ArrowLeft, Trash2, AlertTriangle } from "lucide-react"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import "dayjs/locale/ar"
import { getStaleProducts, bulkDeleteProducts } from "../api/endpoints"
import { Button } from "../components/ui/button"
import { ConfirmDialog } from "../components/ui/confirm-dialog"
import { toast } from "../components/ui/use-toast"

dayjs.extend(relativeTime)
dayjs.locale("ar")

const PERIODS = [
  { days: 60, label: "شهرين" },
  { days: 90, label: "3 أشهر" },
  { days: 180, label: "6 أشهر" },
  { days: 365, label: "سنة" },
]

export function StaleProductsPage() {
  const qc = useQueryClient()
  const [days, setDays] = useState(60)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ["stale-products", days],
    queryFn: () => getStaleProducts(days),
    staleTime: 60_000,
  })

  const products = useMemo(() => data?.data ?? [], [data])
  const allSelected = products.length > 0 && selected.size === products.length

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(products.map((p) => p.id)))
  }

  const deleteMut = useMutation({
    mutationFn: () => bulkDeleteProducts([...selected]),
    onSuccess: (res) => {
      toast({ title: res.message ?? `تم حذف ${res.deleted} مادة` })
      setSelected(new Set())
      setConfirmOpen(false)
      void qc.invalidateQueries({ queryKey: ["stale-products"] })
      void qc.invalidateQueries({ queryKey: ["products"], refetchType: "none" })
    },
    onError: (e: any) => toast({ title: e.response?.data?.message ?? "تعذّر الحذف", variant: "destructive" }),
  })

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ArchiveX className="h-6 w-6" /> المواد الراكدة
          </h1>
          <p className="text-sm text-slate-500">المواد التي لم تتحرك (بيع/تحويل/حركة مخزن) منذ مدة — احذفها أو أبقِها.</p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/inventory"><ArrowLeft className="h-4 w-4" /> المخزن</Link>
        </Button>
      </div>

      {/* Period selector */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3 dark:bg-slate-950">
        <span className="text-sm font-semibold text-slate-600">راكدة منذ:</span>
        {PERIODS.map((p) => (
          <button
            key={p.days}
            onClick={() => { setDays(p.days); setSelected(new Set()) }}
            className={
              "rounded-full px-4 py-1.5 text-sm font-semibold transition " +
              (days === p.days ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")
            }
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Result summary + delete action */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-amber-50 px-4 py-3 dark:bg-amber-950/20">
        <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {isLoading ? "جاري الفحص..." : (
            <span><b>{products.length}</b> مادة راكدة لم تتحرك منذ {PERIODS.find((p) => p.days === days)?.label}</span>
          )}
        </div>
        {selected.size > 0 && (
          <Button variant="destructive" onClick={() => setConfirmOpen(true)} disabled={deleteMut.isPending}>
            <Trash2 className="h-4 w-4" /> حذف المحدد ({selected.size})
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border bg-white dark:bg-slate-950">
        {isLoading ? (
          <p className="p-8 text-center text-sm text-slate-400">جاري التحميل...</p>
        ) : products.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-400">🎉 لا توجد مواد راكدة في هذه المدة — كل البضاعة تتحرك.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-500 dark:bg-slate-900">
              <tr>
                <th className="px-3 py-3 text-center">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 accent-rose-600" />
                </th>
                <th className="px-3 py-3 text-right">المادة</th>
                <th className="px-3 py-3 text-right">المخزون الحالي</th>
                <th className="px-3 py-3 text-right">آخر حركة</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-800">
              {products.map((p) => (
                <tr key={p.id} className={selected.has(p.id) ? "bg-rose-50/60 dark:bg-rose-950/10" : "hover:bg-slate-50/60 dark:hover:bg-slate-900/40"}>
                  <td className="px-3 py-2.5 text-center">
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4 accent-rose-600" />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      {(p.thumbnailUrl || p.imageUrl)
                        ? <img src={p.thumbnailUrl || p.imageUrl || ""} alt="" loading="lazy" className="h-9 w-9 rounded object-cover ring-1 ring-slate-200" />
                        : <span className="grid h-9 w-9 place-items-center rounded bg-slate-100 text-[9px] font-bold text-slate-400">{p.itemNumber?.slice(0, 3)}</span>}
                      <div>
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs text-slate-400 font-mono">{p.itemNumber}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={(p.currentStock ?? 0) > 0 ? "font-semibold" : "text-slate-400"}>
                      {p.currentStock ?? 0} قطعة
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">
                    {p.lastMovementAt
                      ? dayjs(p.lastMovementAt).fromNow()
                      : <span className="text-rose-500">لم تتحرك إطلاقاً</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={`حذف ${selected.size} مادة راكدة؟`}
        description="ستُنقل المواد إلى المحذوفات (يمكن استرجاعها خلال 48 ساعة). يخفف الحمل على القائمة وقاعدة البيانات."
        confirmLabel="حذف"
        destructive
        loading={deleteMut.isPending}
        onConfirm={() => deleteMut.mutate()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
