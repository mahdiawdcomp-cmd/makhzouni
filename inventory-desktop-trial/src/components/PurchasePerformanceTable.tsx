import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import type { PerformanceCategory, PerformanceLevel, PurchaseLotPerformance } from "../api/endpoints"
import { fmt } from "../utils/fmt"

/** Shared by the «أداء المشتريات» page and the tab inside a purchase invoice. */
export const CATEGORY_META: Record<PerformanceCategory, { label: string; hint: string; className: string }> = {
  BEST: { label: "⭐ الأفضل", hint: "سريع البيع وربحه عالي — اطلبه مرة ثانية", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  HIGH_PROFIT_MEDIUM: { label: "💰 ربح عالي، بيع متوسط", hint: "يستاهل تطلبه، بس مو بكمية كبيرة", className: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300" },
  HIGH_PROFIT_SLOW: { label: "💎 ربح عالي، بيع بطيء", hint: "ربحه زين بس يتحرك بطيء — راجع سعره", className: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" },
  FAST_LOW_PROFIT: { label: "🚀 سريع، ربح قليل", hint: "ينباع بسرعة بهامش رفيع — يجيب حركة", className: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300" },
  BALANCED: { label: "⚖️ متوازن", hint: "متوسط بالسرعة والربح", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  STAGNANT: { label: "🐌 راكد", hint: "بطيء وربحه قليل — أو ما انباع أصلاً", className: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300" },
  NEW: { label: "🆕 جديد", hint: "أقل من أسبوع وما انباع بعد — ما ينحكم عليه", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  OTHER: { label: "• غيره", hint: "", className: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" },
}

export const CATEGORY_ORDER: PerformanceCategory[] = [
  "BEST", "HIGH_PROFIT_MEDIUM", "HIGH_PROFIT_SLOW", "FAST_LOW_PROFIT", "BALANCED", "STAGNANT", "NEW", "OTHER",
]

const LEVEL_LABEL: Record<PerformanceLevel, string> = { HIGH: "عالي", MEDIUM: "متوسط", LOW: "قليل" }
const SPEED_LABEL: Record<PerformanceLevel, string> = { HIGH: "سريع", MEDIUM: "متوسط", LOW: "بطيء" }

/** Pieces read as cartons + loose pieces, the way the merchant counts. */
export function inCartons(pieces: number, pcsPerCarton: number) {
  if (pcsPerCarton <= 1) return `${fmt(pieces)} قطعة`
  const cartons = Math.floor(pieces / pcsPerCarton)
  const rest = Math.round(pieces - cartons * pcsPerCarton)
  if (cartons === 0) return `${fmt(rest)} قطعة`
  return `${fmt(cartons)} كارتون${rest ? ` و${fmt(rest)}` : ""}`
}

type SortKey = "score" | "speed" | "profit" | "margin" | "soldPercent"

const SORTS: Array<[SortKey, string]> = [
  ["score", "الأفضل (سرعة + ربح)"],
  ["speed", "الأسرع"],
  ["profit", "أكثر ربح"],
  ["margin", "أعلى هامش"],
  ["soldPercent", "الأكثر نفاداً"],
]

export function PurchasePerformanceTable({ rows, showOrder = true }: { rows: PurchaseLotPerformance[]; showOrder?: boolean }) {
  const [sort, setSort] = useState<SortKey>("score")
  const [search, setSearch] = useState("")

  const sorted = useMemo(() => {
    const q = search.trim()
    const list = q ? rows.filter((r) => r.productName.includes(q) || r.itemNumber.includes(q) || r.invoiceNumber.includes(q)) : rows
    const value = (r: PurchaseLotPerformance) =>
      sort === "speed" ? (r.soldPieces > 0 ? r.soldPercent / Math.max(1, r.daysActive) : -1)
        : sort === "profit" ? r.profit
          : sort === "margin" ? (r.marginIsExpected ? -Infinity : r.margin)
            : sort === "soldPercent" ? r.soldPercent
              : r.score
    return [...list].sort((a, b) => value(b) - value(a))
  }, [rows, sort, search])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث بالمادة أو رقم الفاتورة"
          className="h-9 w-56 rounded-lg border px-3 text-sm dark:bg-slate-900"
        />
        <div className="flex flex-wrap gap-1 rounded-lg border p-0.5 dark:border-slate-700">
          {SORTS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSort(id)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${sort === id ? "bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-900" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-xl border bg-white p-8 text-center text-sm text-slate-400 dark:bg-slate-950">ما في مواد بهذا الفلتر.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white dark:bg-slate-950">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-500 dark:bg-slate-900">
              <tr>
                <th className="px-3 py-3 text-right">المادة</th>
                {showOrder && <th className="px-3 py-3 text-right">الأوردر</th>}
                <th className="px-3 py-3 text-right">المباع</th>
                <th className="px-3 py-3 text-right">السرعة</th>
                <th className="px-3 py-3 text-right">الربح</th>
                <th className="px-3 py-3 text-right">التصنيف</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-800">
              {sorted.map((r) => {
                const meta = CATEGORY_META[r.category]
                return (
                  <tr key={r.lotId} className="align-top hover:bg-slate-50/60 dark:hover:bg-slate-900/40">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        {r.thumbnailUrl
                          ? <img src={r.thumbnailUrl} alt="" loading="lazy" className="h-10 w-10 rounded object-cover ring-1 ring-slate-200" />
                          : <span className="grid h-10 w-10 place-items-center rounded bg-slate-100 text-[9px] font-bold text-slate-400">{r.itemNumber.slice(0, 4)}</span>}
                        <div className="min-w-0">
                          <Link to={`/inventory/${r.productId}`} className="font-medium hover:underline">{r.productName}</Link>
                          <p className="font-mono text-xs text-slate-400">{r.itemNumber}</p>
                        </div>
                      </div>
                    </td>
                    {showOrder && (
                      <td className="px-3 py-2.5 text-xs">
                        <Link to={`/invoices/${r.invoiceId}`} className="font-semibold hover:underline">{r.invoiceNumber}</Link>
                        <p className="text-slate-400">{new Date(r.date).toLocaleDateString("en-GB")}</p>
                        <p className={r.source === "CHINA" ? "text-rose-600" : "text-slate-500"}>{r.source === "CHINA" ? "أوردر صين" : r.supplierName}</p>
                      </td>
                    )}
                    <td className="px-3 py-2.5">
                      <div className="font-semibold">{r.soldPercent}%</div>
                      <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, r.soldPercent)}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {inCartons(r.soldPieces, r.pcsPerCarton)} من {inCartons(r.orderedPieces, r.pcsPerCarton)}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      <div className="font-semibold">{SPEED_LABEL[r.speedLevel]}</div>
                      <p className="text-slate-500">{fmt(r.piecesPerDay)} قطعة/يوم · {fmt(r.daysActive)} يوم</p>
                      <p className="text-slate-500">
                        {r.soldOut ? "خلص ✓" : r.daysToSellOut !== null ? `يخلص خلال ~${fmt(r.daysToSellOut)} يوم` : "ما يتحرك"}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      <div className={`font-bold ${r.profit < 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmt(r.profit)}</div>
                      <p className="text-slate-500">
                        هامش {r.margin}%{r.marginIsExpected ? " (متوقع)" : ""} · {LEVEL_LABEL[r.profitLevel]}
                      </p>
                      <p className="text-slate-400">كلفة القطعة {fmt(r.costPerPiece)}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${meta.className}`} title={meta.hint}>
                        {meta.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
