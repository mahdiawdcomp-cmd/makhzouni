import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { RefreshCw, TrendingUp } from "lucide-react"
import { getPurchasePerformance } from "../api/endpoints"
import type { PerformanceCategory, PurchaseSource } from "../api/endpoints"
import { Button } from "../components/ui/button"
import { QueryErrorBox } from "../components/ui/query-error"
import { CATEGORY_META, CATEGORY_ORDER, PurchasePerformanceTable } from "../components/PurchasePerformanceTable"
import { usePageTitle } from "../hooks/usePageTitle"
import { useAuthStore } from "../store/authStore"
import { fmt } from "../utils/fmt"

const SOURCES: Array<[PurchaseSource | "", string]> = [["", "كل المشتريات"], ["CHINA", "أوردرات الصين"], ["REGULAR", "شراء عادي"]]

/**
 * «أداء المشتريات» — every purchase line graded on how fast it sells and what it
 * earns, so the merchant can see what to order again. Refreshes by itself: every
 * sale moves the numbers.
 */
export function PurchasePerformancePage() {
  usePageTitle("أداء المشتريات")
  const canViewProfits = useAuthStore((s) => s.canViewProfitReports)()
  const [source, setSource] = useState<PurchaseSource | "">("")
  const [category, setCategory] = useState<PerformanceCategory | "">("")
  const [view, setView] = useState<"items" | "orders">("items")

  const report = useQuery({
    queryKey: ["purchase-performance", source],
    // The category filter runs on the client: the counts on the chips need the full list.
    queryFn: () => getPurchasePerformance({ source: source || undefined }),
    enabled: canViewProfits,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })

  if (!canViewProfits) {
    return <p className="rounded-xl border bg-white p-10 text-center text-sm text-slate-500 dark:bg-slate-950">هذي الصفحة تعرض الأرباح، وما عندك صلاحية تقارير الأرباح.</p>
  }

  const data = report.data
  const rows = (data?.rows ?? []).filter((r) => (category ? r.category === category : true))
  const counts = data?.categoryCounts ?? {}

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <TrendingUp className="h-6 w-6" /> أداء المشتريات
          </h1>
          <p className="text-sm text-slate-500">
            كل مادة من كل فاتورة شراء: شكد انباع منها، بأي سرعة، وشكد ربّحت — تتحدّث مع كل بيعة. الأفضل فوق: هذي اطلبها مرة ثانية.
          </p>
        </div>
        <Button variant="outline" onClick={() => void report.refetch()} disabled={report.isFetching}>
          <RefreshCw className={"h-4 w-4 " + (report.isFetching ? "animate-spin" : "")} /> تحديث
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border p-0.5 dark:border-slate-700">
          {SOURCES.map(([id, label]) => (
            <button key={id || "all"} type="button" onClick={() => setSource(id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${source === id ? "bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-900" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg border p-0.5 dark:border-slate-700">
          {([["items", "حسب المادة"], ["orders", "حسب الأوردر"]] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setView(id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${view === id ? "bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-900" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {report.isError && <QueryErrorBox title="تعذّر تحميل أداء المشتريات" onRetry={() => void report.refetch()} />}

      {report.isPending ? (
        <p className="rounded-xl border bg-white p-10 text-center text-sm text-slate-400 dark:bg-slate-950">جاري الحساب...</p>
      ) : view === "items" ? (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setCategory("")}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${category === "" ? "bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-900" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"}`}>
              الكل ({fmt(data?.rows.length ?? 0)})
            </button>
            {CATEGORY_ORDER.filter((c) => (counts[c] ?? 0) > 0).map((c) => (
              <button key={c} type="button" onClick={() => setCategory(c)} title={CATEGORY_META[c].hint}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${category === c ? "ring-2 ring-slate-900 dark:ring-amber-500" : ""} ${CATEGORY_META[c].className}`}>
                {CATEGORY_META[c].label} ({fmt(counts[c] ?? 0)})
              </button>
            ))}
          </div>
          {category && CATEGORY_META[category].hint && (
            <p className="text-xs text-slate-500">{CATEGORY_META[category].hint}</p>
          )}
          <PurchasePerformanceTable rows={rows} />
        </>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white dark:bg-slate-950">
          {(data?.orders.length ?? 0) === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">ما في فواتير شراء.</p>
          ) : (
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-500 dark:bg-slate-900">
                <tr>
                  <th className="px-3 py-3 text-right">الأوردر</th>
                  <th className="px-3 py-3 text-right">المواد</th>
                  <th className="px-3 py-3 text-right">المباع</th>
                  <th className="px-3 py-3 text-right">الربح</th>
                  <th className="px-3 py-3 text-right">الأفضل / الراكد</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-800">
                {data!.orders.map((o) => (
                  <tr key={o.invoiceId} className="hover:bg-slate-50/60 dark:hover:bg-slate-900/40">
                    <td className="px-3 py-2.5">
                      <Link to={`/invoices/${o.invoiceId}`} className="font-semibold hover:underline">{o.invoiceNumber}</Link>
                      <p className="text-xs text-slate-400">{new Date(o.date).toLocaleDateString("en-GB")}</p>
                      <p className={`text-xs ${o.source === "CHINA" ? "text-rose-600" : "text-slate-500"}`}>{o.source === "CHINA" ? "أوردر صين" : o.supplierName}</p>
                    </td>
                    <td className="px-3 py-2.5">{fmt(o.lines)}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold">{o.soldPercent}%</div>
                      <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, o.soldPercent)}%` }} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className={`font-bold ${o.profit < 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmt(o.profit)}</div>
                      <p className="text-xs text-slate-500">هامش {o.margin}%</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      <span className="text-emerald-600">⭐ {fmt(o.best)}</span>
                      <span className="mx-2 text-slate-300">|</span>
                      <span className="text-rose-600">🐌 {fmt(o.stagnant)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <p className="text-xs text-slate-400">
        طريقة الحساب: كل بيعة تتوزّع على فواتير الشراء المفتوحة لنفس المادة حسب الباقي من كل وحدة — تقدير وليس تتبّع قطعة بقطعة.
        الربح محسوب من كلفة كل فاتورة شراء نفسها (ولأوردر الصين: الكلفة مع الشحن والتخليص).
        السرعة والربح مصنّفين بالمقارنة مع كل مشترياتك: السريع يعني سريع بمحلك أنت.
      </p>
    </div>
  )
}

export default PurchasePerformancePage
