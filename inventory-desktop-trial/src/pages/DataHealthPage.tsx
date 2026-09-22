import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { AlertTriangle, ArrowLeft, PackageCheck, RefreshCw, ShieldCheck } from "lucide-react"
import { getProductDataHealth } from "../api/endpoints"
import { Button } from "../components/ui/button"

const fmt = (value: unknown) => Number(value ?? 0).toLocaleString("en-US")

const ISSUE_LABEL: Record<string, string> = {
  MISSING_COST: "بلا كلفة",
  COST_ABOVE_SALE: "الكلفة أعلى من سعر البيع",
}

export function DataHealthPage() {
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["products", "data-health"],
    queryFn: getProductDataHealth,
    staleTime: 60_000,
  })

  const unmigrated = data?.unmigratedStock ?? []
  const costIssues = data?.costIssues ?? []
  const clean = !isLoading && unmigrated.length === 0 && costIssues.length === 0

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ShieldCheck className="h-6 w-6" /> فحص صحة البيانات
          </h1>
          <p className="text-sm text-slate-500">
            فحص للقراءة فقط — ما يعدّل ولا يحذف ولا يخفي أي شي. يكشف الأرقام التي تكذب على الحسابات بصمت.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={"h-4 w-4 " + (isFetching ? "animate-spin" : "")} /> تحديث
          </Button>
          <Button variant="outline" asChild>
            <Link to="/inventory"><ArrowLeft className="h-4 w-4" /> المخزن</Link>
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border bg-white p-10 text-center text-sm text-rose-600 dark:bg-slate-950">تعذّر تحميل الفحص.</p>
      ) : isLoading ? (
        <p className="rounded-xl border bg-white p-10 text-center text-sm text-slate-400 dark:bg-slate-950">جاري الفحص...</p>
      ) : (
        <>
          <div className="rounded-xl border bg-white px-4 py-3 text-sm dark:bg-slate-950">
            تم فحص <b>{fmt(data?.checkedProducts)}</b> مادة.
          </div>

          {clean && (
            <div className="rounded-xl border bg-white p-10 text-center dark:bg-slate-950">
              <PackageCheck className="mx-auto h-10 w-10 text-emerald-500" />
              <p className="mt-3 font-semibold">ما في شي مكشوف — الأرقام سليمة.</p>
            </div>
          )}

          {/* 1 — stock that was never migrated to a warehouse */}
          {unmigrated.length > 0 && (
            <section className="overflow-hidden rounded-xl border bg-white dark:bg-slate-950">
              <div className="border-b bg-amber-50 px-4 py-3 dark:bg-amber-950/20">
                <h2 className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4" /> رصيد قديم لم يُنقل لأي مخزن — {fmt(unmigrated.length)} مادة
                </h2>
                <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-300/80">
                  هذه المواد ما عندها أي صف مخزن، وكانت تعرض رصيدها الأصلي من يوم الإدخال — رقم ما ينقص عند البيع أبداً.
                  هسه صارت تقرأ صفر، وهذا هو الصحيح. لترجيعها للبيع: افتح المادة وأدخل كميتها الحقيقية بالمخزن الصحيح.
                </p>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-500 dark:bg-slate-900">
                  <tr>
                    <th className="px-3 py-3 text-right">المادة</th>
                    <th className="px-3 py-3 text-right">الرقم القديم (قطعة)</th>
                    <th className="px-3 py-3 text-right">القطع بالكارتون</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-800">
                  {unmigrated.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-900/40">
                      <td className="px-3 py-2.5">
                        <Link to={`/inventory/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                        <p className="font-mono text-xs text-slate-400">{p.itemNumber}</p>
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-amber-700 dark:text-amber-400">{fmt(p.legacyPieces)}</td>
                      <td className="px-3 py-2.5 text-slate-500">{fmt(p.pcsPerCarton)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* 2 — cost prices that produce fake profit */}
          {costIssues.length > 0 && (
            <section className="overflow-hidden rounded-xl border bg-white dark:bg-slate-950">
              <div className="border-b bg-rose-50 px-4 py-3 dark:bg-rose-950/20">
                <h2 className="flex items-center gap-2 font-bold text-rose-800 dark:text-rose-300">
                  <AlertTriangle className="h-4 w-4" /> كلفة مشكوك بيها — {fmt(costIssues.length)} مادة
                </h2>
                <p className="mt-1 text-xs text-rose-800/80 dark:text-rose-300/80">
                  الكلفة ما تتحدّث إلا بفاتورة شراء. مادة بلا كلفة تطلع ربحها كامل وهمي، ومادة كلفتها أعلى من سعر بيعها تعني خسارة بكل قطعة تبيعها.
                </p>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-500 dark:bg-slate-900">
                  <tr>
                    <th className="px-3 py-3 text-right">المادة</th>
                    <th className="px-3 py-3 text-right">المشكلة</th>
                    <th className="px-3 py-3 text-right">الكلفة</th>
                    <th className="px-3 py-3 text-right">آخر شراء</th>
                    <th className="px-3 py-3 text-right">سعر البيع</th>
                    <th className="px-3 py-3 text-right">الرصيد</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-800">
                  {costIssues.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-900/40">
                      <td className="px-3 py-2.5">
                        <Link to={`/inventory/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                        <p className="font-mono text-xs text-slate-400">{p.itemNumber}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                          {ISSUE_LABEL[p.issue] ?? p.issue}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-semibold">{fmt(p.costPrice)}</td>
                      <td className="px-3 py-2.5 text-slate-500">{fmt(p.purchasePrice)}</td>
                      <td className="px-3 py-2.5 text-emerald-600">{fmt(p.salePrice)}</td>
                      <td className="px-3 py-2.5 text-slate-500">{fmt(p.currentStock)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  )
}

export default DataHealthPage
