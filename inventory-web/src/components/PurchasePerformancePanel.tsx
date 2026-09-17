import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { ChevronDown, TrendingUp } from "lucide-react"
import { getPurchasePerformance } from "../api/endpoints"
import { useAuthStore } from "../store/authStore"
import { fmt } from "../utils/fmt"
import { CATEGORY_META, CATEGORY_ORDER, PurchasePerformanceTable } from "./PurchasePerformanceTable"

/**
 * «أداء هذا الأوردر» inside a purchase invoice. Grades are still relative to
 * every purchase in the shop, so "الأفضل" here means the best in the shop.
 */
export function PurchasePerformancePanel({ invoiceId }: { invoiceId: string }) {
  const canViewProfits = useAuthStore((s) => s.canViewProfitReports)()
  const [open, setOpen] = useState(true)

  const report = useQuery({
    queryKey: ["purchase-performance", "invoice", invoiceId],
    queryFn: () => getPurchasePerformance({ invoiceId }),
    enabled: canViewProfits && open,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })

  if (!canViewProfits) return null

  const order = report.data?.orders[0]
  const counts = report.data?.categoryCounts ?? {}

  return (
    <div className="print:hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 text-right dark:border-slate-800"
      >
        <span className="flex items-center gap-2 text-sm font-bold">
          <TrendingUp className="h-4 w-4 text-emerald-600" /> أداء هذا الأوردر
        </span>
        <span className="flex items-center gap-3 text-xs text-slate-500">
          {order && (
            <>
              <span>مباع <b className="text-slate-900 dark:text-white">{order.soldPercent}%</b></span>
              <span>ربح <b className={order.profit < 0 ? "text-rose-600" : "text-emerald-600"}>{fmt(order.profit)}</b></span>
            </>
          )}
          <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="space-y-3 p-4">
          {report.isPending ? (
            <p className="text-center text-sm text-slate-400">جاري الحساب...</p>
          ) : report.isError ? (
            <p className="text-center text-sm text-rose-600">تعذّر حساب أداء الأوردر.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {CATEGORY_ORDER.filter((c) => (counts[c] ?? 0) > 0).map((c) => (
                  <span key={c} title={CATEGORY_META[c].hint} className={`rounded-full px-2.5 py-1 text-xs font-semibold ${CATEGORY_META[c].className}`}>
                    {CATEGORY_META[c].label} ({fmt(counts[c] ?? 0)})
                  </span>
                ))}
                <Link to="/reports/purchase-performance" className="mr-auto text-xs text-indigo-600 hover:underline">
                  كل المشتريات ←
                </Link>
              </div>
              <PurchasePerformanceTable rows={report.data?.rows ?? []} showOrder={false} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
