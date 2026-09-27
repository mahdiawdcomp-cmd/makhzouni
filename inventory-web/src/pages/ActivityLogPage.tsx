import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Eye } from "lucide-react"
import { getPageViews, getUsers } from "../api/endpoints"
import { usePageTitle } from "../hooks/usePageTitle"
import { localDateStr } from "../utils/date"

// «سجل الصفحات» — which page each account opened, and when. Owner-only (the
// API is adminOnly too). Kept 90 days on the server.
export function ActivityLogPage() {
  usePageTitle("سجل الصفحات")
  const today = localDateStr()
  const [userId, setUserId] = useState("")
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)

  const users = useQuery({ queryKey: ["users"], queryFn: getUsers })
  const views = useQuery({
    queryKey: ["page-views", userId, from, to],
    queryFn: () => getPageViews({ userId: userId || undefined, from, to, limit: 1000 }),
  })

  // Per-account summary for the period: how many opens and the last page.
  const summary = useMemo(() => {
    const m = new Map<string, { name: string; count: number; last: string; lastAt: string }>()
    for (const v of views.data ?? []) {
      const s = m.get(v.userId)
      if (s) s.count += 1
      else m.set(v.userId, { name: v.userName, count: 1, last: v.label ?? v.path, lastAt: v.createdAt })
    }
    return [...m.values()].sort((a, b) => b.count - a.count)
  }, [views.data])

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleString("ar-IQ", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", numberingSystem: "latn" })

  return (
    <div className="space-y-4 p-4" dir="rtl">
      <div className="flex items-center gap-2 text-xl font-bold">
        <Eye className="h-6 w-6 text-indigo-600" /> سجل الصفحات
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <label className="text-sm">
          <div className="mb-1 font-semibold">الموظف</div>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className="h-9 min-w-40 rounded-lg border bg-white px-2 dark:border-slate-700 dark:bg-slate-950">
            <option value="">الكل</option>
            {(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <div className="mb-1 font-semibold">من</div>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-lg border bg-white px-2 dark:border-slate-700 dark:bg-slate-950" />
        </label>
        <label className="text-sm">
          <div className="mb-1 font-semibold">إلى</div>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-lg border bg-white px-2 dark:border-slate-700 dark:bg-slate-950" />
        </label>
        <div className="text-xs text-slate-500">يبقى السجل 90 يوم</div>
      </div>

      {summary.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {summary.map((s) => (
            <div key={s.name} className="rounded-xl border bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
              <div className="font-bold">{s.name}</div>
              <div className="text-sm text-slate-500">{s.count} فتحة</div>
              <div className="mt-1 text-xs">آخر شي: {s.last} · {fmtTime(s.lastAt)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border bg-white dark:border-slate-700 dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-right dark:bg-slate-800">
            <tr>
              <th className="px-3 py-2">الوقت</th>
              <th className="px-3 py-2">الموظف</th>
              <th className="px-3 py-2">الصفحة</th>
              <th className="px-3 py-2">الرابط</th>
            </tr>
          </thead>
          <tbody>
            {views.isLoading && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500">جاري التحميل…</td></tr>}
            {views.isError && <tr><td colSpan={4} className="px-3 py-6 text-center text-red-600">تعذر تحميل السجل</td></tr>}
            {views.data?.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-500">ماكو شي بهالفترة</td></tr>}
            {(views.data ?? []).map((v) => (
              <tr key={v.id} className="border-t dark:border-slate-800">
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{fmtTime(v.createdAt)}</td>
                <td className="px-3 py-1.5 font-semibold">{v.userName}</td>
                <td className="px-3 py-1.5">{v.label ?? "—"}</td>
                <td className="px-3 py-1.5 font-mono text-xs text-slate-500" dir="ltr">{v.path}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
