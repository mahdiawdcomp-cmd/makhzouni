import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Ban, Sparkles } from "lucide-react"
import { getLoyaltyBalance, setLoyaltyExclusion } from "../api/endpoints"
import { Button } from "./ui/button"
import { toast } from "./ui/use-toast"
import { ConfirmDialog } from "./ui/confirm-dialog"
import { apiErrorMessage } from "../utils/apiError"

/* ══════════════════════════════════════════════════════════════════════
   What this customer can actually spend.

   The stored balance is everything they have ever been left holding, with no
   date on it. Points expire, so the spendable figure is derived from the
   invoices that froze them — which is the only number worth quoting to a
   customer at the counter.
══════════════════════════════════════════════════════════════════════ */

const iqd = (n: number) => `${Math.round(n).toLocaleString("en-US")} د.ع`

export function LoyaltyBalanceCard({ customerId }: { customerId: string }) {
  const qc = useQueryClient()
  const [confirmExclude, setConfirmExclude] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ["loyalty-balance", customerId],
    queryFn: () => getLoyaltyBalance(customerId),
  })

  const excludeMut = useMutation({
    mutationFn: (clearPoints: boolean) =>
      setLoyaltyExclusion(customerId, { excluded: !data?.excluded, clearPoints }),
    onSuccess: (r) => {
      toast({
        title: r.excluded ? "انستثنى من نظام النقاط" : "رجع لنظام النقاط",
        description: r.clearedPoints > 0 ? `وانصفّرت ${r.clearedPoints.toLocaleString("en-US")} نقطة` : undefined,
      })
      void qc.invalidateQueries({ queryKey: ["loyalty-balance", customerId] })
      void qc.invalidateQueries({ queryKey: ["loyalty-points-report"] })
      void qc.invalidateQueries({ queryKey: ["customer", customerId] })
    },
    onError: (e) => toast({ title: apiErrorMessage(e), variant: "destructive" }),
  })

  if (isLoading || !data) return null

  const live = data.redemptions.filter((r) => !r.revertedAt)

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-bold text-amber-800 dark:text-amber-200">
            <Sparkles className="h-4 w-4" />
            نقاط الولاء
          </p>
          {data.excluded ? (
            <p className="mt-1 text-xs text-slate-500">هذا الحساب مستثنى — ما يجمع نقاط ولا يستبدل.</p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">
              النقطة بـ{data.pointValue} دينار
              {data.expiryDays > 0 ? ` · تنتهي بعد ${data.expiryDays} يوم من كسبها` : " · ما تنتهي"}
            </p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => setConfirmExclude(true)} disabled={excludeMut.isPending}>
          <Ban className="h-3.5 w-3.5" />
          {data.excluded ? "رجّعه للنظام" : "استثنِه"}
        </Button>
      </div>

      {!data.excluded && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Cell label="قابلة للاستبدال" value={data.redeemable.toLocaleString("en-US")} strong />
            <Cell label="قيمتها" value={iqd(data.redeemableValue)} strong />
            <Cell label="الرصيد الكلي" value={data.lifetime.toLocaleString("en-US")} />
            <Cell label="منتهية" value={data.expired.toLocaleString("en-US")} />
          </div>

          {data.redeemable > 0 && (
            <p className="mt-2 rounded-xl bg-white px-3 py-2 text-[11px] text-slate-600 dark:bg-slate-900 dark:text-slate-300">
              تنصرف كخصم على فاتورته الجاية — من شاشة الفاتورة، خانة «استبدل نقاط».
            </p>
          )}

          {live.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-[11px] font-bold text-slate-600 dark:text-slate-300">آخر الاستبدالات</p>
              <div className="space-y-1">
                {live.slice(0, 5).map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded-lg bg-white px-2.5 py-1.5 text-[11px] dark:bg-slate-900">
                    <span className="text-slate-600 dark:text-slate-300">
                      {r.points.toLocaleString("en-US")} نقطة
                    </span>
                    <span className="font-bold text-slate-800 dark:text-slate-100" dir="ltr">{iqd(r.value)}</span>
                    <span className="text-slate-400">{new Date(r.createdAt).toLocaleDateString("ar-IQ")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmExclude}
        title={data.excluded ? "رجّعه لنظام النقاط" : "استثنِه من نظام النقاط"}
        description={
          data.excluded
            ? "راح يرجع يجمع نقاط من فواتيره الجاية. النقاط القديمة ما ترجع."
            : `ما راح يجمع نقاط ولا يستبدل. ${data.lifetime > 0 ? `عنده ${data.lifetime.toLocaleString("en-US")} نقطة — تنصفّر.` : ""}`
        }
        confirmLabel={data.excluded ? "رجّعه" : "استثنِه وصفّر نقاطه"}
        loading={excludeMut.isPending}
        onConfirm={() => { setConfirmExclude(false); excludeMut.mutate(!data.excluded) }}
        onCancel={() => setConfirmExclude(false)}
      />
    </div>
  )
}

function Cell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl bg-white p-2.5 dark:bg-slate-900">
      <p className="text-[10px] font-semibold text-slate-500">{label}</p>
      <p className={strong
        ? "mt-0.5 text-sm font-extrabold text-amber-700 dark:text-amber-300"
        : "mt-0.5 text-sm font-bold text-slate-700 dark:text-slate-200"} dir="ltr">{value}</p>
    </div>
  )
}
