import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Search, Sparkles, X } from "lucide-react"
import { getLoyaltyPointsReport, getSettings, updateSettings } from "../api/endpoints"
import { Input } from "./ui/input"
import { Button } from "./ui/button"
import { CustomerProfitAudit } from "./CustomerProfitAudit"
import { apiErrorMessage } from "../utils/apiError"
import { toast } from "./ui/use-toast"
import { UnsavedNotice } from "./ui/unsaved-notice"
import { cn } from "../utils/cn"

/* ══════════════════════════════════════════════════════════════════════
   «نقاط الولاء»

   Points are 10 per 1,000 IQD of profit — so a customer whose sales carry no
   recorded cost is holding points counted against a profit nobody measured.
   The zero-cost column next to each balance is what says which balances to
   distrust, and opening a row goes straight to fixing the costs behind it.
══════════════════════════════════════════════════════════════════════ */

export function LoyaltyPointsPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState("")
  const [auditing, setAuditing] = useState<string | null>(null)
  const [valueDraft, setValueDraft] = useState<string | null>(null)
  const [daysDraft, setDaysDraft] = useState<string | null>(null)

  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings })
  const pointValue = valueDraft ?? String(settingsQuery.data?.loyaltyPointValue ?? 5)
  const expiryDays = daysDraft ?? String(settingsQuery.data?.loyaltyExpiryDays ?? 365)
  const saveMut = useMutation({
    mutationFn: () => updateSettings({
      loyaltyPointValue: Math.max(0, Number(pointValue) || 0),
      loyaltyExpiryDays: Math.max(0, Math.round(Number(expiryDays) || 0)),
    }),
    onSuccess: () => {
      toast({ title: "انحفظت إعدادات النقاط" })
      setValueDraft(null); setDaysDraft(null)
      void qc.invalidateQueries({ queryKey: ["settings"] })
      void qc.invalidateQueries({ queryKey: ["loyalty-balance"] })
    },
    onError: () => toast({ title: "تعذر الحفظ", variant: "destructive" }),
  })

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["loyalty-points-report"],
    queryFn: getLoyaltyPointsReport,
  })

  const q = search.trim()
  const rows = (data?.customers ?? []).filter(
    (c) => !q || c.name.includes(q) || (c.phone ?? "").includes(q),
  )
  const suspect = (data?.customers ?? []).filter((c) => c.zeroCostLines > 0).length

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-0 sm:p-4" dir="rtl" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl sm:p-5 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}>

        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-base font-bold text-slate-900 dark:text-slate-100">
              <Sparkles className="h-5 w-5 text-amber-500" />
              نقاط الولاء
            </h2>
            <p className="text-xs text-slate-500">
              النقطة تنحسب ١٠ نقاط لكل ١٠٠٠ دينار <b>ربح</b> — فالزبون الي مبيعاته بلا كلفة، نقاطه محسوبة على ربح ما انقاس.
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isLoading && <p className="py-10 text-center text-sm text-slate-400">جاري التحميل...</p>}
        {isError && <p className="py-10 text-center text-sm text-red-600">{apiErrorMessage(error)}</p>}

        {data && (
          <>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <Tile label="زبائن عندهم نقاط" value={String(data.customers.length)} />
              <Tile label="مجموع النقاط" value={data.totalPoints.toLocaleString("en-US")} />
              <Tile label="نقاطهم مشكوك بيها" value={String(suspect)} tone={suspect > 0 ? "amber" : "slate"} />
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <p className="mb-2 text-xs font-bold text-slate-700 dark:text-slate-200">إعدادات النقاط</p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="space-y-1">
                  <span className="block text-[11px] font-semibold text-slate-500">قيمة النقطة (دينار)</span>
                  <Input type="number" min={0} value={pointValue} dir="ltr" className="h-9 w-28 text-sm"
                    onChange={(e) => setValueDraft(e.target.value)} />
                </label>
                <label className="space-y-1">
                  <span className="block text-[11px] font-semibold text-slate-500">تنتهي بعد (يوم)</span>
                  <Input type="number" min={0} value={expiryDays} dir="ltr" className="h-9 w-28 text-sm"
                    onChange={(e) => setDaysDraft(e.target.value)} />
                </label>
                <Button size="sm" disabled={saveMut.isPending || (valueDraft === null && daysDraft === null)}
                  onClick={() => saveMut.mutate()}>
                  {saveMut.isPending ? "جاري الحفظ..." : (valueDraft === null && daysDraft === null) ? "محفوظ" : "احفظ"}
                </Button>
              </div>
              <UnsavedNotice show={valueDraft !== null || daysDraft !== null} what="إعدادات" />
              <p className="mt-1.5 text-[11px] text-slate-500">
                صفر بقيمة النقطة يطفي الاستبدال بلا ما يمس أي رصيد. صفر بالأيام يعني ما تنتهي.
              </p>
            </div>

            <div className="relative mt-4">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="دوّر باسم الزبون أو رقمه..." className="pr-9 text-sm" />
            </div>

            <div className="mt-3 space-y-1.5">
              {rows.length === 0 && (
                <p className="py-6 text-center text-xs text-slate-400">
                  {q ? "ما لقينا زبون بهذا الاسم." : "ما اكو ولا زبون عنده نقاط."}
                </p>
              )}
              {rows.map((c) => (
                <div key={c.id} className={cn(
                  "flex flex-wrap items-center gap-2 rounded-xl border p-3",
                  c.zeroCostLines > 0
                    ? "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30"
                    : "border-slate-200 dark:border-slate-700",
                )}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{c.name}</p>
                    <p className="text-[11px] text-slate-500" dir="ltr">{c.phone || "—"}</p>
                  </div>

                  {c.zeroCostLines > 0 && (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                      <AlertTriangle className="h-3 w-3" />
                      {c.zeroCostLines} سطر بلا كلفة
                    </span>
                  )}

                  <div className="shrink-0 text-left">
                    <p className="text-sm font-extrabold text-amber-600" dir="ltr">
                      {c.loyaltyPoints.toLocaleString("en-US")}
                    </p>
                    <p className="text-[10px] text-slate-400">نقطة</p>
                  </div>

                  <Button size="sm" variant="outline" className="shrink-0" onClick={() => setAuditing(c.id)}>
                    افحص وصلّح
                  </Button>
                </div>
              ))}
            </div>

            <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              لمن تصلّح سعر شراء، نقاط الزبون <b>تنزل</b> — لأن الربح الي انحسبت عليه كان أعلى من الحقيقة.
              هذا تصحيح، مو خصم عليه.
            </p>
          </>
        )}

        {auditing && (
          <CustomerProfitAudit customerId={auditing} onClose={() => setAuditing(null)} />
        )}
      </div>
    </div>
  )
}

function Tile({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "amber" }) {
  return (
    <div className={cn(
      "rounded-xl p-3",
      tone === "amber"
        ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
        : "bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    )}>
      <p className="text-[11px] font-semibold opacity-80">{label}</p>
      <p className="mt-0.5 text-sm font-extrabold" dir="ltr">{value}</p>
    </div>
  )
}
