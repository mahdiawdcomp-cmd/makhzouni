import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { Check, Trophy } from "lucide-react"
import { acknowledgeAuction, getAuctionResults } from "../api/endpoints"
import { useAuthStore } from "../store/authStore"
import { fmt } from "../utils/fmt"

/**
 * «انتهى المزاد» — one full-width row per finished auction on the dashboard,
 * until the merchant dismisses it. The bell notification is only a backup.
 */
export function AuctionResultsBanner() {
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const hasPermission = useAuthStore((s) => s.hasPermission)
  // Winners' phone numbers: only for whoever runs auctions.
  const allowed = user?.role === "ADMIN" || hasPermission("MANAGE_PRODUCTS") || hasPermission("MANAGE_INVOICES")

  const results = useQuery({
    queryKey: ["auctions", "results"],
    queryFn: getAuctionResults,
    enabled: allowed,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })

  const dismiss = useMutation({
    mutationFn: acknowledgeAuction,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["auctions"] }),
  })

  if (!allowed || !results.data?.length) return null

  return (
    <div className="space-y-2">
      {results.data.map((lot) => {
        const unit = lot.unit === "CARTON" ? "كارتون" : "قطعة"
        return (
          <div key={lot.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
            <Trophy className="h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <b>انتهى مزاد {lot.product.name}</b>
              {lot.winner ? (
                <span>
                  {" "}— وصل السعر <b>{fmt(lot.winner.amount)} د.ع</b> لل{unit} ({fmt(lot.quantity)} {unit}، المجموع <b>{fmt(lot.winner.total)}</b>)
                  {" "}— الفايز <b>{lot.winner.name}</b>{" "}
                  <a href={`tel:${lot.winner.phone}`} className="font-mono font-bold underline" dir="ltr">{lot.winner.phone}</a>
                </span>
              ) : (
                <span> — ما زايد أحد.</span>
              )}
            </div>
            <Link to="/auctions" className="text-xs font-semibold text-amber-800 underline dark:text-amber-300">كل المزايدين</Link>
            <button
              type="button"
              onClick={() => dismiss.mutate(lot.id)}
              disabled={dismiss.isPending}
              className="flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold shadow-sm hover:bg-slate-50 dark:bg-slate-900"
            >
              <Check className="h-3.5 w-3.5" /> تم
            </button>
          </div>
        )
      })}
    </div>
  )
}
